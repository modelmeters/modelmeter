#!/usr/bin/env node
// Modelmeter Check — GitHub Action core.
// Scans the repo for known model ids (or takes an explicit list), asks
// modelmeter.xyz/check what the record says about them, and turns the answer
// into annotations, a job summary, and an exit code.
// Zero dependencies; needs node >= 18 (actions runners ship 20+).

import { readFileSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { join, extname } from "node:path";

const API = (process.env.INPUT_API_BASE || "https://modelmeter.xyz").replace(/\/$/, "");
const FAIL_ON = (process.env.INPUT_FAIL_ON || "breaking").toLowerCase();
const WARN_DAYS = parseInt(process.env.INPUT_WARN_DAYS || "120", 10);
const ROOT = process.env.INPUT_PATHS || ".";

const SCAN_EXTS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".rb", ".go", ".java", ".rs", ".php", ".cs", ".json", ".yaml", ".yml", ".toml", ".env", ".cfg", ".ini", ".sh"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "vendor", ".venv", "venv", "__pycache__", "target", ".next"]);

async function main() {
  let models = (process.env.INPUT_MODELS || "").split(",").map((s) => s.trim()).filter(Boolean);
  let hits = new Map(); // model -> [file:line, ...]

  if (!models.length) {
    console.log(`No models input — scanning ${ROOT} for known model ids…`);
    // Needles: the full catalog (including deprecated/unavailable — those are
    // the ids that matter most) plus every model named in a deprecation event
    // (covers models retired before the catalog tracked them), each in dashed
    // and dotted spellings (catalog says gemini-2-5-flash, code says
    // gemini-2.5-flash).
    const [catalog, deps] = await Promise.all([
      getJson(`${API}/models?include_unavailable=true&include_unverified=true`),
      getJson(`${API}/deprecations?status=all&limit=500`),
    ]);
    const ids = new Set();
    const add = (bare) => {
      if (!bare || bare.length < 5) return;
      ids.add(bare);
      const dotted = bare.replace(/(\d)-(\d)/g, "$1.$2");
      if (dotted !== bare) ids.add(dotted);
    };
    for (const m of catalog.models ?? []) {
      add(m.id.split("/").slice(1).join("/"));
      for (const a of m.aliases ?? []) add(a);
    }
    for (const r of deps.deprecations ?? []) add(r.model.split("/").slice(1).join("/"));
    hits = scan(ROOT, ids);
    models = [...hits.keys()];
    console.log(`Found ${models.length} distinct model id(s) referenced in the repo.`);
    if (!models.length) { console.log("Nothing to check."); return; }
  }

  const out = [];
  for (let i = 0; i < models.length; i += 50) {
    const batch = models.slice(i, i + 50);
    const res = await getJson(`${API}/check?models=${encodeURIComponent(batch.join(","))}`);
    out.push(...res.results);
  }

  const today = new Date().toISOString().slice(0, 10);
  let failures = 0, warnings = 0;
  const rows = [];
  for (const r of out) {
    const where = hits.get(r.query)?.[0];
    const loc = where ? ` (${where})` : "";
    if (r.status === "retired") {
      failures++;
      annotate("error", `${r.query} is RETIRED (since ${r.effective_at})${r.migration_target ? ` — migrate to ${bare(r.migration_target)}` : ""}${loc}`, where);
      rows.push([r.query, `🔴 retired ${r.effective_at}`, bare(r.migration_target)]);
    } else if (r.status === "scheduled") {
      const urgent = r.days_remaining <= WARN_DAYS;
      if (urgent) failures++; else warnings++;
      annotate(urgent ? "error" : "warning", `${r.query} retires in ${r.days_remaining}d (${r.effective_at})${r.migration_target ? ` — migrate to ${bare(r.migration_target)}` : ""}${loc}`, where);
      rows.push([r.query, `${urgent ? "🟠" : "🟡"} ${r.days_remaining}d left (${r.effective_at})`, bare(r.migration_target)]);
    } else if (r.status === "affected" || r.status === "deprecated_in_catalog") {
      warnings++;
      annotate("warning", `${r.query}: ${r.events?.[0]?.headline ?? "flagged in the record"}${loc}`, where);
      rows.push([r.query, `🟡 ${r.status.replace(/_/g, " ")}`, bare(r.migration_target)]);
    } else if (r.status === "unknown") {
      rows.push([r.query, "⚪ not in catalog", ""]);
    } else {
      rows.push([r.query, "🟢 ok", ""]);
    }
  }

  summary(rows, today);

  const shouldFail =
    (FAIL_ON === "breaking" && failures > 0) ||
    (FAIL_ON === "retired" && out.some((r) => r.status === "retired"));
  console.log(`\n${failures} failing, ${warnings} warning(s) across ${out.length} model(s). fail-on=${FAIL_ON}.`);
  if (shouldFail) process.exit(1);
}

function scan(root, ids) {
  const hits = new Map();
  const needles = [...ids];
  walk(root, (file) => {
    let text;
    try { text = readFileSync(file, "utf8"); } catch { return; }
    const lines = text.split("\n");
    for (const id of needles) {
      if (!text.includes(id)) continue;
      const re = new RegExp(`(^|[^A-Za-z0-9.-])${escapeRe(id)}([^A-Za-z0-9.-]|$)`);
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          if (!hits.has(id)) hits.set(id, []);
          if (hits.get(id).length < 3) hits.get(id).push(`${file}:${i + 1}`);
          break;
        }
      }
    }
  });
  return hits;
}

function walk(dir, onFile) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, onFile);
    else if (st.size < 2_000_000 && SCAN_EXTS.has(extname(name))) onFile(p);
  }
}

function annotate(level, msg, where) {
  const locPart = where ? `file=${where.split(":")[0]},line=${where.split(":")[1] ?? 1},` : "";
  console.log(`::${level} ${locPart}title=Modelmeter Check::${msg}`);
}

function summary(rows, today) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const md = [
    `## Modelmeter Check — ${today}`,
    "",
    "| Model | Status | Migration target |",
    "|---|---|---|",
    ...rows.map((r) => `| \`${r[0]}\` | ${r[1]} | ${r[2] ? `\`${r[2]}\`` : "—"} |`),
    "",
    `Powered by the [changelog of record](https://modelmeter.xyz) · [\`/check\` API](https://modelmeter.xyz/check?models=gpt-4o) · [feed](https://modelmeter.xyz/feed.xml)`,
  ].join("\n");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
}

async function getJson(url) {
  const r = await fetch(url, { headers: { "user-agent": "modelmeter-check-action" } });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return await r.json();
}

const bare = (id) => (id ? id.split("/").slice(1).join("/") || id : "");
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

main().catch((e) => { console.log(`::error title=Modelmeter Check::${e.message}`); process.exit(1); });
