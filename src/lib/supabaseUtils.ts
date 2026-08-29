import { getSupabaseAdmin } from '@/lib/supabaseClient';
import { safeNumeric, safeInt } from '@/lib/parseNumeric';

/**
 * Standard database fields for historical_benchmarks table
 * Used to validate and filter payload before upsert/insert
 */
export const BENCHMARK_FIELDS = [
  'creator_handle',
  'creator_name',
  'content_category',
  'performance_tier',
  'reel_url',
  'performance_notes',
  'views',
  'likes',
  'comments',
  'engagement_rate',
  'profile_link',
  'commercial_cost',
  'cost_per_view',
  'reach_efficiency_pct',
  'roi_rating',
] as const;

export type BenchmarkField = typeof BENCHMARK_FIELDS[number];

/**
 * Sanitizes a benchmark payload for database insertion.
 *
 * - Validates payload keys against standard database fields
 * - Safely formats numeric strings for commercial_cost (stripping currency symbols like ₹, $, commas)
 * - Ensures cost_per_view and reach_efficiency_pct fall back to 0 or null gracefully
 * - If upsert fails with PostgREST code PGRST204 (missing column), dynamically strips invalid property and retries
 */
export async function sanitizeBenchmarkPayload(data: Record<string, any>): Promise<Record<string, any>> {
  // Step 1: Filter to only known database fields
  const sanitized: Record<string, any> = {};

  for (const field of BENCHMARK_FIELDS) {
    if (field in data) {
      sanitized[field] = data[field];
    }
  }

  // Step 2: Sanitize commercial_cost - strip currency symbols and commas
  if ('commercial_cost' in sanitized) {
    let costValue = sanitized.commercial_cost;

    if (typeof costValue === 'string') {
      // Strip currency symbols: ₹, $, €, £, ¥
      costValue = costValue.replace(/[₹$€£¥]/g, '');
      // Strip commas used as thousand separators
      costValue = costValue.replace(/,/g, '');
      // Strip whitespace
      costValue = costValue.trim();
    }

    // Parse to number with safe fallback
    const parsed = safeNumeric(costValue);
    sanitized.commercial_cost = parsed ?? 0;
  }

  // Step 3: Ensure cost_per_view falls back to 0 if missing/invalid
  if (!('cost_per_view' in sanitized) || sanitized.cost_per_view === null || sanitized.cost_per_view === undefined) {
    sanitized.cost_per_view = 0;
  } else {
    const parsed = safeNumeric(sanitized.cost_per_view);
    sanitized.cost_per_view = parsed ?? 0;
  }

  // Step 4: Ensure reach_efficiency_pct falls back to 0 if missing/invalid
  if (!('reach_efficiency_pct' in sanitized) || sanitized.reach_efficiency_pct === null || sanitized.reach_efficiency_pct === undefined) {
    sanitized.reach_efficiency_pct = 0;
  } else {
    const parsed = safeNumeric(sanitized.reach_efficiency_pct);
    sanitized.reach_efficiency_pct = parsed ?? 0;
  }

  // Step 5: Sanitize views, likes, comments with safeInt
  if ('views' in sanitized) {
    sanitized.views = safeInt(sanitized.views, 0);
  }
  if ('likes' in sanitized) {
    sanitized.likes = safeInt(sanitized.likes, 0);
  }
  if ('comments' in sanitized) {
    sanitized.comments = safeInt(sanitized.comments, 0);
  }

  // Step 6: Sanitize engagement_rate
  if ('engagement_rate' in sanitized) {
    const parsed = safeNumeric(sanitized.engagement_rate);
    sanitized.engagement_rate = parsed ?? 0;
  }

  // Step 7: Ensure creator_handle is normalized
  if ('creator_handle' in sanitized && typeof sanitized.creator_handle === 'string') {
    sanitized.creator_handle = sanitized.creator_handle.trim().toLowerCase().replace(/^@/, '');
  }

  return sanitized;
}

/**
 * Performs an upsert with automatic retry on PGRST204 (missing column) errors.
 * Strips invalid columns and retries the operation.
 */
