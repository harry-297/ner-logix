#!/usr/bin/env python3
"""
score_roads_risk.py

Scores every real road in the `roads` table using the existing landslide
risk model (backend/ml/predict_risk.py), fed with LIVE rainfall from
Open-Meteo instead of a manual figure. Updates each road's risk_score,
risk_level, and status in place.

Design choices made here (not part of the original model — stated
explicitly so you can adjust or justify them in your writeup):

- Roads are bucketed into a rainfall grid (~25km cells) so we don't make
  7,000+ separate weather API calls — rainfall is regional enough that
  this is a reasonable approximation, not a fabrication of data.
- risk_level has 4 buckets (LOW/MODERATE/HIGH/CRITICAL) to match the
  roads table's existing convention, though the model itself only
  outputs 3 (low/moderate/high). The CRITICAL threshold (score >= 0.9)
  is an operational judgment call we're adding on top of the model.
- status (ACCESSIBLE/RESTRICTED/DISRUPTED/BLOCKED) is derived from the
  score using thresholds we chose (see STATUS_THRESHOLDS below) — this
  is a rule we're layering on the model's output, not something the
  model predicts directly. Be ready to explain/justify these cutoffs.

Run this on your own machine (needs internet access for Open-Meteo, and
needs the backend/ml model files available on disk).

Setup:
    pip install -r requirements-osm.txt   # already has requests+psycopg2
    (this script also needs backend's own deps importable — see --backend-path)

Usage:
    python score_roads_risk.py                   # score every road
    python score_roads_risk.py --dry-run           # compute but don't write
    python score_roads_risk.py --limit 50          # test on first 50 roads
    python score_roads_risk.py --state Assam        # just one state
"""

import argparse
import re
import sys
import time
from pathlib import Path

import requests

try:
    import psycopg2
except ImportError:
    print("Missing dependency. Run: pip install -r requirements-osm.txt")
    sys.exit(1)


OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
GRID_SIZE = 0.25  # ~25km cells for grouping rainfall lookups
BATCH_SIZE = 50    # Open-Meteo points per request

# Our own thresholds layered on top of the model's raw probability.
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


def load_database_url(env_path: Path) -> str:
    if not env_path.exists():
        print(f"Could not find .env at {env_path}")
        sys.exit(1)
    text = env_path.read_text()
    match = re.search(r'^DATABASE_URL\s*=\s*(.+)$', text, re.MULTILINE)
    if not match:
        print(f"No DATABASE_URL found in {env_path}")
        sys.exit(1)
    raw = match.group(1).strip().strip('"').strip("'")
    return raw.replace("postgresql+asyncpg://", "postgresql://")


def grid_key(lat: float, lon: float) -> tuple[float, float]:
    return (round(lat / GRID_SIZE) * GRID_SIZE, round(lon / GRID_SIZE) * GRID_SIZE)


