import pandas as pd
import numpy as np
import xarray as xr
from pathlib import Path

BASE = Path(__file__).resolve().parent
DATA = BASE.parent / "data"

POS_FILE = DATA / "flood_training_2023.csv"
RAIN_FILE = DATA / "RF25_ind2023_rfp25.nc"
OUT_FILE = DATA / "flood_dataset_2023.csv"

# Load clean positive events
pos = pd.read_csv(POS_FILE)
pos["event_date"] = pd.to_datetime(pos["event_date"])

print("Positive events loaded:", len(pos))

# Load rainfall
rain = xr.open_dataset(RAIN_FILE)["RAINFALL"]

# Flood dates by state + district
flood_dates = {}

for _, row in pos.iterrows():
    key = (row["state"], row["district"])
    flood_dates.setdefault(key, set()).add(row["event_date"].date())

all_dates = pd.date_range("2023-01-01", "2023-12-31", freq="D")

negative_rows = []

for _, row in pos.iterrows():

    key = (row["state"], row["district"])
    event_date = row["event_date"]

    # Same month, away from known flood events
    candidates = []

    for d in all_dates:

        if d.month != event_date.month:
            continue

        if any(
            abs((d.date() - fd).days) <= 3
            for fd in flood_dates[key]
        ):
            continue

        candidates.append(d)

    found = False

    for d in candidates:

        try:
            # First select the date
            daily = rain.sel(TIME=d)

            # Then select nearest grid cell
            cell = daily.sel(
                LATITUDE=row["latitude"],
                LONGITUDE=row["longitude"],
                method="nearest"
            )

            r24 = float(cell.item())

            if not np.isfinite(r24):
                continue

            # 3-day rainfall
            r3 = rain.sel(
                TIME=slice(
                    d - pd.Timedelta(days=2),
                    d
                )
            ).sel(
                LATITUDE=row["latitude"],
                LONGITUDE=row["longitude"],
                method="nearest"
            ).values

            # 7-day rainfall
            r7 = rain.sel(
                TIME=slice(
                    d - pd.Timedelta(days=6),
                    d
                )
            ).sel(
                LATITUDE=row["latitude"],
                LONGITUDE=row["longitude"],
                method="nearest"
            ).values

            r3 = float(np.nansum(r3))
            r7 = float(np.nansum(r7))

            negative_rows.append({
                "UEI": "NEG_" + str(len(negative_rows) + 1),
                "event_date": d,
                "state": row["state"],
                "district": row["district"],
                "lgd_districtcode": row["lgd_districtcode"],
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "grid_latitude": row["grid_latitude"],
                "grid_longitude": row["grid_longitude"],
                "rainfall_24hr_mm": r24,
                "rainfall_3day_mm": r3,
                "rainfall_7day_mm": r7,
                "flood": 0
            })

            found = True
            break

        except Exception:
            continue

    if not found:
        print(
            "WARNING:",
            row["state"],
            row["district"],
            event_date.date()
        )

neg = pd.DataFrame(negative_rows)

# Combine WITHOUT dropping legitimate positive events
dataset = pd.concat(
    [pos, neg],
    ignore_index=True
)

dataset = dataset.sample(
    frac=1,
    random_state=42
).reset_index(drop=True)

dataset.to_csv(
    OUT_FILE,
    index=False
)

print("\n================================")
print("NEGATIVE SAMPLE BUILD COMPLETE")
print("================================")

print("Positive samples:", (dataset["flood"] == 1).sum())
print("Negative samples:", (dataset["flood"] == 0).sum())
print("Total samples:", len(dataset))

print("\nClass distribution:")
print(dataset["flood"].value_counts())

print("\nSaved to:")
print(OUT_FILE)

print("\nRainfall statistics:")
print(
    dataset[
        [
            "rainfall_24hr_mm",
            "rainfall_3day_mm",
            "rainfall_7day_mm"
        ]
    ].describe()
)