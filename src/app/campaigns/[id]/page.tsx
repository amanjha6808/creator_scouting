'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  RefreshCw,
  BarChart2,
  MessageSquare,
  ExternalLink,
  Calendar,
  AlertTriangle,
  Download,
  RotateCcw,
  CheckCircle2,
  Save,
} from 'lucide-react';
import { exportToCSV } from '@/lib/exportCsv';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CreatorData {
  id: string;
  instagram_handle: string;
  name: string | null;
  followers_count: number | null;
  avg_engagement_rate: number | null;
  bio: string | null;
}

interface AnalysisData {
  id: string;
  overall_relevance_score: number;
  post_evidence_reasoning: string;
  created_at: string;
}

interface EvaluationResult {
  creator: CreatorData;
  analysis: AnalysisData;
}

interface CampaignData {
  id: string;
  created_at: string;
  title: string;
  brief_description: string;
  content_type: string;
  red_flags: string[] | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getScoreStyle(score: number): string {
  if (score >= 80) return 'bg-emerald-950/40 text-emerald-300 border-emerald-800/50';
  if (score >= 50) return 'bg-amber-950/40 text-amber-300 border-amber-800/50';
  return 'bg-rose-950/40 text-rose-300 border-rose-800/50';
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function CampaignDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params?.id as string | undefined;

  const [campaign, setCampaign] = useState<CampaignData | null>(null);
  const [results, setResults] = useState<EvaluationResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeReasoning, setActiveReasoning] = useState<{
    handle: string;
    text: string;
    score: number;
  } | null>(null);

  // ── Editable form state ───────────────────────────────────────────────────
  const [formTitle, setFormTitle] = useState('');
  const [formBrief, setFormBrief] = useState('');
  const [formContentType, setFormContentType] = useState('');
  const [formRedFlags, setFormRedFlags] = useState('');
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [lastScoredAt, setLastScoredAt] = useState<string | null>(null);
  const [formSaved, setFormSaved] = useState(false);

