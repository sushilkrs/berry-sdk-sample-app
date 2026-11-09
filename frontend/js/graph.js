// "Knowledge graph" card on the student profile page (#/students/<id>).
//
// Visual language copied from berry-ai's Graph Explorer (src/components/knowledge-graphs/GraphCanvasPro.jsx):
// the same dark / light themes, node palette (PREFIX_COLOR + hashColor over EDGE_COLORS), glowing nodes,
// indigo edges, legend chips that hide a type, hover highlight of neighbours, and a details panel.
// Rendered with force-graph 1.51.4 (vendored), the engine behind react-force-graph-2d, which berry-ai
// ships as well; the explorer itself is React + reagraph and cannot be embedded in this plain-JS app.
//
// Data: GET /api/students/<id>/graph (this app's backend).
//
// student.js re-renders #view wholesale, so the card is ONE persistent element that a MutationObserver
// moves back to the END of the profile tab after every render (moving a node keeps its canvas and layout).

const THEMES = {
  dark: { bg: "linear-gradient(145deg, #0f0f1e 0%, #1a1a2e 50%, #16213e 100%)", canvasBg: "#12121f",
    headerBg: "rgba(15, 15, 30, 0.95)", text: "#e2e8f0", textMuted: "#94a3b8", textDim: "#64748b",
    panelBg: "rgba(15, 15, 30, 0.85)", panelBorder: "rgba(99, 102, 241, 0.2)", btnBg: "rgba(30, 30, 60, 0.8)",
    btnBorder: "rgba(99, 102, 241, 0.3)", labelColor: "#c7d2fe", labelStroke: "#0f0f1e", edgeColor: "#4f46e5",
    edgeActive: "#a78bfa", accent: "#a78bfa", node: { document: "#818cf8", entity: "#34d399" }, isDark: true },
  light: { bg: "linear-gradient(145deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%)", canvasBg: "#f8fafc",
    headerBg: "rgba(255, 255, 255, 0.95)", text: "#1e293b", textMuted: "#64748b", textDim: "#94a3b8",
    panelBg: "rgba(255, 255, 255, 0.9)", panelBorder: "rgba(148, 163, 184, 0.2)", btnBg: "rgba(255, 255, 255, 0.9)",
    btnBorder: "rgba(148, 163, 184, 0.3)", labelColor: "#334155", labelStroke: "#f8fafc", edgeColor: "#94a3b8",
    edgeActive: "#6366f1", accent: "#6366f1", node: { document: "#6366f1", entity: "#10b981" }, isDark: false },
};
const EDGE_COLORS = ["#6366f1", "#10b981", "#f97316", "#ec4899", "#8b5cf6", "#0ea5e9", "#f59e0b", "#14b8a6", "#ef4444", "#84cc16"];
const PREFIX_COLOR = { person: "#f97316", document: "#818cf8", entity: "#34d399", concept: "#f59e0b", category: "#84cc16",
  // types this app adds, picked from the same palette
  student: "#a78bfa", skill: "#10b981", company: "#0ea5e9", organization: "#0ea5e9", institution: "#14b8a6",
  degree: "#f59e0b", role: "#ec4899", location: "#84cc16", date: "#94a3b8" };
const TYPE_LABEL = { student: "Student", document: "Document", skill: "Skill", company: "Company", organization: "Organization",
  institution: "Institution", degree: "Degree", role: "Job title", location: "Location", person: "Person", date: "Date", entity: "Entity" };
const LAYOUTS = { force: null, radial: "radialout", tree: "td" };

function hashColor(s) {
  let h = 0;
  const str = String(s ?? "");
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return EDGE_COLORS[h % EDGE_COLORS.length];
}
const colorOf = (type, theme) => (theme.node[type] || PREFIX_COLOR[type] || hashColor(type));
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let libPromise = null;
function loadLib() {
  libPromise ||= new Promise((ok, bad) => {
    if (window.ForceGraph) return ok(window.ForceGraph);
    const s = document.createElement("script");
    s.src = "vendor/force-graph-1.51.4.min.js";
    s.onload = () => ok(window.ForceGraph);
    s.onerror = () => bad(new Error("Could not load the graph library"));
    document.head.append(s);
  });
  return libPromise;
}