export async function upsertBenchmarkWithRetry(
  rows: Record<string, unknown>[],
  onConflict: string = 'creator_handle'
): Promise<{ data: any[] | null; error: any }> {
  const supabase = getSupabaseAdmin();

  let currentRows = rows;
  let attempt = 0;
  const maxAttempts = 5; // Prevent infinite loops

  while (attempt < maxAttempts) {
    attempt++;

    // Cast to any to avoid strict TypeScript type checking on dynamic columns
    const { data, error } = await supabase
      .from('historical_benchmarks')
      .upsert(currentRows as any, { onConflict })
      .select();

    if (!error) {
      return { data, error: null };
    }

    // Check for PGRST204 - column not found
    if (error.code === 'PGRST204' && error.message.includes('Could not find the')) {
      // Extract column name from error message
      const columnMatch = error.message.match(/Could not find the '([^']+)' column/);
      if (columnMatch) {
        const invalidColumn = columnMatch[1];
        console.warn(`[sanitizeBenchmarkPayload] Column '${invalidColumn}' not found in database, stripping and retrying (attempt ${attempt})`);

        // Strip the invalid column from all rows
        currentRows = currentRows.map(row => {
          const newRow = { ...row };
          delete newRow[invalidColumn];
          return newRow;
        });

        // Also remove from our known fields list to prevent re-adding
        continue;
      }
    }

    // For other errors, return immediately
    return { data: null, error };
  }

  // Max attempts reached
  return { data: null, error: new Error('Max retry attempts reached for upsert') };
}

/**
 * Validates that all required fields are present in the payload
 */
export function validateBenchmarkPayload(data: Record<string, any>): { valid: boolean; missing: string[] } {
  const required: BenchmarkField[] = ['creator_handle', 'performance_tier'];
  const missing = required.filter(field => !(field in data) || data[field] === null || data[field] === undefined);

  return {
    valid: missing.length === 0,
    missing,
  };
}

// ─── Analyses payload sanitizer & resilient upsert ──────────────────────────

/**
 * Builds a safe insertion object for the `public.analyses` table.
 *
 * Maps the Gemini evidence reasoning to BOTH database keys
 * (`scoring_reasoning` and `post_evidence_reasoning`) so it works regardless of
 * which column name the live schema uses. The reasoning text is guaranteed to
 * be a non-empty string (never null/undefined) to avoid PostgREST 23502 NOT
 * NULL constraint errors. `updated_at` is included for schemas that have it;
 * the PGRST204 stripper in upsertAnalysesWithRetry drops unknown columns
 * automatically, so adding it here is safe and non-spammy.
 */
export function buildAnalysisPayload(
  campaignId: string,
  creatorId: string,
  score: number,
  reasoning: string | null | undefined,
): Record<string, any> {
  // Accept either key name (some callers pass result.reasoning, others
  // result.post_evidence_reasoning) and never let it be null/undefined.
  const reasoningText =
    (reasoning && String(reasoning).trim()) ||
    'No evidence provided';

  return {
    campaign_id: campaignId,
    creator_id: creatorId,
    overall_relevance_score: score ?? 0,
    scoring_reasoning: reasoningText,
    post_evidence_reasoning: reasoningText,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Extracts the missing column name from a PostgREST PGRST204 error message
 * ("Could not find the 'X' column of ..."). Returns null if not a PGRST204
 * or the column can't be parsed.
 */
function getPgrst204MissingColumn(error: any): string | null {
  if (!error || error.code !== 'PGRST204' || typeof error.message !== 'string') {
    return null;
  }
  const match = error.message.match(/Could not find the '([^']+)' column/);
  return match ? match[1] : null;
}

/**
 * Strips every column in `cols` from each row, leaving only the surviving
 * properties. Used to drop schema-mismatched fields on PGRST204 one retry at a
 * time (bounded, so no infinite retry spam).
 */
function stripColumns(
  rows: Record<string, unknown>[],
  cols: string[],
): Record<string, any>[] {
  return rows.map((row) => {
    const next: Record<string, any> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!cols.includes(key)) next[key] = value;
    }
    return next;
  });
}

