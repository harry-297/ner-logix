import { ROLE_LABELS } from "../services/authService";
import { useAppStore } from "../store/appStore";

function ProfilePage() {
  const { user, logout } = useAppStore();

  if (!user) {
    return <div className="content">No profile available.</div>;
  }

  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h2>Profile</h2>
          <p>Account information, permissions and operational access.</p>
        </div>
      </div>

      <div className="settings-card wide">
        <div className="profile-grid">
          <div className="profile-avatar">{user.avatar}</div>
          <div className="detail-grid single">
            <Detail label="Name" value={user.name} />
            <Detail label="Role" value={ROLE_LABELS[user.role]} />
            <Detail label="Email" value={user.email} />
            <Detail label="Language" value={user.language} />
            <Detail label="Account Status" value="ACTIVE" />
          </div>
        </div>

        <button className="primary-btn" onClick={logout}>Sign out</button>
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

export default ProfilePage;
