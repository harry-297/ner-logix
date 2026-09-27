import { useEffect, useState } from "react";
import { MapPin, Camera, CheckCircle2, Upload, Clock3, History, X } from "lucide-react";

import { ApiError } from "../lib/api";
import { fileToBase64, type EncodedPhoto } from "../lib/files";
import {
  listMyFieldReports,
  submitFieldReport,
  type FieldReport,
  type FieldReportType,
} from "../services/fieldReportsService";
import { useAppStore } from "../store/appStore";

const REPORT_TYPES: FieldReportType[] = [
  "Landslide",
  "Flood",
  "Road Damage",
  "Bridge Damage",
  "Traffic",
  "Other",
];

function describe(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Can't reach the server. Check that the backend is running.";
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function FieldIntelligencePage() {
  const { connectivity, queueOfflineReport, syncOfflineReports } = useAppStore();

  const [type, setType] = useState<FieldReportType>("Landslide");
  const [location, setLocation] = useState("Pakyong, Sikkim");
  const [description, setDescription] = useState(
    "Debris and road cracks reported on the approach road before the bridge.",
  );
  const [latitude, setLatitude] = useState("27.3389");
  const [longitude, setLongitude] = useState("88.6065");
  const [photo, setPhoto] = useState<EncodedPhoto | null>(null);
  const [photoError, setPhotoError] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const [myReports, setMyReports] = useState<FieldReport[]>([]);
  const [loadingReports, setLoadingReports] = useState(true);

  const loadMyReports = async () => {
    setLoadingReports(true);
    try {
      const data = await listMyFieldReports();
      setMyReports(data.reports);
    } catch {
      // A failed refresh isn't worth blocking the form over; the submit
      // button surfaces its own errors.
    } finally {
      setLoadingReports(false);
    }
  };

  useEffect(() => {
    loadMyReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePhotoChange = async (file: File | undefined) => {
    setPhotoError("");
    if (!file) {
      setPhoto(null);
      return;
    }
    try {
      setPhoto(await fileToBase64(file));
    } catch (err) {
      setPhoto(null);
      setPhotoError(err instanceof Error ? err.message : "Could not read that photo.");
    }
  };

  const handleSubmit = async () => {
    setError("");

    if (connectivity === "OFFLINE") {
      queueOfflineReport();
      setSubmitted(true);
      return;
    }

    setSubmitting(true);
    try {
      await submitFieldReport({
        type,
        location,
        description,
        latitude: latitude ? Number(latitude) : null,
        longitude: longitude ? Number(longitude) : null,
        photo_name: photo?.name || null,
        photo_data: photo?.data || null,
        photo_mime: photo?.mime || null,
      });
      syncOfflineReports();
      setSubmitted(true);
      setPhoto(null);
      await loadMyReports();
    } catch (err) {
      setError(describe(err));
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!submitted) return;
    const timer = window.setTimeout(() => setSubmitted(false), 5000);
    return () => window.clearTimeout(timer);
  }, [submitted]);

  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h2>Field Intelligence</h2>
          <p>Capture field reports, attach evidence and queue incident updates for sync when connectivity is restored.</p>
        </div>
        <div className="status">
          <span />
          {connectivity === "OFFLINE" ? "OFFLINE MODE" : "ONLINE"}
        </div>
      </div>

      <div className="dashboard-grid two-equal">
        <div className="settings-card wide">
          <div className="settings-card-header">
            <MapPin size={17} />
            <div>
              <h3>Submit Field Incident</h3>
              <p>Capture ground truth using geotag, photo and quick local persistence</p>
            </div>
          </div>

          <div className="report-form">
            <label>
              Incident Type
              <select value={type} onChange={(e) => setType(e.target.value as FieldReportType)}>
                {REPORT_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>

            <label>
              Location
              <input value={location} onChange={(e) => setLocation(e.target.value)} />
            </label>

            <label>
              Description
              <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>

            <div className="form-row">
              <label>
                Latitude
                <input value={latitude} onChange={(e) => setLatitude(e.target.value)} />
              </label>
              <label>
                Longitude
                <input value={longitude} onChange={(e) => setLongitude(e.target.value)} />
              </label>
            </div>

            <label className="upload-field">
              Photo Upload
              <div className="upload-box">
                <Upload size={16} />
                <span>{photo?.name || "Attach evidence photo"}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => handlePhotoChange(e.target.files?.[0])}
                />
              </div>
            </label>

            {photoError && (
              <div className="users-error" role="alert">
                {photoError}
              </div>
            )}

            {photo && (
              <div className="photo-preview">
                <img src={`data:${photo.mime};base64,${photo.data}`} alt="Attached evidence preview" />
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setPhoto(null)}
                  aria-label="Remove attached photo"
                >
                  <X size={14} />
                </button>
              </div>
            )}

            {error && (
              <div className="users-error" role="alert">
                {error}
              </div>
            )}

            <button className="primary-btn full-width" onClick={handleSubmit} disabled={submitting}>
              <CheckCircle2 size={16} />
              {submitting
                ? "Submitting..."
                : connectivity === "OFFLINE"
                  ? "Save Offline"
                  : "Submit Geotagged Report"}
            </button>

            {submitted && (
              <div className="offline-sync-banner">
                <Camera size={16} />
                <span>
                  {connectivity === "OFFLINE"
                    ? "Saved offline and queued for later sync."
                    : "Submitted to the database — awaiting Field/Logistics Officer approval."}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="settings-card wide">
          <div className="settings-card-header">
            <History size={17} />
            <div>
              <h3>My Submitted Reports</h3>
              <p>Live status as a Field or Logistics Officer reviews each report</p>
            </div>
          </div>

          {loadingReports ? (
            <p className="td-sub">Loading your reports...</p>
          ) : myReports.length === 0 ? (
            <p className="td-sub">You haven't submitted any field reports yet.</p>
          ) : (
            <div className="incident-list">
              {myReports.map((r) => (
                <div className="incident-row-card" key={r.report_id}>
                  <div className="incident-row-icon">
                    <MapPin size={16} />
                  </div>
                  <div className="incident-row-main">
                    <div className="incident-row-top">
                      <strong>{r.type}</strong>
                      <span className={`status-pill ${r.status.toLowerCase()}`}>{r.status}</span>
                    </div>
                    <p>{r.description}</p>
                    <div className="incident-row-meta">
                      <span><MapPin size={12} /> {r.location}</span>
                      <span><Clock3 size={12} /> {formatWhen(r.created_at)}</span>
                      {r.has_photo && <span className="photo-tag"><Camera size={12} /> Photo attached</span>}
                    </div>
                    {r.status !== "PENDING" && r.reviewer_name && (
                      <span className="reported-by">
                        {r.status === "APPROVED" ? "Approved" : "Rejected"} by {r.reviewer_name}
                        {r.review_notes ? ` — “${r.review_notes}”` : ""}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default FieldIntelligencePage;
