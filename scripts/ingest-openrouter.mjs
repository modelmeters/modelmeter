#!/usr/bin/env node
// Pulls the full OpenRouter model catalog from their public API and merges
// it into pricing/current.json as entries with provider="openrouter".
//
// OpenRouter's API: https://openrouter.ai/api/v1/models
// Returns prices as dollars-per-token. We convert to USD-per-Mtok.
//
// Behavior:
// - Filters to text/chat models (skips embeddings, image, audio, etc.)
// - Attempts to link upstream_model_id to existing direct entries
//   when the normalized name matches.
// - Does NOT overwrite existing openrouter/* entries unless --force is set.
// - Marks entries verification_required: false (API is canonical).
//
// Usage:
//   node scripts/ingest-openrouter.mjs
//   node scripts/ingest-openrouter.mjs --force        # overwrite existing openrouter entries
//   node scripts/ingest-openrouter.mjs --dry-run      # print plan, don't write

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CURRENT_PATH = join(process.cwd(), "pricing/current.json");
const TODAY = new Date().toISOString().slice(0, 10);

const args = parseArgs(process.argv.slice(2));
const force = Boolean(args.force);
const dryRun = Boolean(args["dry-run"]);

const current = JSON.parse(readFileSync(CURRENT_PATH, "utf8"));
const byId = new Map(current.models.map(m => [m.id, m]));

console.log("Fetching openrouter.ai/api/v1/models…");
const res = await fetch("https://openrouter.ai/api/v1/models", {
  headers: { "user-agent": "modelmeter-ingest/0.1 (+https://modelmeter.xyz)" },
});
if (!res.ok) {
  console.error(`OpenRouter API HTTP ${res.status}`);
  process.exit(1);
}
const body = await res.json();
const orModels = body.data || [];
console.log(`OpenRouter returned ${orModels.length} models total.`);

// Build an upstream lookup index: provider/model-name-normalized → existing entry
const upstreamIndex = new Map();
for (const m of current.models) {
  if (m.provider === "venice" || m.provider === "openrouter") continue; // only direct providers
  const key = `${m.provider}/${normalizeName(m.model)}`;
  upstreamIndex.set(key, m.id);
  // Also index by display name parts for fuzzy fallback
  upstreamIndex.set(`${m.provider}/${normalizeName(m.display_name)}`, m.id);
}

const stats = { added: 0, skipped: 0, updated: 0, dropped: 0, withUpstream: 0 };
const proposed = [];

