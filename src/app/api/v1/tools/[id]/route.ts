import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { tools } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { headers } from 'next/headers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const tool = await db.query.tools.findFirst({
    where: and(eq(tools.id, id), eq(tools.userId, session.user.id)),
  });

  if (!tool) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(tool);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();

  // Verify ownership
  const existing = await db.query.tools.findFirst({
    where: and(eq(tools.id, id), eq(tools.userId, session.user.id)),
  });

  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [updated] = await db
    .update(tools)
    .set({
      name: body.name ?? existing.name,
      brand: body.brand ?? existing.brand,
      model: body.model ?? existing.model,
      condition: body.condition ?? existing.condition,
      notes: body.notes ?? existing.notes,
      updatedAt: new Date(),
    })
    .where(eq(tools.id, id))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership
  const existing = await db.query.tools.findFirst({
    where: and(eq(tools.id, id), eq(tools.userId, session.user.id)),
  });

  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await db.delete(tools).where(eq(tools.id, id));

  return new NextResponse(null, { status: 204 });
}
