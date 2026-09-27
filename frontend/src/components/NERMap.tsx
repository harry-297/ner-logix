import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Database, RefreshCw, Layers, X } from "lucide-react";

import { authFetch } from "../lib/api";



/** How often the map re-pulls roads + incidents from the API. */
const REFRESH_INTERVAL_MS = 60_000;

/**
 * A planned route, as handed down by RoutesPage.
 *
 * Coordinates are optional because /api/routes/plan-district identifies its
 * endpoints by state + district, not lat/lng. RoutesPage derives approximate
 * marker positions from the route geometry where it can; where it cannot,
 * the line is still drawn and the markers are simply skipped.
 */
interface RoutePlan {
  origin: {
    name: string;
    latitude?: number | null;
    longitude?: number | null;
  };

  destination: {
    name: string;
    latitude?: number | null;
    longitude?: number | null;
  };

  recommended_route?: {
    name: string;
    road_number: string;
    geometry?: {
      type: string;
      coordinates: number[][];
    };
  };

  alternate_route?: {
    name: string;
    road_number: string;
    geometry?: {
      type: string;
      coordinates: number[][];
    };
  };
}


// ============================================================
// ROAD TYPES
// ============================================================

type RoadProperties = {
  id: string;
  name: string;
  roadNumber: string;
  state: string;
  district: string;
  roadType: string;
  status: string;
  riskScore: number;
  riskLevel: string;
  expectedDelay: number;
};

type RoadFeature = {
  type: "Feature";
  properties: RoadProperties;
  geometry: {
    type: string;
    coordinates: any;
  };
};

/**
 * The backend stores one row per OSM "way" — a long highway like SH5 is
 * split into dozens or hundreds of short segments, each scored on its own.
 * A "corridor" is every segment that shares a road number (or, for unnamed
 * roads, every segment sharing the same name) within one state. Selecting
 * "SH5" should highlight the whole corridor, not the one segment a click or
 * dropdown option happened to land on.
 */
type RoadCorridor = {
  key: string;
  label: string;
  roadNumber: string | null;
  state: string;
  segmentIds: string[];
  segmentCount: number;
  worstStatus: string;
  maxRiskScore: number;
  representative: RoadFeature;
};

const STATUS_SEVERITY: Record<string, number> = {
  BLOCKED: 4,
  DISRUPTED: 3,
  RESTRICTED: 2,
  ACCESSIBLE: 1,
};

function corridorKeyFor(properties: RoadProperties): string {
  const label = (properties.roadNumber || properties.name || "unknown").trim();
  return `${label}::${properties.state}`;
}

function buildRoadCorridors(roads: RoadFeature[]): RoadCorridor[] {
  const byKey = new Map<string, RoadCorridor>();

  for (const road of roads) {
    const key = corridorKeyFor(road.properties);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, {
        key,
        label: road.properties.roadNumber || road.properties.name || "Unnamed road",
        roadNumber: road.properties.roadNumber || null,
        state: road.properties.state,
        segmentIds: [road.properties.id],
        segmentCount: 1,
        worstStatus: road.properties.status,
        maxRiskScore: road.properties.riskScore,
        representative: road,
      });
      continue;
    }

    existing.segmentIds.push(road.properties.id);
    existing.segmentCount += 1;

    const currentSeverity = STATUS_SEVERITY[String(existing.worstStatus).toUpperCase()] ?? 0;
    const nextSeverity = STATUS_SEVERITY[String(road.properties.status).toUpperCase()] ?? 0;

    if (nextSeverity > currentSeverity) {
      existing.worstStatus = road.properties.status;
    }

    if (road.properties.riskScore > existing.maxRiskScore) {
      existing.maxRiskScore = road.properties.riskScore;
      existing.representative = road;
    }
  }

  return Array.from(byKey.values()).sort(
    (a, b) => b.maxRiskScore - a.maxRiskScore,
  );
}


// ============================================================
// INCIDENT TYPES
// ============================================================

type IncidentProperties = {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  state: string;
  district: string;
  source: string;
  status: string;
  reportedAt: string;
};

type IncidentFeature = {
  type: "Feature";
  properties: IncidentProperties;
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
};


// ============================================================
// COLOURS
// ============================================================

const RISK_COLORS: Record<string, string> = {
  LOW: "#22c55e",
  MODERATE: "#eab308",
  HIGH: "#f97316",
  CRITICAL: "#ef4444",
  BLOCKED: "#0f172a",
};

const UNKNOWN_COLOR = "#94a3b8";

/**
 * A road's colour is driven by STATUS first, then risk level.
 *
 * The backend scores status and risk level on two different thresholds:
 * a score of 0.87 is status=BLOCKED but risk_level=HIGH. The old map only
 * looked at riskLevel, so a blocked road still painted orange. Status wins
 * here, because "you cannot drive on it" matters more than the band the
 * score happens to fall into.
 */
