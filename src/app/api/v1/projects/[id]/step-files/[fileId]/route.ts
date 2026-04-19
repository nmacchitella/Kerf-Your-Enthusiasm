import { NextRequest, NextResponse } from 'next/server';
import { and, count, eq } from 'drizzle-orm';

import { db } from '@/db';
import { cuts, projectStepFiles, projects } from '@/db/schema';
import { getDevSession } from '@/lib/dev-session';
import {
  clearCachedStepSession,
  deletePersistedProjectStepFile,
  stringifyPersistedStepBodyState,
  type PersistedStepBodyState,
} from '@/server/project-step-files';

async function getOwnedStepFile(projectId: string, fileId: string, userId: string) {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.userId, userId)),
  });
  if (!project) return null;

  const stepFile = await db.query.projectStepFiles.findFirst({
    where: and(eq(projectStepFiles.projectId, projectId), eq(projectStepFiles.id, fileId)),
  });
  if (!stepFile) return null;

  return { project, stepFile };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const session = getDevSession();
  const { id, fileId } = await params;

  const owned = await getOwnedStepFile(id, fileId, session.user.id);
  if (!owned) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const body = await request.json() as {
    filename?: string;
    selectedBodyIndex?: number;
    sortOrder?: number;
    bodyState?: PersistedStepBodyState[];
  };

  const [updated] = await db
    .update(projectStepFiles)
    .set({
      filename: typeof body.filename === 'string' ? body.filename : owned.stepFile.filename,
      selectedBodyIndex:
        typeof body.selectedBodyIndex === 'number'
          ? body.selectedBodyIndex
          : owned.stepFile.selectedBodyIndex,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : owned.stepFile.sortOrder,
      bodyState:
        body.bodyState !== undefined
          ? stringifyPersistedStepBodyState(body.bodyState)
          : owned.stepFile.bodyState,
      updatedAt: new Date(),
    })
    .where(eq(projectStepFiles.id, fileId))
    .returning();

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const session = getDevSession();
  const { id, fileId } = await params;

  const owned = await getOwnedStepFile(id, fileId, session.user.id);
  if (!owned) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(cuts)
    .where(and(eq(cuts.projectId, id), eq(cuts.stepFileId, fileId)));

  if ((total ?? 0) > 0) {
    return NextResponse.json(
      { detail: 'This STEP file is still referenced by cuts in the project.' },
      { status: 409 }
    );
  }

  await db.delete(projectStepFiles).where(eq(projectStepFiles.id, fileId));
  await deletePersistedProjectStepFile(owned.stepFile.storagePath);
  clearCachedStepSession(fileId);

  if (owned.project.stepActiveFileId === fileId) {
    await db
      .update(projects)
      .set({ stepActiveFileId: null, updatedAt: new Date() })
      .where(eq(projects.id, id));
  }

  return new NextResponse(null, { status: 204 });
}
