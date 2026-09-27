import { useEffect, useMemo, useState } from "react";
import {
  Route,
  ArrowRight,
  Clock3,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  TriangleAlert,
  Gauge,
  Milestone,
} from "lucide-react";

import NERMap from "../components/NERMap";
import { apiFetch } from "../lib/api";
import "./routes-page.css";

/**
 * Routing UI for POST /api/routes/plan-district.
 *
 * The backend routes over the real connected road graph with pgr_dijkstra and
 * identifies endpoints by state + district, not by city name. It returns two
 * independently-computed paths:
 *
 *   safest_route   risk-weighted cost  -- the primary recommendation
 *   fastest_route  distance-only cost  -- shown for comparison
 *
 * These are two real paths, not one path plus a synthesised alternative, so
 * they can legitimately be identical when the safest way is also the shortest.
 */

interface DistrictOption {
  state: string;
  district: string;
}

interface RouteSegment {
  road_id: string;
  name: string;
  road_number: string;
  status: string;
  risk_score: number;
  risk_level: string;
}

interface RoutePath {
  total_distance_km: number;
  estimated_time_minutes: number;
  segment_count: number;
  worst_risk_level: string;
  road_names: string[];
  segments: RouteSegment[];
  geometry?: {
    type: string;
    coordinates: number[][];
  } | null;
}

interface DistrictRouteResult {
  origin: DistrictOption;
  destination: DistrictOption;
  safest_route: RoutePath;
  fastest_route: RoutePath;
  engine: {
    type: string;
    turn_by_turn_routing: boolean;
    primary_objective: string;
    note: string;
  };
}

/**
 * Cities the demo script mentions, mapped to the district that contains them.
 *
 * These are only shortcuts. Each one is checked against the districts the API
 * actually returned before it is offered, so a quick pick can never select a
 * district the backend cannot route through. If the road data does not cover
 * a district, its button simply does not appear.
 */
const CITY_SHORTCUTS: Array<{ city: string } & DistrictOption> = [
  { city: "Gangtok", state: "Sikkim", district: "East Sikkim" },
  { city: "Guwahati", state: "Assam", district: "Kamrup Metropolitan" },
  { city: "Shillong", state: "Meghalaya", district: "East Khasi Hills" },
  { city: "Imphal", state: "Manipur", district: "Imphal West" },
  { city: "Dibrugarh", state: "Assam", district: "Dibrugarh" },
  { city: "Aizawl", state: "Mizoram", district: "Aizawl" },
  { city: "Kohima", state: "Nagaland", district: "Kohima" },
  { city: "Agartala", state: "Tripura", district: "West Tripura" },
];

/** Stable "State|District" key, used as the select value. */
function keyOf(option: DistrictOption): string {
  return `${option.state}|${option.district}`;
}

function labelOf(option: DistrictOption): string {
  return `${option.district}, ${option.state}`;
}

function parseKey(key: string): DistrictOption | null {
  const [state, district] = key.split("|");
  return state && district ? { state, district } : null;
}

/**
 * First and last coordinate of a route geometry.
 *
 * ST_LineMerge returns a LineString when the path joins cleanly and a
 * MultiLineString when it does not, so both shapes have to be handled. These
 * are only used to place the origin/destination markers -- the route line
 * itself is drawn from the full geometry, so an odd result here costs a marker
 * and nothing more.
 */
function endpointsOf(
  geometry: RoutePath["geometry"],
): { start: [number, number]; end: [number, number] } | null {
  if (!geometry?.coordinates?.length) return null;

  const flatten = (value: unknown): number[][] => {
    if (!Array.isArray(value)) return [];
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      return [value as number[]];
    }
    return (value as unknown[]).flatMap(flatten);
  };

  const points = flatten(geometry.coordinates);
  if (points.length < 2) return null;

  const first = points[0];
  const last = points[points.length - 1];

  return {
    start: [first[0], first[1]],
    end: [last[0], last[1]],
  };
}