const CSS = `
.kg-card{margin:16px 0;border-radius:14px;overflow:hidden;border:1px solid var(--kg-border);background:var(--kg-bg);position:relative;color:var(--kg-text)}
.kg-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;background:var(--kg-head);border-bottom:1px solid var(--kg-border)}
.kg-title{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px}
.kg-title .dot{width:10px;height:10px;border-radius:50%;background:var(--kg-accent);box-shadow:0 0 8px var(--kg-accent)}
.kg-badge{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--kg-border);color:var(--kg-muted)}
.kg-sp{flex:1}
.kg-chips{display:flex;gap:4px}
.kg-btn{font:inherit;font-size:12px;padding:4px 10px;border-radius:8px;border:1px solid var(--kg-btnb);background:var(--kg-btn);color:var(--kg-text);cursor:pointer}
.kg-btn.on{border-color:var(--kg-accent);box-shadow:0 0 0 1px var(--kg-accent) inset;color:var(--kg-accent)}
.kg-btn:hover{filter:brightness(1.15)}
.kg-search{font:inherit;font-size:12px;padding:5px 10px;border-radius:8px;border:1px solid var(--kg-btnb);background:var(--kg-btn);color:var(--kg-text);width:160px}
.kg-stage{position:relative;height:540px;background:var(--kg-canvas)}
.kg-msg[hidden]{display:none}
.kg-msg{position:absolute;inset:0;z-index:2;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;color:var(--kg-muted);font-size:13px;text-align:center;padding:20px}
.kg-spin{width:48px;height:48px;border-radius:50%;border:4px solid color-mix(in srgb,var(--kg-accent) 20%,transparent);border-top-color:var(--kg-accent);animation:kgspin 1s linear infinite}
@keyframes kgspin{to{transform:rotate(360deg)}}
.kg-legend{position:absolute;left:12px;bottom:12px;z-index:3;max-width:300px;padding:8px 10px;border-radius:12px;background:var(--kg-panel);border:1px solid var(--kg-border);backdrop-filter:blur(12px)}
.kg-legend h6,.kg-panel h6{margin:0 0 6px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--kg-dim)}
.kg-legend .row{display:flex;flex-wrap:wrap;gap:5px}
.kg-chip{display:inline-flex;align-items:center;gap:5px;font:inherit;font-size:10.5px;padding:2px 7px;border-radius:999px;border:1px solid var(--kg-border);background:var(--kg-panel);color:var(--kg-text);cursor:pointer}
.kg-chip.off{opacity:.35;text-decoration:line-through}
.kg-chip i{width:9px;height:9px;border-radius:50%;display:inline-block}
.kg-panel{position:absolute;top:12px;right:12px;bottom:12px;z-index:3;width:300px;max-width:calc(100% - 24px);overflow:auto;padding:14px;border-radius:12px;background:var(--kg-panel);border:1px solid var(--kg-border);backdrop-filter:blur(16px)}
.kg-panel .x{position:absolute;top:8px;right:10px;border:0;background:none;color:var(--kg-muted);font-size:18px;cursor:pointer}
.kg-panel .nm{display:flex;align-items:center;gap:8px;font-weight:700;font-size:14px;margin:0 22px 4px 0;word-break:break-word}
.kg-panel .nm i{width:12px;height:12px;border-radius:50%;flex:none}
.kg-panel .ty{font-size:11px;color:var(--kg-muted);margin-bottom:10px}
.kg-panel dl{margin:0 0 12px;display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:12px}
.kg-panel dt{color:var(--kg-dim)} .kg-panel dd{margin:0;word-break:break-word}
.kg-panel .src{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px}
.kg-panel .src span{font-size:10.5px;padding:2px 7px;border-radius:999px;border:1px solid var(--kg-border);color:var(--kg-muted)}
.kg-panel .nb{display:flex;flex-direction:column;gap:4px}
.kg-panel .nb button{display:flex;align-items:center;gap:6px;text-align:left;font:inherit;font-size:12px;padding:5px 8px;border-radius:8px;border:1px solid var(--kg-border);background:transparent;color:var(--kg-text);cursor:pointer}
.kg-panel .nb button i{width:8px;height:8px;border-radius:50%;flex:none}
.kg-panel .nb small{margin-left:auto;color:var(--kg-dim);font-size:10px}
.kg-foot{padding:8px 14px;font-size:11px;color:var(--kg-dim);border-top:1px solid var(--kg-border);background:var(--kg-head)}
`;

