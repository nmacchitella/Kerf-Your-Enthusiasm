'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { PartInstanceKey } from '@/types';

interface ContextMenuProps {
  targetKey: PartInstanceKey;
  clientX: number;
  clientY: number;
  isPinned: boolean;
  sheetCount: number;
  currentSheetIndex: number;
  onClose: () => void;
  onRotate: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onMoveToSheet: (sheetIndex: number) => void;
  onAssignToSheet: (sheetIndex: number) => void;
  onRemoveFromSheet: () => void;
  onExcludeFromOptimization: () => void;
}

export default function ContextMenu({
  targetKey: _targetKey,
  clientX,
  clientY,
  isPinned,
  sheetCount,
  currentSheetIndex,
  onClose,
  onRotate,
  onPin,
  onUnpin,
  onMoveToSheet,
  onAssignToSheet,
  onRemoveFromSheet,
  onExcludeFromOptimization,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const x = Math.min(clientX, window.innerWidth - 220);
  const y = Math.min(clientY, window.innerHeight - 340);

  const item = (label: string, onClick: () => void, danger = false) => (
    <button
      key={label}
      onClick={() => { onClick(); onClose(); }}
      className={`w-full text-left px-3 py-1.5 text-xs rounded transition-colors ${
        danger
          ? 'text-red-600 hover:bg-red-50'
          : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  );

  const divider = <div className="my-1 border-t border-slate-100" />;

  const otherSheets = Array.from({ length: sheetCount }, (_, i) => i).filter(i => i !== currentSheetIndex);

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', left: x, top: y, zIndex: 9999 }}
      className="bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[200px]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {item('Rotate 90°', onRotate)}
      {isPinned ? item('Unpin', onUnpin) : item('Pin position', onPin)}

      {otherSheets.length > 0 && (
        <>
          {divider}
          <div className="px-3 py-1 text-[10px] text-slate-400 uppercase tracking-wider">Move to sheet</div>
          {otherSheets.map(i => item(`Sheet ${i + 1}`, () => onMoveToSheet(i)))}

          {divider}
          <div className="px-3 py-1 text-[10px] text-slate-400 uppercase tracking-wider">Assign (free position)</div>
          {otherSheets.map(i => item(`Sheet ${i + 1}`, () => onAssignToSheet(i)))}
        </>
      )}

      {divider}
      {item('Remove from sheet', onRemoveFromSheet)}
      {item('Delete from optimization', onExcludeFromOptimization, true)}
    </div>,
    document.body
  );
}
