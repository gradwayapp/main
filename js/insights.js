// Campus Insights: a dashboard for a university's leaders, built from GradWay's
// anonymous navigation data (or a labeled sample until a campus is live).
// Charts are hand-built SVG with a hover layer, and every chart has a table view.

import { loadCampuses } from "./data.js";
import { fetchInsights, sampleInsights, findings } from "./insights-data.js";

const config = window.GRADWAY_CONFIG;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => Math.round(n).toLocaleString();
const pct = (n, d = 0) => `${(n * 100).toFixed(d)}%`;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hourLabel = h => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);
const params = new URLSearchParams(location.search);
const state = { campuses: [], campus: null, range: params.get("range") || "30", audience: params.get("audience") || "all", data: null, tables: new Set(), map: null };

// MARK: - Theme

function setTheme(dark) {
  if (dark) document.documentElement.dataset.theme = "dark"; else delete document.documentElement.dataset.theme;
  try { localStorage.setItem("gradway.insightsTheme", JSON.stringify(dark ? "dark" : "light")); } catch {}
  $("#theme").innerHTML = dark
    ? `<svg viewBox="0 0 24 24" class="i"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>`
    : `<svg viewBox="0 0 24 24" class="i"><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/></svg>`;
  $("#theme").setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
  if (state.data) draw();
}
$("#theme").addEventListener("click", () => setTheme(document.documentElement.dataset.theme !== "dark"));
setTheme(document.documentElement.dataset.theme === "dark");

// MARK: - Boot

boot();
async function boot() {
  try {
    state.campuses = (await loadCampuses(config)).campuses.filter(c => c.region);
  } catch {
    return showError("Campuses couldn't load. Refresh to try again.");
  }
  const wanted = params.get("campus");
  state.campus = state.campuses.find(c => c.slug === wanted) || state.campuses.find(c => /mississippi state/i.test(c.name)) || state.campuses[0];
  $("#f-campus").innerHTML = state.campuses.map(c => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join("");
  $("#f-campus").value = state.campus.slug;
  $("#f-campus").addEventListener("change", () => { state.campus = state.campuses.find(c => c.slug === $("#f-campus").value); state.map?.remove(); state.map = null; load(); });
  for (const b of document.querySelectorAll("[data-range]")) b.addEventListener("click", () => { state.range = b.dataset.range; load(); });
  for (const b of document.querySelectorAll("[data-audience]")) b.addEventListener("click", () => { state.audience = b.dataset.audience; load(); });
  $("#csv").addEventListener("click", downloadCSV);
  $("#pdf").addEventListener("click", () => window.print());
  let resizeTimer;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => state.data && drawCharts(), 120); }).observe($("#board"));
  // Charts are drawn to fit their card, so redraw them for the printed page and back.
  window.addEventListener("beforeprint", () => state.data && drawCharts());
  window.addEventListener("afterprint", () => state.data && drawCharts());
  load();
}

function rangeDates() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(today); end.setDate(end.getDate() - 1);
  let start;
  if (state.range === "term") {
    const y = today.getFullYear();
    start = today.getMonth() >= 7 ? new Date(y, 7, 18) : new Date(y, 0, 12);
  } else {
    start = new Date(end); start.setDate(end.getDate() - (+state.range - 1));
  }
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: iso(start), to: iso(end), start, end };
}

