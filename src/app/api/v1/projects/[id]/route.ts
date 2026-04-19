import { NextRequest, NextResponse } from 'next/server';
import { getDevSession } from '@/lib/dev-session';
import { db } from '@/db';
import { projects, stocks, cuts, projectStepFiles } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { deletePersistedProjectStepDirectory } from '@/server/project-step-files';
import { dedupeStepCuts, serializeProjectDetail } from '@/server/projects';

type ProjectCutInput = {
  id?: string | null;
  label: string;
  l: number;
  w: number;
  t?: number;
  qty: number;
  mat: string;
  group?: string;
  stepFileId?: string | null;
  stepSessionId?: string | null;
  stepBodyIndex?: number | null;
  stepFaceIndex?: number | null;
};

type ProjectStockInput = {
  id?: string | null;
  name: string;
  l: number;
  w: number;
  t?: number;
  qty: number;
  mat: string;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = getDevSession();

  const { id } = await params;

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.userId, session.user.id)),
    with: {
      stocks: true,
      cuts: true,
      stepFiles: true,
    },
  });

  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json(await serializeProjectDetail(project));
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = getDevSession();

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
  await db
    .update(projects)
    .set({
      name: body.name ?? existing.name,
      description: body.description ?? existing.description,
      kerf: body.kerf ?? existing.kerf,
      units: body.units ?? existing.units,
      groupMultipliers: body.groupMultipliers !== undefined
        ? JSON.stringify(body.groupMultipliers)
        : existing.groupMultipliers,
      layoutOverrides: body.layoutOverrides !== undefined
        ? JSON.stringify(body.layoutOverrides)
        : existing.layoutOverrides,
      layoutExcludedKeys: body.layoutExcludedKeys !== undefined
        ? JSON.stringify(body.layoutExcludedKeys)
        : existing.layoutExcludedKeys,
      layoutPadding: body.layoutPadding ?? existing.layoutPadding,
      layoutHasActive: body.layoutHasActive ?? existing.layoutHasActive,
      stepActiveFileId: body.stepActiveFileId ?? existing.stepActiveFileId,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, id))
    .returning();

  // If stocks were provided, replace them
  if (body.stocks) {
    await db.delete(stocks).where(eq(stocks.projectId, id));
    if (body.stocks.length) {
      await db.insert(stocks).values(
        (body.stocks as ProjectStockInput[]).map((s, i: number) => ({
          id: s.id ?? crypto.randomUUID(),
          projectId: id,
          name: s.name,
          length: s.l,
          width: s.w,
          thickness: s.t ?? 0,
          quantity: s.qty,
          material: s.mat,
          sortOrder: i,
        }))
      );
    }
  }

  // If cuts were provided, replace them
  if (body.cuts) {
    const dedupedCuts = dedupeStepCuts(body.cuts as ProjectCutInput[]);
    await db.delete(cuts).where(eq(cuts.projectId, id));
    if (dedupedCuts.length) {
      await db.insert(cuts).values(
        dedupedCuts.map((c, i: number) => ({
          id: c.id ?? crypto.randomUUID(),
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
      stepFiles: true,
    },
  });

  return NextResponse.json(completeProject ? await serializeProjectDetail(completeProject) : null);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = getDevSession();

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
  await db.delete(projectStepFiles).where(eq(projectStepFiles.projectId, id));
  await deletePersistedProjectStepDirectory(id);

  return new NextResponse(null, { status: 204 });
}
