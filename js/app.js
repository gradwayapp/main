// GradWay for the web: campus picker, student/visitor dashboard, schedule,
// building directory and a campus map with the app's search behaviour.

import { loadCampuses, resolveBuildings, regionAround, formatDistance, walkMinutes, distanceMeters } from "./data.js";
import { runSearch, sortByDistance, bestNameMatch, prefetchCampus, placeDetails, intentFor, CATEGORIES, QUICK_CATEGORIES, DETAIL_LAYERS, SEARCH_RADIUS_MILES } from "./search.js";
import { parseOpeningHours, openStatus, formatWeek } from "./hours.js";
import { initAnalytics, trackPage, trackEvent as countEvent, totalVisits } from "./analytics.js";
import { initInsights, record, recordVisit, cellOf } from "./insights-client.js";

// Actions that also count toward Campus Insights (anonymous; see insights-client.js).
const INSIGHT_ACTIONS = new Set(["schedule-import", "leave-notify-on", "leave-calendar", "tour-finish",
  "route-preview", "street-view", "safety-open", "share-location", "map-place", "hours-lookup", "recenter", "sponsor-click"]);
function trackEvent(name, ...rest) {
  countEvent(name, ...rest);
  if (INSIGHT_ACTIONS.has(name)) record("action", { name });
}
import { CampusMap, MAP_STYLES, escapeHTML as h } from "./map.js";
import { currentWeather } from "./weather.js";
import { travelRoute, nearestStreet } from "./route.js";
import { store } from "./store.js";
import { loadStates, stateAt } from "./states.js";
import { parseICS, parsePasted, matchBuilding } from "./schedule-import.js";
import { ALERT_TYPES, alertsFor, loadAlerts } from "./alerts.js";
import { leaveInfo, walkMinutesBetween, previousClass, buildICS } from "./reminders.js";
import { playTour } from "./tour.js";
import { icon } from "./icons.js";

const config = window.GRADWAY_CONFIG;
const desktop = matchMedia("(min-width: 1000px)");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(navigator.userAgent);

const state = {
  campuses: [],
  isSample: false,
  campus: null,
  userPosition: null,
  map: null,
  searchGeneration: 0,
  searchAbort: null,
  lastSearchKey: null,
  results: [],
  selected: null,
  installPrompt: null
};

const $ = selector => document.querySelector(selector);
const view = $("#view");
const mapPane = $("#map-pane");
const sheet = $("#map-sheet");
const statusEl = $("#map-status");
const searchInput = $("#map-q");

// MARK: - Boot

async function boot() {
  applyTheme(store.theme);
  view.innerHTML = `<div class="loading" role="status"><div class="spinner"></div><p>Loading campuses…</p></div>`;
  const [{ campuses, isSample }] = await Promise.all([loadCampuses(config), loadSponsors(), loadDeals()]);
  state.campuses = campuses;
  state.isSample = isSample;
  const saved = campuses.find(c => c.name === store.campusName);
  if (saved) applyCampus(saved);

  initAnalytics(config);
  initInsights(config, () => ({ campus: state.campus?.name, role: state.campus ? (isVisitor() ? "visitor" : store.modeFor(state.campus.name) ? "student" : "unknown") : null }));
  if (state.campus) recordVisit();
  buildMapChrome();
  window.addEventListener("hashchange", () => transition(render));
  desktop.addEventListener("change", render);
  document.addEventListener("click", onClick);
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    state.installPrompt = event;
    if (routeName() === "dashboard") render();
  });
  render();
  startReminderLoop();
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

/** Sponsored places (data/sponsors.json), keyed by campus name. Optional: a missing file means none. */
async function loadSponsors() {
  state.sponsors = {};
  if (!config.sponsorsURL) return;
  try {
    const response = await fetch(config.sponsorsURL, { cache: "no-store" });
    if (!response.ok) return;
    const json = await response.json();
    state.sponsors = json.campuses || {};
  } catch { /* no sponsors */ }
}

/** Deals of the Month (data/deals.json): national student discounts plus campus-only ones. */
async function loadDeals() {
  state.deals = null;
  try {
    const response = await fetch(config.dealsURL || "data/deals.json", { cache: "no-cache" });
    if (response.ok) state.deals = await response.json();
  } catch { /* no deals */ }
}

const today = () => new Date().toISOString().slice(0, 10);
function sponsorsFor(campus) {
  return (state.sponsors?.[campus?.name] || []).filter(s =>
    s.name && Number.isFinite(s.lat) && Number.isFinite(s.lng) && (!s.ends || s.ends >= today()));
}

function sponsorPlace(s, i) {
  return {
    id: `sponsor-${i}-${s.name}`,
    name: s.name,
    lat: s.lat, lng: s.lng,
    kind: "Sponsored",
    address: s.address || null,
    offer: s.offer || null,
    url: s.url || null,
    info: (s.phone || s.hours) ? { phone: s.phone || null, hours: s.hours || null, website: null } : null,
    sponsored: true
  };
}

function transition(update) {
  if (document.startViewTransition && !reducedMotion.matches) {
    const t = document.startViewTransition(update);
    // A skipped or slow transition is harmless; don't report it as an error.
    [t.ready, t.finished, t.updateCallbackDone].forEach(p => p?.catch(() => {}));
  } else {
    update();
  }
}

/**
 * A short welcome after confirming a campus: the campus badge, its name and three
 * real setup steps (buildings, weather, nearby places), then it fades into the
 * dashboard. About two seconds; tap to skip. Quicker and still with reduced motion.
 */
function playArrival(campus) {
  document.querySelector(".arrival")?.remove();
  const quick = reducedMotion.matches;
  const mode = store.modeFor(campus.name);
  const overlay = document.createElement("div");
  overlay.className = `arrival${quick ? " is-quick" : ""}`;
  overlay.setAttribute("role", "status");
  overlay.style.cssText = `--campus:${campus.theme};--campus-rgb:${campus.themeRGB};--accent:${campus.accent}`;
  const steps = [
    ["building", campus.buildings.length ? `Loading ${campus.buildings.length} buildings` : "Loading campus buildings"],
    ["sun", "Checking the weather on campus"],
    ["pin", "Finding places within 6 miles"]
  ];
  overlay.innerHTML = `
    <div class="arrival-glow"></div>
    <div class="arrival-inner">
      <div class="arrival-badge"><span class="arrival-ring"></span><span class="arrival-ring two"></span>${badge(campus)}</div>
      <p class="eyebrow gold">${mode === "visitor" ? "Welcome, visitor" : "Welcome to"}</p>
      <h1 class="arrival-name">${h(campus.name)}</h1>
      <ul class="arrival-steps">${steps.map(([ic, text], i) => `<li data-step="${i}"><span class="arrival-dot">${icon(ic)}</span><span>${h(text)}</span><span class="arrival-check">${icon("chevronRight")}</span></li>`).join("")}</ul>
      <p class="arrival-skip">Tap to skip</p>
    </div>`;
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add("is-in"));

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const capped = (promise, ms) => Promise.race([Promise.resolve(promise).catch(() => {}), wait(ms)]);
  const work = [
    capped(resolveBuildings(campus), 2200),
    capped(campus.region ? currentWeather(config, campus.region.center) : null, 2200),
    wait(quick ? 300 : 900) // nearby places keep loading in the background
  ];
  const pace = quick ? 150 : 450;
  let closed = false, finished;
  state.arriving = new Promise(resolve => { finished = resolve; });
  const close = () => {
    if (closed) return;
    closed = true;
    overlay.classList.add("is-out");
    setTimeout(async () => {
      overlay.remove();
      // First campus on this device: the walkthrough comes next, then the Student or Visitor question.
      if (!store.tourSeen) {
        store.tourSeen = true;
        await startTour(campus);
      }
      state.arriving = null;
      finished();
    }, quick ? 150 : 520);
  };
  overlay.addEventListener("click", close);
  (async () => {
    for (let i = 0; i < work.length; i++) {
      await Promise.all([work[i], wait(pace)]);
      overlay.querySelector(`[data-step="${i}"]`)?.classList.add("is-done");
    }
    await wait(quick ? 200 : 550);
    close();
  })();
  // Never hold anyone up for more than four seconds.
  setTimeout(close, 4000);
}

/** Someone tapped one of the map's own place icons (a café, a statue, a shop). */
function pickMapPlace(place) {
  if (!state.campus) return;
  const already = state.results.find(r => r.name === place.name && Math.abs(r.lat - place.lat) < 0.0005 && Math.abs(r.lng - place.lng) < 0.0005);
  if (already) { selectItem(already); return; }
  resetSearch();
  const kind = place.kind ? place.kind.replace(/_/g, " ").replace(/^./, c => c.toUpperCase()) : "Place";
  const item = { id: `map-${place.name}-${place.lat.toFixed(5)}`, name: place.name, lat: place.lat, lng: place.lng, kind, findByName: true };
  state.results = [item];
  state.map.setPins([item], selectItem);
  searchInput.value = place.name;
  $("#map-clear").hidden = false;
  document.querySelectorAll("#map-chips .chip").forEach(chip => chip.classList.remove("is-active"));
  showStatus("");
  // Leave the old search in the address bar's history, so tapping its chip again searches again.
  state.lastSearchKey = null;
  try { history.replaceState(null, "", "#/map"); } catch {}
  selectItem(item);
  trackEvent("map-place", state.campus.name, place.name);
}

function startTour(campus = state.campus) {
  if (!campus || document.querySelector(".tour")) return Promise.resolve();
  trackEvent("tour-start", campus.name);
  return playTour({
    campus,
    visitor: store.modeFor(campus.name) === "visitor",
    reducedMotion: reducedMotion.matches,
    track: (event, detail) => trackEvent(event, campus.name, detail)
  });
}

function applyCampus(campus) {
  state.campus = campus;
  store.campusName = campus.name;
  recordVisit();
  const root = document.documentElement.style;
  root.setProperty("--campus", campus.theme);
  root.setProperty("--campus-rgb", campus.themeRGB);
  root.setProperty("--accent", campus.accent);
  $('meta[name="theme-color"]').setAttribute("content", "#0d1322");
  document.title = `${campus.name} · GradWay`;
  state.lastSearchKey = null;
  if (state.map) {
    resetSearch();
    state.map.setCampus(campus);
  }
  resolveBuildings(campus).then(() => { if (routeName() === "buildings") render(); });
  state.weather = null;
  // Fetch every quick category and map detail for this campus once a week, in the background.
  if (campus.region) setTimeout(() => prefetchCampus(config, campus.region).then(() => applyOverlays()).catch(() => {}), 1200);
}

// MARK: - Routing

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  return { name: parts[0] || "dashboard", arg: parts[1] ? decodeURIComponent(parts[1]) : null, params: new URLSearchParams(query) };
}

const routeName = () => parseRoute().name;

function go(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

/** Render again after a change, redrawing the page beside the map too (it's normally kept as is). */
function rerender() {
  state.renderedLeft = null;
  render();
}

function render() {
  const route = parseRoute();

  // Campus deep link: #/c/mississippi-state-university opens its confirmation page
  // (or the dashboard if it's already the chosen campus).
  if (route.name === "c") {
    const campus = state.campuses.find(c => c.slug === route.arg);
    const target = !campus ? "#/campuses" : state.campus?.name === campus.name ? "#/" : `#/confirm/${campus.slug}`;
    history.replaceState(null, "", target);
    return render();
  }

  if (!state.campus && !["campuses", "welcome", "confirm"].includes(route.name)) {
    history.replaceState(null, "", "#/welcome");
    return render();
  }
  if (state.campus && route.name === "welcome") {
    history.replaceState(null, "", "#/");
    return render();
  }

  document.body.dataset.route = route.name;
  const showsMap = route.name === "map" || (desktop.matches && state.campus && route.name !== "confirm");
  mapPane.hidden = !showsMap;
  document.body.classList.toggle("no-map", !showsMap);

  // The list the person came from (dashboard, buildings, classes) stays where it was:
  // beside the map on a wide screen, and one tap back on a phone.
  const renderers = { dashboard: renderDashboard, deals: renderDeals, campuses: renderCampuses, schedule: renderSchedule, import: renderImport, buildings: renderBuildings, welcome: renderWelcome, confirm: () => renderConfirm(route.arg) };
  trackPage(route.name === "confirm" ? state.campuses.find(c => c.slug === route.arg) : state.campus,
    route.name === "map" ? (route.params.get("cat") ? `map/${route.params.get("cat")}` : route.params.get("q") ? "map/search" : "map") : route.name);
  const cameFrom = state.lastRouteName;
  if (cameFrom && cameFrom !== "map" && route.name === "map") saveScroll(cameFrom);
  if (route.name !== "map" && renderers[route.name]) state.leftRoute = route.name;
  const leftRoute = route.name === "map" ? (desktop.matches ? (state.leftRoute || "dashboard") : null) : route.name;
  const alreadyShowing = route.name === "map" && state.renderedLeft === leftRoute && view.childElementCount;
  if (leftRoute && !alreadyShowing) {
    (renderers[leftRoute] || renderDashboard)();
    state.renderedLeft = leftRoute;
    if (cameFrom === "map" && leftRoute === state.leftRoute) restoreScroll(leftRoute);
    else if (route.name !== "map") scrollPage(0);
  }
  if (route.name !== "map" && !leftRoute) state.renderedLeft = null;
  showVisitCount();
  state.lastRouteName = route.name;
  markActiveBuilding(route);

  if (showsMap) showMap(route);
  if (state.campus && route.name !== "campuses") promptForModeIfNeeded();
}

const scrollPositions = {};
const pageScroller = () => (desktop.matches ? view : document.scrollingElement);
function saveScroll(name) { scrollPositions[name] = pageScroller().scrollTop; }
function scrollPage(top) { pageScroller().scrollTop = top; }
function restoreScroll(name) { requestAnimationFrame(() => scrollPage(scrollPositions[name] || 0)); }

/** Highlights the building that's open on the map, when the building list is showing. */
function markActiveBuilding(route) {
  const query = route.name === "map" ? route.params.get("q") : null;
  document.querySelectorAll("#building-list .row").forEach(row => {
    row.classList.toggle("is-active", Boolean(query) && row.dataset.name === query);
  });
}

// MARK: - Dashboard

const isVisitor = () => store.modeFor(state.campus.name) === "visitor";

/** Always the school's initials, never a university logo (campus.json's Logo field is ignored here). */
function badge(campus, size = "") {
  return `<span class="badge ${size}" style="--badge:${campus.theme}"><span class="${campus.initials.length > 3 ? "long" : ""}">${h(campus.initials)}</span></span>`;
}

function minutesOf(time) {
  const [hh, mm] = String(time).split(":").map(Number);
  return hh * 60 + mm;
}

function formatTime(time) {
  const [hh, mm] = String(time).split(":").map(Number);
  const suffix = hh >= 12 ? "PM" : "AM";
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${suffix}`;
}

/** Same rules as GradWayDashboardViewController.loadNextClass. */
function nextClass() {
  if (isVisitor()) return { eyebrow: "Visiting", text: "Find parking", href: "#/map?cat=parking", walk: true };
  const classes = store.classes;
  if (!classes.length) return { eyebrow: "Next class", text: "Add your classes", href: "#/schedule", add: true };
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return { eyebrow: "Next class", text: "No classes today", href: "#/schedule" };
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const next = classes
    .filter(c => c.days.includes(day))
    .sort((a, b) => minutesOf(a.time) - minutesOf(b.time))
    .find(c => minutesOf(c.time) >= nowMinutes);
  if (!next) return { eyebrow: "Next class", text: "No more classes today", href: "#/schedule" };
  return {
    eyebrow: "Next class",
    text: `${next.name} · ${formatTime(next.time)}`,
    href: next.building ? `#/map?q=${encodeURIComponent(next.building)}&exact=1` : "#/schedule",
    walk: Boolean(next.building),
    cls: next
  };
}

