// Place search. Started as a port of GradWayMapViewController.performSearch;
// the web version now searches everything within 6 miles of campus:
//   - Exact building lookups (a class's building) stay inside the campus box.
//   - Categories show campus results at once (from the weekly campus
//     prefetch), then add places within 6 miles as they arrive.
//   - Names search a 6-mile area in one request.
// The caller sorts by distance and branches on the count: 0, 1 or many.

import { bboxOf, distanceMeters, isInside, regionAround, METERS_PER_MILE } from "./data.js";

export const SEARCH_RADIUS_MILES = 6;

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
      osm: props.osm_type && props.osm_id ? { type: props.osm_type, id: props.osm_id } : null,
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

/** Phone, hours, website and a few useful facts from OpenStreetMap tags. */
export function infoFromTags(tags = {}) {
  const info = {
    phone: tags.phone || tags["contact:phone"] || null,
    hours: tags.opening_hours || null,
    website: tags.website || tags["contact:website"] || tags.url || null,
    cuisine: tags.cuisine ? tags.cuisine.split(";").map(c => c.replace(/_/g, " ")).join(", ") : null,
    wheelchair: tags.wheelchair || null,
    wifi: tags.internet_access === "wlan" || tags.internet_access === "yes" ? "yes" : null,
    fee: tags.fee || null,
    brand: tags.brand || null
  };
  return Object.values(info).some(Boolean) ? info : null;
}

/** A more specific label for unnamed parking: "Parking garage", "Permit parking", ... */
function refineKind(kind, tags) {
  if (tags.amenity !== "parking") return kind;
  if (tags.parking === "multi-storey") return "Parking garage";
  if (tags.parking === "underground") return "Underground parking";
  if (["permit", "private", "customers"].includes(tags.access)) return tags.access === "customers" ? "Customer parking" : "Permit parking";
  return kind;
}

function elementToPlace(el, kind) {
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  const tags = el.tags || {};
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const label = refineKind(kind, tags);
  const unnamed = !tags.name && !tags.ref;
  return {
    id: `${el.type}${el.id}`,
    name: tags.name || (tags.ref ? `${label} ${tags.ref}` : tags.operator ? `${label} · ${tags.operator}` : street ? `${label} · ${tags["addr:street"]}` : label),
    address: street || null,
    kind: label,
    unnamed,
    info: infoFromTags(tags),
    osm: { type: el.type, id: el.id },
    lat, lng
  };
}

/**
 * Unnamed places (most parking lots, many bus stops) are named after the
 * closest named campus building within about 250 m: "Parking · near Lee Hall".
 */
export function nameUnnamed(items, landmarks) {
  if (!landmarks?.length) return items;
  return items.map(item => {
    if (!item.unnamed || item.near) return item;
    let best = null, bestMeters = 250;
    for (const l of landmarks) {
      if (Math.abs(l.lat - item.lat) > 0.004 || Math.abs(l.lng - item.lng) > 0.005) continue;
      const m = distanceMeters(item, l);
      if (m < bestMeters) { best = l; bestMeters = m; }
    }
    return best ? { ...item, near: best.name, name: `${item.kind} · near ${best.name}` } : item;
  });
}

const OSM_TYPES = { N: "node", W: "way", R: "relation", node: "node", way: "way", relation: "relation" };

/**
 * Business details for a place found by name (Photon doesn't return phone or
 * hours): one small Overpass lookup by its OpenStreetMap id, kept for a week.
 */
export async function placeDetails(config, item, signal) {
  if (item.info !== undefined) return item.info || null;
  if (!item.osm && item.findByName) return detailsByName(config, item, signal);
  if (!item.osm) return null;
  const type = OSM_TYPES[item.osm.type];
  if (!type) return null;
  const key = `info.${type}${item.osm.id}`;
  const saved = cacheGet(key, 7 * 86_400_000);
  if (saved) return saved.info;
  const json = await overpassQuery(config, `[out:json][timeout:10];${type}(${Number(item.osm.id)});out tags;`, signal, { timeoutMs: 6000, hedgeMs: 1200 });
  const info = infoFromTags(json.elements?.[0]?.tags);
  cacheSet(key, { info });
  return info;
}

/** Hours and phone for a place known only by its name and spot (tapped on the map). */
async function detailsByName(config, item, signal) {
  const key = `info.name.${item.name}.${item.lat.toFixed(4)},${item.lng.toFixed(4)}`;
  const saved = cacheGet(key, 7 * 86_400_000);
  if (saved) return saved.info;
  const name = item.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const body = `[out:json][timeout:10];nwr(around:80,${item.lat.toFixed(6)},${item.lng.toFixed(6)})["name"="${name}"];out tags center 3;`;
  const json = await overpassQuery(config, body, signal, { timeoutMs: 6000, hedgeMs: 1200 });
  const el = (json.elements || [])[0];
  const info = infoFromTags(el?.tags);
  if (el?.tags) {
    const t = el.tags;
    const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
    if (street) item.address = [street, t["addr:city"]].filter(Boolean).join(", ");
  }
  cacheSet(key, { info });
  return info;
}

