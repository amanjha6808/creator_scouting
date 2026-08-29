/**
 * Centralized creator classification module.
 *
 * Pipeline:
 *   1. Fetch bio + post captions via Meta Graph API (business_discovery)
 *   2. Pass context to Gemini for classification against a fixed niche list
 *   3. If both fail, fall back to a keyword dictionary lookup
 *   4. Final fallback: "Lifestyle & Vlogging" (NEVER outputs the raw handle string)
 */

import { getGeminiClient, DETERMINISTIC_CONFIG } from './geminiClient';
import { getSupabaseAdmin } from './supabaseClient';
import {
  TOKEN_EXPIRED_ERROR,
  RATE_LIMIT_ERROR,
} from './metaTokenError';
import { fetchCreatorMetrics } from './metaApi';

/**
 * Thrown when the Meta Graph API returns a token-expired error.
 * Routes should catch this and return { error: "TOKEN_EXPIRED" } to the client.
 */
export class MetaTokenExpiredError extends Error {
  readonly statusCode = TOKEN_EXPIRED_ERROR;
  constructor(message = 'Meta Page Access Token has expired.') {
    super(message);
    this.name = 'MetaTokenExpiredError';
  }
}

/**
 * Thrown when the Meta Graph API returns a rate-limit error (HTTP 403 / code #4).
 * Routes should catch this and fall back to Gemini-only reasoning.
 */
export class MetaRateLimitError extends Error {
  readonly statusCode = RATE_LIMIT_ERROR;
  constructor(message = 'Meta API Application request limit reached.') {
    super(message);
    this.name = 'MetaRateLimitError';
  }
}

// ─── Shared consecutive-403 counter ──────────────────────────────────────────
// Tracks how many Meta requests in a row failed with HTTP 403 across the
// lifetime of a single batch. When it hits 3, callers trigger the UI modal.
let consecutiveMeta403Count = 0;

/** Return current consecutive-403 count and reset the counter. */
export function consumeConsecutive403Count(): number {
  const count = consecutiveMeta403Count;
  consecutiveMeta403Count = 0;
  return count;
}

export function incrementConsecutive403() {
  consecutiveMeta403Count++;
}

export function resetConsecutive403() {
  consecutiveMeta403Count = 0;
}

// ─── Fixed category list ─────────────────────────────────────────────────────

export const VALID_CATEGORIES = [
  'Food & Culinary',
  'Fashion & Style',
  'Beauty & Makeup',
  'Tech & Gaming',
  'Fitness & Wellness',
  'Travel & Lifestyle',
  'Entertainment & Comedy',
  'Business & Finance',
  'Lifestyle & Vlogging',
  'Luxury & Watches',
] as const;

export type ValidCategory = (typeof VALID_CATEGORIES)[number];

const FINAL_FALLBACK: ValidCategory = 'Lifestyle & Vlogging';

// ─── Keyword dictionary for fallback ─────────────────────────────────────────

