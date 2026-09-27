import { useEffect, useMemo, useState } from "react";
import {
  Truck,
  Pill,
  Wheat,
  HardHat,
  Fuel,
  Package,
  MapPin,
  Gauge,
  Clock3,
  Radio,
  X,
} from "lucide-react";
import { vehicles, type Vehicle, type CargoType, type VehicleStatus } from "../data/mockData";
import VehicleTrackerMap from "../components/VehicleTrackerMap";
import { useVehicleTracking } from "../lib/useVehicleTracking";
import { describeLocation } from "../services/routeService";
import { PING_INTERVAL_MS, createSimulatedSource } from "../services/trackingSource";

const cargoIcon: Record<CargoType, React.ReactNode> = {
  Medicines: <Pill size={15} />,
  "Food Supplies": <Wheat size={15} />,
  "Construction Material": <HardHat size={15} />,
  "Agricultural Produce": <Package size={15} />,
  "Fuel & Essentials": <Fuel size={15} />,
};

const statusClass: Record<VehicleStatus, string> = {
  Moving: "vstat moving",
  Idle: "vstat idle",
  Delayed: "vstat delayed",
  Arrived: "vstat arrived",
  Rerouted: "vstat rerouted",
};

/** Colour of the vehicle marker and its travelled path, matching the status pills. */
const statusColor: Record<VehicleStatus, string> = {
  Moving: "#2563eb",
  Idle: "#6b7280",
  Delayed: "#d97706",
  Arrived: "#17945a",
  Rerouted: "#7c3aed",
};

/** Demo speed options: how many times faster than real time the simulated vehicle drives. */
const TIME_SCALES = [1, 10, 30] as const;

function formatEta(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 120) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function formatAgo(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)} min ago`;
}

/** Re-renders the caller every `intervalMs` so "x seconds ago" text stays fresh. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const cargoFilters: (CargoType | "All")[] = [
  "All",
  "Medicines",
  "Food Supplies",
  "Construction Material",
  "Agricultural Produce",
  "Fuel & Essentials",
];

function VehiclesPage() {
  const [cargoFilter, setCargoFilter] = useState<CargoType | "All">("All");
  const [selected, setSelected] = useState<Vehicle | null>(null);

  const filtered = useMemo(
    () =>
      cargoFilter === "All"
        ? vehicles
        : vehicles.filter((v) => v.cargo === cargoFilter),
    [cargoFilter]
  );

  const counts = useMemo(() => {
    const moving = vehicles.filter((v) => v.status === "Moving").length;
    const delayed = vehicles.filter((v) => v.status === "Delayed" || v.status === "Rerouted").length;
    const arrived = vehicles.filter((v) => v.status === "Arrived").length;
    return { moving, delayed, arrived, total: vehicles.length };
  }, []);

  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h2>Vehicle &amp; Cargo Intelligence</h2>
          <p>
            GPS-integrated tracking of essential-commodity vehicles across the
            region — medicines, food, construction material and agricultural
            produce.
          </p>
        </div>
        <div className="status">
          <span></span>
          {counts.total} vehicles under live GPS tracking
        </div>
      </div>

      <div className="stats-grid four">
        <StatMini label="Moving" value={counts.moving} tone="good" icon={<Truck size={16} />} />
        <StatMini label="Delayed / Rerouted" value={counts.delayed} tone="warn" icon={<Clock3 size={16} />} />
        <StatMini label="Arrived Today" value={counts.arrived} tone="neutral" icon={<MapPin size={16} />} />
        <StatMini label="Avg. GPS Ping" value="14s" tone="neutral" icon={<Radio size={16} />} />
      </div>

      <div className="filter-row">
        {cargoFilters.map((f) => (
          <button
            key={f}
            className={`chip-filter ${cargoFilter === f ? "active" : ""}`}
            onClick={() => setCargoFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Vehicle</th>
              <th>Cargo</th>
              <th>Route</th>
              <th>Current Location</th>
              <th>Status</th>
              <th>Progress</th>
              <th>ETA</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((v) => (
              <tr key={v.id} onClick={() => setSelected(v)} className="clickable-row">
                <td>
                  <strong>{v.id}</strong>
                  <span className="td-sub">{v.regNumber}</span>
                </td>
                <td>
                  <span className="cargo-tag">
                    {cargoIcon[v.cargo]}
                    {v.cargo}
                  </span>
                </td>
                <td>
                  {v.origin} <span className="arrow-sep">→</span> {v.destination}
                </td>
                <td>{v.currentLocation}</td>
                <td>
                  <span className={statusClass[v.status]}>{v.status}</span>
                </td>
                <td>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${v.progressPct}%` }} />
                  </div>
                  <span className="td-sub">{v.progressPct}%</span>
                </td>
                <td>{v.status === "Arrived" ? "—" : `${v.etaMinutes} min`}</td>
                <td>
                  <span className={`risk-pill ${v.riskLevel.toLowerCase()}`}>{v.riskLevel}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mvp-notice">
        <Radio size={18} />
        <div>
          <strong>Live GPS simulation</strong>
          <p>
            Positions here refresh from the vehicle telematics gateway (see
            Settings → Integrations). In this prototype build, select a vehicle
            to watch it move along its route — a new GPS ping is simulated
            every 30 seconds to demonstrate real-time tracking behaviour.
          </p>
        </div>
      </div>

      {selected && (
        <TrackingModal key={selected.id} vehicle={selected} onClose={() => setSelected(null)} />
      )}
    </section>
  );
}

