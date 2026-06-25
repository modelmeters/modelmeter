import pricing from "../pricing/current.json";
import events from "../events/current.json";

export const PRICING = pricing;
export const EVENTS = events;

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body, null, 2) + "\n", {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "cache-control": "public, max-age=60, s-maxage=60",
      ...extraHeaders,
    },
  });
}

export function error(message, status = 400, code = null) {
  return json({ error: { code: code ?? statusToCode(status), message } }, status);
}

function statusToCode(status) {
  if (status === 400) return "bad_request";
  if (status === 404) return "not_found";
  if (status === 405) return "method_not_allowed";
  if (status === 500) return "internal_error";
  return "error";
}

export function findModel(id) {
  return PRICING.models.find((m) => m.id === id) ?? null;
}

export function round(n, decimals = 6) {
  if (n === 0) return 0;
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

export function effectiveRates(model, inputTokens) {
  let input = model.input_cost_per_mtok;
  let output = model.output_cost_per_mtok;
  let cacheRead = model.cache_read_cost_per_mtok;
  let cacheWrite = model.cache_write_cost_per_mtok;

  if (Array.isArray(model.tier_pricing)) {
    for (const tier of model.tier_pricing) {
      if (typeof tier.above_input_tokens === "number" && inputTokens > tier.above_input_tokens) {
        if (tier.input_cost_per_mtok != null) input = tier.input_cost_per_mtok;
        if (tier.output_cost_per_mtok != null) output = tier.output_cost_per_mtok;
        if (tier.cache_read_cost_per_mtok != null) cacheRead = tier.cache_read_cost_per_mtok;
        if (tier.cache_write_cost_per_mtok != null) cacheWrite = tier.cache_write_cost_per_mtok;
      }
    }
  }

  return { input, output, cacheRead, cacheWrite };
}

export function logRequest(event) {
  const line = {
    ts: new Date().toISOString(),
    ...event,
  };
  console.log(JSON.stringify(line));
}

export function clientHashes(request) {
  return {
    ua_present: Boolean(request.headers.get("user-agent")),
    cf_country: request.headers.get("cf-ipcountry") ?? null,
    cf_colo: request.cf?.colo ?? null,
  };
}
