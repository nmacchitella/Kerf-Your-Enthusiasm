'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { OptimizationResult, ManualOverrides, PartInstanceKey } from '@/types';
import type { LayoutAction } from '@/hooks/useLayoutEditor';
import { buildMergedSheet, findConflicts, computeUsedArea, snapToGrid } from '@/lib/layout-utils';
import SheetCanvas from './SheetCanvas';
import ContextMenu from './ContextMenu';

interface LayoutEditorProps {
  result: OptimizationResult;
  overrides: ManualOverrides;
  selectedKeys: Set<PartInstanceKey>;
  excludedCuts: Array<{ instanceKey: PartInstanceKey; label: string; l: number; w: number }>;
  canUndo: boolean;
  canRedo: boolean;
  showLabels: boolean;
  gridSize: number;
  dispatch: (action: LayoutAction) => void;
  onExcludeKeys: (keys: PartInstanceKey[]) => void;
  onRestoreExcludedKey: (key: PartInstanceKey) => void;
  onRestoreAllExcluded: () => void;
  onReoptimize: () => void;
  onReoptimizeAll: () => void;
}

interface ContextMenuState {
  key: PartInstanceKey;
  clientX: number;
  clientY: number;
  sheetIndex: number;
}

interface PartOverlayState {
  key: PartInstanceKey;
  clientX: number;
  clientY: number;
}

const MAX_DISPLAY_WIDTH = 500;

