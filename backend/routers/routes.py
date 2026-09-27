from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user

router = APIRouter(
    prefix="/api/routes",
    tags=["Routes"],
)


class DistrictRouteRequest(BaseModel):
    origin_state: str = Field(min_length=1, max_length=100)
    origin_district: str = Field(min_length=1, max_length=100)
    destination_state: str = Field(min_length=1, max_length=100)
    destination_district: str = Field(min_length=1, max_length=100)


# ----------------------------------------------------------------
# Cost function used by BOTH the "safest" and "fastest" runs below.
#
# The user explicitly wants the safest route prioritized over the
# fastest one, even at the cost of extra travel time. So the SAFEST
# cost function weights live risk_score heavily -- heavily enough that
# a real, meaningfully longer detour through low-risk roads will beat
# a shorter path through high-risk ones. This weighting is a design
# choice we made, not something derived from data -- worth being able
# to explain if asked: a road's risk_score contributes up to 5x its
# own length in extra "cost", and DISRUPTED/RESTRICTED roads get a
# further flat penalty on top of that. BLOCKED roads are excluded
# entirely -- not penalized, genuinely unroutable.
#
# The FASTEST cost function ignores risk entirely and optimizes on
# real distance alone, so the two runs produce two genuinely different,
# independently-computed real paths -- not one real path plus an
# invented "alternate".
# ----------------------------------------------------------------

def _edge_sql(cost_mode: str) -> str:
    if cost_mode == "safest":
        cost_expr = """
            (ST_Length(geometry::geography) / 1000.0)
            * (1 + (risk_score / 100.0) * 5)
            + CASE status
                WHEN 'DISRUPTED' THEN 50
                WHEN 'RESTRICTED' THEN 20
                ELSE 0
              END
        """
    elif cost_mode == "fastest":
        cost_expr = "(ST_Length(geometry::geography) / 1000.0)"
    else:
        raise ValueError(f"Unknown cost_mode: {cost_mode}")

    return f"""
        SELECT
            topo_id AS id,
            source,
            target,
            {cost_expr} AS cost,
            {cost_expr} AS reverse_cost
        FROM roads
        WHERE UPPER(status) <> 'BLOCKED'
          AND source IS NOT NULL
          AND target IS NOT NULL
    """


async def _nearest_vertex(db: AsyncSession, state: str, district: str) -> int | None:
    """
    Snap a district to a real, ROUTABLE vertex.

    Only vertices that are endpoints of this district's own non-blocked
    roads are candidates, so we never snap to a dead-end vertex that
    only touches blocked roads (which makes pgr_dijkstra return nothing).

    The road network is fragmented into disconnected components, so among
    the candidates we prefer the LARGEST connected component the district
    touches (the main network, not a tiny island), and then the vertex
    closest to the centroid of the district's road geometry.
    """
    result = await db.execute(
        text("""
            WITH comp AS (
                SELECT node, component
                FROM pgr_connectedComponents(
                    $cc_edges$
                    SELECT topo_id AS id, source, target,
                           1 AS cost, 1 AS reverse_cost
                    FROM roads
                    WHERE UPPER(status) <> 'BLOCKED'
                      AND source IS NOT NULL AND target IS NOT NULL
                    $cc_edges$
                )
            ),
            comp_size AS (
                SELECT component, COUNT(*) AS n FROM comp GROUP BY component
            ),
            centre AS (
                SELECT ST_Centroid(ST_Collect(geometry)) AS g
                FROM roads
                WHERE state = :state AND district = :district
            ),
            district_vertices AS (
                SELECT source AS vid FROM roads
                WHERE state = :state AND district = :district
                  AND UPPER(status) <> 'BLOCKED'
                UNION
                SELECT target AS vid FROM roads
                WHERE state = :state AND district = :district
                  AND UPPER(status) <> 'BLOCKED'
            )
            SELECT v.id
            FROM district_vertices dv
            JOIN road_vertices v ON v.id = dv.vid
            JOIN comp c ON c.node = v.id
            JOIN comp_size s ON s.component = c.component
            CROSS JOIN centre
            ORDER BY s.n DESC, v.geom <-> centre.g
            LIMIT 1
        """),
        {"state": state, "district": district},
    )
    row = result.first()
    return row[0] if row else None


async def _run_dijkstra(db: AsyncSession, cost_mode: str, start_vid: int, end_vid: int):
    edge_sql = _edge_sql(cost_mode)

    result = await db.execute(
        text(f"""
            SELECT
                d.seq, d.node, d.edge, d.cost, d.agg_cost,
                r.road_id, r.name, r.road_number, r.status,
                r.risk_score, r.risk_level, r.road_type,
                r.expected_delay_minutes,
                ST_Length(r.geometry::geography) / 1000.0 AS segment_length_km,
                ST_AsGeoJSON(r.geometry) AS geometry
            FROM pgr_dijkstra(
                $dijkstra_edges$ {edge_sql} $dijkstra_edges$,
                CAST(:start_vid AS bigint),
                CAST(:end_vid AS bigint),
                directed => false
            ) d
            LEFT JOIN roads r ON r.topo_id = d.edge
            ORDER BY d.seq
        """),
        {"start_vid": start_vid, "end_vid": end_vid},
    )
    return result.mappings().all()


def _average_speed_kmh(road_type: str) -> float:
    road_type = (road_type or "").upper()
    if road_type == "NATIONAL_HIGHWAY":
        return 45.0
    if road_type == "STATE_HIGHWAY":
        return 35.0
    return 30.0


