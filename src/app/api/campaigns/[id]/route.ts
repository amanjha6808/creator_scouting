import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseClient';

/**
 * GET /api/campaigns/[id] — Fetch a single campaign and its analyses.
 *
 * Uses Next.js 15+ async `params` pattern:
 *   { params }: { params: Promise<{ id: string }> }
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    if (!id || id === 'undefined') {
      return NextResponse.json(
        { error: 'Invalid campaign ID provided' },
        { status: 400 },
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Fetch campaign metadata
    const { data: campaign, error: campaignErr } = await supabaseAdmin
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .single();

    if (campaignErr) {
      console.error('[API Campaigns [id] GET Campaign Error]:', {
        message: campaignErr.message,
        details: campaignErr.details,
        hint: campaignErr.hint,
        code: campaignErr.code,
      });
      return NextResponse.json(
        { error: campaignErr.message || 'Failed to load campaign' },
        { status: 500 },
      );
    }

    // Fetch analyses joined with creators
    const { data: analyses, error: analysisErr } = await supabaseAdmin
      .from('analyses')
      .select(
        `
        *,
        creators (
          id,
          instagram_handle,
          name,
          followers_count,
          avg_engagement_rate,
          bio
        )
      `,
      )
      .eq('campaign_id', id)
      .order('overall_relevance_score', { ascending: false });

    if (analysisErr) {
      console.error('[API Campaigns [id] GET Analyses Error]:', {
        message: analysisErr.message,
        details: analysisErr.details,
        hint: analysisErr.hint,
        code: analysisErr.code,
      });
      // Return campaign even if analyses fail
      return NextResponse.json(
        { campaign, analyses: [] },
        { status: 200 },
      );
    }

    return NextResponse.json({ campaign, analyses: analyses || [] }, { status: 200 });
  } catch (err: any) {
    console.error('[API Campaigns [id] GET Catch]:', {
      message: err.message,
      stack: err.stack,
    });
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/campaigns/[id] — Update campaign metadata.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    if (!id || id === 'undefined') {
      return NextResponse.json(
        { error: 'Invalid campaign ID provided' },
        { status: 400 },
      );
    }

    const body = await req.json();
    const { title, brief_description, content_type, red_flags } = body;

    const updateFields: {
      title?: string;
      brief_description?: string;
      content_type?: string;
      red_flags?: string[] | null;
    } = {};
    if (title !== undefined) updateFields.title = title;
    if (brief_description !== undefined) updateFields.brief_description = brief_description;
    if (content_type !== undefined) updateFields.content_type = content_type;
    if (red_flags !== undefined) updateFields.red_flags = red_flags;

    if (Object.keys(updateFields).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data, error } = await supabaseAdmin
      .from('campaigns')
      .update(updateFields)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[API Campaigns [id] PATCH Error]:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to update campaign' },
        { status: 500 },
      );
    }

    return NextResponse.json({ campaign: data });
  } catch (err: any) {
    console.error('[API Campaigns [id] PATCH Catch]:', {
      message: err.message,
    });
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/campaigns/[id] — Delete a campaign and its analyses.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    if (!id || id === 'undefined') {
      return NextResponse.json(
        { error: 'Invalid campaign ID provided' },
        { status: 400 },
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Delete campaign (analyses cascade-delete via FK)
    const { error } = await supabaseAdmin
      .from('campaigns')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[API Campaigns [id] DELETE Error]:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to delete campaign' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, deletedId: id });
  } catch (err: any) {
    console.error('[API Campaigns [id] DELETE Catch]:', {
      message: err.message,
    });
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 },
    );
  }
}
