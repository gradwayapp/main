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
  police: "Police", hospital: "Hospital", clinic: "Clinic", doctors: "Doctor",
  phone: "Emergency phone", defibrillator: "AED", bus_stop: "Bus stop", bicycle_parking: "Bike rack",
  toilets: "Restroom", drinking_water: "Water fountain"
};

/** An AbortSignal that fires on the caller's abort or after `ms`, whichever comes first. */
function withTimeout(parent, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
  const onAbort = () => controller.abort(parent.reason);
  parent?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    abort: () => controller.abort(new DOMException("Not needed", "AbortError")),
    done: () => { clearTimeout(timer); parent?.removeEventListener("abort", onAbort); }
  };
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function overpassFetch(url, body, signal) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(body),
    signal
  });
  if (!response.ok) throw new Error(`Overpass ${response.status} at ${new URL(url).host}`);
  const json = await response.json();
  if (json.remark && /runtime error|timed out/i.test(json.remark) && !(json.elements || []).length) {
    throw new Error(`Overpass busy at ${new URL(url).host}`);
  }
  return json;
}

/**
 * One Overpass query with "hedged" requests: ask the first server; if it
 * hasn't answered in 2.5 seconds (or fails), also ask the next one, and use
 * whichever answers first. The slower request is cancelled.
 */
async function overpassQuery(config, body, signal, { timeoutMs = 10000, hedgeMs = 2500 } = {}) {
  const servers = config.overpassURLs || [config.overpassURL].filter(Boolean);
  if (!servers.length) throw new Error("No Overpass server configured");
  const attempts = [];
  return new Promise((resolve, reject) => {
    let finished = false, failures = 0, started = 0, lastError;
    const finish = (fn, value) => {
      if (finished) return;
      finished = true;
      attempts.forEach(a => { a.abort(); a.done(); });
      fn(value);
    };
    const startNext = () => {
      if (finished || started >= servers.length) return;
      const url = servers[started++];
      const attempt = withTimeout(signal, timeoutMs);
      attempts.push(attempt);
      overpassFetch(url, body, attempt.signal)
        .then(json => finish(resolve, json))
        .catch(error => {
          if (signal?.aborted) return finish(reject, error);
          if (finished) return;
          lastError = error;
          console.warn("GradWay: Overpass server failed.", error?.message || error);
          if (++failures >= servers.length) finish(reject, lastError);
          else startNext(); // a failure moves on at once
        });
      // Hedge: if this one is slow, start the next server too.
      setTimeout(() => { if (!finished && started === servers.indexOf(url) + 1) startNext(); }, hedgeMs);
    };
    startNext();
  });
}

const tagSelector = ([k, v]) => `["${k}"="${v}"]`;
const matches = (tags, [k, v]) => tags[k] === v;

function elementToPlace(el, kind) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  const tags = el.tags || {};
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  return {
    id: `${el.type}${el.id}`,
    name: tags.name || (tags.operator ? `${kind} · ${tags.operator}` : tags.ref ? `${kind} ${tags.ref}` : kind),
    address: street || null,
    kind,
    lat, lng
  };
}

/** Overpass (OpenStreetMap places by category), for parking lots and other unnamed places. */
async function overpassSearch(config, { category, region, radiusMiles, signal }) {
  const area = radiusMiles
    ? `(around:${Math.round(radiusMiles * METERS_PER_MILE)},${region.center.lat.toFixed(6)},${region.center.lng.toFixed(6)})`
    : (() => { const [w, s, e, n] = bboxOf(region); return `(${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)})`; })();
  const selectors = category.tags.map(tag => `nwr${tagSelector(tag)}${area};`).join("");
  const body = `[out:json][timeout:15][maxsize:33554432];(${selectors});out center 80;`;
  const json = await overpassQuery(config, body, signal);
  return (json.elements || []).map(el => {
    const tags = el.tags || {};
    const value = category.tags.map(([k]) => tags[k]).find(Boolean);
    return elementToPlace(el, KIND_LABELS[value] || category.label);
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

// MARK: - Saved results (localStorage, wrapped so private browsing still works)

const CACHE_PREFIX = "gradway.cache.";
function cacheGet(key, maxAgeMs) {
  try {
    const entry = JSON.parse(localStorage.getItem(CACHE_PREFIX + key));
    if (entry && Date.now() - entry.t < maxAgeMs) return entry.v;
  } catch { /* storage unavailable */ }
  return null;
}
function cacheSet(key, value) {
  try { localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value })); } catch { /* full or blocked */ }
}

