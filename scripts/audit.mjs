#!/usr/bin/env node
// Cross-dataset integrity audit. validate.mjs checks each file against its own
// schema; this checks the seams BETWEEN datasets — the joins the UI and API
// actually perform. Records live or die on trust, so broken references are
// bugs, not quirks.
//
//   ERROR → exits 1 (CI fails). Invariant violations: dangling references,
//           impossible timelines, forbidden sources, duplicate identities.
//   WARN  → reported, doesn't fail CI. Data smells needing a human call.
//   INFO  → coverage/staleness stats worth glancing at.
//
// Run: node scripts/audit.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const events = JSON.parse(readFileSync(join(ROOT, "events/current.json"), "utf8"));
const pricing = JSON.parse(readFileSync(join(ROOT, "pricing/current.json"), "utf8"));
const history = JSON.parse(readFileSync(join(ROOT, "pricing/history.json"), "utf8"));

const today = new Date().toISOString().slice(0, 10);
let errors = 0, warns = 0;
const err = (rule, msg) => { errors++; console.log(`  ✗ ERROR ${rule}: ${msg}`); };
const warn = (rule, msg) => { warns++; console.log(`  ⚠ WARN  ${rule}: ${msg}`); };
const info = (msg) => console.log(`  · ${msg}`);
const section = (t) => console.log(`\n[${t}]`);

// ---------- shared id resolution ----------
const normId = (x) => String(x).toLowerCase().trim().replace(/\./g, "-");
const baseId = (x) => normId(x).replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{8}$/, "").replace(/-\d{2}-\d{2}$/, "").replace(/-\d{4}$/, "");
const known = new Set();
for (const m of pricing.models) {
  known.add(normId(m.id)); known.add(baseId(m.id));
  const prov = m.id.split("/")[0];
  for (const a of m.aliases ?? []) { known.add(normId(`${prov}/${a}`)); known.add(baseId(`${prov}/${a}`)); }
}
for (const m of history.models) { known.add(normId(m.id)); known.add(baseId(m.id)); }
const resolves = (id) => known.has(normId(id)) || known.has(baseId(id));

// ---------- events ----------
section("events: identity & timeline");
{
  const seen = new Map();
  for (const e of events.events) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
  for (const [id, n] of seen) if (n > 1) err("dup-event-id", `${id} appears ${n}×`);

  for (const e of events.events) {
    if (e.effective_at && e.effective_at < e.announced_at)
      err("timeline", `${e.id}: effective_at ${e.effective_at} precedes announced_at ${e.announced_at}`);
    if (e.announced_at > today)
      err("future-announcement", `${e.id}: announced_at ${e.announced_at} is in the future — a scheduled change belongs in effective_at, announced_at is when it became public`);
  }
}

section("events: correction trail");
{
  const ids = new Set(events.events.map((e) => e.id));
  for (const e of events.events) {
    if (e.corrects && !ids.has(e.corrects)) err("dangling-corrects", `${e.id} corrects missing event ${e.corrects}`);
    if (e.type === "correction" && !e.corrects) err("correction-without-target", `${e.id} is a correction but has no corrects field`);
    if (e.status === "corrected" && !events.events.some((c) => c.corrects === e.id))
      warn("orphan-corrected", `${e.id} is status corrected but no correction event points at it`);
  }
}

section("events: text integrity");
{
  // LLM-extraction mojibake guard: CJK/Hangul runs inside otherwise-English
  // event text (the "Son游戏副本" class — caught by an external reviewer, to
  // our mild embarrassment).
  let hits = 0;
  for (const e of events.events) {
    const m = (e.headline + " " + e.summary).match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]{2,}/);
    if (m) { hits++; err("garbled-text", `${e.id}: unexpected script run "${m[0].slice(0, 12)}"`); }
  }
  if (!hits) info("no unexpected-script runs in event text");
}

section("events: sources");
{
  const FORBIDDEN = ["news.google.com", "google.com/rss"];
  for (const e of events.events) {
    for (const s of e.sources ?? []) {
      if (FORBIDDEN.some((f) => (s.url ?? "").includes(f)))
        err("aggregator-source", `${e.id}: ${s.url} — schema forbids aggregator links`);
    }
    if (!e.sources?.length) err("no-source", `${e.id} has no sources`);
  }
}

