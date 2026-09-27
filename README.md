# NER-LOGIX
### AI-Powered Smart Logistics & Accessibility Intelligence Platform for the North Eastern Region

A working prototype built for Smart India Hackathon, addressing the problem
statement: *"AI-enabled logistics intelligence system tailored for the
unique geographical and operational challenges of NER."*

> **This is the merged build.** Backend from NER Logix 1, frontend from NER
> Logix 2, ML from the SIH stream. See **[MERGE_NOTES.md](MERGE_NOTES.md)**
> for what changed, two bugs that were fixed, and one required setup step
> (`backend/db/build_routing_topology.sql`) that must be run before routing
> will work.

---

## 1. Running the prototype

**Frontend (React + TypeScript + Vite + MapLibre + Recharts)**
```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

**Backend (FastAPI + PostgreSQL/PostGIS)**
```bash
cd backend
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt   # or the packages already used in main.py/routers
uvicorn main:app --reload         # http://127.0.0.1:8000
```
The **Live Map / Routes** pages call the real FastAPI
`/api/routes/plan-district` endpoint (pgRouting Dijkstra over the connected
road graph, returning independently-computed safest and fastest paths).
The **Vehicles / Incidents / Alerts / Analytics / Settings** pages run on
realistic seeded/mock data so the full experience — including states with
no live sensors yet — is demoable end-to-end today. Wiring them to the
backend later is a drop-in replacement (same data shapes are already used
in `frontend/src/data/mockData.ts`).

---

## 2. Feature-to-requirement mapping

| Problem statement requirement | Where it lives in the product |
|---|---|
| a. Real-time road, bridge & transport accessibility monitoring | **Live Map** (GIS corridor layer, risk-coloured roads) + **Dashboard** accessibility stats |
| b. Predicting route disruptions (landslide, flood, rainfall, congestion, damage) | **Incidents** module (6 incident types, severity scoring) + **Dashboard** weather/disruption forecast strip |
| c. AI-based alternate route suggestions & delay estimates | **Routes** (recommended vs. alternate corridor, risk score, ETA) |
| d. GPS tracking of vehicles carrying medicines/food/construction/agri produce | **Vehicles** module — live position, speed, ETA, trip progress per vehicle |
| e. Automated alerts for blocked roads, inaccessible regions, delays, high-risk corridors | **Alerts** module — 5 alert categories, multi-channel delivery |
| f. Field officials uploading geo-tagged updates, photos, incident reports | **Incidents → "New Field Report"** modal — GPS auto-lock, photo attach, offline-safe submission |
| g. Centralized dashboards: district connectivity, bottlenecks, emergency routes, real-time delivery status | **Dashboard** + **Analytics** (connectivity chart, risk matrix, emergency accessibility routes table, cargo mix, delay trends) |
| h. Multilingual notifications & offline sync for low-network areas | **Alerts** language switcher (English/Hindi/Assamese/Nepali) + topbar sync indicator + **Settings → Offline & Low-Network Mode** |

---

## 3. Architecture

```
                          ┌────────────────────────┐
   Field App / Web  ───▶  │   NER-LOGIX Platform    │
   (offline-capable)      │                          │
                          │  • AI risk & route engine│
   IMD Weather API  ───▶  │  • GIS accessibility layer│──▶  District Dashboards
   State PWD Road DB ───▶ │  • GPS/telematics gateway │──▶  Emergency Ops Centre
   Vehicle Telematics ──▶ │  • Alert & translation    │──▶  Field Officers (SMS/IVR)
   NDMA Disaster Feed ──▶ │    engine                 │
   BRO / ISRO Bhuvan  ──▶ │  • Cloud + offline sync   │
                          └────────────────────────┘
```

- **AI/ML route & risk engine** — scores corridors using incident density,
  terrain, weather severity and historical disruption data; ranks a
  recommended vs. alternate route with expected delay.
- **GIS layer** — MapLibre-based accessibility map, colour-coded by risk.
- **GPS/telematics** — per-vehicle tracking for essential-cargo movement.
- **Multi-channel, multilingual alerting** — App push, SMS, IVR voice call.
- **Offline-first field capture** — geo-tagged reports queue locally and
  sync automatically once connectivity returns, built for NER's
  low-network terrain.
- **Integration-ready** — designed to plug into IMD, State PWD, NDMA,
  BRO and ISRO Bhuvan feeds (shown live in Settings → Integrations).

---


