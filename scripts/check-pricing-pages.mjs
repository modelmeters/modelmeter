import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const { models } = JSON.parse(readFileSync("pricing/current.json", "utf8"));

const verified = models.filter((m) => !m.verification_required && m.input_cost_per_mtok != null);
const byUrl = new Map();
for (const m of verified) {
  if (!byUrl.has(m.source_url)) byUrl.set(m.source_url, []);
  byUrl.get(m.source_url).push(m);
}

ensureLabel();

const issues = [];

for (const [url, entries] of byUrl) {
  if (looksLikeApiEndpoint(url)) {
    continue;
  }

  let html;
  try {
    const res = await fetch(url, { headers: { "user-agent": "modelmeter-change-detect/1.0 (+https://modelmeter.xyz)" } });
    if (!res.ok) {
      issues.push({ url, reason: `HTTP ${res.status} fetching ${url}`, models: entries.map((e) => e.id) });
      continue;
    }
    html = await res.text();
  } catch (err) {
    issues.push({ url, reason: `Fetch failed: ${err.message}`, models: entries.map((e) => e.id) });
    continue;
  }

  const missing = [];
  for (const m of entries) {
    const marker = formatMarker(m.input_cost_per_mtok);
    if (!html.includes(marker)) {
      missing.push({ id: m.id, marker, model_display: m.display_name });
    }
  }

  if (missing.length > 0 && missing.length / entries.length < 0.7) {
    issues.push({ url, reason: "One or more verified price markers no longer appear on the source page.", models: missing });
  } else if (missing.length > 0) {
    console.log(`Skipping ${url} — ${missing.length}/${entries.length} markers missing (likely JS-rendered page, not a real pricing change).`);
  }
}

if (issues.length === 0) {
  console.log("All verified prices still appear on source pages.");
  process.exit(0);
}

console.log(`Detected ${issues.length} potential pricing change(s).`);
for (const issue of issues) {
  const title = `Pricing-page change detected: ${issue.url}`;
  const body = renderIssueBody(issue);
  openIssueIfNew(title, body);
}

function formatMarker(value) {
  return `$${Number(value).toFixed(2)}`;
}

function looksLikeApiEndpoint(url) {
  return /\/v\d+\/|\.json($|\?)/i.test(url);
}

function renderIssueBody(issue) {
  const lines = [
    `Source URL: ${issue.url}`,
    "",
    `Reason: ${issue.reason}`,
    "",
    "Affected entries:",
    ...issue.models.map((m) =>
      typeof m === "string"
        ? `- ${m}`
        : `- \`${m.id}\` (${m.model_display}) — expected to find \`${m.marker}\` on the page; not present.`
    ),
    "",
    "Please open the URL, verify current pricing, update `pricing/current.json` if needed, and close this issue.",
  ];
  return lines.join("\n");
}

function ensureLabel() {
  const repo = process.env.GH_REPO;
  if (!repo) return;
  spawnSync(
    "gh",
    [
      "label", "create", "pricing-change",
      "--repo", repo,
      "--color", "cc6600",
      "--description", "Detected potential pricing-page change",
      "--force",
    ],
    { stdio: ["ignore", "ignore", "ignore"] }
  );
}

function openIssueIfNew(title, body) {
  const repo = process.env.GH_REPO;
  if (!repo) {
    console.log("GH_REPO not set; would have opened issue:");
    console.log(title);
    console.log(body);
    return;
  }

  const search = spawnSync(
    "gh",
    ["issue", "list", "--repo", repo, "--state", "open", "--search", title, "--json", "number,title"],
    { encoding: "utf8" }
  );
  if (search.status !== 0) {
    console.error(`Failed to search issues for ${title}: ${search.stderr?.trim()}`);
    process.exitCode = 1;
    return;
  }
  const existing = JSON.parse(search.stdout || "[]");
  if (existing.some((i) => i.title === title)) {
    console.log(`Open issue already exists for: ${title}`);
    return;
  }

  const create = spawnSync(
    "gh",
    ["issue", "create", "--repo", repo, "--title", title, "--body-file", "-", "--label", "pricing-change"],
    { input: body, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] }
  );
  if (create.status !== 0) {
    console.error(`Failed to open issue for ${title}`);
    process.exitCode = 1;
  }
}