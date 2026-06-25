# Modelmeter Pricing Data

This directory holds the source of truth for model pricing.

- [`current.json`](current.json) — what the API and calculator currently serve
- [`schema.json`](schema.json) — JSON Schema for the pricing format
- [`snapshots/`](snapshots) — date-stamped copies of `current.json`, written daily by [`.github/workflows/snapshot.yml`](../.github/workflows/snapshot.yml). Never edit by hand.

## How verification works

Every model entry has two fields you need to care about:

- `last_verified` — ISO date a human last opened the `source_url` and confirmed every price field matches what's published.
- `verification_required` — `true` means *no* human has confirmed these values yet. The calculator refuses to serve entries with this flag set.

This is intentional: it is better to show no price than to show a wrong price. Trust takes years to build and one bad number to lose.

## Updating a price

1. Open [`current.json`](current.json).
2. Update the numeric fields for the model.
3. Update `last_verified` to today (YYYY-MM-DD).
4. Set `verification_required: false`.
5. Commit with a message like `pricing: anthropic/claude-sonnet-4-6 input cost 3.00 → 2.50`.

The daily snapshot workflow will commit a date-stamped copy automatically.

## Adding a new model

Add a new entry following the schema. Use `provider/model-id` as the `id` with lowercase and hyphens. Leave numeric fields `null` and `verification_required: true` until you've checked the provider page.

## Removing / deprecating a model

Do not delete entries. Set `deprecated_on` to the date the provider deprecated the model. The calculator will return historical pricing for deprecated models but mark them clearly.