import { onJobProgress } from '@/lib/progressTracker';

/**
 * GET /api/benchmarks/bulk-upload-sse?jobId=…
 *
 * Server-Sent Events endpoint that streams real-time progress of a
 * benchmark CSV bulk-upload job. The client opens this connection
 * immediately before (or after) kicking off the POST /api/benchmarks/bulk-upload
 * call, and receives progress events until the job completes.
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
      // SSE headers are set on the Response; here we just write the stream body.
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // Controller closed — client disconnected; stop sending.
        }
      };

      // Subscribe to progress events for this job
      const unsubscribe = onJobProgress(jobId, (event) => {
        send(`data: ${JSON.stringify(event)}\n\n`);
        if (event.done) {
          // Close the stream after a short delay so the final event is delivered
          setTimeout(() => {
            try {
              controller.close();
            } catch {
              // already closed
            }
          }, 200);
        }
      });

      // Send an initial connected event so the client knows the stream is alive
      send(`data: ${JSON.stringify({ percent: 0, status: 'Connected', step: 'Waiting for upload...' })}\n\n`);

      // Cleanup on disconnect
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
