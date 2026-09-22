import { getSupabaseAdmin } from './supabaseClient';

const META_API_VERSION = 'v20.0';

export type ReelMetrics = {
  link: string;
  mediaId: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  error?: string;
};

function normalizeUrl(value: string) {
  const url = new URL(value);
  if (!/^(www\.)?instagram\.com$/i.test(url.hostname)) {
    throw new Error('Only instagram.com reel links are supported.');
  }
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function requestJson(url: URL) {
  const response = await fetch(url, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `Meta returned HTTP ${response.status}`);
  return body;
}

/**
 * Retrieves public engagement fields Meta authorizes for a live reel URL.
 * Shares and plays are returned only when Meta includes them for this token.
 */
export async function fetchReelMetrics(rawUrl: string): Promise<ReelMetrics> {
  let link: string;
  try {
    link = normalizeUrl(rawUrl);
  } catch (error) {
    return { link: rawUrl, mediaId: null, views: null, likes: null, comments: null, shares: null, error: error instanceof Error ? error.message : 'Invalid reel URL.' };
  }

  const accessToken = process.env.META_PAGE_ACCESS_TOKEN;
  if (!accessToken) {
    return { link, mediaId: null, views: null, likes: null, comments: null, shares: null, error: 'META_PAGE_ACCESS_TOKEN is not configured.' };
  }

  try {
    const oembedUrl = new URL(`https://graph.facebook.com/${META_API_VERSION}/instagram_oembed`);
    oembedUrl.searchParams.set('url', link);
    oembedUrl.searchParams.set('access_token', accessToken);
    const oembed = await requestJson(oembedUrl);
    const mediaId = String(oembed.media_id || '');
    if (!mediaId) throw new Error('Meta did not return a media ID for this reel.');

    const mediaUrl = new URL(`https://graph.facebook.com/${META_API_VERSION}/${mediaId}`);
    mediaUrl.searchParams.set('fields', 'id,permalink,like_count,comments_count,video_views');
    mediaUrl.searchParams.set('access_token', accessToken);
    const media = await requestJson(mediaUrl);
    const metrics: ReelMetrics = {
      link,
      mediaId,
      views: asNumber(media.video_views),
      likes: asNumber(media.like_count),
      comments: asNumber(media.comments_count),
      shares: asNumber(media.shares_count),
    };

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from('instagram_reel_metrics').upsert({
      reel_url: link,
      media_id: mediaId,
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments,
      shares: metrics.shares,
      fetched_at: new Date().toISOString(),
      last_error: null,
    }, { onConflict: 'reel_url' });
    if (error) console.error('[reelMetrics] Cache write failed:', error.message);
    return metrics;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to fetch metrics from Meta.';
    const supabase = getSupabaseAdmin();
    await supabase.from('instagram_reel_metrics').upsert({
      reel_url: link,
      fetched_at: new Date().toISOString(),
      last_error: message,
    }, { onConflict: 'reel_url' });
    return { link, mediaId: null, views: null, likes: null, comments: null, shares: null, error: message };
  }
}

export async function refreshStaleReelMetrics() {
  const supabase = getSupabaseAdmin();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('instagram_reel_metrics')
    .select('reel_url')
    .lt('fetched_at', cutoff)
    .limit(50);
  if (error) throw new Error(error.message);
  return Promise.all((data || []).map(row => fetchReelMetrics(row.reel_url)));
}
