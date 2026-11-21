// GradWay for the web: campus picker, student/visitor dashboard, schedule,
// building directory and a campus map with the app's search behaviour.

import { loadCampuses, resolveBuildings, regionAround, formatDistance, walkMinutes, distanceMeters } from "./data.js";
import { runSearch, sortByDistance, bestNameMatch, prefetchCampus, CATEGORIES, QUICK_CATEGORIES, DETAIL_LAYERS } from "./search.js";
import { CampusMap, MAP_STYLES, escapeHTML as h } from "./map.js";
import { currentWeather } from "./weather.js";
import { travelRoute } from "./route.js";
import { store } from "./store.js";
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
  view.innerHTML = `<div class="loading" role="status"><div class="spinner"></div><p>Loading campuses…</p></div>`;
  const [{ campuses, isSample }] = await Promise.all([loadCampuses(config), loadSponsors()]);
  state.campuses = campuses;
  state.isSample = isSample;
  const saved = campuses.find(c => c.name === store.campusName);
  if (saved) applyCampus(saved);

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
    sponsored: true
  };
}

function transition(update) {
  if (document.startViewTransition && !reducedMotion.matches) document.startViewTransition(update);
  else update();
}

function applyCampus(campus) {
  state.campus = campus;
  store.campusName = campus.name;
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

function render() {
  const route = parseRoute();

  // Campus deep link: #/c/mississippi-state-university
  if (route.name === "c") {
    const campus = state.campuses.find(c => c.slug === route.arg);
    if (campus) { applyCampus(campus); history.replaceState(null, "", "#/"); return render(); }
    history.replaceState(null, "", "#/campuses");
    return render();
  }

  if (!state.campus && route.name !== "campuses" && route.name !== "welcome") {
    history.replaceState(null, "", "#/welcome");
    return render();
  }
  if (state.campus && route.name === "welcome") {
    history.replaceState(null, "", "#/");
    return render();
  }

  document.body.dataset.route = route.name;
  const showsMap = route.name === "map" || (desktop.matches && state.campus);
  mapPane.hidden = !showsMap;
  document.body.classList.toggle("no-map", !showsMap);

  // The list the person came from (dashboard, buildings, classes) stays where it was:
  // beside the map on a wide screen, and one tap back on a phone.
  const renderers = { dashboard: renderDashboard, campuses: renderCampuses, schedule: renderSchedule, buildings: renderBuildings, welcome: renderWelcome };
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
    walk: Boolean(next.building)
  };
}

