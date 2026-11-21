// Campus data: the same campus.json and field names as the iPhone app's
// CampusData (Models: "Name", "Theme", "Center", "Span", "Buildings", ...).

const METERS_PER_MILE = 1609.34;
const METERS_PER_DEG_LAT = 111_320;

/** Loads the campus list: live file first, bundled sample if that fails. */
export async function loadCampuses(config) {
  const sources = [
    { url: config.campusDataURL, sample: false },
    { url: config.fallbackCampusDataURL, sample: true }
  ].filter(s => s.url);

  for (const source of sources) {
    try {
      const response = await fetch(source.url, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      const list = (json.Campuses || json.campuses || []).map(normalizeCampus).filter(Boolean);
      if (!list.length) throw new Error("No campuses in file");
      list.sort((a, b) => a.name.localeCompare(b.name));
      return { campuses: list, isSample: source.sample };
    } catch (error) {
      console.warn(`GradWay: could not load ${source.url}:`, error);
    }
  }
  return { campuses: [], isSample: false };
}

function clean(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Tolerates bare domains ("alcorn.edu") as the app's visitor mode does. */
function asURL(value) {
  const v = clean(value);
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/** "33.4552, -88.7912" (or "33.4552 -88.7912") to { lat, lng }. */
export function parseCenter(value) {
  const numbers = String(value ?? "").match(/-?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 2) return null;
  const lat = Number(numbers[0]);
  const lng = Number(numbers[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * The app stores Span in square miles (CampusData.spanRegion(fromSqMiles:)).
 * Treat it as a square: side = sqrt(area), converted to degrees.
 */
export function regionFor(center, spanSqMiles) {
  if (!center) return null;
  const area = Number(spanSqMiles) > 0 ? Number(spanSqMiles) : 1.5;
  const sideMeters = Math.sqrt(area) * METERS_PER_MILE;
  const latDelta = sideMeters / METERS_PER_DEG_LAT;
  const lngDelta = latDelta / Math.max(Math.cos(center.lat * Math.PI / 180), 0.2);
  return { center, latDelta, lngDelta };
}

/** Buildings is a String in the app's model; accept lists split by commas, semicolons or new lines. */
function parseBuildings(value) {
  const v = clean(value);
  if (!v) return { names: [], url: null };
  if (/^https?:\/\//i.test(v) || /\.(json|txt)$/i.test(v)) return { names: [], url: v };
  const names = v.split(/[\n;|,]+/).map(s => s.trim()).filter(Boolean);
  return { names: [...new Set(names)].sort((a, b) => a.localeCompare(b)), url: null };
}

/** Optional: Buildings pointing at a file ("buildings/msu.json" or a URL). */
export async function resolveBuildings(campus) {
  if (!campus.buildingsURL || campus.buildings.length) return campus.buildings;
  try {
    const response = await fetch(campus.buildingsURL);
    const text = await response.text();
    let names;
    try {
      const json = JSON.parse(text);
      const list = Array.isArray(json) ? json : (json.Buildings || json.buildings || []);
      names = list.map(item => typeof item === "string" ? item : (item.Name || item.name)).filter(Boolean);
    } catch {
      names = text.split(/[\n;|,]+/).map(s => s.trim()).filter(Boolean);
    }
    campus.buildings = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  } catch (error) {
    console.warn("GradWay: could not load buildings list", error);
  }
  return campus.buildings;
}

export function slugify(name) {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** "Alabama A&M University" to "AAMU", "Mississippi State University" to "MSU". */
export function initials(name) {
  const skip = new Set(["of", "the", "at", "and", "in", "for"]);
  const letters = name.split(/\s+/)
    .filter(word => word && !skip.has(word.toLowerCase()))
    .map(word => (word.match(/[A-Z]/g) || [word[0].toUpperCase()]).join(""))
    .join("");
  return letters.slice(0, 4);
}

// MARK: - Colors

function parseHex(value) {
  const match = String(value ?? "").trim().replace(/^0x/i, "#").match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
}

const toHex = rgb => "#" + rgb.map(c => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("");

function luminance([r, g, b]) {
  const channel = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The app's accentColor: the campus color, lifted until it reads on the dark
 * navy background (WCAG AA, 4.5:1) so labels like "GRADWAY" stay legible.
 */
function accentFor(themeRGB) {
  const background = [13, 19, 34];
  const [hue, sat, light] = toHSL(themeRGB);
  // Raise lightness, keep the hue and keep it saturated so maroon reads as a bright rose, not a muddy brown.
  const s = Math.max(sat, 0.55);
  for (let l = light; l <= 0.92; l += 0.02) {
    const rgb = fromHSL(hue, s, l);
    if (contrast(rgb, background) >= 4.5) return rgb;
  }
  return fromHSL(hue, s, 0.92);
}

function toHSL([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hue / 6, s, l];
}

function fromHSL(hue, s, l) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(hue + 1 / 3), f(hue), f(hue - 1 / 3)].map(c => c * 255);
}

export function normalizeCampus(raw) {
  const name = clean(raw?.Name);
  if (!name) return null;
  const themeRGB = parseHex(raw.Theme) || [110, 30, 40];
  const center = parseCenter(raw.Center);
  const buildings = parseBuildings(raw.Buildings);
  const logo = clean(raw.Logo);

  return {
    name,
    slug: slugify(name),
    initials: initials(name),
    logoURL: logo && /^https?:\/\//i.test(logo) ? logo : null,
    theme: toHex(themeRGB),
    themeRGB: themeRGB.join(" "),
    accent: toHex(accentFor(themeRGB)),
    center,
    region: regionFor(center, raw.Span),
    links: {
      student: asURL(raw.Student),
      academic: asURL(raw["Academic Calendar"]),
      bookstore: asURL(raw.Bookstore),
      website: asURL(raw.edu),
      dining: asURL(raw.Dining),
      events: asURL(raw.Events),
      emergency: asURL(raw.Emergency),
      sports: asURL(raw.Sports),
      news: asURL(raw.News)
    },
    socials: {
      facebook: asURL(raw.Facebook),
      instagram: asURL(raw.Instagram),
      tiktok: asURL(raw.Tiktok)
    },
    buildings: buildings.names,
    buildingsURL: buildings.url
  };
}

// MARK: - Geometry

export function distanceMeters(a, b) {
  const R = 6_371_000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A square region `meters` on a side, like MKCoordinateRegion(center:latitudinalMeters:longitudinalMeters:). */
export function regionAround(center, meters) {
  const latDelta = meters / METERS_PER_DEG_LAT;
  const lngDelta = latDelta / Math.max(Math.cos(center.lat * Math.PI / 180), 0.2);
  return { center, latDelta, lngDelta };
}

/** [minLng, minLat, maxLng, maxLat] */
export function bboxOf(region) {
  const { center, latDelta, lngDelta } = region;
  return [center.lng - lngDelta / 2, center.lat - latDelta / 2, center.lng + lngDelta / 2, center.lat + latDelta / 2];
}

export function isInside(point, region) {
  const [minLng, minLat, maxLng, maxLat] = bboxOf(region);
  return point.lat >= minLat && point.lat <= maxLat && point.lng >= minLng && point.lng <= maxLng;
}

export function formatDistance(meters) {
  const feet = meters * 3.28084;
  if (feet < 1000) return `${Math.max(10, Math.round(feet / 10) * 10)} ft`;
  const miles = meters / METERS_PER_MILE;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

/** Straight-line distance with a 25% allowance for paths, at about 3 mph. */
export function walkMinutes(meters) {
  return Math.max(1, Math.round((meters * 1.25) / 1.34 / 60));
}

export { METERS_PER_MILE };
