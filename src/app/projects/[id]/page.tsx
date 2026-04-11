'use client';

import { useState, useEffect, useMemo, use, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { optimizeCutsBest, calculateStats } from '@/lib/cut-optimizer';
import { toFraction } from '@/lib/fraction-utils';
import { STOCK_PRESETS, MATERIALS, KERF_PRESETS, CUT_COLORS } from '@/lib/constants';
import { UnitToggle } from '@/components/ui/UnitToggle';
import { inToMM } from '@/lib/unit-utils';
import { jsPDF } from 'jspdf';
import type { Stock as StockType, Cut as CutType, OptimizationResult, UnitSystem, PartInstanceKey } from '@/types';
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
  stepSessionId?: string | null;
  stepBodyIndex?: number | null;
  stepFaceIndex?: number | null;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  kerf: number;
  units: string | null;
  groupMultipliers: string | null;
  stocks: DBStock[];
  cuts: DBCut[];
}

function toAppStock(s: DBStock, index: number): StockType {
  return {
    id: index + 1,
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
    label: c.label,
    l: c.length,
    w: c.width,
    t: c.thickness ?? 0,
    qty: c.quantity,
    mat: c.material,
    group: c.groupName ?? undefined,
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
      {/* Row 1: drag handle + checkbox + label + remove */}
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
          title="Remove"
          className="shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity text-slate-300 hover:text-red-500 text-base leading-none px-0.5"
        >×</button>
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
        {cut.stepSessionId && (
          <button
            onClick={onDownloadDxf}
            className="shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity text-xs text-slate-400 hover:text-slate-700 px-1.5 py-0.5 border border-slate-200 rounded"
            title="Download DXF"
          >
            ↓ DXF
          </button>
        )}

        {/* STEP badge */}
        {cut.stepSessionId && (
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
  const dragIdRef = useRef<number | null>(null);
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
    const srcId = dragIdRef.current;
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
    dragIdRef.current = null;
    setDropTarget(null);
  }, [cuts, onChange]);

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

  const isDragging = dragIdRef.current !== null;

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
                  onDragStart={() => { dragIdRef.current = cut.id; setDropTarget(null); }}
                  onDragEnd={() => { dragIdRef.current = null; setDropTarget(null); }}
                  isDropTarget={dropTarget?.kind === 'cut' && dropTarget.id === cut.id}
                  onDragOver={(e) => { e.preventDefault(); if (dragIdRef.current !== cut.id) setDropTarget({ kind: 'cut', id: cut.id }); }}
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
            onItemDragStart={(id) => { dragIdRef.current = id; setDropTarget(null); }}
            onItemDragEnd={() => { dragIdRef.current = null; setDropTarget(null); }}
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
  const [isDirty, setIsDirty] = useState(false);
  const [stocks, setStocks] = useState<StockType[]>([]);
  const [cuts, setCuts] = useState<CutType[]>([]);
  const [kerf, setKerf] = useState(0.125);
  const [padding, setPadding] = useState(0.5);
  const [groupMultipliers, setGroupMultipliers] = useState<Record<string, number>>({});
  const [units, setUnits] = useState<UnitSystem>('in');
  const [showAdv, setShowAdv] = useState(false);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [hoveredPart, setHoveredPart] = useState<{ sheetIndex: number; cutIndex: number } | null>(null);
  const [gridSize, setGridSize] = useState(0.125); // 1/8" default snap
  const [excludedKeys, setExcludedKeys] = useState<Set<PartInstanceKey>>(new Set());

  const EXCLUDED_STORAGE_KEY = `layout-excluded-${id}`;
  const stats = useMemo(() => result ? calculateStats(result) : null, [result]);

  useEffect(() => {
    if (!id) return;
    try {
      const raw = localStorage.getItem(EXCLUDED_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setExcludedKeys(new Set(parsed as PartInstanceKey[]));
    } catch { /* ignore */ }
  }, [EXCLUDED_STORAGE_KEY, id]);

  useEffect(() => {
    if (!id) return;
    try {
      localStorage.setItem(EXCLUDED_STORAGE_KEY, JSON.stringify([...excludedKeys]));
    } catch { /* ignore */ }
  }, [EXCLUDED_STORAGE_KEY, id, excludedKeys]);

  // Layout editor state (overrides, selection, undo/redo, localStorage)
  const {
    overrides,
    selectedKeys,
    canUndo,
    canRedo,
    dispatch: layoutDispatch,
    rotateSelected,
    pinSelected,
    unpinSelected,
  } = useLayoutEditor(id, result);

  // Build a stable reference to result.sheets for keyboard callbacks
  const resultRef = useRef(result);
  useEffect(() => { resultRef.current = result; }, [result]);

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
  }, [id]);

  // Auto-save 1.5 s after any change to the editable project data.
  // A ref guards against firing on the initial data load.
  const isLoaded = useRef(false);
  useEffect(() => {
    if (!isLoaded.current) return;
    setIsDirty(true);
    const t = setTimeout(() => saveProject(), 1500);
    return () => clearTimeout(t);
  }, [stocks, cuts, kerf, units, groupMultipliers]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchProject = async () => {
    try {
      const res = await fetch(`/api/v1/projects/${id}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data);
        setStocks(data.stocks.map(toAppStock));
        setCuts(data.cuts.map(toAppCut));
        setKerf(data.kerf);
        setUnits((data.units as UnitSystem) ?? 'in');
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
  };

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
          stocks: stocks.map((s) => ({ name: s.name, l: s.l, w: s.w, t: s.t, qty: s.qty, mat: s.mat })),
          cuts: cuts.map((c) => ({
            label: c.label, l: c.l, w: c.w, t: c.t, qty: c.qty, mat: c.mat,
            group: c.group, stepSessionId: c.stepSessionId,
            stepBodyIndex: c.stepBodyIndex, stepFaceIndex: c.stepFaceIndex,
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
      id: Date.now(), name: s.name, l: s.length, w: s.width,
      t: (s as typeof STOCK_PRESETS[0]).thickness ?? 0, qty: 1, mat: 'Plywood',
    }]);
  };

  const removeStock = (stockId: number) => setStocks(stocks.filter((s) => s.id !== stockId));
  const removeCut = (cutId: number) => setCuts(cuts.filter((c) => c.id !== cutId));

  const dim = (val: number) => {
    if (units === 'mm') return inToMM(val).toFixed(1);
    return toFraction(val);
  };

  const unitLabel = units === 'mm' ? 'mm' : 'in';

  const downloadSheetDxf = async (sheetIdx: number) => {
    if (!result) return;
    const sheet = result.sheets[sheetIdx];
    // Use merged sheet so manual overrides (drag, rotate, cross-sheet moves) are reflected
    const mergedCuts = buildMergedSheet(sheet, sheetIdx, overrides, result.sheets);
    const stepCuts = mergedCuts.filter(
      (c) => c.stepSessionId && c.stepBodyIndex !== undefined && c.stepFaceIndex !== undefined
    );
    const dimCuts = mergedCuts.filter(
      (c) => !c.stepSessionId
    );
    if (stepCuts.length === 0 && dimCuts.length === 0) return;

    // Determine unit conversion: optimizer works in the project's unit (in or mm)
    const toMM = (v: number) => units === 'mm' ? v : inToMM(v);

    const sessionId = stepCuts[0]?.stepSessionId ?? '';
    const sheetWmm = toMM(sheet.w);
    const sheetLmm = toMM(sheet.l);

    try {
      const res = await fetch('/api/v1/step/export/sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          sheet_width_mm: sheetWmm,
          sheet_length_mm: sheetLmm,
          sheet_name: sheet.name,
          placements: stepCuts.map((c) => ({
            body_index: c.stepBodyIndex!,
            face_index: c.stepFaceIndex!,
            body_name: c.label,
            x_mm: toMM(c.x),
            y_mm: toMM(c.y),
            rot: c.rot,
            session_id: c.stepSessionId!,
          })),
          rect_placements: dimCuts.map((c) => ({
            body_name: c.label,
            x_mm: toMM(c.x),
            y_mm: toMM(c.y),
            w_mm: toMM(c.pw),
            h_mm: toMM(c.ph),
          })),
        }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Sheet_${sheetIdx + 1}_${sheet.name.replace(/[^a-zA-Z0-9]/g, '_')}.dxf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Sheet DXF download failed:', e);
    }
  };

  const [sheetPreview, setSheetPreview] = useState<SheetPreviewData | null>(null);
  const [sheetPreviewLoading, setSheetPreviewLoading] = useState(false);

  const previewSheetDxf = async (sheetIdx: number) => {
    if (!result) return;
    const sheet = result.sheets[sheetIdx];
    const mergedCuts = buildMergedSheet(sheet, sheetIdx, overrides, result.sheets);
    const stepCuts = mergedCuts.filter(
      (c) => c.stepSessionId && c.stepBodyIndex !== undefined && c.stepFaceIndex !== undefined
    );
    const dimCuts = mergedCuts.filter((c) => !c.stepSessionId);
    if (stepCuts.length === 0 && dimCuts.length === 0) return;

    const toMM = (v: number) => units === 'mm' ? v : inToMM(v);
    const sessionId = stepCuts[0]?.stepSessionId ?? '';

    setSheetPreviewLoading(true);
    try {
      const res = await fetch('/api/v1/step/export/sheet/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          sheet_width_mm: toMM(sheet.w),
          sheet_length_mm: toMM(sheet.l),
          sheet_name: sheet.name,
          placements: stepCuts.map((c) => ({
            body_index: c.stepBodyIndex!,
            face_index: c.stepFaceIndex!,
            body_name: c.label,
            x_mm: toMM(c.x),
            y_mm: toMM(c.y),
            rot: c.rot,
            session_id: c.stepSessionId!,
          })),
          rect_placements: dimCuts.map((c) => ({
            body_name: c.label,
            x_mm: toMM(c.x),
            y_mm: toMM(c.y),
            w_mm: toMM(c.pw),
            h_mm: toMM(c.ph),
          })),
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setSheetPreview(data);
    } catch (e) {
      console.error('Sheet DXF preview failed:', e);
    } finally {
      setSheetPreviewLoading(false);
    }
  };

  const downloadPartDxf = async (cut: CutType) => {
    if (!cut.stepSessionId || cut.stepBodyIndex === undefined || cut.stepFaceIndex === undefined) return;
    try {
      const res = await fetch('/api/v1/step/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: cut.stepSessionId,
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

  const downloadCutListCSV = () => {
    if (!result) return;
    const rows = [['Sheet', 'Part', 'Length', 'Width', 'X', 'Y', 'Rotated'].join(',')];
    result.sheets.forEach((sheet, i) => {
      sheet.cuts.forEach((c) => {
        rows.push([`Sheet ${i + 1} (${sheet.name})`, c.label, c.ph, c.pw, c.x, c.y, c.rot ? 'Yes' : 'No'].join(','));
      });
    });
    if (result.unplaced.length > 0) {
      rows.push('', 'UNPLACED PARTS');
      result.unplaced.forEach((c) => {
        rows.push(['N/A', c.label, c.l, c.w, '', '', ''].join(','));
      });
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.name ?? 'cut-list'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadLayoutSVG = () => {
    if (!result) return;
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

      sheet.cuts.forEach((c, j) => {
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
    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project?.name ?? 'cut-layout'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPDF = () => {
    if (!result) return;

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 40;
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    const largestDim = Math.max(...result.sheets.map((s) => Math.max(s.l, s.w)));
    const globalScale = Math.min(contentWidth / largestDim, 3);

    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.text(project?.name ?? 'Cut List', margin, y);
    y += 10;

    if (stats) {
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(100);
      y += 15;
      pdf.text(`${stats.sheets} sheet${stats.sheets !== 1 ? 's' : ''} · ${stats.waste}% waste${stats.unplaced > 0 ? ` · ${stats.unplaced} unplaced` : ''}`, margin, y);
      pdf.setTextColor(0);
    }
    y += 30;

    result.sheets.forEach((sheet, i) => {
      const diagramWidth = sheet.w * globalScale;
      const diagramHeight = sheet.l * globalScale;
      const sortedCuts = [...sheet.cuts].sort((a, b) => (b.pw * b.ph) - (a.pw * a.ph));
      const tableHeight = 30 + sortedCuts.length * 14;
      const sectionHeight = Math.max(diagramHeight + 25, tableHeight + 25);

      if (y + sectionHeight > pageHeight - margin) { pdf.addPage(); y = margin; }

      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(0);
      pdf.text(`Sheet ${i + 1}: ${sheet.name} (${sheet.w}" × ${sheet.l}")`, margin, y);
      y += 18;

      const sectionStartY = y;

      pdf.setDrawColor(148, 163, 184);
      pdf.setFillColor(241, 245, 249);
      pdf.rect(margin, y, diagramWidth, diagramHeight, 'FD');

      sheet.cuts.forEach((c, j) => {
        const col = CUT_COLORS[j % CUT_COLORS.length];
        const r = parseInt(col.slice(1, 3), 16);
        const g = parseInt(col.slice(3, 5), 16);
        const b = parseInt(col.slice(5, 7), 16);
        pdf.setFillColor(r, g, b);
        pdf.setDrawColor(r, g, b);
        const cx = margin + c.x * globalScale;
        const cy = y + c.y * globalScale;
        const cw = c.pw * globalScale;
        const ch = c.ph * globalScale;
        pdf.rect(cx, cy, cw, ch, 'FD');
        const fontSize = Math.min(cw / 4, ch / 4, 9);
        if (fontSize >= 5) {
          pdf.setFontSize(fontSize);
          pdf.setFont('helvetica', 'bold');
          pdf.setTextColor(255);
          const labelWidth = pdf.getTextWidth(c.label);
          if (labelWidth < cw - 2 && fontSize < ch - 2) {
            pdf.text(c.label, cx + cw / 2 - labelWidth / 2, cy + ch / 2 + fontSize / 3);
          }
          pdf.setTextColor(0);
        }
      });

      const tableX = diagramWidth < contentWidth * 0.55 ? margin + diagramWidth + 15 : margin;
      const tableStartY = diagramWidth < contentWidth * 0.55 ? sectionStartY : sectionStartY + diagramHeight + 15;
      const tableWidth = diagramWidth < contentWidth * 0.55 ? contentWidth - diagramWidth - 15 : contentWidth;
      let tableY = tableStartY;

      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'bold');
      pdf.setFillColor(248, 250, 252);
      pdf.rect(tableX, tableY, tableWidth, 14, 'F');
      pdf.setTextColor(100);
      pdf.text('#', tableX + 4, tableY + 10);
      pdf.text('Part', tableX + 20, tableY + 10);
      pdf.text('L', tableX + tableWidth - 50, tableY + 10);
      pdf.text('W', tableX + tableWidth - 25, tableY + 10);
      tableY += 14;

      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(60);
      sortedCuts.forEach((c, idx) => {
        const l = Math.max(c.pw, c.ph);
        const w = Math.min(c.pw, c.ph);
        pdf.setDrawColor(230);
        pdf.line(tableX, tableY, tableX + tableWidth, tableY);
        pdf.text(`${idx + 1}`, tableX + 4, tableY + 10);
        pdf.text(c.label, tableX + 20, tableY + 10);
        pdf.text(`${l}"`, tableX + tableWidth - 50, tableY + 10);
        pdf.text(`${w}"`, tableX + tableWidth - 25, tableY + 10);
        tableY += 14;
      });

      y = Math.max(sectionStartY + diagramHeight, tableY) + 25;
    });

    if (result.unplaced.length > 0) {
      if (y > pageHeight - 80) { pdf.addPage(); y = margin; }
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(180, 0, 0);
      pdf.text(`Unplaced Parts (${result.unplaced.length})`, margin, y);
      y += 18;
      pdf.setFontSize(8);
      pdf.setFont('helvetica', 'bold');
      pdf.setFillColor(254, 242, 242);
      pdf.rect(margin, y, 200, 14, 'F');
      pdf.setTextColor(100);
      pdf.text('Part', margin + 4, y + 10);
      pdf.text('L', margin + 140, y + 10);
      pdf.text('W', margin + 170, y + 10);
      y += 14;
      pdf.setFont('helvetica', 'normal');
      result.unplaced.forEach((p) => {
        const l = Math.max(p.l, p.w);
        const w = Math.min(p.l, p.w);
        pdf.setDrawColor(230);
        pdf.line(margin, y, margin + 200, y);
        pdf.setTextColor(180, 0, 0);
        pdf.text(p.label, margin + 4, y + 10);
        pdf.setTextColor(100);
        pdf.text(`${l}"`, margin + 140, y + 10);
        pdf.text(`${w}"`, margin + 170, y + 10);
        y += 14;
      });
    }

    pdf.save(`${project?.name ?? 'cut-list'}.pdf`);
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
              onClick={() => setCuts([...cuts, { id: Date.now(), label: `Part ${cuts.length + 1}`, l: 24, w: 12, t: 0, qty: 1, mat: '' }])}
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
                const hasStepCuts = sheet.cuts.some((c) => c.stepSessionId);
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-0.5">
                      <span>Sheet {i + 1}: {sheet.name}</span>
                      {hasStepCuts && (
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
                            className="text-xs px-1.5 py-0.5 border border-slate-200 rounded hover:bg-slate-50 text-slate-500"
                          >
                            ↓ DXF
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
