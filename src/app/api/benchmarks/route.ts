import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseClient';
import { safeInt, safeNumeric } from '@/lib/parseNumeric';
import { classifyCreator } from '@/lib/classifyCreator';
import { sanitizeBenchmarkPayload, upsertBenchmarkWithRetry } from '@/lib/supabaseUtils';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category') || '';
    const tier = searchParams.get('tier') || '';
    const search = searchParams.get('search') || '';
    const sortBy = searchParams.get('sort') || 'created_at';

    const supabase = getSupabaseAdmin();

    // Map sort options to Supabase order clauses
    let query = supabase.from('historical_benchmarks').select('*');

    switch (sortBy) {
      case 'lowest_cpv':
        query = query.order('cost_per_view', { ascending: true, nullsFirst: true });
        break;
      case 'highest_reach':
        query = query.order('reach_efficiency_pct', { ascending: false, nullsFirst: true });
        break;
      case 'cost_low_to_high':
        query = query.order('commercial_cost', { ascending: true, nullsFirst: true });
        break;
      case 'overpriced':
        query = query.eq('roi_rating', 'Overpriced / Underdelivered').order('cost_per_view', { ascending: false });
        break;
      default:
        query = query.order('created_at', { ascending: false });
    }

    if (category) {
      query = query.ilike('content_category', `%${category}%`);
    }
    if (tier) {
      query = query.eq('performance_tier', tier as 'High Performer' | 'Average' | 'Flop');
    }
    if (search) {
      query = query.or(
        `creator_handle.ilike.%${search}%,creator_name.ilike.%${search}%`
      );
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching benchmarks:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = data || [];

    // Compute summary stats
    const stats = {
      total: rows.length,
      highPerformers: rows.filter((r) => r.performance_tier === 'High Performer').length,
      average: rows.filter((r) => r.performance_tier === 'Average').length,
      flops: rows.filter((r) => r.performance_tier === 'Flop').length,
    };

    // Collect unique categories
    const allCategoriesResult = await supabase
      .from('historical_benchmarks')
      .select('content_category');

    const categories = Array.from(
      new Set((allCategoriesResult.data || []).map((r) => r.content_category))
    ).sort();

    return NextResponse.json({ benchmarks: rows, stats, categories });
  } catch (error: any) {
    console.error('GET /api/benchmarks error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { creator_handle, creator_name, content_category, performance_tier, reel_url, performance_notes } = body;

    if (!creator_handle || !performance_tier) {
      return NextResponse.json(
        { error: 'creator_handle and performance_tier are required' },
        { status: 400 }
      );
    }

    const validTiers = ['High Performer', 'Average', 'Flop'];
    if (!validTiers.includes(performance_tier)) {
      return NextResponse.json(
        { error: `performance_tier must be one of: ${validTiers.join(', ')}` },
        { status: 400 }
      );
    }

    // Auto-classify if category is missing, empty, or 'General'
    const rawCategory = (content_category || '').trim();
    let finalCategory = rawCategory;
    if (!rawCategory || rawCategory.toLowerCase() === 'general') {
      finalCategory = await classifyCreator({
        handle: creator_handle.trim().toLowerCase().replace(/^@/, ''),
        reelUrl: reel_url || null,
      });
    }

    const supabase = getSupabaseAdmin();

    const views = safeInt(body.views, 0);
    const followers = safeInt(body.followers_count, 0);
    const commercialCost = safeNumeric(body.commercial_cost) ?? 0;
    const costPerView = views > 0 && commercialCost > 0
      ? Math.round((commercialCost / views) * 100) / 100
      : 0;
    const reachEfficiencyPct = followers > 0
      ? Math.round((views / followers) * 10000) / 100
      : 0;
    let roiRating = '';
    if (commercialCost > 0) {
      if (costPerView <= 0.50 && reachEfficiencyPct >= 50) roiRating = 'Exceptional ROI';
      else if (costPerView <= 1.50) roiRating = 'Good Value';
      else if (costPerView > 2.00 || (reachEfficiencyPct > 0 && reachEfficiencyPct < 15)) roiRating = 'Overpriced / Underdelivered';
      else roiRating = 'Moderate';
    }

    // Build payload and sanitize before insert
    const payload = {
      creator_handle: creator_handle.trim().toLowerCase().replace(/^@/, ''),
      creator_name: creator_name || null,
      content_category: finalCategory,
      performance_tier,
      reel_url: reel_url || null,
      performance_notes: performance_notes || null,
      views,
      likes: safeInt(body.likes, 0),
      comments: safeInt(body.comments, 0),
      engagement_rate: safeNumeric(body.engagement_rate) ?? 0,
      profile_link: body.profile_link || null,
      commercial_cost: commercialCost,
      cost_per_view: costPerView,
      reach_efficiency_pct: reachEfficiencyPct,
      roi_rating: roiRating,
    };

    const sanitizedPayload = await sanitizeBenchmarkPayload(payload);

    const { data, error } = await upsertBenchmarkWithRetry([sanitizedPayload], 'creator_handle');

    if (error) {
      console.error('Error inserting benchmark:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ benchmark: data }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/benchmarks error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const idsParam = searchParams.get('ids');

    const supabase = getSupabaseAdmin();

    // Bulk delete: ?ids=uuid1,uuid2,uuid3
    if (idsParam) {
      const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) {
        return NextResponse.json({ error: 'ids parameter must contain at least one id' }, { status: 400 });
      }

      const { error } = await supabase
        .from('historical_benchmarks')
        .delete()
        .in('id', ids);

      if (error) {
        console.error('Error bulk deleting benchmarks:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, deleted: ids.length });
    }

    // Single delete: ?id=uuid
    if (id) {
      const { error } = await supabase
        .from('historical_benchmarks')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting benchmark:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'id or ids query parameter is required' }, { status: 400 });
  } catch (error: any) {
    console.error('DELETE /api/benchmarks error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
