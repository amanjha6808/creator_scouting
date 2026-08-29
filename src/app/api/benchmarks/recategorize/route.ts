import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseClient';
import { classifyCreator, MetaTokenExpiredError, VALID_CATEGORIES } from '@/lib/classifyCreator';
import { tokenExpiredResponse } from '@/lib/metaTokenError';

// ─── Route handler ────────────────────────────────────────────────────────────

const BATCH_SIZE = 25;

export async function POST() {
  try {
    const supabase = getSupabaseAdmin();

    // Fetch all rows that need re-categorization:
    // - content_category IS NULL
    // - content_category = 'General'
    // - content_category is NOT in the valid category list (catches pseudo-categories
    //   like "Delhifoodcrush1", "Ankanaaaa", etc.)
    const validCategoryList = VALID_CATEGORIES.map((c) => `'${c}'`).join(',');
    const { data: rows, error: fetchError } = await supabase
      .from('historical_benchmarks')
      .select('id, creator_handle, reel_url, performance_notes, content_category')
      .or(`content_category.is.null,content_category.eq.General`);

    if (fetchError) {
      console.error('[Recategorize] Fetch error:', fetchError);
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    // Also fetch all rows and filter client-side for pseudo-categories not in the valid list
    const allResult = await supabase
      .from('historical_benchmarks')
      .select('id, creator_handle, reel_url, performance_notes, content_category');

    const validSet = new Set(VALID_CATEGORIES.map((c) => c.toLowerCase()));
    const allRows = allResult.data || [];

    // Combine: rows from the OR filter + rows with pseudo-categories
    const rowMap = new Map<string, any>();
    for (const r of (rows || [])) rowMap.set(r.id, r);
    for (const r of allRows) {
      if (!validSet.has((r.content_category || '').toLowerCase())) {
        rowMap.set(r.id, r);
      }
    }

    const rowsToFix = Array.from(rowMap.values());

    if (rowsToFix.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All rows already have valid categories.',
        updated: 0,
      });
    }

    console.log(`[Recategorize] Found ${rowsToFix.length} row(s) to re-categorize`);

    let updated = 0;
    let failed = 0;

    // Process in batches
    for (let i = 0; i < rowsToFix.length; i += BATCH_SIZE) {
      const batch = rowsToFix.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (row) => {
          const newCategory = await classifyCreator({
            handle: row.creator_handle,
            reelUrl: row.reel_url,
          });

          const { error: updateError } = await supabase
            .from('historical_benchmarks')
            .update({ content_category: newCategory })
            .eq('id', row.id);

          if (updateError) {
            console.error(
              `[Recategorize] Update failed for @${row.creator_handle}:`,
              updateError.message,
            );
            throw updateError;
          }

          console.log(
            `[Recategorize] @${row.creator_handle}: "${row.content_category}" → "${newCategory}"`,
          );
          return { handle: row.creator_handle, old: row.content_category, new: newCategory };
        }),
      );

      // Check for token expiry in batch results
      for (const r of results) {
        if (r.status === 'rejected') {
          const err = r.reason;
          if (err instanceof MetaTokenExpiredError || err?.statusCode === 'TOKEN_EXPIRED' || err?.name === 'MetaTokenExpiredError') {
            console.error('[Recategorize] TOKEN_EXPIRED detected — aborting batch');
            return NextResponse.json(tokenExpiredResponse(), { status: 401 });
          }
          failed++;
        } else {
          updated++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      total: rowsToFix.length,
      updated,
      failed,
    });
  } catch (error: any) {
    console.error('[Recategorize] Unhandled error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 },
    );
  }
}
