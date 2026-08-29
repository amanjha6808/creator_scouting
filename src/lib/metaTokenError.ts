/**
 * Shared Meta Graph API token expiry detection.
 *
 * Detects:
 *   - OAuthException with code 190 (invalid/expired token)
 *   - Subcode 463 (token expired)
 *   - HTTP 400/401 with message containing "access token"
 */

export const TOKEN_EXPIRED_ERROR = 'TOKEN_EXPIRED' as const;
export const RATE_LIMIT_ERROR = 'RATE_LIMITED' as const;

/** Promise-based sleep helper for throttling. */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Meta Rate Limit (#4) Detection ──────────────────────────────────────────

/**
 * Detect Meta Graph API Application Request Limit (code #4 / HTTP 403).
 * This is distinct from token expiry (code 190).
 */
export function isMetaRateLimitError(errorBody: any, httpStatus?: number): boolean {
  if (httpStatus === 403) return true;

  if (!errorBody) return false;
  const err = errorBody.error || errorBody;
  if (typeof err !== 'object') return false;

  // Meta code 4 = Application request limit reached
  if (err.code === 4) return true;

  const message = (err.message || '').toLowerCase();
  if (message.includes('application request limit reached') || message.includes('rate limit')) {
    return true;
  }

  return false;
}

/**
 * Check a fetch Response for Meta rate limit (HTTP 403 / code #4).
 * Returns { limited: boolean, body: any } so callers can decide on retry/fallback.
 */
export async function checkMetaResponseForRateLimit(
  response: Response,
): Promise<{ limited: boolean; body: any }> {
  if (response.status !== 403) return { limited: false, body: null };

  let body: any;
  try {
    body = await response.json();
  } catch {
    return { limited: true, body: null };
  }

  return { limited: isMetaRateLimitError(body, response.status), body };
}

export interface TokenExpiredResponse {
  error: typeof TOKEN_EXPIRED_ERROR;
  message: string;
}

/**
 * Build the standard TOKEN_EXPIRED JSON response body.
 */
export function tokenExpiredResponse(): TokenExpiredResponse {
  return {
    error: TOKEN_EXPIRED_ERROR,
    message:
      'Meta Page Access Token has expired. Please update META_PAGE_ACCESS_TOKEN.',
  };
}

/**
 * Check whether a Meta Graph API error response indicates an expired/invalid token.
 *
 * Works with both the parsed JSON error body and raw HTTP responses.
 */
export interface RateLimitedResponse {
  error: typeof RATE_LIMIT_ERROR;
  message: string;
  retryAfterMs: number;
}

/**
 * Build the standard RATE_LIMITED JSON response body.
 * The client uses retryAfterMs to decide whether to auto-retry or show the modal.
 */
export function rateLimitedResponse(retryAfterMs = 900_000): RateLimitedResponse {
  return {
    error: RATE_LIMIT_ERROR,
    message:
      'Meta API hourly request limit reached (~200 requests/hr). ' +
      'The app has switched to Gemini-only reasoning for remaining handles ' +
      'until the Meta limit resets (approx 15-30 mins).',
    retryAfterMs,
  };
}

export function isTokenExpiredError(errorBody: any): boolean {
  if (!errorBody) return false;

  // Case 1: Structured Meta error object { error: { code: 190, ... } }
  const err = errorBody.error || errorBody;
  if (typeof err === 'object') {
    // OAuthException code 190
    if (err.code === 190) return true;
    // Subcode 463 (token expired specifically)
    if (err.error_subcode === 463) return true;
    // Error subcode 463 nested
    if (err.error?.error_subcode === 463) return true;
  }

  // Case 2: Error message string containing "access token"
  const message = (
    err.message ||
    errorBody.message ||
    errorBody.error_description ||
    ''
  ).toLowerCase();

  if (message.includes('access token') && (message.includes('expired') || message.includes('invalid'))) {
    return true;
  }

  return false;
}

/**
 * Check a fetch Response for token expiry.
 * Reads the body once and returns it alongside the detection result
 * so callers don't need to re-read.
 */
export async function checkMetaResponseForTokenExpiry(
  response: Response,
): Promise<{ expired: boolean; body: any }> {
  let body: any;
  try {
    body = await response.json();
  } catch {
    return { expired: false, body: null };
  }

  // HTTP 400 or 401 from Graph API often means bad/expired token
  if (response.status === 400 || response.status === 401) {
    if (isTokenExpiredError(body)) {
      return { expired: true, body };
    }
  }

  // Also check structured error even on other status codes
  if (isTokenExpiredError(body)) {
    return { expired: true, body };
  }

  return { expired: false, body };
}