interface KeywordRule {
  keywords: string[];
  category: ValidCategory;
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    keywords: ['food', 'bhukkad', 'bites', 'cook', 'eats', 'recipe', 'kitchen', 'chef', 'cuisine', 'mukbang', 'street food', 'foodie', 'dining', 'bakery', 'dessert', 'snack'],
    category: 'Food & Culinary',
  },
  {
    keywords: ['fashion', 'slays', 'style', 'outfit', 'ootd', 'clothing', 'wear', 'dress', 'streetwear', 'aesthetic', 'lookbook', 'trendy', 'fit check'],
    category: 'Fashion & Style',
  },
  {
    keywords: ['beauty', 'makeup', 'skincare', 'cosmetics', 'glow', 'glam', 'lipstick', 'foundation', 'hair', 'haircare', 'nail', 'nails'],
    category: 'Beauty & Makeup',
  },
  {
    keywords: ['tech', 'geek', 'gadget', 'review', 'unbox', 'phone', 'laptop', 'gaming', 'esport', 'stream', 'code', 'app', 'ai', 'software', 'crypto', 'nft'],
    category: 'Tech & Gaming',
  },
  {
    keywords: ['fitness', 'gym', 'workout', 'health', 'wellness', 'yoga', 'muscle', 'exercise', 'diet', 'nutrition', 'training', 'athlete', 'run', 'bodybuilding'],
    category: 'Fitness & Wellness',
  },
  {
    keywords: ['travel', 'wanderlust', 'explore', 'adventure', 'trip', 'vacation', 'backpack', 'roadtrip', 'flight', 'hotel', 'destination', 'vlog', 'lifestyle', 'daily'],
    category: 'Travel & Lifestyle',
  },
  {
    keywords: ['comedy', 'funny', 'meme', 'entertainment', 'humor', 'skit', 'parody', 'roast', 'prank', 'laugh', 'joke', 'podcast', 'music', 'dance', 'singer'],
    category: 'Entertainment & Comedy',
  },
  {
    keywords: ['business', 'finance', 'invest', 'money', 'startup', 'entrepreneur', 'stock', 'marketing', 'brand', 'ceo', 'hustle', 'income', 'crypto'],
    category: 'Business & Finance',
  },
  {
    keywords: ['luxury', 'watch', 'watches', 'rolex', 'premium', 'expensive', 'bling', 'jewelry', 'gold', 'diamond', 'supercar', 'lamborghini', 'ferrari'],
    category: 'Luxury & Watches',
  },
];

/**
 * Keyword-based classification. Never returns the handle string itself.
 */
export function classifyByKeywords(text: string): ValidCategory {
  const lower = text.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        return rule.category;
      }
    }
  }
  return FINAL_FALLBACK;
}

// ─── Meta Graph API: fetch bio + captions (via batching service) ───────────────

interface MetaCreatorContext {
  bio: string;
  captions: string[];
}

/**
 * Fetch biography and recent post captions from the Instagram Graph API.
 * Uses the batching service with cache lookup (7-day TTL) and circuit breaker
 * fallback to Gemini. Returns null if all sources fail.
 */
export async function fetchMetaCreatorContext(
  handle: string,
): Promise<MetaCreatorContext | null> {
  const normalized = handle.trim().toLowerCase().replace(/^@/, '');

  const result = await fetchCreatorMetrics([normalized]);

  if (result.metrics.has(normalized)) {
    const metric = result.metrics.get(normalized)!;
    return {
      bio: metric.biography || '',
      captions: metric.recent_captions,
    };
  }

  console.warn(`[classifyCreator] No context found for @${normalized} from any source`);
  return null;
}

// ─── Supabase bio fallback ───────────────────────────────────────────────────

/**
 * Fetch the creator's bio from the local `creators` table (Supabase).
 * Used when Meta API is unavailable.
 */
export async function fetchSupabaseBio(handle: string): Promise<string | null> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from('creators')
      .select('bio')
      .eq('instagram_handle', handle)
      .maybeSingle();
    return data?.bio || null;
  } catch {
    return null;
  }
}

// ─── Gemini classification ───────────────────────────────────────────────────

const GEMINI_MODELS = ['gemini-3.5-flash-lite'];

function buildClassificationPrompt(
  handle: string,
  bio: string,
  captions: string[],
  reelUrl: string | null,
): string {
  const captionsBlock =
    captions.length > 0
      ? captions.slice(0, 5).map((c, i) => `  Caption ${i + 1}: "${c.slice(0, 200)}"`).join('\n')
      : '  (no captions available)';

  return `You are an Instagram creator niche classifier.

Analyze this creator and classify them into EXACTLY ONE content niche from the list below:

${VALID_CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Creator context:
  Handle: @${handle}
  Bio: "${bio || '(no bio)'}"
  Recent post captions:
${captionsBlock}
${reelUrl ? `  Reel URL: ${reelUrl}` : ''}

Return raw JSON only:
{"category": "Exact Category Name from the list above"}`;
}