// MARK: - Light and dark

function themeButton() {
  const light = store.theme === "light";
  return `<button class="theme-btn" data-action="theme" aria-label="${light ? "Switch to dark theme" : "Switch to light theme"}" title="${light ? "Dark theme" : "Light theme"}">
    <span class="icon theme-moon">${icon("moon")}</span><span class="icon theme-sun">${icon("sun")}</span></button>`;
}

function applyTheme(theme, animate = false) {
  const root = document.documentElement;
  if (animate && !reducedMotion.matches) {
    root.classList.add("theme-switching");
    setTimeout(() => root.classList.remove("theme-switching"), 450);
  }
  if (theme === "light") root.dataset.theme = "light"; else delete root.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#fbf9f4" : "#0d1322");
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme === "light" ? "light" : "dark");
  document.querySelectorAll(".theme-btn").forEach(b => {
    b.setAttribute("aria-label", theme === "light" ? "Switch to dark theme" : "Switch to light theme");
    b.title = theme === "light" ? "Dark theme" : "Light theme";
  });
}

/** "Find breakfast" in the morning, "Find lunch" at midday, and so on. */
function mealCall(date = new Date()) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  if (minutes < 5 * 60) return "Find a late-night bite";
  if (minutes < 10 * 60 + 30) return "Find breakfast";
  if (minutes < 14 * 60 + 30) return "Find lunch";
  if (minutes < 16 * 60 + 30) return "Grab a snack";
  if (minutes < 21 * 60) return "Find dinner";
  return "Find a late-night bite";
}

function linkRow(item, index, count) {
  const pos = count === 1 ? "only" : index === 0 ? "first" : index === count - 1 ? "last" : "middle";
  return `<a class="row row-${pos}" href="${h(item.url)}" target="_blank" rel="noopener">
    <span class="row-icon">${icon(item.icon)}</span><span class="row-text"><span class="row-title">${h(item.title)}</span>${item.sub ? `<span class="row-sub">${h(item.sub)}</span>` : ""}</span>${icon("chevronRight", "row-chevron")}
  </a>`;
}

function section(title, body) {
  return body ? `<section class="section">${title ? `<h2 class="section-title">${h(title)}</h2>` : ""}${body}</section>` : "";
}

function installCard() {
  if (store.installDismissed) return "";
  const close = `<button class="card-close" data-action="dismiss-install" aria-label="Hide this">${icon("close")}</button>`;
  if (isIOS) {
    return `<div class="card install">${close}
      <span class="install-icon">${icon("apple")}</span>
      <div><p class="eyebrow">GradWay for iPhone</p>
      <p class="install-title">Get the full app</p>
      <p class="muted">Walk With Me, Campus Camera and your parked car, on your phone.</p>
      <a class="btn btn-gold" href="${h(config.appStoreURL)}" target="_blank" rel="noopener">${icon("apple")} App Store</a></div></div>`;
  }
  if (state.installPrompt) {
    return `<div class="card install">${close}
      <span class="install-icon">${icon("install")}</span>
      <div><p class="eyebrow">No app store needed</p>
      <p class="install-title">Add GradWay to your home screen</p>
      <p class="muted">It opens full screen like an app. The Android app is on the way.</p>
      <button class="btn btn-gold" data-action="install">${icon("install")} Install</button></div></div>`;
  }
  if (isAndroid) {
    return `<div class="card install">${close}
      <span class="install-icon">${icon("install")}</span>
      <div><p class="eyebrow">Using Android?</p>
      <p class="install-title">Keep GradWay on your home screen</p>
      <p class="muted">Open your browser menu and choose <strong>Add to Home screen</strong> or <strong>Install app</strong>.</p></div></div>`;
  }
  return `<div class="card install">${close}
    <span class="install-icon">${icon("apple")}</span>
    <div><p class="eyebrow">On iPhone?</p>
    <p class="install-title">GradWay is on the App Store</p>
    <a class="btn btn-gold" href="${h(config.appStoreURL)}" target="_blank" rel="noopener">${icon("apple")} App Store</a></div></div>`;
}

function renderDashboard() {
  const campus = state.campus;
  const visitor = isVisitor();
  const next = nextClass();
  const links = campus.links;

  // Each card says what you can do there, not just where it goes.
  const academic = (visitor
    ? [["Explore the university", "globe", links.website, "Admissions, tours and more"], ["Check important dates", "calendar", links.academic, "Breaks, events and the term calendar"], ["Shop the bookstore", "book", links.bookstore, "Gear, gifts and books"]]
    : [["Open your student portal", "portal", links.student, "Registration, grades and fees"], ["Check important dates", "calendar", links.academic, "Drop deadlines, breaks and finals"], ["Get your books", "book", links.bookstore, "Textbooks, supplies and gear"]]
  ).filter(([, , url]) => url).map(([title, iconName, url, sub]) => ({ title, icon: iconName, url, sub }));

  const tiles = [[mealCall(), "food", links.dining, "Dining halls and menus"], ["See what's happening", "events", links.events, "Campus events this week"],
    ["Stay safe on campus", "shield", links.emergency, "Campus police and alerts"], ["Catch a game", "sports", links.sports, "Schedules and tickets"]]
    .filter(([, , url]) => url);

  const socials = [["Facebook", "facebook", campus.socials.facebook], ["Instagram", "instagram", campus.socials.instagram], ["TikTok", "tiktok", campus.socials.tiktok]]
    .filter(([, , url]) => url);

  const buildingCount = campus.buildings.length;

  view.innerHTML = `
    <header class="dash-header">
      ${badge(campus)}
      <div class="dash-titles">
        <p class="eyebrow accent">GradWay</p>
        <h1 class="campus-name">${h(campus.name)}</h1>
      </div>
      ${themeButton()}
    </header>
    <div class="header-actions">
      <button class="pill" data-action="mode">${icon(visitor ? "visitor" : "student")} ${visitor ? "Visiting" : "Student"}</button>
      <a class="pill" href="#/campuses">${icon("swap")} Change campus</a>
      <span class="pill weather-pill" id="weather-pill" hidden></span>
    </div>

    <div class="alerts" id="campus-alerts" aria-live="polite"></div>

    <a class="card glass next-card" href="${next.href}" ${next.walk ? `aria-label="${h(next.eyebrow)}. ${h(next.text)}. Walk there"` : ""}>
      <span><span class="eyebrow">${h(next.eyebrow)}</span><span class="next-text">${h(next.text)}</span>${next.cls ? `<span class="leave-line" id="leave-line" hidden></span>` : ""}</span>
      ${next.walk ? `<span class="walk-glyph">${icon("walk")}</span>` : next.add ? `<span class="walk-glyph">${icon("plus")}</span>` : ""}
    </a>

    <form class="dash-search glass" data-form="dash-search" role="search">
      ${icon("search")}
      <input name="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="Search buildings, ATMs, coffee…" aria-label="Search ${h(campus.name)}">
    </form>
    <div class="chips" role="list">
      ${QUICK_CATEGORIES.map(key => `<a class="chip" role="listitem" href="#/map?cat=${key}">${icon(CATEGORIES[key].icon)}${CATEGORIES[key].label}</a>`).join("")}
    </div>

    ${section("", buildingCount ? `<a class="card glass building-card" href="#/buildings">
        <span class="row-icon">${icon("building")}</span>
        <span><span class="card-title">Find Buildings</span><span class="muted">${buildingCount} buildings at ${h(campus.name)}</span></span>
        ${icon("chevronRight", "row-chevron")}</a>` : "")}

    ${state.isSample ? `<p class="notice">Preview data: the live campus list couldn't be reached, so two sample campuses are showing.</p>` : ""}

    ${installCard()}

    ${dealsOfMonthCard()}

    ${dealsSection(campus)}

    ${section(visitor ? "Campus Info" : "Academic", academic.length ? `<div class="rows">${academic.map((item, i) => linkRow(item, i, academic.length)).join("")}</div>` : "")}

    ${section("Campus", tiles.length ? `<div class="grid">${tiles.map(([title, iconName, url, sub]) => `
      <a class="tile glass" href="${h(url)}" target="_blank" rel="noopener"><span class="tile-icon">${icon(iconName)}</span><span class="tile-text"><span class="tile-title">${h(title)}</span><span class="tile-sub">${h(sub)}</span></span></a>`).join("")}</div>` : "")}

    ${section("News", links.news ? `<a class="card news-card" href="${h(links.news)}" target="_blank" rel="noopener">
        <span class="eyebrow accent">Campus News</span>
        <span class="news-headline">Read the latest from ${h(campus.name)}</span>
        <span class="muted">${h(new URL(links.news).hostname.replace(/^www\./, ""))}</span></a>` : "")}

    ${section(visitor ? "Help" : "Student Help", `<div class="rows">
      <button class="row row-first" data-action="tour"><span class="row-icon">${icon("play")}</span><span class="row-text"><span class="row-title">See how GradWay works</span><span class="row-sub">A one-minute tour of the dashboard and map</span></span>${icon("chevronRight", "row-chevron")}</button>
      ${!visitor ? `<a class="row row-middle" href="#/schedule"><span class="row-icon">${icon("clock")}</span><span class="row-text"><span class="row-title">Plan your class day</span><span class="row-sub">My classes, imports and leave-by reminders</span></span>${icon("chevronRight", "row-chevron")}</a>` : ""}
      <button class="row row-middle" data-action="safety"><span class="row-icon">${icon("help")}</span><span class="row-text"><span class="row-title">Get help fast</span><span class="row-sub">Call 911, campus safety, share your location</span></span>${icon("chevronRight", "row-chevron")}</button>
      <a class="row row-last" href="${h(config.feedbackURL)}" target="_blank" rel="noopener"><span class="row-icon">${icon("feedback")}</span><span class="row-text"><span class="row-title">Tell us what to improve</span><span class="row-sub">Send feedback to the GradWay team</span></span>${icon("chevronRight", "row-chevron")}</a>
    </div>`)}

    ${section("Follow", socials.length ? `<div class="chips">${socials.map(([title, iconName, url]) => `<a class="chip" href="${h(url)}" target="_blank" rel="noopener">${icon(iconName)}Follow on ${title}</a>`).join("")}</div>` : "")}

    ${footer()}
  `;
  showWeather();
  showAlerts();
  if (next.cls) updateLeaveLine(next.cls);
}

// MARK: - Leave-by reminders

/** Where a building is (searched once, then remembered on this device). */
async function spotFor(building) {
  const campus = state.campus;
  if (!building || !campus?.region) return null;
  const known = store.spotsFor(campus.name)[building];
  if (known) return known;
  state.spotLookups ||= new Map();
  const key = `${campus.name}|${building}`;
  if (!state.spotLookups.has(key)) {
    state.spotLookups.set(key, runSearch(config, { query: building, campusRegion: campus.region, isExactLookup: true })
      .then(({ items }) => {
        const best = items.length ? bestNameMatch(items, building) : null;
        if (!best) return null;
        const spot = { lat: +best.lat.toFixed(6), lng: +best.lng.toFixed(6) };
        store.saveSpot(campus.name, building, spot);
        return spot;
      })
      .catch(() => { state.spotLookups.delete(key); return null; }));
  }
  return state.spotLookups.get(key);
}

/** Walking minutes to a class today: from the class before it, else where you are, else your start building. */
async function walkForClass(cls, day, { useLocation = true } = {}) {
  const to = await spotFor(cls.building);
  if (!to) return { minutes: null };
  const before = previousClass(store.classes, cls, day);
  if (before?.building && before.building !== cls.building) {
    const from = await spotFor(before.building);
    if (from) return { minutes: walkMinutesBetween(from, to), fromLabel: before.building };
  } else if (before?.building === cls.building) {
    return { minutes: 2, fromLabel: before.building };
  }
  const settings = store.reminders;
  if (useLocation && settings.start === "location" && state.userPosition && distanceMeters(state.userPosition, to) < 8000) {
    return { minutes: walkMinutesBetween(state.userPosition, to), fromLabel: "where you are" };
  }
  if (settings.start && settings.start !== "location") {
    const from = await spotFor(settings.start);
    if (from) return { minutes: walkMinutesBetween(from, to), fromLabel: settings.start };
  }
  return { minutes: null };
}

const clock = date => date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** "Leave by 1:47 PM · 8 min walk", counting down on the dashboard. */
async function updateLeaveLine(cls) {
  const line = $("#leave-line");
  if (!line || !cls.building) return;
  clearInterval(state.leaveTimer);
  if (store.reminders.start === "location") await locateIfAllowed().catch(() => {});
  const walk = await walkForClass(cls, new Date().getDay());
  const draw = () => {
    if (!document.body.contains(line)) { clearInterval(state.leaveTimer); return; }
    const info = leaveInfo(cls, walk.minutes, store.reminders.buffer);
    const walkText = walk.minutes != null ? `${walk.minutes} min walk` : "about a 10 min walk";
    line.dataset.state = info.state;
    line.innerHTML = info.state === "late" ? `${icon("clock")}<span>Class has started</span>`
      : info.state === "now" ? `${icon("walk")}<span><b>Leave now</b> · ${walkText}</span>`
      : info.state === "soon" ? `${icon("clock")}<span><b>Leave in ${info.minutesLeft} min</b> · by ${clock(info.leaveAt)} · ${walkText}</span>`
      : `${icon("clock")}<span>Leave by ${clock(info.leaveAt)} · ${walkText}</span>`;
    line.hidden = false;
  };
  draw();
  state.leaveTimer = setInterval(draw, 30_000);
}

/** While GradWay is open (or installed and running), a notification at each leave-by time. */
function startReminderLoop() {
  const tick = async () => {
    const settings = store.reminders;
    if (!settings.notify || !state.campus || isVisitor() || !("Notification" in window) || Notification.permission !== "granted") return;
    const now = new Date();
    const day = now.getDay();
    const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    for (const cls of store.classes.filter(c => c.days.includes(day))) {
      const key = `${cls.id}|${today}`;
      if (store.notified.includes(key)) continue;
      const walk = await walkForClass(cls, day);
      const info = leaveInfo(cls, walk.minutes, settings.buffer, now);
      if (info.state !== "now") continue;
      store.markNotified(key);
      const title = `Time to head to ${cls.name}`;
      const body = `Leave now${walk.minutes != null ? `: ${walk.minutes} min walk` : ""}${cls.building ? ` to ${cls.building}` : ""}. Class starts at ${formatTime(cls.time)}.`;
      const data = { url: cls.building ? `./#/map?q=${encodeURIComponent(cls.building)}&exact=1` : "./#/schedule" };
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (reg) await reg.showNotification(title, { body, tag: key, icon: "icons/icon-192.png", badge: "icons/icon-192.png", data });
        else new Notification(title, { body, tag: key, icon: "icons/icon-192.png" });
        trackEvent("leave-notify", state.campus.name);
      } catch { /* notifications blocked */ }
    }
  };
  tick();
  setInterval(tick, 30_000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}

