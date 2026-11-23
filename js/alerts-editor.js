// Alerts editor for the GradWay team. Reads data/alerts.json from GitHub, lets you
// add, edit and remove alerts per campus, and publishes the file back with a
// fine-grained token (Contents: read and write on the site's repository only).
// The token is sent only to api.github.com.

import { loadCampuses } from "./data.js";
import { icon } from "./icons.js";
import { ALERT_TYPES, alertStatus, parseLocal } from "./alerts.js";

const config = window.GRADWAY_CONFIG;
const repoDefaults = config.alertsRepo || {};
const $ = s => document.querySelector(s);
const h = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ALL = "__all__";
const state = { data: null, sha: null, editing: null, campus: ALL, campuses: [] };

const saved = (() => { try { return JSON.parse(localStorage.getItem("gradway.alertsEditor") || "{}"); } catch { return {}; } })();
$("#gh-repo").value = saved.repo || [repoDefaults.owner, repoDefaults.repo].filter(Boolean).join("/");
$("#gh-branch").value = saved.branch || repoDefaults.branch || "main";
$("#gh-token").value = saved.token || "";
$("#gh-remember").checked = Boolean(saved.token);
$("#a-type").innerHTML = Object.entries(ALERT_TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("");

const path = () => repoDefaults.path || "data/alerts.json";
const api = () => {
  const [owner, repo] = $("#gh-repo").value.trim().split("/");
  return `https://api.github.com/repos/${encodeURIComponent(owner || "")}/${encodeURIComponent(repo || "")}/contents/${path()}`;
};
const headers = () => ({ Accept: "application/vnd.github+json", Authorization: `Bearer ${$("#gh-token").value.trim()}`, "X-GitHub-Api-Version": "2022-11-28" });
const status = (text, bad = false) => { const el = $("#gh-status"); el.textContent = text; el.classList.toggle("warn", bad); };
const encode = text => btoa(unescape(encodeURIComponent(text)));
const decode = b64 => decodeURIComponent(escape(atob(b64.replace(/\s/g, ""))));
const empty = () => ({ _how_to: "Edit with alerts-editor.html.", all: [], campuses: {} });

function remember() {
  try {
    localStorage.setItem("gradway.alertsEditor", JSON.stringify({
      repo: $("#gh-repo").value.trim(), branch: $("#gh-branch").value.trim(),
      token: $("#gh-remember").checked ? $("#gh-token").value.trim() : ""
    }));
  } catch {}
}

// MARK: - Load

$("#gh-load").addEventListener("click", load);
async function load() {
  remember();
  status("Loading…");
  const campusesP = loadCampuses(config).then(r => r.campuses).catch(() => []);
  try {
    if ($("#gh-token").value.trim()) {
      const response = await fetch(`${api()}?ref=${encodeURIComponent($("#gh-branch").value.trim())}`, { headers: headers(), cache: "no-store" });
      if (response.status === 404) { state.data = empty(); state.sha = null; status("No alerts file yet. Your first publish creates it."); }
      else if (response.status === 401 || response.status === 403) throw new Error("GitHub didn't accept the token. Check that it hasn't expired and has Contents: read and write on this repository.");
      else if (!response.ok) throw new Error(`GitHub answered ${response.status}. Check the repository name and branch.`);
      else {
        const json = await response.json();
        state.sha = json.sha;
        state.data = JSON.parse(decode(json.content));
        status(`Loaded from ${$("#gh-repo").value.trim()}.`);
      }
    } else {
      // No token: read the published copy, then download the result at the end.
      const response = await fetch(`${config.alertsURL}?m=${Date.now()}`, { cache: "no-store" });
      state.data = response.ok ? await response.json() : empty();
      state.sha = null;
      status("Read-only: add a token to publish, or download the file when you're done.");
      $("#fallback").hidden = false;
    }
  } catch (error) {
    status(error.message, true);
    return;
  }
  state.data.all ||= [];
  state.data.campuses ||= {};
  state.campuses = await campusesP;
  $("#campus").innerHTML = `<option value="${ALL}">All campuses</option>` + state.campuses.map(c => `<option value="${h(c.name)}">${h(c.name)}</option>`).join("");
  const remembered = (() => { try { return localStorage.getItem("gradway.alertsEditorCampus"); } catch { return null; } })();
  if (remembered && [...$("#campus").options].some(o => o.value === remembered)) $("#campus").value = remembered;
  state.campus = $("#campus").value;
  $("#edit").hidden = false;
  drawList();
}

// MARK: - List

const listFor = campus => (campus === ALL ? state.data.all : (state.data.campuses[campus] ||= []));

$("#campus").addEventListener("change", () => {
  state.campus = $("#campus").value;
  try { localStorage.setItem("gradway.alertsEditorCampus", state.campus); } catch {}
  closeForm();
  drawList();
});

function drawList() {
  const list = listFor(state.campus);
  const fmt = v => { const d = parseLocal(v); return d ? d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"; };
  $("#alert-list").innerHTML = list.length ? list.map((a, i) => {
    const st = alertStatus(a);
    return `<div class="admin-item">
      <div class="admin-item-main">
        <span class="admin-badge st-${st}">${{ live: "Live now", scheduled: "Scheduled", ended: "Ended" }[st]}</span>
        <span class="admin-type">${h(ALERT_TYPES[a.type]?.label || "News")}</span>
        <p>${h(a.text)}</p>
        <span class="muted small">${fmt(a.starts)} → ${fmt(a.ends)}${a.link ? ` · link: ${h(a.linkLabel || "Learn more")}` : ""}</span>
      </div>
      <div class="admin-item-actions">
        <button class="btn btn-glass btn-small" data-edit="${i}" type="button">Edit</button>
        <button class="btn btn-glass btn-small danger" data-delete="${i}" type="button">Delete</button>
      </div>
    </div>`;
  }).join("") + (list.some(a => alertStatus(a) === "ended") ? `<button class="linkish" id="clear-ended" type="button">Remove ended alerts</button>` : "")
    : `<p class="muted">No alerts for ${state.campus === ALL ? "all campuses" : h(state.campus)} yet.</p>`;
}

$("#alert-list").addEventListener("click", async event => {
  const edit = event.target.closest("[data-edit]");
  const del = event.target.closest("[data-delete]");
  if (edit) openForm(+edit.dataset.edit);
  if (del) {
    const button = del;
    if (button.dataset.confirm !== "1") { button.dataset.confirm = "1"; button.textContent = "Tap again to delete"; return; }
    const list = listFor(state.campus);
    const removed = list.splice(+del.dataset.delete, 1)[0];
    await publish(`Remove alert "${removed.text.slice(0, 40)}" (${label()})`);
    drawList();
  }
  if (event.target.id === "clear-ended") {
    const list = listFor(state.campus);
    const keep = list.filter(a => alertStatus(a) !== "ended");
    list.splice(0, list.length, ...keep);
    await publish(`Remove ended alerts (${label()})`);
    drawList();
  }
});

const label = () => (state.campus === ALL ? "all campuses" : state.campus);

// MARK: - Form

const pad = n => String(n).padStart(2, "0");
const local = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

$("#new-alert").addEventListener("click", () => openForm(null));
$("#cancel-alert").addEventListener("click", closeForm);

function openForm(index) {
  state.editing = index;
  const a = index == null ? null : listFor(state.campus)[index];
  const now = new Date(); now.setSeconds(0, 0);
  const end = new Date(now); end.setHours(23, 59, 0, 0);
  $("#form-title").textContent = a ? "Edit alert" : `New alert for ${label()}`;
  $("#a-text").value = a?.text || "";
  $("#a-type").value = a?.type || "info";
  $("#a-starts").value = a?.starts || local(now);
  $("#a-ends").value = a?.ends || local(end);
  $("#a-link").value = a?.link || "";
  $("#a-link-label").value = a?.linkLabel || "";
  $("#form-error").hidden = true;
  $("#form-card").hidden = false;
  updatePreview();
  $("#form-card").scrollIntoView({ block: "start", behavior: "smooth" });
  $("#a-text").focus({ preventScroll: true });
}

function closeForm() { $("#form-card").hidden = true; state.editing = null; }

document.querySelectorAll("[data-quick]").forEach(b => b.addEventListener("click", () => {
  const now = new Date(); now.setSeconds(0, 0);
  const start = new Date(now), end = new Date(now);
  if (b.dataset.quick === "today") end.setHours(23, 59, 0, 0);
  if (b.dataset.quick === "tomorrow") { start.setDate(start.getDate() + 1); start.setHours(0, 0, 0, 0); end.setDate(end.getDate() + 1); end.setHours(23, 59, 0, 0); }
  if (b.dataset.quick === "week") { end.setDate(end.getDate() + 7); end.setHours(23, 59, 0, 0); }
  $("#a-starts").value = local(start);
  $("#a-ends").value = local(end);
}));

$("#alert-form").addEventListener("input", updatePreview);
function updatePreview() {
  const type = $("#a-type").value;
  const text = $("#a-text").value.trim() || "Your message";
  $("#text-count").textContent = `${$("#a-text").value.length}/140`;
  $("#preview").innerHTML = `<div class="alert alert-${type}"><span class="alert-icon">${icon(ALERT_TYPES[type].icon)}</span>
    <div class="alert-body"><span class="alert-kind">${h(ALERT_TYPES[type].label)}</span><p class="alert-text">${h(text)}</p>
    ${$("#a-link").value.trim() ? `<span class="alert-link">${h($("#a-link-label").value.trim() || "Learn more")} ${icon("chevronRight")}</span>` : ""}</div>
    <span class="alert-close">${icon("close")}</span></div>`;
}

$("#alert-form").addEventListener("submit", async event => {
  event.preventDefault();
  const error = msg => { $("#form-error").textContent = msg; $("#form-error").hidden = !msg; };
  const text = $("#a-text").value.trim();
  const starts = $("#a-starts").value, ends = $("#a-ends").value;
  let link = $("#a-link").value.trim();
  if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
  if (!text) return error("Write the message first.");
  if (!starts || !ends) return error("Choose when it shows.");
  if (parseLocal(ends) <= parseLocal(starts)) return error("\"Until\" has to be after \"Show from\".");
  error("");
  const list = listFor(state.campus);
  const existing = state.editing == null ? null : list[state.editing];
  const alert = {
    id: existing?.id || `${(state.campus === ALL ? "all" : state.campus).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}-${Date.now().toString(36)}`,
    text, type: $("#a-type").value, starts, ends,
    ...(link ? { link, linkLabel: $("#a-link-label").value.trim() || "Learn more" } : {})
  };
  if (existing) list[state.editing] = alert; else list.unshift(alert);
  const ok = await publish(`${existing ? "Update" : "Add"} alert "${text.slice(0, 40)}" (${label()})`);
  if (ok !== false) { closeForm(); drawList(); }
});

// MARK: - Publish

async function publish(message) {
  if (!$("#gh-token").value.trim()) {
    status("Saved here. Download alerts.json to publish it.", false);
    $("#fallback").hidden = false;
    return true;
  }
  status("Publishing…");
  const body = JSON.stringify(state.data, null, 2) + "\n";
  try {
    const response = await fetch(api(), {
      method: "PUT",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ message, content: encode(body), branch: $("#gh-branch").value.trim(), ...(state.sha ? { sha: state.sha } : {}) })
    });
    if (response.status === 409 || response.status === 422) throw new Error("Someone else changed the alerts. Load them again, then redo this change.");
    if (!response.ok) throw new Error(`GitHub answered ${response.status}. Your change wasn't published.`);
    const json = await response.json();
    state.sha = json.content?.sha || state.sha;
    status(`Published. It shows on the site within about two minutes.`);
    return true;
  } catch (error) {
    status(error.message, true);
    return false;
  }
}

$("#download").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state.data || empty(), null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "alerts.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
