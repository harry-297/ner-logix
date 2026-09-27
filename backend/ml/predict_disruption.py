"""
Unified disruption prediction for a point on the transport network.

This is what your FastAPI router should call. It runs both hazard models and
returns a single verdict per road link / bridge / depot, because the routing
layer does not care which hazard closed the road -- it cares whether the link is
passable and for how long.

    from ml.predict_disruption import predict_disruption
    predict_disruption(lat, lon, rainfall_24hr_mm=..., rainfall_3day_mm=...)
"""
from __future__ import annotations

from datetime import date

try:  # normal case: imported as part of the `ml` package from backend/
    from .predict_risk import predict_risk
    from .flood_risk import predict_flood_risk, _terrain
except ImportError:  # running this file directly for a quick sanity check
    from predict_risk import predict_risk
    from flood_risk import predict_flood_risk, _terrain


def predict_disruption(
    latitude: float,
    longitude: float,
    rainfall_24hr_mm: float,
    rainfall_3day_mm: float | None = None,
    rainfall_7day_mm: float | None = None,
    upstream_rainfall_24hr_mm: float | None = None,
    river_level_pct_of_danger: float | None = None,
    event_date: date | None = None,
    state: str | None = None,
    asset_type: str = "road",
) -> dict:
    """
    asset_type: "road" | "bridge" | "culvert". Bridges fail differently -- they
    survive water over the road but not scour at high discharge -- so flood risk
    is weighted up for them and landslide risk down.
    """
    landslide = predict_risk(
        latitude=latitude,
        longitude=longitude,
        rainfall_24hr_mm=rainfall_24hr_mm,
        event_date=event_date,
        state=state,
    )
    flood = predict_flood_risk(
        latitude=latitude,
        longitude=longitude,
        rainfall_24hr_mm=rainfall_24hr_mm,
        rainfall_3day_mm=rainfall_3day_mm,
        rainfall_7day_mm=rainfall_7day_mm,
        upstream_rainfall_24hr_mm=upstream_rainfall_24hr_mm,
        river_level_pct_of_danger=river_level_pct_of_danger,
        event_date=event_date,
        state=state,
    )

    p_ls_raw = landslide["risk_score"]
    p_fl = flood["risk_score"]

    # Terrain gate on landslide. The trained model has no slope or elevation
    # feature, so it fires at 0.99 anywhere it rains hard -- including the middle
    # of the Barak floodplain, where there is nothing to slide. Damp it using the
    # inverse of flood exposure as a slope proxy. Replace with real slope from a
    # DEM when the GIS layer lands; this is a stopgap, not a substitute.
    _zone, _exposure, _ = _terrain(latitude, longitude)
    slope_proxy = 1.0 - _exposure
    p_ls = p_ls_raw * (0.15 + 0.85 * slope_proxy)
    landslide["risk_score_raw_model"] = p_ls_raw
    landslide["slope_proxy"] = round(slope_proxy, 2)
    # risk_score stays as the raw model output so the number can be traced
    # back to the model; the damped value is reported alongside it. Without
    # this, risk_level (computed from the damped score below) and risk_score
    # would disagree, which reads like a bug when surfaced in the UI.
    landslide["terrain_adjusted_risk_score"] = round(p_ls, 4)
    landslide["risk_level"] = ("high" if p_ls >= 0.75 else
                               "moderate" if p_ls >= 0.4 else "low")

    # Keep the classifier probability intact, but avoid treating hill terrain
    # as a floodplain when combining the two hazard signals.
    flood_terrain_factor = 0.15 + 0.85 * _exposure
    p_fl = p_fl * flood_terrain_factor
    flood["risk_score_raw_model"] = flood["risk_score"]
    flood["terrain_adjusted_risk_score"] = round(p_fl, 4)

    if asset_type == "bridge":
        p_fl = min(1.0, p_fl * 1.20)
        p_ls = p_ls * 0.80
    elif asset_type == "culvert":
        p_fl = min(1.0, p_fl * 1.10)

    # The two hazards share a driver (rainfall), so they are correlated. A naive
    # independent union over-counts; take the dominant hazard and let the other
    # add a damped contribution.
    hi, lo = max(p_ls, p_fl), min(p_ls, p_fl)
    combined = min(0.99, hi + (1.0 - hi) * lo * 0.5)

    dominant = "landslide" if p_ls >= p_fl else "flood"

    if combined >= 0.70:
        level, action = "high", "avoid / hold dispatch; pre-position at nearest depot"
    elif combined >= 0.40:
        level, action = "moderate", "convoy with escort, daylight movement only, confirm with field report"
    else:
        level, action = "low", "normal movement"

    # Landslides block for hours-to-days (clearance is mechanical); floods block
    # until the water drains, which the flood model already estimates.
    if dominant == "landslide":
        hours = 0 if level == "low" else int(6 + 42 * p_ls)
    else:
        hours = flood["expected_disruption_hours"]

    return {
        "combined_risk_score": round(combined, 4),
        "risk_level": level,
        "dominant_hazard": dominant,
        "recommended_action": action,
        "expected_disruption_hours": hours,
        "asset_type": asset_type,
        "landslide": landslide,
        "flood": flood,
        "caveats": _caveats(landslide, flood, rainfall_3day_mm, rainfall_7day_mm),
    }


