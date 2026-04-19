import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { FASTAPI } from '@/app/api/v1/step/_utils';

export interface PersistedStepBodyState {
  bodyIndex: number;
  name: string;
  included: boolean;
  confirmed: boolean;
  selectedFaceIndex?: number;
}

export interface PersistedProjectStepFileRecord {
  id: string;
  filename: string;
  storagePath: string;
}

const stepSessionCache = new Map<string, string>();
const STEP_STORAGE_ROOT = path.resolve(
  process.cwd(),
  process.env.STEP_STORAGE_DIR ?? 'data/step-files'
);

function normalizeStepExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return ext === '.stp' ? '.stp' : '.step';
}

export function getStoredStepAbsolutePath(storagePath: string): string {
  return path.resolve(STEP_STORAGE_ROOT, storagePath);
}

export async function ensureProjectStepStorageDir(projectId: string): Promise<string> {
  const projectDir = path.join(STEP_STORAGE_ROOT, projectId);
  await mkdir(projectDir, { recursive: true });
  return projectDir;
}

export function buildStoredStepRelativePath(
  projectId: string,
  stepFileId: string,
  filename: string
): string {
  return path.join(projectId, `${stepFileId}${normalizeStepExtension(filename)}`);
}

export async function persistProjectStepFile(params: {
  projectId: string;
  stepFileId: string;
  filename: string;
  buffer: Buffer;
}): Promise<{ storagePath: string; fileHash: string; fileSize: number }> {
  const { projectId, stepFileId, filename, buffer } = params;
  await ensureProjectStepStorageDir(projectId);
  const storagePath = buildStoredStepRelativePath(projectId, stepFileId, filename);
  await writeFile(getStoredStepAbsolutePath(storagePath), buffer);
  return {
    storagePath,
    fileHash: createHash('sha256').update(buffer).digest('hex'),
    fileSize: buffer.byteLength,
  };
}

export async function readPersistedProjectStepFile(storagePath: string): Promise<Buffer> {
  return readFile(getStoredStepAbsolutePath(storagePath));
}

export async function getPersistedProjectStepFileSize(storagePath: string): Promise<number> {
  const fileStats = await stat(getStoredStepAbsolutePath(storagePath));
  return fileStats.size;
}

export async function deletePersistedProjectStepFile(storagePath: string): Promise<void> {
  try {
    await unlink(getStoredStepAbsolutePath(storagePath));
  } catch {
    // Ignore missing files during cleanup.
  }
}

export async function deletePersistedProjectStepDirectory(projectId: string): Promise<void> {
  try {
    await rm(path.join(STEP_STORAGE_ROOT, projectId), { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures when removing a project.
  }
}

export function parsePersistedStepBodyState(raw: string | null | undefined): PersistedStepBodyState[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const candidate = entry as Record<string, unknown>;
        const bodyIndex = typeof candidate.bodyIndex === 'number' ? candidate.bodyIndex : null;
        const name = typeof candidate.name === 'string' ? candidate.name : '';
        if (bodyIndex === null) return null;
        return {
          bodyIndex,
          name,
          included: candidate.included !== false,
          confirmed: candidate.confirmed === true,
          selectedFaceIndex:
            typeof candidate.selectedFaceIndex === 'number' ? candidate.selectedFaceIndex : undefined,
          } satisfies PersistedStepBodyState;
      })
      .filter((entry) => entry !== null);
    return normalized as PersistedStepBodyState[];
  } catch {
    return [];
  }
}

export function stringifyPersistedStepBodyState(
  entries: PersistedStepBodyState[] | null | undefined
): string {
  return JSON.stringify(entries ?? []);
}

export function clearCachedStepSession(stepFileId: string): void {
  stepSessionCache.delete(stepFileId);
}

export function cacheStepSession(stepFileId: string, sessionId: string): void {
  stepSessionCache.set(stepFileId, sessionId);
}

export async function ensureBackendSessionForStoredStepFile(
  stepFile: PersistedProjectStepFileRecord,
  forceRefresh = false
): Promise<string> {
  if (!forceRefresh) {
    const cached = stepSessionCache.get(stepFile.id);
    if (cached) return cached;
  }

  const buffer = await readPersistedProjectStepFile(stepFile.storagePath);
  const formData = new FormData();
  formData.append(
    'file',
    new File([new Uint8Array(buffer)], stepFile.filename, { type: 'application/octet-stream' })
  );

  const upstream = await fetch(`${FASTAPI}/session/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!upstream.ok) {
    const errorPayload = await upstream.json().catch(() => ({ detail: 'STEP upload failed' }));
    throw new Error(
      typeof errorPayload?.detail === 'string'
        ? errorPayload.detail
        : `STEP upload failed (${upstream.status})`
    );
  }

  const payload = await upstream.json() as { session_id?: string };
  if (!payload.session_id) {
    throw new Error('STEP upload did not return a session id');
  }

  stepSessionCache.set(stepFile.id, payload.session_id);
  return payload.session_id;
}