/**
 * Clean fallback for upsert: if .upsert() fails on ON CONFLICT, perform a
 * manual 2-step process:
 *   1. select('id').eq('campaign_id').eq('creator_id') to check existence
 *   2. update() if found, insert() if missing
 *
 * The reasoning text is written to BOTH `scoring_reasoning` and
 * `post_evidence_reasoning` so it lands regardless of schema variant. Any
 * missing column reported via PGRST204 is stripped and retried once, so the
 * primary score record ALWAYS persists.
 *
 * Object properties match existing columns. Extra fields (scoring_reasoning /
 * post_evidence_reasoning / updated_at) are sent intentionally and stripped
 * automatically if the live schema lacks them (no retry spam — one strip per
 * distinct missing column).
 */
async function upsertAnalysesWithManualFallback(
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<{ data: any[] | null; error: any }> {
  const supabase = getSupabaseAdmin();
  const results: any[] = [];

  for (const row of rows) {
    const campaignId = row.campaign_id as string;
    const creatorId = row.creator_id as string;
    const reasoningText =
      (row.scoring_reasoning as string) ||
      (row.post_evidence_reasoning as string) ||
      'No evidence provided';

    try {
      // Step 1: check if record exists
      const { data: existing, error: selectErr } = await supabase
        .from('analyses')
        .select('id')
        .eq('campaign_id', campaignId)
        .eq('creator_id', creatorId)
        .limit(1);

      if (selectErr) {
        console.error('[upsertAnalysesWithRetry] select error:', selectErr);
        return { data: null, error: selectErr };
      }

      if (existing && existing.length > 0) {
        // Step 2a: update if found
        try {
          const { data: updated, error: updateErr } = await supabase
            .from('analyses')
            .update({
              overall_relevance_score: row.overall_relevance_score as number,
              scoring_reasoning: reasoningText,
              post_evidence_reasoning: reasoningText,
            } as any)
            .eq('campaign_id', campaignId)
            .eq('creator_id', creatorId)
            .select();

          if (updateErr) {
            const missingCol = getPgrst204MissingColumn(updateErr);
            if (missingCol) {
              console.warn(
                `[upsertAnalysesWithRetry] '${missingCol}' column missing on update — stripping and retrying core fields.`,
              );
              const { data: updatedCore, error: updateCoreErr } = await supabase
                .from('analyses')
                .update({
                  overall_relevance_score: row.overall_relevance_score as number,
                  [missingCol === 'scoring_reasoning' ? 'post_evidence_reasoning' : 'scoring_reasoning']: reasoningText,
                } as any)
                .eq('campaign_id', campaignId)
                .eq('creator_id', creatorId)
                .select();

              if (updateCoreErr) {
                console.error('[upsertAnalysesWithRetry] update (core) error:', updateCoreErr);
                return { data: null, error: updateCoreErr };
              }
              if (updatedCore && updatedCore[0]) results.push(updatedCore[0]);
            } else {
              console.error('[upsertAnalysesWithRetry] update error:', updateErr);
              return { data: null, error: updateErr };
            }
          } else if (updated && updated[0]) {
            results.push(updated[0]);
          }
        } catch (err) {
          console.error('[upsertAnalysesWithRetry] update exception:', err);
          return { data: null, error: err };
        }
      } else {
        // Step 2b: insert if missing — build with both reasoning keys
        const insertRow = {
          campaign_id: row.campaign_id as string,
          creator_id: row.creator_id as string,
          overall_relevance_score: row.overall_relevance_score as number,
          scoring_reasoning: reasoningText,
          post_evidence_reasoning: reasoningText,
          updated_at: new Date().toISOString(),
        };

        try {
          const { data: inserted, error: insertErr } = await supabase
            .from('analyses')
            .insert(insertRow as any)
            .select();

          if (insertErr) {
            const missingCol = getPgrst204MissingColumn(insertErr);
            if (missingCol) {
              console.warn(
                `[upsertAnalysesWithRetry] '${missingCol}' column missing on insert — stripping and retrying.`,
              );
              const { data: insertedCore, error: insertCoreErr } = await supabase
                .from('analyses')
                .insert(stripColumns([insertRow], [missingCol])[0])
                .select();

              if (insertCoreErr) {
                console.error('[upsertAnalysesWithRetry] insert (core) error:', insertCoreErr);
                return { data: null, error: insertCoreErr };
              }
              if (insertedCore && insertedCore[0]) results.push(insertedCore[0]);
            } else {
              console.error('[upsertAnalysesWithRetry] insert error:', insertErr);
              return { data: null, error: insertErr };
            }
          } else if (inserted && inserted[0]) {
            results.push(inserted[0]);
          }
        } catch (err) {
          console.error('[upsertAnalysesWithRetry] insert exception:', err);
          return { data: null, error: err };
        }
      }
    } catch (err) {
      console.error('[upsertAnalysesWithRetry] manual fallback exception:', err);
      return { data: null, error: err };
    }
  }

  return { data: results, error: null };
}

/**
 * Upserts analysis rows into `public.analyses` with a clean, schema-tolerant
 * fallback path.
 *
 * 1. First attempt: .upsert() with onConflict: 'campaign_id, creator_id'.
 *    The payload carries BOTH reasoning keys (scoring_reasoning,
 *    post_evidence_reasoning) plus updated_at so it works on any schema
 *    variant. If Supabase reports a PGRST204 missing column, that column is
 *    stripped from the rows and the upsert is retried (bounded retries — one
 *    per distinct missing column — so there is no retry spam).
 * 2. If the upsert still fails (ON CONFLICT edge case, or a non-PGRST204
 *    error), fall back to a manual 2-step select → update/insert process.
 *
 * The primary analysis record ALWAYS persists: even if every optional text/
 * timestamp column is missing from the live schema, the core
 * `{ campaign_id, creator_id, overall_relevance_score }` is written, so
 * campaign scores still populate in the UI.
 */
export async function upsertAnalysesWithRetry(
  rows: Record<string, unknown>[],
  onConflict: string = 'campaign_id, creator_id',
): Promise<{ data: any[] | null; error: any }> {
  if (!rows || rows.length === 0) {
    return { data: [], error: null };
  }

  const supabase = getSupabaseAdmin();

  // Attempt 1: Direct upsert (with PGRST204 missing-column recovery)
  let currentRows = rows.map((row) => ({ ...row }));
  const strippedColumns = new Set<string>();
  const maxColumnStrips = 6; // core fields + scoring_reasoning + post_evidence_reasoning + updated_at

  for (let attempt = 0; attempt <= maxColumnStrips; attempt++) {
    try {
      const { data, error } = await supabase
        .from('analyses')
        .upsert(currentRows as any, { onConflict })
        .select();

      if (!error) {
        return { data, error: null };
      }

      // PGRST204 — a referenced column does not exist on the live table.
      // Strip that ONE column and retry (bounded, so no spam).
      const missingCol = getPgrst204MissingColumn(error);
      if (missingCol && !strippedColumns.has(missingCol) && attempt < maxColumnStrips) {
        strippedColumns.add(missingCol);
        console.warn(
          `[upsertAnalysesWithRetry] Column '${missingCol}' not found in database — stripping and retrying upsert (attempt ${attempt + 1}).`,
        );
        currentRows = stripColumns(currentRows, [missingCol]);
        continue;
      }

      // Any other error (e.g. 23502 NOT NULL on a required field) → manual path
      console.warn(
        `[upsertAnalysesWithRetry] Upsert failed (code: ${error?.code || 'unknown'}), falling back to manual select/update/insert:`,
        error?.message || error,
      );
      break;
    } catch (err) {
      console.warn('[upsertAnalysesWithRetry] Upsert threw, falling back to manual path:', err);
      break;
    }
  }

  // Attempt 2: Manual select → update/insert fallback (also PGRST204-safe)
  return upsertAnalysesWithManualFallback(rows, onConflict);
}