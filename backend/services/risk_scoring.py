"""
Periodic risk scoring: re-scores every real road in the `roads` table
using LIVE rainfall + the hazard models. This is what makes
risk_score/status reflect *current* weather rather than a one-time
snapshot from whenever a script happened to be run.

Hazard model
------------
Scoring runs through ml.predict_disruption, which combines the landslide
model and the flood model into one verdict per road. This matters for two
reasons beyond simply covering a second hazard:

1. Flood is the dominant disruption mode across the Brahmaputra and Barak
   floodplains, and the landslide model alone cannot see it at all.
2. The landslide model has no slope or elevation feature, so on its own it
   saturates near 0.99 anywhere it rains hard -- including flat floodplain
   where there is nothing to slide. predict_disruption damps it with a
   terrain proxy, so scores across the network become comparable instead
   of everything pinning to CRITICAL during a monsoon burst.

Set USE_COMBINED_HAZARD = False to fall back to the landslide-only path
(the previous behaviour) without touching anything else.

Wired into main.py as a recurring background job (default: every 30
minutes) plus exposed as a manual "run now" endpoint in ml_routes.py.

Design choices (same as scripts/score_roads_risk.py, kept consistent):
- Roads grouped into ~25km grid cells to limit weather API calls —
  rainfall is regional enough that this is a reasonable approximation.
- risk_level/status thresholds are OUR operational rules layered on top
  of the model's raw probability, not something the model itself
  outputs. State this explicitly if asked how status is determined.
"""
import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ml.predict_risk import predict_risk
from ml.predict_disruption import predict_disruption
from services.weather import (
    get_rainfall_24hr_batch_mm,
    get_rainfall_windows_batch_mm,
)

logger = logging.getLogger("risk_scoring")

GRID_SIZE = 0.25   # ~25km grid cells for grouping rainfall lookups
BATCH_SIZE = 50    # Open-Meteo points per request

# Combined landslide + flood scoring. See the module docstring for why this
# is the default. Flip to False for landslide-only scoring.
USE_COMBINED_HAZARD = True

# NOTE: the model's landslide probability is a *prediction*, not a confirmed
# closure. It must never set BLOCKED, because routing removes BLOCKED roads
# from the graph entirely (56% of roads ended up BLOCKED and the network fell
# apart into disconnected islands). BLOCKED is reserved for confirmed
# closures (e.g. an active incident); predicted risk only raises the route
# cost via DISRUPTED / RESTRICTED and risk_score.
STATUS_THRESHOLDS = [
    (0.60, "DISRUPTED"),
    (0.35, "RESTRICTED"),
]
DEFAULT_STATUS = "ACCESSIBLE"

RISK_LEVEL_THRESHOLDS = [
    (0.90, "CRITICAL"),
    (0.75, "HIGH"),
    (0.40, "MODERATE"),
]
DEFAULT_RISK_LEVEL = "LOW"


def _grid_key(lat: float, lon: float) -> tuple[float, float]:
    return (round(lat / GRID_SIZE) * GRID_SIZE, round(lon / GRID_SIZE) * GRID_SIZE)


def _classify(score: float, thresholds: list[tuple[float, str]], default: str) -> str:
    for cutoff, label in thresholds:
        if score >= cutoff:
            return label
    return default


def _windows_for(value) -> dict[str, float]:
    """
    Normalise whatever the rainfall fetch returned into the three keyword
    arguments the hazard models take.

    A grid cell missing from the fetch means the weather call failed or
    returned nothing for it, and we fall back to zero rainfall -- the same
    assumption the landslide-only path always made. Worth knowing when
    reading a score: a cell with no weather data looks dry, not unknown.
    """
    if isinstance(value, dict):
        return {
            "rainfall_24hr_mm": value.get("rainfall_24hr_mm", 0.0),
            "rainfall_3day_mm": value.get("rainfall_3day_mm"),
            "rainfall_7day_mm": value.get("rainfall_7day_mm"),
        }
    return {
        "rainfall_24hr_mm": float(value or 0.0),
        "rainfall_3day_mm": None,
        "rainfall_7day_mm": None,
    }