function applyTheme(el, t) {
  const v = { bg: t.bg, head: t.headerBg, text: t.text, muted: t.textMuted, dim: t.textDim, panel: t.panelBg, border: t.panelBorder,
    btn: t.btnBg, btnb: t.btnBorder, accent: t.accent, canvas: t.canvasBg };
  for (const [k, val] of Object.entries(v)) el.style.setProperty(`--kg-${k}`, val);
}

function createCard() {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  const el = document.createElement("section");
  el.className = "kg-card";
  el.id = "kg-card";
  el.innerHTML = `
    <div class="kg-head">
      <div class="kg-title"><span class="dot"></span>Knowledge graph</div>
      <span class="kg-badge" data-k="count">…</span>
      <span class="kg-sp"></span>
      <input class="kg-search" type="search" placeholder="Find a node…" data-k="search">
      <div class="kg-chips" data-k="layouts">
        <button class="kg-btn on" data-layout="force">Force</button>
        <button class="kg-btn" data-layout="radial">Radial</button>
        <button class="kg-btn" data-layout="tree">Tree</button>
      </div>
      <button class="kg-btn" data-act="fit" title="Fit to view">Fit</button>
      <button class="kg-btn" data-act="zin" title="Zoom in">+</button>
      <button class="kg-btn" data-act="zout" title="Zoom out">−</button>
      <button class="kg-btn" data-act="theme" title="Light / dark">◐</button>
      <button class="kg-btn" data-act="reload" title="Reload from BerryDB">↻</button>
    </div>
    <div class="kg-stage" data-k="stage">
      <div class="kg-msg" data-k="msg"><div class="kg-spin"></div>Loading knowledge graph…</div>
    </div>
    <div class="kg-foot" data-k="foot"></div>`;
  return el;
}

const S = { el: null, fg: null, sid: null, data: null, theme: "dark", layout: "force", hidden: new Set(), hover: null,
  selected: null, neighbours: new Map(), query: "", ro: null };

function neighboursOf(id) { return S.neighbours.get(id) || new Set(); }

function visibleData() {
  const nodes = S.data.nodes.filter((n) => !S.hidden.has(n.type));
  const ids = new Set(nodes.map((n) => n.id));
  const links = S.data.links.filter((l) => ids.has(l._s) && ids.has(l._t));
  return { nodes, links };
}

function renderLegend() {
  const t = THEMES[S.theme];
  const counts = {};
  S.data.nodes.forEach((n) => { counts[n.type] = (counts[n.type] || 0) + 1; });
  const ecounts = {};
  S.data.links.forEach((l) => { ecounts[l.label] = (ecounts[l.label] || 0) + 1; });
  let lg = S.el.querySelector(".kg-legend");
  if (!lg) { lg = document.createElement("div"); lg.className = "kg-legend"; S.el.querySelector("[data-k=stage]").append(lg); }
  lg.innerHTML = `<h6>Node types</h6><div class="row">${Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map((ty) => {
    const c = colorOf(ty, t);
    return `<button class="kg-chip${S.hidden.has(ty) ? " off" : ""}" data-type="${esc(ty)}" title="${S.hidden.has(ty) ? "Show" : "Hide"} ${esc(TYPE_LABEL[ty] || ty)}"><i style="background:${c};box-shadow:0 0 4px ${c}80"></i>${esc(TYPE_LABEL[ty] || ty)} ${counts[ty]}</button>`;
  }).join("")}</div><h6 style="margin-top:8px">Relationships</h6><div class="row">${Object.entries(ecounts).map(([k, v]) =>
    `<span class="kg-chip" style="cursor:default"><i style="background:${hashColor(k)}"></i>${esc(k)} ${v}</span>`).join("")}</div>`;
}

