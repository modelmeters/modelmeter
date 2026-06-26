import { json, error, findModel, round, effectiveRates, logRequest, clientHashes } from "./_lib.js";

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const modelId = url.searchParams.get("model");
  const inputStr = url.searchParams.get("input");
  const outputStr = url.searchParams.get("output");

  if (!modelId) return error("Query parameter `model` is required.", 400);
  if (inputStr == null) return error("Query parameter `input` (token count) is required.", 400);
  if (outputStr == null) return error("Query parameter `output` (token count) is required.", 400);

  const inputTokens = Number(inputStr);
  const outputTokens = Number(outputStr);

  if (!Number.isInteger(inputTokens) || inputTokens < 0) {
    return error("`input` must be a non-negative integer (number of tokens).", 400);
  }
  if (!Number.isInteger(outputTokens) || outputTokens < 0) {
    return error("`output` must be a non-negative integer (number of tokens).", 400);
  }

  const model = findModel(modelId);
  if (!model) {
    logRequest({ tool: "estimate", status: 404, model: modelId, ...clientHashes(request) }, env);
    return error(`Model not found: ${modelId}. See /models for available models.`, 404, "model_not_found");
  }

  if (model.verification_required) {
    logRequest({ tool: "estimate", status: 404, model: modelId, reason: "unverified", ...clientHashes(request) }, env);
    return error(`Model ${modelId} has unverified pricing and is not served by /estimate. See pricing/current.json on GitHub for the raw entry.`, 404, "model_unverified");
  }

  if (model.input_cost_per_mtok == null || model.output_cost_per_mtok == null) {
    logRequest({ tool: "estimate", status: 404, model: modelId, reason: "incomplete_pricing", ...clientHashes(request) }, env);
    return error(`Model ${modelId} has incomplete pricing in the dataset.`, 404, "model_incomplete");
  }

  const rates = effectiveRates(model, inputTokens);
  const inputCost = (inputTokens / 1_000_000) * rates.input;
  const outputCost = (outputTokens / 1_000_000) * rates.output;
  const totalCost = inputCost + outputCost;

  const result = {
    model: modelId,
    display_name: model.display_name,
    provider: model.provider,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    rates_per_mtok: {
      input: rates.input,
      output: rates.output,
    },
    input_cost_usd: round(inputCost),
    output_cost_usd: round(outputCost),
    total_cost_usd: round(totalCost),
    pricing_date: model.last_verified,
    source_url: model.source_url,
    tier_applied: Array.isArray(model.tier_pricing) && model.tier_pricing.some(
      (t) => typeof t.above_input_tokens === "number" && inputTokens > t.above_input_tokens
    ),
  };

  if (model.upstream_model_id) {
    const upstream = findModel(model.upstream_model_id);
    if (upstream && !upstream.verification_required && upstream.input_cost_per_mtok != null && upstream.output_cost_per_mtok != null) {
      const upRates = effectiveRates(upstream, inputTokens);
      const upInput = (inputTokens / 1_000_000) * upRates.input;
      const upOutput = (outputTokens / 1_000_000) * upRates.output;
      const upTotal = upInput + upOutput;
      result.upstream = {
        model: upstream.id,
        display_name: upstream.display_name,
        provider: upstream.provider,
        total_cost_usd: round(upTotal),
        markup_usd: round(totalCost - upTotal),
        markup_percent: upTotal > 0 ? round(((totalCost / upTotal) - 1) * 100, 2) : null,
      };
    } else {
      result.upstream = {
        model: model.upstream_model_id,
        unavailable_reason: "upstream entry exists but pricing is unverified or incomplete",
      };
    }
  }

  logRequest({
    tool: "estimate",
    status: 200,
    model: modelId,
    provider: model.provider,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_cost_usd: result.total_cost_usd,
    has_upstream: Boolean(model.upstream_model_id),
    ...clientHashes(request),
  }, env);

  return json(result);
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