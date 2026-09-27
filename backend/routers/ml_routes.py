from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from ml.predict_risk import predict_risk
from ml.flood_risk import predict_flood_risk
from ml.predict_disruption import predict_disruption
from services.weather import get_rainfall_24hr_mm, get_rainfall_windows_mm
from services.risk_scoring import score_all_roads
from dependencies import LOGISTICS_OFFICER, require_role, get_current_user

router = APIRouter(prefix="/api/ml", tags=["ml"])


class RiskRequest(BaseModel):
    latitude: float
    longitude: float
    # Optional now: if omitted, we fetch live rainfall from Open-Meteo
    # instead of requiring the caller to supply a manual figure.
    rainfall_24hr_mm: float | None = Field(default=None, ge=0)
    state: str | None = None
    event_date: date | None = None


class RiskResponse(BaseModel):
    risk_score: float
    risk_level: str
    state_used: str
    rainfall_anomaly_ratio: float
    state_daily_normal_mm: float
    rainfall_24hr_mm_used: float
    rainfall_source: str  # "live" or "manual"


@router.post(
    "/predict-risk", response_model=RiskResponse,
    dependencies=[Depends(get_current_user)],
)
async def predict_risk_endpoint(payload: RiskRequest):
    if payload.rainfall_24hr_mm is not None:
        rainfall = payload.rainfall_24hr_mm
        source = "manual"
    else:
        try:
            rainfall = await get_rainfall_24hr_mm(payload.latitude, payload.longitude)
            source = "live"
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Could not fetch live rainfall data: {exc}. "
                       f"Pass rainfall_24hr_mm manually to bypass this.",
            ) from exc

    result = predict_risk(
        latitude=payload.latitude,
        longitude=payload.longitude,
        rainfall_24hr_mm=rainfall,
        event_date=payload.event_date,
        state=payload.state,
    )
    result["rainfall_24hr_mm_used"] = rainfall
    result["rainfall_source"] = source
    return result


@router.post(
    "/score-roads-now",
    dependencies=[Depends(require_role(LOGISTICS_OFFICER))],
)
async def score_roads_now(db: AsyncSession = Depends(get_db)):
    """
    Manually triggers a full re-scoring of every road using live rainfall,
    without waiting for the scheduled background job (main.py runs this
    automatically every SCORING_INTERVAL_MINUTES). Useful for demos.
    """
    return await score_all_roads(db)


# ---------------------------------------------------------------------------
# Flood + combined hazard endpoints.
#
# /predict-risk above is landslide-only and is left exactly as it was, so
# anything already calling it keeps working. The two endpoints below add the
# flood model and the combined dispatcher on top.
# ---------------------------------------------------------------------------


class HazardRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)

    # All rainfall windows are optional. If none are supplied we fetch live
    # figures from Open-Meteo for all three at once. Supplying only the 24h
    # figure is allowed but weakens the flood score -- the response says so
    # in its caveats rather than hiding it.
    rainfall_24hr_mm: float | None = Field(default=None, ge=0)
    rainfall_3day_mm: float | None = Field(default=None, ge=0)
    rainfall_7day_mm: float | None = Field(default=None, ge=0)

    upstream_rainfall_24hr_mm: float | None = Field(default=None, ge=0)
    river_level_pct_of_danger: float | None = Field(default=None, ge=0)

    state: str | None = None
    event_date: date | None = None
    asset_type: str = Field(default="road", pattern="^(road|bridge|culvert)$")


async def _resolve_rainfall(payload: HazardRequest) -> tuple[dict, str]:
    """
    Returns the three rainfall windows plus where they came from.

    If the caller supplied any figure at all we treat the request as manual
    and do not silently mix in live data -- mixing would make the result
    impossible to reproduce from the inputs shown in the response.
    """
    supplied = (
        payload.rainfall_24hr_mm,
        payload.rainfall_3day_mm,
        payload.rainfall_7day_mm,
    )
    if any(v is not None for v in supplied):
        if payload.rainfall_24hr_mm is None:
            raise HTTPException(
                status_code=422,
                detail="rainfall_24hr_mm is required when supplying rainfall manually.",
            )
        return {
            "rainfall_24hr_mm": payload.rainfall_24hr_mm,
            "rainfall_3day_mm": payload.rainfall_3day_mm,
            "rainfall_7day_mm": payload.rainfall_7day_mm,
        }, "manual"

    try:
        windows = await get_rainfall_windows_mm(payload.latitude, payload.longitude)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not fetch live rainfall data: {exc}. "
                   f"Pass rainfall_24hr_mm manually to bypass this.",
        ) from exc

    return windows, "live"


@router.post(
    "/predict-flood",
    dependencies=[Depends(get_current_user)],
)
async def predict_flood_endpoint(payload: HazardRequest):
    """Flood probability only, from the trained flood model."""
    windows, source = await _resolve_rainfall(payload)

    result = predict_flood_risk(
        latitude=payload.latitude,
        longitude=payload.longitude,
        upstream_rainfall_24hr_mm=payload.upstream_rainfall_24hr_mm,
        river_level_pct_of_danger=payload.river_level_pct_of_danger,
        event_date=payload.event_date,
        state=payload.state,
        **windows,
    )
    result["rainfall_used"] = windows
    result["rainfall_source"] = source
    return result


@router.post(
    "/predict-disruption",
    dependencies=[Depends(get_current_user)],
)
async def predict_disruption_endpoint(payload: HazardRequest):
    """
    Combined landslide + flood verdict for one point on the network.

    This is the endpoint the routing and dispatch layers should call: it
    answers "is this link passable, and for how long" rather than making the
    caller reason about two hazard scores separately. The individual model
    outputs are still returned under `landslide` and `flood` so the number
    can be traced back, and `caveats` lists the things that would make the
    score unreliable for this particular request.
    """
    windows, source = await _resolve_rainfall(payload)

    result = predict_disruption(
        latitude=payload.latitude,
        longitude=payload.longitude,
        upstream_rainfall_24hr_mm=payload.upstream_rainfall_24hr_mm,
        river_level_pct_of_danger=payload.river_level_pct_of_danger,
        event_date=payload.event_date,
        state=payload.state,
        asset_type=payload.asset_type,
        **windows,
    )
    result["rainfall_used"] = windows
    result["rainfall_source"] = source
    return result
