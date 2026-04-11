'use client';

import { useState, useEffect, useCallback } from 'react';
import { SvgPreview } from './SvgPreview';
import { StepBody, StepFace } from './StepBodyRow';
import { mmToIn } from '@/lib/unit-utils';
import { UnitSystem } from '@/types';

interface EdgeData {
  edges: unknown[];
  face_dims_mm?: [number, number, number] | null;
}

interface Props {
  sessionId: string;
  body: StepBody;
  units: UnitSystem;
  /** OCC face index forced by a 3D viewer click. If set, jumps to that face. */
  forcedFaceOccIndex?: number;
  onFaceSelected: (faceIndex: number) => void;
  /** Called with [l, w, t] in mm whenever the projected face dimensions change. */
  onFaceDims?: (dims: [number, number, number]) => void;
  /** Called whenever the user explicitly navigates faces (◀/▶), to mark confirmed. */
  onFaceNavigated?: () => void;
}

function fmt(val: number, units: UnitSystem): string {
  const n = units === 'mm' ? val : mmToIn(val);
  return n.toFixed(units === 'mm' ? 1 : 3);
}

export function StepPreviewPanel({
  sessionId,
  body,
  units,
  forcedFaceOccIndex,
  onFaceSelected,
  onFaceDims,
  onFaceNavigated,
}: Props) {
  const planarFaces = body.faces.filter((f) => f.is_planar);
  const topFaceIdx = planarFaces.findIndex((f) => f.is_top_face);
  const [planarIdx, setPlanarIdx] = useState(topFaceIdx >= 0 ? topFaceIdx : 0);
  const [edgeData, setEdgeData] = useState<EdgeData | null>(null);
  const [faceDims, setFaceDims] = useState<[number, number, number] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentFace: StepFace | undefined = planarFaces[planarIdx];

  // When 3D viewer forces a face selection, find it in planarFaces and jump to it
  useEffect(() => {
    if (forcedFaceOccIndex === undefined) return;
    const idx = planarFaces.findIndex((f) => f.index === forcedFaceOccIndex);
    if (idx >= 0) setPlanarIdx(idx);
    // If the face isn't planar, don't jump — but the 3D click still updates selection
  }, [forcedFaceOccIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset to top face when body changes
  useEffect(() => {
    const top = planarFaces.findIndex((f) => f.is_top_face);
    setPlanarIdx(top >= 0 ? top : 0);
  }, [body.index]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPreview = useCallback(async () => {
    if (!currentFace) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/step/${sessionId}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body_index: body.index,
          face_index: currentFace.index,
          face_centroid: currentFace.centroid,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? `Preview failed (${res.status})`);
      }
      const data = await res.json();
      setEdgeData(data);
      if (data.face_dims_mm) {
        setFaceDims(data.face_dims_mm);
        onFaceDims?.(data.face_dims_mm);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  }, [sessionId, body.index, currentFace]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  useEffect(() => {
    if (currentFace) onFaceSelected(currentFace.index);
  }, [currentFace, onFaceSelected]);

  const prev = () => { setPlanarIdx((i) => (i - 1 + planarFaces.length) % planarFaces.length); onFaceNavigated?.(); };
  const next = () => { setPlanarIdx((i) => (i + 1) % planarFaces.length); onFaceNavigated?.(); };

  const dims = faceDims ?? body.bbox_mm;
  const dimLabel = units === 'mm' ? 'mm' : 'in';

  return (
    <div className="flex flex-col h-full">
      {/* SVG preview area */}
      <div className="flex-1 bg-slate-50 rounded-lg border border-slate-200 overflow-hidden flex items-center justify-center min-h-0">
        {loading && <div className="text-slate-400 text-sm">Loading preview…</div>}
        {!loading && error && (
          <div className="text-red-500 text-sm px-4 text-center">{error}</div>
        )}
        {!loading && !error && edgeData && (
          <div className="w-full h-full p-3">
            <SvgPreview edgeData={edgeData as Parameters<typeof SvgPreview>[0]['edgeData']} />
          </div>
        )}
        {!loading && !error && !edgeData && (
          <div className="text-slate-400 text-sm">Select a planar face to preview</div>
        )}
      </div>

      {/* Face nav + info */}
      <div className="mt-3 space-y-2 shrink-0">
        {planarFaces.length > 0 ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Planar face {planarIdx + 1} / {planarFaces.length}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={prev}
                  disabled={planarFaces.length <= 1}
                  className="px-2 py-0.5 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40"
                >
                  ◀
                </button>
                <button
                  onClick={next}
                  disabled={planarFaces.length <= 1}
                  className="px-2 py-0.5 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40"
                >
                  ▶
                </button>
              </div>
            </div>

            {currentFace && (
              <div className="text-xs text-slate-500 space-y-0.5">
                {currentFace.normal && (
                  <p>Normal: ({currentFace.normal.map((n) => n.toFixed(2)).join(', ')})</p>
                )}
                <p>Area: {(currentFace.area / 100).toFixed(1)} cm²</p>
                {dims && (
                  <p>
                    {fmt(dims[0], units)} × {fmt(dims[1], units)} × {fmt(dims[2], units)} {dimLabel}
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-400">No planar faces on this body</p>
        )}
      </div>
    </div>
  );
}
