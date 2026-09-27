#!/usr/bin/env python3
"""
fetch_osm_roads.py

Pulls real road geometry for a set of Indian states from OpenStreetMap
(via the public Overpass API) and inserts it into the NER-LOGIX `roads`
table. No fabricated/sample data — anything the script can't confidently
resolve (e.g. district lookup fails) is skipped and reported, not guessed.

Run this on your own machine (needs internet access to reach
overpass-api.de and nominatim.openstreetmap.org).

Setup:
    pip install -r requirements-osm.txt

Usage:
    python fetch_osm_roads.py                     # Assam + Meghalaya, trunk/primary/secondary
    python fetch_osm_roads.py --dry-run            # fetch + resolve, but don't insert
    python fetch_osm_roads.py --limit 50           # test run, only process first 50 ways per state
    python fetch_osm_roads.py --states Assam        # just one state
    python fetch_osm_roads.py --highway-types trunk,primary,secondary,tertiary

By default it reads DATABASE_URL from ../ner-logix/backend/.env (adjust
--env-path if your folder layout differs), and converts the
"postgresql+asyncpg://" URL used by the FastAPI backend into a plain
"postgresql://" DSN for psycopg2.
"""

import argparse
import os
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


OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_USER_AGENT = "ner-logix-hackathon-prototype/1.0 (contact: set-your-email-here)"

# Public Overpass mirrors reject requests that look like generic bot
# traffic (default python-requests User-Agent, missing Accept header).
# Identifying ourselves properly avoids the 406/403 responses this causes.
OVERPASS_HEADERS = {
    "User-Agent": NOMINATIM_USER_AGENT,
    "Accept": "application/json, */*;q=0.8",
}

# Official ISO 3166-2 codes for the Indian states we care about.
# Extend this if you add more states later.
STATE_ISO_CODES = {
    "Assam": "IN-AS",
    "Meghalaya": "IN-ML",
    "Nagaland": "IN-NL",
    "Manipur": "IN-MN",
    "Mizoram": "IN-MZ",
    "Tripura": "IN-TR",
    "ArunachalPradesh": "IN-AR",
    "Sikkim": "IN-SK",
}

# Map OSM highway= values to the road_type categories used in the app.
HIGHWAY_TYPE_MAP = {
    "trunk": "NATIONAL_HIGHWAY",
    "trunk_link": "NATIONAL_HIGHWAY",
    "primary": "STATE_HIGHWAY",
    "primary_link": "STATE_HIGHWAY",
    "secondary": "DISTRICT_ROAD",
    "secondary_link": "DISTRICT_ROAD",
    "tertiary": "DISTRICT_ROAD",
    "tertiary_link": "DISTRICT_ROAD",
}

DEFAULT_HIGHWAY_TYPES = ["trunk", "primary", "secondary"]

# Grid size (degrees) used to bucket coordinates for district-lookup caching.
# ~0.05 deg is roughly 5km — good enough to cut Nominatim calls drastically
# without misattributing roads across district lines too often.
GRID_SIZE = 0.05


def load_database_url(env_path: Path) -> str:
    if not env_path.exists():
        print(f"Could not find .env at {env_path}")
        print("Pass --env-path or --database-url explicitly.")
        sys.exit(1)

    text = env_path.read_text()
    match = re.search(r'^DATABASE_URL\s*=\s*(.+)$', text, re.MULTILINE)
    if not match:
        print(f"No DATABASE_URL found in {env_path}")
        sys.exit(1)

    raw = match.group(1).strip().strip('"').strip("'")
    # backend uses postgresql+asyncpg://..., psycopg2 needs postgresql://...
    return raw.replace("postgresql+asyncpg://", "postgresql://")


def fetch_overpass(query: str, max_retries_per_endpoint: int = 3) -> dict:
    last_error = None
    for endpoint in OVERPASS_ENDPOINTS:
        for attempt in range(1, max_retries_per_endpoint + 1):
            try:
                resp = requests.post(
                    endpoint,
                    data={"data": query},
                    headers=OVERPASS_HEADERS,
                    timeout=180,
                )
                if resp.status_code == 429:
                    # Rate limited — respect Retry-After if the server sent one,
                    # otherwise back off with increasing delay.
                    wait = int(resp.headers.get("Retry-After", 10 * attempt))
                    print(f"  {endpoint}: rate limited (429). Waiting {wait}s "
                          f"(attempt {attempt}/{max_retries_per_endpoint})...")
                    time.sleep(wait)
                    continue
                resp.raise_for_status()
                return resp.json()
            except Exception as exc:  # noqa: BLE001
                print(f"  Overpass endpoint {endpoint} failed "
                      f"(attempt {attempt}/{max_retries_per_endpoint}): {exc}")
                last_error = exc
                time.sleep(5 * attempt)
        # move to next mirror after exhausting retries on this one
        print(f"  Giving up on {endpoint}, trying next mirror...")
    raise RuntimeError(f"All Overpass endpoints failed: {last_error}")


def build_query(iso_code: str, highway_types: list[str]) -> str:
    highway_regex = "|".join(highway_types)
    return f"""
    [out:json][timeout:180];
    area["ISO3166-2"="{iso_code}"]->.a;
    (
      way["highway"~"^({highway_regex})$"](area.a);
    );
    out geom;
    """.strip()


_district_cache: dict[tuple[int, int], str | None] = {}


def grid_key(lat: float, lon: float) -> tuple[int, int]:
    return (round(lat / GRID_SIZE), round(lon / GRID_SIZE))


