// One document's detail: what this app recorded and what BerryDB extracted from it.
import { ICON, SRC, esc, href, size, when } from "./common.js";

const ENTITY_COLORS = { PERSON: "--e-person", ORGANIZATION: "--e-org", LOCATION: "--e-loc", DATE: "--e-date" };
const entColor = (label) => `var(${ENTITY_COLORS[label] || "--e-other"})`;
const ENTITY_NAMES = { PERSON: "People", ORGANIZATION: "Organizations", LOCATION: "Locations", DATE: "Dates" };

function pipeline(f) {
  const sent = f.status === "ingested";
  const steps = [
    { name: "Uploaded", done: true, note: when(f.uploaded_at) },
    { name: "Saved locally", done: true, note: size(f.file_size) },
    { name: "Sent to BerryDB", done: sent || f.status === "failed", active: f.status === "sending" || f.status === "stored",
      failed: f.status === "failed", note: f.status === "failed" ? "failed" : sent ? when(f.ingested_at) : "in progress" },
    { name: "Extracted", done: sent, note: sent ? `${f.fields_filled ?? "?"} fields · ${f.pages ?? "?"} page(s)` : "waiting" },
    { name: "Entities (NER)", done: f.ner_status === "done", active: f.ner_status === "requested", failed: f.ner_status === "failed",
      note: f.ner_status === "done" ? `${f.entity_count} found` : f.ner_status === "requested" ? "running in BerryDB" :
        f.ner_status === "failed" ? "failed" : "not run yet" },
  ];
  return `<div class="card-head"><b class="small">Processing status</b>${SRC.app("documents table: status, timestamps and counts written by the backend as each step finishes")}</div>
  <div class="pipeline">${steps.map((s) => `
    <div class="step${s.failed ? " failed" : s.done ? " done" : s.active ? " active" : ""}">
      <span class="mark"></span><b>${s.name}</b><small>${esc(s.note)}</small>
    </div>`).join("")}</div>`;
}

function hero(d) {
  const f = d.file, p = d.profile;
  const canNer = !!f.berry_record_id && f.ner_status !== "requested";
  return `
    <div class="hero">
      <div class="who">
        <div class="doc-icon">${ICON.file}</div>
        <div style="min-width:0">
          <h2>${esc(f.file_name)} ${SRC.app("file_name")}</h2>
          <div class="title">${p?.fullName ? `${esc([p.fullName, p.jobTitle, p.location].filter(Boolean).join(" · "))} ${SRC.docs("fullName, jobTitle, location extracted from this file")}`
            : "Not extracted yet"}</div>
        </div>
      </div>
      <div class="actions">
        <a class="btn" href="/api/documents/${f.id}/download" target="_blank" rel="noopener">${ICON.file}View PDF</a>
        ${f.berry_record_id ? `<button class="btn primary" data-act="ner" ${canNer ? "" : "disabled"}>${ICON.spark}${
          f.ner_status === "done" ? "Re-run entities" : f.ner_status === "requested" ? "Finding entities…" : "Find entities"}</button>` : ""}
        ${f.status === "failed" || f.status === "ingested" ? `<button class="btn" data-act="send">${ICON.send}${f.status === "failed" ? "Retry send" : "Send again"}</button>` : ""}
        <button class="btn danger" data-act="delete-doc">${ICON.trash}Delete</button>
      </div>
    </div>`;
}

function alerts(d) {
  const f = d.file, out = [];
  if (f.status === "failed") out.push(`<div class="alert bad"><b>BerryDB could not process this file.</b> ${esc(f.error)}</div>`);
  if (d.berry_error) out.push(`<div class="alert warn">${esc(d.berry_error)}</div>`);
  if (f.ner_status === "failed") out.push(`<div class="alert bad"><b>Entity recognition failed.</b> ${esc(f.ner_error)}</div>`);
  if (d.shared_with.length) {
    out.push(`<div class="alert info"><b>Shared BerryDB record.</b> The same file (identical bytes) was also uploaded by
      ${d.shared_with.map((s) => `<a href="#/students/${s.student_id}/documents/${s.id}">${esc(s.student_name)}</a> (${esc(s.file_name)})`).join(", ")}.
      BerryDB derives the record id from the file content, so both uploads point at one record. Each student's profile is
      still built separately, and the record is kept until no student uses it.</div>`);
  }
  if (d.record_owner) {
    out.push(`<div class="alert warn">The BerryDB record is currently tagged <span class="mono">studentId</span> =
      <a href="#/students/${d.record_owner.id}">${esc(d.record_owner.full_name)}</a>, because their upload of the same file
      was sent last. This student's own profile is not affected.</div>`);
  }
  return out.join("");
}

