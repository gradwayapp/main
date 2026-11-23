// "How GradWay works": a story-style walkthrough (tap through, like Instagram
// stories) shown once after someone picks their first campus, and any time from
// the dashboard. Each page has a small animated scene drawn in HTML and SVG, so
// it loads instantly and works offline.
//
// Tap the right side (or →) for next, the left side (or ←) for back, press and
// hold to pause, swipe down or Esc to close.

import { icon } from "./icons.js";

const PAGE_MS = 7000;
const h = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** A small stylized campus map for the scenes. */
function miniMap(inner = "") {
  return `<svg class="tour-map" viewBox="0 0 320 240" aria-hidden="true">
    <rect width="320" height="240" rx="18" fill="var(--t-land)"/>
    <ellipse cx="160" cy="122" rx="70" ry="34" fill="var(--t-green)"/>
    <g fill="none" stroke="var(--t-road)" stroke-linecap="round">
      <path d="M-10 40 C 90 34, 210 48, 330 36" stroke-width="12"/>
      <path d="M-10 206 C 100 214, 220 200, 330 210" stroke-width="12"/>
      <path d="M46 -10 C 52 80, 40 160, 54 250" stroke-width="12"/>
      <path d="M272 -10 C 264 90, 282 170, 268 250" stroke-width="12"/>
      <path d="M54 122 L 268 120" stroke-width="7"/>
      <path d="M160 40 L 162 206" stroke-width="7"/>
    </g>
    <g fill="var(--t-bldg)" stroke="var(--t-bldg-line)" stroke-width="1.2">
      <rect x="70" y="58" width="56" height="34" rx="5"/><rect x="190" y="56" width="62" height="38" rx="5"/>
      <rect x="72" y="152" width="50" height="40" rx="5"/><rect x="196" y="150" width="56" height="42" rx="5"/>
      <rect x="132" y="60" width="18" height="26" rx="4"/><rect x="132" y="160" width="18" height="30" rx="4"/>
    </g>
    ${inner}
  </svg>`;
}

const pin = (x, y, cls = "", glyph = "") => `<g class="tour-pin ${cls}" transform="translate(${x} ${y})"><circle r="9" fill="var(--t-pin)" stroke="#fff" stroke-width="2.5"/>${glyph}</g>`;

