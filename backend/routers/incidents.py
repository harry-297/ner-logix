from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user


router = APIRouter(
    prefix="/api/incidents",
    tags=["Incidents"],
)


@router.get("", dependencies=[Depends(get_current_user)])
async def get_incidents(
    db: AsyncSession = Depends(get_db),
):
    query = text("""
        SELECT
            incident_id,
            type,
            severity,
            title,
            description,
            state,
            district,
            latitude,
            longitude,
            source,
            status,
            reported_at,
            ST_AsGeoJSON(geometry) AS geometry
        FROM incidents
        WHERE status = 'ACTIVE'
        ORDER BY reported_at DESC;
    """)

    result = await db.execute(query)

    incidents = []

    for row in result.mappings():
        incident = dict(row)

        if isinstance(incident["geometry"], str):
            import json
            incident["geometry"] = json.loads(incident["geometry"])

        incidents.append(incident)

    return {
        "count": len(incidents),
        "incidents": incidents,
    }


@router.get("/{incident_id}/affected-roads", dependencies=[Depends(get_current_user)])
async def get_affected_roads(
    incident_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Find active roads within 10 km of an incident using PostGIS."""

    query = text("""
        SELECT
            i.incident_id,
            i.type AS incident_type,
            i.severity,
            i.title AS incident_title,
            i.state AS incident_state,
            i.district AS incident_district,

            r.road_id,
            r.name,
            r.road_number,
            r.state,
            r.district,
            r.road_type,
            r.status,
            r.risk_score,
            r.risk_level,
            r.expected_delay_minutes,

            ROUND(
                (
                    ST_Distance(
                        i.geometry::geography,
                        r.geometry::geography
                    ) / 1000.0
                )::numeric,
                2
            ) AS distance_km

        FROM incidents i
        CROSS JOIN roads r

        WHERE i.incident_id = CAST(:incident_id AS uuid)
          AND i.status = 'ACTIVE'
          AND ST_DWithin(
                i.geometry::geography,
                r.geometry::geography,
                10000
              )

        ORDER BY ST_Distance(
            i.geometry::geography,
            r.geometry::geography
        );
    """)

    result = await db.execute(
        query,
        {"incident_id": incident_id},
    )

    rows = result.mappings().all()

    if not rows:
        incident_check = text("""
            SELECT
                incident_id,
                type,
                severity,
                title,
                state,
                district,
                status
            FROM incidents
            WHERE incident_id = CAST(:incident_id AS uuid);
        """)

        incident_result = await db.execute(
            incident_check,
            {"incident_id": incident_id},
        )

        incident = incident_result.mappings().first()

        if not incident:
            raise HTTPException(
                status_code=404,
                detail="Incident not found",
            )

        return {
            "incident": dict(incident),
            "search_radius_km": 10,
            "affected_roads": [],
            "message": "No roads found within 10 km of this incident.",
        }

    first = dict(rows[0])

    incident = {
        "incident_id": first["incident_id"],
        "type": first["incident_type"],
        "severity": first["severity"],
        "title": first["incident_title"],
        "state": first["incident_state"],
        "district": first["incident_district"],
    }

    affected_roads = []

    for row in rows:
        road = dict(row)

        affected_roads.append({
            "road_id": road["road_id"],
            "name": road["name"],
            "road_number": road["road_number"],
            "state": road["state"],
            "district": road["district"],
            "road_type": road["road_type"],
            "status": road["status"],
            "risk_score": road["risk_score"],
            "risk_level": road["risk_level"],
            "expected_delay_minutes": road["expected_delay_minutes"],
            "distance_km": float(road["distance_km"]),
        })

    return {
        "incident": incident,
        "search_radius_km": 10,
        "affected_roads": affected_roads,
        "count": len(affected_roads),
    }


@router.get("/{incident_id}/impact-assessment", dependencies=[Depends(get_current_user)])
async def get_impact_assessment(
    incident_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Calculate the potential impact of an active incident on nearby roads.

    This endpoint is intentionally read-only for now:
    it calculates a proposed risk/status/delay instead of changing
    the roads table. This lets us validate the model safely before
    persisting automated updates.
    """

    query = text("""
        SELECT
            i.incident_id,
            i.type AS incident_type,
            i.severity,
            i.title AS incident_title,
            i.state AS incident_state,
            i.district AS incident_district,

            r.road_id,
            r.name,
            r.road_number,
            r.state,
            r.district,
            r.status,
            r.risk_score,
            r.risk_level,
            r.expected_delay_minutes,

            ST_Distance(
                i.geometry::geography,
                r.geometry::geography
            ) / 1000.0 AS distance_km

        FROM incidents i
        CROSS JOIN roads r

        WHERE i.incident_id = CAST(:incident_id AS uuid)
          AND i.status = 'ACTIVE'
          AND ST_DWithin(
                i.geometry::geography,
                r.geometry::geography,
                10000
              )

        ORDER BY ST_Distance(
            i.geometry::geography,
            r.geometry::geography
        );
    """)

    result = await db.execute(
        query,
        {"incident_id": incident_id},
    )

    rows = result.mappings().all()

    if not rows:
        incident_check = text("""
            SELECT
                incident_id,
                type,
                severity,
                title,
                state,
                district,
                status
            FROM incidents
            WHERE incident_id = CAST(:incident_id AS uuid);
        """)

        incident_result = await db.execute(
            incident_check,
            {"incident_id": incident_id},
        )

        incident = incident_result.mappings().first()

        if not incident:
            raise HTTPException(
                status_code=404,
                detail="Incident not found",
            )

        return {
            "incident": dict(incident),
            "affected_roads": [],
            "message": "No roads within the 10 km impact radius.",
        }

    first = dict(rows[0])

    severity_weights = {
        "CRITICAL": 40,
        "HIGH": 30,
        "MEDIUM": 20,
        "LOW": 10,
    }

    severity = str(first["severity"]).upper()
    severity_weight = severity_weights.get(severity, 10)

    affected_roads = []

    for row in rows:
        road = dict(row)

        distance_km = float(road["distance_km"])

        # 10 km is the current MVP impact radius.
        # Closer incidents receive a stronger impact.
        proximity_factor = max(
            0.0,
            1.0 - (distance_km / 10.0)
        )

        # Square-root scaling prevents the impact from becoming
        # almost zero too quickly for incidents near the edge.
        proximity_factor = proximity_factor ** 0.5

        risk_increase = round(
            severity_weight * proximity_factor
        )

        current_risk = float(
            road["risk_score"] or 0
        )

        proposed_risk = min(
            100,
            round(current_risk + risk_increase)
        )

        if proposed_risk >= 90:
            proposed_risk_level = "CRITICAL"
        elif proposed_risk >= 70:
            proposed_risk_level = "HIGH"
        elif proposed_risk >= 40:
            proposed_risk_level = "MODERATE"
        else:
            proposed_risk_level = "LOW"

        current_status = str(
            road["status"]
        ).upper()

        if severity == "CRITICAL" and distance_km <= 2:
            proposed_status = "BLOCKED"
        elif severity in {"CRITICAL", "HIGH"} and distance_km <= 10:
            proposed_status = "DISRUPTED"
        else:
            proposed_status = current_status

        delay_increase = round(
            120 * proximity_factor
        )

        current_delay = int(
            road["expected_delay_minutes"] or 0
        )

        proposed_delay = (
            current_delay + delay_increase
        )

        affected_roads.append({
            "road_id": road["road_id"],
            "name": road["name"],
            "road_number": road["road_number"],
            "state": road["state"],
            "district": road["district"],
            "distance_km": round(distance_km, 2),

            "current": {
                "status": current_status,
                "risk_score": current_risk,
                "risk_level": road["risk_level"],
                "expected_delay_minutes": current_delay,
            },

            "proposed": {
                "status": proposed_status,
                "risk_score": proposed_risk,
                "risk_level": proposed_risk_level,
                "expected_delay_minutes": proposed_delay,
            },

            "impact": {
                "severity": severity,
                "severity_weight": severity_weight,
                "proximity_factor": round(
                    proximity_factor,
                    3
                ),
                "risk_increase": risk_increase,
                "additional_delay_minutes": delay_increase,
            },
        })

    return {
        "incident": {
            "incident_id": first["incident_id"],
            "type": first["incident_type"],
            "severity": severity,
            "title": first["incident_title"],
            "state": first["incident_state"],
            "district": first["incident_district"],
        },
        "impact_radius_km": 10,
        "affected_roads": affected_roads,
        "count": len(affected_roads),
        "database_updated": False,
    }
