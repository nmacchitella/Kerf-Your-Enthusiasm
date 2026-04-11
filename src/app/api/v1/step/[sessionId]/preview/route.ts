import { NextRequest } from 'next/server';

import { FASTAPI, readJsonResponse, stepBackendUnavailable } from '../../_utils';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const body = await request.json();
  try {
    const upstream = await fetch(`${FASTAPI}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, session_id: sessionId }),
    });
    return readJsonResponse(upstream, 'Projection preview failed');
  } catch {
    return stepBackendUnavailable('STEP backend unavailable');
  }
}
