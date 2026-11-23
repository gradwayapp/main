// Reads a class schedule from a calendar file (.ics, which most student portals,
// Canvas and Google Calendar can export) or from text pasted out of a portal's
// schedule page, and matches each class's location to the campus's buildings.
// Everything happens in the browser; nothing is uploaded.
//
// A class: { name, title, days: [1..5], time: "HH:MM", location, building, match }
//   match: "matched" (sure), "guess" (likely), "none" (pick one)

const DAY_CODES = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const COURSE = /\b([A-Z]{2,5})\s?[-– ]?\s?(\d{3,4}[A-Z]?)\b/;

// MARK: - Calendar files (.ics)

export function parseICS(text) {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events = [];
  let event = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { event = {}; continue; }
    if (line === "END:VEVENT") { if (event) events.push(event); event = null; continue; }
    if (!event) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const [name, ...params] = line.slice(0, colon).split(";");
    const value = line.slice(colon + 1);
    const key = name.toUpperCase();
    if (!(key in event)) event[key] = { value, params: params.join(";").toUpperCase() };
  }

  const classes = new Map();
  for (const e of events) {
    const start = e.DTSTART && parseICSDate(e.DTSTART);
    if (!start || start.allDay) continue;
    const end = e.DTEND && parseICSDate(e.DTEND);
    if (end && !end.allDay && end.date - start.date > 5 * 3_600_000) continue; // not a class
    const summary = unescapeICS(e.SUMMARY?.value || "").trim();
    if (!summary) continue;
    const rule = e.RRULE?.value || "";
    const byDay = /BYDAY=([^;]+)/.exec(rule)?.[1];
    const days = byDay
      ? byDay.split(",").map(d => DAY_CODES[d.replace(/^[-+]?\d+/, "")]).filter(d => d !== undefined)
      : [start.date.getDay()];
    const time = `${String(start.date.getHours()).padStart(2, "0")}:${String(start.date.getMinutes()).padStart(2, "0")}`;
    const location = unescapeICS(e.LOCATION?.value || "").trim();
    const { name, title } = nameFrom(summary);
    const key = `${name}|${time}|${location}`;
    const existing = classes.get(key);
    if (existing) {
      // Portals that list every meeting separately: collect the weekdays.
      for (const d of days) if (!existing.days.includes(d)) existing.days.push(d);
      existing.repeats = true;
    } else {
      classes.set(key, { name, title, days: [...days], time, location, repeats: Boolean(rule) });
    }
  }
  return [...classes.values()].map(c => ({ ...c, days: c.days.sort(), oneTime: !c.repeats }));
}

function parseICSDate({ value, params }) {
  if (params.includes("VALUE=DATE") && !value.includes("T")) return { allDay: true };
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (hh === undefined) return { allDay: true };
  // A time zone name (TZID) or a floating time is the campus's own clock time;
  // a "Z" (UTC) time is shown in this device's time zone.
  const date = z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +(ss || 0)))
    : new Date(+y, +mo - 1, +d, +hh, +mm, +(ss || 0));
  return { date, allDay: false };
}

const unescapeICS = s => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");

// MARK: - Pasted text

const DAY_WORDS = [
  [/^(mon|monday)$/i, 1], [/^(tue|tues|tuesday)$/i, 2], [/^(wed|weds|wednesday)$/i, 3],
  [/^(thu|thur|thurs|thursday)$/i, 4], [/^(fri|friday)$/i, 5], [/^(sat|saturday)$/i, 6], [/^(sun|sunday)$/i, 0]
];