async function load() {
  document.querySelectorAll("[data-range]").forEach(b => b.classList.toggle("on", b.dataset.range === state.range));
  document.querySelectorAll("[data-audience]").forEach(b => b.classList.toggle("on", b.dataset.audience === state.audience));
  const { from, to, start, end } = rangeDates();
  const d = x => x.toLocaleDateString([], { month: "short", day: "numeric", year: start.getFullYear() !== end.getFullYear() ? "numeric" : undefined });
  $("#range-note").textContent = `${d(start)} – ${d(end)}, ${end.getFullYear()}`;
  $("#board").classList.add("is-loading");
  showError("");
  const key = params.get("key");
  let data;
  try {
    data = config.insightsEndpoint && key
      ? await fetchInsights(config, { campus: state.campus, from, to, audience: state.audience, key })
      : sampleInsights(state.campus, { from, to, audience: state.audience });
  } catch (error) {
    showError(`${error.message} Showing sample data instead.`);
    data = sampleInsights(state.campus, { from, to, audience: state.audience });
  }
  state.data = data;
  $("#sample-note").hidden = !data.sample;
  history.replaceState(null, "", `?${new URLSearchParams({ campus: state.campus.slug, range: state.range, audience: state.audience, ...(key ? { key } : {}) })}`);
  draw();
  $("#board").classList.remove("is-loading");
}

function showError(text) { $("#error").textContent = text; $("#error").hidden = !text; }

// MARK: - Layout

function delta(key, lowerIsBetter = false, neutral = false) {
  const now = state.data.totals[key], before = state.data.previous?.[key];
  if (!before) return "";
  const change = (now - before) / before;
  if (Math.abs(change) < 0.005) return `<span class="ins-delta">Same as the previous period</span>`;
  const up = change > 0;
  const good = lowerIsBetter ? !up : up;
  return `<span class="ins-delta ${neutral ? "" : good ? "good" : "bad"}"><span aria-hidden="true">${up ? "▲" : "▼"}</span> ${pct(Math.abs(change))} <span class="muted">vs previous ${state.data.days} days</span></span>`;
}

function card(id, title, sub, body, { wide = false, table = true, cls = "" } = {}) {
  return `<section class="ins-card ${wide ? "wide" : ""} ${cls}" id="card-${id}">
    <header class="ins-card-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ""}</div>
      ${table ? `<button class="ins-link" type="button" data-table="${id}">${state.tables.has(id) ? "Show chart" : "Show table"}</button>` : ""}</header>
    <div class="ins-card-body" data-chart="${id}">${body}</div>
  </section>`;
}

function draw() {
  const data = state.data, t = data.totals, c = state.campus;
  $("#campus-head").innerHTML = `<span class="ins-badge" style="--campus:${c.theme}">${esc(c.initials)}</span>
    <div><p class="ins-eyebrow">Prepared for</p><h1>${esc(c.name)}</h1></div>`;
  const kpis = [
    ["Routes given", fmt(t.routes), delta("routes"), "Walking and driving directions to a place on or near campus"],
    ["People helped", fmt(t.people), delta("people"), "Devices that used GradWay, counted once a day"],
    ["Average route", `${t.avgRouteMi.toFixed(2)} mi`, delta("avgRouteMi", false, true), `About a ${Math.round(t.avgWalkMin)}-minute walk`],
    ["On foot", pct(t.walkShare), delta("walkShare", false, true), `${pct(1 - t.walkShare)} of routes are by car`],
    ["Searches", fmt(t.searches), delta("searches"), "Buildings, food, parking and more"],
    ["After dark", pct(t.afterDarkShare), delta("afterDarkShare", false, true), "Routes that start after 6 PM"]
  ];
  $("#board").innerHTML = `
    <div class="ins-kpis">${kpis.map(([label, value, d, note]) => `<div class="ins-kpi"><span class="ins-kpi-label">${label}</span><span class="ins-kpi-value">${value}</span>${d}<span class="ins-kpi-note">${note}</span></div>`).join("")}</div>
    <div class="ins-grid">
      ${card("daily", "Routes per day", "Walking and driving directions requested", "", { wide: true })}
      <section class="ins-card ins-findings"><header class="ins-card-head"><div><h2>What stands out</h2><p>Found in this period's data</p></div></header>
        <ol>${findings(data).map(f => `<li>${esc(f)}</li>`).join("")}</ol></section>
      ${card("heat", "When people find their way", "Routes by day and hour. Darker means busier", "", { wide: true, cls: "full" })}
      ${card("map", "Where people go", "Destinations on campus. Brighter means more routes", `<div class="ins-map" id="ins-map" role="img" aria-label="Map of where routes on campus lead"></div><p class="ins-map-note muted" id="map-note"></p>`, { wide: true, table: false })}
      ${card("dest", "Top destinations", "Routes requested to each place", "")}
      ${card("cats", "What people look for", "Quick searches by category", "")}
      ${card("lengths", "How far people go", "Routes by distance", "")}
      ${card("gaps", "Searches with no results", "Names people use that the map doesn't know yet", "", { table: false })}
      ${card("parking", "Parking demand by hour", "Parking searches and routes to lots", "", { wide: true })}
      ${card("audience", "Who uses GradWay", "Students and visitors", "", { table: false })}
      ${card("alerts", "Campus alerts", "Messages shown on the GradWay dashboard", "", { table: false })}
      ${card("planning", "Planning ahead and safety", "Features that keep people on time and safe", "", { table: false, wide: true })}
    </div>`;
  for (const b of document.querySelectorAll("[data-table]")) b.addEventListener("click", () => {
    const id = b.dataset.table;
    state.tables.has(id) ? state.tables.delete(id) : state.tables.add(id);
    b.textContent = state.tables.has(id) ? "Show chart" : "Show table";
    drawCharts();
  });
  drawCharts();
  drawMap();
}

