// "Advertise on GradWay": a local business signs up for a sponsored listing.
// It sends the listing for review (to a form service set in config.js, or by
// email), then offers the plan's payment link. Once approved, the listing goes
// into data/sponsors.json exactly as shown in the email ("sponsors.json entry").

import { loadCampuses, distanceMeters, formatDistance, slugify, METERS_PER_MILE } from "./data.js";
import { loadStates, stateAt } from "./states.js";
import { icon } from "./icons.js";
import { initAnalytics, trackEvent } from "./analytics.js";

const config = window.GRADWAY_CONFIG;
const $ = s => document.querySelector(s);
const h = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const form = $("#ad-form");
const CATEGORY_LABELS = { coffee: "Coffee", food: "Food", books: "Bookstore", pharmacy: "Pharmacy", gym: "Gym", atm: "ATM", parking: "Parking" };
const CATEGORY_ICONS = { coffee: "coffee", food: "food", books: "book", pharmacy: "pharmacy", gym: "gym", atm: "atm", parking: "parking" };
const plans = (config.sponsorPlans || []).filter(p => p && p.id && p.name);

const state = { campuses: [], campus: null, spot: null, map: null, marker: null, plan: plans[0]?.id || "" };

// MARK: - Setup

document.querySelectorAll("[data-icon]").forEach(el => { el.innerHTML = icon(el.dataset.icon); });
$("#ad-year").textContent = new Date().getFullYear();
initAnalytics(config);

$("#ad-plans").innerHTML = plans.length ? plans.map((p, i) => `
  <label class="ad-plan">
    <input type="radio" name="plan" value="${h(p.id)}" ${i === 0 ? "checked" : ""}>
    <span class="ad-plan-card">
      <span class="ad-plan-name">${h(p.name)}</span>
      <span class="ad-plan-price">${h(p.price)}<small> ${h(p.per || "")}</small></span>
      ${p.note ? `<span class="muted small">${h(p.note)}</span>` : ""}
    </span>
  </label>`).join("") : `<p class="muted">Plans and prices are sent by email after review.</p>`;

restoreDraft();
loadCampusList();
form.addEventListener("input", () => { saveDraft(); updatePreview(); updateCounts(); });
form.addEventListener("change", () => { saveDraft(); updatePreview(); });
$("#ad-campus").addEventListener("change", () => {
  state.campus = state.campuses.find(c => c.slug === $("#ad-campus").value) || null;
  if (state.spot && state.campus) describeSpot();
});
$("#ad-find").addEventListener("click", findOnMap);
$("#ad-drop").addEventListener("click", () => {
  if (!state.campus?.region) return showError("Choose your campus first.");
  placePin(state.spot || state.campus.region.center);
});
form.addEventListener("submit", submit);
updateCounts();
updatePreview();

async function loadCampusList() {
  const select = $("#ad-campus");
  try {
    const { campuses } = await loadCampuses(config);
    state.campuses = campuses.filter(c => c.region);
    let groups = null;
    try {
      const states = await loadStates();
      for (const c of state.campuses) c.state = stateAt(states, c.region.center);
      groups = new Map();
      for (const c of state.campuses) {
        const key = c.state?.name || "Other";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
      }
    } catch { /* one plain list */ }
    const option = c => `<option value="${h(c.slug)}">${h(c.name)}</option>`;
    select.innerHTML = `<option value="">Choose your campus</option>` + (groups
      ? [...groups.keys()].sort((a, b) => (a === "Other") - (b === "Other") || a.localeCompare(b))
          .map(name => `<optgroup label="${h(name)}">${groups.get(name).map(option).join("")}</optgroup>`).join("")
      : state.campuses.map(option).join(""));
    const wanted = new URLSearchParams(location.search).get("campus") || readDraft()?.campus;
    if (wanted && state.campuses.some(c => c.slug === wanted)) select.value = wanted;
    state.campus = state.campuses.find(c => c.slug === select.value) || null;
    updatePreview();
  } catch {
    select.innerHTML = `<option value="">Campuses couldn't load. Refresh to try again.</option>`;
  }
}

// MARK: - Location

