import { EVENTS } from "./_lib.js";

// GET /feed.xml — RSS 2.0 of the record's operational events (breaking +
// action_required): deprecations, sunsets, model swaps, price changes.
// Plugs into Feedly / Slack RSS / email bridges with zero integration work.
const SITE = "https://modelmeter.xyz";

export const onRequestGet = async () => {
  const items = feedEvents().map((e) => `    <item>
      <title>${esc(prefix(e) + e.headline)}</title>
      <link>${esc(e.sources?.[0]?.url ?? `${SITE}/events`)}</link>
      <guid isPermaLink="false">${esc(e.id)}</guid>
      <pubDate>${rfc822(e.announced_at)}</pubDate>
      <category>${esc(e.type)}</category>
      <description>${esc(describe(e))}</description>
    </item>`).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Modelmeter — model-layer changes</title>
    <link>${SITE}</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>
    <description>The changelog of record for the AI stack: source-verified deprecations, sunsets, model swaps, and price changes.</description>
    <language>en</language>
    <ttl>180</ttl>
${items}
  </channel>
</rss>
`;
  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=600, s-maxage=600",
    },
  });
};

export function feedEvents() {
  return EVENTS.events
    .filter((e) => (e.severity === "breaking" || e.severity === "action_required") && e.status !== "corrected")
    .sort((a, b) => b.announced_at.localeCompare(a.announced_at))
    .slice(0, 60);
}

export function describe(e) {
  const bits = [e.summary];
  if (e.effective_at) bits.push(`Effective: ${e.effective_at}.`);
  if (e.migration_target) bits.push(`Migration target: ${e.migration_target}.`);
  if (e.models?.length) bits.push(`Affected: ${e.models.join(", ")}.`);
  bits.push(`Severity: ${e.severity}. Verification: ${e.status}.`);
  return bits.join(" ");
}

export function prefix(e) {
  return e.severity === "breaking" ? "[breaking] " : "[action] ";
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rfc822(date) {
  return new Date(`${date}T12:00:00Z`).toUTCString();
}
