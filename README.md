# Modelmeter

Agent-first measurement and instrumentation for AI models. Live at [modelmeter.xyz](https://modelmeter.xyz).

## What this is

A growing toolkit of small, sharply-scoped utilities — cost calculators, context-window checks, and market-event tracking — designed primarily for AI agents to call programmatically, and secondarily for humans through a dashboard. The wedge: clean GET URLs, stable JSON contracts, an [OpenAPI spec](public/openapi.yaml), and an [`llms.txt`](public/llms.txt) discoverability file. Most calculator sites are JS-heavy SPAs that agents can't use; Modelmeter is built the other way around.

## Endpoints

- `GET /estimate?model=X&input=N&output=M` — token cost for a hypothetical call, including upstream-markup comparison for reseller models
- `GET /models` — current model catalog, with filters
- `GET /events` — AI market events (model launches, deprecations, regulatory actions, compute partnerships) for annotating the pricing timeline
- `GET /pricing.json` — raw pricing snapshot
- `GET /events.json` — raw events snapshot

See [`public/openapi.yaml`](public/openapi.yaml) for the full spec.

## Datasets

- [`pricing/`](pricing/) — current and historical model pricing across providers
- [`events/`](events/) — annotated AI market events with primary-source citations

Each entry carries a `last_verified` date. Daily snapshots in `pricing/snapshots/` accumulate the historical record. Wrong pricing is the existential risk — the schema requires explicit human verification before an entry is served.

## Contributing

Found a price change? Open a PR updating [`pricing/current.json`](pricing/current.json) with the new value, an updated `last_verified` date, and the source URL.

Spotted a meaningful AI market event? Add an entry to [`events/current.json`](events/current.json) with primary-source citations and `verified: true`.

Automation opens issues when provider pricing pages change. Pick one up if you want to help.

## License

MIT — see [LICENSE](LICENSE).