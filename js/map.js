// The map: MapLibre GL with OpenFreeMap vector tiles (no API key).
// Mirrors the app's region handling: start on the campus box, keep the
// camera within about 4x the campus, relax that when results are farther out.
//
// Three looks: dark (the light style darkened with a CSS filter, to match the
// app), light, and satellite (USGS aerial imagery, public domain, with the
// street and place labels from the light style on top).

import { bboxOf } from "./data.js";

export const MAP_STYLES = ["dark", "light", "satellite"];

// Route colors per look. The dark look inverts the canvas, so its colors are
// the inverse of what shows (navy casing, sky-blue walking, gold driving).
const ROUTE_COLORS = {
  dark:      { casing: "#e9e1d0", walk: "#004f99", drive: "#704a00", straight: "#3d5a73" },
  light:     { casing: "#ffffff", walk: "#1a73d9", drive: "#c27c0e", straight: "#6b7a8c" },
  satellite: { casing: "#0d1322", walk: "#4fb3ff", drive: "#e4b463", straight: "#c9d3de" }
};

export class CampusMap {
  constructor(container, config) {
    this.container = container;
    this.config = config;
    this.markers = [];
    this.userMarker = null;
    this.selectedId = null;
    this.failed = false;
    this.styleName = "dark";
    this.overlays = new Map(); // key -> [marker]
    this.ready = this.#create();
  }

  /** Switches between "dark", "light" and "satellite". */
  async setStyleName(name) {
    if (!MAP_STYLES.includes(name)) name = "dark";
    const wasSatellite = this.styleName === "satellite";
    this.styleName = name;
    this.container.classList.toggle("is-dark", name === "dark");
    this.container.dataset.look = name;
    if (!this.map) return;
    if (name === "satellite") {
      this.map.setStyle(await this.#satelliteStyle(), { diff: false });
    } else if (wasSatellite) {
      this.map.setStyle(this.config.mapStyleURL, { diff: false });
    } else {
      this.#recolorRoute();
      return;
    }
    // A new style drops our route layers; draw the last route again once it loads.
    this.map.once("style.load", () => this.#redrawLastRoute());
  }

  /** USGS aerial imagery with the light style's labels on top (labels only if that style loads). */
  async #satelliteStyle() {
    const imagery = {
      type: "raster",
      tiles: [this.config.satelliteTilesURL],
      tileSize: 256,
      maxzoom: 19,
      attribution: '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>'
    };
    const style = { version: 8, sources: { imagery }, layers: [{ id: "imagery", type: "raster", source: "imagery" }] };
    try {
      if (!this.labelStyle) {
        const response = await fetch(this.config.mapStyleURL);
        this.labelStyle = await response.json();
      }
      const base = this.labelStyle;
      const labels = (base.layers || []).filter(layer => layer.type === "symbol").map(layer => ({
        ...layer,
        paint: { ...(layer.paint || {}), "text-color": "#ffffff", "text-halo-color": "rgba(0,0,0,0.75)", "text-halo-width": 1.4 }
      }));
      if (!labels.length || !base.glyphs) return style;
      return {
        ...style,
        glyphs: base.glyphs,
        ...(base.sprite ? { sprite: base.sprite } : {}),
        sources: { ...base.sources, imagery },
        layers: [...style.layers, ...labels]
      };
    } catch {
      return style;
    }
  }

  async #create() {
    const gl = window.maplibregl;
    if (!gl || (gl.supported && !gl.supported())) return this.#fail();
    try {
      this.map = new gl.Map({
        container: this.container,
        style: this.config.mapStyleURL,
        center: [-88.79, 33.455],
        zoom: 14,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        cooperativeGestures: false
      });
      this.map.touchZoomRotate.disableRotation();
      this.container.classList.toggle("is-dark", this.styleName === "dark");
      this.map.on("error", event => console.warn("GradWay map:", event?.error?.message || event));
      await new Promise(resolve => {
        if (this.map.loaded()) resolve();
        this.map.once("load", resolve);
        setTimeout(resolve, 6000); // never block the app on slow tiles
      });
      return this.map;
    } catch (error) {
      console.warn("GradWay: map unavailable", error);
      return this.#fail();
    }
  }

