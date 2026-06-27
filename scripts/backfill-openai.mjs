#!/usr/bin/env node
// Modelmeter — historical event backfill for OpenAI.
//
// Discovers significant OpenAI announcements via Hacker News (Algolia API),
// fetches each article for context, scores via Venice, drafts events with
// verified=false, and opens a single PR.
//
// Env required:
//   VENICE_API_KEY      Venice inference key
//
// Env optional:
//   BACKFILL_FROM       YYYY-MM-DD, default 3 years ago
//   BACKFILL_TO         YYYY-MM-DD, default today
//   BACKFILL_MIN_POINTS HN points threshold for inclusion, default 100
//   BACKFILL_SCORE_MIN  Venice 1-10 threshold to accept, default 7
//   BACKFILL_DRY_RUN    "1" prints proposals to stdout and skips git/PR
//   BACKFILL_LIMIT      optional cap on candidates (for testing)
//   VENICE_MODEL        default qwen3-235b-a22b-instruct-2507

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const EVENTS_PATH = join(ROOT, "events/current.json");

const VENICE_KEY = process.env.VENICE_API_KEY;
const VENICE_MODEL = process.env.VENICE_MODEL ?? "qwen3-235b-a22b-instruct-2507";

const FROM = process.env.BACKFILL_FROM ?? new Date(Date.now() - 3 * 365 * 86400 * 1000).toISOString().slice(0, 10);
const TO = process.env.BACKFILL_TO ?? new Date().toISOString().slice(0, 10);
const MIN_POINTS = Number(process.env.BACKFILL_MIN_POINTS ?? 100);
const SCORE_MIN = Number(process.env.BACKFILL_SCORE_MIN ?? 7);
const DRY_RUN = process.env.BACKFILL_DRY_RUN === "1";
const LIMIT = process.env.BACKFILL_LIMIT ? Number(process.env.BACKFILL_LIMIT) : Infinity;

const PROVIDER_ENUM = new Set([
  "anthropic", "openai", "venice", "google", "xai",
  "meta", "deepseek", "alibaba", "zhipu", "moonshot",
  "mistral", "cohere", "nvidia", "amazon", "microsoft",
  "spacex", "groq", "together", "fireworks", "openrouter", "other",
]);

if (!VENICE_KEY) {
  console.error("VENICE_API_KEY missing. Set it in ~/.hermes/.env or shell.");
  process.exit(2);
}

console.log(`Backfilling OpenAI events ${FROM} → ${TO} (min HN points ${MIN_POINTS}, score min ${SCORE_MIN})…`);

const hits = await fetchHnHits();
console.log(`HN Algolia returned ${hits.length} story hit(s) on openai.com.`);

const existing = JSON.parse(readFileSync(EVENTS_PATH, "utf8"));
const existingUrls = new Set();
for (const e of existing.events) {
  for (const u of e.source_urls ?? []) existingUrls.add(canonicalUrl(u));
}

const candidates = [];
for (const hit of hits) {
  if (!hit.url) continue;
  if (existingUrls.has(canonicalUrl(hit.url))) continue;
  candidates.push({
    title: hit.title,
    source: "Hacker News / openai.com",
    url: hit.url,
    published: hit.created_at,
    points: hit.points,
    comments: hit.num_comments,
    snippet: hit.story_text ?? "",
  });
  if (candidates.length >= LIMIT) break;
}

console.log(`${candidates.length} candidate(s) after dedup against existing sources.`);

const proposals = [];
for (let i = 0; i < candidates.length; i++) {
  const cand = candidates[i];
  try {
    const enriched = await fetchArticleMeta(cand);
    const verdict = await scoreWithVenice(enriched);
    console.log(`  [${i + 1}/${candidates.length}] [${verdict.score}/10] ${cand.title.slice(0, 70)}`);
    if (verdict.score >= SCORE_MIN && verdict.event) {
      proposals.push(materializeEvent(verdict.event, enriched));
    }
    await sleep(250);
  } catch (err) {
    console.error(`  scoring failed: ${cand.title.slice(0, 60)} — ${err.message}`);
  }
}

