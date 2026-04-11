import { NextRequest, NextResponse } from 'next/server';

import { FASTAPI, stepBackendUnavailable } from '../_utils';

export async function POST(request: NextRequest) {
  const body = await request.json();
  try {
    const upstream = await fetch(`${FASTAPI}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({ detail: 'Export failed' }));
      return NextResponse.json(err, { status: upstream.status });
    }
    const blob = await upstream.arrayBuffer();
    const filename = upstream.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'export.dxf';
    return new NextResponse(blob, {
      status: 200,
      headers: { 'Content-Type': 'application/dxf', 'Content-Disposition': `attachment; filename="${filename}"` },
    });
  } catch {
    return stepBackendUnavailable('STEP backend unavailable');
  }
}