function remindersCard() {
  const s = store.reminders;
  const canNotify = "Notification" in window;
  const permission = canNotify ? Notification.permission : "unsupported";
  const on = s.notify && permission === "granted";
  return `<section class="card glass reminders-card">
    <div class="reminders-head"><span class="row-icon gold-icon">${icon("clock")}</span><div>
      <p class="card-title">Leave-by reminders</p>
      <p class="muted small">GradWay works out when to leave for each class from the walk there, plus a few minutes to spare.</p></div></div>
    <label class="field"><span>Usually leaving from</span>
      <select id="rem-start">
        <option value="location" ${s.start === "location" ? "selected" : ""}>Wherever I am (uses my location)</option>
        ${state.campus.buildings.map(b => `<option value="${h(b)}" ${s.start === b ? "selected" : ""}>${h(b)}</option>`).join("")}
      </select></label>
    <div class="field"><span>Extra minutes to spare</span>
      <div class="segmented" role="radiogroup" aria-label="Extra minutes">${[0, 5, 10, 15].map(n => `<button type="button" role="radio" aria-checked="${s.buffer === n}" class="${s.buffer === n ? "is-on" : ""}" data-buffer="${n}">${n} min</button>`).join("")}</div></div>
    <div class="reminder-actions">
      ${canNotify ? `<button class="btn ${on ? "btn-glass" : "btn-gold"}" data-action="toggle-notify">${icon("bell")} ${on ? "Notifications on · turn off" : "Notify me when it's time to leave"}</button>` : ""}
      <button class="btn btn-glass" data-action="calendar-reminders">${icon("calendar")} Add reminders to my calendar</button>
    </div>
    <p class="muted small" id="rem-note">${permission === "denied" ? "Notifications are blocked for this site in your browser settings. The calendar reminders still work." :
      "Notifications come while GradWay is open or installed on your home screen. For reminders that always arrive, add them to your calendar: each class gets an alarm at its leave-by time."}</p>
  </section>`;
}

async function downloadCalendarReminders(button) {
  const campus = state.campus;
  const classes = store.classes;
  if (!classes.length) return;
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = "Working out walking times…";
  const settings = store.reminders;
  const entries = [];
  for (const cls of classes) {
    for (const day of cls.days) {
      const walk = await walkForClass(cls, day, { useLocation: false });
      const lead = (walk.minutes ?? 10) + (settings.buffer || 0);
      entries.push({ cls, day, leadMinutes: lead, walkMinutes: walk.minutes, fromLabel: walk.fromLabel });
    }
  }
  const text = buildICS(entries, campus.name);
  const blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `GradWay classes - ${campus.name}.ics`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  button.disabled = false;
  button.innerHTML = original;
  const note = $("#rem-note");
  if (note) note.innerHTML = `<b>Calendar file ready.</b> Open it to add your ${classes.length} ${classes.length === 1 ? "class" : "classes"} with leave-by alarms. On Android, open the download with your calendar app. If you change your classes later, add the new file and delete the old events.`;
  trackEvent("leave-calendar", campus.name, String(entries.length));
}

// MARK: - Campus alerts (data/alerts.json)

/** Fills the alert banners at the top of the dashboard. Fetched at most every 2 minutes. */
async function showAlerts() {
  const campus = state.campus;
  const box = $("#campus-alerts");
  if (!box || !config.alertsURL) return;
  const fresh = state.alerts && Date.now() - state.alerts.at < 120_000;
  if (!fresh) {
    try { state.alerts = { data: await loadAlerts(config.alertsURL), at: Date.now() }; }
    catch { state.alerts = { data: state.alerts?.data || null, at: Date.now() }; }
  }
  if (state.campus !== campus || !document.body.contains(box)) return;
  const list = alertsFor(state.alerts.data, campus.name, new Date(), store.dismissedAlerts);
  box.innerHTML = list.map(a => {
    const type = ALERT_TYPES[a.type] ? a.type : "info";
    return `<div class="alert alert-${type}" data-alert="${h(a.id)}" role="${type === "safety" ? "alert" : "status"}">
      <span class="alert-icon">${icon(ALERT_TYPES[type].icon)}</span>
      <div class="alert-body">
        <span class="alert-kind">${h(ALERT_TYPES[type].label)}</span>
        <p class="alert-text">${h(a.text)}</p>
        ${a.link ? `<a class="alert-link" href="${h(a.link)}" target="_blank" rel="noopener" data-alert-link="${h(a.id)}">${h(a.linkLabel || "Learn more")} ${icon("chevronRight")}</a>` : ""}
      </div>
      <button class="alert-close" data-action="dismiss-alert" aria-label="Hide this alert">${icon("close")}</button>
    </div>`;
  }).join("");
  if (list.length) trackEvent("alert-view", campus.name, list.map(a => a.id).join(","));
  // Each alert's text is public, so Insights can show how each one did.
  for (const a of list) record("action", { name: "alert-view", detail: String(a.text).slice(0, 120) });
}

/** The public visit count in the footer, when GoatCounter is set up to share it. */
async function showVisitCount() {
  if (state.visits === undefined) state.visits = await totalVisits();
  document.querySelectorAll(".visit-count").forEach(el => {
    if (!state.visits) return;
    el.textContent = `${state.visits} visits`;
    el.hidden = false;
  });
}

/** Current weather in the header row (National Weather Service). Hidden if it can't load. */
async function showWeather() {
  const campus = state.campus;
  const pill = $("#weather-pill");
  if (!pill || !campus?.region) return;
  const fill = w => {
    if (!w) { pill.hidden = true; return; }
    const range = w.high != null && w.low != null ? ` · H ${w.high}° L ${w.low}°` : w.low != null ? ` · Low ${w.low}°` : "";
    pill.innerHTML = `${icon(w.icon)} <strong>${w.temp}°</strong> ${h(w.text)}<span class="weather-range">${range}</span>`;
    pill.title = `${w.text}${w.rainChance != null ? ` · ${w.rainChance}% chance of rain` : ""} · National Weather Service`;
    pill.setAttribute("aria-label", `Weather: ${w.temp} degrees, ${w.text}${range.replace(/·/g, ",")}`);
    pill.hidden = false;
  };
  if (state.weather?.campus === campus.name) return fill(state.weather.value);
  const value = await currentWeather(config, campus.region.center);
  if (state.campus !== campus) return;
  state.weather = { campus: campus.name, value };
  fill(value);
}

function dealsSection(campus) {
  const deals = sponsorsFor(campus);
  if (!deals.length) return "";
  deals.forEach(d => trackEvent("sponsor-view", campus.name, d.name));
  return section("Local deals", `<div class="rows">${deals.map((d, i) => `
    <button class="row deal-row ${deals.length === 1 ? "row-only" : i === 0 ? "row-first" : i === deals.length - 1 ? "row-last" : "row-middle"}" data-deal="${i}">
      <span class="row-icon gold-icon">${icon("tag")}</span>
      <span class="deal-text"><span class="row-title">${h(d.name)}</span>${d.offer ? `<span class="muted small">${h(d.offer)}</span>` : ""}</span>
      <span class="sponsored-tag">Sponsored</span>
    </button>`).join("")}</div>`);
}

function footer() {
  const legal = [
    config.privacyURL && `<a href="${h(config.privacyURL)}" target="_blank" rel="noopener">Privacy Policy</a>`,
    config.termsURL && `<a href="${h(config.termsURL)}" target="_blank" rel="noopener">Terms of Use</a>`,
    `<a href="${h(config.appStoreURL)}" target="_blank" rel="noopener">GradWay on the App Store</a>`
  ].filter(Boolean).join("<span aria-hidden=\"true\"> · </span>");
  return `<footer class="footer">
    <p>${legal}</p>
    <p>© ${new Date().getFullYear()} Oakland Software Co. All rights reserved. GradWay is a trademark of Oakland Software Co. · Not affiliated with any university.</p>
    <p>Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · Imagery: USGS · Weather: National Weather Service</p>
    ${config.advertiseURL ? `<p><a href="${h(config.advertiseURL)}${state.campus && !/^mailto:/.test(config.advertiseURL) ? `?campus=${encodeURIComponent(state.campus.slug)}` : ""}">Advertise on GradWay</a></p>` : ""}
    <p class="visit-count" hidden></p>
  </footer>`;
}

// MARK: - Campus picker

