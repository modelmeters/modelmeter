import { json, logRequest, clientHashes } from "./_lib.js";
import history from "../pricing/history.json";

export const onRequestGet = async ({ request, env }) => {
  const url = new URL(request.url);
  const modelFilter = url.searchParams.get("model");
  const providerFilter = url.searchParams.get("provider");
  const since = url.searchParams.get("since");
  const until = url.searchParams.get("until");

  let models = history.models;
  if (providerFilter) models = models.filter((m) => m.provider === providerFilter);
  if (modelFilter) models = models.filter((m) => m.id === modelFilter);

  if (since || until) {
    models = models.map((m) => ({
      ...m,
      history: m.history.filter((h) => (!since || h.date >= since) && (!until || h.date <= until)),
    })).filter((m) => m.history.length > 0);
  }

  logRequest({
    tool: "history",
    status: 200,
    count: models.length,
    filters: { model: modelFilter, provider: providerFilter, since, until },
    ...clientHashes(request),
  }, env);

  return json({
    schema_version: history.schema_version,
    generated_at: history.generated_at,
    count: models.length,
    models,
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