import { NextResponse } from 'next/server';
import { fetchReelMetrics } from '@/lib/reelMetrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type InputReel = { link?: unknown };

function corsHeaders(request: Request): Record<string, string> {
  const allowedOrigin = process.env.PORTFOLIO_ADMIN_ORIGIN;
  const origin = request.headers.get('origin');
  return allowedOrigin && origin === allowedOrigin
    ? { 'Access-Control-Allow-Origin': allowedOrigin, 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' }
    : {};
}

export function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const reels = Array.isArray(body?.reels) ? body.reels as InputReel[] : [];
    const links = reels.map(reel => typeof reel.link === 'string' ? reel.link.trim() : '').filter(Boolean);
    if (!links.length) return NextResponse.json({ error: 'Provide at least one reel link.' }, { status: 400, headers: corsHeaders(request) });
    if (links.length > 50) return NextResponse.json({ error: 'A maximum of 50 reels can be refreshed at once.' }, { status: 400, headers: corsHeaders(request) });

    const results = await Promise.all(links.map(fetchReelMetrics));
    return NextResponse.json({ reels: results }, { headers: corsHeaders(request) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid request.' }, { status: 400, headers: corsHeaders(request) });
  }
}