function drawCharts() {
  const data = state.data;
  const body = id => document.querySelector(`[data-chart="${id}"]`);
  const show = (id, chart, table) => { const el = body(id); if (el) el.innerHTML = state.tables.has(id) ? table() : chart(el.clientWidth); };

  show("daily", w => lineChart(w, data.daily), () => tableHTML(["Date", "Walking", "Driving", "Total"], data.daily.map(d => [d.date, fmt(d.walk), fmt(d.drive), fmt(d.walk + d.drive)])));
  show("heat", w => heatmap(w, data.heat), () => tableHTML(["Day", ...Array.from({ length: 24 }, (_, h) => hourLabel(h))], data.heat.map((row, i) => [DAYS[i], ...row.map(fmt)])));
  show("dest", w => barList(data.destinations.slice(0, 10).map(d => ({ label: d.name, sub: d.kind, value: d.routes })), w), () => tableHTML(["Destination", "Type", "Routes", "Average distance"], data.destinations.map(d => [d.name, d.kind, fmt(d.routes), `${d.avgMi} mi`])));
  show("cats", w => barList(data.categories.map(c => ({ label: c.label, value: c.searches })), w), () => tableHTML(["Category", "Searches"], data.categories.map(c => [c.label, fmt(c.searches)])));
  show("lengths", w => columns(w, data.lengths.map(l => ({ label: l.label, value: l.count })), { height: 210 }), () => tableHTML(["Distance", "Routes"], data.lengths.map(l => [l.label, fmt(l.count)])));
  show("parking", w => columns(w, data.parkingByHour.map((v, h) => ({ label: hourLabel(h), value: v, title: `${hourLabel(h)}–${hourLabel((h + 1) % 24)}` })), { height: 220, every: 3 }), () => tableHTML(["Hour", "Parking searches and routes"], data.parkingByHour.map((v, h) => [hourLabel(h), fmt(v)])));
  body("gaps").innerHTML = `<table class="ins-table compact"><thead><tr><th>Searched for</th><th class="num">Times</th></tr></thead><tbody>${data.noResults.map(q => `<tr><td>"${esc(q.query)}"</td><td class="num">${fmt(q.count)}</td></tr>`).join("")}</tbody></table>
    <p class="muted small">GradWay adds these names so the next search finds the right place.</p>`;
  const a = data.audience, totalPeople = Math.max(1, a.students + a.visitors);
  body("audience").innerHTML = `<div class="ins-split" role="img" aria-label="Students ${pct(a.students / totalPeople)}, visitors ${pct(a.visitors / totalPeople)}">
      <span class="s1" style="flex:${a.students}"></span><span class="s2" style="flex:${a.visitors}"></span></div>
    <div class="ins-legend"><span><i class="k1"></i>Students <b>${fmt(a.students)}</b> · ${pct(a.students / totalPeople)}</span><span><i class="k2"></i>Visitors <b>${fmt(a.visitors)}</b> · ${pct(a.visitors / totalPeople)}</span></div>
    <div class="ins-mini"><span class="ins-mini-value">${fmt(a.firstTimeVisitors)}</span><span>first-time visitors: prospective students, families and guests finding their way</span></div>`;
  body("alerts").innerHTML = `<table class="ins-table compact"><thead><tr><th>Alert</th><th class="num">Seen</th><th class="num">Tapped</th></tr></thead><tbody>${data.alerts.map(al => `<tr><td>${esc(al.text)}</td><td class="num">${fmt(al.views)}</td><td class="num">${fmt(al.taps)}</td></tr>`).join("")}</tbody></table>
    <p class="muted small">${fmt(data.totals.alertViews)} views and ${fmt(data.totals.alertTaps)} taps in this period. Send alerts any time from the GradWay alerts editor.</p>`;
  const tiles = [
    [fmt(data.totals.schedulesImported), "class schedules imported"], [fmt(data.totals.remindersOn), "students with leave-by reminders"],
    [fmt(data.safety.afterDarkRoutes), "routes after dark"], [fmt(data.safety.safetyOpens), "opened Safety & Emergency"], [fmt(data.safety.shareLocation), "shared their location with someone"]
  ];
  body("planning").innerHTML = `<div class="ins-tiles">${tiles.map(([v, l]) => `<div><span>${v}</span>${l}</div>`).join("")}</div>`;
  attachTips();
}

