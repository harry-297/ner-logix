/**
 * Turns a vehicle's planned stops into a drawable, measurable route.
 *
 * Strategy, in order:
 *   1. Ask a road-routing engine (OSRM) for the driving geometry through the
 *      stops flagged `via`. This gives a path that follows real roads.
 *   2. If that fails (offline, rate-limited, engine cannot snap a point),
 *      retry with just origin + destination.
 *   3. If that fails too, draw straight lines between the named stops and mark
 *      the route "approximate" so the UI can say so honestly.
 *
 * The result is cached per vehicle for the session.
 *
 * Endpoint: defaults to the public OSRM demo server, fine for a prototype but
 * not for production traffic. Set VITE_OSRM_URL to a self-hosted OSRM (or to a
 * backend proxy) without touching any code. Later this whole module can be
 * replaced by the backend's own risk-aware routing (pgRouting in
 * backend/routers/routes.py) - callers only depend on the RouteLine shape.
 */

import {
  buildPolyline,
  haversineKm,
  simplifyByDistance,
  snapToPolyline,
  type LngLat,
  type Polyline,
} from "../lib/geo";
import { vehicleRoutes, type RouteStopDef } from "../data/vehicleRoutes";

const OSRM_BASE: string =
  import.meta.env.VITE_OSRM_URL ?? "https://router.project-osrm.org";

const OSRM_TIMEOUT_MS = 8_000;

/** Vertices closer than this are dropped from routed geometry. */
const SIMPLIFY_KM = 0.15;

/** A routed path more than this many times the straight-line length is rejected as a bad detour. */
const MAX_DETOUR_RATIO = 3.5;

/** "Near <place>" is used when the vehicle is within this distance of a stop. */
const NEAR_STOP_KM = 6;

export interface RouteStop {
  name: string;
  /** Distance along the route, km. */
  km: number;
}

export interface RouteLine extends Polyline {
  origin: RouteStop;
  destination: RouteStop;
  /** Named stops in travel order, including origin and destination. */
  stops: RouteStop[];
  /** "road" = follows real roads; "approximate" = straight lines between stops. */
  kind: "road" | "approximate";
}

async function fetchOsrm(points: LngLat[]): Promise<LngLat[] | null> {
  const path = points.map(([lng, lat]) => `${lng.toFixed(5)},${lat.toFixed(5)}`).join(";");
  const url = `${OSRM_BASE.replace(/\/$/, "")}/route/v1/driving/${path}?overview=full&geometries=geojson&steps=false`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(OSRM_TIMEOUT_MS) });
    if (!response.ok) return null;

    const body = (await response.json()) as {
      code?: string;
      routes?: { geometry?: { coordinates?: LngLat[] } }[];
    };
    const coords = body.routes?.[0]?.geometry?.coordinates;
    if (body.code !== "Ok" || !coords || coords.length < 2) return null;

    // Sanity check: reject absurd detours (e.g. a stop snapped to the wrong valley).
    const straightKm = points.reduce(
      (sum, p, i) => (i === 0 ? 0 : sum + haversineKm(points[i - 1], p)),
      0,
    );
    const routedKm = buildPolyline(coords).totalKm;
    if (straightKm > 0 && routedKm > straightKm * MAX_DETOUR_RATIO) return null;

    return coords;
  } catch {
    return null; // network error, timeout, CORS, bad JSON - all mean "use fallback"
  }
}

function toStops(defs: RouteStopDef[], line: Polyline): RouteStop[] {
  const stops = defs.map((def, i): RouteStop => {
    if (i === 0) return { name: def.name, km: 0 };
    if (i === defs.length - 1) return { name: def.name, km: line.totalKm };
    return { name: def.name, km: snapToPolyline(line, [def.lng, def.lat]).km };
  });
  return stops.sort((a, b) => a.km - b.km);
}

function assemble(defs: RouteStopDef[], coords: LngLat[], kind: RouteLine["kind"]): RouteLine {
  const line = buildPolyline(coords);
  const stops = toStops(defs, line);
  return {
    ...line,
    stops,
    origin: stops[0],
    destination: stops[stops.length - 1],
    kind,
  };
}

async function buildRoute(defs: RouteStopDef[]): Promise<RouteLine> {
  const first = defs[0];
  const last = defs[defs.length - 1];
  const asPoint = (d: RouteStopDef): LngLat => [d.lng, d.lat];

  const viaPoints = [first, ...defs.slice(1, -1).filter((d) => d.via), last].map(asPoint);
  const attempts: LngLat[][] = [viaPoints];
  if (viaPoints.length > 2) attempts.push([asPoint(first), asPoint(last)]);

  for (const points of attempts) {
    const routed = await fetchOsrm(points);
    if (routed) return assemble(defs, simplifyByDistance(routed, SIMPLIFY_KM), "road");
  }

  return assemble(defs, defs.map(asPoint), "approximate");
}

const cache = new Map<string, Promise<RouteLine | null>>();

/** Resolves to null when no route is configured for the vehicle. Never rejects. */
export function loadRoute(vehicleId: string): Promise<RouteLine | null> {
  const cached = cache.get(vehicleId);
  if (cached) return cached;

  const defs = vehicleRoutes[vehicleId];
  const pending = defs && defs.length >= 2 ? buildRoute(defs) : Promise.resolve(null);
  cache.set(vehicleId, pending);
  return pending;
}

/** Human-readable position: "Near Dirang" or "Between Bomdila and Dirang". */
export function describeLocation(route: RouteLine, km: number): string {
  const { stops } = route;

  let nearest = stops[0];
  for (const stop of stops) {
    if (Math.abs(stop.km - km) < Math.abs(nearest.km - km)) nearest = stop;
  }
  if (Math.abs(nearest.km - km) <= NEAR_STOP_KM) return `Near ${nearest.name}`;

  const previous = [...stops].reverse().find((s) => s.km <= km);
  const next = stops.find((s) => s.km > km);
  return previous && next ? `Between ${previous.name} and ${next.name}` : `Near ${nearest.name}`;
}
