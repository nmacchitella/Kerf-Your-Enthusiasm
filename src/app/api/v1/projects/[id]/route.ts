import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { projects, stocks, cuts } from '@/db/schema';
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

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.userId, session.user.id)),
    with: {
      stocks: true,
      cuts: true,
    },
  });

  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(project);
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
  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.userId, session.user.id)),
  });

  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Update project metadata
  const [updated] = await db
    .update(projects)
    .set({
      name: body.name ?? existing.name,
      description: body.description ?? existing.description,
      kerf: body.kerf ?? existing.kerf,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, id))
    .returning();

  // If stocks were provided, replace them
  if (body.stocks) {
    await db.delete(stocks).where(eq(stocks.projectId, id));
    if (body.stocks.length) {
      await db.insert(stocks).values(
        body.stocks.map((s: { name: string; l: number; w: number; qty: number; mat: string }, i: number) => ({
          projectId: id,
          name: s.name,
          length: s.l,
          width: s.w,
          quantity: s.qty,
          material: s.mat,
          sortOrder: i,
        }))
      );
    }
  }

  // If cuts were provided, replace them
  if (body.cuts) {
    await db.delete(cuts).where(eq(cuts.projectId, id));
    if (body.cuts.length) {
      await db.insert(cuts).values(
        body.cuts.map((c: { label: string; l: number; w: number; qty: number; mat: string }, i: number) => ({
          projectId: id,
          label: c.label,
          length: c.l,
          width: c.w,
          quantity: c.qty,
          material: c.mat || '',
          sortOrder: i,
        }))
      );
    }
  }

  // Fetch complete project
  const completeProject = await db.query.projects.findFirst({
    where: eq(projects.id, id),
    with: {
      stocks: true,
      cuts: true,
    },
  });

  return NextResponse.json(completeProject);
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
  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.userId, session.user.id)),
  });

  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Delete project (cascades to stocks and cuts)
  await db.delete(projects).where(eq(projects.id, id));

  return new NextResponse(null, { status: 204 });
}
