// Data for Campus Insights (insights.html).
//
// Live: GET {insightsEndpoint}/insights?campus=…&from=…&to=…&audience=…  with the campus's key.
// Sample: until a campus has live data, the dashboard shows a realistic, clearly
// labeled sample built here (same shape), so it can be shown to universities.
//
// The shape both return:
// { campus, from, to, days, sample,
//   totals: { routes, people, searches, placeViews, avgRouteMi, avgWalkMin, walkShare, visitorShare,
//             afterDarkShare, alertViews, alertTaps, schedulesImported, remindersOn },
//   previous: { …same keys, for the period before },
//   daily: [{ date: "YYYY-MM-DD", walk, drive }],
//   heat: [[24 numbers] × 7]  (Sunday first; routes by day of week and hour),
//   destinations: [{ name, kind, routes, avgMi }],
//   cells: [{ lat, lng, count }]  (destinations on a ~150 m grid; small groups removed),
//   categories: [{ key, label, searches }],
//   noResults: [{ query, count }],
//   lengths: [{ label, count }],
//   audience: { students, visitors, firstTimeVisitors },
//   parkingByHour: [24 numbers],
//   alerts: [{ text, type, views, taps }],
//   safety: { safetyOpens, shareLocation, afterDarkRoutes } }

export const CATEGORY_LABELS = { parking: "Parking", food: "Food", coffee: "Coffee", library: "Library", atm: "ATM", books: "Bookstore", gym: "Gym", pharmacy: "Pharmacy" };

// MARK: - Live

export async function fetchInsights(config, { campus, from, to, audience, key }) {
  const url = new URL(`${config.insightsEndpoint.replace(/\/$/, "")}/insights`);
  url.search = new URLSearchParams({ campus: campus.name, from, to, audience }).toString();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
  if (response.status === 401 || response.status === 403) throw new Error("This insights key isn't valid for this campus.");
  if (!response.ok) throw new Error(`Insights server answered ${response.status}.`);
  return { ...(await response.json()), sample: false };
}

// MARK: - Sample

function rng(seedText) {
  let seed = 2166136261;
  for (const ch of seedText) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619);
  return () => {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822507);
    seed = Math.imul(seed ^ (seed >>> 13), 3266489909);
    return ((seed ^= seed >>> 16) >>> 0) / 4294967296;
  };
}

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const gauss = (x, mu, sigma) => Math.exp(-((x - mu) ** 2) / (2 * sigma ** 2));

/** How busy a given day is, relative to a normal weekday (semester shape). */
function dayFactor(date) {
  const dow = date.getDay();
  let f = dow === 0 ? 0.42 : dow === 6 ? 0.5 : dow === 5 ? 0.82 : 1;
  const m = date.getMonth(), d = date.getDate();
  // First weeks of a term: lots of first-time navigation.
  const termStarts = [new Date(date.getFullYear(), 7, 18), new Date(date.getFullYear(), 0, 12)];
  for (const start of termStarts) {
    const weeks = (date - start) / (7 * 86_400_000);
    if (weeks >= 0 && weeks < 3) f *= 1 + 0.9 * Math.exp(-weeks * 1.3);
  }
  if (m === 10 && d >= 23 && d <= 29) f *= 0.3;            // Thanksgiving break
  if (m === 11 && d >= 7 && d <= 12) f *= 1.15;            // finals
  if (m === 11 && d > 13) f *= 0.25;                       // winter break
  if (m === 9 && d >= 16 && d <= 17) f *= 0.55;            // fall break
  return f;
}

/** Hour-of-day shape: class changes, lunch, evening study. */
function hourShape(hour, weekend) {
  if (weekend) return 0.15 + gauss(hour, 13, 3.2) * 0.9 + gauss(hour, 19, 2) * 0.35;
  return 0.04 + gauss(hour, 7.8, 0.7) * 0.95 + gauss(hour, 9.8, 0.6) * 0.8 + gauss(hour, 10.9, 0.6) * 0.75
    + gauss(hour, 12.2, 0.9) * 0.95 + gauss(hour, 13.8, 0.6) * 0.75 + gauss(hour, 15.1, 0.8) * 0.5
    + gauss(hour, 18.5, 1.4) * 0.32 + gauss(hour, 21, 1.5) * 0.16;
}

