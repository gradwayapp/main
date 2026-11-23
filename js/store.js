// Small wrapper around localStorage. Private browsing or blocked storage can
// make every call throw, so the site keeps working (it just forgets).

const PREFIX = "gradway.";
const memory = new Map();

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return memory.has(key) ? memory.get(key) : fallback;
  }
}

function write(key, value) {
  memory.set(key, value);
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export const store = {
  get campusName() { return read("campus", null); },

  /** Leave-by reminders: start ("location" or a building name), buffer minutes, notify while open. */
  get reminders() { return { start: "location", buffer: 5, notify: false, ...read("reminders", {}) }; },
  set reminders(value) { write("reminders", value); },
  /** Where each building is, found once by search: { "McCool Hall": { lat, lng } } per campus. */
  spotsFor(campusName) { return read("spots", {})[campusName] || {}; },
  saveSpot(campusName, building, spot) { const all = read("spots", {}); all[campusName] = { ...(all[campusName] || {}), [building]: spot }; write("spots", all); },
  /** "classId|YYYY-MM-DD" keys already notified (last 50). */
  get notified() { return read("notified", []); },
  markNotified(key) { write("notified", [...read("notified", []), key].slice(-50)); },

  /** "dark" (the default, like the app) or "light". */
  get theme() { return read("theme", "dark"); },
  set theme(value) { write("theme", value === "light" ? "light" : "dark"); },

  get tourSeen() { return read("tourSeen", false); },
  set tourSeen(value) { write("tourSeen", Boolean(value)); },

  /** Alert ids the person closed (kept to the last 100). */
  get dismissedAlerts() { return read("dismissedAlerts", []); },
  dismissAlert(id) { write("dismissedAlerts", [...read("dismissedAlerts", []).filter(x => x !== id), id].slice(-100)); },
  set campusName(name) { write("campus", name); },

  /** "student" | "visitor" | undefined, per campus (GradWayModeStore). */
  modeFor(campusName) { return read("modes", {})[campusName]; },
  setMode(campusName, mode) { const modes = read("modes", {}); modes[campusName] = mode; write("modes", modes); },

  /** [{ id, name, building, days: [1..5], time: "HH:MM" }] */
  get classes() { return read("classes", []); },
  set classes(list) { write("classes", list); },

  /** "walk" | "drive" for routes in the place card. */
  /** Walking routes that avoid steps and stairs (wheelchairs, strollers, crutches). */
  get stepFree() { return read("stepFree", false); },
  set stepFree(value) { write("stepFree", Boolean(value)); },
  get travelMode() { return read("travelMode", "walk"); },
  set travelMode(value) { write("travelMode", value); },

  /** "dark" | "light" | "satellite" */
  get mapLook() { return read("mapLook", "streets"); },
  set mapLook(value) { write("mapLook", value); },
  get traffic() { return read("traffic", false); },
  set traffic(value) { write("traffic", Boolean(value)); },

  /** Map details turned on, e.g. ["phones", "bus"]. */
  get mapDetails() { return read("mapDetails", []); },
  set mapDetails(list) { write("mapDetails", list); },

  get installDismissed() { return read("installDismissed", false); },
  set installDismissed(value) { write("installDismissed", value); }
};
