import { json, error, checkModelId, logRequest, clientHashes } from "./_lib.js";

// GET /check?models=gpt-4o,claude-sonnet-4-6,gemini-2.5-flash
//
// One call, one question: is my stack okay? For each model id: scheduled
// retirements with countdowns and migration targets, past retirements,
// other breaking/action events, or a clean bill. Id matching is tolerant
// (dots/dashes, dated snapshot suffixes, bare or provider-prefixed).
export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const raw = url.searchParams.get("models") ?? url.searchParams.get("model");
  if (!raw) return error("missing models parameter — e.g. /check?models=gpt-4o,claude-sonnet-4-6", 400);

  const queries = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!queries.length) return error("no model ids given", 400);
  if (queries.length > 50) return error("too many models (max 50 per call)", 400);

  const today = new Date().toISOString().slice(0, 10);
  const results = queries.map((q) => checkModelId(q, today));
  const summary = { total: results.length, ok: 0, scheduled: 0, retired: 0, affected: 0, deprecated_in_catalog: 0, unknown: 0 };
  for (const r of results) summary[r.status] = (summary[r.status] ?? 0) + 1;

  logRequest({
    tool: "check", status: 200, count: results.length,
    model: queries[0], ...clientHashes(request),
  }, env);

  return json({ checked_at: today, summary, results });
};

export const onRequestOptions = async () =>
  new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-max-age": "86400" } });
