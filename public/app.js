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
  funding: "money", acquisition: "money", compute_partnership: "money", pricing_change: "money",
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
const MAGNITUDE_RADIUS = { minor: 4, moderate: 6, major: 9, structural: 12 };

// ---------- state ----------
let events = [];
let modelsByProvider = {};
let currentModels = [];
let history = null;
const activeCategories = new Set(Object.keys(CATEGORY_META));
let chartState = {
  model: null,
  range: "all",
  scale: "log",
  cache: false,
  viewMode: "across",          // "across" or "single"
  tier: "flagship",            // "flagship" | "mid" | "cheap"
  priceField: "input_cost_per_mtok",
};

const ACROSS_PROVIDERS = ["anthropic", "openai", "google", "xai"];
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
  const results = await Promise.allSettled([
    loadEvents(),
    loadModels(),
    loadHistory(),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById("status-text").textContent = `live · ${today}`;
  document.getElementById("stats-date").textContent = today;
  renderTicker();
  renderStats();
  renderPrivacyGauge();
  // renderMarkupSpread(); // folded into the gauge as dots
  renderCalculator();
//       renderTimelineControls();
//       renderTimelineLegend();
//       renderTimeline();
  renderEventsFeed();
  renderChartControls();
  renderChart();
  window.addEventListener("resize", () => { renderChart(); renderPrivacyGauge(); });
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
    const cat = TYPE_CATEGORY[ev.type] || "other";
    const color = CATEGORY_META[cat].color;
    const url = ev.source_urls?.[0] || "#";
    const date = ev.date;
    return `<span class="ticker-item">
      <span class="tick-date">${date}</span>
      <span class="tick-cat" style="color:${color}">${ev.type.replace(/_/g," ").toUpperCase()}</span>
      <a href="${url}" target="_blank" rel="noopener">${escapeHtml(ev.headline)}</a>
    </span>`;
  });
  // Duplicate to allow seamless loop
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

// ---------- markup spread ----------
function renderMarkupSpread() {
  const wrap = document.getElementById("markup-list");
  const reseller = currentModels.filter(m => m.upstream_model_id);
  const direct = Object.fromEntries(currentModels.map(m => [m.id, m]));
  const rows = [];
  for (const r of reseller) {
    const u = direct[r.upstream_model_id];
    if (!u || u.input_cost_per_mtok == null) continue;
    const rIn = r.input_cost_per_mtok, rOut = r.output_cost_per_mtok;
    const uIn = u.input_cost_per_mtok, uOut = u.output_cost_per_mtok;
    if (uIn === 0 || uOut === 0) continue;
    // Average markup using a 1:1 input:output ratio for ranking
    const markupPct = (((rIn + rOut) / (uIn + uOut)) - 1) * 100;
    rows.push({ id: r.id, name: r.display_name, pct: markupPct });
  }
  rows.sort((a, b) => b.pct - a.pct);
  const top = rows.slice(0, 6);
  if (top.length === 0) { wrap.innerHTML = '<div style="color: var(--muted); font-size: 11px;">no markups computed</div>'; return; }
  wrap.innerHTML = top.map(r => `
    <div class="markup-item">
      <span class="m-name" title="${escapeHtml(r.name)}">${escapeHtml(shorten(r.name, 28))}</span>
      <span class="m-pct ${r.pct >= 15 ? 'm-up' : ''}">+${r.pct.toFixed(1)}%</span>
    </div>
  `).join("");
}

