import history from "../pricing/history.json";
import { logRequest, clientHashes, cachedJson } from "./_lib.js";

export const onRequestGet = async ({ request, env }) => {
  logRequest({
    tool: "history_json",
    status: 200,
    schema_version: history.schema_version,
    model_count: history.model_count,
    snapshot_count: history.snapshot_count,
    ...clientHashes(request),
  }, env);

  return cachedJson(JSON.stringify(history, null, 2) + "\n", request, [history.generated_at?.slice(0, 10) ?? "0", history.model_count]);
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