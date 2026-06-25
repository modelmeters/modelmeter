import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const PRICING_DIR = "pricing";
const SNAPSHOTS_DIR = join(PRICING_DIR, "snapshots");
const CURRENT_PATH = join(PRICING_DIR, "current.json");

const current = readFileSync(CURRENT_PATH, "utf8");
const currentHash = createHash("sha256").update(current).digest("hex");

if (!existsSync(SNAPSHOTS_DIR)) {
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });
}

const existing = readdirSync(SNAPSHOTS_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();
const latest = existing.at(-1);

if (latest) {
  const latestContent = readFileSync(join(SNAPSHOTS_DIR, latest), "utf8");
  const latestHash = createHash("sha256").update(latestContent).digest("hex");
  if (latestHash === currentHash) {
    console.log(`No change since ${latest}. Skipping snapshot.`);
    process.exit(0);
  }
}

const today = new Date().toISOString().slice(0, 10);
const outPath = join(SNAPSHOTS_DIR, `${today}.json`);
writeFileSync(outPath, current);
console.log(`Wrote snapshot: ${outPath}`);