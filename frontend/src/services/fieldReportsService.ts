/**
 * Client for the backend's /api/field-reports/* endpoints.
 *
 * Any signed-in user can submit a report and see their own. Seeing every
 * report and approving/rejecting one requires Field Officer or above -- the
 * backend enforces that with require_role(FIELD_OFFICER); this file just
 * mirrors the shape of what it returns.
 */
import { apiFetch } from "../lib/api";

export type FieldReportType =
  | "Landslide"
  | "Flood"
  | "Road Damage"
  | "Bridge Damage"
  | "Traffic"
  | "Other";

export type FieldReportStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface FieldReport {
  report_id: string;
  type: FieldReportType;
  location: string;
  description: string;
  latitude: number | null;
  longitude: number | null;
  photo_name: string | null;
  /** Whether a photo is stored for this report -- the base64 itself isn't in list responses, see getFieldReportPhoto. */
  has_photo: boolean;
  photo_mime: string | null;
  status: FieldReportStatus;
  reported_by: string | null;
  reporter_name: string;
  reviewed_by: string | null;
  reviewer_name: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  incident_id: string | null;
  created_at: string;
}

export interface FieldReportPhoto {
  report_id: string;
  photo_name: string | null;
  photo_mime: string;
  photo_data: string;
}

export interface FieldReportInput {
  type: FieldReportType;
  location: string;
  description?: string;
  latitude?: number | null;
  longitude?: number | null;
  photo_name?: string | null;
  /** Bare base64 (no "data:...;base64," prefix) -- see lib/files.ts fileToBase64. */
  photo_data?: string | null;
  photo_mime?: string | null;
}

export function submitFieldReport(input: FieldReportInput): Promise<FieldReport> {
  return apiFetch<FieldReport>("/api/field-reports", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Fetches one report's photo on demand. Reporter can fetch their own; Field Officer+ can fetch any. */
export function getFieldReportPhoto(reportId: string): Promise<FieldReportPhoto> {
  return apiFetch<FieldReportPhoto>(`/api/field-reports/${encodeURIComponent(reportId)}/photo`);
}

/** Builds a data: URL an <img> can use directly from a fetched photo. */
export function photoDataUrl(photo: FieldReportPhoto): string {
  return `data:${photo.photo_mime};base64,${photo.photo_data}`;
}

export function listMyFieldReports(): Promise<{ count: number; reports: FieldReport[] }> {
  return apiFetch("/api/field-reports/mine");
}

/** Field Officer and above only; the backend returns 403 otherwise. */
export function listFieldReports(
  status?: FieldReportStatus | "All",
): Promise<{ count: number; reports: FieldReport[] }> {
  const query = status && status !== "All" ? `?status=${status}` : "";
  return apiFetch(`/api/field-reports${query}`);
}

export function decideFieldReport(
  reportId: string,
  status: "APPROVED" | "REJECTED",
  reviewNotes?: string,
): Promise<FieldReport> {
  return apiFetch<FieldReport>(
    `/api/field-reports/${encodeURIComponent(reportId)}/decision`,
    { method: "PATCH", body: JSON.stringify({ status, review_notes: reviewNotes || null }) },
  );
}
