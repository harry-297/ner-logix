from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from dependencies import get_current_user

router = APIRouter(prefix="/api/districts", tags=["districts"])


@router.get("", dependencies=[Depends(get_current_user)])
async def list_districts(db: AsyncSession = Depends(get_db)):
    """
    Real districts derived directly from the roads table — not a
    hardcoded list. Only districts that actually have real road data
    show up here, so the dropdown can never offer a place we can't
    actually route through.
    """
    result = await db.execute(text("""
        SELECT DISTINCT state, district
        FROM roads
        WHERE district IS NOT NULL
        ORDER BY state, district
    """))
    rows = result.mappings().all()

    return {
        "count": len(rows),
        "districts": [
            {"state": row["state"], "district": row["district"]}
            for row in rows
        ],
    }
