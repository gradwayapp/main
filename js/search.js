// Place search, ported from GradWayMapViewController.performSearch:
//   1. Search the campus box and keep only results inside it.
//   2. If nothing is there (and it isn't an exact building lookup), widen to
//      circles of 3, 6, 10 and 15 miles around the campus center, stopping at
//      the first circle that finds something.
//   3. Sort by distance from the user (or the campus center without a fix).
// The caller then branches on the count: 0, 1 or many.

import { bboxOf, distanceMeters, isInside, regionAround, METERS_PER_MILE } from "./data.js";

const EXPANSION_RADII_MILES = [3, 6, 10, 15];

/**
 * Quick searches. Each maps to OpenStreetMap tags, the web stand-in for the
 * Apple Maps point-of-interest categories the app filters on.
 */
export const CATEGORIES = {
  library:  { label: "Library",  icon: "library",  query: "library",  tags: [["amenity", "library"]] },
  coffee:   { label: "Coffee",   icon: "coffee",   query: "coffee",   tags: [["amenity", "cafe"]] },
  food:     { label: "Food",     icon: "food",     query: "food",     tags: [["amenity", "restaurant"], ["amenity", "fast_food"], ["amenity", "food_court"]] },
  parking:  { label: "Parking",  icon: "parking",  query: "parking",  tags: [["amenity", "parking"]] },
  atm:      { label: "ATM",      icon: "atm",      query: "atm",      tags: [["amenity", "atm"], ["amenity", "bank"]] },
  books:    { label: "Bookstore", icon: "book",    query: "bookstore", tags: [["shop", "books"]] },
  pharmacy: { label: "Pharmacy", icon: "pharmacy", query: "pharmacy", tags: [["amenity", "pharmacy"]] },
  gym:      { label: "Gym",      icon: "gym",      query: "gym",      tags: [["leisure", "fitness_centre"], ["leisure", "sports_centre"]] },
  police:   { label: "Police",   icon: "shield",   query: "police",   tags: [["amenity", "police"]] },
  health:   { label: "Health",   icon: "health",   query: "clinic",   tags: [["amenity", "hospital"], ["amenity", "clinic"], ["amenity", "doctors"]] }
};

export const QUICK_CATEGORIES = ["library", "coffee", "food", "parking", "atm", "books", "pharmacy", "gym"];

/** The campus box first, then wider circles, skipping any not meaningfully larger than campus. */
export function searchPasses(campusRegion, isExactLookup) {
  const passes = [{ region: campusRegion, radiusMiles: null }];
  if (isExactLookup) return passes;
  const campusRadiusMeters = Math.max(campusRegion.latDelta, campusRegion.lngDelta * Math.cos(campusRegion.center.lat * Math.PI / 180)) * 111_000 / 2;
  for (const miles of EXPANSION_RADII_MILES) {
    if (miles * METERS_PER_MILE > campusRadiusMeters * 1.25) {
      passes.push({ region: regionAround(campusRegion.center, miles * METERS_PER_MILE * 2), radiusMiles: miles });
    }
  }
  return passes;
}

// MARK: - Providers

function placeName(props) {
  if (props.name) return props.name;
  const street = [props.housenumber, props.street].filter(Boolean).join(" ");
  return street || null;
}

function photonAddress(props) {
  const line = [[props.housenumber, props.street].filter(Boolean).join(" "), props.city].filter(Boolean).join(", ");
  return line || null;
}

