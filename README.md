# Modelmeter

The changelog of record for the AI stack. Live at [modelmeter.xyz](https://modelmeter.xyz).

## What this is

A machine-readable, source-verified record of everything that changes in the model layer: **deprecations with sunset dates and migration targets, silent model swaps behind stable IDs, price changes, releases** — plus three years of pricing history and cost tooling. Every event carries its sources with verbatim quotes (most with archive snapshots), a verification status (`unverified` → human-reviewed `verified`), and corrections are never silent — a `correction` event points at what it supersedes.

Built primarily for AI agents to call programmatically, secondarily for humans through a dashboard. Reach it three ways: plain **GET URLs** returning JSON, a remote **[MCP server](#mcp-server)** any tool-calling agent can connect to, and a **visual dashboard** built on the same endpoints. The wedge: clean URLs, stable JSON contracts, an [OpenAPI spec](public/openapi.yaml), and an [`llms.txt`](public/llms.txt) discoverability file. Most sites in this space are JS-heavy SPAs that agents can't use; Modelmeter is built the other way around.

## Endpoints

- `GET /estimate?model=X&input=N&output=M` — token cost for a hypothetical call, including upstream-markup comparison for reseller models
- `GET /models` — current model catalog, with filters
- `GET /model?id=X` — unified card for one model: normalized pricing, capabilities (context window, vision, reasoning, tags), availability, reseller markup, and a price-history summary (launch vs. current price, % change, all-time low/high)
- `GET /events` — the changelog of record: deprecations, price changes, launches and surrounding market events, each with `severity` (`breaking` | `action_required` | `informational`), `announced_at`/`effective_at` dates, sources with quotes, and verification `status`. Filters: `provider`, `type`, `model`, `severity`, `since`, `until`, `status`
- `GET /history` — historical pricing time-series per model, with filters
- `GET /pricing.json` — raw pricing snapshot
- `GET /events.json` — raw events snapshot
- `GET /history.json` — raw historical time-series

See [`public/openapi.yaml`](public/openapi.yaml) for the full spec.

## MCP server

Modelmeter is also a remote [MCP](https://modelcontextprotocol.io) server, so any tool-calling agent (Claude, Hermes, …) can call it natively over the Streamable HTTP transport — no auth, no install:

```
https://modelmeter.xyz/mcp
```

Tools: `estimate_cost`, `get_model`, `list_models`, `get_price_history`, `list_events`. Start with `list_models` to discover ids, then `get_model` or `estimate_cost`. The MCP tools return the same data as the REST endpoints above — use whichever your runtime prefers.

## Datasets

- [`pricing/`](pricing/) — current and historical model pricing across providers
- [`events/`](events/) — the events record (schema 2.0.0): deprecations, price changes, releases, and market events with primary-source citations, verbatim quotes, and verification status

Each entry carries a `last_verified` date. Daily snapshots in `pricing/snapshots/` accumulate the historical record. Wrong pricing is the existential risk — the schema requires explicit human verification before an entry is served.

## Contributing

Found a price change? Open a PR updating [`pricing/current.json`](pricing/current.json) with the new value, an updated `last_verified` date, and the source URL.

Spotted a meaningful AI market event? Add an entry to [`events/current.json`](events/current.json) with primary-source citations and `verified: true`.

Automation opens issues when provider pricing pages change. Pick one up if you want to help.

## License

MIT — see [LICENSE](LICENSE).