const ROAD_COLOR_EXPRESSION: any = [
  "case",

  ["==", ["upcase", ["coalesce", ["get", "status"], ""]], "BLOCKED"],
  RISK_COLORS.BLOCKED,

  [
    "match",
    ["upcase", ["coalesce", ["get", "riskLevel"], ""]],

    "CRITICAL",
    RISK_COLORS.CRITICAL,

    "HIGH",
    RISK_COLORS.HIGH,

    "MODERATE",
    RISK_COLORS.MODERATE,

    "LOW",
    RISK_COLORS.LOW,

    UNKNOWN_COLOR,
  ],
];

/** Matches nothing — used to hide a layer without touching visibility. */
const MATCH_NOTHING: any = ["==", ["get", "id"], "\u0000__none__"];


// ============================================================
// HELPERS
// ============================================================

function roadColorFor(properties: RoadProperties): string {
  if (String(properties.status || "").toUpperCase() === "BLOCKED") {
    return RISK_COLORS.BLOCKED;
  }

  return (
    RISK_COLORS[String(properties.riskLevel || "").toUpperCase()] ||
    UNKNOWN_COLOR
  );
}

function severityColorFor(severity: string): string {
  switch (String(severity || "").toUpperCase()) {
    case "CRITICAL":
      return "#ef4444";
    case "HIGH":
      return "#f97316";
    case "MEDIUM":
      return "#eab308";
    case "LOW":
      return "#22c55e";
    default:
      return UNKNOWN_COLOR;
  }
}

/** Walks any GeoJSON coordinate nesting and extends the bounds. */
function extendBounds(bounds: maplibregl.LngLatBounds, coordinates: any) {
  if (!Array.isArray(coordinates)) return;

  if (
    coordinates.length >= 2 &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    bounds.extend([coordinates[0], coordinates[1]] as [number, number]);
    return;
  }

  coordinates.forEach((child: any) => extendBounds(bounds, child));
}

