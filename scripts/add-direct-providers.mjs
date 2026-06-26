#!/usr/bin/env node
// One-shot script to add direct-provider entries to pricing/current.json.
// Adds: DeepSeek, Mistral, Cohere, Together, Groq.
// All entries sourced from each provider's public pricing page on 2026-06-26.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CURRENT_PATH = join(process.cwd(), "pricing/current.json");
const TODAY = new Date().toISOString().slice(0, 10);

const NEW = [
  // ---------- DeepSeek (direct) ----------
  {
    id: "deepseek/deepseek-v4-flash",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    display_name: "DeepSeek V4 Flash",
    input_cost_per_mtok: 0.14,
    output_cost_per_mtok: 0.28,
    cache_write_cost_per_mtok: null,
    cache_read_cost_per_mtok: 0.0028,
    context_window: 1000000,
    max_output_tokens: 384000,
    source_url: "https://api-docs.deepseek.com/quick_start/pricing",
    tags: ["flash"],
  },
  {
    id: "deepseek/deepseek-v4-pro",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    display_name: "DeepSeek V4 Pro",
    input_cost_per_mtok: 0.435,
    output_cost_per_mtok: 0.87,
    cache_write_cost_per_mtok: null,
    cache_read_cost_per_mtok: 0.003625,
    context_window: 1000000,
    max_output_tokens: 384000,
    source_url: "https://api-docs.deepseek.com/quick_start/pricing",
    tags: ["pro"],
  },

  // ---------- Mistral (direct) ----------
  {
    id: "mistral/mistral-medium-3-5",
    provider: "mistral",
    model: "mistral-medium-3-5",
    display_name: "Mistral Medium 3.5",
    input_cost_per_mtok: 1.50,
    output_cost_per_mtok: 7.50,
    source_url: "https://mistral.ai/pricing",
    notes: "API id: mistral-medium-latest",
  },
  {
    id: "mistral/mistral-large-3",
    provider: "mistral",
    model: "mistral-large-3",
    display_name: "Mistral Large 3",
    input_cost_per_mtok: 0.50,
    output_cost_per_mtok: 1.50,
    source_url: "https://mistral.ai/pricing",
    notes: "API id: mistral-large-latest",
  },
  {
    id: "mistral/mistral-small-4",
    provider: "mistral",
    model: "mistral-small-4",
    display_name: "Mistral Small 4",
    input_cost_per_mtok: 0.15,
    output_cost_per_mtok: 0.60,
    source_url: "https://mistral.ai/pricing",
    notes: "API id: mistral-small-latest",
  },
  {
    id: "mistral/devstral-2",
    provider: "mistral",
    model: "devstral-2",
    display_name: "Devstral 2",
    input_cost_per_mtok: 0.40,
    output_cost_per_mtok: 2.00,
    source_url: "https://mistral.ai/pricing",
    tags: ["coder"],
    notes: "Code-focused. API id: devstral-medium-latest",
  },
  {
    id: "mistral/magistral-medium",
    provider: "mistral",
    model: "magistral-medium",
    display_name: "Magistral Medium",
    input_cost_per_mtok: 2.00,
    output_cost_per_mtok: 5.00,
    source_url: "https://mistral.ai/pricing",
    tags: ["thinking"],
    notes: "Reasoning model. API id: magistral-medium-latest",
  },

  // ---------- Cohere (direct) ----------
  {
    id: "cohere/command",
    provider: "cohere",
    model: "command",
    display_name: "Cohere Command",
    input_cost_per_mtok: 1.00,
    output_cost_per_mtok: 2.00,
    source_url: "https://cohere.com/pricing",
  },
  {
    id: "cohere/command-light",
    provider: "cohere",
    model: "command-light",
    display_name: "Cohere Command Light",
    input_cost_per_mtok: 0.30,
    output_cost_per_mtok: 0.60,
    source_url: "https://cohere.com/pricing",
  },
  {
    id: "cohere/command-r-03-2024",
    provider: "cohere",
    model: "command-r-03-2024",
    display_name: "Cohere Command R (03-2024)",
    input_cost_per_mtok: 0.50,
    output_cost_per_mtok: 1.50,
    source_url: "https://cohere.com/pricing",
  },
  {
    id: "cohere/command-r-plus-04-2024",
    provider: "cohere",
    model: "command-r-plus-04-2024",
    display_name: "Cohere Command R+ (04-2024)",
    input_cost_per_mtok: 3.00,
    output_cost_per_mtok: 15.00,
    source_url: "https://cohere.com/pricing",
  },
  {
    id: "cohere/command-r-plus-08-2024",
    provider: "cohere",
    model: "command-r-plus-08-2024",
    display_name: "Cohere Command R+ (08-2024)",
    input_cost_per_mtok: 2.50,
    output_cost_per_mtok: 10.00,
    source_url: "https://cohere.com/pricing",
  },
  {
    id: "cohere/aya-expanse",
    provider: "cohere",
    model: "aya-expanse",
    display_name: "Aya Expanse",
    input_cost_per_mtok: 0.50,
    output_cost_per_mtok: 1.50,
    source_url: "https://cohere.com/pricing",
    notes: "Research model, 8B and 32B variants priced identically.",
  },

  // ---------- Together AI (OSS hosting) ----------
  {
    id: "together/deepseek-v4-pro",
    provider: "together",
    model: "deepseek-v4-pro",
    display_name: "Together: DeepSeek V4 Pro",
    input_cost_per_mtok: 1.74,
    output_cost_per_mtok: 3.48,
    cache_read_cost_per_mtok: 0.20,
    source_url: "https://www.together.ai/pricing",
    tags: ["reseller", "pro"],
    upstream_model_id: "deepseek/deepseek-v4-pro",
  },
  {
    id: "together/qwen3-7-max",
    provider: "together",
    model: "qwen3-7-max",
    display_name: "Together: Qwen 3.7 Max",
    input_cost_per_mtok: 1.25,
    output_cost_per_mtok: 3.75,
    cache_read_cost_per_mtok: 0.13,
    source_url: "https://www.together.ai/pricing",
    tags: ["reseller"],
  },
  {
    id: "together/qwen3-5-397b",
    provider: "together",
    model: "qwen3-5-397b",
    display_name: "Together: Qwen 3.5 397B",
    input_cost_per_mtok: 0.60,
    output_cost_per_mtok: 3.60,
    cache_read_cost_per_mtok: 0.35,
    source_url: "https://www.together.ai/pricing",
    tags: ["reseller"],
  },
  {
    id: "together/nemotron-3-ultra",
    provider: "together",
    model: "nemotron-3-ultra",
    display_name: "Together: NVIDIA Nemotron 3 Ultra",
    input_cost_per_mtok: 0.60,
    output_cost_per_mtok: 3.60,
    cache_read_cost_per_mtok: 0.20,
    source_url: "https://www.together.ai/pricing",
    tags: ["reseller"],
  },
  {
    id: "together/llama-3-3-70b",
    provider: "together",
    model: "llama-3-3-70b",
    display_name: "Together: Llama 3.3 70B",
    input_cost_per_mtok: 1.04,
    output_cost_per_mtok: 1.04,
    source_url: "https://www.together.ai/pricing",
    tags: ["reseller"],
  },
  {
    id: "together/minimax-m3",
    provider: "together",
    model: "minimax-m3",
    display_name: "Together: MiniMax M3",
    input_cost_per_mtok: 0.30,
    output_cost_per_mtok: 1.20,
    cache_read_cost_per_mtok: 0.06,
    source_url: "https://www.together.ai/pricing",
    tags: ["reseller"],
  },
  {
    id: "together/gemma-4-31b",
    provider: "together",
    model: "gemma-4-31b",
    display_name: "Together: Gemma 4 31B",
    input_cost_per_mtok: 0.39,
    output_cost_per_mtok: 0.97,
    source_url: "https://www.together.ai/pricing",
    tags: ["reseller"],
  },
  {
    id: "together/qwen3-5-9b",
    provider: "together",
    model: "qwen3-5-9b",
    display_name: "Together: Qwen 3.5 9B",
    input_cost_per_mtok: 0.17,
    output_cost_per_mtok: 0.25,
    source_url: "https://www.together.ai/pricing",
    tags: ["reseller"],
  },

  // ---------- Groq (OSS hosting, fast inference) ----------
  {
    id: "groq/gpt-oss-20b",
    provider: "groq",
    model: "gpt-oss-20b",
    display_name: "Groq: GPT OSS 20B",
    input_cost_per_mtok: 0.075,
    output_cost_per_mtok: 0.30,
    context_window: 128000,
    source_url: "https://groq.com/pricing",
    tags: ["reseller", "fast"],
  },
  {
    id: "groq/gpt-oss-safeguard-20b",
    provider: "groq",
    model: "gpt-oss-safeguard-20b",
    display_name: "Groq: GPT OSS Safeguard 20B",
    input_cost_per_mtok: 0.075,
    output_cost_per_mtok: 0.30,
    source_url: "https://groq.com/pricing",
    tags: ["reseller", "fast"],
  },
  {
    id: "groq/gpt-oss-120b",
    provider: "groq",
    model: "gpt-oss-120b",
    display_name: "Groq: GPT OSS 120B",
    input_cost_per_mtok: 0.15,
    output_cost_per_mtok: 0.60,
    context_window: 128000,
    source_url: "https://groq.com/pricing",
    tags: ["reseller", "fast"],
  },
  {
    id: "groq/llama-4-scout-17bx16e",
    provider: "groq",
    model: "llama-4-scout-17bx16e",
    display_name: "Groq: Llama 4 Scout 17Bx16E",
    input_cost_per_mtok: 0.11,
    output_cost_per_mtok: 0.34,
    context_window: 128000,
    source_url: "https://groq.com/pricing",
    tags: ["reseller", "fast"],
  },
  {
    id: "groq/qwen3-32b",
    provider: "groq",
    model: "qwen3-32b",
    display_name: "Groq: Qwen 3 32B",
    input_cost_per_mtok: 0.29,
    output_cost_per_mtok: 0.59,
    context_window: 131000,
    source_url: "https://groq.com/pricing",
    tags: ["reseller", "fast"],
  },
  {
    id: "groq/llama-3-3-70b-versatile",
    provider: "groq",
    model: "llama-3-3-70b-versatile",
    display_name: "Groq: Llama 3.3 70B Versatile",
    input_cost_per_mtok: 0.59,
    output_cost_per_mtok: 0.79,
    context_window: 128000,
    source_url: "https://groq.com/pricing",
    tags: ["reseller", "fast"],
  },
  {
    id: "groq/llama-3-1-8b-instant",
    provider: "groq",
    model: "llama-3-1-8b-instant",
    display_name: "Groq: Llama 3.1 8B Instant",
    input_cost_per_mtok: 0.05,
    output_cost_per_mtok: 0.08,
    context_window: 128000,
    source_url: "https://groq.com/pricing",
    tags: ["reseller", "fast"],
  },
  {
    id: "groq/qwen3-6-27b",
    provider: "groq",
    model: "qwen3-6-27b",
    display_name: "Groq: Qwen 3.6 27B",
    input_cost_per_mtok: 0.60,
    output_cost_per_mtok: 3.00,
    context_window: 131000,
    source_url: "https://groq.com/pricing",
    tags: ["reseller", "fast"],
  },
];

