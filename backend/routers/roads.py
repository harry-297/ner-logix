import json

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user


router = APIRouter(
    prefix="/api/roads",
    tags=["Roads"],
)


@router.get("", dependencies=[Depends(get_current_user)])
async def get_roads(
    db: AsyncSession = Depends(get_db),
):
    query = text("""
        SELECT
            road_id,
            name,
            road_number,
            state,
            district,
            road_type,
            status,
            risk_score,
            risk_level,
            expected_delay_minutes,
            ST_AsGeoJSON(geometry) AS geometry
        FROM roads
        ORDER BY risk_score DESC;
    """)

    result = await db.execute(query)

    roads = []

    for row in result.mappings():
        road = dict(row)

        # Convert GeoJSON string into a real JSON object
        if isinstance(road["geometry"], str):
            road["geometry"] = json.loads(road["geometry"])

        roads.append(road)

    return {
        "count": len(roads),
        "roads": roads,
    }