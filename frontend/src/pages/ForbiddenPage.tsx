import { Link } from "react-router-dom";

import { ROLE_LABELS, type UserRole } from "../services/authService";
import { useAppStore } from "../store/appStore";

/** Shown when a signed-in user opens a page above their role. */
function ForbiddenPage({ required }: { required: UserRole }) {
  const { user } = useAppStore();

  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h2>Access restricted</h2>
          <p>
            This page needs the {ROLE_LABELS[required]} role or higher.
            {user ? ` Your role is ${ROLE_LABELS[user.role]}.` : ""} Ask a
            Logistics Officer if you need access.
          </p>
        </div>
      </div>

      <Link to="/live-map" className="primary-btn">
        Go to live map
      </Link>
    </section>
  );
}

export default ForbiddenPage;
