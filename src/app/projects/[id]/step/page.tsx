'use client';

import { useState, useCallback, use, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { StepSidebar, BodyState } from '@/components/step/StepSidebar';
import { StepPreviewPanel } from '@/components/step/StepPreviewPanel';
import { StepBody } from '@/components/step/StepBodyRow';
import type { BodyMeshData } from '@/components/step/StepViewer3D';
import { mmToIn } from '@/lib/unit-utils';
import { UnitSystem } from '@/types';

const StepViewer3D = dynamic(
  () => import('@/components/step/StepViewer3D').then((m) => m.StepViewer3D),
  { ssr: false, loading: () => <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">Loading 3D…</div> }
);

interface UploadResult {
  session_id: string;
  bodies: StepBody[];
}

interface SessionData {
  sessionId: string;
  filename: string;
  bodyStates: BodyState[];
  selectedFaceIndices: Record<number, number>;
  /** Projected face dimensions [l, w, t] in mm, keyed by body array index. */
  faceDimsMap: Record<number, [number, number, number]>;
  selectedBodyIdx: number;
}

export default function StepWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const STORAGE_KEY = `kerfuffle-step:${id}`;

  // ── Multi-session state ───────────────────────────────────────────────────
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [addingNew, setAddingNew] = useState(false);

  // ── Mesh cache (keyed by sessionId, so switching tabs doesn't re-fetch) ──
  const [meshCache, setMeshCache] = useState<Record<string, BodyMeshData[]>>({});
  const [meshLoading, setMeshLoading] = useState(false);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [projectUnits, setProjectUnits] = useState<UnitSystem>('in');
  const [units, setUnits] = useState<UnitSystem>('in');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addedCount, setAddedCount] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // ── Derived: active session ───────────────────────────────────────────────
  const activeSession = sessions[activeIdx] ?? null;

  const updateActiveSession = useCallback(
    (patch: Partial<SessionData> | ((s: SessionData) => Partial<SessionData>)) => {
      setSessions((prev) =>
        prev.map((s, i) => {
          if (i !== activeIdx) return s;
          const p = typeof patch === 'function' ? patch(s) : patch;
          return { ...s, ...p };
        })
      );
    },
    [activeIdx]
  );

  // ── Restore from sessionStorage ───────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const { sessions: savedSessions, activeIdx: savedActiveIdx } = JSON.parse(saved) as {
        sessions: {
          sessionId: string;
          filename: string;
          bodyMeta: { name: string; included: boolean; confirmed: boolean }[];
          selectedFaceIndices: Record<number, number>;
          selectedBodyIdx: number;
        }[];
        activeIdx: number;
      };
      if (!savedSessions?.length) return;
      setRestoring(true);
      Promise.all(
        savedSessions.map(async (s) => {
          const r = await fetch(`/api/v1/step/${s.sessionId}/bodies`);
          if (!r.ok) throw new Error('session gone');
          const data = await r.json();
          const bodies: StepBody[] = data.bodies;
          return {
            sessionId: s.sessionId,
            filename: s.filename,
            bodyStates: bodies.map((b, i) => ({
              body: b,
              name: s.bodyMeta[i]?.name ?? b.name,
              included: s.bodyMeta[i]?.included ?? true,
              confirmed: s.bodyMeta[i]?.confirmed ?? false,
            })),
            selectedFaceIndices: s.selectedFaceIndices ?? {},
            faceDimsMap: {},
            selectedBodyIdx: s.selectedBodyIdx ?? 0,
          } as SessionData;
        })
      )
        .then((restored) => {
          setSessions(restored);
          setActiveIdx(Math.min(savedActiveIdx ?? 0, restored.length - 1));
        })
        .catch(() => sessionStorage.removeItem(STORAGE_KEY))
        .finally(() => setRestoring(false));
    } catch {
      // malformed — ignore
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load the owning project's units for storage/optimizer consistency ────
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/projects/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const nextUnits = (data?.units as UnitSystem | null) ?? 'in';
        if (cancelled) return;
        setProjectUnits(nextUnits);
        setUnits(nextUnits);
      })
      .catch(() => {
        // Fall back to inches if the project metadata can't be loaded.
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // ── Persist whenever sessions change ─────────────────────────────────────
  useEffect(() => {
    if (sessions.length === 0) return;
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sessions: sessions.map((s) => ({
            sessionId: s.sessionId,
            filename: s.filename,
            bodyMeta: s.bodyStates.map((bs) => ({
              name: bs.name,
              included: bs.included,
              confirmed: bs.confirmed,
            })),
            selectedFaceIndices: s.selectedFaceIndices,
            selectedBodyIdx: s.selectedBodyIdx,
          })),
          activeIdx,
        })
      );
    } catch { /* storage full */ }
  }, [sessions, activeIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load mesh for active session (cached) ─────────────────────────────────
  useEffect(() => {
    const sid = activeSession?.sessionId;
    if (!sid) return;
    if (meshCache[sid]) return; // already have it
    setMeshLoading(true);
    fetch(`/api/v1/step/${sid}/mesh`)
      .then((r) => r.json())
      .then((data) => setMeshCache((prev) => ({ ...prev, [sid]: data.bodies ?? [] })))
      .catch(console.error)
      .finally(() => setMeshLoading(false));
  }, [activeSession?.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Upload ────────────────────────────────────────────────────────────────
  const handleFile = async (file: File) => {
    if (!file.name.match(/\.(step|stp)$/i)) {
      setUploadError('File must be a .step or .stp file');
      return;
    }
    setUploading(true);
    setUploadError(null);
    setAddedCount(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/v1/step/upload', { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Upload failed (${res.status})`);
      }
      const data: UploadResult = await res.json();
      const newSession: SessionData = {
        sessionId: data.session_id,
        filename: file.name,
        bodyStates: data.bodies.map((b) => ({ body: b, name: b.name, included: true, confirmed: false })),
        selectedFaceIndices: {},
        faceDimsMap: {},
        selectedBodyIdx: 0,
      };
      setSessions((prev) => {
        const next = [...prev, newSession];
        setActiveIdx(next.length - 1);
        return next;
      });
      setAddingNew(false);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };
  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = ''; // allow re-selecting same file
  };

  // ── Remove a session tab ──────────────────────────────────────────────────
  const handleRemoveSession = (idx: number) => {
    setSessions((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 0) sessionStorage.removeItem(STORAGE_KEY);
      setActiveIdx((prevActive) => {
        if (prevActive > idx) return prevActive - 1;
        if (prevActive === idx) return Math.max(0, idx - 1);
        return prevActive;
      });
      return next;
    });
  };

  // ── Face selection ────────────────────────────────────────────────────────
  const handleSelectFace3D = useCallback(
    (bodyIdx: number, faceIdx: number) => {
      updateActiveSession((s) => ({
        selectedBodyIdx: bodyIdx,
        selectedFaceIndices: { ...s.selectedFaceIndices, [bodyIdx]: faceIdx },
        bodyStates: s.bodyStates.map((bs, i) => (i === bodyIdx ? { ...bs, confirmed: true } : bs)),
      }));
    },
    [updateActiveSession]
  );

  const handleFaceSelectedFromPreview = useCallback(
    (faceIndex: number) => {
      updateActiveSession((s) => ({
        selectedFaceIndices: { ...s.selectedFaceIndices, [s.selectedBodyIdx]: faceIndex },
      }));
    },
    [updateActiveSession]
  );

  const handleFaceDims = useCallback(
    (dims: [number, number, number]) => {
      updateActiveSession((s) => ({
        faceDimsMap: { ...s.faceDimsMap, [s.selectedBodyIdx]: dims },
      }));
    },
    [updateActiveSession]
  );

  const handleFaceNavigated = useCallback(() => {
    updateActiveSession((s) => ({
      bodyStates: s.bodyStates.map((bs, i) =>
        i === s.selectedBodyIdx ? { ...bs, confirmed: true } : bs
      ),
    }));
  }, [updateActiveSession]);

  const handleConfirmAll = useCallback(() => {
    updateActiveSession((s) => ({
      bodyStates: s.bodyStates.map((bs) => ({ ...bs, confirmed: true })),
    }));
  }, [updateActiveSession]);

  // ── Add confirmed parts to cut list ──────────────────────────────────────
  const handleAddToCutList = async () => {
    if (!activeSession) return;
    setAdding(true);
    try {
      const { sessionId, bodyStates, selectedFaceIndices, faceDimsMap } = activeSession;
      const toAdd = bodyStates.filter((bs) => bs.included && bs.confirmed);
      const cutsPayload = toAdd.map((bs) => {
        const bodyArrayIdx = bodyStates.indexOf(bs);
        // Use projected face dims when available, fall back to body bbox
        const dims = faceDimsMap[bodyArrayIdx] ?? bs.body.bbox_mm;
        const faceIdx =
          selectedFaceIndices[bodyArrayIdx] ??
          bs.body.faces.find((f) => f.is_top_face)?.index ?? 0;
        const toProjectUnit = projectUnits === 'mm' ? (v: number) => v : mmToIn;
        return {
          label: bs.name,
          l: dims ? toProjectUnit(dims[0]) : 0,
          w: dims ? toProjectUnit(dims[1]) : 0,
          t: dims ? toProjectUnit(dims[2]) : 0,
          qty: 1,
          mat: '',
          stepSessionId: sessionId,
          stepBodyIndex: bs.body.index,
          stepFaceIndex: faceIdx,
        };
      });
      const res = await fetch(`/api/v1/projects/${id}/cuts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cuts: cutsPayload }),
      });
      if (!res.ok) throw new Error('Failed to add cuts');
      const data = await res.json();
      setAddedCount(data.added);
    } catch (e) {
      console.error(e);
    } finally {
      setAdding(false);
    }
  };

  // ── Export all DXFs ───────────────────────────────────────────────────────
  const [exportingAll, setExportingAll] = useState(false);
  const handleExportAllDxfs = async () => {
    if (!activeSession) return;
    setExportingAll(true);
    try {
      const { sessionId, filename, bodyStates, selectedFaceIndices } = activeSession;
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const bs of bodyStates.filter((b) => b.included)) {
        const bodyArrayIdx = bodyStates.indexOf(bs);
        const faceIdx =
          selectedFaceIndices[bodyArrayIdx] ??
          bs.body.faces.find((f) => f.is_top_face)?.index ??
          bs.body.faces.find((f) => f.is_planar)?.index ?? 0;
        const res = await fetch('/api/v1/step/export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            body_index: bs.body.index,
            body_name: bs.name,
            face_index: faceIdx,
          }),
        });
        if (!res.ok) continue;
        zip.file(`${bs.name}.dxf`, await res.blob());
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename.replace(/\.(step|stp)$/i, '')}_dxfs.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
    } finally {
      setExportingAll(false);
    }
  };

  // ── Resizable right panel ─────────────────────────────────────────────────
  const [previewWidth, setPreviewWidth] = useState(288);
  const sepDragging = useRef(false);
  const onSepPointerDown = (e: React.PointerEvent) => {
    sepDragging.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onSepPointerMove = (e: React.PointerEvent) => {
    if (!sepDragging.current) return;
    setPreviewWidth((w) => Math.max(180, Math.min(640, w - e.movementX)));
  };
  const onSepPointerUp = () => { sepDragging.current = false; };

  // ── Dropzone ──────────────────────────────────────────────────────────────
  const dropzone = (
    <div
      onDrop={onDrop}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onClick={() => fileInputRef.current?.click()}
      className={`border-2 border-dashed rounded-xl p-16 text-center cursor-pointer transition-colors ${
        dragOver ? 'border-slate-500 bg-slate-50' : 'border-slate-300 hover:border-slate-400'
      }`}
    >
      <input ref={fileInputRef} type="file" accept=".step,.stp" className="hidden" onChange={onFileInput} />
      <svg className="w-12 h-12 mx-auto mb-4 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
      {uploading ? (
        <p className="text-slate-600">Parsing STEP file…</p>
      ) : (
        <>
          <p className="text-slate-700 font-medium">Drop a .step or .stp file here</p>
          <p className="text-slate-400 text-sm mt-1">or click to browse</p>
        </>
      )}
      {uploadError && <p className="mt-3 text-red-600 text-sm">{uploadError}</p>}
    </div>
  );

  // ── Loading / empty states ────────────────────────────────────────────────
  if (restoring) {
    return (
      <div className="flex items-center justify-center h-screen text-slate-400 text-sm gap-2">
        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
        </svg>
        Restoring session…
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="flex items-center gap-4 mb-6">
          <Link href={`/projects/${id}`} className="text-slate-500 hover:text-slate-700">
            &larr; Back to project
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Import STEP</h1>
        </div>
        {dropzone}
      </div>
    );
  }

  // ── Workspace ──────────────────────────────────────────────────────────────
  const { bodyStates, selectedFaceIndices, selectedBodyIdx } = activeSession!;
  const activeMeshData = meshCache[activeSession!.sessionId] ?? [];
  const confirmedCount = bodyStates.filter((bs) => bs.included && bs.confirmed).length;
  const selectedBody = bodyStates[selectedBodyIdx]?.body;
  const forcedFaceOccIndex = selectedFaceIndices[selectedBodyIdx];

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 bg-white shrink-0">

        {/* Left: back link + file tabs */}
        <div className="flex items-center gap-2 min-w-0 overflow-hidden">
          <Link href={`/projects/${id}`} className="text-slate-500 hover:text-slate-700 text-sm shrink-0">
            &larr; Project
          </Link>

          {/* Tabs */}
          <div className="flex items-center gap-1 overflow-x-auto min-w-0">
            {sessions.map((s, i) => (
              <div
                key={s.sessionId}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs shrink-0 select-none transition-colors ${
                  i === activeIdx && !addingNew
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 cursor-pointer'
                }`}
              >
                <span
                  onClick={() => { setActiveIdx(i); setAddingNew(false); }}
                  className="max-w-[140px] truncate cursor-pointer"
                >
                  {s.filename}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemoveSession(i); }}
                  className={`ml-0.5 rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none transition-colors ${
                    i === activeIdx && !addingNew ? 'hover:bg-white/20' : 'hover:bg-slate-300'
                  }`}
                  title="Remove this STEP"
                >
                  ×
                </button>
              </div>
            ))}

            {/* Add-new tab */}
            <button
              onClick={() => { setAddingNew(true); setUploadError(null); }}
              className={`px-2 py-1 rounded text-xs shrink-0 transition-colors ${
                addingNew
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
              title="Load another STEP file"
            >
              + STEP
            </button>
          </div>

          {!addingNew && meshLoading && (
            <span className="text-xs text-slate-400 animate-pulse shrink-0">Tessellating…</span>
          )}
        </div>

        {/* Right: controls */}
        {addingNew ? (
          <button
            onClick={() => { setAddingNew(false); setUploadError(null); }}
            className="text-sm text-slate-500 hover:text-slate-700 shrink-0"
          >
            Cancel
          </button>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex rounded border border-slate-200 overflow-hidden text-xs">
              {(['mm', 'in'] as UnitSystem[]).map((u) => (
                <button key={u} onClick={() => setUnits(u)}
                  className={`px-2 py-1 transition-colors ${units === u ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  {u}
                </button>
              ))}
            </div>
            <button
              onClick={handleExportAllDxfs}
              disabled={exportingAll || !bodyStates.some((b) => b.included)}
              className="px-3 py-1.5 text-xs border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-40"
            >
              {exportingAll ? 'Exporting…' : '↓ Export All DXFs'}
            </button>
            <button
              onClick={handleAddToCutList}
              disabled={adding || confirmedCount === 0}
              className="px-3 py-1.5 text-sm bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-40"
            >
              {adding ? 'Adding…' : `Add ${confirmedCount > 0 ? confirmedCount : ''} to Cut List →`}
            </button>
          </div>
        )}
      </div>

      {/* Success banner */}
      {addedCount !== null && !addingNew && (
        <div className="shrink-0 bg-emerald-50 border-b border-emerald-200 px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-sm text-emerald-800 font-medium">
              {addedCount} part{addedCount !== 1 ? 's' : ''} added to the cut list.
            </span>
          </div>
          <button
            onClick={() => router.push(`/projects/${id}`)}
            className="text-sm font-medium text-emerald-800 hover:text-emerald-950"
          >
            Go to project →
          </button>
        </div>
      )}

      {/* "Adding new" dropzone */}
      {addingNew ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-lg w-full">{dropzone}</div>
        </div>
      ) : (
        /* Three-column workspace */
        <div className="flex flex-1 min-h-0">
          {/* Left: Parts tree */}
          <div className="w-52 shrink-0 border-r border-slate-200 overflow-hidden">
            <StepSidebar
              bodyStates={bodyStates}
              selectedIndex={selectedBodyIdx}
              onSelect={(i) => updateActiveSession({ selectedBodyIdx: i })}
              onConfirmAll={handleConfirmAll}
              onToggle={(i) =>
                updateActiveSession((s) => ({
                  bodyStates: s.bodyStates.map((bs, idx) =>
                    idx === i ? { ...bs, included: !bs.included } : bs
                  ),
                }))
              }
              onRename={(i, name) =>
                updateActiveSession((s) => ({
                  bodyStates: s.bodyStates.map((bs, idx) =>
                    idx === i ? { ...bs, name } : bs
                  ),
                }))
              }
            />
          </div>

          {/* Center: 3D viewer */}
          <div className="flex-1 min-w-0 relative">
            {activeMeshData.length > 0 ? (
              <StepViewer3D
                meshData={activeMeshData}
                bodyStates={bodyStates}
                selectedBodyIdx={selectedBodyIdx}
                selectedFaceIndices={selectedFaceIndices}
                onSelectFace={handleSelectFace3D}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400">
                {meshLoading ? (
                  <>
                    <svg className="w-7 h-7 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                    </svg>
                    <span className="text-sm">Tessellating geometry…</span>
                  </>
                ) : (
                  <span className="text-sm">No 3D data</span>
                )}
              </div>
            )}
            {activeMeshData.length > 0 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-xs text-slate-400 bg-white/70 rounded px-2 py-1 pointer-events-none whitespace-nowrap">
                Drag: orbit · Shift/Right-drag: pan · Scroll: zoom · Click face: select
              </div>
            )}
          </div>

          {/* Drag separator */}
          <div
            className="w-[5px] shrink-0 cursor-col-resize flex items-center justify-center bg-slate-100 hover:bg-indigo-200 active:bg-indigo-400 transition-colors select-none group/sep"
            onPointerDown={onSepPointerDown}
            onPointerMove={onSepPointerMove}
            onPointerUp={onSepPointerUp}
            onPointerLeave={onSepPointerUp}
          >
            <div className="flex flex-col gap-[3px] pointer-events-none">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="w-[3px] h-[3px] rounded-full bg-slate-300 group-hover/sep:bg-indigo-400" />
              ))}
            </div>
          </div>

          {/* Right: 2D face preview */}
          <div style={{ width: previewWidth }} className="shrink-0 p-3 overflow-hidden flex flex-col border-l-0">
            {selectedBody ? (
              <>
                <div className="flex items-center gap-2 mb-2 shrink-0">
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider truncate flex-1">
                    {bodyStates[selectedBodyIdx]?.name ?? selectedBody.name}
                  </p>
                  {!bodyStates[selectedBodyIdx]?.confirmed ? (
                    <button
                      onClick={() =>
                        updateActiveSession((s) => ({
                          bodyStates: s.bodyStates.map((bs, i) =>
                            i === s.selectedBodyIdx ? { ...bs, confirmed: true } : bs
                          ),
                        }))
                      }
                      className="shrink-0 text-xs text-emerald-600 hover:text-emerald-800 font-medium"
                    >
                      ✓ Confirm
                    </button>
                  ) : (
                    <span className="shrink-0 text-xs text-emerald-500 font-medium flex items-center gap-0.5">
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Confirmed
                    </span>
                  )}
                </div>
                <div className="flex-1 min-h-0">
                  <StepPreviewPanel
                    key={selectedBody.index}
                    sessionId={activeSession!.sessionId}
                    body={selectedBody}
                    units={units}
                    forcedFaceOccIndex={forcedFaceOccIndex}
                    onFaceSelected={handleFaceSelectedFromPreview}
                    onFaceDims={handleFaceDims}
                    onFaceNavigated={handleFaceNavigated}
                  />
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm text-center">
                Click a face in the 3D view to preview its projection
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
