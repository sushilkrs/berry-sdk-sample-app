// One student's workspace: their merged BerryDB profile, and their documents.
import { $, ICON, SRC, ago, api, copyText, docBusy, docStatusBadge, esc, href, initials, size, toast, when } from "./common.js";
import { documentHtml } from "./document.js";

export function studentView(root, params) {
  const sid = params.id;
  const st = { tab: params.tab || "profile", docId: params.docId || null, docTab: "extracted",
               data: null, doc: null, query: "", timer: null, alive: true };

  const docName = (id) => st.data?.documents.find((d) => d.id === id)?.file_name || "a deleted document";

  // ---------- header ----------
  function header() {
    const s = st.data.student, docs = st.data.documents;
    const ingested = docs.filter((d) => d.status === "ingested").length;
    return `
      <a class="crumb" href="#/">${ICON.back}All students</a>
      <div class="card student-head">
        <div class="who">
          <div class="avatar lg">${esc(initials(s.full_name))}</div>
          <div style="min-width:0">
            <h2>${esc(s.full_name)} ${SRC.app("students table: entered when the student was added")}</h2>
            <div class="muted">${esc(s.email || "No email")}</div>
            <div class="uuid-line"><span class="muted">Student UUID</span> <span class="mono">${esc(s.id)}</span>
              <button class="icon-btn" data-copy="${esc(s.id)}" title="Copy UUID">${ICON.copy}</button></div>
          </div>
        </div>
        <div class="stats">
          <div><b>${docs.length}</b><span>documents</span></div>
          <div><b>${ingested}</b><span>extracted</span></div>
          <div><b>${s.profile_synced_at ? ago(s.profile_synced_at) : "never"}</b><span>profile synced</span></div>
        </div>
        <div class="actions">
          <button class="btn" data-act="sync" title="Rebuild the profile from all documents and upsert it to BerryDB">${ICON.sync}Re-sync profile</button>
          <button class="btn danger" data-act="delete-student">${ICON.trash}Delete student</button>
        </div>
      </div>
      ${s.profile_error ? `<div class="alert bad" style="margin:12px 0 0"><b>Last profile sync failed.</b> ${esc(s.profile_error)}</div>` : ""}
      <div class="tabs big">
        <a class="tab${st.tab === "profile" ? " on" : ""}" href="#/students/${sid}">Profile</a>
        <a class="tab${st.tab === "documents" ? " on" : ""}" href="#/students/${sid}/documents">Documents<span class="n">${docs.length}</span></a>
      </div>`;
  }

  // ---------- profile tab ----------
  function from(docId) {
    return `<span class="from" title="Came from this document">${ICON.file}${esc(docName(docId))}</span>`;
  }

  function profileTab() {
    const p = st.data.profile;
    const explain = `<div class="note-strip">One record per student in BerryDB <span class="mono">StudentProfiles</span>, with
      <span class="mono">id = student UUID</span>. This app rebuilds it from all of the student's documents after every upload,
      re-send or delete, and saves it with the SDK's <span class="mono">upsert</span>: BerryDB creates the record the first time and
      replaces it afterwards. Newest document wins for single values; lists are combined.</div>`;
    if (!p) {
      return `${explain}<div class="card section"><p class="muted">${esc(st.data.berry_error || "No profile in BerryDB yet.")}</p></div>`;
    }
    const sources = p.skillSources || {};
    const links = [
      p.email && `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>`,
      p.linkedInUrl && `<a href="${esc(href(p.linkedInUrl))}" target="_blank" rel="noopener">LinkedIn</a>`,
      p.githubUrl && `<a href="${esc(href(p.githubUrl))}" target="_blank" rel="noopener">GitHub</a>`,
      p.portfolioUrl && `<a href="${esc(href(p.portfolioUrl))}" target="_blank" rel="noopener">Portfolio</a>`,
    ].filter(Boolean);
    const empty = !(p.documentIds || []).length;
    return `${explain}
      ${empty ? `<div class="alert info" style="margin:0 0 16px">The profile only has the registration details so far.
        <a href="#/students/${sid}/documents">Upload a document</a> and BerryDB's extraction will be merged in.</div>` : ""}
      <div class="card section">
        <h3>Headline ${SRC.profile("jobTitle, location, links: newest document with a value")}</h3>
        <p class="headline">${esc([p.jobTitle, p.location].filter(Boolean).join(" · ")) || '<span class="muted">No title or location yet.</span>'}</p>
        ${links.length ? `<div class="links">${links.join("")}</div>` : ""}
      </div>
      <div class="card section"><h3>Summary ${SRC.profile("professionalSummary: newest document with a value")}</h3>
        <p>${esc(p.professionalSummary) || '<span class="muted">No summary yet.</span>'}</p></div>
      <div class="card section"><h3>Skills <span class="muted">(${(p.skillsList || []).length})</span> ${SRC.profile("skillsList: combined from all documents")}</h3>
        ${(p.skillsList || []).length ? `<div class="chips">${p.skillsList.map((s) => {
          const ids = sources[s] || [];
          return `<span class="chip" title="From: ${esc(ids.map(docName).join(", "))}">${esc(s)}${ids.length > 1 ? `<small>×${ids.length}</small>` : ""}</span>`;
        }).join("")}</div><p class="hint">Hover a skill to see which documents list it.</p>` : '<span class="muted">No skills yet.</span>'}</div>
      <div class="cols">
        <div class="card section"><h3>Experience ${SRC.profile("workExperience: one entry per company, newest description")}</h3>
          ${(p.workExperience || []).length ? `<div class="timeline">${p.workExperience.map((w) => `
            <div class="job"><b>${esc(w.company || "Company not named")}</b><p>${esc(w.details)}</p>${from(w.documentId)}</div>`).join("")}</div>`
            : '<span class="muted">No work experience yet.</span>'}</div>
        <div class="card section"><h3>Education ${SRC.profile("education: combined from all documents")}</h3>
          ${(p.education || []).length ? `<div class="timeline">${p.education.map((e) => `
            <div class="job"><b>${esc(e.degreeName || "Degree not named")}</b>
              <p>${esc([e.institutionName, e.graduationYear || ""].filter(Boolean).join(" · "))}</p>${from(e.documentId)}</div>`).join("")}</div>`
            : '<span class="muted">No education yet.</span>'}</div>
      </div>
      <div class="card section">
        <h3>Profile record ${SRC.profile("the record's own fields")}</h3>
        <dl class="kv">
          <dt>Record id</dt><dd class="mono">${esc(p.id)} <span class="muted">(= student UUID)</span></dd>
          <dt>Last rebuilt</dt><dd>${when(p.updatedAt)}</dd>
          <dt>Built from</dt><dd>${(p.documentIds || []).length ? p.documentIds.map((id) =>
            `<a href="#/students/${sid}/documents/${id}">${esc(docName(id))}</a>`).join(", ") : "registration details only"}</dd>
        </dl>
        <details><summary>Raw BerryDB profile record</summary><pre class="json">${esc(JSON.stringify(p, null, 2))}</pre></details>
      </div>`;
  }

  // ---------- documents tab ----------
  function docList() {
    const q = st.query.toLowerCase();
    const docs = st.data.documents.filter((d) => !q || d.file_name.toLowerCase().includes(q));
    return docs.length ? docs.map((d) => `
      <a class="item${d.id === st.docId ? " sel" : ""}" href="#/students/${sid}/documents/${d.id}">
        <div class="doc-icon sm">${ICON.file}</div>
        <div class="body">
          <div class="name">${esc(d.file_name)}</div>
          <div class="sub">${size(d.file_size)} · ${ago(d.uploaded_at)}</div>
          <div class="meta">${docStatusBadge(d)}${d.shared_with.length ? '<span class="badge info" title="Another student uploaded the identical file">Shared record</span>' : ""}</div>
        </div>
      </a>`).join("")
      : `<div class="nolist">${st.data.documents.length ? "No documents match." : "No documents yet. Upload a PDF to start."}</div>`;
  }

  function documentsTab() {
    return `
      <div class="workspace">
        <aside class="sidebar card">
          <label class="drop" id="drop">
            <input id="picker" type="file" accept="application/pdf,.pdf" multiple hidden>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
            <strong>Upload for ${esc(st.data.student.full_name)}</strong>
            <span>PDF · max 50 MB · sent to BerryDB with this student's UUID</span>
          </label>
          <div id="uploads"></div>
          <div class="list-head">
            <input id="doc-search" type="search" placeholder="Search file name…" value="${esc(st.query)}">
            <div class="counts">${st.data.documents.length} document(s) ${SRC.app("documents table")}</div>
          </div>
          <div class="list" id="doc-list">${docList()}</div>
        </aside>
        <section id="doc-main" class="doc-main">${docMain()}</section>
      </div>`;
  }

  function docMain() {
    if (!st.docId) {
      return `<div class="empty">${ICON.file}<h2>Select a document</h2>
        <p>Each upload is saved under <span class="mono">storage/students/${esc(sid.slice(0, 8))}…/documents/</span>, recorded in the
        app database, and sent to BerryDB with this student's UUID. BerryDB extracts it, and the app merges the result
        into the student's profile.</p></div>`;
    }
    return st.doc ? documentHtml(st.doc, st.docTab) : `<div class="empty"><p>Loading…</p></div>`;
  }

  // ---------- rendering ----------
  function render() {
    if (!st.data) { root.innerHTML = `<div class="page"><div class="empty"><p>Loading…</p></div></div>`; return; }
    root.innerHTML = `<div class="page wide">${header()}<div id="tab-body">${st.tab === "documents" ? documentsTab() : profileTab()}</div></div>`;
    if (st.tab === "documents") wireDocuments();
  }

  function wireDocuments() {
    $("#picker", root).addEventListener("change", (e) => { upload(e.target.files); e.target.value = ""; });
    const drop = $("#drop", root);
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
    drop.addEventListener("drop", (e) => upload(e.dataTransfer.files));
    $("#doc-search", root).addEventListener("input", (e) => { st.query = e.target.value; $("#doc-list", root).innerHTML = docList(); });
  }

  function renderDocParts() {  // refresh without losing the upload area or the search box
    if (st.tab !== "documents" || !$("#doc-list", root)) return render();
    $("#doc-list", root).innerHTML = docList();
    $("#doc-main", root).innerHTML = docMain();
  }

  // ---------- data ----------
  async function loadStudent() {
    st.data = await api(`/api/students/${sid}`);
  }
  async function loadDoc() {
    st.doc = st.docId ? await api(`/api/documents/${st.docId}`) : null;
  }

  async function tick() {
    clearTimeout(st.timer);
    if (!st.alive) return;
    try {
      await loadStudent();
      if (st.docId) await loadDoc();
      st.tab === "documents" ? renderDocParts() : render();
    } catch { /* the next tick tries again */ }
    const busy = st.data?.documents.some(docBusy);
    if (st.alive && busy) st.timer = setTimeout(tick, 3000);
  }

  async function upload(files) {
    if (!files.length) return;
    const form = new FormData();
    [...files].forEach((f) => form.append("files", f));
    $("#uploads", root).innerHTML = `<div class="upnote">Uploading ${files.length} file(s)…</div>`;
    try {
      const res = await api(`/api/students/${sid}/documents`, { method: "POST", body: form });
      const bad = res.filter((r) => r.error);
      const ok = res.filter((r) => !r.error);
      if (ok.length) toast(`${ok.length} file(s) saved, sending to BerryDB`);
      if (ok.length === 1) { location.hash = `#/students/${sid}/documents/${ok[0].id}`; }
      await tick();
      if ($("#uploads", root)) $("#uploads", root).innerHTML = bad.map((r) => `<div class="upnote bad">${esc(r.file_name)}: ${esc(r.error)}</div>`).join("");
    } catch (e) {
      $("#uploads", root).innerHTML = `<div class="upnote bad">${esc(e.message)}</div>`;
    }
  }

  async function act(kind, btn) {
    if (kind === "sync") {
      btn.disabled = true;
      await api(`/api/students/${sid}/profile/sync`, { method: "POST" });
      toast("Profile rebuilt and saved to BerryDB");
      return tick();
    }
    if (kind === "delete-student") {
      const n = st.data.documents.length;
      if (!confirm(`Delete ${st.data.student.full_name}? This removes ${n} document(s) from disk and the app database, `
        + "their BerryDB document records (unless another student shares the same file) and their BerryDB profile.")) return;
      await api(`/api/students/${sid}`, { method: "DELETE" });
      toast("Student deleted");
      location.hash = "#/";
      return;
    }
    const id = st.docId;
    if (kind === "delete-doc") {
      if (!confirm("Delete this document? The file and app database row are removed, the BerryDB record is deleted "
        + "unless another student shares it, and the student's profile is rebuilt without it.")) return;
      await api(`/api/documents/${id}`, { method: "DELETE" });
      toast("Document deleted; profile rebuilt");
      location.hash = `#/students/${sid}/documents`;
      return;
    }
    btn.disabled = true;
    if (kind === "ner") {
      await api(`/api/documents/${id}/ner`, { method: "POST" });
      st.docTab = "entities";
      toast("BerryDB is finding entities");
    }
    if (kind === "send") {
      await api(`/api/documents/${id}/send`, { method: "POST" });
      toast("Sending to BerryDB again");
    }
    await tick();
  }

  render();
  tick().catch((e) => toast(e.message, true));

  return {
    key: sid,
    // called by the router when only the tab or the selected document changed
    route(p) {
      const tabChanged = (p.tab || "profile") !== st.tab;
      st.tab = p.tab || "profile";
      if ((p.docId || null) !== st.docId) { st.docId = p.docId || null; st.doc = null; st.docTab = "extracted"; }
      tabChanged ? render() : renderDocParts();
      tick();
    },
    onClick(e) {
      const c = e.target.closest("[data-copy]");
      if (c) return copyText(c.dataset.copy);
      const t = e.target.closest("[data-doctab]");
      if (t) { st.docTab = t.dataset.doctab; $("#doc-main", root).innerHTML = docMain(); return; }
      const btn = e.target.closest("[data-act]");
      if (btn) act(btn.dataset.act, btn).catch((err) => { toast(err.message, true); btn.disabled = false; });
    },
    destroy() { st.alive = false; clearTimeout(st.timer); },
  };
}
