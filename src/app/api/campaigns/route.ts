import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseClient';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing campaign id' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Fetch the campaign
    const { data: campaign, error: campErr } = await supabaseAdmin
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .single();

    if (campErr) {
      console.error('[API Campaign GET] Error fetching campaign:', {
        message: campErr.message,
        details: campErr.details,
        hint: campErr.hint,
        code: campErr.code,
      });
      return NextResponse.json({ error: `Failed to load campaign: ${campErr.message}` }, { status: 500 });
    }

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Fetch analyses joined with creators using correct PostgREST syntax
    const { data: analyses, error: anaErr } = await supabaseAdmin
      .from('analyses')
      .select(`
        id,
        overall_relevance_score,
        post_evidence_reasoning,
        created_at,
        creator_id,
        creators (
          id,
          instagram_handle,
          name,
          followers_count,
          avg_engagement_rate,
          bio
        )
      `)
      .eq('campaign_id', id)
      .order('overall_relevance_score', { ascending: false });

    if (anaErr) {
      console.error('[API Campaign GET] Error fetching analyses:', {
        message: anaErr.message,
        details: anaErr.details,
        hint: anaErr.hint,
        code: anaErr.code,
      });

      // Fallback: fetch analyses without join, then fetch creators separately
      console.warn('[API Campaign GET] Falling back to two-step query...');

      const { data: rawAnalyses, error: rawErr } = await supabaseAdmin
        .from('analyses')
        .select('id, overall_relevance_score, post_evidence_reasoning, created_at, creator_id')
        .eq('campaign_id', id)
        .order('overall_relevance_score', { ascending: false });

      if (rawErr) {
        console.error('[API Campaign GET] Fallback raw analyses fetch failed:', {
          message: rawErr.message,
          details: rawErr.details,
          hint: rawErr.hint,
          code: rawErr.code,
        });
        return NextResponse.json({ error: `Failed to load analyses: ${rawErr.message}` }, { status: 500 });
      }

      if (!rawAnalyses || rawAnalyses.length === 0) {
        return NextResponse.json({ campaign, analyses: [] });
      }

      // Collect unique creator_ids and fetch creators
      const creatorIds = [...new Set(rawAnalyses.map((a: any) => a.creator_id).filter(Boolean))];

      let creatorsMap = new Map<string, any>();
      if (creatorIds.length > 0) {
        const { data: creatorsData, error: creatorsErr } = await supabaseAdmin
          .from('creators')
          .select('id, instagram_handle, name, followers_count, avg_engagement_rate, bio')
          .in('id', creatorIds);

        if (creatorsErr) {
          console.error('[API Campaign GET] Fallback creators fetch failed:', {
            message: creatorsErr.message,
            details: creatorsErr.details,
            hint: creatorsErr.hint,
            code: creatorsErr.code,
          });
        }

        if (creatorsData) {
          creatorsMap = new Map(creatorsData.map((c: any) => [c.id, c]));
        }
      }

      // Merge in memory
      const merged = rawAnalyses
        .map((item: any) => {
          const creator = creatorsMap.get(item.creator_id);
          if (!creator) return null;
          return {
            id: item.id,
            overall_relevance_score: item.overall_relevance_score,
            post_evidence_reasoning: item.post_evidence_reasoning,
            created_at: item.created_at,
            creator_id: item.creator_id,
            creators: creator,
          };
        })
        .filter(Boolean);

      return NextResponse.json({ campaign, analyses: merged });
    }

    return NextResponse.json({
      campaign,
      analyses: analyses || [],
    });
  } catch (err: any) {
    console.error('[API Campaign GET] Unhandled error:', {
      message: err.message,
      stack: err.stack,
    });
    return NextResponse.json({ error: err.message || 'Failed to fetch campaign' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing campaign id' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { error } = await supabaseAdmin
      .from('campaigns')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting campaign:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deletedId: id });
  } catch (err: any) {
    console.error('API /api/campaigns DELETE error:', err);
    return NextResponse.json({ error: err.message || 'Failed to delete campaign' }, { status: 500 });
  }
}
