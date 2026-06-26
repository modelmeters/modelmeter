import history from "../pricing/history.json";
import { logRequest, clientHashes } from "./_lib.js";

export const onRequestGet = async ({ request, env }) => {
  logRequest({
    tool: "history_json",
    status: 200,
    schema_version: history.schema_version,
    model_count: history.model_count,
    snapshot_count: history.snapshot_count,
    ...clientHashes(request),
  }, env);

  return new Response(JSON.stringify(history, null, 2) + "\n", {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "cache-control": "public, max-age=600, s-maxage=600",
    },
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