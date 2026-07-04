import { feedEvents, describe, prefix } from "./feed.xml.js";

// GET /feed.json — JSON Feed 1.1 of the record's operational events.
const SITE = "https://modelmeter.xyz";

export const onRequestGet = async () => {
  const body = {
    version: "https://jsonfeed.org/version/1.1",
    title: "Modelmeter — model-layer changes",
    home_page_url: SITE,
    feed_url: `${SITE}/feed.json`,
    description: "The changelog of record for the AI stack: source-verified deprecations, sunsets, model swaps, and price changes.",
    items: feedEvents().map((e) => ({
      id: e.id,
      title: prefix(e) + e.headline,
      content_text: describe(e),
      url: e.sources?.[0]?.url ?? `${SITE}/events`,
      date_published: `${e.announced_at}T12:00:00Z`,
      tags: [e.type, e.severity, ...(e.providers ?? [])],
      _modelmeter: {
        severity: e.severity,
        type: e.type,
        effective_at: e.effective_at ?? null,
        models: e.models ?? [],
        migration_target: e.migration_target ?? null,
        verification: e.status,
      },
    })),
  };
  return new Response(JSON.stringify(body, null, 2) + "\n", {
    headers: {
      "content-type": "application/feed+json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=600, s-maxage=600",
    },
  });
};