/** "MWF", "TR", "TTh", "MoWe", "Mon/Wed", "M W F" → [1, 3, 5]. Returns null when it isn't days. */
export function parseDays(text) {
  const t = text.trim();
  if (!t) return null;
  // Day words separated by / , - or spaces
  const words = t.split(/[\s/,&-]+/).filter(Boolean);
  if (words.length && words.every(w => DAY_WORDS.some(([re]) => re.test(w)))) {
    return [...new Set(words.map(w => DAY_WORDS.find(([re]) => re.test(w))[1]))].sort();
  }
  // Letter codes, case-sensitive so ordinary words don't match: M T W R F, Th Tu, Mo We Fr...
  const compact = t.replace(/\s+/g, "");
  if (compact.length > 10) return null;
  const re = /(Mo|Tu|We|Th|Fr|Sa|Su|M|T|W|R|F|S|U)/gy;
  const days = [];
  let m;
  while ((m = re.exec(compact))) {
    const code = { Mo: 1, M: 1, Tu: 2, T: 2, We: 3, W: 3, Th: 4, R: 4, Fr: 5, F: 5, Sa: 6, S: 6, Su: 0, U: 0 }[m[1]];
    if (!days.includes(code)) days.push(code);
    if (re.lastIndex === compact.length) return days.sort();
  }
  return null;
}

const TIME = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m?\.?|p\.?m?\.?)?(?=\s*(?:[-–]|to\b|$|\s|,))/gi;

/** The first start time in a line ("2:00 PM - 3:15 PM", "14:00-15:15", "9-9:50am") as "HH:MM". */
export function parseStartTime(line) {
  const found = [];
  let m;
  TIME.lastIndex = 0;
  while ((m = TIME.exec(line))) {
    const hour = +m[1], minute = m[2] ? +m[2] : 0;
    if (hour > 23 || minute > 59) continue;
    if (!m[2] && !m[3]) continue; // a bare number (a room or course number), not a time
    found.push({ hour, minute, meridiem: m[3]?.[0].toLowerCase(), index: m.index });
  }
  if (!found.length) return null;
  const [first, second] = found;
  let { hour } = first;
  const meridiem = first.meridiem || (second && second.index - first.index < 14 ? second.meridiem : undefined);
  if (meridiem === "p" && hour < 12) hour += 12;
  else if (meridiem === "a" && hour === 12) hour = 0;
  else if (!meridiem && hour >= 1 && hour <= 6) hour += 12; // "2:00" in a class list is 2 PM
  return `${String(hour).padStart(2, "0")}:${String(first.minute).padStart(2, "0")}`;
}

function daysInLine(line) {
  // The course code's letters ("MUS", "FR") aren't days, so leave the code out.
  const words = line.replace(COURSE, " ").split(/\s+/).map(w => w.replace(/[(),.;:|]/g, "")).filter(Boolean);
  // Try three words together ("M W F", "Mon Wed Fri"), then two, then one.
  for (let size = 3; size >= 1; size--) {
    for (let i = 0; i + size <= words.length; i++) {
      const group = words.slice(i, i + size);
      if (size > 1 && !group.every(w => w.length <= 3 || DAY_WORDS.some(([re]) => re.test(w)))) continue;
      const days = parseDays(group.join(size > 1 && group.some(w => w.length > 2) ? " " : ""));
      if (!days?.length) continue;
      if (size === 1 && group[0].length === 1 && !/^[MTWRF]$/.test(group[0])) continue;
      return days;
    }
  }
  return null;
}

/**
 * Text copied from a portal's schedule (one class per line, or a block per class).
 * A new class starts at each course code (BIO 1134, CSE-1284). Each line with a time
 * inside that block is one meeting (a lecture and a lab become two classes).
 */
