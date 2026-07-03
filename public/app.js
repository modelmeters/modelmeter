// ---------- constants ----------

const PROVIDER_LABELS = {
  openai: "OpenAI", anthropic: "Anthropic", google: "Google", xai: "xAI", venice: "Venice",
  microsoft: "Microsoft", amazon: "Amazon", meta: "Meta", nvidia: "NVIDIA", deepseek: "DeepSeek",
  mistral: "Mistral", cohere: "Cohere", alibaba: "Alibaba", zhipu: "Zhipu", moonshot: "Moonshot",
  spacex: "SpaceX", groq: "Groq", together: "Together", fireworks: "Fireworks", openrouter: "OpenRouter",
  other: "Other",
};
const TYPE_CATEGORY = {
  model_launch: "model", model_deprecation: "model", model_unavailable: "model",
  id_rename: "model", model_swap: "model", context_change: "model",
  rate_limit_change: "model", endpoint_change: "model", capability_change: "model",
  funding: "money", acquisition: "money", partnership: "money", pricing_change: "money",
  infrastructure: "infra",
  regulatory_action: "regulatory", legal_outcome: "regulatory", policy_change: "regulatory",
  open_source_release: "oss",
  leadership_change: "other", correction: "other",
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
  view: "lifecycles",          // "lifecycles" or "price"
  model: null,
  range: "all",
  scale: "log",
  cache: false,
  viewMode: "across",          // "across" or "single"
  tier: "flagship",            // "flagship" | "mid" | "fast"
  priceField: "input_cost_per_mtok",
  showDeprecated: true,
};

const ACROSS_PROVIDERS = ["anthropic", "openai", "google", "xai", "deepseek", "venice"];
// Venice is a reseller with ~117 history models — its lines flood the price
// view (its pricing tracks upstream anyway), so the price chart scopes it out.
// Lifecycles and the events swimlane keep all six.
const PRICE_PROVIDERS = ACROSS_PROVIDERS.filter(p => p !== "venice");


// Ordered generational chains — used to draw dashed connectors between model segments
const MODEL_FAMILIES = {
  "anthropic/opus":    ["anthropic/claude-3-opus","anthropic/claude-opus-3","anthropic/claude-opus-4","anthropic/claude-opus-4-5","anthropic/claude-opus-4-6","anthropic/claude-opus-4-7","anthropic/claude-opus-4-8"],
  "anthropic/sonnet":  ["anthropic/claude-3-sonnet","anthropic/claude-3-5-sonnet","anthropic/claude-3-7-sonnet","anthropic/claude-sonnet-3-7","anthropic/claude-sonnet-4","anthropic/claude-sonnet-4-5","anthropic/claude-sonnet-4-6"],
  "anthropic/haiku":   ["anthropic/claude-3-haiku","anthropic/claude-haiku-3","anthropic/claude-3-5-haiku","anthropic/claude-haiku-3-5","anthropic/claude-haiku-4-5"],
  "openai/gpt-5":      ["openai/gpt-5","openai/gpt-5-2","openai/gpt-5-4","openai/gpt-5-5"],
  "openai/gpt-4-line": ["openai/gpt-4-8k","openai/gpt-4","openai/gpt-4-turbo","openai/gpt-4o"],
  "openai/gpt-mini":   ["openai/gpt-3-5-turbo","openai/gpt-4o-mini"],
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
  renderSunsets();
  renderNotice();
  renderCheck();
  renderEventsFeed();
  wireFeedSeverity();
  renderChartControls();
  renderChart();
  window.addEventListener("resize", () => { renderChart(); });
}

