"""
Inference wrapper for the NER landslide risk model.
Drop this + risk_model.joblib + model_metadata.json into backend/app/ml/
and import predict_risk() from your FastAPI router.
"""
import json
from datetime import date
from pathlib import Path
import joblib
import numpy as np
import pandas as pd

try:  # normal case: imported as part of the `ml` package from backend/
    from .geo import nearest_state
except ImportError:  # running this file directly for a quick sanity check
    from geo import nearest_state

_DIR = Path(__file__).parent
_model = joblib.load(_DIR / "risk_model.joblib")
_metadata = json.loads((_DIR / "model_metadata.json").read_text())

FEATURE_COLS = _metadata["feature_cols"]
STATES = _metadata["states"]
STATE_DAILY_NORMAL = _metadata["state_daily_normal"]
MONTH_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
              "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


# The old single-centroid fallback that used to live here was wrong for most
# of Assam -- Assam is a long thin arc wrapped around Meghalaya and the hill
# states, so its centroid sits far from most Assamese towns. Guwahati, Dhubri
# and Silchar all resolved to the wrong state, pulling the wrong monthly
# rainfall normal (Guwahati used Meghalaya's 25.2 mm/day instead of Assam's
# 10.1 mm/day in June -- a 2.5x error in the anomaly ratio, which is a model
# feature). ml/geo.py replaces it with a multi-anchor lookup. Still a
# fallback: pass `state` explicitly from the road/district record when you
# have it.


def predict_risk(
    latitude: float,
    longitude: float,
    rainfall_24hr_mm: float,
    event_date: date | None = None,
    state: str | None = None,
) -> dict:
    """
    Returns a risk score (0-1 probability from the model) and a coarse
    risk_level bucket, plus the inputs it derived (state, daily normal)
    for transparency in the API response.
    """
    event_date = event_date or date.today()
    month = event_date.month
    state = state if state in STATES else nearest_state(latitude, longitude)

    daily_normal = STATE_DAILY_NORMAL[state][MONTH_ABBR[month - 1]]
    anomaly_ratio = rainfall_24hr_mm / max(daily_normal, 0.1)

    row = {c: 0.0 for c in FEATURE_COLS}
    row["latitude"] = latitude
    row["longitude"] = longitude
    row["month"] = month
    row["rainfall_24hr_mm"] = rainfall_24hr_mm
    row["state_daily_normal_mm"] = daily_normal
    row["rainfall_anomaly_ratio"] = anomaly_ratio
    state_col = f"state_{state}"
    if state_col in row:
        row[state_col] = 1.0

    X = pd.DataFrame([[row[c] for c in FEATURE_COLS]], columns=FEATURE_COLS)
    score = float(_model.predict_proba(X)[0, 1])

    if score >= 0.75:
        level = "high"
    elif score >= 0.4:
        level = "moderate"
    else:
        level = "low"

    return {
        "risk_score": round(score, 4),
        "risk_level": level,
        "state_used": state,
        "rainfall_anomaly_ratio": round(anomaly_ratio, 2),
        "state_daily_normal_mm": round(daily_normal, 2),
    }


if __name__ == "__main__":
    # sanity check
    print(predict_risk(25.58, 91.88, rainfall_24hr_mm=250, state="Meghalaya"))
    print(predict_risk(25.58, 91.88, rainfall_24hr_mm=2, state="Meghalaya"))