def _asset_type(road) -> str:
    """
    Bridges fail differently from roadway: they survive water over the deck
    but not scour at high discharge, so predict_disruption weights flood up
    and landslide down for them.

    We have no bridge flag in the roads table, so this is a name heuristic
    and will miss unnamed structures. It only ever shifts weighting between
    two hazards that are already being scored, so a miss degrades to the
    plain road weighting rather than to a wrong answer.
    """
    name = (getattr(road, "name", "") or "").lower()
    if "bridge" in name or "setu" in name or "pul" in name:
        return "bridge"
    if "culvert" in name:
        return "culvert"
    return "road"


async def score_all_roads(session: AsyncSession) -> dict:
    """Re-scores every road using live rainfall. Returns a summary dict."""
    result = await session.execute(text("""
        SELECT road_id, state, name, road_type,
               ST_Y(ST_Centroid(geometry)) AS lat,
               ST_X(ST_Centroid(geometry)) AS lon
        FROM roads
    """))
    roads = result.fetchall()

    if not roads:
        logger.info("score_all_roads: no roads in table, nothing to do.")
        return {"roads_scored": 0, "message": "No roads in table."}

    grid_points = sorted({_grid_key(r.lat, r.lon) for r in roads})
    logger.info(f"score_all_roads: {len(roads)} roads, "
                f"{len(grid_points)} rainfall grid cell(s), "
                f"model={'combined' if USE_COMBINED_HAZARD else 'landslide-only'}.")

    # Values are dicts of rainfall windows in combined mode, plain 24h floats
    # otherwise. _windows_for() below normalises both into one shape.
    rainfall_by_grid: dict[tuple[float, float], object] = {}
    fetch = (
        get_rainfall_windows_batch_mm
        if USE_COMBINED_HAZARD
        else get_rainfall_24hr_batch_mm
    )

    for i in range(0, len(grid_points), BATCH_SIZE):
        batch = grid_points[i:i + BATCH_SIZE]
        try:
            rainfall_by_grid.update(await fetch(batch))
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Rainfall batch fetch failed for cells {batch}: {exc}")

    level_counts: dict[str, int] = {}
    status_counts: dict[str, int] = {}
    hazard_counts: dict[str, int] = {}
    updated = 0
    failed = 0

    for r in roads:
        key = _grid_key(r.lat, r.lon)
        windows = _windows_for(rainfall_by_grid.get(key))

        try:
            if USE_COMBINED_HAZARD:
                prediction = predict_disruption(
                    latitude=r.lat, longitude=r.lon,
                    state=r.state,
                    asset_type=_asset_type(r),
                    **windows,
                )
                score = prediction["combined_risk_score"]
                hazard = prediction["dominant_hazard"]
                hazard_counts[hazard] = hazard_counts.get(hazard, 0) + 1
            else:
                prediction = predict_risk(
                    latitude=r.lat, longitude=r.lon,
                    rainfall_24hr_mm=windows["rainfall_24hr_mm"],
                    state=r.state,
                )
                score = prediction["risk_score"]
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"Hazard prediction failed for road {r.road_id}: {exc}")
            failed += 1
            continue

        risk_score_pct = round(score * 100, 2)
        risk_level = _classify(score, RISK_LEVEL_THRESHOLDS, DEFAULT_RISK_LEVEL)
        status = _classify(score, STATUS_THRESHOLDS, DEFAULT_STATUS)

        level_counts[risk_level] = level_counts.get(risk_level, 0) + 1
        status_counts[status] = status_counts.get(status, 0) + 1

        await session.execute(text("""
            UPDATE roads
            SET risk_score = :risk_score, risk_level = :risk_level,
                status = :status, updated_at = now()
            WHERE road_id = :road_id
        """), {
            "risk_score": risk_score_pct,
            "risk_level": risk_level,
            "status": status,
            "road_id": r.road_id,
        })
        updated += 1

    await session.commit()

    summary = {
        "roads_scored": updated,
        "roads_failed": failed,
        "model": "combined" if USE_COMBINED_HAZARD else "landslide-only",
        "risk_level_distribution": level_counts,
        "status_distribution": status_counts,
        "rainfall_cells_resolved": len(rainfall_by_grid),
        "rainfall_cells_requested": len(grid_points),
    }
    if USE_COMBINED_HAZARD:
        summary["dominant_hazard_distribution"] = hazard_counts
    logger.info(f"score_all_roads complete: {summary}")
    return summary
