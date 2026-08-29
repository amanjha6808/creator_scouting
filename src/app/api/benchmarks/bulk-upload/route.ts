import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseClient';
import { safeInt, safeNumeric } from '@/lib/parseNumeric';
import { sanitizeBenchmarkPayload, upsertBenchmarkWithRetry } from '@/lib/supabaseUtils';
import { classifyCreator, classifyCreatorsBatch, classifyByKeywords, MetaTokenExpiredError, MetaRateLimitError, consumeConsecutive403Count } from '@/lib/classifyCreator';
import { tokenExpiredResponse, rateLimitedResponse, sleep } from '@/lib/metaTokenError';
import { createJob, emitProgress, endJob, calcPercent } from '@/lib/progressTracker';

// ─── CSV line parser (handles quoted fields with commas) ──────────────────────

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ─── Link classification regexes ──────────────────────────────────────────────

const REEL_RE = /instagram\.com\/(reel\/|p\/)/i;
const REEL_KEYWORD_RE = /\breel\b/i;
const PROFILE_RE = /instagram\.com\/([a-zA-Z0-9_.]+)\/?$/i;
const HANDLE_ONLY_RE = /^@?([a-zA-Z0-9_.]+)$/;

type LinkClassification =
  | { kind: 'reel'; url: string }
  | { kind: 'profile'; url: string; handle: string }
  | { kind: 'bare_handle'; handle: string }
  | null;

function classifyLink(raw: string): LinkClassification {
  if (!raw) return null;
  const trimmed = raw.trim();

  // Reel / post URL → reel_url
  if (REEL_RE.test(trimmed) || REEL_KEYWORD_RE.test(trimmed)) {
    return { kind: 'reel', url: trimmed };
  }

  // Profile URL → extract handle
  const profileMatch = trimmed.match(PROFILE_RE);
  if (profileMatch) {
    return { kind: 'profile', url: trimmed, handle: profileMatch[1].toLowerCase() };
  }

  // Bare username / @handle
  const handleMatch = trimmed.match(HANDLE_ONLY_RE);
  if (handleMatch) {
    return { kind: 'bare_handle', handle: handleMatch[1].toLowerCase() };
  }

  return null;
}

// ─── Dynamic tier calculation ─────────────────────────────────────────────────

function calculateTier(
  views: number | null,
  followers: number | null
): 'High Performer' | 'Average' | 'Flop' {
  if (views !== null && followers !== null && followers > 0) {
    const ratio = views / followers;
    if (ratio >= 1.5) return 'High Performer';
    if (ratio >= 0.4) return 'Average';
    return 'Flop';
  }
  if (views !== null) {
    if (views >= 100_000) return 'High Performer';
    if (views >= 10_000) return 'Average';
    return 'Flop';
  }
  return 'Average';
}

// ─── Flexible header matching ─────────────────────────────────────────────────

const LINK_HEADERS = [
  'profile_link', 'profile_url', 'link', 'instagram', 'url',
  'reel_url', 'reel', 'post_url', 'post_link',
];
const NAME_HEADERS = ['name', 'creator_name', 'display_name', 'full_name'];
const HANDLE_HEADERS = [
  'username', 'user', 'handle', 'creator_handle', 'profile', 'account',
];
const CATEGORY_HEADERS = [
  'content_category', 'category', 'niche', 'vertical', 'genre',
];
const TIER_HEADERS = [
  'performance_tier', 'tier', 'rating', 'performance', 'quality',
];
const NOTES_HEADERS = [
  'performance_notes', 'notes', 'note', 'comment', 'comments', 'description',
];
const VIEWS_HEADERS = ['views', 'view_count', 'total_views', 'impressions', 'reach'];
const FOLLOWERS_HEADERS = [
  'followers', 'follower_count', 'fans', 'subscribers',
];
const LIKES_HEADERS = ['likes', 'like_count', 'total_likes'];
const COMMENTS_HEADERS = ['comments_count', 'comment_count'];
const ER_HEADERS = [
  'engagement_rate', 'er', 'eng_rate', 'avg_engagement_rate', 'avg_er',
];
const COST_HEADERS = [
  'commercial_cost', 'cost', 'price', 'commercials', 'fee', 'amount_paid',
  'budget', 'spend', 'payment', 'rate', 'deal_value', 'cost_inr', 'cost_usd',
];