function showPanel(node) {
  S.selected = node ? node.id : null;
  let p = S.el.querySelector(".kg-panel");
  if (!node) { p?.remove(); return; }
  const t = THEMES[S.theme];
  if (!p) { p = document.createElement("div"); p.className = "kg-panel"; S.el.querySelector("[data-k=stage]").append(p); }
  const c = colorOf(node.type, t);
  const props = Object.entries(node.data || {}).filter(([, v]) => v !== null && v !== "" && typeof v !== "object");
  const lists = Object.entries(node.data || {}).filter(([, v]) => Array.isArray(v));
  const links = S.data.links.filter((l) => l._s === node.id || l._t === node.id);
  const byId = new Map(S.data.nodes.map((n) => [n.id, n]));
  p.style.boxShadow = `0 0 20px ${c}30`;
  p.innerHTML = `<button class="x" data-act="close" title="Close">×</button>
    <div class="nm"><i style="background:${c};box-shadow:0 0 6px ${c}80"></i>${esc(node.label)}</div>
    <div class="ty">${esc(TYPE_LABEL[node.type] || node.type)} · <span style="font-family:ui-monospace,monospace">${esc(node.id.length > 48 ? node.id.slice(0, 48) + "…" : node.id)}</span></div>
    <h6>From</h6><div class="src">${(node.sources || []).map((s) => `<span>${esc(s)}</span>`).join("")}</div>
    ${props.length || lists.length ? `<h6>Properties</h6><dl>${props.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}${
      lists.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v.length} item(s)</dd>`).join("")}</dl>` : ""}
    <h6>Connections (${links.length})</h6><div class="nb">${links.map((l) => {
      const other = byId.get(l._s === node.id ? l._t : l._s);
      if (!other) return "";
      const oc = colorOf(other.type, t);
      return `<button data-goto="${esc(other.id)}"><i style="background:${oc}"></i>${l._s === node.id ? "→" : "←"} ${esc(other.label)}<small>${esc(l.label)}</small></button>`;
    }).join("")}</div>`;
}

function focus(id) {
  const n = S.data.nodes.find((x) => x.id === id);
  if (!n) return;
  showPanel(n);
  if (n.x !== undefined) { S.fg.centerAt(n.x, n.y, 600); S.fg.zoom(2.6, 600); }
}

function isLit(id) {
  const focusId = S.hover || S.selected;
  if (S.query) return S.data.nodes.find((n) => n.id === id)?.label.toLowerCase().includes(S.query);
  if (!focusId) return true;
  return id === focusId || neighboursOf(focusId).has(id);
}

function draw() {
  const t = THEMES[S.theme];
  applyTheme(S.el, t);
  S.fg.backgroundColor(t.canvasBg)
    .nodeCanvasObject((n, ctx, scale) => {
      const c = colorOf(n.type, t);
      const r = n.type === "student" ? 9 : n.type === "document" ? 7 : 5 + Math.min(3, (neighboursOf(n.id).size - 1) * 0.6);
      const lit = isLit(n.id);
      ctx.globalAlpha = lit ? 1 : 0.18;
      ctx.shadowColor = c;
      ctx.shadowBlur = (n.id === S.selected || n.id === S.hover) ? 22 : 10;
      ctx.beginPath();
      if (n.type === "document") ctx.rect(n.x - r, n.y - r, r * 2, r * 2); else ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = c;
      ctx.fill();
      ctx.shadowBlur = 0;
      if (n.id === S.selected) { ctx.lineWidth = 2 / scale; ctx.strokeStyle = t.accent; ctx.stroke(); }
      if (scale > 0.9 || n.type === "student" || n.id === S.hover || n.id === S.selected) {
        const fs = Math.max(10 / scale, 2.4);
        const label = n.label.length > 34 ? `${n.label.slice(0, 33)}…` : n.label;
        ctx.font = `${n.type === "student" ? "600 " : ""}${fs}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.lineWidth = 3 / scale;
        ctx.strokeStyle = t.labelStroke;
        ctx.strokeText(label, n.x, n.y + r + 2 / scale);
        ctx.fillStyle = (n.id === S.selected || n.id === S.hover) ? t.accent : t.labelColor;
        ctx.fillText(label, n.x, n.y + r + 2 / scale);
      }
      ctx.globalAlpha = 1;
      n.__r = r;
    })
    .nodePointerAreaPaint((n, color, ctx) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(n.x, n.y, (n.__r || 6) + 2, 0, 2 * Math.PI); ctx.fill(); })
    .linkColor((l) => {
      const focusId = S.hover || S.selected;
      const active = focusId && (l._s === focusId || l._t === focusId);
      if (active) return t.edgeActive;
      return focusId || S.query ? `${t.edgeColor}1f` : `${t.edgeColor}8c`;
    })
    .linkWidth((l) => ((S.hover || S.selected) && (l._s === (S.hover || S.selected) || l._t === (S.hover || S.selected)) ? 2 : 1))
    .linkDirectionalArrowLength(3.5)
    .linkDirectionalArrowRelPos(1)
    .linkDirectionalArrowColor(() => t.edgeColor)
    .linkLabel((l) => esc(l.label))
    .linkCanvasObjectMode(() => "after")
    .linkCanvasObject((l, ctx, scale) => {
      const focusId = S.hover || S.selected;
      if (!(focusId && (l._s === focusId || l._t === focusId)) || scale < 1.2) return;
      const a = l.source, b = l.target;
      if (a.x === undefined || b.x === undefined) return;
      const fs = Math.max(8 / scale, 2);
      ctx.font = `${fs}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 3 / scale; ctx.strokeStyle = t.labelStroke;
      ctx.strokeText(l.label, (a.x + b.x) / 2, (a.y + b.y) / 2);
      ctx.fillStyle = t.textMuted;
      ctx.fillText(l.label, (a.x + b.x) / 2, (a.y + b.y) / 2);
    });
  renderLegend();
  if (S.selected) showPanel(S.data.nodes.find((n) => n.id === S.selected));
}

function setData() {
  const v = visibleData();
  S.fg.dagMode(LAYOUTS[S.layout]).dagLevelDistance(S.layout === "force" ? null : 70).graphData(v);
  S.fg.d3Force("charge").strength(-160);
  S.fg.d3Force("link").distance((l) => (l.label === "HAS_DOCUMENT" ? 70 : 55));
  setTimeout(() => S.fg.zoomToFit(500, 50), 900);
}

async function load(sid) {
  const msg = S.el.querySelector("[data-k=msg]");
  msg.hidden = false;
  msg.innerHTML = `<div class="kg-spin"></div>Loading knowledge graph…`;
  let res;
  try {
    const [lib, r] = await Promise.all([loadLib(), fetch(`/api/students/${encodeURIComponent(sid)}/graph`, { credentials: "same-origin" })]);
    res = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(res.detail || `HTTP ${r.status}`);
    if (sid !== S.sid) return;
    S.data = { nodes: res.nodes.map((n) => ({ ...n })), links: res.edges.map((e) => ({ ...e, _s: e.source, _t: e.target })) };
    S.neighbours = new Map();
    S.data.links.forEach((l) => {
      if (!S.neighbours.has(l._s)) S.neighbours.set(l._s, new Set());
      if (!S.neighbours.has(l._t)) S.neighbours.set(l._t, new Set());
      S.neighbours.get(l._s).add(l._t); S.neighbours.get(l._t).add(l._s);
    });
    const stage = S.el.querySelector("[data-k=stage]");
    if (!S.fg) {
      const host = document.createElement("div");
      stage.prepend(host);
      S.fg = lib()(host)
        .nodeId("id").nodeLabel(() => "")
        .cooldownTicks(200)
        .onNodeHover((n) => { S.hover = n ? n.id : null; stage.style.cursor = n ? "pointer" : "default"; })
        .onNodeClick((n) => focus(n.id))
        .onBackgroundClick(() => showPanel(null));
      S.ro = new ResizeObserver(() => S.fg.width(stage.clientWidth).height(stage.clientHeight));
      S.ro.observe(stage);
      S.fg.width(stage.clientWidth).height(stage.clientHeight);
    }
    draw();
    setData();
    const c = res.counts || {};
    S.el.querySelector("[data-k=count]").textContent = `${c.nodes} nodes · ${c.edges} edges`;
    const src = res.sources || {};
    S.el.querySelector("[data-k=foot]").innerHTML = `Profile: BerryDB <b>${esc(src.profile_database)}</b> · documents: <b>${esc(src.documents_database)}</b> · entities: ${
      c.ugs_entities ? `${c.ugs_entities} from BerryDB's graph (universal-graph-service)` : ""}${c.ugs_entities && c.ner_entities ? " + " : ""}${
      c.ner_entities ? `${c.ner_entities} from the NER annotation` : ""}${!c.ugs_entities && !c.ner_entities ? "none yet (run Entities on a document)" : ""}${
      (res.notes || []).length ? ` · ${esc(res.notes.join(" · "))}` : ""}`;
    msg.hidden = res.nodes.length > 1;
    if (!msg.hidden) msg.innerHTML = "No graph yet: upload a resume on the Documents tab, then run entity recognition.";
  } catch (e) {
    msg.hidden = false;
    msg.textContent = `Could not load the knowledge graph: ${e.message}`;
  }
}

function wire() {
  S.el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.layout) {
      S.layout = b.dataset.layout;
      S.el.querySelectorAll("[data-layout]").forEach((x) => x.classList.toggle("on", x === b));
      setData();
    } else if (b.dataset.type) {
      S.hidden.has(b.dataset.type) ? S.hidden.delete(b.dataset.type) : S.hidden.add(b.dataset.type);
      setData(); renderLegend();
    } else if (b.dataset.goto) focus(b.dataset.goto);
    else if (b.dataset.act === "close") showPanel(null);
    else if (b.dataset.act === "fit") S.fg?.zoomToFit(400, 50);
    else if (b.dataset.act === "zin") S.fg?.zoom(S.fg.zoom() * 1.4, 300);
    else if (b.dataset.act === "zout") S.fg?.zoom(S.fg.zoom() / 1.4, 300);
    else if (b.dataset.act === "theme") { S.theme = S.theme === "dark" ? "light" : "dark"; if (S.fg) draw(); else applyTheme(S.el, THEMES[S.theme]); }
    else if (b.dataset.act === "reload" && S.sid) load(S.sid);
  });
  S.el.querySelector("[data-k=search]").addEventListener("input", (e) => {
    S.query = e.target.value.trim().toLowerCase();
    const hit = S.query && S.data?.nodes.find((n) => n.label.toLowerCase().includes(S.query));
    if (hit && hit.x !== undefined) S.fg.centerAt(hit.x, hit.y, 400);
  });
}

function profileRoute() {
  const m = location.hash.match(/^#\/students\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function place() {
  const sid = profileRoute();
  const body = document.getElementById("tab-body");
  if (!sid || !body) return;
  if (!S.el) { S.el = createCard(); applyTheme(S.el, THEMES[S.theme]); wire(); }
  if (body.lastElementChild !== S.el) body.append(S.el);  // always the last section of the profile tab
  if (S.sid !== sid) {
    S.sid = sid; S.selected = null; S.hover = null; S.hidden.clear();
    S.el.querySelector(".kg-panel")?.remove();
    load(sid);
  }
}

const view = document.getElementById("view");
if (view) new MutationObserver(place).observe(view, { childList: true, subtree: true });
window.addEventListener("hashchange", place);
place();
