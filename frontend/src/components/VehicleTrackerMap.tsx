import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { LocateFixed, Maximize2 } from "lucide-react";

import { pointAt, sliceBetween, type LngLat } from "../lib/geo";
import type { RouteLine } from "../services/routeService";
import "./vehicle-tracker.css";

/** How long the marker glides from the old position to the new one after a ping. */
const GLIDE_MS = 2500;

/** Follow mode zooms in at least this far so movement is visible. */
const FOLLOW_MIN_ZOOM = 11;

const SRC_TRAVELED = "vt-traveled";
const SRC_REMAINING = "vt-remaining";

const TRUCK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>`;

type LineFeature = {
  type: "Feature";
  properties: Record<string, never>;
  geometry: { type: "LineString"; coordinates: LngLat[] };
};

function lineOf(coordinates: LngLat[]): LineFeature {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } };
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function fitRoute(map: maplibregl.Map, route: RouteLine, duration: number) {
  const bounds = new maplibregl.LngLatBounds(route.coords[0], route.coords[0]);
  for (const c of route.coords) bounds.extend(c);
  map.fitBounds(bounds, {
    padding: { top: 64, bottom: 56, left: 56, right: 56 },
    maxZoom: 12,
    duration,
  });
}

function stopMarkerElement(kind: "origin" | "destination", name: string): HTMLElement {
  const el = document.createElement("div");
  el.className = `vt-stop ${kind}`;
  const label = document.createElement("span");
  label.className = "vt-stop-label";
  label.textContent = name;
  const dot = document.createElement("span");
  dot.className = "vt-stop-dot";
  el.append(label, dot);
  return el;
}

interface VehicleTrackerMapProps {
  route: RouteLine | null;
  /** Distance travelled along the route, km. Null until the first ping. */
  km: number | null;
  /** Colour of the travelled path and the vehicle marker. */
  color: string;
  /** Pulse the marker (vehicle is under way). */
  moving: boolean;
  /** Shown over the map while there is no route yet. */
  message: string | null;
  /** Overlay content, top-left (live status). */
  statusChip?: ReactNode;
}

function VehicleTrackerMap({ route, km, color, moving, message, statusChip }: VehicleTrackerMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const vehicleMarkerRef = useRef<maplibregl.Marker | null>(null);
  const shownKmRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);
  const followRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [follow, setFollow] = useState(false);

  // ------------------------------------------------------------------
  // Map lifecycle
  // ------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [93.5, 27.5],
      zoom: 5,
      minZoom: 4,
      maxZoom: 17,
      dragRotate: false,
      attributionControl: false,
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");

    map.on("load", () => {
      const lineLayout = { "line-cap": "round", "line-join": "round" } as const;

      map.addSource(SRC_REMAINING, { type: "geojson", data: lineOf([]) });
      map.addSource(SRC_TRAVELED, { type: "geojson", data: lineOf([]) });

      // Remaining path: light, dashed.  Travelled path: solid, in the vehicle's colour.
      map.addLayer({
        id: "vt-remaining-casing",
        type: "line",
        source: SRC_REMAINING,
        layout: lineLayout,
        paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "vt-remaining",
        type: "line",
        source: SRC_REMAINING,
        layout: { "line-join": "round" },
        paint: { "line-color": "#7d8aa8", "line-width": 4, "line-dasharray": [1.4, 1.2] },
      });
      map.addLayer({
        id: "vt-traveled-casing",
        type: "line",
        source: SRC_TRAVELED,
        layout: lineLayout,
        paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0.95 },
      });
      map.addLayer({
        id: "vt-traveled",
        type: "line",
        source: SRC_TRAVELED,
        layout: lineLayout,
        paint: { "line-color": "#2563eb", "line-width": 6 },
      });

      setReady(true);
    });

    // A manual drag means the user wants to look around: stop following.
    map.on("dragstart", () => {
      if (followRef.current) {
        followRef.current = false;
        setFollow(false);
      }
    });

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      vehicleMarkerRef.current?.remove();
      vehicleMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      shownKmRef.current = null;
      setReady(false);
    };
  }, []);

  // ------------------------------------------------------------------
  // New route: draw it, drop origin / destination pins, create the vehicle marker
  // ------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !route) return;

    (map.getSource(SRC_REMAINING) as maplibregl.GeoJSONSource).setData(lineOf(route.coords));
    (map.getSource(SRC_TRAVELED) as maplibregl.GeoJSONSource).setData(lineOf([]));
    shownKmRef.current = null;

    const start = route.coords[0];
    const end = route.coords[route.coords.length - 1];
    const originMarker = new maplibregl.Marker({
      element: stopMarkerElement("origin", route.origin.name),
      anchor: "center",
    })
      .setLngLat(start)
      .addTo(map);
    const destinationMarker = new maplibregl.Marker({
      element: stopMarkerElement("destination", route.destination.name),
      anchor: "center",
    })
      .setLngLat(end)
      .addTo(map);

    const vehicleEl = document.createElement("div");
    vehicleEl.className = "vt-marker";
    vehicleEl.innerHTML = `<span class="vt-pulse"></span><span class="vt-badge">${TRUCK_SVG}</span>`;
    const vehicleMarker = new maplibregl.Marker({ element: vehicleEl, anchor: "center" })
      .setLngLat(start)
      .addTo(map);
    vehicleMarkerRef.current = vehicleMarker;

    fitRoute(map, route, 0);

    return () => {
      originMarker.remove();
      destinationMarker.remove();
      vehicleMarker.remove();
      vehicleMarkerRef.current = null;
    };
  }, [ready, route]);

  // ------------------------------------------------------------------
  // New ping: glide the marker to the new position and redraw the path split
  // ------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    const marker = vehicleMarkerRef.current;
    if (!map || !ready || !route || !marker || km === null) return;

    const traveled = map.getSource(SRC_TRAVELED) as maplibregl.GeoJSONSource;
    const remaining = map.getSource(SRC_REMAINING) as maplibregl.GeoJSONSource;
    const target = Math.min(Math.max(km, 0), route.totalKm);
    const from = shownKmRef.current;

    const keepInView = (p: LngLat) => {
      const px = map.project(p);
      const { clientWidth: w, clientHeight: h } = map.getContainer();
      const margin = 70;
      if (px.x < margin || px.y < margin || px.x > w - margin || px.y > h - margin) {
        map.easeTo({ center: p, duration: 700 });
      }
    };

    const draw = (atKm: number) => {
      const p = pointAt(route, atKm).point;
      marker.setLngLat(p);
      traveled.setData(lineOf(sliceBetween(route, 0, atKm)));
      remaining.setData(lineOf(sliceBetween(route, atKm, route.totalKm)));
      shownKmRef.current = atKm;
      if (followRef.current) map.setCenter(p);
    };

    if (from === null || from === target || prefersReducedMotion()) {
      draw(target);
      keepInView(pointAt(route, target).point);
      return;
    }

    const startedAt = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / GLIDE_MS);
      draw(from + (target - from) * easeInOut(t));
      if (t < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        frameRef.current = null;
        if (!followRef.current) keepInView(pointAt(route, target).point);
      }
    };
    frameRef.current = requestAnimationFrame(step);

    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [ready, route, km]);

  // ------------------------------------------------------------------
  // Colour + pulse follow the vehicle's status
  // ------------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setPaintProperty("vt-traveled", "line-color", color);

    const el = vehicleMarkerRef.current?.getElement();
    if (el) {
      el.style.setProperty("--vt-color", color);
      el.classList.toggle("is-moving", moving);
    }
  }, [ready, route, color, moving]);

  // ------------------------------------------------------------------
  // Camera controls
  // ------------------------------------------------------------------
  const handleFit = useCallback(() => {
    const map = mapRef.current;
    if (!map || !route) return;
    followRef.current = false;
    setFollow(false);
    fitRoute(map, route, 800);
  }, [route]);

  const handleFollow = useCallback(() => {
    const map = mapRef.current;
    const marker = vehicleMarkerRef.current;
    if (!map || !marker) return;

    const next = !followRef.current;
    followRef.current = next;
    setFollow(next);
    if (next) {
      map.easeTo({
        center: marker.getLngLat(),
        zoom: Math.max(map.getZoom(), FOLLOW_MIN_ZOOM),
        duration: 700,
      });
    }
  }, []);

  return (
    <div className="vt-map-wrap">
      <div ref={containerRef} className="vt-map" />

      {statusChip && <div className="vt-overlay vt-top-left">{statusChip}</div>}

      {route && (
        <div className="vt-overlay vt-top-right">
          <button type="button" className="vt-map-btn" onClick={handleFit} title="Show whole route">
            <Maximize2 size={14} /> Route
          </button>
          <button
            type="button"
            className={`vt-map-btn ${follow ? "active" : ""}`}
            onClick={handleFollow}
            title="Keep the vehicle centred"
            aria-pressed={follow}
          >
            <LocateFixed size={14} /> Follow
          </button>
        </div>
      )}

      {route && (
        <div className="vt-overlay vt-legend">
          <span className="vt-legend-item">
            <i className="vt-swatch solid" style={{ background: color }} /> Travelled
          </span>
          <span className="vt-legend-item">
            <i className="vt-swatch dashed" /> Remaining
          </span>
          {route.kind === "approximate" && (
            <span
              className="vt-legend-note"
              title="Road routing was unreachable, so the path is drawn as straight lines between named stops."
            >
              Approximate path
            </span>
          )}
        </div>
      )}

      {message && <div className="vt-message">{message}</div>}
    </div>
  );
}

export default VehicleTrackerMap;
