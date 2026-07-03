#!/usr/bin/env node
// Repo-wide validation script. Runs in CI and locally via `npm run check`.
//
// Checks:
//   1. pricing/current.json validates against pricing/schema.json
//   2. events/current.json validates against events/schema.json
//   3. Every JSON file in the repo (excluding node_modules) is syntactically valid
//   4. Every .js and .mjs file in functions/, scripts/, and public/ parses
//   5. Schema versions in current.json files match the schema.json const
//
// Exits 0 on success, 1 on any failure. Reports all failures before exiting.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { execSync } from "node:child_process";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = process.cwd();
const failures = [];

function fail(check, file, detail) {
  failures.push({ check, file, detail });
  console.error(`  ✗ ${check} · ${file}: ${detail}`);
}
function pass(check, file) {
  console.log(`  ✓ ${check} · ${file}`);
}

// ---------- 1 & 2 & 5. Schema validation ----------
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

function validateAgainstSchema(dataPath, schemaPath, name) {
  const data = JSON.parse(readFileSync(join(ROOT, dataPath), "utf8"));
  const schema = JSON.parse(readFileSync(join(ROOT, schemaPath), "utf8"));
  const validate = ajv.compile(schema);
  if (!validate(data)) {
    for (const err of validate.errors) {
      fail(`schema: ${name}`, dataPath, `${err.instancePath || "(root)"} ${err.message}`);
    }
    return false;
  }
  pass(`schema: ${name}`, dataPath);

  // Cross-check schema_version on data matches the const in schema
  const expected = schema?.properties?.schema_version?.const;
  if (expected && data.schema_version !== expected) {
    fail(`schema_version`, dataPath, `data says "${data.schema_version}", schema requires "${expected}"`);
  }
  return true;
}

console.log("\n[1/3] schema validation");
validateAgainstSchema("pricing/current.json", "pricing/schema.json", "pricing 1.x");
validateAgainstSchema("events/current.json", "events/schema.json", "events 2.x");

// Alias integrity: each alias must be globally unique and must not collide
// with any model's canonical id (else lookups would be ambiguous).
(function checkAliasUniqueness() {
  const pricing = JSON.parse(readFileSync(join(ROOT, "pricing/current.json"), "utf8"));
  const ids = new Set(pricing.models.map((m) => m.id));
  const seen = new Map(); // alias -> owning model id
  let ok = true;
  for (const m of pricing.models) {
    for (const a of m.aliases ?? []) {
      if (ids.has(a)) { fail("alias uniqueness", "pricing/current.json", `alias "${a}" (on ${m.id}) collides with a model id`); ok = false; }
      if (seen.has(a)) { fail("alias uniqueness", "pricing/current.json", `alias "${a}" used by both ${seen.get(a)} and ${m.id}`); ok = false; }
      seen.set(a, m.id);
    }
  }
  if (ok) pass("alias uniqueness", "pricing/current.json");
})();

// ---------- 3. JSON syntax across the repo ----------
console.log("\n[2/3] JSON syntax sweep");
function walkJsonFiles(dir, hits = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "node_modules" || name === ".git" || name === ".private") continue;
    const st = statSync(path);
    if (st.isDirectory()) walkJsonFiles(path, hits);
    else if (extname(name) === ".json") hits.push(path);
  }
  return hits;
}
const jsonFiles = walkJsonFiles(ROOT);
let jsonCount = 0;
for (const path of jsonFiles) {
  try {
    JSON.parse(readFileSync(path, "utf8"));
    jsonCount++;
  } catch (err) {
    fail("json syntax", relative(ROOT, path), err.message);
  }
}
console.log(`  ✓ parsed ${jsonCount} JSON files`);

// ---------- 4. JS syntax sweep ----------
console.log("\n[3/3] JS syntax sweep");
function walkJsFiles(dirs) {
  const hits = [];
  for (const dir of dirs) {
    if (!safeStat(join(ROOT, dir))) continue;
    walk(join(ROOT, dir), hits);
  }
  return hits;
}
function safeStat(path) {
  try { return statSync(path); } catch { return null; }
}
function walk(dir, hits) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, hits);
    else if (extname(name) === ".js" || extname(name) === ".mjs") hits.push(path);
  }
}
const jsFiles = walkJsFiles(["functions", "scripts", "public"]);
let jsCount = 0;
for (const path of jsFiles) {
  try {
    execSync(`node --check "${path}"`, { stdio: ["ignore", "ignore", "pipe"] });
    jsCount++;
  } catch (err) {
    fail("js syntax", relative(ROOT, path), err.stderr?.toString().split("\n").slice(0, 3).join(" / ") || "parse failed");
  }
}
console.log(`  ✓ parsed ${jsCount} JS/MJS files`);

// ---------- Result ----------
console.log("");
if (failures.length === 0) {
  console.log(`PASS — ${jsonFiles.length} JSON + ${jsFiles.length} JS files validated, schemas clean`);
  process.exit(0);
} else {
  console.error(`FAIL — ${failures.length} issue(s):`);
  for (const f of failures) console.error(`  ${f.check} · ${f.file}: ${f.detail}`);
  process.exit(1);
}