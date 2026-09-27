import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, MapPin, Clock3, Camera, ClipboardCheck } from "lucide-react";

import { ApiError } from "../lib/api";
import {
  decideFieldReport,
  getFieldReportPhoto,
  listFieldReports,
  photoDataUrl,
  type FieldReport,
  type FieldReportStatus,
} from "../services/fieldReportsService";

const statusTabs: (FieldReportStatus | "All")[] = ["PENDING", "APPROVED", "REJECTED", "All"];

function describe(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Can't reach the server. Check that the backend is running.";
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function FieldReportsReviewPage() {
  const [statusFilter, setStatusFilter] = useState<FieldReportStatus | "All">("PENDING");
  const [reports, setReports] = useState<FieldReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  const [toast, setToast] = useState("");
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [loadingPhotoId, setLoadingPhotoId] = useState<string | null>(null);

  const viewPhoto = async (reportId: string) => {
    if (photoUrls[reportId]) return; // already fetched
    setLoadingPhotoId(reportId);
    try {
      const photo = await getFieldReportPhoto(reportId);
      setPhotoUrls((prev) => ({ ...prev, [reportId]: photoDataUrl(photo) }));
    } catch (err) {
      setError(describe(err));
    } finally {
      setLoadingPhotoId(null);
    }
  };

  const load = async (status: FieldReportStatus | "All") => {
    setLoading(true);
    setError("");
    try {
      const data = await listFieldReports(status);
      setReports(data.reports);
    } catch (err) {
      setError(describe(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(statusFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const decide = async (report: FieldReport, decision: "APPROVED" | "REJECTED") => {
    setDecidingId(report.report_id);
    setError("");
    try {
      await decideFieldReport(report.report_id, decision, notesDraft[report.report_id]);
      setToast(
        decision === "APPROVED"
          ? `${report.type} report at ${report.location} approved${report.latitude != null ? " and added to Incidents." : "."}`
          : `${report.type} report at ${report.location} rejected.`,
      );
      await load(statusFilter);
    } catch (err) {
      setError(describe(err));
    } finally {
      setDecidingId(null);
    }
  };

  const pendingCount = reports.filter((r) => r.status === "PENDING").length;

  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h2>Field Report Review</h2>
          <p>
            Approve or reject geo-tagged reports submitted from Field Intelligence. Approving a
            report with coordinates adds it to Incidents and the Live Map automatically.
          </p>
        </div>
        <div className="status">
          <span />
          {statusFilter === "PENDING" ? `${pendingCount} awaiting review` : `${reports.length} reports`}
        </div>
      </div>

      <div className="filter-row">
        {statusTabs.map((t) => (
          <button
            key={t}
            className={`chip-filter ${statusFilter === t ? "active" : ""}`}
            onClick={() => setStatusFilter(t)}
          >
            {t === "All" ? "All" : t.charAt(0) + t.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {error && (
        <div className="users-error" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="td-sub">Loading field reports...</p>
      ) : reports.length === 0 ? (
        <div className="settings-card wide">
          <div className="settings-card-header">
            <ClipboardCheck size={17} />
            <div>
              <h3>Nothing here</h3>
              <p>No field reports match this filter right now.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="incident-list">
          {reports.map((r) => {
            const deciding = decidingId === r.report_id;
            return (
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
                    {r.latitude != null && r.longitude != null && (
                      <span>{r.latitude.toFixed(4)}°, {r.longitude.toFixed(4)}°</span>
                    )}
                    <span><Clock3 size={12} /> {formatWhen(r.created_at)}</span>
                  </div>
                  <span className="reported-by">Reported by {r.reporter_name}</span>

                  {r.has_photo && (
                    photoUrls[r.report_id] ? (
                      <img
                        src={photoUrls[r.report_id]}
                        alt={`Evidence for ${r.type} report at ${r.location}`}
                        className="review-photo-thumb"
                        onClick={() => window.open(photoUrls[r.report_id], "_blank")}
                      />
                    ) : (
                      <button
                        type="button"
                        className="chip-filter"
                        onClick={() => viewPhoto(r.report_id)}
                        disabled={loadingPhotoId === r.report_id}
                      >
                        <Camera size={12} />
                        {loadingPhotoId === r.report_id ? "Loading photo..." : "View attached photo"}
                      </button>
                    )
                  )}

                  {r.status !== "PENDING" && (
                    <span className="reported-by">
                      {r.status === "APPROVED" ? "Approved" : "Rejected"} by {r.reviewer_name}
                      {r.review_notes ? ` — “${r.review_notes}”` : ""}
                      {r.incident_id ? " · Added to Incidents" : ""}
                    </span>
                  )}

                  {r.status === "PENDING" && (
                    <input
                      className="review-notes-input"
                      placeholder="Optional review note..."
                      value={notesDraft[r.report_id] ?? ""}
                      onChange={(e) =>
                        setNotesDraft((prev) => ({ ...prev, [r.report_id]: e.target.value }))
                      }
                    />
                  )}
                </div>

                {r.status === "PENDING" && (
                  <div className="incident-row-actions">
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={deciding}
                      onClick={() => decide(r, "REJECTED")}
                    >
                      <XCircle size={14} /> Reject
                    </button>
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={deciding}
                      onClick={() => decide(r, "APPROVED")}
                    >
                      <CheckCircle2 size={14} /> Approve
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {toast && (
        <div className="toast-success">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
    </section>
  );
}

export default FieldReportsReviewPage;
