import {
  ensureBackendSessionForStoredStepFile,
  parsePersistedStepBodyState,
} from '@/server/project-step-files';

type StepCutRef = {
  stepFileId?: string | null;
  stepSessionId?: string | null;
  stepBodyIndex?: number | null;
  stepFaceIndex?: number | null;
};

type ProjectStepFileRecord = {
  id: string;
  filename: string;
  storagePath: string;
  fileSize: number | null;
  bodyState: string | null;
  selectedBodyIndex: number | null;
  sortOrder: number | null;
};

type ProjectDetailRecord = {
  id: string;
  name: string;
  description: string | null;
  kerf: number;
  units: string | null;
  groupMultipliers: string | null;
  layoutOverrides: string | null;
  layoutExcludedKeys: string | null;
  layoutPadding: number | null;
  layoutHasActive: boolean | null;
  stepActiveFileId: string | null;
  stocks: unknown[];
  cuts: StepCutRef[];
  stepFiles?: ProjectStepFileRecord[];
};

export function parseJsonColumn<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function getStepCutDedupKey(cut: StepCutRef): string | null {
  if (cut.stepBodyIndex == null || cut.stepFaceIndex == null) {
    return null;
  }

  if (cut.stepFileId) {
    return `file:${cut.stepFileId}:${cut.stepBodyIndex}:${cut.stepFaceIndex}`;
  }

  if (cut.stepSessionId) {
    return `session:${cut.stepSessionId}:${cut.stepBodyIndex}:${cut.stepFaceIndex}`;
  }

  return null;
}

export function dedupeStepCuts<T extends StepCutRef>(projectCuts: T[]): T[] {
  const seen = new Set<string>();

  return projectCuts.filter((cut) => {
    const key = getStepCutDedupKey(cut);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function serializeProjectDetail(project: ProjectDetailRecord) {
  const serializedStepFiles = await Promise.all(
    [...(project.stepFiles ?? [])]
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map(async (stepFile) => {
        let sessionId: string | null = null;
        try {
          sessionId = await ensureBackendSessionForStoredStepFile(stepFile);
        } catch {
          sessionId = null;
        }

        return {
          id: stepFile.id,
          filename: stepFile.filename,
          fileSize: stepFile.fileSize ?? 0,
          selectedBodyIndex: stepFile.selectedBodyIndex ?? 0,
          sortOrder: stepFile.sortOrder ?? 0,
          bodyState: parsePersistedStepBodyState(stepFile.bodyState),
          sessionId,
        };
      })
  );

  return {
    ...project,
    cuts: dedupeStepCuts(project.cuts),
    layoutOverrides: parseJsonColumn<Record<string, unknown>>(project.layoutOverrides, {}),
    layoutExcludedKeys: parseJsonColumn<string[]>(project.layoutExcludedKeys, []),
    layoutPadding: project.layoutPadding ?? 0.5,
    layoutHasActive: project.layoutHasActive ?? false,
    stepActiveFileId: project.stepActiveFileId ?? null,
    stepFiles: serializedStepFiles,
  };
}
