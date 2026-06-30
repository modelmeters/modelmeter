// Remote MCP server for Modelmeter.
// Stateless JSON-RPC 2.0 over the MCP Streamable HTTP transport, hosted as a
// Cloudflare Pages Function at /mcp. Tools-only, so no session/SSE machinery is
// needed: clients POST a JSON-RPC message (or batch) and get a JSON response.
//
// Wraps the same data + helpers the REST endpoints use, computing directly
// rather than making internal HTTP round-trips. /swap is intentionally NOT
// exposed until the quality gate lands (see .private/QUALITY_LAYER_PLAN.md).

import { PRICING, EVENTS, findModel, effectiveRates, round } from "./_lib.js";
import { buildModelCard } from "./model.js";
import history from "../pricing/history.json";

const DEFAULT_PROTOCOL = "2025-06-18";
const SUPPORTED_PROTOCOLS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);
const SERVER_INFO = { name: "modelmeter", version: "0.1.0" };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, authorization",
  "access-control-max-age": "86400",
};

// ---------- tool definitions ----------
const TOOLS = [
  {
    name: "estimate_cost",
    description:
      "Estimate the USD cost of an LLM API call for a given model and token counts. " +
      "Returns input/output/total cost, plus reseller markup vs. the upstream model when applicable.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "Model id in provider/model form, e.g. anthropic/claude-opus-4-8. Use list_models to discover ids." },
        input_tokens: { type: "integer", minimum: 0, description: "Number of input (prompt) tokens." },
        output_tokens: { type: "integer", minimum: 0, description: "Number of output (completion) tokens." },
      },
      required: ["model", "input_tokens", "output_tokens"],
    },
  },
  {
    name: "get_model",
    description:
      "Unified card for one model in a single call: normalized pricing, capabilities (context window, " +
      "vision, reasoning, tags), availability, reseller markup vs. upstream, and a price-history summary " +
      "(launch vs. current price, percent change, last change date, all-time low/high).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Model id in provider/model form, e.g. openai/gpt-5-5." },
      },
      required: ["id"],
    },
  },
  {
    name: "list_models",
    description: "List available models with their current pricing. Optionally filter by provider.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "Provider id, e.g. anthropic, openai, google, venice, openrouter." },
        include_unavailable: { type: "boolean", description: "Include deprecated/restricted/unavailable models. Default false." },
        limit: { type: "integer", minimum: 1, maximum: 1000, description: "Max rows to return. Default 200." },
      },
    },
  },
  {
    name: "get_price_history",
    description: "Historical pricing time-series for a model or provider. Each point is a dated snapshot of the per-Mtok rates.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "Model id to fetch history for." },
        provider: { type: "string", description: "Provider id to fetch history for (all its models)." },
        since: { type: "string", description: "ISO date (YYYY-MM-DD); only points on/after this date." },
        until: { type: "string", description: "ISO date (YYYY-MM-DD); only points on/before this date." },
      },
    },
  },
  {
    name: "list_events",
    description:
      "AI market events — model launches, deprecations, regulatory actions, compute partnerships. " +
      "Useful for explaining why a price changed. Optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "Filter to events touching this provider." },
        type: { type: "string", description: "Event type, e.g. model_launch, model_unavailable, price_change." },
        since: { type: "string", description: "ISO date (YYYY-MM-DD); events on/after." },
        until: { type: "string", description: "ISO date (YYYY-MM-DD); events on/before." },
        limit: { type: "integer", minimum: 1, maximum: 500, description: "Max events. Default 50." },
      },
    },
  },
];

// ---------- tool implementations ----------
// Each returns a plain object; the caller wraps it as MCP content.
// Throw an Error to produce an isError tool result.

function toolEstimateCost(args) {
  const { model: id, input_tokens: inputTokens, output_tokens: outputTokens } = args;
  if (typeof id !== "string") throw new Error("`model` is required.");
  if (!Number.isInteger(inputTokens) || inputTokens < 0) throw new Error("`input_tokens` must be a non-negative integer.");
  if (!Number.isInteger(outputTokens) || outputTokens < 0) throw new Error("`output_tokens` must be a non-negative integer.");

  const model = findModel(id);
  if (!model) throw new Error(`Model not found: ${id}. Use list_models to see available ids.`);
  if (model.verification_required) throw new Error(`Model ${id} has unverified pricing and is not served.`);
  if (model.input_cost_per_mtok == null || model.output_cost_per_mtok == null) {
    throw new Error(`Model ${id} has incomplete pricing in the dataset.`);
  }

  const rates = effectiveRates(model, inputTokens);
  const inputCost = (inputTokens / 1_000_000) * rates.input;
  const outputCost = (outputTokens / 1_000_000) * rates.output;
  const totalCost = inputCost + outputCost;

  const result = {
    model: id,
    display_name: model.display_name,
    provider: model.provider,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    rates_per_mtok: { input: rates.input, output: rates.output },
    input_cost_usd: round(inputCost),
    output_cost_usd: round(outputCost),
    total_cost_usd: round(totalCost),
    pricing_date: model.last_verified,
    source_url: model.source_url,
  };

  if (model.upstream_model_id) {
    const up = findModel(model.upstream_model_id);
    if (up && !up.verification_required && up.input_cost_per_mtok != null && up.output_cost_per_mtok != null) {
      const upRates = effectiveRates(up, inputTokens);
      const upTotal = (inputTokens / 1_000_000) * upRates.input + (outputTokens / 1_000_000) * upRates.output;
      result.upstream = {
        model: up.id,
        display_name: up.display_name,
        provider: up.provider,
        total_cost_usd: round(upTotal),
        markup_usd: round(totalCost - upTotal),
        markup_percent: upTotal > 0 ? round(((totalCost / upTotal) - 1) * 100, 2) : null,
      };
    }
  }
  return result;
}

