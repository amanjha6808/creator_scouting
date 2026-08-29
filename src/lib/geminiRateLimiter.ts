/**
 * Gemini API Rate Limiter
 *
 * Enforces a maximum of 12 requests per minute (5-second delay between calls)
 * to stay under the 15 RPM free tier cap. Implements exponential backoff
 * for 429 RESOURCE_EXHAUSTED errors.
 */

interface RateLimitInfo {
  retryDelay?: number; // seconds from API response
  retryAfter?: number; // milliseconds from Retry-After header
}

interface GeminiRateLimiterConfig {
  maxRequestsPerMinute: number;
  minDelayMs: number;
}

const DEFAULT_CONFIG: GeminiRateLimiterConfig = {
  maxRequestsPerMinute: 12,
  minDelayMs: 5000, // 5 seconds = 12 RPM
};

// In-memory queue state (per-process)
let requestTimestamps: number[] = [];
let isProcessing = false;
const pendingQueue: Array<{
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  fn: () => Promise<any>;
}> = [];

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract retry delay from Gemini 429 error
 */
function extractRetryDelay(error: any): number | null {
  // Try to get retryDelay from error details (Google GenAI format)
  if (error?.error?.details) {
    for (const detail of error.error.details) {
      if (detail['@type']?.includes('RetryInfo') && detail.retryDelay) {
        // retryDelay format: "7s" or "7.5s"
        const match = detail.retryDelay.match(/^([\d.]+)s$/);
        if (match) {
          return Math.ceil(parseFloat(match[1]) * 1000); // convert to ms
        }
      }
    }
  }

  // Try standard Retry-After header (if available in error)
  if (error?.retryAfter) {
    const retryAfter = parseInt(error.retryAfter, 10);
    if (!isNaN(retryAfter)) {
      return retryAfter * 1000; // header is in seconds
    }
  }

  // Try error.message for delay info
  if (error?.message) {
    const match = error.message.match(/retry[_\s]?delay[:\s]*([\d.]+)\s*s/i);
    if (match) {
      return Math.ceil(parseFloat(match[1]) * 1000);
    }
    const match2 = error.message.match(/wait[:\s]*([\d.]+)\s*s/i);
    if (match2) {
      return Math.ceil(parseFloat(match2[1]) * 1000);
    }
  }

  return null;
}

/**
 * Check if error is a 429 rate limit error
 */
function isRateLimitError(error: any): boolean {
  if (!error) return false;

  // Google GenAI error structure
  if (error?.error?.code === 429 || error?.status === 429) return true;
  if (error?.error?.status === 'RESOURCE_EXHAUSTED') return true;

  // Message-based detection
  const message = error?.message || error?.error?.message || '';
  if (
    message.includes('429') ||
    message.includes('RESOURCE_EXHAUSTED') ||
    message.includes('rate limit') ||
    message.includes('quota exceeded') ||
    message.includes('Too Many Requests')
  ) {
    return true;
  }

  return false;
}

/**
 * Clean old timestamps outside the sliding window
 */
function cleanOldTimestamps(windowMs: number): void {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter((ts) => now - ts < windowMs);
}

/**
 * Wait until we can make a request (rate limiting)
 */
async function waitForSlot(config: GeminiRateLimiterConfig): Promise<void> {
  const windowMs = 60_000; // 1 minute sliding window

  while (true) {
    cleanOldTimestamps(windowMs);

    if (requestTimestamps.length < config.maxRequestsPerMinute) {
      // We have a slot
      break;
    }

    // Wait until the oldest request expires
    const oldestTimestamp = requestTimestamps[0];
    const waitMs = Math.max(0, oldestTimestamp + windowMs - Date.now()) + 50; // small buffer
    await sleep(waitMs);
  }

  // Enforce minimum delay between requests
  if (requestTimestamps.length > 0) {
    const lastTimestamp = requestTimestamps[requestTimestamps.length - 1];
    const timeSinceLastRequest = Date.now() - lastTimestamp;
    if (timeSinceLastRequest < config.minDelayMs) {
      await sleep(config.minDelayMs - timeSinceLastRequest);
    }
  }
}

/**
 * Execute a function with rate limiting and exponential backoff for 429 errors
 */
export async function executeWithGeminiRateLimit<T>(
  fn: () => Promise<T>,
  config: Partial<GeminiRateLimiterConfig> = {},
): Promise<T> {
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  const maxRetries = 3;
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt <= maxRetries) {
    try {
      // Wait for rate limiter slot
      await waitForSlot(mergedConfig);

      // Record this request timestamp
      requestTimestamps.push(Date.now());

      // Execute the actual function
      const result = await fn();
      return result;
    } catch (error: any) {
      lastError = error;

      // Check if it's a rate limit error
      if (isRateLimitError(error)) {
        attempt++;

        // Extract retry delay from error, fallback to exponential backoff
        const apiRetryDelay = extractRetryDelay(error);
        const backoffDelay = apiRetryDelay ?? Math.min(1000 * Math.pow(2, attempt), 30000); // max 30s

        console.warn(
          `[Gemini Rate Limiter] 429 rate limit hit (attempt ${attempt}/${maxRetries}). ` +
            `Waiting ${Math.round(backoffDelay / 1000)}s before retry...`,
        );

        await sleep(backoffDelay);
        continue;
      }

      // Non-rate-limit error, throw immediately
      throw error;
    }
  }

  // Max retries exceeded
  throw new Error(
    `Gemini API rate limit exceeded after ${maxRetries} retries. Last error: ${lastError?.message}`,
  );
}

/**
 * Get current rate limiter status
 */
export function getGeminiRateLimiterStatus(): {
  requestsInWindow: number;
  maxRequestsPerMinute: number;
  windowMs: number;
  oldestRequestAgeMs: number | null;
} {
  cleanOldTimestamps(60_000);
  return {
    requestsInWindow: requestTimestamps.length,
    maxRequestsPerMinute: DEFAULT_CONFIG.maxRequestsPerMinute,
    windowMs: 60_000,
    oldestRequestAgeMs: requestTimestamps.length > 0 ? Date.now() - requestTimestamps[0] : null,
  };
}

/**
 * Reset rate limiter state (for testing or manual recovery)
 */
export function resetGeminiRateLimiter(): void {
  requestTimestamps = [];
  pendingQueue.length = 0;
  isProcessing = false;
}