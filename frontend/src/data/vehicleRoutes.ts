/**
 * Planned route for each tracked vehicle, keyed by vehicle id.
 *
 * Each route is an ordered list of named stops: first = origin, last =
 * destination. These serve two purposes:
 *
 *   1. They are sent to the road-routing service so the drawn path follows
 *      real roads (see services/routeService.ts).
 *   2. If routing is unavailable, they ARE the path (straight lines between
 *      stops) and the map labels it "approximate".
 *
 * `via: true` marks intermediate stops that are guaranteed to sit on the main
 * highway; the router is forced through them. Stops without it are used only
 * for the "Near <place>" label and the approximate fallback path, so a slightly
 * misplaced coordinate can never drag the real route onto the wrong road.
 *
 * Coordinates are [longitude, latitude].
 *
 * When vehicles come from the backend, this table goes away: the route
 * geometry arrives with the trip (e.g. from /api/routes/plan-district).
 */
export interface RouteStopDef {
  name: string;
  lng: number;
  lat: number;
  via?: boolean;
}

export const vehicleRoutes: Record<string, RouteStopDef[]> = {
  // Guwahati -> Tawang (Medicines): NH-27 / NH-13 via Tezpur, Bomdila, Sela Pass
  "VH-1042": [
    { name: "Guwahati", lng: 91.7362, lat: 26.1445 },
    { name: "Nagaon", lng: 92.684, lat: 26.348 },
    { name: "Tezpur", lng: 92.7926, lat: 26.6338, via: true },
    { name: "Bhalukpong", lng: 92.65, lat: 27.017, via: true },
    { name: "Bomdila", lng: 92.4157, lat: 27.2645, via: true },
    { name: "Dirang", lng: 92.2436, lat: 27.3586, via: true },
    { name: "Sela Pass", lng: 92.0947, lat: 27.5 },
    { name: "Tawang", lng: 91.8594, lat: 27.586 },
  ],

  // Shillong -> Nongstoin (Food Supplies)
  "VH-1043": [
    { name: "Shillong", lng: 91.8825, lat: 25.5788 },
    { name: "Mairang", lng: 91.6333, lat: 25.5667, via: true },
    { name: "Nongstoin", lng: 91.2667, lat: 25.5167 },
  ],

  // Gangtok -> Mangan (Construction Material): North Sikkim highway
  "VH-1044": [
    { name: "Gangtok", lng: 88.6138, lat: 27.3314 },
    { name: "Phodong", lng: 88.5722, lat: 27.4128 },
    { name: "Singhik", lng: 88.533, lat: 27.452 },
    { name: "Mangan", lng: 88.5322, lat: 27.5107 },
  ],

  // Imphal -> Ukhrul (Agricultural Produce)
  "VH-1045": [
    { name: "Imphal", lng: 93.9368, lat: 24.817 },
    { name: "Ukhrul", lng: 94.3667, lat: 25.1167 },
  ],

  // Dibrugarh -> Ziro (Fuel & Essentials): via Dhemaji and North Lakhimpur
  "VH-1046": [
    { name: "Dibrugarh", lng: 94.912, lat: 27.4728 },
    { name: "Dhemaji", lng: 94.5833, lat: 27.4833, via: true },
    { name: "North Lakhimpur", lng: 94.1, lat: 27.2333, via: true },
    { name: "Ziro", lng: 93.83, lat: 27.545 },
  ],

  // Agartala -> Kanchanpur (Medicines) - already arrived
  "VH-1047": [
    { name: "Agartala", lng: 91.2868, lat: 23.8315 },
    { name: "Kanchanpur", lng: 92.18, lat: 24.29 },
  ],

  // Kohima -> Zunheboto (Food Supplies)
  "VH-1048": [
    { name: "Kohima", lng: 94.1086, lat: 25.6747 },
    { name: "Zunheboto", lng: 94.5252, lat: 26.0089 },
  ],

  // Aizawl -> Lunglei (Construction Material): NH-54 via Thenzawl
  "VH-1049": [
    { name: "Aizawl", lng: 92.7176, lat: 23.7271 },
    { name: "Thenzawl", lng: 92.75, lat: 23.29 },
    { name: "Lunglei", lng: 92.735, lat: 22.888 },
  ],
};
