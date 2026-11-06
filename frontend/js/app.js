// Router: #/ = students, #/search = search, #/students/<id> = profile, #/students/<id>/documents[/<documentId>] = documents.
import { $, api } from "./common.js";
import { searchView } from "./search.js";
import { studentView } from "./student.js";
import { studentsView } from "./students.js";

const root = $("#view");
let current = null;

function parse() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "students" && parts[1]) {
    return { view: "student", id: parts[1], tab: parts[2] === "documents" ? "documents" : "profile", docId: parts[3] || null };
  }
  if (parts[0] === "search") return { view: "search" };
  return { view: "students" };
}

function route() {
  const p = parse();
  if (p.view === "student" && current?.key === p.id) return current.route(p);  // same student: keep state
  current?.destroy();
  current = p.view === "student" ? studentView(root, p) : p.view === "search" ? searchView(root) : studentsView(root);
  document.querySelectorAll(".nav a").forEach((a) => a.classList.toggle("on", a.dataset.view === (p.view === "search" ? "search" : "students")));
  window.scrollTo(0, 0);
}

document.addEventListener("click", (e) => current?.onClick(e));
window.addEventListener("hashchange", route);
route();

api("/api/health").then((h) => {
  const c = $("#conn");
  c.classList.add(h.berry_reachable ? "ok" : "bad");
  c.lastElementChild.textContent = h.berry_reachable ? "BerryDB connected" : "BerryDB not reachable";
  c.title = `${h.berry_host}\ndocuments: ${h.berry_database}\nprofiles: ${h.berry_profile_database}`;
}).catch(() => { $("#conn").classList.add("bad"); $("#conn").lastElementChild.textContent = "App backend not running"; });