async function findOnMap() {
  const data = new FormData(form);
  if (!state.campus?.region) return showError("Choose your campus first.");
  const name = String(data.get("name") || "").trim(), address = String(data.get("address") || "").trim();
  if (!name && !address) return showError("Enter your business name or street address first.");
  const box = $("#ad-matches");
  box.hidden = false;
  box.innerHTML = `<p class="muted small">Looking it up…</p>`;
  const center = state.campus.region.center;
  const lookup = async q => {
    const url = `${config.photonURL}?q=${encodeURIComponent(q)}&lat=${center.lat}&lon=${center.lng}&limit=6`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Photon ${response.status}`);
    return (await response.json()).features || [];
  };
  let features = [];
  try {
    features = await lookup([name, address].filter(Boolean).join(" "));
    if (!features.length && address) features = await lookup(address);
  } catch { /* falls through to "not found" */ }
  const near = features
    .map(f => ({ f, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }))
    .map(x => ({ ...x, meters: distanceMeters(center, x) }))
    .filter(x => x.meters < 25 * METERS_PER_MILE)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, 4);
  if (!near.length) {
    box.innerHTML = `<p class="muted small">Couldn't find that near ${h(state.campus.name)}. Use <b>Place the pin myself</b> instead.</p>`;
    return;
  }
  box.innerHTML = `<p class="muted small">Which one is yours?</p>` + near.map((x, i) => {
    const p = x.f.properties;
    const line = [p.name, [p.housenumber, p.street].filter(Boolean).join(" "), p.city].filter(Boolean).join(", ");
    return `<button type="button" class="ad-match" data-i="${i}">${icon("pin")}<span>${h(line || "Unnamed place")}<span class="muted small">${formatDistance(x.meters)} from campus</span></span></button>`;
  }).join("");
  box.querySelectorAll(".ad-match").forEach(button => button.addEventListener("click", () => {
    const x = near[+button.dataset.i];
    box.hidden = true;
    placePin({ lat: x.lat, lng: x.lng });
  }));
}

async function placePin(point) {
  state.spot = { lat: +point.lat.toFixed(6), lng: +point.lng.toFixed(6) };
  $("#ad-map-wrap").hidden = false;
  describeSpot();
  saveDraft();
  updatePreview();
  const gl = window.maplibregl;
  if (!gl) return;
  if (!state.map) {
    state.map = new gl.Map({
      container: "ad-map", style: config.streetsStyleURL || config.mapStyleURL,
      center: [state.spot.lng, state.spot.lat], zoom: 16.5, attributionControl: { compact: true }, dragRotate: false
    });
    state.marker = new gl.Marker({ draggable: true, color: "#e4b463" }).setLngLat([state.spot.lng, state.spot.lat]).addTo(state.map);
    state.marker.on("dragend", () => {
      const ll = state.marker.getLngLat();
      state.spot = { lat: +ll.lat.toFixed(6), lng: +ll.lng.toFixed(6) };
      describeSpot();
      saveDraft();
    });
  } else {
    state.marker.setLngLat([state.spot.lng, state.spot.lat]);
    state.map.jumpTo({ center: [state.spot.lng, state.spot.lat], zoom: 16.5 });
    state.map.resize();
  }
}

function describeSpot() {
  if (!state.spot || !state.campus?.region) return;
  const meters = distanceMeters(state.campus.region.center, state.spot);
  const far = meters > 6 * METERS_PER_MILE;
  $("#ad-where").innerHTML = far
    ? `<b class="warn">${formatDistance(meters)} from campus.</b> GradWay searches up to 6 miles out, so students may not see a listing this far away.`
    : `${formatDistance(meters)} from campus. Drag the pin onto your front door if it's off.`;
}

// MARK: - Preview

function listing() {
  const data = Object.fromEntries(new FormData(form));
  return {
    name: (data.name || "").trim(), category: data.category || "", offer: (data.offer || "").trim(),
    address: (data.address || "").trim(), url: normalizeURL(data.url), phone: (data.phone || "").trim(),
    hours: (data.hours || "").trim(), contact: (data.contact || "").trim(), email: (data.email || "").trim(),
    plan: data.plan || state.plan
  };
}

