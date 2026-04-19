import { NextResponse } from 'next/server';

import { FASTAPI, readJsonResponse, stepBackendUnavailable } from '../../_utils';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  try {
    const upstream = await fetch(`${FASTAPI}/session/${sessionId}/file`);
    if (!upstream.ok) {
      return readJsonResponse(upstream, 'Failed to download STEP file');
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
        'Content-Disposition': upstream.headers.get('content-disposition') ?? `attachment; filename="${sessionId}.step"`,
      },
    });
  } catch {
    return stepBackendUnavailable('STEP backend unavailable');
  }
}
