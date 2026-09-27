import { useEffect, useState } from "react";
import { MessageSquareText, Star, CheckCircle2, History } from "lucide-react";

import { ApiError } from "../lib/api";
import {
  FEEDBACK_CATEGORIES,
  listMyFeedback,
  submitFeedback,
  type Feedback,
  type FeedbackCategory,
} from "../services/feedbackService";

const PAGE_CONTEXTS = [
  "Dashboard",
  "Live Map",
  "Routes",
  "Vehicles",
  "Incidents",
  "Alerts",
  "Analytics",
  "Disruption Predictor",
  "Field Intelligence",
  "General / App-wide",
];

function describe(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Can't reach the server. Check that the backend is running.";
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function StarPicker({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="star-picker" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          className={`star-btn ${n <= value ? "filled" : ""}`}
          onClick={() => onChange(n)}
        >
          <Star size={22} fill={n <= value ? "currentColor" : "none"} />
        </button>
      ))}
    </div>
  );
}

function FeedbackPage() {
  const [category, setCategory] = useState<FeedbackCategory>("Usability");
  const [rating, setRating] = useState(4);
  const [pageContext, setPageContext] = useState(PAGE_CONTEXTS[0]);
  const [message, setMessage] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const [myFeedback, setMyFeedback] = useState<Feedback[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listMyFeedback();
      setMyFeedback(data.feedback);
    } catch {
      // Non-blocking; the form still works even if history fails to load.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleSubmit = async () => {
    setError("");
    if (!message.trim()) {
      setError("Please add a short message before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      await submitFeedback({
        category,
        rating,
        message: message.trim(),
        page_context: pageContext,
      });
      setMessage("");
      setToast("Thanks — your feedback was saved and is visible to the review team.");
      await load();
    } catch (err) {
      setError(describe(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h2>Feedback</h2>
          <p>Tell us what's working and what isn't — every submission reaches the officer review queue.</p>
        </div>
      </div>

      <div className="dashboard-grid two-equal">
        <div className="settings-card wide">
          <div className="settings-card-header">
            <MessageSquareText size={17} />
            <div>
              <h3>Share Feedback</h3>
              <p>Rate your experience and add any detail that would help us improve</p>
            </div>
          </div>

          <div className="report-form">
            <label>
              Category
              <select value={category} onChange={(e) => setCategory(e.target.value as FeedbackCategory)}>
                {FEEDBACK_CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>

            <label>
              Related Page (optional)
              <select value={pageContext} onChange={(e) => setPageContext(e.target.value)}>
                {PAGE_CONTEXTS.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>

            <label>
              Rating
              <StarPicker value={rating} onChange={setRating} />
            </label>

            <label>
              Message
              <textarea
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What went well, or what should we fix?"
              />
            </label>

            {error && (
              <div className="users-error" role="alert">
                {error}
              </div>
            )}

            <button className="primary-btn full-width" onClick={handleSubmit} disabled={submitting}>
              <CheckCircle2 size={16} />
              {submitting ? "Submitting..." : "Submit Feedback"}
            </button>
          </div>
        </div>

        <div className="settings-card wide">
          <div className="settings-card-header">
            <History size={17} />
            <div>
              <h3>My Feedback History</h3>
              <p>Status updates as the review team goes through your submissions</p>
            </div>
          </div>

          {loading ? (
            <p className="td-sub">Loading your feedback...</p>
          ) : myFeedback.length === 0 ? (
            <p className="td-sub">You haven't submitted any feedback yet.</p>
          ) : (
            <div className="incident-list">
              {myFeedback.map((f) => (
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
                      {f.page_context && <span>{f.page_context}</span>}
                      <span>{formatWhen(f.created_at)}</span>
                    </div>
                    {f.review_notes && (
                      <span className="reported-by">Officer note: “{f.review_notes}”</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div className="toast-success">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
    </section>
  );
}

export default FeedbackPage;