function extractedTab(p) {
  if (!p) return `<div class="card section muted">BerryDB has not returned an extraction for this file yet.</div>`;
  const jobs = (p.workExperience || []).filter((w) => w && (w.company || w.details));
  const links = [
    p.email && `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>`,
    p.linkedInUrl && `<a href="${esc(href(p.linkedInUrl))}" target="_blank" rel="noopener">LinkedIn</a>`,
    p.githubUrl && `<a href="${esc(href(p.githubUrl))}" target="_blank" rel="noopener">GitHub</a>`,
    p.portfolioUrl && `<a href="${esc(href(p.portfolioUrl))}" target="_blank" rel="noopener">Portfolio</a>`,
  ].filter(Boolean);
  return `
    <div class="note-strip">What BerryDB extracted from <b>this file only</b>. The student's combined view is on the Profile tab.</div>
    <div class="card section"><h3>Summary ${SRC.docs("professionalSummary")}</h3><p>${esc(p.professionalSummary) || '<span class="muted">No summary found.</span>'}</p>
      ${links.length ? `<div class="links">${links.join("")}</div>` : ""}</div>
    <div class="card section"><h3>Skills <span class="muted">(${(p.skillsList || []).length})</span> ${SRC.docs("skillsList")}</h3>
      ${(p.skillsList || []).length ? `<div class="chips">${p.skillsList.map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div>`
        : '<span class="muted">No skills found.</span>'}</div>
    <div class="cols">
      <div class="card section"><h3>Experience ${SRC.docs("workExperience")}</h3>
        ${jobs.length ? `<div class="timeline">${jobs.map((w) => `<div class="job"><b>${esc(w.company || "Company not named")}</b><p>${esc(w.details)}</p></div>`).join("")}</div>`
          : '<span class="muted">No work experience found.</span>'}</div>
      <div class="card section"><h3>Education ${SRC.docs("degreeName, institutionName, graduationYear")}</h3>
        ${p.degreeName || p.institutionName ? `<div class="job"><b>${esc(p.degreeName || "Degree not named")}</b>
          <p>${esc([p.institutionName, p.graduationYear].filter(Boolean).join(" · "))}</p></div>` : '<span class="muted">No education found.</span>'}
      </div>
    </div>`;
}

function entitiesTab(d) {
  const f = d.file;
  if (!d.entity_groups.length) {
    return `<div class="card section">
      <p>${f.ner_status === "requested" ? "BerryDB is finding entities in this document. This usually takes a few seconds."
        : "No entities yet. <b>Find entities</b> asks BerryDB to run named-entity recognition on the document text and save the results on its record."}</p></div>`;
  }
  const run = d.ner_run;
  return `
    <div class="card section">
      <h3>Entities found by BerryDB <span class="muted">(${d.entities.length} mentions)</span> ${SRC.docs("annotations on the record, written by BerryDB's NER")}</h3>
      ${d.entity_groups.map((g) => `
        <div class="ent-group" style="--c:${entColor(g.label)}">
          <div class="ent-label"><i></i>${esc(ENTITY_NAMES[g.label] || g.label)} <small>${g.values.length}</small></div>
          <div class="chips">${g.values.map((v) => `<span class="ent">${esc(v)}</span>`).join("")}</div>
        </div>`).join("")}
    </div>
    ${run ? `<div class="card section"><h3>How BerryDB ran it ${SRC.docs("the NER run details BerryDB saved with the annotations")}</h3><dl class="kv">
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
    <h3>Document text as stored in BerryDB <span class="muted">(${d.text.length} characters, field ${esc(d.file.text_field || "content.text")})</span>
      ${SRC.docs("content.text, plus the entity positions from annotations")}</h3>
    ${labels.length ? `<div class="legend">${labels.map((l) => `<span style="--c:${entColor(l)}"><i></i>${esc(ENTITY_NAMES[l] || l)}</span>`).join("")}</div>` : ""}
    <div class="doc-text">${highlighted(d.text, d.entities)}</div></div>`;
}

function lineageTab(d) {
  const f = d.file, m = d.berry_meta;
  return `
    <div class="cols">
      <div class="card section store">
        <h4>${ICON.disk} Local disk ${SRC.app("path, size, type and hash are recorded in the documents table")}</h4>
        <div class="where">The original file, kept by this app under the student's folder</div>
        <dl class="kv"><dt>Path</dt><dd class="mono">${esc(f.file_path)}</dd><dt>Size</dt><dd>${size(f.file_size)} (${f.file_size} bytes)</dd>
          <dt>Type</dt><dd>${esc(f.file_type)}</dd><dt>SHA-256</dt><dd class="mono">${esc(f.sha256)}</dd></dl>
        <div class="how">The hash is only compared with this student's other files, to refuse an exact re-upload.</div>
      </div>
      <div class="card section store">
        <h4>${ICON.db} App database ${SRC.app()}</h4><div class="where">SQLite <span class="mono">data/app.db</span>, table <span class="mono">documents</span></div>
        <dl class="kv">
          <dt>Document id</dt><dd class="mono">${esc(f.id)}</dd><dt>Student id</dt><dd class="mono">${esc(f.student_id)}</dd>
          <dt>Status</dt><dd>${esc(f.status)}</dd>
          <dt>Uploaded</dt><dd>${when(f.uploaded_at)}</dd><dt>Sent to BerryDB</dt><dd>${when(f.ingested_at) || "—"}</dd>
          <dt>BerryDB record</dt><dd class="mono">${esc(f.berry_record_id || "—")}</dd>
          <dt>Fields filled</dt><dd>${f.fields_filled ?? "—"}</dd><dt>NER</dt><dd>${esc(f.ner_status || "not run")}${f.entity_count ? `, ${f.entity_count} entities` : ""}</dd>
          ${f.error ? `<dt>Error</dt><dd style="color:var(--bad)">${esc(f.error)}</dd>` : ""}
        </dl>
      </div>
    </div>
    <div class="card section store">
      <h4>${ICON.cloud} BerryDB document record ${SRC.docs("the record's _meta and id")}</h4>
      <div class="where">Database <span class="mono">ResumePlaygroundKG</span>: the extraction, full text and entities of this file</div>
      ${m ? `<dl class="kv">
        <dt>Organization</dt><dd>${esc(m.organization)}</dd><dt>Database</dt><dd>${esc(m.database)} (id ${esc(m.databaseId)})</dd>
        <dt>Record id</dt><dd class="mono">${esc(m.id)}</dd><dt>Written</dt><dd>${when(m.uploadedTime) || "—"}</dd>
        <dt>studentId on record</dt><dd class="mono">${esc(m.studentId || "—")}</dd>
        <dt>documentId on record</dt><dd class="mono">${esc(m.documentId || "—")}</dd></dl>` : `<p class="muted">${esc(d.berry_error || "Not in BerryDB yet.")}</p>`}
      <div class="how">
        <b>Written by</b> <span class="mono">POST /berrydb/ingest/structured</span> with the PDF and <span class="mono">metadata = {studentId, documentId}</span>
        (direct API call; SDK 1.7.7 only sends URLs). The record id is derived by BerryDB from the file bytes.<br>
        <b>Read by</b> the SDK, <span class="mono">db.get_all_documents(document_ids=[id])</span>, every time this page opens.<br>
        <b>Entities by</b> the SDK, <span class="mono">db.ner("content.text", [id], annotate=True)</span>; BerryDB saves them on the same record.
      </div>
    </div>`;
}

function rawTab(d) {
  return `<div class="cols">
    <div class="card section"><h3>App database row ${SRC.app("documents table")}</h3><pre class="json">${esc(JSON.stringify(d.file, null, 2))}</pre></div>
    <div class="card section"><h3>BerryDB document record ${SRC.docs()}</h3><pre class="json">${esc(d.record ? JSON.stringify(d.record, null, 2) : "Not available")}</pre></div>
  </div>`;
}

const TABS = [
  ["extracted", "Extracted", extractedTab, null, (d) => d.profile],
  ["entities", "Entities", entitiesTab, (d) => d.entity_groups.length],
  ["text", "Text", textTab],
  ["lineage", "Where data lives", lineageTab],
  ["raw", "Raw JSON", rawTab],
];

export function documentHtml(d, tab) {
  const t = TABS.find(([k]) => k === tab) || TABS[0];
  const body = t[0] === "extracted" ? extractedTab(d.profile) : t[2](d);
  return `
    <div class="card">${hero(d)}${alerts(d)}${pipeline(d.file)}</div>
    <div class="tabs">${TABS.map(([k, label, , count]) => {
      const n = count ? count(d) : 0;
      return `<button class="tab${t[0] === k ? " on" : ""}" data-doctab="${k}">${label}${n ? `<span class="n">${n}</span>` : ""}</button>`;
    }).join("")}</div>
    <div class="panel">${body}</div>`;
}
