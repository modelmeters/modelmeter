import { json, EVENTS, logRequest, clientHashes } from "./_lib.js";

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const providerFilter = url.searchParams.get("provider");
  const typeFilter = url.searchParams.get("type");
  const modelFilter = url.searchParams.get("model");
  const since = url.searchParams.get("since");
  const until = url.searchParams.get("until");
  const includeUnverified = url.searchParams.get("include_unverified") === "true";
  const limit = clampInt(url.searchParams.get("limit"), 1, 500, 200);

  let evs = EVENTS.events;

  if (!includeUnverified) {
    evs = evs.filter((e) => e.verified === true);
  }
  if (providerFilter) {
    evs = evs.filter((e) => Array.isArray(e.providers) && e.providers.includes(providerFilter));
  }
  if (typeFilter) {
    evs = evs.filter((e) => e.type === typeFilter);
  }
  if (modelFilter) {
    evs = evs.filter((e) => Array.isArray(e.models) && e.models.includes(modelFilter));
  }
  if (since) {
    evs = evs.filter((e) => e.date >= since);
  }
  if (until) {
    evs = evs.filter((e) => e.date <= until);
  }

  evs = evs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);

  logRequest({
    tool: "events",
    status: 200,
    count: evs.length,
    filters: { provider: providerFilter, type: typeFilter, model: modelFilter, since, until, include_unverified: includeUnverified },
    ...clientHashes(request),
  }, env);

  return json({
    schema_version: EVENTS.schema_version,
    snapshot_date: EVENTS.snapshot_date,
    count: evs.length,
    events: evs,
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

function clampInt(raw, min, max, fallback) {
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}