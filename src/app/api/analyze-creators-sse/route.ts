import { onJobProgress } from '@/lib/progressTracker';

/**
 * GET /api/analyze-creators-sse?jobId=…
 *
 * Server-Sent Events endpoint that streams real-time per-creator progress
 * of a campaign analysis job. The client opens this connection immediately
 * before (or after) kicking off the POST /api/analyze-creators call,
 * and receives progress events until the job completes.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return new Response(JSON.stringify({ error: 'jobId query parameter is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // Controller closed — client disconnected
        }
      };

      const unsubscribe = onJobProgress(jobId, (event) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
        if (event.done) {
          setTimeout(() => {
            try {
              controller.close();
            } catch {
              // already closed
            }
          }, 200);
        }
      });

      // Initial connected event
      send(`data: ${JSON.stringify({ percent: 0, status: 'Connected', step: 'Waiting for analysis...' })}\n\n`);

      req.signal?.addEventListener('abort', () => {
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
