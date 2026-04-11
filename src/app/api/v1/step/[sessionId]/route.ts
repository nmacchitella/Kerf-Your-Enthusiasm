import { NextRequest } from 'next/server';

import { FASTAPI, readJsonResponse, stepBackendUnavailable } from '../_utils';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  try {
    const upstream = await fetch(`${FASTAPI}/session/${sessionId}`, { method: 'DELETE' });
    return readJsonResponse(upstream, 'Failed to delete STEP session');
  } catch {
    return stepBackendUnavailable('STEP backend unavailable');
  }
}