// MARK: - Map details (overlays)

/** Extra things to show on the map, from OpenStreetMap. */
export const DETAIL_LAYERS = {
  phones:    { label: "Emergency phones", short: "Blue-light phones", icon: "phone",   tags: [["emergency", "phone"]] },
  aed:       { label: "AEDs",             short: "AEDs",              icon: "health",  tags: [["emergency", "defibrillator"]] },
  bus:       { label: "Bus stops",        short: "Bus stops",         icon: "bus",     tags: [["highway", "bus_stop"]] },
  bikes:     { label: "Bike racks",       short: "Bike racks",        icon: "bike",    tags: [["amenity", "bicycle_parking"]] },
  restrooms: { label: "Restrooms",        short: "Restrooms",         icon: "restroom", tags: [["amenity", "toilets"]] },
  water:     { label: "Water fountains",  short: "Water",             icon: "water",   tags: [["amenity", "drinking_water"]] }
};

// MARK: - Campus prefetch

const PREFETCH_DAYS = 7;
const prefetches = new Map();
const campusKey = region => `${region.center.lat.toFixed(4)},${region.center.lng.toFixed(4)}`;

/**
 * One Overpass request per campus per week that fetches every quick category
 * and every map detail inside the campus box. After that, tapping Library or
 * Coffee answers from this device with no network wait.
 * Returns { [key]: places[] } for CATEGORIES and DETAIL_LAYERS keys.
 */
export function prefetchCampus(config, campusRegion) {
  const key = campusKey(campusRegion);
  if (prefetches.has(key)) return prefetches.get(key);
  const cached = cacheGet(`poi.${key}`, PREFETCH_DAYS * 86_400_000);
  if (cached) { const p = Promise.resolve(cached); prefetches.set(key, p); return p; }

  const groups = [
    ...Object.entries(CATEGORIES).map(([k, c]) => [k, c.label, c.tags]),
    ...Object.entries(DETAIL_LAYERS).map(([k, d]) => [k, d.label, d.tags])
  ];
  const [w, s, e, n] = bboxOf(campusRegion);
  const area = `(${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)})`;
  const allTags = [...new Map(groups.flatMap(([, , tags]) => tags).map(t => [t.join("="), t])).values()];
  const body = `[out:json][timeout:25][maxsize:67108864];(${allTags.map(t => `nwr${tagSelector(t)}${area};`).join("")});out center 2500;`;

  const promise = overpassQuery(config, body, null, { timeoutMs: 20000, hedgeMs: 4000 }).then(json => {
    const byKey = Object.fromEntries(groups.map(([k]) => [k, []]));
    for (const el of json.elements || []) {
      const tags = el.tags || {};
      for (const [k, label, groupTags] of groups) {
        const hit = groupTags.find(t => matches(tags, t));
        if (!hit) continue;
        const kind = KIND_LABELS[hit[1]] || label.replace(/s$/, "");
        const place = elementToPlace(el, kind);
        if (Number.isFinite(place.lat) && Number.isFinite(place.lng)) byKey[k].push(place);
      }
    }
    for (const k of Object.keys(byKey)) byKey[k] = dedupe(byKey[k]);
    cacheSet(`poi.${key}`, byKey);
    return byKey;
  }).catch(error => {
    prefetches.delete(key); // try again next time
    throw error;
  });
  prefetches.set(key, promise);
  return promise;
}

// MARK: - Search

/** Resolves with the first promise that gives a non-empty list; [] if all are empty; rejects if all fail. */
function firstNonEmpty(promises) {
  return new Promise((resolve, reject) => {
    let pending = promises.length, anySuccess = false, lastError;
    promises.forEach(p => p.then(items => {
      anySuccess = true;
      if (items.length) resolve(items);
      if (--pending === 0) resolve([]);
    }).catch(error => {
      lastError = error;
      if (--pending === 0) anySuccess ? resolve([]) : reject(lastError);
    }));
  });
}