function renderCampuses() {
  const current = state.campus;
  view.innerHTML = `
    <div class="picker${current ? "" : " is-first"}">
    <div class="picker-main">
    <header class="page-header">
      <a class="icon-btn" href="${current ? "#/" : "#/welcome"}" aria-label="Back">${icon("chevronLeft")}</a>
      <div>
        <p class="eyebrow gold">GradWay</p>
        <h1 class="page-title">${current ? "Change campus" : "Choose your campus"}</h1>
      </div>
    </header>
    ${current ? "" : `<p class="lead">Pick your school to see its buildings, dining, parking and campus links.</p>`}
    <form class="dash-search glass" role="search" onsubmit="return false">
      ${icon("search")}
      <input id="campus-filter" type="search" autocomplete="off" placeholder="Search ${state.campuses.length || ""} campuses" aria-label="Search campuses">
    </form>
    ${state.isSample ? `<p class="notice">Preview data: the live campus list couldn't be reached, so two sample campuses are showing.</p>` : ""}
    <nav class="state-jump" id="state-jump" aria-label="Jump to a state" hidden></nav>
    <div class="campus-list" id="campus-list">
      ${state.campuses.length ? campusRows(state.campuses) : `<div class="empty"><p>Campuses couldn't load. Check your connection and try again.</p><button class="btn btn-gold" data-action="reload">Try again</button></div>`}
    </div>
    <p class="muted center small" id="campus-none" hidden>No campus matches. GradWay adds new campuses every semester.</p>
    </div>
    </div>
    ${footer()}
  `;
  const filter = $("#campus-filter");
  const applyFilter = () => {
    const term = filter.value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll(".campus-row").forEach(row => {
      const match = !term || row.dataset.search.includes(term);
      row.hidden = !match;
      if (match) shown++;
    });
    // Hide a state's heading when none of its campuses match.
    document.querySelectorAll(".campus-group").forEach(group => {
      group.hidden = !group.querySelector(".campus-row:not([hidden])");
    });
    const jump = $("#state-jump");
    if (jump) jump.classList.toggle("is-filtered", Boolean(term));
    $("#campus-none").hidden = shown > 0;
  };
  filter.addEventListener("input", applyFilter);
  // Group by state once the state outlines load (from cache after the first visit).
  if (state.campuses.length) groupCampusesByState().then(() => { if (routeName() === "campuses") applyFilter(); });
}

function campusRow(c) {
  const current = state.campus;
  const where = c.state ? ` ${c.state.name.toLowerCase()} ${c.state.abbr.toLowerCase()}` : "";
  return `
    <button class="campus-row ${current?.name === c.name ? "is-current" : ""}" data-campus="${h(c.name)}" data-search="${h(c.name.toLowerCase() + where)}">
      ${badge(c, "small")}<span>${h(c.name)}</span>${current?.name === c.name ? `<span class="tag">Current</span>` : icon("chevronRight", "row-chevron")}
    </button>`;
}

function campusRows(campuses) {
  if (!campuses.some(c => c.state)) return campuses.map(campusRow).join("");
  const groups = new Map();
  for (const c of campuses) {
    const name = c.state?.name || "Other";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(c);
  }
  const names = [...groups.keys()].sort((a, b) => (a === "Other") - (b === "Other") || a.localeCompare(b));
  return names.map(name => `
    <section class="campus-group" id="state-${slugState(name)}" aria-label="${h(name)}">
      <h2 class="campus-state"><span>${h(name)}</span><span class="count">${groups.get(name).length}</span></h2>
      ${groups.get(name).sort((a, b) => a.name.localeCompare(b.name)).map(campusRow).join("")}
    </section>`).join("");
}

const slugState = name => name.toLowerCase().replace(/[^a-z]+/g, "-");

/** Works out each campus's state from its center (once per visit) and redraws the list in groups. */
async function groupCampusesByState() {
  try {
    if (!state.campuses.every(c => "state" in c)) {
      const states = await loadStates();
      for (const c of state.campuses) c.state = stateAt(states, c.region?.center || c.center);
    }
  } catch {
    return; // keep the plain list
  }
  const list = $("#campus-list");
  if (!list || routeName() !== "campuses") return;
  list.innerHTML = campusRows(state.campuses);
  const names = [...new Set(state.campuses.map(c => c.state?.name).filter(Boolean))].sort();
  const jump = $("#state-jump");
  if (jump && names.length > 1) {
    jump.innerHTML = names.map(name => {
      const abbr = state.campuses.find(c => c.state?.name === name).state.abbr;
      return `<a class="state-chip" href="#/campuses" data-state-jump="${slugState(name)}" title="${h(name)}">${h(abbr || name)}</a>`;
    }).join("");
    jump.hidden = false;
  }
}

// MARK: - Campus confirmation

/** After picking a campus: its photo, what GradWay has for it, and Continue. */
function renderConfirm(slugArg) {
  const campus = state.campuses.find(c => c.slug === slugArg);
  if (!campus) { history.replaceState(null, "", "#/campuses"); return renderCampuses(); }
  const links = campus.links;
  const features = [
    campus.buildings.length && ["building", `${campus.buildings.length} buildings`],
    ["search", "Campus map and search"],
    links.dining && ["food", "Dining"],
    links.events && ["events", "Events"],
    links.sports && ["sports", "Sports"],
    links.news && ["news", "News"],
    links.academic && ["calendar", "Academic calendar"],
    links.student && ["portal", "Student portal"],
    links.emergency && ["shield", "Public safety"]
  ].filter(Boolean);
  const vars = `--campus:${campus.theme};--campus-rgb:${campus.themeRGB};--accent:${campus.accent}`;
  view.innerHTML = `
    <section class="confirm" style="${vars}">
      <header class="page-header">
        <a class="icon-btn" href="#/campuses" aria-label="Back to campuses">${icon("chevronLeft")}</a>
        <div><p class="eyebrow gold">Confirm your campus</p></div>
      </header>
      <div class="confirm-hero">
        ${campus.photoURL ? `<img class="confirm-photo" src="${h(campus.photoURL)}" alt="${h(campus.name)} campus" loading="eager" referrerpolicy="no-referrer">` : ""}
        <div class="confirm-shade"></div>
        <div class="confirm-badge">${badge(campus)}</div>
      </div>
      <h1 class="confirm-name">${h(campus.name)}</h1>
      <span class="pill weather-pill" id="confirm-weather" hidden></span>
      <p class="eyebrow">What you'll find</p>
      <ul class="confirm-features">${features.map(([iconName, text]) => `<li>${icon(iconName)}<span>${h(text)}</span></li>`).join("")}</ul>
      <div class="confirm-actions">
        <button class="btn btn-gold btn-big" data-confirm="${h(campus.slug)}">Continue to ${h(shortName(campus))}</button>
        <a class="btn btn-glass btn-big" href="#/campuses">Choose a different campus</a>
      </div>
    </section>
  `;
  const photo = view.querySelector(".confirm-photo");
  photo?.addEventListener("error", () => { photo.remove(); view.querySelector(".confirm-hero")?.classList.add("no-photo"); });
  if (!campus.photoURL) view.querySelector(".confirm-hero")?.classList.add("no-photo");
  if (campus.region) currentWeather(config, campus.region.center).then(w => {
    const pill = $("#confirm-weather");
    if (!w || !pill) return;
    pill.innerHTML = `${icon(w.icon)} <strong>${w.temp}°</strong> ${h(w.text)} on campus now`;
    pill.hidden = false;
  });
}

/** "Mississippi State University" stays whole; very long names use initials ("SIUE"). */
const shortName = campus => campus.name.length > 28 ? campus.initials : campus.name;

// MARK: - Welcome (first visit, no campus yet)

function renderWelcome() {
  const features = [
    ["search", "Find any building", "Search halls, libraries, coffee and parking on a campus map, then walk or drive there with a live arrival time."],
    ["clock", "Your day at a glance", "Add your classes and the next one is always on top, one tap from its building."],
    ["visitor", "Visiting? Start here", "Tours, game days and move-in: parking, the university website and campus info in one place."],
    ["shield", "Safety built in", "Call 911, find campus police and emergency phones, and share your location with a friend."]
  ];
  const campusCount = state.campuses.length;
  view.innerHTML = `
    <section class="welcome">
      <div class="welcome-copy">
        <p class="eyebrow gold">GradWay</p>
        <h1 class="welcome-title">Find your way on campus.</h1>
        <p class="lead">Class buildings, dining, parking and campus links for students and visitors. Free on any phone, no download needed.</p>
        <div class="welcome-cta">
          <a class="btn btn-gold btn-big" href="#/campuses">${icon("search")} Find my campus</a>
          <a class="btn btn-glass btn-big" href="${h(config.appStoreURL)}" target="_blank" rel="noopener">${icon("apple")} iPhone app</a>
        </div>
        <div class="stats welcome-stats">
          <div><span class="stat">${campusCount > 15 ? campusCount : "15+"}</span><span class="muted small">campuses</span></div>
          <div><span class="stat">1.3M+</span><span class="muted small">routes walked</span></div>
          <div><span class="stat">2016</span><span class="muted small">helping since</span></div>
        </div>
      </div>
      <div class="welcome-art" aria-hidden="true">${welcomeArt()}</div>
    </section>
    <ul class="welcome-features">${features.map(([iconName, title, text]) => `
      <li class="glass"><span class="row-icon gold-icon">${icon(iconName)}</span><strong>${title}</strong><span class="muted small">${text}</span></li>`).join("")}
    </ul>
    <p class="muted small center">Using Android? Open GradWay in Chrome and choose <strong>Install app</strong> to keep it on your home screen.</p>
    ${footer()}
  `;
}

/** A small campus drawn in the app's style: blocks, a quad and a dotted walk to class. */
function welcomeArt() {
  return `<svg viewBox="0 0 360 300" class="campus-art">
    <defs>
      <radialGradient id="artGlow" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="rgb(var(--campus-rgb))" stop-opacity=".55"/><stop offset="1" stop-color="rgb(var(--campus-rgb))" stop-opacity="0"/></radialGradient>
    </defs>
    <rect x="0" y="0" width="360" height="300" rx="28" fill="url(#artGlow)"/>
    <g class="art-roads"><path d="M0 92 H360 M0 214 H360 M118 0 V300 M262 0 V300"/></g>
    <g class="art-blocks">
      <rect x="18" y="16" width="82" height="56" rx="8"/><rect x="136" y="16" width="108" height="56" rx="8"/><rect x="280" y="16" width="64" height="56" rx="8"/>
      <rect x="18" y="232" width="82" height="52" rx="8"/><rect x="136" y="232" width="108" height="52" rx="8"/><rect x="280" y="232" width="64" height="52" rx="8"/>
      <rect x="18" y="110" width="82" height="86" rx="8"/><rect x="280" y="110" width="64" height="86" rx="8"/>
    </g>
    <rect class="art-quad" x="136" y="110" width="108" height="86" rx="14"/>
    <path class="art-path" d="M58 196 C 70 160, 110 150, 150 152 S 230 160, 250 128 S 300 92, 312 70"/>
    <g class="art-you"><circle cx="58" cy="196" r="11"/><circle cx="58" cy="196" r="5"/></g>
    <g class="art-pin"><circle cx="312" cy="62" r="13"/><circle cx="312" cy="62" r="5"/></g>
    <g class="art-label"><rect x="234" y="24" width="118" height="26" rx="13"/><text x="293" y="42">Lee Hall · 9:00</text></g>
  </svg>`;
}

// MARK: - Schedule

const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

function renderSchedule() {
  const classes = store.classes;
  const days = [1, 2, 3, 4, 5].map(day => ({
    day,
    items: classes.filter(c => c.days.includes(day)).sort((a, b) => minutesOf(a.time) - minutesOf(b.time))
  })).filter(group => group.items.length);

  view.innerHTML = `
    <header class="page-header">
      <a class="icon-btn" href="#/" aria-label="Back">${icon("chevronLeft")}</a>
      <div><p class="eyebrow accent">${h(state.campus.name)}</p><h1 class="page-title">My classes</h1></div>
      <a class="btn btn-glass btn-small" href="#/import" aria-label="Import schedule">${icon("calendar")}<span class="btn-label">Import</span></a>
      <button class="btn btn-gold btn-small" data-action="add-class" aria-label="Add a class">${icon("plus")}<span class="btn-label">Add</span></button>
    </header>
    ${days.length ? remindersCard() : ""}
    ${days.length ? days.map(group => `
      <section class="section">
        <h2 class="section-title">${DAY_NAMES[group.day]}</h2>
        <div class="rows">${group.items.map((c, i) => `
          <div class="row class-row row-${group.items.length === 1 ? "only" : i === 0 ? "first" : i === group.items.length - 1 ? "last" : "middle"}">
            <span class="class-time">${formatTime(c.time)}</span>
            <a class="class-main" href="${c.building ? `#/map?q=${encodeURIComponent(c.building)}&exact=1` : "#/schedule"}">
              <span class="row-title">${h(c.name)}${c.title ? ` <span class="class-title-text">${h(c.title)}</span>` : ""}</span>
              <span class="muted small">${c.building ? `${icon("walk")} ${h(c.building)}${c.room ? ` · Room ${h(c.room)}` : ""}` : "No building yet"}</span>
            </a>
            <button class="icon-btn subtle" data-action="edit-class" data-id="${h(c.id)}" aria-label="Edit ${h(c.name)}">${icon("pencil")}</button>
            <button class="icon-btn subtle" data-delete-class="${h(c.id)}" aria-label="Delete ${h(c.name)}">${icon("trash")}</button>
          </div>`).join("")}</div>
      </section>`).join("") : `
      <div class="empty card glass">
        <p class="card-title">Add your first class</p>
        <p class="muted">Your next class shows on the dashboard. Tap it to see the building on the map.</p>
        <div class="empty-actions">
          <a class="btn btn-gold" href="#/import">${icon("calendar")} Import my schedule</a>
          <button class="btn btn-glass" data-action="add-class">${icon("plus")} Add one class</button>
        </div>
      </div>`}
    <p class="muted small center">Classes are saved in this browser only.</p>
  `;
}

// MARK: - Import a schedule

const IMPORT_DAYS = [[1, "M"], [2, "T"], [3, "W"], [4, "Th"], [5, "F"]];

function renderImport() {
  const draft = state.importDraft;
  view.innerHTML = `
    <header class="page-header">
      <a class="icon-btn" href="#/schedule" aria-label="Back to my classes">${icon("chevronLeft")}</a>
      <div><p class="eyebrow accent">${h(state.campus.name)}</p><h1 class="page-title">Import your schedule</h1></div>
    </header>
    ${draft ? importReview(draft) : importStart()}
    <p class="muted small center">Your schedule stays in this browser. Nothing is uploaded.</p>`;
}

function importStart() {
  return `
    <section class="card glass import-card">
      <div class="import-step"><span class="import-num">1</span><div>
        <p class="card-title">From a calendar file</p>
        <p class="muted small">Most student portals, Canvas and Google Calendar can export your class schedule as a calendar file (.ics). Look for <b>Export</b>, <b>Download</b> or <b>Add to calendar</b> on your schedule page.</p>
      </div></div>
      <label class="drop-zone" id="ics-drop">
        <input type="file" id="ics-file" accept=".ics,text/calendar" hidden>
        ${icon("calendar")}<span><b>Choose a .ics file</b><span class="muted small">or drop it here</span></span>
      </label>
    </section>
    <section class="card glass import-card">
      <div class="import-step"><span class="import-num">2</span><div>
        <p class="card-title">Or paste it from your portal</p>
        <p class="muted small">Open your class schedule, select the list of classes, copy it and paste it here. Each class needs its course code (like BIO 1134), days and start time.</p>
      </div></div>
      <label class="field"><span class="sr-only">Your schedule</span>
        <textarea id="import-text" rows="7" placeholder="BIO 1134  Biology I  TR  2:00 PM - 3:15 PM  McCool Hall 215&#10;EN 1103  English Comp I  MWF  9:00-9:50am  Lee Hall 302"></textarea>
      </label>
      <button class="btn btn-gold btn-block" data-action="import-read">${icon("search")} Read my schedule</button>
    </section>
    <p class="form-error center" id="import-error" role="alert" hidden></p>`;
}

function importReview(draft) {
  const chosen = draft.classes.filter(c => c.include);
  const matched = draft.classes.filter(c => c.match === "matched").length;
  const unsure = draft.classes.filter(c => c.include && !c.building).length;
  return `
    <section class="import-summary card glass">
      <p class="card-title">Found ${draft.classes.length} ${draft.classes.length === 1 ? "class" : "classes"} in ${h(draft.source)}</p>
      <p class="muted small">${matched} matched to a building${unsure ? ` · ${unsure} still ${unsure === 1 ? "needs" : "need"} a building (you can add it later)` : ""}. Check each one, then add them.</p>
    </section>
    <datalist id="import-buildings">${state.campus.buildings.map(b => `<option value="${h(b)}">`).join("")}</datalist>
    <div class="import-list">
      ${draft.classes.map((c, i) => `
        <article class="import-item ${c.include ? "" : "is-off"}" data-i="${i}">
          <label class="import-include"><input type="checkbox" data-field="include" ${c.include ? "checked" : ""}><span class="sr-only">Include ${h(c.name)}</span></label>
          <div class="import-body">
            <div class="import-top">
              <input class="import-name" data-field="name" value="${h(c.name)}" aria-label="Class name">
              ${c.note ? `<span class="import-note">${h(c.note)}</span>` : ""}
            </div>
            ${c.title ? `<p class="muted small import-title">${h(c.title)}</p>` : ""}
            <div class="import-when">
              <div class="import-days" role="group" aria-label="Days">${IMPORT_DAYS.map(([d, label]) => `<button type="button" class="${c.days.includes(d) ? "is-on" : ""}" data-day="${d}" aria-pressed="${c.days.includes(d)}">${label}</button>`).join("")}</div>
              <input type="time" class="import-time" data-field="time" value="${h(c.time)}" aria-label="Start time">
            </div>
            <div class="import-where">
              ${icon("building")}
              <input data-field="building" list="import-buildings" value="${h(c.building)}" placeholder="Pick a building" aria-label="Building">
              <span class="match-tag match-${c.building ? c.match : "none"}">${c.building ? (c.match === "matched" ? "Matched" : c.match === "guess" ? "Best guess" : "Chosen") : "Pick one"}</span>
            </div>
            ${c.location ? `<p class="muted small import-from">From: ${h(c.location.replace(/\s+/g, " ").slice(0, 90))}</p>` : ""}
          </div>
        </article>`).join("")}
    </div>
    <div class="import-actions">
      <button class="btn btn-glass" data-action="import-reset">Start over</button>
      <button class="btn btn-gold" data-action="import-save" ${chosen.length ? "" : "disabled"}>${icon("plus")} Add ${chosen.length} ${chosen.length === 1 ? "class" : "classes"}</button>
    </div>`;
}

async function readSchedule(text, source) {
  const error = $("#import-error");
  let classes = [];
  try {
    classes = /BEGIN:VCALENDAR|BEGIN:VEVENT/.test(text) ? parseICS(text) : parsePasted(text);
  } catch (e) {
    console.warn("GradWay: schedule import", e);
  }
  if (!classes.length) {
    if (error) {
      error.textContent = /BEGIN:V/.test(text)
        ? "That calendar file has no weekly classes in it. Try exporting your class schedule (not the term calendar)."
        : "Couldn't find classes in that. Each class needs a course code (like BIO 1134), days (like MWF or TR) and a start time.";
      error.hidden = false;
    }
    return;
  }
  await resolveBuildings(state.campus).catch(() => {});
  const existing = store.classes;
  state.importDraft = {
    source,
    classes: classes.map(c => {
      const found = matchBuilding(c.location, state.campus.buildings);
      const duplicate = existing.some(e => e.name.toLowerCase() === c.name.toLowerCase() && e.time === c.time);
      const weekdays = c.days.filter(d => d >= 1 && d <= 5);
      return {
        ...c, days: weekdays, building: found.building, match: found.match,
        include: !duplicate && !c.oneTime && weekdays.length > 0,
        note: duplicate ? "Already added" : c.oneTime ? "One-time event" : !weekdays.length ? "Weekend only" : ""
      };
    })
  };
  trackEvent("schedule-import-read", state.campus.name, `${source}: ${classes.length}`);
  renderImport();
  scrollPage(0);
}

function saveImport() {
  const draft = state.importDraft;
  if (!draft) return;
  const add = draft.classes.filter(c => c.include && c.name.trim() && c.days.length && c.time).map(c => ({
    id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    name: c.name.trim(), title: (c.title || "").trim(), building: c.building.trim(), room: roomFrom(c.location, c.building),
    days: [...c.days].sort(), time: c.time
  }));
  if (!add.length) return;
  store.classes = [...store.classes, ...add];
  trackEvent("schedule-import", state.campus.name, String(add.length));
  state.importDraft = null;
  go("#/schedule");
}

// Edits on the review list (name, time, building, include, days)
document.addEventListener("input", event => {
  const item = event.target.closest(".import-item");
  if (!item || !state.importDraft) return;
  const c = state.importDraft.classes[+item.dataset.i];
  const field = event.target.dataset.field;
  if (field === "include") {
    c.include = event.target.checked;
    item.classList.toggle("is-off", !c.include);
    updateImportButton();
  } else if (field === "building") {
    c.building = event.target.value;
    c.match = state.campus.buildings.includes(c.building) ? (c.match === "none" ? "chosen" : c.match) : "none";
    const tag = item.querySelector(".match-tag");
    if (tag) { tag.className = `match-tag match-${c.building ? c.match : "none"}`; tag.textContent = c.building ? (c.match === "matched" ? "Matched" : c.match === "guess" ? "Best guess" : "Chosen") : "Pick one"; }
  } else if (field) {
    c[field] = event.target.value;
  }
});

function updateImportButton() {
  const n = state.importDraft.classes.filter(c => c.include).length;
  const button = document.querySelector('[data-action="import-save"]');
  if (button) { button.disabled = !n; button.innerHTML = `${icon("plus")} Add ${n} ${n === 1 ? "class" : "classes"}`; }
}

document.addEventListener("change", event => {
  if (event.target.id === "rem-start") { store.reminders = { ...store.reminders, start: event.target.value }; return; }
  if (event.target.id !== "ics-file" || !event.target.files?.[0]) return;
  const file = event.target.files[0];
  file.text().then(text => readSchedule(text, file.name));
});
document.addEventListener("dragover", event => { if (event.target.closest?.("#ics-drop")) { event.preventDefault(); event.target.closest("#ics-drop").classList.add("is-over"); } });
document.addEventListener("dragleave", event => { event.target.closest?.("#ics-drop")?.classList.remove("is-over"); });
document.addEventListener("drop", event => {
  const zone = event.target.closest?.("#ics-drop");
  if (!zone) return;
  event.preventDefault();
  zone.classList.remove("is-over");
  const file = event.dataTransfer?.files?.[0];
  if (file) file.text().then(text => readSchedule(text, file.name));
});

/** The room number at the end of a location ("McCool Hall 215" → "215"), when there is one. */
function roomFrom(location, building) {
  if (!location) return "";
  const m = /(?:\b(?:room|rm)\.?\s*)?([A-Z]?\d{1,4}[A-Z]?)\s*$/i.exec(String(location).trim());
  return m && m[1] && !String(building || "").includes(m[1]) ? m[1].toUpperCase() : "";
}

/** Opens the class form, empty to add a class or filled in to edit one. */
function openClassDialog(cls = null) {
  const dialog = $("#class-dialog");
  const form = dialog.querySelector("form");
  form.reset();
  form.querySelector(".form-error").hidden = true;
  $("#building-options").innerHTML = state.campus.buildings.map(b => `<option value="${h(b)}">`).join("");
  dialog.dataset.editing = cls?.id || "";
  $("#class-title").textContent = cls ? "Edit class" : "Add a class";
  $("#class-save").textContent = cls ? "Save changes" : "Save class";
  if (cls) {
    form.elements.name.value = cls.name || "";
    form.elements.title.value = cls.title || "";
    form.elements.building.value = cls.building || "";
    form.elements.room.value = cls.room || "";
    form.elements.time.value = cls.time || "";
    form.querySelectorAll('input[name="days"]').forEach(box => { box.checked = cls.days.includes(Number(box.value)); });
  }
  dialog.showModal();
  if (!cls) form.elements.name.focus();
}

function saveClass(form) {
  const data = new FormData(form);
  const days = data.getAll("days").map(Number);
  const name = String(data.get("name") || "").trim();
  const time = String(data.get("time") || "");
  const error = form.querySelector(".form-error");
  if (!name || !time || !days.length) {
    error.textContent = !name ? "Add the class name." : !time ? "Add the start time." : "Pick at least one day.";
    error.hidden = false;
    return false;
  }
  const editing = $("#class-dialog").dataset.editing;
  const entry = {
    id: editing || (crypto.randomUUID?.() ?? String(Date.now())), name,
    title: String(data.get("title") || "").trim(), building: String(data.get("building") || "").trim(),
    room: String(data.get("room") || "").trim(), days: days.sort(), time
  };
  const existing = editing && store.classes.find(c => c.id === editing);
  store.classes = existing ? store.classes.map(c => (c.id === editing ? { ...c, ...entry } : c)) : [...store.classes, entry];
  if (existing) trackEvent("class-edit", state.campus.name);
  error.hidden = true;
  return true;
}

// MARK: - Deals of the Month

const DEAL_CATEGORIES = [
  ["all", "All", "sparkle"], ["local", "Near campus", "pin"], ["food", "Food & delivery", "food"], ["desserts", "Desserts", "coffee"],
  ["books", "Books & study", "book"], ["tools", "Digital tools", "portal"], ["shopping", "Shopping", "tag"], ["entertainment", "Entertainment", "play"]
];

/** National deals plus this campus's own, minus any that have ended. Links to the bookstore and library follow the campus. */
function dealsForCampus(campus) {
  const data = state.deals;
  if (!data) return [];
  const live = d => d && d.brand && d.url && (!d.ends || d.ends >= today());
  const fillURL = url => url === "{bookstore}" ? (campus.links.bookstore || "#/map?cat=books")
    : url === "{library}" ? "#/map?cat=library" : url;
  const local = (data.campuses?.[campus.name] || []).filter(live).map(d => ({ ...d, local: true }));
  const sponsors = sponsorsFor(campus).filter(s => s.offer).map((s, i) => ({
    id: `sponsor-${i}`, brand: s.name, category: "local", headline: s.offer, details: s.address || "", url: s.url || "", sponsored: true, local: true, sponsorIndex: i
  }));
  return [...sponsors, ...local, ...(data.deals || []).filter(live)].map(d => ({ ...d, url: fillURL(d.url) }));
}

function dealsOfMonthCard() {
  const deals = state.campus && dealsForCampus(state.campus);
  if (!deals?.length) return "";
  return section("", `<a class="card glass deals-card" href="#/deals">
    <span class="row-icon gold-icon">${icon("tag")}</span>
    <span><span class="card-title">Deals of the Month</span><span class="muted">${deals.length} student discounts${state.deals.month ? ` for ${h(state.deals.month)}` : ""}</span></span>
    ${icon("chevronRight", "row-chevron")}</a>`);
}

const initialsOf = name => name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(w => w && !/^(for|the|your|of|and)$/i.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join("");

function renderDeals() {
  const campus = state.campus;
  const deals = dealsForCampus(campus);
  const filter = state.dealFilter || "all";
  const counts = Object.fromEntries(DEAL_CATEGORIES.map(([key]) => [key, key === "all" ? deals.length : deals.filter(d => (key === "local" ? d.local : d.category === key)).length]));
  const shown = filter === "all" ? deals : deals.filter(d => (filter === "local" ? d.local : d.category === filter));
  const checked = state.deals?.checked ? new Date(`${state.deals.checked}T12:00:00`).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }) : "";
  const card = d => {
    const internal = d.url.startsWith("#");
    const link = d.url ? `<a class="btn ${d.local ? "btn-gold" : "btn-glass"} btn-small deal-go" href="${h(d.url)}" ${internal ? "" : `target="_blank" rel="noopener${d.sponsored ? " sponsored" : ""}"`} data-deal-link="${h(d.id)}">${d.sponsorIndex != null ? "Open" : internal ? "Find it" : "Get deal"} ${icon("chevronRight")}</a>` : "";
    return `<article class="deal-card glass" data-category="${h(d.category)}">
      <div class="deal-top">
        <span class="deal-mark" style="--mark:${h(/^#[0-9a-f]{6}$/i.test(d.color || "") ? d.color : "var(--accent)")}" aria-hidden="true">${h(initialsOf(d.brand))}</span>
        <div class="deal-names"><p class="deal-brand">${h(d.brand)}${d.sponsored ? ` <span class="sponsored-tag">Sponsored</span>` : ""}</p><p class="deal-headline">${h(d.headline)}</p></div>
      </div>
      ${d.details ? `<p class="deal-details">${h(d.details)}</p>` : ""}
      <div class="deal-foot">${d.how ? `<p class="muted small deal-how">${icon("student")} ${h(d.how)}</p>` : "<span></span>"}${d.sponsorIndex != null ? `<button class="btn btn-gold btn-small deal-go" data-deal="${d.sponsorIndex}">On the map ${icon("chevronRight")}</button>` : link}</div>
    </article>`;
  };
  view.innerHTML = `
    <header class="page-header">
      <a class="icon-btn" href="#/" aria-label="Back">${icon("chevronLeft")}</a>
      <div><p class="eyebrow accent">${h(campus.name)}</p><h1 class="page-title">Deals of the Month</h1></div>
    </header>
    <p class="deals-intro">${state.deals?.month ? `<strong>${h(state.deals.month)}.</strong> ` : ""}Student discounts on food, books, tools and fun, from national brands and spots near campus.</p>
    <div class="chips deal-chips" role="tablist" aria-label="Deal categories">
      ${DEAL_CATEGORIES.filter(([key]) => counts[key] || key === "all").map(([key, label, ic]) => `<button class="chip ${filter === key ? "is-active" : ""}" role="tab" aria-selected="${filter === key}" data-deal-filter="${key}">${icon(ic)}${label}</button>`).join("")}
    </div>
    ${shown.length ? `<div class="deal-grid">${shown.map(card).join("")}</div>` : `<div class="empty card glass"><p class="card-title">No deals here yet</p><p class="muted">Check back next month, or pick another category.</p></div>`}
    ${!deals.some(d => d.local) ? `<a class="card glass deals-local-cta" href="${h(config.advertiseURL || "advertise.html")}" target="_blank" rel="noopener"><span class="row-icon">${icon("pin")}</span><span><span class="card-title">Own a business near ${h(campus.name)}?</span><span class="muted">Offer a student deal on GradWay.</span></span>${icon("chevronRight", "row-chevron")}</a>` : ""}
    <p class="muted small center deals-fine">${checked ? `Checked ${h(checked)}. ` : ""}Prices and terms change, and most offers need student verification. Confirm on the brand's site before you buy. GradWay isn't affiliated with these brands unless a deal is marked Sponsored.</p>
  `;
  trackEvent("deals-view", campus.name, filter);
}

// MARK: - Buildings

function renderBuildings() {
  const campus = state.campus;
  view.innerHTML = `
    <header class="page-header">
      <a class="icon-btn" href="#/" aria-label="Back">${icon("chevronLeft")}</a>
      <div><p class="eyebrow accent">${h(campus.name)}</p><h1 class="page-title">Find Buildings</h1></div>
    </header>
    <form class="dash-search glass" role="search" onsubmit="return false">
      ${icon("search")}
      <input id="building-filter" type="search" autocomplete="off" placeholder="Filter ${campus.buildings.length} buildings" aria-label="Filter buildings" value="${h(state.buildingFilter || "")}">
    </form>
    <div class="rows" id="building-list">
      ${campus.buildings.map((name, i) => `
        <a class="row ${i === 0 ? "row-first" : i === campus.buildings.length - 1 ? "row-last" : "row-middle"}" href="#/map?q=${encodeURIComponent(name)}&exact=1" data-search="${h(name.toLowerCase())}" data-name="${h(name)}">
          <span class="row-icon">${icon("building")}</span><span class="row-title">${h(name)}</span>${icon("pin", "row-chevron")}
        </a>`).join("") || `<p class="muted">No building list for this campus yet. Search the map instead.</p>`}
    </div>
  `;
  const applyFilter = value => {
    state.buildingFilter = value;
    const term = value.trim().toLowerCase();
    document.querySelectorAll("#building-list .row").forEach(row => { row.hidden = Boolean(term) && !row.dataset.search.includes(term); });
  };
  $("#building-filter").addEventListener("input", event => applyFilter(event.target.value));
  applyFilter(state.buildingFilter || "");
}

// MARK: - Mode (Student / Visitor), like GradWayModePicker

function promptForModeIfNeeded() {
  const dialog = $("#mode-dialog");
  if (!store.modeFor(state.campus.name) && !dialog.open && !$("#class-dialog").open && !$("#safety-dialog").open) {
    openModeDialog();
  }
}

function openModeDialog() {
  // The welcome screen sits under dialogs, so ask Student or Visitor once it has finished.
  if (state.arriving) { state.arriving.then(() => { if (state.campus && !$("#mode-dialog").open) openModeDialog(); }); return; }
  const dialog = $("#mode-dialog");
  dialog.querySelector(".mode-campus").textContent = state.campus.name;
  const current = store.modeFor(state.campus.name);
  dialog.querySelectorAll("[data-mode]").forEach(b => b.classList.toggle("is-current", b.dataset.mode === current));
  dialog.showModal();
}

// MARK: - Safety

function openSafetyDialog() {
  const campus = state.campus;
  $("#safety-body").innerHTML = `
    <a class="btn btn-danger btn-block" href="tel:911">${icon("phone")} Call 911</a>
    <div class="rows">
      ${campus.links.emergency ? `<a class="row row-first" href="${h(campus.links.emergency)}" target="_blank" rel="noopener"><span class="row-icon">${icon("shield")}</span><span class="row-title">${h(campus.name)} public safety</span>${icon("chevronRight", "row-chevron")}</a>` : ""}
      <a class="row ${campus.links.emergency ? "row-middle" : "row-first"}" href="#/map?cat=police" data-close-dialog><span class="row-icon">${icon("shield")}</span><span class="row-title">Police near campus</span>${icon("pin", "row-chevron")}</a>
      <a class="row row-middle" href="#/map?cat=health" data-close-dialog><span class="row-icon">${icon("health")}</span><span class="row-title">Clinics and hospitals</span>${icon("pin", "row-chevron")}</a>
      <button class="row row-last" data-action="share-location"><span class="row-icon">${icon("share")}</span><span class="row-title">Share my location</span>${icon("chevronRight", "row-chevron")}</button>
    </div>
    <p class="muted small" id="share-status" role="status"></p>
    <p class="muted small">Walking home late? The iPhone app's Walk With Me lets a friend watch the clock until you arrive.</p>`;
  $("#safety-dialog").showModal();
}