export function parsePasted(text) {
  const lines = text.replace(/\r/g, "").split("\n").map(l => l.replace(/\t/g, "  ").trim()).filter(Boolean);
  const blocks = [];
  let block = null;
  for (const line of lines) {
    const code = COURSE.exec(line);
    if (code && !(block && !block.lines.some(l => parseStartTime(l)) && block.code === `${code[1]} ${code[2]}`)) {
      block = { code: `${code[1]} ${code[2]}`, lines: [] };
      blocks.push(block);
    }
    if (!block) { block = { code: "", lines: [] }; blocks.push(block); }
    block.lines.push(line);
  }

  const classes = [];
  for (const b of blocks) {
    const titleLine = cleanTitle(b.lines[0].replace(COURSE, "").replace(/^[\s\-–:|·.0-9]+/, "").trim());
    const meetings = [];
    b.lines.forEach((line, i) => {
      const time = parseStartTime(line);
      if (!time) return;
      const days = daysInLine(line) || (i > 0 && daysInLine(b.lines[i - 1])) || null;
      // The room is usually on the same line, or on the next one when that has no time of its own.
      const next = b.lines[i + 1] || "";
      const location = parseStartTime(next) ? line : `${line}  ${next}`;
      meetings.push({ time, days, location, line });
    });
    meetings.forEach((m, k) => {
      if (!m.days?.length) return;
      const name = b.code || titleLine.slice(0, 40) || "Class";
      const lab = meetings.length > 1 && k > 0 && /\blab\b/i.test(m.line + " " + b.lines.join(" ")) ? " Lab" : "";
      classes.push({
        name: k > 0 && meetings.length > 1 && !classes.some(c => c.name === name + lab) ? name + lab : name,
        title: titleLine && b.code ? shorten(titleLine.split(/\s{2,}|\s\|\s/)[0], 48) : "",
        days: m.days, time: m.time, location: m.location, oneTime: false
      });
    });
  }
  return dedupe(classes);
}

/** "English Composition I  MWF 9:00-9:50am  Lee Hall" → "English Composition I". */
function cleanTitle(text) {
  let t = text.split(/\s{2,}|\s\|\s|\t/)[0];
  TIME.lastIndex = 0;
  const time = TIME.exec(t);
  if (time && (time[2] || time[3])) t = t.slice(0, time.index);
  const parts = t.trim().split(/\s+/);
  while (parts.length && parseDays(parts[parts.length - 1]) && parts[parts.length - 1].length <= 4) parts.pop();
  while (parts.length && /^(lecture|lec|lab|sec|section|\d+)$/i.test(parts[parts.length - 1])) parts.pop();
  return parts.join(" ");
}

function dedupe(classes) {
  const seen = new Map();
  for (const c of classes) {
    const key = `${c.name}|${c.time}|${c.days.join("")}`;
    if (!seen.has(key)) seen.set(key, c);
  }
  return [...seen.values()];
}

function nameFrom(summary) {
  const code = COURSE.exec(summary);
  if (!code) return { name: shorten(summary, 40), title: "" };
  const title = summary.replace(code[0], "").replace(/^[\s\-–:|·.0-9]+/, "").replace(/\b(section|sec)\.?\s*\w+/i, "").trim();
  return { name: `${code[1]} ${code[2]}`, title: shorten(title, 48) };
}

const shorten = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// MARK: - Buildings

const FILLER = new Set(["hall", "halls", "building", "bldg", "bld", "room", "rm", "center", "ctr", "the", "of", "and", "at",
  "complex", "auditorium", "aud", "annex", "east", "west", "north", "south", "campus", "main", "floor", "fl", "suite", "ste"]);

const words = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ")
  .replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w && !/^\d+[a-z]?$/.test(w));
const core = s => words(s).filter(w => !FILLER.has(w));

/**
 * The campus building a location string most likely means ("MCCOOL 215" → "McCool Hall").
 * Returns { building, match } with match "matched", "guess" or "none".
 */
export function matchBuilding(location, buildings) {
  if (!location || !buildings?.length) return { building: "", match: "none" };
  const loc = words(location);
  const locSet = new Set(loc);
  const has = w => locSet.has(w) || (w.length >= 5 && loc.some(l => l.length >= 4 && (w.startsWith(l) || l.startsWith(w))));
  let best = null;
  for (const b of buildings) {
    const tokens = core(b).length ? core(b) : words(b);
    if (!tokens.length) continue;
    const hits = tokens.filter(has).length;
    if (!hits) continue;
    const score = hits / tokens.length + (words(location).join(" ").includes(words(b).join(" ")) ? 1 : 0);
    const strong = tokens.filter(has).some(t => t.length >= 4 || (t.length === 3 && locSet.has(t)));
    if (!strong) continue;
    if (!best || score > best.score || (score === best.score && b.length < best.building.length)) best = { building: b, score, all: hits === tokens.length };
  }
  if (!best) return { building: "", match: "none" };
  // Another building that fits equally well makes it a guess.
  return { building: best.building, match: best.all ? "matched" : "guess" };
}