function linkRow(item, index, count) {
  const pos = count === 1 ? "only" : index === 0 ? "first" : index === count - 1 ? "last" : "middle";
  return `<a class="row row-${pos}" href="${h(item.url)}" target="_blank" rel="noopener">
    <span class="row-icon">${icon(item.icon)}</span><span class="row-title">${h(item.title)}</span>${icon("chevronRight", "row-chevron")}
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

  const academic = (visitor
    ? [["University Website", "globe", links.website], ["Academic Calendar", "calendar", links.academic], ["Bookstore", "book", links.bookstore]]
    : [["Student Portal", "portal", links.student], ["Academic Calendar", "calendar", links.academic], ["Bookstore", "book", links.bookstore]]
  ).filter(([, , url]) => url).map(([title, iconName, url]) => ({ title, icon: iconName, url }));

  const tiles = [["Dining", "food", links.dining], ["Events", "events", links.events], ["Public Safety", "shield", links.emergency], ["Sports", "sports", links.sports]]
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
    </header>
    <div class="header-actions">
      <button class="pill" data-action="mode">${icon(visitor ? "visitor" : "student")} ${visitor ? "Visiting" : "Student"}</button>
      <a class="pill" href="#/campuses">${icon("swap")} Change campus</a>
      <span class="pill weather-pill" id="weather-pill" hidden></span>
    </div>

    <a class="card glass next-card" href="${next.href}" ${next.walk ? `aria-label="${h(next.eyebrow)}. ${h(next.text)}. Walk there"` : ""}>
      <span><span class="eyebrow">${h(next.eyebrow)}</span><span class="next-text">${h(next.text)}</span></span>
      ${next.walk ? `<span class="walk-glyph">${icon("walk")}</span>` : next.add ? `<span class="walk-glyph">${icon("plus")}</span>` : ""}
    </a>

    <form class="dash-search glass" data-form="dash-search" role="search">
      ${icon("search")}
      <input name="q" type="search" enterkeyhint="search" autocomplete="off" placeholder="Search buildings, ATMs, coffee…" aria-label="Search ${h(campus.name)}">
    </form>
    <div class="chips" role="list">
      ${QUICK_CATEGORIES.map(key => `<a class="chip" role="listitem" href="#/map?cat=${key}">${icon(CATEGORIES[key].icon)}${CATEGORIES[key].label}</a>`).join("")}
    </div>

    ${state.isSample ? `<p class="notice">Preview data: the live campus list couldn't be reached, so two sample campuses are showing.</p>` : ""}

    ${installCard()}

    ${dealsSection(campus)}

    ${section(visitor ? "Campus Info" : "Academic", academic.length ? `<div class="rows">${academic.map((item, i) => linkRow(item, i, academic.length)).join("")}</div>` : "")}

    ${section("Campus", tiles.length ? `<div class="grid">${tiles.map(([title, iconName, url]) => `
      <a class="tile glass" href="${h(url)}" target="_blank" rel="noopener"><span class="tile-icon">${icon(iconName)}</span><span>${title}</span></a>`).join("")}</div>` : "")}

    ${section("", buildingCount ? `<a class="card glass building-card" href="#/buildings">
        <span class="row-icon">${icon("building")}</span>
        <span><span class="card-title">Buildings</span><span class="muted">${buildingCount} on the ${h(campus.name)} directory</span></span>
        ${icon("chevronRight", "row-chevron")}</a>` : "")}

    ${section("News", links.news ? `<a class="card news-card" href="${h(links.news)}" target="_blank" rel="noopener">
        <span class="eyebrow accent">Campus News</span>
        <span class="news-headline">See the latest from ${h(campus.name)}</span>
        <span class="muted">${h(new URL(links.news).hostname.replace(/^www\./, ""))}</span></a>` : "")}

    ${section(visitor ? "Help" : "Student Help", `<div class="rows">
      ${!visitor ? `<a class="row row-first" href="#/schedule"><span class="row-icon">${icon("clock")}</span><span class="row-title">My classes</span>${icon("chevronRight", "row-chevron")}</a>` : ""}
      <button class="row ${visitor ? "row-first" : "row-middle"}" data-action="safety"><span class="row-icon">${icon("help")}</span><span class="row-title">Safety &amp; Emergency</span>${icon("chevronRight", "row-chevron")}</button>
      <a class="row row-last" href="${h(config.feedbackURL)}" target="_blank" rel="noopener"><span class="row-icon">${icon("feedback")}</span><span class="row-title">Send feedback</span>${icon("chevronRight", "row-chevron")}</a>
    </div>`)}

    ${section("Follow", socials.length ? `<div class="chips">${socials.map(([title, iconName, url]) => `<a class="chip" href="${h(url)}" target="_blank" rel="noopener">${icon(iconName)}${title}</a>`).join("")}</div>` : "")}

    ${footer()}
  `;
  showWeather();
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
    <p>© ${new Date().getFullYear()} Oakland Software Co. · Not affiliated with any university.</p>
    <p>Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · Imagery: USGS · Weather: National Weather Service</p>
    ${config.advertiseURL ? `<p><a href="${h(config.advertiseURL)}" target="_blank" rel="noopener">Advertise on GradWay</a></p>` : ""}
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
    <div class="campus-list" id="campus-list">
      ${state.campuses.length ? state.campuses.map(c => `
        <button class="campus-row ${current?.name === c.name ? "is-current" : ""}" data-campus="${h(c.name)}" data-search="${h(c.name.toLowerCase())}">
          ${badge(c, "small")}<span>${h(c.name)}</span>${current?.name === c.name ? `<span class="tag">Current</span>` : icon("chevronRight", "row-chevron")}
        </button>`).join("") : `<div class="empty"><p>Campuses couldn't load. Check your connection and try again.</p><button class="btn btn-gold" data-action="reload">Try again</button></div>`}
    </div>
    <p class="muted center small" id="campus-none" hidden>No campus matches. GradWay adds new campuses every semester.</p>
    </div>
    </div>
    ${footer()}
  `;
  const filter = $("#campus-filter");
  filter.addEventListener("input", () => {
    const term = filter.value.trim().toLowerCase();
    let shown = 0;
    document.querySelectorAll(".campus-row").forEach(row => {
      const match = !term || row.dataset.search.includes(term);
      row.hidden = !match;
      if (match) shown++;
    });
    $("#campus-none").hidden = shown > 0;
  });
}

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
      <button class="btn btn-gold btn-small" data-action="add-class">${icon("plus")} Add</button>
    </header>
    ${days.length ? days.map(group => `
      <section class="section">
        <h2 class="section-title">${DAY_NAMES[group.day]}</h2>
        <div class="rows">${group.items.map((c, i) => `
          <div class="row class-row row-${group.items.length === 1 ? "only" : i === 0 ? "first" : i === group.items.length - 1 ? "last" : "middle"}">
            <span class="class-time">${formatTime(c.time)}</span>
            <a class="class-main" href="${c.building ? `#/map?q=${encodeURIComponent(c.building)}&exact=1` : "#/schedule"}">
              <span class="row-title">${h(c.name)}</span>
              <span class="muted small">${c.building ? `${icon("walk")} ${h(c.building)}` : "No building yet"}</span>
            </a>
            <button class="icon-btn subtle" data-delete-class="${h(c.id)}" aria-label="Delete ${h(c.name)}">${icon("trash")}</button>
          </div>`).join("")}</div>
      </section>`).join("") : `
      <div class="empty card glass">
        <p class="card-title">Add your first class</p>
        <p class="muted">Your next class shows on the dashboard. Tap it to see the building on the map.</p>
        <button class="btn btn-gold" data-action="add-class">${icon("plus")} Add a class</button>
      </div>`}
    <p class="muted small center">Classes are saved in this browser only.</p>
  `;
}

function openClassDialog() {
  const dialog = $("#class-dialog");
  const form = dialog.querySelector("form");
  form.reset();
  $("#building-options").innerHTML = state.campus.buildings.map(b => `<option value="${h(b)}">`).join("");
  dialog.showModal();
  form.elements.name.focus();
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
  const entry = { id: crypto.randomUUID?.() ?? String(Date.now()), name, building: String(data.get("building") || "").trim(), days, time };
  store.classes = [...store.classes, entry];
  error.hidden = true;
  return true;
}

// MARK: - Buildings

function renderBuildings() {
  const campus = state.campus;
  view.innerHTML = `
    <header class="page-header">
      <a class="icon-btn" href="#/" aria-label="Back">${icon("chevronLeft")}</a>
      <div><p class="eyebrow accent">${h(campus.name)}</p><h1 class="page-title">Buildings</h1></div>
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

const LOOK_LABELS = { dark: "Dark", light: "Light", satellite: "Satellite" };

function buildLayersPanel() {
  const look = MAP_STYLES.includes(store.mapLook) ? store.mapLook : "dark";
  const on = new Set(store.mapDetails);
  $("#map-layers-panel").innerHTML = `
    <p class="eyebrow">Map style</p>
    <div class="look-toggle" role="radiogroup" aria-label="Map style">
      ${MAP_STYLES.map(name => `<button role="radio" aria-checked="${name === look}" class="look-${name} ${name === look ? "is-on" : ""}" data-look="${name}"><span class="look-swatch"></span>${LOOK_LABELS[name]}</button>`).join("")}
    </div>
    <p class="eyebrow">Show on map</p>
    <div class="detail-toggles">
      ${Object.entries(DETAIL_LAYERS).map(([key, d]) => `
        <label class="detail-toggle"><input type="checkbox" data-detail="${key}" ${on.has(key) ? "checked" : ""}>
          <span class="detail-dot detail-${key}">${icon(d.icon)}</span><span>${d.label}</span><span class="muted small detail-count" data-count="${key}"></span></label>`).join("")}
    </div>
    <p class="muted small layers-note">Details come from OpenStreetMap and may be incomplete on some campuses.</p>`;
  $("#map-layers-panel").addEventListener("change", event => {
    const key = event.target.dataset.detail;
    if (!key) return;
    const set = new Set(store.mapDetails);
    event.target.checked ? set.add(key) : set.delete(key);
    store.mapDetails = [...set];
    applyOverlays();
  });
}

function setLook(name) {
  store.mapLook = name;
  document.querySelectorAll("[data-look]").forEach(b => {
    const on = b.dataset.look === name;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-checked", String(on));
  });
  state.map?.setStyleName(name);
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

const prefetchReady = campus => { try { return Boolean(localStorage.getItem(`gradway.cache.poi.${campus.region.center.lat.toFixed(4)},${campus.region.center.lng.toFixed(4)}`)); } catch { return false; } };

async function ensureMap() {
  if (!state.map) {
    state.map = new CampusMap($("#map"), config);
    state.map.styleName = MAP_STYLES.includes(store.mapLook) ? store.mapLook : "dark";
    await state.map.ready;
    if (state.map.styleName !== "dark") await state.map.setStyleName(state.map.styleName);
    if (state.campus) state.map.setCampus(state.campus);
    applyOverlays();
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
  const generation = ++state.searchGeneration;
  const controller = new AbortController();
  state.searchAbort = controller;
  showStatus("Searching…");

  let result;
  try {
    result = await runSearch(config, {
      query, categoryKey, campusRegion: campus.region, isExactLookup: exact, signal: controller.signal,
      onWidening: () => { if (generation === state.searchGeneration) showStatus("Searching a wider area…"); }
    });
  } catch (error) {
    if (error?.name === "AbortError" || generation !== state.searchGeneration) return;
    console.warn("GradWay search:", error);
    showStatus("Search isn't responding right now. Try again in a moment.");
    return;
  }
  if (generation !== state.searchGeneration) return;

  const { items, expandedToMiles, searchedMaxMiles } = result;
  const reference = state.userPosition || campus.region.center;
  let sorted = sortByDistance(items, reference);
  if (categoryKey) {
    const promos = sponsorsFor(campus).map(sponsorPlace).filter((p, i) => sponsorsFor(campus)[i].category === categoryKey);
    if (promos.length) {
      const names = new Set(promos.map(p => p.name.toLowerCase()));
      sorted = [...sortByDistance(promos, reference), ...sorted.filter(i => !names.has(i.name.toLowerCase()))];
    }
  }
  state.results = sorted;
  state.map?.setPins(sorted, selectItem);

  if (exact && sorted.length) {
    const match = bestNameMatch(sorted, query);
    showStatus("");
    selectItem(match, { zoomMeters: 1000 });
    return;
  }

  if (expandedToMiles) state.map?.relaxLimits();
  const expandedNote = expandedToMiles ? `Nothing on campus · within ${expandedToMiles} mi` : null;

  switch (sorted.length) {
    case 0:
      showStatus(searchedMaxMiles ? `Nothing found within ${searchedMaxMiles} mi` : "Try a different search");
      state.map?.setRegion(regionAround(campus.region.center, 2500));
      break;
    case 1:
      showStatus(expandedNote || "");
      selectItem(sorted[0], { zoomMeters: 1000 });
      break;
    default:
      showStatus(expandedNote ? `${expandedNote} · pick from the list` : `${desktop.matches ? "Zoom" : "Pinch"} to explore, or pick from the list`);
      showResultsList();
      if (expandedToMiles) state.map?.fitItems(sorted, sheetPadding());
      else state.map?.setRegion(regionAround(campus.region.center, 2200), sheetPadding());
  }
}

function distanceLine(item) {
  const fromUser = Boolean(state.userPosition);
  const meters = item.distance ?? distanceMeters(item, state.userPosition || state.campus.region.center);
  return `${formatDistance(meters)} ${fromUser ? "away" : "from campus center"} · about ${walkMinutes(meters)} min walk`;
}

function showResultsList() {
  const items = state.results;
  sheet.hidden = false;
  sheet.innerHTML = `
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="sheet-head"><p class="sheet-title">${items.length} places</p><p class="muted small">Closest first</p></div>
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
  return apple
    ? `https://maps.apple.com/?daddr=${item.lat},${item.lng}&dirflg=${mode === "drive" ? "d" : "w"}`
    : `https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lng}&travelmode=${mode === "drive" ? "driving" : "walking"}`;
}

const travelMode = () => (store.travelMode === "drive" ? "drive" : "walk");

function travelToggle() {
  const mode = travelMode();
  return `<div class="travel-toggle" role="radiogroup" aria-label="Route type">
    <button role="radio" aria-checked="${mode === "walk"}" class="${mode === "walk" ? "is-on" : ""}" data-travel="walk">${icon("walk")} Walk</button>
    <button role="radio" aria-checked="${mode === "drive"}" class="${mode === "drive" ? "is-on" : ""}" data-travel="drive">${icon("car")} Drive</button>
  </div>`;
}

function setTravelMode(mode) {
  store.travelMode = mode;
  document.querySelectorAll(".travel-toggle [data-travel]").forEach(b => {
    const on = b.dataset.travel === mode;
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-checked", String(on));
  });
  const item = state.selected;
  if (!item) return;
  document.querySelector(".directions-btn")?.setAttribute("href", directionsURL(item));
  document.querySelector(".alt-maps")?.setAttribute("href", directionsURL(item, !isIOS));
  const routeMe = document.querySelector(".route-me");
  if (routeMe) routeMe.lastChild.textContent = ` ${mode === "drive" ? "Driving" : "Walking"} route from my location`;
  if (state.userPosition) requestRoute(item);
}

function selectItem(item, { zoomMeters } = {}) {
  if (!item) return;
  state.selected = item;
  state.map?.select(item);
  const hasList = state.results.length > 1;
  sheet.hidden = false;
  sheet.innerHTML = `
    <div class="sheet-handle" aria-hidden="true"></div>
    <div class="detail">
      <div class="detail-head">
        ${hasList ? `<button class="icon-btn subtle" data-action="back-to-list" aria-label="Back to the list">${icon("chevronLeft")}</button>` : ""}
        <div class="detail-titles">
          <p class="eyebrow accent">${h(item.kind || "Place")}</p>
          <h2 class="detail-name">${h(item.name)}</h2>
          ${item.address ? `<p class="muted small">${h(item.address)}</p>` : ""}
          ${item.offer ? `<p class="deal-offer">${icon("tag")} ${h(item.offer)}</p>` : ""}
          ${item.url ? `<a class="muted small alt-maps" href="${h(item.url)}" target="_blank" rel="noopener sponsored">Visit website</a>` : ""}
        </div>
        <button class="icon-btn subtle" data-action="close-selection" aria-label="Close">${icon("close")}</button>
      </div>
      ${travelToggle()}
      <p class="detail-distance" id="route-line" aria-live="polite"><span class="route-icon ${travelMode() === "drive" ? "is-drive" : ""}">${icon(travelMode() === "drive" ? "car" : "walk")}</span> <span class="route-text">${distanceLine(item)}</span></p>
      ${state.userPosition ? "" : `<button class="btn btn-glass btn-block route-me" data-action="route-me">${icon("locate")} ${travelMode() === "drive" ? "Driving" : "Walking"} route from my location</button>`}
      <div class="detail-actions">
        <a class="btn btn-gold directions-btn" href="${directionsURL(item)}" target="_blank" rel="noopener">${icon("directions")} Directions</a>
        <button class="btn btn-glass" data-action="share-place">${icon("share")} Share</button>
      </div>
      <a class="muted small alt-maps" href="${directionsURL(item, !isIOS)}" target="_blank" rel="noopener">Open in ${isIOS ? "Google Maps" : "Apple Maps"}</a>
    </div>`;
  const region = regionAround(item, zoomMeters || 700);
  cancelRoute();
  if (state.userPosition) requestRoute(item);
  else requestAnimationFrame(() => state.map?.setRegion(region, sheetPadding()));
}

// MARK: - Walking route and ETA

const MAX_WALK_METERS = 20 * 1609.34;

function cancelRoute() {
  state.routeAbort?.abort();
  state.routeAbort = null;
  state.map?.clearRoute();
}

function setRouteLine(text, mode = travelMode()) {
  const line = document.querySelector("#route-line .route-text");
  if (line) line.textContent = text;
  const glyph = document.querySelector("#route-line .route-icon");
  if (glyph) { glyph.innerHTML = icon(mode === "drive" ? "car" : "walk"); glyph.classList.toggle("is-drive", mode === "drive"); }
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
  document.querySelector(".route-me")?.remove();
  const from = state.userPosition;
  const straight = distanceMeters(from, item);
  state.map?.showUser(from);
  if (state.campus.region && distanceMeters(from, state.campus.region.center) > 8000) state.map?.relaxLimits();

  // Too far to walk: route it as a drive, without changing the person's choice.
  let mode = travelMode();
  const tooFarToWalk = mode === "walk" && straight > MAX_WALK_METERS;
  if (tooFarToWalk) mode = "drive";

  const controller = new AbortController();
  state.routeAbort = controller;
  setRouteLine(`Finding a ${mode === "drive" ? "driving" : "walking"} route…`, mode);
  try {
    const route = await travelRoute(config, mode, from, item, controller.signal);
    if (controller.signal.aborted || state.selected !== item) return;
    const verb = mode === "drive" ? "drive" : "walk";
    setRouteLine(`${tooFarToWalk ? "Too far to walk · " : ""}${formatDuration(route.seconds)} ${verb} · ${formatDistance(route.meters)} · arrive ${arrivalTime(route.seconds)}`, mode);
    state.map?.showRoute(route.coordinates, { mode, padding: sheetPadding() });
  } catch (error) {
    if (controller.signal.aborted || state.selected !== item) return;
    console.warn("GradWay route:", error);
    const estimate = mode === "drive"
      ? `about ${Math.max(1, Math.round(straight * 1.3 / 11 / 60))} min drive`
      : `about ${walkMinutes(straight)} min walk`;
    setRouteLine(`Route servers didn't answer · ${formatDistance(straight)} straight line, ${estimate}`, mode);
    state.map?.showRoute([[from.lng, from.lat], [item.lng, item.lat]], { mode, straight: true, padding: sheetPadding() });
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
    if (button) { button.disabled = false; button.lastChild.textContent = ` ${travelMode() === "drive" ? "Driving" : "Walking"} route from my location`; }
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
    if (state.selected) requestRoute(state.selected);
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
  const target = event.target.closest("[data-action], [data-campus], [data-result], [data-delete-class], [data-mode], [data-close-dialog], [data-travel], [data-look], [data-deal]");
  if (!target) return;
  if (target.dataset.travel) { setTravelMode(target.dataset.travel); return; }
  if (target.dataset.look) { setLook(target.dataset.look); return; }
  if (target.dataset.deal != null) {
    const deal = sponsorsFor(state.campus)[Number(target.dataset.deal)];
    if (deal) { state.pendingDeal = sponsorPlace(deal, Number(target.dataset.deal)); go("#/map?deal=1"); }
    return;
  }

  if (target.dataset.campus) {
    const campus = state.campuses.find(c => c.name === target.dataset.campus);
    if (campus) { applyCampus(campus); go("#/"); }
    return;
  }
  if (target.dataset.result) {
    const item = state.results.find(r => r.id === target.dataset.result);
    selectItem(item);
    return;
  }
  if (target.dataset.deleteClass) {
    store.classes = store.classes.filter(c => c.id !== target.dataset.deleteClass);
    render();
    return;
  }
  if (target.dataset.mode) {
    store.setMode(state.campus.name, target.dataset.mode);
    $("#mode-dialog").close();
    state.lastSearchKey = null;
    render();
    return;
  }
  if (target.hasAttribute("data-close-dialog")) {
    target.closest("dialog")?.close();
    return;
  }

  switch (target.dataset.action) {
    case "mode": openModeDialog(); break;
    case "safety": openSafetyDialog(); break;
    case "share-location": shareLocation(); break;
    case "add-class": openClassDialog(); break;
    case "dismiss-install": store.installDismissed = true; target.closest(".install")?.remove(); break;
    case "install":
      state.installPrompt?.prompt();
      state.installPrompt?.userChoice.finally(() => { state.installPrompt = null; render(); });
      break;
    case "back-to-list": cancelRoute(); showResultsList(); break;
    case "route-me": routeFromMyLocation(); break;
    case "close-selection": closeSelection(); break;
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
    setTimeout(render, 0);
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
