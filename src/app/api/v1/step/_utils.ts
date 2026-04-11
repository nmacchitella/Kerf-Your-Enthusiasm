import { NextResponse } from 'next/server';

export const FASTAPI = process.env.FASTAPI_URL ?? 'http://localhost:8000';

export async function readJsonResponse(
  upstream: Response,
  fallbackDetail: string
): Promise<NextResponse> {
  const payload = await upstream.json().catch(() => ({ detail: fallbackDetail }));
  return NextResponse.json(payload, { status: upstream.status });
}

export function stepBackendUnavailable(message: string): NextResponse {
  return NextResponse.json({ detail: message }, { status: 502 });
}
