// Resume KG Playground UI. Talks only to this app's backend (/api/*); the backend talks to BerryDB.
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = { files: [], selected: null, detail: null, tab: "profile", query: "", timer: null };

const ENTITY_COLORS = { PERSON: "--e-person", ORGANIZATION: "--e-org", LOCATION: "--e-loc", DATE: "--e-date" };
const entColor = (label) => `var(${ENTITY_COLORS[label] || "--e-other"})`;
const ENTITY_NAMES = { PERSON: "People", ORGANIZATION: "Organizations", LOCATION: "Locations", DATE: "Dates" };

const ICON = {
  file: '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm7 0v5h5"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M4 12h12m0 0-5-5m5 5-5 5M20 5v14"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/></svg>',
  disk: '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4zM4 15h16M8 18h.01"/></svg>',
  db: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7Z"/></svg>',
};

// ---------- helpers ----------
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail || `Request failed (HTTP ${r.status})`);
  return body;
}
function toast(msg, bad = false) {
  const t = document.createElement("div");
  t.className = `toast${bad ? " bad" : ""}`;
  t.textContent = msg;
  $("#toasts").append(t);
  setTimeout(() => t.remove(), bad ? 7000 : 3500);
}
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (s) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
function ago(s) {
  if (!s) return "";
  const sec = Math.round((Date.now() - new Date(s)) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  return new Date(s).toLocaleDateString();
}
function initials(f) {
  const n = f.candidate_name || f.file_name.replace(/\.pdf$/i, "").replace(/[_\d]+/g, " ");
  return n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}
const displayName = (f) => f.candidate_name || f.file_name;
const url = (u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

function statusBadge(f) {
  if (f.status === "stored" || f.status === "sending") return '<span class="badge warn"><span class="spin"></span>Sending to BerryDB</span>';
  if (f.status === "failed") return '<span class="badge bad">Failed</span>';
  if (f.ner_status === "requested") return '<span class="badge warn"><span class="spin"></span>Finding entities</span>';
  if (f.ner_status === "done") return `<span class="badge ok">Extracted · ${f.entity_count} entities</span>`;
  if (f.ner_status === "failed") return '<span class="badge bad">NER failed</span>';
  return '<span class="badge info">Extracted</span>';
}
// Where each piece of information comes from, shown next to it on screen.
const SRC = {
  app: (what = "") => `<span class="src app" title="From this app's SQLite database (data/app.db, table files)${what ? ": " + what : ""}">App DB</span>`,
  berry: (what = "") => `<span class="src berry" title="From BerryDB, read live through the SDK${what ? ": " + what : ""}">BerryDB</span>`,
  copied: () => `<span class="src app" title="Stored in the app's SQLite database; the value was copied from the BerryDB record after extraction">App DB · copied from BerryDB</span>`,
};

const busy = (f) => f.status === "stored" || f.status === "sending" || f.ner_status === "requested";

// ---------- list ----------
function renderList() {
  const q = state.query.toLowerCase();
  const files = state.files.filter((f) => !q || [f.candidate_name, f.job_title, f.location, f.file_name]
    .some((v) => (v || "").toLowerCase().includes(q)));
  const done = state.files.filter((f) => f.status === "ingested").length;
  $("#counts").textContent = state.files.length
    ? `${state.files.length} resume${state.files.length > 1 ? "s" : ""} · ${done} extracted by BerryDB` : "";
  $("#counts").innerHTML = state.files.length ? `${esc($("#counts").textContent)} ${SRC.copied()}` : "";
  $("#list").innerHTML = files.length ? files.map((f) => `
    <li class="item${f.id === state.selected ? " sel" : ""}" data-id="${f.id}">
      <div class="avatar">${esc(initials(f))}</div>
      <div class="body">
        <div class="name">${esc(displayName(f))}</div>
        <div class="sub">${esc([f.job_title, f.location].filter(Boolean).join(" · ") || f.file_name)}</div>
        <div class="meta">${statusBadge(f)}<span class="muted" style="font-size:11px">${ago(f.uploaded_at)}</span></div>
      </div>
    </li>`).join("")
    : `<li class="nolist">${state.files.length ? "No resumes match your search." : "No resumes yet. Upload a PDF to start."}</li>`;
}

async function loadFiles() {
  state.files = await api("/api/files");
  renderList();
}

// ---------- detail ----------
function pipeline(f, d) {
  const sent = f.status === "ingested";
  const steps = [
    { name: "Uploaded", done: true, note: when(f.uploaded_at) },
    { name: "Saved locally", done: true, note: size(f.file_size) },
    { name: "Sent to BerryDB", done: sent || f.status === "failed", active: f.status === "sending" || f.status === "stored",
      failed: f.status === "failed", note: f.status === "failed" ? "failed" : sent ? when(f.ingested_at) : "in progress" },
    { name: "Profile extracted", done: sent, note: sent ? `${f.fields_filled ?? "?"} fields · ${f.pages ?? "?"} page(s)` : "waiting" },
    { name: "Entities (NER)", done: f.ner_status === "done", active: f.ner_status === "requested", failed: f.ner_status === "failed",
      note: f.ner_status === "done" ? `${f.entity_count} found` : f.ner_status === "requested" ? "running in BerryDB" :
        f.ner_status === "failed" ? "failed" : "not run yet" },
  ];
  return `<div class="card-head"><b style="font-size:12px">Processing status</b>${SRC.app("status, timestamps and counts are written by the backend as each step finishes")}</div>
  <div class="pipeline">${steps.map((s) => `
    <div class="step${s.failed ? " failed" : s.done ? " done" : s.active ? " active" : ""}">
      <span class="mark"></span><b>${s.name}</b><small>${esc(s.note)}</small>
    </div>`).join("")}</div>`;
}

function hero(f, p) {
  const links = p ? [
    p.email && `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>`,
    p.linkedInUrl && `<a href="${esc(url(p.linkedInUrl))}" target="_blank" rel="noopener">LinkedIn</a>`,
    p.githubUrl && `<a href="${esc(url(p.githubUrl))}" target="_blank" rel="noopener">GitHub</a>`,
    p.portfolioUrl && `<a href="${esc(url(p.portfolioUrl))}" target="_blank" rel="noopener">Portfolio</a>`,
  ].filter(Boolean) : [];
  const canNer = !!f.berry_record_id && f.ner_status !== "requested";
  return `
    <div class="hero">
      <div class="who">
        <div class="avatar">${esc(initials(f))}</div>
        <div style="min-width:0">
          <h2>${esc(p?.fullName || f.file_name)} ${p?.fullName ? SRC.berry("fullName, jobTitle, location, email and links of the record") : SRC.app("file_name; BerryDB has not returned a profile yet")}</h2>
          <div class="title">${esc([p?.jobTitle, p?.location].filter(Boolean).join(" · ") || "Profile not extracted yet")}</div>
          ${links.length ? `<div class="links">${links.join("")}</div>` : ""}
        </div>
      </div>
      <div class="actions">
        <a class="btn" href="/api/files/${f.id}/download" target="_blank" rel="noopener">${ICON.file}View PDF</a>
        ${f.berry_record_id ? `<button class="btn primary" data-act="ner" ${canNer ? "" : "disabled"}>${ICON.spark}${
          f.ner_status === "done" ? "Re-run entities" : f.ner_status === "requested" ? "Finding entities…" : "Find entities"}</button>` : ""}
        ${f.status === "failed" ? `<button class="btn primary" data-act="send">${ICON.send}Retry send</button>` : ""}
        <button class="btn danger" data-act="delete">${ICON.trash}Delete</button>
      </div>
    </div>`;
}

function profileTab(p) {
  if (!p) return `<div class="card section muted">BerryDB has not returned a profile for this file yet.</div>`;
  const jobs = (p.workExperience || []).filter((w) => w && (w.company || w.details));
  return `
    <div class="card section"><h3>Summary ${SRC.berry("professionalSummary")}</h3><p>${esc(p.professionalSummary) || '<span class="muted">No summary found.</span>'}</p></div>
    <div class="card section"><h3>Skills <span class="muted">(${(p.skillsList || []).length})</span> ${SRC.berry("skillsList")}</h3>
      ${(p.skillsList || []).length ? `<div class="chips">${p.skillsList.map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div>`
        : '<span class="muted">No skills found.</span>'}</div>
    <div class="cols">
      <div class="card section"><h3>Experience ${SRC.berry("workExperience")}</h3>
        ${jobs.length ? `<div class="timeline">${jobs.map((w) => `<div class="job"><b>${esc(w.company || "Company not named")}</b><p>${esc(w.details)}</p></div>`).join("")}</div>`
          : '<span class="muted">No work experience found.</span>'}</div>
      <div class="card section"><h3>Education ${SRC.berry("degreeName, institutionName, graduationYear")}</h3>
        ${p.degreeName || p.institutionName ? `<div class="job"><b>${esc(p.degreeName || "Degree not named")}</b>
          <p>${esc([p.institutionName, p.graduationYear].filter(Boolean).join(" · "))}</p></div>` : '<span class="muted">No education found.</span>'}
        ${(p.academicUnits || []).length > 1 ? `<h3 style="margin-top:16px">Academic units</h3><div class="chips">${p.academicUnits.map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div>` : ""}
      </div>
    </div>`;
}

function entitiesTab(d) {
  const f = d.file;
  if (!d.entity_groups.length) {
    return `<div class="card section">
      <p>${f.ner_status === "requested" ? "BerryDB is finding entities in this resume. This usually takes a few seconds."
        : "No entities yet. <b>Find entities</b> asks BerryDB to run named-entity recognition on the resume text and save the results on the record."}</p></div>`;
  }
  const run = d.ner_run;
  return `
    <div class="card section">
      <h3>Entities found by BerryDB <span class="muted">(${d.entities.length} mentions)</span> ${SRC.berry("annotations on the record, written by BerryDB's NER")}</h3>
      ${d.entity_groups.map((g) => `
        <div class="ent-group" style="--c:${entColor(g.label)}">
          <div class="ent-label"><i></i>${esc(ENTITY_NAMES[g.label] || g.label)} <small>${g.values.length}</small></div>
          <div class="chips">${g.values.map((v) => `<span class="ent">${esc(v)}</span>`).join("")}</div>
        </div>`).join("")}
    </div>
    ${run ? `<div class="card section"><h3>How BerryDB ran it ${SRC.berry("the NER run details BerryDB saved with the annotations")}</h3><dl class="kv">
      <dt>Provider / task</dt><dd>${esc(run.provider)} · ${esc(run.model)}</dd>
      <dt>Time</dt><dd>${run.elapsed_ms ?? "?"} ms</dd>
      ${run.usage ? `<dt>Tokens</dt><dd>${run.usage.total_tokens} total (${run.usage.cached_tokens} cached)</dd>
      <dt>Cost estimate</dt><dd>$${Number(run.usage.cost_estimate_usd || 0).toFixed(4)}</dd>` : ""}
      <dt>Requested</dt><dd>${when(f.ner_requested_at) || "—"} ${SRC.app("ner_requested_at")}</dd></dl></div>` : ""}`;
}

function highlighted(text, ents) {
  let out = "", pos = 0;
  for (const e of ents) {
    if (e.start == null || e.end == null || e.start < pos || e.end > text.length) continue;
    out += esc(text.slice(pos, e.start)) +
      `<mark style="--c:${entColor(e.label)}" title="${esc(e.label)}">${esc(text.slice(e.start, e.end))}</mark>`;
    pos = e.end;
  }
  return out + esc(text.slice(pos));
}

function textTab(d) {
  if (!d.text) return `<div class="card section muted">No text stored on the BerryDB record.</div>`;
  const labels = [...new Set(d.entities.map((e) => e.label))];
  return `<div class="card section">
    <h3>${SRC.berry("content.text, plus the entity positions from annotations")} Resume text as stored in BerryDB <span class="muted">(${d.text.length} characters, field ${esc(d.file.text_field || "content.text")})</span></h3>
    ${labels.length ? `<div class="legend">${labels.map((l) => `<span style="--c:${entColor(l)}"><i></i>${esc(ENTITY_NAMES[l] || l)}</span>`).join("")}</div>` : ""}
    <div class="doc-text">${highlighted(d.text, d.entities)}</div></div>`;
}

function lineageTab(d) {
  const f = d.file, m = d.berry_meta;
  return `
    <div class="cols">
      <div class="card section store">
        <h4>${ICON.disk} Local disk ${SRC.app("path, size, type and hash are recorded in the files table")}</h4><div class="where">The original file, kept by this app</div>
        <dl class="kv"><dt>Path</dt><dd class="mono">${esc(f.file_path)}</dd><dt>Size</dt><dd>${size(f.file_size)} (${f.file_size} bytes)</dd>
          <dt>Type</dt><dd>${esc(f.file_type)}</dd><dt>SHA-256</dt><dd class="mono">${esc(f.sha256)}</dd></dl>
        <div class="how">Written by the backend on upload (<span class="mono">backend/main.py</span>, <span class="mono">upload</span>).</div>
      </div>
      <div class="card section store">
        <h4>${ICON.db} App database ${SRC.app()}</h4><div class="where">SQLite <span class="mono">data/app.db</span>, table <span class="mono">files</span>, one row per upload</div>
        <dl class="kv">
          <dt>Row id</dt><dd class="mono">${esc(f.id)}</dd><dt>Status</dt><dd>${esc(f.status)}</dd>
          <dt>Uploaded</dt><dd>${when(f.uploaded_at)}</dd><dt>Sent to BerryDB</dt><dd>${when(f.ingested_at) || "—"}</dd>
          <dt>BerryDB record</dt><dd class="mono">${esc(f.berry_record_id || "—")}</dd>
          <dt>Fields filled</dt><dd>${f.fields_filled ?? "—"}</dd><dt>NER</dt><dd>${esc(f.ner_status || "not run")}${f.entity_count ? `, ${f.entity_count} entities` : ""}</dd>
          ${f.error ? `<dt>Error</dt><dd style="color:var(--bad)">${esc(f.error)}</dd>` : ""}
        </dl>
        <div class="how">Name, title and location are copied here from BerryDB so the list loads without calling BerryDB.</div>
      </div>
    </div>
    <div class="card section store">
      <h4>${ICON.cloud} BerryDB ${SRC.berry("the record's _meta and id")}</h4><div class="where">The structured profile, full text and entities, in the hosted BerryDB</div>
      ${m ? `<dl class="kv">
        <dt>Organization</dt><dd>${esc(m.organization)}</dd><dt>Database</dt><dd>${esc(m.database)} (id ${esc(m.databaseId)})</dd>
        <dt>Record id</dt><dd class="mono">${esc(m.id)}</dd><dt>Written</dt><dd>${when(m.uploadedTime) || "—"}</dd>
        <dt>appFileId on record</dt><dd class="mono">${esc(m.appFileId || "—")}</dd></dl>` : `<p class="muted">${esc(d.berry_error || "Not in BerryDB yet.")}</p>`}
      <div class="how">
        <b>Written by</b> <span class="mono">POST /berrydb/ingest/structured</span> with the PDF itself (direct API call; SDK 1.7.7 only sends URLs).<br>
        <b>Read by</b> the SDK, <span class="mono">db.get_all_documents(document_ids=[id])</span>, every time this page opens.<br>
        <b>Entities by</b> the SDK, <span class="mono">db.ner("content.text", [id], annotate=True)</span>; BerryDB saves them on the same record.
      </div>
    </div>`;
}

function rawTab(d) {
  return `<div class="cols">
    <div class="card section"><h3>App database row ${SRC.app()}</h3><pre class="json">${esc(JSON.stringify(d.file, null, 2))}</pre></div>
    <div class="card section"><h3>BerryDB record ${SRC.berry()}</h3><pre class="json">${esc(d.record ? JSON.stringify(d.record, null, 2) : "Not available")}</pre></div>
  </div>`;
}

const TABS = [
  ["profile", "Profile", () => profileTab(state.detail.profile)],
  ["entities", "Entities", () => entitiesTab(state.detail), (d) => d.entity_groups.length],
  ["text", "Resume text", () => textTab(state.detail)],
  ["lineage", "Where data lives", () => lineageTab(state.detail)],
  ["raw", "Raw JSON", () => rawTab(state.detail)],
];

function renderDetail() {
  const d = state.detail;
  if (!d) return;
  const f = d.file;
  const alert = f.status === "failed" ? `<div class="alert bad"><b>BerryDB could not process this file.</b> ${esc(f.error)}</div>`
    : d.berry_error ? `<div class="alert warn">${esc(d.berry_error)}</div>`
    : f.ner_status === "failed" ? `<div class="alert bad"><b>Entity recognition failed.</b> ${esc(f.ner_error)}</div>` : "";
  $("#main").innerHTML = `
    <div class="card">${hero(f, d.profile)}${alert}${pipeline(f, d)}</div>
    <div class="tabs">${TABS.map(([k, label, , count]) => {
      const n = count ? count(d) : 0;
      return `<button class="tab${state.tab === k ? " on" : ""}" data-tab="${k}">${label}${n ? `<span class="n">${n}</span>` : ""}</button>`;
    }).join("")}</div>
    <div class="panel">${TABS.find(([k]) => k === state.tab)[2]()}</div>`;
}

async function select(id, quiet = false) {
  if (state.selected !== id) state.tab = "profile";
  state.selected = id;
  renderList();
  try {
    state.detail = await api(`/api/files/${id}`);
    renderDetail();
  } catch (e) {
    if (!quiet) toast(e.message, true);
  }
}

// ---------- polling while something runs ----------
async function tick() {
  clearTimeout(state.timer);
  try {
    await loadFiles();
    const sel = state.files.find((f) => f.id === state.selected);
    if (sel && (busy(sel) || state.detail?.file.status !== sel.status)) await select(sel.id, true);
  } catch { /* the next tick tries again */ }
  if (state.files.some(busy)) state.timer = setTimeout(tick, 3000);
}

// ---------- actions ----------
async function upload(list) {
  if (!list.length) return;
  const form = new FormData();
  [...list].forEach((f) => form.append("files", f));
  $("#uploads").innerHTML = `<div class="upnote">Uploading ${list.length} file(s)…</div>`;
  try {
    const res = await api("/api/files", { method: "POST", body: form });
    const bad = res.filter((r) => r.error);
    $("#uploads").innerHTML = bad.map((r) => `<div class="upnote bad">${esc(r.file_name)}: ${esc(r.error)}</div>`).join("");
    const ok = res.filter((r) => !r.error);
    if (ok.length) toast(`${ok.length} file(s) saved, sending to BerryDB`);
    await tick();
    if (ok.length === 1) select(ok[0].id);
  } catch (e) {
    $("#uploads").innerHTML = `<div class="upnote bad">${esc(e.message)}</div>`;
  }
}

async function act(kind, btn) {
  const id = state.selected;
  if (kind === "delete") {
    if (!confirm("Delete this resume? This removes the local file, the app database row and the BerryDB record.")) return;
    await api(`/api/files/${id}`, { method: "DELETE" });
    state.selected = null; state.detail = null;
    $("#main").innerHTML = $("#empty-tpl").innerHTML;
    toast("Deleted from the app and BerryDB");
    return loadFiles();
  }
  btn.disabled = true;
  if (kind === "ner") {
    await api(`/api/files/${id}/ner`, { method: "POST" });
    state.tab = "entities";
    toast("BerryDB is finding entities");
  }
  if (kind === "send") {
    await api(`/api/files/${id}/send`, { method: "POST" });
    toast("Sending to BerryDB again");
  }
  await tick();
  await select(id, true);
}

// ---------- events ----------
document.addEventListener("click", async (e) => {
  const item = e.target.closest(".item");
  if (item) return select(item.dataset.id);
  const tab = e.target.closest("[data-tab]");
  if (tab) { state.tab = tab.dataset.tab; return renderDetail(); }
  const btn = e.target.closest("[data-act]");
  if (btn) {
    try { await act(btn.dataset.act, btn); } catch (err) { toast(err.message, true); btn.disabled = false; }
  }
});
$("#search").addEventListener("input", (e) => { state.query = e.target.value; renderList(); });
$("#picker").addEventListener("change", (e) => { upload(e.target.files); e.target.value = ""; });
const drop = $("#drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => upload(e.dataTransfer.files));

// keep the empty state to restore after a delete
const tpl = document.createElement("template");
tpl.id = "empty-tpl";
tpl.innerHTML = $("#main").innerHTML;
document.body.append(tpl);

api("/api/health").then((h) => {
  const c = $("#conn");
  c.classList.add(h.berry_reachable ? "ok" : "bad");
  c.lastElementChild.textContent = h.berry_reachable ? `BerryDB connected · ${h.berry_database}` : "BerryDB not reachable";
  c.title = `${h.berry_host} · schema ${h.berry_schema}`;
}).catch(() => { $("#conn").classList.add("bad"); $("#conn").lastElementChild.textContent = "App backend not running"; });
tick();
