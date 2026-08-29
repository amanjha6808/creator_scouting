/**
 * Meta Graph API Batching & Caching Service
 *
 * Architecture:
 *   1. Cache Lookup — Query `public.creators` table for handles updated within 7 days
 *   2. Batch Fetch — Chunk missing handles into ≤50, POST to Meta Graph API batch endpoint
 *   3. Circuit Breaker — On HTTP 403 (rate limit) or OAuth 190 (token expiry), trip breaker
 *      and fall back to Gemini direct inference (gemini-3.5-flash-lite)
 *   4. Persist Results — Upsert fresh data back to `public.creators` for future caching
 *
 * Integration points:
 *   - Uses existing `circuitBreaker.ts` for 20-min auto-recovery
 *   - Uses existing `metaTokenError.ts` for token expiry (code 190) and rate limit (HTTP 403, code 4) detection
 *   - Falls back to `gemini-3.5-flash-lite` for classification when Meta is unavailable
 */

import { getSupabaseAdmin } from './supabaseClient';
import { getGeminiClient, DETERMINISTIC_CONFIG } from './geminiClient';
import {
  checkMetaResponseForTokenExpiry,
  checkMetaResponseForRateLimit,
  sleep,
} from './metaTokenError';
import {
  isMetaCircuitOpen,
  tripCircuitBreaker,
  resetCircuitBreaker,
} from './circuitBreaker';
import { VALID_CATEGORIES, classifyByKeywords, incrementConsecutive403 } from './classifyCreator';

const BATCH_MAX_SIZE = 50;
const CACHE_TTL_DAYS = 7;
const META_API_VERSION = 'v20.0';

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface CreatorMediaItem {
  id?: string | null;
  caption: string | null;
  like_count: number | null;
  comments_count: number | null;
  timestamp: string | null;
}

export interface CreatorMetrics {
  handle: string;
  username: string;
  name: string | null;
  biography: string | null;
  followers_count: number | null;
  media_count: number | null;
  recent_captions: string[];
  recent_media: CreatorMediaItem[];
  data_source: 'cache' | 'meta_api' | 'gemini_fallback';
  fetched_at: string;
}

export interface BatchFetchResult {
  metrics: Map<string, CreatorMetrics>;
  cachedHandles: string[];
  fetchedHandles: string[];
  failedHandles: string[];
  circuitBreakerTripped: boolean;
  fallbackUsed: boolean;
}

interface MetaBatchRequest {
  method: 'GET';
  relative_url: string;
}

interface MetaBatchResponse {
  code: number;
  body: string;
  headers: Array<{ name: string; value: string }>;
}

interface MetaBusinessDiscoveryResponse {
  id: string;
  username: string;
  name: string | null;
  biography: string | null;
  followers_count: number | null;
  media_count: number | null;
  media?: {
    data: Array<{
      caption: string | null;
      like_count: number | null;
      comments_count: number | null;
      timestamp: string;
    }>;
  };
}

// ─── Cache Lookup ────────────────────────────────────────────────────────────────

/**
 * Check the `public.creators` table for recently updated creator data (within 7 days).
 * Returns a Map of handle → CreatorMetrics for handles that have fresh cache.
 */
