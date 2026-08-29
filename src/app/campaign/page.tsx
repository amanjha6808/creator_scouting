'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Papa from 'papaparse';
import { supabase } from '@/lib/supabaseClient';
import { exportToCSV } from '@/lib/exportCsv';
import {
  Send,
  RefreshCw,
  BarChart2,
  MessageSquare,
  X,
  Upload,
  FileSpreadsheet,
  Check,
  ArrowLeft,
  Download,
  AlertTriangle,
  ExternalLink,
  Trash2,
} from 'lucide-react';
import TokenExpiredModal from '@/components/TokenExpiredModal';
import ProgressBar from '@/components/ProgressBar';

interface CreatorInput {
  username: string;
  name: string;
  profile_link: string;
}

interface CreatorData {
  id?: string;
  instagram_handle: string;
  name: string | null;
  followers_count: number | null;
  avg_engagement_rate: number | null;
  bio: string | null;
}

interface AnalysisData {
  id?: string;
  overall_relevance_score: number;
  post_evidence_reasoning: string;
}

interface EvaluationResult {
  creator: CreatorData;
  analysis: AnalysisData;
}

export default function CampaignPage() {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-zinc-500">
          <RefreshCw className="h-5 w-5 animate-spin" />
        </div>
      }
    >
      <CampaignContent />
    </React.Suspense>
  );
}

function CampaignContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const campaignIdParam = searchParams.get('id');

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [contentType, setContentType] = useState('');
  const [redFlags, setRedFlags] = useState('');

  // CSV States
  const [parsedCreators, setParsedCreators] = useState<CreatorInput[]>([]);
  const [duplicateHandles, setDuplicateHandles] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Loading & Results
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [results, setResults] = useState<EvaluationResult[]>([]);
  const [activeReasoning, setActiveReasoning] = useState<{
    handle: string;
    text: string;
    score: number;
  } | null>(null);
  const [showTokenExpired, setShowTokenExpired] = useState(false);
  const [dataHydrated, setDataHydrated] = useState(false);

  // Progress tracking
  const [progress, setProgress] = useState({
    percent: 0,
    status: '',
    step: '',
    total: 0,
    processed: 0,
  });
  const abortRef = useRef<AbortController | null>(null);

  const handleDeleteCampaign = async () => {
    try {
      if (!campaignIdParam) return;
      if (
        !confirm(
          `Delete "${title || 'this campaign'}"? This cannot be undone.`,
        )
      ) {
        return;
      }
      setIsDeleting(true);
      const res = await fetch(`/api/campaigns/${campaignIdParam}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete campaign');
      }
      router.push('/campaigns');
    } catch (err: any) {
      console.error(err);
      alert(`Error: ${err.message || err}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Fetch campaign if id is in URL search params
  useEffect(() => {
    if (campaignIdParam) {
      const activeId: string = campaignIdParam;
      async function loadExistingCampaign() {
        setIsLoading(true);
        try {
          const { data: campaignData } = await supabase
            .from('campaigns')
            .select('*')
            .eq('id', activeId)
            .single();

          if (campaignData) {
            setTitle(campaignData.title);
            setDescription(campaignData.brief_description);
            setContentType(campaignData.content_type || '');
            setRedFlags(
              campaignData.red_flags ? campaignData.red_flags.join(', ') : '',
            );
          }

          const { data: analysesData } = await supabase
            .from('analyses')
            .select(`*, creator:creators(*)`)
            .eq('campaign_id', activeId);

          if (analysesData && analysesData.length > 0) {
            const formatted: EvaluationResult[] = analysesData
              .map((item: any) => ({
                creator: item.creator,
                analysis: {
                  id: item.id,
                  overall_relevance_score: Number(
                    item.overall_relevance_score,
                  ),
                  post_evidence_reasoning: item.post_evidence_reasoning,
                },
              }))
              .sort(
                (a, b) =>
                  b.analysis.overall_relevance_score -
                  a.analysis.overall_relevance_score,
              );
            setResults(formatted);
          }
          setDataHydrated(true);
        } catch (err) {
          console.error('Error loading existing campaign:', err);
          setDataHydrated(true);
        } finally {
          setIsLoading(false);
        }
      }
      loadExistingCampaign();
    }
  }, [campaignIdParam]);

  // Helpers
  const sanitizeHandle = (input: string): string => {
    if (!input) return '';
    let cleaned = input.trim();
    if (cleaned.toLowerCase().includes('instagram.com/')) {
      try {
        const urlObj = new URL(
          cleaned.startsWith('http') ? cleaned : `https://${cleaned}`,
        );
        const pathSegments = urlObj.pathname.split('/').filter(Boolean);
        if (pathSegments.length > 0) cleaned = pathSegments[0];
      } catch {
        const parts = cleaned.split('instagram.com/');
        if (parts.length > 1) cleaned = parts[1].split('/')[0];
      }
    }
    return cleaned.replace(/^@/, '').trim();
  };

  const processCSV = (file: File) => {
    setCsvFileName(file.name);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parseResults) => {
        const list: CreatorInput[] = [];
        parseResults.data.forEach((row: any) => {
          const keys = Object.keys(row);
          const usernameKey = keys.find(
            (k) => /username|handle|ig_handle|creator/i.test(k),
          );
          const nameKey = keys.find((k) => /name|full_name/i.test(k));
          const linkKey = keys.find(
            (k) => /profile_link|link|url/i.test(k),
          );
          const rawUsername = usernameKey ? row[usernameKey] : '';
          const rawName = nameKey ? row[nameKey] : '';
          const rawLink = linkKey ? row[linkKey] : '';
          const sanitized = sanitizeHandle(rawUsername || rawLink);
          if (sanitized) {
            list.push({
              username: sanitized,
              name: (rawName || sanitized).trim(),
              profile_link: (
                rawLink ||
                `https://instagram.com/${sanitized}`
              ).trim(),
            });
          }
        });
        const seen = new Map<string, number>();
        const dupes: string[] = [];
        list.forEach((c) => {
          const count = (seen.get(c.username) || 0) + 1;
          seen.set(c.username, count);
          if (count === 2) dupes.push(c.username);
        });
        const dedupMap = new Map<string, CreatorInput>();
        list.forEach((c) => dedupMap.set(c.username, c));
        setDuplicateHandles(dupes);
        setParsedCreators(Array.from(dedupMap.values()));
      },
      error: (error) => {
        console.error('Error parsing CSV:', error);
        alert('Failed to parse CSV file.');
      },
    });
  };

  const handleDrag = (e: React.DragEvent) => {
    try {
      e.preventDefault();
      e.stopPropagation();
      if (e.type === 'dragenter' || e.type === 'dragover')
        setDragActive(true);
      else if (e.type === 'dragleave') setDragActive(false);
    } catch (err) {
      console.error('Drag event error:', err);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    try {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        processCSV(e.dataTransfer.files[0]);
      }
    } catch (err) {
      console.error('Drop event error:', err);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (e.target.files && e.target.files[0]) {
        processCSV(e.target.files[0]);
      }
    } catch (err) {
      console.error('File change error:', err);
    }
  };

  const clearCSV = () => {
    try {
      setParsedCreators([]);
      setDuplicateHandles([]);
      setCsvFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      console.error('Clear CSV error:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description || !contentType) {
      alert('Please fill out Campaign Title, Brief Description, and Content Type.');
      return;
    }
    if (parsedCreators.length === 0) {
      alert('Please upload a CSV file containing creator handles.');
      return;
    }

    setIsLoading(true);
    setResults([]);
    setProgress({
      percent: 0,
      status: 'Connecting...',
      step: 'Connecting',
      total: parsedCreators.length,
      processed: 0,
    });

    const jobId = crypto.randomUUID();
    const abortController = new AbortController();
    abortRef.current = abortController;

    const eventSource = new EventSource(
      `/api/analyze-creators-sse?jobId=${jobId}`,
    );
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        setProgress({
          percent: data.percent || 0,
          status: data.status || '',
          step: data.step || '',
          total: data.total || parsedCreators.length,
          processed: data.processed || 0,
        });
      } catch {
        /* ignore */
      }
    };
    eventSource.onerror = () => {};

    try {
      const payload = {
        title,
        brief_description: description,
        content_type: contentType,
        red_flags: redFlags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        creators: parsedCreators,
        jobId,
      };

      const response = await fetch('/api/analyze-creators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });

      const data = await response.json();

      if (data.error === 'TOKEN_EXPIRED') {
        setShowTokenExpired(true);
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || 'Analysis request failed');
      }

      if (data.success && data.results) {
        const sorted = data.results.sort(
          (a: EvaluationResult, b: EvaluationResult) =>
            b.analysis.overall_relevance_score -
            a.analysis.overall_relevance_score,
        );
        // IMMEDIATE local state update so the table populates without needing
        // a manual refresh or waiting for the /campaigns/[id] page to re-fetch.
        setResults(sorted);
        setProgress({
          percent: 100,
          status: 'Analysis complete',
          step: 'Done',
          total: sorted.length,
          processed: sorted.length,
        });

        if (data.campaignId && !campaignIdParam) {
          router.replace(`/campaign?id=${data.campaignId}`, {
            scroll: false,
          });
        }

        if (data.rateLimited) {
          window.dispatchEvent(new Event('meta-rate-limit'));
        }
      } else {
        alert('Could not retrieve analysis details.');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error(err);
        alert(`Error running analysis: ${err.message || err}`);
      }
    } finally {
      eventSource.close();
      abortRef.current = null;
      setIsLoading(false);
    }
  };

  const handleSetActiveReasoning = (r: {
    handle: string;
    text: string;
    score: number;
  } | null) => {
    try {
      setActiveReasoning(r);
    } catch (err) {
      console.error('Failed to set active reasoning:', err);
    }
  };

  const handleCloseReasoning = () => {
    try {
      setActiveReasoning(null);
    } catch (err) {
      console.error('Failed to close reasoning panel:', err);
    }
  };

  const handleExportCSV = () => {
    try {
      exportToCSV(results, title);
    } catch (err) {
      console.error('CSV export failed:', err);
    }
  };

  const getScoreStyle = (score: number) => {
    if (score >= 80)
      return 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50';
    if (score >= 50)
      return 'bg-amber-950/40 text-amber-300 border-amber-800/50';
    return 'bg-rose-950/40 text-rose-300 border-rose-800/50';
  };

  return (
    <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-8 md:py-12">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex items-center justify-between">
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Campaigns
          </Link>
          {campaignIdParam && (
            <button
              onClick={handleDeleteCampaign}
              disabled={isDeleting}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-red-400 border border-zinc-800 hover:border-red-900 px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
            >
              {isDeleting ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="h-3 w-3" />
              )}
              Delete
            </button>
          )}
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Form Section */}
          <section className="lg:col-span-5 border border-zinc-800 rounded-xl p-6 bg-zinc-900/50">
            <h2 className="text-base font-semibold text-zinc-200 mb-5">
              {campaignIdParam ? 'Campaign Details' : 'New Campaign'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="title"
                  className="block text-xs font-medium text-zinc-500 mb-1.5"
                >
                  Title *
                </label>
                <input
                  id="title"
                  type="text"
                  placeholder="e.g. Minimalist Watch Campaign"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  readOnly={!!campaignIdParam}
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors read-only:opacity-60"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="description"
                  className="block text-xs font-medium text-zinc-500 mb-1.5"
                >
                  Brief Description *
                </label>
                <textarea
                  id="description"
                  rows={3}
                  placeholder="Describe product goals, tone, and target demographic..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  readOnly={!!campaignIdParam}
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors resize-none read-only:opacity-60"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="contentType"
                  className="block text-xs font-medium text-zinc-500 mb-1.5"
                >
                  Content Type *
                </label>
                <input
                  id="contentType"
                  type="text"
                  placeholder="e.g. Fashion Lookbooks, Tech Reviews"
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value)}
                  readOnly={!!campaignIdParam}
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors read-only:opacity-60"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="redFlags"
                  className="block text-xs font-medium text-zinc-500 mb-1.5"
                >
                  Red Flags / Competitors{' '}
                  <span className="text-zinc-600">(comma-separated)</span>
                </label>
                <input
                  id="redFlags"
                  type="text"
                  placeholder="e.g. Brand X, fast fashion"
                  value={redFlags}
                  onChange={(e) => setRedFlags(e.target.value)}
                  readOnly={!!campaignIdParam}
                  className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors read-only:opacity-60"
                />
              </div>

              {/* CSV Dropzone */}
              {!campaignIdParam && (
                <div className="space-y-1.5 pt-1">
                  <label className="block text-xs font-medium text-zinc-500">
                    Creator CSV *
                  </label>
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                      dragActive
                        ? 'border-zinc-500 bg-zinc-800/30'
                        : csvFileName
                          ? 'border-zinc-700 bg-zinc-800/20'
                          : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
                    }`}
                    onDragEnter={handleDrag}
                    onDragOver={handleDrag}
                    onDragLeave={handleDrag}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                      accept=".csv"
                      className="hidden"
                    />
                    {csvFileName ? (
                      <div className="flex flex-col items-center gap-1.5">
                        <FileSpreadsheet className="h-7 w-7 text-zinc-400" />
                        <span className="text-sm font-medium text-zinc-300 truncate max-w-full">
                          {csvFileName}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            clearCSV();
                          }}
                          className="mt-1 text-xs text-zinc-500 hover:text-zinc-300 font-medium transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <Upload className="h-7 w-7 text-zinc-600" />
                        <span className="text-sm text-zinc-400">
                          Drop CSV or click to browse
                        </span>
                        <span className="text-[11px] text-zinc-600">
                          Columns: username, name, profile_link
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Parsed Creators Preview */}
              {!campaignIdParam && parsedCreators.length > 0 && (
                <div className="border border-zinc-800 rounded-lg p-3.5">
                  <div className="flex items-center justify-between text-[11px] font-medium text-zinc-500 mb-2">
                    <span>
                      {parsedCreators.length} creator
                      {parsedCreators.length !== 1 ? 's' : ''} parsed
                    </span>
                    <span className="inline-flex items-center gap-1 text-zinc-400">
                      <Check className="h-3 w-3" /> Ready
                    </span>
                  </div>

                  {duplicateHandles.length > 0 && (
                    <div className="flex items-start gap-2 bg-amber-950/30 border border-amber-800/40 rounded-md px-3 py-2 mb-2">
                      <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                      <p className="text-[11px] text-amber-400/80 leading-relaxed">
                        {duplicateHandles.length} duplicate
                        {duplicateHandles.length !== 1 ? 's' : ''} merged
                      </p>
                    </div>
                  )}

                  <div className="max-h-24 overflow-y-auto flex flex-wrap gap-1">
                    {parsedCreators.map((c, i) => (
                      <span
                        key={i}
                        className="text-[11px] border border-zinc-800 text-zinc-400 px-2 py-0.5 rounded font-mono"
                      >
                        @{c.username}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {!campaignIdParam && (
                <button
                  type="submit"
                  disabled={isLoading || parsedCreators.length === 0}
                  className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-lg text-sm transition-colors shadow-sm shadow-indigo-950 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Running Pipeline…
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Run Creator Match Assessment
                    </>
                  )}
                </button>
              )}
            </form>
          </section>

          {/* Results Section */}
          <section className="lg:col-span-7 space-y-4">
            <div className="border border-zinc-800 rounded-xl bg-zinc-900/50">
              <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
                <div className="flex items-center gap-2">
                  <BarChart2 className="h-4 w-4 text-zinc-500" />
                  <h2 className="text-sm font-semibold text-zinc-200">
                    Results
                  </h2>
                  {results.length > 0 && (
                    <span className="text-[11px] text-zinc-500 border border-zinc-800 px-1.5 py-0.5 rounded font-mono">
                      {results.length}
                    </span>
                  )}
                </div>
                {results.length > 0 && (
                  <button
                    onClick={handleExportCSV}
                    className="flex items-center gap-1.5 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    CSV
                  </button>
                )}
              </div>

              <div className="p-6">
                {isLoading && results.length === 0 ? (
                  <div className="space-y-6">
                    <ProgressBar
                      percent={progress.percent}
                      statusMessage={progress.status}
                      stepLabel={progress.step}
                    />
                    <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                      <RefreshCw className="h-6 w-6 animate-spin mb-3 text-zinc-600" />
                      <p className="text-sm font-medium text-zinc-400">
                        Running AI Pipeline…
                      </p>
                      <p className="text-xs text-zinc-600 mt-1">
                        Throttling 1.5s per creator for Meta API rate limits
                      </p>
                    </div>
                  </div>
                ) : results.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center py-16">
                    <BarChart2 className="h-6 w-6 text-zinc-700 mb-3" />
                    <h3 className="text-sm font-semibold text-zinc-300">
                      {dataHydrated
                        ? 'No Analytics Found'
                        : 'No Results Yet'}
                    </h3>
                    <p className="text-xs text-zinc-500 mt-1 max-w-xs leading-relaxed">
                      {dataHydrated
                        ? 'No analysis results exist for this campaign. Upload a CSV and run the pipeline.'
                        : 'Upload a creator CSV and submit to trigger the scoring pipeline.'}
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Desktop Table */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="border-b border-zinc-800">
                            <th className="pb-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                              Creator
                            </th>
                            <th className="pb-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider text-right">
                              Followers
                            </th>
                            <th className="pb-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider text-right">
                              ER %
                            </th>
                            <th className="pb-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider text-center">
                              Score
                            </th>
                            <th className="pb-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider text-right">
                              Evidence
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800/60">
                          {results.map((item, index) => {
                            const score =
                              item.analysis.overall_relevance_score;
                            return (
                              <tr
                                key={item.creator.id || index}
                                className="hover:bg-zinc-800/30 transition-colors"
                              >
                                <td className="py-3.5 pr-4">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-medium text-sm text-zinc-200">
                                      @{item.creator.instagram_handle}
                                    </span>
                                    <a
                                      href={`https://instagram.com/${item.creator.instagram_handle}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-zinc-600 hover:text-zinc-400"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  </div>
                                  <div className="text-xs text-zinc-500 mt-0.5">
                                    {item.creator.name || 'Creator'}
                                  </div>
                                </td>
                                <td className="py-3.5 text-right text-sm tabular-nums">
                                  <span className="text-zinc-300">
                                    {item.creator.followers_count
                                      ? item.creator.followers_count.toLocaleString()
                                      : '—'}
                                  </span>
                                </td>
                                <td className="py-3.5 text-right text-sm tabular-nums">
                                  {item.creator.avg_engagement_rate != null ? (
                                    <span className="text-sky-300 font-medium">
                                      {item.creator.avg_engagement_rate}%
                                    </span>
                                  ) : (
                                    <span className="text-zinc-500">—</span>
                                  )}
                                </td>
                                <td className="py-3.5 text-center">
                                  <span
                                    className={`inline-block px-2.5 py-0.5 rounded-md border text-xs font-semibold tabular-nums ${getScoreStyle(score)}`}
                                  >
                                    {score}
                                  </span>
                                </td>
                                <td className="py-3.5 text-right">
                                  <button
                                    onClick={() =>
                                      handleSetActiveReasoning({
                                        handle:
                                          item.creator.instagram_handle,
                                        text: item.analysis
                                          .post_evidence_reasoning,
                                        score,
                                      })
                                    }
                                    className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 font-medium border border-zinc-800 hover:border-zinc-700 px-2.5 py-1.5 rounded-md transition-colors"
                                  >
                                    <MessageSquare className="h-3 w-3" />
                                    Evidence
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Cards */}
                    <div className="md:hidden space-y-3">
                      {results.map((item, index) => {
                        const score =
                          item.analysis.overall_relevance_score;
                        return (
                          <div
                            key={item.creator.id || index}
                            className="border border-zinc-800 rounded-lg p-4 space-y-3"
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium text-sm text-zinc-200">
                                    @{item.creator.instagram_handle}
                                  </span>
                                  <a
                                    href={`https://instagram.com/${item.creator.instagram_handle}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-zinc-600 hover:text-zinc-400"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                </div>
                                <div className="text-xs text-zinc-500 mt-0.5">
                                  {item.creator.name || 'Creator'}
                                </div>
                              </div>
                              <span
                                className={`px-2 py-0.5 rounded-md border text-xs font-semibold tabular-nums ${getScoreStyle(score)}`}
                              >
                                {score}
                              </span>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-zinc-500">
                              <span>
                                <span className="text-zinc-300 font-medium">
                                  {item.creator.followers_count
                                    ? item.creator.followers_count.toLocaleString()
                                    : '—'}
                                </span>{' '}
                                followers
                              </span>
                              <span>
                                ER{' '}
                                {item.creator.avg_engagement_rate != null ? (
                                  <span className="text-sky-300 font-medium">
                                    {item.creator.avg_engagement_rate}%
                                  </span>
                                ) : (
                                  <span className="text-zinc-500">—</span>
                                )}
                              </span>
                            </div>
                            <button
                              onClick={() =>
                                handleSetActiveReasoning({
                                  handle:
                                    item.creator.instagram_handle,
                                  text: item.analysis
                                    .post_evidence_reasoning,
                                  score,
                                })
                              }
                              className="w-full inline-flex items-center justify-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 font-medium border border-zinc-800 hover:border-zinc-700 px-3 py-2 rounded-lg transition-colors"
                            >
                              <MessageSquare className="h-3 w-3" />
                              View Evidence
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Evidence Drawer */}
      {activeReasoning && (
        <div className="fixed inset-0 z-50 flex justify-end bg-zinc-950/80 backdrop-blur-sm">
          <div className="bg-zinc-900 border-l border-zinc-800 max-w-lg w-full h-full flex flex-col animate-slide-in-right">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-indigo-300 font-mono">
                    @{activeReasoning.handle}
                  </span>
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${getScoreStyle(activeReasoning.score)}`}
                  >
                    {activeReasoning.score}/100
                  </span>
                </div>
                <h3 className="text-base font-semibold text-zinc-100 mt-1">
                  Evidence &amp; Justification
                </h3>
              </div>
              <button
                onClick={handleCloseReasoning}
                className="text-zinc-500 hover:text-zinc-300 p-1 rounded-md hover:bg-zinc-800 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <div className="bg-zinc-800/30 border border-zinc-800/60 rounded-lg p-5">
                <p className="text-sm text-zinc-300 leading-relaxed whitespace-pre-line">
                  {activeReasoning.text}
                </p>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-zinc-800 flex items-center justify-between">
              <a
                href={`https://instagram.com/${activeReasoning.handle}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 font-medium transition-colors"
              >
                <ExternalLink className="h-3 w-3" /> @
                {activeReasoning.handle}
              </a>
              <button
                onClick={handleCloseReasoning}
                className="text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-md transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showTokenExpired && (
        <TokenExpiredModal onClose={() => setShowTokenExpired(false)} />
      )}
    </div>
  );
}