const dedup = new Map();
for (const p of proposals) {
  if (!dedup.has(p.id)) dedup.set(p.id, p);
}
const unique = Array.from(dedup.values());

console.log(`\n${unique.length} unique proposal(s) drafted.`);

if (!unique.length) process.exit(0);

if (DRY_RUN) {
  console.log("\n--- dry-run proposals ---");
  console.log(JSON.stringify(unique, null, 2));
  process.exit(0);
}

const existingIds = new Set(existing.events.map((e) => e.id));
const fresh = unique.filter((p) => !existingIds.has(p.id));
console.log(`${fresh.length} fresh (not duplicate id).`);

if (!fresh.length) process.exit(0);

existing.events.push(...fresh);
existing.snapshot_date = new Date().toISOString().slice(0, 10);
writeFileSync(EVENTS_PATH, JSON.stringify(existing, null, 2) + "\n");

const branch = `backfill/openai-${FROM}-to-${TO}`;
sh(`git checkout -B ${branch}`);
sh(`git add events/current.json`);
sh(`git commit -m "events: openai backfill ${FROM} to ${TO} (${fresh.length} entries)"`);

const remoteExists = tryShOk(`git ls-remote --exit-code --heads origin ${branch}`);
if (remoteExists) {
  sh(`git push --force-with-lease origin ${branch}`);
} else {
  sh(`git push -u origin ${branch}`);
}

const prExistsRaw = tryShOut(`gh pr list --head ${branch} --json number --jq ".[0].number"`).trim();
if (prExistsRaw) {
  console.log(`PR #${prExistsRaw} already open for ${branch}. Updated.`);
} else {
  const body = buildPrBody(fresh, FROM, TO);
  const bodyPath = `/tmp/backfill-openai-${FROM}-${TO}.md`;
  writeFileSync(bodyPath, body);
  sh(`gh pr create --title "events: openai backfill ${FROM} to ${TO}" --body-file ${bodyPath} --base main --head ${branch}`);
}

sh(`git checkout main`);
console.log("Done.");

// ---- helpers ----

async function fetchHnHits() {
  const fromTs = Math.floor(new Date(FROM).getTime() / 1000);
  const toTs = Math.floor(new Date(TO).getTime() / 1000);
  const all = [];
  let page = 0;
  while (page < 20) {
    const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=created_at_i>${fromTs},created_at_i<${toTs},points>=${MIN_POINTS}&query=openai.com&restrictSearchableAttributes=url&hitsPerPage=100&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`HN Algolia error ${res.status} on page ${page}`);
      break;
    }
    const data = await res.json();
    const hits = (data.hits ?? []).filter((h) => h.url && /\/\/(www\.)?openai\.com\//.test(h.url));
    all.push(...hits);
    if (page >= (data.nbPages ?? 1) - 1) break;
    page++;
    await sleep(300);
  }
  return all;
}

async function fetchArticleMeta(cand) {
  try {
    const res = await fetch(cand.url, { headers: { "user-agent": "Mozilla/5.0 (compatible; modelmeter-backfill/0.1)" }, redirect: "follow" });
    if (!res.ok) return cand;
    const html = await res.text();
    const description = match(html, /<meta\s+(?:name|property)="(?:description|og:description)"\s+content="([^"]+)"/i);
    const ogTitle = match(html, /<meta\s+(?:name|property)="og:title"\s+content="([^"]+)"/i);
    const articleDate = match(html, /<meta\s+(?:name|property)="article:published_time"\s+content="([^"]+)"/i);
    return {
      ...cand,
      title: ogTitle ?? cand.title,
      published: articleDate ?? cand.published,
      snippet: description ?? cand.snippet ?? cand.title,
    };
  } catch {
    return cand;
  }
}

function match(s, re) {
  const m = s.match(re);
  return m ? decode(m[1]) : null;
}

