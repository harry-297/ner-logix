import { Link } from "react-router-dom";

function NotFoundPage() {
  return (
    <div className="auth-shell">
      <div className="auth-card narrow">
        <div className="auth-brand">
          <div className="logo-mark alt">N</div>
          <div>
            <h1>NER-LOGIX</h1>
            <span>Route not found</span>
          </div>
        </div>

        <div className="auth-copy">
          <h2>404 — Route not found</h2>
          <p>The requested operational view is unavailable.</p>
        </div>

        <Link to="/" className="primary-btn full-width" style={{ display: "inline-flex" }}>
          Return to Command Center
        </Link>
      </div>
    </div>
  );
}

export default NotFoundPage;
