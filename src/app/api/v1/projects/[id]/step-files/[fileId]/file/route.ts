import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { projectStepFiles, projects } from '@/db/schema';
import { getDevSession } from '@/lib/dev-session';
import { readPersistedProjectStepFile } from '@/server/project-step-files';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const session = getDevSession();
  const { id, fileId } = await params;

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.userId, session.user.id)),
  });
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const stepFile = await db.query.projectStepFiles.findFirst({
    where: and(eq(projectStepFiles.projectId, id), eq(projectStepFiles.id, fileId)),
  });
  if (!stepFile) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const buffer = await readPersistedProjectStepFile(stepFile.storagePath);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${stepFile.filename}"`,
      },
    });
  } catch {
    return NextResponse.json({ detail: 'Stored STEP file is missing' }, { status: 404 });
  }
}
