import { useMemo, useState } from "react";
import { Truck, Clock3, ShieldAlert, PackageCheck, AlertTriangle } from "lucide-react";
import { getShipments } from "../services/mockApi";

function SupplyTrackerPage() {
  const shipments = useMemo(() => getShipments(), []);
  const [selected, setSelected] = useState(() => shipments[0]);

  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h2>Supply Tracker</h2>
          <p>Priority logistics visibility across medicines, food, emergency supplies and essential cargo.</p>
        </div>
        <div className="status">
          <span />
          {shipments.length} active shipments
        </div>
      </div>

      <div className="stats-grid four">
        <StatCard label="Active Deliveries" value="24" tone="good" icon={<Truck size={16} />} />
        <StatCard label="On Time" value="18" tone="good" icon={<PackageCheck size={16} />} />
        <StatCard label="Delayed" value="4" tone="warn" icon={<Clock3 size={16} />} />
        <StatCard label="At Risk" value="2" tone="bad" icon={<ShieldAlert size={16} />} />
      </div>

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Shipment ID</th>
              <th>Cargo</th>
              <th>Origin</th>
              <th>Destination</th>
              <th>Status</th>
              <th>ETA</th>
              <th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {shipments.map((shipment) => (
              <tr key={shipment.id} className="clickable-row" onClick={() => setSelected(shipment)}>
                <td><strong>{shipment.id}</strong></td>
                <td>{shipment.cargo}</td>
                <td>{shipment.origin}</td>
                <td>{shipment.destination}</td>
                <td><span className={`vstat ${shipment.status.toLowerCase().replace(/\s+/g, "")}`}>{shipment.status}</span></td>
                <td>{shipment.eta}</td>
                <td><span className={`risk-pill ${shipment.risk.toLowerCase()}`}>{shipment.risk}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="map-card">
        <div className="card-header">
          <div>
            <h3>Shipment Detail</h3>
            <p>Live status and routing intelligence</p>
          </div>
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            <Detail label="Vehicle" value={selected.vehicle} />
            <Detail label="Origin" value={selected.origin} />
            <Detail label="Destination" value={selected.destination} />
            <Detail label="Current Status" value={selected.status} />
            <Detail label="ETA" value={selected.eta} />
            <Detail label="Last Update" value={selected.lastUpdate} />
          </div>
          <div className="mvp-notice">
            <AlertTriangle size={18} />
            <div>
              <strong>Vehicle movement is simulated</strong>
              <p>Routes, delays and risk states stay deterministic for demo reliability and can later be replaced by live telematics feeds.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value, tone, icon }: { label: string; value: string; tone: "good" | "warn" | "bad"; icon: React.ReactNode }) {
  return (
    <div className="stat-card mini">
      <div className={`stat-mini-icon ${tone === "good" ? "good" : tone === "warn" ? "warn" : "bad"}`}>{icon}</div>
      <div>
        <span className="stat-title">{label}</span>
        <strong className="stat-value">{value}</strong>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default SupplyTrackerPage;
