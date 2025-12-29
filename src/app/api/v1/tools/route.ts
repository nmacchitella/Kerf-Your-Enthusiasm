import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { tools } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';
import { headers } from 'next/headers';
import { rateLimit, getClientIP, rateLimitResponse } from '@/lib/rate-limit';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return NextResponse.json([]);
  }

  const userTools = await db.query.tools.findMany({
    where: eq(tools.userId, session.user.id),
    orderBy: [asc(tools.name)],
  });

  return NextResponse.json(userTools);
}

export async function POST(request: NextRequest) {
  // Rate limit: 50 tools per hour per IP
  const ip = getClientIP(request);
  const rl = rateLimit(`tools:create:${ip}`, { limit: 50, windowMs: 3600000 });
  if (!rl.success) {
    return rateLimitResponse(rl.resetIn);
  }

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  const [tool] = await db
    .insert(tools)
    .values({
      userId: session.user.id,
      name: body.name,
      brand: body.brand || '',
      model: body.model || '',
      condition: body.condition || 'good',
      notes: body.notes || '',
      copiedFromId: body.copiedFromId || null,
    })
    .returning();

  return NextResponse.json(tool, { status: 201 });
}