function TrackingModal({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const [timeScale, setTimeScale] = useState<number>(30);

  // The simulator applies a new demo speed from the next ping, without restarting.
  const [source] = useState(() => createSimulatedSource(timeScale));
  useEffect(() => {
    source.setTimeScale(timeScale);
  }, [source, timeScale]);

  const { status, route, ping, km, startKm } = useVehicleTracking(vehicle, source);
  const now = useNow(1000);

  const totalKm = route?.totalKm ?? 0;
  const tracked = route !== null && km !== null;
  const arrived = vehicle.status === "Arrived" || (tracked && km >= totalKm - 0.05);
  const stationary = !arrived && vehicle.status === "Idle";
  const moving = !arrived && !stationary;

  const displayStatus: VehicleStatus = arrived ? "Arrived" : vehicle.status;
  const speed = arrived ? 0 : (ping?.speedKmph ?? vehicle.speedKmph);
  const remainingKm = tracked ? Math.max(0, totalKm - km) : null;
  const progressPct = tracked ? Math.round((km / totalKm) * 100) : vehicle.progressPct;
  const etaMinutes =
    arrived ? 0 : speed > 0 && remainingKm !== null ? Math.round((remainingKm / speed) * 60) : null;

  // Keep the table's own label until the vehicle has actually moved, then
  // describe the live position relative to named stops on its route.
  const hasMoved = tracked && startKm !== null && Math.abs(km - startKm) > 0.05;
  const location = tracked && hasMoved ? describeLocation(route, km) : vehicle.currentLocation;

  const lastPing = ping ? formatAgo(now - ping.timestamp) : vehicle.lastPing;
  const lat = ping?.lat ?? vehicle.gpsLat;
  const lng = ping?.lng ?? vehicle.gpsLng;

  const message =
    status === "loading"
      ? "Loading route…"
      : status === "unavailable"
        ? "No route is configured for this vehicle yet."
        : null;

  const chipTone = arrived ? "done" : stationary ? "idle" : "";
  const chipLabel = arrived ? "Arrived" : stationary ? "Stationary" : "Live";

  const minutesPerPing = (PING_INTERVAL_MS / 60_000) * timeScale;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card tracking" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>{vehicle.id}</h3>
            <span className="td-sub">{vehicle.regNumber} · {vehicle.operator}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body tracking-body">
          <VehicleTrackerMap
            route={route}
            km={km}
            color={statusColor[displayStatus]}
            moving={moving}
            message={message}
            statusChip={
              tracked && (
                <span className={`vt-chip ${chipTone}`}>
                  <span className="vt-live-dot" />
                  {chipLabel}
                  <small>· last ping {lastPing}</small>
                </span>
              )
            }
          />

          <div className="tracking-side">
            <div className="detail-grid">
              <Detail label="Driver" value={vehicle.driver} />
              <Detail label="Cargo" value={vehicle.cargo} />
              <Detail label="Origin" value={vehicle.origin} />
              <Detail label="Destination" value={vehicle.destination} />
              <Detail label="Current Location" value={location} />
              <Detail label="Status" value={displayStatus} />
              <Detail label="Speed" value={`${speed} km/h`} icon={<Gauge size={14} />} />
              <Detail label="Last GPS Ping" value={lastPing} icon={<Radio size={14} />} />
              <Detail label="ETA" value={arrived ? "Arrived" : formatEta(etaMinutes)} icon={<Clock3 size={14} />} />
              <Detail label="Corridor Risk" value={vehicle.riskLevel} />
            </div>

            <div className="progress-track lg">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="td-sub tracking-coords" style={{ marginTop: 6, marginBottom: 16 }}>
              Trip progress — {progressPct}% complete
              {remainingKm !== null && !arrived ? ` · ${Math.round(remainingKm)} km to go` : ""}
              <br />
              GPS coordinates {lat.toFixed(4)}, {lng.toFixed(4)}
            </p>

            <div className="vt-sim">
              <div className="vt-sim-head">
                <Radio size={14} /> GPS simulation
              </div>
              <p>
                A new position arrives every {PING_INTERVAL_MS / 1000} seconds. Demo speed
                compresses travel time so the movement is easy to see.
              </p>
              <div className="vt-seg" role="group" aria-label="Demo speed">
                {TIME_SCALES.map((scale) => (
                  <button
                    key={scale}
                    type="button"
                    className={timeScale === scale ? "active" : ""}
                    onClick={() => setTimeScale(scale)}
                  >
                    {scale === 1 ? "Real time" : `${scale}×`}
                  </button>
                ))}
              </div>
              <small>
                {stationary
                  ? "This vehicle is stationary, so its position will not change."
                  : arrived
                    ? "This vehicle has reached its destination."
                    : timeScale === 1
                      ? "Each ping covers 30 seconds of real driving."
                      : `Each ping covers about ${minutesPerPing} min of driving.`}
              </small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatMini({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string | number;
  tone: "good" | "warn" | "neutral";
  icon: React.ReactNode;
}) {
  return (
    <div className="stat-card mini">
      <div className={`stat-mini-icon ${tone}`}>{icon}</div>
      <div>
        <span className="stat-title">{label}</span>
        <strong className="stat-value">{value}</strong>
      </div>
    </div>
  );
}

function Detail({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="detail-item">
      <span>
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

export default VehiclesPage;