function toolGetModel(args) {
  const id = args?.id;
  if (typeof id !== "string") throw new Error("`id` is required.");
  const model = findModel(id);
  if (!model) throw new Error(`Model not found: ${id}. Use list_models to see available ids.`);
  return {
    schema_version: PRICING.schema_version,
    snapshot_date: PRICING.snapshot_date,
    model: buildModelCard(model, history.models),
  };
}

function toolListModels(args = {}) {
  const provider = args.provider;
  const includeUnavailable = args.include_unavailable === true;
  const limit = Number.isInteger(args.limit) ? Math.max(1, Math.min(1000, args.limit)) : 200;

  let models = PRICING.models.filter((m) => !m.verification_required && m.input_cost_per_mtok != null);
  if (provider) models = models.filter((m) => m.provider === provider);
  if (!includeUnavailable) models = models.filter((m) => !m.availability || m.availability === "available");

  const rows = models.slice(0, limit).map((m) => ({
    id: m.id,
    provider: m.provider,
    display_name: m.display_name,
    input_cost_per_mtok: m.input_cost_per_mtok,
    output_cost_per_mtok: m.output_cost_per_mtok,
    context_window: m.context_window ?? null,
    tags: m.tags ?? [],
    last_verified: m.last_verified,
  }));
  return { snapshot_date: PRICING.snapshot_date, count: rows.length, total_available: models.length, models: rows };
}

function toolGetPriceHistory(args = {}) {
  const { model: modelFilter, provider, since, until } = args;
  if (!modelFilter && !provider) throw new Error("Provide `model` or `provider` to scope the history.");
  let models = history.models;
  if (provider) models = models.filter((m) => m.provider === provider);
  if (modelFilter) models = models.filter((m) => m.id === modelFilter);
  if (since || until) {
    models = models
      .map((m) => ({ ...m, history: m.history.filter((h) => (!since || h.date >= since) && (!until || h.date <= until)) }))
      .filter((m) => m.history.length > 0);
  }
  return { generated_at: history.generated_at, count: models.length, models };
}

function toolListEvents(args = {}) {
  const { provider, type, since, until } = args;
  const limit = Number.isInteger(args.limit) ? Math.max(1, Math.min(500, args.limit)) : 50;
  let evs = EVENTS.events.filter((e) => e.verified === true);
  if (provider) evs = evs.filter((e) => Array.isArray(e.providers) && e.providers.includes(provider));
  if (type) evs = evs.filter((e) => e.type === type);
  if (since) evs = evs.filter((e) => e.date >= since);
  if (until) evs = evs.filter((e) => e.date <= until);
  evs = evs.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
  return { snapshot_date: EVENTS.snapshot_date, count: evs.length, events: evs };
}

const TOOL_IMPL = {
  estimate_cost: toolEstimateCost,
  get_model: toolGetModel,
  list_models: toolListModels,
  get_price_history: toolGetPriceHistory,
  list_events: toolListEvents,
};

// ---------- JSON-RPC plumbing ----------
function rpcResult(id, result) { return { jsonrpc: "2.0", id, result }; }
function rpcError(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }

function handleMessage(msg, env) {
  // Notifications have no id and expect no response.
  const isNotification = msg == null || msg.id === undefined || msg.id === null;
  const { id, method, params } = msg || {};

  if (method === "initialize") {
    const requested = params?.protocolVersion;
    const protocolVersion = SUPPORTED_PROTOCOLS.has(requested) ? requested : DEFAULT_PROTOCOL;
    return rpcResult(id, {
      protocolVersion,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
      instructions:
        "Modelmeter: agent-callable LLM pricing, model cards, price history, and market events. " +
        "Start with list_models to discover ids, then get_model or estimate_cost.",
    });
  }

  if (isNotification) return null; // e.g. notifications/initialized — ack with no body
  if (method === "ping") return rpcResult(id, {});
  if (method === "tools/list") return rpcResult(id, { tools: TOOLS });

  if (method === "tools/call") {
    const name = params?.name;
    const impl = TOOL_IMPL[name];
    if (!impl) return rpcError(id, -32602, `Unknown tool: ${name}`);
    try {
      const data = impl(params?.arguments ?? {});
      return rpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
        isError: false,
      });
    } catch (err) {
      // Tool-level errors are reported in-band so the model can react.
      return rpcResult(id, { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true });
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

export const onRequestPost = async ({ request, env }) => {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify(rpcError(null, -32700, "Parse error: invalid JSON")), {
      status: 400, headers: { "content-type": "application/json", ...CORS },
    });
  }

  const messages = Array.isArray(body) ? body : [body];
  const responses = messages.map((m) => handleMessage(m, env)).filter((r) => r !== null);

  // All-notifications batch → 202 Accepted, no body.
  if (responses.length === 0) {
    return new Response(null, { status: 202, headers: CORS });
  }

  const payload = Array.isArray(body) ? responses : responses[0];
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
};

// This server doesn't offer a server→client SSE stream, so GET is not supported.
export const onRequestGet = async () => {
  return new Response(JSON.stringify(rpcError(null, -32000, "This MCP endpoint only supports POST (Streamable HTTP).")), {
    status: 405, headers: { "content-type": "application/json", "allow": "POST, OPTIONS", ...CORS },
  });
};

export const onRequestOptions = async () => new Response(null, { status: 204, headers: CORS });