import pandas as pd
import joblib

from pathlib import Path

from sklearn.model_selection import train_test_split
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    roc_auc_score,
    average_precision_score
)


BASE = Path(__file__).resolve().parent
DATA = BASE.parent / "data"

DATA_FILE = DATA / "flood_dataset_2023.csv"
MODEL_FILE = BASE / "flood_model.joblib"


# -----------------------------
# 1. Load dataset
# -----------------------------

df = pd.read_csv(DATA_FILE)

print("Dataset loaded")
print("Rows:", len(df))

# Convert date
df["event_date"] = pd.to_datetime(df["event_date"])

# Month is useful because rainfall/flood behavior is seasonal
df["month"] = df["event_date"].dt.month


# -----------------------------
# 2. Select real features
# -----------------------------

features = [
    "latitude",
    "longitude",
    "month",
    "rainfall_24hr_mm",
    "rainfall_3day_mm",
    "rainfall_7day_mm"
]

X = df[features]
y = df["flood"]


print("\nFeatures:")
print(features)

print("\nClass distribution:")
print(y.value_counts())


# -----------------------------
# 3. Train/test split
# -----------------------------

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.20,
    random_state=42,
    stratify=y
)

print("\nTraining samples:", len(X_train))
print("Testing samples:", len(X_test))


# -----------------------------
# 4. Train model
# -----------------------------

model = GradientBoostingClassifier(
    n_estimators=150,
    learning_rate=0.05,
    max_depth=3,
    random_state=42
)

model.fit(X_train, y_train)


# -----------------------------
# 5. Evaluate
# -----------------------------

pred = model.predict(X_test)
prob = model.predict_proba(X_test)[:, 1]

auc = roc_auc_score(y_test, prob)
ap = average_precision_score(y_test, prob)

print("\n==============================")
print("FLOOD MODEL RESULTS")
print("==============================")

print("\nROC-AUC:", round(auc, 4))
print("Average Precision:", round(ap, 4))

print("\nConfusion Matrix:")
print(confusion_matrix(y_test, pred))

print("\nClassification Report:")
print(classification_report(y_test, pred))


# -----------------------------
# 6. Feature importance
# -----------------------------

importance = pd.Series(
    model.feature_importances_,
    index=features
).sort_values(ascending=False)

print("\nFeature Importance:")
print(importance)


# -----------------------------
# 7. Save model
# -----------------------------

joblib.dump(model, MODEL_FILE)

print("\nModel saved to:")
print(MODEL_FILE)