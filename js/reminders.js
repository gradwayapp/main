// Leave-by reminders: when to leave for each class, given the walk there.
//
// Three layers, because browsers can't wake a closed website without a server:
//  1. The dashboard's Next class card counts down ("Leave in 12 min", "Leave now").
//  2. A notification at leave time while GradWay is open or installed and running.
//  3. A calendar file with a "leave by" alarm on every class, which the phone's
//     calendar fires on time even when GradWay is closed.

import { distanceMeters } from "./data.js";

const WALK_METERS_PER_MINUTE = 80;   // about 3 mph
const PATH_FACTOR = 1.25;            // paths aren't straight lines

export const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export const minutesOf = time => { const [hh, mm] = String(time).split(":").map(Number); return hh * 60 + mm; };

/** Walking minutes between two points, rounded up, at least 2. */
export function walkMinutesBetween(a, b) {
  if (!a || !b) return null;
  return Math.max(2, Math.ceil((distanceMeters(a, b) * PATH_FACTOR) / WALK_METERS_PER_MINUTE));
}

/**
 * Leave-by for a class today: { leaveAt: Date, startsAt: Date, minutesLeft, state }
 * state: "later" (more than 60 min), "soon" (leave within the hour), "now" (time to go), "late" (class started).
 */
export function leaveInfo(cls, walkMinutes, bufferMinutes, now = new Date()) {
  const startsAt = new Date(now);
  const start = minutesOf(cls.time);
  startsAt.setHours(Math.floor(start / 60), start % 60, 0, 0);
  const lead = (walkMinutes ?? 10) + (bufferMinutes || 0);
  const leaveAt = new Date(startsAt.getTime() - lead * 60_000);
  const minutesLeft = Math.round((leaveAt - now) / 60_000);
  const state = now >= startsAt ? "late" : minutesLeft <= 0 ? "now" : minutesLeft <= 60 ? "soon" : "later";
  return { leaveAt, startsAt, minutesLeft, state, lead };
}

/** The previous class on the same day that starts within 3 hours before this one. */
export function previousClass(classes, cls, day) {
  const start = minutesOf(cls.time);
  return classes
    .filter(c => c !== cls && c.days.includes(day) && minutesOf(c.time) < start && start - minutesOf(c.time) <= 180)
    .sort((a, b) => minutesOf(b.time) - minutesOf(a.time))[0] || null;
}

const pad = n => String(n).padStart(2, "0");
const icsDate = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const icsText = s => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const fold = line => { const out = []; let rest = line; while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = " " + rest.slice(74); } out.push(rest); return out.join("\r\n"); };

/**
 * A calendar file: one weekly event per class (per start time), each with an alarm
 * at its leave-by time. entries: [{ cls, day, leadMinutes, fromLabel, walkMinutes }]
 * Times are "floating", so the calendar uses the phone's own time zone.
 */
export function buildICS(entries, campusName, now = new Date()) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Oakland Software Co.//GradWay//EN", "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${icsText(`GradWay classes · ${campusName}`)}`];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  for (const e of entries) {
    const first = new Date(now);
    first.setHours(0, 0, 0, 0);
    while (first.getDay() !== e.day) first.setDate(first.getDate() + 1);
    const start = minutesOf(e.cls.time);
    first.setHours(Math.floor(start / 60), start % 60, 0, 0);
    const end = new Date(first.getTime() + 50 * 60_000);
    const where = e.cls.building || "";
    const walk = e.walkMinutes != null ? `${e.walkMinutes} min walk${e.fromLabel ? ` from ${e.fromLabel}` : ""}` : "your walk";
    lines.push(
      "BEGIN:VEVENT",
      `UID:gradway-${e.cls.id}-${DAY_CODES[e.day]}@gradwayapp.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(first)}`,
      `DTEND:${icsDate(end)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${DAY_CODES[e.day]}`,
      fold(`SUMMARY:${icsText(e.cls.name + (where ? ` · ${where}` : ""))}`),
      ...(where ? [fold(`LOCATION:${icsText(`${where}, ${campusName}`)}`)] : []),
      fold(`DESCRIPTION:${icsText(`Leave ${e.leadMinutes} minutes before class (${walk}, plus a few minutes to spare). From GradWay.`)}`),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      fold(`DESCRIPTION:${icsText(`Leave now for ${e.cls.name}${where ? ` in ${where}` : ""}`)}`),
      `TRIGGER:-PT${e.leadMinutes}M`,
      "END:VALARM",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