function normalizeURL(u) {
  const t = (u || "").trim();
  return !t ? "" : /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function updatePreview() {
  const l = listing();
  const campus = state.campus;
  const label = CATEGORY_LABELS[l.category] || "Coffee";
  const ic = CATEGORY_ICONS[l.category] || "coffee";
  const name = l.name || "Your business";
  const offer = l.offer || "Your offer for students";
  const distance = state.spot && campus?.region ? formatDistance(distanceMeters(campus.region.center, state.spot)) : "0.4 mi";
  $("#ad-preview").innerHTML = `
    <div class="ad-screen">
      <div class="ad-chip-row"><span class="chip is-active">${icon(ic)}${h(label)}</span></div>
      <p class="ad-label">Search results · ${h(campus?.name || "your campus")}</p>
      <div class="ad-results">
        <div class="ad-result is-sponsored">
          <span class="result-pin ad-gold-pin"></span>
          <span class="ad-result-text"><b>${h(name)}</b><span class="muted small">${h(offer)} · ${distance}</span></span>
          <span class="sponsored-tag">Sponsored</span>
        </div>
        <div class="ad-result"><span class="result-pin"></span><span class="ad-result-text"><b>Another ${h(label.toLowerCase())} spot</b><span class="muted small">0.6 mi</span></span></div>
        <div class="ad-result"><span class="result-pin"></span><span class="ad-result-text"><b>One more nearby</b><span class="muted small">0.9 mi</span></span></div>
      </div>
      <p class="ad-label">On the campus dashboard</p>
      <h3 class="section-title">Local deals</h3>
      <div class="rows"><div class="row deal-row row-only">
        <span class="row-icon gold-icon">${icon("tag")}</span>
        <span class="deal-text"><span class="row-title">${h(name)}</span><span class="muted small">${h(offer)}</span></span>
        <span class="sponsored-tag">Sponsored</span>
      </div></div>
    </div>`;
}

function updateCounts() {
  document.querySelectorAll("[data-count-for]").forEach(el => {
    const input = form.elements[el.dataset.countFor];
    el.textContent = `${input.value.length}/${input.maxLength}`;
  });
}

// MARK: - Submit

function showError(text) {
  const el = $("#ad-error");
  el.textContent = text;
  el.hidden = !text;
  if (text) el.scrollIntoView({ block: "center", behavior: "smooth" });
}

function addMonths(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

async function submit(event) {
  event.preventDefault();
  const l = listing();
  const campus = state.campus;
  const plan = plans.find(p => p.id === l.plan) || plans[0] || { id: "listing", name: "Listing", months: 1 };
  const missing = [
    !campus && "your campus", !l.name && "business name", !l.category && "category", !l.offer && "offer",
    !l.address && "address", !state.spot && "your spot on the map (Find it on the map)",
    !l.contact && "your name", !/^\S+@\S+\.\S+$/.test(l.email) && "a valid email"
  ].filter(Boolean);
  if (missing.length) return showError(`Please add ${missing.join(", ")}.`);
  showError("");

  const entry = {
    name: l.name, category: l.category, offer: l.offer, lat: state.spot.lat, lng: state.spot.lng, address: l.address,
    ...(l.url ? { url: l.url } : {}), ...(l.phone ? { phone: l.phone } : {}), ends: addMonths(plan.months || 1)
  };
  const reference = `${campus.slug}-${slugify(l.name)}`.slice(0, 120);
  const summary = [
    `New GradWay sponsored listing`,
    ``,
    `Campus: ${campus.name}`,
    `Plan: ${plan.name}${plan.price ? ` (${plan.price} ${plan.per || ""})` : ""}`,
    `Business: ${l.name}`,
    `Category: ${CATEGORY_LABELS[l.category]}`,
    `Offer: ${l.offer}`,
    `Address: ${l.address}`,
    l.url && `Website: ${l.url}`,
    l.phone && `Phone: ${l.phone}`,
    l.hours && `Hours: ${l.hours}`,
    `Contact: ${l.contact} <${l.email}>`,
    `Reference: ${reference}`,
    ``,
    `sponsors.json entry (add under "${campus.name}" in "campuses"; set "ends" once paid):`,
    JSON.stringify(entry, null, 2)
  ].filter(x => x !== false && x !== "").join("\n").replace(/\n(?=sponsors\.json)/, "\n\n");

  const button = form.querySelector(".ad-submit");
  button.disabled = true;
  button.textContent = "Sending…";
  let sent = false;
  if (config.sponsorFormURL) {
    try {
      const response = await fetch(config.sponsorFormURL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ _subject: `GradWay listing: ${l.name} at ${campus.name}`, email: l.email, campus: campus.name, plan: plan.name, reference, message: summary })
      });
      sent = response.ok;
    } catch { sent = false; }
  }
  button.disabled = false;
  button.textContent = "Send my listing for review";
  trackEvent("sponsor-signup", campus.name, plan.id);
  showDone({ sent, summary, campus, plan, reference, email: l.email, name: l.name });
}

