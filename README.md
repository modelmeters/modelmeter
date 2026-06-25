# Modelmeter

Agent-first measurement and instrumentation for AI models. Live at [modelmeter.xyz](https://modelmeter.xyz).

## What this is

A growing toolkit of small, sharply-scoped utilities — cost calculators, context-window checks, latency aggregators — designed primarily for AI agents to call programmatically, and secondarily for humans to use through a dashboard. The wedge: clean GET URLs, stable JSON contracts, an OpenAPI spec, and an `llms.txt` discoverability file. Most calculator sites are JS-heavy SPAs that agents can't use; Modelmeter is built the other way around.

## V1: LLM cost calculator

Three providers (OpenAI, Anthropic, Venice), current models only. Static site on Cloudflare Pages, Cloudflare Worker for the JSON API, pricing data as versioned JSON in this repo.

## Pricing data

Pricing lives in [pricing/current.json](pricing/current.json). Each entry has a `last_verified` date and `source_url`. Daily snapshots are committed to `pricing/snapshots/YYYY-MM-DD.json` so the historical dataset compounds from day one.

**Never trust pricing data without checking `last_verified`.** Providers change prices; this repo is best-effort and depends on community PRs.

## Contributing

Found a price change? Open a PR updating [pricing/current.json](pricing/current.json) with:
- New value
- Updated `last_verified` date
- Updated `source_url` if needed

Daily automation opens issues when provider pricing pages change. Pick one up if you want to help.

## License

MIT — see [LICENSE](LICENSE).