#!/usr/bin/env node
// Historical pricing backfill.
//
// For each provider's pricing page, queries the Wayback Machine CDX API for
// monthly captures, fetches each capture's HTML, sends a cleaned excerpt to
// Venice's chat completions API, and asks for structured pricing extraction.
// Writes one snapshot per successful capture to pricing/snapshots/.
//
// Usage:
//   VENICE_API_KEY=... node scripts/backfill.mjs
//   VENICE_API_KEY=... node scripts/backfill.mjs --providers anthropic,openai --from 2024-01 --to 2026-06
//
// Idempotent: skips any pricing/snapshots/YYYY-MM-DD.json that already exists.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const VENICE_API_KEY = process.env.VENICE_API_KEY;
if (!VENICE_API_KEY) {
  console.error("Missing VENICE_API_KEY env var. Run with: VENICE_API_KEY=... node scripts/backfill.mjs");
  process.exit(1);
}

const VENICE_MODEL = process.env.VENICE_MODEL || "qwen3-235b-a22b-instruct-2507";
const VENICE_URL = "https://api.venice.ai/api/v1/chat/completions";
const WAYBACK_CDX = "https://web.archive.org/cdx/search/cdx";
const WAYBACK_RAW = "https://web.archive.org/web";

const SNAPSHOTS_DIR = join(process.cwd(), "pricing/snapshots");
if (!existsSync(SNAPSHOTS_DIR)) mkdirSync(SNAPSHOTS_DIR, { recursive: true });

// Provider configuration. Each entry produces snapshots whose `models` are
// scoped to that provider. We could merge multi-provider snapshots later;
// keeping per-provider is simpler.
const PROVIDERS = [
  { id: "anthropic", url: "https://www.anthropic.com/pricing", aliases: ["https://www.anthropic.com/api"] },
  { id: "openai",    url: "https://openai.com/api/pricing",     aliases: ["https://openai.com/pricing", "https://platform.openai.com/docs/pricing"] },
  { id: "google",    url: "https://ai.google.dev/pricing",      aliases: ["https://ai.google.dev/gemini-api/docs/pricing"] },
  { id: "xai",       url: "https://x.ai/api",                   aliases: ["https://docs.x.ai/docs/models"] },
  { id: "venice",    url: "https://venice.ai/pricing",          aliases: ["https://docs.venice.ai/overview/pricing"] },
];

// CLI args
const args = parseArgs(process.argv.slice(2));
const providerFilter = args.providers ? args.providers.split(",").map(s => s.trim()) : null;
const fromYM = args.from || "2024-01";
const toYM = args.to || new Date().toISOString().slice(0, 7);

const fromStamp = `${fromYM.replace("-", "")}01`;
const toStamp = `${toYM.replace("-", "")}28`;

const stats = { attempted: 0, written: 0, skipped: 0, failed: 0 };