const tableHTML = (head, rows) => `<div class="ins-table-wrap"><table class="ins-table"><thead><tr>${head.map((x, i) => `<th class="${i ? "num" : ""}">${esc(x)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((x, i) => `<td class="${i ? "num" : ""}">${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;

// MARK: - Charts (SVG)

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(Math.max(1, v)));
  return [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(m => m * p).find(m => m >= v) || v;
}

function lineChart(width, daily) {
  const h = 260, m = { t: 14, r: 16, b: 30, l: 46 };
  const w = Math.max(280, width);
  const iw = w - m.l - m.r, ih = h - m.t - m.b;
  const max = niceMax(Math.max(...daily.map(d => d.walk), ...daily.map(d => d.drive)));
  const x = i => m.l + (daily.length === 1 ? iw / 2 : (i / (daily.length - 1)) * iw);
  const y = v => m.t + ih - (v / max) * ih;
  const path = key => daily.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(d[key]).toFixed(1)}`).join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
  const labelEvery = Math.ceil(daily.length / Math.max(2, Math.floor(iw / 70)));
  const dateLabel = s => new Date(`${s}T00:00`).toLocaleDateString([], { month: "short", day: "numeric" });
  const last = daily.length - 1;
  return `<div class="ins-legend top"><span><i class="k1 line"></i>Walking</span><span><i class="k2 line"></i>Driving</span></div>
  <svg class="ins-svg" width="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" data-kind="line" data-points='${JSON.stringify(daily.map((d, i) => [x(i), d.date, d.walk, d.drive]))}'>
    ${ticks.map(v => `<line class="grid" x1="${m.l}" x2="${w - m.r}" y1="${y(v)}" y2="${y(v)}"/><text class="axis" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`).join("")}
    ${daily.map((d, i) => (i % labelEvery === 0 ? `<text class="axis" x="${x(i)}" y="${h - 8}" text-anchor="middle">${dateLabel(d.date)}</text>` : "")).join("")}
    <path class="series s1" d="${path("walk")}"/>
    <path class="series s2" d="${path("drive")}"/>
    <circle class="end s1" cx="${x(last)}" cy="${y(daily[last].walk)}" r="4"/>
    <circle class="end s2" cx="${x(last)}" cy="${y(daily[last].drive)}" r="4"/>
    <line class="crosshair" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>
    <rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent" tabindex="0" aria-label="Routes per day chart. Use the table for exact values."/>
  </svg>`;
}

