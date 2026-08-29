/**
 * Meta API Rate-Limit Circuit Breaker
 *
 * When Meta returns HTTP 403 (Application request limit reached), this module
 * immediately trips the breaker, disabling all Meta API calls for 20 minutes.
 * During this window, the analyze-creators pipeline falls back to Gemini-only
 * reasoning (mock data for profile metrics, Gemini for scoring).
 *
 * The breaker can also be manually reset via the /api/circuit-breaker endpoint.
 */

const RECOVERY_MS = 20 * 60 * 1000; // 20 minutes

let isRateLimited = false;
let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
let trippedAt: number | null = null;

/**
 * Check whether Meta API calls are currently blocked by the circuit breaker.
 */
export function isMetaCircuitOpen(): boolean {
  return isRateLimited;
}

/**
 * Get the remaining time (in ms) until the circuit breaker auto-resets.
 * Returns 0 if the breaker is not active.
 */
export function getCircuitBreakerRemainingMs(): number {
  if (!isRateLimited || !trippedAt) return 0;
  const elapsed = Date.now() - trippedAt;
  return Math.max(0, RECOVERY_MS - elapsed);
}

/**
 * Trip the circuit breaker. Called when Meta API returns HTTP 403.
 * Sets a 20-minute auto-recovery timer.
 */
export function tripCircuitBreaker(): void {
  if (isRateLimited) {
    console.warn('[Circuit Breaker] Already tripped — ignoring duplicate trip signal.');
    return;
  }

  isRateLimited = true;
  trippedAt = Date.now();

  console.warn(
    `[Circuit Breaker] Meta rate limit hit. Disabling Meta API calls for 20 minutes. ` +
    `Will auto-recover at ${new Date(trippedAt + RECOVERY_MS).toISOString()}`
  );

  // Auto-recovery timer
  recoveryTimer = setTimeout(() => {
    console.log('[Circuit Breaker] 20-minute recovery window elapsed — re-enabling Meta API calls.');
    resetCircuitBreaker();
  }, RECOVERY_MS);
}

/**
 * Manually reset the circuit breaker (admin action or auto-recovery).
 */
export function resetCircuitBreaker(): void {
  if (!isRateLimited) {
    console.log('[Circuit Breaker] Already closed — nothing to reset.');
    return;
  }

  isRateLimited = false;
  trippedAt = null;

  if (recoveryTimer) {
    clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }

  console.log('[Circuit Breaker] Manually reset — Meta API calls re-enabled.');
}

/**
 * Get current circuit breaker status for the admin endpoint.
 */
export function getCircuitBreakerStatus() {
  return {
    isOpen: isRateLimited,
    trippedAt: trippedAt ? new Date(trippedAt).toISOString() : null,
    recoveryMs: getCircuitBreakerRemainingMs(),
    recoveryAt: trippedAt ? new Date(trippedAt + RECOVERY_MS).toISOString() : null,
  };
}
