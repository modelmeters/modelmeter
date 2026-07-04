import { json, EVENTS, deprecationRows, logRequest, clientHashes } from "./_lib.js";

// GET /deprecations — per-model retirement rows expanded from the events
// record: which model dies when, with runway and migration target.
// Params: provider, model, status=scheduled(default)|retired|all, limit.
export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");
  const model = url.searchParams.get("model");
  const status = url.searchParams.get("status") || "scheduled";
  const limit = clampInt(url.searchParams.get("limit"), 1, 500, 200);
  const today = new Date().toISOString().slice(0, 10);

  let rows = deprecationRows();
  if (provider) rows = rows.filter((r) => r.provider === provider);
  if (model) rows = rows.filter((r) => r.model === model || r.model.endsWith(`/${model}`));
  if (status === "scheduled") rows = rows.filter((r) => r.effective_at >= today);
  else if (status === "retired") rows = rows.filter((r) => r.effective_at < today);

  rows = rows
    .map((r) => (r.effective_at >= today ? { ...r, days_remaining: Math.ceil((new Date(r.effective_at) - new Date(today)) / 864e5) } : r))
    .sort((a, b) => status === "retired" ? b.effective_at.localeCompare(a.effective_at) : a.effective_at.localeCompare(b.effective_at))
    .slice(0, limit);

  logRequest({
    tool: "deprecations", status: 200, count: rows.length,
    filters: { provider, model, status }, ...clientHashes(request),
  }, env);

  return json({ snapshot_date: EVENTS.snapshot_date, as_of: today, count: rows.length, deprecations: rows });
};

export const onRequestOptions = async () =>
  new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-max-age": "86400" } });

function clampInt(raw, min, max, fallback) {
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
