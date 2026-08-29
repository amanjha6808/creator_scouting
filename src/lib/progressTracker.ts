/**
 * Shared in-memory progress tracker for streaming batch-operation progress
 * via Server-Sent Events (SSE).
 *
 * Each upload / analysis run gets a unique `jobId`. The server pushes
 * events to an `EventEmitter`, and the SSE GET endpoint forwards them
 * to the connected client.
 */

import { EventEmitter } from 'events';

export interface ProgressEvent {
  /** Current percentage (0–100) */
  percent: number;
  /** Human-readable status message */
  status: string;
  /** Step label, e.g. "Parsing CSV" or "Fetching Meta API Data" */
  step?: string;
  /** Total items in the batch */
  total?: number;
  /** Items processed so far */
  processed?: number;
  /** Set to `true` when the job completes (success or failure) */
  done?: boolean;
  /** Optional error message when the job fails */
  error?: string;
}

// ── Per-job event bus ──────────────────────────────────────────────────────

const jobs = new Map<string, EventEmitter>();

/**
 * Create a new job channel and return its `jobId`.
 * Call `emitProgress(jobId, …)` to push events, and `endJob(jobId)` when finished.
 */
export function createJob(providedId?: string): string {
  const jobId = providedId || crypto.randomUUID();
  const bus = new EventEmitter();
  bus.setMaxListeners(0); // unlimited listeners
  jobs.set(jobId, bus);
  return jobId;
}

/**
 * Push a progress event to all listeners of a job.
 */
export function emitProgress(
  jobId: string,
  event: ProgressEvent,
): void {
  const bus = jobs.get(jobId);
  if (bus) bus.emit('progress', event);
}

/**
 * Mark a job as done and clean up after a short grace period
 * (so the last SSE message can be delivered before listeners are removed).
 */
export function endJob(jobId: string): void {
  const bus = jobs.get(jobId);
  if (!bus) return;
  bus.emit('progress', { percent: 100, status: 'Complete', done: true });
  // Allow the SSE response to flush the final event before tearing down
  setTimeout(() => {
    bus.removeAllListeners();
    jobs.delete(jobId);
  }, 5_000);
}

/**
 * Attach a listener to a job channel. Returns a cleanup function that
 * removes the listener (call it when the SSE connection closes).
 */
export function onJobProgress(
  jobId: string,
  handler: (event: ProgressEvent) => void,
): () => void {
  const bus = jobs.get(jobId);
  if (!bus) {
    // Job may have already finished — fire a synthetic done event
    handler({ percent: 100, status: 'Complete', done: true });
    return () => {};
  }
  bus.on('progress', handler);
  return () => {
    bus.removeListener('progress', handler);
  };
}

/**
 * Helper: compute percent from processed / total.
 */
export function calcPercent(processed: number, total: number): number {
  if (total <= 0) return 100;
  return Math.round((processed / total) * 100);
}
