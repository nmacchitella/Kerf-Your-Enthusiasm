import { NextRequest, NextResponse } from 'next/server';
import { getDevSession } from '@/lib/dev-session';
import { db } from '@/db';
import { projects, cuts } from '@/db/schema';
import { eq, and, max } from 'drizzle-orm';
import { getStepCutDedupKey } from '@/server/projects';

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
    stepFileId?: string;
    stepSessionId?: string; stepBodyIndex?: number; stepFaceIndex?: number;
  }[] = body.cuts ?? [];

  if (!newCuts.length) {
    return NextResponse.json({ added: 0 });
  }

  const existingStepCuts = await db.query.cuts.findMany({
    where: eq(cuts.projectId, id),
    columns: {
      stepFileId: true,
      stepSessionId: true,
      stepBodyIndex: true,
      stepFaceIndex: true,
    },
  });

  const existingStepKeys = new Set(
    existingStepCuts
      .map((cut) => getStepCutDedupKey(cut))
      .filter((key): key is string => Boolean(key))
  );

  const dedupedCuts = newCuts.filter((cut) => {
    const key = getStepCutDedupKey(cut);
    if (!key) {
      return true;
    }
    if (existingStepKeys.has(key)) {
      return false;
    }

    existingStepKeys.add(key);
    return true;
  });

  if (!dedupedCuts.length) {
    return NextResponse.json({ added: 0, skipped: newCuts.length }, { status: 200 });
  }

  // Find current max sortOrder so appended items follow existing ones
  const [{ maxOrder }] = await db
    .select({ maxOrder: max(cuts.sortOrder) })
    .from(cuts)
    .where(eq(cuts.projectId, id));

  const startOrder = (maxOrder ?? -1) + 1;

  await db.insert(cuts).values(
    dedupedCuts.map((c, i) => ({
      projectId: id,
      label: c.label,
      length: c.l,
      width: c.w,
      thickness: c.t ?? 0,
      quantity: c.qty,
      material: c.mat || '',
      groupName: c.group || '',
      stepFileId: c.stepFileId ?? null,
      stepSessionId: c.stepSessionId ?? null,
      stepBodyIndex: c.stepBodyIndex ?? null,
      stepFaceIndex: c.stepFaceIndex ?? null,
      sortOrder: startOrder + i,
    }))
  );

  return NextResponse.json(
    { added: dedupedCuts.length, skipped: newCuts.length - dedupedCuts.length },
    { status: 201 }
  );
}