async function shareLocation() {
  const status = $("#share-status");
  status.textContent = "Finding your location…";
  try {
    const position = await locate();
    const url = `https://maps.google.com/?q=${position.lat.toFixed(6)},${position.lng.toFixed(6)}`;
    const text = `I'm here right now: ${url}`;
    if (navigator.share) {
      await navigator.share({ title: "My location", text });
      status.textContent = "";
    } else {
      await navigator.clipboard.writeText(text);
      status.textContent = "Location link copied. Paste it into a text.";
    }
  } catch (error) {
    if (error?.name === "AbortError") { status.textContent = ""; return; }
    status.textContent = "Location isn't available. Check that location is allowed for this site.";
  }
}

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("unsupported"));
    navigator.geolocation.getCurrentPosition(
      p => { state.userPosition = { lat: p.coords.latitude, lng: p.coords.longitude }; state.userPositionAt = Date.now(); resolve(state.userPosition); },
      reject,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}

// MARK: - Map screen

const PLACEHOLDERS = ["Find your way", "Libraries", "Cafe", "Building names", "Breakfast", "Tacos",
  "Bookstores", "Starbucks", "Post office", "Gyms", "Parking lots", "Pharmacy"];

function buildMapChrome() {
  $("#map-chips").innerHTML = QUICK_CATEGORIES.map(key =>
    `<a class="chip" href="#/map?cat=${key}" data-cat="${key}">${icon(CATEGORIES[key].icon)}${CATEGORIES[key].label}</a>`).join("");
  $("#map-search-icon").innerHTML = icon("search");
  $("#map-back").innerHTML = icon("chevronLeft");
  $("#map-clear").innerHTML = icon("close");
  $("#map-locate").innerHTML = icon("locate");
  $("#map-layers").innerHTML = icon("layers");
  $("#map-campus").innerHTML = icon("building");
  $("#map-campus").addEventListener("click", () => {
    const campus = state.campus;
    if (!campus?.region || !state.map) return;
    // Back to the whole campus, centered on its center point.
    // Keep the campus center clear of the search bar and of the list or card, wherever it sits.
    const card = !sheet.hidden && sheet.offsetHeight ? sheet.getBoundingClientRect() : null;
    const padding = desktop.matches
      ? { top: 140, bottom: 40, left: card ? card.right + 16 - $("#map").getBoundingClientRect().left : 40, right: 80 }
      : { top: 190, bottom: card && !sheet.classList.contains("is-collapsed") ? Math.min(card.height + 24, innerHeight * 0.55) : 40 };
    state.map.recenter(campus.region, padding);
    trackEvent("recenter", campus.name);
  });
  buildLayersPanel();
  $("#map-layers").addEventListener("click", event => {
    event.stopPropagation();
    const panel = $("#map-layers-panel");
    panel.hidden = !panel.hidden;
    $("#map-layers").setAttribute("aria-expanded", String(!panel.hidden));
  });
  document.addEventListener("click", event => {
    const panel = $("#map-layers-panel");
    if (!panel.hidden && !panel.contains(event.target)) { panel.hidden = true; $("#map-layers").setAttribute("aria-expanded", "false"); }
  });

  $("#map-search").addEventListener("submit", event => {
    event.preventDefault();
    const query = searchInput.value.trim();
    if (!query) return;
    searchInput.blur();
    go(`#/map?q=${encodeURIComponent(query)}`);
  });
  searchInput.addEventListener("input", () => { $("#map-clear").hidden = !searchInput.value; });
  $("#map-clear").addEventListener("click", () => {
    searchInput.value = "";
    $("#map-clear").hidden = true;
    resetSearch();
    state.lastSearchKey = "";
    history.replaceState(null, "", "#/map");
    if (state.campus.region) state.map?.setRegion(state.campus.region);
    showIdlePanel();
    searchInput.focus();
  });
  $("#map-locate").addEventListener("click", async () => {
    try {
      const position = await locate();
      state.map?.showUser(position);
      const far = state.campus.region && distanceMeters(position, state.campus.region.center) > 25_000;
      if (far) {
        state.map?.relaxLimits();
        showStatus(`You're ${formatDistance(distanceMeters(position, state.campus.region.center))} from campus`);
      }
      if (state.selected) requestRoute(state.selected);
      else state.map?.flyTo(position);
    } catch {
      showStatus("Location isn't available. Allow location for this site to see where you are.");
    }
  });
  document.addEventListener("keydown", event => { if (event.key === "Escape" && state.selected) closeSelection(); });
  animatePlaceholder();
}

