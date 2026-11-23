// Anonymous campus activity for Campus Insights. Off until `insightsEndpoint` is set
// in config.js. What's sent is coarse on purpose:
//  - no identifiers, accounts or IP addresses kept (the server doesn't store them);
//  - for a route: destination, distance (to 50 m), minutes, walk or drive, the hour,
//    never the starting point or the person's location;
//  - places are reduced to a ~150 m grid square;
//  - a search's text is sent only when it found nothing (to fix missing names), cut to 40 characters.

let endpoint = null;
let context = () => ({});

export function initInsights(config, getContext) {
  endpoint = config.insightsEndpoint ? config.insightsEndpoint.replace(/\/$/, "") : null;
  context = getContext;
}

const pad = n => String(n).padStart(2, "0");

/** A ~150 m grid square (rows of 0.00135° latitude, columns of 0.0016° longitude). */
export function cellOf(point) {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  return `${Math.round(point.lat / 0.00135)}:${Math.round(point.lng / 0.0016)}`;
}

export function record(type, fields = {}) {
  if (!endpoint) return;
  const { campus, role } = context();
  if (!campus) return;
  const now = new Date();
  const body = JSON.stringify({
    v: 1, type, campus, role: role || "unknown",
    day: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, hour: now.getHours(), dow: now.getDay(),
    ...fields
  });
  try {
    const blob = new Blob([body], { type: "text/plain" }); // a "simple" request: no CORS preflight
    if (!navigator.sendBeacon?.(`${endpoint}/e`, blob)) fetch(`${endpoint}/e`, { method: "POST", body, keepalive: true, mode: "no-cors" }).catch(() => {});
  } catch { /* never get in the way */ }
}

/** Once a day per campus: counts people without following anyone from day to day. */
export function recordVisit() {
  const { campus } = context();
  if (!endpoint || !campus) return;
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const key = `gradway.seen.${campus}`;
  let last = null;
  try { last = localStorage.getItem(key); } catch {}
  if (last === today) return;
  try { localStorage.setItem(key, today); } catch {}
  record("visit", { returning: last ? 1 : 0 });
}