function pages(campus, visitor) {
  const initials = campus.initials || campus.name.split(/\s+/).map(w => w[0]).join("").slice(0, 3);
  return [
    {
      eyebrow: `Welcome to ${campus.name}`,
      title: "Your campus, in your pocket",
      body: "Buildings, food, parking, walking routes and your classes, all in one place. Here's a quick tour.",
      scene: `<div class="scene scene-welcome">
        <div class="orbit">${["library", "coffee", "parking", "walk", "calendar", "shield"].map((ic, i) => `<span class="orbit-icon" style="--i:${i}">${icon(ic)}</span>`).join("")}</div>
        <span class="tour-badge">${h(initials)}</span></div>`
    },
    {
      eyebrow: "Search",
      title: "Find any building in seconds",
      body: "Type a building, a class building or a place. GradWay searches your campus first, so you get the building on your campus, not one across town.",
      scene: `<div class="scene scene-search">
        <div class="fake-search">${icon("search")}<span class="typing" data-text="Mitchell Library"></span><span class="caret"></span></div>
        ${miniMap(`${pin(98, 75, "drop d1")}${pin(222, 74, "drop d2 dim")}${pin(98, 170, "drop d3 dim")}<g class="tour-label"><rect x="112" y="58" width="104" height="22" rx="11" fill="#fff"/><text x="122" y="73" font-size="11" font-weight="700" fill="#18203a">Mitchell Library</text></g>`)}
      </div>`
    },
    {
      eyebrow: "Quick searches",
      title: "Coffee, food or parking? One tap",
      body: "Quick buttons find what's nearby: on campus first, then up to 6 miles out, with hours and phone numbers.",
      scene: `<div class="scene scene-chips">
        <div class="fake-chips">${[["coffee", "Coffee"], ["food", "Food"], ["parking", "Parking"], ["atm", "ATM"]].map(([ic, t], i) => `<span class="fake-chip" style="--i:${i}">${icon(ic)}${t}</span>`).join("")}</div>
        ${miniMap([[84, 106], [210, 100], [150, 146], [236, 176], [70, 186], [120, 40]].map(([x, y], i) => pin(x, y, `pop p${i}`)).join(""))}
      </div>`
    },
    {
      eyebrow: "Routes",
      title: "Walk there with a live route",
      body: "Tap a place to see the way from where you are, how long it takes and when you'll arrive. Switch between walking and driving.",
      scene: `<div class="scene scene-route">
        ${miniMap(`<path class="route-line" d="M66 196 C 66 150, 100 130, 160 122 S 250 100, 226 72" fill="none" stroke="var(--t-route)" stroke-width="6" stroke-linecap="round" stroke-dasharray="1 11"/>
          <circle cx="66" cy="196" r="8" fill="var(--t-route)" stroke="#fff" stroke-width="3"/>${pin(226, 72, "drop d1")}`)}
        <div class="fake-eta"><span class="fake-toggle"><b>${icon("walk")} Walk</b><span>${icon("car")} Drive</span></span><span><b>7 min</b> · 0.4 mi · arrive 1:41 PM</span></div>
      </div>`
    },
    {
      eyebrow: "Preview",
      title: "Fly over the route before you go",
      body: "On short walks, Preview route tilts the map and follows the path, turn by turn. Street View shows the building from outside.",
      scene: `<div class="scene scene-flyover">
        <div class="tilt">${miniMap(`<path d="M66 196 C 66 150, 100 130, 160 122 S 250 100, 226 72" fill="none" stroke="var(--t-route)" stroke-width="6" stroke-linecap="round"/>`)}<span class="flyer">${icon("walk")}</span></div>
        <div class="fake-buttons"><span>${icon("flyover")} Preview route</span><span>${icon("streetview")} Street View</span></div>
      </div>`
    },
    visitor ? {
      eyebrow: "Visiting",
      title: "Parking and info for visitors",
      body: "As a visitor, GradWay puts parking and the university's info first. Switch to Student anytime from the dashboard.",
      scene: `<div class="scene scene-visitor">
        ${miniMap(`<rect class="lot lot1" x="62" y="96" width="44" height="40" rx="6"/><rect class="lot lot2" x="214" y="98" width="44" height="40" rx="6"/>${pin(84, 116, "drop d1")}`)}
        <div class="fake-card"><span class="eyebrow">Visiting</span><b>Find parking</b><span class="muted">Visitor Lot · 4 min walk</span></div>
      </div>`
    } : {
      eyebrow: "Your classes",
      title: "Know when to leave for class",
      body: "Import your schedule from your student portal. Your next class shows on the dashboard with a leave-by countdown and optional reminders.",
      scene: `<div class="scene scene-class">
        <div class="fake-card class-card"><span class="eyebrow">Next class</span><b>BIO 1134 · 2:00 PM</b>
          <span class="countdown">${icon("clock")} Leave in <span class="tick">12</span> min · 8 min walk</span></div>
        <div class="fake-buttons"><span>${icon("calendar")} Import schedule</span><span class="ring-bell">${icon("bell")} Remind me</span></div>
      </div>`
    },
    {
      eyebrow: "Places",
      title: "Tap anything on the map",
      body: "Cafés, restaurants and landmarks on the map open a card with hours, phone, directions and Street View.",
      scene: `<div class="scene scene-place">
        ${miniMap(`${pin(204, 84, "drop d1")}<circle class="tap" cx="204" cy="84" r="16" fill="none" stroke="#fff" stroke-width="2"/>`)}
        <div class="fake-sheet"><span class="eyebrow">Café</span><b>Campus Coffee</b><span class="open-now">Open until 9 PM</span><span class="sheet-row"><span>${icon("phone")} Call</span><span>${icon("directions")} Directions</span></span></div>
      </div>`
    },
    {
      eyebrow: "Stay in the loop",
      title: "Campus alerts and safety",
      body: "Important news shows at the top of your dashboard, like deadlines and closures. Safety & Emergency is always one tap away.",
      scene: `<div class="scene scene-alerts">
        <div class="fake-alert">${icon("calendar")}<span><small>Deadline</small><b>Last day to drop a class is Friday</b></span></div>
        <div class="fake-safety"><span class="sos">${icon("phone")} Call 911</span><span>${icon("shield")} Campus safety</span><span>${icon("pin")} Share my location</span></div>
      </div>`
    },
    {
      eyebrow: "Make it yours",
      title: "You're all set",
      body: "Switch between light and dark with the sun and moon button, pick a map style, and save your classes. Replay this tour anytime from the dashboard.",
      scene: `<div class="scene scene-done">
        <span class="swap-theme"><span class="sun">${icon("sun")}</span><span class="moon">${icon("moon")}</span></span>
        <div class="style-dots"><span class="s1"></span><span class="s2"></span><span class="s3"></span><span class="s4"></span></div>
      </div>`,
      last: true
    }
  ];
}

