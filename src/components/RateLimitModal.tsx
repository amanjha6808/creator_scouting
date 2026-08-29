'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { X, Clock, Zap, RotateCcw } from 'lucide-react';

export default function RateLimitModal() {
  const [visible, setVisible] = useState(false);
  const [remainingMs, setRemainingMs] = useState(0);
  const [resetting, setResetting] = useState(false);

  const handleShow = useCallback(() => {
    setVisible(true);
    // Poll circuit breaker status every 10 seconds
    fetchCircuitStatus();
  }, []);

  // Poll circuit breaker status
  const fetchCircuitStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/circuit-breaker');
      const data = await res.json();
      if (data.recoveryMs) {
        setRemainingMs(data.recoveryMs);
      }
    } catch {
      // ignore
    }
  }, []);

  // Countdown timer
  useEffect(() => {
    if (!visible || remainingMs <= 0) return;
    const interval = setInterval(() => {
      setRemainingMs((prev) => {
        if (prev <= 1000) {
          // Circuit breaker recovered — auto-dismiss
          setVisible(false);
          return 0;
        }
        return prev - 1000;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [visible, remainingMs > 0]);

  // Re-fetch status periodically while visible
  useEffect(() => {
    if (!visible) return;
    const interval = setInterval(fetchCircuitStatus, 15_000);
    return () => clearInterval(interval);
  }, [visible, fetchCircuitStatus]);

  useEffect(() => {
    window.addEventListener('meta-rate-limit', handleShow);
    return () => window.removeEventListener('meta-rate-limit', handleShow);
  }, [handleShow]);

  const handleManualReset = async () => {
    setResetting(true);
    try {
      await fetch('/api/circuit-breaker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      });
      setVisible(false);
      setRemainingMs(0);
    } catch (err) {
      console.error('Failed to reset circuit breaker:', err);
    } finally {
      setResetting(false);
    }
  };

  if (!visible) return null;

  const minutes = Math.floor(remainingMs / 60_000);
  const seconds = Math.floor((remainingMs % 60_000) / 1000);
  const timeStr = remainingMs > 0
    ? `${minutes}:${String(seconds).padStart(2, '0')}`
    : '~15–30 min';

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex justify-center pt-4 px-4 pointer-events-none">
      <div
        className="pointer-events-auto w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl p-4 animate-fade-in"
        role="alert"
        aria-live="assertive"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-100">
              Meta Rate Limit — Circuit Breaker Active
            </h3>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
              Hourly limit hit (~200 req/hr). Meta API calls disabled for{' '}
              <span className="text-zinc-300 font-medium">20 minutes</span>.
              Switched to{' '}
              <span className="text-zinc-300 font-medium">Gemini-only reasoning</span> for
              remaining handles.
            </p>
            <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-500">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3 text-zinc-500" />
                Auto-recovery in {timeStr}
              </span>
              <span className="inline-flex items-center gap-1">
                <Zap className="h-3 w-3 text-indigo-400" />
                Gemini fallback active
              </span>
            </div>
            <button
              onClick={handleManualReset}
              disabled={resetting}
              className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-400 hover:text-amber-300 border border-amber-800/50 hover:border-amber-700/50 bg-amber-950/30 px-2.5 py-1 rounded-md transition-colors disabled:opacity-50"
            >
              <RotateCcw className={`h-3 w-3 ${resetting ? 'animate-spin' : ''}`} />
              {resetting ? 'Resetting…' : 'Reset Circuit Breaker (Admin)'}
            </button>
          </div>
          <button
            onClick={() => setVisible(false)}
            className="text-zinc-500 hover:text-zinc-300 p-1 rounded-md hover:bg-zinc-800 transition-colors shrink-0"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
