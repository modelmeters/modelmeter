// ---------- constants ----------

// Venice referral code — appended as ?ref=<code> on every "run via Venice" link.
const VENICE_REFERRAL = "9conaa";
const VENICE_REF_PARAM = "ref";

// Compute the best Venice deep-link for a model in our catalog.
// - If the model is itself a venice/* entry: deep-link with model param.
// - Otherwise: if any venice/* entry resells this model (upstream_model_id match):
//   deep-link to that one.
// - Otherwise: fall back to venice.ai/chat with just the ref code.
function veniceUrlFor(modelId) {
  const base = "https://venice.ai/chat";
  const refQ = VENICE_REFERRAL
    ? `?${encodeURIComponent(VENICE_REF_PARAM)}=${encodeURIComponent(VENICE_REFERRAL)}`
    : "";
  const sep = refQ ? "&" : "?";
  const model = currentModels.find((m) => m.id === modelId);
  if (!model) return `${base}${refQ}`;
  if (model.provider === "venice") {
    return `${base}${refQ}${sep}model=${encodeURIComponent(model.model)}`;
  }
  const reseller = currentModels.find(
    (m) => m.provider === "venice" && m.upstream_model_id === modelId
  );
  if (reseller) {
    return `${base}${refQ}${sep}model=${encodeURIComponent(reseller.model)}`;
  }
  return `${base}${refQ}`;
}

const PROVIDER_LABELS = {
  openai: "OpenAI", anthropic: "Anthropic", google: "Google", xai: "xAI", venice: "Venice",
  microsoft: "Microsoft", amazon: "Amazon", meta: "Meta", nvidia: "NVIDIA", deepseek: "DeepSeek",
  mistral: "Mistral", cohere: "Cohere", alibaba: "Alibaba", zhipu: "Zhipu", moonshot: "Moonshot",
  spacex: "SpaceX", groq: "Groq", together: "Together", fireworks: "Fireworks", openrouter: "OpenRouter",
  other: "Other",
};
const TYPE_CATEGORY = {
  model_launch: "model", model_deprecation: "model", model_unavailable: "model",
  funding: "money", acquisition: "money", partnership: "money", pricing_change: "money",
  infrastructure: "infra",
  regulatory_action: "regulatory", legal_outcome: "regulatory",
  open_source_release: "oss",
  leadership_change: "other",
};
const CATEGORY_META = {
  model:      { color: "var(--c-model)",      label: "Models",         desc: "launches, deprecations, availability" },
  money:      { color: "var(--c-money)",      label: "Money",          desc: "funding, deals, pricing" },
  infra:      { color: "var(--c-infra)",      label: "Infrastructure", desc: "compute, datacenters, chips" },
  regulatory: { color: "var(--c-regulatory)", label: "Regulatory",     desc: "bans, restrictions, legal" },
  oss:        { color: "var(--c-oss)",        label: "Open source",    desc: "open-weight releases" },
  other:      { color: "var(--c-other)",      label: "Other",          desc: "" },
};
const MAGNITUDE_RADIUS = { minor: 2, moderate: 3, major: 5, structural: 8 };
const TYPE_META = {
  model_unavailable:    { color: "#ff296d", label: "model restricted" },
  model_launch:         { color: "#ffd166", label: "model launch" },
  partnership:  { color: "#5534eb", label: "partnership" },
};
function typeColor(type) {
  return TYPE_META[type]?.color ?? CATEGORY_META[TYPE_CATEGORY[type] ?? "other"].color;
}
function typeLabel(type) {
  return TYPE_META[type]?.label ?? type.replace(/_/g, " ");
}

// ---------- state ----------
let events = [];
let modelsByProvider = {};
let currentModels = [];
let history = null;
let sharedXParams = null; // set by renderAcrossProvidersChart/renderSingleModelChart, read by renderEventSwimlane
const activeSwimlaneCategories = new Set(Object.keys(CATEGORY_META).filter(k => k !== "oss"));
let chartState = {
  model: null,
  range: "all",
  scale: "log",
  cache: false,
  viewMode: "across",          // "across" or "single"
  tier: "flagship",            // "flagship" | "mid" | "fast"
  priceField: "input_cost_per_mtok",
  showDeprecated: true,
};

const ACROSS_PROVIDERS = ["anthropic", "openai", "google", "xai"];


// Ordered generational chains — used to draw dashed connectors between model segments
const MODEL_FAMILIES = {
  "anthropic/opus":    ["anthropic/claude-3-opus","anthropic/claude-opus-3","anthropic/claude-opus-4","anthropic/claude-opus-4-5","anthropic/claude-opus-4-6","anthropic/claude-opus-4-7","anthropic/claude-opus-4-8"],
  "anthropic/sonnet":  ["anthropic/claude-3-sonnet","anthropic/claude-3-5-sonnet","anthropic/claude-3-7-sonnet","anthropic/claude-sonnet-3-7","anthropic/claude-sonnet-4","anthropic/claude-sonnet-4-5","anthropic/claude-sonnet-4-6"],
  "anthropic/haiku":   ["anthropic/claude-3-haiku","anthropic/claude-haiku-3","anthropic/claude-3-5-haiku","anthropic/claude-haiku-3-5","anthropic/claude-haiku-4-5"],
  "openai/gpt-5":      ["openai/gpt-5","openai/gpt-5-2","openai/gpt-5-4","openai/gpt-5-5"],
  "google/gemini-pro": ["google/gemini-1-5-pro","google/gemini-2-5-pro"],
  "google/gemini-flash":["google/gemini-1-5-flash","google/gemini-2-0-flash","google/gemini-2-5-flash","google/gemini-3-flash-preview","google/gemini-3-5-flash"],
  "xai/grok":          ["xai/grok-beta","xai/grok-2","xai/grok-3","xai/grok-4","xai/grok-4-3"],
};
const PROVIDER_COLORS = {
  anthropic: "#ff8a65",
  openai:    "#74aa9c",
  google:    "#7eb8ff",
  xai:       "#e8e6e0",
  venice:    "#c084fc",
  deepseek:  "#a3e635",
  mistral:   "#fb923c",
  cohere:    "#f472b6",
  together:  "#fbbf24",
  groq:      "#22d3ee",
  openrouter:"#94a3b8",
};

