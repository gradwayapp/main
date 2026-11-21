// Opening hours in OpenStreetMap's format ("Mo-Fr 07:00-22:00; Sa,Su 08:00-20:00").
// Covers the common forms: day lists and ranges, several time ranges, times
// past midnight, "off", and "24/7". Anything fancier (months, holidays,
// sunrise) returns null, and the card shows the hours as written instead.

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseDays(spec) {
  const days = new Set();
  for (const part of spec.split(",")) {
    const [from, to] = part.split("-").map(d => DAYS.indexOf(d.trim()));
    if (from < 0 || (to !== undefined && to < 0)) return null;
    if (to === undefined) { days.add(from); continue; }
    for (let d = from; ; d = (d + 1) % 7) { days.add(d); if (d === to) break; }
  }
  return days;
}

function parseTimes(spec) {
  const ranges = [];
  for (const part of spec.split(",")) {
    const m = part.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/);
    if (!m) return null;
    const start = Number(m[1]) * 60 + Number(m[2]);
    let end = Number(m[3]) * 60 + Number(m[4]);
    if (end <= start) end += 24 * 60; // e.g. 18:00-02:00
    ranges.push([start, end]);
  }
  return ranges;
}

/** Returns an array of 7 lists of [startMinute, endMinute] (Sunday first), or null. */
export function parseOpeningHours(text) {
  if (!text || typeof text !== "string") return null;
  const value = text.trim();
  if (value === "24/7") return Array.from({ length: 7 }, () => [[0, 24 * 60]]);
  const week = Array.from({ length: 7 }, () => null);
  for (const rawRule of value.split(";")) {
    const rule = rawRule.trim().replace(/\s+/g, " ");
    if (!rule) continue;
    const ruleNoPH = rule.replace(/(^|,)\s*PH\b(\s*off)?/g, "").replace(/^,/, "").trim();
    if (!ruleNoPH) continue; // a public-holiday-only rule; ignored
    let m = ruleNoPH.match(/^([A-Za-z,\- ]+?)\s+(off|closed|\d.*)$/);
    let days, times;
    if (m) {
      days = parseDays(m[1].replace(/\s/g, ""));
      times = /^(off|closed)$/i.test(m[2]) ? [] : parseTimes(m[2]);
    } else if (/^\d/.test(ruleNoPH)) {
      days = new Set([0, 1, 2, 3, 4, 5, 6]);
      times = parseTimes(ruleNoPH);
    } else {
      return null;
    }
    if (!days || !times) return null;
    for (const d of days) week[d] = times; // later rules override earlier ones
  }
  return week.map(d => d || []);
}

function clock(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  if (m === 0) return "midnight";
  if (m === 720) return "noon";
  const h = Math.floor(m / 60), mm = m % 60;
  return `${((h + 11) % 12) + 1}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * { open: boolean, text: "Open · closes 10 PM" | "Closed · opens 7 AM Tue" | "Open 24 hours" }
 * or null if the hours can't be read.
 */
export function openStatus(week, now = new Date()) {
  if (!week) return null;
  const day = now.getDay();
  const minute = now.getHours() * 60 + now.getMinutes();
  if (week.every(ranges => ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] >= 1440)) {
    return { open: true, text: "Open 24 hours" };
  }
  const yesterday = (day + 6) % 7;
  for (const [start, end] of week[yesterday]) {
    if (end > 1440 && minute < end - 1440) return { open: true, text: `Open · closes ${clock(end)}` };
  }
  for (const [start, end] of week[day]) {
    if (minute >= start && minute < end) {
      return { open: true, text: end >= 1440 && start === 0 ? "Open all day" : `Open · closes ${clock(end)}` };
    }
  }
  for (let offset = 0; offset < 7; offset++) {
    const d = (day + offset) % 7;
    const next = week[d].map(r => r[0]).filter(start => offset > 0 || start > minute).sort((a, b) => a - b)[0];
    if (next !== undefined) {
      const when = offset === 0 ? "" : offset === 1 ? " tomorrow" : ` ${DAY_NAMES[d]}`;
      return { open: false, text: `Closed · opens ${clock(next)}${when}` };
    }
  }
  return { open: false, text: "Closed" };
}

/** "Mon–Fri 7 AM–10 PM · Sat–Sun 8 AM–8 PM" (Monday first). */
export function formatWeek(week) {
  if (!week) return null;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const label = ranges => !ranges.length ? "Closed"
    : ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] >= 1440 ? "24 hours"
    : ranges.map(([s, e]) => `${clock(s)}–${clock(e)}`).join(", ");
  const groups = [];
  for (const d of order) {
    const text = label(week[d]);
    const last = groups[groups.length - 1];
    if (last && last.text === text) last.to = d;
    else groups.push({ from: d, to: d, text });
  }
  if (groups.length === 1) return `Every day ${groups[0].text}`;
  return groups.map(g => `${DAY_NAMES[g.from]}${g.to !== g.from ? `–${DAY_NAMES[g.to]}` : ""} ${g.text}`).join(" · ");
}