for (const provider of PROVIDERS) {
  if (providerFilter && !providerFilter.includes(provider.id)) continue;
  console.log(`\n=== ${provider.id.toUpperCase()} ===`);
  const urls = [provider.url, ...(provider.aliases || [])];
  const allCaptures = [];
  for (const url of urls) {
    const captures = await listCaptures(url);
    console.log(`  ${url} → ${captures.length} captures`);
    allCaptures.push(...captures);
  }
  // Dedupe by YYYYMM, keep earliest per month
  const byMonth = new Map();
  for (const cap of allCaptures.sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    const ym = cap.timestamp.slice(0, 6);
    if (!byMonth.has(ym)) byMonth.set(ym, cap);
  }
  console.log(`  Unique monthly captures: ${byMonth.size}`);

  for (const [ym, cap] of [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const dateIso = `${ym.slice(0, 4)}-${ym.slice(4, 6)}-${cap.timestamp.slice(6, 8)}`;
    const outPath = join(SNAPSHOTS_DIR, `${dateIso}__${provider.id}.json`);
    if (existsSync(outPath)) {
      stats.skipped++;
      continue;
    }
    stats.attempted++;
    try {
      const html = await fetchCapture(cap.timestamp, cap.original);
      if (!html || html.length < 500) {
        console.log(`  ✗ ${dateIso} ${provider.id}: empty/short HTML`);
        stats.failed++;
        await sleep(1500);
        continue;
      }
      const cleaned = cleanHtml(html);
      const extracted = await extractPricing(cleaned, provider, dateIso, cap.original);
      if (!extracted || !extracted.models || extracted.models.length === 0) {
        console.log(`  ✗ ${dateIso} ${provider.id}: extraction yielded no models`);
        stats.failed++;
        await sleep(1500);
        continue;
      }
      const snapshot = {
        schema_version: "1.2.0",
        snapshot_date: dateIso,
        source: {
          provider: provider.id,
          source_url: cap.original,
          wayback_url: `${WAYBACK_RAW}/${cap.timestamp}/${cap.original}`,
          extracted_via: { method: "venice-llm", model: VENICE_MODEL },
        },
        models: extracted.models,
      };
      writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n");
      stats.written++;
      console.log(`  ✓ ${dateIso} ${provider.id}: ${extracted.models.length} models`);
      await sleep(1500);
    } catch (err) {
      console.log(`  ✗ ${dateIso} ${provider.id}: ${err.message}`);
      stats.failed++;
      await sleep(2000);
    }
  }
}

console.log(`\n=== SUMMARY ===`);
console.log(`Attempted: ${stats.attempted}`);
console.log(`Written:   ${stats.written}`);
console.log(`Skipped:   ${stats.skipped} (already existed)`);
console.log(`Failed:    ${stats.failed}`);
process.exit(0);

// ---------- functions ----------

async function listCaptures(url) {
  const params = new URLSearchParams({
    url,
    output: "json",
    from: fromStamp,
    to: toStamp,
    "collapse": "timestamp:6",
    "filter": "statuscode:200",
    "filter": "mimetype:text/html",
  });
  // URLSearchParams collapses duplicate keys; need to use direct construction
  const qs = `url=${encodeURIComponent(url)}&output=json&from=${fromStamp}&to=${toStamp}&collapse=timestamp:6&filter=statuscode:200&filter=mimetype:text/html`;
  const res = await fetchWithRetry(`${WAYBACK_CDX}?${qs}`, { headers: ua() });
  if (!res.ok) return [];
  const json = await res.json();
  if (!Array.isArray(json) || json.length < 2) return [];
  const [headers, ...rows] = json;
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  return rows.map((r) => ({
    timestamp: r[idx.timestamp],
    original: r[idx.original],
    statuscode: r[idx.statuscode],
    mimetype: r[idx.mimetype],
  }));
}

async function fetchCapture(timestamp, originalUrl) {
  // id_ suffix returns raw page without Wayback's injected banner
  const url = `${WAYBACK_RAW}/${timestamp}id_/${originalUrl}`;
  const res = await fetchWithRetry(url, { headers: ua() });
  if (!res.ok) throw new Error(`Wayback fetch HTTP ${res.status}`);
  return await res.text();
}

function cleanHtml(html) {
  // Drop scripts, styles, svg, head metadata, and ad-like blocks
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "");
  // Strip remaining attributes from tags to reduce token count (keep tag names)
  s = s.replace(/<([a-zA-Z][a-zA-Z0-9]*)\s+[^>]*>/g, "<$1>");
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  // Cap length at ~30K chars (~10K tokens) — pricing tables are usually compact
  if (s.length > 30000) s = s.slice(0, 30000);
  return s;
}

async function extractPricing(html, provider, dateIso, sourceUrl) {
  const systemPrompt = `You are a strict pricing-data extractor. Output ONLY a JSON object matching this exact shape, no prose:
{
  "models": [
    {
      "id": "provider/model-id",
      "provider": "${provider.id}",
      "model": "model-id",
      "display_name": "Human readable",
      "input_cost_per_mtok": 0.00,
      "output_cost_per_mtok": 0.00,
      "cache_write_cost_per_mtok": null,
      "cache_read_cost_per_mtok": null,
      "context_window": null,
      "max_output_tokens": null,
      "source_url": "${sourceUrl}",
      "last_verified": "${dateIso}",
      "verification_required": false,
      "notes": "extracted from wayback capture"
    }
  ]
}

Rules:
- id format: "provider/model-id" (lowercase, hyphens only, no dots).
  Example: claude-sonnet-3-5, gpt-4-turbo, gemini-1-5-pro, grok-2.
- All prices in USD per 1M tokens. If the page shows per-1K-tokens, multiply by 1000.
- If a field is not visible on the page, use null.
- Skip embeddings, image generation, TTS/STT, fine-tuning. Only chat/completion text models.
- Skip "Pro tier" subscription products (Plus, Team, Enterprise plans). Only API per-token pricing.
- If pricing is shown as "Standard / Batch / Priority", capture Standard rates.
- If a model is listed but pricing is null/coming-soon/unavailable, include it with null prices.
- Output ONLY the JSON object. No markdown, no explanation.`;

  const userPrompt = `Provider: ${provider.id}
Snapshot date: ${dateIso}
Source URL: ${sourceUrl}

HTML (cleaned):
${html}`;

  const res = await fetch(VENICE_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${VENICE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VENICE_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 4000,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Venice API HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const body = await res.json();
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Venice returned empty content");

  // Robust JSON extraction: handle code fences, leading prose
  let jsonStr = content;
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);

  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`JSON parse failed: ${err.message}`);
  }
  return parsed;
}

async function fetchWithRetry(url, opts = {}, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, opts);
      if (res.status >= 500 && i < attempts) {
        await sleep(i * 2000);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      await sleep(i * 1500);
    }
  }
  throw lastErr ?? new Error("fetch failed");
}

function ua() {
  return { "user-agent": "Mozilla/5.0 (compatible; modelmeter-backfill/0.1; +https://modelmeter.xyz)" };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}
