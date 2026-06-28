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
let clearedCount = 0;
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
    // Clear verification_required on models where price confirmed unchanged today
    const changedIds = new Set(changes.filter(c => c.status === "changed").map(c => c.model_id));
    for (const m of models) {
      if (m.verification_required && !changedIds.has(m.id)) {
        m.verification_required = false;
        m.last_verified = today;
        clearedCount++;
        console.log(`  ✓ cleared verification_required on ${m.id}`);
      }
    }

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

if (!allChanges.length && clearedCount === 0) {
  console.log("\nNo pricing changes detected today.");
  process.exit(0);
}

if (clearedCount > 0) console.log(`\n${clearedCount} model(s) had verification_required cleared.`);
if (allChanges.length) console.log(`${allChanges.length} provider page(s) with changes.`);

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

pricing.snapshot_date = today;
writeFileSync(PRICING_PATH, JSON.stringify(pricing, null, 2) + "\n");

// Clears-only: commit directly to main, no PR needed
if (appliedCount === 0 && clearedCount > 0) {
  sh(`git add pricing/current.json`);
  sh(`git commit -m "pricing: clear verification_required on ${clearedCount} confirmed model(s) (${today})"`);
  sh(`git push origin main`);
  console.log("Done — verification flags cleared, committed directly to main.");
  process.exit(0);
}

const allNew = allChanges.flatMap(p => p.changes.filter(c => c.status === "new").map(c => ({ ...c, url: p.url })));
const allDeprecated = allChanges.flatMap(p => p.changes.filter(c => c.status === "deprecated").map(c => ({ ...c, url: p.url })));
const hasReviewItems = allNew.length > 0 || allDeprecated.length > 0;

sh(`git checkout -B ${branch}`);
if (appliedCount > 0) {
  sh(`git add pricing/current.json`);
  const summary = [
    appliedCount > 0 ? `${appliedCount} change(s)` : null,
    allNew.length > 0 ? `${allNew.length} new` : null,
    allDeprecated.length > 0 ? `${allDeprecated.length} deprecated` : null,
  ].filter(Boolean).join(", ");
  sh(`git commit -m "pricing: drafted updates for ${today} (${summary})"`);
} else if (hasReviewItems) {
  // New/deprecated spotted but no price edits — still open a PR so they surface for review
  sh(`git commit --allow-empty -m "pricing: new/deprecated models spotted ${today} (no price edits)"`);
} else {
  process.exit(0);
}

const remoteExists = tryShOk(`git ls-remote --exit-code --heads origin ${branch}`);
if (remoteExists) {
  sh(`git push --force-with-lease origin ${branch}`);
} else {
  sh(`git push -u origin ${branch}`);
}

const body = buildPrBody(allChanges, allNew, allDeprecated, today);
const bodyPath = `/tmp/pricing-pr-${today}.md`;
writeFileSync(bodyPath, body);
const prTitle = allNew.length > 0
  ? `pricing: ${allNew.length} new model(s) spotted + updates for ${today}`
  : `pricing: drafted updates for ${today}`;
sh(`gh pr create --title "${prTitle}" --body-file ${bodyPath} --base main --head ${branch}`);
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

function buildPrBody(providers, allNew, allDeprecated, today) {
  const lines = [`Auto-drafted pricing updates for **${today}**.`, ``];

  if (allNew.length > 0) {
    lines.push(`## 🆕 New models spotted (${allNew.length})`);
    lines.push(`> Not auto-added — each needs full schema fields. Add manually to \`pricing/current.json\`.`);
    lines.push(``);
    for (const c of allNew) {
      const inC = c.new_input_cost != null ? `$${c.new_input_cost}` : "?";
      const outC = c.new_output_cost != null ? `$${c.new_output_cost}` : "?";
      lines.push(`- \`${c.model_id}\` — in ${inC} / out ${outC} per Mtok`);
      lines.push(`  Source: ${c.url}`);
      if (c.reasoning) lines.push(`  _${c.reasoning}_`);
    }
    lines.push(``);
  }

  if (allDeprecated.length > 0) {
    lines.push(`## ⚠️ Deprecated / disappeared from page (${allDeprecated.length})`);
    lines.push(`> Not auto-removed. Consider setting \`availability: "deprecated"\` on each.`);
    lines.push(``);
    for (const c of allDeprecated) {
      lines.push(`- \`${c.model_id}\` — no longer found on ${c.url}`);
      if (c.reasoning) lines.push(`  _${c.reasoning}_`);
    }
    lines.push(``);
  }

  const changedProviders = providers.filter(p => p.changes.some(c => c.status === "changed"));
  if (changedProviders.length > 0) {
    lines.push(`## Price changes (auto-applied)`);
    lines.push(`> \`verification_required: true\` set on each — confirm against source then merge.`);
    lines.push(``);
    for (const p of changedProviders) {
      lines.push(`### ${p.url}`);
      lines.push(``);
      for (const c of p.changes.filter(c => c.status === "changed")) {
        const inC = c.new_input_cost != null ? `$${c.new_input_cost}` : "?";
        const outC = c.new_output_cost != null ? `$${c.new_output_cost}` : "?";
        let line = `- \`${c.model_id}\` — in ${inC} / out ${outC} per Mtok`;
        if (c.reasoning) line += `  \n  _${c.reasoning}_`;
        lines.push(line);
      }
      if (p.notes) { lines.push(``); lines.push(`> ${p.notes}`); }
      lines.push(``);
    }
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