function RoutesPage() {
  const [districts, setDistricts] = useState<DistrictOption[]>([]);
  const [districtsError, setDistrictsError] = useState("");
  const [loadingDistricts, setLoadingDistricts] = useState(true);

  const [originKey, setOriginKey] = useState("");
  const [destinationKey, setDestinationKey] = useState("");

  const [result, setResult] = useState<DistrictRouteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // The dropdowns are populated from the API rather than hardcoded, so they
  // can only ever offer districts that actually have road data behind them.
  useEffect(() => {
    let cancelled = false;

    async function loadDistricts() {
      try {
        const data = await apiFetch<{ districts: DistrictOption[] }>(
          "/api/districts",
        );
        if (cancelled) return;

        const options = data.districts ?? [];
        setDistricts(options);

        if (options.length >= 2) {
          setOriginKey(keyOf(options[0]));
          setDestinationKey(keyOf(options[1]));
        }
      } catch (err) {
        if (!cancelled) {
          setDistrictsError(
            err instanceof Error ? err.message : "Unable to load districts.",
          );
        }
      } finally {
        if (!cancelled) setLoadingDistricts(false);
      }
    }

    loadDistricts();
    return () => {
      cancelled = true;
    };
  }, []);

  const availableKeys = useMemo(
    () => new Set(districts.map(keyOf)),
    [districts],
  );

  const shortcuts = useMemo(
    () => CITY_SHORTCUTS.filter((entry) => availableKeys.has(keyOf(entry))),
    [availableKeys],
  );

  async function handlePlanRoute() {
    const origin = parseKey(originKey);
    const destination = parseKey(destinationKey);

    if (!origin || !destination) {
      setError("Select both an origin and a destination district.");
      return;
    }

    if (originKey === destinationKey) {
      setError("Origin and destination must be different districts.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const data = await apiFetch<DistrictRouteResult>(
        "/api/routes/plan-district",
        {
          method: "POST",
          body: JSON.stringify({
            origin_state: origin.state,
            origin_district: origin.district,
            destination_state: destination.state,
            destination_district: destination.district,
          }),
        },
      );
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to plan route.");
    } finally {
      setLoading(false);
    }
  }

  // Adapt the district response into the shape NERMap draws. Marker positions
  // come from the safest route's own geometry, so they sit on the road rather
  // than at a district centroid the path may never touch.
  const mapPlan = useMemo(() => {
    if (!result) return null;

    const endpoints = endpointsOf(result.safest_route.geometry);

    return {
      origin: {
        name: labelOf(result.origin),
        longitude: endpoints?.start[0] ?? null,
        latitude: endpoints?.start[1] ?? null,
      },
      destination: {
        name: labelOf(result.destination),
        longitude: endpoints?.end[0] ?? null,
        latitude: endpoints?.end[1] ?? null,
      },
      recommended_route: {
        name: "Safest route",
        road_number: `${result.safest_route.segment_count} segments`,
        geometry: result.safest_route.geometry ?? undefined,
      },
      alternate_route: {
        name: "Fastest route",
        road_number: `${result.fastest_route.segment_count} segments`,
        geometry: result.fastest_route.geometry ?? undefined,
      },
    };
  }, [result]);

  const sameRoute =
    result !== null &&
    result.safest_route.segments.map((s) => s.road_id).join(">") ===
      result.fastest_route.segments.map((s) => s.road_id).join(">");

  const detour = result
    ? {
        km:
          result.safest_route.total_distance_km -
          result.fastest_route.total_distance_km,
        minutes:
          result.safest_route.estimated_time_minutes -
          result.fastest_route.estimated_time_minutes,
      }
    : null;

  const disabled = loading || loadingDistricts || districts.length < 2;

  return (
    <section className="content routes-page">
      <div className="page-heading">
        <div>
          <h2>Route Intelligence</h2>
          <p>
            District-to-district routing over the real road graph, optimised
            for safety first and compared against the shortest path.
          </p>
        </div>

        <div className="status">
          <span></span>
          Routing Engine Online
        </div>
      </div>

      {/* ROUTE REQUEST */}
      <div className="route-request-card">
        <div className="route-request-header">
          <div>
            <h3>Plan a Logistics Route</h3>
            <p>
              Districts are loaded from the road network itself, so every
              option listed has real road data behind it.
            </p>
          </div>
        </div>

        {districtsError && (
          <div className="route-error">
            <AlertTriangle size={20} />
            <div>
              <strong>Could not load districts</strong>
              <p>{districtsError}</p>
            </div>
          </div>
        )}

        <div className="route-form">
          <div className="route-input-group">
            <label>Origin</label>
            <select
              value={originKey}
              disabled={loadingDistricts || districts.length === 0}
              onChange={(e) => setOriginKey(e.target.value)}
            >
              {loadingDistricts && <option>Loading districts…</option>}
              {!loadingDistricts && districts.length === 0 && (
                <option>No districts available</option>
              )}
              {districts.map((option) => (
                <option key={keyOf(option)} value={keyOf(option)}>
                  {labelOf(option)}
                </option>
              ))}
            </select>
          </div>

          <ArrowRight className="route-arrow" size={22} />

          <div className="route-input-group">
            <label>Destination</label>
            <select
              value={destinationKey}
              disabled={loadingDistricts || districts.length === 0}
              onChange={(e) => setDestinationKey(e.target.value)}
            >
              {loadingDistricts && <option>Loading districts…</option>}
              {!loadingDistricts && districts.length === 0 && (
                <option>No districts available</option>
              )}
              {districts.map((option) => (
                <option key={keyOf(option)} value={keyOf(option)}>
                  {labelOf(option)}
                </option>
              ))}
            </select>
          </div>

          <button
            className="plan-route-button"
            onClick={handlePlanRoute}
            disabled={disabled}
          >
            {loading ? (
              <>
                <Loader2 size={18} className="spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Route size={18} />
                Plan Route
              </>
            )}
          </button>
        </div>

        {shortcuts.length > 0 && (
          <div className="route-shortcuts">
            <span className="route-shortcuts-label">Quick picks</span>
            {shortcuts.map((entry) => (
              <div className="route-shortcut" key={entry.city}>
                <strong>{entry.city}</strong>
                <button
                  type="button"
                  onClick={() => setOriginKey(keyOf(entry))}
                  disabled={loading}
                >
                  From
                </button>
                <button
                  type="button"
                  onClick={() => setDestinationKey(keyOf(entry))}
                  disabled={loading}
                >
                  To
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ERROR */}
      {error && (
        <div className="route-error">
          <AlertTriangle size={20} />
          <div>
            <strong>Route Planning Error</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* RESULTS */}
      {result && (
        <>
          <div className="route-summary">
            <div className="route-location">
              <span>ORIGIN</span>
              <strong>{labelOf(result.origin)}</strong>
            </div>

            <ArrowRight size={24} />

            <div className="route-location">
              <span>DESTINATION</span>
              <strong>{labelOf(result.destination)}</strong>
            </div>

            <div className="route-saved">
              <ShieldCheck size={18} />
              {result.safest_route.segment_count} segments routed
            </div>
          </div>

          <div className="route-options">
            <RouteOption
              recommended
              title="Safest Route"
              subtitle="Risk-weighted cost"
              path={result.safest_route}
            />
            <RouteOption
              title="Fastest Route"
              subtitle="Distance-only cost"
              path={result.fastest_route}
            />
          </div>

          {sameRoute ? (
            <div className="recommendation-card">
              <div className="recommendation-icon">
                <ShieldCheck size={22} />
              </div>
              <div>
                <h3>Safest and fastest are the same path</h3>
                <p>
                  Both cost functions independently selected the same road
                  segments, so there is no safety/time trade-off to make on
                  this pair right now. That can change as live rainfall
                  re-scores the network.
                </p>
              </div>
            </div>
          ) : (
            detour && (
              <div className="recommendation-card">
                <div className="recommendation-icon">
                  <ShieldCheck size={22} />
                </div>
                <div>
                  <h3>Why the safest route?</h3>
                  <p>
                    Avoiding the higher-risk corridors costs{" "}
                    <strong>
                      {detour.km >= 0 ? "+" : ""}
                      {detour.km.toFixed(1)} km
                    </strong>{" "}
                    and{" "}
                    <strong>
                      {detour.minutes >= 0 ? "+" : ""}
                      {detour.minutes} min
                    </strong>{" "}
                    against the shortest path, and brings the worst risk level
                    on the route from{" "}
                    <strong>{result.fastest_route.worst_risk_level}</strong>{" "}
                    down to{" "}
                    <strong>{result.safest_route.worst_risk_level}</strong>.
                    Worst-level is reported rather than an average so a single
                    critical segment cannot hide inside an otherwise calm
                    route.
                  </p>
                </div>
              </div>
            )
          )}

          <div className="route-map-card">
            <div className="card-header">
              <div>
                <h3>Route Visualization</h3>
                <p>Safest route and fastest route drawn together</p>
              </div>
            </div>

            <div className="route-map-container">
              {mapPlan && <NERMap routePlan={mapPlan} />}
            </div>
          </div>

          <SegmentTable
            path={result.safest_route}
            title="Safest Route Segments"
          />

          <div className="mvp-notice">
            <TriangleAlert size={18} />
            <div>
              <strong>Engine: {result.engine.type}</strong>
              <p>{result.engine.note}</p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function RouteOption({
  path,
  title,
  subtitle,
  recommended = false,
}: {
  path: RoutePath;
  title: string;
  subtitle: string;
  recommended?: boolean;
}) {
  const riskClass = (path.worst_risk_level ?? "low").toLowerCase();

  return (
    <div className={`route-option ${recommended ? "recommended" : ""}`}>
      <div className="route-option-top">
        <div>
          {recommended && <span className="recommended-badge">RECOMMENDED</span>}
          <h3>{title}</h3>
        </div>

        {recommended && <ShieldCheck size={24} />}
      </div>

      <div className="route-name">
        <strong>{subtitle}</strong>
        <span>{path.segment_count} road segments</span>
      </div>

      <div className="route-metrics">
        <div>
          <Clock3 size={17} />
          <span>Estimated Time</span>
          <strong>{path.estimated_time_minutes} min</strong>
        </div>

        <div>
          <Milestone size={17} />
          <span>Distance</span>
          <strong>{path.total_distance_km} km</strong>
        </div>

        <div>
          <span className={`risk-dot ${riskClass}`}></span>
          <span>Worst Risk</span>
          <strong>{path.worst_risk_level}</strong>
        </div>
      </div>

      <div className="route-status">
        Via:
        <strong>
          {path.road_names.slice(0, 3).filter(Boolean).join(" → ") || "—"}
          {path.road_names.length > 3
            ? ` +${path.road_names.length - 3} more`
            : ""}
        </strong>
      </div>
    </div>
  );
}

function SegmentTable({ path, title }: { path: RoutePath; title: string }) {
  if (path.segments.length === 0) return null;

  return (
    <div className="considered-incidents">
      <div className="section-title">
        <div>
          <h3>{title}</h3>
          <p>Every road the engine actually routed through, in order.</p>
        </div>
        <span>{path.segments.length}</span>
      </div>

      <div className="incident-grid">
        {path.segments.map((segment, index) => (
          <div
            className="considered-incident"
            key={`${segment.road_id}-${index}`}
          >
            <Gauge size={18} />
            <div>
              <strong>{segment.name || "Unnamed road"}</strong>
              <span>
                {segment.road_number || "—"} · {segment.status}
              </span>
              <small>
                Risk {segment.risk_score}/100 · {segment.risk_level}
              </small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default RoutesPage;
