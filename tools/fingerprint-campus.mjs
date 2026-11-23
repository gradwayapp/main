#!/usr/bin/env node
// Invisible fingerprints for campus.json, so a copied file can be proven to be ours.
//
// Each campus gets a secret mark worked out from its name and a private key:
//  - Center: the 5th and 6th decimal places of latitude and of longitude (a shift under 11 m);
//  - Theme: the lowest 2 bits of the blue channel (a color change no one can see).
// Students see nothing different. A copy that keeps our coordinates or colors carries the marks,
// and with dozens of campuses the chance of matching by accident is effectively zero.
//
//   node tools/fingerprint-campus.mjs keygen
//       Makes a private key. Keep it in a password manager: never in the repo or the app.
//   node tools/fingerprint-campus.mjs stamp campus.json campus.stamped.json --key <key>
//       Adds the marks (safe to run again after editing the file).
//   node tools/fingerprint-campus.mjs check suspect.json --key <key>
//       Checks someone else's file (or a JSON of their data) for our marks.

import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [command, ...rest] = process.argv.slice(2);
const keyAt = rest.indexOf("--key");
const key = keyAt >= 0 ? rest[keyAt + 1] : process.env.GRADWAY_FINGERPRINT_KEY;
const files = rest.filter((_, i) => i !== keyAt && i !== keyAt + 1);

const norm = name => String(name || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const markFor = name => {
  const b = createHmac("sha256", key).update(norm(name)).digest();
  return { lat: b.readUInt16BE(0) % 100, lng: b.readUInt16BE(2) % 100, blue: b[4] & 3 };
};
const campusesOf = json => json.Campuses || json.campuses || (Array.isArray(json) ? json : []);
const parseCenter = v => { const n = String(v ?? "").match(/-?\d+(?:\.\d+)?/g); return n && n.length >= 2 ? n.slice(0, 2) : null; };

/** Keeps 4 decimals, then puts the mark in the 5th and 6th. */
function stampNumber(text, mark) {
  const value = Number(text), sign = value < 0 ? -1 : 1;
  const base = Math.trunc(Math.abs(value) * 1e4) / 1e4;
  return (sign * (base + mark / 1e6)).toFixed(6);
}
/** The 5th and 6th decimals, or null when the number has fewer than 6. */
function digitsOf(text) {
  const m = String(text).match(/\.(\d{6,})/);
  return m ? Number(m[1].slice(4, 6)) : null;
}

if (command === "keygen") {
  console.log(randomBytes(24).toString("base64url"));
} else if (command === "stamp" && key && files.length === 2) {
  const json = JSON.parse(readFileSync(files[0], "utf8"));
  let n = 0;
  for (const campus of campusesOf(json)) {
    if (!campus?.Name) continue;
    const mark = markFor(campus.Name);
    const center = parseCenter(campus.Center);
    if (center) campus.Center = `${stampNumber(center[0], mark.lat)}, ${stampNumber(center[1], mark.lng)}`;
    if (/^#[0-9a-f]{6}$/i.test(campus.Theme || "")) {
      const blue = (parseInt(campus.Theme.slice(5, 7), 16) & 0xfc) | mark.blue;
      campus.Theme = campus.Theme.slice(0, 5) + blue.toString(16).padStart(2, "0").toUpperCase();
    }
    n++;
  }
  writeFileSync(files[1], JSON.stringify(json, null, 2) + "\n");
  console.log(`Stamped ${n} campuses into ${files[1]}. Check it opens in the app, then publish it in place of campus.json.`);
} else if (command === "check" && key && files.length === 1) {
  const json = JSON.parse(readFileSync(files[0], "utf8"));
  let checked = 0, hits = 0, possible = 0, log10chance = 0;
  const rows = [];
  for (const campus of campusesOf(json)) {
    const name = campus?.Name || campus?.name;
    if (!name) continue;
    const mark = markFor(name);
    const center = parseCenter(campus.Center || campus.center);
    const tests = [];
    if (center) {
      const lat = digitsOf(center[0]), lng = digitsOf(center[1]);
      if (lat !== null) tests.push(["lat", lat === mark.lat, 2]);
      if (lng !== null) tests.push(["lng", lng === mark.lng, 2]);
    }
    const theme = campus.Theme || campus.theme;
    if (/^#[0-9a-f]{6}$/i.test(theme || "")) tests.push(["color", (parseInt(theme.slice(5, 7), 16) & 3) === mark.blue, Math.log10(4)]);
    if (!tests.length) continue;
    checked++;
    for (const [, ok, weight] of tests) { possible++; if (ok) { hits++; log10chance -= weight; } }
    rows.push(`${tests.every(t => t[1]) ? "MATCH  " : tests.some(t => t[1]) ? "partial" : "-      "} ${name} (${tests.map(t => `${t[0]} ${t[1] ? "yes" : "no"}`).join(", ")})`);
  }
  console.log(rows.join("\n"));
  console.log(`\n${checked} campuses checked, ${hits} of ${possible} marks found.`);
  // Each mark matches by chance 1 in 100 (coordinates) or 1 in 4 (color); unmatched marks are ignored, which overstates the chance.
  const expected = possible ? possible * 0.1 : 0;
  if (hits > Math.max(3, expected * 3)) console.log(`Strong sign of copying: matching this many by chance is about 1 in 10^${Math.floor(-log10chance)}. Keep this output, the file and where you found it, and talk to a lawyer.`);
  else console.log("No clear sign of copying (the marks may have been rounded away, or the data was collected independently).");
} else {
  console.log("Usage:\n  node tools/fingerprint-campus.mjs keygen\n  node tools/fingerprint-campus.mjs stamp <campus.json> <out.json> --key <key>\n  node tools/fingerprint-campus.mjs check <suspect.json> --key <key>");
  process.exit(command ? 1 : 0);
}
