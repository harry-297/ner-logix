-- ===========================================================================
-- NER-LOGIX schema
-- ===========================================================================
--
-- This file did not exist in any of the three source projects. Every table
-- and column below was reconstructed by reading every SQL query across
-- routers/*.py, services/risk_scoring.py, and scripts/*.py, and cross-checking
-- them against each other so the columns line up everywhere they're used.
-- No table definition anywhere was invented beyond what the code requires.
--
-- Run this FIRST, before build_routing_topology.sql, and before loading any
-- road or incident data.
--
--   createdb ner_logix
--   psql ner_logix -f backend/db/schema.sql
--   psql ner_logix -f backend/db/build_routing_topology.sql   -- after roads are loaded
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- roads
-- ---------------------------------------------------------------------------
-- Columns and types below are exactly what the code touches:
--   - roads.py            SELECT road_id, name, road_number, state, district,
--                          road_type, status, risk_score, risk_level,
--                          expected_delay_minutes, geometry
--   - incidents.py         same columns, joined against incidents by distance
--   - services/risk_scoring.py   UPDATEs risk_score, risk_level, status,
--                                updated_at; SELECTs name, road_type for
--                                asset-type inference (routers/ml_routes.py)
--   - routers/routes.py    pgr_dijkstra over source/target/topo_id (added
--                           by build_routing_topology.sql, not here)
--   - scripts/fetch_osm_roads.py   INSERTs name, road_number, state,
--                                  district, road_type, geometry only --
--                                  everything else gets its column default
--                                  below, and score_roads_risk.py / the
--                                  live scoring job fill it in on first run

CREATE TABLE IF NOT EXISTS roads (
    road_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name                    TEXT NOT NULL,
    road_number             TEXT,
    state                   TEXT NOT NULL,
    district                TEXT,
    road_type               TEXT NOT NULL DEFAULT 'OTHER',
    -- road_type values used in the app: NATIONAL_HIGHWAY, STATE_HIGHWAY,
    -- DISTRICT_ROAD, OTHER (see scripts/fetch_osm_roads.py HIGHWAY_TYPE_MAP)

    status                  TEXT NOT NULL DEFAULT 'ACCESSIBLE',
    -- ACCESSIBLE | RESTRICTED | DISRUPTED | BLOCKED
    -- BLOCKED is reserved for confirmed closures (e.g. an active incident).
    -- Predicted risk never sets it -- see services/risk_scoring.py.

    risk_score               NUMERIC(5, 2) NOT NULL DEFAULT 0,
    -- 0-100 scale (hazard model outputs 0-1; scoring multiplies by 100)
    risk_level               TEXT NOT NULL DEFAULT 'LOW',
    -- LOW | MODERATE | HIGH | CRITICAL

    expected_delay_minutes   INTEGER NOT NULL DEFAULT 0,

    geometry                 geometry(LineString, 4326) NOT NULL,

    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- incidents
-- ---------------------------------------------------------------------------
-- routers/incidents.py CASTs incident_id to uuid explicitly, confirming the
-- type. latitude/longitude are stored alongside geometry because the
-- frontend (NERMap.tsx incident popups) reads them as plain numbers rather
-- than parsing GeoJSON for a point that's already a single coordinate pair.

CREATE TABLE IF NOT EXISTS incidents (
    incident_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    type            TEXT NOT NULL,
    -- e.g. LANDSLIDE, FLOOD, ROAD_DAMAGE, ACCIDENT, PROTEST, OTHER
    severity        TEXT NOT NULL,
    -- LOW | MEDIUM | HIGH | CRITICAL (incidents.py's severity_weights map)
    title           TEXT NOT NULL,
    description     TEXT,

    state           TEXT NOT NULL,
    district        TEXT,

    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    geometry        geometry(Point, 4326) NOT NULL,

    source          TEXT,
    -- who/what reported it -- field report, news, sensor, etc.
    status          TEXT NOT NULL DEFAULT 'ACTIVE',
    -- ACTIVE | RESOLVED

    reported_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- roads.geometry, source, target and the routing indexes are created by
-- build_routing_topology.sql (they depend on columns that script adds).
-- These cover the non-routing query paths: /api/roads ordering, /api/incidents
-- filtering, and the distance joins in incidents.py.

CREATE INDEX IF NOT EXISTS roads_risk_score_idx      ON roads (risk_score DESC);
CREATE INDEX IF NOT EXISTS incidents_geometry_idx    ON incidents USING GIST (geometry);
CREATE INDEX IF NOT EXISTS incidents_status_idx      ON incidents (status);
CREATE INDEX IF NOT EXISTS incidents_reported_at_idx ON incidents (reported_at DESC);

-- ---------------------------------------------------------------------------
-- Sanity check
-- ---------------------------------------------------------------------------
SELECT
    (SELECT count(*) FROM roads)     AS roads_loaded,
    (SELECT count(*) FROM incidents) AS incidents_loaded;
-- Both will read 0 right after this file runs -- that's expected. Load real
-- road data next (see MERGE_NOTES.md / README.md), then
-- build_routing_topology.sql, then start the backend.
