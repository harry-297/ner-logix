/**
 * Client for the backend's /api/auth/* endpoints.
 *
 * Roles mirror backend/dependencies.py exactly. The UI uses them to decide
 * what to *show*; the backend is what actually enforces access.
 */
import { apiFetch } from "../lib/api";

export type UserRole = "USER" | "FIELD_OFFICER" | "LOGISTICS_OFFICER";

export const ROLE_LABELS: Record<UserRole, string> = {
  USER: "User",
  FIELD_OFFICER: "Field Officer",
  LOGISTICS_OFFICER: "Logistics Officer",
};

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

export interface MessageResponse {
  message: string;
  email?: string;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return post<AuthResponse>("/api/auth/login", { email, password });
}

export function signup(input: {
  name: string;
  email: string;
  password: string;
}): Promise<MessageResponse> {
  return post<MessageResponse>("/api/auth/signup", input);
}

export function verifySignupOtp(
  email: string,
  code: string,
): Promise<AuthResponse> {
  return post<AuthResponse>("/api/auth/verify-signup-otp", { email, code });
}

export function resendSignupOtp(email: string): Promise<MessageResponse> {
  return post<MessageResponse>("/api/auth/resend-signup-otp", { email });
}

export function forgotPassword(email: string): Promise<MessageResponse> {
  return post<MessageResponse>("/api/auth/forgot-password", { email });
}

export function resetPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<AuthResponse> {
  return post<AuthResponse>("/api/auth/reset-password", {
    email,
    code,
    new_password: newPassword,
  });
}

/** The caller's own profile. Also confirms a stored token is still valid. */
export function fetchMe(): Promise<AuthUser> {
  return apiFetch<AuthUser>("/api/auth/me");
}

// ---------------------------------------------------------------------------
// User management (Logistics Officer only -- the backend returns 403 otherwise)
// ---------------------------------------------------------------------------

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_verified: boolean;
  created_at: string | null;
  last_login_at: string | null;
}

/** Matches the backend's default page size for GET /api/auth/users. */
export const USER_PAGE_SIZE = 50;

/** Accounts whose email contains `query`; the newest accounts when it is empty. */
export function listUsers(query: string): Promise<{ users: ManagedUser[] }> {
  const trimmed = query.trim();
  const search = trimmed ? `?q=${encodeURIComponent(trimmed)}` : "";
  return apiFetch<{ users: ManagedUser[] }>(`/api/auth/users${search}`);
}

export function setUserRole(userId: string, role: UserRole): Promise<AuthUser> {
  return apiFetch<AuthUser>(
    `/api/auth/users/${encodeURIComponent(userId)}/role`,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
}
