import { NextResponse } from 'next/server';
import {
  getCircuitBreakerStatus,
  resetCircuitBreaker,
} from '@/lib/circuitBreaker';

/**
 * GET /api/circuit-breaker — Returns current circuit breaker status.
 */
export async function GET() {
  const status = getCircuitBreakerStatus();
  return NextResponse.json(status);
}

/**
 * POST /api/circuit-breaker — Manually resets the circuit breaker.
 * Accepts { action: 'reset' } in the body.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    if (body.action === 'reset') {
      resetCircuitBreaker();
      return NextResponse.json({ success: true, ...getCircuitBreakerStatus() });
    }

    return NextResponse.json(
      { error: 'Unknown action. Send { "action": "reset" } to reset the circuit breaker.' },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed' }, { status: 500 });
  }
}