function animatePlaceholder() {
  if (reducedMotion.matches) return;
  let index = 0, char = 0, deleting = false;
  const tick = () => {
    if (document.activeElement !== searchInput && !searchInput.value) {
      const word = PLACEHOLDERS[index];
      char += deleting ? -1 : 1;
      searchInput.placeholder = word.slice(0, char) || "Search buildings, ATMs, coffee…";
      if (!deleting && char >= word.length) { deleting = true; return setTimeout(tick, 1400); }
      if (deleting && char <= 0) { deleting = false; index = (index + 1) % PLACEHOLDERS.length; }
    }
    setTimeout(tick, deleting ? 45 : 90);
  };
  setTimeout(tick, 1200);
}

const LOOK_LABELS = { dark: "Dark", light: "Light", satellite: "Satellite", navy: "Navy", streets: "Streets" };

function buildLayersPanel() {
  const look = MAP_STYLES.includes(store.mapLook) ? store.mapLook : "streets";
  const on = new Set(store.mapDetails);
  $("#map-layers-panel").innerHTML = `
    <p class="eyebrow">Map style</p>
    <div class="look-toggle" role="radiogroup" aria-label="Map style">
      ${MAP_STYLES.map(name => `<button role="radio" aria-checked="${name === look}" class="look-${name} ${name === look ? "is-on" : ""}" data-look="${name}"><span class="look-swatch"></span>${LOOK_LABELS[name]}</button>`).join("")}
    </div>
    <p class="eyebrow">Show on map</p>
    <div class="detail-toggles">
      ${config.trafficTilesURL ? `
        <label class="detail-toggle"><input type="checkbox" data-traffic="1" ${store.traffic ? "checked" : ""}>
          <span class="detail-dot detail-traffic">${icon("car")}</span><span>Live traffic</span><span class="muted small">TomTom</span></label>` : ""}
      ${Object.entries(DETAIL_LAYERS).filter(([, d]) => !d.group).map(([key, d]) => detailToggle(key, d, on)).join("")}
    </div>
    <p class="eyebrow">Accessibility</p>
    <div class="detail-toggles">
      <label class="detail-toggle"><input type="checkbox" data-step-free="1" ${store.stepFree ? "checked" : ""}>
        <span class="detail-dot detail-stepfree">${icon("walk")}</span><span>Step-free walking routes</span><span class="muted small">Avoids stairs</span></label>
      ${Object.entries(DETAIL_LAYERS).filter(([, d]) => d.group === "Accessibility").map(([key, d]) => detailToggle(key, d, on)).join("")}
    </div>
    <p class="muted small layers-note">Details come from OpenStreetMap and may be incomplete on some campuses.</p>`;
  $("#map-layers-panel").addEventListener("change", event => {
    if (event.target.dataset.traffic) {
      store.traffic = event.target.checked;
      state.map?.setTraffic(event.target.checked);
      if (event.target.checked) trackEvent("traffic-on", state.campus?.name);
      return;
    }
    if (event.target.dataset.stepFree) {
      store.stepFree = event.target.checked;
      document.querySelectorAll(".step-free").forEach(b => { b.classList.toggle("is-on", store.stepFree); b.setAttribute("aria-pressed", String(store.stepFree)); const st = b.querySelector(".step-free-state"); if (st) st.textContent = store.stepFree ? "On" : "Off"; });
      if (state.selected && nearCampus()) requestRoute(state.selected);
      return;
    }
    const key = event.target.dataset.detail;
    if (!key) return;
    const set = new Set(store.mapDetails);
    event.target.checked ? set.add(key) : set.delete(key);
    store.mapDetails = [...set];
    applyOverlays();
  });
}

function detailToggle(key, d, on) {
  return `<label class="detail-toggle"><input type="checkbox" data-detail="${key}" ${on.has(key) ? "checked" : ""}>
    <span class="detail-dot detail-${key}">${icon(d.icon)}</span><span>${d.label}</span><span class="muted small detail-count" data-count="${key}"></span></label>`;
}

async function setLook(name) {
  const previous = state.map?.styleName || store.mapLook;
  const mark = look => document.querySelectorAll("[data-look]").forEach(b => {
    const on = b.dataset.look === look;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-checked", String(on));
  });
  mark(name);
  const ok = state.map ? await state.map.setStyleName(name) : true;
  if (ok) { store.mapLook = name; return; }
  mark(previous);
  showStatus(`The ${LOOK_LABELS[name]} style isn't available right now. Try another one.`);
}

/** Draws the chosen map details (emergency phones, bus stops, ...) from the campus prefetch. */
async function applyOverlays() {
  const map = state.map;
  const campus = state.campus;
  if (!map || !campus?.region) return;
  const on = new Set(store.mapDetails);
  for (const key of Object.keys(DETAIL_LAYERS)) if (!on.has(key)) map.clearOverlay(key);
  if (!on.size) return;
  let byKey;
  try {
    if (!prefetchReady(campus)) showStatus("Loading map details…");
    byKey = await prefetchCampus(config, campus.region);
  } catch {
    showStatus("Map details couldn't load right now. Try again in a minute.");
    return;
  }
  if (state.campus !== campus) return;
  if (statusEl.textContent === "Loading map details…") showStatus("");
  for (const key of on) {
    const d = DETAIL_LAYERS[key];
    const items = byKey[key] || [];
    map.setOverlay(key, items, { icon: icon(d.icon), label: d.label.replace(/s$/, ""), onSelect: item => selectItem({ ...item, id: `detail-${item.id}` }) });
    const count = document.querySelector(`[data-count="${key}"]`);
    if (count) count.textContent = items.length ? String(items.length) : "none mapped";
  }
}

const prefetchReady = campus => { try { return Boolean(localStorage.getItem(`gradway.cache.poi3.${campus.region.center.lat.toFixed(4)},${campus.region.center.lng.toFixed(4)}`)); } catch { return false; } };

async function ensureMap() {
  if (!state.map) {
    const wanted = MAP_STYLES.includes(store.mapLook) ? store.mapLook : "streets";
    state.map = new CampusMap($("#map"), config, { look: wanted });
    await state.map.ready;
    // Satellite (or a style that didn't load at first) switches once the map exists.
    if (state.map.styleName !== wanted && !(await state.map.setStyleName(wanted))) store.mapLook = state.map.styleName;
    if (state.map.styleName !== wanted) document.querySelectorAll("[data-look]").forEach(b => {
      const on = b.dataset.look === state.map.styleName;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-checked", String(on));
    });
    state.map.enablePlacePicking(pickMapPlace);
    if (config.trafficTilesURL && store.traffic) state.map.setTraffic(true);
    if (state.campus) state.map.setCampus(state.campus);
    applyOverlays();
    // A drag, pinch or scroll by the person (not our own camera moves) shrinks the bottom card.
    for (const type of ["dragstart", "zoomstart", "rotatestart", "pitchstart"]) {
      state.map.map?.on(type, event => { if (event.originalEvent) collapseSheet(); });
    }
    sheet.addEventListener("click", event => {
      if (!sheet.classList.contains("is-collapsed")) return;
      if (event.target.closest('[data-action="toggle-sheet"]')) return;
      event.preventDefault();
      event.stopPropagation();
      expandSheet();
    }, true);
  } else {
    await state.map.ready;
  }
  requestAnimationFrame(() => state.map.resize());
  return state.map;
}

async function showMap(route) {
  $("#map-back").setAttribute("href", !state.leftRoute || state.leftRoute === "dashboard" ? "#/" : `#/${state.leftRoute}`);
  await ensureMap();
  locateIfAllowed();
  const query = route.params.get("q");
  const categoryKey = route.params.get("cat");
  const exact = route.params.get("exact") === "1";
  const deal = route.params.get("deal") === "1" ? state.pendingDeal : null;
  const key = `${state.campus.name}|${query}|${categoryKey}|${exact}|${deal?.id || ""}`;
  document.querySelectorAll("#map-chips .chip").forEach(chip => chip.classList.toggle("is-active", chip.dataset.cat === categoryKey));
  if (key === state.lastSearchKey) return;
  state.lastSearchKey = key;

  if (deal) {
    searchInput.value = deal.name;
    resetSearch();
    state.results = [];
    state.map?.setPins([deal], selectItem);
    selectItem(deal, { zoomMeters: 900 });
  } else if (categoryKey && CATEGORIES[categoryKey]) {
    searchInput.value = CATEGORIES[categoryKey].label;
    performSearch({ categoryKey, query: CATEGORIES[categoryKey].query, exact: false });
  } else if (query) {
    searchInput.value = query;
    performSearch({ query, exact });
  } else {
    searchInput.value = "";
    resetSearch();
    showIdlePanel();
  }
  $("#map-clear").hidden = !searchInput.value;
}

/** Laptop only: when the map has no search, offer the next class and a few buildings. */
function showIdlePanel() {
  if (!desktop.matches || !state.campus) return;
  const campus = state.campus;
  const next = nextClass();
  const picks = campus.buildings.slice(0, 6);
  const start = next.walk ? `
    <a class="idle-next" href="${next.href}">
      <span class="walk-glyph">${icon("walk")}</span>
      <span><span class="eyebrow">${h(next.eyebrow)}</span><span class="next-text">${h(next.text)}</span></span>
      ${icon("chevronRight", "row-chevron")}
    </a>` : "";
  sheet.hidden = false;
  sheet.innerHTML = `
    <div class="idle">
      <p class="eyebrow accent">Explore</p>
      <h2 class="detail-name">${h(campus.name)}</h2>
      <p class="muted small">Search above, pick a category, or start here.</p>
      ${start}
      ${picks.length ? `<p class="eyebrow idle-label">Buildings</p>
      <ol class="result-list">${picks.map(name => `
        <li><a class="result" href="#/map?q=${encodeURIComponent(name)}&exact=1">
          <span class="row-icon">${icon("building")}</span>
          <span class="result-text"><span class="result-name">${h(name)}</span></span>
          ${icon("pin", "row-chevron")}
        </a></li>`).join("")}</ol>
      ${campus.buildings.length > picks.length ? `<a class="muted small alt-maps" href="#/buildings">All ${campus.buildings.length} buildings</a>` : ""}` : ""}
    </div>`;
}

function showStatus(text) {
  statusEl.textContent = text || "";
  statusEl.hidden = !text;
}

function resetSearch() {
  state.searchAbort?.abort();
  cancelRoute();
  state.results = [];
  state.selected = null;
  state.map?.clearPins();
  state.map?.limitToCampus();
  sheet.innerHTML = "";
  sheet.hidden = true;
  showStatus("");
}

const sheetPadding = () => ({ bottom: sheet.hidden ? 24 : Math.min(sheet.offsetHeight + 24, innerHeight * 0.6), top: desktop.matches ? 90 : 150 });

/** GradWayMapViewController.performSearch, then presentSearchResults. */
async function performSearch({ query, categoryKey, exact }) {
  const campus = state.campus;
  if (!campus.region) { showStatus("This campus doesn't have a map location yet."); return; }

  resetSearch();
  // Typed words that mean a kind of place ("coffee", "fitness", "where can I eat") search
  // that category, the same as its quick button, instead of matching names.
  let understood = null;
  if (!categoryKey && !exact && query) {
    understood = intentFor(query);
    if (understood) {
      categoryKey = understood;
      document.querySelectorAll("#map-chips .chip").forEach(chip => chip.classList.toggle("is-active", chip.dataset.cat === categoryKey));
      trackEvent("search-understood", categoryKey);
    }
  }
  const generation = ++state.searchGeneration;
  const controller = new AbortController();
  state.searchAbort = controller;
  if (categoryKey) trackEvent("category", categoryKey);
  showStatus(understood ? `Looking for ${CATEGORIES[categoryKey].label.toLowerCase()}…` : "Searching…");

  const present = (result, { partial = false } = {}) => {
    if (generation !== state.searchGeneration) return;
    const reference = distanceReference();
    let sorted = sortByDistance(result.items, reference);
    if (categoryKey) {
      const promos = sponsorsFor(campus).map(sponsorPlace).filter((p, i) => sponsorsFor(campus)[i].category === categoryKey);
      if (promos.length) {
        if (!partial) promos.forEach(p => trackEvent("sponsor-view", campus.name, p.name));
        const names = new Set(promos.map(p => p.name.toLowerCase()));
        sorted = [...sortByDistance(promos, reference), ...sorted.filter(i => !names.has(i.name.toLowerCase()))];
      }
    }
    // Keep what the person has open if more results arrive.
    const keepSelection = state.selected && sorted.some(i => i.id === state.selected.id);
    state.results = sorted;
    state.map?.setPins(sorted, selectItem);

    if (exact) {
      if (sorted.length) { showStatus(""); selectItem(bestNameMatch(sorted, query), { zoomMeters: 1000 }); }
      else { showStatus("Not found on campus · try the building's full name"); state.map?.setRegion(regionAround(campus.region.center, 2500)); }
      return;
    }

    const onCampus = result.onCampus;
    const nearbyCount = result.items.length - onCampus;
    if (nearbyCount > 0) state.map?.relaxLimits();
    const radius = result.radiusMiles || SEARCH_RADIUS_MILES;
    const status = partial ? `${onCampus} on campus · finding more nearby…`
      : !sorted.length ? `Nothing found within ${radius} mi`
      : !onCampus && nearbyCount ? `Nothing on campus · ${nearbyCount} within ${radius} mi`
      : nearbyCount ? `${onCampus} on campus · ${nearbyCount} nearby`
      : `${desktop.matches ? "Zoom" : "Pinch"} to explore, or pick from the list`;
    showStatus(status);

    if (keepSelection) { state.map?.select(state.selected); return; }
    if (!sorted.length) { state.map?.setRegion(regionAround(campus.region.center, 2500)); return; }
    if (sorted.length === 1) { selectItem(sorted[0], { zoomMeters: 1000 }); return; }
    showResultsList();
    // Frame campus results when there are some; otherwise the nearest few off campus.
    const focus = onCampus ? sorted.filter(i => isInsideCampus(i)) : sorted.slice(0, 6);
    if (focus.length > 1) state.map?.fitItems(focus, sheetPadding());
    else state.map?.setRegion(regionAround(focus[0] || campus.region.center, 2200), sheetPadding());
  };

  try {
    const result = await runSearch(config, {
      query, categoryKey, campusRegion: campus.region, isExactLookup: exact, signal: controller.signal,
      onPartial: partial => present(partial, { partial: true })
    });
    present(result);
    if (!exact) record("search", {
      kind: categoryKey ? "category" : "name", category: categoryKey || null, results: result.items.length,
      query: !categoryKey && !result.items.length ? String(query).trim().toLowerCase().slice(0, 40) : null
    });
  } catch (error) {
    if (error?.name === "AbortError" || generation !== state.searchGeneration) return;
    console.warn("GradWay search:", error);
    if (!state.results.length) showStatus("Search isn't responding right now. Try again in a moment.");
    else showStatus("Showing campus results · nearby places didn't load");
  }
}