function shorten(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

// ---------- Privacy Premium gauge ----------
function computePrivacyPremium() {
  const direct = Object.fromEntries(currentModels.map(m => [m.id, m]));
  const pairs = [];
  for (const m of currentModels) {
    if (!m.upstream_model_id) continue;
    const u = direct[m.upstream_model_id];
    if (!u || u.input_cost_per_mtok == null || u.output_cost_per_mtok == null) continue;
    if (m.input_cost_per_mtok == null || m.output_cost_per_mtok == null) continue;
    const uSum = u.input_cost_per_mtok + u.output_cost_per_mtok;
    if (uSum <= 0) continue;
    const rSum = m.input_cost_per_mtok + m.output_cost_per_mtok;
    pairs.push({
      reseller_id: m.id,
      reseller_name: m.display_name,
      upstream_id: u.id,
      upstream_name: u.display_name,
      provider: m.provider,
      markup_pct: ((rSum / uSum) - 1) * 100,
    });
  }
  if (pairs.length === 0) return { pct: null, count: 0, min: null, max: null, pairs: [] };
  const markups = pairs.map(p => p.markup_pct);
  const avg = markups.reduce((a, b) => a + b, 0) / markups.length;
  return {
    pct: avg,
    count: pairs.length,
    min: Math.min(...markups),
    max: Math.max(...markups),
    pairs,
  };
}

function renderPrivacyGauge() {
  const data = computePrivacyPremium();
  const valueEl = document.getElementById("gauge-value");
  const deltaEl = document.getElementById("gauge-delta");
  const metaEl = document.getElementById("gauge-meta");
  const svg = document.getElementById("gauge-svg");
  if (data.pct == null) {
    valueEl.textContent = "—";
    deltaEl.textContent = "no reseller pairs found";
    metaEl.textContent = "verify upstream_model_id links";
    svg.innerHTML = "";
    return;
  }
  valueEl.textContent = `+${data.pct.toFixed(1)}%`;
  deltaEl.textContent = `avg over direct`;
  metaEl.innerHTML = `${data.count} reseller↔direct pairs<br>range ${data.min.toFixed(1)}% to ${data.max.toFixed(1)}%`;

  const width = svg.clientWidth || 600;
  const height = 70;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = "";
  const ns = "http://www.w3.org/2000/svg";

  const padX = 18;
  const barY = 18;
  const barH = 2;
  const max = 50;
  const inner = width - 2 * padX;
  const xFor = v => padX + (Math.min(Math.max(v, 0), max) / max) * inner;

  // Background bar
  const bg = document.createElementNS(ns, "rect");
  bg.setAttribute("x", padX); bg.setAttribute("y", barY);
  bg.setAttribute("width", inner); bg.setAttribute("height", barH);
  bg.setAttribute("class", "bar-bg");
  svg.appendChild(bg);

  // Filled portion up to current value
  const fillWidth = xFor(data.pct) - padX;
  const fill = document.createElementNS(ns, "rect");
  fill.setAttribute("x", padX); fill.setAttribute("y", barY);
  fill.setAttribute("width", fillWidth); fill.setAttribute("height", barH);
  fill.setAttribute("class", data.pct > max ? "bar-overflow" : "bar-fill");
  fill.setAttribute("opacity", "1");
  svg.appendChild(fill);

  // Tick marks every 10%
  for (let v = 0; v <= max; v += 10) {
    const x = xFor(v);
    const t = document.createElementNS(ns, "line");
    t.setAttribute("x1", x); t.setAttribute("x2", x);
    t.setAttribute("y1", barY + barH + 1); t.setAttribute("y2", barY + barH + 5);
    t.setAttribute("class", "tick");
    svg.appendChild(t);
    const lbl = document.createElementNS(ns, "text");
    lbl.setAttribute("x", x); lbl.setAttribute("y", barY + barH + 17);
    lbl.setAttribute("text-anchor", "middle"); lbl.setAttribute("class", "tick-label");
    lbl.textContent = `${v}%`;
    svg.appendChild(lbl);
  }

  // Needle (vertical line through bar)
  const nx = xFor(data.pct);
  const needle = document.createElementNS(ns, "line");
  needle.setAttribute("x1", nx); needle.setAttribute("x2", nx);
  needle.setAttribute("y1", barY - 6); needle.setAttribute("y2", barY + barH + 6);
  needle.setAttribute("class", "needle");
  svg.appendChild(needle);

  // Needle cap (small triangle marker)
  const cap = document.createElementNS(ns, "polygon");
  cap.setAttribute("points", `${nx},${barY - 8} ${nx + 5},${barY - 14} ${nx - 5},${barY - 14}`);
  cap.setAttribute("class", "needle-cap");
  svg.appendChild(cap);

  // Individual reseller pair dots along the bar, color-coded by provider
  const barCenterY = barY + barH / 2;
  for (const pair of data.pairs) {
    const dotX = xFor(pair.markup_pct);
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", dotX);
    dot.setAttribute("cy", barCenterY);
    dot.setAttribute("r", "4");
    dot.setAttribute("fill", PROVIDER_COLORS[pair.provider] || "#ffffff");
    dot.setAttribute("fill-opacity", "0.7");
    dot.setAttribute("stroke", "var(--bg)");
    dot.setAttribute("stroke-width", "1");
    dot.setAttribute("style", "cursor: pointer");
    attachGaugePairTooltip(dot, pair);
    svg.appendChild(dot);
  }
}

function attachGaugePairTooltip(el, pair) {
  const tooltip = document.getElementById("gauge-tooltip");
  if (!tooltip) return;
  el.addEventListener("mouseenter", e => {
    tooltip.innerHTML = `
      <div class="tdate">${PROVIDER_LABELS[pair.provider] || pair.provider} · markup</div>
      <div class="thead">${escapeHtml(pair.reseller_name)}</div>
      <div class="tbody">+${pair.markup_pct.toFixed(1)}% over ${escapeHtml(pair.upstream_name)}</div>
    `;
    positionTooltip(tooltip, e);
    tooltip.classList.add("show");
  });
  el.addEventListener("mousemove", e => positionTooltip(tooltip, e));
  el.addEventListener("mouseleave", () => tooltip.classList.remove("show"));
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
    <a href="${veniceUrl}" target="_blank" rel="noopener" class="cta-link">run via Venice →</a>
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
    ctxLabel.textContent = `${model.display_name}`;
  } else {
    ctxLabel.textContent = "all providers";
  }
  filtered = [...filtered].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  if (filtered.length === 0) { wrap.innerHTML = '<div style="color: var(--muted); font-size: 11px;">no events for this model</div>'; return; }
  wrap.innerHTML = filtered.map(ev => {
    const cat = TYPE_CATEGORY[ev.type] || "other";
    const color = CATEGORY_META[cat].color;
    const url = ev.source_urls?.[0] || "#";
    return `<div class="ev-item" onclick="window.open('${url}', '_blank', 'noopener')">
      <div class="ev-date">${ev.date} · <span style="color: ${color}">${ev.type.replace(/_/g, " ")}</span></div>
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
  const isAcross = chartState.viewMode === "across";
  const set = (id, vis) => { const el = document.getElementById(id); if (el) el.style.display = vis; };
  set("chart-tier", isAcross ? "" : "none");
  set("chart-price", isAcross ? "" : "none");
  set("chart-model", isAcross ? "none" : "");
  set("chart-cache", isAcross ? "none" : "");
}

function renderChart() {
  if (chartState.viewMode === "across") {
    renderAcrossProvidersChart();
  } else {
    renderSingleModelChart();
  }
}

// ---------- across-providers chart ----------
function buildTierSeries(provider, tier, priceField) {
  const providerModels = history.models.filter(m => m.provider === provider);
  if (providerModels.length === 0) return [];

  // Collect all unique dates from this provider's history
  const allDates = new Set();
  for (const m of providerModels) for (const h of m.history) allDates.add(h.date);
  const sortedDates = [...allDates].sort();

  const raw = [];
  for (const date of sortedDates) {
    const active = [];
    for (const m of providerModels) {
      const entries = m.history.filter(h => h.date <= date && h[priceField] != null);
      if (entries.length === 0) continue;
      const latest = entries[entries.length - 1];
      active.push({ price: latest[priceField], model_id: m.id, display_name: m.display_name });
    }
    if (active.length === 0) continue;
    // Sort by output cost is more discriminating; if priceField is input, sort by it
    active.sort((a, b) => b.price - a.price);
    let chosen;
    if (tier === "flagship") chosen = active[0];
    else if (tier === "cheap") chosen = active[active.length - 1];
    else { // mid
      if (active.length < 3) continue;
      chosen = active[Math.floor(active.length / 2)];
    }
    raw.push({ date, price: chosen.price, model_id: chosen.model_id, display_name: chosen.display_name });
  }
  // Dedupe consecutive points where chosen model + price unchanged
  const compressed = [];
  for (const p of raw) {
    const prev = compressed[compressed.length - 1];
    if (!prev || prev.model_id !== p.model_id || prev.price !== p.price) compressed.push(p);
  }
  return compressed;
}

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

  const allSeries = {};
  for (const p of ACROSS_PROVIDERS) {
    const s = buildTierSeries(p, chartState.tier, chartState.priceField);
    if (s.length > 0) allSeries[p] = s;
  }
  const providers = Object.keys(allSeries);
  if (providers.length === 0) {
    empty.style.display = "flex";
    empty.innerHTML = "no historical data for direct providers in this tier";
    svg.style.display = "none";
    return;
  }

  // Apply range filter
  let cutoff = null;
  if (chartState.range !== "all") {
    const months = parseInt(chartState.range, 10);
    cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months);
  }
  const filtered = {};
  for (const p of providers) {
    filtered[p] = cutoff ? allSeries[p].filter(pt => new Date(pt.date) >= cutoff) : allSeries[p];
  }
  const visibleProviders = providers.filter(p => filtered[p].length > 0);
  if (visibleProviders.length === 0) {
    empty.style.display = "flex";
    empty.innerHTML = `no data in last ${chartState.range} months`;
    svg.style.display = "none";
    return;
  }

  empty.style.display = "none";
  svg.style.display = "block";
  svg.innerHTML = "";

  const width = svg.clientWidth || 800;
  const height = 380;
  const padLeft = 60, padRight = 24, padTop = 24, padBottom = 40;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  // Compute global date and price range
  const allDates = [];
  const allPrices = [];
  for (const p of visibleProviders) {
    for (const pt of filtered[p]) {
      allDates.push(new Date(pt.date));
      allPrices.push(pt.price);
    }
  }
  const minDate = new Date(Math.min(...allDates));
  const maxDate = new Date(Math.max(...allDates, Date.now()));
  const xScale = d => padLeft + ((new Date(d) - minDate) / Math.max(1, maxDate - minDate)) * (width - padLeft - padRight);

  let yMin = 0, yMax = Math.max(...allPrices);
  if (chartState.scale === "log") {
    const positive = allPrices.filter(v => v > 0);
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
    if (cursor.getMonth() % 3 === 0) months.push(new Date(cursor));
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

  // Event markers — show events affecting any visible provider
  const relevantEvents = events.filter(e => {
    const evProviders = e.providers || [];
    return visibleProviders.some(p => evProviders.includes(p));
  });
  for (const ev of relevantEvents) {
    const evDate = new Date(ev.date);
    if (evDate < minDate || evDate > maxDate) continue;
    const x = xScale(evDate);
    const cat = TYPE_CATEGORY[ev.type] || "other";
    const color = CATEGORY_META[cat].color;
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", x); line.setAttribute("x2", x);
    line.setAttribute("y1", padTop); line.setAttribute("y2", height - padBottom);
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "1");
    line.setAttribute("stroke-dasharray", "3,3");
    line.setAttribute("opacity", "0.4");
    svg.appendChild(line);
    const r = 5;
    const diamond = document.createElementNS(ns, "polygon");
    diamond.setAttribute("points", `${x},${padTop-r} ${x+r},${padTop} ${x},${padTop+r} ${x-r},${padTop}`);
    diamond.setAttribute("fill", color);
    diamond.setAttribute("stroke", "var(--panel)");
    diamond.setAttribute("stroke-width", "1");
    diamond.setAttribute("style", "cursor: pointer");
    attachEventTooltip(diamond, ev);
    svg.appendChild(diamond);
  }

  // Per-provider step-function lines
  for (const p of visibleProviders) {
    const points = filtered[p];
    const color = PROVIDER_COLORS[p] || "#ffffff";
    let d = "";
    for (let i = 0; i < points.length; i++) {
      const x = xScale(points[i].date);
      const y = yScale(points[i].price);
      if (i === 0) d += `M ${x} ${y}`;
      else {
        const prevY = yScale(points[i - 1].price);
        d += ` L ${x} ${prevY} L ${x} ${y}`;
      }
    }
    // Extend to today
    const lastX = xScale(maxDate);
    const lastY = yScale(points[points.length - 1].price);
    d += ` L ${lastX} ${lastY}`;
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", color);
    path.setAttribute("stroke-width", "2");
    svg.appendChild(path);
    // Dots at each transition
    for (const pt of points) {
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("cx", xScale(pt.date));
      c.setAttribute("cy", yScale(pt.price));
      c.setAttribute("r", "3");
      c.setAttribute("fill", color);
      c.setAttribute("stroke", "var(--panel)");
      c.setAttribute("stroke-width", "1");
      c.setAttribute("style", "cursor: pointer");
      attachProviderPointTooltip(c, p, pt);
      svg.appendChild(c);
    }
  }

  // Legend with provider swatches + JSON link
  const tierLabel = chartState.tier === "flagship" ? "flagship" : chartState.tier === "cheap" ? "cheap/fast" : "mid-tier";
  const priceLabel = chartState.priceField === "input_cost_per_mtok" ? "input" : "output";
  let legendHtml = "";
  for (const p of visibleProviders) {
    const color = PROVIDER_COLORS[p] || "#ffffff";
    legendHtml += `<span><span class="swatch line" style="background:${color}"></span>${PROVIDER_LABELS[p] || p}</span>`;
  }
  legendHtml += `<span style="color: var(--muted-2);">${tierLabel} · ${priceLabel} · ${relevantEvents.length} events</span>`;
  legendHtml += `<span style="margin-left: auto;"><a href="/history.json" target="_blank" rel="noopener" style="color: var(--text-dim); font-size: 11px;">try as json ↗</a></span>`;
  legend.innerHTML = legendHtml;
}

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
  const wrap = document.getElementById("chart-canvas-wrap");
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
  const height = 380;
  const padLeft = 60, padRight = 24, padTop = 24, padBottom = 40;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const dates = series.map(h => new Date(h.date));
  const minDate = new Date(Math.min(...dates));
  const maxDate = new Date(Math.max(...dates, Date.now()));
  const xScale = d => padLeft + ((new Date(d) - minDate) / Math.max(1, maxDate - minDate)) * (width - padLeft - padRight);

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

  // Event markers (vertical lines)
  const relevantEvents = events.filter(e =>
    (e.providers || []).includes(model.provider) ||
    (e.models || []).includes(model.id)
  );
  for (const ev of relevantEvents) {
    const evDate = new Date(ev.date);
    if (evDate < minDate || evDate > maxDate) continue;
    const x = xScale(evDate);
    const cat = TYPE_CATEGORY[ev.type] || "other";
    const color = CATEGORY_META[cat].color;
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", x); line.setAttribute("x2", x);
    line.setAttribute("y1", padTop); line.setAttribute("y2", height - padBottom);
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "1");
    line.setAttribute("stroke-dasharray", "3,3");
    line.setAttribute("opacity", "0.55");
    svg.appendChild(line);
    // Diamond marker at top
    const r = 5;
    const diamond = document.createElementNS(ns, "polygon");
    diamond.setAttribute("points", `${x},${padTop-r} ${x+r},${padTop} ${x},${padTop+r} ${x-r},${padTop}`);
    diamond.setAttribute("fill", color);
    diamond.setAttribute("stroke", "var(--panel)");
    diamond.setAttribute("stroke-width", "1");
    diamond.setAttribute("style", "cursor: pointer");
    attachEventTooltip(diamond, ev);
    svg.appendChild(diamond);
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

  // Legend
  legend.innerHTML = `
    <span><span class="swatch line" style="background: var(--c-infra)"></span>input</span>
    <span><span class="swatch line" style="background: var(--down)"></span>output</span>
    ${chartState.cache ? `<span><span class="swatch line" style="background: var(--c-money); border-top: 2px dashed var(--c-money); background: transparent;"></span>cache read</span>
    <span><span class="swatch line" style="background: var(--warn); border-top: 2px dashed var(--warn); background: transparent;"></span>cache write</span>` : ''}
    <span><span class="swatch" style="background: var(--c-regulatory); transform: rotate(45deg); width: 8px; height: 8px;"></span>event marker · click for source</span>
    <span style="color: var(--muted-2);">${series.length} data points · ${relevantEvents.length} events</span>
  `;
}

function attachEventTooltip(el, ev) {
  const tooltip = document.getElementById("chart-tooltip");
  el.addEventListener("mouseenter", e => {
    const cat = TYPE_CATEGORY[ev.type] || "other";
    tooltip.innerHTML = `
      <div class="tdate">${ev.date} · ${(ev.providers || []).map(p => PROVIDER_LABELS[p] || p).join(", ")}</div>
      <div class="thead">${escapeHtml(ev.headline)}</div>
      <div class="tbody">${escapeHtml(ev.summary || "")}</div>
      <div class="tfoot"><span style="color: ${CATEGORY_META[cat].color}">${ev.type.replace(/_/g, " ")}</span><span>click to open source ↗</span></div>
    `;
    positionTooltip(tooltip, e);
    tooltip.classList.add("show");
  });
  el.addEventListener("mousemove", e => positionTooltip(tooltip, e));
  el.addEventListener("mouseleave", () => tooltip.classList.remove("show"));
  el.addEventListener("click", () => {
    if (ev.source_urls?.[0]) window.open(ev.source_urls[0], "_blank", "noopener");
  });
}

function positionTooltip(tooltip, e) {
  const wrap = tooltip.parentElement.getBoundingClientRect();
  const x = e.clientX - wrap.left + 14;
  const y = e.clientY - wrap.top + 14;
  tooltip.style.left = `${Math.min(x, wrap.width - tooltip.offsetWidth - 10)}px`;
  tooltip.style.top = `${y}px`;
}

// ---------- events timeline (bottom) ----------
function renderTimelineControls() {
  const wrap = document.getElementById("timeline-controls");
  wrap.innerHTML = "";
  const all = document.createElement("button");
  all.className = "filter active";
  all.textContent = "All";
  all.addEventListener("click", () => {
    for (const k of Object.keys(CATEGORY_META)) activeCategories.add(k);
    updateActiveStates(); renderTimeline();
  });
  wrap.appendChild(all);
  for (const [key, meta] of Object.entries(CATEGORY_META)) {
    const btn = document.createElement("button");
    btn.className = "filter active";
    btn.dataset.cat = key;
    btn.innerHTML = `<span class="swatch" style="background:${meta.color}"></span>${meta.label}`;
    btn.addEventListener("click", () => {
      if (activeCategories.has(key) && activeCategories.size === Object.keys(CATEGORY_META).length) {
        activeCategories.clear(); activeCategories.add(key);
      } else if (activeCategories.has(key)) {
        activeCategories.delete(key);
        if (activeCategories.size === 0) for (const k of Object.keys(CATEGORY_META)) activeCategories.add(k);
      } else {
        activeCategories.add(key);
      }
      updateActiveStates(); renderTimeline();
    });
    wrap.appendChild(btn);
  }
  updateActiveStates();
}

function updateActiveStates() {
  const allEqual = activeCategories.size === Object.keys(CATEGORY_META).length;
  document.querySelectorAll(".timeline-controls .filter").forEach((el, idx) => {
    if (idx === 0) el.classList.toggle("active", allEqual);
    else el.classList.toggle("active", activeCategories.has(el.dataset.cat));
  });
}

function renderTimelineLegend() {
  const wrap = document.getElementById("timeline-legend");
  let html = "";
  for (const [_, meta] of Object.entries(CATEGORY_META)) {
    html += `<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${meta.color};margin-right:5px;vertical-align:middle"></span>${meta.label}${meta.desc ? `<span style="color:var(--muted-2)"> · ${meta.desc}</span>` : ''}</span>`;
  }
  wrap.innerHTML = html;
}

function renderTimeline() {
  const svg = document.getElementById("timeline");
  svg.innerHTML = "";
  if (events.length === 0) return;
  const width = svg.clientWidth || 800;
  const height = 320;
  const padLeft = 90, padRight = 20, padTop = 16, padBottom = 36;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const dates = events.map(e => new Date(e.date));
  let minDate = new Date(Math.min(...dates));
  let maxDate = new Date(Math.max(...dates, Date.now()));
  const dayMs = 86400000;
  minDate = new Date(minDate.getTime() - 14 * dayMs);
  maxDate = new Date(maxDate.getTime() + 14 * dayMs);
  const xScale = d => padLeft + ((new Date(d) - minDate) / (maxDate - minDate)) * (width - padLeft - padRight);

  const providerCounts = {};
  for (const ev of events) for (const p of ev.providers || []) providerCounts[p] = (providerCounts[p] || 0) + 1;
  const providers = Object.keys(providerCounts).sort((a, b) => providerCounts[b] - providerCounts[a]);
  const laneHeight = (height - padTop - padBottom) / providers.length;
  const ns = "http://www.w3.org/2000/svg";

  providers.forEach((p, i) => {
    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", padLeft); rect.setAttribute("y", padTop + i * laneHeight);
    rect.setAttribute("width", width - padLeft - padRight); rect.setAttribute("height", laneHeight);
    rect.setAttribute("class", "lane-bg" + (i % 2 ? " alt" : ""));
    svg.appendChild(rect);
    const label = document.createElementNS(ns, "text");
    label.setAttribute("x", padLeft - 10); label.setAttribute("y", padTop + i * laneHeight + laneHeight / 2 + 4);
    label.setAttribute("text-anchor", "end"); label.setAttribute("class", "lane-label");
    label.textContent = PROVIDER_LABELS[p] || p;
    svg.appendChild(label);
  });

  const months = [];
  const cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  while (cursor <= maxDate) { months.push(new Date(cursor)); cursor.setMonth(cursor.getMonth() + 1); }
  months.forEach(m => {
    const x = xScale(m);
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", x); line.setAttribute("y1", padTop);
    line.setAttribute("x2", x); line.setAttribute("y2", height - padBottom);
    line.setAttribute("class", "grid-line");
    svg.appendChild(line);
    if (m.getMonth() % 2 === 0) {
      const lbl = document.createElementNS(ns, "text");
      lbl.setAttribute("x", x); lbl.setAttribute("y", height - padBottom + 14);
      lbl.setAttribute("text-anchor", "middle"); lbl.setAttribute("class", "grid-label");
    lbl.setAttribute("fill", "#ece9e0");
      const monthName = m.toLocaleString("en", { month: "short" });
      lbl.textContent = `${monthName} '${String(m.getFullYear()).slice(-2)}`;
      svg.appendChild(lbl);
    }
  });

  const tlTooltip = document.getElementById("tl-tooltip");
  for (const ev of events) {
    const category = TYPE_CATEGORY[ev.type] || "other";
    const radius = MAGNITUDE_RADIUS[ev.impact?.magnitude] ?? 5;
    const color = CATEGORY_META[category].color;
    const x = xScale(ev.date);
    for (const p of ev.providers || ["other"]) {
      const laneIdx = providers.indexOf(p);
      if (laneIdx < 0) continue;
      const y = padTop + laneIdx * laneHeight + laneHeight / 2;
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("cx", x); circle.setAttribute("cy", y); circle.setAttribute("r", radius);
      circle.setAttribute("fill", color); circle.setAttribute("class", "event");
      if (!activeCategories.has(category)) circle.classList.add("dimmed");
      circle.addEventListener("mouseenter", e => {
        tlTooltip.innerHTML = `
          <div class="tdate">${ev.date} · ${(ev.providers || []).map(p => PROVIDER_LABELS[p] || p).join(", ")}</div>
          <div class="thead">${escapeHtml(ev.headline)}</div>
          <div class="tbody">${escapeHtml(ev.summary || "")}</div>
          <div class="tfoot"><span style="color: ${color}">${ev.type.replace(/_/g, " ")}</span><span>click to open source ↗</span></div>
        `;
        positionTooltip(tlTooltip, e);
        tlTooltip.classList.add("show");
      });
      circle.addEventListener("mousemove", e => positionTooltip(tlTooltip, e));
      circle.addEventListener("mouseleave", () => tlTooltip.classList.remove("show"));
      circle.addEventListener("click", () => { if (ev.source_urls?.[0]) window.open(ev.source_urls[0], "_blank", "noopener"); });
      svg.appendChild(circle);
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
}

boot();