function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function scoreWithVenice(cand) {
  const system = `You triage AI-industry news for a pricing/events dataset (modelmeter.xyz).
Score 1-10 how worth-recording the item is. >= 7 means: clearly affects model pricing, availability, capacity, regulation, or major industry structure. Include model launches, pricing changes, deprecations, acquisitions, funding rounds, partnerships, regulatory actions, infrastructure deals. < 7 means: marketing fluff, generic explainers, repeats of older news, low-signal employee tweets, conference promos.

If score >= 7, also draft an event entry:
{
  "type": one of [pricing_change, model_launch, model_deprecation, model_unavailable, compute_partnership, regulatory_action, acquisition, funding, open_source_release, legal_outcome, infrastructure, leadership_change],
  "providers": array of provider ids (lowercase) from: anthropic, openai, venice, google, xai, meta, deepseek, alibaba, zhipu, moonshot, mistral, cohere, nvidia, amazon, microsoft, spacex, groq, together, fireworks, openrouter, other,
  "models": array of "provider/model-id" strings (empty if unclear or none specific),
  "headline": one-line neutral factual summary,
  "summary": 1-3 sentence context paragraph,
  "tags": array of kebab-case strings; use "major" sparingly,
  "impact": { "magnitude": one of [minor, moderate, major, structural], "duration": one of [one-time, temporary, ongoing, structural], "price_direction": one of [up, down, mixed, none] }
}

Return strict JSON: { "score": int, "reasoning": string, "event": object_or_null }`;

  const user = `Title: ${cand.title}
URL: ${cand.url}
Published: ${cand.published}
HN points: ${cand.points} (${cand.comments} comments)
Snippet: ${cand.snippet}`;

  const res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${VENICE_KEY}`,
    },
    body: JSON.stringify({
      model: VENICE_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Venice ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(content);
}

function normalizeProviders(arr) {
  if (!Array.isArray(arr)) return ["openai"];
  const filtered = arr.map((s) => String(s).toLowerCase().trim()).filter((s) => PROVIDER_ENUM.has(s));
  const unique = Array.from(new Set(filtered));
  if (!unique.includes("openai")) unique.unshift("openai");
  return unique.length ? unique : ["openai"];
}

function normalizeTags(arr) {
  if (!Array.isArray(arr)) return [];
  return Array.from(new Set(arr.map((s) => slugify(String(s))).filter(Boolean)));
}

function materializeEvent(draft, cand) {
  const today = new Date().toISOString().slice(0, 10);
  const dateOnly = (cand.published ?? today).slice(0, 10);
  const yyyymm = dateOnly.slice(0, 7);
  const providers = normalizeProviders(draft.providers);
  const primary = providers[0];
  let slugBase = slugify(draft.headline ?? cand.title).slice(0, 60);
  if (slugBase.startsWith(`${primary}-`)) slugBase = slugBase.slice(primary.length + 1);
  const id = `${yyyymm}-${primary}-${slugBase}`;
  return {
    id,
    date: dateOnly,
    type: draft.type ?? "model_launch",
    providers,
    models: Array.isArray(draft.models) ? draft.models : [],
    headline: draft.headline ?? cand.title,
    summary: draft.summary ?? cand.snippet,
    source_urls: [cand.url],
    verified: false,
    tags: normalizeTags(draft.tags),
    impact: draft.impact ?? undefined,
    created_at: today,
    updated_at: today,
  };
}

function buildPrBody(events, from, to) {
  const lines = [
    `Auto-drafted backfill of OpenAI events from **${from}** to **${to}**.`,
    ``,
    `Source: Hacker News Algolia API → openai.com links with ≥${MIN_POINTS} points → Venice-scored ≥${SCORE_MIN}/10.`,
    ``,
    `**All entries have \`verified: false\` until human review.** Walk through with Claude (see modelmeter PR review pattern), edit/drop entries, flip \`verified: true\` before merging.`,
    ``,
    `## Proposed entries (${events.length})`,
    ``,
  ];
  for (const e of events) {
    lines.push(`- **${e.date}** \`${e.type}\` — ${e.headline}`);
  }
  return lines.join("\n");
}

function canonicalUrl(u) {
  try {
    const url = new URL(u);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return u;
  }
}

function slugify(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sh(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

function tryShOk(cmd) {
  try { execSync(cmd, { stdio: "ignore" }); return true; } catch { return false; }
}

function tryShOut(cmd) {
  try { return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString(); } catch { return ""; }
}