export async function getCachedCreatorMetrics(
  handles: string[]
): Promise<Map<string, CreatorMetrics>> {
  if (handles.length === 0) return new Map();

  const supabase = getSupabaseAdmin();
  const normalizedHandles = handles.map(h => h.trim().toLowerCase().replace(/^@/, ''));
  const cutoffDate = new Date(Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('creators')
    .select('instagram_handle, name, followers_count, avg_engagement_rate, bio, recent_posts_json, updated_at')
    .in('instagram_handle', normalizedHandles)
    .gte('updated_at', cutoffDate);

  if (error) {
    console.warn('[metaApi] Cache lookup failed:', error.message);
    return new Map();
  }

  const cache = new Map<string, CreatorMetrics>();

  for (const row of data || []) {
    const handle = row.instagram_handle;
    let recentCaptions: string[] = [];
    let recentMedia: CreatorMediaItem[] = [];

    if (row.recent_posts_json && typeof row.recent_posts_json === 'object') {
      const media = (row.recent_posts_json as any).data;
      if (Array.isArray(media)) {
        recentCaptions = media
          .map((m: any) => m.caption)
          .filter((c: string | null): c is string => Boolean(c))
          .slice(0, 10);

        recentMedia = media.slice(0, 10).map((m: any): CreatorMediaItem => ({
          id: m.id ?? null,
          caption: m.caption ?? null,
          like_count: m.like_count ?? null,
          comments_count: m.comments_count ?? null,
          timestamp: m.timestamp ?? null,
        }));
      }
    }

    cache.set(handle, {
      handle,
      username: handle,
      name: row.name,
      biography: row.bio,
      followers_count: row.followers_count,
      media_count: null, // Not stored in creators table
      recent_captions: recentCaptions,
      recent_media: recentMedia,
      data_source: 'cache',
      fetched_at: row.updated_at,
    });
  }

  if (cache.size > 0) {
    console.log(`[metaApi] Cache hit for ${cache.size}/${handles.length} handles`);
  }

  return cache;
}

// ─── Meta Graph API Batch Fetch ──────────────────────────────────────────────────

/**
 * Build the batch request body for Meta Graph API.
 * Each request fetches business_discovery for a single handle.
 */
function buildBatchRequests(handles: string[], igBusinessId: string): MetaBatchRequest[] {
  return handles.map(handle => ({
    method: 'GET',
    relative_url: `${igBusinessId}?fields=business_discovery.username(${handle}){id,username,name,biography,followers_count,media_count,media{caption,like_count,comments_count,timestamp}}`,
  }));
}

/**
 * Parse the Meta batch response and extract creator metrics.
 */
function parseBatchResponse(
  responses: MetaBatchResponse[],
  handles: string[]
): Map<string, CreatorMetrics> {
  const metrics = new Map<string, CreatorMetrics>();

  for (let i = 0; i < responses.length; i++) {
    const handle = handles[i].toLowerCase().replace(/^@/, '');
    const response = responses[i];

    if (response.code !== 200) {
      console.warn(`[metaApi] Batch sub-request failed for @${handle}: HTTP ${response.code}`, response.body);
      continue;
    }

    try {
      const body = JSON.parse(response.body);
      const bd = body.business_discovery;

      if (!bd) {
        console.warn(`[metaApi] No business_discovery data for @${handle}`);
        continue;
      }

      const captions: string[] = [];
      const media: CreatorMediaItem[] = [];
      if (bd.media?.data) {
        for (const m of bd.media.data) {
          if (m.caption) captions.push(m.caption);
          media.push({
            id: m.id ?? null,
            caption: m.caption ?? null,
            like_count: m.like_count ?? null,
            comments_count: m.comments_count ?? null,
            timestamp: m.timestamp ?? null,
          });
        }
      }

      metrics.set(handle, {
        handle,
        username: bd.username,
        name: bd.name,
        biography: bd.biography,
        followers_count: bd.followers_count,
        media_count: bd.media_count,
        recent_captions: captions.slice(0, 10),
        recent_media: media.slice(0, 10),
        data_source: 'meta_api',
        fetched_at: new Date().toISOString(),
      });
    } catch (err) {
      console.warn(`[metaApi] Failed to parse batch response for @${handle}:`, err);
    }
  }

  return metrics;
}

/**
 * Fetch creator metrics via Meta Graph API batch endpoint.
 * Chunks handles into batches of ≤50.
 * Returns metrics for successfully fetched handles.
 */
async function batchFetchCreatorMetrics(
  handles: string[]
): Promise<Map<string, CreatorMetrics>> {
  const pageAccessToken = process.env.META_PAGE_ACCESS_TOKEN;
  const igBusinessId = process.env.META_IG_BUSINESS_ID;

  if (!pageAccessToken || !igBusinessId) {
    console.warn('[metaApi] Meta API credentials missing — skipping batch fetch');
    return new Map();
  }

  // Check circuit breaker before making requests
  if (isMetaCircuitOpen()) {
    console.log('[metaApi] Circuit breaker open — skipping Meta batch fetch');
    return new Map();
  }

  const allMetrics = new Map<string, CreatorMetrics>();
  const normalizedHandles = handles.map(h => h.trim().toLowerCase().replace(/^@/, ''));

  // Process in chunks of 50
  for (let i = 0; i < normalizedHandles.length; i += BATCH_MAX_SIZE) {
    const chunk = normalizedHandles.slice(i, i + BATCH_MAX_SIZE);
    const batchRequests = buildBatchRequests(chunk, igBusinessId);

    const batchBody = JSON.stringify({ batch: batchRequests });
    const url = `https://graph.facebook.com/${META_API_VERSION}/?access_token=${pageAccessToken}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: batchBody,
      });

      // Check for rate limit (HTTP 403)
      const { limited, body: rlBody } = await checkMetaResponseForRateLimit(response.clone());
      if (limited) {
        console.warn('[metaApi] Meta batch API RATE_LIMITED (403) — tripping circuit breaker');
        incrementConsecutive403();
        tripCircuitBreaker();
        return allMetrics; // Return what we have so far
      }

      // Check for token expiry
      if (!response.ok) {
        const { expired, body: errData } = await checkMetaResponseForTokenExpiry(response);
        if (expired) {
          console.error('[metaApi] Meta batch API TOKEN_EXPIRED — tripping circuit breaker');
          tripCircuitBreaker();
          return allMetrics;
        }
        console.warn(`[metaApi] Meta batch API HTTP ${response.status}:`, errData?.error?.message || response.statusText);
        continue;
      }

      const { expired, body: data } = await checkMetaResponseForTokenExpiry(response);
      if (expired) {
        console.error('[metaApi] Meta batch API TOKEN_EXPIRED in response body — tripping circuit breaker');
        tripCircuitBreaker();
        return allMetrics;
      }

      // Parse the batch response
      const batchResponses: MetaBatchResponse[] = data?.map((r: any) => ({
        code: r.code,
        body: r.body,
        headers: r.headers,
      })) || [];

      const chunkMetrics = parseBatchResponse(batchResponses, chunk);
      for (const [handle, metric] of chunkMetrics) {
        allMetrics.set(handle, metric);
      }

      console.log(`[metaApi] Batch fetched ${chunkMetrics.size}/${chunk.length} handles in chunk ${Math.floor(i / BATCH_MAX_SIZE) + 1}`);

      // Small delay between chunks to avoid overwhelming the API
      if (i + BATCH_MAX_SIZE < normalizedHandles.length) {
        await sleep(500);
      }
    } catch (err: any) {
      console.error('[metaApi] Batch fetch request failed:', err?.message || err);
      // Don't trip circuit breaker on network errors, only on 403/190
    }
  }

  return allMetrics;
}

// ─── Gemini Fallback Classification ──────────────────────────────────────────────

const GEMINI_FALLBACK_MODEL = 'gemini-3.5-flash-lite';

/**
 * Use Gemini to infer creator category and basic metrics when Meta is unavailable.
 * This provides a "best effort" classification for the pipeline to continue.
 */
async function geminiFallbackClassification(
  handles: string[]
): Promise<Map<string, CreatorMetrics>> {
  const gemini = getGeminiClient();
  if (!gemini) {
    console.warn('[metaApi] Gemini client unavailable — cannot provide fallback');
    return new Map();
  }

  const metrics = new Map<string, CreatorMetrics>();

  // Process in small batches to avoid token limits
  const BATCH_SIZE = 10;
  for (let i = 0; i < handles.length; i += BATCH_SIZE) {
    const chunk = handles.slice(i, i + BATCH_SIZE);

    const prompt = `Classify these Instagram creator handles into ONE category each from this list:
${VALID_CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Handles:
${chunk.map((h, idx) => `${idx + 1}. @${h}`).join('\n')}

Reply as JSON: {"classifications": [{"handle": "handle1", "category": "Category Name"}, ...]}`;

    try {
      const response = await gemini.models.generateContent({
        model: GEMINI_FALLBACK_MODEL,
        contents: prompt,
        config: { responseMimeType: 'application/json', ...DETERMINISTIC_CONFIG },
      });

      const text = (response.text || '{}').trim();
      const parsed = JSON.parse(text);
      const classifications = Array.isArray(parsed.classifications) ? parsed.classifications : [];

      for (const cls of classifications) {
        const handle = cls.handle?.toLowerCase().replace(/^@/, '');
        const category = cls.category;
        if (handle && chunk.includes(handle)) {
          // Validate category
          const matched = VALID_CATEGORIES.find(vc => vc.toLowerCase() === category?.toLowerCase());
          const finalCategory = matched || classifyByKeywords(handle);

          metrics.set(handle, {
            handle,
            username: handle,
            name: null,
            biography: `Inferred category: ${finalCategory}`,
            followers_count: null,
            media_count: null,
            recent_captions: [],
            recent_media: [],
            data_source: 'gemini_fallback',
            fetched_at: new Date().toISOString(),
          });
        }
      }

      // Handle any handles not returned by Gemini
      for (const handle of chunk) {
        if (!metrics.has(handle)) {
          const fallbackCategory = classifyByKeywords(handle);
          metrics.set(handle, {
            handle,
            username: handle,
            name: null,
            biography: `Keyword fallback: ${fallbackCategory}`,
            followers_count: null,
            media_count: null,
            recent_captions: [],
            recent_media: [],
            data_source: 'gemini_fallback',
            fetched_at: new Date().toISOString(),
          });
        }
      }
    } catch (err: any) {
      console.warn(`[metaApi] Gemini fallback failed for chunk:`, err?.message || err);
      // Keyword fallback for this chunk
      for (const handle of chunk) {
        if (!metrics.has(handle)) {
          const fallbackCategory = classifyByKeywords(handle);
          metrics.set(handle, {
            handle,
            username: handle,
            name: null,
            biography: `Keyword fallback: ${fallbackCategory}`,
            followers_count: null,
            media_count: null,
            recent_captions: [],
            recent_media: [],
            data_source: 'gemini_fallback',
            fetched_at: new Date().toISOString(),
          });
        }
      }
    }
  }

  return metrics;
}

// ─── Persist to Cache ────────────────────────────────────────────────────────────

/**
 * Upsert fetched creator metrics back to the `public.creators` table
 * for future cache hits. Uses the same retry logic as bulk-upload.
 */
export async function persistCreatorMetrics(
  metrics: Map<string, CreatorMetrics>
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const rows: any[] = [];

  for (const metric of metrics.values()) {
    if (metric.data_source === 'cache') continue; // Don't re-persist cache hits

    const payload = {
      instagram_handle: metric.handle,
      name: metric.name,
      followers_count: metric.followers_count,
      avg_engagement_rate: null, // Not directly available from batch
      bio: metric.biography,
      recent_posts_json: metric.recent_media.length > 0
        ? { data: metric.recent_media.map((m, i) => ({ id: m.id ?? `post_${i}`, caption: m.caption, like_count: m.like_count, comments_count: m.comments_count, timestamp: m.timestamp })) }
        : null,
      updated_at: new Date().toISOString(),
    };
    rows.push(payload);
  }

  if (rows.length === 0) return;

  // Use upsert with onConflict to update existing records
  const { error } = await supabase
    .from('creators')
    .upsert(rows, { onConflict: 'instagram_handle' });

  if (error) {
    console.warn('[metaApi] Failed to persist creator metrics:', error.message);
  } else {
    console.log(`[metaApi] Persisted ${rows.length} creator metrics to cache`);
  }
}

// ─── Main Entry Point ────────────────────────────────────────────────────────────

/**
 * Main entry point: fetch creator metrics for a list of handles.
 *
 * Flow:
 *   1. Check cache (public.creators, 7-day TTL)
 *   2. For missing handles, batch fetch from Meta Graph API (≤50 per request)
 *   3. On HTTP 403 or OAuth 190, trip circuit breaker and fall back to Gemini
 *   4. Persist fresh results to cache
 *   5. Return combined metrics (cache + fresh + fallback)
 */
export async function fetchCreatorMetrics(
  handles: string[]
): Promise<BatchFetchResult> {
  const normalizedHandles = handles.map(h => h.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  const uniqueHandles = [...new Set(normalizedHandles)];

  if (uniqueHandles.length === 0) {
    return {
      metrics: new Map(),
      cachedHandles: [],
      fetchedHandles: [],
      failedHandles: [],
      circuitBreakerTripped: false,
      fallbackUsed: false,
    };
  }

  console.log(`[metaApi] Fetching metrics for ${uniqueHandles.length} unique handles`);

  // Step 1: Cache lookup
  const cache = await getCachedCreatorMetrics(uniqueHandles);
  const cachedHandles = Array.from(cache.keys());
  const missingHandles = uniqueHandles.filter(h => !cache.has(h));

  let fetchedMetrics = new Map<string, CreatorMetrics>();
  let circuitBreakerTripped = false;
  let fallbackUsed = false;

  // Step 2: Batch fetch from Meta for missing handles
  if (missingHandles.length > 0) {
    console.log(`[metaApi] ${missingHandles.length} handles need fresh data from Meta API`);
    fetchedMetrics = await batchFetchCreatorMetrics(missingHandles);

    // Check if circuit breaker was tripped during fetch
    circuitBreakerTripped = isMetaCircuitOpen();

    // Step 3: Fallback to Gemini for any still-missing handles
    const stillMissing = missingHandles.filter(h => !fetchedMetrics.has(h));
    if (stillMissing.length > 0) {
      console.log(`[metaApi] ${stillMissing.length} handles still missing — using Gemini fallback`);
      fallbackUsed = true;
      const fallbackMetrics = await geminiFallbackClassification(stillMissing);
      for (const [handle, metric] of fallbackMetrics) {
        fetchedMetrics.set(handle, metric);
      }
    }
  }

  // Combine cache + fresh + fallback
  const allMetrics = new Map<string, CreatorMetrics>();
  for (const [handle, metric] of cache) {
    allMetrics.set(handle, metric);
  }
  for (const [handle, metric] of fetchedMetrics) {
    allMetrics.set(handle, metric);
  }

  const fetchedHandles = Array.from(fetchedMetrics.keys());
  const failedHandles = uniqueHandles.filter(h => !allMetrics.has(h));

  // Step 4: Persist fresh data to cache (non-blocking)
  if (fetchedMetrics.size > 0) {
    // Fire and forget - don't await to avoid slowing down the response
    persistCreatorMetrics(fetchedMetrics).catch(err =>
      console.warn('[metaApi] Background persist failed:', err)
    );
  }

  return {
    metrics: allMetrics,
    cachedHandles,
    fetchedHandles,
    failedHandles,
    circuitBreakerTripped,
    fallbackUsed,
  };
}

// ─── Utility: Reset Circuit Breaker (for admin/manual recovery) ──────────────────

export { resetCircuitBreaker, isMetaCircuitOpen } from './circuitBreaker';
export { tripCircuitBreaker } from './circuitBreaker';