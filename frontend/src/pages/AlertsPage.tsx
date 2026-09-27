import { useMemo, useState } from "react";
import {
  Bell,
  Smartphone,
  MessageSquare,
  Phone,
  Languages,
  WifiOff,
  RefreshCcw,
  Ban,
  ShieldAlert,
  Clock3,
  Truck,
  CloudRain,
  MapPinOff,
} from "lucide-react";
import { alerts, SUPPORTED_LANGUAGES, type AlertCategory } from "../data/mockData";

const categoryIcon: Record<AlertCategory, React.ReactNode> = {
  "Blocked Road": <Ban size={16} />,
  "High-Risk Corridor": <ShieldAlert size={16} />,
  "Delivery Delay": <Truck size={16} />,
  "Weather Warning": <CloudRain size={16} />,
  "Region Inaccessible": <MapPinOff size={16} />,
};

const channelIcon: Record<string, React.ReactNode> = {
  "App Push": <Smartphone size={12} />,
  SMS: <MessageSquare size={12} />,
  "IVR Voice Call": <Phone size={12} />,
};

const categories: (AlertCategory | "All")[] = [
  "All",
  "Blocked Road",
  "High-Risk Corridor",
  "Delivery Delay",
  "Weather Warning",
  "Region Inaccessible",
];

function AlertsPage() {
  const [category, setCategory] = useState<AlertCategory | "All">("All");
  const [language, setLanguage] = useState("English");

  const filtered = useMemo(
    () => (category === "All" ? alerts : alerts.filter((a) => a.category === category)),
    [category]
  );

  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h2>Alerts &amp; Notifications</h2>
          <p>
            Automated multilingual alerts for blocked roads, high-risk
            corridors, delivery delays and inaccessible regions.
          </p>
        </div>
        <div className="language-switcher">
          <Languages size={15} />
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="offline-sync-banner">
        <WifiOff size={16} />
        <span>
          <strong>3 alerts</strong> queued from field zones with low
          connectivity — will auto-deliver once devices reconnect.
        </span>
        <button className="ghost-btn">
          <RefreshCcw size={13} /> Sync now
        </button>
      </div>

      <div className="filter-row">
        {categories.map((c) => (
          <button
            key={c}
            className={`chip-filter ${category === c ? "active" : ""}`}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="alerts-grid">
        {filtered.map((a) => (
          <div className={`alert-card sev-${a.severity.toLowerCase()}`} key={a.id}>
            <div className="alert-card-top">
              <span className="alert-icon">{categoryIcon[a.category]}</span>
              <span className={`severity-pill ${a.severity.toLowerCase()}`}>{a.severity}</span>
              <span className="td-sub" style={{ marginLeft: "auto" }}>
                <Clock3 size={11} style={{ marginRight: 4, verticalAlign: -2 }} />
                {a.time}
              </span>
            </div>

            <h4>{a.title}</h4>
            <p className="alert-translated">
              {a.translations[language] ?? a.translations.English}
            </p>
            <span className="alert-district"><MapPinOff size={12} /> {a.district}</span>

            <div className="alert-channels">
              {a.channels.map((c) => (
                <span key={c} className="channel-tag">
                  {channelIcon[c] ?? <Bell size={12} />}
                  {c}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mvp-notice">
        <Languages size={18} />
        <div>
          <strong>Multilingual delivery, built for low-literacy access</strong>
          <p>
            Alerts are auto-translated into regional languages (English,
            Hindi, Assamese, Nepali — with Khasi, Bodo &amp; Manipuri planned)
            and pushed across app, SMS and IVR voice-call channels so field
            teams without smartphones still receive critical warnings.
          </p>
        </div>
      </div>
    </section>
  );
}

export default AlertsPage;