/** Photon (OpenStreetMap search by name). `tags` narrows to a category, e.g. [["amenity", "cafe"]]. */
async function photonSearch(config, { query, region, signal, tags = [] }) {
  const params = new URLSearchParams({
    q: query,
    lat: region.center.lat.toFixed(6),
    lon: region.center.lng.toFixed(6),
    bbox: bboxOf(region).map(n => n.toFixed(6)).join(","),
    limit: "25",
    lang: "en"
  });
  tags.forEach(([k, v]) => params.append("osm_tag", `${k}:${v}`));
  const attempt = withTimeout(signal, 10000);
  let response;
  try {
    response = await fetch(`${config.photonURL}?${params}`, { signal: attempt.signal });
  } finally {
    attempt.done();
  }
  if (!response.ok) throw new Error(`Search failed (${response.status})`);
  const json = await response.json();
  return (json.features || []).map(feature => {
    const props = feature.properties || {};
    const [lng, lat] = feature.geometry?.coordinates || [];
    return {
      id: `${props.osm_type || "x"}${props.osm_id || `${lat},${lng}`}`,
      name: placeName(props),
      address: photonAddress(props),
      kind: props.osm_value ? props.osm_value.replace(/_/g, " ") : null,
      lat, lng
    };
  }).filter(item => item.name && Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

const KIND_LABELS = {
  parking: "Parking", atm: "ATM", bank: "Bank", cafe: "Cafe", restaurant: "Restaurant",
  fast_food: "Fast food", food_court: "Food court", library: "Library", books: "Bookstore",
  pharmacy: "Pharmacy", fitness_centre: "Gym", sports_centre: "Sports center",
  police: "Police", hospital: "Hospital", clinic: "Clinic", doctors: "Doctor"
};

/** An AbortSignal that fires on the caller's abort or after `ms`, whichever comes first. */
function withTimeout(parent, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
  const onAbort = () => controller.abort(parent.reason);
  parent?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    done: () => { clearTimeout(timer); parent?.removeEventListener("abort", onAbort); }
  };
}

/** One Overpass query, tried on each server in config.overpassURLs until one answers. */
async function overpassQuery(config, body, signal) {
  const servers = config.overpassURLs || [config.overpassURL].filter(Boolean);
  let lastError = new Error("No Overpass server configured");
  for (const url of servers) {
    const attempt = withTimeout(signal, 9000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(body),
        signal: attempt.signal
      });
      if (!response.ok) throw new Error(`Overpass ${response.status} at ${new URL(url).host}`);
      const json = await response.json();
      if (json.remark && /runtime error|timed out/i.test(json.remark) && !(json.elements || []).length) {
        throw new Error(`Overpass busy at ${new URL(url).host}`);
      }
      return json;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      console.warn("GradWay: Overpass server failed, trying the next one.", error?.message || error);
    } finally {
      attempt.done();
    }
  }
  throw lastError;
}

/** Overpass (OpenStreetMap places by category), for parking lots and other unnamed places. */
async function overpassSearch(config, { category, region, radiusMiles, signal }) {
  const area = radiusMiles
    ? `(around:${Math.round(radiusMiles * METERS_PER_MILE)},${region.center.lat.toFixed(6)},${region.center.lng.toFixed(6)})`
    : (() => { const [w, s, e, n] = bboxOf(region); return `(${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)})`; })();
  const selectors = category.tags.map(([k, v]) => `nwr["${k}"="${v}"]${area};`).join("");
  const body = `[out:json][timeout:15][maxsize:33554432];(${selectors});out center 80;`;
  const json = await overpassQuery(config, body, signal);
  return (json.elements || []).map(el => {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const tags = el.tags || {};
    const value = category.tags.map(([k]) => tags[k]).find(Boolean);
    const kind = KIND_LABELS[value] || category.label;
    const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
    return {
      id: `${el.type}${el.id}`,
      name: tags.name || (tags.operator ? `${kind} · ${tags.operator}` : kind),
      address: street || null,
      kind,
      lat, lng
    };
  }).filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng));
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = `${item.name.toLowerCase()}|${item.lat.toFixed(4)}|${item.lng.toFixed(4)}`;
    if (seen.has(key) || seen.has(item.id)) return false;
    seen.add(key); seen.add(item.id);
    return true;
  });
}

// MARK: - Search

