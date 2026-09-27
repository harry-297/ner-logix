import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  X,
  Camera,
  MapPin,
  CheckCircle2,
  Clock3,
  Mountain,
  Waves,
  Construction,
  Milestone,
  CarFront,
  CloudRain,
  Upload,
  Loader2,
} from "lucide-react";
import {
  incidents as initialIncidents,
  type Incident,
  type IncidentStatus,
  type IncidentType,
} from "../data/mockData";
import { hasRole } from "../lib/access";
import { ROLE_LABELS } from "../services/authService";
import { useAppStore } from "../store/appStore";

const typeIcon: Record<IncidentType, React.ReactNode> = {
  Landslide: <Mountain size={16} />,
  Flood: <Waves size={16} />,
  "Road Damage": <Construction size={16} />,
  "Bridge Risk": <Milestone size={16} />,
  "Traffic Congestion": <CarFront size={16} />,
  "Heavy Rainfall": <CloudRain size={16} />,
};

const statusTabs: (IncidentStatus | "All")[] = ["All", "Active", "Under Verification", "Resolved"];

const incidentTypes: IncidentType[] = [
  "Landslide",
  "Flood",
  "Road Damage",
  "Bridge Risk",
  "Traffic Congestion",
  "Heavy Rainfall",
];

function IncidentsPage() {
  const { user } = useAppStore();
  // Anyone can report an incident; confirming or resolving one is Field Officer and above.
  const canVerify = hasRole(user?.role, "FIELD_OFFICER");

  const [incidents, setIncidents] = useState<Incident[]>(initialIncidents);
  const [statusFilter, setStatusFilter] = useState<IncidentStatus | "All">("All");
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState("");

  const filtered = useMemo(
    () =>
      statusFilter === "All"
        ? incidents
        : incidents.filter((i) => i.status === statusFilter),
    [incidents, statusFilter]
  );

  function handleSubmitReport(report: {
    type: IncidentType;
    title: string;
    description: string;
    state: string;
    district: string;
    road: string;
    hasPhoto: boolean;
  }) {
    const newIncident: Incident = {
      id: `INC-${4472 + incidents.length}`,
      type: report.type,
      severity: "Moderate",
      title: report.title,
      description: report.description,
      state: report.state,
      district: report.district,
      road: report.road || "Unnamed local road",
      source: user && canVerify ? "Field Officer" : "Citizen Report",
      status: "Under Verification",
      reportedAt: "Just now",
      hasPhoto: report.hasPhoto,
      reportedBy: user
        ? `${user.name} (${ROLE_LABELS[user.role]}, geo-tagged)`
        : "You (Field App · geo-tagged)",
    };
    setIncidents([newIncident, ...incidents]);
    setShowModal(false);
    setToast("Report submitted with geo-tag — awaiting district verification.");
    setTimeout(() => setToast(""), 4500);
  }

  function updateStatus(id: string, status: IncidentStatus, message: string) {
    setIncidents((current) =>
      current.map((incident) => (incident.id === id ? { ...incident, status } : incident)),
    );
    setToast(message);
    setTimeout(() => setToast(""), 4500);
  }

  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h2>Incident Management</h2>
          <p>
            Active road, bridge, flood and landslide incidents — reported by
            field officers, citizens, IoT sensors and satellite feeds.
          </p>
        </div>
        <button className="primary-btn" onClick={() => setShowModal(true)}>
          <Plus size={16} />
          New Field Report
        </button>
      </div>

      <div className="filter-row">
        {statusTabs.map((t) => (
          <button
            key={t}
            className={`chip-filter ${statusFilter === t ? "active" : ""}`}
            onClick={() => setStatusFilter(t)}
          >
            {t}
            {t !== "All" && (
              <span className="chip-count">
                {incidents.filter((i) => i.status === t).length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="incident-list">
        {filtered.map((inc) => (
          <div className={`incident-row-card sev-${inc.severity.toLowerCase()}`} key={inc.id}>
            <div className="incident-row-icon">{typeIcon[inc.type]}</div>

            <div className="incident-row-main">
              <div className="incident-row-top">
                <strong>{inc.title}</strong>
                <span className={`severity-pill ${inc.severity.toLowerCase()}`}>{inc.severity}</span>
                <span className={`status-pill ${inc.status.replace(/\s/g, "-").toLowerCase()}`}>
                  {inc.status}
                </span>
              </div>
              <p>{inc.description}</p>
              <div className="incident-row-meta">
                <span><MapPin size={12} /> {inc.district}, {inc.state}</span>
                <span>{inc.road}</span>
                <span>Source: {inc.source}</span>
                <span><Clock3 size={12} /> {inc.reportedAt}</span>
                {inc.hasPhoto && <span className="photo-tag"><Camera size={12} /> Photo attached</span>}
              </div>
              <span className="reported-by">Reported by {inc.reportedBy}</span>
            </div>

            {canVerify && inc.status !== "Resolved" && (
              <div className="incident-row-actions">
                {inc.status === "Under Verification" && (
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => updateStatus(inc.id, "Active", `${inc.id} confirmed as an active incident.`)}
                  >
                    Confirm
                  </button>
                )}
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => updateStatus(inc.id, "Resolved", `${inc.id} marked as resolved.`)}
                >
                  Mark resolved
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {toast && (
        <div className="toast-success">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}

      {showModal && (
        <ReportModal onClose={() => setShowModal(false)} onSubmit={handleSubmitReport} />
      )}
    </section>
  );
}

function ReportModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (r: {
    type: IncidentType;
    title: string;
    description: string;
    state: string;
    district: string;
    road: string;
    hasPhoto: boolean;
  }) => void;
}) {
  const [type, setType] = useState<IncidentType>("Landslide");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [state, setState] = useState("Assam");
  const [district, setDistrict] = useState("");
  const [road, setRoad] = useState("");
  const [photoName, setPhotoName] = useState("");
  const [locking, setLocking] = useState(true);
  const [gps] = useState({
    lat: (24 + Math.random() * 4).toFixed(4),
    lng: (89 + Math.random() * 6).toFixed(4),
  });

  useEffect(() => {
    const t = setTimeout(() => setLocking(false), 900);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>New Field Report</h3>
            <span className="td-sub">Geo-tagged incident submission</span>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          <div className="gps-lock-box">
            {locking ? (
              <>
                <Loader2 size={16} className="spin" /> Acquiring GPS location...
              </>
            ) : (
              <>
                <MapPin size={16} />
                Location locked: {gps.lat}° N, {gps.lng}° E (±6m accuracy)
              </>
            )}
          </div>

          <form
            className="report-form"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit({
                type,
                title: title || `${type} reported near ${district || "field location"}`,
                description: description || "Field officer submitted a geo-tagged incident report from a low-connectivity area.",
                state,
                district: district || "Unspecified",
                road,
                hasPhoto: !!photoName,
              });
            }}
          >
            <label>
              Incident Type
              <select value={type} onChange={(e) => setType(e.target.value as IncidentType)}>
                {incidentTypes.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>

            <label>
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Road washout near bridge approach"
              />
            </label>

            <div className="form-row">
              <label>
                State
                <select value={state} onChange={(e) => setState(e.target.value)}>
                  {["Assam", "Sikkim", "Meghalaya", "Arunachal Pradesh", "Manipur", "Mizoram", "Nagaland", "Tripura"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                District
                <input value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="e.g. West Kameng" />
              </label>
            </div>

            <label>
              Road / Corridor (optional)
              <input value={road} onChange={(e) => setRoad(e.target.value)} placeholder="e.g. NH-13" />
            </label>

            <label>
              Description
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what you're seeing on the ground..."
              />
            </label>

            <label className="upload-field">
              Photo Evidence
              <div className="upload-box">
                <Upload size={16} />
                <span>{photoName || "Tap to attach a photo (offline-safe, syncs when connected)"}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setPhotoName(e.target.files?.[0]?.name || "")}
                />
              </div>
            </label>

            <div className="offline-hint">
              This report is saved to your device immediately and will sync
              automatically once network connectivity is restored.
            </div>

            <button type="submit" className="primary-btn full-width">
              <CheckCircle2 size={16} />
              Submit Geo-Tagged Report
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default IncidentsPage;
