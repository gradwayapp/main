// Visitor counts with GoatCounter (goatcounter.com): no cookies, no personal
// data, free for small businesses. Turned on by setting goatcounterCode in
// config.js. Without it, every function here does nothing.
//
// What gets counted:
//   page views  /<campus>/<screen>, e.g. /mississippi-state-university/map
//   events      category/<key>, route/<walk|drive>,
//               sponsor-view/<campus>/<name>, sponsor-click/<campus>/<name>

let endpoint = null;
let queue = [];

export function initAnalytics(config) {
  const code = config.goatcounterCode;
  if (!code || !/^[a-z0-9-]+$/i.test(code)) return;
  endpoint = `https://${code}.goatcounter.com`;
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://gc.zgo.at/count.js";
  script.dataset.goatcounter = `${endpoint}/count`;
  script.dataset.goatcounterSettings = JSON.stringify({ no_onload: true });
  script.onload = flush;
  document.head.appendChild(script);
}

function flush() {
  if (!window.goatcounter?.count) return;
  const pending = queue;
  queue = [];
  pending.forEach(args => { try { window.goatcounter.count(args); } catch { /* never break the page */ } });
}

function send(args) {
  if (!endpoint) return;
  queue.push(args);
  flush();
}

const slug = text => String(text || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function trackPage(campus, screen) {
  send({ path: `/${campus ? slug(campus.name) : "no-campus"}/${screen}`, title: document.title, event: false });
}

export function trackEvent(...parts) {
  send({ path: parts.map(slug).join("/"), title: parts.join(" · "), event: true });
}

/** Total visits for the footer, or null (needs "Allow adding visitor counts" in GoatCounter settings). */
export async function totalVisits() {
  if (!endpoint) return null;
  try {
    const response = await fetch(`${endpoint}/counter/TOTAL.json`);
    if (!response.ok) return null;
    const json = await response.json();
    return json.count || null;
  } catch {
    return null;
  }
}
