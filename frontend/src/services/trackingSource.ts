/**
 * Where vehicle positions come from.
 *
 * The UI never asks "how do I simulate a truck?" - it subscribes to a
 * TrackingSource and reacts to GPS pings. Today the only implementation is the
 * simulator below. Going real-time means writing a second implementation of
 * the same interface (WebSocket / SSE / polling against the backend) and
 * passing it to useVehicleTracking instead. No component changes.
 *
 * A live source would look like:
 *
 *   export function createLiveSource(): TrackingSource {
 *     return {
 *       subscribe(vehicle, _route, onPing) {
 *         const ws = new WebSocket(`${WS_BASE}/ws/vehicles/${vehicle.id}`);
 *         ws.onmessage = (e) => onPing(JSON.parse(e.data)); // { lng, lat, speedKmph, timestamp }
 *         return () => ws.close();
 *       },
 *     };
 *   }
 *
 * Note the source only emits raw lng/lat. Working out progress along the route
 * is the tracker's job (it snaps each ping onto the route), so real devices
 * that know nothing about our routes work unchanged.
 */

import type { Vehicle } from "../data/mockData";
import type { LngLat } from "../lib/geo";
import { pointAt, snapToPolyline } from "../lib/geo";
import type { RouteLine } from "./routeService";

/** How often a new GPS position arrives. */
export const PING_INTERVAL_MS = 30_000;

export interface GpsPing {
  lng: number;
  lat: number;
  speedKmph: number;
  /** Epoch ms when the position was recorded. */
  timestamp: number;
}

export interface TrackingSource {
  /**
   * Starts delivering pings for a vehicle. Should call `onPing` right away with
   * the latest known position, then again for every new one. Returns a
   * function that stops delivery.
   */
  subscribe(
    vehicle: Vehicle,
    route: RouteLine,
    onPing: (ping: GpsPing) => void,
  ): () => void;
}

// ---------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------

/** A GPS fix further than this from the route is treated as unreliable. */
const MAX_GPS_OFFSET_KM = 15;

/** Never start a still-travelling vehicle at the very end, or it "arrives" instantly. */
const MAX_START_FRACTION = 0.97;

/** Where each vehicle was last seen (as a fraction of its route), so reopening a vehicle resumes rather than restarts. */
const lastFraction = new Map<string, number>();

function startFraction(vehicle: Vehicle, route: RouteLine): number {
  if (vehicle.status === "Arrived") return 1;

  const remembered = lastFraction.get(vehicle.id);
  if (remembered !== undefined) return remembered;

  // Prefer the vehicle's reported GPS fix, snapped onto its route...
  const fix: LngLat = [vehicle.gpsLng, vehicle.gpsLat];
  const snap = snapToPolyline(route, fix);
  if (snap.offKm <= MAX_GPS_OFFSET_KM && route.totalKm > 0) {
    return Math.min(snap.km / route.totalKm, MAX_START_FRACTION);
  }

  // ...but if the fix is nowhere near the route, fall back to reported progress.
  return Math.min(vehicle.progressPct / 100, MAX_START_FRACTION);
}

export interface SimulatedSource extends TrackingSource {
  /** Applies from the next ping onward. */
  setTimeScale(scale: number): void;
}

/**
 * Simulated GPS feed: every PING_INTERVAL_MS the vehicle advances along its
 * route by (speed x time). The time scale compresses time for demos - at 30x,
 * one 30 s ping covers 15 minutes of driving, so movement is visible on a
 * region-scale map. At 1x the vehicle moves at its true speed.
 */
export function createSimulatedSource(initialTimeScale = 1): SimulatedSource {
  let timeScale = initialTimeScale;

  return {
    setTimeScale(scale) {
      timeScale = scale;
    },

    subscribe(vehicle, route, onPing) {
      const total = route.totalKm;
      let km = startFraction(vehicle, route) * total;

      const emit = () => {
        const arrived = km >= total - 1e-6;
        const moving = vehicle.status !== "Idle" && vehicle.status !== "Arrived" && !arrived;
        const [lng, lat] = pointAt(route, km).point;
        lastFraction.set(vehicle.id, total > 0 ? km / total : 0);
        onPing({
          lng,
          lat,
          speedKmph: moving ? vehicle.speedKmph : 0,
          timestamp: Date.now(),
        });
      };

      emit();

      const timer = setInterval(() => {
        const moving = vehicle.status !== "Idle" && vehicle.status !== "Arrived";
        if (moving) {
          const hours = (PING_INTERVAL_MS / 3_600_000) * timeScale;
          km = Math.min(total, km + vehicle.speedKmph * hours);
        }
        emit();
      }, PING_INTERVAL_MS);

      return () => clearInterval(timer);
    },
  };
}
