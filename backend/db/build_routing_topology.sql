-- ===========================================================================
-- Routing topology for /api/routes/plan-district
-- ===========================================================================
--
-- routers/routes.py runs pgr_dijkstra over the `roads` table and expects
-- three things that plain imported road geometry does not have:
--
--   roads.topo_id          stable integer edge id  (pgr_dijkstra needs int, not uuid)
--   roads.source/target    the vertex ids at each end of the edge
--   road_vertices(id,geom) the vertex table, queried by _nearest_vertex()
--
-- Run this ONCE after loading roads (scripts/fetch_osm_roads.py), and again
-- any time roads are added, removed, or their geometry changes. Scoring runs
-- do not change geometry, so routine re-scoring does not require a rebuild.
--
--   psql "$DATABASE_URL" -f backend/db/build_routing_topology.sql
--
-- Requires: PostGIS + pgRouting.
--     CREATE EXTENSION IF NOT EXISTS postgis;
--     CREATE EXTENSION IF NOT EXISTS pgrouting;
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgrouting;

-- ---------------------------------------------------------------------------
-- 1. Topology columns
-- ---------------------------------------------------------------------------
-- topo_id is a plain BIGSERIAL because pgr_dijkstra's edge ids must be
-- integers; road_id stays the real primary key and the API's identifier.

ALTER TABLE roads ADD COLUMN IF NOT EXISTS topo_id BIGSERIAL;
ALTER TABLE roads ADD COLUMN IF NOT EXISTS source  BIGINT;
ALTER TABLE roads ADD COLUMN IF NOT EXISTS target  BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS roads_topo_id_idx ON roads (topo_id);
CREATE INDEX IF NOT EXISTS roads_source_idx   ON roads (source);
CREATE INDEX IF NOT EXISTS roads_target_idx   ON roads (target);
CREATE INDEX IF NOT EXISTS roads_geometry_idx ON roads USING GIST (geometry);

-- Status and district are both filtered on every routing call.
CREATE INDEX IF NOT EXISTS roads_status_idx        ON roads (UPPER(status));
CREATE INDEX IF NOT EXISTS roads_state_district_idx ON roads (state, district);

-- ---------------------------------------------------------------------------
-- 2. Build the topology
-- ---------------------------------------------------------------------------
-- The tolerance is how far apart two endpoints can be and still be treated as
-- the same junction. This is a real trade-off, not a magic number:
--   too small -> OSM segments that don't share an exact vertex stay
--                disconnected, and the network shatters into islands
--   too large -> roads that merely pass near each other get welded into a
--                junction that does not exist, inventing routes
-- 0.00001 degrees is roughly 1 m. Raise toward 0.0001 (~11 m) only if the
-- component check in section 4 shows the network badly fragmented, and
-- re-check that the routes it produces are still plausible.

SELECT pgr_createTopology(
    'roads',
    0.00001,
    'geometry',
    'topo_id',
    'source',
    'target',
    clean := true
);

-- ---------------------------------------------------------------------------
-- 3. Vertex table under the name routes.py expects
-- ---------------------------------------------------------------------------
-- pgr_createTopology writes roads_vertices_pgr. _nearest_vertex() queries
-- road_vertices(id, geom), so expose it under that name. A view keeps the two
-- from drifting apart on rebuild.

DROP VIEW IF EXISTS road_vertices;
CREATE VIEW road_vertices AS
    SELECT id, the_geom AS geom FROM roads_vertices_pgr;

-- The <-> nearest-neighbour ordering in _nearest_vertex() needs this index on
-- the underlying table (a view cannot carry one).
CREATE INDEX IF NOT EXISTS roads_vertices_pgr_geom_idx
    ON roads_vertices_pgr USING GIST (the_geom);

ANALYZE roads;
ANALYZE roads_vertices_pgr;

-- ---------------------------------------------------------------------------
-- 4. Sanity checks
-- ---------------------------------------------------------------------------
-- Read these before trusting a route. They are informational, not fatal.

-- 4a. Edges that failed to get a source/target. These are invisible to the
--     router. A handful is normal; a large share means the tolerance is wrong
--     or some geometries are not LineStrings.
SELECT
    count(*) FILTER (WHERE source IS NULL OR target IS NULL) AS unrouted_edges,
    count(*)                                                 AS total_edges,
    round(
        100.0 * count(*) FILTER (WHERE source IS NULL OR target IS NULL)
        / NULLIF(count(*), 0),
    1) AS unrouted_pct
FROM roads;

-- 4b. Connected components. The largest component is the usable network.
--     If it holds well under half the vertices, expect plan-district to 404
--     for many pairs -- that is a genuine coverage gap, and routes.py is
--     written to report it rather than invent a path around it.
WITH comp AS (
    SELECT node, component
    FROM pgr_connectedComponents(
        $$
        SELECT topo_id AS id, source, target,
               1 AS cost, 1 AS reverse_cost
        FROM roads
        WHERE UPPER(status) <> 'BLOCKED'
          AND source IS NOT NULL AND target IS NOT NULL
        $$
    )
),
sizes AS (
    SELECT component, count(*) AS n FROM comp GROUP BY component
)
SELECT
    (SELECT count(*) FROM sizes)                        AS components,
    (SELECT max(n)   FROM sizes)                        AS largest_component,
    (SELECT count(*) FROM comp)                         AS routable_vertices,
    round(100.0 * (SELECT max(n) FROM sizes)
          / NULLIF((SELECT count(*) FROM comp), 0), 1)  AS largest_pct;

-- 4c. Districts with no routable vertex at all. Every district listed here
--     will 404 from /api/routes/plan-district no matter what it is paired
--     with, so it should not be offered in the UI dropdown. /api/districts
--     reads straight from roads, so a district appears there as soon as it
--     has any road -- routable or not.
SELECT r.state, r.district, count(*) AS roads
FROM roads r
WHERE r.district IS NOT NULL
GROUP BY r.state, r.district
HAVING count(*) FILTER (
    WHERE r.source IS NOT NULL
      AND r.target IS NOT NULL
      AND UPPER(r.status) <> 'BLOCKED'
) = 0
ORDER BY r.state, r.district;
