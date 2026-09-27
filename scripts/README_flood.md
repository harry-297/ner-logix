# Flood risk for the NER logistics platform

## Why this is not a copy of the landslide model

The landslide model maps same-day rainfall to a risk score. That works because a
landslide is a fast, local response to a rainfall burst on a steep slope.

Floods do not work that way, so the flood classifier uses multi-day rainfall,
location, and month rather than copying the landslide feature contract:

| | Landslide | Flood |
|---|---|---|
| Time scale | Hours, same-day | 2–10 days of accumulation |
| Terrain that raises risk | Steep slope, high relief | Flat, low-lying floodplain |
| Key hidden variable | Slope, soil depth | Soil saturation, upstream inflow |
| Where the rain falls | Here | Often 200 km upstream |

The terrain factor is an inversion, not a variation. The places at highest
landslide risk in NER — the Meghalaya plateau, the Naga hills, Arunachal — are at
*low* flood risk, and the Brahmaputra and Barak valleys are the reverse. A model
trained on the same features would learn "rain = bad" and assign the same score
to a ridge and a floodplain.

## What was built

- **`flood_risk.py`** — `predict_flood_risk()`. Loads the trained
   `GradientBoostingClassifier` and passes exactly six features: latitude,
   longitude, month, and 24-hour, 3-day, and 7-day rainfall. Legacy upstream,
   gauge, and state arguments are accepted as non-ML context for the dispatcher.
- The saved flood model was trained on 532 real 2023 inventory/rainfall rows
   (266 flood events and 266 matched non-inventory samples), with test ROC-AUC
   0.9266, average precision 0.9356, and approximately 88% accuracy.
- **`geo.py`** — fixed state resolution (see bug notes below).
- **`predict_disruption.py`** — what your router should call. Runs both hazards,
  returns one verdict per road link or bridge with an expected disruption
  duration and a dispatch recommendation.
- **`train_flood_model.py`** — reproducible training script for the existing
   real flood dataset. It is not needed for inference.

Terrain exposure remains a transparent dispatcher adjustment for combining the
two hazard signals; it is not added to the trained flood feature row.

## Two bugs found in the existing code

**1. State resolution was wrong for most of Assam.** `_nearest_state` picked the
nearest state centroid. Assam is a long arc wrapped around Meghalaya, so its
centroid sits far from most Assamese towns. Guwahati, Dhubri and Silchar all
resolved to the wrong state, pulling the wrong monthly normal — Guwahati was
using Meghalaya's 25.2 mm/day June normal instead of Assam's 15.5, a 1.6x error
in `rainfall_anomaly_ratio`, which is the model's second-most-important feature.
`geo.py` replaces it with multi-anchor nearest-neighbour: 15/15 on a test set of
NER towns. `predict_risk.py` has been patched to use it.

**2. `feature_cols` contains `state_daily_normal_mm` twice.** Positions 5 and 7.
Inference still works, but the model trained on a duplicated column and split its
importance across both copies. Harmless, worth cleaning up on the next retrain.

## One thing to know about the landslide model

It saturates. Probe it and you get 0.988 at 50 mm, 0.988 at 120 mm, 0.988 at 500
mm. Combined with the metadata note that negatives are synthetic quiet days, the
0.991 AUC is measuring "can you tell rain from no rain". Above about 50 mm/24 h
it is a threshold alarm, not a ranking. Do not sort road segments by that score
and tell an operator the top one is the most dangerous.

`predict_disruption.py` also damps landslide risk in flat terrain, because the
trained model has no slope feature and otherwise returns 0.99 in the middle of
the Barak floodplain. That is a stopgap; a DEM slope raster is the real fix.

## What to add next, in order of payoff

1. **Multi-day rainfall in your weather ingest.** The flood index falls back to
   estimating 3-day and 7-day totals from the 24-hour figure, which is the single
   biggest accuracy loss right now. IMD gridded rainfall or Open-Meteo historical
   both give daily series free.
2. **CWC river gauge levels.** `river_level_pct_of_danger` is an observation
   rather than an inference and dominates the score when supplied. The Central
   Water Commission publishes level and danger-level data for Brahmaputra and
   Barak stations.
3. **A DEM.** SRTM or Copernicus 30 m. Gives slope for the landslide side and
   HAND (height above nearest drainage) for the flood side, replacing both the
   bounding-box flood zones and the slope proxy. This is the change that turns
   both models from rainfall heuristics into hazard models.
4. **Upstream catchment averaging.** Currently `upstream_rainfall_24hr_mm` is a
   parameter you pass in. Once you have basin polygons, compute it automatically
   by area-averaging rainfall over the source region named in `UPSTREAM_SOURCES`.

## Flood event labels, if you want to train

- Assam State Disaster Management Authority daily flood reports (district-level,
  daily through the monsoon, includes roads and embankments breached)
- NDMA and the Assam Flood Reporting and Information Management System
- Dartmouth Flood Observatory global flood archive
- EM-DAT for major events with dates and affected districts
- Sentinel-1 SAR flood extent — the most useful source, because it gives
  spatially explicit water masks rather than district-level counts

Assam SDMA alone gives several thousand district-days of labels across a decade.
That is enough to train on, provided you sample negatives the way
`train_flood_model.py` describes and not the way the landslide model did.

## Quick check

    python geo.py                 # state resolver test set
    python flood_risk.py          # five scenarios
    python predict_disruption.py  # combined verdicts

Scenario behaviour after calibration:

| Scenario | Flood | Dominant | Blocked |
|---|---|---|---|
| Silchar, Barak valley, 420 mm/3d | 0.99 | flood | 124 h |
| Guwahati, 195 mm/3d, dry antecedent week | 0.90 | flood | 115 h |
| Cherrapunji plateau, 800 mm/24h | 0.65 | landslide | 41 h |
| Dhubri, clear sky, 240 mm upstream | 0.86 | flood | 140 h |
| Guwahati, dry January | 0.08 | — | 0 h |

The Dhubri row is the one worth demoing: clear sky overhead, 5 mm of local rain,
and the platform still flags the bridge, because it is tracking what fell on the
Bhutan hills 30 hours ago.
