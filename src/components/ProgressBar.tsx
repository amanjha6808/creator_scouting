'use client';

import React from 'react';
import { RefreshCw } from 'lucide-react';

interface ProgressBarProps {
  percent: number;
  statusMessage: string;
  stepLabel?: string;
  visible?: boolean;
  className?: string;
}

export default function ProgressBar({
  percent,
  statusMessage,
  stepLabel,
  visible,
  className = '',
}: ProgressBarProps) {
  const show = visible ?? percent > 0;
  if (!show) return null;

  const clamped = Math.max(0, Math.min(100, percent));
  const isComplete = clamped >= 100;

  return (
    <div className={`w-full space-y-2 ${className}`}>
      {stepLabel && (
        <div className="flex items-center gap-2">
          {!isComplete && (
            <RefreshCw className="h-3 w-3 animate-spin text-indigo-400" />
          )}
          <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
            {stepLabel}
          </span>
        </div>
      )}

      {/* Track */}
      <div className="relative w-full h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${clamped}%` }}
        >
          <div
            className={`absolute inset-0 rounded-full ${
              isComplete
                ? 'bg-emerald-400'
                : 'progress-gradient-fill animate-progress-pulse'
            }`}
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500 truncate max-w-[80%]">
          {statusMessage}
        </span>
        <span className="text-xs font-mono text-zinc-400 tabular-nums">
          {Math.round(clamped)}%
        </span>
      </div>
    </div>
  );
}
