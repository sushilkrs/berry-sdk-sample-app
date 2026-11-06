// Search page: a plain-English question -> Berry GPT writes a query -> the app runs it on StudentProfiles.
import { $, SRC, api, esc, initials, shortId, toast } from "./common.js";

const EXAMPLES = ["students who know Java and MySQL", "students who know Python or Go", "students who know Kafka but not Java"];

export function searchView(root) {
  let busy = false;

  const value = (v) => Array.isArray(v) ? (v.every((x) => typeof x !== "object") ? v.join(", ") : JSON.stringify(v)) :
    v && typeof v === "object" ? JSON.stringify(v) : String(v ?? "");

  function steps(r) {
    return `
      <div class="card search-steps">
        <dl class="kv">
          <dt>1 · Berry GPT</dt><dd>LLMAgent.chat() with our ${esc(r.provider || "")} key${r.model ? ` (${esc(r.model)})` : ""}${r.llm_ms != null ? ` · ${r.llm_ms} ms` : ""}</dd>
          <dt>2 · Query</dt><dd>${r.sql ? `<pre class="json">${esc(r.sql)}</pre>` : '<span class="muted">none</span>'}</dd>
          <dt>3 · db.query()</dt><dd>${r.error ? '<span class="muted">not run</span>' : `${r.students.length} document${r.students.length === 1 ? "" : "s"} matched · ${r.query_ms} ms`}</dd>
        </dl>
        ${r.llm_reply && r.llm_reply.trim() !== r.sql ? `<details><summary>Model reply as received</summary><pre class="json">${esc(r.llm_reply)}</pre></details>` : ""}
      </div>`;
  }

  function results(r) {
    if (r.error) return `<div class="alert bad"><b>Search failed.</b> ${esc(r.error)}</div>`;
    if (!r.students.length) return '<div class="card"><div class="nolist">No students match.</div></div>';
    return `<div class="card stable">${r.students.map((s) => `
      <${s.in_app ? `a href="#/students/${esc(s.id)}"` : "div"} class="hit">
        <div class="avatar">${esc(initials(s.full_name))}</div>
        <div class="who"><b>${esc(s.full_name || "(no name)")}</b>
          <span class="muted mono" title="${esc(s.id)}">${esc(shortId(s.id))}${s.in_app ? "" : " · not in the app DB"}</span></div>
        <dl class="kv">${Object.entries(s.fields).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(value(v))}</dd>`).join("")}</dl>
      </${s.in_app ? "a" : "div"}>`).join("")}</div>`;
  }

  async function run(question) {
    if (busy || !question.trim()) return;
    busy = true;
    const btn = $("#search-go", root);
    btn.disabled = true;
    $("#search-out", root).innerHTML = '<div class="nolist"><span class="spin"></span> Asking Berry GPT for a query…</div>';
    try {
      const r = await api("/api/search", { method: "POST", json: { question } });
      $("#search-out", root).innerHTML = `
        <h3 class="search-h">${r.error ? "Result" : `${r.students.length} student${r.students.length === 1 ? "" : "s"}`} ${SRC.profile("matched by the query below")}</h3>
        ${results(r)}${steps(r)}`;
    } catch (e) {
      $("#search-out", root).innerHTML = "";
      toast(e.message, true);
    } finally {
      busy = false;
      btn.disabled = false;
    }
  }

  root.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <h2>Search students</h2>
          <p class="muted">Ask in plain English. Berry GPT (SDK <code>LLMAgent</code>, with our own LLM key) writes a query over
            the merged profiles, and the app runs it with <code>db.query()</code>, which returns every match.</p>
        </div>
      </div>
      <form id="search-form" class="search-bar">
        <input id="search-q" class="search" type="search" maxlength="500" placeholder="e.g. students who know Java and MySQL" autocomplete="off">
        <button id="search-go" class="btn primary">Search</button>
      </form>
      <div class="chips search-examples">${EXAMPLES.map((q) => `<button type="button" class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>
      <div id="search-ready"></div>
      <div id="search-out"></div>
    </div>`;
  $("#search-form", root).addEventListener("submit", (e) => { e.preventDefault(); run($("#search-q", root).value); });
  $("#search-q", root).focus();
  api("/api/health").then((h) => {
    if (!h.search_ready) $("#search-ready", root).innerHTML =
      '<div class="alert warn">Set <code>LLM_API_KEY</code> (and <code>LLM_PROVIDER</code>) in <code>.env</code> and restart the app to search.</div>';
  }).catch(() => {});

  return {
    onClick(e) {
      const ex = e.target.closest("[data-q]");
      if (ex) { $("#search-q", root).value = ex.dataset.q; run(ex.dataset.q); }
    },
    destroy() {},
  };
}
