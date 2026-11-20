// The map: MapLibre GL with OpenFreeMap vector tiles (no API key).
// Mirrors the app's region handling: start on the campus box, keep the
// camera within about 4x the campus, relax that when results are farther out.

import { bboxOf } from "./data.js";

export class CampusMap {
  constructor(container, config) {
    this.container = container;
    this.config = config;
    this.markers = [];
    this.userMarker = null;
    this.selectedId = null;
    this.failed = false;
    this.ready = this.#create();
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
    const big = {
      center: region.center,
      latDelta: Math.max(region.latDelta * 4, 0.05),
      lngDelta: Math.max(region.lngDelta * 4, 0.05)
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
   * Draws a dotted walking route, like the app's dotted path.
   * The map canvas is darkened with a CSS invert filter, so these colors are
   * the inverse of what shows: a dark navy casing and a sky-blue dotted line.
   */
  showRoute(coordinates, padding = {}) {
    if (!this.map || !coordinates?.length) return;
    const data = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } };
    const draw = () => {
      const source = this.map.getSource("gw-route");
      if (source) {
        source.setData(data);
      } else {
        this.map.addSource("gw-route", { type: "geojson", data });
        this.map.addLayer({
          id: "gw-route-casing", type: "line", source: "gw-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#e9e1d0", "line-width": 11, "line-opacity": 0.9 }
        });
        this.map.addLayer({
          id: "gw-route-line", type: "line", source: "gw-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#004f99", "line-width": 6, "line-dasharray": [0.1, 1.8] }
        });
      }
      const lngs = coordinates.map(c => c[0]), lats = coordinates.map(c => c[1]);
      this.map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], {
        padding: { top: 70, bottom: 70, left: 60, right: 60, ...padding },
        maxZoom: 17.5,
        duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700
      });
    };
    if (this.map.isStyleLoaded()) draw();
    else this.map.once("idle", draw);
  }

  clearRoute() {
    if (!this.map) return;
    for (const id of ["gw-route-line", "gw-route-casing"]) if (this.map.getLayer(id)) this.map.removeLayer(id);
    if (this.map.getSource("gw-route")) this.map.removeSource("gw-route");
  }

  flyTo(position, zoom = 16.5) {
    this.map?.flyTo({ center: [position.lng, position.lat], zoom, duration: 700 });
  }
}

export function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
