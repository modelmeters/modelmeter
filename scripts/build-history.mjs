#!/usr/bin/env node
// Build pricing/history.json by rolling up all per-snapshot files in
// pricing/snapshots/ into a single time-series per model.
//
// Input:  pricing/snapshots/{YYYY-MM-DD,YYYY-MM-DD__provider}.json
// Output: pricing/history.json
//
// Each model gets a `history` array sorted by date, with one entry per
// snapshot. Models that appear in multiple snapshots are merged on `id`.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SNAPSHOTS_DIR = join(process.cwd(), "pricing/snapshots");
const CURRENT_PATH = join(process.cwd(), "pricing/current.json");
const HISTORY_PATH = join(process.cwd(), "pricing/history.json");

const files = readdirSync(SNAPSHOTS_DIR)
  .filter((f) => f.endsWith(".json") && !f.startsWith(".") && f !== "README.md")
  .sort();

console.log(`Reading ${files.length} snapshot files…`);

const byModel = new Map();

for (const f of files) {
  let snap;
  try {
    snap = JSON.parse(readFileSync(join(SNAPSHOTS_DIR, f), "utf8"));
  } catch (err) {
    console.error(`  ✗ ${f}: parse failed (${err.message})`);
    continue;
  }
  const date = snap.snapshot_date;
  if (!date) continue;
  for (const m of snap.models || []) {
    if (!m.id) continue;
    if (!byModel.has(m.id)) {
      byModel.set(m.id, {
        id: m.id,
        provider: m.provider,
        display_name: m.display_name,
        history: [],
      });
    }
    const entry = byModel.get(m.id);
    entry.history.push({
      date,
      input_cost_per_mtok: m.input_cost_per_mtok ?? null,
      output_cost_per_mtok: m.output_cost_per_mtok ?? null,
      cache_read_cost_per_mtok: m.cache_read_cost_per_mtok ?? null,
      cache_write_cost_per_mtok: m.cache_write_cost_per_mtok ?? null,
      context_window: m.context_window ?? null,
      source_url: m.source_url ?? null,
    });
    // Keep the most recent display_name + provider in case of drift
    entry.display_name = m.display_name || entry.display_name;
    entry.provider = m.provider || entry.provider;
  }
}

// Also include current.json as the most-recent data point per model
try {
  const current = JSON.parse(readFileSync(CURRENT_PATH, "utf8"));
  const currentDate = current.snapshot_date;
  for (const m of current.models || []) {
    if (!m.id) continue;
    if (!byModel.has(m.id)) {
      byModel.set(m.id, {
        id: m.id,
        provider: m.provider,
        display_name: m.display_name,
        history: [],
      });
    }
    const entry = byModel.get(m.id);
    // Only add if there isn't already an entry for this date
    if (!entry.history.some((h) => h.date === currentDate)) {
      entry.history.push({
        date: currentDate,
        input_cost_per_mtok: m.input_cost_per_mtok ?? null,
        output_cost_per_mtok: m.output_cost_per_mtok ?? null,
        cache_read_cost_per_mtok: m.cache_read_cost_per_mtok ?? null,
        cache_write_cost_per_mtok: m.cache_write_cost_per_mtok ?? null,
        context_window: m.context_window ?? null,
        source_url: m.source_url ?? null,
      });
    }
    entry.display_name = m.display_name || entry.display_name;
    entry.provider = m.provider || entry.provider;
  }
} catch (err) {
  console.error(`  Warning: could not merge current.json: ${err.message}`);
}

// Sort each model's history by date, dedupe identical-date entries (keep first)
for (const entry of byModel.values()) {
  const seen = new Set();
  entry.history = entry.history
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((h) => {
      if (seen.has(h.date)) return false;
      seen.add(h.date);
      return true;
    });
}

// Build summary stats
const models = [...byModel.values()].sort((a, b) => {
  if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
  return a.display_name.localeCompare(b.display_name);
});

const out = {
  schema_version: "1.0.0",
  generated_at: new Date().toISOString(),
  snapshot_count: files.length,
  model_count: models.length,
  models,
};

writeFileSync(HISTORY_PATH, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote pricing/history.json: ${models.length} models across ${files.length} snapshots.`);