function formatClock(date: Date | null): string {
  if (!date) return "—";

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function buildRoadPopupHTML(properties: RoadProperties): string {
  const color = roadColorFor(properties);

  const row = (label: string, value: string) => `
    <div class="ner-popup-row">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;

  return `
    <div class="ner-popup">
      <div class="ner-popup-head">
        <span class="ner-popup-swatch" style="background:${color};"></span>
        <div>
          <div class="ner-popup-title">${properties.name ?? "Road"}</div>
          <div class="ner-popup-sub">${properties.roadNumber ?? ""}</div>
        </div>
      </div>

      ${row("Risk Score", `${properties.riskScore}/100`)}
      ${row("Risk Level", String(properties.riskLevel ?? "—"))}
      ${row("Status", String(properties.status ?? "—"))}
      ${row("District", String(properties.district ?? "—"))}
      ${row("State", String(properties.state ?? "—"))}
      ${row("Expected Delay", `${properties.expectedDelay ?? 0} min`)}
    </div>
  `;
}

function buildIncidentPopupHTML(properties: IncidentProperties): string {
  const color = severityColorFor(properties.severity);

  const row = (label: string, value: string) => `
    <div class="ner-popup-row">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `;

  return `
    <div class="ner-popup">
      <div class="ner-popup-head">
        <span class="ner-popup-dot" style="background:${color};"></span>
        <div>
          <div class="ner-popup-title">${properties.title ?? "Incident"}</div>
          <div class="ner-popup-sub">${properties.type ?? ""}</div>
        </div>
      </div>

      ${row("Severity", String(properties.severity ?? "—"))}
      ${row("Status", String(properties.status ?? "—"))}
      ${row("District", String(properties.district ?? "—"))}
      ${row("State", String(properties.state ?? "—"))}

      <div class="ner-popup-note">${properties.description ?? ""}</div>
      <div class="ner-popup-meta">Source: ${properties.source ?? "—"}</div>
    </div>
  `;
}


// ============================================================
// MAP COMPONENT
// ============================================================

function NERMap({
  routePlan,
  variant = "full",
  interactive = true,
  refreshIntervalMs = REFRESH_INTERVAL_MS,
}: {
  routePlan?: RoutePlan | null;
  /** "full" shows the lookup toolbar + legends (Live Map page).
   *  "preview" renders a clean, chrome-free map for dashboard cards. */
  variant?: "full" | "preview";
  /** Disable scroll-zoom / drag for small embedded previews. */
  interactive?: boolean;
  /** Auto-refresh cadence. Pass 0 to disable polling. */
  refreshIntervalMs?: number;
}) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);

  const [roads, setRoads] = useState<RoadFeature[]>([]);
  const [incidents, setIncidents] = useState<IncidentFeature[]>([]);

  // Every raw segment grouped into whole-highway corridors (see
  // buildRoadCorridors above) — this is what the dropdown and click
  // highlighting actually operate on, not individual DB rows.
  const roadCorridors = useMemo(() => buildRoadCorridors(roads), [roads]);

  const corridorByKey = useMemo(() => {
    const map = new Map<string, RoadCorridor>();
    roadCorridors.forEach((corridor) => map.set(corridor.key, corridor));
    return map;
  }, [roadCorridors]);

  const [selectedCorridorKey, setSelectedCorridorKey] = useState("");
  const [selectedIncidentId, setSelectedIncidentId] = useState("");

  // Which corridor is currently "in focus" — every segment belonging to it
  // gets risk colouring; everything else stays neutral.
  const [focusedCorridorKey, setFocusedCorridorKey] = useState<string | null>(
    null,
  );

  // Preview cards have no toolbar, so they show every road coloured.
  const [showAllRoads, setShowAllRoads] = useState(variant === "preview");

  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Refs let the MapLibre event handlers read current values without
  // being re-registered on every render.
  const roadsRef = useRef<RoadFeature[]>([]);
  const layersReady = useRef(false);

  const popupRef = useRef<maplibregl.Popup | null>(null);
  const openPopupRoadId = useRef<string | null>(null);


  // ==========================================================
  // POPUP (single reusable instance)
  // ==========================================================

  const getPopup = useCallback(() => {
    if (!popupRef.current) {
      // closeOnClick is deliberately false. With it enabled, the popup's own
      // "close on map click" listener can fire inside the very click that
      // opened it, so the card appears to never open at all.
      popupRef.current = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: false,
        maxWidth: "340px",
        className: "ner-map-popup",
        offset: 12,
      });

      popupRef.current.on("close", () => {
        openPopupRoadId.current = null;
      });
    }

    return popupRef.current;
  }, []);


  const showRoadPopup = useCallback(
    (
      nerMap: maplibregl.Map,
      properties: RoadProperties,
      lngLat: maplibregl.LngLatLike,
    ) => {
      openPopupRoadId.current = String(properties.id);

      getPopup()
        .setLngLat(lngLat)
        .setHTML(buildRoadPopupHTML(properties))
        .addTo(nerMap);
    },
    [getPopup],
  );


  // ==========================================================
  // FOCUS / COLOURING
  // ==========================================================

  /**
   * Roads start out uncoloured (plain grey). Colour appears when a
   * *corridor* is focused — every segment sharing that road number, picked
   * from the dropdown or clicked on the map — or when the user asks for
   * every road at once. Filtering by the full segment-id list (rather than
   * a single id) is what makes clicking anywhere on "SH5" light up the
   * whole highway instead of the one OSM way segment under the cursor.
   */
  const applyRoadFocus = useCallback(
    (segmentIds: string[] | null, showAll: boolean) => {
      const nerMap = map.current;

      if (!nerMap || !nerMap.getLayer("ner-road-risk")) return;

      let riskFilter: any;
      let baseFilter: any;

      if (showAll) {
        riskFilter = null;
        baseFilter = MATCH_NOTHING;
      } else if (segmentIds && segmentIds.length > 0) {
        const inGroup = ["in", ["get", "id"], ["literal", segmentIds]];
        riskFilter = inGroup;
        baseFilter = ["!", inGroup];
      } else {
        riskFilter = MATCH_NOTHING;
        baseFilter = null;
      }

      nerMap.setFilter("ner-road-risk", riskFilter);
      nerMap.setFilter("ner-road-casing", riskFilter);
      nerMap.setFilter("ner-road-base", baseFilter);
    },
    [],
  );


  useEffect(() => {
    const corridor = focusedCorridorKey
      ? corridorByKey.get(focusedCorridorKey)
      : null;

    applyRoadFocus(corridor ? corridor.segmentIds : null, showAllRoads);
  }, [focusedCorridorKey, showAllRoads, corridorByKey, applyRoadFocus]);


  // ==========================================================
  // LAYER SETUP (runs once, with empty sources)
  // ==========================================================

  const ensureLayers = useCallback((nerMap: maplibregl.Map) => {
    if (layersReady.current) return;

    const emptyCollection: any = {
      type: "FeatureCollection",
      features: [],
    };

    nerMap.addSource("road-risk", {
      type: "geojson",
      data: emptyCollection,
    });

    nerMap.addSource("incidents", {
      type: "geojson",
      data: emptyCollection,
    });

    // ----- 1. Neutral base: every road that is NOT in focus -----
    nerMap.addLayer({
      id: "ner-road-base",
      type: "line",
      source: "road-risk",

      layout: {
        "line-cap": "round",
        "line-join": "round",
      },

      paint: {
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4, 1.6,
          8, 2.4,
          12, 3.4,
        ],
        "line-color": "#8a94a6",
        "line-opacity": 0.45,
      },
    });

    // ----- 2. Dark casing behind the focused road -----
    nerMap.addLayer({
      id: "ner-road-casing",
      type: "line",
      source: "road-risk",

      layout: {
        "line-cap": "round",
        "line-join": "round",
      },

      filter: MATCH_NOTHING,

      paint: {
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4, 8,
          8, 12,
          12, 16,
        ],
        "line-color": "#ffffff",
        "line-opacity": 0.9,
      },
    });

    // ----- 3. The risk-coloured road itself -----
    nerMap.addLayer({
      id: "ner-road-risk",
      type: "line",
      source: "road-risk",

      layout: {
        "line-cap": "round",
        "line-join": "round",
      },

      filter: MATCH_NOTHING,

      paint: {
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4, 5,
          8, 8,
          12, 12,
        ],
        "line-color": ROAD_COLOR_EXPRESSION,
        "line-opacity": 1,
      },
    });

    // ----- 4. Invisible, generous click target -----
    // Thin lines are very hard to hit with a mouse. This transparent layer
    // is ~22px wide and is what the click handler actually listens to.
    nerMap.addLayer({
      id: "ner-road-hit",
      type: "line",
      source: "road-risk",

      layout: {
        "line-cap": "round",
        "line-join": "round",
      },

      paint: {
        "line-width": 22,
        "line-color": "#000000",
        "line-opacity": 0,
      },
    });

    // ----- 5. Incidents -----
    nerMap.addLayer({
      id: "incident-casing",
      type: "circle",
      source: "incidents",

      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4, 7,
          8, 11,
          12, 15,
        ],
        "circle-color": [
          "match",
          ["upcase", ["coalesce", ["get", "severity"], ""]],
          "CRITICAL", "#ef4444",
          "HIGH", "#f97316",
          "MEDIUM", "#eab308",
          "LOW", "#22c55e",
          UNKNOWN_COLOR,
        ],
        "circle-opacity": 0.25,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });

    nerMap.addLayer({
      id: "incidents-point",
      type: "circle",
      source: "incidents",

      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          4, 4,
          8, 7,
          12, 10,
        ],
        "circle-color": [
          "match",
          ["upcase", ["coalesce", ["get", "severity"], ""]],
          "CRITICAL", "#ef4444",
          "HIGH", "#f97316",
          "MEDIUM", "#eab308",
          "LOW", "#22c55e",
          UNKNOWN_COLOR,
        ],
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
      },
    });

    layersReady.current = true;
  }, []);


  // ==========================================================
  // DATA LOADING + REFRESH
  // ==========================================================

  const loadData = useCallback(
    async (options: { fit?: boolean } = {}) => {
      const nerMap = map.current;

      if (!nerMap || !layersReady.current) return;

      setIsRefreshing(true);

      try {
        const [roadResponse, incidentResponse] = await Promise.all([
          authFetch("/api/roads"),
          authFetch("/api/incidents"),
        ]);

        if (!roadResponse.ok) {
          throw new Error(`Road API returned ${roadResponse.status}`);
        }

        if (!incidentResponse.ok) {
          throw new Error(`Incident API returned ${incidentResponse.status}`);
        }

        const roadData = await roadResponse.json();
        const incidentData = await incidentResponse.json();

        // The map may have been torn down while these requests were open.
        if (!map.current) return;

        const roadFeatures: RoadFeature[] = (roadData.roads || []).map(
          (road: any) => ({
            type: "Feature",
            properties: {
              id: String(road.road_id),
              name: road.name,
              roadNumber: road.road_number,
              state: road.state,
              district: road.district,
              roadType: road.road_type,
              status: road.status,
              riskScore: road.risk_score,
              riskLevel: road.risk_level,
              expectedDelay: road.expected_delay_minutes,
            },
            geometry: road.geometry,
          }),
        );

        const incidentFeatures: IncidentFeature[] = (
          incidentData.incidents || []
        ).map((incident: any) => ({
          type: "Feature",
          properties: {
            id: String(incident.incident_id),
            type: incident.type,
            severity: incident.severity,
            title: incident.title,
            description: incident.description,
            state: incident.state,
            district: incident.district,
            source: incident.source,
            status: incident.status,
            reportedAt: incident.reported_at,
          },
          geometry: incident.geometry,
        }));

        roadsRef.current = roadFeatures;

        setRoads(roadFeatures);
        setIncidents(incidentFeatures);

        const roadSource = nerMap.getSource("road-risk") as
          | maplibregl.GeoJSONSource
          | undefined;

        const incidentSource = nerMap.getSource("incidents") as
          | maplibregl.GeoJSONSource
          | undefined;

        roadSource?.setData({
          type: "FeatureCollection",
          features: roadFeatures,
        } as any);

        incidentSource?.setData({
          type: "FeatureCollection",
          features: incidentFeatures,
        } as any);

        setLastUpdated(new Date());
        setLoadError(null);

        // Keep an open road card in sync with the freshly scored data.
        if (openPopupRoadId.current && popupRef.current?.isOpen()) {
          const openRoad = roadFeatures.find(
            (road) => road.properties.id === openPopupRoadId.current,
          );

          if (openRoad) {
            popupRef.current.setHTML(buildRoadPopupHTML(openRoad.properties));
          }
        }

        // Only frame the data on the very first load — re-framing on every
        // poll would yank the map out from under whoever is reading it.
        if (options.fit) {
          const bounds = new maplibregl.LngLatBounds();
          let hasCoordinates = false;

          roadFeatures.forEach((feature) => {
            if (feature.geometry?.coordinates) {
              extendBounds(bounds, feature.geometry.coordinates);
              hasCoordinates = true;
            }
          });

          incidentFeatures.forEach((feature) => {
            if (feature.geometry?.coordinates) {
              extendBounds(bounds, feature.geometry.coordinates);
              hasCoordinates = true;
            }
          });

          if (hasCoordinates && !bounds.isEmpty()) {
            nerMap.fitBounds(bounds, {
              padding: 100,
              duration: 1200,
              maxZoom: 7,
            });
          }
        }
      } catch (error) {
        console.error("Failed to load NER-LOGIX map data:", error);

        setLoadError(
          error instanceof Error ? error.message : "Unable to reach the API",
        );
      } finally {
        setIsRefreshing(false);
      }
    },
    [],
  );


  // ==========================================================
  // INITIALIZE MAP
  // ==========================================================

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const nerMap = new maplibregl.Map({
      container: mapContainer.current,

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

        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
          },
        ],
      },

      center: [93.5, 27.5],
      zoom: 5,
      minZoom: 4,
      maxZoom: 18,

      scrollZoom: interactive,
      dragPan: interactive,
      dragRotate: false,
      doubleClickZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive,
      attributionControl: false,
    });

    map.current = nerMap;

    if (interactive) {
      nerMap.addControl(new maplibregl.NavigationControl(), "top-right");
      nerMap.addControl(new maplibregl.ScaleControl({ unit: "metric" }));
    }

    nerMap.on("load", () => {
      ensureLayers(nerMap);

      // ------------------------------------------------------
      // ROAD CLICK -> focus + card
      // ------------------------------------------------------

      nerMap.on("click", "ner-road-hit", (event) => {
        const feature = event.features?.[0];

        if (!feature || !feature.properties) return;

        // Stops the generic map-click handler below from closing the card
        // we are about to open.
        (event.originalEvent as any).__nerHandled = true;

        const properties = feature.properties as unknown as RoadProperties;
        const key = corridorKeyFor(properties);

        setFocusedCorridorKey(key);
        setSelectedCorridorKey(key);

        // The popup still shows the exact segment clicked — its own risk
        // score can genuinely differ from the rest of the corridor — while
        // the map highlights the whole highway around it.
        showRoadPopup(nerMap, properties, event.lngLat);
      });

      // ------------------------------------------------------
      // INCIDENT CLICK -> card
      // ------------------------------------------------------

      nerMap.on("click", "incidents-point", (event) => {
        const feature = event.features?.[0];

        if (!feature || !feature.properties) return;

        (event.originalEvent as any).__nerHandled = true;

        const properties =
          feature.properties as unknown as IncidentProperties;

        openPopupRoadId.current = null;

        getPopup()
          .setLngLat(event.lngLat)
          .setHTML(buildIncidentPopupHTML(properties))
          .addTo(nerMap);
      });

      // ------------------------------------------------------
      // BLANK MAP CLICK -> dismiss the card
      // ------------------------------------------------------

      nerMap.on("click", (event) => {
        if ((event.originalEvent as any).__nerHandled) return;

        popupRef.current?.remove();
      });

      // ------------------------------------------------------
      // CURSORS
      // ------------------------------------------------------

      ["ner-road-hit", "incidents-point"].forEach((layerId) => {
        nerMap.on("mouseenter", layerId, () => {
          nerMap.getCanvas().style.cursor = "pointer";
        });

        nerMap.on("mouseleave", layerId, () => {
          nerMap.getCanvas().style.cursor = "";
        });
      });

      applyRoadFocus(null, variant === "preview");

      void loadData({ fit: true });
    });

    return () => {
      popupRef.current?.remove();
      popupRef.current = null;

      layersReady.current = false;

      nerMap.remove();
      map.current = null;
    };
  }, [interactive, variant, ensureLayers, loadData, showRoadPopup, getPopup, applyRoadFocus]);


  // ==========================================================
  // AUTO-REFRESH
  // ==========================================================

  useEffect(() => {
    if (!refreshIntervalMs) return;

    const tick = () => {
      // Skip polling while the tab is in the background, then catch up
      // as soon as the user comes back (handler below).
      if (document.visibilityState !== "visible") return;

      void loadData();
    };

    const timer = window.setInterval(tick, refreshIntervalMs);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void loadData();
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refreshIntervalMs, loadData]);


  // ==========================================================
  // DRAW PLANNED ROUTE
  // ==========================================================

  useEffect(() => {
    const nerMap = map.current;

    if (!nerMap || !routePlan) return;

    const drawRoute = () => {
      const recommended = routePlan.recommended_route;
      const alternate = routePlan.alternate_route;

      const routeLayers = [
        "planned-route-recommended-casing",
        "planned-route-recommended",
        "planned-route-alternate-casing",
        "planned-route-alternate",
      ];

      routeLayers.forEach((layerId) => {
        if (nerMap.getLayer(layerId)) {
          nerMap.removeLayer(layerId);
        }
      });

      ["planned-route-recommended", "planned-route-alternate"].forEach(
        (sourceId) => {
          if (nerMap.getSource(sourceId)) {
            nerMap.removeSource(sourceId);
          }
        },
      );

      const addRoute = (
        sourceId: string,
        geometry: NonNullable<RoutePlan["recommended_route"]>["geometry"],
        casingLayerId: string,
        routeLayerId: string,
        casingColor: string,
        routeColor: string,
      ) => {
        if (!geometry) return;

        nerMap.addSource(sourceId, {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: geometry,
          } as any,
        });

        nerMap.addLayer({
          id: casingLayerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-cap": "round",
            "line-join": "round",
            visibility: "visible",
          },
          paint: {
            "line-color": casingColor,
            "line-width": 11,
            "line-opacity": 1,
          },
        });

        nerMap.addLayer({
          id: routeLayerId,
          type: "line",
          source: sourceId,
          layout: {
            "line-cap": "round",
            "line-join": "round",
            visibility: "visible",
          },
          paint: {
            "line-color": routeColor,
            "line-width": 7,
            "line-opacity": 1,
          },
        });

        const bringRouteToFront = () => {
          try {
            if (nerMap.getLayer(casingLayerId)) {
              nerMap.moveLayer(casingLayerId);
            }

            if (nerMap.getLayer(routeLayerId)) {
              nerMap.moveLayer(routeLayerId);
            }
          } catch (error) {
            console.warn("NER route: could not move layer to top", error);
          }
        };

        bringRouteToFront();
        nerMap.once("idle", bringRouteToFront);
      };

      if (alternate?.geometry) {
        addRoute(
          "planned-route-alternate",
          alternate.geometry,
          "planned-route-alternate-casing",
          "planned-route-alternate",
          "#ffffff",
          "#64748b",
        );
      }

      if (recommended?.geometry) {
        addRoute(
          "planned-route-recommended",
          recommended.geometry,
          "planned-route-recommended-casing",
          "planned-route-recommended",
          "#ffffff",
          "#2563eb",
        );
      }

      document
        .querySelectorAll(".ner-route-marker")
        .forEach((element) => element.remove());

      const addMarker = (
        coordinates: [number, number],
        label: string,
        background: string,
      ) => {
        const element = document.createElement("div");
        element.className = "ner-route-marker";
        element.innerHTML = `
          <div style="
            display:flex;
            align-items:center;
            gap:6px;
            background:#ffffff;
            border:1px solid #cbd5e1;
            border-radius:999px;
            padding:5px 9px;
            box-shadow:0 2px 8px rgba(0,0,0,0.2);
            font-family:Arial,sans-serif;
            font-size:12px;
            font-weight:700;
            color:#0f172a;
            white-space:nowrap;
          ">
            <span style="
              width:9px;
              height:9px;
              border-radius:50%;
              background:${background};
              display:inline-block;
            "></span>
            ${label}
          </div>
        `;

        new maplibregl.Marker({
          element,
          anchor: "bottom",
        })
          .setLngLat(coordinates)
          .addTo(nerMap);
      };

      const addEndpoint = (
        point: RoutePlan["origin"],
        label: string,
        color: string,
      ) => {
        if (
          typeof point.latitude !== "number" ||
          typeof point.longitude !== "number"
        ) {
          return;
        }

        const coordinates: [number, number] = [point.longitude, point.latitude];
        addMarker(coordinates, `${label} · ${point.name}`, color);
        bounds.extend(coordinates);
      };

      const bounds = new maplibregl.LngLatBounds();

      extendBounds(bounds, recommended?.geometry?.coordinates);
      extendBounds(bounds, alternate?.geometry?.coordinates);

      addEndpoint(routePlan.origin, "Origin", "#16a34a");
      addEndpoint(routePlan.destination, "Destination", "#dc2626");

      if (!bounds.isEmpty()) {
        nerMap.fitBounds(bounds, {
          padding: 90,
          duration: 1200,
          maxZoom: 10,
        });
      }
    };

    if (nerMap.isStyleLoaded()) {
      drawRoute();
    } else {
      nerMap.once("load", drawRoute);
    }

    return () => {
      nerMap.off("load", drawRoute);

      [
        "planned-route-recommended-casing",
        "planned-route-recommended",
        "planned-route-alternate-casing",
        "planned-route-alternate",
      ].forEach((layerId) => {
        if (nerMap.getLayer(layerId)) {
          nerMap.removeLayer(layerId);
        }
      });

      ["planned-route-recommended", "planned-route-alternate"].forEach(
        (sourceId) => {
          if (nerMap.getSource(sourceId)) {
            nerMap.removeSource(sourceId);
          }
        },
      );

      document
        .querySelectorAll(".ner-route-marker")
        .forEach((element) => element.remove());
    };
  }, [routePlan]);


  // ==========================================================
  // GO TO ROAD
  // ==========================================================

  const goToCorridor = (corridorKey: string) => {
    const nerMap = map.current;

    if (!nerMap || !corridorKey) return;

    const corridor = corridorByKey.get(corridorKey);

    if (!corridor) return;

    // Frame the ENTIRE highway, not just one OSM way segment. Without this
    // the map zooms to a few hundred metres of road and the rest of the
    // highlighted corridor sits off-screen.
    const segmentIds = new Set(corridor.segmentIds);
    const bounds = new maplibregl.LngLatBounds();

    roadsRef.current.forEach((road) => {
      if (segmentIds.has(road.properties.id)) {
        extendBounds(bounds, road.geometry.coordinates);
      }
    });

    if (bounds.isEmpty()) return;

    // Selecting a road colours that whole corridor, rest stays neutral.
    setShowAllRoads(false);
    setFocusedCorridorKey(corridorKey);
    setSelectedCorridorKey(corridorKey);

    nerMap.fitBounds(bounds, {
      padding: 120,
      duration: 1200,
      maxZoom: 11,
    });

    nerMap.once("moveend", () => {
      // Show the worst-scoring segment of the corridor — that's the one
      // that actually explains why the highway is flagged.
      showRoadPopup(
        nerMap,
        corridor.representative.properties,
        bounds.getCenter(),
      );
    });
  };


  // ==========================================================
  // LOAD IMPACT ASSESSMENT
  // ==========================================================

  const getImpactAssessment = async (incidentId: string) => {
    const response = await authFetch(
      `/api/incidents/${incidentId}/impact-assessment`,
    );

    if (!response.ok) {
      throw new Error(`Impact API returned ${response.status}`);
    }

    return response.json();
  };


  // ==========================================================
  // GO TO INCIDENT
  // ==========================================================

  const goToIncident = async (incidentId: string) => {
    const nerMap = map.current;

    if (!nerMap || !incidentId) return;

    const incident = incidents.find(
      (item) => item.properties.id === incidentId,
    );

    if (!incident) return;

    setSelectedIncidentId(incidentId);

    const [longitude, latitude] = incident.geometry.coordinates;

    nerMap.flyTo({
      center: [longitude, latitude],
      zoom: 11,
      duration: 1200,
    });

    const properties = incident.properties;
    const severityColor = severityColorFor(properties.severity);

    let popupContent: string;

    try {
      const impactData = await getImpactAssessment(incidentId);

      const affectedRoads = impactData.affected_roads || [];

      const affectedRoadsHtml =
        affectedRoads.length > 0
          ? affectedRoads
              .map(
                (road: any) => `
                  <div class="ner-popup-impact">
                    <div class="ner-popup-impact-name">
                      ${road.road_number} · ${road.name}
                    </div>

                    <div class="ner-popup-meta">
                      ${road.distance_km} km away
                    </div>

                    <div class="ner-popup-row">
                      <span>Risk</span>
                      <strong>
                        ${road.current.risk_score} → ${road.proposed.risk_score}
                      </strong>
                    </div>

                    <div class="ner-popup-row">
                      <span>Status</span>
                      <strong>
                        ${road.current.status} → ${road.proposed.status}
                      </strong>
                    </div>

                    <div class="ner-popup-row">
                      <span>Delay</span>
                      <strong>
                        ${road.current.expected_delay_minutes} →
                        ${road.proposed.expected_delay_minutes} min
                      </strong>
                    </div>

                    <div class="ner-popup-impact-delta">
                      +${road.impact.risk_increase} risk ·
                      +${road.impact.additional_delay_minutes} min delay
                    </div>
                  </div>
                `,
              )
              .join("")
          : `
              <div class="ner-popup-note">
                No roads found inside the
                ${impactData.impact_radius_km || 10} km impact radius.
              </div>
            `;

      popupContent = `
        <div class="ner-popup">
          <div class="ner-popup-head">
            <span class="ner-popup-dot" style="background:${severityColor};"></span>
            <div>
              <div class="ner-popup-title">${properties.title}</div>
              <div class="ner-popup-sub">${properties.type}</div>
            </div>
          </div>

          <div class="ner-popup-row">
            <span>Severity</span>
            <strong style="color:${severityColor};">${properties.severity}</strong>
          </div>

          <div class="ner-popup-row">
            <span>Status</span>
            <strong>${properties.status}</strong>
          </div>

          <div class="ner-popup-row">
            <span>District</span>
            <strong>${properties.district}</strong>
          </div>

          <div class="ner-popup-row">
            <span>State</span>
            <strong>${properties.state}</strong>
          </div>

          <div class="ner-popup-section">Impact assessment</div>

          ${affectedRoadsHtml}

          <div class="ner-popup-meta">
            Assessment is calculated by PostGIS and is not written to the
            database yet.
          </div>
        </div>
      `;
    } catch (error) {
      console.error("Failed to load incident impact assessment:", error);

      popupContent = `
        <div class="ner-popup">
          <div class="ner-popup-title">${properties.title}</div>
          <div class="ner-popup-note" style="color:#dc2626;">
            Impact assessment unavailable.
          </div>
        </div>
      `;
    }

    openPopupRoadId.current = null;

    nerMap.once("moveend", () => {
      getPopup()
        .setLngLat([longitude, latitude])
        .setHTML(popupContent)
        .addTo(nerMap);
    });
  };


  // ==========================================================
  // TOOLBAR ACTIONS
  // ==========================================================

  const clearFocus = () => {
    setShowAllRoads(false);
    setFocusedCorridorKey(null);
    setSelectedCorridorKey("");

    popupRef.current?.remove();
  };

  const toggleShowAll = () => {
    setShowAllRoads((previous) => {
      const next = !previous;

      if (next) {
        setFocusedCorridorKey(null);
        popupRef.current?.remove();
      }

      return next;
    });
  };

  const focusedCorridor = focusedCorridorKey
    ? corridorByKey.get(focusedCorridorKey)
    : undefined;


  // ==========================================================
  // UI
  // ==========================================================

  return (
    <div className="map-wrapper">

      <div ref={mapContainer} className="ner-map" />

      {variant === "full" && (
        <>
          {/* ====================================================
              LOOKUP TOOLBAR
          ==================================================== */}

          <div className="map-toolbar">
            <div className="map-toolbar-title">
              <Database size={13} />
              Jump to record
            </div>

            <div className="map-toolbar-row">
              <select
                className="map-toolbar-select"
                value={selectedCorridorKey}
                onChange={(event) =>
                  setSelectedCorridorKey(event.target.value)
                }
              >
                <option value="">Select a road…</option>
                {roadCorridors.map((corridor) => (
                  <option key={corridor.key} value={corridor.key}>
                    {corridor.label} — {corridor.state}
                    {corridor.segmentCount > 1
                      ? ` (${corridor.segmentCount} segments)`
                      : ""}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="map-toolbar-go"
                onClick={() => goToCorridor(selectedCorridorKey)}
                disabled={!selectedCorridorKey}
              >
                Go
              </button>
            </div>

            <div className="map-toolbar-row">
              <select
                className="map-toolbar-select"
                value={selectedIncidentId}
                onChange={(event) =>
                  setSelectedIncidentId(event.target.value)
                }
              >
                <option value="">Select an incident…</option>
                {incidents.map((incident) => (
                  <option
                    key={incident.properties.id}
                    value={incident.properties.id}
                  >
                    {incident.properties.type} — {incident.properties.state}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="map-toolbar-go"
                onClick={() => goToIncident(selectedIncidentId)}
                disabled={!selectedIncidentId}
              >
                Go
              </button>
            </div>

            <div className="map-toolbar-divider" />

            <div className="map-toolbar-actions">
              <button
                type="button"
                className={`map-toolbar-chip${showAllRoads ? " is-active" : ""}`}
                onClick={toggleShowAll}
              >
                <Layers size={12} />
                {showAllRoads ? "Showing all roads" : "Show all roads"}
              </button>

              {(focusedCorridorKey || showAllRoads) && (
                <button
                  type="button"
                  className="map-toolbar-chip"
                  onClick={clearFocus}
                >
                  <X size={12} />
                  Clear
                </button>
              )}
            </div>

            <div className="map-toolbar-hint">
              {showAllRoads
                ? `Every road is risk-coloured (${roads.length} segments).`
                : focusedCorridor
                  ? `Highlighting ${focusedCorridor.label} — all ${focusedCorridor.segmentCount} segment${
                      focusedCorridor.segmentCount === 1 ? "" : "s"
                    }, worst status ${focusedCorridor.worstStatus}. Other roads stay neutral.`
                  : "Pick a road or click one on the map to colour it."}
            </div>
          </div>

          {/* ====================================================
              LIVE STATUS STRIP
          ==================================================== */}

          <div className="map-databadge">
            <span
              className={`map-databadge-dot${
                isRefreshing ? " is-pulsing" : ""
              }${loadError ? " is-error" : ""}`}
            />

            <span className="map-databadge-text">
              {loadError
                ? `API unreachable — ${loadError}`
                : `NER-LOGIX DATABASE · ${roads.length} roads · ${incidents.length} incidents`}
            </span>

            <span className="map-databadge-sep" />

            <span className="map-databadge-time">
              Updated {formatClock(lastUpdated)}
            </span>

            <button
              type="button"
              className="map-databadge-refresh"
              onClick={() => void loadData()}
              disabled={isRefreshing}
              title="Refresh now"
            >
              <RefreshCw
                size={12}
                className={isRefreshing ? "is-spinning" : undefined}
              />
            </button>
          </div>

          {/* ====================================================
              ROAD LEGEND
          ==================================================== */}

          <div className="map-legend">
            <div className="legend-title">Road Accessibility</div>

            <LegendItem color={RISK_COLORS.LOW} label="Low Risk" />
            <LegendItem color={RISK_COLORS.MODERATE} label="Moderate" />
            <LegendItem color={RISK_COLORS.HIGH} label="High Risk" />
            <LegendItem color={RISK_COLORS.CRITICAL} label="Critical" />
            <LegendItem color={RISK_COLORS.BLOCKED} label="Blocked" />
            <LegendItem color="#8a94a6" label="Not selected" />
          </div>

          {/* ====================================================
              INCIDENT LEGEND
          ==================================================== */}

          <div className="map-legend map-legend-right">
            <div className="legend-title">Incident Severity</div>

            <IncidentLegendItem color="#ef4444" label="Critical" />
            <IncidentLegendItem color="#f97316" label="High" />
            <IncidentLegendItem color="#eab308" label="Medium" />
            <IncidentLegendItem color="#22c55e" label="Low" />
          </div>
        </>
      )}

    </div>
  );
}


// ============================================================
// ROAD LEGEND ITEM
// ============================================================

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="legend-item">
      <span className="legend-line" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </div>
  );
}


// ============================================================
// INCIDENT LEGEND ITEM
// ============================================================

function IncidentLegendItem({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  return (
    <div className="legend-item">
      <span className="legend-dot" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </div>
  );
}


export default NERMap;