function showDone({ sent, summary, campus, plan, reference, email, name }) {
  const pay = plan.paymentURL
    ? `${plan.paymentURL}${plan.paymentURL.includes("?") ? "&" : "?"}prefilled_email=${encodeURIComponent(email)}&client_reference_id=${encodeURIComponent(reference)}`
    : "";
  const mail = `mailto:${config.contactEmail}?subject=${encodeURIComponent(`GradWay listing: ${name} at ${campus.name}`)}&body=${encodeURIComponent(summary)}`;
  const done = $("#ad-done");
  done.innerHTML = sent ? `
      <p class="eyebrow gold">Sent</p>
      <h2>Thanks! ${h(name)} is in for review.</h2>
      <p>We'll check your listing, usually within one business day, and email <b>${h(email)}</b> when it's live at ${h(campus.name)}.</p>
      ${pay ? `<a class="btn btn-gold" href="${h(pay)}" target="_blank" rel="noopener">Pay for the ${h(plan.name.toLowerCase())} plan</a>
      <p class="muted small">Secure checkout by Stripe. Your listing starts when it's approved.</p>`
        : `<p class="muted">We'll send a secure payment link with your approval.</p>`}` : `
      <p class="eyebrow gold">Almost done</p>
      <h2>Send your listing to GradWay</h2>
      <p>Tap the button to email your listing to us. If your email app doesn't open, copy the details and send them to <b class="ad-email">${h(config.contactEmail)}</b>.</p>
      <div class="ad-done-actions">
        <a class="btn btn-gold" href="${h(mail)}">Email my listing</a>
        <button type="button" class="btn btn-glass" id="ad-copy">Copy the details</button>
      </div>
      ${pay ? `<p>Then pay for the ${h(plan.name.toLowerCase())} plan: <a href="${h(pay)}" target="_blank" rel="noopener">secure checkout by Stripe</a>. Your listing starts when it's approved.</p>`
        : `<p class="muted">We'll reply with a secure payment link once it's approved, usually within one business day.</p>`}
      <details class="ad-details"><summary>See what we'll receive</summary><pre>${h(summary)}</pre></details>`;
  done.hidden = false;
  form.hidden = true;
  document.querySelector(".ad-preview").classList.add("is-done");
  done.focus();
  done.scrollIntoView({ block: "start", behavior: "smooth" });
  $("#ad-copy")?.addEventListener("click", async event => {
    try { await navigator.clipboard.writeText(summary); event.target.textContent = "Copied"; }
    catch { done.querySelector(".ad-details").open = true; event.target.textContent = "Select the text below"; }
  });
  try { localStorage.removeItem("gradway.sponsorDraft"); } catch {}
}

// MARK: - Draft (kept in this browser only)

function saveDraft() {
  try {
    const data = Object.fromEntries(new FormData(form));
    localStorage.setItem("gradway.sponsorDraft", JSON.stringify({ ...data, campus: $("#ad-campus").value, spot: state.spot }));
  } catch {}
}
function readDraft() {
  try { return JSON.parse(localStorage.getItem("gradway.sponsorDraft") || "null"); } catch { return null; }
}
function restoreDraft() {
  const draft = readDraft();
  if (!draft) return;
  for (const [key, value] of Object.entries(draft)) {
    const el = form.elements[key];
    if (!el || key === "campus") continue;
    if (el instanceof RadioNodeList) { for (const r of el) r.checked = r.value === value; }
    else el.value = value;
  }
  if (draft.spot) { state.spot = draft.spot; setTimeout(() => placePin(draft.spot), 0); }
}