function isInsideCampus(item) {
  const r = state.campus?.region;
  if (!r) return false;
  return Math.abs(item.lat - r.center.lat) <= r.latDelta / 2 && Math.abs(item.lng - r.center.lng) <= r.lngDelta / 2;
}

const FAR_FROM_CAMPUS_METERS = 25 * 1609.34;

/** True when we know where the person is and they're within 25 miles of campus. */
function nearCampus() {
  const center = state.campus?.region?.center;
  return Boolean(state.userPosition && center && distanceMeters(state.userPosition, center) <= FAR_FROM_CAMPUS_METERS);
}

/** Where distances are measured from: the person on or near campus, otherwise the campus center. */
const distanceReference = () => (nearCampus() ? state.userPosition : state.campus.region.center);

function distanceLine(item) {
  const fromUser = nearCampus();
  const meters = distanceMeters(item, distanceReference());
  return `${formatDistance(meters)} ${fromUser ? "away" : "from campus center"} · about ${walkMinutes(meters)} min walk`;
}

/** The route button's words: from my location, with how far away that is when it's off campus. */
function routeButtonLabel() {
  const verb = { drive: "Driving", bike: "Biking", walk: "Walking" }[travelMode()];
  if (state.userPosition && !nearCampus()) {
    return `${verb === "Walking" ? "Driving" : verb} route from my location · ${formatDistance(distanceMeters(state.userPosition, state.campus.region.center))} away`;
  }
  return `${verb} route from my location`;
}

function showResultsList() {
  const items = state.results;
  sheet.hidden = false;
  expandSheet();
  sheet.innerHTML = `
    ${sheetHandle()}
    <div class="sheet-head"><p class="sheet-title">${items.length} places</p><p class="muted small">Closest first</p>
      <button class="icon-btn subtle sheet-min" data-action="toggle-sheet" aria-label="Minimize the list">${icon("chevronDown")}</button></div>
    <ol class="result-list">${items.map(item => `
      <li><button class="result" data-result="${h(item.id)}">
        <span class="result-pin" aria-hidden="true"></span>
        <span class="result-text"><span class="result-name">${h(item.name)}</span>
        <span class="muted small">${item.sponsored ? `<span class="sponsored-tag">Sponsored</span> ` : ""}${h([item.sponsored ? item.offer : item.kind, formatDistance(item.distance)].filter(Boolean).join(" · "))}</span></span>
        ${icon("chevronRight", "row-chevron")}
      </button></li>`).join("")}</ol>`;
  state.selected = null;
  state.map?.select(null);
}

function directionsURL(item, apple = isIOS, mode = travelMode()) {
  const at = `${item.lat},${item.lng}`;
  if (apple) {
    // Apple's newer Maps links (iOS 18.4+) know cycling and "avoid stairs"; the classic link covers walk and drive everywhere.
    if (mode === "bike") return `https://maps.apple.com/directions?destination=${at}&mode=cycling`;
    if (mode === "walk" && store.stepFree) return `https://maps.apple.com/directions?destination=${at}&mode=walking&avoid=stairs`;
    return `https://maps.apple.com/?daddr=${at}&dirflg=${mode === "drive" ? "d" : "w"}`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${at}&travelmode=${{ drive: "driving", bike: "bicycling", walk: "walking" }[mode] || "walking"}`;
}

/** Waze (driving only). Opens the Waze app if it's installed, or waze.com. */
const wazeURL = item => `https://waze.com/ul?ll=${item.lat},${item.lng}&navigate=yes`;

/** The small links under Directions: the other map app, and Waze when driving. */
function altMapsLinks(item) {
  const other = `<a href="${directionsURL(item, !isIOS)}" target="_blank" rel="noopener" data-alt-maps="1">Open in ${isIOS ? "Google Maps" : "Apple Maps"}</a>`;
  const waze = travelMode() === "drive" ? ` · <a href="${wazeURL(item)}" target="_blank" rel="noopener" data-waze="1">Waze</a>` : "";
  return other + waze;
}

// Opens Google Street View (no API key needed). Google shows the panorama closest to
// the viewpoint, which for a building's center is often a visitor's photo from inside.
// So the link starts at the place itself and is then re-aimed from the nearest street,
// facing the building, where Google's own outdoor imagery is.
const streetViewURL = (item, from) => {
  const base = "https://www.google.com/maps/@?api=1&map_action=pano";
  if (!from) return `${base}&viewpoint=${item.lat},${item.lng}`;
  const heading = Math.round((bearingDegrees(from, item) + 360) % 360);
  return `${base}&viewpoint=${from.lat.toFixed(6)},${from.lng.toFixed(6)}&heading=${heading}&pitch=5&fov=80`;
};

function bearingDegrees(a, b) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return Math.atan2(y, x) / r;
}

const streetSpots = new Map();
/** Finds the nearest street to the place and points the card's Street View button from there. */
async function aimStreetView(item) {
  const key = `${item.lat.toFixed(5)},${item.lng.toFixed(5)}`;
  if (!streetSpots.has(key)) streetSpots.set(key, nearestStreet(config, item).catch(() => null));
  const spot = await streetSpots.get(key);
  // Use the street only if it's close (a place set back over 250 m keeps its own point),
  // and not when the place is itself on the street.
  if (!spot || spot.meters > 250 || spot.meters < 6 || state.selected !== item) return;
  const link = document.querySelector(".streetview-btn");
  if (link) link.href = streetViewURL(item, spot);
}

const travelMode = () => (["drive", "bike"].includes(store.travelMode) ? store.travelMode : "walk");
const MODE_ICONS = { walk: "walk", bike: "bike", drive: "car" };

function travelToggle() {
  const mode = travelMode();
  return `<div class="travel-toggle three" role="radiogroup" aria-label="Route type">
    ${[["walk", "Walk"], ["bike", "Bike"], ["drive", "Drive"]].map(([m, label]) =>
      `<button role="radio" aria-checked="${mode === m}" class="${mode === m ? "is-on" : ""}" data-travel="${m}">${icon(MODE_ICONS[m])} ${label}</button>`).join("")}
  </div>
  <button class="step-free ${store.stepFree ? "is-on" : ""}" data-action="step-free" aria-pressed="${store.stepFree}" ${mode === "walk" ? "" : "hidden"}>
    ${icon("wheelchair")}<span>Step-free route</span><span class="step-free-state">${store.stepFree ? "On" : "Off"}</span></button>`;
}

function setTravelMode(mode) {
  const changed = travelMode() !== mode;
  store.travelMode = mode;
  const stepFree = document.querySelector(".step-free");
  if (stepFree) stepFree.hidden = mode !== "walk";
  document.querySelectorAll(".travel-toggle [data-travel]").forEach(b => {
    const on = b.dataset.travel === mode;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-checked", String(on));
  });
  const item = state.selected;
  if (!item) return;
  document.querySelector(".directions-btn")?.setAttribute("href", directionsURL(item));
  const alt = document.querySelector(".maps-links");
  if (alt) alt.innerHTML = altMapsLinks(item);
  const routeMe = document.querySelector(".route-me");
  if (routeMe) routeMe.lastChild.textContent = ` ${routeButtonLabel()}`;
  // Re-route whenever a route is (or was being) shown for this place, near campus or not.
  if (changed && state.userPosition && (nearCampus() || state.routedItem === item)) requestRoute(item);
}

function selectItem(item, { zoomMeters } = {}) {
  if (!item) return;
  if (state.selected !== item) record("place", { name: item.unnamed ? null : String(item.name).slice(0, 80), kind: String(item.categoryKey || item.kind || "").slice(0, 40), cell: cellOf(item) });
  state.selected = item;
  state.map?.select(item);
  const hasList = state.results.length > 1;
  sheet.hidden = false;
  sheet.innerHTML = `
    ${sheetHandle()}
    <div class="detail">
      <div class="detail-head">
        ${hasList ? `<button class="icon-btn subtle" data-action="back-to-list" aria-label="Back to the list">${icon("chevronLeft")}</button>` : ""}
        <div class="detail-titles">
          <p class="eyebrow accent">${h(item.kind || "Place")}</p>
          <h2 class="detail-name">${h(item.name)}</h2>
          ${item.address ? `<p class="muted small">${h(item.address)}</p>` : ""}
          ${item.offer ? `<p class="deal-offer">${icon("tag")} ${h(item.offer)}</p>` : ""}
          ${item.url ? `<a class="muted small alt-maps" href="${h(item.url)}" target="_blank" rel="noopener sponsored" data-sponsor-link="${h(item.name)}">Visit website</a>` : ""}
        </div>
        <button class="icon-btn subtle sheet-min" data-action="toggle-sheet" aria-label="Minimize">${icon("chevronDown")}</button>
        <button class="icon-btn subtle" data-action="close-selection" aria-label="Close">${icon("close")}</button>
      </div>
      ${travelToggle()}
      <p class="detail-distance" id="route-line" aria-live="polite"><span class="route-icon is-${travelMode()}">${icon(MODE_ICONS[travelMode()])}</span> <span class="route-text">${distanceLine(item)}</span></p>
      ${nearCampus() ? "" : `<button class="btn btn-glass btn-block route-me" data-action="route-me">${icon("locate")} ${routeButtonLabel()}</button>`}
      <div class="place-info" id="place-info" hidden></div>
      <div class="detail-actions">
        <a class="btn btn-gold directions-btn" href="${directionsURL(item)}" target="_blank" rel="noopener" ${item.sponsored ? `data-sponsor-link="${h(item.name)}"` : ""}>${icon("directions")} Directions</a>
        <a class="btn btn-glass streetview-btn" href="${streetViewURL(item)}" target="_blank" rel="noopener" data-streetview="1">${icon("streetview")} Street View</a>
        <button class="btn btn-glass" data-action="share-place">${icon("share")} Share</button>
      </div>
      <p class="muted small alt-maps maps-links">${altMapsLinks(item)}</p>
    </div>`;
  expandSheet();
  showPlaceInfo(item);
  aimStreetView(item);
  const region = regionAround(item, zoomMeters || 700);
  cancelRoute();
  if (nearCampus()) requestRoute(item);
  else requestAnimationFrame(() => state.map?.setRegion(region, sheetPadding()));
}

// MARK: - Business info (phone, hours, website)

function prettyPhone(phone) {
  const digits = phone.replace(/[^\d+]/g, "");
  const us = digits.replace(/^\+?1/, "");
  return /^\d{10}$/.test(us) ? `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}` : phone;
}

/** Google Maps search for the place, which usually lists hours and a phone number. */
function googleLookupURL(item) {
  const where = item.address || state.campus?.name || "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([item.name, where].filter(Boolean).join(", "))}`;
}

/** Shown when OpenStreetMap has no hours or phone for a place (or the lookup failed). */
function missingInfoRow(item, failed) {
  if (!item || item.unnamed) return "";
  return `<div class="info-row info-missing">${icon("clock")}<div>
    <span class="muted small">${failed ? "Couldn't load hours and phone right now." : "Hours and phone aren't listed for this place yet."}</span>
    <a href="${h(googleLookupURL(item))}" target="_blank" rel="noopener" data-lookup="1">Check hours on Google Maps</a></div></div>`;
}

function placeInfoHTML(info, item) {
  if (!info) return missingInfoRow(item);
  const rows = [];
  if (info.hours) {
    const week = parseOpeningHours(info.hours);
    const status = openStatus(week);
    rows.push(`<div class="info-row">${icon("clock")}<div>
      ${status ? `<span class="open-state ${status.open ? "is-open" : "is-closed"}">${h(status.text)}</span>` : ""}
      <span class="muted small">${h(formatWeek(week) || info.hours)}</span></div></div>`);
  }
  if (info.phone) {
    const first = info.phone.split(";")[0].trim();
    rows.push(`<div class="info-row">${icon("phone")}<a href="tel:${h(first.replace(/[^\d+]/g, ""))}">${h(prettyPhone(first))}</a></div>`);
  }
  if (info.website) {
    let host = info.website;
    try { host = new URL(/^https?:/i.test(info.website) ? info.website : `https://${info.website}`).hostname.replace(/^www\./, ""); } catch { /* keep as written */ }
    rows.push(`<div class="info-row">${icon("globe")}<a href="${h(/^https?:/i.test(info.website) ? info.website : `https://${info.website}`)}" target="_blank" rel="noopener">${h(host)}</a></div>`);
  }
  const facts = [
    info.cuisine && info.cuisine,
    info.wheelchair === "yes" && "Wheelchair accessible",
    info.wheelchair === "limited" && "Limited wheelchair access",
    info.wifi && "Wi-Fi",
    info.fee === "yes" && "Fee to park",
    info.fee === "no" && "Free"
  ].filter(Boolean);
  if (facts.length) rows.push(`<div class="info-facts">${facts.map(f => `<span class="info-chip">${h(f)}</span>`).join("")}</div>`);
  if (!info.hours && !info.phone) rows.unshift(missingInfoRow(item));
  return rows.join("");
}

/** Fills the place card's info section, looking it up on tap when the search didn't include it. */
async function showPlaceInfo(item) {
  const box = $("#place-info");
  if (!box) return;
  const fill = (info, failed = false) => {
    if (state.selected !== item) return;
    const html = failed ? missingInfoRow(item, true) : placeInfoHTML(info, item);
    box.innerHTML = html;
    box.hidden = !html;
  };
  if (item.info !== undefined || (!item.osm && !item.findByName)) return fill(item.info);
  box.innerHTML = `<p class="muted small">Looking up hours and phone…</p>`;
  box.hidden = false;
  try {
    // Give up after 8 seconds rather than leave the card waiting.
    const info = await Promise.race([
      placeDetails(config, item),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out")), 8000))
    ]);
    item.info = info;
    fill(info);
  } catch {
    fill(null, true);
  }
}

// MARK: - Bottom card: shrinks while the map is being moved, grows back on tap

/** The bar at the top of the bottom card; tapping it minimizes or restores the card. */
const sheetHandle = () => `<button class="sheet-handle-btn" data-action="toggle-sheet" aria-label="Minimize or expand"><span class="sheet-handle"></span></button>`;

function toggleSheet() {
  if (sheet.classList.contains("is-collapsed")) expandSheet();
  else collapseSheet();
}

function collapseSheet() {
  if (sheet.hidden || sheet.classList.contains("is-collapsed")) return;
  sheet.classList.add("is-collapsed");
  sheet.scrollTop = 0;
  sheet.setAttribute("aria-expanded", "false");
}

function expandSheet() {
  sheet.classList.remove("is-collapsed");
  sheet.setAttribute("aria-expanded", "true");
}

// MARK: - Walking route and ETA

const MAX_WALK_METERS = 20 * 1609.34;
const MAX_BIKE_METERS = 30 * 1609.34;
// Routes up to about three-quarters of a mile get a "Preview route" flyover.
const PREVIEW_MAX_METERS = 0.75 * 1609.34;

const previewLabel = () => `${icon("flyover")} Preview route`;

/** Adds (or removes) the flyover button under the route line. */
function setPreviewButton(show) {
  let button = document.querySelector(".preview-route");
  if (!show) { button?.remove(); return; }
  if (button) return;
  button = document.createElement("button");
  button.className = "btn btn-glass btn-block preview-route";
  button.dataset.action = "preview-route";
  button.innerHTML = previewLabel();
  document.querySelector("#route-line")?.after(button);
}

function previewRoute() {
  const map = state.map;
  const button = document.querySelector(".preview-route");
  if (!map || !button) return;
  if (map.isPreviewing) { map.stopPreview({ settle: true }); return; }
  map.previewPadding = sheetPadding();
  const started = map.previewRoute({
    onEnd: () => {
      const b = document.querySelector(".preview-route");
      if (b) { b.innerHTML = previewLabel(); b.classList.remove("is-playing"); }
      expandSheet();
    }
  });
  if (!started) return;
  trackEvent("route-preview", state.campus?.name, state.selected?.name);
  button.innerHTML = `${icon("close")} Stop preview`;
  button.classList.add("is-playing");
  collapseSheet();
}

function cancelRoute() {
  state.routeAbort?.abort();
  state.routeAbort = null;
  sheet.classList.remove("is-routing");
  state.map?.clearRoute();
}

function setRouteLine(text, mode = travelMode()) {
  const line = document.querySelector("#route-line .route-text");
  if (line) line.textContent = text;
  const glyph = document.querySelector("#route-line .route-icon");
  if (glyph) { glyph.innerHTML = icon(MODE_ICONS[mode] || "walk"); glyph.className = `route-icon is-${mode}`; }
}

function formatDuration(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr ${minutes % 60} min`;
}

function arrivalTime(seconds) {
  return new Date(Date.now() + seconds * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Routes from the user's position to `item` by the chosen mode, animates the
 * line to the destination, and puts the time and arrival in the place card.
 * If no routing server answers, a straight dashed line still shows the way.
 */
async function requestRoute(item) {
  if (!state.userPosition || state.selected !== item) return;
  cancelRoute();
  setPreviewButton(false);
  document.querySelector(".route-me")?.remove();
  const from = state.userPosition;
  const straight = distanceMeters(from, item);
  state.map?.showUser(from);
  if (state.campus.region && distanceMeters(from, state.campus.region.center) > 8000) state.map?.relaxLimits();

  // Too far to walk or bike: route it as a drive, without changing the person's choice.
  let mode = travelMode();
  const tooFarToWalk = (mode === "walk" && straight > MAX_WALK_METERS) || (mode === "bike" && straight > MAX_BIKE_METERS);
  const chosen = mode;
  if (tooFarToWalk) mode = "drive";
  const stepFree = mode === "walk" && store.stepFree;

  const controller = new AbortController();
  state.routeAbort = controller;
  state.routedItem = item;
  // Fit the route to the full card, then tuck the card away so the map shows while it loads.
  const padding = sheetPadding();
  // A short delay keeps instant (cached) routes from making the card flicker.
  const tuck = setTimeout(() => { collapseSheet(); sheet.classList.add("is-routing"); }, 150);
  controller.signal.addEventListener("abort", () => clearTimeout(tuck));
  const finish = () => { clearTimeout(tuck); sheet.classList.remove("is-routing"); expandSheet(); };
  trackEvent("route", mode);
  setRouteLine(`Finding a ${stepFree ? "step-free " : ""}${{ drive: "driving", bike: "biking", walk: "walking" }[mode]} route…`, mode);
  try {
    const route = await travelRoute(config, mode, from, item, controller.signal, { stepFree });
    if (controller.signal.aborted || state.selected !== item) return;
    const verb = { drive: "drive", bike: "by bike", walk: "walk" }[mode];
    const prefix = tooFarToWalk ? `Too far to ${chosen === "bike" ? "bike" : "walk"} · ` : stepFree ? (route.stepFree ? "Step-free · " : "No step-free route found · standard route · ") : "";
    setRouteLine(`${prefix}${formatDuration(route.seconds)} ${verb} · ${formatDistance(route.meters)} · arrive ${arrivalTime(route.seconds)}`, mode);
    state.map?.showRoute(route.coordinates, { mode, padding });
    finish();
    setPreviewButton(route.meters <= PREVIEW_MAX_METERS && route.coordinates.length > 1);
    record("route", {
      mode, meters: Math.round(route.meters / 50) * 50, minutes: Math.round(route.seconds / 60),
      dest: item.unnamed ? null : String(item.name).slice(0, 80), kind: String(item.categoryKey || item.kind || "").slice(0, 40),
      cell: cellOf(item), onCampus: isInsideCampus(item) ? 1 : 0
    });
  } catch (error) {
    if (controller.signal.aborted || state.selected !== item) return;
    console.warn("GradWay route:", error);
    const estimate = mode === "drive"
      ? `about ${Math.max(1, Math.round(straight * 1.3 / 11 / 60))} min drive`
      : mode === "bike" ? `about ${Math.max(1, Math.round(straight * 1.3 / 4.5 / 60))} min by bike`
      : `about ${walkMinutes(straight)} min walk`;
    setRouteLine(`Route servers didn't answer · ${formatDistance(straight)} straight line, ${estimate}`, mode);
    state.map?.showRoute([[from.lng, from.lat], [item.lng, item.lat]], { mode, straight: true, padding });
    finish();
  }
}

/** Asks for location (the browser shows its prompt once), then routes to the open place. */
async function routeFromMyLocation() {
  const item = state.selected;
  const button = document.querySelector(".route-me");
  if (button) { button.disabled = true; button.lastChild.textContent = " Finding you…"; }
  try {
    await locate();
    requestRoute(item);
  } catch {
    if (button) { button.disabled = false; button.lastChild.textContent = ` ${routeButtonLabel()}`; }
    showStatus("Location is off for this site. Allow it in your browser's settings to get a route.");
  }
}

/** If location was already allowed, find the user quietly when the map opens. */
async function locateIfAllowed() {
  if (state.userPosition && Date.now() - (state.userPositionAt || 0) < 60_000) return;
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" });
    if (status?.state !== "granted") return;
    await locate();
    state.map?.showUser(state.userPosition);
    if (state.selected && nearCampus()) requestRoute(state.selected);
  } catch { /* permissions API missing or location unavailable */ }
}

