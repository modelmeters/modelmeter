import { PRICING, logRequest, clientHashes } from "./_lib.js";

export const onRequestGet = async ({ request }) => {
  logRequest({
    tool: "pricing_json",
    status: 200,
    schema_version: PRICING.schema_version,
    count: PRICING.models.length,
    ...clientHashes(request),
  });

  return new Response(JSON.stringify(PRICING, null, 2) + "\n", {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "cache-control": "public, max-age=300, s-maxage=300",
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