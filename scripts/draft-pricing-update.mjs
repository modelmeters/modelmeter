#!/usr/bin/env node
// Modelmeter — daily pricing update drafter.
//
// For each unique source_url in pricing/current.json: fetches the page,
// asks Venice to diff currently-tracked model prices against the page,
// applies "changed" updates with verification_required=true, flags "new"
// and "deprecated" models in the PR body for human follow-up, and opens
// a PR titled `pricing: drafted updates for YYYY-MM-DD`.
//
// Mirrors the events workflow: auto-draft → human review → squash-merge.
//
// Env required:
//   VENICE_API_KEY      Venice inference key
//   GITHUB_TOKEN        (gh CLI uses it)
//
// Env optional:
//   VENICE_MODEL        default qwen3-235b-a22b-instruct-2507
//   PRICING_DRY_RUN     "1" prints proposed changes and skips git/PR
//   PRICING_FORCE       "1" runs even if a PR for today already open
//   PRICING_LIMIT       optional cap on provider pages (testing)

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = process.cwd();
const PRICING_PATH = join(ROOT, "pricing/current.json");

const VENICE_KEY = process.env.VENICE_API_KEY;
const VENICE_MODEL = process.env.VENICE_MODEL ?? "qwen3-235b-a22b-instruct-2507";
const DRY_RUN = process.env.PRICING_DRY_RUN === "1";
const FORCE = process.env.PRICING_FORCE === "1";
const LIMIT = process.env.PRICING_LIMIT ? Number(process.env.PRICING_LIMIT) : Infinity;

if (!VENICE_KEY) {
  console.error("VENICE_API_KEY missing. Set it in ~/.hermes/.env or shell.");
  process.exit(2);
}

const today = new Date().toISOString().slice(0, 10);
const branch = `pricing/update-${today}`;

if (!DRY_RUN && !FORCE) {
  const openPr = tryShOut(`gh pr list --head ${branch} --state open --json number --jq ".[0].number"`).trim();
  if (openPr) {
    console.log(`PR #${openPr} already open for pricing update ${today}. Skipping. Set PRICING_FORCE=1 to overwrite.`);
    process.exit(0);
  }
}

const pricing = JSON.parse(readFileSync(PRICING_PATH, "utf8"));

const groups = new Map();
for (const m of pricing.models) {
  if (!m.source_url) continue;
  if (looksLikeApi(m.source_url)) continue;
  if (m.input_cost_per_mtok == null) continue;
  if (m.availability && m.availability !== "available") continue;
  if (!groups.has(m.source_url)) groups.set(m.source_url, []);
  groups.get(m.source_url).push(m);
}

const urls = Array.from(groups.keys()).slice(0, LIMIT);
console.log(`Checking ${urls.length} provider pricing page(s)…`);

const allChanges = [];
for (const url of urls) {
  const models = groups.get(url);
  try {
    const text = await fetchPageText(url);
    if (!text || text.length < 800) {
      console.log(`  Skipping ${url} — page text too small (${text?.length ?? 0} chars), likely JS-rendered.`);
      continue;
    }
    const diff = await extractDiffs(url, text, models);
    const changes = (diff?.changes ?? [])
      .filter((c) => c.status === "changed" || c.status === "new" || c.status === "deprecated")
      .filter((c) => {
        if (c.status === "changed") {
          const m = models.find((mm) => mm.id === c.model_id);
          if (!m) return true;
          const inputSame = c.new_input_cost == null || Math.abs(c.new_input_cost - (m.input_cost_per_mtok ?? 0)) < 0.001;
          const outputSame = c.new_output_cost == null || Math.abs(c.new_output_cost - (m.output_cost_per_mtok ?? 0)) < 0.001;
          return !(inputSame && outputSame);
        }
        if (c.status === "deprecated") {
          const m = models.find((mm) => mm.id === c.model_id);
          if (!m) return true;
          return m.availability !== "deprecated"; // already deprecated, skip
        }
        if (c.status === "new") {
          return !pricing.models.some((mm) => mm.id === c.model_id); // already tracked, skip
        }
        return true;
      });
    if (changes.length) {
      allChanges.push({ url, changes, notes: diff.notes ?? "" });
      console.log(`  ${url}: ${changes.length} change(s) (${changes.filter(c => c.status === "changed").length} changed, ${changes.filter(c => c.status === "new").length} new, ${changes.filter(c => c.status === "deprecated").length} deprecated)`);
    } else {
      console.log(`  ${url}: no changes`);
    }
    await sleep(400);
  } catch (err) {
    console.error(`  Error on ${url}: ${err.message}`);
  }
}

if (!allChanges.length) {
  console.log("\nNo pricing changes detected today.");
  process.exit(0);
}

console.log(`\n${allChanges.length} provider page(s) with changes.`);

let appliedCount = 0;
for (const provider of allChanges) {
  for (const change of provider.changes) {
    if (change.status !== "changed") continue;
    const m = pricing.models.find((mm) => mm.id === change.model_id);
    if (!m) continue;
    if (typeof change.new_input_cost === "number") m.input_cost_per_mtok = change.new_input_cost;
    if (typeof change.new_output_cost === "number") m.output_cost_per_mtok = change.new_output_cost;
    m.last_verified = today;
    m.verification_required = true;
    appliedCount++;
  }
}

