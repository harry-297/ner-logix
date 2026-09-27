/**
 * Small geometry toolkit for vehicle tracking.
 *
 * A route is stored as a polyline plus the cumulative distance (km) at every
 * vertex. That lets us answer the three questions tracking needs cheaply:
 *
 *   - "where is the point N km along this route?"          -> pointAt
 *   - "which stretch of the route lies between A and B km?" -> sliceBetween
 *   - "how far along the route is this GPS fix?"            -> snapToPolyline
 *
 * The last one is what makes the tracker source-agnostic: simulated pings and
 * real GPS pings are both just lng/lat, and both get snapped onto the route to
 * work out progress.
 */

export type LngLat = [number, number];

const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_DEGREE = 111.195;

const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Polyline {
  coords: LngLat[];
  /** cumKm[i] = distance from the start to coords[i]. cumKm[0] === 0. */
  cumKm: number[];
  totalKm: number;
}

export function buildPolyline(coords: LngLat[]): Polyline {
  const cumKm: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cumKm.push(cumKm[i - 1] + haversineKm(coords[i - 1], coords[i]));
  }
  return { coords, cumKm, totalKm: cumKm[cumKm.length - 1] ?? 0 };
}

/**
 * Drops vertices closer than `minKm` to the previously kept one. Routing
 * engines return a vertex every few metres; for drawing and snapping we do
 * not need that, and 10k-point lines make per-frame map updates sluggish.
 */
export function simplifyByDistance(coords: LngLat[], minKm: number): LngLat[] {
  if (coords.length <= 2) return coords;
  const out: LngLat[] = [coords[0]];
  for (let i = 1; i < coords.length - 1; i++) {
    if (haversineKm(out[out.length - 1], coords[i]) >= minKm) out.push(coords[i]);
  }
  out.push(coords[coords.length - 1]);
  return out;
}

/** Index of the segment containing `km` (segment i runs coords[i] -> coords[i+1]). */
function segmentIndexAt(line: Polyline, km: number): number {
  const last = line.coords.length - 2;
  if (last < 0) return 0;
  let lo = 0;
  let hi = last;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (line.cumKm[mid] <= km) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function pointAt(line: Polyline, km: number): { point: LngLat; index: number } {
  if (line.coords.length === 0) return { point: [0, 0], index: 0 };
  if (line.coords.length === 1) return { point: line.coords[0], index: 0 };

  const clamped = Math.min(Math.max(km, 0), line.totalKm);
  const index = segmentIndexAt(line, clamped);
  const segLen = line.cumKm[index + 1] - line.cumKm[index];
  const t = segLen > 0 ? (clamped - line.cumKm[index]) / segLen : 0;
  const a = line.coords[index];
  const b = line.coords[index + 1];
  return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], index };
}

/** The part of the route between two distances, as a drawable coordinate list. */
export function sliceBetween(line: Polyline, fromKm: number, toKm: number): LngLat[] {
  if (toKm <= fromKm) {
    const p = pointAt(line, fromKm).point;
    return [p, p];
  }
  const a = pointAt(line, fromKm);
  const b = pointAt(line, toKm);
  const out: LngLat[] = [a.point];
  for (let j = a.index + 1; j <= b.index; j++) {
    if (line.cumKm[j] > fromKm && line.cumKm[j] < toKm) out.push(line.coords[j]);
  }
  out.push(b.point);
  return out;
}

export interface Snap {
  /** Distance along the route of the closest point. */
  km: number;
  point: LngLat;
  /** How far the input was from the route, in km. */
  offKm: number;
}

/**
 * Projects a GPS fix onto the route.
 *
 * `hintKm` (the previous position) only breaks ties, e.g. where a road doubles
 * back and two stretches are equally close; it never overrides a clearly
 * closer match.
 */
export function snapToPolyline(line: Polyline, p: LngLat, hintKm?: number): Snap {
  if (line.coords.length < 2) {
    return { km: 0, point: line.coords[0] ?? p, offKm: 0 };
  }

  // Local equirectangular projection: accurate enough over a route segment.
  const cosLat = Math.cos(toRad(p[1]));
  let best: Snap | null = null;

  for (let i = 0; i < line.coords.length - 1; i++) {
    const a = line.coords[i];
    const b = line.coords[i + 1];

    const ax = a[0] * cosLat;
    const bx = b[0] * cosLat;
    const px = p[0] * cosLat;
    const dx = bx - ax;
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;

    let t = lenSq > 0 ? ((px - ax) * dx + (p[1] - a[1]) * dy) / lenSq : 0;
    t = Math.min(1, Math.max(0, t));

    const projX = ax + dx * t;
    const projY = a[1] + dy * t;
    const offKm = Math.hypot(px - projX, p[1] - projY) * KM_PER_DEGREE;
    const km = line.cumKm[i] + t * (line.cumKm[i + 1] - line.cumKm[i]);

    const better =
      best === null ||
      offKm < best.offKm - 0.03 ||
      (hintKm !== undefined &&
        Math.abs(offKm - best.offKm) <= 0.03 &&
        Math.abs(km - hintKm) < Math.abs(best.km - hintKm));

    if (better) {
      best = { km, offKm, point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] };
    }
  }

  return best as Snap;
}
