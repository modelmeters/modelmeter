# Daily News Digest

Date-stamped markdown files (`YYYY-MM-DD.md`) of candidate AI-market events surfaced by the digest pipeline. Read, decide what deserves a verified entry in [`events/current.json`](../events/current.json), commit those, ignore the rest.

## How it works (Phase 1)

1. [`scripts/digest.mjs`](../scripts/digest.mjs) runs daily via GitHub Action
2. Pulls candidates from ~12 RSS feeds, Hacker News (Algolia search), and Reddit subreddits
3. Filters by AI-relevance keywords (see [`scripts/digest-sources.json`](../scripts/digest-sources.json))
4. Dedupes against [`.seen.json`](.seen.json) — URL hashes we've already shown
5. Writes a markdown digest committed to this directory
6. Updates `.seen.json` so the same link doesn't surface twice

## Workflow

- Daily: skim the new digest file
- Promote real events to [`events/current.json`](../events/current.json) with `verified: true`
- The rest stay in the digest archive as a record of what was filtered

## Phase 2 (future)

When the Mac Mini is up with Hermes:
- LLM filter pass scores each candidate 1–10 for AI pricing/capacity/availability relevance
- Drops <7, ranks the rest
- Drafts proposed `events/current.json` entries for human review
- Daily 5-minute review instead of 15

## `.seen.json`

The dedup state. Stores up to 50,000 URL hashes (trimmed FIFO). Don't edit by hand. If you want a previously-seen URL to surface again, delete its hash here.