if (DRY_RUN) {
  console.log("\n--- dry-run changes ---");
  console.log(JSON.stringify(allChanges, null, 2));
  process.exit(0);
}

if (appliedCount > 0) {
  pricing.snapshot_date = today;
  writeFileSync(PRICING_PATH, JSON.stringify(pricing, null, 2) + "\n");
}

sh(`git checkout -B ${branch}`);
if (appliedCount > 0) {
  sh(`git add pricing/current.json`);
  sh(`git commit -m "pricing: drafted updates for ${today} (${appliedCount} change(s))"`);
} else {
  console.log("No 'changed' status edits to commit — opening a PR-less notes file instead.");
  const notesPath = join(ROOT, `digest/.pricing-notes-${today}.md`);
  writeFileSync(notesPath, buildPrBody(allChanges, today));
  console.log(`Notes saved to ${notesPath}. (Not committing — no automated edits to send to review.)`);
  process.exit(0);
}

const remoteExists = tryShOk(`git ls-remote --exit-code --heads origin ${branch}`);
if (remoteExists) {
  sh(`git push --force-with-lease origin ${branch}`);
} else {
  sh(`git push -u origin ${branch}`);
}

const body = buildPrBody(allChanges, today);
const bodyPath = `/tmp/pricing-pr-${today}.md`;
writeFileSync(bodyPath, body);
sh(`gh pr create --title "pricing: drafted updates for ${today}" --body-file ${bodyPath} --base main --head ${branch}`);
sh(`git checkout main`);
console.log("Done.");

// ---- helpers ----

async function fetchPageText(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.5",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40000);
}

async function extractDiffs(url, text, models) {
  const modelSummary = models
    .map((m) => {
      const inCost = m.input_cost_per_mtok ?? "null";
      const outCost = m.output_cost_per_mtok ?? "null";
      return `- ${m.id} (${m.display_name ?? m.model}) — input $${inCost}/Mtok, output $${outCost}/Mtok`;
    })
    .join("\n");

  const system = `You compare a provider's live pricing page against a list of currently-tracked model prices.

For each tracked model, look for its current input/output price on the page (per million tokens, USD).
- If the price on the page matches what we already track → DO NOT include it. Omit it entirely. Only report differences.
- If the price on the page is NUMERICALLY DIFFERENT from what we track → status "changed". Set new_input_cost and new_output_cost to the numbers FROM THE PAGE (not our current values). In your reasoning, include both the old tracked value and the new page value so the diff is clear.
- CRITICAL: Never return status "changed" if the price you found equals the price we already have. "Changed" means the number changed.
- If the model is no longer mentioned anywhere on the page → status "deprecated".

Then list up to 5 models on the page that are NOT in our tracked list AND have explicit per-Mtok USD prices in a pricing table (status "new"). Only include "new" entries with real prices from the page — do not guess or infer prices.

Be CONSERVATIVE: only flag "changed" if the page explicitly shows a different number in a pricing table or per-Mtok pricing section. Marketing copy, FAQ examples, and bundled plan descriptions don't count. If unsure, omit.

Return strict JSON: { "changes": [{ "model_id": string, "status": "changed"|"new"|"deprecated", "new_input_cost"?: number, "new_output_cost"?: number, "reasoning": string }], "notes": string }`;

  const user = `Provider page: ${url}

Currently-tracked models:
${modelSummary}

Page text (stripped HTML, may be truncated):
${text}`;

  const res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${VENICE_KEY}` },
    body: JSON.stringify({
      model: VENICE_MODEL,
      temperature: 0.1,
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
  return JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
}

function buildPrBody(providers, today) {
  const lines = [
    `Auto-drafted pricing updates for **${today}**.`,
    ``,
    `Models with \`status: changed\` had their \`input_cost_per_mtok\`/\`output_cost_per_mtok\` and \`last_verified\` updated in-place, with \`verification_required\` set to \`true\` until you confirm against the source.`,
    ``,
    `Models with \`status: new\` were spotted on the page but aren't tracked yet — not auto-added (need full schema fields). Flag here for manual addition.`,
    ``,
    `Models with \`status: deprecated\` disappeared from the page — not auto-removed (per "always include where we can"). Consider setting \`availability: deprecated\` or adding a note.`,
    ``,
  ];
  for (const p of providers) {
    lines.push(`## ${p.url}`);
    lines.push(``);
    for (const c of p.changes) {
      const status = c.status.toUpperCase();
      let line = `- **${status}** \`${c.model_id}\``;
      if (c.status === "changed" || c.status === "new") {
        const inC = c.new_input_cost != null ? `$${c.new_input_cost}` : "?";
        const outC = c.new_output_cost != null ? `$${c.new_output_cost}` : "?";
        line += ` — in ${inC} / out ${outC} per Mtok`;
      }
      if (c.reasoning) line += `  \n  _${c.reasoning}_`;
      lines.push(line);
    }
    if (p.notes) {
      lines.push(``);
      lines.push(`> ${p.notes}`);
    }
    lines.push(``);
  }
  return lines.join("\n");
}

function looksLikeApi(url) {
  return /\/v\d+\/|\.json($|\?)/i.test(url);
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