// ---------- boot ----------
async function boot() {
  await Promise.allSettled([
    loadEvents(),
    loadModels(),
    loadHistory(),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("status-text").textContent = `live · ${today}`;
  document.getElementById("stats-date").textContent = today;
  renderTicker();
  renderPriceTicker();
  renderStats();
  renderPrivacyPremium();
  renderCalculator();
  renderEventsFeed();
  renderChartControls();
  renderChart();
  window.addEventListener("resize", () => { renderChart(); });
}

async function loadEvents() {
  const res = await fetch("/events.json");
  const body = await res.json();
  events = (body.events || []).filter(e => e.date);
}

async function loadModels() {
  const res = await fetch("/models");
  const data = await res.json();
  currentModels = data.models || [];
  for (const m of currentModels) (modelsByProvider[m.provider] ||= []).push(m);
}

async function loadHistory() {
  try {
    const res = await fetch("/history.json");
    if (!res.ok) { history = null; return; }
    history = await res.json();
  } catch { history = null; }
}

// ---------- ticker ----------
function renderTicker() {
  const track = document.getElementById("ticker-track");
  if (events.length === 0) { track.innerHTML = '<span class="ticker-item">no events yet</span>'; return; }
  const recent = [...events].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20);
  const items = recent.map(ev => {
    const url = ev.source_urls?.[0] || "#";
    const date = ev.date;
    return `<span class="ticker-item">
      <span class="tick-date">${date}</span>
      <span class="tick-cat" style="color:${typeColor(ev.type)}">${typeLabel(ev.type).toUpperCase()}</span>
      <a href="${url}" target="_blank" rel="noopener">${escapeHtml(ev.headline)}</a>
    </span>`;
  });
  // Duplicate to allow seamless loop
  track.innerHTML = items.join('') + items.join('');
}

// ---------- price ticker ----------
function renderPriceTicker() {
  const track = document.getElementById("price-ticker-track");
  if (!history?.models?.length) { track.innerHTML = '<span class="ticker-item">no price history yet</span>'; return; }

  // Find models with a price change between their last two snapshots
  const changes = [];
  for (const m of history.models) {
    const h = m.history.filter(e => e.input_cost_per_mtok != null);
    if (h.length < 2) continue;
    const prev = h[h.length - 2];
    const curr = h[h.length - 1];
    if (prev.input_cost_per_mtok === curr.input_cost_per_mtok) continue;
    const dir = curr.input_cost_per_mtok < prev.input_cost_per_mtok ? "↓" : "↑";
    const color = dir === "↓" ? "var(--down)" : "var(--up)";
    changes.push({ m, prev, curr, dir, color, date: curr.date });
  }

  const source = changes.length > 0
    ? [...changes].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40)
    : null;

  const items = source
    ? source.map(({ m, prev, curr, dir, color, date }) =>
        `<span class="ticker-item">
          <span class="tick-date">${date}</span>
          <span style="color:${color}">${dir}</span>
          <span>${escapeHtml(m.display_name)}</span>
          <span style="color:var(--muted)">$${prev.input_cost_per_mtok} → <span style="color:${color}">$${curr.input_cost_per_mtok}</span>/Mtok in</span>
        </span>`)
    : history.models.slice(0, 40).map(m => {
        const last = m.history.filter(e => e.input_cost_per_mtok != null).slice(-1)[0];
        if (!last) return '';
        return `<span class="ticker-item">
          <span>${escapeHtml(m.display_name)}</span>
          <span style="color:var(--muted)">$${last.input_cost_per_mtok}/Mtok in</span>
        </span>`;
      }).filter(Boolean);

  track.innerHTML = items.join('') + items.join('');
}

// ---------- stats ----------
function renderStats() {
  document.getElementById("s-models").textContent = currentModels.length || "—";
  document.getElementById("s-events").textContent = events.length || "—";
  const providers = new Set(currentModels.map(m => m.provider));
  document.getElementById("s-providers").textContent = providers.size || "—";
  document.getElementById("s-snapshots").textContent = history?.snapshot_count ?? "—";
  document.getElementById("s-history").textContent = history?.model_count ?? "—";
}