function findHeader(
  normalisedHeaders: string[],
  candidates: string[]
): string | null {
  for (const candidate of candidates) {
    const idx = normalisedHeaders.indexOf(candidate);
    if (idx !== -1) return normalisedHeaders[idx];
  }
  return null;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No CSV file provided in form data (field name: "file")' },
        { status: 400 }
      );
    }

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

    if (lines.length < 2) {
      return NextResponse.json(
        { error: 'CSV must have a header row and at least one data row' },
        { status: 400 }
      );
    }

    // Parse headers — normalise for matching
    const rawHeaders = parseCSVLine(lines[0]);
    const normalisedHeaders = rawHeaders.map((h) =>
      h.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '')
    );

    // Map flexible column positions
    const linkCol = findHeader(normalisedHeaders, LINK_HEADERS);
    const handleCol = findHeader(normalisedHeaders, HANDLE_HEADERS);
    const nameCol = findHeader(normalisedHeaders, NAME_HEADERS);
    const categoryCol = findHeader(normalisedHeaders, CATEGORY_HEADERS);
    const tierCol = findHeader(normalisedHeaders, TIER_HEADERS);
    const notesCol = findHeader(normalisedHeaders, NOTES_HEADERS);
    const viewsCol = findHeader(normalisedHeaders, VIEWS_HEADERS);
    const followersCol = findHeader(normalisedHeaders, FOLLOWERS_HEADERS);
    const likesCol = findHeader(normalisedHeaders, LIKES_HEADERS);
    const commentsCol = findHeader(normalisedHeaders, COMMENTS_HEADERS);
    const erCol = findHeader(normalisedHeaders, ER_HEADERS);
    const costCol = findHeader(normalisedHeaders, COST_HEADERS);

    // Need at least a link or username column
    if (!linkCol && !handleCol) {
      return NextResponse.json(
        {
          error:
            'CSV must contain at least a profile link or username column. ' +
            'Recognised headers include: Profile Link, Profile URL, Link, Instagram, URL, Username, Handle.',
        },
        { status: 400 }
      );
    }

    const validTiers = ['High Performer', 'Average', 'Flop'];
    const rows: any[] = [];
    let skippedCount = 0;

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length === 0 || values.every((v) => !v.trim())) {
        skippedCount++;
        continue;
      }

      const row: Record<string, string> = {};
      normalisedHeaders.forEach((h, idx) => {
        row[h] = values[idx] || '';
      });

      // ── Determine handle: prefer username column, fall back to link ──
      let handle: string | null = null;
      let profileLink: string | null = null;
      let reelUrl: string | null = null;

      // Try username / handle column first
      if (handleCol) {
        const cls = classifyLink(row[handleCol]);
        if (cls) {
          if (cls.kind === 'bare_handle') {
            handle = cls.handle;
          } else if (cls.kind === 'profile') {
            handle = cls.handle;
            profileLink = cls.url;
          } else if (cls.kind === 'reel') {
            reelUrl = cls.url;
          }
        }
      }

      // Fall back to link column for handle + classify the link
      if (!handle && linkCol) {
        const cls = classifyLink(row[linkCol]);
        if (cls) {
          if (cls.kind === 'bare_handle') {
            handle = cls.handle;
          } else if (cls.kind === 'profile') {
            handle = cls.handle;
            profileLink = cls.url;
          } else if (cls.kind === 'reel') {
            reelUrl = cls.url;
          }
        }
      }

      // Also check a second link column for reel if handle found via username
      if (!reelUrl && linkCol) {
        const cls = classifyLink(row[linkCol]);
        if (cls?.kind === 'reel') {
          reelUrl = cls.url;
        }
      }

      // Skip silently if no valid handle
      if (!handle) {
        skippedCount++;
        continue;
      }

      // ── Derive category (never accept 'General') ──
      const rawCategory = (categoryCol && row[categoryCol]?.trim()) || '';
      const category = rawCategory && rawCategory.toLowerCase() !== 'general' ? rawCategory : '';

      // ── Derive tier ──
      let tier: 'High Performer' | 'Average' | 'Flop';
      const rawTier = (tierCol && row[tierCol]?.trim()) || '';

      if (validTiers.includes(rawTier)) {
        tier = rawTier as 'High Performer' | 'Average' | 'Flop';
      } else {
        const views = viewsCol ? safeInt(row[viewsCol], 0) : 0;
        const followers = followersCol ? safeInt(row[followersCol], 0) : 0;
        tier = calculateTier(views, followers);
      }

      // ── Parse metrics (safe sanitization) ──
      const views = safeInt(row[viewsCol || ''] || '', 0);
      const likes = safeInt(row[likesCol || ''] || '', 0);
      const comments = safeInt(row[commentsCol || ''] || '', 0);
      const followers = followersCol ? safeInt(row[followersCol], 0) : 0;

      // ── Parse commercial cost (strip currency symbols, commas) — graceful fallback to 0 ──
      let commercialCost = 0;
      if (costCol && row[costCol]) {
        let costStr = row[costCol].trim();
        if (costStr) {
          // Strip currency symbols: ₹, $, €, £, ¥
          costStr = costStr.replace(/[₹$€£¥]/g, '');
          // Strip commas used as thousand separators
          costStr = costStr.replace(/,/g, '');
          // Strip whitespace
          costStr = costStr.trim();
          const parsed = safeNumeric(costStr);
          if (parsed !== null && parsed > 0) {
            commercialCost = parsed;
          }
        }
      }
      // If cost column omitted, commercialCost stays 0 (graceful fallback)

      // ── Calculate cost_per_view (CPV) — graceful fallback to 0 ──
      const costPerView = views > 0 && commercialCost > 0
        ? Math.round((commercialCost / views) * 100) / 100
        : 0;

      // ── Calculate reach_efficiency_pct = (views / followers) * 100 — graceful fallback to 0 ──
      const reachEfficiencyPct = followers > 0
        ? Math.round((views / followers) * 10000) / 100
        : 0;

      // ── Calculate roi_rating ──
      let roiRating = '';
      if (commercialCost > 0) {
        if (costPerView <= 0.50 && reachEfficiencyPct >= 50) {
          roiRating = 'Exceptional ROI';
        } else if (costPerView <= 1.50) {
          roiRating = 'Good Value';
        } else if (costPerView > 2.00 || (reachEfficiencyPct > 0 && reachEfficiencyPct < 15)) {
          roiRating = 'Overpriced / Underdelivered';
        } else {
          roiRating = 'Moderate';
        }
      }

      // Engagement rate: prefer CSV column, else calculate from views/likes/comments
      let engagementRate = 0;
      if (erCol && row[erCol]) {
        const parsed = safeNumeric(row[erCol]);
        if (parsed !== null) {
          // If value is between 0 and 1, it's likely a ratio — scale to percentage
          engagementRate = parsed > 0 && parsed < 1 ? Math.round(parsed * 10000) / 100 : parsed;
        }
      }
      if (engagementRate === 0 && views > 0) {
        engagementRate = Math.round(((likes + comments) / views) * 10000) / 100;
      }

      // ── Build row ──
      const nameValue = nameCol ? row[nameCol]?.trim() : undefined;

      rows.push({
        creator_handle: handle,
        creator_name: nameValue || null,
        content_category: category,
        performance_tier: tier,
        reel_url: reelUrl,
        performance_notes: notesCol ? row[notesCol]?.trim() || null : null,
        views,
        likes,
        comments,
        engagement_rate: engagementRate,
        profile_link: profileLink,
        commercial_cost: commercialCost,
        cost_per_view: costPerView,
        reach_efficiency_pct: reachEfficiencyPct,
        roi_rating: roiRating,
      });
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No valid rows found in CSV' },
        { status: 400 }
      );
    }

    // ── Deduplicate by creator_handle (last occurrence wins) ──
    const dedupMap = new Map<string, any>();
    for (const row of rows) {
      dedupMap.set(row.creator_handle, row);
    }
    const uniqueRows = Array.from(dedupMap.values());
    const duplicatesRemoved = rows.length - uniqueRows.length;

    // ── Create progress tracking job (use client-provided jobId for SSE correlation) ──
    const clientJobId = formData.get('jobId') as string | null;
    const jobId = createJob(clientJobId || undefined);
    emitProgress(jobId, { percent: 10, status: `Parsed ${uniqueRows.length} creators from CSV`, step: 'Parsing CSV' });

    // ── Auto-categorize rows with missing/empty/General category via classifyCreator ──
    const needsCategorization = uniqueRows.filter(
      (r) => !r.content_category || r.content_category.toLowerCase() === 'general'
    );
    let autoCategorizedCount = 0;

    if (needsCategorization.length > 0) {
      console.log(
        `[AutoCategorize] ${needsCategorization.length} creator(s) need category assignment`
      );
      emitProgress(jobId, { percent: 20, status: `Auto-categorizing ${needsCategorization.length} creator(s)...`, step: 'Running Gemini AI Classification' });

      try {
        const batchResult = await classifyCreatorsBatch(
          needsCategorization.map((r) => ({
            handle: r.creator_handle,
            reelUrl: r.reel_url,
          }))
        );

        for (const row of needsCategorization) {
          const suggested = batchResult.get(row.creator_handle);
          if (suggested) {
            row.content_category = suggested;
            autoCategorizedCount++;
          }
        }

        console.log(
          `[AutoCategorize] Assigned categories to ${autoCategorizedCount} creator(s)`
        );
        emitProgress(jobId, { percent: 50, status: `Auto-categorized ${autoCategorizedCount} creator(s)`, step: 'Running Gemini AI Classification' });
      } catch (err: any) {
        if (err instanceof MetaTokenExpiredError) {
          console.error('[BulkUpload] TOKEN_EXPIRED — aborting categorization, no records saved');
          endJob(jobId);
          return NextResponse.json(tokenExpiredResponse(), { status: 401 });
        }
        throw err;
      }
    } else {
      emitProgress(jobId, { percent: 50, status: 'All creators have categories assigned', step: 'Running Gemini AI Classification' });
    }

    // Final safety: ensure NO row has 'General' or empty category before upsert
    for (let i = 0; i < uniqueRows.length; i++) {
      const row = uniqueRows[i];
      if (!row.content_category || row.content_category.toLowerCase() === 'general') {
        if (i > 0) await sleep(1500);
        try {
          const cat = await classifyCreator({ handle: row.creator_handle, reelUrl: row.reel_url });
          row.content_category = cat;
          console.warn(`[AutoCategorize] Final safety net: classified @${row.creator_handle} → "${cat}"`);
        } catch (err: any) {
          if (err instanceof MetaTokenExpiredError) {
            console.error('[BulkUpload] TOKEN_EXPIRED in final safety net — aborting, no records saved');
            endJob(jobId);
            return NextResponse.json(tokenExpiredResponse(), { status: 401 });
          }
          if (err instanceof MetaRateLimitError) {
            console.error('[BulkUpload] RATE_LIMITED in final safety net — falling back to keyword classification');
            row.content_category = classifyByKeywords(row.creator_handle);
          } else {
            throw err;
          }
        }
      }
    }

    emitProgress(jobId, { percent: 75, status: 'Persisting to Supabase...', step: 'Persisting to Supabase' });

    // Sanitize all rows before upsert
    const sanitizedRows = await Promise.all(
      uniqueRows.map(row => sanitizeBenchmarkPayload(row))
    );

    // Upsert with automatic retry on PGRST204 (missing column) errors
    const { data, error } = await upsertBenchmarkWithRetry(sanitizedRows, 'creator_handle');

    if (error) {
      console.error('Bulk upsert error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // ── Build category breakdown for response ──
    const finalRows = data || uniqueRows;
    const categoryBreakdown: Record<string, number> = {};
    for (const row of finalRows) {
      const cat = row.content_category || 'General';
      categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
    }
    const uniqueCategories = Object.keys(categoryBreakdown).length;

    // ── Rate-limit status for client-side modal ──
    const consecutive403Count = consumeConsecutive403Count();
    const rateLimited = consecutive403Count >= 3;
    if (rateLimited) {
      console.warn(
        `[BulkUpload] ${consecutive403Count} consecutive Meta 403s — flagging rate limit to client`,
      );
    }

    emitProgress(jobId, { percent: 95, status: 'Finalizing...', step: 'Persisting to Supabase' });
    endJob(jobId);

    return NextResponse.json({
      success: true,
      jobId,
      inserted: finalRows.length,
      skippedCount,
      duplicatesRemoved,
      autoCategorizedCount,
      categoryBreakdown,
      uniqueCategories,
      rateLimited,
    });
  } catch (error: any) {
    console.error('POST /api/benchmarks/bulk-upload error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
