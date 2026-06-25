import { json, PRICING, logRequest, clientHashes } from "./_lib.js";

export const onRequestGet = async ({ request }) => {
  const url = new URL(request.url);
  const providerFilter = url.searchParams.get("provider");
  const includeUnverified = url.searchParams.get("include_unverified") === "true";
  const includeUnavailable = url.searchParams.get("include_unavailable") === "true";
  const excludeTagsParam = url.searchParams.get("exclude_tags");
  const excludeTags = excludeTagsParam ? excludeTagsParam.split(",").map((t) => t.trim().toLowerCase()) : [];

  let models = PRICING.models;

  if (providerFilter) {
    models = models.filter((m) => m.provider === providerFilter);
  }
  if (!includeUnverified) {
    models = models.filter((m) => !m.verification_required && m.input_cost_per_mtok != null);
  }
  if (!includeUnavailable) {
    models = models.filter((m) => !m.availability || m.availability === "available");
  }
  if (excludeTags.length > 0) {
    models = models.filter((m) => {
      const tags = (m.tags ?? []).map((t) => t.toLowerCase());
      return !tags.some((t) => excludeTags.includes(t));
    });
  }

  const result = models.map((m) => ({
    id: m.id,
    provider: m.provider,
    display_name: m.display_name,
    input_cost_per_mtok: m.input_cost_per_mtok,
    output_cost_per_mtok: m.output_cost_per_mtok,
    cache_read_cost_per_mtok: m.cache_read_cost_per_mtok ?? null,
    cache_write_cost_per_mtok: m.cache_write_cost_per_mtok ?? null,
    context_window: m.context_window ?? null,
    tags: m.tags ?? [],
    upstream_model_id: m.upstream_model_id ?? null,
    last_verified: m.last_verified,
    source_url: m.source_url,
  }));

  logRequest({
    tool: "models",
    status: 200,
    count: result.length,
    filters: {
      provider: providerFilter,
      include_unverified: includeUnverified,
      include_unavailable: includeUnavailable,
      exclude_tags: excludeTags,
    },
    ...clientHashes(request),
  });

  return json({
    schema_version: PRICING.schema_version,
    snapshot_date: PRICING.snapshot_date,
    count: result.length,
    models: result,
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