function shorten(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

// ---------- Privacy Premium gauge ----------
// ---------- Privacy Premium (Venice vs direct flagship) ----------
function computePrivacyPremium() {
  const rows = [];
  for (const provider of ACROSS_PROVIDERS) {
    const active = currentModels.filter(m =>
      m.provider === provider &&
      m.input_cost_per_mtok != null &&
      m.availability !== "deprecated"
    );
    if (active.length === 0) continue;
    active.sort((a, b) => b.input_cost_per_mtok - a.input_cost_per_mtok);
    const flagship = active[0];
    const veniceModel = currentModels.find(m =>
      m.provider === "venice" &&
      m.upstream_model_id === flagship.id &&
      m.input_cost_per_mtok != null
    );
    const markup_pct = veniceModel
      ? (((veniceModel.input_cost_per_mtok + (veniceModel.output_cost_per_mtok ?? 0)) /
          (flagship.input_cost_per_mtok + (flagship.output_cost_per_mtok ?? 0))) - 1) * 100
      : null;
    rows.push({ provider, flagship, veniceModel, markup_pct });
  }
  const valid = rows.filter(r => r.markup_pct != null);
  const avg = valid.length > 0 ? valid.reduce((s, r) => s + r.markup_pct, 0) / valid.length : null;
  return { avg, rows };
}

function renderPrivacyPremium() {
  const avgEl = document.getElementById("privacy-avg");
  const listEl = document.getElementById("privacy-pairs");
  if (!avgEl || !listEl) return;
  const { avg, rows } = computePrivacyPremium();
  avgEl.textContent = avg != null ? `+${Math.round(avg)}% AVG` : "—";
  listEl.innerHTML = rows.map(r => {
    const color = PROVIDER_COLORS[r.provider] || "#ffffff";
    const provName = PROVIDER_LABELS[r.provider] || r.provider;
    const modelShort = shorten(r.flagship.display_name, 20);
    const dash = `<span class="pp-prov-dash" style="background:${color}" title="${escapeHtml(provName)}"></span>`;
    if (!r.veniceModel) {
      return `<div class="pp-row pp-na">
        ${dash}
        <span class="pp-model" title="${escapeHtml(r.flagship.display_name)}">${escapeHtml(modelShort)}</span>
        <span class="pp-pct" style="color:var(--muted-2)">—</span>
        <span></span>
      </div>`;
    }
    const veniceUrl = veniceUrlFor(r.flagship.id);
    return `<div class="pp-row">
      ${dash}
      <span class="pp-model" title="${escapeHtml(r.flagship.display_name)}">${escapeHtml(modelShort)}</span>
      <span class="pp-pct">+${Math.round(r.markup_pct)}%</span>
      <a href="${veniceUrl}" target="_blank" rel="noopener" class="pp-run" title="$${r.flagship.input_cost_per_mtok} direct → $${r.veniceModel.input_cost_per_mtok} via Venice">→</a>
    </div>`;
  }).join("");
}

// ---------- calculator ----------
function renderCalculator() {
  const sel = document.getElementById("calc-model");
  const calcBtn = document.getElementById("calc-btn");
  sel.innerHTML = "";
  const order = ["anthropic", "openai", "google", "xai", "venice"];
  for (const p of order) {
    if (!modelsByProvider[p]) continue;
    const g = document.createElement("optgroup");
    g.label = PROVIDER_LABELS[p] || p;
    for (const m of modelsByProvider[p].sort((a, b) => a.display_name.localeCompare(b.display_name))) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.display_name} · $${m.input_cost_per_mtok}/$${m.output_cost_per_mtok}`;
      g.appendChild(opt);
    }
    sel.appendChild(g);
  }
  sel.disabled = false;
  calcBtn.disabled = false;
  // Default to claude-sonnet-4-6 if present
  const def = currentModels.find(m => m.id === "anthropic/claude-sonnet-4-6") || currentModels[0];
  if (def) sel.value = def.id;
  sel.addEventListener("change", () => {
    chartState.model = sel.value;
    renderChart();
    renderEventsFeed();
  });
  calcBtn.addEventListener("click", calculate);
  document.getElementById("calc-input").addEventListener("keydown", e => { if (e.key === "Enter") calculate(); });
  document.getElementById("calc-output").addEventListener("keydown", e => { if (e.key === "Enter") calculate(); });
}

async function calculate() {
  const model = document.getElementById("calc-model").value;
  const input = document.getElementById("calc-input").value;
  const output = document.getElementById("calc-output").value;
  if (!model) return;
  const url = `/estimate?model=${encodeURIComponent(model)}&input=${input}&output=${output}`;
  const result = document.getElementById("calc-result");
  result.className = "show";
  result.textContent = "calculating…";
  try {
    const res = await fetch(url);
    const body = await res.json();
    if (res.status !== 200) {
      result.className = "show error";
      result.innerHTML = `<strong>error:</strong> ${escapeHtml(body.error?.message ?? "request failed")}`;
      return;
    }
    renderCalcResult(body, url);
  } catch {
    result.className = "show error";
    result.textContent = "request failed";
  }
}

function renderCalcResult(r, callUrl) {
  let html = `<div class="total-line">$${r.total_cost_usd.toFixed(6)}</div>`;
  html += `<div class="calc-breakdown">`;
  html += `<div>${r.input_tokens.toLocaleString()} in × $${r.rates_per_mtok.input}/Mtok</div><div class="v">$${r.input_cost_usd.toFixed(6)}</div>`;
  html += `<div>${r.output_tokens.toLocaleString()} out × $${r.rates_per_mtok.output}/Mtok</div><div class="v">$${r.output_cost_usd.toFixed(6)}</div>`;
  html += `</div>`;
  if (r.tier_applied) html += `<div style="color: var(--warn); font-size: 11px; margin-top: 4px;">(overage tier rates applied)</div>`;
  if (r.upstream?.total_cost_usd != null) {
    const direction = r.upstream.markup_percent > 0 ? "above" : "below";
    const abs = Math.abs(r.upstream.markup_percent);
    html += `<div class="calc-up-block">vs <strong>${escapeHtml(r.upstream.display_name)}</strong> direct: $${r.upstream.total_cost_usd.toFixed(6)} · <span class="pct">${abs.toFixed(1)}% ${direction}</span></div>`;
  }
  const veniceUrl = veniceUrlFor(r.model);
  html += `<div class="calc-cta">
    <a href="${veniceUrl}" target="_blank" rel="noopener" class="cta-link">run privately w/ Venice →</a>
  </div>`;
  html += `<div class="try-json">json: <a href="${callUrl}" target="_blank">${escapeHtml(callUrl)}</a></div>`;
  document.getElementById("calc-result").innerHTML = html;
}

// ---------- events feed (right column) ----------
function renderEventsFeed() {
  const wrap = document.getElementById("events-feed");
  const ctxLabel = document.getElementById("feed-context");
  const modelId = chartState.model || document.getElementById("calc-model")?.value;
  const model = currentModels.find(m => m.id === modelId);
  let filtered = events;
  if (model) {
    filtered = events.filter(e =>
      (e.providers || []).includes(model.provider) ||
      (e.models || []).includes(model.id)
    );
    ctxLabel.textContent = PROVIDER_LABELS[model.provider] || model.provider;
  } else {
    ctxLabel.textContent = "all providers";
  }
  filtered = [...filtered].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  if (filtered.length === 0) { wrap.innerHTML = '<div style="color: var(--muted); font-size: 11px;">no events for this model</div>'; return; }
  wrap.innerHTML = filtered.map(ev => {
    const url = ev.source_urls?.[0] || "#";
    return `<div class="ev-item" onclick="window.open('${url}', '_blank', 'noopener')">
      <div class="ev-date">${ev.date} · <span style="color: ${typeColor(ev.type)}">${typeLabel(ev.type)}</span></div>
      <div class="ev-headline">${escapeHtml(ev.headline)}</div>
    </div>`;
  }).join("");
}

// ---------- chart ----------
function renderChartControls() {
  const sel = document.getElementById("chart-model");
  sel.innerHTML = "";
  if (!history) {
    sel.innerHTML = '<option>no history yet</option>';
    sel.disabled = true;
    return;
  }
  // Build options grouped by provider, sorted by history length descending
  const byProvider = {};
  for (const m of history.models) (byProvider[m.provider] ||= []).push(m);
  const order = ["anthropic", "openai", "google", "xai", "venice"];
  for (const p of order) {
    if (!byProvider[p]) continue;
    const g = document.createElement("optgroup");
    g.label = PROVIDER_LABELS[p] || p;
    const sorted = byProvider[p].sort((a, b) => b.history.length - a.history.length);
    for (const m of sorted) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.display_name} (${m.history.length})`;
      g.appendChild(opt);
    }
    sel.appendChild(g);
  }
  // Pick default: model with most history overall
  const best = [...history.models].sort((a, b) => b.history.length - a.history.length)[0];
  if (best) { sel.value = best.id; chartState.model = best.id; }
  sel.disabled = false;
  sel.addEventListener("change", () => { chartState.model = sel.value; renderChart(); renderEventsFeed(); });

  document.querySelectorAll("#chart-range .chip").forEach(c => {
    c.addEventListener("click", () => {
      chartState.range = c.dataset.range;
      document.querySelectorAll("#chart-range .chip").forEach(x => x.classList.toggle("active", x === c));
      renderChart();
    });
  });
  document.querySelectorAll("#chart-scale .chip").forEach(c => {
    c.addEventListener("click", () => {
      chartState.scale = c.dataset.scale;
      document.querySelectorAll("#chart-scale .chip").forEach(x => x.classList.toggle("active", x === c));
      renderChart();
    });
  });
  document.querySelectorAll("#chart-cache .chip").forEach(c => {
    c.addEventListener("click", () => {
      chartState.cache = c.dataset.cache === "on";
      document.querySelectorAll("#chart-cache .chip").forEach(x => x.classList.toggle("active", x === c));
      renderChart();
    });
  });
  document.querySelectorAll("#chart-deprecated .chip").forEach(c => {
    c.addEventListener("click", () => {
      chartState.showDeprecated = c.dataset.deprecated === "all";
      document.querySelectorAll("#chart-deprecated .chip").forEach(x => x.classList.toggle("active", x === c));
      // Auto-zoom to 12mo when switching to active-only so recent models are visible
      if (!chartState.showDeprecated && chartState.range === "all") {
        chartState.range = "12";
        document.querySelectorAll("#chart-range .chip").forEach(x => x.classList.toggle("active", x.dataset.range === "12"));
      }
      renderChart();
    });
  });
  document.querySelectorAll("#chart-mode .chip").forEach(c => {
    c.addEventListener("click", () => {
      chartState.viewMode = c.dataset.mode;
      document.querySelectorAll("#chart-mode .chip").forEach(x => x.classList.toggle("active", x === c));
      applyChartControlVisibility();
      renderChart();
      renderEventsFeed();
    });
  });
  document.querySelectorAll("#chart-tier .chip").forEach(c => {
    c.addEventListener("click", () => {
      chartState.tier = c.dataset.tier;
      document.querySelectorAll("#chart-tier .chip").forEach(x => x.classList.toggle("active", x === c));
      renderChart();
    });
  });
  document.querySelectorAll("#chart-price .chip").forEach(c => {
    c.addEventListener("click", () => {
      chartState.priceField = c.dataset.price;
      document.querySelectorAll("#chart-price .chip").forEach(x => x.classList.toggle("active", x === c));
      renderChart();
    });
  });
  applyChartControlVisibility();
}

