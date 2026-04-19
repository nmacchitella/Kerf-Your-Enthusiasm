'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth-client';

interface Project {
  id: string;
  name: string;
  description: string | null;
  kerf: number;
  createdAt: string;
  updatedAt: string;
  stocks: Array<{ id: string; name: string }>;
  cuts: Array<{ id: string; label: string }>;
}

interface ProjectDetailsResponse {
  id: string;
  name: string;
  description: string | null;
  kerf: number;
  units?: string | null;
  groupMultipliers?: string | null;
  layoutOverrides?: Record<string, unknown>;
  layoutExcludedKeys?: string[];
  layoutPadding?: number;
  layoutHasActive?: boolean;
  stepActiveFileId?: string | null;
  stocks: Array<{
    id: string;
    name: string;
    length: number;
    width: number;
    thickness: number | null;
    quantity: number;
    material: string;
  }>;
  cuts: Array<{
    id: string;
    label: string;
    length: number;
    width: number;
    thickness: number | null;
    quantity: number;
    material: string;
    groupName?: string | null;
    stepFileId?: string | null;
    stepSessionId?: string | null;
    stepBodyIndex?: number | null;
    stepFaceIndex?: number | null;
  }>;
  stepFiles: Array<{
    id: string;
    filename: string;
    sortOrder: number;
    selectedBodyIndex: number;
    bodyState: Array<{
      bodyIndex: number;
      name: string;
      included: boolean;
      confirmed: boolean;
      selectedFaceIndex?: number;
    }>;
    sessionId: string | null;
  }>;
}

interface UploadResult {
  id: string;
}

interface ImportedProjectStock {
  id?: string;
  dbId?: string;
  name: string;
  l: number;
  w: number;
  t?: number;
  qty: number;
  mat: string;
}

interface ImportedProjectCut {
  id?: string;
  dbId?: string;
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
}

interface ImportedStepFile {
  id?: string;
  fileName: string;
  filename?: string;
  sortOrder?: number;
  selectedBodyIndex?: number;
  bodyState?: Array<{
    bodyIndex: number;
    name: string;
    included: boolean;
    confirmed: boolean;
    selectedFaceIndex?: number;
  }>;
  exported?: boolean;
  error?: string;
}

