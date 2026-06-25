# Next Steps — Modelmeter

What's done and what's left to take the scaffold from "files on disk" to "live at modelmeter.xyz."

## Status

- [x] Repo scaffold (README, LICENSE, schema, workflows, OpenAPI, llms.txt)
- [x] Pricing JSON shape and validation discipline (verification_required gates)
- [x] Daily snapshot + change-detection GitHub Actions
- [ ] GitHub repo created and code pushed
- [ ] First prices manually verified for at least one provider
- [ ] Cloudflare Pages connected, domain pointed
- [ ] Cloudflare Worker built (`/estimate`, `/models`, `/pricing.json`)
- [ ] Landing page (real, not the placeholder)
- [ ] OpenRouter affiliate signup
- [ ] First post / announcement

## Step 1 — Create the GitHub repo (5 min)

```bash
cd /Users/kirk/projects/modelmeter
gh repo create modelmeters/modelmeter --public --source . --remote origin --description "Agent-first measurement and instrumentation for AI models"
git add .
git commit -m "scaffold: initial repo structure, pricing schema, workflows"
git push -u origin main
```

After push, update the GitHub URLs hardcoded in:
- [README.md](README.md)
- [public/llms.txt](public/llms.txt)
- [public/openapi.yaml](public/openapi.yaml)
- [wrangler.toml](wrangler.toml)

(If `modelmeters/modelmeter` is right, skip — these are already pointed there.)

## Step 2 — Verify first prices manually (15–30 min)

This is the only step that gets the calculator producing real numbers. Recommended order: start with Anthropic (simplest pricing page), then OpenAI, then Venice.

For each model:

1. Open the `source_url` in [pricing/current.json](pricing/current.json)
2. Find the model row on the page
3. Update these fields:
   - `input_cost_per_mtok` — USD per 1M input tokens
   - `output_cost_per_mtok` — USD per 1M output tokens
   - `cache_write_cost_per_mtok` / `cache_read_cost_per_mtok` — if applicable
   - `context_window` — verify it
   - `max_output_tokens` — if listed
4. Set `last_verified` to today's date (YYYY-MM-DD)
5. Set `verification_required` to `false`
6. Commit with message like `pricing: verify anthropic/claude-sonnet-4-6`

The Venice entries currently have placeholder IDs (`venice/model-1` etc.) — replace these with real model identifiers from venice.ai/pricing.

## Step 3 — Connect Cloudflare Pages (10 min)

1. Sign in to Cloudflare (or sign up — free)
2. Workers & Pages → Create application → Pages → Connect to Git
3. Select the `modelmeters/modelmeter` repo
4. Build settings:
   - Build command: *(leave empty)*
   - Build output directory: `public`
   - Root directory: `/`
5. Deploy
6. Custom domains → Set up custom domain → `modelmeter.xyz`
7. Follow DNS instructions (Cloudflare handles this if the domain is registered with them; otherwise update nameservers at your registrar)

After deploy, `modelmeter.xyz/llms.txt` and `modelmeter.xyz/openapi.yaml` should be live.

## Step 4 — Build the Worker (next session with Claude)

The `/estimate`, `/models`, and `/pricing.json` endpoints need a Cloudflare Worker. This is the next coding session — straightforward but takes an hour. Worker:

- Loads `pricing/current.json` (either fetched from GitHub raw URL or bundled at build)
- Routes:
  - `GET /pricing.json` — returns the whole file
  - `GET /models` — returns the array of models with `verification_required: false`
  - `GET /estimate?model=X&input=N&output=M` — does the math, returns JSON
- Rejects requests for models with `verification_required: true` with a 404 and an explanatory message
- Includes basic per-IP rate limiting
- Logs to Cloudflare Analytics Engine (the substitution-pattern dataset starts here)

## Step 5 — Real landing page (next session)

Replace the placeholder in [public/index.html](public/index.html) with:
- Calculator UI (the human-facing version of `/estimate`)
- Comparison table across providers
- Copy that explains the agent-first angle without being too inside-baseball
- "Try it as JSON" toggle that shows the equivalent API URL

## Step 6 — OpenRouter affiliate signup (5 min, do anytime)

1. Sign up at openrouter.ai
2. Find their referral / affiliate program in account settings
3. Save your referral code somewhere — it'll get wired into "try this model" CTAs once those exist

## Step 7 — Soft launch (after Steps 1–6 are done)

- Post on X with `modelmeter.xyz` link, OpenAPI URL, llms.txt URL
- Submit to Hacker News ("Show HN: Modelmeter — LLM pricing for agents, JSON-first")
- Post in relevant Discord/Slack communities (agent builders, AI infra)

Don't over-polish before this — getting one real user is more valuable than five more design tweaks.

## Later — Mac Mini intelligence layer (not pricing!)

Once the Mini is set up and the V1 pipeline is humming on GitHub Actions:

- Hermes agent on the Mini, role = "AI announcements monitor"
- Watches HN, X, provider changelogs, Reddit for new model launches and pricing rumors
- Posts daily digest to Discord/email
- Does NOT write to `pricing/current.json` — that stays human-reviewed via PRs

Treat this as a follow-on project. Don't block V1 launch on it.

## Open questions to resolve as you go

- **GitHub org name:** UXYZ LLC org or personal?
- **Email for bot commits:** `bot@modelmeter.xyz` is hardcoded in `snapshot.yml` — works fine, no SPF needed for commit signing.
- **Issue labels:** the change-detection script adds `pricing-change` label; create it in the repo (or remove from script if you'd rather not).
- **Schema version bumps:** if pricing JSON shape changes, bump `schema_version` and document in pricing/README.md.