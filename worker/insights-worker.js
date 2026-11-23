// GradWay Campus Insights: a Cloudflare Worker with a D1 database.
//   POST /e          one anonymous event from the GradWay site (no IP or identifier is stored)
//   GET  /insights   a campus's numbers for insights.html, with that campus's key
// Keys live in the KEYS secret as JSON: {"Mississippi State University": "long-random-key", "*": "admin-key"}.

const SMALL_GROUP = 10;   // destinations, grid squares and searches seen fewer times than this are left out
const CELL_LAT = 0.00135, CELL_LNG = 0.0016;
const TYPES = new Set(["visit", "route", "search", "place", "action"]);
const ACTIONS = new Set(["schedule-import", "leave-notify-on", "leave-calendar", "tour-finish", "route-preview", "street-view",
  "safety-open", "share-location", "map-place", "hours-lookup", "recenter", "sponsor-click", "alert-view", "alert-click"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === "/e" && request.method === "POST") return await collect(request, env, cors);
      if (url.pathname === "/insights" && request.method === "GET") return await insights(request, env, url, cors);
      return new Response("GradWay Insights", { status: 404, headers: cors });
    } catch (error) {
      return json({ error: "Something went wrong." }, 500, cors);
    }
  }
};

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim());
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Vary": "Origin"
  };
}

const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } });
const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const int = (v, min, max) => (Number.isFinite(+v) && v !== null && v !== "" ? Math.min(max, Math.max(min, Math.round(+v))) : null);

// MARK: - Collect

async function collect(request, env, cors) {
  const text = await request.text();
  if (text.length > 2048) return new Response(null, { status: 413, headers: cors });
  let e;
  try { e = JSON.parse(text); } catch { return new Response(null, { status: 400, headers: cors }); }
  if (e?.v !== 1 || !TYPES.has(e.type) || !str(e.campus, 120) || !/^\d{4}-\d{2}-\d{2}$/.test(e.day || "")) return new Response(null, { status: 400, headers: cors });
  if (e.type === "action" && !ACTIONS.has(e.name)) return new Response(null, { status: 400, headers: cors });
  // Only accept the visitor's date if it's within a day of now (no back-filling).
  if (Math.abs(Date.parse(`${e.day}T12:00:00Z`) - Date.now()) > 2 * 86_400_000) return new Response(null, { status: 400, headers: cors });
  await env.DB.prepare(`INSERT INTO events (day, hour, dow, campus, type, role, mode, meters, minutes, dest, kind, cell, on_campus, category, results, query, name, detail, is_returning)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)`).bind(
    e.day, int(e.hour, 0, 23) ?? 0, int(e.dow, 0, 6) ?? 0, str(e.campus, 120), e.type,
    ["student", "visitor"].includes(e.role) ? e.role : "unknown",
    ["walk", "drive"].includes(e.mode) ? e.mode : null,
    int(e.meters, 0, 200_000), int(e.minutes, 0, 600), str(e.dest, 80), str(e.kind, 40),
    /^-?\d{1,6}:-?\d{1,6}$/.test(e.cell || "") ? e.cell : null, int(e.onCampus, 0, 1),
    str(e.category, 20), int(e.results, 0, 1000), e.type === "search" && +e.results === 0 ? str(e.query, 40)?.toLowerCase() ?? null : null,
    e.type === "place" ? str(e.name, 80) : e.type === "action" ? e.name : null,
    e.type === "action" && String(e.name).startsWith("alert") ? str(e.detail, 120) : null,
    int(e.returning, 0, 1)
  ).run();
  return new Response(null, { status: 204, headers: cors });
}

// MARK: - Insights

function authorized(request, env, campus) {
  let keys = {};
  try { keys = JSON.parse(env.KEYS || "{}"); } catch {}
  const given = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  return Boolean(given) && (given === keys["*"] || given === keys[campus]);
}