/** Overpass (OpenStreetMap places by category), for parking lots and other unnamed places. */
async function overpassSearch(config, { category, region, radiusMiles, signal }) {
  const area = radiusMiles
    ? `(around:${Math.round(radiusMiles * METERS_PER_MILE)},${region.center.lat.toFixed(6)},${region.center.lng.toFixed(6)})`
    : (() => { const [w, s, e, n] = bboxOf(region); return `(${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)})`; })();
  const selectors = category.tags.map(tag => `nwr${tagSelector(tag)}${area};`).join("");
  const body = `[out:json][timeout:15][maxsize:33554432];(${selectors});out center 150;`;
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
  const cached = cacheGet(`poi2.${key}`, PREFETCH_DAYS * 86_400_000);
  if (cached) { const p = Promise.resolve(cached); prefetches.set(key, p); return p; }

  const groups = [
    ...Object.entries(CATEGORIES).map(([k, c]) => [k, c.label, c.tags]),
    ...Object.entries(DETAIL_LAYERS).map(([k, d]) => [k, d.label, d.tags])
  ];
  const [w, s, e, n] = bboxOf(campusRegion);
  const area = `(${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)})`;
  const allTags = [...new Map(groups.flatMap(([, , tags]) => tags).map(t => [t.join("="), t])).values()];
  // Named buildings come along too; they're used to name unnamed lots and stops.
  const body = `[out:json][timeout:25][maxsize:67108864];(${allTags.map(t => `nwr${tagSelector(t)}${area};`).join("")}way["building"]["name"]${area};);out center 3000;`;

  const promise = overpassQuery(config, body, null, { timeoutMs: 20000, hedgeMs: 4000 }).then(json => {
    const byKey = Object.fromEntries(groups.map(([k]) => [k, []]));
    byKey.landmarks = [];
    for (const el of json.elements || []) {
      const tags = el.tags || {};
      if (tags.building && tags.name) {
        const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
        if (Number.isFinite(lat) && Number.isFinite(lng)) byKey.landmarks.push({ name: tags.name, lat, lng });
      }
      for (const [k, label, groupTags] of groups) {
        const hit = groupTags.find(t => matches(tags, t));
        if (!hit) continue;
        const kind = KIND_LABELS[hit[1]] || label.replace(/s$/, "");
        const place = elementToPlace(el, kind);
        if (Number.isFinite(place.lat) && Number.isFinite(place.lng)) byKey[k].push(place);
      }
    }
    for (const k of Object.keys(byKey)) if (k !== "landmarks") byKey[k] = dedupe(nameUnnamed(byKey[k], byKey.landmarks));
    cacheSet(`poi2.${key}`, byKey);
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
 * Returns { items, onCampus, radiusMiles }.
 * `onPartial` is called once with campus-only results for categories, so
 * the list shows at once while places within 6 miles are still loading.
 */
export async function runSearch(config, { query, categoryKey, campusRegion, isExactLookup, signal, onPartial }) {
  const category = categoryKey ? CATEGORIES[categoryKey] : null;
  const radiusMeters = SEARCH_RADIUS_MILES * METERS_PER_MILE;
  const nearby = regionAround(campusRegion.center, radiusMeters * 2);
  const withinRadius = item => distanceMeters(item, campusRegion.center) <= radiusMeters;
  const finish = (items, radiusMiles = SEARCH_RADIUS_MILES) => {
    const list = dedupe(items).filter(radiusMiles ? withinRadius : item => isInside(item, campusRegion));
    return { items: list, onCampus: list.filter(item => isInside(item, campusRegion)).length, radiusMiles };
  };

  // A class's building: campus only, so a same-named building elsewhere never wins.
  if (isExactLookup) {
    return finish(await photonSearch(config, { query, region: campusRegion, signal }), null);
  }

  if (category) {
    const key = `cat6.${categoryKey}.${campusKey(campusRegion)}`;
    const saved = cacheGet(key, 86_400_000);
    if (saved) return saved;

    // Campus results from the weekly prefetch, if it has already run on this device.
    const prefetched = cacheGet(`poi2.${campusKey(campusRegion)}`, PREFETCH_DAYS * 86_400_000);
    const campusItems = (prefetched?.[categoryKey] || []).filter(item => isInside(item, campusRegion));
    if (campusItems.length) onPartial?.(finish(campusItems));

    let near = [];
    try {
      near = await categorySearch(config, { category, region: nearby, radiusMiles: SEARCH_RADIUS_MILES, signal });
    } catch (error) {
      if (signal?.aborted || !campusItems.length) throw error;
      console.warn("GradWay: nearby search failed; showing campus results only.", error?.message || error);
    }
    const result = finish(nameUnnamed([...campusItems, ...near], prefetched?.landmarks));
    if (near.length) cacheSet(key, result);
    return result;
  }

  const key = `q6.${query.toLowerCase()}.${campusKey(campusRegion)}`;
  const saved = cacheGet(key, 3_600_000);
  if (saved) return saved;
  const result = finish(await photonSearch(config, { query, region: nearby, signal }));
  if (result.items.length) cacheSet(key, result);
  return result;
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
