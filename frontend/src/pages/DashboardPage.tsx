import { useNavigate } from "react-router-dom";
import {
  TriangleAlert,
  CloudSun,
  Satellite,
  Radio,
  Database,
} from "lucide-react";

import NERMap from "../components/NERMap";

function DashboardPage() {
  const navigate = useNavigate();

  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h2>NER Command Center</h2>
          <p>
            Real-time logistics and accessibility intelligence across the
            North Eastern Region.
          </p>
        </div>

        <div className="status">
          <span></span>
          System Operational
        </div>
      </div>

      {/* STATISTICS */}
      <div className="stats-grid">
        <StatCard
          title="Accessible Roads"
          value="1,284 km"
          change="+8.4%"
          description="vs. previous week"
        />
        <StatCard
          title="High Risk Corridors"
          value="87"
          change="+12"
          description="requiring attention"
        />
        <StatCard
          title="Active Vehicles"
          value="143"
          change="+6"
          description="currently tracked"
        />
        <StatCard
          title="Active Incidents"
          value="27"
          change="-4"
          description="reported today"
        />
      </div>

      {/* MAP + INCIDENTS */}
      <div className="dashboard-grid">
        <div className="map-card">
          <div className="card-header">
            <div>
              <h3>Regional Accessibility</h3>
              <p>Live transportation network status</p>
            </div>

            <button className="view-map" onClick={() => navigate("/routes")}>
              Plan Route →
            </button>
          </div>

          <div className="map-placeholder">
            <NERMap variant="preview" interactive={false} />
          </div>
        </div>

        <div className="incident-card">
          <div className="card-header">
            <div>
              <h3>Critical Incidents</h3>
              <p>Requires immediate attention</p>
            </div>

            <span className="incident-count">4</span>
          </div>

          <Incident type="Landslide" location="NH-10 · Sikkim" time="12 min ago" />
          <Incident type="Flood" location="Dhemaji · Assam" time="27 min ago" />
          <Incident type="Road Damage" location="NH-15 · Arunachal" time="41 min ago" />
          <Incident type="Bridge Risk" location="Imphal · Manipur" time="1 hr ago" />
        </div>
      </div>

      {/* WEATHER + EMERGENCY STRIP */}
      <div className="dashboard-grid two-equal">
        <div className="weather-card">
          <div className="card-header">
            <div>
              <h3>
                <CloudSun size={15} style={{ marginRight: 6, verticalAlign: -3 }} />
                Weather &amp; Disruption Forecast
              </h3>
              <p>IMD feed — predictive risk for the next 24-48 hrs</p>
            </div>
          </div>

          <div className="weather-grid">
            <WeatherChip state="Sikkim" condition="Heavy Rain" risk="High" />
            <WeatherChip state="Arunachal Pradesh" condition="Thunderstorms" risk="High" />
            <WeatherChip state="Assam" condition="Moderate Rain" risk="Moderate" />
            <WeatherChip state="Meghalaya" condition="Overcast" risk="Low" />
            <WeatherChip state="Manipur" condition="Light Rain" risk="Moderate" />
            <WeatherChip state="Tripura" condition="Clear" risk="Low" />
          </div>
        </div>

        <div className="emergency-card">
          <div className="card-header">
            <div>
              <h3>Emergency Accessibility</h3>
              <p>Disaster-time evacuation &amp; relief corridors</p>
            </div>
          </div>

          <EmergencyRow name="Gangtok ↔ Siliguri Relief Corridor" status="escort" />
          <EmergencyRow name="Dhemaji Flood Response Route" status="open" />
          <EmergencyRow name="Imphal ↔ Ukhrul Medical Corridor" status="open" />
          <EmergencyRow name="Bomdila Landslide Bypass" status="closed" />
        </div>
      </div>

      {/* INTEGRATIONS STRIP */}
      <div className="integrations-strip">
        <span className="integrations-strip-label">
          <Satellite size={13} /> Live data sources
        </span>
        <span className="integration-chip">
          <Radio size={12} /> GPS Telematics — Connected
        </span>
        <span className="integration-chip">
          <CloudSun size={12} /> IMD Weather API — Connected
        </span>
        <span className="integration-chip">
          <Database size={12} /> State PWD Road DB — Connected
        </span>
        <span className="integration-chip warn">
          <Satellite size={12} /> ISRO Bhuvan GIS — Degraded
        </span>
      </div>
    </section>
  );
}

function StatCard({
  title,
  value,
  change,
  description,
}: {
  title: string;
  value: string;
  change: string;
  description: string;
}) {
  return (
    <div className="stat-card">
      <span className="stat-title">{title}</span>
      <strong className="stat-value">{value}</strong>

      <div className="stat-bottom">
        <span className="stat-change">{change}</span>
        <span>{description}</span>
      </div>
    </div>
  );
}

function Incident({
  type,
  location,
  time,
}: {
  type: string;
  location: string;
  time: string;
}) {
  return (
    <div className="incident">
      <div className="incident-icon">
        <TriangleAlert size={17} />
      </div>

      <div className="incident-info">
        <strong>{type}</strong>
        <span>{location}</span>
      </div>

      <time>{time}</time>
    </div>
  );
}

function WeatherChip({
  state,
  condition,
  risk,
}: {
  state: string;
  condition: string;
  risk: "Low" | "Moderate" | "High";
}) {
  return (
    <div className="weather-chip">
      <strong>{state}</strong>
      <span>{condition}</span>
      <span className={`risk-pill ${risk.toLowerCase()}`}>{risk} risk</span>
    </div>
  );
}

function EmergencyRow({
  name,
  status,
}: {
  name: string;
  status: "open" | "escort" | "closed";
}) {
  const label = status === "open" ? "Open" : status === "escort" ? "Escort Required" : "Closed";
  const pillClass =
    status === "open" ? "resolved" : status === "closed" ? "active" : "under-verification";

  return (
    <div className="emergency-row">
      <span>{name}</span>
      <span className={`status-pill ${pillClass}`}>{label}</span>
    </div>
  );
}

export default DashboardPage;
