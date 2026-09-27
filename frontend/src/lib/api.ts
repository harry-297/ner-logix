/**
 * Backend API configuration and authenticated fetch helpers.
 *
 * The base URL was previously hardcoded as http://127.0.0.1:8000 in both
 * NERMap.tsx and RoutesPage.tsx, which meant any deployment outside a local
 * dev machine needed a code edit in two places. Set VITE_API_BASE in a .env
 * file to point somewhere else; the default keeps local development working
 * with no configuration at all.
 *
 * Auth: every data endpoint on the backend requires a bearer token, so both
 * helpers below attach the stored token automatically. Call sites never touch
 * the token themselves.
 */
export const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

/** Join the base URL and a path without doubling or dropping the slash. */
export function apiUrl(path: string): string {
  return `${API_BASE.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

const TOKEN_KEY = "ner-logix-token";

/** Fired when the backend rejects a token we sent (expired, revoked, etc.). */
export const UNAUTHORIZED_EVENT = "ner-logix:unauthorized";

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Storage unavailable (private mode, quota). The session then lasts only
    // until reload, which is a degraded experience rather than a failure.
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

/**
 * A 401 on a request that carried a token means the session is dead. Drop the
 * token and tell the app so it can return to the login page. A 401 on a
 * request with no token (a failed login attempt) is deliberately ignored --
 * that is just "wrong password", not an expired session.
 */
function handleUnauthorized(sentToken: boolean): void {
  if (!sentToken) return;
  clearToken();
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  // Declared and assigned explicitly rather than as a constructor parameter
  // property: this project builds with `erasableSyntaxOnly`, which disallows
  // the shorthand.
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * Pulls a readable message out of a FastAPI error body.
 *
 * `detail` is a plain string for errors the backend raises itself, but a list
 * of {msg, loc} objects for request-validation failures (422) -- for example a
 * password that is too short. Handling only the string case would turn those
 * into an unhelpful "Request failed (422)".
 */
function readDetail(body: unknown): string | null {
  const detail = (body as { detail?: unknown } | null)?.detail;

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => (item as { msg?: unknown })?.msg)
      .filter((msg): msg is string => typeof msg === "string");
    if (messages.length > 0) return messages.join(" ");
  }

  return null;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

/**
 * Raw fetch with the bearer token attached. Returns the Response untouched so
 * callers that already inspect `response.ok` themselves (the map) keep working.
 */
export async function authFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = getToken();
  const { headers, ...rest } = init ?? {};

  const response = await fetch(apiUrl(path), {
    ...rest,
    headers: {
      ...(headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (response.status === 401) handleUnauthorized(Boolean(token));

  return response;
}

/**
 * fetch + JSON with the error handling every caller needs.
 *
 * FastAPI puts a human-readable message in `detail`, and the backend leans on
 * that deliberately -- plan-district explains *why* no route exists (a real
 * coverage gap, not a bug) rather than returning a bare 404. Surfacing that
 * text is the difference between a useful message and "Request failed (404)".
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await authFetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const message = readDetail(await response.json());
      if (message) detail = message;
    } catch {
      // Non-JSON error body; keep the status-code message.
    }
    throw new ApiError(detail, response.status);
  }

  return (await response.json()) as T;
}
