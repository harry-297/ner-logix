"""
ML hazard models for NER-LOGIX.

Two trained models live here, plus a dispatcher that combines them:

  predict_risk(...)        landslide probability      (risk_model.joblib)
  predict_flood_risk(...)  flood probability          (flood_model.joblib)
  predict_disruption(...)  combined verdict per asset (dispatcher)

`predict_disruption` is the one the routing/scoring layer should normally
call: the road network does not care *which* hazard closed a link, only
whether it is passable and for how long.

Import style
------------
Modules here use `from ml.x import y` with a fallback to a flat import, so
they work both as part of the FastAPI app (run from `backend/`) and when a
file is executed directly for a quick sanity check (`python ml/geo.py`).
"""

from .predict_risk import predict_risk
from .flood_risk import predict_flood_risk
from .predict_disruption import predict_disruption

__all__ = ["predict_risk", "predict_flood_risk", "predict_disruption"]