const DESTINATIONS = [
  ["Mitchell Memorial Library", "Library", 15], ["Colvard Student Union", "Student union", 13], ["McCool Hall", "Classrooms", 10],
  ["Lee Hall", "Classrooms", 8], ["Butler Hall", "Classrooms", 7], ["Sanderson Center", "Recreation", 7],
  ["Hand Chemistry Laboratory", "Labs", 6], ["Perry Cafeteria", "Dining", 6], ["Humphrey Coliseum", "Arena", 4],
  ["Davis Wade Stadium", "Stadium", 4], ["Longest Student Health Center", "Health", 3], ["Swalm Hall", "Classrooms", 3]
];

export function sampleInsights(campus, { from, to, audience = "all" }) {
  const r = rng(`${campus.name}|${from}|${to}|${audience}`);
  const start = new Date(`${from}T00:00`), end = new Date(`${to}T00:00`);
  const days = Math.max(1, Math.round((end - start) / 86_400_000) + 1);
  const scale = audience === "visitors" ? 0.19 : audience === "students" ? 0.81 : 1;
  const base = 430 * scale;
  const walkShareTarget = audience === "visitors" ? 0.46 : 0.8;

  const daily = [];
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const total = Math.round(base * dayFactor(d) * (0.9 + r() * 0.2));
    const walk = Math.round(total * (walkShareTarget + (r() - 0.5) * 0.06));
    daily.push({ date: iso(d), walk, drive: total - walk });
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const shape = Array.from({ length: 24 }, (_, h) => hourShape(h, weekend));
    const sum = shape.reduce((a, b) => a + b, 0);
    shape.forEach((v, h) => { heat[d.getDay()][h] += Math.round((total * v) / sum); });
  }
  const routes = daily.reduce((a, d) => a + d.walk + d.drive, 0);
  const walkRoutes = daily.reduce((a, d) => a + d.walk, 0);

  const weightSum = DESTINATIONS.reduce((a, d) => a + d[2], 0);
  const destinations = DESTINATIONS.map(([name, kind, w]) => ({
    name, kind, routes: Math.round((routes * 0.72 * w * (0.85 + r() * 0.3)) / weightSum), avgMi: +(0.35 + r() * 0.5).toFixed(2)
  })).sort((a, b) => b.routes - a.routes);

  const catWeights = { parking: audience === "visitors" ? 40 : 27, food: 21, coffee: 14, library: audience === "visitors" ? 3 : 11, atm: 6, books: 5, gym: 5, pharmacy: 3 };
  const searches = Math.round(routes * 1.65);
  const catSum = Object.values(catWeights).reduce((a, b) => a + b, 0);
  const categories = Object.entries(catWeights).map(([key, w]) => ({ key, label: CATEGORY_LABELS[key], searches: Math.round((searches * 0.55 * w * (0.9 + r() * 0.2)) / catSum) }))
    .sort((a, b) => b.searches - a.searches);

  const noResults = [["the junction", 64], ["dorman", 51], ["sanderson", 47], ["registrar", 39], ["bowen hall", 33], ["wise center", 28], ["chem lab", 22], ["health center", 19]]
    .map(([query, c]) => ({ query, count: Math.max(10, Math.round(c * (days / 30) * scale * (0.8 + r() * 0.4))) }))
    .sort((a, b) => b.count - a.count);

  const lengthShares = [0.21, 0.31, 0.2, 0.11, 0.1, 0.07];
  const lengths = ["Under ¼ mi", "¼–½ mi", "½–¾ mi", "¾–1 mi", "1–2 mi", "2–6 mi"].map((label, i) => ({ label, count: Math.round(routes * lengthShares[i] * (0.92 + r() * 0.16)) }));

  const parkingByHour = Array.from({ length: 24 }, (_, h) => Math.round(routes * 0.016 * scale ** 0 * (0.04 + gauss(h, 7.7, 0.9) + 0.55 * gauss(h, 10.2, 1) + 0.45 * gauss(h, 12.8, 1.1) + 0.3 * gauss(h, 17.5, 1.4)) * (0.9 + r() * 0.2)));

  const visitors = audience === "students" ? 0 : Math.round(routes * (audience === "visitors" ? 1 : 0.19) / 2.4);
  const students = audience === "visitors" ? 0 : Math.round(routes * (audience === "students" ? 1 : 0.81) / 3.1);
  const afterDarkShare = 0.17 + r() * 0.03;

  const totals = {
    routes, people: students + visitors, searches, placeViews: Math.round(routes * 2.3),
    avgRouteMi: +(0.58 + r() * 0.1).toFixed(2), avgWalkMin: +(10.2 + r() * 1.6).toFixed(1),
    walkShare: walkRoutes / routes, visitorShare: visitors / Math.max(1, students + visitors),
    afterDarkShare, alertViews: Math.round(routes * 0.9), alertTaps: Math.round(routes * 0.11),
    schedulesImported: audience === "visitors" ? 0 : Math.round(students * 0.27), remindersOn: audience === "visitors" ? 0 : Math.round(students * 0.18)
  };
  const drift = () => 0.82 + r() * 0.3;
  const previous = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, typeof v === "number" ? +(v * (k.endsWith("Share") || k.startsWith("avg") ? 0.96 + r() * 0.08 : drift())).toFixed(k.startsWith("avg") || k.endsWith("Share") ? 3 : 0) : v]));

  return {
    campus: campus.name, from, to, days, sample: true,
    totals, previous, daily, heat, destinations, categories, noResults, lengths, parkingByHour,
    audience: { students, visitors, firstTimeVisitors: Math.round(visitors * 0.78) },
    alerts: [
      { text: "Last day to drop a fall class is Friday.", type: "deadline", views: Math.round(totals.alertViews * 0.42), taps: Math.round(totals.alertTaps * 0.55) },
      { text: "Fried chicken day at the Union food court.", type: "food", views: Math.round(totals.alertViews * 0.33), taps: Math.round(totals.alertTaps * 0.12) },
      { text: "Severe weather: shelter in place until 2 PM.", type: "safety", views: Math.round(totals.alertViews * 0.25), taps: Math.round(totals.alertTaps * 0.33) }
    ],
    safety: { safetyOpens: Math.round(routes * 0.021), shareLocation: Math.round(routes * 0.006), afterDarkRoutes: Math.round(routes * afterDarkShare) },
    cells: null // drawn from destinations once their spots are found
  };
}

