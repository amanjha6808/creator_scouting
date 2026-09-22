import { NextResponse } from 'next/server';
import { refreshStaleReelMetrics } from '@/lib/reelMetrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const expectedSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');
  if (!expectedSecret || authorization !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const results = await refreshStaleReelMetrics();
    const failed = results.filter(result => result.error).length;
    return NextResponse.json({ refreshed: results.length, failed });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Refresh failed.' }, { status: 500 });
  }
}
