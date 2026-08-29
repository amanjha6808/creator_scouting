import { NextResponse } from 'next/server';
import {
  tripCircuitBreaker,
  getCircuitBreakerStatus,
  resetCircuitBreaker,
} from '@/lib/circuitBreaker';

/**
 * POST /api/circuit-breaker/test — Manually trips the circuit breaker for testing.
 *
 * Usage:
 *   curl -X POST http://localhost:3000/api/circuit-breaker/test
 *   → Trips the breaker, all subsequent Meta calls will use Gemini fallback
 *
 *   curl -X POST http://localhost:3000/api/circuit-breaker/test -d '{"action":"reset"}'
 *   → Resets the breaker early
 *
 *   curl http://localhost:3000/api/circuit-breaker/test
 *   → Returns current status
 */
export async function GET() {
  const status = getCircuitBreakerStatus();
  return NextResponse.json({
    message: status.isOpen
      ? 'Circuit breaker is OPEN — Meta API calls are blocked'
      : 'Circuit breaker is CLOSED — Meta API calls are allowed',
    ...status,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    if (body.action === 'reset') {
      resetCircuitBreaker();
      return NextResponse.json({
        success: true,
        message: 'Circuit breaker manually reset — Meta API calls re-enabled',
        ...getCircuitBreakerStatus(),
      });
    }

    // Default: trip the breaker
    tripCircuitBreaker();
    return NextResponse.json({
      success: true,
      message: 'Circuit breaker tripped — Meta API calls now blocked for 20 minutes. Run a campaign to see Gemini fallback in action.',
      ...getCircuitBreakerStatus(),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}
