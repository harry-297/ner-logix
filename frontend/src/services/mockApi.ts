import { alerts, incidents, vehicles } from "../data/mockData";

export interface RouteRequest {
  origin: string;
  destination: string;
  vehicleType: string;
  cargoType: string;
  priority: string;
  departureTime: string;
}

export function getCorridors() {
  return [
    { id: "corridor-sikkim", name: "NH-10 Sikkim Corridor", district: "Pakyong", state: "Sikkim", status: "Restricted", risk: "High" },
    { id: "corridor-assam", name: "SH-7 Dhemaji Route", district: "Dhemaji", state: "Assam", status: "Blocked", risk: "Critical" },
    { id: "corridor-meghalaya", name: "SH-5 Meghalaya Link", district: "West Khasi Hills", state: "Meghalaya", status: "Accessible", risk: "Low" },
    { id: "corridor-manipur", name: "Iril Bridge Corridor", district: "Imphal East", state: "Manipur", status: "High-Risk", risk: "High" },
    { id: "corridor-arunachal", name: "NH-13 Bomdila Route", district: "West Kameng", state: "Arunachal Pradesh", status: "Restricted", risk: "Moderate" },
  ];
}

export function getVehicles() {
  return vehicles;
}

export function getIncidents() {
  return incidents;
}

export function getAlerts() {
  return alerts;
}

export function getPredictions() {
  return [
    {
      id: "pred-1",
      location: "Sikkim Corridor",
      hazard: "Landslide",
      probability: 78,
      severity: "High",
      window: "Next 6 hours",
      affectedCorridors: 3,
      action: "Pre-position emergency supplies and reroute heavy vehicles.",
    },
    {
      id: "pred-2",
      location: "Dhemaji Flood Zone",
      hazard: "Flood",
      probability: 69,
      severity: "High",
      window: "Next 12 hours",
      affectedCorridors: 2,
      action: "Restrict low-lying route access and deploy flood relief convoys.",
    },
    {
      id: "pred-3",
      location: "North Sikkim",
      hazard: "Heavy Rainfall",
      probability: 82,
      severity: "Critical",
      window: "Next 24 hours",
      affectedCorridors: 6,
      action: "Alert field teams and suspend non-essential cargo movement.",
    },
  ];
}

export function calculateRoute(request: RouteRequest) {
  const baseRoutes = [
    {
      name: "Route A · Shortest Route",
      distanceKm: 182,
      etaMinutes: 320,
      risk: "High",
      resilience: 42,
      roadCondition: "Restricted",
      weatherRisk: 82,
      traffic: 74,
      potentialDelay: 47,
    },
    {
      name: "Route B · Safest Route",
      distanceKm: 194,
      etaMinutes: 345,
      risk: "Low",
      resilience: 87,
      roadCondition: "Accessible",
      weatherRisk: 37,
      traffic: 46,
      potentialDelay: 18,
    },
    {
      name: "Route C · Emergency Corridor",
      distanceKm: 210,
      etaMinutes: 390,
      risk: "Moderate",
      resilience: 74,
      roadCondition: "Escort Required",
      weatherRisk: 52,
      traffic: 38,
      potentialDelay: 12,
    },
  ];

  return baseRoutes.map((route) => ({
    ...route,
    origin: request.origin,
    destination: request.destination,
    vehicleType: request.vehicleType,
    cargoType: request.cargoType,
    priority: request.priority,
    departureTime: request.departureTime,
  }));
}

export async function submitIncident(payload: Record<string, unknown>) {
  return {
    success: true,
    saved: payload,
    queued: true,
    id: `offline-${Date.now()}`,
  };
}

export async function syncOfflineReports() {
  return {
    success: true,
    synced: 3,
    message: "3 offline reports synchronized successfully.",
  };
}
