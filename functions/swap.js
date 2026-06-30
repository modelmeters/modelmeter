import { json, error, findModel, round, logRequest, clientHashes, PRICING } from "./_lib.js";

// Capability flags derived from a model's tags + fields.
function caps(model) {
  const tags = model.tags ?? [];
  return {
    vision: tags.includes("vision"),
    reasoning: tags.includes("thinking"),
    context_window: model.context_window ?? null,
    tags,
  };
}

// Price on the chosen optimization axis. blended = mean of input & output.
function axisCost(model, optimize) {
  const i = model.input_cost_per_mtok;
  const o = model.output_cost_per_mtok;
  if (optimize === "input") return i;
  if (optimize === "output") return o;
  if (i == null || o == null) return null;
  return (i + o) / 2;
}

function boolParam(url, name, fallback) {
  const v = url.searchParams.get(name);
  if (v == null) return fallback;
  return v === "true" || v === "1";
}

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const fromId = url.searchParams.get("from") || url.searchParams.get("model");
  const optimize = (url.searchParams.get("optimize") || "blended").toLowerCase();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "5", 10) || 5, 1), 25);
  const sameProvider = boolParam(url, "same_provider", false);
  const includeUnverified = boolParam(url, "include_unverified", false);
  const includeUnavailable = boolParam(url, "include_unavailable", false);
  const includeFree = boolParam(url, "include_free", false);

  if (!fromId) {
    return error("Query parameter `from` is required (the model id you currently use, e.g. ?from=openai/gpt-5-5).", 400);
  }
  if (!["input", "output", "blended"].includes(optimize)) {
    return error("`optimize` must be one of: input, output, blended.", 400);
  }

  const source = findModel(fromId);
  if (!source) {
    logRequest({ tool: "swap", status: 404, model: fromId, ...clientHashes(request) }, env);
    return error(`Model not found: ${fromId}. See /models for available models.`, 404, "model_not_found");
  }

  const srcCost = axisCost(source, optimize);
  if (srcCost == null) {
    return error(`Model ${fromId} has incomplete pricing on the '${optimize}' axis; cannot compute savings.`, 404, "model_incomplete");
  }

  const srcCaps = caps(source);

  // Requirements default to the source's capabilities; caller may override.
  const requireVision = boolParam(url, "require_vision", srcCaps.vision);
  const requireReasoning = boolParam(url, "require_reasoning", srcCaps.reasoning);
  const minContextParam = url.searchParams.get("min_context");
  const minContext = minContextParam != null
    ? (parseInt(minContextParam, 10) || null)
    : srcCaps.context_window;

  const alternatives = [];
  for (const m of PRICING.models) {
    if (m.id === source.id) continue;
    if (sameProvider && m.provider !== source.provider) continue;
    if (!includeUnverified && (m.verification_required || m.input_cost_per_mtok == null)) continue;
    if (!includeUnavailable && m.availability && m.availability !== "available") continue;

    const c = caps(m);
    if (requireVision && !c.vision) continue;
    if (requireReasoning && !c.reasoning) continue;
    if (minContext != null && (c.context_window == null || c.context_window < minContext)) continue;

    const cost = axisCost(m, optimize);
    if (cost == null || cost >= srcCost) continue; // must be strictly cheaper
    if (cost === 0 && !includeFree) continue; // skip free/rate-limited endpoints by default

    alternatives.push({
      id: m.id,
      provider: m.provider,
      display_name: m.display_name,
      input_cost_per_mtok: m.input_cost_per_mtok,
      output_cost_per_mtok: m.output_cost_per_mtok,
      context_window: c.context_window,
      vision: c.vision,
      reasoning: c.reasoning,
      tags: c.tags,
      availability: m.availability ?? "available",
      upstream_model_id: m.upstream_model_id ?? null,
      savings: {
        axis: optimize,
        candidate_cost_per_mtok: round(cost, 4),
        source_cost_per_mtok: round(srcCost, 4),
        absolute_saving_per_mtok: round(srcCost - cost, 4),
        percent_cheaper: round((1 - cost / srcCost) * 100, 2),
      },
    });
  }

  alternatives.sort((a, b) => a.savings.candidate_cost_per_mtok - b.savings.candidate_cost_per_mtok);
  const top = alternatives.slice(0, limit);

  logRequest({
    tool: "swap",
    status: 200,
    model: fromId,
    provider: source.provider,
    count: top.length,
    filters: { optimize, same_provider: sameProvider, require_vision: requireVision, require_reasoning: requireReasoning, min_context: minContext },
    ...clientHashes(request),
  }, env);

  return json({
    schema_version: PRICING.schema_version,
    snapshot_date: PRICING.snapshot_date,
    from: {
      id: source.id,
      display_name: source.display_name,
      provider: source.provider,
      input_cost_per_mtok: source.input_cost_per_mtok,
      output_cost_per_mtok: source.output_cost_per_mtok,
      cost_per_mtok_on_axis: round(srcCost, 4),
      context_window: srcCaps.context_window,
      vision: srcCaps.vision,
      reasoning: srcCaps.reasoning,
    },
    criteria: {
      optimize,
      require_vision: requireVision,
      require_reasoning: requireReasoning,
      min_context_window: minContext,
      same_provider: sameProvider,
      include_free: includeFree,
      note: "Alternatives share the required capabilities and are strictly cheaper on the chosen axis. No quality ranking is implied — this is a capability-and-price match. Free ($0) endpoints are excluded unless include_free=true.",
    },
    count: top.length,
    candidates_considered: alternatives.length,
    alternatives: top,
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