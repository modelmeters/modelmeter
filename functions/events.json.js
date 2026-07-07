import { EVENTS, logRequest, clientHashes , cachedJson} from "./_lib.js";

export const onRequestGet = async ({ request, env }) => {
  logRequest({
    tool: "events_json",
    status: 200,
    schema_version: EVENTS.schema_version,
    count: EVENTS.events.length,
    ...clientHashes(request),
  }, env);

  return cachedJson(JSON.stringify(EVENTS, null, 2) + "\n", request, [EVENTS.snapshot_date, EVENTS.events.length]);
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