function heatmap(width, heat) {
  const w = Math.max(320, width);
  const m = { t: 8, r: 8, b: 26, l: 40 };
  const cw = (w - m.l - m.r) / 24, ch = Math.min(30, Math.max(20, cw * 0.8));
  const h = m.t + ch * 7 + m.b;
  const max = Math.max(...heat.flat(), 1);
  const order = [1, 2, 3, 4, 5, 6, 0];
  const ramp = ["--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5", "--seq-6", "--seq-7"];
  const step = v => (v <= 0 ? "--seq-0" : ramp[Math.min(ramp.length - 1, Math.floor((v / max) * ramp.length))]);
  return `<svg class="ins-svg" width="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
    ${order.map((d, row) => `<text class="axis" x="${m.l - 8}" y="${m.t + row * ch + ch / 2 + 4}" text-anchor="end">${DAYS[d]}</text>
      ${heat[d].map((v, hr) => `<rect class="cell" x="${(m.l + hr * cw + 1).toFixed(1)}" y="${(m.t + row * ch + 1).toFixed(1)}" width="${(cw - 2).toFixed(1)}" height="${(ch - 2).toFixed(1)}" rx="3" fill="var(${step(v)})" tabindex="-1" data-tip="${DAYS[d]} ${hourLabel(hr)}–${hourLabel((hr + 1) % 24)}|${fmt(v)} routes"/>`).join("")}`).join("")}
    ${Array.from({ length: 24 }, (_, hr) => (hr % 3 === 0 ? `<text class="axis" x="${m.l + hr * cw + cw / 2}" y="${h - 8}" text-anchor="middle">${hourLabel(hr)}</text>` : "")).join("")}
  </svg>
  <div class="ins-ramp" aria-hidden="true"><span>Fewer</span>${["--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5", "--seq-6", "--seq-7"].map(v => `<i style="background:var(${v})"></i>`).join("")}<span>More</span></div>`;
}

function barList(items, width) {
  const max = Math.max(...items.map(i => i.value), 1);
  return `<ol class="ins-bars">${items.map(i => `<li data-tip="${esc(i.label)}|${fmt(i.value)}${i.sub ? ` · ${esc(i.sub)}` : ""}" tabindex="-1">
      <span class="ins-bar-label">${esc(i.label)}</span><span class="ins-bar-value">${fmt(i.value)}</span>
      <span class="ins-bar-track"><span class="ins-bar" style="width:${Math.max(1.5, (i.value / max) * 100)}%"></span></span></li>`).join("")}</ol>`;
}

function columns(width, items, { height = 220, every = 1 } = {}) {
  const w = Math.max(280, width), h = height, m = { t: 22, r: 6, b: 28, l: 6 };
  const iw = w - m.l - m.r, ih = h - m.t - m.b;
  const max = niceMax(Math.max(...items.map(i => i.value), 1));
  const bw = iw / items.length;
  const peak = items.reduce((best, i, k) => (i.value > items[best].value ? k : best), 0);
  return `<svg class="ins-svg" width="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
    <line class="baseline" x1="${m.l}" x2="${w - m.r}" y1="${m.t + ih}" y2="${m.t + ih}"/>
    ${items.map((it, k) => {
      const bh = Math.max(2, (it.value / max) * ih);
      const x = m.l + k * bw + 1, y = m.t + ih - bh, width = Math.max(2, bw - 2);
      return `<path class="col" d="M${x} ${m.t + ih} V${y + Math.min(4, bh)} q0 -4 4 -4 H${x + width - 4} q4 0 4 4 V${m.t + ih} Z" data-tip="${esc(it.title || it.label)}|${fmt(it.value)}" tabindex="-1"/>
        ${k === peak || items.length <= 8 ? `<text class="val" x="${x + width / 2}" y="${y - 6}" text-anchor="middle">${fmt(it.value)}</text>` : ""}
        ${k % every === 0 ? `<text class="axis" x="${x + width / 2}" y="${h - 9}" text-anchor="middle">${esc(it.label)}</text>` : ""}`;
    }).join("")}
  </svg>`;
}

