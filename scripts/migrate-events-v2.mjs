// One-off migration: events schema 1.0.0 -> 2.0.0 (2026-07-02).
// Kept in the repo as the audit record of how v1 entries were mapped.
//
// Mechanical mapping, no data invented:
//   date         -> announced_at            (same value, precise name)
//   source_urls  -> sources[{url}]          (quote/archived_url absent: not captured in v1)
//   verified     -> status                  (true -> "verified", false -> "unverified")
//   + severity   derived from type          (see SEVERITY_BY_TYPE; v1 predates per-event
//                                            severity judgment, so it is type-derived)
//   effective_at / detected_at / migration_target: absent (unknown for v1 entries;
//   never inferred — filled per-event later where a source documents them)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PATH = join(ROOT, "events/current.json");

const SEVERITY_BY_TYPE = {
  model_deprecation: "breaking",
  model_unavailable: "action_required",
  pricing_change: "action_required",
  // everything else in v1 is market context
};

const d = JSON.parse(readFileSync(PATH, "utf8"));
if (d.schema_version !== "1.0.0") {
  console.error(`expected schema_version 1.0.0, found ${d.schema_version} — nothing to do`);
  process.exit(1);
}

d.events = d.events.map((e) => {
  const { date, source_urls, verified, ...rest } = e;
  return {
    id: rest.id,
    announced_at: date,
    type: rest.type,
    severity: SEVERITY_BY_TYPE[rest.type] ?? "informational",
    status: verified === true ? "verified" : "unverified",
    providers: rest.providers,
    models: rest.models,
    headline: rest.headline,
    summary: rest.summary,
    sources: (source_urls ?? []).map((url) => ({ url })),
    ...(rest.tags ? { tags: rest.tags } : {}),
    ...(rest.impact ? { impact: rest.impact } : {}),
    created_at: rest.created_at,
    updated_at: rest.updated_at,
  };
});
d.schema_version = "2.0.0";

writeFileSync(PATH, JSON.stringify(d, null, 2) + "\n");
const bySev = {};
for (const e of d.events) bySev[e.severity] = (bySev[e.severity] || 0) + 1;
console.log(`migrated ${d.events.length} events to 2.0.0`);
console.log("severity:", bySev);
console.log("status:", d.events.reduce((a, e) => ((a[e.status] = (a[e.status] || 0) + 1), a), {}));
