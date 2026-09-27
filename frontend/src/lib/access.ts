/**
 * Who can see what.
 *
 * This is the single place that maps each page to the lowest role allowed to
 * open it. Layout.tsx uses it to hide menu items and App.tsx uses it to block
 * the page itself, so the menu and the routes can never disagree.
 *
 * The frontend only decides what is *shown*. The backend enforces what is
 * *allowed* (backend/dependencies.py, require_role), because anyone can bypass
 * a hidden menu item by typing a URL or calling the API directly.
 *
 * Tiers, lowest to highest (each includes everything below it):
 *   USER               map, routes, disruption predictor, incident reporting
 *   FIELD_OFFICER      + incident verification, dashboard,
 *                        vehicles
 *   LOGISTICS_OFFICER  + admin actions and promoting users
 */
import type { UserRole } from "../services/authService";

// Mirrors ROLE_RANK in backend/dependencies.py.
export const ROLE_RANK: Record<UserRole, number> = {
  USER: 1,
  FIELD_OFFICER: 2,
  LOGISTICS_OFFICER: 3,
};

export function hasRole(
  role: UserRole | null | undefined,
  minimum: UserRole,
): boolean {
  return role != null && ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export const MIN_ROLE = {
  // Everyone
  "/live-map": "USER",
  "/routes": "USER",
  "/disruption-predictor": "USER",
  "/incidents": "USER", // reporting; confirm/resolve is gated inside the page
  "/field-intelligence": "USER", // submitting a field report is incident reporting
  "/feedback": "USER", // anyone can submit and see their own feedback
  "/alerts": "USER", // read-only warnings
  "/settings": "USER",
  "/profile": "USER",

  // Field Officer and above
  "/": "FIELD_OFFICER", // dashboard
  "/vehicles": "FIELD_OFFICER",
  "/field-reports-review": "FIELD_OFFICER", // approve/reject submitted field reports
  "/feedback-review": "FIELD_OFFICER", // browse + action all feedback

  // Logistics Officer only
  "/analytics": "LOGISTICS_OFFICER",
  "/emergency-mode": "LOGISTICS_OFFICER",
  "/manage-users": "LOGISTICS_OFFICER",
} as const satisfies Record<string, UserRole>;

export type AppPath = keyof typeof MIN_ROLE;
