import pricing from "../pricing/current.json";
import events from "../events/current.json";
import quality from "../pricing/quality.json";

export const PRICING = pricing;
export const EVENTS = events;
export const QUALITY = quality;

const QUALITY_INDEX = new Map((quality.models ?? []).map((m) => [m.id, m]));

// Quality record for a model id, or null. Shape: { id, overall?, tasks?, mapping_confidence }.
export function qualityFor(id) {
  return QUALITY_INDEX.get(id) ?? null;
}

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

// Resolve a model by our canonical `id`, by a provider API id listed in
// `aliases`, or by a case/punctuation-normalized form of either. Exact id
// wins, then exact alias, then the normalized fallback. Aliases are stored
// bare (no "provider/" prefix), so a bare query is matched against them too.
export function findModel(id) {
  if (!id) return null;
  const exact = PRICING.models.find((m) => m.id === id);
  if (exact) return exact;
  const aliased = PRICING.models.find((m) => (m.aliases ?? []).includes(id));
  if (aliased) return aliased;
  const q = normId(id);
  const qBare = q.includes("/") ? q.slice(q.indexOf("/") + 1) : q;
  const normMatch = PRICING.models.find((m) =>
    normId(m.id) === q ||
    (m.aliases ?? []).some((a) => { const na = normId(a); return na === q || na === qBare; })
  );
  if (normMatch) return normMatch;
  // Bare canonical id ("claude-sonnet-4-6" without the provider prefix). May be
  // ambiguous when a reseller mirrors the id (venice/claude-opus-4-5) — prefer
  // the first-party entry (no upstream_model_id).
  if (!q.includes("/")) {
    const bare = PRICING.models.filter((m) => normId(m.id).split("/")[1] === q);
    if (bare.length) return bare.find((m) => !m.upstream_model_id) ?? bare[0];
  }
  return null;
}

function normId(s) {
  return String(s).toLowerCase().replace(/\./g, "-");
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

// ---------- the deprecation record (shared by /check, /deprecations, MCP, feeds) ----------
// Tolerant id normalization: providers write model ids with dots vs dashes and
// dated snapshot suffixes (-2025-08-07, -20250805, -03-25, -0613).
export function evNormId(s) { return String(s).toLowerCase().trim().replace(/\./g, "-"); }
export function evBaseId(s) {
  return evNormId(s)
    .replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{8}$/, "")
    .replace(/-\d{2}-\d{2}$/, "").replace(/-\d{4}$/, "");
}

// Index of operational (breaking / action_required) events keyed by every
// normalized form of every affected model id. Built once at module init.
const OP_EVENT_INDEX = new Map();
for (const e of events.events) {
  if (e.severity !== "breaking" && e.severity !== "action_required") continue;
  for (const m of e.models ?? []) {
    const bare = m.includes("/") ? m.slice(m.indexOf("/") + 1) : m;
    for (const k of new Set([evNormId(m), evBaseId(m), evNormId(bare), evBaseId(bare)])) {
      if (!OP_EVENT_INDEX.has(k)) OP_EVENT_INDEX.set(k, []);
      if (!OP_EVENT_INDEX.get(k).includes(e)) OP_EVENT_INDEX.get(k).push(e);
    }
  }
}

function eventRef(e) {
  return {
    id: e.id, type: e.type, severity: e.severity, status: e.status,
    announced_at: e.announced_at, effective_at: e.effective_at ?? null,
    migration_target: e.migration_target ?? null,
    headline: e.headline, source: e.sources?.[0]?.url ?? null,
  };
}

// Verdict for one model id: is anything in the record affecting it?
export function checkModelId(query, today = new Date().toISOString().slice(0, 10)) {
  const qs = new Set([evNormId(query), evBaseId(query)]);
  const hits = [];
  for (const q of qs) for (const e of OP_EVENT_INDEX.get(q) ?? []) if (!hits.includes(e)) hits.push(e);

  const catalogModel = findModel(query);
  const upcoming = hits.filter((e) => e.effective_at && e.effective_at >= today)
    .sort((a, b) => a.effective_at.localeCompare(b.effective_at));
  const past = hits.filter((e) => e.effective_at && e.effective_at < today)
    .sort((a, b) => b.effective_at.localeCompare(a.effective_at));
  const undated = hits.filter((e) => !e.effective_at)
    .sort((a, b) => b.announced_at.localeCompare(a.announced_at));

  let status, primary = null;
  if (upcoming.length) {
    status = "scheduled"; primary = upcoming[0];
  } else if (past.length) {
    status = "retired"; primary = past[0];
  } else if (undated.length) {
    status = "affected"; primary = undated[0];
  } else if (catalogModel) {
    status = catalogModel.availability === "deprecated" ? "deprecated_in_catalog" : "ok";
  } else {
    status = "unknown";
  }

  return {
    query,
    model_id: catalogModel?.id ?? null,
    status,
    ...(primary?.effective_at && status === "scheduled"
      ? { days_remaining: Math.ceil((new Date(primary.effective_at) - new Date(today)) / 864e5), effective_at: primary.effective_at }
      : {}),
    ...(status === "retired" ? { effective_at: primary.effective_at } : {}),
    ...(primary?.migration_target ? { migration_target: primary.migration_target } : {}),
    events: hits
      .sort((a, b) => (b.effective_at ?? b.announced_at).localeCompare(a.effective_at ?? a.announced_at))
      .slice(0, 5).map(eventRef),
  };
}

// Per-model deprecation rows expanded from the events record — the view
// consumers actually want ("which model dies when"), vs. per-announcement events.
export function deprecationRows() {
  const rows = [];
  for (const e of events.events) {
    if ((e.type !== "model_deprecation" && e.type !== "model_swap") || !e.effective_at) continue;
    for (const m of e.models ?? []) {
      rows.push({
        model: m,
        provider: e.providers?.[0] ?? m.split("/")[0],
        type: e.type,
        announced_at: e.announced_at,
        effective_at: e.effective_at,
        migration_target: e.migration_target ?? null,
        event_id: e.id,
        headline: e.headline,
        source: e.sources?.[0]?.url ?? null,
        verification: e.status,
      });
    }
  }
  return rows;
}

// Weak ETag support for the raw snapshot endpoints: pollers get 304s instead
// of re-downloading unchanged multi-MB JSON. Tag derives from snapshot
// identity (date + count), which changes exactly when the data does.
export function cachedJson(body, request, tagParts, contentType = "application/json; charset=utf-8") {
  const etag = `W/"${tagParts.join("-")}"`;
  const headers = {
    "content-type": contentType,
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=300, s-maxage=300",
    etag,
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}
