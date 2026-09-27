/**
 * Client for the backend's /api/feedback/* endpoints.
 *
 * Any signed-in user can submit feedback and see their own. Browsing every
 * submission, the aggregate stats, and marking one reviewed/actioned
 * requires Field Officer or above (require_role(FIELD_OFFICER) on the
 * backend).
 */
import { apiFetch } from "../lib/api";

export type FeedbackCategory =
  | "Usability"
  | "Data Accuracy"
  | "Performance"
  | "Feature Request"
  | "Bug Report"
  | "Other";

export type FeedbackStatus = "NEW" | "REVIEWED" | "ACTIONED";

export const FEEDBACK_CATEGORIES: FeedbackCategory[] = [
  "Usability",
  "Data Accuracy",
  "Performance",
  "Feature Request",
  "Bug Report",
  "Other",
];

export interface Feedback {
  feedback_id: string;
  user_id: string | null;
  user_name: string;
  user_role: string | null;
  category: FeedbackCategory;
  rating: number;
  message: string;
  page_context: string | null;
  status: FeedbackStatus;
  reviewed_by: string | null;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface FeedbackInput {
  category: FeedbackCategory;
  rating: number;
  message: string;
  page_context?: string | null;
}

export interface FeedbackStatsSummary {
  total: number;
  average_rating: number | null;
  new_count: number;
  reviewed_count: number;
  actioned_count: number;
  low_rating_count: number;
}

export interface FeedbackCategoryStat {
  category: FeedbackCategory;
  count: number;
  average_rating: number | null;
}

export interface FeedbackStats {
  summary: FeedbackStatsSummary;
  by_category: FeedbackCategoryStat[];
}

export function submitFeedback(input: FeedbackInput): Promise<Feedback> {
  return apiFetch<Feedback>("/api/feedback", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function listMyFeedback(): Promise<{ count: number; feedback: Feedback[] }> {
  return apiFetch("/api/feedback/mine");
}

/** Field Officer and above only; the backend returns 403 otherwise. */
export function listFeedback(
  status?: FeedbackStatus | "All",
  category?: FeedbackCategory | "All",
): Promise<{ count: number; feedback: Feedback[] }> {
  const params = new URLSearchParams();
  if (status && status !== "All") params.set("status", status);
  if (category && category !== "All") params.set("category", category);
  const query = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/api/feedback${query}`);
}

export function fetchFeedbackStats(): Promise<FeedbackStats> {
  return apiFetch("/api/feedback/stats");
}

export function updateFeedbackStatus(
  feedbackId: string,
  status: FeedbackStatus,
  reviewNotes?: string,
): Promise<Feedback> {
  return apiFetch<Feedback>(
    `/api/feedback/${encodeURIComponent(feedbackId)}/status`,
    { method: "PATCH", body: JSON.stringify({ status, review_notes: reviewNotes || null }) },
  );
}