def _summarize_path(rows) -> dict | None:
    """
    Turns the raw pgr_dijkstra row sequence into a real summary: total
    real distance, total real estimated time (summed per-segment, not
    guessed), the ordered list of real road segments used, and the
    highest risk level encountered anywhere on the path (so a route
    doesn't look "safe" just because most of it is calm if one segment
    is CRITICAL).
    """
    segments = [row for row in rows if row["edge"] is not None and row["edge"] != -1]

    if not segments:
        return None

    total_km = 0.0
    total_minutes = 0.0
    risk_levels_seen = []
    road_names = []

    RISK_ORDER = {"LOW": 0, "MODERATE": 1, "HIGH": 2, "CRITICAL": 3}

    for row in segments:
        length_km = float(row["segment_length_km"] or 0)
        speed = _average_speed_kmh(row["road_type"])
        minutes = (length_km / speed) * 60 + int(row["expected_delay_minutes"] or 0)

        total_km += length_km
        total_minutes += minutes
        risk_levels_seen.append(row["risk_level"] or "LOW")
        road_names.append(row["name"])

    worst_risk = max(risk_levels_seen, key=lambda r: RISK_ORDER.get(r, 0))

    return {
        "total_distance_km": round(total_km, 1),
        "estimated_time_minutes": round(total_minutes),
        "segment_count": len(segments),
        "worst_risk_level": worst_risk,
        "road_names": road_names,
        "segments": [
            {
                "road_id": row["road_id"],
                "name": row["name"],
                "road_number": row["road_number"],
                "status": row["status"],
                "risk_score": float(row["risk_score"] or 0),
                "risk_level": row["risk_level"],
            }
            for row in segments
        ],
    }


async def _merged_geometry(db: AsyncSession, edge_ids: list[int]) -> dict | None:
    if not edge_ids:
        return None

    result = await db.execute(
        text("""
            SELECT ST_AsGeoJSON(
                ST_LineMerge(ST_Collect(geometry ORDER BY array_position(CAST(:edge_ids AS bigint[]), topo_id::bigint)))
            ) AS geometry
            FROM roads
            WHERE topo_id::bigint = ANY(CAST(:edge_ids AS bigint[]))
        """),
        {"edge_ids": edge_ids},
    )
    row = result.first()
    if not row or not row[0]:
        return None

    import json
    return json.loads(row[0])


@router.get("/districts", dependencies=[Depends(get_current_user)])
async def list_route_districts(db: AsyncSession = Depends(get_db)):
    """Convenience alias -- same data as /api/districts, kept here too
    so the routing UI has one obvious place to look."""
    result = await db.execute(text("""
        SELECT DISTINCT state, district FROM roads
        WHERE district IS NOT NULL
        ORDER BY state, district
    """))
    rows = result.mappings().all()
    return {"districts": [dict(row) for row in rows]}


@router.post("/plan-district", dependencies=[Depends(get_current_user)])
async def plan_district_route(
    request: DistrictRouteRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Real district-to-district routing over the actual connected road
    graph (topology built in db/build_routing_topology.sql), using
    pgr_dijkstra -- an actual multi-segment path, not a single
    best-guess corridor.

    Returns TWO independently-computed real paths:
      - "safest_route": optimized with heavy risk weighting (the
        primary recommendation, per explicit product decision)
      - "fastest_route": optimized on distance alone, for comparison

    If either endpoint district can't be resolved to a connected
    vertex, or no path exists between them in the real network (some
    isolated segments are expected -- see topology sanity checks),
    this returns a 404 rather than fabricating a route.
    """
    origin_vid = await _nearest_vertex(db, request.origin_state, request.origin_district)
    dest_vid = await _nearest_vertex(db, request.destination_state, request.destination_district)

    if origin_vid is None:
        raise HTTPException(404, f"No road data found for {request.origin_district}, {request.origin_state}")
    if dest_vid is None:
        raise HTTPException(404, f"No road data found for {request.destination_district}, {request.destination_state}")
    if origin_vid == dest_vid:
        raise HTTPException(400, "Origin and destination resolve to the same location.")

    safest_rows = await _run_dijkstra(db, "safest", origin_vid, dest_vid)
    fastest_rows = await _run_dijkstra(db, "fastest", origin_vid, dest_vid)

    safest_summary = _summarize_path(safest_rows)
    fastest_summary = _summarize_path(fastest_rows)

    if safest_summary is None or fastest_summary is None:
        raise HTTPException(
            404,
            f"No connected route exists between {request.origin_district} and "
            f"{request.destination_district} in the current real road network. "
            f"This can happen for districts whose mapped roads don't connect "
            f"through the corridors we pulled -- a genuine gap in coverage, "
            f"not an error.",
        )

    safest_edge_ids = [s["road_id"] for s in safest_summary["segments"]]
    fastest_edge_ids = [s["road_id"] for s in fastest_summary["segments"]]

    # Need topo_ids (not road_ids) for the geometry merge query.
    safest_geometry = await _merged_geometry(
        db, [row["edge"] for row in safest_rows if row["edge"] not in (None, -1)]
    )
    fastest_geometry = await _merged_geometry(
        db, [row["edge"] for row in fastest_rows if row["edge"] not in (None, -1)]
    )

    safest_summary["geometry"] = safest_geometry
    fastest_summary["geometry"] = fastest_geometry

    return {
        "origin": {"state": request.origin_state, "district": request.origin_district},
        "destination": {"state": request.destination_state, "district": request.destination_district},
        "safest_route": safest_summary,
        "fastest_route": fastest_summary,
        "engine": {
            "type": "pgrouting-dijkstra",
            "turn_by_turn_routing": True,
            "primary_objective": "safest",
            "note": "Two independently-computed paths: risk-weighted (safest, "
                    "primary) and distance-only (fastest, comparison).",
        },
    }