def lookup_district(lat: float, lon: float) -> str | None:
    """Reverse-geocode a point to a district name via Nominatim, with
    grid-cell caching to avoid redundant calls and respect rate limits."""
    key = grid_key(lat, lon)
    if key in _district_cache:
        return _district_cache[key]

    try:
        resp = requests.get(
            NOMINATIM_ENDPOINT,
            params={
                "format": "jsonv2",
                "lat": lat,
                "lon": lon,
                "zoom": 8,
                "addressdetails": 1,
            },
            headers={"User-Agent": NOMINATIM_USER_AGENT},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        address = data.get("address", {})
        district = (
            address.get("state_district")
            or address.get("county")
            or address.get("district")
            or address.get("city_district")
        )
    except Exception as exc:  # noqa: BLE001
        print(f"    Nominatim lookup failed for ({lat:.4f},{lon:.4f}): {exc}")
        district = None

    _district_cache[key] = district
    time.sleep(1)  # Nominatim usage policy: max 1 req/sec
    return district


def way_to_linestring_wkt(coords: list[dict]) -> str | None:
    if len(coords) < 2:
        return None
    points = ", ".join(f"{c['lon']} {c['lat']}" for c in coords)
    return f"LINESTRING({points})"


def midpoint(coords: list[dict]) -> tuple[float, float]:
    mid = coords[len(coords) // 2]
    return mid["lat"], mid["lon"]


def process_state(
    state_name: str,
    iso_code: str,
    highway_types: list[str],
    limit: int | None,
) -> list[dict]:
    print(f"\n=== {state_name} ({iso_code}) ===")
    query = build_query(iso_code, highway_types)
    print("Querying Overpass for road ways...")
    data = fetch_overpass(query)
    elements = data.get("elements", [])
    ways = [e for e in elements if e.get("type") == "way" and e.get("geometry")]
    print(f"Fetched {len(ways)} way(s) from OSM.")

    if limit:
        ways = ways[:limit]
        print(f"Limiting to first {limit} for this run.")

    rows = []
    skipped_no_geometry = 0
    skipped_no_district = 0

    for i, way in enumerate(ways, 1):
        tags = way.get("tags", {})
        highway = tags.get("highway", "")
        coords = way.get("geometry", [])

        wkt = way_to_linestring_wkt(coords)
        if not wkt:
            skipped_no_geometry += 1
            continue

        lat, lon = midpoint(coords)
        district = lookup_district(lat, lon)
        if not district:
            skipped_no_district += 1
            continue

        name = tags.get("name") or tags.get("ref") or f"Unnamed road (OSM way {way['id']})"
        road_number = tags.get("ref")
        road_type = HIGHWAY_TYPE_MAP.get(highway, "OTHER")

        rows.append({
            "name": name,
            "road_number": road_number,
            "state": state_name,
            "district": district,
            "road_type": road_type,
            "geometry_wkt": wkt,
            "osm_way_id": way["id"],
        })

        if i % 25 == 0 or i == len(ways):
            print(f"  Resolved {i}/{len(ways)} ways "
                  f"({len(rows)} kept, {skipped_no_district} skipped-no-district)")

    print(f"{state_name}: {len(rows)} roads ready to insert, "
          f"{skipped_no_geometry} skipped (no geometry), "
          f"{skipped_no_district} skipped (district lookup failed).")
    return rows


def insert_rows(dsn: str, rows: list[dict], dry_run: bool) -> None:
    if dry_run:
        print(f"\n[dry-run] Would insert {len(rows)} rows. Sample:")
        for r in rows[:5]:
            print(f"  - {r['name']} ({r['road_type']}) in {r['district']}, {r['state']}"
                  f" [OSM way {r['osm_way_id']}]")
        return

    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    cur = conn.cursor()
    inserted = 0
    try:
        for r in rows:
            cur.execute(
                """
                INSERT INTO roads (name, road_number, state, district, road_type, geometry)
                VALUES (%s, %s, %s, %s, %s, ST_GeomFromText(%s, 4326))
                """,
                (r["name"], r["road_number"], r["state"], r["district"],
                 r["road_type"], r["geometry_wkt"]),
            )
            inserted += 1
            if inserted % 100 == 0:
                conn.commit()
                print(f"  Committed {inserted}/{len(rows)}...")
        conn.commit()
        print(f"Inserted {inserted} roads total.")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--states", default="Assam,Meghalaya",
                         help="Comma-separated state names (must be in STATE_ISO_CODES)")
    parser.add_argument("--highway-types", default=",".join(DEFAULT_HIGHWAY_TYPES),
                         help="Comma-separated OSM highway= values to include")
    parser.add_argument("--limit", type=int, default=None,
                         help="Only process first N ways per state (for testing)")
    parser.add_argument("--dry-run", action="store_true",
                         help="Fetch and resolve, but don't write to the database")
    parser.add_argument("--env-path", default="../ner-logix/backend/.env",
                         help="Path to backend .env containing DATABASE_URL")
    parser.add_argument("--database-url", default=None,
                         help="Override: full postgresql:// DSN (skips reading .env)")
    args = parser.parse_args()

    states = [s.strip() for s in args.states.split(",")]
    highway_types = [h.strip() for h in args.highway_types.split(",")]

    for s in states:
        if s not in STATE_ISO_CODES:
            print(f"Unknown state '{s}'. Known: {list(STATE_ISO_CODES)}")
            sys.exit(1)

    if args.database_url:
        dsn = args.database_url
    else:
        dsn = load_database_url(Path(args.env_path))

    all_rows = []
    for state in states:
        rows = process_state(state, STATE_ISO_CODES[state], highway_types, args.limit)
        all_rows.extend(rows)

    print(f"\n=== Total: {len(all_rows)} real roads resolved across {len(states)} state(s) ===")
    insert_rows(dsn, all_rows, args.dry_run)


if __name__ == "__main__":
    main()
