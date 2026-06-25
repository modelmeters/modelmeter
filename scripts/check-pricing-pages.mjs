import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const { models } = JSON.parse(readFileSync("pricing/current.json", "utf8"));

const verified = models.filter((m) => !m.verification_required && m.input_cost_per_mtok != null);
const byUrl = new Map();
for (const m of verified) {
  if (!byUrl.has(m.source_url)) byUrl.set(m.source_url, []);
  byUrl.get(m.source_url).push(m);
}

const issues = [];

for (const [url, entries] of byUrl) {
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

  if (missing.length > 0) {
    issues.push({ url, reason: "One or more verified price markers no longer appear on the source page.", models: missing });
  }
}

if (issues.length === 0) {
  console.log("All verified prices still appear on source pages.");
  process.exit(0);
}

console.log(`Detected ${issues.length} potential pricing changes.`);
for (const issue of issues) {
  const title = `Pricing-page change detected: ${issue.url}`;
  const body = renderIssueBody(issue);
  openIssueIfNew(title, body);
}

function formatMarker(value) {
  return `$${Number(value).toFixed(2)}`;
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

function openIssueIfNew(title, body) {
  const repo = process.env.GH_REPO;
  if (!repo) {
    console.log("GH_REPO not set; would have opened issue:");
    console.log(title);
    console.log(body);
    return;
  }
  try {
    const existing = execSync(
      `gh issue list --repo ${repo} --state open --search ${JSON.stringify(title)} --json number,title`,
      { stdio: ["ignore", "pipe", "pipe"] }
    ).toString();
    const existingArr = JSON.parse(existing);
    if (existingArr.some((i) => i.title === title)) {
      console.log(`Open issue already exists for: ${title}`);
      return;
    }
    execSync(
      `gh issue create --repo ${repo} --title ${JSON.stringify(title)} --body ${JSON.stringify(body)} --label pricing-change`,
      { stdio: "inherit" }
    );
  } catch (err) {
    console.error(`Failed to open issue for ${title}: ${err.message}`);
    process.exitCode = 1;
  }
}