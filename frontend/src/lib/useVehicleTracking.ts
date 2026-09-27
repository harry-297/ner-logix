import { useEffect, useState } from "react";
import type { Vehicle } from "../data/mockData";
import { snapToPolyline } from "./geo";
import { loadRoute, type RouteLine } from "../services/routeService";
import type { GpsPing, TrackingSource } from "../services/trackingSource";

export type TrackingStatus = "loading" | "ready" | "unavailable";

export interface VehicleTracking {
  status: TrackingStatus;
  route: RouteLine | null;
  /** Latest GPS ping, as received. */
  ping: GpsPing | null;
  /** Distance travelled along the route at the latest ping, km. */
  km: number | null;
  /** Distance along the route at the first ping this session, km. */
  startKm: number | null;
}

interface LoadedRoute {
  vehicleId: string;
  route: RouteLine | null;
}

interface TrackState {
  vehicleId: string;
  ping: GpsPing;
  km: number;
  startKm: number;
}

/**
 * Loads a vehicle's route, subscribes to its position source, and snaps every
 * ping onto the route to work out how far along it is.
 *
 * Works identically for simulated and real sources - it only sees GPS pings.
 * State is tagged with the vehicle id, so switching vehicles is treated as
 * "loading" again without any reset logic.
 */
export function useVehicleTracking(vehicle: Vehicle, source: TrackingSource): VehicleTracking {
  const [loaded, setLoaded] = useState<LoadedRoute | null>(null);
  const [track, setTrack] = useState<TrackState | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadRoute(vehicle.id).then((route) => {
      if (!cancelled) setLoaded({ vehicleId: vehicle.id, route });
    });
    return () => {
      cancelled = true;
    };
  }, [vehicle.id]);

  const routeReady = loaded?.vehicleId === vehicle.id;
  const route = routeReady ? loaded.route : null;

  useEffect(() => {
    if (!route) return;

    let previousKm: number | undefined;
    const unsubscribe = source.subscribe(vehicle, route, (ping) => {
      const snapped = snapToPolyline(route, [ping.lng, ping.lat], previousKm);
      previousKm = snapped.km;
      setTrack((current) => ({
        vehicleId: vehicle.id,
        ping,
        km: snapped.km,
        startKm: current?.vehicleId === vehicle.id ? current.startKm : snapped.km,
      }));
    });

    return unsubscribe;
  }, [route, source, vehicle]);

  const live = track?.vehicleId === vehicle.id ? track : null;

  return {
    status: !routeReady ? "loading" : route === null ? "unavailable" : "ready",
    route,
    ping: live?.ping ?? null,
    km: live?.km ?? null,
    startKm: live?.startKm ?? null,
  };
}
