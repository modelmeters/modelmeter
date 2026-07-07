import { PRICING, logRequest, clientHashes , cachedJson} from "./_lib.js";

export const onRequestGet = async ({ request, env }) => {
  logRequest({
    tool: "pricing_json",
    status: 200,
    schema_version: PRICING.schema_version,
    count: PRICING.models.length,
    ...clientHashes(request),
  }, env);

  return cachedJson(JSON.stringify(PRICING, null, 2) + "\n", request, [PRICING.snapshot_date, PRICING.models.length]);
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