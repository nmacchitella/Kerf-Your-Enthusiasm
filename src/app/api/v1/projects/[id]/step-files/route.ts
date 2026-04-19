import { NextRequest, NextResponse } from 'next/server';
import { and, eq, max } from 'drizzle-orm';

import { db } from '@/db';
import { projectStepFiles, projects } from '@/db/schema';
import { getDevSession } from '@/lib/dev-session';
import {
  cacheStepSession,
  persistProjectStepFile,
  stringifyPersistedStepBodyState,
} from '@/server/project-step-files';
import { FASTAPI } from '@/app/api/v1/step/_utils';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = getDevSession();
  const { id } = await params;

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.userId, session.user.id)),
  });
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ detail: 'Missing STEP file upload' }, { status: 400 });
  }

  if (!file.name.match(/\.(step|stp)$/i)) {
    return NextResponse.json({ detail: 'Files must be .step or .stp' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const stepFileId = crypto.randomUUID();
  const persisted = await persistProjectStepFile({
    projectId: id,
    stepFileId,
    filename: file.name,
    buffer,
  });

  const upstreamFormData = new FormData();
  upstreamFormData.append(
    'file',
    new File([new Uint8Array(buffer)], file.name, { type: file.type || 'application/octet-stream' })
  );
  const upstream = await fetch(`${FASTAPI}/session/upload`, {
    method: 'POST',
    body: upstreamFormData,
  });
  if (!upstream.ok) {
    const errorPayload = await upstream.json().catch(() => ({ detail: 'STEP upload failed' }));
    return NextResponse.json(errorPayload, { status: upstream.status });
  }

  const uploadPayload = await upstream.json() as {
    session_id: string;
    bodies: unknown[];
  };
  cacheStepSession(stepFileId, uploadPayload.session_id);

  const [{ maxOrder }] = await db
    .select({ maxOrder: max(projectStepFiles.sortOrder) })
    .from(projectStepFiles)
    .where(eq(projectStepFiles.projectId, id));

  await db.insert(projectStepFiles).values({
    id: stepFileId,
    projectId: id,
    filename: file.name,
    storagePath: persisted.storagePath,
    fileHash: persisted.fileHash,
    fileSize: persisted.fileSize,
    bodyState: stringifyPersistedStepBodyState([]),
    selectedBodyIndex: 0,
    sortOrder: (maxOrder ?? -1) + 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return NextResponse.json({
    id: stepFileId,
    filename: file.name,
    fileSize: persisted.fileSize,
    selectedBodyIndex: 0,
    sortOrder: (maxOrder ?? -1) + 1,
    bodyState: [],
    sessionId: uploadPayload.session_id,
    bodies: uploadPayload.bodies ?? [],
  });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = getDevSession();
  const { id } = await params;

  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.userId, session.user.id)),
    with: {
      stepFiles: true,
      cuts: {
        columns: {
          stepFileId: true,
        },
      },
    },
  });
  if (!project) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    stepFiles: project.stepFiles,
    referencedStepFileIds: [...new Set(project.cuts.map((cut) => cut.stepFileId).filter(Boolean))],
    stepActiveFileId: project.stepActiveFileId ?? null,
  });
}
