# Daily News Digest

Date-stamped markdown files (`YYYY-MM-DD.md`) of candidate AI-market events surfaced by the digest pipeline. A maintainer reviews each digest, promotes confirmed events to [`events/current.json`](../events/current.json), and the rest stay archived.

## How it works

1. [`scripts/digest.mjs`](../scripts/digest.mjs) runs daily via GitHub Action
2. Pulls candidates from ~12 RSS feeds, Hacker News (Algolia search), and Reddit subreddits
3. Filters by AI-relevance keywords (see [`scripts/digest-sources.json`](../scripts/digest-sources.json))
4. Dedupes against [`.seen.json`](.seen.json) — URL hashes already shown
5. Writes a markdown digest committed to this directory
6. Updates `.seen.json` so the same link doesn't surface twice

## Reviewing a digest

- Skim the new file
- Promote real events to [`events/current.json`](../events/current.json) with `verified: true`
- The rest stay in the digest archive as a record of what was filtered

## `.seen.json`

The dedup state. Stores up to 50,000 URL hashes (trimmed FIFO). Don't edit by hand. To resurface a previously-seen URL, delete its hash from this file.