// Defaults
function complete(e) {
  return {
    id: e.id,
    provider: e.provider,
    model: e.model,
    display_name: e.display_name,
    input_cost_per_mtok: e.input_cost_per_mtok,
    output_cost_per_mtok: e.output_cost_per_mtok,
    cache_write_cost_per_mtok: e.cache_write_cost_per_mtok ?? null,
    cache_read_cost_per_mtok: e.cache_read_cost_per_mtok ?? null,
    context_window: e.context_window ?? null,
    max_output_tokens: e.max_output_tokens ?? null,
    source_url: e.source_url,
    last_verified: TODAY,
    verification_required: false,
    availability: "available",
    tags: e.tags ?? [],
    upstream_model_id: e.upstream_model_id ?? null,
    notes: e.notes ?? "",
    deprecated_on: null,
  };
}

const current = JSON.parse(readFileSync(CURRENT_PATH, "utf8"));
const byId = new Map(current.models.map(m => [m.id, m]));

let added = 0;
let updated = 0;
for (const draft of NEW) {
  const e = complete(draft);
  if (byId.has(e.id)) {
    const idx = current.models.findIndex(m => m.id === e.id);
    current.models[idx] = e;
    updated++;
  } else {
    current.models.push(e);
    added++;
  }
}

current.snapshot_date = TODAY;
writeFileSync(CURRENT_PATH, JSON.stringify(current, null, 2) + "\n");
console.log(`Added: ${added}`);
console.log(`Updated: ${updated}`);
console.log(`Total models now: ${current.models.length}`);
const byProv = {};
for (const m of current.models) byProv[m.provider] = (byProv[m.provider] || 0) + 1;
console.log("By provider:", byProv);