/**
 * Shows the walkthrough. Resolves when it closes, with how far they got.
 * options: { campus, visitor, reducedMotion: boolean, track(event, detail) }
 */
export function playTour({ campus, visitor = false, reducedMotion = false, track = () => {} }) {
  return new Promise(resolve => {
    const list = pages(campus, visitor);
    let index = 0, timer = null, startedAt = 0, elapsed = 0, paused = false, holding = null;
    const opener = document.activeElement;
    const root = document.createElement("div");
    root.className = `tour${reducedMotion ? " is-still" : ""}`;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "How GradWay works");
    root.style.cssText = `--campus:${campus.theme};--campus-rgb:${campus.themeRGB};--accent:${campus.accent}`;
    root.innerHTML = `
      <div class="tour-story">
        <div class="tour-bars">${list.map(() => `<span class="tour-bar"><i></i></span>`).join("")}</div>
        <div class="tour-top">
          <span class="tour-brand"><img src="icons/icon-192.png" alt="">GradWay</span>
          <button class="tour-pause" type="button" aria-label="Pause">${icon("pause")}</button>
          <button class="tour-close" type="button" aria-label="Close the tour">${icon("close")}</button>
        </div>
        <div class="tour-stage" aria-hidden="true"></div>
        <div class="tour-copy" aria-live="polite"></div>
        <div class="tour-nav">
          <button class="tour-prev" type="button" aria-label="Previous">${icon("chevronLeft")}</button>
          <button class="btn btn-gold tour-next" type="button"></button>
        </div>
        <button class="tour-zone left" type="button" tabindex="-1" aria-hidden="true"></button>
        <button class="tour-zone right" type="button" tabindex="-1" aria-hidden="true"></button>
      </div>`;
    document.body.append(root);
    document.body.classList.add("tour-open");
    requestAnimationFrame(() => root.classList.add("is-in"));
    const bars = [...root.querySelectorAll(".tour-bar i")];
    const stage = root.querySelector(".tour-stage");
    const copy = root.querySelector(".tour-copy");
    const nextButton = root.querySelector(".tour-next");
    const pauseButton = root.querySelector(".tour-pause");

    function show(i) {
      index = Math.max(0, Math.min(list.length - 1, i));
      const page = list[index];
      stage.innerHTML = page.scene;
      copy.innerHTML = `<p class="eyebrow gold">${h(page.eyebrow)}</p><h2>${h(page.title)}</h2><p>${h(page.body)}</p>`;
      nextButton.textContent = page.last ? "Get started" : "Next";
      root.querySelector(".tour-prev").disabled = index === 0;
      bars.forEach((bar, k) => { bar.style.transition = "none"; bar.style.width = k < index ? "100%" : "0%"; });
      const typing = stage.querySelector(".typing");
      if (typing) typeText(typing);
      const tick = stage.querySelector(".tick");
      if (tick && !reducedMotion) {
        let n = 12;
        const t = setInterval(() => {
          if (!document.body.contains(tick)) { clearInterval(t); return; }
          if (paused) return;
          tick.textContent = --n;
          if (n <= 9) clearInterval(t);
        }, 1600);
      }
      track("tour-page", String(index + 1));
      elapsed = 0;
      start();
    }

    function typeText(el) {
      const text = el.dataset.text;
      if (reducedMotion) { el.textContent = text; return; }
      let n = 0;
      const step = () => { if (!document.body.contains(el)) return; el.textContent = text.slice(0, ++n); if (n < text.length) setTimeout(step, 85); };
      setTimeout(step, 450);
    }

    function start() {
      clearTimeout(timer);
      if (paused) return;
      const bar = bars[index];
      const remaining = PAGE_MS - elapsed;
      startedAt = performance.now();
      requestAnimationFrame(() => {
        bar.style.transition = `width ${remaining}ms linear`;
        bar.style.width = "100%";
      });
      timer = setTimeout(() => (list[index].last ? holdOnLast() : show(index + 1)), remaining);
    }

    function holdOnLast() { /* the last page waits for "Get started" */ }

    function pause(on) {
      if (paused === on) return;
      paused = on;
      root.classList.toggle("is-paused", on);
      pauseButton.innerHTML = icon(on ? "play" : "pause");
      pauseButton.setAttribute("aria-label", on ? "Play" : "Pause");
      const bar = bars[index];
      if (on) {
        clearTimeout(timer);
        elapsed += performance.now() - startedAt;
        const width = getComputedStyle(bar).width;
        bar.style.transition = "none";
        bar.style.width = width;
      } else {
        start();
      }
    }

    function close() {
      clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      root.classList.remove("is-in");
      root.classList.add("is-out");
      document.body.classList.remove("tour-open");
      track(index === list.length - 1 ? "tour-finish" : "tour-skip", String(index + 1));
      setTimeout(() => { root.remove(); opener?.focus?.(); resolve(index + 1); }, reducedMotion ? 0 : 300);
    }

    const next = () => (list[index].last ? close() : show(index + 1));
    const prev = () => show(index - 1);

    nextButton.addEventListener("click", next);
    root.querySelector(".tour-prev").addEventListener("click", prev);
    root.querySelector(".tour-close").addEventListener("click", close);
    pauseButton.addEventListener("click", () => pause(!paused));

    // Tap zones: tap to move, press and hold to pause.
    for (const zone of root.querySelectorAll(".tour-zone")) {
      zone.addEventListener("pointerdown", () => { holding = setTimeout(() => { holding = "held"; pause(true); }, 260); });
      zone.addEventListener("pointerup", () => {
        if (holding === "held") { holding = null; pause(false); return; }
        clearTimeout(holding); holding = null;
        zone.classList.contains("left") ? prev() : next();
      });
      zone.addEventListener("pointerleave", () => { if (holding === "held") pause(false); else clearTimeout(holding); holding = null; });
      zone.addEventListener("contextmenu", e => e.preventDefault());
    }

    // Swipe down to close.
    let touchY = null;
    root.addEventListener("touchstart", e => { touchY = e.touches[0].clientY; }, { passive: true });
    root.addEventListener("touchend", e => { if (touchY != null && e.changedTouches[0].clientY - touchY > 110) close(); touchY = null; });

    function onKey(e) {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === " " && e.target === document.body) { e.preventDefault(); pause(!paused); }
    }
    function onVisibility() { if (document.hidden) pause(true); }
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);

    show(0);
    nextButton.focus({ preventScroll: true });
  });
}
