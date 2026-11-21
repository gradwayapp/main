// Walking and driving routes from the user's location, using the free
// routing servers openstreetmap.org itself uses (OSRM first, Valhalla if that
// fails; the OSRM demo server as a last resort for driving). No API key.

function timeoutSignal(parent, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
  parent?.addEventListener("abort", () => controller.abort(parent.reason), { once: true });
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function osrmRoute(baseURL, from, to, signal) {
  const coords = `${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;
  // Each server has one profile (foot or car); OSRM still expects a profile name in the path.
  const url = `${baseURL}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`;
  const t = timeoutSignal(signal, 9000);
  try {
    const response = await fetch(url, { signal: t.signal });
    if (!response.ok) throw new Error(`OSRM ${response.status}`);
    const json = await response.json();
    const route = json.routes?.[0];
    if (json.code !== "Ok" || !route?.geometry?.coordinates?.length) throw new Error(`OSRM ${json.code || "no route"}`);
    return { coordinates: route.geometry.coordinates, meters: route.distance, seconds: route.duration };
  } finally {
    t.done();
  }
}

/** Valhalla returns its line as an encoded polyline with 6 decimal places. */
function decodePolyline6(encoded) {
  const coordinates = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    for (const axis of [0, 1]) {
      let result = 0, shift = 0, byte;
      do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lng += delta;
    }
    coordinates.push([lng / 1e6, lat / 1e6]);
  }
  return coordinates;
}

async function valhallaRoute(config, costing, from, to, signal) {
  const request = {
    locations: [{ lat: from.lat, lon: from.lng }, { lat: to.lat, lon: to.lng }],
    costing,
    directions_type: "none"
  };
  const t = timeoutSignal(signal, 9000);
  try {
    const response = await fetch(`${config.valhallaURL}/route?json=${encodeURIComponent(JSON.stringify(request))}`, { signal: t.signal });
    if (!response.ok) throw new Error(`Valhalla ${response.status}`);
    const json = await response.json();
    const trip = json.trip;
    if (!trip?.legs?.[0]?.shape) throw new Error("Valhalla: no route");
    return { coordinates: decodePolyline6(trip.legs[0].shape), meters: trip.summary.length * 1000, seconds: trip.summary.time };
  } finally {
    t.done();
  }
}

/**
 * mode: "walk" | "drive".
 * Returns { coordinates: [[lng, lat], ...], meters, seconds }, or throws when no server can route.
 */
export async function travelRoute(config, mode, from, to, signal) {
  const providers = (mode === "drive"
    ? [
        config.osrmCarURL && (() => osrmRoute(config.osrmCarURL, from, to, signal)),
        config.valhallaURL && (() => valhallaRoute(config, "auto", from, to, signal)),
        config.osrmDemoURL && (() => osrmRoute(config.osrmDemoURL, from, to, signal))
      ]
    : [
        config.osrmFootURL && (() => osrmRoute(config.osrmFootURL, from, to, signal)),
        config.valhallaURL && (() => valhallaRoute(config, "pedestrian", from, to, signal))
      ]).filter(Boolean);
  let lastError = new Error("No routing server configured");
  for (const provider of providers) {
    try {
      return await provider();
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
      console.warn("GradWay: routing server failed, trying the next one.", error?.message || error);
    }
  }
  throw lastError;
}