// MARK: - Hover layer

function attachTips() {
  const tip = $("#tip");
  const place = (e, html) => {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = e.clientX + 14, top = e.clientY + 14;
    if (left + r.width > innerWidth - 8) left = e.clientX - r.width - 14;
    if (top + r.height > innerHeight - 8) top = e.clientY - r.height - 14;
    tip.style.left = `${left}px`; tip.style.top = `${top}px`;
  };
  const hide = () => { tip.hidden = true; };
  for (const el of document.querySelectorAll("[data-tip]")) {
    const [label, value] = el.dataset.tip.split("|");
    el.addEventListener("pointermove", e => place(e, `<b>${esc(value)}</b><span>${esc(label)}</span>`));
    el.addEventListener("pointerleave", hide);
  }
  for (const svg of document.querySelectorAll('svg[data-kind="line"]')) {
    const points = JSON.parse(svg.dataset.points);
    const hair = svg.querySelector(".crosshair");
    const hit = svg.querySelector(".hit");
    hit.addEventListener("pointermove", e => {
      const box = svg.getBoundingClientRect();
      const px = (e.clientX - box.left) * (svg.viewBox.baseVal.width / box.width);
      const p = points.reduce((best, q) => (Math.abs(q[0] - px) < Math.abs(best[0] - px) ? q : best));
      hair.setAttribute("x1", p[0]); hair.setAttribute("x2", p[0]); hair.setAttribute("visibility", "visible");
      const date = new Date(`${p[1]}T00:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
      place(e, `<span class="tip-head">${date}</span><span class="tip-row"><i class="k1 line"></i><b>${fmt(p[2])}</b> walking</span><span class="tip-row"><i class="k2 line"></i><b>${fmt(p[3])}</b> driving</span>`);
    });
    hit.addEventListener("pointerleave", () => { hide(); hair.setAttribute("visibility", "hidden"); });
  }
}

// MARK: - Map

async function drawMap() {
  const gl = window.maplibregl;
  const el = document.getElementById("ins-map");
  if (!gl || !el || !state.campus.region) return;
  const center = state.campus.region.center;
  const points = state.data.cells || await sampleCells(state.data.destinations, center);
  const features = points.map(p => ({ type: "Feature", properties: { count: p.count, name: p.name || "" }, geometry: { type: "Point", coordinates: [p.lng, p.lat] } }));
  const labels = (state.data.cells ? [] : state.sampleSpots || []).slice(0, 6).map(s => ({ type: "Feature", properties: { name: s.name }, geometry: { type: "Point", coordinates: [s.lng, s.lat] } }));
  $("#map-note").textContent = state.data.sample ? "Sample activity placed at real campus buildings. Live maps use a 150 m grid." : "Activity on a 150 m grid. Squares with fewer than 10 routes are hidden.";
  const dark = document.documentElement.dataset.theme === "dark";
  state.map?.remove();
  state.map = new gl.Map({
    container: el, style: dark ? config.navyStyleURL : config.mapStyleURL, center: [center.lng, center.lat], zoom: 14.6,
    attributionControl: { compact: true }, dragRotate: false, cooperativeGestures: true, preserveDrawingBuffer: true
  });
  state.map.on("load", () => {
    const map = state.map;
    map.addSource("activity", { type: "geojson", data: { type: "FeatureCollection", features } });
    const max = Math.max(...points.map(p => p.count), 1);
    map.addLayer({ id: "activity-heat", type: "heatmap", source: "activity", paint: {
      "heatmap-weight": ["/", ["get", "count"], max], "heatmap-intensity": 1.2, "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 13, 18, 16, 46],
      "heatmap-opacity": 0.82,
      "heatmap-color": ["interpolate", ["linear"], ["heatmap-density"], 0, "rgba(42,120,214,0)", 0.15, "#b7d3f6", 0.35, "#6da7ec", 0.55, "#2a78d6", 0.75, "#eb6834", 1, "#e34948"]
    } });
    if (labels.length) {
      map.addSource("labels", { type: "geojson", data: { type: "FeatureCollection", features: labels } });
      map.addLayer({ id: "label-dots", type: "circle", source: "labels", paint: { "circle-radius": 4, "circle-color": "#ffffff", "circle-stroke-color": "#0b0b0b", "circle-stroke-width": 1.5 } });
      map.addLayer({ id: "label-text", type: "symbol", source: "labels", layout: { "text-field": ["get", "name"], "text-size": 12, "text-offset": [0, 1.1], "text-anchor": "top", "text-font": ["Noto Sans Bold"] },
        paint: { "text-color": "#0b0b0b", "text-halo-color": "#ffffff", "text-halo-width": 1.6 } });
    }
    const coords = (labels.length ? labels : features).map(f => f.geometry.coordinates);
    if (coords.length > 1) {
      const lngs = coords.map(c => c[0]), lats = coords.map(c => c[1]);
      map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 50, maxZoom: 16, duration: 0 });
    }
  });
}

/** Sample mode: find each destination on the map (once), then spread its routes around it. */
async function sampleCells(destinations, center) {
  const cacheKey = `gradway.insightSpots.${state.campus.slug}`;
  let spots = {};
  try { spots = JSON.parse(localStorage.getItem(cacheKey) || "{}"); } catch {}
  const missing = destinations.filter(d => !spots[d.name]);
  const box = [center.lng - 0.03, center.lat - 0.02, center.lng + 0.03, center.lat + 0.02];
  await Promise.all(missing.map(async d => {
    try {
      const r = await fetch(`${config.photonURL}?q=${encodeURIComponent(d.name)}&bbox=${box.join(",")}&limit=1`);
      const f = (await r.json()).features?.[0];
      if (f) spots[d.name] = { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
    } catch {}
  }));
  try { localStorage.setItem(cacheKey, JSON.stringify(spots)); } catch {}
  const placed = destinations.filter(d => spots[d.name]).map(d => ({ ...d, ...spots[d.name] }));
  state.sampleSpots = placed;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = [];
  for (const d of placed) {
    for (let k = 0; k < 6; k++) out.push({ lat: d.lat + (rand() - 0.5) * 0.0012, lng: d.lng + (rand() - 0.5) * 0.0014, count: d.routes / 6, name: d.name });
  }
  if (!out.length) out.push({ lat: center.lat, lng: center.lng, count: 1 });
  return out;
}

// MARK: - Export

function downloadCSV() {
  const d = state.data;
  const rows = [["GradWay Campus Insights", d.campus], ["Dates", `${d.from} to ${d.to}`], ["People", state.audience], ["Sample data", d.sample ? "yes" : "no"], [],
    ["Metric", "Value"], ...Object.entries(d.totals).map(([k, v]) => [k, v]), [],
    ["Date", "Walking routes", "Driving routes"], ...d.daily.map(x => [x.date, x.walk, x.drive]), [],
    ["Destination", "Type", "Routes", "Average miles"], ...d.destinations.map(x => [x.name, x.kind, x.routes, x.avgMi]), [],
    ["Category", "Searches"], ...d.categories.map(x => [x.label, x.searches]), [],
    ["Search with no results", "Times"], ...d.noResults.map(x => [x.query, x.count]), [],
    ["Day", ...Array.from({ length: 24 }, (_, h) => hourLabel(h))], ...d.heat.map((r, i) => [DAYS[i], ...r]), [],
    ["Hour", "Parking demand"], ...d.parkingByHour.map((v, h) => [hourLabel(h), v])];
  const csv = rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `GradWay Insights - ${d.campus} - ${d.from} to ${d.to}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