/** Plain-language findings for the "What stands out" card. */
export function findings(data) {
  const out = [];
  if (!data.totals.routes) return ["No routes yet in these dates. Findings appear here once people start using GradWay at this campus."];
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  let best = { d: 0, h: 0, v: -1 };
  data.heat.forEach((row, d) => row.forEach((v, h) => { if (v > best.v) best = { d, h, v }; }));
  const weekTotal = data.heat.flat().reduce((a, b) => a + b, 0) || 1;
  const hourLabel = h => `${((h + 11) % 12) + 1} ${h < 12 ? "AM" : "PM"}`;
  out.push(`The busiest hour is ${dayNames[best.d]} at ${hourLabel(best.h)}: ${Math.round((best.v / weekTotal) * 1000) / 10}% of all routes start then. Class changes drive most navigation.`);
  const top = data.destinations[0];
  if (top) out.push(`${top.name} is the most-requested destination, with ${top.routes.toLocaleString()} routes (${Math.round((top.routes / data.totals.routes) * 100)}% of all).`);
  const parkPeak = data.parkingByHour.indexOf(Math.max(...data.parkingByHour));
  const parking = data.categories.find(c => c.key === "parking");
  if (parking) out.push(`Parking is ${data.categories[0].key === "parking" ? "the #1 search" : "a top search"} (${parking.searches.toLocaleString()} searches), peaking around ${hourLabel(parkPeak)}.`);
  out.push(`${Math.round(data.totals.afterDarkShare * 100)}% of routes happen after dark (after 6 PM), when lighting and safe-walk options matter most.`);
  if (data.noResults[0]) out.push(`People searched for "${data.noResults[0].query}" ${data.noResults[0].count} times and found nothing. Adding the names people actually use would help.`);
  return out;
}
