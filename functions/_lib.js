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

// Writes a request log line two ways:
//  1. console.log — captured by Cloudflare Workers logs (24-48h retention)
//  2. Analytics Engine — long-term queryable behavioral dataset (binding name: ANALYTICS)
//
// The Analytics Engine schema is consistent across all tools:
//   indexes[0]   = tool name (estimate | models | events | history | pricing_json | events_json | history_json)
//   blobs[0]     = primary target (model id for /estimate, provider filter for list endpoints)
//   blobs[1]     = secondary target (provider for /estimate, event type for /events, etc.)
//   blobs[2]     = cf_country
//   blobs[3]     = cf_colo
//   blobs[4]     = ua_class (agent | bot | desktop | mobile | unknown)
//   doubles[0]   = HTTP status
//   doubles[1]   = input tokens (/estimate) or result count (list endpoints)
//   doubles[2]   = output tokens (/estimate) or 0
//   doubles[3]   = total_cost_usd (/estimate) or 0
//   doubles[4]   = always 1 (for summing → request counts)
export function logRequest(event, env) {
  const line = { ts: new Date().toISOString(), ...event };
  console.log(JSON.stringify(line));

  // Write to Analytics Engine when the binding is configured.
  // The binding is added in the Cloudflare Pages dashboard:
  //   Pages → modelmeter → Settings → Functions → Analytics Engine bindings
  //   variable: ANALYTICS    dataset: modelmeter_requests
  if (env && env.ANALYTICS && typeof env.ANALYTICS.writeDataPoint === "function") {
    try {
      env.ANALYTICS.writeDataPoint({
        indexes: [String(event.tool || "unknown")],
        blobs: [
          String(event.model || event.filters?.provider || ""),
          String(event.provider || event.filters?.type || ""),
          String(event.cf_country || ""),
          String(event.cf_colo || ""),
          String(event.ua_class || ""),
        ],
        doubles: [
          Number(event.status || 0),
          Number(event.input_tokens ?? event.count ?? 0),
          Number(event.output_tokens || 0),
          Number(event.total_cost_usd || 0),
          1,
        ],
      });
    } catch (err) {
      console.error("AE writeDataPoint failed:", err.message);
    }
  }
}

export function clientHashes(request) {
  const ua = request.headers.get("user-agent") || "";
  let ua_class = "unknown";
  if (/\b(bot|crawler|spider|curl|wget|httpie|python-requests)\b/i.test(ua)) ua_class = "bot";
  else if (/(claude|gpt|openai|anthropic|agent|llm|inference)/i.test(ua)) ua_class = "agent";
  else if (/(mobile|android|iphone|ipad)/i.test(ua)) ua_class = "mobile";
  else if (/(mozilla|chrome|safari|firefox|edge)/i.test(ua)) ua_class = "desktop";
  return {
    ua_present: Boolean(ua),
    ua_class,
    cf_country: request.headers.get("cf-ipcountry") ?? null,
    cf_colo: request.cf?.colo ?? null,
  };
}
