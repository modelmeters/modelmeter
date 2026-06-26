#!/usr/bin/env node
// Modelmeter daily news digest aggregator.
//
// Pulls candidate AI-market news from RSS feeds, Hacker News, and Reddit.
// Filters by keyword. Dedupes against state. Writes a date-stamped markdown
// digest to digest/YYYY-MM-DD.md and updates digest/.seen.json.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import Parser from "rss-parser";

const ROOT = process.cwd();
const SOURCES_PATH = join(ROOT, "scripts/digest-sources.json");
const DIGEST_DIR = join(ROOT, "digest");
const SEEN_PATH = join(DIGEST_DIR, ".seen.json");

const TODAY = new Date().toISOString().slice(0, 10);
const DIGEST_PATH = join(DIGEST_DIR, `${TODAY}.md`);

const sources = JSON.parse(readFileSync(SOURCES_PATH, "utf8"));
const seen = loadSeen();
const parser = new Parser({ timeout: 15000, headers: { "user-agent": "modelmeter-digest/0.1 (+https://modelmeter.xyz)" } });

const keywordRegex = new RegExp(`\\b(${sources.keywords.map(escapeRegex).join("|")})\\b`, "i");

const candidates = [];

for (const feed of sources.rss_feeds) {
  try {
    const items = await fetchFeed(feed.url);
    for (const item of items) {
      const text = `${item.title ?? ""} ${item.contentSnippet ?? item.content ?? ""}`;
      if (!keywordRegex.test(text)) continue;
      const link = canonicalUrl(item.link);
      if (!link || seen.has(hashUrl(link))) continue;
      candidates.push({
        source: feed.name,
        source_type: "rss",
        title: clean(item.title ?? "(no title)"),
        url: link,
        snippet: clean((item.contentSnippet ?? item.content ?? "").slice(0, 280)),
        published: item.isoDate ?? item.pubDate ?? null,
      });
    }
  } catch (err) {
    console.error(`RSS fetch failed: ${feed.name} (${feed.url}) — ${err.message}`);
  }
}

for (const query of sources.hn_searches) {
  try {
    const items = await fetchHN(query);
    for (const item of items) {
      const link = canonicalUrl(item.url ?? `https://news.ycombinator.com/item?id=${item.objectID}`);
      if (!link || seen.has(hashUrl(link))) continue;
      candidates.push({
        source: `Hacker News (${query})`,
        source_type: "hn",
        title: clean(item.title ?? "(no title)"),
        url: link,
        snippet: `${item.points ?? 0} points · ${item.num_comments ?? 0} comments`,
        published: item.created_at,
      });
    }
  } catch (err) {
    console.error(`HN fetch failed for ${query} — ${err.message}`);
  }
}

for (const sub of sources.reddit_subs) {
  try {
    const items = await fetchReddit(sub);
    for (const item of items) {
      const text = `${item.title} ${item.selftext ?? ""}`;
      if (!keywordRegex.test(text)) continue;
      const link = canonicalUrl(`https://reddit.com${item.permalink}`);
      if (!link || seen.has(hashUrl(link))) continue;
      candidates.push({
        source: `r/${sub}`,
        source_type: "reddit",
        title: clean(item.title),
        url: link,
        snippet: clean((item.selftext ?? "").slice(0, 280)) || `↑ ${item.ups ?? 0} · ${item.num_comments ?? 0} comments`,
        published: item.created_utc ? new Date(item.created_utc * 1000).toISOString() : null,
      });
    }
  } catch (err) {
    console.error(`Reddit fetch failed for r/${sub} — ${err.message}`);
  }
}

candidates.sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""));

if (candidates.length === 0) {
  console.log("No new candidates today.");
  process.exit(0);
}

writeFileSync(DIGEST_PATH, renderDigest(candidates));
for (const c of candidates) seen.add(hashUrl(c.url));
saveSeen(seen);

console.log(`Wrote ${candidates.length} candidates to ${DIGEST_PATH}.`);

// helpers

async function fetchFeed(url) {
  const feed = await parser.parseURL(url);
  return feed.items ?? [];
}

async function fetchHN(query) {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&numericFilters=points%3E30`;
  const res = await fetch(url, { headers: { "user-agent": "modelmeter-digest/0.1" } });
  if (!res.ok) throw new Error(`HN HTTP ${res.status}`);
  const body = await res.json();
  return body.hits ?? [];
}

async function fetchReddit(sub) {
  const url = `https://www.reddit.com/r/${sub}/.json?limit=25`;
  const res = await fetch(url, { headers: { "user-agent": "modelmeter-digest/0.1" } });
  if (!res.ok) throw new Error(`Reddit HTTP ${res.status}`);
  const body = await res.json();
  return (body.data?.children ?? []).map((c) => c.data);
}

function loadSeen() {
  if (!existsSync(DIGEST_DIR)) mkdirSync(DIGEST_DIR, { recursive: true });
  if (!existsSync(SEEN_PATH)) return new Set();
  try {
    const obj = JSON.parse(readFileSync(SEEN_PATH, "utf8"));
    return new Set(obj.hashes ?? []);
  } catch {
    return new Set();
  }
}

function saveSeen(set) {
  const arr = Array.from(set);
  const trimmed = arr.slice(-50000);
  writeFileSync(SEEN_PATH, JSON.stringify({ updated: new Date().toISOString(), count: trimmed.length, hashes: trimmed }, null, 2) + "\n");
}

function hashUrl(url) {
  return createHash("sha256").update(canonicalUrl(url) ?? "").digest("hex").slice(0, 16);
}

function canonicalUrl(u) {
  if (!u) return null;
  try {
    const url = new URL(u);
    for (const k of [...url.searchParams.keys()]) {
      if (/^utm_/.test(k) || ["ref", "ref_src", "ref_url"].includes(k)) url.searchParams.delete(k);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function clean(s) {
  return String(s).replace(/\s+/g, " ").trim();
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderDigest(items) {
  const byType = {};
  for (const c of items) (byType[c.source_type] ||= []).push(c);

  let md = `# Modelmeter Digest — ${TODAY}\n\n`;
  md += `${items.length} candidate event${items.length === 1 ? "" : "s"} matched AI-relevance keywords across ${Object.keys(byType).length} source type${Object.keys(byType).length === 1 ? "" : "s"}.\n\n`;
  md += `Read, decide which deserve a verified entry in [\`events/current.json\`](../events/current.json), and commit. Stubs not worth tracking can be ignored — they're already deduped via \`digest/.seen.json\`.\n\n`;
  md += `---\n\n`;

  const order = ["rss", "hn", "reddit"];
  for (const t of order) {
    if (!byType[t]) continue;
    md += `## ${labelFor(t)} (${byType[t].length})\n\n`;
    for (const c of byType[t]) {
      md += `### ${c.title}\n\n`;
      md += `- **Source:** ${c.source}\n`;
      if (c.published) md += `- **Published:** ${c.published}\n`;
      md += `- **Link:** ${c.url}\n`;
      if (c.snippet) md += `- **Snippet:** ${c.snippet}\n`;
      md += `\n`;
    }
  }
  return md;
}

function labelFor(t) {
  return { rss: "RSS feeds", hn: "Hacker News", reddit: "Reddit" }[t] ?? t;
}