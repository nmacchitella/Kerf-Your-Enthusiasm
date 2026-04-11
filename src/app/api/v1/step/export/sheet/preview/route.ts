import { NextRequest, NextResponse } from 'next/server';

import { FASTAPI, readJsonResponse, stepBackendUnavailable } from '../../../_utils';

export async function POST(request: NextRequest) {
  const body = await request.json();
  try {
    const upstream = await fetch(`${FASTAPI}/export/sheet/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return readJsonResponse(upstream, 'Sheet preview failed');
  } catch {
    return stepBackendUnavailable('STEP backend unavailable');
  }
}
