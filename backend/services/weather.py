"""
Live rainfall lookup via the Open-Meteo API (free, no API key required).

Used to feed real, current rainfall into the hazard models instead of
requiring the caller to supply rainfall figures by hand.

Two shapes of lookup live here:

- get_rainfall_24hr_mm / get_rainfall_24hr_batch_mm
  Single 24-hour total. This is all the landslide model needs, and these
  two functions are unchanged -- existing callers keep working exactly as
  before.

- get_rainfall_windows_mm / get_rainfall_windows_batch_mm
  24-hour, 3-day and 7-day totals in one request. The flood model is
  trained on all three windows; handing it only the 24-hour figure and
  letting flood_risk.py estimate the rest makes the score substantially
  less reliable (predict_disruption emits an explicit caveat when this
  happens). One request covers all three windows, so there is no extra
  API cost over fetching 24 hours alone.

Open-Meteo docs: https://open-meteo.com/en/docs
"""
import httpx

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

# 7 days of history is the longest window the flood model uses. Open-Meteo
# caps past_days at 92, so this is well inside limits.
HISTORY_DAYS = 7


def _sum_last(values: list, hours: int) -> float:
    """Sum the most recent `hours` hourly readings, skipping nulls."""
    window = values[-hours:] if values else []
    return round(sum(v for v in window if v is not None), 2)


def _windows_from_hourly(precip_values: list) -> dict[str, float]:
    return {
        "rainfall_24hr_mm": _sum_last(precip_values, 24),
        "rainfall_3day_mm": _sum_last(precip_values, 72),
        "rainfall_7day_mm": _sum_last(precip_values, 168),
    }


async def get_rainfall_24hr_mm(latitude: float, longitude: float) -> float:
    """
    Returns total precipitation (mm) over the last 24 hours at the given
    coordinates, using Open-Meteo's hourly precipitation data.

    past_days=1 gives us yesterday + today's hours up to now; we sum the
    most recent 24 hourly values to get a rolling 24hr total.
    """
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": "precipitation",
        "past_days": 1,
        "forecast_days": 1,
        "timezone": "UTC",
    }
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(OPEN_METEO_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    hourly = data.get("hourly", {})
    precip_values = hourly.get("precipitation", [])

    if not precip_values:
        raise ValueError("Open-Meteo returned no precipitation data for this location")

    # Take the most recent 24 hourly readings available.
    last_24 = precip_values[-24:]
    return round(sum(v for v in last_24 if v is not None), 2)


async def get_rainfall_24hr_batch_mm(points: list[tuple[float, float]]) -> dict[tuple[float, float], float]:
    """
    Batched version: Open-Meteo supports comma-separated lat/lon lists in a
    single request, which is far cheaper than one request per point when
    scoring thousands of roads grouped into a smaller number of grid cells.
    """
    if not points:
        return {}

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
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(OPEN_METEO_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    # Open-Meteo returns a list of per-location results when multiple
    # lat/lon values are passed; a single dict otherwise.
    results = data if isinstance(data, list) else [data]

    output = {}
    for point, result in zip(points, results):
        precip_values = result.get("hourly", {}).get("precipitation", [])
        last_24 = precip_values[-24:] if precip_values else []
        output[point] = round(sum(v for v in last_24 if v is not None), 2)
    return output


async def get_rainfall_windows_mm(latitude: float, longitude: float) -> dict[str, float]:
    """
    Returns 24-hour, 3-day and 7-day precipitation totals (mm) at the given
    coordinates -- the three rainfall features the flood model was trained
    on. One request covers all three windows.
    """
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "hourly": "precipitation",
        "past_days": HISTORY_DAYS,
        "forecast_days": 1,
        "timezone": "UTC",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(OPEN_METEO_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    precip_values = data.get("hourly", {}).get("precipitation", [])

    if not precip_values:
        raise ValueError("Open-Meteo returned no precipitation data for this location")

    return _windows_from_hourly(precip_values)


async def get_rainfall_windows_batch_mm(
    points: list[tuple[float, float]],
) -> dict[tuple[float, float], dict[str, float]]:
    """
    Batched multi-window version, same trick as get_rainfall_24hr_batch_mm:
    Open-Meteo accepts comma-separated lat/lon lists in a single request,
    which is far cheaper than one request per grid cell when scoring the
    whole road network.

    Points that come back without usable data are omitted from the result
    rather than defaulted to zero -- a missing reading and a genuinely dry
    cell are different things, and the caller decides how to treat each.
    """
    if not points:
        return {}

    params = {
        "latitude": ",".join(str(p[0]) for p in points),
        "longitude": ",".join(str(p[1]) for p in points),
        "hourly": "precipitation",
        "past_days": HISTORY_DAYS,
        "forecast_days": 1,
        "timezone": "UTC",
    }
    async with httpx.AsyncClient(timeout=45) as client:
        resp = await client.get(OPEN_METEO_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    # Open-Meteo returns a list of per-location results when multiple
    # lat/lon values are passed; a single dict otherwise.
    results = data if isinstance(data, list) else [data]

    output: dict[tuple[float, float], dict[str, float]] = {}
    for point, result in zip(points, results):
        precip_values = result.get("hourly", {}).get("precipitation", [])
        if not precip_values:
            continue
        output[point] = _windows_from_hourly(precip_values)
    return output
