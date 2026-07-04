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
let sharedXParams = null; // set by renderLifecycles, read by renderEventSwimlane
const activeSwimlaneCategories = new Set(Object.keys(CATEGORY_META).filter(k => k !== "oss"));
let chartState = {
  range: "all",
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
  "anthropic/frontier":["anthropic/claude-sonnet-5","anthropic/claude-fable-5","anthropic/claude-mythos-5"],
  "openai/gpt-5":      ["openai/gpt-5","openai/gpt-5-2","openai/gpt-5-4","openai/gpt-5-5"],
  "openai/gpt-4-line": ["openai/gpt-4-8k","openai/gpt-4","openai/gpt-4-turbo","openai/gpt-4o"],
  "openai/gpt-mini":   ["openai/gpt-3-5-turbo","openai/gpt-4o-mini"],
  "google/gemini-pro": ["google/gemini-1-5-pro","google/gemini-2-5-pro"],
  "google/gemini-flash":["google/gemini-1-5-flash","google/gemini-2-0-flash","google/gemini-2-5-flash","google/gemini-3-flash-preview","google/gemini-3-5-flash"],
  "xai/grok":          ["xai/grok-beta","xai/grok-2","xai/grok-3","xai/grok-4","xai/grok-4-3"],
  "deepseek/chat":     ["deepseek/deepseek-chat","deepseek/deepseek-v4-flash"],
  "deepseek/reasoner": ["deepseek/deepseek-reasoner","deepseek/deepseek-v4-pro"],
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
  renderChartControls();
  renderChart();
  setupPriceTable();
  renderPriceTable();
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

// The compiled history carries duplicate ids from two sources: pages that
// renamed models mid-history (claude-3-opus vs claude-opus-3) and dot/dash
// variants (gemini-2.5-pro vs gemini-2-5-pro). Merge them under one canonical
// id so every view (lifecycles, price, stats) sees one lane per model.
// TODO: fix at the data layer (build-history.mjs) so /history serves clean ids.
const RENAMED_IDS = {
  "anthropic/claude-3-opus": "anthropic/claude-opus-3",
  "anthropic/claude-3-haiku": "anthropic/claude-haiku-3",
  "anthropic/claude-3-5-haiku": "anthropic/claude-haiku-3-5",
  "anthropic/claude-3-7-sonnet": "anthropic/claude-sonnet-3-7",
  "anthropic/claude-3-5-sonnet": "anthropic/claude-sonnet-3-5",
};
function canonicalHistoryId(id) { return RENAMED_IDS[id] ?? id.replace(/\./g, "-"); }
function dedupeHistory(models) {
  const byId = new Map();
  for (const m of models) {
    const id = canonicalHistoryId(m.id);
    const prev = byId.get(id);
    if (!prev) { byId.set(id, { ...m, id }); continue; }
    const seen = new Set(prev.history.map(h => h.date));
    prev.history = [...prev.history, ...m.history.filter(h => !seen.has(h.date))].sort((a, b) => a.date.localeCompare(b.date));
    prev.display_name = prev.display_name || m.display_name;
  }
  return [...byId.values()];
}
async function loadHistory() {
  try {
    const res = await fetch("/history.json");
    if (!res.ok) { history = null; return; }
    history = await res.json();
    if (history?.models) history.models = dedupeHistory(history.models);
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
  const allVerified = upcoming.length && upcoming.every(e => e.status === "verified");
  document.getElementById("sunset-count").innerHTML = upcoming.length
    ? `${upcoming.length} scheduled${allVerified ? ' · <span style="color: var(--up)">all human-verified ✓</span>' : ""}` : "";
  if (!upcoming.length) { board.innerHTML = '<div style="color: var(--muted); font-size: 11px; padding: 12px 14px;">no scheduled retirements on record</div>'; return; }

  const shown = sunsetExpanded ? upcoming : upcoming.slice(0, SUNSET_COLLAPSED);
  const rows = shown.map(ev => {
    const days = Math.ceil((new Date(ev.effective_at) - new Date(today)) / 864e5);
    const daysColor = days <= 30 ? "var(--down)" : days <= 90 ? "var(--warn)" : "var(--text-dim)";
    const prov = ev.providers?.[0] || "?";
    const maker = ev.providers?.[1];
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
      <span class="sun-prov"><span class="pp-prov-dash" style="background:${PROVIDER_COLORS[prov] || "var(--muted)"}; margin-right:6px;"></span>${PROVIDER_LABELS[prov] || prov}${maker ? ` <span style="color: var(--muted-2)">· ${PROVIDER_LABELS[maker] || maker}</span>` : ""}</span>
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

// ---------- price table ----------
// First-party model makers. Everything else in currentModels (venice, openrouter,
// together, groq) is a reseller/aggregator, shown only in "all providers" scope.
const DIRECT_PROVIDERS = ["anthropic", "openai", "google", "xai", "deepseek", "mistral", "cohere"];
let tableState = { scope: "direct", search: "", sortKey: "provider", sortDir: "asc" };

function fmtPrice(n) { return n == null ? "—" : "$" + n; }
function fmtCtx(n) {
  if (n == null) return "—";
  if (n >= 1e6) return (n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1) + "M";
  if (n >= 1000) return Math.round(n / 1000) + "K";
  return String(n);
}

function tableSortVal(m, key) {
  if (key === "provider") return m.provider;
  if (key === "model") return (m.display_name || m.id).toLowerCase();
  return m[key]; // input_cost_per_mtok | output_cost_per_mtok | context_window
}

function renderPriceTable() {
  const body = document.getElementById("price-table-body");
  const countEl = document.getElementById("table-count");
  if (!body) return;

  let rows = currentModels.filter(m =>
    tableState.scope === "all" || DIRECT_PROVIDERS.includes(m.provider)
  );
  const q = tableState.search.trim().toLowerCase();
  if (q) rows = rows.filter(m =>
    (m.id + " " + (m.display_name || "") + " " + (m.tags || []).join(" ") + " " + (m.aliases || []).join(" "))
      .toLowerCase().includes(q)
  );

  const { sortKey, sortDir } = tableState;
  const dir = sortDir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    const av = tableSortVal(a, sortKey), bv = tableSortVal(b, sortKey);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;                 // nulls always last
    if (bv == null) return -1;
    if (typeof av === "string") return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });

  countEl.textContent = `${rows.length} model${rows.length === 1 ? "" : "s"}`;
  body.innerHTML = rows.map(m => {
    const prov = PROVIDER_LABELS[m.provider] || m.provider;
    const color = PROVIDER_COLORS[m.provider] || "#888";
    const deprecated = m.availability === "deprecated";
    const tags = (m.tags || []).map(t => `<span class="ptag">${escapeHtml(t)}</span>`).join("");
    return `<tr${deprecated ? ' class="row-deprecated"' : ""}>
      <td class="c-prov"><span class="prov-dot" style="background:${color}"></span>${escapeHtml(prov)}</td>
      <td class="c-model"><a href="/model?id=${encodeURIComponent(m.id)}" title="${escapeHtml(m.id)}">${escapeHtml(m.display_name || m.id)}</a>${deprecated ? ' <span class="ptag" style="color: var(--down)">deprecated</span>' : ""}${tags ? ` <span class="ptags">${tags}</span>` : ""}</td>
      <td class="c-num">${fmtPrice(m.input_cost_per_mtok)}</td>
      <td class="c-num">${fmtPrice(m.output_cost_per_mtok)}</td>
      <td class="c-num">${fmtCtx(m.context_window)}</td>
    </tr>`;
  }).join("");
}

function updateTableSortHeaders() {
  document.querySelectorAll("#price-table thead th[data-key]").forEach(th => {
    const active = th.dataset.key === tableState.sortKey;
    th.classList.toggle("sorted", active);
    th.setAttribute("data-dir", active ? tableState.sortDir : "");
  });
}

function setupPriceTable() {
  document.querySelectorAll("#table-scope .chip").forEach(chip =>
    chip.addEventListener("click", () => {
      document.querySelectorAll("#table-scope .chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      tableState.scope = chip.dataset.scope;
      renderPriceTable();
    })
  );
  const search = document.getElementById("table-search");
  if (search) search.addEventListener("input", () => { tableState.search = search.value; renderPriceTable(); });

  document.querySelectorAll("#price-table thead th[data-key]").forEach(th =>
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (tableState.sortKey === key) {
        tableState.sortDir = tableState.sortDir === "asc" ? "desc" : "asc";
      } else {
        tableState.sortKey = key;
        // numeric columns default to ascending (cheapest/smallest first)
        tableState.sortDir = "asc";
      }
      updateTableSortHeaders();
      renderPriceTable();
    })
  );
  updateTableSortHeaders();
}

function shorten(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

// ---------- check your stack ----------
// Client-side preview of the /check endpoint: match user model ids against the
// events record and report scheduled retirements / breaking history per model.
function normId(x) { return String(x).toLowerCase().trim().replace(/\./g, "-"); }
function baseId(x) { return normId(x).replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/-\d{8}$/, "").replace(/-\d{2}-\d{2}$/, "").replace(/-\d{4}$/, ""); }
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
  ctxLabel.textContent = "all providers · newest first";
  const filtered = [...events].sort((a, b) => b.announced_at.localeCompare(a.announced_at)).slice(0, 60);
  if (filtered.length === 0) { wrap.innerHTML = '<div style="color: var(--muted); font-size: 11px;">no matching events</div>'; return; }
  wrap.innerHTML = filtered.map(ev => {
    const url = ev.sources?.[0]?.url || "#";
    const sev = ev.severity && ev.severity !== "informational"
      ? ` · <span class="sev-chip ${ev.severity}">${ev.severity === "action_required" ? "action" : "breaking"}</span>` : "";
    const unv = ev.status === "unverified" ? ' · <span class="sev-chip informational">unverified</span>' : "";
    return `<div class="ev-item" onclick="window.open('${url}', '_blank', 'noopener')">
      <div class="ev-date">${ev.announced_at} · <span style="color: ${typeColor(ev.type)}">${typeLabel(ev.type)}</span>${sev}${unv}</div>
      <div class="ev-headline">${escapeHtml(ev.headline)}</div>
    </div>`;
  }).join("");
}

// ---------- chart ----------
function renderChartControls() {
  document.querySelectorAll("#chart-range .chip").forEach(c => {
    c.addEventListener("click", () => {
      chartState.range = c.dataset.range;
      document.querySelectorAll("#chart-range .chip").forEach(x => x.classList.toggle("active", x === c));
      renderChart();
    });
  });
}

function renderChart() {
  renderLifecycles();
  renderEventSwimlane();
  syncFeedHeight();
}

// The events feed matches the lifecycles panel height exactly (they sit
// side-by-side), scrolling internally — re-synced on every render so the
// bottom edges stay aligned through expander clicks and resizes.
function syncFeedHeight() {
  if (typeof document.querySelector !== "function") return;
  const chartPanel = document.querySelector(".chart-panel");
  const feedPanel = document.querySelector(".col-right .panel");
  if (!chartPanel || !feedPanel || !chartPanel.offsetHeight) return;
  feedPanel.style.height = chartPanel.offsetHeight + "px";
}

// ---------- model lifecycles ----------
// One lane per model: bar from first-tracked to shutdown (or today), with the
// deprecation window (announced → effective) shaded and lifecycle markers.
// Rows come from the pricing history; windows come from the events record.
const LIFE_ROWS_PER_PROVIDER = 14;
const lifeExpanded = new Set(); // providers the user expanded to all lanes
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

  // Build + curate rows per provider. Venice is excluded here: its lanes are
  // resales with no lifecycle signal of their own (no deprecation schedule,
  // upstream-driven churn) and they doubled the chart height. Venice stays in
  // the events swimlane, the check widget, and the events feed.
  const groups = [];
  for (const provider of PRICE_PROVIDERS) {
    const candidates = history.models
      .filter(m => m.provider === provider && m.history.length > 0)
      .map(m => {
        const dates = m.history.map(h => h.date).sort();
        const start = dates[0];
        const dep = depMap.get(normId(m.id)) || depMap.get(baseId(m.id));
        const cur = currentById[m.id];
        // Three ways a model ends: a documented shutdown (dep event), a
        // catalog deprecation, or silent removal — it just stops being listed
        // (xAI publishes no deprecation schedule at all). Silent removals end
        // at the last snapshot the model appeared in, marked "last seen".
        const docRetired = dep && dep.effective <= today;
        const delisted = !dep && !cur;
        const catalogDeprecated = cur?.availability === "deprecated";
        const activeEnd = docRetired ? dep.effective : delisted ? dates[dates.length - 1] : today;
        return { m, provider, start, dep, cur, delisted, retired: docRetired || delisted || catalogDeprecated, activeEnd };
      })
      .filter(r => !cutoff || new Date(r.activeEnd) >= cutoff || (r.dep && new Date(r.dep.effective) >= cutoff));
    // Priority: deprecation-window models (most recent shutdown first — the
    // sunsets the record is about), then curated family chains, then
    // longest-history actives. Collapsed to LIFE_ROWS_PER_PROVIDER by default
    // with a per-provider expander; the legend always counts the full record.
    const expanded = lifeExpanded.has(provider);
    const cap = expanded ? 80 : LIFE_ROWS_PER_PROVIDER;
    // Default view: the lineage story + what's dying — curated family chains
    // (alive AND dead, so the generational arc survives) plus every scheduled
    // sunset. The snapshot graveyard (dated variants, delisted previews)
    // appears on expand. Providers without curated chains fall back to living
    // models so their lanes aren't empty.
    const famIds = Object.entries(MODEL_FAMILIES).filter(([k]) => k.startsWith(provider + "/")).flatMap(([, ids]) => ids);
    const famRows = famIds.map(id => candidates.find(r => canonicalHistoryId(r.m.id) === canonicalHistoryId(id))).filter(Boolean);
    const picked = [];
    const seen = new Set();
    const take = (r) => { if (r && !seen.has(r.m.id) && picked.length < cap) { seen.add(r.m.id); picked.push(r); } };
    if (expanded) {
      for (const r of famRows) take(r);
      for (const r of candidates.filter(r => r.dep).sort((a, b) => b.dep.effective.localeCompare(a.dep.effective))) take(r);
      for (const r of [...candidates].sort((a, b) => b.m.history.length - a.m.history.length)) take(r);
    } else {
      for (const r of famRows) take(r);
      for (const r of candidates.filter(r => r.dep && r.dep.effective > today).sort((a, b) => a.dep.effective.localeCompare(b.dep.effective))) take(r);
      if (picked.length < 5) for (const r of candidates.filter(r => !r.retired).sort((a, b) => b.m.history.length - a.m.history.length)) take(r);
    }
    picked.sort((a, b) => a.start.localeCompare(b.start));
    if (picked.length) groups.push({
      provider, rows: picked, hidden: candidates.length - picked.length, expanded,
      hiddenRetired: expanded ? 0 : candidates.filter(r => r.retired).length,
      fullScheduled: candidates.filter(r => r.dep && r.dep.effective > today).length,
      fullRetired: candidates.filter(r => r.retired && !r.delisted).length,
      fullDelisted: candidates.filter(r => r.delisted).length,
      fullCount: candidates.length,
    });
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
  const rowH = 15, headH = 20, groupGap = 6, expH = 14;
  const height = padTop + groups.reduce((s, g) => s + headH + g.rows.length * rowH + ((g.hidden > 0 || g.expanded) ? expH : 0) + groupGap, 0) + padBottom;
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
      // price-change ticks: the model's pricing biography on its lane.
      // Green = price fell, red = rose (input rate). History is already
      // compressed to change points, so consecutive differing values = a change.
      const hist = (r.m.history ?? []).filter(h => h.input_cost_per_mtok != null && h.input_cost_per_mtok > 0);
      let priceChanges = 0, lastChange = null;
      for (let i = 1; i < hist.length; i++) {
        if (hist[i].input_cost_per_mtok === hist[i - 1].input_cost_per_mtok) continue;
        priceChanges++;
        const down = hist[i].input_cost_per_mtok < hist[i - 1].input_cost_per_mtok;
        lastChange = { date: hist[i].date, from: hist[i - 1].input_cost_per_mtok, to: hist[i].input_cost_per_mtok, down };
        const px = clampX(hist[i].date);
        const tick = document.createElementNS(ns, "path");
        tick.setAttribute("d", down ? `M ${px - 3} ${cy - 4} L ${px + 3} ${cy - 4} L ${px} ${cy + 1} Z` : `M ${px - 3} ${cy + 4} L ${px + 3} ${cy + 4} L ${px} ${cy - 1} Z`);
        tick.setAttribute("fill", down ? "var(--up)" : "var(--down)");
        tick.setAttribute("opacity", r.retired ? "0.5" : "0.95");
        svg.appendChild(tick);
      }
      r._priceChanges = priceChanges; r._lastChange = lastChange;
      if (r.delisted) {
        // silent removal: grey cap at last-seen — no documented shutdown
        const dx = clampX(r.activeEnd);
        const cap = document.createElementNS(ns, "rect");
        cap.setAttribute("x", String(dx - 1)); cap.setAttribute("y", String(cy - 5));
        cap.setAttribute("width", "2.5"); cap.setAttribute("height", "10");
        cap.setAttribute("fill", "var(--muted-2)");
        svg.appendChild(cap);
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
          : r.delisted
            ? `<div class="tbody">silently delisted · last seen ${r.activeEnd} · no deprecation schedule published</div>`
            : r.retired
              ? `<div class="tbody">marked deprecated in the catalog</div>`
              : `<div class="tbody">active · no scheduled retirement on record</div>`;
        tooltip.innerHTML = `
          <div class="tdate">${PROVIDER_LABELS[r.provider] || r.provider}</div>
          <div class="thead">${escapeHtml(r.m.display_name || r.m.id)}</div>
          <div class="tbody">first tracked ${r.start}${r._priceChanges ? ` · ${r._priceChanges} price change${r._priceChanges > 1 ? "s" : ""} (last ${r._lastChange.date}: $${r._lastChange.from} → $${r._lastChange.to}/Mtok in)` : " · no price changes on record"}</div>${dep}
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
    if (g.hidden > 0 || g.expanded) {
      const ex = document.createElementNS(ns, "text");
      ex.setAttribute("x", String(padLeft)); ex.setAttribute("y", String(y + 10));
      ex.setAttribute("fill", "#807c72"); ex.setAttribute("font-size", "9");
      ex.setAttribute("style", "cursor: pointer; text-transform: uppercase; letter-spacing: 0.05em;");
      ex.textContent = g.expanded ? "− collapse" : `+ ${g.hidden} snapshots & retired`;
      ex.addEventListener("click", () => { g.expanded ? lifeExpanded.delete(g.provider) : lifeExpanded.add(g.provider); renderChart(); });
      svg.appendChild(ex);
      y += expH;
    }
    y += groupGap;
  }

  const scheduled = groups.reduce((n, g) => n + g.fullScheduled, 0);
  const retired = groups.reduce((n, g) => n + g.fullRetired, 0);
  const delisted = groups.reduce((n, g) => n + g.fullDelisted, 0);
  const total = groups.reduce((n, g) => n + g.fullCount, 0);
  legend.innerHTML = `
    <span><span class="swatch" style="background: var(--text-dim); height: 3px;"></span>tracked lifespan</span>
    <span><span class="swatch" style="background: var(--warn); opacity: 0.4;"></span>deprecation window</span>
    <span><span class="swatch" style="background: var(--down); width: 3px;"></span>shutdown</span>
    <span><span class="swatch" style="background: var(--muted-2); width: 3px;"></span>silently delisted</span>
    <span>▾ <span style="color: var(--up)">price cut</span> · ▴ <span style="color: var(--down)">price rise</span></span>
    <span style="color: var(--muted-2);">${allRows.length} of ${total} models shown · ${scheduled} scheduled · ${retired} retired · ${delisted} silently delisted</span>
    <span style="margin-left: auto;"><a href="/events.json" target="_blank" rel="noopener" style="color: var(--text-dim); font-size: 11px;">try as json ↗</a></span>`;
}

// Shared tooltip positioner (restored — an old dead-code sweep removed it and
// silently broke every chart/swimlane hover with a ReferenceError).
function positionTooltip(tooltip, e, above = false) {
  const wrap = tooltip.parentElement.getBoundingClientRect();
  const x = e.clientX - wrap.left + 14;
  const tipH = tooltip.offsetHeight || 120;
  const y = above
    ? e.clientY - wrap.top - tipH - 14
    : e.clientY - wrap.top + 14;
  tooltip.style.left = `${Math.min(Math.max(0, x), wrap.width - (tooltip.offsetWidth || 280) - 10)}px`;
  tooltip.style.top = `${y}px`;
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

  // Lanes: only providers with events that actually plot after the severity
  // filter below (Venice has news events but nothing operational — no lane).
  const slPlotted = events.filter(e => e.severity !== "informational" || e.impact?.magnitude === "structural");
  const laneProviders = ACROSS_PROVIDERS.filter(p => slPlotted.some(e => (e.providers || []).includes(p)));

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
  for (const ev of slPlotted) {
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
