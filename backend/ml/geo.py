"""
State resolution for NER coordinates.

Replaces the single-centroid `_nearest_state` in predict_risk.py, which was
wrong for most of Assam: Assam is a long thin arc wrapped around Meghalaya and
the hill states, so its centroid sits far from most Assamese towns. Guwahati,
Dhubri and Silchar all resolved to the wrong state, which pulled the wrong
monthly rainfall normal (Guwahati was using Meghalaya's 25.2 mm/day instead of
Assam's 10.1 mm/day in June -- a 2.5x error in the anomaly ratio).

Multi-anchor nearest-neighbour: each state is represented by several towns, so
non-convex states resolve correctly. Still a fallback -- pass `state` explicitly
from your district/road record whenever you have it, and replace this with a
shapefile point-in-polygon lookup when you add the GIS layer.
"""
from __future__ import annotations

STATE_ANCHORS: dict[str, list[tuple[float, float]]] = {
    "Assam": [(26.14, 91.73), (26.02, 89.98), (26.63, 92.80), (26.75, 94.22),
              (27.47, 94.91), (24.82, 92.80), (26.35, 92.68), (27.49, 95.36),
              (26.18, 91.00), (24.69, 92.36)],
    "Arunachal Pradesh": [(27.10, 93.62), (28.07, 95.33), (27.92, 96.17),
                          (27.59, 91.87), (27.63, 93.83), (27.13, 95.73),
                          (28.22, 94.23), (27.88, 92.40)],
    "Meghalaya": [(25.57, 91.88), (25.52, 90.22), (25.45, 92.20),
                  (25.30, 91.70), (25.52, 91.26), (25.18, 92.03)],
    "Manipur": [(24.81, 93.94), (24.33, 93.68), (25.05, 94.36),
                (24.80, 93.12), (24.50, 94.02)],
    "Mizoram": [(23.73, 92.72), (22.89, 92.73), (23.47, 93.33),
                (22.49, 92.98), (24.07, 92.60)],
    "Nagaland": [(25.67, 94.11), (25.90, 93.73), (26.32, 94.52),
                 (26.75, 95.00), (26.13, 94.51)],
    "Sikkim": [(27.33, 88.61), (27.28, 88.26), (27.17, 88.35), (27.51, 88.53)],
    "Tripura": [(23.83, 91.28), (23.53, 91.48), (24.37, 92.17), (23.94, 91.85)],
}


def nearest_state(lat: float, lon: float) -> str:
    """Nearest-anchor state lookup. Longitude is scaled by cos(lat) so that a
    degree of longitude is compared against a degree of latitude fairly."""
    import math
    k = math.cos(math.radians(lat))
    best, best_d = "Assam", float("inf")
    for state, anchors in STATE_ANCHORS.items():
        for alat, alon in anchors:
            d = (lat - alat) ** 2 + ((lon - alon) * k) ** 2
            if d < best_d:
                best, best_d = state, d
    return best


if __name__ == "__main__":
    checks = {
        "Guwahati": (26.14, 91.73, "Assam"),
        "Silchar": (24.82, 92.80, "Assam"),
        "Dibrugarh": (27.47, 94.91, "Assam"),
        "Dhubri": (26.02, 89.98, "Assam"),
        "Shillong": (25.57, 91.88, "Meghalaya"),
        "Cherrapunji": (25.30, 91.70, "Meghalaya"),
        "Tura": (25.52, 90.22, "Meghalaya"),
        "Kohima": (25.67, 94.11, "Nagaland"),
        "Dimapur": (25.90, 93.73, "Nagaland"),
        "Imphal": (24.81, 93.94, "Manipur"),
        "Aizawl": (23.73, 92.72, "Mizoram"),
        "Agartala": (23.83, 91.28, "Tripura"),
        "Gangtok": (27.33, 88.61, "Sikkim"),
        "Itanagar": (27.10, 93.62, "Arunachal Pradesh"),
        "Pasighat": (28.07, 95.33, "Arunachal Pradesh"),
    }
    ok = 0
    for name, (la, lo, want) in checks.items():
        got = nearest_state(la, lo)
        flag = "ok " if got == want else "BAD"
        ok += got == want
        print(f"{flag} {name:14s} -> {got}")
    print(f"\n{ok}/{len(checks)} correct")