interface ProjectBundle {
  format: string;
  version: number;
  project?: {
    name: string;
    description?: string | null;
    settings?: {
      kerf?: number;
      padding?: number;
      units?: string;
      groupMultipliers?: Record<string, number>;
    };
    layout?: {
      overrides?: Record<string, unknown>;
      excludedKeys?: string[];
    };
    stepActiveFileId?: string | null;
    stepFiles?: ImportedStepFile[];
    stocks?: ImportedProjectStock[];
    cuts?: ImportedProjectCut[];
  };
  stepSessions?: Array<{
    sessionId: string;
    fileName: string;
    exported?: boolean;
    error?: string;
  }>;
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const bundleInputRef = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [creatingStep, setCreatingStep] = useState(false);
  const [duplicatingProjectId, setDuplicatingProjectId] = useState<string | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [savingRenameId, setSavingRenameId] = useState<string | null>(null);
  const [importingBundle, setImportingBundle] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects();
  }, []);

  const fetchProjects = async () => {
    try {
      const res = await fetch('/api/v1/projects');
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;

    setCreating(true);
    try {
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newProjectName }),
      });

      if (res.ok) {
        const project = await res.json();
        setProjects([project, ...projects]);
        setNewProjectName('');
        setShowNewForm(false);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleNewStepProject = async () => {
    setCreatingStep(true);
    try {
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New STEP Project' }),
      });
      if (res.ok) {
        const project = await res.json();
        router.push(`/projects/${project.id}/step`);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
    } finally {
      setCreatingStep(false);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm('Are you sure you want to delete this project?')) return;

    try {
      const res = await fetch(`/api/v1/projects/${id}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        setProjects(projects.filter((p) => p.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const makeDuplicateProjectName = (name: string) => {
    const trimmed = name.trim() || 'Untitled Project';
    const match = trimmed.match(/^(.*) Copy(?: (\d+))?$/);
    if (!match) return `${trimmed} Copy`;
    const baseName = match[1].trim() || 'Untitled Project';
    const copyIndex = match[2] ? parseInt(match[2], 10) + 1 : 2;
    return `${baseName} Copy ${copyIndex}`;
  };

  const scheduleAutoOptimize = (projectId: string) => {
    try {
      sessionStorage.setItem(`project-auto-optimize-${projectId}`, '1');
    } catch {
      // Ignore browser storage failures and still allow navigation.
    }
  };

  const createProjectShell = async (name: string, description?: string | null) => {
    const createRes = await fetch('/api/v1/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: description ?? null }),
    });

    if (!createRes.ok) {
      const errorPayload = await createRes.json().catch(() => ({}));
      throw new Error(errorPayload.error ?? errorPayload.detail ?? `Project creation failed (${createRes.status})`);
    }

    return createRes.json() as Promise<Project>;
  };

  const uploadStepFileToProject = async (projectId: string, fileName: string, blob: Blob) => {
    const formData = new FormData();
    formData.append('file', new File([blob], fileName, { type: 'application/octet-stream' }));

    const uploadRes = await fetch(`/api/v1/projects/${projectId}/step-files`, {
      method: 'POST',
      body: formData,
    });

    if (!uploadRes.ok) {
      const errorPayload = await uploadRes.json().catch(() => ({}));
      throw new Error(errorPayload.detail ?? `Upload failed (${uploadRes.status})`);
    }

    return uploadRes.json() as Promise<UploadResult>;
  };

  const patchProjectStepFileState = async (
    projectId: string,
    fileId: string,
    stepFile: Pick<ImportedStepFile, 'sortOrder' | 'selectedBodyIndex' | 'bodyState'>
  ) => {
    await fetch(`/api/v1/projects/${projectId}/step-files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sortOrder: stepFile.sortOrder ?? 0,
        selectedBodyIndex: stepFile.selectedBodyIndex ?? 0,
        bodyState: stepFile.bodyState ?? [],
      }),
    });
  };

  const remapInstanceKey = (key: string, cutIdMap: Map<string, string>) => {
    const match = key.match(/^(.*)-(\d+)$/);
    if (!match) return key;
    const [, oldCutId, instanceIndex] = match;
    const nextCutId = cutIdMap.get(oldCutId);
    return nextCutId ? `${nextCutId}-${instanceIndex}` : null;
  };

  const remapLayoutState = (
    layout: { overrides?: Record<string, unknown>; excludedKeys?: string[] } | undefined,
    cutIdMap: Map<string, string>
  ) => {
    const overrides = layout?.overrides ?? {};
    const remappedOverrides = Object.fromEntries(
      Object.entries(overrides).flatMap(([key, value]) => {
        const mappedKey = remapInstanceKey(key, cutIdMap);
        return mappedKey ? [[mappedKey, value]] : [];
      })
    );
    const remappedExcludedKeys = (layout?.excludedKeys ?? [])
      .map((key) => remapInstanceKey(key, cutIdMap))
      .filter((key): key is string => Boolean(key));

    return {
      overrides: remappedOverrides,
      excludedKeys: remappedExcludedKeys,
    };
  };

  const startRenamingProject = (project: Project) => {
    setBundleError(null);
    setRenamingProjectId(project.id);
    setRenameDraft(project.name);
  };

  const cancelRenamingProject = () => {
    setRenamingProjectId(null);
    setRenameDraft('');
  };

  const handleRenameProject = async (project: Project) => {
    const nextName = renameDraft.trim();
    if (!nextName) return;
    if (nextName === project.name) {
      cancelRenamingProject();
      return;
    }

    setSavingRenameId(project.id);
    try {
      const res = await fetch(`/api/v1/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName }),
      });

      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({}));
        throw new Error(errorPayload.error ?? errorPayload.detail ?? `Failed to rename project (${res.status})`);
      }

      const updatedProject = await res.json() as Project;
      setProjects((prev) => prev.map((p) => (p.id === project.id ? updatedProject : p)));
      cancelRenamingProject();
    } catch (error) {
      console.error('Failed to rename project:', error);
      setBundleError(error instanceof Error ? error.message : 'Project rename failed');
    } finally {
      setSavingRenameId(null);
    }
  };

  const handleDuplicateProject = async (projectId: string) => {
    setDuplicatingProjectId(projectId);
    try {
      const sourceRes = await fetch(`/api/v1/projects/${projectId}`);
      if (!sourceRes.ok) {
        throw new Error(`Failed to load project (${sourceRes.status})`);
      }

      const sourceProject = await sourceRes.json() as ProjectDetailsResponse;
      let parsedGroupMultipliers: Record<string, number> = {};
      try {
        const parsed = JSON.parse(sourceProject.groupMultipliers ?? '{}');
        if (parsed && typeof parsed === 'object') {
          parsedGroupMultipliers = parsed as Record<string, number>;
        }
      } catch {
        parsedGroupMultipliers = {};
      }

      const duplicatedProject = await createProjectShell(
        makeDuplicateProjectName(sourceProject.name),
        sourceProject.description ?? null
      );

      const stepFileIdMap = new Map<string, string>();
      for (const stepFile of sourceProject.stepFiles ?? []) {
        const fileRes = await fetch(`/api/v1/projects/${projectId}/step-files/${stepFile.id}/file`);
        if (!fileRes.ok) {
          throw new Error(`Failed to duplicate STEP file ${stepFile.filename}`);
        }
        const uploadData = await uploadStepFileToProject(
          duplicatedProject.id,
          stepFile.filename,
          await fileRes.blob()
        );
        stepFileIdMap.set(stepFile.id, uploadData.id);
        await patchProjectStepFileState(duplicatedProject.id, uploadData.id, stepFile);
      }

      const cutIdMap = new Map<string, string>(
        sourceProject.cuts.map((cut) => [cut.id, crypto.randomUUID()])
      );
      const remappedLayout = remapLayoutState(
        {
          overrides: sourceProject.layoutOverrides ?? {},
          excludedKeys: sourceProject.layoutExcludedKeys ?? [],
        },
        cutIdMap
      );

      const updateRes = await fetch(`/api/v1/projects/${duplicatedProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: makeDuplicateProjectName(sourceProject.name),
          description: sourceProject.description ?? null,
          kerf: sourceProject.kerf,
          units: sourceProject.units ?? 'in',
          groupMultipliers: parsedGroupMultipliers,
          layoutOverrides: remappedLayout.overrides,
          layoutExcludedKeys: remappedLayout.excludedKeys,
          layoutPadding: sourceProject.layoutPadding ?? 0.5,
          layoutHasActive: sourceProject.layoutHasActive ?? false,
          stepActiveFileId: sourceProject.stepActiveFileId
            ? stepFileIdMap.get(sourceProject.stepActiveFileId) ?? null
            : null,
          stocks: sourceProject.stocks.map((stock) => ({
            id: crypto.randomUUID(),
            name: stock.name,
            l: stock.length,
            w: stock.width,
            t: stock.thickness ?? 0,
            qty: stock.quantity,
            mat: stock.material,
          })),
          cuts: sourceProject.cuts.map((cut) => ({
            id: cutIdMap.get(cut.id) ?? crypto.randomUUID(),
            label: cut.label,
            l: cut.length,
            w: cut.width,
            t: cut.thickness ?? 0,
            qty: cut.quantity,
            mat: cut.material ?? '',
            group: cut.groupName ?? undefined,
            stepFileId: cut.stepFileId ? stepFileIdMap.get(cut.stepFileId) ?? undefined : undefined,
            stepBodyIndex: cut.stepBodyIndex ?? undefined,
            stepFaceIndex: cut.stepFaceIndex ?? undefined,
          })),
        }),
      });

      if (!updateRes.ok) {
        const errorPayload = await updateRes.json().catch(() => ({}));
        throw new Error(errorPayload.error ?? errorPayload.detail ?? `Failed to finalize duplicate (${updateRes.status})`);
      }

      scheduleAutoOptimize(duplicatedProject.id);
      setProjects((prev) => [duplicatedProject, ...prev]);
      router.push(`/projects/${duplicatedProject.id}`);
    } catch (error) {
      console.error('Failed to duplicate project:', error);
      setBundleError(error instanceof Error ? error.message : 'Project duplication failed');
    } finally {
      setDuplicatingProjectId(null);
    }
  };

  const importProjectBundle = async (file: File) => {
    setImportingBundle(true);
    setBundleError(null);

    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(file);
      const projectEntry = zip.file('project.json');

      if (!projectEntry) {
        throw new Error('This zip does not contain a project.json bundle manifest.');
      }

      const bundle = JSON.parse(await projectEntry.async('string')) as ProjectBundle;
      if (bundle.format !== 'kerfuffle-project-bundle' || !bundle.project?.name) {
        throw new Error('This does not look like a Kerfuffle project bundle.');
      }

      const importedProject = await createProjectShell(
        bundle.project.name,
        bundle.project.description ?? null
      );

      const stepFileIdMap = new Map<string, string>();
      const legacySessionMap = new Map<string, string>();
      const missingStepFiles: string[] = [];

      for (const stepFile of bundle.project.stepFiles ?? []) {
        if (!stepFile?.fileName) continue;

        const stepEntry = zip.file(`step-files/${stepFile.fileName}`);
        if (!stepEntry) {
          missingStepFiles.push(stepFile.fileName);
          continue;
        }

        try {
          const uploadData = await uploadStepFileToProject(
            importedProject.id,
            stepFile.filename ?? stepFile.fileName,
            await stepEntry.async('blob')
          );
          if (stepFile.id) {
            stepFileIdMap.set(stepFile.id, uploadData.id);
          }
          await patchProjectStepFileState(importedProject.id, uploadData.id, stepFile);
        } catch (error) {
          missingStepFiles.push(
            `${stepFile.fileName} (${error instanceof Error ? error.message : 'Upload failed'})`
          );
        }
      }

      for (const stepSession of bundle.stepSessions ?? []) {
        if (!stepSession?.sessionId || !stepSession?.fileName) continue;

        const stepEntry = zip.file(`step-files/${stepSession.fileName}`);
        if (!stepEntry) {
          missingStepFiles.push(stepSession.fileName);
          continue;
        }

        try {
          const uploadData = await uploadStepFileToProject(
            importedProject.id,
            stepSession.fileName,
            await stepEntry.async('blob')
          );
          legacySessionMap.set(stepSession.sessionId, uploadData.id);
        } catch (error) {
          missingStepFiles.push(
            `${stepSession.fileName} (${error instanceof Error ? error.message : 'Upload failed'})`
          );
        }
      }

      const getBundleCutSourceId = (cut: ImportedProjectCut, index: number) =>
        String(cut.dbId ?? cut.id ?? `legacy-${index}`);
      const cutIdMap = new Map<string, string>(
        (bundle.project.cuts ?? []).map((cut, index) => [
          getBundleCutSourceId(cut, index),
          crypto.randomUUID(),
        ])
      );
      const remappedLayout = remapLayoutState(bundle.project.layout, cutIdMap);

      const importedCuts = (bundle.project.cuts ?? []).map((cut, index) => {
        const mappedStepFileId = cut.stepFileId
          ? stepFileIdMap.get(cut.stepFileId) ?? null
          : cut.stepSessionId
          ? legacySessionMap.get(cut.stepSessionId) ?? null
          : null;
        const sourceCutId = getBundleCutSourceId(cut, index);

        return {
          id: cutIdMap.get(sourceCutId) ?? crypto.randomUUID(),
          label: cut.label,
          l: cut.l,
          w: cut.w,
          t: cut.t ?? 0,
          qty: cut.qty ?? 1,
          mat: cut.mat ?? '',
          group: cut.group ?? undefined,
          stepFileId: mappedStepFileId ?? undefined,
          stepBodyIndex: mappedStepFileId ? cut.stepBodyIndex ?? undefined : undefined,
          stepFaceIndex: mappedStepFileId ? cut.stepFaceIndex ?? undefined : undefined,
        };
      });

      const updateRes = await fetch(`/api/v1/projects/${importedProject.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: bundle.project.name,
          description: bundle.project.description ?? null,
          kerf: bundle.project.settings?.kerf ?? 0.125,
          units: bundle.project.settings?.units ?? 'in',
          groupMultipliers: bundle.project.settings?.groupMultipliers ?? {},
          layoutOverrides: remappedLayout.overrides,
          layoutExcludedKeys: remappedLayout.excludedKeys,
          layoutPadding: bundle.project.settings?.padding ?? 0.5,
          layoutHasActive: false,
          stepActiveFileId: bundle.project.stepActiveFileId
            ? stepFileIdMap.get(bundle.project.stepActiveFileId) ?? null
            : null,
          stocks: (bundle.project.stocks ?? []).map((stock) => ({
            id: crypto.randomUUID(),
            name: stock.name,
            l: stock.l,
            w: stock.w,
            t: stock.t ?? 0,
            qty: stock.qty,
            mat: stock.mat,
          })),
          cuts: importedCuts,
        }),
      });

      if (!updateRes.ok) {
        const errorPayload = await updateRes.json().catch(() => ({}));
        throw new Error(errorPayload.error ?? errorPayload.detail ?? `Import failed (${updateRes.status})`);
      }

      scheduleAutoOptimize(importedProject.id);

      if (missingStepFiles.length > 0) {
        alert(
          `${missingStepFiles.length} STEP file${missingStepFiles.length === 1 ? '' : 's'} could not be restored. `
          + 'Those parts were still imported as dimension-based cuts.'
        );
      }

      router.push(`/projects/${importedProject.id}`);
    } catch (error) {
      console.error('Failed to import bundle:', error);
      setBundleError(error instanceof Error ? error.message : 'Bundle import failed');
    } finally {
      setImportingBundle(false);
      if (bundleInputRef.current) bundleInputRef.current.value = '';
    }
  };

  const handleBundleInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await importProjectBundle(file);
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-1/4"></div>
          <div className="h-32 bg-slate-200 rounded"></div>
          <div className="h-32 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <input
        ref={bundleInputRef}
        type="file"
        accept=".zip,application/zip"
        onChange={(e) => { void handleBundleInput(e); }}
        className="hidden"
      />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Projects</h1>
          <p className="text-slate-600 mt-1">
            Welcome back, {session?.user.name || 'there'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => bundleInputRef.current?.click()}
            disabled={importingBundle}
            className="px-4 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium disabled:opacity-50"
          >
            {importingBundle ? 'Importing...' : 'Import Bundle'}
          </button>
          <button
            onClick={handleNewStepProject}
            disabled={creatingStep}
            className="px-4 py-2 bg-slate-100 text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium disabled:opacity-50"
          >
            {creatingStep ? 'Creating...' : '↑ Import STEP'}
          </button>
          <button
            onClick={() => setShowNewForm(true)}
            className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors text-sm font-medium"
          >
            New Project
          </button>
        </div>
      </div>

      {bundleError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {bundleError}
        </div>
      )}

      {showNewForm && (
        <div className="mb-6 p-4 bg-white rounded-lg border border-slate-200">
          <form onSubmit={handleCreateProject} className="flex gap-3">
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name..."
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
              autoFocus
            />
            <button
              type="submit"
              disabled={creating || !newProjectName.trim()}
              className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNewForm(false);
                setNewProjectName('');
              }}
              className="px-4 py-2 text-slate-600 hover:text-slate-900 transition-colors text-sm"
            >
              Cancel
            </button>
          </form>
        </div>
      )}

      {projects.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border border-slate-200">
          <div className="text-slate-400 text-5xl mb-4">📐</div>
          <h3 className="text-lg font-medium text-slate-900 mb-2">
            No projects yet
          </h3>
          <p className="text-slate-600 mb-4">
            Create a project manually or import a STEP file to get started
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => bundleInputRef.current?.click()}
              disabled={importingBundle}
              className="px-4 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {importingBundle ? 'Importing...' : 'Import Bundle'}
            </button>
            <button
              onClick={handleNewStepProject}
              disabled={creatingStep}
              className="px-4 py-2 bg-slate-100 text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium disabled:opacity-50"
            >
              {creatingStep ? 'Creating...' : '↑ Import STEP'}
            </button>
            <button
              onClick={() => setShowNewForm(true)}
              className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors text-sm font-medium"
            >
              New Cut List
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {projects.map((project) => (
            <div
              key={project.id}
              className="bg-white rounded-lg border border-slate-200 p-4 hover:border-slate-300 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  {renamingProjectId === project.id ? (
                    <input
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleRenameProject(project);
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelRenamingProject();
                        }
                      }}
                      className="w-full max-w-md rounded border border-slate-300 px-2 py-1 text-lg font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-500"
                      autoFocus
                    />
                  ) : (
                    <Link
                      href={`/projects/${project.id}`}
                      className="text-lg font-medium text-slate-900 hover:text-slate-600"
                    >
                      {project.name}
                    </Link>
                  )}
                  {project.description && (
                    <p className="text-slate-600 text-sm mt-1">
                      {project.description}
                    </p>
                  )}
                  <div className="flex items-center gap-4 mt-2 text-sm text-slate-500">
                    <span>{project.stocks.length} stocks</span>
                    <span>{project.cuts.length} cuts</span>
                    <span>Kerf: {project.kerf}&quot;</span>
                    <span>Updated {formatDate(project.updatedAt)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {renamingProjectId === project.id ? (
                    <>
                      <button
                        onClick={() => { void handleRenameProject(project); }}
                        disabled={savingRenameId === project.id || !renameDraft.trim()}
                        className="px-3 py-1.5 text-sm text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors disabled:opacity-50"
                      >
                        {savingRenameId === project.id ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={cancelRenamingProject}
                        disabled={savingRenameId === project.id}
                        className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => startRenamingProject(project)}
                        disabled={duplicatingProjectId !== null || savingRenameId !== null}
                        className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors disabled:opacity-50"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => { void handleDuplicateProject(project.id); }}
                        disabled={duplicatingProjectId !== null || renamingProjectId !== null}
                        className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors disabled:opacity-50"
                      >
                        {duplicatingProjectId === project.id ? 'Duplicating...' : 'Duplicate'}
                      </button>
                      <Link
                        href={`/projects/${project.id}/step`}
                        className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                      >
                        ↑ STEP
                      </Link>
                      <Link
                        href={`/projects/${project.id}`}
                        className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                      >
                        Open
                      </Link>
                      <button
                        onClick={() => handleDeleteProject(project.id)}
                        className="px-3 py-1.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 p-4 bg-slate-50 rounded-lg border border-slate-200">
        <h3 className="font-medium text-slate-900 mb-2">Quick Actions</h3>
        <div className="flex gap-3">
          <Link
            href="/cut-list"
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Open Cut List (without saving)
          </Link>
          <span className="text-slate-300">|</span>
          <Link
            href="/tools"
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Manage Tools
          </Link>
          <span className="text-slate-300">|</span>
          <Link
            href="/calculators"
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Calculators
          </Link>
        </div>
      </div>
    </div>
  );
}
