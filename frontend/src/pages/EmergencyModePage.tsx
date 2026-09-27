import { useState } from "react";
import { Siren, ShieldAlert, Ambulance, Route } from "lucide-react";

function EmergencyModePage() {
  const [active, setActive] = useState(false);

  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h2>Emergency Mode</h2>
          <p>Toggle emergency operations to prioritize critical routes, blocked corridors and relief movement.</p>
        </div>
        <button className="primary-btn" onClick={() => setActive((value) => !value)}>
          <Siren size={16} />
          {active ? "Deactivate Emergency Mode" : "Activate Emergency Mode"}
        </button>
      </div>

      <div className="stats-grid four">
        <StatCard label="Active Emergency" value={active ? "Flood" : "None"} tone="bad" icon={<Siren size={16} />} />
        <StatCard label="Blocked Corridors" value="3" tone="warn" icon={<ShieldAlert size={16} />} />
        <StatCard label="Emergency Supply Vehicles" value="12" tone="good" icon={<Ambulance size={16} />} />
        <StatCard label="Safe Corridors" value="4" tone="good" icon={<Route size={16} />} />
      </div>

      <div className="table-card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Emergency Type</th>
              <th>Affected Area</th>
              <th>Blocked Corridors</th>
              <th>Priority Deliveries</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Flood</td>
              <td>Dhemaji, Assam</td>
              <td>SH-7, River access roads</td>
              <td>Medications, water and food logistics</td>
              <td><span className={`status-pill ${active ? "active" : "resolved"}`}>{active ? "ACTIVE" : "STANDBY"}</span></td>
            </tr>
          </tbody>
        </table>
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

export default EmergencyModePage;
