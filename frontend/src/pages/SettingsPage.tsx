import { useState } from "react";
import {
  Plug,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Languages,
  WifiOff,
  Users,
  Lock,
  Bell,
  Database,
  RefreshCcw,
} from "lucide-react";
import { integrations, SUPPORTED_LANGUAGES } from "../data/mockData";

const statusMeta: Record<string, { icon: React.ReactNode; className: string }> = {
  Connected: { icon: <CheckCircle2 size={13} />, className: "conn-ok" },
  Syncing: { icon: <Loader2 size={13} className="spin" />, className: "conn-warn" },
  Degraded: { icon: <AlertCircle size={13} />, className: "conn-bad" },
};

function Toggle({ defaultOn = true, label }: { defaultOn?: boolean; label: string }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="toggle-row">
      <span>{label}</span>
      <button className={`toggle-switch ${on ? "on" : ""}`} onClick={() => setOn(!on)}>
        <span className="toggle-knob" />
      </button>
    </div>
  );
}

function SettingsPage() {
  const [primaryLang, setPrimaryLang] = useState("English");
  const [syncInterval, setSyncInterval] = useState("15");

  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h2>System Settings</h2>
          <p>Integrations, language, offline sync, roles and data security for NER-LOGIX.</p>
        </div>
      </div>

      <div className="settings-grid">
        {/* INTEGRATIONS */}
        <div className="settings-card wide">
          <div className="settings-card-header">
            <Plug size={17} />
            <div>
              <h3>Connected Systems &amp; Data Sources</h3>
              <p>External APIs and government databases feeding the platform</p>
            </div>
          </div>

          <div className="integration-list">
            {integrations.map((i) => (
              <div className="integration-row" key={i.name}>
                <div>
                  <strong>{i.name}</strong>
                  <span className="td-sub">{i.type}</span>
                </div>
                <div className="integration-right">
                  <span className={`conn-pill ${statusMeta[i.status].className}`}>
                    {statusMeta[i.status].icon}
                    {i.status}
                  </span>
                  <span className="td-sub">Synced {i.lastSync}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* LANGUAGE */}
        <div className="settings-card">
          <div className="settings-card-header">
            <Languages size={17} />
            <div>
              <h3>Language &amp; Notifications</h3>
              <p>Multilingual alert delivery preferences</p>
            </div>
          </div>

          <label className="settings-field">
            Primary Language
            <select value={primaryLang} onChange={(e) => setPrimaryLang(e.target.value)}>
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>

          <Toggle label="App push notifications" defaultOn />
          <Toggle label="SMS alerts for field officers" defaultOn />
          <Toggle label="IVR voice-call alerts (low-literacy access)" defaultOn />
          <Toggle label="Auto-translate incoming citizen reports" defaultOn />
        </div>

        {/* OFFLINE SYNC */}
        <div className="settings-card">
          <div className="settings-card-header">
            <WifiOff size={17} />
            <div>
              <h3>Offline &amp; Low-Network Mode</h3>
              <p>Field data capture in low-connectivity districts</p>
            </div>
          </div>

          <label className="settings-field">
            Auto-sync interval when reconnected
            <select value={syncInterval} onChange={(e) => setSyncInterval(e.target.value)}>
              <option value="5">Every 5 minutes</option>
              <option value="15">Every 15 minutes</option>
              <option value="30">Every 30 minutes</option>
            </select>
          </label>

          <Toggle label="Cache maps for offline field use" defaultOn />
          <Toggle label="Queue photo evidence until on Wi-Fi" defaultOn />
          <Toggle label="Compress reports on 2G / 3G networks" defaultOn />

          <button className="ghost-btn full-width">
            <RefreshCcw size={13} /> Force sync now
          </button>
        </div>

        {/* ROLES */}
        <div className="settings-card">
          <div className="settings-card-header">
            <Users size={17} />
            <div>
              <h3>User Roles &amp; Access</h3>
              <p>Role-based access across the control hierarchy</p>
            </div>
          </div>

          <div className="role-list">
            <div className="role-row"><span className="role-badge admin">Logistics Officer</span><span>Everything below, plus analytics, admin actions and promoting users</span></div>
            <div className="role-row"><span className="role-badge district">Field Officer</span><span>Incident verification, dashboard, vehicles</span></div>
            <div className="role-row"><span className="role-badge field">User</span><span>Live map, route planning, disruption predictor, incident reporting</span></div>
          </div>
        </div>

        {/* SECURITY */}
        <div className="settings-card">
          <div className="settings-card-header">
            <Lock size={17} />
            <div>
              <h3>Data &amp; Security</h3>
              <p>Encryption, backups and audit trail</p>
            </div>
          </div>

          <Toggle label="End-to-end encrypted field reports" defaultOn />
          <Toggle label="Role-based data access control" defaultOn />
          <Toggle label="Full audit log of all edits" defaultOn />
          <div className="toggle-row">
            <span>
              <Database size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
              Cloud backup
            </span>
            <span className="conn-pill conn-ok"><CheckCircle2 size={13} /> Every 6 hours</span>
          </div>
        </div>

        {/* ABOUT */}
        <div className="settings-card">
          <div className="settings-card-header">
            <Bell size={17} />
            <div>
              <h3>Platform Info</h3>
              <p>NER-LOGIX build details</p>
            </div>
          </div>
          <div className="detail-grid single">
            <Detail label="Version" value="v0.9.0 — SIH Prototype" />
            <Detail label="Environment" value="Staging / Demo" />
            <Detail label="Region Coverage" value="8 NER States, 60+ Districts" />
            <Detail label="Deployment Target" value="Cloud (multi-AZ) + Edge caching" />
          </div>
        </div>
      </div>
    </section>
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

export default SettingsPage;
