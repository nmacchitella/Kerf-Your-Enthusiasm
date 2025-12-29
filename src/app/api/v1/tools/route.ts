import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { tools } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';
import { headers } from 'next/headers';

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
