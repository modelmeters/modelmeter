# Modelmeter Events Dataset

Annotated AI market events that may impact pricing, capacity, or availability of AI models. Used to overlay context onto the pricing timeline so the chart tells a story, not just a series of numbers.

- [`current.json`](current.json) — what the API serves
- [`schema.json`](schema.json) — JSON Schema 1.0.0

## What counts as an event?

An event belongs in this dataset if it **plausibly impacts AI pricing, capacity, or availability**. Examples:

- A provider publishes new prices, releases a new model, or deprecates an old one
- A provider's model becomes unavailable in a region or globally
- A multi-billion-dollar compute partnership announced
- A regulator bans, restricts, or restricts export of a specific model or capability
- A major M&A involving labs or compute infrastructure
- A material funding round ($500M+ rounds for AI labs or chip makers)
- A significant open-source release that shifts the price floor
- A major lawsuit outcome (copyright, antitrust)
- New chip generations or fab capacity announcements

What's **out of scope**: general AI news, opinion pieces, product launches that don't affect API economics, marketing announcements.

## Source discipline

Every event must cite **at least one primary source** in `source_urls`:

- Provider newsroom / blog
- Provider's pricing or model docs page
- Regulatory filings (SEC, Federal Register, EU Official Journal)
- Court documents
- Reputable journalism (Reuters, FT, WSJ, Bloomberg, The Information)

**Not acceptable as sole sources:** aggregator sites, Twitter/X posts, Reddit threads. These can be supporting context but the primary source must be authoritative.

## The `verified` flag

- `true`: a human has confirmed the headline, date, and source URLs match what's reported.
- `false`: stub entry (typically from the daily digest pipeline) awaiting human review.

The `/events` API filters to `verified: true` by default. Stubs accumulate in the dataset but don't appear in default outputs.

## Contributing an event

1. Verify the headline, date, and sources against primary references
2. Add an entry to [`current.json`](current.json) with `verified: true`
3. Open a PR with message like `events: add 2026-06-anthropic-fable-5-unavailable`

## Event IDs

Stable slug convention: `YYYY-MM-{primary-provider}-{short-description}`. Lowercase, hyphenated, no special characters. The schema enforces `^[a-z0-9-]+$`.

Examples:
- `2026-06-anthropic-fable-5-unavailable`
- `2026-anthropic-opus-4-8-launch`

IDs should never be reused or renumbered. To correct an event, edit the existing entry and bump `updated_at`.