function closeSelection() {
  cancelRoute();
  if (state.results.length > 1) { showResultsList(); return; }
  state.selected = null;
  state.map?.select(null);
  sheet.hidden = true;
  sheet.innerHTML = "";
  showIdlePanel();
}

async function sharePlace() {
  const item = state.selected;
  if (!item) return;
  const url = directionsURL(item, false);
  try {
    if (navigator.share) await navigator.share({ title: item.name, text: `${item.name} at ${state.campus.name}`, url });
    else { await navigator.clipboard.writeText(url); showStatus("Directions link copied"); }
  } catch { /* the person closed the share sheet */ }
}

// MARK: - Clicks

function onClick(event) {
  const buffer = event.target.closest("[data-buffer]");
  if (buffer) {
    store.reminders = { ...store.reminders, buffer: +buffer.dataset.buffer };
    buffer.parentElement.querySelectorAll("[data-buffer]").forEach(b => { const on = b === buffer; b.classList.toggle("is-on", on); b.setAttribute("aria-checked", String(on)); });
    return;
  }
  if (event.target.closest("[data-waze]")) { trackEvent("waze", state.campus?.name); return; }
  const alertLink = event.target.closest("[data-alert-link]");
  if (alertLink) {
    trackEvent("alert-click", state.campus?.name, alertLink.dataset.alertLink);
    const shown = [...(state.alerts?.data?.all || []), ...(state.alerts?.data?.campuses?.[state.campus?.name] || [])].find(a => a.id === alertLink.dataset.alertLink);
    if (shown) record("action", { name: "alert-click", detail: String(shown.text).slice(0, 120) });
    return;
  }
  const dayButton = event.target.closest(".import-days [data-day]");
  if (dayButton && state.importDraft) {
    const c = state.importDraft.classes[+dayButton.closest(".import-item").dataset.i];
    const d = +dayButton.dataset.day;
    c.days = c.days.includes(d) ? c.days.filter(x => x !== d) : [...c.days, d].sort();
    dayButton.classList.toggle("is-on", c.days.includes(d));
    dayButton.setAttribute("aria-pressed", String(c.days.includes(d)));
    return;
  }
  const jumpTo = event.target.closest("[data-state-jump]");
  if (jumpTo) {
    event.preventDefault();
    document.getElementById(`state-${jumpTo.dataset.stateJump}`)?.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
    return;
  }
  const dealLink = event.target.closest("[data-deal-link]");
  if (dealLink) trackEvent("deal-click", state.campus?.name, dealLink.dataset.dealLink);
  const dealFilter = event.target.closest("[data-deal-filter]");
  if (dealFilter) { state.dealFilter = dealFilter.dataset.dealFilter; renderDeals(); return; }
  const target = event.target.closest("[data-action], [data-campus], [data-confirm], [data-result], [data-delete-class], [data-mode], [data-close-dialog], [data-travel], [data-look], [data-deal], [data-sponsor-link], [data-streetview], [data-lookup]");
  if (!target) return;
  if (target.dataset.lookup) { trackEvent("hours-lookup", state.campus?.name, state.selected?.name); return; }
  if (target.dataset.streetview) { trackEvent("street-view", state.campus?.name, state.selected?.name); return; }
  if (target.dataset.sponsorLink) { trackEvent("sponsor-click", state.campus?.name, target.dataset.sponsorLink); return; }
  if (target.dataset.travel) { setTravelMode(target.dataset.travel); return; }
  if (target.dataset.look) { setLook(target.dataset.look); return; }
  if (target.dataset.deal != null) {
    const deal = sponsorsFor(state.campus)[Number(target.dataset.deal)];
    if (deal) { trackEvent("sponsor-click", state.campus.name, deal.name); state.pendingDeal = sponsorPlace(deal, Number(target.dataset.deal)); go("#/map?deal=1"); }
    return;
  }

  if (target.dataset.campus) {
    const campus = state.campuses.find(c => c.name === target.dataset.campus);
    if (campus) go(state.campus?.name === campus.name ? "#/" : `#/confirm/${campus.slug}`);
    return;
  }
  if (target.dataset.confirm) {
    const campus = state.campuses.find(c => c.slug === target.dataset.confirm);
    if (campus) { applyCampus(campus); playArrival(campus); go("#/"); }
    return;
  }
  if (target.dataset.result) {
    const item = state.results.find(r => r.id === target.dataset.result);
    selectItem(item);
    return;
  }
  if (target.dataset.deleteClass) {
    store.classes = store.classes.filter(c => c.id !== target.dataset.deleteClass);
    rerender();
    return;
  }
  if (target.dataset.mode) {
    store.setMode(state.campus.name, target.dataset.mode);
    $("#mode-dialog").close();
    rerender();
    return;
  }
  if (target.hasAttribute("data-close-dialog")) {
    target.closest("dialog")?.close();
    return;
  }

  switch (target.dataset.action) {
    case "mode": openModeDialog(); break;
    case "safety": openSafetyDialog(); trackEvent("safety-open", state.campus?.name); break;
    case "share-location": shareLocation(); trackEvent("share-location", state.campus?.name); break;
    case "add-class": openClassDialog(); break;
    case "edit-class": openClassDialog(store.classes.find(c => c.id === target.dataset.id)); break;
    case "import-read": {
      const text = $("#import-text")?.value || "";
      if (text.trim()) readSchedule(text, "your pasted schedule");
      break;
    }
    case "import-reset": state.importDraft = null; renderImport(); break;
    case "import-save": saveImport(); break;
    case "toggle-notify": {
      const s = store.reminders;
      if (s.notify && Notification.permission === "granted") { store.reminders = { ...s, notify: false }; render(); break; }
      Notification.requestPermission().then(result => {
        store.reminders = { ...store.reminders, notify: result === "granted" };
        if (result === "granted") trackEvent("leave-notify-on", state.campus?.name);
        render();
      });
      break;
    }
    case "calendar-reminders": downloadCalendarReminders(target); break;
    case "tour": startTour(); break;
    case "step-free": {
      store.stepFree = !store.stepFree;
      target.classList.toggle("is-on", store.stepFree);
      target.setAttribute("aria-pressed", String(store.stepFree));
      target.querySelector(".step-free-state").textContent = store.stepFree ? "On" : "Off";
      document.querySelectorAll("[data-step-free]").forEach(box => { box.checked = store.stepFree; });
      trackEvent("step-free", store.stepFree ? "on" : "off");
      const item = state.selected;
      if (item) {
        document.querySelector(".directions-btn")?.setAttribute("href", directionsURL(item));
        if (nearCampus()) requestRoute(item);
      }
      break;
    }
    case "theme": {
      const next = store.theme === "light" ? "dark" : "light";
      store.theme = next;
      applyTheme(next, true);
      trackEvent("theme", next);
      break;
    }
    case "dismiss-alert": {
      const banner = target.closest("[data-alert]");
      if (!banner) break;
      store.dismissAlert(banner.dataset.alert);
      banner.classList.add("is-leaving");
      setTimeout(() => banner.remove(), reducedMotion.matches ? 0 : 220);
      break;
    }
    case "dismiss-install": store.installDismissed = true; target.closest(".install")?.remove(); break;
    case "install":
      state.installPrompt?.prompt();
      state.installPrompt?.userChoice.finally(() => { state.installPrompt = null; render(); });
      break;
    case "back-to-list": cancelRoute(); showResultsList(); break;
    case "toggle-sheet": toggleSheet(); break;
    case "route-me": routeFromMyLocation(); break;
    case "close-selection": closeSelection(); break;
    case "preview-route": previewRoute(); break;
    case "share-place": sharePlace(); break;
    case "reload": location.reload(); break;
    case "close-dialog": target.closest("dialog")?.close(); break;
  }
}

document.addEventListener("submit", event => {
  const form = event.target;
  if (form.dataset.form === "dash-search") {
    event.preventDefault();
    const query = form.elements.q.value.trim();
    if (query) go(`#/map?q=${encodeURIComponent(query)}`);
  }
  if (form.dataset.form === "class") {
    if (event.submitter?.value === "cancel") return;
    if (!saveClass(form)) { event.preventDefault(); return; }
    setTimeout(rerender, 0);
  }
});

// Close a dialog when its backdrop is tapped.
document.querySelectorAll("dialog").forEach(dialog => {
  dialog.addEventListener("click", event => {
    if (event.target === dialog && dialog.id !== "mode-dialog") dialog.close();
  });
});

window.GradWay = state; // handy in the browser console when testing
boot();
