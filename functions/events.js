import { json, EVENTS, logRequest, clientHashes } from "./_lib.js";

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const providerFilter = url.searchParams.get("provider");
  const typeFilter = url.searchParams.get("type");
  const modelFilter = url.searchParams.get("model");
  const severityFilter = url.searchParams.get("severity");
  const since = url.searchParams.get("since");
  const until = url.searchParams.get("until");
  // status=verified (default) | unverified | all | corrected.
  // "all" = verified + unverified; corrected (superseded) entries are only
  // returned when asked for explicitly — they exist for the audit trail.
  const status = url.searchParams.get("status") || "verified";

  const limit = clampInt(url.searchParams.get("limit"), 1, 500, 200);

  let evs = EVENTS.events;

  if (status === "all") {
    evs = evs.filter((e) => e.status !== "corrected");
  } else {
    evs = evs.filter((e) => e.status === status);
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
  if (severityFilter) {
    evs = evs.filter((e) => e.severity === severityFilter);
  }
  if (since) {
    evs = evs.filter((e) => e.announced_at >= since);
  }
  if (until) {
    evs = evs.filter((e) => e.announced_at <= until);
  }

  evs = evs.sort((a, b) => b.announced_at.localeCompare(a.announced_at)).slice(0, limit);

  logRequest({
    tool: "events",
    status: 200,
    count: evs.length,
    filters: { provider: providerFilter, type: typeFilter, model: modelFilter, severity: severityFilter, since, until, status },
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