async function loadEvents() {
  const res = await fetch("/events.json");
  const body = await res.json();
  events = (body.events || []).filter(e => e.announced_at && e.status !== "corrected");
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
  const recent = [...events].sort((a, b) => b.announced_at.localeCompare(a.announced_at)).slice(0, 20);
  const items = recent.map(ev => {
    const url = ev.sources?.[0]?.url || "#";
    const date = ev.announced_at;
    // severity outranks type for chip color: breaking red, action yellow
    const chipColor = ev.severity === "breaking" ? "var(--down)" : ev.severity === "action_required" ? "var(--warn)" : typeColor(ev.type);
    return `<span class="ticker-item">
      <span class="tick-date">${date}</span>
      <span class="tick-cat" style="color:${chipColor}">${typeLabel(ev.type).toUpperCase()}</span>
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
  document.getElementById("s-breaking").textContent = events.filter(e => e.severity === "breaking").length || "—";
  document.getElementById("s-action").textContent = events.filter(e => e.severity === "action_required").length || "—";
  const providers = new Set(currentModels.map(m => m.provider));
  document.getElementById("s-providers").textContent = providers.size || "—";
  document.getElementById("s-snapshots").textContent = history?.snapshot_count ?? "—";
  document.getElementById("s-history").textContent = history?.model_count ?? "—";
}

// ---------- sunset board ----------
const SUNSET_COLLAPSED = 10;
let sunsetExpanded = false;
function renderSunsets() {
  const board = document.getElementById("sunset-board");
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events
    .filter(e => e.effective_at && e.effective_at >= today && (e.severity === "breaking" || e.severity === "action_required"))
    .sort((a, b) => a.effective_at.localeCompare(b.effective_at));
  document.getElementById("sunset-count").textContent = upcoming.length ? `${upcoming.length} scheduled` : "";
  if (!upcoming.length) { board.innerHTML = '<div style="color: var(--muted); font-size: 11px; padding: 12px 14px;">no scheduled retirements on record</div>'; return; }

  const shown = sunsetExpanded ? upcoming : upcoming.slice(0, SUNSET_COLLAPSED);
  const rows = shown.map(ev => {
    const days = Math.ceil((new Date(ev.effective_at) - new Date(today)) / 864e5);
    const daysColor = days <= 30 ? "var(--down)" : days <= 90 ? "var(--warn)" : "var(--text-dim)";
    const prov = ev.providers?.[0] || "?";
    const models = (ev.models || []).map(m => m.split("/").slice(1).join("/"));
    const what = models.length
      ? `<span class="models">${escapeHtml(shorten(models.join(", "), 72))}</span>`
      : escapeHtml(shorten(ev.headline, 72));
    const target = ev.migration_target
      ? `<span class="arrow">→</span>${escapeHtml(ev.migration_target.split("/").slice(1).join("/"))}`
      : `<span class="arrow" style="opacity:.5">·</span>`;
    const url = ev.sources?.[0]?.url || "#";
    return `<div class="sun-row" title="${escapeHtml(ev.headline)}" onclick="window.open('${url}', '_blank', 'noopener')">
      <span class="sun-days" style="color:${daysColor}">${days}d</span>
      <span class="sun-date">${ev.effective_at}</span>
      <span class="sun-prov"><span class="pp-prov-dash" style="background:${PROVIDER_COLORS[prov] || "var(--muted)"}; margin-right:6px;"></span>${PROVIDER_LABELS[prov] || prov}</span>
      <span class="sun-what">${what}</span>
      <span class="sun-target">${target}</span>
    </div>`;
  });
  let more = "";
  if (upcoming.length > SUNSET_COLLAPSED) {
    more = `<div class="sun-more" id="sun-more">${sunsetExpanded ? "▲ show fewer" : `▼ show all ${upcoming.length}`}</div>`;
  }
  board.innerHTML = rows.join("") + more;
  document.getElementById("sun-more")?.addEventListener("click", (e) => { e.stopPropagation(); sunsetExpanded = !sunsetExpanded; renderSunsets(); });
}

// ---------- notice-given panel ----------
function renderNotice() {
  const wrap = document.getElementById("notice-rows");
  const byProv = {};
  for (const e of events) {
    if (e.type !== "model_deprecation" || !e.effective_at || !e.announced_at) continue;
    const days = Math.round((new Date(e.effective_at) - new Date(e.announced_at)) / 864e5);
    if (days < 0) continue;
    (byProv[e.providers?.[0] || "?"] ??= []).push(days);
  }
  const rows = Object.entries(byProv)
    .filter(([, arr]) => arr.length >= 3)
    .map(([p, arr]) => {
      arr.sort((a, b) => a - b);
      return { p, n: arr.length, med: arr[Math.floor(arr.length / 2)], min: arr[0] };
    })
    .sort((a, b) => b.med - a.med);
  if (!rows.length) { wrap.innerHTML = '<div style="color: var(--muted); font-size: 11px;">not enough deprecation data yet</div>'; return; }
  wrap.innerHTML = rows.map(r => `<div class="notice-row">
    <span class="pp-prov-dash" style="background:${PROVIDER_COLORS[r.p] || "var(--muted)"}"></span>
    <span class="notice-prov">${PROVIDER_LABELS[r.p] || r.p}</span>
    <span class="notice-med">${r.med}d</span>
    <span class="notice-n">n=${r.n} · min ${r.min}d</span>
  </div>`).join("");
}

// ---------- feed severity filter ----------
let feedSeverity = "all";
function wireFeedSeverity() {
  document.querySelectorAll("#feed-severity .chip").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#feed-severity .chip").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      feedSeverity = btn.dataset.sev;
      renderEventsFeed();
    });
  });
}

function shorten(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

// ---------- check your stack ----------
// Client-side preview of the /check endpoint: match user model ids against the
// events record and report scheduled retirements / breaking history per model.
function normId(x) { return String(x).toLowerCase().trim().replace(/\./g, "-"); }
function baseId(x) { return normId(x).replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{4}$/, ""); }
function renderCheck() {
  const btn = document.getElementById("check-btn");
  const input = document.getElementById("check-input");
  if (!btn || !input) return;
  btn.addEventListener("click", runCheck);
  input.addEventListener("keydown", e => { if (e.key === "Enter") runCheck(); });
}
function runCheck() {
  const raw = document.getElementById("check-input").value;
  const out = document.getElementById("check-result");
  const tokens = raw.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
  if (!tokens.length) { out.className = "show"; out.innerHTML = '<div style="color: var(--muted);">enter one or more model ids</div>'; return; }
  const today = new Date().toISOString().slice(0, 10);
  const rows = tokens.slice(0, 12).map(tok => {
    const q = normId(tok), qb = baseId(tok);
    // events whose affected-model list matches this id (with or without provider prefix, date-suffix tolerant)
    const hits = events.filter(e => (e.models || []).some(m => {
      const bare = normId(m.split("/").slice(1).join("/"));
      return bare === q || bare === qb || baseId(bare) === q || baseId(bare) === qb || normId(m) === q;
    }));
    const upcoming = hits.filter(e => e.effective_at && e.effective_at >= today).sort((a, b) => a.effective_at.localeCompare(b.effective_at));
    const past = hits.filter(e => e.effective_at && e.effective_at < today).sort((a, b) => b.effective_at.localeCompare(a.effective_at));
    const label = `<span class="chk-id">${escapeHtml(tok)}</span>`;
    if (upcoming.length) {
      const ev = upcoming[0];
      const days = Math.ceil((new Date(ev.effective_at) - new Date(today)) / 864e5);
      const col = days <= 30 ? "var(--down)" : days <= 90 ? "var(--warn)" : "var(--text-dim)";
      const tgt = ev.migration_target ? ` → ${escapeHtml(ev.migration_target.split("/").slice(1).join("/"))}` : "";
      const url = ev.sources?.[0]?.url || "#";
      return `<div class="chk-row" onclick="window.open('${url}', '_blank', 'noopener')" title="${escapeHtml(ev.headline)}">${label}<span class="chk-verdict" style="color:${col}">⚠ ${days}d — ${typeLabel(ev.type)} ${ev.effective_at}${tgt}</span></div>`;
    }
    if (past.length) {
      const ev = past[0];
      const url = ev.sources?.[0]?.url || "#";
      return `<div class="chk-row" onclick="window.open('${url}', '_blank', 'noopener')" title="${escapeHtml(ev.headline)}">${label}<span class="chk-verdict" style="color:var(--down)">✗ ${typeLabel(ev.type)} — effective ${ev.effective_at}</span></div>`;
    }
    if (hits.length) {
      const ev = [...hits].sort((a, b) => b.announced_at.localeCompare(a.announced_at))[0];
      const url = ev.sources?.[0]?.url || "#";
      return `<div class="chk-row" onclick="window.open('${url}', '_blank', 'noopener')" title="${escapeHtml(ev.headline)}">${label}<span class="chk-verdict" style="color:var(--warn)">· ${typeLabel(ev.type)} ${ev.announced_at}</span></div>`;
    }
    const known = currentModels.some(m => { const bare = normId(m.id.split("/").slice(1).join("/")); return bare === q || bare === qb || normId(m.id) === q; });
    return `<div class="chk-row">${label}<span class="chk-verdict" style="color:${known ? "var(--up)" : "var(--muted-2)"}">${known ? "✓ no scheduled changes on record" : "? not in catalog — unrecognized id"}</span></div>`;
  });
  out.className = "show";
  out.innerHTML = rows.join("") + `<div class="chk-note">checked against ${events.length} recorded events · <a href="/events.json" target="_blank" rel="noopener">events.json ↗</a></div>`;
}

// ---------- events feed (right column) ----------
function renderEventsFeed() {
  const wrap = document.getElementById("events-feed");
  const ctxLabel = document.getElementById("feed-context");
  const modelId = chartState.viewMode === "single" ? chartState.model : null;
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
  if (feedSeverity !== "all") filtered = filtered.filter(e => e.severity === feedSeverity);
  filtered = [...filtered].sort((a, b) => b.announced_at.localeCompare(a.announced_at)).slice(0, 30);
  if (filtered.length === 0) { wrap.innerHTML = '<div style="color: var(--muted); font-size: 11px;">no matching events</div>'; return; }
  wrap.innerHTML = filtered.map(ev => {
    const url = ev.sources?.[0]?.url || "#";
    const sev = ev.severity && ev.severity !== "informational"
      ? ` · <span class="sev-chip ${ev.severity}">${ev.severity === "action_required" ? "action" : "breaking"}</span>` : "";
    return `<div class="ev-item" onclick="window.open('${url}', '_blank', 'noopener')">
      <div class="ev-date">${ev.announced_at} · <span style="color: ${typeColor(ev.type)}">${typeLabel(ev.type)}</span>${sev}</div>
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
  document.querySelectorAll("#chart-view .chip").forEach(c => {
    c.addEventListener("click", () => {
      chartState.view = c.dataset.view;
      document.querySelectorAll("#chart-view .chip").forEach(x => x.classList.toggle("active", x === c));
      applyChartControlVisibility();
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
  const isPrice = chartState.view === "price";
  const mode = chartState.viewMode;
  const isAcross = isPrice && mode === "across";
  const isSingle = isPrice && mode === "single";
  const set = (id, vis) => { const el = document.getElementById(id); if (el) el.style.display = vis; };
  set("chart-mode", isPrice ? "" : "none");
  set("chart-tier", "none");
  set("chart-price", isAcross ? "" : "none");
  set("chart-model", isSingle ? "" : "none");
  set("chart-cache", isSingle ? "" : "none");
  set("chart-scale", isPrice ? "" : "none");
  set("chart-deprecated", isPrice ? "" : "none");
  const title = document.getElementById("chart-title");
  if (title) title.textContent = isPrice ? "Price · per Mtok · over time" : "Model Lifecycles";
}

function renderChart() {
  const svg = document.getElementById("chart-svg");
  if (chartState.view === "lifecycles") {
    renderLifecycles();
  } else {
    if (svg) svg.style.height = "420px";
    if (chartState.viewMode === "across") renderAcrossProvidersChart();
    else renderSingleModelChart();
  }
  renderEventSwimlane();
}

// ---------- model lifecycles ----------
// One lane per model: bar from first-tracked to shutdown (or today), with the
// deprecation window (announced → effective) shaded and lifecycle markers.
// Rows come from the pricing history; windows come from the events record.
const LIFE_ROWS_PER_PROVIDER = 10;
function buildDepMap() {
  // model id (normalized, plus date-suffix-stripped base) → deprecation window.
  // Where several events touch the same id, the earliest effective date governs.
  const map = new Map();
  for (const e of events) {
    if (e.type !== "model_deprecation" || !e.effective_at || !e.announced_at) continue;
    for (const m of e.models || []) {
      const entry = { announced: e.announced_at, effective: e.effective_at, target: e.migration_target, url: e.sources?.[0]?.url, headline: e.headline };
      for (const key of new Set([normId(m), baseId(m)])) {
        const prev = map.get(key);
        if (!prev || entry.effective < prev.effective) map.set(key, entry);
      }
    }
  }
  return map;
}
function renderLifecycles() {
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

  const today = new Date().toISOString().slice(0, 10);
  const depMap = buildDepMap();
  const currentById = Object.fromEntries(currentModels.map(m => [m.id, m]));

  let cutoff = null;
  if (chartState.range !== "all") {
    const months = parseInt(chartState.range, 10);
    cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months);
  }

  // Build + curate rows per provider
  const groups = [];
  for (const provider of ACROSS_PROVIDERS) {
    const candidates = history.models
      .filter(m => m.provider === provider && m.history.length > 0)
      .map(m => {
        const start = m.history.map(h => h.date).sort()[0];
        const dep = depMap.get(normId(m.id)) || depMap.get(baseId(m.id));
        const retired = dep && dep.effective <= today;
        const activeEnd = retired ? dep.effective : today;
        const cur = currentById[m.id];
        const isDeprecatedCatalog = cur?.availability === "deprecated";
        return { m, provider, start, dep, retired: retired || isDeprecatedCatalog, activeEnd };
      })
      .filter(r => !cutoff || new Date(r.activeEnd) >= cutoff || (r.dep && new Date(r.dep.effective) >= cutoff));
    // priority: curated family chains → models with deprecation windows → longest history
    const picked = [];
    const seen = new Set();
    const take = (r) => { if (r && !seen.has(r.m.id) && picked.length < LIFE_ROWS_PER_PROVIDER) { seen.add(r.m.id); picked.push(r); } };
    for (const id of Object.entries(MODEL_FAMILIES).filter(([k]) => k.startsWith(provider + "/")).flatMap(([, ids]) => ids)) {
      take(candidates.find(r => r.m.id === id));
    }
    for (const r of candidates.filter(r => r.dep).sort((a, b) => a.start.localeCompare(b.start))) take(r);
    for (const r of [...candidates].sort((a, b) => b.m.history.length - a.m.history.length)) take(r);
    picked.sort((a, b) => a.start.localeCompare(b.start));
    if (picked.length) groups.push({ provider, rows: picked });
  }
  if (!groups.length) {
    empty.style.display = "flex"; empty.innerHTML = "no lifecycle data in range"; svg.style.display = "none"; return;
  }

  empty.style.display = "none";
  svg.style.display = "block";
  svg.innerHTML = "";

  const allRows = groups.flatMap(g => g.rows);
  const width = svg.clientWidth || 800;
  const padLeft = 150, padRight = 56, padTop = 18, padBottom = 26;
  const rowH = 15, headH = 20, groupGap = 6;
  const height = padTop + groups.reduce((s, g) => s + headH + g.rows.length * rowH + groupGap, 0) + padBottom;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.height = `${height}px`;

  const minDate = cutoff ? new Date(cutoff) : new Date(Math.min(...allRows.map(r => new Date(r.start))));
  const maxDate = new Date(Math.max(Date.now(), ...allRows.map(r => r.dep ? +new Date(r.dep.effective) : 0)));
  const xScale = d => padLeft + ((new Date(d) - minDate) / Math.max(1, maxDate - minDate)) * (width - padLeft - padRight);
  const clampX = d => Math.max(padLeft, Math.min(xScale(d), width - padRight));
  sharedXParams = { minDate, maxDate, xScale, width, padLeft, padRight, padTop, padBottom };

  const ns = "http://www.w3.org/2000/svg";
  const tooltip = document.getElementById("chart-tooltip");

  // Quarterly x grid
  const curTick = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  while (curTick <= maxDate) {
    if (curTick.getMonth() % 3 === 0) {
      const x = xScale(curTick);
      const gl = document.createElementNS(ns, "line");
      gl.setAttribute("x1", x); gl.setAttribute("x2", x);
      gl.setAttribute("y1", padTop); gl.setAttribute("y2", height - padBottom);
      gl.setAttribute("class", "grid-line"); svg.appendChild(gl);
      const lbl = document.createElementNS(ns, "text");
      lbl.setAttribute("x", x); lbl.setAttribute("y", height - padBottom + 13);
      lbl.setAttribute("text-anchor", "middle"); lbl.setAttribute("fill", "#807c72"); lbl.setAttribute("font-size", "9");
      const mo = curTick.toLocaleString("en", { month: "short" }).toUpperCase();
      lbl.textContent = curTick.getMonth() === 0 ? `${mo} '${String(curTick.getFullYear()).slice(-2)}` : mo;
      svg.appendChild(lbl);
    }
    curTick.setMonth(curTick.getMonth() + 1);
  }
  // Crosshair (driven by swimlane hover)
  const ch = document.createElementNS(ns, "line");
  ch.setAttribute("id", "chart-crosshair");
  ch.setAttribute("x1", "-1"); ch.setAttribute("x2", "-1");
  ch.setAttribute("y1", String(padTop)); ch.setAttribute("y2", String(height - padBottom));
  ch.setAttribute("class", "chart-crosshair");
  ch.style.display = "none";
  svg.appendChild(ch);
  // Today line
  const tl = document.createElementNS(ns, "line");
  const tx = xScale(today);
  tl.setAttribute("x1", tx); tl.setAttribute("x2", tx);
  tl.setAttribute("y1", padTop); tl.setAttribute("y2", height - padBottom);
  tl.setAttribute("stroke", "var(--accent)"); tl.setAttribute("stroke-width", "1");
  tl.setAttribute("stroke-dasharray", "2,4"); tl.setAttribute("opacity", "0.3");
  svg.appendChild(tl);

  let y = padTop;
  for (const g of groups) {
    const color = PROVIDER_COLORS[g.provider] || "#ffffff";
    const head = document.createElementNS(ns, "text");
    head.setAttribute("x", "6"); head.setAttribute("y", String(y + 13));
    head.setAttribute("fill", color); head.setAttribute("font-size", "10");
    head.setAttribute("style", "text-transform: uppercase; letter-spacing: 0.08em;");
    head.textContent = PROVIDER_LABELS[g.provider] || g.provider;
    svg.appendChild(head);
    y += headH;

    for (const r of g.rows) {
      const cy = y + rowH / 2;
      // label
      const lbl = document.createElementNS(ns, "text");
      lbl.setAttribute("x", String(padLeft - 8)); lbl.setAttribute("y", String(cy + 3));
      lbl.setAttribute("text-anchor", "end"); lbl.setAttribute("fill", "#b8b4a8"); lbl.setAttribute("font-size", "9.5");
      lbl.textContent = shorten(r.m.display_name || r.m.id, 24);
      svg.appendChild(lbl);
      // active bar: first-tracked → activeEnd
      const x1 = clampX(r.start), x2 = clampX(r.activeEnd);
      const bar = document.createElementNS(ns, "rect");
      bar.setAttribute("x", String(x1)); bar.setAttribute("y", String(cy - 2));
      bar.setAttribute("width", String(Math.max(2, x2 - x1))); bar.setAttribute("height", "4");
      bar.setAttribute("fill", color); bar.setAttribute("opacity", r.retired ? "0.45" : "0.95");
      svg.appendChild(bar);
      // first-tracked dot
      if (!cutoff || new Date(r.start) >= cutoff) {
        const dot = document.createElementNS(ns, "circle");
        dot.setAttribute("cx", String(x1)); dot.setAttribute("cy", String(cy));
        dot.setAttribute("r", "3"); dot.setAttribute("fill", color);
        svg.appendChild(dot);
      }
      if (r.dep) {
        // deprecation window: announced → effective
        const wx1 = clampX(r.dep.announced), wx2 = clampX(r.dep.effective);
        const win = document.createElementNS(ns, "rect");
        win.setAttribute("x", String(wx1)); win.setAttribute("y", String(cy - 5));
        win.setAttribute("width", String(Math.max(2, wx2 - wx1))); win.setAttribute("height", "10");
        win.setAttribute("fill", "var(--warn)"); win.setAttribute("opacity", "0.22");
        svg.appendChild(win);
        // shutdown cap
        const cap = document.createElementNS(ns, "rect");
        cap.setAttribute("x", String(wx2 - 1)); cap.setAttribute("y", String(cy - 6));
        cap.setAttribute("width", "2.5"); cap.setAttribute("height", "12");
        cap.setAttribute("fill", "var(--down)"); cap.setAttribute("opacity", r.retired ? "0.9" : "0.7");
        svg.appendChild(cap);
        // scheduled (future) shutdowns get a date label
        if (r.dep.effective > today) {
          const dl = document.createElementNS(ns, "text");
          dl.setAttribute("x", String(wx2 + 5)); dl.setAttribute("y", String(cy + 3));
          dl.setAttribute("fill", "var(--down)"); dl.setAttribute("font-size", "8.5"); dl.setAttribute("opacity", "0.9");
          dl.textContent = r.dep.effective.slice(5);
          svg.appendChild(dl);
        }
      }
      // hover target across the lane
      const hit = document.createElementNS(ns, "rect");
      hit.setAttribute("x", String(padLeft)); hit.setAttribute("y", String(y));
      hit.setAttribute("width", String(width - padLeft - padRight)); hit.setAttribute("height", String(rowH));
      hit.setAttribute("fill", "transparent"); hit.setAttribute("style", "cursor: pointer");
      hit.addEventListener("mouseenter", e => {
        const dep = r.dep
          ? `<div class="tbody">deprecation announced ${r.dep.announced} · ${r.retired ? "retired" : "shutdown"} ${r.dep.effective}${r.dep.target ? ` · → ${escapeHtml(r.dep.target.split("/").slice(1).join("/"))}` : ""}</div>`
          : `<div class="tbody">active · no scheduled retirement on record</div>`;
        tooltip.innerHTML = `
          <div class="tdate">${PROVIDER_LABELS[r.provider] || r.provider}</div>
          <div class="thead">${escapeHtml(r.m.display_name || r.m.id)}</div>
          <div class="tbody">first tracked ${r.start}</div>${dep}
          <div class="tfoot"><span>${r.dep?.url ? "click for source ↗" : "click for model card ↗"}</span></div>`;
        positionTooltip(tooltip, e);
        tooltip.classList.add("show");
      });
      hit.addEventListener("mousemove", e => positionTooltip(tooltip, e));
      hit.addEventListener("mouseleave", () => tooltip.classList.remove("show"));
      hit.addEventListener("click", () => {
        window.open(r.dep?.url || `/model?id=${encodeURIComponent(r.m.id)}`, "_blank", "noopener");
      });
      svg.appendChild(hit);
      y += rowH;
    }
    y += groupGap;
  }

  const scheduled = allRows.filter(r => r.dep && r.dep.effective > today).length;
  const retired = allRows.filter(r => r.retired).length;
  legend.innerHTML = `
    <span><span class="swatch" style="background: var(--text-dim); height: 3px;"></span>tracked lifespan</span>
    <span><span class="swatch" style="background: var(--warn); opacity: 0.4;"></span>deprecation window</span>
    <span><span class="swatch" style="background: var(--down); width: 3px;"></span>shutdown</span>
    <span style="color: var(--muted-2);">${allRows.length} models · ${scheduled} scheduled · ${retired} retired</span>
    <span style="margin-left: auto;"><a href="/events.json" target="_blank" rel="noopener" style="color: var(--text-dim); font-size: 11px;">try as json ↗</a></span>`;
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
  for (const provider of PRICE_PROVIDERS) {
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
        if (!last || last.date < today) series.push({ date: today, [priceField]: cur[priceField], _synthetic: true });
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

    // Dots only where something happened: series start, an actual price
    // change, or the last real point of a deprecated line — not the synthetic
    // today-point every active model carries (that was a wall of dots at the
    // right edge).
    const r = 3.5;
    for (let i = 0; i < visible.length; i++) {
      const pt = visible[i];
      const changed = i > 0 && pt[priceField] !== visible[i - 1][priceField];
      const isLastReal = i === visible.length - 1 && !pt._synthetic;
      if (!(i === 0 || changed || isLastReal)) continue;
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
  for (const p of PRICE_PROVIDERS) {
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

  // Event dots — informational noise filtered: only breaking/action events plus
  // structural informational ones make the timeline. ("major" is too common in
  // drafted events to discriminate — 324 of 691 informational events carry it.)
  const slEvents = events.filter(e => e.severity !== "informational" || e.impact?.magnitude === "structural");
  for (const ev of slEvents) {
    const evDate = new Date(ev.announced_at);
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
          <div class="tdate">${ev.announced_at} · ${(ev.providers || []).map(q => PROVIDER_LABELS[q] || q).join(", ")}</div>
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
        if (ev.sources?.[0]?.url) window.open(ev.sources[0].url, "_blank", "noopener");
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