/**
 * Category places for one area. Overpass is complete (it finds unnamed parking
 * lots) but can be slow, so if it hasn't answered in 1.5 seconds Photon's
 * category filter runs alongside it and the first useful answer wins.
 */
async function categorySearch(config, { category, region, radiusMiles, signal }) {
  const overpass = overpassSearch(config, { category, region, radiusMiles, signal });
  const quick = await Promise.race([overpass.then(r => ({ r }), () => null), delay(1500).then(() => null)]);
  if (quick) return quick.r;
  const area = radiusMiles ? regionAround(region.center, radiusMiles * METERS_PER_MILE * 2) : region;
  const photon = photonSearch(config, { query: category.query, region: area, signal, tags: category.tags });
  return firstNonEmpty([overpass, photon]);
}

/**
 * Runs the passes in order. Returns the first pass's matches that pass the
 * same manual filter the app uses (inside the box, or inside the circle).
 *
 * Category searches: the campus box comes from the weekly prefetch (instant
 * once it has run); wider areas ask for 6 and then 15 miles and apply the
 * 3/6/10/15-mile rings locally, so an empty campus costs at most two requests.
 */
export async function runSearch(config, { query, categoryKey, campusRegion, isExactLookup, signal, onWidening }) {
  const category = categoryKey ? CATEGORIES[categoryKey] : null;
  const passes = searchPasses(campusRegion, isExactLookup);
  const searchedMaxMiles = passes[passes.length - 1].radiusMiles;

  const filterFor = pass => item => pass.radiusMiles
    ? distanceMeters(item, campusRegion.center) <= pass.radiusMiles * METERS_PER_MILE
    : isInside(item, pass.region);

  if (category) {
    const resultKey = `cat.${categoryKey}.${campusKey(campusRegion)}`;
    const saved = cacheGet(resultKey, 86_400_000);
    if (saved) return saved;

    const fetched = new Map(); // fetch radius (null = campus box) -> items
    const fetchRadiusFor = miles => miles == null ? null : miles <= 6 ? 6 : 15;
    let result = { items: [], expandedToMiles: null, searchedMaxMiles };

    for (let index = 0; index < passes.length; index++) {
      const pass = passes[index];
      const fetchRadius = fetchRadiusFor(pass.radiusMiles);
      if (!fetched.has(fetchRadius)) {
        if (index > 0) onWidening?.();
        let items;
        if (fetchRadius == null) {
          try {
            items = (await prefetchCampus(config, campusRegion))[categoryKey] || [];
          } catch {
            items = await categorySearch(config, { category, region: pass.region, radiusMiles: null, signal });
          }
        } else {
          const region = regionAround(campusRegion.center, fetchRadius * METERS_PER_MILE * 2);
          items = await categorySearch(config, { category, region, radiusMiles: fetchRadius, signal });
        }
        fetched.set(fetchRadius, dedupe(items));
      }
      const filtered = fetched.get(fetchRadius).filter(filterFor(pass));
      if (filtered.length) { result = { items: filtered, expandedToMiles: pass.radiusMiles, searchedMaxMiles }; break; }
    }
    if (result.items.length) cacheSet(resultKey, result);
    return result;
  }

  const nameKey = `q.${query.toLowerCase()}.${isExactLookup ? 1 : 0}.${campusKey(campusRegion)}`;
  const savedName = cacheGet(nameKey, 3_600_000);
  if (savedName) return savedName;
  for (let index = 0; index < passes.length; index++) {
    const pass = passes[index];
    const raw = await photonSearch(config, { query, region: pass.region, signal });
    const filtered = dedupe(raw).filter(filterFor(pass));
    if (filtered.length || index === passes.length - 1) {
      const result = { items: filtered, expandedToMiles: pass.radiusMiles, searchedMaxMiles };
      if (filtered.length) cacheSet(nameKey, result);
      return result;
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
