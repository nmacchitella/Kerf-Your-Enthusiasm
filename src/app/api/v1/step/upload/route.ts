import { NextRequest } from 'next/server';

import { FASTAPI, readJsonResponse, stepBackendUnavailable } from '../_utils';

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  try {
    const upstream = await fetch(`${FASTAPI}/session/upload`, { method: 'POST', body: formData });
    return readJsonResponse(upstream, 'STEP upload failed');
  } catch {
    return stepBackendUnavailable('STEP backend unavailable');
  }
}