/** Category places for one area: Overpass first, Photon's category filter if every Overpass server fails. */
async function categorySearch(config, { category, region, radiusMiles, signal }) {
  try {
    return await overpassSearch(config, { category, region, radiusMiles, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    console.warn("GradWay: Overpass unavailable, using Photon's category filter.", error?.message || error);
    const area = radiusMiles ? regionAround(region.center, radiusMiles * METERS_PER_MILE * 2) : region;
    return photonSearch(config, { query: category.query, region: area, signal, tags: category.tags });
  }
}

// Category results for this visit, so tapping Coffee twice doesn't ask the servers twice.
const categoryCache = new Map();

/**
 * Runs the passes in order. Returns the first pass's matches that pass the
 * same manual filter the app uses (inside the box, or inside the circle).
 *
 * Category searches ask for fewer, larger areas (campus, then 6 mi, then
 * 15 mi) and apply the 3/6/10/15-mile rings locally, so an empty campus costs
 * at most three requests instead of five.
 */
export async function runSearch(config, { query, categoryKey, campusRegion, isExactLookup, signal, onWidening }) {
  const category = categoryKey ? CATEGORIES[categoryKey] : null;
  const passes = searchPasses(campusRegion, isExactLookup);
  const searchedMaxMiles = passes[passes.length - 1].radiusMiles;

  const filterFor = pass => item => pass.radiusMiles
    ? distanceMeters(item, campusRegion.center) <= pass.radiusMiles * METERS_PER_MILE
    : isInside(item, pass.region);

  if (category) {
    const key = `${categoryKey}|${campusRegion.center.lat.toFixed(4)},${campusRegion.center.lng.toFixed(4)}`;
    if (categoryCache.has(key)) return categoryCache.get(key);

    const fetched = new Map(); // fetch radius (null = campus box) -> items
    const fetchRadiusFor = miles => miles == null ? null : miles <= 6 ? 6 : 15;
    let result = { items: [], expandedToMiles: null, searchedMaxMiles };

    for (let index = 0; index < passes.length; index++) {
      const pass = passes[index];
      const fetchRadius = fetchRadiusFor(pass.radiusMiles);
      if (!fetched.has(fetchRadius)) {
        if (index > 0) onWidening?.();
        const region = fetchRadius == null ? pass.region : regionAround(campusRegion.center, fetchRadius * METERS_PER_MILE * 2);
        fetched.set(fetchRadius, dedupe(await categorySearch(config, { category, region, radiusMiles: fetchRadius, signal })));
      }
      const filtered = fetched.get(fetchRadius).filter(filterFor(pass));
      if (filtered.length) { result = { items: filtered, expandedToMiles: pass.radiusMiles, searchedMaxMiles }; break; }
    }
    categoryCache.set(key, result);
    return result;
  }

  for (let index = 0; index < passes.length; index++) {
    const pass = passes[index];
    const raw = await photonSearch(config, { query, region: pass.region, signal });
    const filtered = dedupe(raw).filter(filterFor(pass));
    if (filtered.length || index === passes.length - 1) {
      return { items: filtered, expandedToMiles: pass.radiusMiles, searchedMaxMiles };
    }
    onWidening?.();
  }
  return { items: [], expandedToMiles: null, searchedMaxMiles };
}

export function sortByDistance(items, reference) {
  return items
    .map(item => ({ ...item, distance: distanceMeters(item, reference) }))
    .sort((a, b) => a.distance - b.distance);
}

/** For exact lookups (a class's building), prefer the closest name match over the first hit. */
export function bestNameMatch(items, name) {
  const target = name.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  const score = item => {
    const n = item.name.toLowerCase().replace(/[^a-z0-9 ]/g, "");
    if (n === target) return 3;
    if (n.startsWith(target) || target.startsWith(n)) return 2;
    if (n.includes(target) || target.includes(n)) return 1;
    return 0;
  };
  return [...items].sort((a, b) => score(b) - score(a))[0];
}