function applyChartControlVisibility() {
  const mode = chartState.viewMode;
  const isAcross = mode === "across";
  const isSingle = mode === "single";
  const set = (id, vis) => { const el = document.getElementById(id); if (el) el.style.display = vis; };
  set("chart-tier", "none");
  set("chart-price", isAcross ? "" : "none");
  set("chart-model", isSingle ? "" : "none");
  set("chart-cache", isSingle ? "" : "none");
  set("chart-scale", "");
}

function renderChart() {
  if (chartState.viewMode === "across") renderAcrossProvidersChart();
  else renderSingleModelChart();
  renderEventSwimlane();
}

// ---------- across-providers chart ----------
function renderAcrossProvidersChart() {
  const empty = document.getElementById("chart-empty");
  const svg = document.getElementById("chart-svg");
  const legend = document.getElementById("chart-legend");
  legend.innerHTML = "";

  if (!history) {
    empty.style.display = "flex";
    empty.innerHTML = '<span class="loader">⟳</span> waiting for historical pricing data…';
    svg.style.display = "none";
    return;
  }

  const priceField = chartState.priceField;
  const currentById = Object.fromEntries(currentModels.map(m => [m.id, m]));

  // Collect all models for the 4 providers, with metadata
  const today = new Date().toISOString().slice(0, 10);
  const allModelLines = [];
  for (const provider of ACROSS_PROVIDERS) {
    const provModels = history.models.filter(m => m.provider === provider);
    const historyIds = new Set(provModels.map(m => m.id));

    for (const m of provModels) {
      const series = m.history
        .filter(h => h[priceField] != null && h[priceField] > 0)
        .sort((a, b) => a.date.localeCompare(b.date));
      const cur = currentById[m.id];
      const isDeprecated = !cur || cur.availability === "deprecated";
      // Inject current price as synthetic today-point for active models
      if (!isDeprecated && cur[priceField] != null && cur[priceField] > 0) {
        const last = series[series.length - 1];
        if (!last || last.date < today) series.push({ date: today, [priceField]: cur[priceField] });
        else if (last.date === today) series[series.length - 1] = { ...last, [priceField]: cur[priceField] };
      }
      if (series.length === 0) continue;
      allModelLines.push({ m, provider, series, isDeprecated });
    }

    // Also include active models from current.json that have no history entry yet
    for (const cur of currentModels) {
      if (cur.provider !== provider) continue;
      if (historyIds.has(cur.id)) continue;
      if (cur.availability === "deprecated") continue;
      const price = cur[priceField];
      if (price == null || price <= 0) continue;
      const syntheticM = { id: cur.id, display_name: cur.display_name || cur.id, history: [] };
      allModelLines.push({ m: syntheticM, provider, series: [{ date: today, [priceField]: price }], isDeprecated: false });
    }
  }
  if (allModelLines.length === 0) {
    empty.style.display = "flex";
    empty.innerHTML = "no historical data";
    svg.style.display = "none";
    return;
  }

  // Range filter: keep models with any data in range; include last-before-cutoff as anchor
  let cutoff = null;
  if (chartState.range !== "all") {
    const months = parseInt(chartState.range, 10);
    cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months);
  }
  const visibleLines = [];
  for (const ml of allModelLines) {
    if (!cutoff) { visibleLines.push({ ...ml, visible: ml.series }); continue; }
    const after = ml.series.filter(h => new Date(h.date) >= cutoff);
    const before = ml.series.filter(h => new Date(h.date) < cutoff);
    const anchor = before.length > 0 ? [before[before.length - 1]] : [];
    const visible = [...anchor, ...after];
    if (visible.length > 0) visibleLines.push({ ...ml, visible });
  }
  if (visibleLines.length === 0) {
    empty.style.display = "flex";
    empty.innerHTML = "no data in range";
    svg.style.display = "none";
    return;
  }

  // Filter deprecated if toggle is set to active-only
  const displayLines = chartState.showDeprecated ? visibleLines : visibleLines.filter(ml => !ml.isDeprecated);

  empty.style.display = "none";
  svg.style.display = "block";
  svg.innerHTML = "";

  const width = svg.clientWidth || 800;
  const height = 420;
  const padLeft = 60, padRight = 24, padTop = 24, padBottom = 40;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  // Global date + price range across all visible series
  const allDates = displayLines.flatMap(ml => ml.visible.map(h => new Date(h.date)));
  const allPrices = displayLines.flatMap(ml => ml.visible.map(h => h[priceField]));
  const minDate = cutoff ? new Date(cutoff) : new Date(Math.min(...allDates));
  const maxDate = new Date(Math.max(...allDates, Date.now()));
  const xScale = d => padLeft + ((new Date(d) - minDate) / Math.max(1, maxDate - minDate)) * (width - padLeft - padRight);
  sharedXParams = { minDate, maxDate, xScale, width, padLeft, padRight, padTop, padBottom };

  const positive = allPrices.filter(v => v > 0);
  let yMin = Math.min(...positive) * 0.6;
  let yMax = Math.max(...positive) * 1.4;
  if (chartState.scale !== "log") { yMin = 0; yMax = Math.max(...positive) * 1.15; }
  const yScale = v => {
    if (chartState.scale === "log") {
      if (v <= 0) return height - padBottom;
      const logMin = Math.log10(yMin || 0.001), logMax = Math.log10(yMax);
      return padTop + (1 - (Math.log10(v) - logMin) / (logMax - logMin)) * (height - padTop - padBottom);
    }
    return padTop + (1 - v / yMax) * (height - padTop - padBottom);
  };

  const ns = "http://www.w3.org/2000/svg";

  // Y-axis grid + labels
  for (let i = 0; i <= 5; i++) {
    let v;
    if (chartState.scale === "log") {
      const lm = Math.log10(yMin || 0.001), lM = Math.log10(yMax);
      v = Math.pow(10, lm + (i / 5) * (lM - lm));
    } else { v = (yMax / 5) * i; }
    const y = yScale(v);
    const gl = document.createElementNS(ns, "line");
    gl.setAttribute("x1", padLeft); gl.setAttribute("x2", width - padRight);
    gl.setAttribute("y1", y); gl.setAttribute("y2", y);
    gl.setAttribute("class", "grid-line");
    svg.appendChild(gl);
    const lbl = document.createElementNS(ns, "text");
    lbl.setAttribute("x", padLeft - 8); lbl.setAttribute("y", y + 3);
    lbl.setAttribute("text-anchor", "end"); lbl.setAttribute("class", "grid-label");
    lbl.setAttribute("fill", "#ece9e0");
    lbl.textContent = `$${v < 1 ? v.toFixed(3) : v.toFixed(v < 10 ? 2 : 0)}`;
    svg.appendChild(lbl);
  }

  // X-axis labels (quarterly) — uppercase month, year only at January
  const cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  while (cur <= maxDate) {
    if (cur.getMonth() % 3 === 0) {
      const x = xScale(cur);
      const gl = document.createElementNS(ns, "line");
      gl.setAttribute("x1", x); gl.setAttribute("x2", x);
      gl.setAttribute("y1", padTop); gl.setAttribute("y2", height - padBottom);
      gl.setAttribute("class", "grid-line"); svg.appendChild(gl);
      const lbl = document.createElementNS(ns, "text");
      lbl.setAttribute("x", x); lbl.setAttribute("y", height - padBottom + 14);
      lbl.setAttribute("text-anchor", "middle"); lbl.setAttribute("class", "grid-label");
      lbl.setAttribute("fill", "#ece9e0");
      const mo = cur.toLocaleString("en", { month: "short" }).toUpperCase();
      lbl.textContent = cur.getMonth() === 0 ? `${mo} '${String(cur.getFullYear()).slice(-2)}` : mo;
      svg.appendChild(lbl);
    }
    cur.setMonth(cur.getMonth() + 1);
  }

  for (const ml of displayLines) {
    const { provider, visible, isDeprecated } = ml;
    const color = PROVIDER_COLORS[provider] || "#ffffff";
    const strokeWidth = 1;

    // Opacity: full for all active models, dimmed for deprecated
    const opacity = isDeprecated ? 0.2 : 1;

    // Step-function path
    let d = "";
    for (let i = 0; i < visible.length; i++) {
      const x = xScale(visible[i].date);
      const y = yScale(visible[i][priceField]);
      if (i === 0) d += `M ${x} ${y}`;
      else { const py = yScale(visible[i-1][priceField]); d += ` L ${x} ${py} L ${x} ${y}`; }
    }
    // Active lines terminate at today via synthetic current-price point

    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", String(strokeWidth));
    path.setAttribute("opacity", String(opacity));
    svg.appendChild(path);

    // Dots at price-change points
    const r = 3.5;
    for (const pt of visible) {
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", String(xScale(pt.date)));
      c.setAttribute("cy", String(yScale(pt[priceField])));
      c.setAttribute("r", String(r));
      c.setAttribute("fill", color);
      c.setAttribute("opacity", String(opacity));
      c.setAttribute("stroke", "var(--panel)");
      c.setAttribute("stroke-width", "0.5");
      c.setAttribute("style", "cursor: pointer");
      attachProviderPointTooltip(c, provider, { date: pt.date, price: pt[priceField], display_name: ml.m.display_name });
      svg.appendChild(c);
    }
  }

  // Family connectors: dashed step between consecutive model generations
  for (const [familyKey, memberIds] of Object.entries(MODEL_FAMILIES)) {
    const provider = familyKey.split("/")[0];
    const color = PROVIDER_COLORS[provider] || "#ffffff";
    for (let i = 0; i < memberIds.length - 1; i++) {
      const mlA = displayLines.find(ml => ml.m.id === memberIds[i]);
      const mlB = displayLines.find(ml => ml.m.id === memberIds[i + 1]);
      if (!mlA || !mlB) continue;
      const lastPt = mlA.visible[mlA.visible.length - 1];
      const firstPt = mlB.visible[0];
      if (!lastPt || !firstPt) continue;
      const x1 = xScale(lastPt.date), y1 = yScale(lastPt[priceField]);
      const x2 = xScale(firstPt.date), y2 = yScale(firstPt[priceField]);
      const conn = document.createElementNS(ns, "path");
      conn.setAttribute("d", `M ${x1} ${y1} L ${x2} ${y1} L ${x2} ${y2}`);
      conn.setAttribute("fill", "none");
      conn.setAttribute("stroke", color);
      conn.setAttribute("stroke-width", "0.75");
      conn.setAttribute("stroke-dasharray", "4,4");
      conn.setAttribute("opacity", "0.35");
      svg.appendChild(conn);
    }
  }

  // Crosshair line
  const crosshair = document.createElementNS(ns, "line");
  crosshair.setAttribute("id", "chart-crosshair");
  crosshair.setAttribute("x1", "-1"); crosshair.setAttribute("x2", "-1");
  crosshair.setAttribute("y1", String(padTop)); crosshair.setAttribute("y2", String(height - padBottom));
  crosshair.setAttribute("class", "chart-crosshair");
  crosshair.style.display = "none";
  svg.appendChild(crosshair);

  // Legend: provider color swatches + flagship model names
  const priceLabel = priceField === "input_cost_per_mtok" ? "input" : "output";
  const totalShown = displayLines.length;
  const activeCount = displayLines.filter(ml => !ml.isDeprecated).length;
  let legendHtml = "";
  for (const p of ACROSS_PROVIDERS) {
    if (!displayLines.some(ml => ml.provider === p)) continue;
    const color = PROVIDER_COLORS[p] || "#ffffff";
    legendHtml += `<span><span class="swatch line" style="background:${color}"></span>${PROVIDER_LABELS[p] || p}</span>`;
  }
  legendHtml += `<span style="color: var(--muted-2);">${activeCount} active · ${totalShown - activeCount} deprecated · ${priceLabel}</span>`;
  legendHtml += `<span style="margin-left: auto;"><a href="/history.json" target="_blank" rel="noopener" style="color: var(--text-dim); font-size: 11px;">try as json ↗</a></span>`;
  legend.innerHTML = legendHtml;
}