def fetch_rainfall_batch(points: list[tuple[float, float]]) -> dict[tuple[float, float], float]:
    """Fetch 24hr rainfall for a batch of grid-cell centroids in one request."""
    lat_str = ",".join(str(p[0]) for p in points)
    lon_str = ",".join(str(p[1]) for p in points)
    params = {
        "latitude": lat_str,
        "longitude": lon_str,
        "hourly": "precipitation",
        "past_days": 1,
        "forecast_days": 1,
        "timezone": "UTC",
    }
    resp = requests.get(OPEN_METEO_URL, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    results = data if isinstance(data, list) else [data]

    output = {}
    for point, result in zip(points, results):
        precip_values = result.get("hourly", {}).get("precipitation", [])
        last_24 = precip_values[-24:] if precip_values else []
        output[point] = round(sum(v for v in last_24 if v is not None), 2)
    return output


def classify(score: float, thresholds: list[tuple[float, str]], default: str) -> str:
    for cutoff, label in thresholds:
        if score >= cutoff:
            return label
    return default


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-path", default="../ner-logix/backend/.env")
    parser.add_argument("--backend-path", default="../ner-logix/backend",
                         help="Path to backend/ so we can import ml.predict_risk")
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--state", default=None, help="Only score roads in this state")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    backend_path = str(Path(args.backend_path).resolve())
    if backend_path not in sys.path:
        sys.path.insert(0, backend_path)
    try:
        from ml.predict_risk import predict_risk  # noqa: E402
    except Exception as exc:
        print(f"Could not import predict_risk from {backend_path}/ml: {exc}")
        print("Check --backend-path points at your backend/ folder.")
        sys.exit(1)

    dsn = args.database_url or load_database_url(Path(args.env_path))

    conn = psycopg2.connect(dsn)
    cur = conn.cursor()

    query = """
        SELECT road_id, state,
               ST_Y(ST_Centroid(geometry)) AS lat,
               ST_X(ST_Centroid(geometry)) AS lon
        FROM roads
    """
    params = []
    if args.state:
        query += " WHERE state = %s"
        params.append(args.state)
    if args.limit:
        query += " LIMIT %s"
        params.append(args.limit)

    cur.execute(query, params)
    roads = cur.fetchall()  # [(road_id, state, lat, lon), ...]
    print(f"Loaded {len(roads)} road(s) to score.")

    # Group by grid cell to minimize weather API calls.
    grid_points = sorted({grid_key(lat, lon) for _, _, lat, lon in roads})
    print(f"Grouped into {len(grid_points)} rainfall grid cell(s) "
          f"(~{GRID_SIZE}deg, ~25km each).")

    rainfall_by_grid: dict[tuple[float, float], float] = {}
    for i in range(0, len(grid_points), BATCH_SIZE):
        batch = grid_points[i:i + BATCH_SIZE]
        print(f"  Fetching rainfall for grid cells {i+1}-{i+len(batch)}"
              f"/{len(grid_points)}...")
        try:
            rainfall_by_grid.update(fetch_rainfall_batch(batch))
        except Exception as exc:
            print(f"  Batch failed: {exc}. Retrying once after 5s...")
            time.sleep(5)
            rainfall_by_grid.update(fetch_rainfall_batch(batch))
        time.sleep(1)

    updates = []
    level_counts = {}
    status_counts = {}

    for road_id, state, lat, lon in roads:
        key = grid_key(lat, lon)
        rainfall = rainfall_by_grid.get(key, 0.0)

        result = predict_risk(
            latitude=lat, longitude=lon,
            rainfall_24hr_mm=rainfall, state=state,
        )
        score = result["risk_score"]  # 0-1 probability

        risk_score_pct = round(score * 100, 2)
        risk_level = classify(score, RISK_LEVEL_THRESHOLDS, DEFAULT_RISK_LEVEL)
        status = classify(score, STATUS_THRESHOLDS, DEFAULT_STATUS)

        level_counts[risk_level] = level_counts.get(risk_level, 0) + 1
        status_counts[status] = status_counts.get(status, 0) + 1

        updates.append((risk_score_pct, risk_level, status, road_id))

    print(f"\nRisk level distribution: {level_counts}")
    print(f"Status distribution: {status_counts}")

    if args.dry_run:
        print(f"\n[dry-run] Would update {len(updates)} roads. Not writing to DB.")
        cur.close()
        conn.close()
        return

    print(f"\nUpdating {len(updates)} roads...")
    updated = 0
    for risk_score_pct, risk_level, status, road_id in updates:
        cur.execute(
            """
            UPDATE roads
            SET risk_score = %s, risk_level = %s, status = %s, updated_at = now()
            WHERE road_id = %s
            """,
            (risk_score_pct, risk_level, status, road_id),
        )
        updated += 1
        if updated % 500 == 0:
            conn.commit()
            print(f"  Committed {updated}/{len(updates)}...")
    conn.commit()
    print(f"Done. Updated {updated} roads.")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
