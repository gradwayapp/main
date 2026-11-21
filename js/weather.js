// Current weather from the National Weather Service (api.weather.gov):
// free, no API key, open data for any use. U.S. locations only, which covers
// every GradWay campus. Results are kept for 30 minutes per campus.

const CACHE = "gradway.weather.";

function cached(key, maxAgeMs) {
  try {
    const entry = JSON.parse(localStorage.getItem(CACHE + key));
    if (entry && Date.now() - entry.t < maxAgeMs) return entry.v;
  } catch { /* storage unavailable */ }
  return null;
}
function save(key, value) {
  try { localStorage.setItem(CACHE + key, JSON.stringify({ t: Date.now(), v: value })); } catch { /* ignore */ }
}

async function getJSON(url, signal) {
  const response = await fetch(url, { headers: { Accept: "application/geo+json" }, signal });
  if (!response.ok) throw new Error(`Weather ${response.status}`);
  return response.json();
}

/** Picks an icon name from the forecast's words. */
export function weatherIcon(text = "", isDaytime = true) {
  const t = text.toLowerCase();
  if (/thunder|t-storm/.test(t)) return "storm";
  if (/snow|sleet|flurr|ice|freezing/.test(t)) return "snow";
  if (/rain|shower|drizzle/.test(t)) return "rain";
  if (/fog|haze|smoke|mist/.test(t)) return "fog";
  if (/partly|mostly sunny|mostly clear/.test(t)) return "partly";
  if (/cloud|overcast/.test(t)) return "cloud";
  return isDaytime ? "sun" : "moon";
}

/**
 * Returns { temp, unit, text, icon, high, low, updated } or null if the
 * weather can't be loaded (outside the U.S., offline, or the service is busy).
 */
export async function currentWeather(config, center, signal) {
  if (!config.weatherURL || !center) return null;
  const key = `${center.lat.toFixed(3)},${center.lng.toFixed(3)}`;
  const recent = cached(`now.${key}`, 30 * 60_000);
  if (recent) return recent;
  try {
    // The grid point for a place rarely changes, so it is kept for 30 days.
    let point = cached(`point.${key}`, 30 * 86_400_000);
    if (!point) {
      const json = await getJSON(`${config.weatherURL}/points/${center.lat.toFixed(4)},${center.lng.toFixed(4)}`, signal);
      point = { hourly: json.properties.forecastHourly, daily: json.properties.forecast };
      save(`point.${key}`, point);
    }
    const [hourly, daily] = await Promise.all([getJSON(point.hourly, signal), getJSON(point.daily, signal).catch(() => null)]);
    const now = hourly.properties.periods[0];
    const days = daily?.properties?.periods || [];
    // At night the first period is "Tonight", so there is no high left for today.
    const today = days[0]?.isDaytime ? days[0] : null;
    const tonight = days[0]?.isDaytime ? days[1] : days[0];
    const result = {
      temp: Math.round(now.temperature),
      unit: now.temperatureUnit || "F",
      text: now.shortForecast,
      icon: weatherIcon(now.shortForecast, now.isDaytime),
      high: today ? Math.round(today.temperature) : null,
      low: tonight ? Math.round(tonight.temperature) : null,
      rainChance: now.probabilityOfPrecipitation?.value ?? null,
      updated: Date.now()
    };
    save(`now.${key}`, result);
    return result;
  } catch (error) {
    if (signal?.aborted) return null;
    console.warn("GradWay weather:", error?.message || error);
    return null;
  }
}