async function insights(request, env, url, cors) {
  const campus = url.searchParams.get("campus") || "";
  const from = url.searchParams.get("from"), to = url.searchParams.get("to");
  const audience = url.searchParams.get("audience") || "all";
  if (!campus || !/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "")) return json({ error: "campus, from and to are required." }, 400, cors);
  if (!authorized(request, env, campus)) return json({ error: "Not authorized." }, 401, cors);

  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const prevTo = new Date(Date.parse(from) - 86_400_000).toISOString().slice(0, 10);
  const prevFrom = new Date(Date.parse(from) - days * 86_400_000).toISOString().slice(0, 10);
  const role = audience === "students" ? "student" : audience === "visitors" ? "visitor" : null;

  const where = "campus = ?1 AND day BETWEEN ?2 AND ?3 AND (?4 IS NULL OR role = ?4)";
  const q = (sql, a = from, b = to) => env.DB.prepare(sql).bind(campus, a, b, role).all().then(r => r.results);

  const totalsSQL = `SELECT
      SUM(type = 'route') AS routes,
      SUM(type = 'visit') AS people,
      SUM(type = 'search') AS searches,
      SUM(type = 'place') AS placeViews,
      AVG(CASE WHEN type = 'route' THEN meters END) AS avgMeters,
      AVG(CASE WHEN type = 'route' AND mode = 'walk' THEN minutes END) AS avgWalkMin,
      AVG(CASE WHEN type = 'route' THEN mode = 'walk' END) AS walkShare,
      AVG(CASE WHEN type = 'visit' THEN role = 'visitor' END) AS visitorShare,
      AVG(CASE WHEN type = 'route' THEN hour >= 18 OR hour < 5 END) AS afterDarkShare,
      SUM(type = 'action' AND name = 'alert-view') AS alertViews,
      SUM(type = 'action' AND name = 'alert-click') AS alertTaps,
      SUM(type = 'action' AND name = 'schedule-import') AS schedulesImported,
      SUM(type = 'action' AND name = 'leave-notify-on') AS remindersOn,
      SUM(type = 'action' AND name = 'safety-open') AS safetyOpens,
      SUM(type = 'action' AND name = 'share-location') AS shareLocation,
      SUM(type = 'route' AND (hour >= 18 OR hour < 5)) AS afterDarkRoutes
    FROM events WHERE ${where}`;
  const shapeTotals = r => ({
    routes: r.routes || 0, people: r.people || 0, searches: r.searches || 0, placeViews: r.placeViews || 0,
    avgRouteMi: +((r.avgMeters || 0) / 1609.34).toFixed(2), avgWalkMin: +(r.avgWalkMin || 0).toFixed(1),
    walkShare: r.walkShare || 0, visitorShare: r.visitorShare || 0, afterDarkShare: r.afterDarkShare || 0,
    alertViews: r.alertViews || 0, alertTaps: r.alertTaps || 0, schedulesImported: r.schedulesImported || 0, remindersOn: r.remindersOn || 0
  });

  const [totalsRow, prevRow, daily, heatRows, destinations, cells, categories, noResults, lengths, audienceRows, parking, alerts] = await Promise.all([
    q(totalsSQL).then(r => r[0] || {}),
    q(totalsSQL, prevFrom, prevTo).then(r => r[0] || {}),
    q(`SELECT day, SUM(mode = 'walk') AS walk, SUM(mode = 'drive') AS drive FROM events WHERE ${where} AND type = 'route' GROUP BY day ORDER BY day`),
    q(`SELECT dow, hour, COUNT(*) AS n FROM events WHERE ${where} AND type = 'route' GROUP BY dow, hour`),
    q(`SELECT dest AS name, MAX(kind) AS kind, COUNT(*) AS routes, ROUND(AVG(meters) / 1609.34, 2) AS avgMi FROM events WHERE ${where} AND type = 'route' AND dest IS NOT NULL GROUP BY dest HAVING COUNT(*) >= ${SMALL_GROUP} ORDER BY routes DESC LIMIT 15`),
    q(`SELECT cell, COUNT(*) AS n FROM events WHERE ${where} AND type = 'route' AND cell IS NOT NULL GROUP BY cell HAVING COUNT(*) >= ${SMALL_GROUP}`),
    q(`SELECT category AS key, COUNT(*) AS searches FROM events WHERE ${where} AND type = 'search' AND category IS NOT NULL GROUP BY category ORDER BY searches DESC`),
    q(`SELECT query, COUNT(*) AS count FROM events WHERE ${where} AND type = 'search' AND results = 0 AND query IS NOT NULL GROUP BY query HAVING COUNT(*) >= ${SMALL_GROUP} ORDER BY count DESC LIMIT 10`),
    q(`SELECT CASE WHEN meters < 402 THEN 0 WHEN meters < 805 THEN 1 WHEN meters < 1207 THEN 2 WHEN meters < 1609 THEN 3 WHEN meters < 3219 THEN 4 ELSE 5 END AS bin, COUNT(*) AS n
       FROM events WHERE ${where} AND type = 'route' AND meters IS NOT NULL GROUP BY bin`),
    q(`SELECT role, COUNT(*) AS n, SUM(is_returning = 0) AS firsts FROM events WHERE ${where} AND type = 'visit' GROUP BY role`),
    q(`SELECT hour, COUNT(*) AS n FROM events WHERE ${where} AND ((type = 'search' AND category = 'parking') OR (type = 'route' AND LOWER(kind) LIKE '%parking%')) GROUP BY hour`),
    q(`SELECT detail AS text, SUM(name = 'alert-view') AS views, SUM(name = 'alert-click') AS taps FROM events WHERE ${where} AND type = 'action' AND detail IS NOT NULL GROUP BY detail ORDER BY views DESC LIMIT 8`)
  ]);

  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of heatRows) heat[r.dow][r.hour] = r.n;
  const lengthLabels = ["Under ¼ mi", "¼–½ mi", "½–¾ mi", "¾–1 mi", "1–2 mi", "2–6 mi"];
  const lengthCounts = Array(6).fill(0);
  for (const r of lengths) lengthCounts[r.bin] = r.n;
  const labels = { parking: "Parking", food: "Food", coffee: "Coffee", library: "Library", atm: "ATM", books: "Bookstore", gym: "Gym", pharmacy: "Pharmacy" };
  const parkingByHour = Array(24).fill(0);
  for (const r of parking) parkingByHour[r.hour] = r.n;
  const byRole = Object.fromEntries(audienceRows.map(r => [r.role, r]));
  const totals = shapeTotals(totalsRow);

  return json({
    campus, from, to, days,
    totals, previous: shapeTotals(prevRow),
    daily: fillDays(from, to, daily),
    heat,
    destinations: destinations.map(d => ({ ...d, kind: d.kind || "" })),
    cells: cells.map(c => { const [r, k] = c.cell.split(":").map(Number); return { lat: +(r * CELL_LAT).toFixed(5), lng: +(k * CELL_LNG).toFixed(5), count: c.n }; }),
    categories: categories.map(c => ({ ...c, label: labels[c.key] || c.key })),
    noResults,
    lengths: lengthLabels.map((label, i) => ({ label, count: lengthCounts[i] })),
    audience: { students: byRole.student?.n || 0, visitors: byRole.visitor?.n || 0, firstTimeVisitors: byRole.visitor?.firsts || 0 },
    parkingByHour,
    alerts: alerts.map(a => ({ text: a.text, type: "", views: a.views, taps: a.taps })),
    safety: { safetyOpens: totalsRow.safetyOpens || 0, shareLocation: totalsRow.shareLocation || 0, afterDarkRoutes: totalsRow.afterDarkRoutes || 0 }
  }, 200, cors);
}

function fillDays(from, to, rows) {
  const map = new Map(rows.map(r => [r.day, r]));
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push({ day, date: day, walk: map.get(day)?.walk || 0, drive: map.get(day)?.drive || 0 });
  }
  return out;
}
