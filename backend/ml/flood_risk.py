from pathlib import Path

import joblib
import pandas as pd


BASE = Path(__file__).resolve().parent
MODEL_FILE = BASE / "flood_model.joblib"

model = joblib.load(MODEL_FILE)


def _terrain(latitude, longitude):
    """Return a coarse terrain exposure label for dispatcher compatibility."""
    if 24.0 <= latitude <= 26.0 and 91.8 <= longitude <= 93.2:
        return "Barak floodplain", 0.90, "Barak catchment"
    if 25.5 <= latitude <= 27.8 and 89.5 <= longitude <= 95.5:
        return "Brahmaputra floodplain", 0.85, "Brahmaputra catchment"
    if 22.0 <= latitude <= 29.0 and 88.0 <= longitude <= 97.0:
        return "upland and hill terrain", 0.20, None
    return "NER lowland", 0.55, None


def predict_flood_risk(
    latitude,
    longitude,
    rainfall_24hr_mm,
    rainfall_3day_mm=None,
    rainfall_7day_mm=None,
    upstream_rainfall_24hr_mm=None,
    river_level_pct_of_danger=None,
    event_date=None,
    state=None,
):
    """Predict flood probability with the six features used during training.

    The extra keyword arguments are retained for callers of the previous
    heuristic interface. They are reported as context but are not passed to
    the trained classifier as features.
    """

    # Estimate missing rainfall windows
    if rainfall_3day_mm is None:
        rainfall_3day_mm = rainfall_24hr_mm

    if rainfall_7day_mm is None:
        rainfall_7day_mm = rainfall_3day_mm

    # Derive the same six columns used by train_flood_model.py.
    if event_date is not None:
        event_date = pd.to_datetime(event_date)
        month = event_date.month
    else:
        month = pd.Timestamp.now().month

    features = pd.DataFrame([{
        "latitude": latitude,
        "longitude": longitude,
        "month": month,
        "rainfall_24hr_mm": rainfall_24hr_mm,
        "rainfall_3day_mm": rainfall_3day_mm,
        "rainfall_7day_mm": rainfall_7day_mm
    }])

    probability = float(
        model.predict_proba(features)[0][1]
    )

    if probability >= 0.75:
        risk_level = "high"
    elif probability >= 0.40:
        risk_level = "moderate"
    else:
        risk_level = "low"

    zone, terrain_exposure, upstream_source = _terrain(latitude, longitude)
    upstream_inflow = float(upstream_rainfall_24hr_mm or 0.0)
    gauge_used = river_level_pct_of_danger is not None
    expected_disruption_hours = 0 if probability < 0.40 else int(6 + 140 * probability)
    if gauge_used:
        expected_disruption_hours = int(
            expected_disruption_hours * (1.0 + max(0.0, min(1.0, river_level_pct_of_danger / 100.0)))
        )

    return {
        "risk_score": round(probability, 4),
        "flood_probability": round(probability * 100, 2),
        "risk_level": risk_level,
        "model": "GradientBoostingClassifier",
        "expected_disruption_hours": expected_disruption_hours,
        "terrain_exposure": terrain_exposure,
        "drivers": {
            "burst_24hr": round(float(rainfall_24hr_mm), 2),
            "rainfall_3day_mm": round(float(rainfall_3day_mm), 2),
            "rainfall_7day_mm": round(float(rainfall_7day_mm), 2),
            "upstream_source": upstream_source,
            "upstream_inflow": upstream_inflow,
            "upstream_lag_hours": 30 if upstream_source else None,
            "gauge_used": gauge_used,
            "state_context": state,
        },
    }


if __name__ == "__main__":

    result = predict_flood_risk(
        latitude=26.36,
        longitude=92.75,
        rainfall_24hr_mm=16.01,
        rainfall_3day_mm=22.56,
        rainfall_7day_mm=70.98,
        event_date="2023-09-01"
    )

    print("\nFLOOD ML PREDICTION")
    print("-------------------")
    print("Probability:", result["flood_probability"], "%")
    print("Risk level:", result["risk_level"])
    print("Model:", result["model"])