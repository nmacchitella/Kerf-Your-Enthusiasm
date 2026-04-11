import { NextRequest } from 'next/server';

import { FASTAPI, readJsonResponse, stepBackendUnavailable } from '../../_utils';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  try {
    const upstream = await fetch(`${FASTAPI}/session/${sessionId}/bodies`);
    return readJsonResponse(upstream, 'Failed to load STEP bodies');
  } catch {
    return stepBackendUnavailable('STEP backend unavailable');
  }
}
