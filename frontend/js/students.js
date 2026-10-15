// Students page: everyone registered in the app, and the "Add student" form.
import { $, ICON, SRC, ago, api, copyText, esc, initials, modal, shortId, toast } from "./common.js";

export function studentsView(root) {
  let students = [];
  let query = "";

  function profileState(s) {
    if (s.profile_error) return `<span class="badge bad" title="${esc(s.profile_error)}">Profile sync failed</span>`;
    if (s.pending_count) return '<span class="badge warn"><span class="spin"></span>Processing</span>';
    if (s.profile_synced_at) return `<span class="badge ok" title="Last saved to BerryDB StudentProfiles">Profile synced ${ago(s.profile_synced_at)}</span>`;
    return '<span class="badge">Not synced</span>';
  }

  function renderRows() {
    const q = query.toLowerCase();
    const list = students.filter((s) => !q || [s.full_name, s.email, s.id].some((v) => (v || "").toLowerCase().includes(q)));
    $("#student-rows", root).innerHTML = list.length ? list.map((s) => `
      <a class="srow" href="#/students/${s.id}">
        <div class="avatar">${esc(initials(s.full_name))}</div>
        <div class="who">
          <b>${esc(s.full_name)}</b>
          <span class="muted">${esc(s.email || "No email")}</span>
        </div>
        <div class="uuid mono" title="${esc(s.id)}">${esc(shortId(s.id))}</div>
        <div class="num"><b>${s.document_count}</b><span class="muted"> doc${s.document_count === 1 ? "" : "s"}</span></div>
        <div>${profileState(s)}</div>
        <div class="muted small">${s.last_upload_at ? `Last upload ${ago(s.last_upload_at)}` : `Added ${ago(s.created_at)}`}</div>
      </a>`).join("")
      : `<div class="nolist">${students.length ? "No students match your search." : "No students yet. Add one to start uploading documents."}</div>`;
  }

  async function load() {
    students = await api("/api/students");
    $("#student-count", root).textContent = students.length;
    renderRows();
  }

  function addStudent() {
    modal(`
      <h2>Add student</h2>
      <p class="muted">The app generates a permanent UUID for the student. It identifies them everywhere:
        in this app's database, in file storage, on every document sent to BerryDB, and as the id of their
        BerryDB profile.</p>
      <label>Full name <input name="full_name" required maxlength="120" placeholder="e.g. Priya Nair"></label>
      <label>Email <span class="muted">(optional)</span> <input name="email" type="email" maxlength="200" placeholder="name@example.com"></label>
      <p class="form-error" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn" data-close>Cancel</button>
        <button class="btn primary">${ICON.plus}Add student</button>
      </div>`,
    async (form) => {
      const err = $(".form-error", form);
      const submit = $("button.primary", form);
      submit.disabled = true;
      try {
        const s = await api("/api/students", { method: "POST", json: { full_name: form.full_name.value, email: form.email.value } });
        form.innerHTML = `
          <h2>Student added</h2>
          <dl class="kv">
            <dt>Name</dt><dd>${esc(s.full_name)}</dd>
            <dt>Student UUID</dt><dd class="mono">${esc(s.id)} <button type="button" class="icon-btn" data-copy="${esc(s.id)}" title="Copy">${ICON.copy}</button></dd>
            <dt>BerryDB profile</dt><dd>${s.profile_synced_at ? "Created in StudentProfiles (record id = UUID)" : `Not created yet: ${esc(s.profile_error || "")}`}</dd>
          </dl>
          <div class="modal-actions">
            <button type="button" class="btn" data-close>Close</button>
            <a class="btn primary" href="#/students/${s.id}/documents" data-close>Upload documents</a>
          </div>`;
        form.addEventListener("click", (e) => { const c = e.target.closest("[data-copy]"); if (c) copyText(c.dataset.copy); });
        load();
        return false;
      } catch (e) {
        err.textContent = e.message; err.hidden = false; submit.disabled = false;
        return false;
      }
    });
  }

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <h2>Students <span class="count" id="student-count"></span> ${SRC.app("students table, with document counts from the documents table")}</h2>
          <p class="muted">Each student has a permanent UUID. Their documents and their BerryDB profile are all linked by it.</p>
        </div>
        <button class="btn primary" data-act="add">${ICON.plus}Add student</button>
      </div>
      <input id="student-search" class="search" type="search" placeholder="Search name, email or UUID…">
      <div class="card stable">
        <div class="shead"><span></span><span>Student</span><span>UUID</span><span>Documents</span><span>BerryDB profile</span><span>Activity</span></div>
        <div id="student-rows"><div class="nolist">Loading…</div></div>
      </div>
    </div>`;
  $("#student-search", root).addEventListener("input", (e) => { query = e.target.value; renderRows(); });
  load().catch((e) => toast(e.message, true));

  return {
    onClick(e) {
      if (e.target.closest('[data-act="add"]')) addStudent();
    },
    destroy() {},
  };
}
