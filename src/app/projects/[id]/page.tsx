'use client';

import { useState, useEffect, useMemo, use, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { optimizeCutsBest, calculateStats } from '@/lib/cut-optimizer';
import { toFraction } from '@/lib/fraction-utils';
import { STOCK_PRESETS, MATERIALS, KERF_PRESETS, CUT_COLORS } from '@/lib/constants';
import { UnitToggle } from '@/components/ui/UnitToggle';
import { inToMM, mmToIn } from '@/lib/unit-utils';
import { jsPDF } from 'jspdf';
import type {
  Stock as StockType,
  Cut as CutType,
  OptimizationResult,
  UnitSystem,
  PartInstanceKey,
  PlacedCut,
  ManualOverrides,
} from '@/types';
import { useLayoutEditor } from '@/hooks/useLayoutEditor';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { buildPinnedPlacements, buildSheetAssignments, buildMergedSheet } from '@/lib/layout-utils';
import { expandCutsWithKeys } from '@/lib/instance-key';
import LayoutEditor from '@/components/canvas/LayoutEditor';
import { SheetDxfPreview, type SheetPreviewData } from '@/components/step/SheetDxfPreview';

interface DBStock {
  id: string;
  name: string;
  length: number;
  width: number;
  thickness: number | null;
  quantity: number;
  material: string;
}

interface DBCut {
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
}

interface DBStepBodyState {
  bodyIndex: number;
  name: string;
  included: boolean;
  confirmed: boolean;
  selectedFaceIndex?: number;
}

interface DBStepFile {
  id: string;
  filename: string;
  fileSize: number;
  selectedBodyIndex: number;
  sortOrder: number;
  bodyState: DBStepBodyState[];
  sessionId: string | null;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  kerf: number;
  units: string | null;
  groupMultipliers: string | null;
  layoutOverrides: Record<string, unknown>;
  layoutExcludedKeys: string[];
  layoutPadding: number;
  layoutHasActive: boolean;
  stepActiveFileId?: string | null;
  stocks: DBStock[];
  cuts: DBCut[];
  stepFiles: DBStepFile[];
}

interface NumberedPlacedCut extends PlacedCut {
  partNumber: number;
}

interface SheetExportPayload {
  session_id: string;
  sheet_width_mm: number;
  sheet_length_mm: number;
  sheet_name: string;
  placements: Array<{
    body_index: number;
    face_index: number;
    body_name: string;
    x_mm: number;
    y_mm: number;
    rot: boolean;
    session_id: string;
  }>;
  rect_placements: Array<{
    body_name: string;
    x_mm: number;
    y_mm: number;
    w_mm: number;
    h_mm: number;
  }>;
}

type SheetLayerStyle = 'default' | 'vcarve';

interface PartLabelSource {
  label: string;
  group?: string;
  stepFileId?: string | null;
  stepSessionId?: string | null;
}

interface PartPreviewData {
  edges: SheetPreviewData['edges'];
  face_dims_mm?: [number, number, number] | null;
}

interface PartOperationSummary {
  hasHoles: boolean;
  depthsMm: number[];
  thicknessMm: number | null;
}

function sanitizeFilenameSegment(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function stripStepFilenameSuffix(value: string): string {
  return value.replace(/\.(step|stp)$/i, '').trim();
}

function buildStepFilenameMap(stepFiles: DBStepFile[]): Map<string, string> {
  return new Map(stepFiles.map((stepFile) => [stepFile.id, stepFile.filename]));
}

function buildStepSessionMap(stepFiles: DBStepFile[]): Map<string, string> {
  return new Map(
    stepFiles
      .filter((stepFile): stepFile is DBStepFile & { sessionId: string } => Boolean(stepFile.sessionId))
      .map((stepFile) => [stepFile.id, stepFile.sessionId])
  );
}

function buildSheetDxfFilename(
  sheetIdx: number,
  sheetName: string,
  layerStyle: SheetLayerStyle = 'default'
): string {
  const stem = `Sheet_${sheetIdx + 1}_${sanitizeFilenameSegment(sheetName, 'sheet')}`;
  return layerStyle === 'vcarve' ? `${stem}_vcarve.dxf` : `${stem}.dxf`;
}

function buildVcarveReadme(projectName: string): string {
  return [
    `${projectName} - VCarve DXF Export`,
    '',
    'These DXFs represent the current optimized sheet layout from Kerfuffle.',
    'The files use VCarve-oriented layer names so you can map template toolpaths by layer.',
    '',
    'Current layer mapping:',
    '- OUTSIDE_PROFILE: outside/profile cuts',
    '- INTERIOR_OPENINGS: interior cut-through openings',
    '- POCKET_*MM: pocket geometry by depth in millimeters',
    '- SHEET_BOUNDARY: stock outline',
    '- LABELS: part labels',
    '',
    'Suggested VCarve template setup:',
    '- Profile toolpath selecting OUTSIDE_PROFILE',
    '- Profile or drill toolpath selecting INTERIOR_OPENINGS as needed',
    '- Pocket toolpaths selecting each POCKET_*MM layer',
  ].join('\n');
}

function buildExportPartLabel(cut: PartLabelSource, stepFilenameMap: Map<string, string>): string {
  const partName = cut.label.trim();
  const sourceName = stripStepFilenameSuffix(
    cut.stepFileId
      ? stepFilenameMap.get(cut.stepFileId) ?? ''
      : cut.group ?? ''
  );

  if (!sourceName) return partName || 'Part';
  if (!partName) return sourceName;

  const normalizedSource = sourceName.toLowerCase();
  const normalizedPart = partName.toLowerCase();
  if (normalizedPart === normalizedSource || normalizedPart.startsWith(`${normalizedSource} - `)) {
    return partName;
  }

  return `${sourceName} - ${partName}`;
}

function parseDepthLayerMm(layer?: string): number | null {
  const match = layer?.match(/^DEPTH_([0-9]+(?:\.[0-9]+)?)mm$/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeThicknessMm(thicknessMm?: number | null): number | null {
  return thicknessMm && Number.isFinite(thicknessMm) && thicknessMm > 0 ? thicknessMm : null;
}

function depthMatchesThickness(depthMm: number, thicknessMm?: number | null): boolean {
  const normalizedThickness = normalizeThicknessMm(thicknessMm);
  if (normalizedThickness === null) return false;
  return Math.abs(depthMm - normalizedThickness) <= 0.1;
}

function summarizeOperationLayers(
  edges: Array<{ layer?: string }>,
  thicknessMm?: number | null
): PartOperationSummary {
  const depthSet = new Set<number>();
  let hasHoles = false;

  for (const edge of edges) {
    if (edge.layer === 'HOLES') {
      hasHoles = true;
    }
    const depthMm = parseDepthLayerMm(edge.layer);
    if (depthMm !== null) {
      depthSet.add(depthMm);
    }
  }

  const sortedDepths = [...depthSet].sort((a, b) => a - b);
  const normalizedThickness = normalizeThicknessMm(thicknessMm);

  return {
    hasHoles,
    depthsMm: sortedDepths.filter((depthMm) => !depthMatchesThickness(depthMm, normalizedThickness)),
    thicknessMm: normalizedThickness,
  };
}

function mergeOperationSummaries(summaries: Array<PartOperationSummary | null>): PartOperationSummary {
  const depthSet = new Set<number>();
  let hasHoles = false;

  for (const summary of summaries) {
    if (!summary) continue;
    if (summary.hasHoles) hasHoles = true;
    summary.depthsMm.forEach((depth) => depthSet.add(depth));
  }

  return {
    hasHoles,
    depthsMm: [...depthSet].sort((a, b) => a - b),
    thicknessMm: null,
  };
}

function formatOperationDepth(depthMm: number, units: UnitSystem): string {
  return units === 'mm'
    ? `${depthMm.toFixed(1)} mm`
    : `${mmToIn(depthMm).toFixed(3)} in (${depthMm.toFixed(1)} mm)`;
}

function formatPartThickness(thicknessMm: number, units: UnitSystem): string {
  return units === 'mm'
    ? thicknessMm.toFixed(1)
    : toFraction(mmToIn(thicknessMm));
}

function buildOperationLines(
  cut: PartLabelSource,
  summary: PartOperationSummary | null,
  units: UnitSystem
): string[] {
  if (!cut.stepFileId && !cut.stepSessionId) return [];
  if (!summary) return ['Ops unavailable'];
  if (!summary.hasHoles && summary.depthsMm.length === 0) return ['Profile only'];

  const lines: string[] = [];
  if (summary.hasHoles) {
    lines.push('Holes');
  }
  if (summary.depthsMm.length === 1) {
    lines.push(`Pocket depth: ${formatOperationDepth(summary.depthsMm[0], units)}`);
  } else if (summary.depthsMm.length > 1) {
    lines.push(`Pocket depths: ${summary.depthsMm.map((depth) => formatOperationDepth(depth, units)).join(', ')}`);
  }
  return lines;
}

function buildSheetOperationText(summary: PartOperationSummary, units: UnitSystem): string {
  const parts = ['Profiles'];
  if (summary.hasHoles) {
    parts.push('holes');
  }
  if (summary.depthsMm.length === 1) {
    parts.push(`pocket ${formatOperationDepth(summary.depthsMm[0], units)}`);
  } else if (summary.depthsMm.length > 1) {
    parts.push(`pockets ${summary.depthsMm.map((depth) => formatOperationDepth(depth, units)).join(', ')}`);
  }
  return parts.join(' · ');
}

function getPartThicknessDisplay(
  cut: Pick<PlacedCut, 't'>,
  summary: PartOperationSummary | null,
  units: UnitSystem
): string {
  if (summary?.thicknessMm) {
    return formatPartThickness(summary.thicknessMm, units);
  }
  if (cut.t > 0) {
    return units === 'mm' ? cut.t.toFixed(1) : toFraction(cut.t);
  }
  return '';
}

function getPdfLayerColor(layer?: string): [number, number, number] {
  if (layer === 'SHEET_BOUNDARY') return [148, 163, 184];
  if (layer === 'HOLES') return [220, 38, 38];
  if (layer?.startsWith('DEPTH_')) return [37, 99, 235];
  return [15, 23, 42];
}

function getPdfLayerLineWidth(layer?: string): number {
  if (layer === 'SHEET_BOUNDARY') return 1.1;
  if (layer?.startsWith('DEPTH_')) return 0.55;
  return 0.72;
}

function getPdfLayerDrawPriority(layer?: string): number {
  if (layer === 'SHEET_BOUNDARY') return 0;
  if (layer?.startsWith('DEPTH_')) return 1;
  if (!layer || layer === 'PROFILE') return 2;
  if (layer === 'HOLES') return 3;
  return 1;
}

function toAppStock(s: DBStock, index: number): StockType {
  return {
    id: index + 1,
    dbId: s.id,
    name: s.name,
    l: s.length,
    w: s.width,
    t: s.thickness ?? 0,
    qty: s.quantity,
    mat: s.material,
  };
}

function toAppCut(c: DBCut, index: number): CutType {
  return {
    id: index + 1,
    dbId: c.id,
    label: c.label,
    l: c.length,
    w: c.width,
    t: c.thickness ?? 0,
    qty: c.quantity,
    mat: c.material,
    group: c.groupName ?? undefined,
    stepFileId: c.stepFileId ?? undefined,
    stepSessionId: c.stepSessionId ?? undefined,
    stepBodyIndex: c.stepBodyIndex ?? undefined,
    stepFaceIndex: c.stepFaceIndex ?? undefined,
  };
}

// ── Reusable stepper input ────────────────────────────────────────────────────

// ── Inline-editable cut row ───────────────────────────────────────────────────

function CutRow({
  cut,
  dim,
  onChange,
  onRemove,
  onDownloadDxf,
  onDragStart,
  onDragEnd,
  isDropTarget,
  onDragOver,
  onDragLeave,
  onDrop,
  inGroup,
  selected,
  onToggleSelect,
}: {
  cut: CutType;
  dim: (v: number) => string;
  onChange: (updated: CutType) => void;
  onRemove: () => void;
  onDownloadDxf: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  isDropTarget: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
  inGroup?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(cut.label);
  const [editingQty, setEditingQty] = useState(false);
  const [qtyDraft, setQtyDraft] = useState(String(cut.qty));
  const [editingT, setEditingT] = useState(false);
  const [tDraft, setTDraft] = useState(String(cut.t));
  const [editingMat, setEditingMat] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const tRef = useRef<HTMLInputElement>(null);
  const matRef = useRef<HTMLSelectElement>(null);

  useEffect(() => { if (editingLabel) labelRef.current?.select(); }, [editingLabel]);
  useEffect(() => { if (editingQty) qtyRef.current?.select(); }, [editingQty]);
  useEffect(() => { if (editingT) tRef.current?.select(); }, [editingT]);
  useEffect(() => { if (editingMat) matRef.current?.focus(); }, [editingMat]);

  const commitLabel = () => {
    setEditingLabel(false);
    const v = labelDraft.trim();
    if (v && v !== cut.label) onChange({ ...cut, label: v });
    else setLabelDraft(cut.label);
  };
  const commitQty = () => {
    setEditingQty(false);
    const v = parseInt(qtyDraft);
    if (!isNaN(v) && v > 0 && v !== cut.qty) onChange({ ...cut, qty: v });
    else setQtyDraft(String(cut.qty));
  };
  const commitT = () => {
    setEditingT(false);
    const v = parseFloat(tDraft);
    if (!isNaN(v) && v >= 0 && v !== cut.t) onChange({ ...cut, t: v });
    else setTDraft(String(cut.t));
  };

  return (
    <div
      className={`rounded-md transition-all group/row ${
        isDropTarget
          ? 'bg-indigo-50 ring-2 ring-indigo-300 ring-offset-1'
          : selected
          ? 'bg-indigo-50 ring-1 ring-indigo-200'
          : inGroup ? 'bg-white hover:bg-slate-50' : 'bg-slate-50 hover:bg-white'
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Row 1: drag handle + checkbox + label + delete */}
      <div className="flex items-center gap-2 px-2 pt-2 pb-0.5">
        <div
          draggable
          onDragStart={(e) => { e.stopPropagation(); onDragStart(); }}
          onDragEnd={onDragEnd}
          className="shrink-0 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 touch-none"
          title="Drag to group with another part"
        >
          <svg className="w-3 h-4" viewBox="0 0 8 16" fill="currentColor">
            <circle cx="2" cy="3" r="1.2"/><circle cx="6" cy="3" r="1.2"/>
            <circle cx="2" cy="8" r="1.2"/><circle cx="6" cy="8" r="1.2"/>
            <circle cx="2" cy="13" r="1.2"/><circle cx="6" cy="13" r="1.2"/>
          </svg>
        </div>

        {onToggleSelect && (
          <input
            type="checkbox"
            checked={selected ?? false}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            className={`shrink-0 w-3.5 h-3.5 accent-indigo-600 cursor-pointer transition-opacity rounded ${
              selected ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'
            }`}
          />
        )}

        <div className="flex-1 min-w-0">
          {editingLabel ? (
            <input
              ref={labelRef}
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={commitLabel}
              onKeyDown={(e) => { if (e.key === 'Enter') commitLabel(); if (e.key === 'Escape') { setEditingLabel(false); setLabelDraft(cut.label); } }}
              className="w-full text-sm font-medium px-1 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          ) : (
            <button
              className="text-sm font-medium text-slate-700 text-left w-full flex items-center gap-1 hover:text-slate-900 group/lbl"
              onClick={() => { setEditingLabel(true); setLabelDraft(cut.label); }}
              title="Click to rename"
            >
              <span className="truncate">{cut.label}</span>
              <svg className="w-3 h-3 text-slate-300 opacity-0 group-hover/lbl:opacity-100 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 0l.172.172a2 2 0 010 2.828L12 16H9v-3z" />
              </svg>
            </button>
          )}
        </div>

        <button
          onClick={onRemove}
          title="Delete part"
          className="shrink-0 inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-1 text-xs font-medium text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3M4 7h16" />
          </svg>
          <span>Delete</span>
        </button>
      </div>

      {/* Row 2: dims · T · mat · qty + DXF + STEP badge */}
      <div className="flex items-center gap-1.5 px-2 pb-2 pl-7 flex-wrap">
        <span className="text-xs text-slate-400 shrink-0">{dim(cut.l)} × {dim(cut.w)}</span>

        <span className="text-slate-200 text-xs shrink-0">·</span>

        {/* Thickness */}
        {editingT ? (
          <input
            ref={tRef}
            type="number" min={0} step="0.0625"
            value={tDraft}
            onChange={(e) => setTDraft(e.target.value)}
            onBlur={commitT}
            onKeyDown={(e) => { if (e.key === 'Enter') commitT(); if (e.key === 'Escape') { setEditingT(false); setTDraft(String(cut.t)); } }}
            className="w-16 shrink-0 text-xs text-center px-1 py-0.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        ) : (
          <button
            onClick={() => { setEditingT(true); setTDraft(String(cut.t)); }}
            title="Click to set thickness (0 = any)"
            className={`shrink-0 text-xs rounded px-1.5 py-0.5 transition-colors ${
              cut.t > 0
                ? 'font-medium text-slate-600 bg-slate-100 hover:bg-slate-200'
                : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100'
            }`}
          >
            T: {cut.t > 0 ? dim(cut.t) : '–'}
          </button>
        )}

        {/* Material */}
        {editingMat ? (
          <select
            ref={matRef}
            value={cut.mat || ''}
            onChange={(e) => { onChange({ ...cut, mat: e.target.value }); setEditingMat(false); }}
            onBlur={() => setEditingMat(false)}
            className="shrink-0 text-xs px-1 py-0.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-500 bg-white"
          >
            <option value="">Any material</option>
            {MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <button
            onClick={() => setEditingMat(true)}
            title="Click to set material"
            className={`shrink-0 text-xs rounded px-1.5 py-0.5 transition-colors ${
              cut.mat
                ? 'font-medium text-slate-600 bg-slate-100 hover:bg-slate-200'
                : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100'
            }`}
          >
            {cut.mat || 'Any mat'}
          </button>
        )}

        {/* Qty */}
        {editingQty ? (
          <input
            ref={qtyRef}
            type="number" min={1}
            value={qtyDraft}
            onChange={(e) => setQtyDraft(e.target.value)}
            onBlur={commitQty}
            onKeyDown={(e) => { if (e.key === 'Enter') commitQty(); if (e.key === 'Escape') { setEditingQty(false); setQtyDraft(String(cut.qty)); } }}
            className="w-14 shrink-0 text-xs text-center px-1 py-0.5 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-500"
          />
        ) : (
          <button
            onClick={() => { setEditingQty(true); setQtyDraft(String(cut.qty)); }}
            title="Click to change quantity"
            className="shrink-0 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded px-1.5 py-0.5 transition-colors"
          >
            ×{cut.qty}
          </button>
        )}

        {/* DXF download */}
        {(cut.stepFileId || cut.stepSessionId) && (
          <button
            onClick={onDownloadDxf}
            className="shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity text-xs text-slate-400 hover:text-slate-700 px-1.5 py-0.5 border border-slate-200 rounded"
            title="Download DXF"
          >
            ↓ DXF
          </button>
        )}

        {/* STEP badge */}
        {(cut.stepFileId || cut.stepSessionId) && (
          <span title="From STEP import" className="shrink-0 text-xs text-slate-300 font-medium">3D</span>
        )}

        {/* Drop-to-group hint */}
        {isDropTarget && (
          <span className="shrink-0 text-xs text-indigo-500 font-medium animate-pulse">Group together?</span>
        )}
      </div>
    </div>
  );
}

// ── Grouped cut list ──────────────────────────────────────────────────────────

function CutList({
  cuts,
  dim,
  onChange,
  onRemove,
  onDownloadDxf,
  groupMultipliers,
  onMultiplierChange,
}: {
  cuts: CutType[];
  dim: (v: number) => string;
  onChange: (updated: CutType[]) => void;
  onRemove: (id: number) => void;
  onDownloadDxf: (cut: CutType) => void;
  groupMultipliers: Record<string, number>;
  onMultiplierChange: (group: string, mult: number) => void;
}) {
  const [draggingCutId, setDraggingCutId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<
    { kind: 'cut'; id: number } | { kind: 'group'; name: string } | null
  >(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggleSelect = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const groupSelected = useCallback(() => {
    if (selected.size < 2) return;
    const used = new Set(cuts.map((c) => c.group).filter(Boolean));
    let n = 1;
    while (used.has(`Group ${n}`)) n++;
    const groupName = `Group ${n}`;
    onChange(cuts.map((c) => selected.has(c.id) ? { ...c, group: groupName } : c));
    setSelected(new Set());
  }, [cuts, onChange, selected]);

  const groups = useMemo(() => {
    const map = new Map<string, CutType[]>();
    const order: string[] = [];
    for (const cut of cuts) {
      const key = cut.group ?? '';
      if (!map.has(key)) { map.set(key, []); order.push(key); }
      map.get(key)!.push(cut);
    }
    return order
      .map((name) => ({ name, items: map.get(name)! }))
      .sort((a, b) => !a.name && b.name ? 1 : a.name && !b.name ? -1 : a.name.localeCompare(b.name));
  }, [cuts]);

  const updateCut = useCallback((updated: CutType) => {
    onChange(cuts.map((c) => (c.id === updated.id ? updated : c)));
  }, [cuts, onChange]);

  const handleDrop = useCallback((target: typeof dropTarget) => {
    const srcId = draggingCutId;
    if (srcId === null || target === null) { setDropTarget(null); return; }

    const next = cuts.map((c) => ({ ...c }));
    const srcIdx = next.findIndex((c) => c.id === srcId);
    if (srcIdx === -1) { setDropTarget(null); return; }

    if (target.kind === 'group') {
      if (next[srcIdx].group !== target.name) {
        next[srcIdx].group = target.name;
        onChange(next);
      }
    } else {
      if (target.id === srcId) { setDropTarget(null); return; }
      const tgtIdx = next.findIndex((c) => c.id === target.id);
      const tgtGroup = next[tgtIdx]?.group;
      if (tgtGroup) {
        next[srcIdx].group = tgtGroup;
      } else {
        const used = new Set(cuts.map((c) => c.group).filter(Boolean));
        let n = 1;
        while (used.has(`Group ${n}`)) n++;
        next[srcIdx].group = `Group ${n}`;
        next[tgtIdx].group = `Group ${n}`;
      }
      onChange(next);
    }
    setDraggingCutId(null);
    setDropTarget(null);
  }, [cuts, draggingCutId, onChange]);

  const renameGroup = useCallback((oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    onChange(cuts.map((c) => (c.group === oldName ? { ...c, group: trimmed } : c)));
  }, [cuts, onChange]);

  const ungroupAll = useCallback((groupName: string) => {
    onChange(cuts.map((c) => (c.group === groupName ? { ...c, group: undefined } : c)));
  }, [cuts, onChange]);

  const removeFromGroup = useCallback((cutId: number) => {
    onChange(cuts.map((c) => (c.id === cutId ? { ...c, group: undefined } : c)));
  }, [cuts, onChange]);

  if (cuts.length === 0) {
    return <p className="text-slate-500 text-xs text-center py-4">No parts added yet</p>;
  }

  const isDragging = draggingCutId !== null;

  return (
    <div className="space-y-2">
      {groups.map(({ name, items }) => {
        if (!name) {
          const allSelected = items.length > 0 && items.every((c) => selected.has(c.id));
          const someSelected = items.some((c) => selected.has(c.id));
          const selectedCount = items.filter((c) => selected.has(c.id)).length;

          return (
            <div key="__ungrouped__" className="space-y-1">
              {/* Select-all toolbar */}
              {items.length > 1 && (
                <div className="flex items-center gap-2 px-2 py-1">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={() => {
                      if (allSelected) setSelected(new Set());
                      else setSelected(new Set(items.map((c) => c.id)));
                    }}
                    className="w-3.5 h-3.5 accent-indigo-600 cursor-pointer"
                  />
                  {someSelected ? (
                    <>
                      <span className="text-xs text-slate-500">{selectedCount} selected</span>
                      {selectedCount >= 2 && (
                        <button
                          onClick={groupSelected}
                          className="text-xs font-medium text-white bg-indigo-500 hover:bg-indigo-600 rounded px-2 py-0.5 transition-colors"
                        >
                          Group {selectedCount}
                        </button>
                      )}
                      <button
                        onClick={() => setSelected(new Set())}
                        className="text-xs text-slate-400 hover:text-slate-600"
                      >
                        Clear
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-slate-300">Select all</span>
                  )}
                </div>
              )}
              {isDragging && groups.some((g) => g.name) && (
                <p className="text-xs text-slate-400 text-center py-1">Drag onto another part to group, or onto a group card</p>
              )}
              {items.map((cut) => (
                <CutRow
                  key={cut.id}
                  cut={cut}
                  dim={dim}
                  onChange={updateCut}
                  onRemove={() => onRemove(cut.id)}
                  onDownloadDxf={() => onDownloadDxf(cut)}
                  onDragStart={() => { setDraggingCutId(cut.id); setDropTarget(null); }}
                  onDragEnd={() => { setDraggingCutId(null); setDropTarget(null); }}
                  isDropTarget={dropTarget?.kind === 'cut' && dropTarget.id === cut.id}
                  onDragOver={(e) => { e.preventDefault(); if (draggingCutId !== cut.id) setDropTarget({ kind: 'cut', id: cut.id }); }}
                  onDragLeave={() => setDropTarget((prev) => prev?.kind === 'cut' && prev.id === cut.id ? null : prev)}
                  onDrop={() => handleDrop({ kind: 'cut', id: cut.id })}
                  selected={selected.has(cut.id)}
                  onToggleSelect={() => toggleSelect(cut.id)}
                />
              ))}
            </div>
          );
        }

        const isGroupDropTarget = dropTarget?.kind === 'group' && dropTarget.name === name;
        return (
          <GroupCard
            key={name}
            name={name}
            items={items}
            dim={dim}
            isDropTarget={isGroupDropTarget}
            onDragOver={(e) => { e.preventDefault(); setDropTarget({ kind: 'group', name }); }}
            onDragLeave={() => setDropTarget((prev) => prev?.kind === 'group' && prev.name === name ? null : prev)}
            onDrop={() => handleDrop({ kind: 'group', name })}
            onRename={(newName) => renameGroup(name, newName)}
            onUngroupAll={() => ungroupAll(name)}
            onUpdateCut={updateCut}
            onRemoveCut={(id) => onRemove(id)}
            onRemoveFromGroup={removeFromGroup}
            onDownloadDxf={onDownloadDxf}
            onItemDragStart={(id) => { setDraggingCutId(id); setDropTarget(null); }}
            onItemDragEnd={() => { setDraggingCutId(null); setDropTarget(null); }}
            multiplier={groupMultipliers[name] ?? 1}
            onMultiplierChange={(m) => onMultiplierChange(name, m)}
          />
        );
      })}

      {isDragging && (
        <p className="text-xs text-center text-slate-400 pt-1 select-none pointer-events-none">
          ⠿ Drop onto a part to group · Drop onto a group card to add
        </p>
      )}
    </div>
  );
}

// ── Group card ────────────────────────────────────────────────────────────────

function GroupCard({
  name, items, dim, isDropTarget,
  onDragOver, onDragLeave, onDrop,
  onRename, onUngroupAll,
  onUpdateCut, onRemoveCut, onRemoveFromGroup, onDownloadDxf,
  onItemDragStart, onItemDragEnd,
  multiplier, onMultiplierChange,
}: {
  name: string; items: CutType[]; dim: (v: number) => string; isDropTarget: boolean;
  onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: () => void;
  onRename: (n: string) => void; onUngroupAll: () => void;
  onUpdateCut: (c: CutType) => void; onRemoveCut: (id: number) => void;
  onRemoveFromGroup: (id: number) => void; onDownloadDxf: (c: CutType) => void;
  onItemDragStart: (id: number) => void; onItemDragEnd: () => void;
  multiplier: number; onMultiplierChange: (m: number) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(name);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editingName) nameRef.current?.select(); }, [editingName]);

  const commitName = () => {
    setEditingName(false);
    onRename(nameDraft);
  };

  return (
    <div
      className={`rounded-lg border-2 transition-all ${
        isDropTarget
          ? 'border-indigo-400 bg-indigo-50 shadow-md shadow-indigo-100'
          : 'border-indigo-200 bg-white hover:border-indigo-300'
      }`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={`flex items-center gap-2 px-3 py-2 rounded-t-lg border-b ${
        isDropTarget ? 'bg-indigo-100 border-indigo-300' : 'bg-indigo-50 border-indigo-100'
      }`}>
        <button
          onClick={() => setCollapsed(c => !c)}
          className="shrink-0 text-indigo-400 hover:text-indigo-600 transition-colors"
          title={collapsed ? 'Expand group' : 'Collapse group'}
        >
          <svg className="w-3.5 h-3.5 transition-transform duration-150" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }} fill="currentColor" viewBox="0 0 20 20">
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
        </button>

        {editingName ? (
          <input
            ref={nameRef}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') { setEditingName(false); setNameDraft(name); } }}
            className="flex-1 text-xs font-semibold text-indigo-700 bg-white border border-indigo-300 rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
        ) : (
          <button
            className="flex-1 text-xs font-semibold text-indigo-700 text-left hover:text-indigo-900 flex items-center gap-1 group/hdr"
            onClick={() => { setEditingName(true); setNameDraft(name); }}
            title="Click to rename group"
          >
            {name}
            <svg className="w-3 h-3 text-indigo-300 opacity-0 group-hover/hdr:opacity-100 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 0l.172.172a2 2 0 010 2.828L12 16H9v-3z" />
            </svg>
          </button>
        )}

        <span className="text-xs text-indigo-400 shrink-0">{items.length} part{items.length !== 1 ? 's' : ''}</span>

        {isDropTarget && (
          <span className="text-xs text-indigo-600 font-medium animate-pulse shrink-0">Drop to add →</span>
        )}

        {/* Group quantity multiplier */}
        <div
          className={`flex items-center gap-1 shrink-0 rounded border px-1.5 py-0.5 transition-colors text-xs ${multiplier > 1 ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-indigo-200'}`}
          title="Multiply all quantities in this group when optimizing"
          onClick={(e) => e.stopPropagation()}
        >
          <span className={`font-medium ${multiplier > 1 ? 'text-white' : 'text-indigo-400'}`}>×</span>
          <input
            type="number"
            min={1}
            step={1}
            value={multiplier}
            onChange={(e) => onMultiplierChange(Math.max(1, parseInt(e.target.value) || 1))}
            className={`w-8 text-center outline-none bg-transparent font-semibold ${multiplier > 1 ? 'text-white' : 'text-indigo-400'}`}
          />
        </div>

        <button
          onClick={onUngroupAll}
          title="Remove this group (keeps all parts)"
          className="shrink-0 text-xs text-indigo-400 hover:text-red-500 transition-colors ml-1"
        >
          Ungroup
        </button>
      </div>

      {!collapsed && (
        <div className="p-1.5 space-y-1">
          {items.map((cut) => (
            <div key={cut.id} className="flex items-center gap-1 group/grow">
              <div className="flex-1 min-w-0">
                <CutRow
                  cut={cut}
                  dim={dim}
                  onChange={onUpdateCut}
                  onRemove={() => onRemoveCut(cut.id)}
                  onDownloadDxf={() => onDownloadDxf(cut)}
                  onDragStart={() => onItemDragStart(cut.id)}
                  onDragEnd={onItemDragEnd}
                  isDropTarget={false}
                  onDragOver={(e) => e.preventDefault()}
                  onDragLeave={() => {}}
                  onDrop={() => {}}
                  inGroup
                />
              </div>
              <button
                onClick={() => onRemoveFromGroup(cut.id)}
                title="Remove from group (keep in cut list)"
                className="shrink-0 opacity-0 group-hover/grow:opacity-100 transition-opacity text-slate-300 hover:text-slate-600 px-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exportingBundle, setExportingBundle] = useState(false);
  const [exportingSheetDxfs, setExportingSheetDxfs] = useState(false);
  const [exportingVcarveDxfs, setExportingVcarveDxfs] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [stocks, setStocks] = useState<StockType[]>([]);
  const [cuts, setCuts] = useState<CutType[]>([]);
  const [stepFiles, setStepFiles] = useState<DBStepFile[]>([]);
  const [kerf, setKerf] = useState(0.125);
  const [padding, setPadding] = useState(0.5);
  const [groupMultipliers, setGroupMultipliers] = useState<Record<string, number>>({});
  const [units, setUnits] = useState<UnitSystem>('in');
  const [showAdv, setShowAdv] = useState(false);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [hoveredPart, setHoveredPart] = useState<{ sheetIndex: number; cutIndex: number } | null>(null);
  const [gridSize] = useState(0.125); // 1/8" default snap
  const [excludedKeys, setExcludedKeys] = useState<Set<PartInstanceKey>>(new Set());
  const [initialLayoutOverrides, setInitialLayoutOverrides] = useState<ManualOverrides | undefined>(undefined);
  const [shouldRestoreLayout, setShouldRestoreLayout] = useState(false);

  const AUTO_OPTIMIZE_STORAGE_KEY = `project-auto-optimize-${id}`;
  const stats = useMemo(() => result ? calculateStats(result) : null, [result]);

  // Layout editor state (overrides, selection, undo/redo)
  const {
    hydrated: layoutEditorHydrated,
    overrides,
    selectedKeys,
    canUndo,
    canRedo,
    dispatch: layoutDispatch,
    rotateSelected,
    pinSelected,
    unpinSelected,
  } = useLayoutEditor(id, result, initialLayoutOverrides);

  const layoutStateHydrated = !loading && layoutEditorHydrated;

  // Build a stable reference to result.sheets for keyboard callbacks
  const resultRef = useRef(result);
  useEffect(() => { resultRef.current = result; }, [result]);
  const stepFilenameMap = useMemo(() => buildStepFilenameMap(stepFiles), [stepFiles]);
  const stepSessionMap = useMemo(() => buildStepSessionMap(stepFiles), [stepFiles]);

  const expandedEffectiveCuts = useMemo(() => {
    const effectiveCuts = cuts.map(c => {
      const mult = c.group ? (groupMultipliers[c.group] ?? 1) : 1;
      return mult > 1 ? { ...c, qty: c.qty * mult } : c;
    });
    return expandCutsWithKeys(effectiveCuts);
  }, [cuts, groupMultipliers]);

  const excludedCuts = useMemo(
    () => expandedEffectiveCuts.filter(c => excludedKeys.has(c.instanceKey)),
    [expandedEffectiveCuts, excludedKeys]
  );

  useEffect(() => {
    if (!project) return;
    const validKeys = new Set<PartInstanceKey>(expandedEffectiveCuts.map(c => c.instanceKey));
    setExcludedKeys(prev => {
      let changed = false;
      const next = new Set<PartInstanceKey>();
      prev.forEach((key) => {
        if (validKeys.has(key)) next.add(key);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [project, expandedEffectiveCuts]);

  const runOptimization = useCallback((keepPins: boolean, nextExcludedKeys: Set<PartInstanceKey> = excludedKeys) => {
    const optimizableCuts = expandedEffectiveCuts.filter(c => !nextExcludedKeys.has(c.instanceKey));
    const pinned = keepPins && result
      ? buildPinnedPlacements(result, overrides).filter(p => !nextExcludedKeys.has(p.key))
      : [];
    const assigned = keepPins && result
      ? buildSheetAssignments(result, overrides).filter(a => !nextExcludedKeys.has(a.key))
      : [];
    setResult(optimizeCutsBest(stocks, optimizableCuts, kerf, padding, pinned, assigned));
  }, [excludedKeys, expandedEffectiveCuts, kerf, overrides, padding, result, stocks]);

  const handleOptimize = useCallback((keepPins: boolean) => {
    runOptimization(keepPins);
  }, [runOptimization]);

  const excludeKeysFromOptimization = useCallback((keys: PartInstanceKey[]) => {
    if (keys.length === 0) return;
    const next = new Set(excludedKeys);
    let changed = false;
    for (const key of keys) {
      if (!next.has(key)) {
        next.add(key);
        changed = true;
      }
    }
    if (!changed) return;
    setExcludedKeys(next);
    layoutDispatch({ type: 'DESELECT_ALL' });
    runOptimization(true, next);
  }, [excludedKeys, layoutDispatch, runOptimization]);

  const restoreExcludedKeys = useCallback((keys: PartInstanceKey[]) => {
    if (keys.length === 0) return;
    const next = new Set(excludedKeys);
    let changed = false;
    for (const key of keys) {
      if (next.delete(key)) changed = true;
    }
    if (!changed) return;
    setExcludedKeys(next);
    runOptimization(true, next);
  }, [excludedKeys, runOptimization]);

  const restoreAllExcluded = useCallback(() => {
    if (excludedKeys.size === 0) return;
    const next = new Set<PartInstanceKey>();
    setExcludedKeys(next);
    runOptimization(true, next);
  }, [excludedKeys, runOptimization]);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onRotate: () => { if (resultRef.current) rotateSelected(resultRef.current.sheets); },
    onDelete: () => excludeKeysFromOptimization([...selectedKeys]),
    onEscape: () => layoutDispatch({ type: 'DESELECT_ALL' }),
    onSelectAll: () => {
      if (!resultRef.current) return;
      const allKeys = resultRef.current.sheets.flatMap(s => s.cuts.map(c => c.instanceKey));
      layoutDispatch({ type: 'SELECT', keys: allKeys, additive: false });
    },
    onUndo: () => layoutDispatch({ type: 'UNDO' }),
    onRedo: () => layoutDispatch({ type: 'REDO' }),
    onPin: () => { if (resultRef.current) pinSelected(resultRef.current.sheets); },
    onUnpin: () => unpinSelected(),
  });

  useEffect(() => {
    fetchProject();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (loading || result || stocks.length === 0 || cuts.length === 0 || !layoutStateHydrated) return;

    let shouldAutoOptimize = shouldRestoreLayout;
    try {
      shouldAutoOptimize = shouldAutoOptimize || sessionStorage.getItem(AUTO_OPTIMIZE_STORAGE_KEY) === '1';
      sessionStorage.removeItem(AUTO_OPTIMIZE_STORAGE_KEY);
    } catch {
      // Ignore browser storage failures.
    }

    if (!shouldAutoOptimize) return;
    runOptimization(false);
  }, [
    AUTO_OPTIMIZE_STORAGE_KEY,
    cuts.length,
    layoutStateHydrated,
    loading,
    result,
    runOptimization,
    shouldRestoreLayout,
    stocks.length,
  ]);

  useEffect(() => {
    if (!result) return;
    setShouldRestoreLayout(true);
  }, [result]);

  // Auto-save 1.5 s after any change to the editable project data.
  // A ref guards against firing on the initial data load.
  const isLoaded = useRef(false);
  useEffect(() => {
    if (!isLoaded.current) return;
    setIsDirty(true);
    const t = setTimeout(() => saveProject(), 1500);
    return () => clearTimeout(t);
  }, [cuts, excludedKeys, groupMultipliers, kerf, overrides, padding, result, stocks, units]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchProject() {
    try {
      const res = await fetch(`/api/v1/projects/${id}`);
      if (res.ok) {
        const data = await res.json() as Project;
        setProject(data);
        setStocks(data.stocks.map(toAppStock));
        setCuts(data.cuts.map(toAppCut));
        setStepFiles(data.stepFiles ?? []);
        setKerf(data.kerf);
        setUnits((data.units as UnitSystem) ?? 'in');
        setPadding(
          typeof data.layoutPadding === 'number' && Number.isFinite(data.layoutPadding)
            ? data.layoutPadding
            : 0.5
        );
        setExcludedKeys(new Set((data.layoutExcludedKeys ?? []) as PartInstanceKey[]));
        setInitialLayoutOverrides((data.layoutOverrides ?? {}) as ManualOverrides);
        setShouldRestoreLayout(Boolean(data.layoutHasActive));
        try {
          const parsed = JSON.parse(data.groupMultipliers ?? '{}');
          if (parsed && typeof parsed === 'object') setGroupMultipliers(parsed);
        } catch { /* ignore malformed JSON */ }
      } else if (res.status === 404) {
        router.push('/dashboard');
      }
    } catch (error) {
      console.error('Failed to fetch project:', error);
    } finally {
      setLoading(false);
      isLoaded.current = true;
    }
  }

  const saveProject = async () => {
    if (!project) return;
    setSaving(true);
    try {
      await fetch(`/api/v1/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kerf,
          units,
          groupMultipliers,
          layoutOverrides: overrides,
          layoutExcludedKeys: [...excludedKeys],
          layoutPadding: padding,
          layoutHasActive: Boolean(result),
          stepActiveFileId: project.stepActiveFileId ?? null,
          stocks: stocks.map((s) => ({
            id: s.dbId,
            name: s.name,
            l: s.l,
            w: s.w,
            t: s.t,
            qty: s.qty,
            mat: s.mat,
          })),
          cuts: cuts.map((c) => ({
            id: c.dbId,
            label: c.label, l: c.l, w: c.w, t: c.t, qty: c.qty, mat: c.mat,
            group: c.group,
            stepFileId: c.stepFileId,
            stepSessionId: c.stepSessionId,
            stepBodyIndex: c.stepBodyIndex,
            stepFaceIndex: c.stepFaceIndex,
          })),
        }),
      });
      setIsDirty(false);
    } catch (error) {
      console.error('Failed to save project:', error);
    } finally {
      setSaving(false);
    }
  };

  const addStock = (preset?: typeof STOCK_PRESETS[0]) => {
    const s = preset || { name: 'Custom', length: 96, width: 48 };
    setStocks([...stocks, {
      id: Date.now(),
      dbId: crypto.randomUUID(),
      name: s.name, l: s.length, w: s.width,
      t: (s as typeof STOCK_PRESETS[0]).thickness ?? 0, qty: 1, mat: 'Plywood',
    }]);
  };

  const removeStock = (stockId: number) => setStocks(stocks.filter((s) => s.id !== stockId));
  const removeCut = (cutId: number) => setCuts(cuts.filter((c) => c.id !== cutId));

  const dim = useCallback((val: number) => {
    if (units === 'mm') return inToMM(val).toFixed(1);
    return toFraction(val);
  }, [units]);

  const unitLabel = units === 'mm' ? 'mm' : 'in';
  const toProjectMm = useCallback((val: number) => units === 'mm' ? val : inToMM(val), [units]);

  const csvCell = useCallback((value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }, []);

  const buildSheetContext = useCallback((sheetIdx: number) => {
    if (!result) return null;
    const sheet = result.sheets[sheetIdx];
    if (!sheet) return null;

    const mergedCuts = buildMergedSheet(sheet, sheetIdx, overrides, result.sheets);
    const numberedCuts: NumberedPlacedCut[] = [...mergedCuts]
      .sort((a, b) => {
        const areaDiff = (b.pw * b.ph) - (a.pw * a.ph);
        return areaDiff !== 0 ? areaDiff : a.label.localeCompare(b.label);
      })
      .map((cut, index) => ({ ...cut, partNumber: index + 1 }));

    const stepCuts = mergedCuts.flatMap((cut) => {
      if (cut.stepBodyIndex === undefined || cut.stepFaceIndex === undefined) return [];
      const sessionId = cut.stepFileId
        ? stepSessionMap.get(cut.stepFileId) ?? null
        : cut.stepSessionId ?? null;
      if (!sessionId) return [];
      return [{ cut, sessionId }] as const;
    });
    const dimCuts = mergedCuts.filter((c) => !c.stepFileId && !c.stepSessionId);

    const payload: SheetExportPayload | null =
      stepCuts.length === 0 && dimCuts.length === 0
        ? null
        : {
          session_id: stepCuts[0]?.sessionId ?? '',
          sheet_width_mm: toProjectMm(sheet.w),
          sheet_length_mm: toProjectMm(sheet.l),
          sheet_name: sheet.name,
          placements: stepCuts.map(({ cut, sessionId }) => ({
            body_index: cut.stepBodyIndex!,
            face_index: cut.stepFaceIndex!,
            body_name: cut.label,
            x_mm: toProjectMm(cut.x),
            y_mm: toProjectMm(cut.y),
            rot: cut.rot,
            session_id: sessionId,
          })),
          rect_placements: dimCuts.map((c) => ({
            body_name: c.label,
            x_mm: toProjectMm(c.x),
            y_mm: toProjectMm(c.y),
            w_mm: toProjectMm(c.pw),
            h_mm: toProjectMm(c.ph),
          })),
        };

    return { sheet, mergedCuts, numberedCuts, payload };
  }, [overrides, result, stepSessionMap, toProjectMm]);

  const fetchSheetPreviewData = useCallback(async (sheetIdx: number): Promise<SheetPreviewData | null> => {
    const context = buildSheetContext(sheetIdx);
    if (!context?.payload) return null;

    const res = await fetch('/api/v1/step/export/sheet/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context.payload),
    });

    if (!res.ok) return null;
    return res.json();
  }, [buildSheetContext]);

  const exportableSheetIndices = useMemo(() => {
    if (!result) return [];
    return result.sheets.flatMap((_, index) => (buildSheetContext(index)?.payload ? [index] : []));
  }, [buildSheetContext, result]);

  const fetchSheetDxfExport = useCallback(async (
    sheetIdx: number,
    layerStyle: SheetLayerStyle = 'default'
  ) => {
    const context = buildSheetContext(sheetIdx);
    if (!context?.payload) return null;
    const { sheet, payload } = context;

    const res = await fetch('/api/v1/step/export/sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, layer_style: layerStyle }),
    });
    if (!res.ok) {
      const errorPayload = await res.json().catch(() => null) as { detail?: string } | null;
      throw new Error(errorPayload?.detail ?? 'Sheet DXF export failed');
    }

    return {
      blob: await res.blob(),
      filename: buildSheetDxfFilename(sheetIdx, sheet.name, layerStyle),
    };
  }, [buildSheetContext]);

  const downloadSheetDxf = async (sheetIdx: number, layerStyle: SheetLayerStyle = 'default') => {
    try {
      const exported = await fetchSheetDxfExport(sheetIdx, layerStyle);
      if (!exported) return;
      const url = URL.createObjectURL(exported.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exported.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Sheet DXF download failed:', e);
    }
  };

  const downloadAllSheetDxfs = async (layerStyle: SheetLayerStyle = 'default') => {
    if (!project || exportableSheetIndices.length === 0) return;

    const setExporting = layerStyle === 'vcarve' ? setExportingVcarveDxfs : setExportingSheetDxfs;
    setExporting(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const exportErrors: string[] = [];
      let exportedCount = 0;

      if (layerStyle === 'vcarve') {
        zip.file('README-vcarve.txt', buildVcarveReadme(project.name));
      }

      for (const sheetIdx of exportableSheetIndices) {
        try {
          const exported = await fetchSheetDxfExport(sheetIdx, layerStyle);
          if (!exported) continue;
          zip.file(exported.filename, exported.blob);
          exportedCount += 1;
        } catch (error) {
          const fallbackSheetName = result?.sheets[sheetIdx]?.name ?? `Sheet ${sheetIdx + 1}`;
          exportErrors.push(
            `Sheet ${sheetIdx + 1} (${fallbackSheetName}): ${error instanceof Error ? error.message : 'Export failed'}`
          );
        }
      }

      if (exportErrors.length > 0) {
        zip.file('export-errors.txt', exportErrors.join('\n'));
      }
      if (exportedCount === 0) {
        throw new Error(exportErrors[0] ?? 'No sheet DXFs were available to export');
      }

      const bundleBlob = await zip.generateAsync({ type: 'blob' });
      const bundleUrl = URL.createObjectURL(bundleBlob);
      const a = document.createElement('a');
      a.href = bundleUrl;
      a.download = `${sanitizeFilenameSegment(project.name, 'project')}-${layerStyle === 'vcarve' ? 'vcarve-dxfs' : 'sheet-dxfs'}.zip`;
      a.click();
      URL.revokeObjectURL(bundleUrl);
    } catch (error) {
      console.error('All sheet DXF download failed:', error);
    } finally {
      setExporting(false);
    }
  };

  const [sheetPreview, setSheetPreview] = useState<SheetPreviewData | null>(null);
  const [sheetPreviewLoading, setSheetPreviewLoading] = useState(false);

  const previewSheetDxf = async (sheetIdx: number) => {
    const context = buildSheetContext(sheetIdx);
    if (!context?.payload) return;
    setSheetPreviewLoading(true);
    try {
      setSheetPreview(await fetchSheetPreviewData(sheetIdx));
    } catch (e) {
      console.error('Sheet DXF preview failed:', e);
    } finally {
      setSheetPreviewLoading(false);
    }
  };

  const downloadPartDxf = async (cut: CutType) => {
    const sessionId = cut.stepFileId
      ? stepSessionMap.get(cut.stepFileId) ?? null
      : cut.stepSessionId ?? null;
    if (!sessionId || cut.stepBodyIndex === undefined || cut.stepFaceIndex === undefined) return;
    try {
      const res = await fetch('/api/v1/step/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          body_index: cut.stepBodyIndex,
          body_name: cut.label,
          face_index: cut.stepFaceIndex,
        }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cut.label}.dxf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Part DXF download failed:', e);
    }
  };

  const buildCutListCsvContent = useCallback(() => {
    if (!result) return null;

    const rows = [[
      'Sheet',
      'Part #',
      'Part',
      `Length (${unitLabel})`,
      `Width (${unitLabel})`,
      `X (${unitLabel})`,
      `Y (${unitLabel})`,
      'Rotated',
    ].map(csvCell).join(',')];

    result.sheets.forEach((_sheet, i) => {
      const context = buildSheetContext(i);
      if (!context) return;
      context.numberedCuts.forEach((c) => {
        rows.push([
          `Sheet ${i + 1} (${context.sheet.name})`,
          c.partNumber,
          c.label,
          dim(Math.max(c.pw, c.ph)),
          dim(Math.min(c.pw, c.ph)),
          dim(c.x),
          dim(c.y),
          c.rot ? 'Yes' : 'No',
        ].map(csvCell).join(','));
      });
    });

    if (result.unplaced.length > 0) {
      rows.push('');
      rows.push('UNPLACED PARTS');
      result.unplaced.forEach((c) => {
        rows.push([
          'N/A',
          '',
          c.label,
          dim(Math.max(c.l, c.w)),
          dim(Math.min(c.l, c.w)),
          '',
          '',
          '',
        ].map(csvCell).join(','));
      });
    }

    return rows.join('\n');
  }, [buildSheetContext, csvCell, dim, result, unitLabel]);

  const downloadCutListCSV = () => {
    const csvContent = buildCutListCsvContent();
    if (!csvContent) return;
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.name ?? 'cut-list'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildLayoutSvgContent = useCallback(() => {
    if (!result) return null;
    const padding = 50;
    const sheetGap = 40;
    const scale = 4;
    const tickInterval = 12;

    let totalHeight = padding;
    result.sheets.forEach((s) => { totalHeight += s.l * scale + sheetGap + 30; });
    const maxWidth = Math.max(...result.sheets.map((s) => s.w * scale)) + padding * 2;

    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${maxWidth}" height="${totalHeight}" style="background: #f8fafc; font-family: system-ui, sans-serif;">`;

    let yOffset = padding;
    result.sheets.forEach((sheet, i) => {
      const context = buildSheetContext(i);
      if (!context) return;
      svgContent += `<text x="${padding}" y="${yOffset + 16}" fill="#334155" font-size="14" font-weight="500">Sheet ${i + 1}: ${sheet.name} (${sheet.w}" × ${sheet.l}")</text>`;
      yOffset += 24;

      for (let tick = 0; tick <= sheet.w; tick += tickInterval) {
        const x = padding + tick * scale;
        svgContent += `<line x1="${x}" y1="${yOffset - 15}" x2="${x}" y2="${yOffset - 5}" stroke="#94a3b8" stroke-width="1"/>`;
        svgContent += `<text x="${x}" y="${yOffset - 18}" text-anchor="middle" fill="#94a3b8" font-size="9">${tick}"</text>`;
      }
      for (let tick = 0; tick <= sheet.l; tick += tickInterval) {
        const y = yOffset + tick * scale;
        svgContent += `<line x1="${padding - 15}" y1="${y}" x2="${padding - 5}" y2="${y}" stroke="#94a3b8" stroke-width="1"/>`;
        svgContent += `<text x="${padding - 18}" y="${y + 3}" text-anchor="end" fill="#94a3b8" font-size="9">${tick}"</text>`;
      }

      svgContent += `<rect x="${padding}" y="${yOffset}" width="${sheet.w * scale}" height="${sheet.l * scale}" fill="#e2e8f0" stroke="#94a3b8" stroke-width="2"/>`;

      context.numberedCuts.forEach((c, j) => {
        const col = CUT_COLORS[j % CUT_COLORS.length];
        const x = padding + c.x * scale;
        const y = yOffset + c.y * scale;
        const w = c.pw * scale;
        const h = c.ph * scale;
        svgContent += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${col}" fill-opacity="0.5" stroke="${col}" stroke-width="1.5"/>`;
        svgContent += `<text x="${x + w / 2}" y="${y + h / 2 - 6}" text-anchor="middle" fill="white" font-size="${Math.min(w, h) / 6}">${c.label}</text>`;
        svgContent += `<text x="${x + w / 2}" y="${y + h / 2 + 10}" text-anchor="middle" fill="#64748b" font-size="${Math.min(w, h) / 8}">${c.pw}" × ${c.ph}"${c.rot ? ' (R)' : ''}</text>`;
      });

      yOffset += sheet.l * scale + sheetGap;
    });

    svgContent += '</svg>';
    return svgContent;
  }, [buildSheetContext, result]);

  const downloadLayoutSVG = () => {
    const svgContent = buildLayoutSvgContent();
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.name ?? 'cut-layout'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildCutListPdf = useCallback(async () => {
    if (!result) return null;

    const partOperationCache = new Map<string, Promise<PartOperationSummary | null>>();
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 36;
    const previewBoxWidth = Math.min(380, pageWidth * 0.54);
    const previewGap = 18;
    const tableRightWidth = pageWidth - margin * 2 - previewBoxWidth - previewGap;

    const previewEdgePoints = (edge: SheetPreviewData['edges'][number], sheetLengthMm: number) => {
      if (edge.type === 'line') {
        return [
          { x: edge.start[0], y: sheetLengthMm - edge.start[1] },
          { x: edge.end[0], y: sheetLengthMm - edge.end[1] },
        ];
      }

      if (edge.type === 'polyline') {
        return edge.points.map(([x, y]) => ({ x, y: sheetLengthMm - y }));
      }

      const sweep = edge.is_full_circle
        ? 360
        : (() => {
          let delta = edge.end_angle - edge.start_angle;
          if (delta <= 0) delta += 360;
          return delta;
        })();

      const segments = edge.is_full_circle ? 40 : Math.max(12, Math.ceil(sweep / 15));
      return Array.from({ length: segments + 1 }, (_, index) => {
        const angle = edge.is_full_circle
          ? (Math.PI * 2 * index) / segments
          : ((edge.start_angle + (sweep * index) / segments) * Math.PI) / 180;
        return {
          x: edge.center[0] + edge.radius * Math.cos(angle),
          y: sheetLengthMm - (edge.center[1] + edge.radius * Math.sin(angle)),
        };
      });
    };

    const drawPolyline = (
      points: Array<{ x: number; y: number }>,
      originX: number,
      originY: number,
      scale: number,
      strokeColor: [number, number, number]
    ) => {
      if (points.length < 2) return;
      pdf.setDrawColor(...strokeColor);
      for (let index = 1; index < points.length; index++) {
        const from = points[index - 1];
        const to = points[index];
        pdf.line(
          originX + from.x * scale,
          originY + from.y * scale,
          originX + to.x * scale,
          originY + to.y * scale
        );
      }
    };

    const getPartOperationSummary = (cut: NumberedPlacedCut): Promise<PartOperationSummary | null> => {
      const sessionId = cut.stepFileId
        ? stepSessionMap.get(cut.stepFileId) ?? null
        : cut.stepSessionId ?? null;
      if (!sessionId || cut.stepBodyIndex === undefined || cut.stepFaceIndex === undefined) {
        return Promise.resolve(null);
      }

      const cacheKey = `${sessionId}:${cut.stepBodyIndex}:${cut.stepFaceIndex}`;
      const cached = partOperationCache.get(cacheKey);
      if (cached) return cached;

      const request = fetch(`/api/v1/step/${sessionId}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body_index: cut.stepBodyIndex,
          face_index: cut.stepFaceIndex,
        }),
      })
        .then(async (res) => {
          if (!res.ok) return null;
          const data = await res.json() as PartPreviewData;
          return summarizeOperationLayers(data.edges ?? [], data.face_dims_mm?.[2] ?? null);
        })
        .catch(() => null);

      partOperationCache.set(cacheKey, request);
      return request;
    };

    const renderSheetTable = (
      cuts: NumberedPlacedCut[],
      startIndex: number,
      x: number,
      y: number,
      width: number,
      bottom: number,
      operationSummaries: Map<string, PartOperationSummary | null> = new Map()
    ) => {
      const colNumber = 28;
      const colSize = 74;
      const colThickness = 40;
      const partColWidth = Math.max(96, width - colNumber - colSize - colThickness - 16);
      let cursorY = y;
      let index = startIndex;

      pdf.setFillColor(248, 250, 252);
      pdf.setDrawColor(226, 232, 240);
      pdf.roundedRect(x, cursorY, width, 18, 4, 4, 'FD');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(100);
      pdf.text('#', x + 6, cursorY + 12);
      pdf.text('Part', x + colNumber + 6, cursorY + 12);
      pdf.text(`L × W (${unitLabel})`, x + colNumber + partColWidth + 6, cursorY + 12);
      pdf.text(`T (${unitLabel})`, x + colNumber + partColWidth + colSize + 6, cursorY + 12);
      cursorY += 18;

      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(55, 65, 81);

      while (index < cuts.length) {
        const cut = cuts[index];
        const sizeText = `${dim(Math.max(cut.pw, cut.ph))} × ${dim(Math.min(cut.pw, cut.ph))}`;
        const operationSummary = operationSummaries.get(cut.instanceKey) ?? null;
        const thicknessText = getPartThicknessDisplay(cut, operationSummary, units);
        const exportLabel = buildExportPartLabel(cut, stepFilenameMap);
        const labelLines = pdf.splitTextToSize(exportLabel, partColWidth - 8) as string[];
        const operationLines = buildOperationLines(
          cut,
          operationSummary,
          units
        ).flatMap((line) => pdf.splitTextToSize(line, partColWidth - 8) as string[]);
        const rowHeight = Math.max(
          18,
          labelLines.length * 8 + (operationLines.length > 0 ? operationLines.length * 7 + 8 : 6)
        );

        if (cursorY + rowHeight > bottom) break;

        pdf.setDrawColor(241, 245, 249);
        pdf.line(x, cursorY, x + width, cursorY);
        pdf.text(String(cut.partNumber), x + 6, cursorY + 11);
        pdf.text(labelLines, x + colNumber + 6, cursorY + 11);
        if (operationLines.length > 0) {
          pdf.setFontSize(6.5);
          pdf.setTextColor(100);
          pdf.text(operationLines, x + colNumber + 6, cursorY + 11 + labelLines.length * 8);
          pdf.setFontSize(8);
          pdf.setTextColor(55, 65, 81);
        }
        pdf.text(sizeText, x + colNumber + partColWidth + 6, cursorY + 11);
        pdf.text(thicknessText, x + colNumber + partColWidth + colSize + 6, cursorY + 11);
        cursorY += rowHeight;
        index++;
      }

      return index;
    };

    for (let sheetIdx = 0; sheetIdx < result.sheets.length; sheetIdx++) {
      if (sheetIdx > 0) {
        pdf.addPage('letter', 'landscape');
      }

      const context = buildSheetContext(sheetIdx);
      if (!context) continue;

      const { sheet, numberedCuts } = context;
      let previewData: SheetPreviewData | null = null;
      try {
        previewData = await fetchSheetPreviewData(sheetIdx);
      } catch {
        previewData = null;
      }
      const operationSummaries = new Map(
        await Promise.all(
          numberedCuts.map(async (cut) => [cut.instanceKey, await getPartOperationSummary(cut)] as const)
        )
      );
      const sheetOperationSummary = mergeOperationSummaries([...operationSummaries.values()]);

      const headerY = margin;
      const headerRightX = pageWidth - margin;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(17);
      pdf.setTextColor(15, 23, 42);
      pdf.text(project?.name ?? 'Cut List', margin, headerY);

      pdf.setFontSize(11);
      pdf.text(`Sheet ${sheetIdx + 1}: ${sheet.name}`, margin, headerY + 18);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(100);
      pdf.text(`${dim(sheet.w)} × ${dim(sheet.l)} ${unitLabel}`, margin, headerY + 32);
      pdf.text(`Numbers match table · black profile · red holes · blue pockets`, margin, headerY + 44);

      if (stats) {
        pdf.text(
          `${stats.sheets} sheet${stats.sheets !== 1 ? 's' : ''} · ${stats.waste}% waste${stats.unplaced > 0 ? ` · ${stats.unplaced} unplaced` : ''}`,
          headerRightX,
          headerY + 18,
          { align: 'right' }
        );
      }
      pdf.text(buildSheetOperationText(sheetOperationSummary, units), headerRightX, headerY + 32, { align: 'right' });

      const previewBoxY = headerY + 56;
      const previewBoxHeight = pageHeight - previewBoxY - margin;
      const tableX = margin + previewBoxWidth + previewGap;
      const tableTop = previewBoxY;
      const tableBottom = pageHeight - margin;

      pdf.setDrawColor(226, 232, 240);
      pdf.roundedRect(margin, previewBoxY, previewBoxWidth, previewBoxHeight, 6, 6, 'S');

      const sheetWidthMm = previewData?.sheet_width_mm ?? toProjectMm(sheet.w);
      const sheetLengthMm = previewData?.sheet_length_mm ?? toProjectMm(sheet.l);
      const innerPadding = 14;
      const previewScale = Math.min(
        (previewBoxWidth - innerPadding * 2) / sheetWidthMm,
        (previewBoxHeight - innerPadding * 2) / sheetLengthMm
      );
      const drawingWidth = sheetWidthMm * previewScale;
      const drawingHeight = sheetLengthMm * previewScale;
      const drawingX = margin + (previewBoxWidth - drawingWidth) / 2;
      const drawingY = previewBoxY + (previewBoxHeight - drawingHeight) / 2;

      pdf.setDrawColor(148, 163, 184);
      pdf.setLineWidth(1);
      pdf.rect(drawingX, drawingY, drawingWidth, drawingHeight, 'S');

      if (previewData?.edges?.length) {
        [...previewData.edges]
          .sort((a, b) => getPdfLayerDrawPriority(a.layer) - getPdfLayerDrawPriority(b.layer))
          .forEach((edge) => {
          pdf.setLineWidth(getPdfLayerLineWidth(edge.layer));
          drawPolyline(
            previewEdgePoints(edge, sheetLengthMm),
            drawingX,
            drawingY,
            previewScale,
            getPdfLayerColor(edge.layer)
          );
          });
      } else {
        pdf.setDrawColor(15, 23, 42);
        pdf.setLineWidth(0.7);
        numberedCuts.forEach((cut) => {
          pdf.rect(
            drawingX + toProjectMm(cut.x) * previewScale,
            drawingY + toProjectMm(cut.y) * previewScale,
            toProjectMm(cut.pw) * previewScale,
            toProjectMm(cut.ph) * previewScale,
            'S'
          );
        });
      }

      numberedCuts.forEach((cut) => {
        const centerX = drawingX + toProjectMm(cut.x + cut.pw / 2) * previewScale;
        const centerY = drawingY + (sheetLengthMm - toProjectMm(cut.y + cut.ph / 2)) * previewScale;
        const badgeRadius = Math.max(
          7,
          Math.min(12, Math.min(toProjectMm(cut.pw) * previewScale, toProjectMm(cut.ph) * previewScale) * 0.28)
        );
        pdf.setFillColor(255, 255, 255);
        pdf.setDrawColor(15, 23, 42);
        pdf.circle(centerX, centerY, badgeRadius, 'FD');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(Math.max(7, badgeRadius));
        pdf.setTextColor(15, 23, 42);
        pdf.text(String(cut.partNumber), centerX, centerY + badgeRadius * 0.35, { align: 'center' });
      });

      let nextRow = renderSheetTable(numberedCuts, 0, tableX, tableTop, tableRightWidth, tableBottom, operationSummaries);
      while (nextRow < numberedCuts.length) {
        pdf.addPage('letter', 'landscape');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(12);
        pdf.setTextColor(15, 23, 42);
        pdf.text(`Sheet ${sheetIdx + 1}: ${sheet.name} (continued)`, margin, margin);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(9);
        pdf.setTextColor(100);
        pdf.text(`Units: ${unitLabel}`, pageWidth - margin, margin, { align: 'right' });
        nextRow = renderSheetTable(
          numberedCuts,
          nextRow,
          margin,
          margin + 16,
          pageWidth - margin * 2,
          pageHeight - margin,
          operationSummaries
        );
      }
    }

    if (result.unplaced.length > 0) {
      pdf.addPage('letter', 'landscape');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      pdf.setTextColor(180, 0, 0);
      pdf.text(`Unplaced Parts (${result.unplaced.length})`, margin, margin);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(100);
      pdf.text(`Units: ${unitLabel}`, pageWidth - margin, margin, { align: 'right' });

      const tableCuts = result.unplaced
        .slice()
        .sort((a, b) => (b.l * b.w) - (a.l * a.w))
        .map((cut, index) => ({
          ...cut,
          x: 0,
          y: 0,
          pw: cut.w,
          ph: cut.l,
          rot: false,
          instanceKey: `${cut.id}-${index}`,
          partNumber: index + 1,
        })) as NumberedPlacedCut[];

      renderSheetTable(tableCuts, 0, margin, margin + 20, pageWidth - margin * 2, pageHeight - margin);
    }

    return pdf;
  }, [buildSheetContext, dim, fetchSheetPreviewData, project?.name, result, stats, stepFilenameMap, stepSessionMap, toProjectMm, unitLabel, units]);

  const downloadPDF = async () => {
    const pdf = await buildCutListPdf();
    if (!pdf) return;
    pdf.save(`${project?.name ?? 'cut-list'}.pdf`);
  };

  const downloadProjectBundle = async () => {
    if (!project) return;

    setExportingBundle(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const safeProjectName = sanitizeFilenameSegment(project.name, 'project');
      const exportedStepFiles = [];

      for (const [index, stepFile] of stepFiles.entries()) {
        const safeStem = sanitizeFilenameSegment(
          stepFile.filename.replace(/\.(step|stp)$/i, ''),
          `step-file-${index + 1}`
        );
        const extension = stepFile.filename.match(/\.stp$/i) ? '.stp' : '.step';
        const fileName = `${safeStem}${extension}`;

        try {
          const res = await fetch(`/api/v1/projects/${id}/step-files/${stepFile.id}/file`);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          zip.file(`step-files/${fileName}`, await res.blob());
          exportedStepFiles.push({
            id: stepFile.id,
            fileName,
            filename: stepFile.filename,
            sortOrder: stepFile.sortOrder,
            selectedBodyIndex: stepFile.selectedBodyIndex,
            bodyState: stepFile.bodyState,
            exported: true,
          });
        } catch (error) {
          exportedStepFiles.push({
            id: stepFile.id,
            fileName,
            filename: stepFile.filename,
            sortOrder: stepFile.sortOrder,
            selectedBodyIndex: stepFile.selectedBodyIndex,
            bodyState: stepFile.bodyState,
            exported: false,
            error: error instanceof Error ? error.message : 'Failed to export STEP file',
          });
        }
      }

      const csvContent = buildCutListCsvContent();
      if (csvContent) {
        zip.file('exports/cut-list.csv', csvContent);
      }

      const svgContent = buildLayoutSvgContent();
      if (svgContent) {
        zip.file('exports/cut-layout.svg', svgContent);
      }

      const pdf = await buildCutListPdf();
      if (pdf) {
        zip.file('exports/cut-list.pdf', pdf.output('blob'));
      }

      const missingStepFiles = exportedStepFiles.filter((stepFile) => !stepFile.exported);
      if (missingStepFiles.length > 0) {
        zip.file(
          'exports/missing-step-files.txt',
          missingStepFiles
            .map((stepFile) => `${stepFile.id}: ${stepFile.fileName} — ${stepFile.error ?? 'Missing'}`)
            .join('\n')
        );
      }

      zip.file('project.json', JSON.stringify({
        format: 'kerfuffle-project-bundle',
        version: 2,
        exportedAt: new Date().toISOString(),
        sourceProjectId: project.id,
        project: {
          name: project.name,
          description: project.description,
          settings: {
            kerf,
            padding,
            units,
            groupMultipliers,
          },
          layout: {
            overrides,
            excludedKeys: [...excludedKeys],
          },
          stepActiveFileId: project.stepActiveFileId ?? null,
          stepFiles: exportedStepFiles.map((stepFile) => ({
            id: stepFile.id,
            fileName: stepFile.fileName,
            filename: stepFile.filename,
            sortOrder: stepFile.sortOrder,
            selectedBodyIndex: stepFile.selectedBodyIndex,
            bodyState: stepFile.bodyState,
            exported: stepFile.exported,
            error: stepFile.exported ? undefined : stepFile.error,
          })),
          stocks,
          cuts,
          optimization: result
            ? {
              stats,
              sheets: result.sheets.map((_sheet, index) => {
                const context = buildSheetContext(index);
                return context ? {
                  sheetIndex: index,
                  name: context.sheet.name,
                  width: context.sheet.w,
                  length: context.sheet.l,
                  cuts: context.numberedCuts.map((cut) => ({
                    partNumber: cut.partNumber,
                    label: cut.label,
                    x: cut.x,
                    y: cut.y,
                    width: cut.pw,
                    height: cut.ph,
                    rotated: cut.rot,
                    stepFileId: cut.stepFileId ?? null,
                    stepSessionId: cut.stepSessionId ?? null,
                    stepBodyIndex: cut.stepBodyIndex ?? null,
                    stepFaceIndex: cut.stepFaceIndex ?? null,
                  })),
                } : null;
              }).filter(Boolean),
              unplaced: result.unplaced,
            }
            : null,
        },
      }, null, 2));

      const bundleBlob = await zip.generateAsync({ type: 'blob' });
      const bundleUrl = URL.createObjectURL(bundleBlob);
      const a = document.createElement('a');
      a.href = bundleUrl;
      a.download = `${safeProjectName}-bundle.zip`;
      a.click();
      URL.revokeObjectURL(bundleUrl);
    } catch (error) {
      console.error('Project bundle export failed:', error);
    } finally {
      setExportingBundle(false);
    }
  };

  if (loading) {
    return (
      <div className="pt-6 px-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-1/4"></div>
          <div className="h-64 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="pt-6 flex flex-col lg:flex-row gap-8 min-h-[calc(100vh-6rem)]">

      {/* ── LEFT PANEL ──────────────────────────────────────────────────────── */}
      <div className="w-full lg:w-[420px] flex-shrink-0 space-y-4 lg:overflow-y-auto lg:max-h-[calc(100vh-6rem)] text-sm">

        {/* Project header */}
        <div className="bg-white rounded-md p-4 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-3 min-w-0">
              <Link href="/dashboard" className="text-slate-400 hover:text-slate-700 shrink-0">
                ←
              </Link>
              <h1 className="font-semibold text-slate-900 truncate">{project.name}</h1>
              <Link
                href={`/projects/${id}/step`}
                className="shrink-0 text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50 text-slate-600"
              >
                Import STEP
              </Link>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <UnitToggle value={units} onChange={setUnits} />
              <button
                onClick={downloadProjectBundle}
                disabled={exportingBundle}
                className="px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 text-slate-600 transition-colors text-xs font-medium disabled:opacity-50"
              >
                {exportingBundle ? 'Exporting…' : 'Export Bundle'}
              </button>
              <button
                onClick={saveProject}
                disabled={saving}
                className={`px-3 py-1.5 rounded transition-colors text-xs font-medium disabled:opacity-50 ${
                  isDirty ? 'bg-slate-800 hover:bg-slate-700 text-white' : 'bg-slate-100 text-slate-400 cursor-default'
                }`}
              >
                {saving ? 'Saving…' : isDirty ? 'Save' : 'Saved'}
              </button>
            </div>
          </div>
        </div>

        {/* Settings */}
        <div className="bg-white rounded-md p-4 shadow-sm border border-slate-200 space-y-3">
          <h2 className="text-slate-500 text-xs font-medium uppercase tracking-wide">Settings</h2>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-slate-500 block mb-1">Blade Kerf</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.0625"
                  min={0}
                  value={kerf}
                  onChange={(e) => setKerf(parseFloat(e.target.value) || 0)}
                  className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5 w-20 focus:border-slate-400 outline-none text-slate-800 text-xs"
                />
                <span className="text-slate-400 text-[10px]">in</span>
              </div>
            </div>
            <div>
              <label className="text-slate-500 block mb-1">Presets</label>
              <div className="flex gap-1 flex-wrap">
                {KERF_PRESETS.map((k) => (
                  <button
                    key={k.value}
                    onClick={() => setKerf(k.value)}
                    className={`px-2 py-1.5 rounded text-[10px] ${kerf === k.value ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-700 border border-slate-200'}`}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-slate-500 block mb-1">Padding <span className="text-slate-400 font-normal">(clearance per side)</span></label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.0625"
                  min={0}
                  value={padding}
                  onChange={(e) => setPadding(parseFloat(e.target.value) || 0)}
                  className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5 w-20 focus:border-slate-400 outline-none text-slate-800 text-xs"
                />
                <span className="text-slate-400 text-[10px]">in</span>
              </div>
            </div>
            <div>
              <label className="text-slate-500 block mb-1">Presets</label>
              <div className="flex gap-1 flex-wrap">
                {[{ label: 'None', value: 0 }, { label: '¼"', value: 0.25 }, { label: '½"', value: 0.5 }, { label: '1"', value: 1 }].map((p) => (
                  <button
                    key={p.value}
                    onClick={() => setPadding(p.value)}
                    className={`px-2 py-1.5 rounded text-[10px] ${padding === p.value ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-700 border border-slate-200'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-4 text-xs pt-1">
            <label className="flex items-center gap-2 text-slate-500 cursor-pointer">
              <input type="checkbox" checked={showAdv} onChange={(e) => setShowAdv(e.target.checked)} className="w-3 h-3 accent-slate-600" />
              Show Material Column
            </label>
            <label className="flex items-center gap-2 text-slate-500 cursor-pointer">
              <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} className="w-3 h-3 accent-slate-600" />
              Show Labels on Sheet
            </label>
          </div>
        </div>

        {/* Stock */}
        <div className="bg-white rounded-md p-4 shadow-sm border border-slate-200 space-y-2">
          <div className="flex justify-between items-center">
            <h2 className="text-slate-500 text-xs font-medium uppercase tracking-wide">Stock Sheets</h2>
            <div className="flex gap-1">
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    const p = STOCK_PRESETS.find((x) => x.name === e.target.value);
                    if (p) addStock(p);
                    e.target.value = '';
                  }
                }}
                className="bg-slate-50 border border-slate-200 text-xs rounded px-1 py-0.5 text-slate-600"
                defaultValue=""
              >
                <option value="">+preset</option>
                {STOCK_PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
              </select>
              <button onClick={() => addStock()} className="text-xs text-slate-500 hover:text-slate-700">+custom</button>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="text-left font-normal pb-1">Name</th>
                <th className="text-right font-normal pb-1 w-12">L</th>
                <th className="text-right font-normal pb-1 w-12">W</th>
                <th className="text-right font-normal pb-1 w-10">T</th>
                <th className="text-right font-normal pb-1 w-8">Qty</th>
                {showAdv && <th className="text-left font-normal pb-1 pl-1 w-16">Mat</th>}
                <th className="w-4"></th>
              </tr>
            </thead>
            <tbody>
              {stocks.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="py-0.5">
                    <input value={s.name} onChange={(e) => setStocks(stocks.map((x) => x.id === s.id ? { ...x, name: e.target.value } : x))} className="bg-transparent w-full outline-none text-slate-700" />
                  </td>
                  <td className="py-0.5">
                    <input type="number" step="1" min={0} value={s.l} onChange={(e) => setStocks(stocks.map((x) => x.id === s.id ? { ...x, l: parseFloat(e.target.value) || 0 } : x))} className="bg-transparent w-full text-right outline-none text-slate-700 text-xs" />
                  </td>
                  <td className="py-0.5">
                    <input type="number" step="1" min={0} value={s.w} onChange={(e) => setStocks(stocks.map((x) => x.id === s.id ? { ...x, w: parseFloat(e.target.value) || 0 } : x))} className="bg-transparent w-full text-right outline-none text-slate-700 text-xs" />
                  </td>
                  <td className="py-0.5">
                    <input type="number" step="0.0625" min={0} value={s.t ?? 0} onChange={(e) => setStocks(stocks.map((x) => x.id === s.id ? { ...x, t: parseFloat(e.target.value) || 0 } : x))} className="bg-transparent w-full text-right outline-none text-slate-700 text-xs" placeholder="0" />
                  </td>
                  <td className="py-0.5">
                    <input type="number" step="1" min={1} value={s.qty ?? 1} onChange={(e) => setStocks(stocks.map((x) => x.id === s.id ? { ...x, qty: parseInt(e.target.value) || 1 } : x))} className="bg-transparent w-full text-right outline-none text-slate-700 text-xs" />
                  </td>
                  {showAdv && (
                    <td className="py-0.5 pl-1">
                      <select value={s.mat} onChange={(e) => setStocks(stocks.map((x) => x.id === s.id ? { ...x, mat: e.target.value } : x))} className="bg-transparent outline-none text-slate-700">
                        {MATERIALS.map((m) => <option key={m}>{m}</option>)}
                      </select>
                    </td>
                  )}
                  <td className="py-0.5 text-right">
                    <button onClick={() => removeStock(s.id)} className="text-slate-300 hover:text-red-500">×</button>
                  </td>
                </tr>
              ))}
              {stocks.length === 0 && (
                <tr><td colSpan={showAdv ? 7 : 6} className="py-3 text-center text-slate-400">No stock added yet</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Parts */}
        <div className="bg-white rounded-md p-4 shadow-sm border border-slate-200 space-y-2">
          <div className="flex justify-between items-center">
            <h2 className="text-slate-500 text-xs font-medium uppercase tracking-wide">Parts to Cut</h2>
            <button
              onClick={() => setCuts([
                ...cuts,
                {
                  id: Date.now(),
                  dbId: crypto.randomUUID(),
                  label: `Part ${cuts.length + 1}`,
                  l: 24,
                  w: 12,
                  t: 0,
                  qty: 1,
                  mat: '',
                },
              ])}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              +add
            </button>
          </div>
          <CutList
            cuts={cuts}
            dim={dim}
            onChange={setCuts}
            onRemove={removeCut}
            onDownloadDxf={downloadPartDxf}
            groupMultipliers={groupMultipliers}
            onMultiplierChange={(group, mult) =>
              setGroupMultipliers((prev) => ({ ...prev, [group]: mult }))
            }
          />
        </div>

        {/* Optimize */}
        <div>
          <button
            onClick={() => handleOptimize(false)}
            className="w-full py-2.5 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded text-sm transition-colors"
          >
            Optimize Cut Layout
          </button>
          {stats && (
            <div className="text-xs text-slate-500 text-center mt-2">
              {stats.sheets} sheet{stats.sheets !== 1 ? 's' : ''} · {stats.waste}% waste
              {stats.unplaced > 0 && <span className="text-red-500"> · {stats.unplaced} unplaced</span>}
            </div>
          )}
        </div>

        {/* Results table */}
        {result && result.sheets.length > 0 && (
          <div className="bg-white rounded-md p-4 shadow-sm border border-slate-200 space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-slate-500 text-xs font-medium uppercase tracking-wide">Cut List</h2>
              <span className="text-slate-400 text-xs">{result.sheets.reduce((acc, s) => acc + s.cuts.length, 0)} cuts</span>
            </div>
            <div className="space-y-2">
              {result.sheets.map((sheet, i) => {
                const canExportSheet = Boolean(buildSheetContext(i)?.payload);
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-0.5">
                      <span>Sheet {i + 1}: {sheet.name}</span>
                      {canExportSheet && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => previewSheetDxf(i)}
                            disabled={sheetPreviewLoading}
                            className="text-xs px-1.5 py-0.5 border border-slate-200 rounded hover:bg-slate-50 text-slate-500 disabled:opacity-40"
                          >
                            {sheetPreviewLoading ? 'Loading…' : 'Preview'}
                          </button>
                          <button
                            onClick={() => downloadSheetDxf(i)}
                            disabled={exportingSheetDxfs}
                            className="text-xs px-1.5 py-0.5 border border-slate-200 rounded hover:bg-slate-50 text-slate-500 disabled:opacity-40"
                          >
                            ↓ DXF
                          </button>
                          <button
                            onClick={() => downloadSheetDxf(i, 'vcarve')}
                            disabled={exportingVcarveDxfs}
                            className="text-xs px-1.5 py-0.5 border border-amber-200 rounded hover:bg-amber-50 text-amber-700 disabled:opacity-40"
                          >
                            ↓ VCarve
                          </button>
                        </div>
                      )}
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-slate-400">
                          <th className="text-left font-normal pb-0.5 w-6">#</th>
                          <th className="text-left font-normal pb-0.5">Part</th>
                          <th className="text-right font-normal pb-0.5 w-16">L</th>
                          <th className="text-right font-normal pb-0.5 w-16">W</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sheet.cuts
                          .map((c, origIdx) => ({ ...c, origIdx }))
                          .sort((a, b) => (b.pw * b.ph) - (a.pw * a.ph))
                          .map((c, j) => {
                            const l = Math.max(c.pw, c.ph);
                            const w = Math.min(c.pw, c.ph);
                            const isHovered = hoveredPart?.sheetIndex === i && hoveredPart?.cutIndex === c.origIdx;
                            return (
                              <tr
                                key={j}
                                className={`border-t border-slate-100 cursor-pointer transition-colors ${isHovered ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                                onMouseEnter={() => setHoveredPart({ sheetIndex: i, cutIndex: c.origIdx })}
                                onMouseLeave={() => setHoveredPart(null)}
                              >
                                <td className="py-0.5 text-slate-400">{j + 1}</td>
                                <td className={`py-0.5 ${isHovered ? 'text-slate-800' : 'text-slate-600'}`}>{c.label}</td>
                                <td className={`py-0.5 text-right ${isHovered ? 'text-slate-700' : 'text-slate-400'}`}>{dim(l)}</td>
                                <td className={`py-0.5 text-right ${isHovered ? 'text-slate-700' : 'text-slate-400'}`}>{dim(w)}</td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>

            {result.unplaced.length > 0 && (
              <div className="mt-2">
                <div className="text-xs text-red-500 mb-0.5">Unplaced ({result.unplaced.length})</div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="text-left font-normal pb-0.5">Part</th>
                      <th className="text-right font-normal pb-0.5 w-16">L</th>
                      <th className="text-right font-normal pb-0.5 w-16">W</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.unplaced.map((p, j) => (
                      <tr key={j} className="border-t border-slate-100">
                        <td className="py-0.5 text-red-500">{p.label}</td>
                        <td className="py-0.5 text-right text-slate-400">{dim(Math.max(p.l, p.w))}</td>
                        <td className="py-0.5 text-right text-slate-400">{dim(Math.min(p.l, p.w))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex gap-3 pt-3 mt-3 border-t border-slate-200">
              <button onClick={downloadPDF} className="text-slate-600 hover:text-slate-800 text-xs">↓ PDF</button>
              <button onClick={downloadCutListCSV} className="text-slate-400 hover:text-slate-600 text-xs">↓ CSV</button>
              <button onClick={downloadLayoutSVG} className="text-slate-400 hover:text-slate-600 text-xs">↓ SVG</button>
              <button
                onClick={() => downloadAllSheetDxfs()}
                disabled={exportingSheetDxfs || exportableSheetIndices.length === 0}
                className="text-slate-400 hover:text-slate-600 text-xs disabled:opacity-40"
              >
                {exportingSheetDxfs ? 'Preparing DXFs…' : '↓ All Sheet DXFs'}
              </button>
              <button
                onClick={() => downloadAllSheetDxfs('vcarve')}
                disabled={exportingVcarveDxfs || exportableSheetIndices.length === 0}
                className="text-amber-700 hover:text-amber-800 text-xs disabled:opacity-40"
              >
                {exportingVcarveDxfs ? 'Preparing VCarve DXFs…' : '↓ VCarve DXFs'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── RIGHT PANEL — Interactive Layout Editor ──────────────────────────── */}
      <div className="flex-1 min-w-0">
        {!result ? (
          <div className="h-full min-h-[200px] flex items-center justify-center text-slate-400 text-sm">
            Click Optimize to generate cut layout
          </div>
        ) : result.sheets.length === 0 && excludedCuts.length === 0 ? (
          <div className="h-full min-h-[200px] flex items-center justify-center text-red-500 text-sm">
            No sheets generated. Parts may be too large for available stock.
          </div>
        ) : (
          <LayoutEditor
            result={result}
            overrides={overrides}
            selectedKeys={selectedKeys}
            excludedCuts={excludedCuts}
            canUndo={canUndo}
            canRedo={canRedo}
            showLabels={showLabels}
            gridSize={gridSize}
            dispatch={layoutDispatch}
            onExcludeKeys={excludeKeysFromOptimization}
            onRestoreExcludedKey={(key) => restoreExcludedKeys([key])}
            onRestoreAllExcluded={restoreAllExcluded}
            onReoptimize={() => handleOptimize(true)}
            onReoptimizeAll={() => handleOptimize(false)}
          />
        )}
      </div>

      {/* Sheet DXF Preview Modal */}
      {sheetPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSheetPreview(null)}>
          <div
            className="bg-white rounded-lg shadow-xl w-[90vw] h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
              <h2 className="text-sm font-semibold text-slate-700">Sheet DXF Preview</h2>
              <button
                onClick={() => setSheetPreview(null)}
                className="text-slate-400 hover:text-slate-700 text-lg leading-none px-1"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 min-h-0">
              <SheetDxfPreview data={sheetPreview} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
