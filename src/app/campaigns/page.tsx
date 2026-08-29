'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { Plus, Calendar, ArrowRight, RefreshCw, BarChart2, AlertTriangle, Trash2 } from 'lucide-react';

interface CampaignItem {
  id: string;
  created_at: string;
  title: string;
  brief_description: string;
  content_type: string;
  red_flags: string[] | null;
}

export default function CampaignsGalleryPage() {
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCampaigns() {
      try {
        const { data, error } = await supabase
          .from('campaigns')
          .select('id, created_at, title, brief_description, content_type, red_flags')
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Error fetching campaigns:', error);
        } else if (data) {
          setCampaigns(data as CampaignItem[]);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchCampaigns();
  }, []);

  const handleDelete = async (id: string, title: string) => {
    try {
      if (!confirm(`Delete campaign "${title}"? This cannot be undone.`)) {
        return;
      }

      setDeletingId(id);
      const res = await fetch(`/api/campaigns/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete campaign');
      }

      setCampaigns(prev => prev.filter(c => c.id !== id));
    } catch (err: any) {
      console.error(err);
      alert(`Error deleting campaign: ${err.message || err}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen px-4 sm:px-6 lg:px-8 py-10 md:py-12">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100">
              Campaigns
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Manage campaigns and review AI-driven creator evaluations.
            </p>
          </div>
          <Link
            href="/campaign"
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-4 py-2.5 rounded-lg text-sm transition-colors shadow-sm shadow-indigo-950 shrink-0"
          >
            <Plus className="h-4 w-4" />
            New Campaign
          </Link>
        </header>

        {/* Content */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-zinc-500">
            <RefreshCw className="h-6 w-6 animate-spin mb-3 text-zinc-600" />
            <p className="text-sm">Loading campaigns…</p>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-20 border border-zinc-800 rounded-xl bg-zinc-900/50 max-w-md mx-auto">
            <div className="h-12 w-12 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center mb-4">
              <BarChart2 className="h-5 w-5 text-zinc-500" />
            </div>
            <h3 className="text-lg font-semibold text-zinc-200">No Campaigns Yet</h3>
            <p className="text-sm text-zinc-500 mt-1 max-w-xs leading-relaxed">
              Create your first campaign brief and upload a creator list for AI scoring.
            </p>
            <Link
              href="/campaign"
              className="mt-6 inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-4 py-2 rounded-lg text-sm transition-colors shadow-sm shadow-indigo-950"
            >
              <Plus className="h-4 w-4" /> Create Campaign
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map((camp) => (
              <div
                key={camp.id}
                className="border border-zinc-800 rounded-xl p-5 bg-zinc-900/50 hover:border-zinc-700 transition-colors flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between text-xs text-zinc-500 mb-3">
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="h-3 w-3" />
                      {new Date(camp.created_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    {camp.content_type && (
                      <span className="border border-zinc-800 text-zinc-400 px-2 py-0.5 rounded text-[11px] font-medium truncate max-w-[130px]">
                        {camp.content_type}
                      </span>
                    )}
                  </div>

                  <h3 className="text-base font-semibold text-zinc-100 mb-1.5 line-clamp-1">
                    {camp.title}
                  </h3>

                  <p className="text-sm text-zinc-500 line-clamp-2 leading-relaxed mb-4">
                    {camp.brief_description}
                  </p>

                  {camp.red_flags && camp.red_flags.length > 0 && (
                    <div className="mb-4 flex flex-wrap items-center gap-1">
                      <span className="text-[10px] uppercase font-semibold text-zinc-500 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Flags
                      </span>
                      {camp.red_flags.slice(0, 2).map((flag, idx) => (
                        <span
                          key={idx}
                          className="text-[10px] border border-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded"
                        >
                          {flag}
                        </span>
                      ))}
                      {camp.red_flags.length > 2 && (
                        <span className="text-[10px] text-zinc-600">
                          +{camp.red_flags.length - 2}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-zinc-800/60">
                  <Link
                    href={`/campaigns/${camp.id}`}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors group/link"
                  >
                    <BarChart2 className="h-3.5 w-3.5" />
                    View Results
                    <ArrowRight className="h-3.5 w-3.5 group-hover/link:translate-x-0.5 transition-transform" />
                  </Link>

                  <button
                    onClick={() => handleDelete(camp.id, camp.title)}
                    disabled={deletingId === camp.id}
                    title="Delete Campaign"
                    className="text-zinc-600 hover:text-red-400 p-1.5 rounded-md hover:bg-red-950/30 transition-colors disabled:opacity-50"
                  >
                    {deletingId === camp.id ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
