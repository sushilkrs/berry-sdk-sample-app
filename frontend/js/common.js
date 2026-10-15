// Shared helpers for every page. The UI talks only to this app's backend (/api/*); the backend talks to BerryDB.
export const $ = (s, el = document) => el.querySelector(s);
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export async function api(path, opts = {}) {
  if (opts.json !== undefined) {
    opts = { ...opts, body: JSON.stringify(opts.json), headers: { "content-type": "application/json" } };
  }
  const r = await fetch(path, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.detail || `Request failed (HTTP ${r.status})`);
  return body;
}

export function toast(msg, bad = false) {
  const t = document.createElement("div");
  t.className = `toast${bad ? " bad" : ""}`;
  t.textContent = msg;
  $("#toasts").append(t);
  setTimeout(() => t.remove(), bad ? 7000 : 3500);
}

export const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const when = (s) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
export function ago(s) {
  if (!s) return "";
  const sec = Math.round((Date.now() - new Date(s)) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} h ago`;
  return new Date(s).toLocaleDateString();
}
export const initials = (name) => (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
export const shortId = (id) => (id ? `${id.slice(0, 8)}…` : "");
export const href = (u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

export const ICON = {
  file: '<svg viewBox="0 0 24 24"><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm7 0v5h5"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M4 12h12m0 0-5-5m5 5-5 5M20 5v14"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m-8 0 1 13h8l1-13"/></svg>',
  disk: '<svg viewBox="0 0 24 24"><path d="M4 5h16v14H4zM4 15h16M8 18h.01"/></svg>',
  db: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>',
  cloud: '<svg viewBox="0 0 24 24"><path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7Z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  sync: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15m0 5v-5h5"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
};

// Where each piece of information comes from, shown next to it on screen.
const tag = (cls, label, title) => `<span class="src ${cls}" title="${esc(title)}">${label}</span>`;
export const SRC = {
  app: (what = "") => tag("app", "App DB", `This app's SQLite database (data/app.db)${what ? ": " + what : ""}`),
  docs: (what = "") => tag("berry", "BerryDB · documents",
    `BerryDB database ResumePlaygroundKG: one record per uploaded PDF, extracted by BerryDB, read live through the SDK${what ? ": " + what : ""}`),
  profile: (what = "") => tag("prof", "BerryDB · profiles",
    `BerryDB database StudentProfiles: one record per student (id = student UUID), built by this app and saved with upsert, read live through the SDK${what ? ": " + what : ""}`),
};

export function docStatusBadge(d) {
  if (d.status === "stored" || d.status === "sending") return '<span class="badge warn"><span class="spin"></span>Sending to BerryDB</span>';
  if (d.status === "failed") return '<span class="badge bad">Failed</span>';
  if (d.ner_status === "requested") return '<span class="badge warn"><span class="spin"></span>Finding entities</span>';
  if (d.ner_status === "done") return `<span class="badge ok">Extracted · ${d.entity_count} entities</span>`;
  if (d.ner_status === "failed") return '<span class="badge bad">NER failed</span>';
  return '<span class="badge info">Extracted</span>';
}
export const docBusy = (d) => d.status === "stored" || d.status === "sending" || d.ner_status === "requested";

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Copy failed", true); }
}

// Simple modal; returns the dialog element. `onSubmit(form)` may return false to keep it open.
export function modal(html, onSubmit) {
  const wrap = document.createElement("div");
  wrap.className = "modal-wrap";
  wrap.innerHTML = `<form class="modal card" novalidate>${html}</form>`;
  document.body.append(wrap);
  const form = $("form", wrap);
  const close = () => wrap.remove();
  wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", function onKey(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if ((await onSubmit(form, close)) !== false) close();
  });
  setTimeout(() => form.querySelector("input")?.focus(), 0);
  return wrap;
}
