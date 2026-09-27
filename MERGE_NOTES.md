# NER-LOGIX — merged build

This tree merges three parallel work streams into one project.

| Source | What was taken |
|---|---|
| **NER Logix 1** | The whole backend. This is the base, and its behaviour is preserved. |
| **NER Logix 2** | The whole frontend, including seven pages NER Logix 1 did not have. |
| **SIH** | The ML: the trained flood model, the `geo.py` state-resolution fix, and the combined-hazard dispatcher. |

---

## Two things that were broken before the merge

Both of these already existed in NER Logix 1 and would have surfaced at demo
time. They are fixed here.

### 1. The Routes page called an endpoint that no longer exists

`RoutesPage.tsx` POSTed to `/api/routes/plan` with hardcoded city coordinates.
NER Logix 1's backend had replaced that with `/api/routes/plan-district`
(pgRouting, district-to-district), but the frontend was never updated — and the
frontends in *both* NER Logix 1 and 2 were identical on this point, so swapping
them would not have fixed it.

The page is rewritten against the real endpoint. See "Routes page" below.

### 2. `db/build_routing_topology.sql` did not exist

`routers/routes.py` references this file by name and depends on what it creates:
`roads.topo_id`, `roads.source`, `roads.target`, and a `road_vertices` table.
It was not in any of the three archives, so `pgr_dijkstra` had no graph to
traverse and `/plan-district` would have failed on every request.

It has been written (`backend/db/build_routing_topology.sql`) and includes the
topology build plus three sanity checks: unrouted edges, connected components,
and districts with no routable vertex. **It has not been run against your
database** — there was no network access here — so run it and read the check
output before relying on a route.

---

## ML: what changed

### The flood model is now wired in

SIH's `flood_model.joblib` and `predict_disruption.py` are in `backend/ml/`.
The dispatcher combines landslide and flood into one verdict per asset, which
matters for more than just covering a second hazard:

The landslide model has no slope or elevation feature. On its own it saturates
near 0.99 anywhere it rains hard — including flat floodplain where there is
nothing to slide. Measured across ten real NER points under a 120 mm/24 h
burst:

| | Distribution |
|---|---|
| Landslide-only | **10/10 CRITICAL** |
| Combined | 8 HIGH, 2 CRITICAL, hill vs floodplain correctly separated |

Cherrapunji, Aizawl and Gangtok come back landslide-dominant; Guwahati, Dhubri
and Silchar come back flood-dominant. Under landslide-only they were
indistinguishable.

The damping is a slope *proxy* derived from flood exposure, not real terrain.
It is a stopgap until a DEM layer exists, and it is labelled as such in the
code and surfaced in the API's `caveats`.

### A real bug in state resolution

`predict_risk` used a single-centroid nearest-state lookup. Assam is a long
thin arc wrapped around Meghalaya, so its centroid sits far from most Assamese
towns — Guwahati, Dhubri and Silchar all resolved to the **wrong state**.

Guwahati was pulling Meghalaya's 25.2 mm/day June rainfall normal instead of
Assam's 10.1 — a 2.5× error in `rainfall_anomaly_ratio`, which is a model input
feature. SIH's multi-anchor `geo.py` fixes this and is now in use. Verified:
Guwahati resolves to Assam.

### Rainfall now covers the windows the flood model was trained on

The flood model takes 24-hour, 3-day and 7-day rainfall. `weather.py` only
fetched 24 hours, which meant `flood_risk.py` had to estimate the other two —
substantially less reliable, and the dispatcher emits a caveat when it happens.

`get_rainfall_windows_mm` / `get_rainfall_windows_batch_mm` fetch all three in
a single Open-Meteo request, so there is no extra API cost over fetching 24
hours alone.

### Road scoring runs through the combined model

`services/risk_scoring.py` now scores via `predict_disruption`. Everything else
about it is unchanged — same grid batching, same thresholds, and the same rule
that predicted risk never sets `BLOCKED` (that stays reserved for confirmed
closures, because routing drops BLOCKED roads from the graph entirely).

Set `USE_COMBINED_HAZARD = False` at the top of the file to revert to
landslide-only. No other change is needed.

Bridges and culverts are weighted differently by the dispatcher (they survive
water over the deck but not scour). There is no bridge flag in the `roads`
table, so `_asset_type()` infers it from the road name — a heuristic that will
miss unnamed structures. A miss degrades to plain road weighting, not to a
wrong answer.

---

## API

Unchanged, still working exactly as before:

- `POST /api/ml/predict-risk` — landslide only
- `POST /api/ml/score-roads-now`
- `GET /api/districts`, `/api/roads`, `/api/incidents`
- `POST /api/routes/plan-district`

New:

- `POST /api/ml/predict-flood` — flood model only
- `POST /api/ml/predict-disruption` — combined verdict, with per-model
  breakdown and a `caveats` list

Both new endpoints fetch live rainfall when none is supplied. Supplying any
rainfall figure switches the request to fully manual rather than silently
mixing live and manual data, so a result always reproduces from the inputs
shown beside it.

---

## Frontend

The NER Logix 2 frontend is used wholesale — all seven extra pages, the auth
store, and the larger stylesheet. Three changes:

**Routes page** now loads districts from `/api/districts` (so the dropdown can
only offer districts that actually have road data) and calls
`/api/routes/plan-district`. It shows the safest and fastest paths side by
side, the real segment list, and the concrete cost of choosing safety — "+14.2
km and +23 min, worst risk HIGH → MODERATE".

The demo script's city names survive as **quick picks**. Each one is validated
against the districts the API returned before its button renders, so a shortcut
can never select something the backend cannot route through. If road coverage
does not include a district, its button simply does not appear.

**Disruption Predictor** was 100% hardcoded numbers. It now calls
`/api/ml/predict-disruption` and shows the real rainfall windows, the raw model
output next to the terrain-adjusted value, and the caveats list.

**`src/lib/api.ts`** replaces the backend URL that was hardcoded in two
components. Set `VITE_API_BASE` to point elsewhere; it defaults to
`http://127.0.0.1:8000`.

---

## Running it

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env        # fill in DATABASE_URL

# Once, after loading roads — required before /plan-district works
psql "$DATABASE_URL" -f db/build_routing_topology.sql

uvicorn main:app --reload
```

```bash
# Frontend
cd frontend
npm install
npm run dev
```

`scikit-learn` must stay pinned at **1.8.0**. Both `.joblib` files fail to
unpickle on newer versions (`ModuleNotFoundError: _loss`).

---

## What was verified, and what was not

**Verified here.** Both models load and run on the pinned versions. The full ML
package imports correctly from the backend root. The combined-vs-landslide-only
comparison above is measured, not estimated. The Guwahati state-resolution fix
is confirmed. The frontend passes `tsc -b` clean — the same gate `npm run build`
runs first.

**Not verified here.** No database, so nothing that touches PostGIS or
pgRouting was executed — including the new topology SQL. No network, so the
live Open-Meteo calls were not exercised end to end; the window-summing logic
was unit-tested against synthetic hourly series instead. `vite build` and
`oxlint` could not run: the `node_modules` in the archive carries
Windows-only native binaries for both. They should work after a fresh
`npm install` on your machine.

**Note.** `backend/.env` contains a real database password. It is gitignored
and should stay that way.