/**
 * Call Gemini to classify a creator into one of the valid categories.
 * Returns null if Gemini is unavailable or returns an invalid response.
 */
async function classifyWithGemini(
  handle: string,
  bio: string,
  captions: string[],
  reelUrl: string | null,
): Promise<ValidCategory | null> {
  const gemini = getGeminiClient();
  if (!gemini) return null;

  const prompt = buildClassificationPrompt(handle, bio, captions, reelUrl);

  for (const modelName of GEMINI_MODELS) {
    try {
      const response = await gemini.models.generateContent({
        model: modelName,
        contents: prompt,
        config: { responseMimeType: 'application/json', ...DETERMINISTIC_CONFIG },
      });

      const text = (response.text || '').trim();
      let cat = '';

      try {
        const parsed = JSON.parse(text);
        cat = String(parsed.category || '').trim().replace(/^["']|["']$/g, '');
      } catch {
        cat = text.replace(/^["']|["']$/g, '').trim();
      }

      // Validate against allowed categories (case-insensitive match)
      if (cat) {
        const matched = VALID_CATEGORIES.find(
          (vc) => vc.toLowerCase() === cat.toLowerCase(),
        );
        if (matched) return matched;

        // Gemini may return a close variant — accept if it's in the list
        if (VALID_CATEGORIES.some((vc) => vc.toLowerCase().includes(cat.toLowerCase()))) {
          return VALID_CATEGORIES.find((vc) =>
            vc.toLowerCase().includes(cat.toLowerCase()),
          )!;
        }
      }
    } catch (err: any) {
      console.warn(
        `[classifyCreator] Gemini model ${modelName} failed for @${handle}:`,
        err?.message || err,
      );
      if (err?.status === 429) break;
    }
  }

  return null;
}

// ─── Main classification pipeline ────────────────────────────────────────────

export interface ClassifyOptions {
  handle: string;
  reelUrl?: string | null;
  bioOverride?: string | null;
  captionsOverride?: string[];
}

/**
 * Classify a creator into one of the valid content niches.
 *
 * Pipeline:
 *   1. Fetch context from Meta Graph API (bio + captions)
 *   2. If Meta unavailable, fall back to Supabase bio
 *   3. Call Gemini with full context
 *   4. If Gemini fails, use keyword dictionary
 *   5. Final fallback: "Lifestyle & Vlogging"
 *
 * NEVER returns the raw handle string or "General".
 */
export async function classifyCreator(
  options: ClassifyOptions,
): Promise<ValidCategory> {
  const { handle, reelUrl = null, bioOverride, captionsOverride } = options;

  // Step A: Fetch context from Meta Graph API
  let bio = bioOverride || '';
  let captions = captionsOverride || [];

  if (!bio && captions.length === 0) {
    const metaCtx = await fetchMetaCreatorContext(handle);
    if (metaCtx) {
      bio = metaCtx.bio;
      captions = metaCtx.captions;
    }
  }

  // Step B: If still no bio, try Supabase local table
  if (!bio) {
    bio = (await fetchSupabaseBio(handle)) || '';
  }

  // Step C: Call Gemini
  const geminiResult = await classifyWithGemini(handle, bio, captions, reelUrl);
  if (geminiResult) {
    return geminiResult;
  }

  // Step D: Keyword fallback using all available text
  const fallbackText = [handle, bio, ...captions, reelUrl || ''].join(' ');
  const keywordResult = classifyByKeywords(fallbackText);

  console.warn(
    `[classifyCreator] @${handle} — using keyword fallback → "${keywordResult}"`,
  );
  return keywordResult;
}

/**
 * Batch-classify multiple creators. Returns a Map of handle → category.
 */
export async function classifyCreatorsBatch(
  items: Array<{ handle: string; reelUrl?: string | null }>,
): Promise<Map<string, ValidCategory>> {
  const result = new Map<string, ValidCategory>();
  if (items.length === 0) return result;

  // Fetch all Meta contexts in one batch (cache + batch API + Gemini fallback)
  const handles = items.map(i => i.handle.trim().toLowerCase().replace(/^@/, ''));
  const batchResult = await fetchCreatorMetrics(handles);

  // Build contexts from batch results
  const contexts: Array<{ handle: string; reelUrl?: string | null; bio: string; captions: string[] }> = [];

  for (const item of items) {
    const normalized = item.handle.trim().toLowerCase().replace(/^@/, '');
    const metric = batchResult.metrics.get(normalized);

    let bio = '';
    let captions: string[] = [];

    if (metric) {
      bio = metric.biography || '';
      captions = metric.recent_captions || [];
    }

    // Fallback to Supabase bio if Meta didn't provide one
    if (!bio) {
      bio = (await fetchSupabaseBio(normalized)) || '';
    }

    contexts.push({ handle: normalized, reelUrl: item.reelUrl, bio, captions });
  }

  const gemini = getGeminiClient();

  if (!gemini) {
    // Gemini unavailable — use keyword fallback for all
    for (const ctx of contexts) {
      const text = [ctx.handle, ctx.bio, ...ctx.captions, ctx.reelUrl || ''].join(' ');
      result.set(ctx.handle, classifyByKeywords(text));
    }
    return result;
  }

  // Build a batch prompt
  const creatorLines = contexts.map((ctx, i) => {
    const parts = [`@${ctx.handle}`];
    if (ctx.bio) parts.push(`bio: "${ctx.bio.slice(0, 150)}"`);
    if (ctx.captions.length > 0) {
      parts.push(`captions: ${ctx.captions.slice(0, 3).map((c: string) => `"${c.slice(0, 80)}"`).join(', ')}`);
    }
    if (ctx.reelUrl) parts.push(`reel: ${ctx.reelUrl}`);
    return `${i + 1}. ${parts.join(' — ')}`;
  });

  const prompt = `You are an Instagram creator niche classifier. For each creator below, classify into EXACTLY ONE content niche from this list:

${VALID_CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Creators:
${creatorLines.join('\n')}

Reply as JSON: {"categories": ["Cat1", "Cat2", ...]} with exactly ${contexts.length} strings, one per creator in order.
Each value MUST be one of the categories listed above. Return ONLY valid JSON.`;

  for (const modelName of GEMINI_MODELS) {
    try {
      const response = await gemini.models.generateContent({
        model: modelName,
        contents: prompt,
        config: { responseMimeType: 'application/json', ...DETERMINISTIC_CONFIG },
      });

      const text = (response.text || '{}').trim();
      const parsed = JSON.parse(text);
      const arr = Array.isArray(parsed) ? parsed : parsed.categories || [];

      if (Array.isArray(arr) && arr.length === contexts.length) {
        for (let i = 0; i < contexts.length; i++) {
          let cat = String(arr[i] || '').trim().replace(/^["']|["']$/g, '');
          // Validate against allowed categories
          const matched = VALID_CATEGORIES.find(
            (vc) => vc.toLowerCase() === cat.toLowerCase(),
          );
          if (matched) {
            result.set(contexts[i].handle, matched);
          } else {
            // Keyword fallback for this creator
            const text = [contexts[i].handle, contexts[i].bio, ...contexts[i].captions].join(' ');
            result.set(contexts[i].handle, classifyByKeywords(text));
          }
        }
        return result;
      }
    } catch (err: any) {
      console.warn(
        `[classifyCreator] Batch Gemini model ${modelName} failed:`,
        err?.message || err,
      );
      if (err?.status === 429) break;
    }
  }

  // Gemini batch failed — keyword fallback for all
  for (const ctx of contexts) {
    const text = [ctx.handle, ctx.bio, ...ctx.captions, ctx.reelUrl || ''].join(' ');
    result.set(ctx.handle, classifyByKeywords(text));
  }
  return result;
}