def _caveats(landslide, flood, r3, r7) -> list[str]:
    out = []
    if landslide.get("risk_score_raw_model", 0) > 0.95 and flood["drivers"]["burst_24hr"] < 1.4:
        out.append(
            "Landslide model saturates near 1.0 above roughly 50 mm/24 h; treat "
            "0.98 and 0.99 as the same alert, not as a ranking."
        )
    if r3 is None or r7 is None:
        out.append(
            "Multi-day rainfall not supplied -- flood score was estimated from the "
            "24 h figure and is substantially less reliable."
        )
    if flood["drivers"]["upstream_source"] and flood["drivers"]["upstream_inflow"] == 0.0:
        out.append(
            f"No upstream rainfall supplied for {flood['drivers']['upstream_source']}; "
            f"flood risk here typically lags that catchment by "
            f"{flood['drivers']['upstream_lag_hours']} h and may be understated."
        )
    if landslide.get("slope_proxy", 1.0) < 0.35:
        out.append(
            "Point sits in flat floodplain terrain; landslide score was damped by a "
            "slope proxy because the trained model has no terrain feature."
        )
    if not flood["drivers"]["gauge_used"] and flood["terrain_exposure"] > 0.6:
        out.append("No river gauge reading supplied; CWC level data would materially improve this score.")
    return out


if __name__ == "__main__":
    from pprint import pprint
    print("=== NH-6 Silchar-Shillong, Barak valley, day 3 of monsoon surge")
    pprint(predict_disruption(24.82, 92.80, rainfall_24hr_mm=180,
                              rainfall_3day_mm=420, rainfall_7day_mm=690,
                              event_date=date(2024, 6, 20)))
    print("\n=== Bridge near Dhubri, clear sky, heavy upstream rain")
    pprint(predict_disruption(26.02, 89.98, rainfall_24hr_mm=5,
                              rainfall_3day_mm=40, rainfall_7day_mm=300,
                              upstream_rainfall_24hr_mm=240,
                              asset_type="bridge",
                              event_date=date(2024, 7, 5))["combined_risk_score"])
    print("\n=== Hill road near Cherrapunji, extreme burst")
    r = predict_disruption(25.30, 91.70, rainfall_24hr_mm=800,
                           rainfall_3day_mm=1400, rainfall_7day_mm=2100,
                           event_date=date(2024, 6, 17))
    print(r["combined_risk_score"], r["dominant_hazard"], r["expected_disruption_hours"])
    print("\n=== Dry January, Guwahati")
    r = predict_disruption(26.14, 91.73, rainfall_24hr_mm=1,
                           rainfall_3day_mm=2, rainfall_7day_mm=4,
                           event_date=date(2024, 1, 10))
    print(r["combined_risk_score"], r["risk_level"], r["recommended_action"])