for (const m of orModels) {
  if (!m.id || !m.pricing) { stats.dropped++; continue; }
  // Skip non-text generation models
  const inputModalities = m.architecture?.input_modalities || [];
  const outputModalities = m.architecture?.output_modalities || [];
  const isText = outputModalities.includes("text");
  if (!isText) { stats.dropped++; continue; }

  // Filter "openrouter/auto" and similar synthetic entries
  if (m.id.startsWith("openrouter/")) { stats.dropped++; continue; }

  const [orProvider, orModel] = m.id.includes("/")
    ? [m.id.split("/")[0], m.id.split("/").slice(1).join("/")]
    : ["misc", m.id];

  const ourId = `openrouter/${normalizeId(orProvider + "-" + orModel)}`;
  if (!/^[a-z0-9-]+\/[a-z0-9.-]+$/.test(ourId)) { stats.dropped++; continue; }

  // Convert OpenRouter's $/token → $/Mtok
  const inPriceStr = m.pricing.prompt;
  const outPriceStr = m.pricing.completion;
  const inPrice = inPriceStr != null ? Number(inPriceStr) * 1_000_000 : null;
  const outPrice = outPriceStr != null ? Number(outPriceStr) * 1_000_000 : null;
  if (inPrice == null || outPrice == null || !Number.isFinite(inPrice) || !Number.isFinite(outPrice)) {
    stats.dropped++; continue;
  }

  const cacheReadStr = m.pricing.input_cache_read;
  const cacheWriteStr = m.pricing.input_cache_write;
  const cacheRead = cacheReadStr != null ? Number(cacheReadStr) * 1_000_000 : null;
  const cacheWrite = cacheWriteStr != null ? Number(cacheWriteStr) * 1_000_000 : null;

  // Try to find an upstream direct entry
  let upstreamId = null;
  const candidates = [
    `${orProvider}/${normalizeName(orModel)}`,
  ];
  for (const c of candidates) {
    if (upstreamIndex.has(c)) {
      upstreamId = upstreamIndex.get(c);
      break;
    }
  }
  if (upstreamId) stats.withUpstream++;

  // Tag heuristics
  const tags = ["reseller"];
  const idLower = orModel.toLowerCase();
  if (idLower.includes("vision") || (inputModalities.includes("image"))) tags.push("vision");
  if (idLower.includes("preview")) tags.push("preview");
  if (idLower.includes("beta")) tags.push("beta");
  if (idLower.includes(":free") || m.pricing?.prompt === "0") tags.push("free-tier");
  if (idLower.includes("instant") || idLower.includes("flash") || idLower.includes("turbo")) tags.push("fast");
  if (idLower.includes("thinking") || idLower.includes("reasoning")) tags.push("thinking");

  const entry = {
    id: ourId,
    provider: "openrouter",
    model: normalizeId(orProvider + "-" + orModel),
    display_name: `OpenRouter: ${m.name || m.id}`,
    input_cost_per_mtok: round6(inPrice),
    output_cost_per_mtok: round6(outPrice),
    cache_write_cost_per_mtok: cacheWrite != null && Number.isFinite(cacheWrite) ? round6(cacheWrite) : null,
    cache_read_cost_per_mtok: cacheRead != null && Number.isFinite(cacheRead) ? round6(cacheRead) : null,
    context_window: m.context_length ?? null,
    max_output_tokens: m.top_provider?.max_completion_tokens ?? null,
    source_url: "https://openrouter.ai/api/v1/models",
    last_verified: TODAY,
    verification_required: false,
    availability: "available",
    tags,
    upstream_model_id: upstreamId,
    notes: `Ingested from OpenRouter API. OpenRouter id: ${m.id}.`,
    deprecated_on: null,
  };

  const existing = byId.get(ourId);
  if (existing && !force) {
    stats.skipped++;
    continue;
  }
  if (existing) {
    stats.updated++;
  } else {
    stats.added++;
  }
  proposed.push(entry);
}

console.log("\n=== INGEST PLAN ===");
console.log(`Added:        ${stats.added}`);
console.log(`Updated:      ${stats.updated} (--force in effect)`);
console.log(`Skipped:      ${stats.skipped} (already exist, run with --force to overwrite)`);
console.log(`Dropped:      ${stats.dropped} (non-text, no pricing, or malformed)`);
console.log(`With upstream link: ${stats.withUpstream}`);

if (dryRun) {
  console.log("\n--dry-run set, not writing.");
  process.exit(0);
}

if (proposed.length === 0) {
  console.log("\nNothing to write.");
  process.exit(0);
}

// Merge: overwrite existing openrouter/* with new, append new
const proposedById = new Map(proposed.map(e => [e.id, e]));
const merged = current.models.map(m => proposedById.has(m.id) ? proposedById.get(m.id) : m);
for (const e of proposed) {
  if (!byId.has(e.id)) merged.push(e);
}

current.models = merged;
current.snapshot_date = TODAY;

writeFileSync(CURRENT_PATH, JSON.stringify(current, null, 2) + "\n");
console.log(`\nWrote pricing/current.json: ${merged.length} total models (was ${current.models.length - stats.added}).`);

// Helpers
function normalizeName(s) {
  return String(s || "").toLowerCase().replace(/[._\s]/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function normalizeId(s) {
  return normalizeName(s).slice(0, 80);
}
function round6(n) { return Math.round(n * 1e6) / 1e6; }
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) { out[key] = next; i++; }
      else out[key] = true;
    }
  }
  return out;
}