import { useEffect, useState } from "react";
import { CheckCircle2, Search } from "lucide-react";

import { ROLE_RANK } from "../lib/access";
import { ApiError } from "../lib/api";
import {
  ROLE_LABELS,
  USER_PAGE_SIZE,
  listUsers,
  setUserRole,
  type ManagedUser,
  type UserRole,
} from "../services/authService";
import { useAppStore } from "../store/appStore";
import "./manage-users.css";

const ROLES = (Object.keys(ROLE_RANK) as UserRole[]).sort(
  (a, b) => ROLE_RANK[a] - ROLE_RANK[b],
);

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function describe(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "Can't reach the server. Check that the backend is running.";
}

function ManageUsersPage() {
  const { user: me } = useAppStore();

  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<ManagedUser[]>([]);
  // The query the current results answer. Loading is simply "the box has moved
  // on from what is on screen", which needs no state set inside the effect.
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const loading = loadedQuery !== query;
  const [error, setError] = useState("");
  // Role picked in a row's dropdown but not saved yet, keyed by user id.
  const [drafts, setDrafts] = useState<Record<string, UserRole>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  // Search the database as the officer types. The delay avoids one request per
  // keystroke; `cancelled` stops a slow earlier search overwriting a newer one.
  useEffect(() => {
    let cancelled = false;

    const timer = window.setTimeout(
      async () => {
        try {
          const data = await listUsers(query);
          if (cancelled) return;
          setUsers(data.users);
          setError("");
        } catch (err) {
          if (!cancelled) setError(describe(err));
        } finally {
          if (!cancelled) setLoadedQuery(query);
        }
      },
      query ? 300 : 0,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const saveRole = async (target: ManagedUser) => {
    const role = drafts[target.id];
    if (!role || role === target.role) return;

    setSavingId(target.id);
    setError("");

    try {
      const updated = await setUserRole(target.id, role);
      setUsers((prev) =>
        prev.map((u) => (u.id === updated.id ? { ...u, role: updated.role } : u)),
      );
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
      setNotice(`${target.name} is now a ${ROLE_LABELS[updated.role]}.`);
    } catch (err) {
      setError(describe(err));
    } finally {
      setSavingId(null);
    }
  };

  const trimmed = query.trim();

  return (
    <section className="content">
      <div className="page-heading">
        <div>
          <h2>Manage users</h2>
          <p>
            Search for an account by email and change what it can access. The
            new role applies to their next request; their menu updates when
            they next open or refresh the app.
          </p>
        </div>
      </div>

      <label className="user-search">
        <Search size={16} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by email address"
          aria-label="Search users by email address"
          autoComplete="off"
          autoFocus
        />
      </label>

      {error && (
        <div className="users-error" role="alert">
          {error}
        </div>
      )}

      <div className="users-status" aria-live="polite">
        {loading
          ? "Searching..."
          : users.length >= USER_PAGE_SIZE
            ? `Showing the first ${USER_PAGE_SIZE} accounts. Type more of the email to narrow it down.`
            : `${users.length} ${users.length === 1 ? "account" : "accounts"}`}
      </div>

      <div className="table-card users-table-scroll">
        <table className={`data-table users-table ${loading ? "is-loading" : ""}`}>
          <thead>
            <tr>
              <th>User</th>
              <th>Last sign-in</th>
              <th>Role</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === me?.id;
              const selected = drafts[u.id] ?? u.role;
              const changed = selected !== u.role;
              const saving = savingId === u.id;

              return (
                <tr key={u.id}>
                  <td>
                    <strong>{u.name}</strong>
                    <span className="td-sub">{u.email}</span>
                    {!u.is_verified && (
                      <span className="status-pill under-verification">
                        Email not verified
                      </span>
                    )}
                  </td>
                  <td>{formatDate(u.last_login_at)}</td>
                  <td>
                    {isSelf ? (
                      <span className="role-self">
                        {ROLE_LABELS[u.role]} <em>(you)</em>
                      </span>
                    ) : (
                      <select
                        value={selected}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [u.id]: event.target.value as UserRole,
                          }))
                        }
                        disabled={saving}
                        aria-label={`Role for ${u.name}`}
                      >
                        {ROLES.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="users-actions">
                    {!isSelf && (
                      <button
                        type="button"
                        className="primary-btn"
                        onClick={() => saveRole(u)}
                        disabled={!changed || saving}
                      >
                        {saving ? "Saving..." : "Save role"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!loading && users.length === 0 && (
          <div className="users-empty">
            {trimmed
              ? `No accounts match “${trimmed}”. Try a different part of the email address.`
              : "No accounts yet."}
          </div>
        )}
      </div>

      {notice && (
        <div className="toast-success" role="status">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
    </section>
  );
}

export default ManageUsersPage;
