import { json, error, findModel, round, logRequest, clientHashes, PRICING, QUALITY, qualityFor } from "./_lib.js";
import history from "../pricing/history.json";

// Summarize one price field over a model's snapshot history.
function summarizeField(entries, field) {
  const pts = entries.filter((e) => e[field] != null);
  if (pts.length === 0) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  let lastChangeDate = null;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][field] !== pts[i - 1][field]) lastChangeDate = pts[i].date;
  }
  const vals = pts.map((p) => p[field]);
  return {
    launch: first[field],
    current: last[field],
    change_percent: first[field] > 0 ? round(((last[field] / first[field]) - 1) * 100, 2) : null,
    last_change_date: lastChangeDate,
    all_time_low: Math.min(...vals),
    all_time_high: Math.max(...vals),
  };
}

// Assemble the normalized, enriched card for a single model.
// Pure so it can be unit-tested without a Request/env.
export function buildModelCard(model, historyModels) {
  const tags = model.tags ?? [];
  const has = (t) => tags.includes(t);

  let markup = null;
  if (model.upstream_model_id) {
    const up = findModel(model.upstream_model_id);
    if (up && up.input_cost_per_mtok != null && up.output_cost_per_mtok != null) {
      markup = {
        upstream_model_id: up.id,
        upstream_provider: up.provider,
        upstream_input_cost_per_mtok: up.input_cost_per_mtok,
        upstream_output_cost_per_mtok: up.output_cost_per_mtok,
        input_markup_percent: up.input_cost_per_mtok > 0
          ? round(((model.input_cost_per_mtok / up.input_cost_per_mtok) - 1) * 100, 2) : null,
        output_markup_percent: up.output_cost_per_mtok > 0
          ? round(((model.output_cost_per_mtok / up.output_cost_per_mtok) - 1) * 100, 2) : null,
      };
    } else {
      markup = {
        upstream_model_id: model.upstream_model_id,
        unavailable_reason: "upstream entry missing or has incomplete pricing",
      };
    }
  }

  const q = qualityFor(model.id);
  const quality = q
    ? {
        overall: q.overall ?? null,
        tasks: q.tasks ?? null,
        mapping_confidence: q.mapping_confidence ?? null,
        provisional: Boolean(QUALITY.provisional),
        disclaimer: "Coarse sourced signal, not ground truth. See /history.json for the methodology source list.",
      }
    : null;

  let price_history = null;
  const hist = historyModels.find((h) => h.id === model.id);
  if (hist && Array.isArray(hist.history) && hist.history.length > 0) {
    const entries = hist.history;
    price_history = {
      first_seen: entries[0].date,
      last_seen: entries[entries.length - 1].date,
      snapshots: entries.length,
      input_cost_per_mtok: summarizeField(entries, "input_cost_per_mtok"),
      output_cost_per_mtok: summarizeField(entries, "output_cost_per_mtok"),
    };
  }

  return {
    id: model.id,
    provider: model.provider,
    provider_model_id: model.model,
    aliases: model.aliases ?? [],
    display_name: model.display_name,
    pricing: {
      currency: "USD",
      unit: "per_mtok",
      input_cost_per_mtok: model.input_cost_per_mtok,
      output_cost_per_mtok: model.output_cost_per_mtok,
      cache_read_cost_per_mtok: model.cache_read_cost_per_mtok ?? null,
      cache_write_cost_per_mtok: model.cache_write_cost_per_mtok ?? null,
      tier_pricing: Array.isArray(model.tier_pricing) ? model.tier_pricing : null,
    },
    capabilities: {
      context_window: model.context_window ?? null,
      max_output_tokens: model.max_output_tokens ?? null,
      vision: has("vision"),
      reasoning: has("thinking"),
      tags,
    },
    availability: {
      status: model.availability ?? "available",
      deprecated_on: model.deprecated_on ?? null,
    },
    markup,
    quality,
    price_history,
    provenance: {
      last_verified: model.last_verified,
      source_url: model.source_url,
      verification_required: Boolean(model.verification_required),
      snapshot_date: PRICING.snapshot_date,
    },
    notes: model.notes ?? null,
  };
}

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || url.searchParams.get("model");

  if (!id) {
    return error("Query parameter `id` is required (e.g. ?id=anthropic/claude-opus-4-8). See /models for the catalog.", 400);
  }

  const model = findModel(id);
  if (!model) {
    logRequest({ tool: "model", status: 404, model: id, ...clientHashes(request) }, env);
    return error(`Model not found: ${id}. See /models for available models.`, 404, "model_not_found");
  }

  const card = buildModelCard(model, history.models);

  logRequest({
    tool: "model",
    status: 200,
    model: id,
    provider: model.provider,
    ...clientHashes(request),
  }, env);

  return json({
    schema_version: PRICING.schema_version,
    snapshot_date: PRICING.snapshot_date,
    model: card,
  });
};

export const onRequestOptions = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-max-age": "86400",
    },
  });
};