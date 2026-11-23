// Campus alerts: short, timed messages at the top of a campus's dashboard
// ("Today is the last day to drop a class", "Fried chicken day at the Union").
// They live in data/alerts.json, which the alerts editor (alerts-editor.html)
// publishes to GitHub.

export const ALERT_TYPES = {
  info:     { label: "News",     icon: "sparkle" },
  deadline: { label: "Deadline", icon: "calendar" },
  food:     { label: "Food",     icon: "food" },
  event:    { label: "Event",    icon: "events" },
  weather:  { label: "Weather",  icon: "sun" },
  safety:   { label: "Safety",   icon: "shield" }
};

export const MAX_ALERTS_SHOWN = 3;

/** "2026-11-23T08:00" (campus time, as typed in the editor) → Date. */
export function parseLocal(value) {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}

/** "live", "scheduled" or "ended". */
export function alertStatus(alert, now = new Date()) {
  const starts = parseLocal(alert.starts), ends = parseLocal(alert.ends);
  if (ends && ends < now) return "ended";
  if (starts && starts > now) return "scheduled";
  return "live";
}

/** The alerts to show for a campus right now: safety first, then newest, at most three. */
export function alertsFor(data, campusName, now = new Date(), dismissed = []) {
  if (!data) return [];
  const list = [...(data.all || []), ...(data.campuses?.[campusName] || [])]
    .filter(a => a && a.id && a.text && alertStatus(a, now) === "live" && !dismissed.includes(a.id));
  const rank = a => (a.type === "safety" ? 0 : 1);
  return list
    .sort((a, b) => rank(a) - rank(b) || String(b.starts || "").localeCompare(String(a.starts || "")))
    .slice(0, MAX_ALERTS_SHOWN);
}

export async function loadAlerts(url) {
  if (!url) return null;
  // A new address each minute, so a just-published change isn't held back by caches for long.
  const bust = `${url.includes("?") ? "&" : "?"}m=${Math.floor(Date.now() / 60_000)}`;
  const response = await fetch(url + bust, { cache: "no-store" });
  if (!response.ok) throw new Error(`Alerts ${response.status}`);
  return response.json();
}