section("events: type/severity coherence");
{
  const EXPECT = {
    model_deprecation: "breaking", id_rename: "breaking", model_swap: "breaking", endpoint_change: "breaking",
    model_unavailable: "action_required", pricing_change: "action_required",
    rate_limit_change: "action_required", context_change: "action_required", capability_change: "action_required",
  };
  // A deliberate downgrade to informational (consumer-scope pricing news etc.)
  // is a reviewed judgment call, not a smell — count it, don't warn. Warn only
  // on unexpected escalations/derivations in the operational tier.
  let mismatches = 0, downgraded = 0;
  for (const e of events.events) {
    const want = EXPECT[e.type];
    if (!want || e.severity === want) continue;
    if (e.severity === "informational") { downgraded++; continue; }
    mismatches++;
    if (mismatches <= 10) warn("severity-mismatch", `${e.id}: type ${e.type} usually ${want}, has ${e.severity}`);
  }
  if (mismatches > 10) info(`…and ${mismatches - 10} more severity mismatches`);
  if (downgraded) info(`${downgraded} event(s) deliberately scoped down to informational (consumer/product news)`);
  if (!mismatches) info("all operational-tier events carry their expected severity");
}

section("events: operational completeness");
{
  for (const e of events.events) {
    if (e.type !== "model_deprecation") continue;
    if (!e.models?.length) warn("deprecation-no-models", `${e.id} names no affected models`);
    if (!e.effective_at) warn("deprecation-no-shutdown", `${e.id} has no effective_at (no shutdown date)`);
  }
}

section("events → catalog/history: model id resolution");
{
  // breaking/action_required references feed /check and the lifecycles chart —
  // those must resolve. Informational news events routinely name products we
  // don't price-track (video models, apps) or unverified rumor names; count
  // them, don't flood.
  let refs = 0; const opUnresolved = []; let infoUnresolved = 0;
  for (const e of events.events) {
    for (const m of e.models ?? []) {
      refs++;
      if (resolves(m)) continue;
      if (e.severity === "informational") infoUnresolved++;
      else opUnresolved.push(`${m} (${e.id})`);
    }
  }
  info(`${refs} model references across events · ${refs - opUnresolved.length - infoUnresolved} resolve against catalog/aliases/history`);
  for (const u of opUnresolved.slice(0, 20)) warn("unresolved-model-operational", u);
  if (opUnresolved.length > 20) info(`…and ${opUnresolved.length - 20} more unresolved operational refs`);
  info(`${infoUnresolved} unresolved refs in informational events (untracked products/rumor names — expected)`);
}

// ---------- pricing catalog ----------
section("catalog: sanity");
{
  for (const m of pricing.models) {
    if (m.input_cost_per_mtok != null && m.output_cost_per_mtok != null && m.input_cost_per_mtok > m.output_cost_per_mtok)
      warn("input-gt-output", `${m.id}: input $${m.input_cost_per_mtok} > output $${m.output_cost_per_mtok} — unusual, verify`);

  }
  const stale = pricing.models.filter((m) => m.last_verified && (new Date(today) - new Date(m.last_verified)) / 864e5 > 30);
  const byProv = {};
  for (const m of stale) byProv[m.provider] = (byProv[m.provider] ?? 0) + 1;
  info(`last_verified >30d stale: ${stale.length}/${pricing.models.length}${stale.length ? " — " + Object.entries(byProv).map(([p, n]) => `${p}:${n}`).join(" ") : ""}`);
  const DIRECT = ["anthropic", "openai", "google", "xai", "deepseek", "mistral", "cohere"];
  const nullCtx = pricing.models.filter((m) => DIRECT.includes(m.provider) && m.context_window == null);
  info(`direct-provider context_window nulls: ${nullCtx.length}${nullCtx.length ? " — " + nullCtx.map((m) => m.id.split("/")[1]).slice(0, 8).join(", ") + (nullCtx.length > 8 ? "…" : "") : ""}`);
}

// ---------- history ----------
section("history: identity (duplicate-series regression guard)");
{
  const byKey = new Map();
  for (const m of history.models) {
    const k = m.provider + ":" + normId(m.id.split("/").slice(1).join("/")).replace(/-/g, "");
    (byKey.get(k) ?? byKey.set(k, []).get(k)).push(m.id);
  }
  let dupes = 0;
  for (const ids of byKey.values()) if (ids.length > 1) { dupes++; err("dup-history-series", ids.join(" <-> ")); }
  if (!dupes) info(`${history.models.length} series, no duplicate identities`);
}

section("history: price-jump anomalies (extraction-error candidates)");
{
  let hits = 0;
  for (const m of history.models) {
    for (let i = 1; i < m.history.length; i++) {
      const a = m.history[i - 1].input_cost_per_mtok, b = m.history[i].input_cost_per_mtok;
      if (a > 0 && b > 0 && (b / a > 50 || a / b > 50)) {
        hits++;
        if (hits <= 10) warn("price-jump", `${m.id}: $${a} → $${b} between ${m.history[i - 1].date} and ${m.history[i].date}`);
      }
    }
  }
  if (hits > 10) info(`…and ${hits - 10} more price jumps >50×`);
  if (!hits) info("no >50× input-price jumps between consecutive snapshots");
}

// ---------- summary ----------
console.log(`\n${errors ? "FAIL" : "PASS"} — ${errors} error(s), ${warns} warning(s)`);
process.exit(errors ? 1 : 0);
