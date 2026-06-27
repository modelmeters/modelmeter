#!/usr/bin/env node
// Modelmeter digest filter — Hermes-side helper.
//
// Reads the latest digest/YYYY-MM-DD.md, scores each candidate with Venice,
// drafts events that score >= threshold, appends them to events/current.json
// with verified=false, and opens a PR for human review.
//
// Env required:
//   VENICE_API_KEY      Venice inference key
//   GITHUB_TOKEN        (gh CLI uses it; we don't read it directly)
//
// Env optional:
//   FILTER_SCORE_MIN    integer 1-10, default 7
//   FILTER_DATE         YYYY-MM-DD to force a specific digest; default = latest
//   FILTER_DRY_RUN      "1" prints proposals to stdout and skips git push/PR
//   VENICE_MODEL        default qwen3-235b-a22b-instruct-2507

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const DIGEST_DIR = join(ROOT, "digest");
const EVENTS_PATH = join(ROOT, "events/current.json");

const SCORE_MIN = Number(process.env.FILTER_SCORE_MIN ?? 7);
const DRY_RUN = process.env.FILTER_DRY_RUN === "1";
const VENICE_MODEL = process.env.VENICE_MODEL ?? "qwen3-235b-a22b-instruct-2507";
const VENICE_KEY = process.env.VENICE_API_KEY;

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

const digestDate = process.env.FILTER_DATE ?? findLatestDigest();
if (!digestDate) {
  console.error("No digest files found in digest/");
  process.exit(1);
}

const digestPath = join(DIGEST_DIR, `${digestDate}.md`);
if (!existsSync(digestPath)) {
  console.error(`Digest not found: ${digestPath}`);
  process.exit(1);
}

console.log(`Filtering digest ${digestDate} (score min ${SCORE_MIN})…`);
const md = readFileSync(digestPath, "utf8");
const candidates = parseCandidates(md);
console.log(`Found ${candidates.length} candidate(s) in digest.`);

if (!candidates.length) process.exit(0);

const proposals = [];
for (const cand of candidates) {
  try {
    const verdict = await scoreWithVenice(cand);
    console.log(`  [${verdict.score}/10] ${cand.title.slice(0, 70)}`);
    if (verdict.score >= SCORE_MIN && verdict.event) {
      proposals.push(materializeEvent(verdict.event, cand));
    }
  } catch (err) {
    console.error(`  scoring failed: ${cand.title.slice(0, 60)} — ${err.message}`);
  }
}

if (!proposals.length) {
  console.log("Nothing met the threshold. Done.");
  process.exit(0);
}

console.log(`\n${proposals.length} proposal(s) drafted.`);

if (DRY_RUN) {
  console.log("\n--- dry-run proposals ---");
  console.log(JSON.stringify(proposals, null, 2));
  process.exit(0);
}

const existing = JSON.parse(readFileSync(EVENTS_PATH, "utf8"));
const existingIds = new Set(existing.events.map((e) => e.id));
const fresh = proposals.filter((p) => !existingIds.has(p.id));

if (!fresh.length) {
  console.log("All proposals already exist in events/current.json. Done.");
  process.exit(0);
}

existing.events.push(...fresh);
existing.snapshot_date = new Date().toISOString().slice(0, 10);
writeFileSync(EVENTS_PATH, JSON.stringify(existing, null, 2) + "\n");

const branch = `hermes/digest-${digestDate}`;

sh(`git checkout -B ${branch}`);
sh(`git add events/current.json`);
sh(`git commit -m "events: hermes proposals for ${digestDate}"`);

const remoteExists = tryShOk(`git ls-remote --exit-code --heads origin ${branch}`);
if (remoteExists) {
  console.log(`Branch ${branch} already on origin — pushing force-with-lease.`);
  sh(`git push --force-with-lease origin ${branch}`);
} else {
  sh(`git push -u origin ${branch}`);
}

const prExists = tryShOut(`gh pr list --head ${branch} --json number --jq ".[0].number"`).trim();
if (prExists) {
  console.log(`PR #${prExists} already open for ${branch}. Updated.`);
} else {
  const body = buildPrBody(fresh, digestDate);
  const bodyPath = `/tmp/hermes-pr-${digestDate}.md`;
  writeFileSync(bodyPath, body);
  sh(`gh pr create --title "events: hermes proposals for ${digestDate}" --body-file ${bodyPath} --base main --head ${branch}`);
}

