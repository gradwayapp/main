// Which U.S. state a campus is in, from its center coordinate. campus.json has no
// state field, so the campus picker looks it up in simplified Census state outlines
// (data/us-states.json, about 14 KB over the network) right here in the browser.

let loading = null;

export function loadStates(url = "data/us-states.json") {
  if (!loading) {
    loading = fetch(url)
      .then(response => { if (!response.ok) throw new Error(`States ${response.status}`); return response.json(); })
      .then(json => sortSmallestFirst(json.states.map(state => ({ ...state, box: boundsOf(state.polygons) }))))
      .catch(error => { loading = null; throw error; });
  }
  return loading;
}

// Small places first, so Washington, D.C. wins over the Maryland outline around it
// (simplifying the outlines can close the gap Maryland leaves for D.C.).
export function sortSmallestFirst(states) {
  const area = ([w, s, e, n]) => (e - w) * (n - s);
  return states.sort((a, b) => area(a.box) - area(b.box));
}

export function boundsOf(polygons) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const polygon of polygons) for (const [x, y] of polygon[0]) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return [w, s, e, n];
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(x, y, polygon) {
  if (!inRing(x, y, polygon[0])) return false;
  for (let k = 1; k < polygon.length; k++) if (inRing(x, y, polygon[k])) return false; // a hole
  return true;
}

/**
 * The state containing { lat, lng }, as { name, abbr }. A campus right on a coast or
 * border can fall just outside the simplified outlines, so the nearest state within
 * about 15 miles is used then. Returns null for anything farther away.
 */
export function stateAt(states, point) {
  if (!point) return null;
  const x = point.lng, y = point.lat;
  for (const state of states) {
    const [w, s, e, n] = state.box;
    if (x < w || x > e || y < s || y > n) continue;
    if (state.polygons.some(polygon => inPolygon(x, y, polygon))) return { name: state.name, abbr: state.abbr };
  }
  let best = null, bestDistance = Infinity;
  const cos = Math.cos(y * Math.PI / 180);
  for (const state of states) {
    const [w, s, e, n] = state.box;
    if (x < w - 0.3 || x > e + 0.3 || y < s - 0.3 || y > n + 0.3) continue;
    for (const polygon of state.polygons) for (const [px, py] of polygon[0]) {
      const d = Math.hypot((px - x) * cos, py - y);
      if (d < bestDistance) { bestDistance = d; best = state; }
    }
  }
  return best && bestDistance < 0.22 ? { name: best.name, abbr: best.abbr } : null;
}