  #fail() {
    this.failed = true;
    this.container.innerHTML = `<div class="map-fallback"><p>The map can't load on this device.</p><p>Search results still show in the list, with directions.</p></div>`;
    return null;
  }

  resize() { this.map?.resize(); }

  #toBounds(region) {
    const [w, s, e, n] = bboxOf(region);
    return [[w, s], [e, n]];
  }

  /** Camera limit: about 4x the campus, at least 0.05 degrees (applyCameraLimits). */
  setCampus(campus) {
    this.campus = campus;
    if (!this.map || !campus.region) return;
    this.limitToCampus();
    this.map.jumpTo({ center: [campus.region.center.lng, campus.region.center.lat] });
    this.map.fitBounds(this.#toBounds(campus.region), { padding: 24, animate: false });
  }

  limitToCampus() {
    const region = this.campus?.region;
    if (!this.map || !region) return;
    // At least 10 miles around campus in every direction (the search radius), or 4x the campus.
    const tenMilesLat = (2 * 10 * 1609.34) / 111_320 * 1.1;
    const tenMilesLng = tenMilesLat / Math.max(Math.cos(region.center.lat * Math.PI / 180), 0.2);
    const big = {
      center: region.center,
      latDelta: Math.max(region.latDelta * 4, tenMilesLat),
      lngDelta: Math.max(region.lngDelta * 4, tenMilesLng)
    };
    this.map.setMaxBounds(this.#toBounds(big));
  }

  relaxLimits() { this.map?.setMaxBounds(null); }

  setRegion(region, padding = {}) {
    if (!this.map) return;
    this.map.fitBounds(this.#toBounds(region), {
      padding: { top: 16, bottom: 16, left: 16, right: 16, ...padding },
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700,
      maxZoom: 18
    });
  }

  fitItems(items, padding = {}) {
    if (!this.map || !items.length) return;
    const lngs = items.map(i => i.lng), lats = items.map(i => i.lat);
    this.map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
      padding: { top: 60, bottom: 60, left: 50, right: 50, ...padding },
      maxZoom: 17,
      duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700
    });
  }

  clearPins() {
    this.clearRoute();
    this.markers.forEach(({ marker }) => marker.remove());
    this.markers = [];
    this.selectedId = null;
  }

  setPins(items, onSelect) {
    this.clearPins();
    if (!this.map) return;
    for (const item of items) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "pin";
      el.setAttribute("aria-label", item.name);
      el.innerHTML = `<span class="pin-dot"></span><span class="pin-label">${escapeHTML(item.name)}</span>`;
      el.addEventListener("click", event => { event.stopPropagation(); onSelect(item); });
      const marker = new window.maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([item.lng, item.lat])
        .addTo(this.map);
      this.markers.push({ id: item.id, marker, el });
    }
  }

  select(item) {
    this.selectedId = item?.id ?? null;
    for (const { id, el } of this.markers) el.classList.toggle("is-selected", id === this.selectedId);
  }

  showUser(position) {
    if (!this.map || !position) return;
    if (!this.userMarker) {
      const el = document.createElement("div");
      el.className = "user-dot";
      el.setAttribute("aria-label", "Your location");
      this.userMarker = new window.maplibregl.Marker({ element: el }).setLngLat([position.lng, position.lat]).addTo(this.map);
    } else {
      this.userMarker.setLngLat([position.lng, position.lat]);
    }
  }

  /**
   * Draws the route and animates it from the user to the destination, with a
   * small walker (or car) riding the front of the line.
   * Walking: a dotted line, like the app's dotted path. Driving: a solid line.
   * `straight` (no routing server answered): a dashed straight line.
   * The map canvas is darkened with a CSS invert filter, so the colors here are
   * the inverse of what shows: navy casing, sky-blue walking, gold driving.
   */
  showRoute(coordinates, { mode = "walk", straight = false, padding = {} } = {}) {
    if (!this.map || !coordinates?.length) return;
    this.clearRoute();
    const token = (this.routeToken = (this.routeToken || 0) + 1);

    const lngs = coordinates.map(c => c[0]), lats = coordinates.map(c => c[1]);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
      padding: { top: 80, bottom: 80, left: 70, right: 70, ...padding },
      maxZoom: 17.5,
      duration: reduce ? 0 : 700
    });

    const colors = ROUTE_COLORS[this.styleName] || ROUTE_COLORS.dark;
    const lineColor = straight ? colors.straight : mode === "drive" ? colors.drive : colors.walk;
    const dash = straight ? [1.2, 1.2] : mode === "drive" ? null : [0.1, 1.8];
    this.lastRoute = { coordinates, mode, straight };
    const empty = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [coordinates[0], coordinates[0]] } };

    const addLayers = () => {
      if (token !== this.routeToken) return true;
      try {
        if (!this.map.getSource("gw-route")) this.map.addSource("gw-route", { type: "geojson", data: empty });
        if (!this.map.getLayer("gw-route-casing")) this.map.addLayer({
          id: "gw-route-casing", type: "line", source: "gw-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": colors.casing, "line-width": mode === "drive" ? 12 : 11, "line-opacity": 0.85 }
        });
        if (!this.map.getLayer("gw-route-line")) this.map.addLayer({
          id: "gw-route-line", type: "line", source: "gw-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": lineColor, "line-width": mode === "drive" ? 6 : 6.5, ...(dash ? { "line-dasharray": dash } : {}) }
        });
        return true;
      } catch (error) {
        return false; // style still loading; try again shortly
      }
    };

    const start = () => {
      if (token !== this.routeToken) return;
      this.#animateRoute(coordinates, { mode, straight, token, reduce });
    };

    if (addLayers()) {
      setTimeout(start, reduce ? 0 : 450);
    } else {
      let tries = 0;
      const retry = () => {
        if (token !== this.routeToken) return;
        if (addLayers()) start();
        else if (++tries < 40) setTimeout(retry, 250);
      };
      this.map.once("styledata", retry);
      setTimeout(retry, 250);
    }
  }

  #animateRoute(coordinates, { mode, straight, token, reduce }) {
    const source = this.map.getSource("gw-route");
    if (!source) return;
    const cosLat = Math.cos(coordinates[0][1] * Math.PI / 180);
    const cumulative = [0];
    for (let i = 1; i < coordinates.length; i++) {
      const dx = (coordinates[i][0] - coordinates[i - 1][0]) * cosLat;
      const dy = coordinates[i][1] - coordinates[i - 1][1];
      cumulative.push(cumulative[i - 1] + Math.hypot(dx, dy));
    }
    const total = cumulative[cumulative.length - 1] || 1;
    const feature = coords => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } });

    if (reduce) { source.setData(feature(coordinates)); this.#arrive(); return; }

    const head = document.createElement("div");
    head.className = `route-head ${mode === "drive" ? "is-drive" : ""}`;
    head.innerHTML = mode === "drive"
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16.5V12l1.8-4.6A2 2 0 0 1 8.7 6h6.6a2 2 0 0 1 1.9 1.4L19 12v4.5"/><path d="M4 12h16v4.5H4z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13" cy="4" r="2"/><path d="m9 21 2.5-6.5L14 17v4"/><path d="m11.5 14.5-1-5.5 4 1.5 2.5 3"/><path d="M10.5 9 7 11v3"/></svg>';
    this.routeHead = new window.maplibregl.Marker({ element: head }).setLngLat(coordinates[0]).addTo(this.map);

    const duration = Math.min(2600, Math.max(1300, coordinates.length * 18 + 900));
    const startedAt = performance.now();
    const ease = t => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    const frame = now => {
      if (token !== this.routeToken) return;
      const t = Math.min(1, (now - startedAt) / duration);
      const target = ease(t) * total;
      let i = 1;
      while (i < cumulative.length - 1 && cumulative[i] < target) i++;
      const segment = cumulative[i] - cumulative[i - 1] || 1;
      const f = Math.max(0, Math.min(1, (target - cumulative[i - 1]) / segment));
      const a = coordinates[i - 1], b = coordinates[i];
      const tip = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      source.setData(feature([...coordinates.slice(0, i), tip]));
      this.routeHead?.setLngLat(tip);
      if (t < 1) this.routeFrame = requestAnimationFrame(frame);
      else { source.setData(feature(coordinates)); this.routeHead?.remove(); this.routeHead = null; this.#arrive(); }
    };
    this.routeFrame = requestAnimationFrame(frame);
  }

  /** A short pulse on the destination pin when the line reaches it. */
  #arrive() {
    const selected = this.markers.find(m => m.id === this.selectedId);
    if (!selected) return;
    selected.el.classList.remove("arrived");
    void selected.el.offsetWidth;
    selected.el.classList.add("arrived");
  }

  /** After a style change: put the finished route back, without animating. */
  #redrawLastRoute() {
    const last = this.lastRoute;
    if (!last || !this.map) return;
    const colors = ROUTE_COLORS[this.styleName] || ROUTE_COLORS.dark;
    const dash = last.straight ? [1.2, 1.2] : last.mode === "drive" ? null : [0.1, 1.8];
    try {
      this.map.addSource("gw-route", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: last.coordinates } } });
      this.map.addLayer({ id: "gw-route-casing", type: "line", source: "gw-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": colors.casing, "line-width": last.mode === "drive" ? 12 : 11, "line-opacity": 0.85 } });
      this.map.addLayer({ id: "gw-route-line", type: "line", source: "gw-route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": last.straight ? colors.straight : last.mode === "drive" ? colors.drive : colors.walk, "line-width": 6.5, ...(dash ? { "line-dasharray": dash } : {}) } });
    } catch (error) {
      console.warn("GradWay: couldn't redraw route", error);
    }
  }

  #recolorRoute() {
    const last = this.lastRoute;
    if (!last || !this.map?.getLayer("gw-route-line")) return;
    const colors = ROUTE_COLORS[this.styleName] || ROUTE_COLORS.dark;
    this.map.setPaintProperty("gw-route-casing", "line-color", colors.casing);
    this.map.setPaintProperty("gw-route-line", "line-color", last.straight ? colors.straight : last.mode === "drive" ? colors.drive : colors.walk);
  }

  // MARK: Map details (emergency phones, bus stops, ...): small HTML markers so colors stay exact on every look.

  setOverlay(key, items, { icon, label, onSelect }) {
    this.clearOverlay(key);
    if (!this.map) return;
    const markers = items.map(item => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `detail-dot detail-${key}`;
      el.title = item.name || label;
      el.setAttribute("aria-label", item.name || label);
      el.innerHTML = icon;
      el.addEventListener("click", event => { event.stopPropagation(); onSelect?.(item); });
      return new window.maplibregl.Marker({ element: el }).setLngLat([item.lng, item.lat]).addTo(this.map);
    });
    this.overlays.set(key, markers);
  }

  clearOverlay(key) {
    (this.overlays.get(key) || []).forEach(marker => marker.remove());
    this.overlays.delete(key);
  }

  clearRoute() {
    this.lastRoute = null;
    this.routeToken = (this.routeToken || 0) + 1;
    if (this.routeFrame) cancelAnimationFrame(this.routeFrame);
    this.routeFrame = null;
    this.routeHead?.remove();
    this.routeHead = null;
    if (!this.map) return;
    try {
      for (const id of ["gw-route-line", "gw-route-casing"]) if (this.map.getLayer(id)) this.map.removeLayer(id);
      if (this.map.getSource("gw-route")) this.map.removeSource("gw-route");
    } catch { /* style reloading */ }
  }

  flyTo(position, zoom = 16.5) {
    this.map?.flyTo({ center: [position.lng, position.lat], zoom, duration: 700 });
  }
}

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
