'use client';

import React from 'react';
import { ExternalLink, X, KeyRound } from 'lucide-react';

interface TokenExpiredModalProps {
  onClose: () => void;
}

export default function TokenExpiredModal({ onClose }: TokenExpiredModalProps) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <KeyRound className="h-4 w-4 text-indigo-400" />
            </div>
            <h2 className="text-sm font-semibold text-zinc-100">Token Expired</h2>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 p-1 rounded-md hover:bg-zinc-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <p className="text-sm text-zinc-400 leading-relaxed">
            Your Meta Page Access Token has expired. Generate a new token from the
            Meta Developer Explorer to resume creator data fetching.
          </p>

          <div className="bg-zinc-800/50 border border-zinc-800 rounded-lg p-4 space-y-2">
            <p className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wide">How to fix</p>
            <ol className="text-xs text-zinc-400 space-y-1.5 list-decimal list-inside leading-relaxed">
              <li>Open the <span className="text-zinc-300 font-medium">Meta Graph API Explorer</span></li>
              <li>Generate a new <span className="text-zinc-300 font-medium">Page Access Token</span></li>
              <li>Update <span className="font-mono text-zinc-300 text-[11px]">META_PAGE_ACCESS_TOKEN</span> in <span className="font-mono text-zinc-300 text-[11px]">.env.local</span></li>
              <li>Restart the dev server</li>
            </ol>
          </div>

          <div className="flex gap-3">
            <a
              href="https://developers.facebook.com/tools/explorer/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors shadow-sm shadow-indigo-950"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open Meta Explorer
            </a>
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 text-sm font-medium transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
