import { json, error, findModel, round, logRequest, clientHashes, PRICING, QUALITY, qualityFor } from "./_lib.js";

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

  // Quality gate: when the source has a quality score, restrict alternatives to those
  // within tolerance of it, so we don't suggest an 8B model in place of a flagship.
  // Inactive (degrades to pure capability+price) when the source has no quality data.
  const includeUnrated = boolParam(url, "include_unrated", false);
  const qualityToleranceParam = url.searchParams.get("quality_tolerance");
  const qualityTolerance = qualityToleranceParam != null ? (parseFloat(qualityToleranceParam) || 0) : 0.05;
  const minQualityParam = url.searchParams.get("min_quality");
  const srcQuality = qualityFor(source.id)?.overall ?? null;
  const qualityGateActive = srcQuality != null && typeof srcQuality.value === "number";
  const qualityFloor = qualityGateActive
    ? (minQualityParam != null ? (parseFloat(minQualityParam) || 0) : srcQuality.value * (1 - qualityTolerance))
    : null;

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

    // Quality gate (only when the source is rated).
    let candQuality = qualityFor(m.id)?.overall ?? null;
    if (qualityGateActive) {
      if (candQuality && candQuality.metric === srcQuality.metric && typeof candQuality.value === "number") {
        if (candQuality.value < qualityFloor) continue; // below the quality floor
      } else {
        if (!includeUnrated) continue; // unrated candidate excluded by default
        candQuality = null;
      }
    }

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
      quality: candQuality,
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
    filters: { optimize, same_provider: sameProvider, require_vision: requireVision, require_reasoning: requireReasoning, min_context: minContext, quality_gate: qualityGateActive },
    ...clientHashes(request),
  }, env);

  const qualityNote = qualityGateActive
    ? `Quality gate ACTIVE: alternatives are within ${minQualityParam != null ? `min_quality ${qualityFloor}` : `${Math.round(qualityTolerance * 100)}% (${round(qualityFloor, 1)})`} of the source's ${srcQuality.metric} (${srcQuality.value}). Unrated candidates excluded unless include_unrated=true.`
    : "Quality gate INACTIVE: source has no quality score, so this is a capability-and-price match only — quality is not guaranteed. Pass a rated source to enable the gate.";

  return json({
    schema_version: PRICING.schema_version,
    snapshot_date: PRICING.snapshot_date,
    quality_data_provisional: Boolean(QUALITY.provisional),
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
      quality: srcQuality,
    },
    criteria: {
      optimize,
      require_vision: requireVision,
      require_reasoning: requireReasoning,
      min_context_window: minContext,
      same_provider: sameProvider,
      include_free: includeFree,
      quality_gate_active: qualityGateActive,
      quality_floor: qualityFloor,
      quality_tolerance: qualityGateActive ? qualityTolerance : null,
      include_unrated: includeUnrated,
      note: `Alternatives share the required capabilities and are strictly cheaper on the chosen axis. ${qualityNote} Free ($0) endpoints are excluded unless include_free=true.`,
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