  // ── Hydrate via server API route (bypasses browser RLS) ──────────────────
  // In Next.js 15+, useParams() can resolve to undefined on the initial render.
  // Guard against that (and the literal string 'undefined') so we never fire a
  // fetch with an invalid id — which previously returned a 400 and left the
  // page stuck on the "No Analytics Found" empty state.
  useEffect(() => {
    if (!campaignId || campaignId === 'undefined') return;

    async function loadCampaignData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/campaigns/${campaignId}`);
        const data = await res.json();

        if (!res.ok) {
          console.error('[CampaignDetails] API error:', data.error || `HTTP ${res.status}`);
          setError(data.error || 'Failed to load campaign details.');
          return;
        }

        if (data.campaign) {
          const c = data.campaign as CampaignData;
          setCampaign(c);
          setFormTitle(c.title || '');
          setFormBrief(c.brief_description || '');
          setFormContentType(c.content_type || '');
          setFormRedFlags((c.red_flags || []).join(', '));
        }

        if (data.analyses && data.analyses.length > 0) {
          const formatted: EvaluationResult[] = data.analyses.map((item: any) => ({
            creator: (item.creators || item.creator) as CreatorData,
            analysis: {
              id: item.id,
              overall_relevance_score: Number(item.overall_relevance_score),
              post_evidence_reasoning: item.post_evidence_reasoning,
              created_at: item.created_at,
            },
          }));
          setResults(formatted);
        } else {
          setResults([]);
        }
      } catch (err: any) {
        console.error('[Page Load Error]:', {
          message: err.message,
          stack: err.stack,
        });
        setError(err.message || 'Failed to load campaign details.');
      } finally {
        setLoading(false);
      }
    }

    loadCampaignData();
  }, [campaignId]);

  const fetchCampaignData = useCallback(async () => {
    if (!campaignId || campaignId === 'undefined') return;

    try {
      const res = await fetch(`/api/campaigns/${campaignId}`);
      const data = await res.json();

      if (!res.ok) {
        console.error('[CampaignDetails] API error:', data.error || `HTTP ${res.status}`);
        setError(data.error || 'Failed to load campaign details.');
        return;
      }

      if (data.campaign) {
        const c = data.campaign as CampaignData;
        setCampaign(c);
        setFormTitle(c.title || '');
        setFormBrief(c.brief_description || '');
        setFormContentType(c.content_type || '');
        setFormRedFlags((c.red_flags || []).join(', '));
      }

      if (data.analyses && data.analyses.length > 0) {
        const formatted: EvaluationResult[] = data.analyses.map((item: any) => ({
          creator: (item.creators || item.creator) as CreatorData,
          analysis: {
            id: item.id,
            overall_relevance_score: Number(item.overall_relevance_score),
            post_evidence_reasoning: item.post_evidence_reasoning,
            created_at: item.created_at,
          },
        }));
        setResults(formatted);
      } else {
        setResults([]);
      }
    } catch (err: any) {
      console.error('[CampaignDetails] Fetch failed:', {
        message: err.message,
        stack: err.stack,
      });
      setError(err.message || 'Failed to load campaign details.');
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  // ── Handlers with try/catch ───────────────────────────────────────────────

  const handleExportCSV = useCallback(() => {
    try {
      exportToCSV(results, campaign?.title || 'campaign');
    } catch (err) {
      console.error('Export failed:', err);
    }
  }, [results, campaign]);

  const handleOpenReasoning = useCallback(
    (handle: string, text: string, score: number) => {
      try {
        setActiveReasoning({ handle, text, score });
      } catch (err) {
        console.error('Failed to open reasoning panel:', err);
      }
    },
    [],
  );

  const handleCloseReasoning = useCallback(() => {
    try {
      setActiveReasoning(null);
    } catch (err) {
      console.error('Failed to close reasoning panel:', err);
    }
  }, []);

  const handleNavigateBack = useCallback(() => {
    try {
      router.push('/campaigns');
    } catch (err) {
      console.error('Navigation failed:', err);
      window.location.href = '/campaigns';
    }
  }, [router]);

  // ── Save campaign metadata (title, brief, content_type, red_flags) ──────
  const handleSaveCampaign = useCallback(async () => {
    if (!campaignId || !campaign) return;
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formTitle,
          brief_description: formBrief,
          content_type: formContentType,
          red_flags: formRedFlags
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean),
        }),
      });
      if (res.ok) {
        setCampaign((prev) =>
          prev
            ? {
                ...prev,
                title: formTitle,
                brief_description: formBrief,
                content_type: formContentType,
                red_flags: formRedFlags
                  .split(',')
                  .map((f) => f.trim())
                  .filter(Boolean),
              }
            : prev,
        );
        setFormSaved(true);
        setTimeout(() => setFormSaved(false), 2000);
      }
    } catch (err) {
      console.error('[Save Campaign] Error:', err);
    }
  }, [campaignId, campaign, formTitle, formBrief, formContentType, formRedFlags]);

  // ── Recalculate Scores ──────────────────────────────────────────────────
  const handleRecalculate = useCallback(async () => {
    if (!campaignId || !campaign || isRecalculating) return;

    // Build creator handles from current results
    const creators = results.map((r) => ({
      username: r.creator.instagram_handle,
      name: r.creator.name || undefined,
    }));

    if (creators.length === 0) {
      setError('No creators found to recalculate. Open the editor to add creators first.');
      return;
    }

    setIsRecalculating(true);
    setError(null);

    try {
      const res = await fetch('/api/analyze-creators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formTitle || campaign.title,
          brief_description: formBrief || campaign.brief_description,
          content_type: formContentType || campaign.content_type,
          red_flags: formRedFlags
            .split(',')
            .map((f) => f.trim())
            .filter(Boolean),
          creators,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error('[Recalculate] API error:', data.error);
        setError(data.error || 'Recalculation failed.');
        return;
      }

      // Refresh from the database to get the newly upserted analyses
      await fetchCampaignData();
      setLastScoredAt(new Date().toISOString());
    } catch (err: any) {
      console.error('[Recalculate] Error:', err);
      setError(err.message || 'Failed to recalculate scores.');
    } finally {
      setIsRecalculating(false);
    }
  }, [campaignId, campaign, results, formTitle, formBrief, formContentType, formRedFlags, isRecalculating, fetchCampaignData]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-8 md:py-12">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex items-center justify-between">
          <button
            onClick={handleNavigateBack}
            className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" /> Campaigns
          </button>
        </header>

        {/* Campaign Metadata — Editable Form */}
        {campaign && (
          <section className="border border-zinc-800 rounded-xl p-6 bg-zinc-900/30">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-5">
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full bg-transparent text-xl sm:text-2xl font-bold tracking-tight text-zinc-100 mb-1.5 border-none outline-none focus:ring-0 placeholder:text-zinc-600"
                  placeholder="Campaign title"
                />
                <p className="text-[11px] text-zinc-600 border border-zinc-800 inline-block px-2 py-0.5 rounded mb-3">
                  Created {new Date(campaign.created_at).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {lastScoredAt && (
                  <span className="text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2.5 py-1 rounded-md flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Last scored: Just now
                  </span>
                )}
                <button
                  onClick={handleSaveCampaign}
                  disabled={formSaved}
                  className="inline-flex items-center gap-1.5 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  {formSaved ? 'Saved' : 'Save'}
                </button>
                <button
                  onClick={handleRecalculate}
                  disabled={isRecalculating || results.length === 0}
                  className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors shadow-sm shadow-indigo-950"
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${isRecalculating ? 'animate-spin' : ''}`} />
                  {isRecalculating ? 'Recalculating…' : 'Recalculate Scores'}
                </button>
              </div>
            </div>

            {/* Editable fields grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-[10px] uppercase font-semibold text-zinc-500 mb-1.5">Brief Description</label>
                <textarea
                  value={formBrief}
                  onChange={(e) => setFormBrief(e.target.value)}
                  rows={3}
                  className="w-full bg-zinc-800/40 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700 resize-none transition-colors"
                  placeholder="Describe the campaign brief..."
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase font-semibold text-zinc-500 mb-1.5">Content Type</label>
                <input
                  type="text"
                  value={formContentType}
                  onChange={(e) => setFormContentType(e.target.value)}
                  className="w-full bg-zinc-800/40 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700 transition-colors"
                  placeholder="e.g. Fashion, Tech, Food..."
                />
                <label className="block text-[10px] uppercase font-semibold text-zinc-500 mb-1.5 mt-4">Red Flags / Competitors</label>
                <input
                  type="text"
                  value={formRedFlags}
                  onChange={(e) => setFormRedFlags(e.target.value)}
                  className="w-full bg-zinc-800/40 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700 transition-colors"
                  placeholder="Comma-separated: BrandA, BrandB..."
                />
              </div>
            </div>
          </section>
        )}

        {/* Results */}
        <section className="border border-zinc-800 rounded-xl bg-zinc-900/50">
          <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
            <div className="flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-zinc-500" />
              <h2 className="text-sm font-semibold text-zinc-200">Analysis Results</h2>
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
                Export CSV
              </button>
            )}
          </div>

          <div className="p-6">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
                <RefreshCw className="h-6 w-6 animate-spin mb-3 text-zinc-600" />
                <p className="text-sm">Loading analyses…</p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center text-center py-16">
                <AlertTriangle className="h-6 w-6 text-zinc-600 mb-3" />
                <h3 className="text-sm font-semibold text-zinc-300 mb-1">Failed to Load</h3>
                <p className="text-xs text-zinc-500 max-w-xs">{error}</p>              <button
                onClick={() => fetchCampaignData()}
                  className="mt-4 inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors shadow-sm shadow-indigo-950"
                >
                  <RefreshCw className="h-3 w-3" /> Retry
                </button>
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-16">
                <BarChart2 className="h-6 w-6 text-zinc-700 mb-3" />
                <h3 className="text-sm font-semibold text-zinc-300">No Analytics Found</h3>
                <p className="text-xs text-zinc-500 mt-1 max-w-xs leading-relaxed">
                  Run the AI scoring pipeline from the campaign editor to generate evaluations.
                </p>
                <Link
                  href={`/campaign?id=${campaignId}`}
                  className="mt-4 inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-4 py-2 rounded-lg text-xs transition-colors shadow-sm shadow-indigo-950"
                >
                  Open Editor
                </Link>
              </div>
            ) : (
              <>
                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-zinc-800">
                        <th className="pb-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Creator</th>
                        <th className="pb-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider text-right">Followers</th>
                        <th className="pb-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider text-right">ER %</th>
                        <th className="pb-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider text-center">Score</th>
                        <th className="pb-3 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider text-right">Evidence</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {results.map((item, index) => {
                        const score = item.analysis.overall_relevance_score;
                        return (
                          <tr key={item.creator.id || index} className="hover:bg-zinc-800/30 transition-colors">
                            <td className="py-3.5 pr-4">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm text-zinc-200">
                                  @{item.creator.instagram_handle}
                                </span>
                                <a
                                  href={`https://instagram.com/${item.creator.instagram_handle}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-zinc-600 hover:text-zinc-400 transition-colors"
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
                              <span className={`inline-block px-2.5 py-0.5 rounded-md border text-xs font-semibold tabular-nums ${getScoreStyle(score)}`}>
                                {score}
                              </span>
                            </td>
                            <td className="py-3.5 text-right">
                              <button
                                onClick={() =>
                                  handleOpenReasoning(
                                    item.creator.instagram_handle,
                                    item.analysis.post_evidence_reasoning,
                                    score,
                                  )
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
                    const score = item.analysis.overall_relevance_score;
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
                          <span className={`px-2 py-0.5 rounded-md border text-xs font-semibold tabular-nums ${getScoreStyle(score)}`}>
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
                            handleOpenReasoning(
                              item.creator.instagram_handle,
                              item.analysis.post_evidence_reasoning,
                              score,
                            )
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
        </section>
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
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-md border ${getScoreStyle(activeReasoning.score)}`}>
                    {activeReasoning.score}/100
                  </span>
                </div>
                <h3 className="text-base font-semibold text-zinc-100 mt-1">
                  Evidence & Justification
                </h3>
              </div>
              <button
                onClick={handleCloseReasoning}
                className="text-zinc-500 hover:text-zinc-300 p-1 rounded-md hover:bg-zinc-800 transition-colors"
              >
                ✕
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
                <ExternalLink className="h-3 w-3" /> @{activeReasoning.handle}
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
    </div>
  );
}
