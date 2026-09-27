import { useEffect, useState } from "react";
import { Star, MessageSquareText, CheckCircle2, ThumbsDown, Inbox, Layers } from "lucide-react";

import { ApiError } from "../lib/api";
import {
  fetchFeedbackStats,
  listFeedback,
  updateFeedbackStatus,
  type Feedback,
  type FeedbackStats,
  type FeedbackStatus,
} from "../services/feedbackService";

const statusTabs: (FeedbackStatus | "All")[] = ["NEW", "REVIEWED", "ACTIONED", "All"];

function describe(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Can't reach the server. Check that the backend is running.";
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function FeedbackReviewPage() {
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | "All">("NEW");
  const [items, setItems] = useState<Feedback[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const load = async (status: FeedbackStatus | "All") => {
    setLoading(true);
    setError("");
    try {
      const [list, statsData] = await Promise.all([listFeedback(status), fetchFeedbackStats()]);
      setItems(list.feedback);
      setStats(statsData);
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

  const advance = async (item: Feedback, next: FeedbackStatus) => {
    setSavingId(item.feedback_id);
    try {
      await updateFeedbackStatus(item.feedback_id, next);
      setToast(`Marked as ${next.toLowerCase()}.`);
      await load(statusFilter);
    } catch (err) {
      setError(describe(err));
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h2>Feedback Review</h2>
          <p>App feedback from every role, kept here for continuous improvement.</p>
        </div>
      </div>

      {stats && (
        <div className="stats-grid four">
          <StatMini
            label="Total Feedback"
            value={stats.summary.total}
            tone="neutral"
            icon={<Inbox size={16} />}
          />
          <StatMini
            label="Average Rating"
            value={stats.summary.average_rating != null ? stats.summary.average_rating.toFixed(2) : "—"}
            tone="good"
            icon={<Star size={16} />}
          />
          <StatMini
            label="Awaiting Review"
            value={stats.summary.new_count}
            tone="warn"
            icon={<MessageSquareText size={16} />}
          />
          <StatMini
            label="Low Ratings (≤2★)"
            value={stats.summary.low_rating_count}
            tone="warn"
            icon={<ThumbsDown size={16} />}
          />
        </div>
      )}

      {stats && stats.by_category.length > 0 && (
        <div className="settings-card wide">
          <div className="settings-card-header">
            <Layers size={17} />
            <div>
              <h3>By Category</h3>
              <p>Volume and average rating per feedback category</p>
            </div>
          </div>
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Submissions</th>
                  <th>Average Rating</th>
                </tr>
              </thead>
              <tbody>
                {stats.by_category.map((c) => (
                  <tr key={c.category}>
                    <td>{c.category}</td>
                    <td>{c.count}</td>
                    <td>{c.average_rating != null ? `${c.average_rating.toFixed(2)} ★` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
        <p className="td-sub">Loading feedback...</p>
      ) : items.length === 0 ? (
        <div className="settings-card wide">
          <div className="settings-card-header">
            <Inbox size={17} />
            <div>
              <h3>Nothing here</h3>
              <p>No feedback matches this filter right now.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="incident-list">
          {items.map((f) => {
            const saving = savingId === f.feedback_id;
            return (
              <div className="incident-row-card" key={f.feedback_id}>
                <div className="incident-row-icon">
                  <MessageSquareText size={16} />
                </div>
                <div className="incident-row-main">
                  <div className="incident-row-top">
                    <strong>{f.category}</strong>
                    <span className="star-display">
                      {"★".repeat(f.rating)}
                      {"☆".repeat(5 - f.rating)}
                    </span>
                    <span className={`status-pill ${f.status.toLowerCase()}`}>{f.status}</span>
                  </div>
                  <p>{f.message}</p>
                  <div className="incident-row-meta">
                    <span>{f.user_name}{f.user_role ? ` · ${f.user_role.replace("_", " ")}` : ""}</span>
                    {f.page_context && <span>{f.page_context}</span>}
                    <span>{formatWhen(f.created_at)}</span>
                  </div>
                  {f.review_notes && (
                    <span className="reported-by">Note: “{f.review_notes}”</span>
                  )}
                </div>

                <div className="incident-row-actions">
                  {f.status !== "REVIEWED" && (
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={saving}
                      onClick={() => advance(f, "REVIEWED")}
                    >
                      Mark reviewed
                    </button>
                  )}
                  {f.status !== "ACTIONED" && (
                    <button
                      type="button"
                      className="primary-btn"
                      disabled={saving}
                      onClick={() => advance(f, "ACTIONED")}
                    >
                      Mark actioned
                    </button>
                  )}
                </div>
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
        <span className="td-sub">{label}</span>
        <strong style={{ display: "block", fontSize: 20 }}>{value}</strong>
      </div>
    </div>
  );
}

export default FeedbackReviewPage;
