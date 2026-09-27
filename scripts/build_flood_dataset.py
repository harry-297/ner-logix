import pandas as pd
import geopandas as gpd
import xarray as xr
from pathlib import Path


# --------------------------------------------------
# PATHS
# --------------------------------------------------

BASE = Path(__file__).resolve().parent
DATA = BASE.parent / "data"

FLOOD_FILE = DATA / "India_Flood_Inventory_v3.csv"
DISTRICT_FILE = DATA / "ner_districts.geojson"
RAIN_FILE = DATA / "RF25_ind2023_rfp25.nc"

OUTPUT_FILE = DATA / "flood_training_2023.csv"
SKIPPED_FILE = DATA / "flood_events_skipped_2023.csv"


# --------------------------------------------------
# NER STATES
# --------------------------------------------------

NER_STATES = [
    "Assam",
    "Arunachal Pradesh",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Tripura",
    "Sikkim"
]


# --------------------------------------------------
# LOAD FLOOD INVENTORY
# --------------------------------------------------

print("Loading flood inventory...")

df = pd.read_csv(FLOOD_FILE)

# Correct date interpretation: DD-MM-YYYY
df["event_date"] = pd.to_datetime(
    df["Start Date"],
    dayfirst=True,
    errors="coerce"
)

# Keep 2023 NER events
df = df[
    (df["event_date"].dt.year == 2023)
    & df["State"].isin(NER_STATES)
].copy()

print("NER 2023 events:", len(df))


# --------------------------------------------------
# LOAD DISTRICT GEOMETRY
# --------------------------------------------------

print("Loading district boundaries...")

gdf = gpd.read_file(DISTRICT_FILE)

# Calculate accurate centroids using projected CRS
g_projected = gdf.to_crs("EPSG:32646")

centroids = g_projected.geometry.centroid.to_crs("EPSG:4326")

gdf["lat"] = centroids.y
gdf["lon"] = centroids.x

# Make LGD code numeric where possible
gdf["lgd_districtcode"] = pd.to_numeric(
    gdf["lgd_districtcode"],
    errors="coerce"
)


# --------------------------------------------------
# LOAD IMD RAINFALL
# --------------------------------------------------

print("Loading IMD rainfall...")

ds = xr.open_dataset(RAIN_FILE)

rain = ds["RAINFALL"]


# --------------------------------------------------
# BUILD TRAINING ROWS
# --------------------------------------------------

rows = []
skipped = []

print("Building rainfall features...")


for _, event in df.iterrows():

    ue_id = event["UEI"]
    event_date = event["event_date"]

    # ----------------------------------------------
    # Get LGD code
    # ----------------------------------------------

    code_text = str(event["District_LGD_Codes"])

    if code_text == "nan" or not code_text.strip():
        skipped.append({
            "UEI": ue_id,
            "reason": "missing LGD code"
        })
        continue

    # Handle multiple LGD codes
    codes = []

    for value in code_text.split(","):
        value = value.strip()

        try:
            codes.append(int(float(value)))
        except ValueError:
            pass

    if not codes:
        skipped.append({
            "UEI": ue_id,
            "reason": "invalid LGD code"
        })
        continue

    # ----------------------------------------------
    # Process every district linked to event
    # ----------------------------------------------

    for lgd_code in codes:

        district = gdf[
            gdf["lgd_districtcode"] == lgd_code
        ]

        if district.empty:
            skipped.append({
                "UEI": ue_id,
                "reason": f"LGD {lgd_code} not found"
            })
            continue

        district = district.iloc[0]

        lat = float(district["lat"])
        lon = float(district["lon"])

        # ------------------------------------------
        # Find nearest IMD grid
        # ------------------------------------------

        grid = rain.sel(
            LATITUDE=lat,
            LONGITUDE=lon,
            method="nearest"
        )

        grid_lat = float(grid.LATITUDE)
        grid_lon = float(grid.LONGITUDE)

        # ------------------------------------------
        # Check rainfall date
        # ------------------------------------------

        if event_date not in pd.to_datetime(
            rain.TIME.values
        ):
            skipped.append({
                "UEI": ue_id,
                "reason": "event date not available in rainfall file"
            })
            continue

        # ------------------------------------------
        # 24-hour rainfall
        # ------------------------------------------

        r24 = rain.sel(
            TIME=event_date,
            LATITUDE=lat,
            LONGITUDE=lon,
            method="nearest"
        )

        rainfall_24h = float(r24)

        # ------------------------------------------
        # 3-day rainfall
        # ------------------------------------------

        start_3 = event_date - pd.Timedelta(days=2)

        r3 = rain.sel(
    TIME=slice(start_3, event_date)
).sel(
    LATITUDE=lat,
    LONGITUDE=lon,
    method="nearest"
)

        rainfall_3day = float(r3.sum())

        # ------------------------------------------
        # 7-day rainfall
        # ------------------------------------------

        start_7 = event_date - pd.Timedelta(days=6)

        
    TIME=slice(start_7, event_date)
).sel(
    LATITUDE=lat,
    LONGITUDE=lon,
    method="nearest"
)

        rainfall_7day = float(r7.sum())

        # ------------------------------------------
        # Save row
        # ------------------------------------------

        rows.append({

            "UEI": ue_id,

            "event_date": event_date.strftime("%Y-%m-%d"),

            "state": event["State"],

            "district": district["lgd_districtname"],

            "lgd_districtcode": lgd_code,

            "latitude": lat,

            "longitude": lon,

            "grid_latitude": grid_lat,

            "grid_longitude": grid_lon,

            "rainfall_24hr_mm": rainfall_24h,

            "rainfall_3day_mm": rainfall_3day,

            "rainfall_7day_mm": rainfall_7day,

            # Flood inventory provides the positive label
            "flood": 1
        })


# --------------------------------------------------
# SAVE DATASET
# --------------------------------------------------

result = pd.DataFrame(rows)

result.to_csv(
    OUTPUT_FILE,
    index=False
)

pd.DataFrame(skipped).to_csv(
    SKIPPED_FILE,
    index=False
)


# --------------------------------------------------
# SUMMARY
# --------------------------------------------------

print()
print("====================================")
print("DATASET BUILD COMPLETE")
print("====================================")

print("Training rows:", len(result))
print("Unique flood events:", result["UEI"].nunique())

print()
print("Rows by state:")
print(result["state"].value_counts().to_string())

print()
print("Rainfall statistics:")
print(
    result[
        [
            "rainfall_24hr_mm",
            "rainfall_3day_mm",
            "rainfall_7day_mm"
        ]
    ].describe().to_string()
)

print()
print("Skipped records:", len(skipped))

print()
print("Saved:")
print(OUTPUT_FILE)
print(SKIPPED_FILE)