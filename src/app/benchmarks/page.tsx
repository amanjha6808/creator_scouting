'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  Database,
  Plus,
  Upload,
  Search,
  Filter,
  Trash2,
  RefreshCw,
  TrendingUp,
  Minus,
  TrendingDown,
  X,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  FileText,
  Star,
  Users,
  BarChart3,
} from 'lucide-react';
import TokenExpiredModal from '@/components/TokenExpiredModal';
import ProgressBar from '@/components/ProgressBar';

// ─── Types ───────────────────────────────────────────────────────────────────

type PerformanceTier = 'High Performer' | 'Average' | 'Flop';

interface Benchmark {
  id: string;
  created_at: string;
  creator_handle: string;
  creator_name: string | null;
  content_category: string;
  performance_tier: PerformanceTier;
  reel_url: string | null;
  performance_notes: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  engagement_rate: number | null;
  profile_link: string | null;
  commercial_cost: number | null;
  cost_per_view: number | null;
  reach_efficiency_pct: number | null;
  roi_rating: string | null;
}

interface Stats {
  total: number;
  highPerformers: number;
  average: number;
  flops: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatNumber(n: number | null | undefined): string {
  if (n == null || n === 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number | null | undefined): string {
  if (n == null || n === 0) return '—';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatCPV(n: number | null | undefined): string {
  if (n == null || n === 0) return '—';
  return `₹${n.toFixed(2)}`;
}

// ─── ROI Rating Badge ───────────────────────────────────────────────────────

type RoiRating = 'Exceptional ROI' | 'Good Value' | 'Moderate' | 'Overpriced / Underdelivered' | '';

function RoiBadge({ rating }: { rating: string | null }) {
  if (!rating) return <span className="text-zinc-600 text-[10px]">—</span>;
  const config: Record<string, { className: string }> = {
    'Exceptional ROI': { className: 'bg-emerald-950/50 text-emerald-300 border-emerald-800/60' },
    'Good Value': { className: 'bg-sky-950/50 text-sky-300 border-sky-800/60' },
    'Moderate': { className: 'bg-zinc-800/50 text-zinc-400 border-zinc-700/50' },
    'Overpriced / Underdelivered': { className: 'bg-rose-950/50 text-rose-300 border-rose-800/60' },
  };
  const { className } = config[rating] || config['Moderate'];
  return (
    <span className={`inline-flex items-center border rounded-md px-1.5 py-0.5 text-[9px] font-semibold whitespace-nowrap ${className}`}>
      {rating}
    </span>
  );
}

// ─── CPV Badge (green for good, red for expensive) ──────────────────────────

function CpvBadge({ cpv }: { cpv: number | null | undefined }) {
  if (cpv == null || cpv === 0) return <span className="text-zinc-600 text-xs tabular-nums">—</span>;
  const isGood = cpv <= 0.50;
  const isBad = cpv > 2.00;
  return (
    <span className={`text-xs tabular-nums font-medium ${
      isGood ? 'text-emerald-300' : isBad ? 'text-rose-300' : 'text-zinc-300'
    }`}>
      {formatCPV(cpv)}
    </span>
  );
}

// ─── Tier Badge ──────────────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: PerformanceTier }) {
  const config: Record<
    PerformanceTier,
    { label: string; className: string; Icon: React.ElementType }
  > = {
    'High Performer': {
      label: 'High',
      className: 'bg-indigo-950/50 text-indigo-300 border-indigo-800/60',
      Icon: TrendingUp,
    },
    Average: {
      label: 'Avg',
      className: 'bg-sky-950/50 text-sky-300 border-sky-800/60',
      Icon: Minus,
    },
    Flop: {
      label: 'Flop',
      className: 'bg-rose-950/50 text-rose-300 border-rose-800/60',
      Icon: TrendingDown,
    },
  };
  const { label, className, Icon } = config[tier];
  return (
    <span
      className={`inline-flex items-center gap-1 border rounded-md px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${className}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// ─── Truncated cell ──────────────────────────────────────────────────────────

function TruncatedCell({ text, maxLen = 28 }: { text: string | null; maxLen?: number }) {
  if (!text) return <span className="text-zinc-600">—</span>;
  const truncated = text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
  return (
    <span className="text-zinc-400 text-xs" title={text}>
      {truncated}
    </span>
  );
}

// ─── Add Creator Modal ───────────────────────────────────────────────────────

interface AddCreatorModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function AddCreatorModal({ onClose, onSuccess }: AddCreatorModalProps) {
  const [form, setForm] = useState({
    creator_handle: '',
    creator_name: '',
    content_category: '',
    performance_tier: '' as PerformanceTier | '',
    reel_url: '',
    performance_notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.creator_handle || !form.content_category || !form.performance_tier) {
      setError('Handle, category, and tier are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/benchmarks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">Add Creator</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 p-1 rounded-md hover:bg-zinc-800 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1.5">
                Handle <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                className={inputClass}
                placeholder="@username"
                value={form.creator_handle}
                onChange={(e) => setForm({ ...form, creator_handle: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-500 mb-1.5">
                Name
              </label>
              <input
                type="text"
                className={inputClass}
                placeholder="Display name"
                value={form.creator_name}
                onChange={(e) => setForm({ ...form, creator_name: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">
              Category <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              className={inputClass}
              placeholder="e.g. Fashion, Tech Reviews"
              value={form.content_category}
              onChange={(e) => setForm({ ...form, content_category: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">
              Tier <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <select
                className={`${inputClass} appearance-none cursor-pointer`}
                value={form.performance_tier}
                onChange={(e) => setForm({ ...form, performance_tier: e.target.value as PerformanceTier })}
              >
                <option value="">Select tier…</option>
                <option value="High Performer">High Performer</option>
                <option value="Average">Average</option>
                <option value="Flop">Flop</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500 pointer-events-none" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">
              Reel URL
            </label>
            <input
              type="url"
              className={inputClass}
              placeholder="https://instagram.com/reel/..."
              value={form.reel_url}
              onChange={(e) => setForm({ ...form, reel_url: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-500 mb-1.5">
              Notes
            </label>
            <textarea
              rows={3}
              className={`${inputClass} resize-none`}
              placeholder="What made this creator stand out?"
              value={form.performance_notes}
              onChange={(e) => setForm({ ...form, performance_notes: e.target.value })}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 border border-red-800/50 bg-red-950/30 rounded-lg px-3 py-2.5 text-red-300 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors shadow-sm shadow-indigo-950"
            >
              {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {saving ? 'Saving…' : 'Add Creator'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Bulk Upload Modal ───────────────────────────────────────────────────────

interface BulkUploadModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function BulkUploadModal({ onClose, onSuccess }: BulkUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ percent: 0, status: '', step: '' });
  const [result, setResult] = useState<{
    inserted?: number;
    skippedCount?: number;
    duplicatesRemoved?: number;
    autoCategorizedCount?: number;
    categoryBreakdown?: Record<string, number>;
    uniqueCategories?: number;
  } | null>(null);
  const [error, setError] = useState('');
  const [showTokenExpired, setShowTokenExpired] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.name.endsWith('.csv')) {
      setFile(dropped);
      setError('');
    } else {
      setError('Please drop a valid .csv file');
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError('');
    setResult(null);
    setProgress({ percent: 0, status: 'Connecting…', step: 'Connecting' });

    const jobId = crypto.randomUUID();
    const abortController = new AbortController();
    abortRef.current = abortController;

    const eventSource = new EventSource(`/api/benchmarks/bulk-upload-sse?jobId=${jobId}`);
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setProgress({ percent: data.percent || 0, status: data.status || '', step: data.step || '' });
      } catch {
        /* ignore */
      }
    };
    eventSource.onerror = () => {};

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('jobId', jobId);
      const res = await fetch('/api/benchmarks/bulk-upload', {
        method: 'POST',
        body: fd,
        signal: abortController.signal,
      });
      const data = await res.json();

      if (data.error === 'TOKEN_EXPIRED') {
        setError('Meta Access Token expired. Upload aborted.');
        setShowTokenExpired(true);
        return;
      }

      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setResult({
        inserted: data.inserted,
        skippedCount: data.skippedCount,
        duplicatesRemoved: data.duplicatesRemoved,
        autoCategorizedCount: data.autoCategorizedCount,
        categoryBreakdown: data.categoryBreakdown,
        uniqueCategories: data.uniqueCategories,
      });
      setProgress({ percent: 100, status: 'Complete', step: 'Done' });
      onSuccess();

      if (data.rateLimited) {
        window.dispatchEvent(new Event('meta-rate-limit'));
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || 'Something went wrong');
      }
    } finally {
      eventSource.close();
      abortRef.current = null;
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">Bulk Upload CSV</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 p-1 rounded-md hover:bg-zinc-800 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-zinc-800/50 border border-zinc-800 rounded-lg p-3.5">
            <p className="text-[11px] font-semibold text-zinc-300 mb-1.5 flex items-center gap-1.5">
              <FileText className="h-3 w-3 text-zinc-400" /> Flexible CSV Format
            </p>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Auto-detects columns for Profile Link, Reel URL, Username, Views, Likes, etc.
              Tier is auto-calculated if metrics are present.
            </p>
            <p className="text-[11px] text-zinc-500 mt-1">
              Required: a <span className="font-mono text-zinc-400">Profile Link</span>,{' '}
              <span className="font-mono text-zinc-400">URL</span>, or{' '}
              <span className="font-mono text-zinc-400">Username</span> column
            </p>
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragging
                ? 'border-zinc-500 bg-zinc-800/30'
                : file
                ? 'border-zinc-700 bg-zinc-800/20'
                : 'border-zinc-800 hover:border-zinc-700'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) { setFile(f); setError(''); }
              }}
            />
            {file ? (
              <>
                <CheckCircle className="h-8 w-8 text-zinc-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-zinc-300">{file.name}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{(file.size / 1024).toFixed(1)} KB</p>
              </>
            ) : (
              <>
                <Upload className="h-8 w-8 text-zinc-600 mx-auto mb-2" />
                <p className="text-sm text-zinc-400">Drop CSV or click to browse</p>
              </>
            )}
          </div>

          {uploading && !result && (
            <ProgressBar
              percent={progress.percent}
              statusMessage={progress.status}
              stepLabel={progress.step}
            />
          )}

          {result && (
            <div className="border border-zinc-800 bg-zinc-800/30 rounded-lg p-4">
              <p className="text-sm font-medium text-zinc-200 flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-zinc-400" /> Imported {result.inserted} creator{result.inserted !== 1 ? 's' : ''}
              </p>
              <div className="mt-1.5 space-y-0.5">
                {result.skippedCount != null && result.skippedCount > 0 && (
                  <p className="text-[11px] text-zinc-500">{result.skippedCount} row{result.skippedCount !== 1 ? 's' : ''} skipped</p>
                )}
                {result.duplicatesRemoved != null && result.duplicatesRemoved > 0 && (
                  <p className="text-[11px] text-zinc-400">{result.duplicatesRemoved} duplicate{result.duplicatesRemoved !== 1 ? 's' : ''} merged</p>
                )}
                {result.autoCategorizedCount != null && result.autoCategorizedCount > 0 && (
                  <p className="text-[11px] text-zinc-400">{result.autoCategorizedCount} auto-categorized via AI</p>
                )}
              </div>
              {result.categoryBreakdown && Object.keys(result.categoryBreakdown).length > 0 && (
                <div className="mt-2.5 pt-2.5 border-t border-zinc-800">
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(result.categoryBreakdown)
                      .sort(([, a], [, b]) => b - a)
                      .map(([cat, count]) => (
                        <span key={cat} className="text-[11px] border border-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded font-medium">
                          {cat} <span className="text-zinc-600">×{count}</span>
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {error && !showTokenExpired && (
            <div className="flex items-start gap-2 border border-red-800/50 bg-red-950/30 rounded-lg px-3 py-2.5 text-red-300 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          {showTokenExpired && (
            <div className="flex items-start gap-2 border border-amber-800/50 bg-amber-950/30 rounded-lg px-3 py-2.5 text-amber-300 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => { setShowTokenExpired(false); onClose(); }}
              className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 text-sm font-medium transition-colors"
            >
              {result || showTokenExpired ? 'Done' : 'Cancel'}
            </button>
            {!result && (
              <button
                onClick={handleUpload}
                disabled={!file || uploading}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold disabled:opacity-50 transition-colors shadow-sm shadow-indigo-950"
              >
                {uploading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? 'Uploading…' : 'Upload & Import'}
              </button>
            )}
          </div>
        </div>
      </div>

      {showTokenExpired && <TokenExpiredModal onClose={() => { setShowTokenExpired(false); onClose(); }} />}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function BenchmarksPage() {
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, highPerformers: 0, average: 0, flops: 0 });
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [recategorizing, setRecategorizing] = useState(false);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [sortBy, setSortBy] = useState('created_at');

  const [showAddModal, setShowAddModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showTokenExpired, setShowTokenExpired] = useState(false);

  const fetchBenchmarks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (categoryFilter) params.set('category', categoryFilter);
      if (tierFilter) params.set('tier', tierFilter);
      if (sortBy) params.set('sort', sortBy);
      const res = await fetch(`/api/benchmarks?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBenchmarks(data.benchmarks || []);
      setStats(data.stats || { total: 0, highPerformers: 0, average: 0, flops: 0 });
      setCategories(data.categories || []);
    } catch (err) {
      console.error('Error fetching benchmarks:', err);
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter, tierFilter, sortBy]);

  useEffect(() => {
    fetchBenchmarks();
  }, [fetchBenchmarks]);

  const allSelected = benchmarks.length > 0 && selectedIds.size === benchmarks.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < benchmarks.length;

  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set() : new Set(benchmarks.map((b) => b.id)));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected creator${selectedIds.size !== 1 ? 's' : ''}?`)) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds).join(',');
      const res = await fetch(`/api/benchmarks?ids=${encodeURIComponent(ids)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bulk delete failed');
      const deleted = new Set(selectedIds);
      setBenchmarks((prev) => prev.filter((b) => !deleted.has(b.id)));
      setStats((prev) => {
        let hp = prev.highPerformers, av = prev.average, fl = prev.flops;
        benchmarks.forEach((b) => {
          if (deleted.has(b.id)) {
            if (b.performance_tier === 'High Performer') hp--;
            else if (b.performance_tier === 'Average') av--;
            else fl--;
          }
        });
        return { total: prev.total - deleted.size, highPerformers: hp, average: av, flops: fl };
      });
      setSelectedIds(new Set());
    } catch (err: any) {
      alert(`Failed: ${err.message}`);
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleDelete = async (id: string, handle: string) => {
    if (!confirm(`Delete benchmark for @${handle}?`)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/benchmarks?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Delete failed');
      }
      const b = benchmarks.find((b) => b.id === id);
      setBenchmarks((prev) => prev.filter((b) => b.id !== id));
      setStats((prev) => ({
        ...prev,
        total: prev.total - 1,
        highPerformers: b?.performance_tier === 'High Performer' ? prev.highPerformers - 1 : prev.highPerformers,
        average: b?.performance_tier === 'Average' ? prev.average - 1 : prev.average,
        flops: b?.performance_tier === 'Flop' ? prev.flops - 1 : prev.flops,
      }));
    } catch (err: any) {
      alert(`Failed: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleRecategorize = async () => {
    if (!confirm('Re-categorize all "General" rows? This uses Gemini AI.')) return;
    setRecategorizing(true);
    try {
      const res = await fetch('/api/benchmarks/recategorize', { method: 'POST' });
      const data = await res.json();
      if (data.error === 'TOKEN_EXPIRED') { setShowTokenExpired(true); return; }
      if (!res.ok) throw new Error(data.error || 'Failed');
      alert(`Done! Updated ${data.updated} creator(s) (${data.failed} failed).`);
      fetchBenchmarks();
    } catch (err: any) {
      alert(`Failed: ${err.message}`);
    } finally {
      setRecategorizing(false);
    }
  };

  const statCards = [
    { label: 'Total', value: stats.total, icon: Users, iconClass: 'text-zinc-400', valueClass: 'text-zinc-100' },
    { label: 'High', value: stats.highPerformers, icon: TrendingUp, iconClass: 'text-emerald-400', valueClass: 'text-emerald-400' },
    { label: 'Average', value: stats.average, icon: Minus, iconClass: 'text-amber-400', valueClass: 'text-amber-400' },
    { label: 'Flops', value: stats.flops, icon: TrendingDown, iconClass: 'text-red-400', valueClass: 'text-red-400' },
  ];

  return (
    <div className="min-h-screen">
      {showAddModal && <AddCreatorModal onClose={() => setShowAddModal(false)} onSuccess={fetchBenchmarks} />}
      {showUploadModal && <BulkUploadModal onClose={() => setShowUploadModal(false)} onSuccess={fetchBenchmarks} />}
      {showTokenExpired && <TokenExpiredModal onClose={() => setShowTokenExpired(false)} />}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100">
              Benchmarks
            </h1>
            <p className="mt-1 text-sm text-zinc-500 max-w-xl">
              Log post-campaign creator performance. These feed Gold Standard references into the Gemini calibration engine.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowUploadModal(true)}
              className="inline-flex items-center gap-2 bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700 hover:bg-zinc-800 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <Upload className="h-4 w-4" /> Upload CSV
            </button>              <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors shadow-sm shadow-indigo-950"
            >
              <Plus className="h-4 w-4" /> Add Creator
            </button>
          </div>
        </header>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          {statCards.map(({ label, value, icon: Icon, iconClass, valueClass }) => (
            <div key={label} className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/50">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">{label}</p>
                <Icon className={`h-4 w-4 ${iconClass}`} />
              </div>
              <p className={`text-2xl font-bold tabular-nums ${valueClass}`}>
                {loading ? '—' : value}
              </p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" />
            <input
              type="text"
              placeholder="Search handle or category…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="pl-9 pr-8 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 appearance-none focus:outline-none focus:border-zinc-600 transition-colors cursor-pointer min-w-[160px]"
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600 pointer-events-none" />
          </div>
          <div className="relative">
            <Star className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" />
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="pl-9 pr-8 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 appearance-none focus:outline-none focus:border-zinc-600 transition-colors cursor-pointer min-w-[140px]"
            >
              <option value="">All Tiers</option>
              <option value="High Performer">High Performer</option>
              <option value="Average">Average</option>
              <option value="Flop">Flop</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600 pointer-events-none" />
          </div>            <button
              onClick={handleRecategorize}
              disabled={recategorizing}
              className="inline-flex items-center gap-2 bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700 hover:bg-zinc-800 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
            {recategorizing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
            {recategorizing ? 'Processing…' : 'Re-categorize'}
          </button>
          <div className="relative">
            <BarChart3 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-600" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="pl-9 pr-8 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-200 appearance-none focus:outline-none focus:border-zinc-600 transition-colors cursor-pointer min-w-[200px]"
            >
              <option value="created_at">Newest First</option>
              <option value="lowest_cpv">Lowest CPV (Best ROI)</option>
              <option value="highest_reach">Highest Reach %</option>
              <option value="cost_low_to_high">Cost: Low → High</option>
              <option value="overpriced">Overpriced Creators</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-600 pointer-events-none" />
          </div>
          {(search || categoryFilter || tierFilter || sortBy !== 'created_at') && (
            <button
              onClick={() => { setSearch(''); setCategoryFilter(''); setTierFilter(''); setSortBy('created_at'); }}
              className="inline-flex items-center gap-1 border border-zinc-800 text-zinc-400 hover:text-zinc-200 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>

        {/* Bulk delete */}
        {selectedIds.size > 0 && (
          <div className="mb-3 flex items-center gap-3 px-4 py-2.5 border border-red-800/50 bg-red-950/30 rounded-lg">
            <span className="text-sm text-red-300 font-medium">{selectedIds.size} selected</span>
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-500 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
            >
              {bulkDeleting ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              {bulkDeleting ? 'Deleting…' : 'Delete'}
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs text-red-400/60 hover:text-red-300 transition-colors"
            >
              Clear
            </button>
          </div>
        )}

        {/* Table */}
        <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/50">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
              <RefreshCw className="h-6 w-6 animate-spin mb-3 text-zinc-600" />
              <p className="text-sm">Loading benchmarks…</p>
            </div>
          ) : benchmarks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
              <Database className="h-6 w-6 text-zinc-700 mb-3" />
              <h3 className="text-sm font-semibold text-zinc-300 mb-1">No Benchmarks Found</h3>
              <p className="text-xs text-zinc-500 max-w-sm mb-4 leading-relaxed">
                {search || categoryFilter || tierFilter
                  ? 'No creators match your filters. Try adjusting the search.'
                  : 'Add creators manually or upload a campaign CSV to start building benchmarks.'}
              </p>
              {!search && !categoryFilter && !tierFilter && (
                <div className="flex gap-2">
                  <button onClick={() => setShowUploadModal(true)} className="inline-flex items-center gap-1.5 border border-zinc-800 text-zinc-300 px-3 py-1.5 rounded-lg text-xs font-medium hover:border-zinc-700 transition-colors">
                    <Upload className="h-3.5 w-3.5" /> Upload CSV
                  </button>
                  <button onClick={() => setShowAddModal(true)} className="inline-flex items-center gap-1.5 bg-zinc-100 text-zinc-900 font-semibold px-3 py-1.5 rounded-lg text-xs hover:bg-white transition-colors">
                    <Plus className="h-3.5 w-3.5" /> Add Creator
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="px-4 py-3 w-[36px]">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={toggleSelectAll}
                        className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-zinc-400 cursor-pointer"
                      />
                    </th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Handle</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Category</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Tier</th>
                    <th className="text-right px-3 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Views</th>
                    <th className="text-right px-3 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Likes</th>
                    <th className="text-right px-3 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Comments</th>
                    <th className="text-right px-3 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">ER %</th>
                    <th className="text-right px-3 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Cost</th>
                    <th className="text-right px-3 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">CPV</th>
                    <th className="text-right px-3 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Reach %</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">ROI</th>
                    <th className="text-center px-3 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Reel</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Notes</th>
                    <th className="text-left px-3 py-3 text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Added</th>
                    <th className="px-3 py-3 w-[40px]" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {benchmarks.map((b) => (
                    <tr
                      key={b.id}
                      className={`transition-colors group ${
                        selectedIds.has(b.id) ? 'bg-zinc-800/40' : 'hover:bg-zinc-800/20'
                      }`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(b.id)}
                          onChange={() => toggleSelect(b.id)}
                          className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-zinc-400 cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={b.profile_link || `https://instagram.com/${b.creator_handle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono font-medium text-zinc-300 hover:text-zinc-100 transition-colors text-xs"
                          title={b.creator_name || b.creator_handle}
                        >
                          @{b.creator_handle}
                        </a>
                      </td>
                      <td className="px-3 py-3">
                        <span className="border border-zinc-700/50 bg-zinc-800/70 text-zinc-300 px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap">
                          {b.content_category}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <TierBadge tier={b.performance_tier} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className="text-zinc-400 text-xs tabular-nums">{formatNumber(b.views)}</span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className="text-zinc-400 text-xs tabular-nums">{formatNumber(b.likes)}</span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className="text-zinc-400 text-xs tabular-nums">{formatNumber(b.comments)}</span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span
                          className={`text-xs tabular-nums font-medium ${
                            (b.engagement_rate ?? 0) >= 5
                              ? 'text-sky-300'
                              : (b.engagement_rate ?? 0) >= 2
                              ? 'text-sky-400/70'
                              : 'text-zinc-400'
                          }`}
                        >
                          {b.engagement_rate != null && b.engagement_rate > 0
                            ? `${b.engagement_rate.toFixed(1)}%`
                            : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className="text-zinc-400 text-xs tabular-nums">
                          {formatCost(b.commercial_cost)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <CpvBadge cpv={b.cost_per_view} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className="text-xs tabular-nums text-zinc-400">
                          {b.reach_efficiency_pct != null && b.reach_efficiency_pct > 0
                            ? `${b.reach_efficiency_pct.toFixed(0)}%`
                            : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <RoiBadge rating={b.roi_rating} />
                      </td>
                      <td className="px-3 py-3 text-center">
                        {b.reel_url ? (
                          <a
                            href={b.reel_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-400 hover:text-zinc-200 transition-colors"
                            title={b.reel_url}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : (
                          <span className="text-zinc-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <TruncatedCell text={b.performance_notes} maxLen={24} />
                      </td>
                      <td className="px-3 py-3 text-zinc-600 text-[11px] whitespace-nowrap">
                        {new Date(b.created_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="px-3 py-3">
                        <button
                          onClick={() => handleDelete(b.id, b.creator_handle)}
                          disabled={deletingId === b.id}
                          className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 p-1 rounded-md hover:bg-red-950/30 transition-all disabled:opacity-50"
                          title="Delete"
                        >
                          {deletingId === b.id ? (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-2.5 border-t border-zinc-800 text-[11px] text-zinc-600">
                Showing {benchmarks.length} creator{benchmarks.length !== 1 ? 's' : ''}
                {(search || categoryFilter || tierFilter) && ' (filtered)'}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
