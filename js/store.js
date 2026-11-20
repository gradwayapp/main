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
  set campusName(name) { write("campus", name); },

  /** "student" | "visitor" | undefined, per campus (GradWayModeStore). */
  modeFor(campusName) { return read("modes", {})[campusName]; },
  setMode(campusName, mode) { const modes = read("modes", {}); modes[campusName] = mode; write("modes", modes); },

  /** [{ id, name, building, days: [1..5], time: "HH:MM" }] */
  get classes() { return read("classes", []); },
  set classes(list) { write("classes", list); },

  /** "walk" | "drive" for routes in the place card. */
  get travelMode() { return read("travelMode", "walk"); },
  set travelMode(value) { write("travelMode", value); },

  get installDismissed() { return read("installDismissed", false); },
  set installDismissed(value) { write("installDismissed", value); }
};
