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
 * Categories. Each maps to OpenStreetMap tags, the web stand-in for the Apple Maps
 * point-of-interest categories the app filters on.
 *
 * `tags` is a list of selectors; a place matches if it fits any one of them. A selector
 * is either one [key, value] pair or a list of pairs that must all fit. A value starting
 * with "~" is a pattern (case doesn't matter): ["cuisine", "~coffee"] matches
 * "coffee_shop" and "donut;coffee_shop".
 */
const COFFEE_BRANDS = "~^(starbucks|dunkin|dutch bros|peet|tim hortons|caribou|scooter|pj.?s coffee|biggby|black rifle|ziggi|human bean|7 brew|seven brew|tropical smoothie|panera)";
const EAT = "~^(restaurant|fast_food|food_court|cafe)$";
const food = (cuisine, extra = []) => [[["amenity", EAT], ["cuisine", `~${cuisine}`]], ...extra];

export const CATEGORIES = {
  library:  { label: "Library",  icon: "library",  query: "library",  tags: [["amenity", "library"]] },
  coffee:   { label: "Coffee",   icon: "coffee",   query: "coffee",
              tags: [["amenity", "cafe"], ["shop", "coffee"], [["amenity", "fast_food"], ["cuisine", "~coffee|donut"]], ["brand", COFFEE_BRANDS], ["name", COFFEE_BRANDS]] },
  food:     { label: "Food",     icon: "food",     query: "food",     tags: [["amenity", "restaurant"], ["amenity", "fast_food"], ["amenity", "food_court"]] },
  parking:  { label: "Parking",  icon: "parking",  query: "parking",  tags: [["amenity", "parking"]] },
  atm:      { label: "ATM",      icon: "atm",      query: "atm",      tags: [["amenity", "atm"], ["amenity", "bank"]] },
  books:    { label: "Bookstore", icon: "book",    query: "bookstore", tags: [["shop", "books"]] },
  pharmacy: { label: "Pharmacy", icon: "pharmacy", query: "pharmacy", tags: [["amenity", "pharmacy"], ["healthcare", "pharmacy"], ["shop", "chemist"]] },
  gym:      { label: "Gym",      icon: "gym",      query: "gym",      tags: [["leisure", "fitness_centre"], ["leisure", "sports_centre"], ["amenity", "gym"], ["sport", "fitness"]] },
  police:   { label: "Police",   icon: "shield",   query: "police",   tags: [["amenity", "police"]] },
  health:   { label: "Health",   icon: "health",   query: "clinic",   tags: [["amenity", "hospital"], ["amenity", "clinic"], ["amenity", "doctors"], ["healthcare", "~clinic|centre|hospital|doctor"]] },
  // Found by typing, not by a quick button:
  grocery:  { label: "Groceries", icon: "food",    query: "grocery",  tags: [["shop", "supermarket"], ["shop", "convenience"], ["shop", "greengrocer"]] },
  gas:      { label: "Gas",      icon: "car",      query: "gas station", tags: [["amenity", "fuel"]] },
  charging: { label: "EV charging", icon: "car",   query: "charging station", tags: [["amenity", "charging_station"]] },
  hotel:    { label: "Hotels",   icon: "building", query: "hotel",    tags: [["tourism", "hotel"], ["tourism", "motel"], ["tourism", "guest_house"]] },
  restroom: { label: "Restrooms", icon: "restroom", query: "restroom", tags: [["amenity", "toilets"]] },
  water:    { label: "Water fountains", icon: "water", query: "water fountain", tags: [["amenity", "drinking_water"]] },
  bus:      { label: "Bus stops", icon: "bus",     query: "bus stop", tags: [["highway", "bus_stop"], ["public_transport", "platform"]] },
  bikes:    { label: "Bikes",    icon: "bike",     query: "bike",     tags: [["amenity", "bicycle_parking"], ["amenity", "bicycle_rental"], ["shop", "bicycle"], ["amenity", "bicycle_repair_station"]] },
  print:    { label: "Printing", icon: "book",     query: "print shop", tags: [["shop", "copyshop"], ["amenity", "printer"], ["craft", "printer"]] },
  post:     { label: "Mail",     icon: "building", query: "post office", tags: [["amenity", "post_office"], ["shop", "~^(shipping|post)"], ["amenity", "parcel_locker"]] },
  laundry:  { label: "Laundry",  icon: "building", query: "laundry",  tags: [["shop", "laundry"], ["shop", "dry_cleaning"]] },
  bar:      { label: "Bars",     icon: "food",     query: "bar",      tags: [["amenity", "bar"], ["amenity", "pub"], ["amenity", "biergarten"]] },
  dessert:  { label: "Dessert",  icon: "food",     query: "dessert",  tags: [["amenity", "ice_cream"], ["shop", "ice_cream"], ["shop", "confectionery"], ["shop", "pastry"], ...food("ice_cream|frozen_yogurt|dessert|cake")] },
  bakery:   { label: "Bakeries and donuts", icon: "food", query: "bakery", tags: [["shop", "bakery"], ...food("donut|bagel|bakery")] },
  pizza:    { label: "Pizza",    icon: "food",     query: "pizza",    tags: food("pizza", [["name", "~pizza|domino|papa john|little caesar"]]) },
  burgers:  { label: "Burgers",  icon: "food",     query: "burger",   tags: food("burger", [["name", "~burger|mcdonald|wendy|sonic|whataburger|five guys|checkers|culver"]]) },
  chicken:  { label: "Chicken",  icon: "food",     query: "chicken",  tags: food("chicken|wings", [["name", "~chick|chicken|wing|popeyes|kfc|zaxby|cane"]]) },
  mexican:  { label: "Mexican",  icon: "food",     query: "mexican",  tags: food("mexican|tex-mex|taco|burrito", [["name", "~taco|chipotle|moe.?s|qdoba|burrito"]]) },
  sandwich: { label: "Sandwiches", icon: "food",   query: "sandwich", tags: food("sandwich|sub|deli", [["name", "~subway|jimmy john|jersey mike|firehouse|potbelly|which wich"]]) },
  asian:    { label: "Asian",    icon: "food",     query: "asian",    tags: food("asian|chinese|japanese|sushi|thai|vietnamese|korean|ramen|indian|pho") },
  bbq:      { label: "Barbecue", icon: "food",     query: "bbq",      tags: food("bbq|barbecue") },
  breakfast:{ label: "Breakfast", icon: "food",    query: "breakfast", tags: food("breakfast|pancake|waffle|bagel|donut", [["name", "~waffle house|ihop|biscuit|first watch|denny"]]) },
  drinks:   { label: "Smoothies and tea", icon: "coffee", query: "smoothie", tags: food("bubble_tea|juice|smoothie|tea", [["name", "~smoothie|boba|tea|juice"]]) }
};

/**
 * What people type, mapped to a category: "coffee", "starbucks near me", "fitness",
 * "where can I eat", "fast food", "textbooks"... Anything else is searched by name.
 */
const INTENTS = [
  ["coffee", "coffee coffees cafe cafes café latte espresso cappuccino coffee shop coffee shops"],
  ["food", "food foods eat eating restaurant restaurants dining dine lunch dinner meal meals fast food fastfood takeout take out drive thru drive through hungry snack snacks grub dining hall cafeteria food court"],
  ["breakfast", "breakfast brunch pancakes waffles"],
  ["pizza", "pizza pizzas"],
  ["burgers", "burger burgers hamburger hamburgers"],
  ["chicken", "chicken wings chicken tenders"],
  ["mexican", "mexican tacos taco burrito burritos tex mex"],
  ["sandwich", "sandwich sandwiches subs sub deli"],
  ["asian", "asian chinese sushi japanese thai pho ramen korean indian vietnamese hibachi"],
  ["bbq", "bbq barbecue barbeque"],
  ["dessert", "dessert desserts ice cream froyo frozen yogurt sweets candy cake"],
  ["bakery", "bakery bakeries donut donuts doughnut doughnuts bagel bagels pastry"],
  ["drinks", "smoothie smoothies boba bubble tea juice tea"],
  ["gym", "gym gyms fitness fitness center workout work out exercise weights weight room rec rec center recreation recreation center wellness center crossfit yoga"],
  ["library", "library libraries study study spot study spots quiet place study room study rooms"],
  ["parking", "parking park parking lot parking lots lot lots garage parking garage parking deck deck where to park visitor parking"],
  ["atm", "atm atms cash bank banks money withdraw"],
  ["books", "bookstore bookstores books textbook textbooks book store"],
  ["pharmacy", "pharmacy pharmacies drugstore drug store medicine prescription prescriptions"],
  ["health", "health clinic doctor doctors hospital urgent care health center student health medical er emergency room"],
  ["police", "police campus police security public safety"],
  ["grocery", "grocery groceries supermarket supermarkets grocery store convenience store corner store"],
  ["gas", "gas gas station gas stations fuel"],
  ["charging", "ev charging charger chargers charging station ev"],
  ["hotel", "hotel hotels motel motels lodging place to stay inn"],
  ["restroom", "restroom restrooms bathroom bathrooms toilet toilets washroom"],
  ["water", "water water fountain water fountains drinking water bottle filler"],
  ["bus", "bus buses bus stop bus stops shuttle shuttles transit"],
  ["bikes", "bike bikes bicycle bike rack bike racks bike rental bike share bike shop scooter scooters"],
  ["print", "print printing printer printers copy copies print shop"],
  ["post", "post office mail mailbox shipping package packages"],
  ["laundry", "laundry laundromat dry cleaning dry cleaner"],
  ["bar", "bar bars pub pubs drinks nightlife brewery"]
];
const FILLER = new Set("a an the near me nearby nearest closest close around on off in at by campus best good great cheap open now find where wheres where's is are some any place places spot spots i want need get to for of can go somewhere".split(" "));
const singular = w => (w.length > 4 && w.endsWith("ies") ? w.slice(0, -3) + "y" : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const INTENT_PHRASES = new Map();
// Words that only mean something as part of a longer phrase ("food court", "bus stop", "Lee Hall").
const NOT_ALONE = new Set(("court drive thru through take out hall tim horton dutch bro shop room work lot garage deck where to park store station stop center " +
  "student office fast ice cream frozen bubble place stay care urgent emergency public safety campus corner convenience bottle filler drinking fil a raising " +
  "jersey jimmy papa little five guy mike john caesar house rental share rack repair dry cleaning cleaner weight tex quiet spot visitor caribou peet " +
  "chick wendy sonic subway target walmart kroger ups er").split(" "));
for (const [key, list] of INTENTS) {
  for (const word of list.split(" ").map(singular)) if (!NOT_ALONE.has(word)) INTENT_PHRASES.set(word, key);
}
for (const [key, phrases] of Object.entries({
  food: ["fast food", "drive thru", "drive through", "take out", "dining hall", "food court", "where to eat", "something to eat", "place to eat"], coffee: ["coffee shop"],
  chicken: ["chicken tender"], mexican: ["tex mex"], dessert: ["ice cream", "frozen yogurt"], drinks: ["bubble tea"],
  gym: ["fitness center", "work out", "weight room", "rec center", "recreation center", "wellness center"], library: ["study spot", "quiet place", "study room"],
  parking: ["parking lot", "parking garage", "parking deck", "where to park", "visitor parking"], books: ["book store"], pharmacy: ["drug store"],
  health: ["urgent care", "health center", "student health", "emergency room"], police: ["campus police", "public safety"],
  grocery: ["grocery store", "convenience store", "corner store"], gas: ["gas station"], charging: ["ev charging", "charging station"], hotel: ["place to stay"],
  water: ["water fountain", "drinking water", "bottle filler"], bus: ["bus stop"], bikes: ["bike rack", "bike rental", "bike share", "bike shop"],
  print: ["print shop"], post: ["post office"], laundry: ["dry cleaning", "dry cleaner"]
})) for (const p of phrases) INTENT_PHRASES.set(p.split(" ").map(singular).join(" "), key);

/** The category a typed search means, or null to search by name. */
export function intentFor(query) {
  const raw = String(query).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/).filter(Boolean);
  const words = raw.map(singular);
  if (INTENT_PHRASES.has(words.join(" "))) return INTENT_PHRASES.get(words.join(" "));
  const meaningful = raw.filter(w => !FILLER.has(w)).map(singular);
  if (!meaningful.length || meaningful.length > 4) return null;
  const phrase = meaningful.join(" ");
  if (INTENT_PHRASES.has(phrase)) return INTENT_PHRASES.get(phrase);
  // One known word with a modifier ("cheap pizza", "late night food", "24 hour gym").
  const MODIFIERS = new Set("late night 24 hour hours cheap quick fast healthy local student free fresh hot".split(" "));
  const rest = meaningful.filter(w => !MODIFIERS.has(w));
  if (rest.length && rest.length <= 3 && INTENT_PHRASES.has(rest.join(" "))) return INTENT_PHRASES.get(rest.join(" "));
  return null;
}

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
  toilets: "Restroom", drinking_water: "Water fountain",
  supermarket: "Grocery store", convenience: "Convenience store", greengrocer: "Grocer", fuel: "Gas station", charging_station: "EV charging",
  hotel: "Hotel", motel: "Motel", guest_house: "Guest house", copyshop: "Print shop", printer: "Printer", post_office: "Post office",
  parcel_locker: "Parcel locker", laundry: "Laundry", dry_cleaning: "Dry cleaner", bar: "Bar", pub: "Pub", ice_cream: "Ice cream",
  bakery: "Bakery", confectionery: "Sweets", pastry: "Pastry", coffee: "Coffee", chemist: "Drugstore", gym: "Gym",
  bicycle_rental: "Bike rental", bicycle: "Bike shop", bicycle_repair_station: "Bike repair", platform: "Bus stop"
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

/** A selector is [key, value] or a list of them that must all fit. Values starting with "~" are patterns. */
const conditions = selector => (typeof selector[0] === "string" ? [selector] : selector);
const tagSelector = selector => conditions(selector)
  .map(([k, v]) => (v === "*" ? `["${k}"]` : v.startsWith("~") ? `["${k}"~"${v.slice(1).replace(/"/g, '\\"')}",i]` : `["${k}"="${v}"]`)).join("");
const patterns = new Map();
const matches = (tags, selector) => conditions(selector).every(([k, v]) => {
  if (tags[k] == null) return false;
  if (v === "*") return true;
  if (!v.startsWith("~")) return tags[k] === v;
  if (!patterns.has(v)) patterns.set(v, new RegExp(v.slice(1), "i"));
  return patterns.get(v).test(tags[k]);
});
/** The tag value that names what a place is (for its label): amenity, shop, leisure... */
const mainValue = tags => tags.amenity || tags.shop || tags.leisure || tags.tourism || tags.healthcare || tags.highway || tags.craft || null;

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
/** "Coffee shop", "Fast food", "Pizza"... from a place's tags. */
function kindFor(tags, fallback) {
  const value = mainValue(tags);
  const cuisine = String(tags.cuisine || "").split(";")[0];
  if (value === "fast_food" && /coffee|donut/.test(cuisine)) return "Coffee and donuts";
  if ((value === "fast_food" || value === "restaurant") && cuisine && CUISINE_LABELS[cuisine]) return CUISINE_LABELS[cuisine];
  return KIND_LABELS[value] || fallback;
}
const CUISINE_LABELS = { pizza: "Pizza", burger: "Burgers", chicken: "Chicken", mexican: "Mexican", sandwich: "Sandwiches", sushi: "Sushi", chinese: "Chinese",
  japanese: "Japanese", thai: "Thai", indian: "Indian", bbq: "Barbecue", barbecue: "Barbecue", coffee_shop: "Coffee shop", ice_cream: "Ice cream", italian: "Italian",
  american: "American", seafood: "Seafood", breakfast: "Breakfast", donut: "Donuts", bagel: "Bagels", wings: "Wings", vietnamese: "Vietnamese", korean: "Korean", tex_mex: "Tex-Mex" };

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
    return elementToPlace(el, kindFor(tags, category.label));
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
  water:     { label: "Water fountains",  short: "Water",             icon: "water",   tags: [["amenity", "drinking_water"]] },
  // Accessibility
  accessParking: { label: "Accessible parking", short: "Accessible parking", icon: "wheelchair", group: "Accessibility",
    tags: [[["amenity", "parking_space"], ["parking_space", "disabled"]], [["amenity", "parking_space"], ["wheelchair", "~^(yes|designated)$"]], [["amenity", "parking"], ["capacity:disabled", "~^([1-9]|yes)"]]] },
  entrances: { label: "Accessible entrances", short: "Accessible entrances", icon: "wheelchair", group: "Accessibility",
    tags: [[["entrance", "*"], ["wheelchair", "~^(yes|designated)$"]], [["door", "*"], ["automatic_door", "~^(yes|button|motion)"]]] },
  elevators: { label: "Elevators", short: "Elevators", icon: "elevator", group: "Accessibility", tags: [["highway", "elevator"]] }
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
  const cached = cacheGet(`poi3.${key}`, PREFETCH_DAYS * 86_400_000);
  if (cached) { const p = Promise.resolve(cached); prefetches.set(key, p); return p; }

  const groups = [
    ...QUICK_CATEGORIES.map(k => [k, CATEGORIES[k].label, CATEGORIES[k].tags]),
    ...Object.entries(DETAIL_LAYERS).map(([k, d]) => [k, d.label, d.tags])
  ];
  const [w, s, e, n] = bboxOf(campusRegion);
  const area = `(${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)})`;
  const allTags = [...new Map(groups.flatMap(([, , tags]) => tags).map(t => [JSON.stringify(t), t])).values()];
  // Named buildings come along too; they're used to name unnamed lots and stops.
  const body = `[out:json][timeout:25][maxsize:67108864];(${allTags.map(t => `nwr${tagSelector(t)}${area};`).join("")}way["building"]["name"]${area};);out center 3000;`;

  const promise = overpassQuery(config, body, null, { timeoutMs: 20000, hedgeMs: 4000 }).then(json => {
    const byKey = Object.fromEntries(groups.map(([k]) => [k, []]));
    byKey.landmarks = [];
    for (const el of json.elements || []) {
      const tags = el.tags || {};
      if (tags.building && tags.name) {
        const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
        if (Number.isFinite(lat) && Number.isFinite(lng)) byKey.landmarks.push({ name: tags.name, lat, lng, kind: "Building", osm: { type: el.type, id: el.id }, id: `${el.type}${el.id}` });
      }
      for (const [k, label, groupTags] of groups) {
        const hit = groupTags.find(t => matches(tags, t));
        if (!hit) continue;
        const kind = kindFor(tags, label.replace(/s$/, ""));
        const place = elementToPlace(el, kind);
        if (Number.isFinite(place.lat) && Number.isFinite(place.lng)) byKey[k].push(place);
      }
    }
    for (const k of Object.keys(byKey)) if (k !== "landmarks") byKey[k] = dedupe(nameUnnamed(byKey[k], byKey.landmarks));
    cacheSet(`poi3.${key}`, byKey);
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
  const simple = category.tags.filter(t => typeof t[0] === "string" && !t[1].startsWith("~"));
  const photon = photonSearch(config, { query: category.query, region: area, signal, tags: simple });
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

  // Buildings and places already saved on this device answer name searches instantly and offline.
  const prefetched = cacheGet(`poi3.${campusKey(campusRegion)}`, PREFETCH_DAYS * 86_400_000);
  const local = query ? localNameMatches(prefetched, query) : [];

  // A class's building: campus only, so a same-named building elsewhere never wins.
  if (isExactLookup) {
    const onCampus = local.filter(item => isInside(item, campusRegion));
    if (onCampus.length) return finish(onCampus, null);
    return finish(await nameSearch(config, { query, region: campusRegion, signal }), null);
  }

  if (category) {
    const key = `cat7.${categoryKey}.${campusKey(campusRegion)}`;
    const saved = cacheGet(key, 86_400_000);
    if (saved) return saved;

    // Campus results from the weekly prefetch, if it has already run on this device.
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

  const key = `q7.${query.toLowerCase()}.${campusKey(campusRegion)}`;
  const saved = cacheGet(key, 3_600_000);
  if (saved) return saved;
  if (local.length) onPartial?.(finish(local));
  let found = [];
  try {
    found = await nameSearch(config, { query, region: nearby, campusRegion, signal });
  } catch (error) {
    // The search services are busy or down: what's saved on this device is still an answer.
    if (signal?.aborted || !local.length) throw error;
    console.warn("GradWay: name search failed; showing saved campus results.", error?.message || error);
    return finish(local);
  }
  const result = finish([...local, ...found]);
  if (found.length) cacheSet(key, result);
  return result;
}

const normName = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Saved campus buildings and places whose name contains every word typed ("lee hall", "crump"). */
function localNameMatches(prefetched, query) {
  if (!prefetched) return [];
  const words = normName(query).split(" ").filter(w => w.length > 1 || /\d/.test(w));
  if (!words.length) return [];
  const pool = Object.values(prefetched).flat().filter(item => item && item.name);
  // Places with full OpenStreetMap details first, so hours and phone can load.
  const hits = pool.filter(item => { const n = normName(item.name); return words.every(w => n.includes(w)); })
    .sort((a, b) => (a.osm ? 0 : 1) - (b.osm ? 0 : 1));
  return dedupe(hits.map(item => ({ id: item.id || `local:${item.name}:${item.lat.toFixed(5)}`, kind: item.kind || "Building", ...item })));
}

const regexEscape = s => s.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&");

/**
 * Finds places by name. Photon (OpenStreetMap search) is quick but is a free shared
 * service that can be busy, so it gets one retry, and if it hasn't answered in
 * 2.5 seconds an OpenStreetMap name lookup on campus runs alongside it.
 */
async function nameSearch(config, { query, region, campusRegion = region, signal }) {
  const photon = photonSearch(config, { query, region, signal }).catch(async error => {
    if (signal?.aborted) throw error;
    await delay(700);
    return photonSearch(config, { query, region, signal });
  });
  const quick = await Promise.race([photon.then(r => ({ r }), () => null), delay(2500).then(() => null)]);
  if (quick?.r.length) return quick.r;
  const words = normName(query).split(" ").filter(Boolean);
  if (!words.length) return photon;
  const [w, s, e, n] = bboxOf(campusRegion);
  const pattern = words.map(regexEscape).join(".*");
  const body = `[out:json][timeout:10];nwr["name"~"${pattern}",i](${s.toFixed(6)},${w.toFixed(6)},${n.toFixed(6)},${e.toFixed(6)});out center 40;`;
  const overpass = overpassQuery(config, body, signal, { timeoutMs: 9000, hedgeMs: 2000 })
    .then(json => (json.elements || []).map(el => elementToPlace(el, kindFor(el.tags || {}, "Place"))).filter(p => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng)));
  return firstNonEmpty([photon, overpass]);
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