// renderIndexChart removed — replaced by Option D two-panel layout (price chart + event swimlane)

function attachProviderPointTooltip(el, provider, pt) {
  const tooltip = document.getElementById("chart-tooltip");
  el.addEventListener("mouseenter", e => {
    const priceLabel = chartState.priceField === "input_cost_per_mtok" ? "input" : "output";
    tooltip.innerHTML = `
      <div class="tdate">${pt.date} · ${PROVIDER_LABELS[provider] || provider}</div>
      <div class="thead">${escapeHtml(pt.display_name)}</div>
      <div class="tbody">${priceLabel}: $${pt.price.toFixed(pt.price < 1 ? 4 : 2)} / Mtok</div>
    `;
    positionTooltip(tooltip, e);
    tooltip.classList.add("show");
  });
  el.addEventListener("mousemove", e => positionTooltip(tooltip, e));
  el.addEventListener("mouseleave", () => tooltip.classList.remove("show"));
}

function renderSingleModelChart() {
  const empty = document.getElementById("chart-empty");
  const svg = document.getElementById("chart-svg");
  const legend = document.getElementById("chart-legend");
  legend.innerHTML = "";

  if (!history || !chartState.model) {
    empty.style.display = "flex";
    svg.style.display = "none";
    return;
  }
  const model = history.models.find(m => m.id === chartState.model);
  if (!model || model.history.length === 0) {
    empty.style.display = "flex";
    empty.innerHTML = "no history available for this model";
    svg.style.display = "none";
    return;
  }

  empty.style.display = "none";
  svg.style.display = "block";
  svg.innerHTML = "";

  // Compute time range
  let series = model.history.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (chartState.range !== "all") {
    const months = parseInt(chartState.range, 10);
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months);
    series = series.filter(h => new Date(h.date) >= cutoff);
    if (series.length === 0) { empty.style.display = "flex"; empty.innerHTML = `no data in last ${months} months`; svg.style.display = "none"; return; }
  }

  const width = svg.clientWidth || 800;
  const height = 420;
  const padLeft = 60, padRight = 24, padTop = 24, padBottom = 40;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const dates = series.map(h => new Date(h.date));
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates, Date.now()));
  const xScale = d => padLeft + ((new Date(d) - minDate) / Math.max(1, maxDate - minDate)) * (width - padLeft - padRight);
  sharedXParams = { minDate, maxDate, xScale, width, padLeft, padRight, padTop, padBottom: 40 };

  // Collect y values for scale
  const yVals = [];
  for (const h of series) {
    if (h.input_cost_per_mtok != null) yVals.push(h.input_cost_per_mtok);
    if (h.output_cost_per_mtok != null) yVals.push(h.output_cost_per_mtok);
    if (chartState.cache) {
      if (h.cache_read_cost_per_mtok != null) yVals.push(h.cache_read_cost_per_mtok);
      if (h.cache_write_cost_per_mtok != null) yVals.push(h.cache_write_cost_per_mtok);
    }
  }
  if (yVals.length === 0) { empty.style.display = "flex"; empty.innerHTML = "no numeric pricing in selected range"; svg.style.display = "none"; return; }
  let yMin = 0, yMax = Math.max(...yVals);
  if (chartState.scale === "log") {
    const positive = yVals.filter(v => v > 0);
    yMin = Math.min(...positive) * 0.6;
    yMax = Math.max(...positive) * 1.4;
  } else {
    yMax = yMax * 1.15;
  }
  const yScale = v => {
    if (chartState.scale === "log") {
      if (v <= 0) return height - padBottom;
      const logMin = Math.log10(yMin || 0.001);
      const logMax = Math.log10(yMax);
      const logV = Math.log10(v);
      return padTop + (1 - (logV - logMin) / (logMax - logMin)) * (height - padTop - padBottom);
    }
    return padTop + (1 - v / yMax) * (height - padTop - padBottom);
  };

  const ns = "http://www.w3.org/2000/svg";

  // Y-axis grid + labels
  const yTickCount = 5;
  for (let i = 0; i <= yTickCount; i++) {
    let v;
    if (chartState.scale === "log") {
      const lm = Math.log10(yMin || 0.001), lM = Math.log10(yMax);
      v = Math.pow(10, lm + (i / yTickCount) * (lM - lm));
    } else {
      v = (yMax / yTickCount) * i;
    }
    const y = yScale(v);
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", padLeft); line.setAttribute("x2", width - padRight);
    line.setAttribute("y1", y); line.setAttribute("y2", y);
    line.setAttribute("class", "grid-line");
    svg.appendChild(line);
    const lbl = document.createElementNS(ns, "text");
    lbl.setAttribute("x", padLeft - 8); lbl.setAttribute("y", y + 3);
    lbl.setAttribute("text-anchor", "end");
    lbl.setAttribute("class", "grid-label");
    lbl.setAttribute("fill", "#ece9e0");
    lbl.textContent = `$${v < 1 ? v.toFixed(3) : v.toFixed(v < 10 ? 2 : 0)}`;
    svg.appendChild(lbl);
  }

  // X-axis labels (quarterly)
  const months = [];
  const cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  while (cursor <= maxDate) {
    if (cursor.getMonth() % 3 === 0) {
      months.push(new Date(cursor));
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  for (const m of months) {
    const x = xScale(m);
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", x); line.setAttribute("x2", x);
    line.setAttribute("y1", padTop); line.setAttribute("y2", height - padBottom);
    line.setAttribute("class", "grid-line");
    svg.appendChild(line);
    const lbl = document.createElementNS(ns, "text");
    lbl.setAttribute("x", x); lbl.setAttribute("y", height - padBottom + 14);
    lbl.setAttribute("text-anchor", "middle");
    lbl.setAttribute("class", "grid-label");
    lbl.setAttribute("fill", "#ece9e0");
    const monthName = m.toLocaleString("en", { month: "short" });
    lbl.textContent = `${monthName} '${String(m.getFullYear()).slice(-2)}`;
    svg.appendChild(lbl);
  }

  // Step-function lines for input/output (and cache if enabled)
  function pathFor(key, color, dash) {
    const points = series.filter(h => h[key] != null);
    if (points.length === 0) return;
    let d = "";
    for (let i = 0; i < points.length; i++) {
      const x = xScale(points[i].date);
      const y = yScale(points[i][key]);
      if (i === 0) d += `M ${x} ${y}`;
      else {
        const prevY = yScale(points[i - 1][key]);
        d += ` L ${x} ${prevY} L ${x} ${y}`;
      }
    }
    // Extend the line to today
    const lastX = xScale(maxDate);
    const lastY = yScale(points[points.length - 1][key]);
    d += ` L ${lastX} ${lastY}`;
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", "2");
    if (dash) path.setAttribute("stroke-dasharray", dash);
    svg.appendChild(path);
    // Dots at each data point
    for (const p of points) {
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", xScale(p.date));
      c.setAttribute("cy", yScale(p[key]));
      c.setAttribute("r", "3");
      c.setAttribute("fill", color);
      c.setAttribute("stroke", "var(--panel)");
      c.setAttribute("stroke-width", "1");
      svg.appendChild(c);
    }
  }

  pathFor("input_cost_per_mtok", "var(--c-infra)");
  pathFor("output_cost_per_mtok", "var(--down)");
  if (chartState.cache) {
    pathFor("cache_read_cost_per_mtok", "var(--c-money)", "4,3");
    pathFor("cache_write_cost_per_mtok", "var(--warn)", "4,3");
  }

  // Crosshair line
  const crosshairNs = "http://www.w3.org/2000/svg";
  const crosshairEl = document.createElementNS(crosshairNs, "line");
  crosshairEl.setAttribute("id", "chart-crosshair");
  crosshairEl.setAttribute("x1", "-1"); crosshairEl.setAttribute("x2", "-1");
  crosshairEl.setAttribute("y1", String(padTop)); crosshairEl.setAttribute("y2", String(height - padBottom));
  crosshairEl.setAttribute("class", "chart-crosshair");
  crosshairEl.style.display = "none";
  svg.appendChild(crosshairEl);

  // Legend
  legend.innerHTML = `
    <span><span class="swatch line" style="background: var(--c-infra)"></span>input</span>
    <span><span class="swatch line" style="background: var(--down)"></span>output</span>
    ${chartState.cache ? `<span><span class="swatch line" style="background: var(--c-money); border-top: 2px dashed var(--c-money); background: transparent;"></span>cache read</span>
    <span><span class="swatch line" style="background: var(--warn); border-top: 2px dashed var(--warn); background: transparent;"></span>cache write</span>` : ''}
    <span style="color: var(--muted-2);">${series.length} data points</span>
  `;
}

function showChartCrosshair(x) {
  const line = document.getElementById("chart-crosshair");
  if (!line) return;
  line.setAttribute("x1", String(x));
  line.setAttribute("x2", String(x));
  line.style.display = "";
}
function hideChartCrosshair() {
  const line = document.getElementById("chart-crosshair");
  if (line) line.style.display = "none";
}

// ---------- event swimlane ----------
function renderEventSwimlane() {
  const swimSvg = document.getElementById("swimlane-svg");
  const swimTooltip = document.getElementById("swimlane-tooltip");
  const catLegend = document.getElementById("swimlane-cat-legend");
  if (!swimSvg) return;

  if (!sharedXParams || events.length === 0) {
    swimSvg.setAttribute("viewBox", "0 0 100 20");
    swimSvg.setAttribute("height", "20");
    if (catLegend) catLegend.innerHTML = "";
    return;
  }

  const { minDate, maxDate, xScale, width, padLeft, padRight } = sharedXParams;

  // Determine lane providers
  let laneProviders;
  if (chartState.viewMode === "single" && chartState.model) {
    const m = history?.models?.find(m => m.id === chartState.model);
    laneProviders = m ? [m.provider] : ACROSS_PROVIDERS.slice();
  } else {
    laneProviders = ACROSS_PROVIDERS.filter(p => events.some(e => (e.providers || []).includes(p)));
  }

  const slPadLeft = padLeft, slPadRight = padRight, slPadTop = 6, slPadBottom = 4;
  const laneH = 22;
  const height = slPadTop + laneProviders.length * laneH + slPadBottom;
  swimSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  swimSvg.setAttribute("height", String(height));
  swimSvg.innerHTML = "";

  const ns = "http://www.w3.org/2000/svg";

  // Lane backgrounds + labels
  laneProviders.forEach((p, i) => {
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", String(slPadLeft));
    rect.setAttribute("y", String(slPadTop + i * laneH));
    rect.setAttribute("width", String(width - slPadLeft - slPadRight));
    rect.setAttribute("height", String(laneH));
    rect.setAttribute("fill", i % 2 === 0 ? "var(--panel-2)" : "var(--panel-3)");
    swimSvg.appendChild(rect);

    const lbl = document.createElementNS(ns, "text");
    lbl.setAttribute("x", String(slPadLeft - 6));
    lbl.setAttribute("y", String(slPadTop + i * laneH + laneH / 2 + 4));
    lbl.setAttribute("text-anchor", "end");
    lbl.setAttribute("class", "sl-label");
    lbl.textContent = PROVIDER_LABELS[p] || p;
    swimSvg.appendChild(lbl);
  });

  // Swimlane crosshair line (shown on hover)
  const slCrosshair = document.createElementNS(ns, "line");
  slCrosshair.setAttribute("id", "swimlane-crosshair");
  slCrosshair.setAttribute("x1", "-1"); slCrosshair.setAttribute("x2", "-1");
  slCrosshair.setAttribute("y1", String(slPadTop)); slCrosshair.setAttribute("y2", String(height - slPadBottom));
  slCrosshair.setAttribute("class", "sl-crosshair");
  slCrosshair.style.display = "none";
  swimSvg.appendChild(slCrosshair);

  // Event dots
  for (const ev of events) {
    const evDate = new Date(ev.date);
    if (evDate < minDate || evDate > maxDate) continue;

    const x = xScale(evDate);
    const r = Math.max(3, MAGNITUDE_RADIUS[ev.impact?.magnitude] ?? 3);
    const color = typeColor(ev.type);
    const cat = TYPE_CATEGORY[ev.type] || "other";
    const isDimmed = !activeSwimlaneCategories.has(cat);

    const affectedProviders = laneProviders.filter(p => (ev.providers || []).includes(p));
    for (const p of affectedProviders) {
      const laneIdx = laneProviders.indexOf(p);
      const cy = slPadTop + laneIdx * laneH + laneH / 2;

      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", String(x));
      c.setAttribute("cy", String(cy));
      c.setAttribute("r", String(r));
      c.setAttribute("fill", color);
      c.setAttribute("fill-opacity", "0.8");
      c.setAttribute("stroke", "var(--panel)");
      c.setAttribute("stroke-width", "1");
      c.setAttribute("class", `sl-event${isDimmed ? " dimmed" : ""}`);

      c.addEventListener("mouseenter", e => {
        // Show crosshair in both panels
        showChartCrosshair(x);
        const sl = document.getElementById("swimlane-crosshair");
        if (sl) { sl.setAttribute("x1", String(x)); sl.setAttribute("x2", String(x)); sl.style.display = ""; }
        swimTooltip.innerHTML = `
          <div class="tdate">${ev.date} · ${(ev.providers || []).map(q => PROVIDER_LABELS[q] || q).join(", ")}</div>
          <div class="thead">${escapeHtml(ev.headline)}</div>
          <div class="tbody">${escapeHtml(ev.summary || "")}</div>
          <div class="tfoot"><span style="color: ${color}">${typeLabel(ev.type)}</span><span>click to open ↗</span></div>
        `;
        positionTooltip(swimTooltip, e, true);
        swimTooltip.classList.add("show");
      });
      c.addEventListener("mousemove", e => positionTooltip(swimTooltip, e, true));
      c.addEventListener("mouseleave", () => {
        hideChartCrosshair();
        const sl = document.getElementById("swimlane-crosshair");
        if (sl) sl.style.display = "none";
        swimTooltip.classList.remove("show");
      });
      c.addEventListener("click", () => {
        if (ev.source_urls?.[0]) window.open(ev.source_urls[0], "_blank", "noopener");
      });

      swimSvg.appendChild(c);
    }
  }

  // Category filter legend
  if (catLegend) {
    catLegend.innerHTML = Object.entries(CATEGORY_META).filter(([key]) => key !== "oss").map(([key, meta]) =>
      `<span class="sl-cat${activeSwimlaneCategories.has(key) ? "" : " dimmed"}" data-cat="${key}">
        <span class="swatch" style="background:${meta.color}"></span>${meta.label}
      </span>`
    ).join("");
    catLegend.querySelectorAll(".sl-cat").forEach(el => {
      el.addEventListener("click", () => {
        const key = el.dataset.cat;
        if (activeSwimlaneCategories.has(key)) {
          if (activeSwimlaneCategories.size > 1) activeSwimlaneCategories.delete(key);
        } else {
          activeSwimlaneCategories.add(key);
        }
        renderEventSwimlane();
      });
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}

boot();