export default function LayoutEditor({
  result,
  overrides,
  selectedKeys,
  excludedCuts,
  canUndo,
  canRedo,
  showLabels,
  gridSize,
  dispatch,
  onExcludeKeys,
  onRestoreExcludedKey,
  onRestoreAllExcluded,
  onReoptimize,
  onReoptimizeAll,
}: LayoutEditorProps) {
  const [zoom, setZoom] = useState(1);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [partOverlay, setPartOverlay] = useState<PartOverlayState | null>(null);
  const [unplacedOpen, setUnplacedOpen] = useState(true);
  const [excludedOpen, setExcludedOpen] = useState(true);

  const sheetRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [draggingKey, setDraggingKey] = useState<PartInstanceKey | null>(null);
  const [dropTargetSheet, setDropTargetSheet] = useState<number | null>(null);

  useEffect(() => {
    if (!draggingKey) return;
    const onMove = (e: PointerEvent) => {
      for (let i = 0; i < sheetRefs.current.length; i++) {
        const el = sheetRefs.current[i];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right &&
            e.clientY >= r.top  && e.clientY <= r.bottom) {
          setDropTargetSheet(i);
          return;
        }
      }
      setDropTargetSheet(null);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [draggingKey]);

  const baseScale = useMemo(() => {
    if (result.sheets.length === 0) return 4;
    const largest = Math.max(...result.sheets.map(s => Math.max(s.w, s.l)));
    return MAX_DISPLAY_WIDTH / largest;
  }, [result.sheets]);

  const scale = baseScale * zoom;

  const mergedSheets = useMemo(
    () => result.sheets.map((sheet, i) => buildMergedSheet(sheet, i, overrides, result.sheets)),
    [result.sheets, overrides]
  );

  const conflictSets = useMemo(
    () => mergedSheets.map((cuts, i) => findConflicts(cuts, result.sheets[i])),
    [mergedSheets, result.sheets]
  );

  const allConflictCount = useMemo(
    () => new Set(conflictSets.flatMap(s => [...s])).size,
    [conflictSets]
  );

  const sheetMetrics = useMemo(
    () => result.sheets.map((sheet, i) => {
      const merged = mergedSheets[i];
      const usedArea = computeUsedArea(merged);
      const totalArea = sheet.w * sheet.l;
      const utilPct = totalArea > 0 ? Math.round((usedArea / totalArea) * 100) : 0;
      const pinnedCount = merged.filter(c => overrides[c.instanceKey]?.pinned).length;
      const conflictCount = conflictSets[i].size;
      return { utilPct, pinnedCount, conflictCount };
    }),
    [result.sheets, mergedSheets, overrides, conflictSets]
  );

  const findSheetIndex = useCallback(
    (key: PartInstanceKey): number => {
      const ov = overrides[key];
      if (ov?.sheetIndex !== undefined) return ov.sheetIndex;
      for (let i = 0; i < result.sheets.length; i++) {
        if (result.sheets[i].cuts.some(c => c.instanceKey === key)) return i;
      }
      return 0;
    },
    [overrides, result.sheets]
  );

  // Look up a PlacedCut by key across all merged sheets
  const findPlacedCut = useCallback(
    (key: PartInstanceKey) => {
      for (const merged of mergedSheets) {
        const c = merged.find(c => c.instanceKey === key);
        if (c) return c;
      }
      return null;
    },
    [mergedSheets]
  );

  const handlePartDrop = useCallback(
    (key: PartInstanceKey, x: number, y: number, sheetIndex: number, clientX: number, clientY: number) => {
      // Check if the pointer landed over a different sheet
      for (let i = 0; i < result.sheets.length; i++) {
        if (i === sheetIndex) continue;
        const el = sheetRefs.current[i];
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right &&
            clientY >= r.top  && clientY <= r.bottom) {
          const cut = findPlacedCut(key);
          const unitX = snapToGrid(Math.max(0, (clientX - r.left) / scale - (cut?.pw ?? 0) / 2), gridSize);
          const unitY = snapToGrid(Math.max(0, (clientY - r.top)  / scale - (cut?.ph ?? 0) / 2), gridSize);
          dispatch({ type: 'MOVE', key, x: unitX, y: unitY, sheetIndex: i });
          if (!selectedKeys.has(key)) dispatch({ type: 'SELECT', keys: [key], additive: false });
          return;
        }
      }
      // Same-sheet drop
      dispatch({ type: 'MOVE', key, x, y, sheetIndex });
      if (!selectedKeys.has(key)) dispatch({ type: 'SELECT', keys: [key], additive: false });
    },
    [dispatch, selectedKeys, result.sheets, findPlacedCut, scale, gridSize]
  );

  const handlePartSelect = useCallback(
    (key: PartInstanceKey, additive: boolean) => dispatch({ type: 'SELECT', keys: [key], additive }),
    [dispatch]
  );

  const handleRubberBandSelect = useCallback(
    (keys: PartInstanceKey[]) => dispatch({ type: 'SELECT', keys, additive: false }),
    [dispatch]
  );

  const handleContextMenu = useCallback(
    (key: PartInstanceKey | null, clientX: number, clientY: number) => {
      if (!key) return;
      setContextMenu({ key, clientX, clientY, sheetIndex: findSheetIndex(key) });
    },
    [findSheetIndex]
  );

  const handleStageClick = useCallback(() => {
    dispatch({ type: 'DESELECT_ALL' });
    setPartOverlay(null);
  }, [dispatch]);

  const handlePartInfo = useCallback(
    (key: PartInstanceKey, clientX: number, clientY: number) => {
      setPartOverlay({ key, clientX, clientY });
    },
    []
  );

  const handleRotate = useCallback(() => {
    if (!contextMenu) return;
    for (const sheet of result.sheets) {
      const cut = sheet.cuts.find(c => c.instanceKey === contextMenu.key);
      if (cut) { dispatch({ type: 'ROTATE', key: contextMenu.key, cut, currentOverride: overrides[contextMenu.key] }); return; }
    }
  }, [contextMenu, result.sheets, overrides, dispatch]);

  const handlePin = useCallback(() => {
    if (!contextMenu) return;
    const key = contextMenu.key;
    for (let i = 0; i < result.sheets.length; i++) {
      const cut = result.sheets[i].cuts.find(c => c.instanceKey === key);
      if (cut) {
        const ov = overrides[key];
        dispatch({ type: 'PIN', key, x: ov?.x ?? cut.x, y: ov?.y ?? cut.y, rot: ov?.rot ?? cut.rot, sheetIndex: ov?.sheetIndex ?? i });
        return;
      }
    }
  }, [contextMenu, result.sheets, overrides, dispatch]);

  const handleUnpin = useCallback(() => {
    if (!contextMenu) return;
    dispatch({ type: 'UNPIN', key: contextMenu.key });
  }, [contextMenu, dispatch]);

  const handleMoveToSheet = useCallback(
    (targetSheet: number) => {
      if (!contextMenu) return;
      const ov = overrides[contextMenu.key];
      dispatch({ type: 'MOVE', key: contextMenu.key, x: ov?.x ?? 0, y: ov?.y ?? 0, sheetIndex: targetSheet });
    },
    [contextMenu, overrides, dispatch]
  );

  const handleAssignToSheet = useCallback(
    (targetSheet: number) => {
      if (!contextMenu) return;
      dispatch({ type: 'ASSIGN_SHEET', key: contextMenu.key, sheetIndex: targetSheet });
    },
    [contextMenu, dispatch]
  );

  const handleRemoveFromSheet = useCallback(() => {
    if (!contextMenu) return;
    dispatch({ type: 'REMOVE_FROM_SHEET', key: contextMenu.key });
  }, [contextMenu, dispatch]);

  const handleExcludeFromOptimization = useCallback(() => {
    if (!contextMenu) return;
    onExcludeKeys([contextMenu.key]);
  }, [contextMenu, onExcludeKeys]);

  const selCount = selectedKeys.size;

  return (
    <div className="flex flex-col rounded-xl overflow-hidden ring-1 ring-slate-200 bg-white">

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-white border-b border-slate-200 flex-shrink-0">

        {/* Undo / Redo */}
        <button
          onClick={() => dispatch({ type: 'UNDO' })}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 transition-colors text-base leading-none"
        >↩</button>
        <button
          onClick={() => dispatch({ type: 'REDO' })}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
          className="w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-25 transition-colors text-base leading-none"
        >↪</button>

        <div className="w-px h-4 bg-slate-200 mx-0.5" />

        {/* Zoom */}
        <div className="flex items-center text-xs text-slate-500 border border-slate-200 rounded-md overflow-hidden bg-slate-50">
          <button
            onClick={() => setZoom(z => Math.max(0.25, parseFloat((z - 0.25).toFixed(2))))}
            className="px-2 py-1 hover:bg-slate-100 hover:text-slate-800 transition-colors"
          >−</button>
          <span className="w-10 text-center text-slate-600 border-x border-slate-200 py-1 tabular-nums select-none">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(z => Math.min(4, parseFloat((z + 0.25).toFixed(2))))}
            className="px-2 py-1 hover:bg-slate-100 hover:text-slate-800 transition-colors"
          >+</button>
        </div>

        {/* Selection actions */}
        {selCount > 0 && (
          <>
            <div className="w-px h-4 bg-slate-200 mx-0.5" />
            <span className="text-xs text-slate-400 tabular-nums">{selCount} sel.</span>
            <button
              onClick={() => {
                for (const key of selectedKeys) {
                  for (const s of result.sheets) {
                    const cut = s.cuts.find(c => c.instanceKey === key);
                    if (cut) { dispatch({ type: 'ROTATE', key, cut, currentOverride: overrides[key] }); break; }
                  }
                }
              }}
              className="text-xs px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-800 transition-colors"
            >Rotate</button>
            <button
              onClick={() => {
                for (const key of selectedKeys) dispatch({ type: 'REMOVE_FROM_SHEET', key });
                dispatch({ type: 'DESELECT_ALL' });
              }}
              className="text-xs px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-800 transition-colors"
            >Unplace</button>
            <button
              onClick={() => onExcludeKeys([...selectedKeys])}
              className="text-xs px-2 py-1 rounded border border-red-100 bg-white hover:bg-red-50 text-red-500 hover:text-red-600 transition-colors"
            >Delete</button>
          </>
        )}

        <div className="flex-1" />

        {/* Conflict badge */}
        {allConflictCount > 0 && (
          <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md tabular-nums">
            ⚠ {allConflictCount} conflict{allConflictCount !== 1 ? 's' : ''}
          </span>
        )}

        {/* Full reset — demoted */}
        <button
          onClick={onReoptimizeAll}
          title="Re-run optimizer ignoring all pins"
          className="text-xs text-slate-400 hover:text-slate-600 transition-colors px-1"
        >Reset</button>

        {/* Re-optimize — primary CTA */}
        <button
          onClick={onReoptimize}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
        >↻ Re-optimize</button>
      </div>

      {/* ── Sheet grid — wrapping row layout on slate-100 surface ─── */}
      <div className="overflow-auto bg-slate-100">
        <div className="flex flex-wrap gap-6 p-5 min-w-fit">
          {result.sheets.map((sheet, i) => {
            const merged = mergedSheets[i];
            const conflicts = conflictSets[i];
            const metrics = sheetMetrics[i];
            const canvasW = Math.round(sheet.w * scale);
            const canvasH = Math.round(sheet.l * scale);

            return (
              <div key={i} className="flex flex-col">

                {/* Sheet label */}
                {result.sheets.length > 1 && (
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11px]">
                    <span className="font-medium text-slate-500">Sheet {i + 1}</span>
                    {sheet.name && <span className="text-slate-400">{sheet.name}</span>}
                  </div>
                )}

                {/* Canvas — shadow lifts it off the surface */}
                <div
                  ref={el => { sheetRefs.current[i] = el; }}
                  style={{ width: canvasW, height: canvasH }}
                  className={`shadow-md ring-1 select-none flex-shrink-0 transition-shadow ${
                    draggingKey && dropTargetSheet === i
                      ? 'ring-2 ring-indigo-400 shadow-indigo-200'
                      : 'ring-slate-300/60'
                  }`}
                >
                  <SheetCanvas
                    sheet={sheet}
                    sheetIndex={i}
                    mergedCuts={merged}
                    overrides={overrides}
                    selectedKeys={selectedKeys}
                    conflictKeys={conflicts}
                    gridSize={gridSize}
                    showLabels={showLabels}
                    scale={scale}
                    onPartDrop={handlePartDrop}
                    onPartSelect={handlePartSelect}
                    onPartInfo={handlePartInfo}
                    onRubberBandSelect={handleRubberBandSelect}
                    onContextMenu={handleContextMenu}
                    onStageClick={handleStageClick}
                    onPartDragStart={(key) => { setDraggingKey(key); setDropTargetSheet(null); }}
                    onPartDragEnd={() => { setDraggingKey(null); setDropTargetSheet(null); }}
                  />
                </div>

                {/* Per-sheet info strip */}
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400 select-none" style={{ maxWidth: canvasW }}>
                  {result.sheets.length === 1 && sheet.name && (
                    <span className="font-medium text-slate-500">{sheet.name}</span>
                  )}
                  <span className="tabular-nums">{sheet.w}" × {sheet.l}"</span>

                  {/* Utilization bar */}
                  <div className="flex items-center gap-1">
                    <div className="w-12 h-1 bg-slate-300 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          metrics.utilPct >= 80 ? 'bg-emerald-500'
                            : metrics.utilPct >= 50 ? 'bg-yellow-400'
                            : 'bg-slate-400'
                        }`}
                        style={{ width: `${metrics.utilPct}%` }}
                      />
                    </div>
                    <span className="tabular-nums">{metrics.utilPct}%</span>
                  </div>

                  {metrics.pinnedCount > 0 && (
                    <span className="text-indigo-500">⊕ {metrics.pinnedCount}</span>
                  )}
                  {metrics.conflictCount > 0 && (
                    <span className="text-red-500">⚠ {metrics.conflictCount}</span>
                  )}

                  <button
                    onClick={() => dispatch({ type: 'SELECT', keys: merged.map(c => c.instanceKey), additive: false })}
                    className="ml-auto text-slate-400 hover:text-slate-600 transition-colors"
                  >Select all</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Unplaced staging tray ──────────────────────────────────── */}
      {result.unplaced.length > 0 && (
        <div className="border-t border-amber-200 bg-amber-50 flex-shrink-0">
          <button
            onClick={() => setUnplacedOpen(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-amber-700 hover:text-amber-800 transition-colors"
          >
            <span>⚠</span>
            <span className="font-medium">
              {result.unplaced.length} part{result.unplaced.length !== 1 ? 's' : ''} didn&apos;t fit
            </span>
            <svg
              viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
              className={`w-3 h-3 ml-auto text-amber-400 transition-transform duration-200 ${unplacedOpen ? 'rotate-180' : ''}`}
            >
              <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {unplacedOpen && (
            <div className="px-4 pb-3 flex flex-wrap gap-1.5">
              {result.unplaced.map((p, j) => {
                const instanceKey = (p as typeof p & { instanceKey?: PartInstanceKey }).instanceKey;
                return (
                  <div
                    key={instanceKey ?? `${p.id}-${j}`}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-amber-200 rounded-full text-[11px] text-amber-700"
                  >
                    <span className="font-medium">{p.label}</span>
                    <span className="text-amber-300">·</span>
                    <span className="text-amber-500 tabular-nums">{p.l}×{p.w}</span>
                    {instanceKey && (
                      <>
                        <span className="text-amber-300">·</span>
                        <button
                          onClick={() => onExcludeKeys([instanceKey])}
                          className="text-amber-600 hover:text-amber-800 underline underline-offset-2"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Excluded tray ─────────────────────────────────────────── */}
      {excludedCuts.length > 0 && (
        <div className="border-t border-rose-200 bg-rose-50 flex-shrink-0">
          <button
            onClick={() => setExcludedOpen(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-rose-700 hover:text-rose-800 transition-colors"
          >
            <span>✕</span>
            <span className="font-medium">
              {excludedCuts.length} part{excludedCuts.length !== 1 ? 's' : ''} removed from optimization
            </span>
            <svg
              viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
              className={`w-3 h-3 ml-auto text-rose-400 transition-transform duration-200 ${excludedOpen ? 'rotate-180' : ''}`}
            >
              <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {excludedOpen && (
            <div className="px-4 pb-3 space-y-2">
              <div className="flex justify-end">
                <button
                  onClick={onRestoreAllExcluded}
                  className="text-[11px] text-rose-600 hover:text-rose-800 underline underline-offset-2"
                >
                  Restore all
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {excludedCuts.map((p) => (
                  <button
                    key={p.instanceKey}
                    onClick={() => onRestoreExcludedKey(p.instanceKey)}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-rose-200 rounded-full text-[11px] text-rose-700 hover:bg-rose-100 transition-colors"
                  >
                    <span className="font-medium">{p.label}</span>
                    <span className="text-rose-300">·</span>
                    <span className="text-rose-500 tabular-nums">{p.l}×{p.w}</span>
                    <span className="text-rose-400">Restore</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Materials summary ─────────────────────────────────────── */}
      {(() => {
        const tally = new Map<string, { w: number; l: number; name: string; count: number }>();
        for (const sheet of result.sheets) {
          const key = `${sheet.name}__${sheet.w}__${sheet.l}`;
          const existing = tally.get(key);
          if (existing) existing.count++;
          else tally.set(key, { name: sheet.name, w: sheet.w, l: sheet.l, count: 1 });
        }
        const rows = [...tally.values()];
        return (
          <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 flex-shrink-0">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider mb-2">Materials needed</div>
            <div className="space-y-1">
              {rows.map((r, i) => (
                <div key={i} className="flex items-baseline justify-between text-xs">
                  <span className="text-slate-600 font-medium truncate pr-2">{r.name}</span>
                  <span className="text-slate-400 tabular-nums shrink-0">
                    {r.w}" × {r.l}"
                    <span className="ml-2 font-semibold text-slate-600">× {r.count}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          targetKey={contextMenu.key}
          clientX={contextMenu.clientX}
          clientY={contextMenu.clientY}
          isPinned={overrides[contextMenu.key]?.pinned ?? false}
          sheetCount={result.sheets.length}
          currentSheetIndex={contextMenu.sheetIndex}
          onClose={() => setContextMenu(null)}
          onRotate={handleRotate}
          onPin={handlePin}
          onUnpin={handleUnpin}
          onMoveToSheet={handleMoveToSheet}
          onAssignToSheet={handleAssignToSheet}
          onRemoveFromSheet={handleRemoveFromSheet}
          onExcludeFromOptimization={handleExcludeFromOptimization}
        />
      )}

      {/* Part info overlay — appears on single-part click */}
      {partOverlay && selectedKeys.size === 1 && (() => {
        const cut = findPlacedCut(partOverlay.key);
        if (!cut) return null;
        const x = Math.min(partOverlay.clientX + 14, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 200);
        const y = Math.min(partOverlay.clientY + 14, (typeof window !== 'undefined' ? window.innerHeight : 9999) - 120);
        return (
          <div
            style={{ position: 'fixed', left: x, top: y, zIndex: 9000 }}
            className="pointer-events-none bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2.5 text-xs min-w-[140px]"
          >
            <div className="font-semibold text-slate-800 mb-1">{cut.label}</div>
            <div className="text-slate-500 tabular-nums">{cut.pw}&quot; × {cut.ph}&quot;</div>
            {cut.rot && <div className="text-indigo-400 mt-0.5">rotated 90°</div>}
            <div className="text-slate-300 mt-1 tabular-nums">at {cut.x.toFixed(2)}&quot;, {cut.y.toFixed(2)}&quot;</div>
          </div>
        );
      })()}
    </div>
  );
}