sh(`git checkout main`);
console.log("Done.");

// ---- helpers ----

function findLatestDigest() {
  const entries = readdirSync(DIGEST_DIR)
    .filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n))
    .sort();
  return entries.length ? entries.at(-1).replace(/\.md$/, "") : null;
}

function parseCandidates(md) {
  const sectionRegex = /### (.+?)\n\n((?:- \*\*.+?\n)+)/g;
  const out = [];
  let m;
  while ((m = sectionRegex.exec(md))) {
    const title = m[1].trim();
    const body = m[2];
    const fields = {};
    for (const line of body.split("\n")) {
      const fm = line.match(/^- \*\*(.+?):\*\* (.+)$/);
      if (fm) fields[fm[1].toLowerCase()] = fm[2].trim();
    }
    if (!fields.link) continue;
    out.push({
      title,
      source: fields.source ?? "",
      published: fields.published ?? null,
      url: fields.link,
      snippet: fields.snippet ?? "",
    });
  }
  return out;
}

async function scoreWithVenice(cand) {
  const system = `You triage AI-industry news for a pricing/events dataset (modelmeter.xyz).
Score 1-10 how worth-recording the item is. >= 7 means: clearly affects model pricing, availability, capacity, regulation, or major industry structure. < 7 means: marketing fluff, conference promos, generic explainers, unrelated tech news, or sub-significant blog posts.

If score >= 7, also draft an event entry matching this schema:
{
  "type": one of [pricing_change, model_launch, model_deprecation, model_unavailable, compute_partnership, regulatory_action, acquisition, funding, open_source_release, legal_outcome, infrastructure, leadership_change],
  "providers": array of provider ids (lowercase, from: anthropic, openai, venice, google, xai, meta, deepseek, alibaba, zhipu, moonshot, mistral, cohere, nvidia, amazon, microsoft, spacex, groq, together, fireworks, openrouter, other),
  "models": array of "provider/model-id" strings (empty if unclear),
  "headline": one-line neutral factual summary,
  "summary": 1-3 sentence context paragraph,
  "tags": array of strings (use "major" sparingly, only for structural shifts),
  "impact": { "magnitude": one of [minor, moderate, major, structural], "duration": one of [one-time, temporary, ongoing, structural], "price_direction": one of [up, down, mixed, none] }
}

Return strict JSON: { "score": int, "reasoning": string, "event": object_or_null }`;

  const user = `Title: ${cand.title}
Source: ${cand.source}
Published: ${cand.published}
URL: ${cand.url}
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
  if (!Array.isArray(arr)) return ["other"];
  const filtered = arr
    .map((s) => String(s).toLowerCase().trim())
    .filter((s) => PROVIDER_ENUM.has(s));
  const unique = Array.from(new Set(filtered));
  return unique.length ? unique : ["other"];
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

function buildPrBody(events, digestDate) {
  const lines = [
    `Auto-drafted from \`digest/${digestDate}.md\` by Hermes.`,
    ``,
    `**All entries have \`verified: false\` until a human confirms.** Review each, edit headline/summary/providers as needed, then flip \`verified: true\` before merging — or drop entries that don't belong.`,
    ``,
    `## Proposed entries`,
    ``,
  ];
  for (const e of events) {
    lines.push(`### ${e.headline}`);
    lines.push(``);
    lines.push(`- **id:** \`${e.id}\``);
    lines.push(`- **type:** ${e.type}`);
    lines.push(`- **date:** ${e.date}`);
    lines.push(`- **providers:** ${(e.providers ?? []).join(", ") || "—"}`);
    lines.push(`- **source:** ${e.source_urls[0]}`);
    lines.push(``);
    lines.push(`> ${e.summary}`);
    lines.push(``);
  }
  return lines.join("\n");
}

function slugify(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sh(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

function tryShOk(cmd) {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function tryShOut(cmd) {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch {
    return "";
  }
}