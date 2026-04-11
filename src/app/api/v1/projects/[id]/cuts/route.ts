import { NextRequest, NextResponse } from 'next/server';
import { getDevSession } from '@/lib/dev-session';
import { db } from '@/db';
import { projects, cuts } from '@/db/schema';
import { eq, and, max } from 'drizzle-orm';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = getDevSession();
  const { id } = await params;

  // Verify ownership
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.userId, session.user.id)),
  });
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json();
  const newCuts: {
    label: string; l: number; w: number; t?: number; qty: number; mat: string;
    group?: string;
    stepSessionId?: string; stepBodyIndex?: number; stepFaceIndex?: number;
  }[] = body.cuts ?? [];

  if (!newCuts.length) {
    return NextResponse.json({ added: 0 });
  }

  // Find current max sortOrder so appended items follow existing ones
  const [{ maxOrder }] = await db
    .select({ maxOrder: max(cuts.sortOrder) })
    .from(cuts)
    .where(eq(cuts.projectId, id));

  const startOrder = (maxOrder ?? -1) + 1;

  await db.insert(cuts).values(
    newCuts.map((c, i) => ({
      projectId: id,
      label: c.label,
      length: c.l,
      width: c.w,
      thickness: c.t ?? 0,
      quantity: c.qty,
      material: c.mat || '',
      groupName: c.group || '',
      stepSessionId: c.stepSessionId ?? null,
      stepBodyIndex: c.stepBodyIndex ?? null,
      stepFaceIndex: c.stepFaceIndex ?? null,
      sortOrder: startOrder + i,
    }))
  );

  return NextResponse.json({ added: newCuts.length }, { status: 201 });
}
