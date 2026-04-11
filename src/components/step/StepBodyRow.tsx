'use client';

import { useState, useRef, useEffect } from 'react';

export interface StepBody {
  index: number;
  name: string;
  folder_path: string[];
  face_count: number;
  faces: StepFace[];
  bbox_mm: [number, number, number] | null;
}

export interface StepFace {
  index: number;
  is_planar: boolean;
  normal: [number, number, number] | null;
  centroid: [number, number, number] | null;
  area: number;
  is_top_face?: boolean;
}

interface Props {
  body: StepBody;
  included: boolean;
  name: string;
  selected: boolean;
  confirmed: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onRename: (name: string) => void;
}

export function StepBodyRow({ body, included, name, selected, confirmed, onSelect, onToggle, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
    else setDraft(name);
  };

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer transition-colors ${
        selected ? 'bg-slate-200' : included ? 'hover:bg-slate-100' : 'opacity-40 hover:bg-slate-100'
      }`}
      onClick={onSelect}
    >
      {/* Include checkbox */}
      <input
        type="checkbox"
        checked={included}
        onChange={(e) => { e.stopPropagation(); onToggle(); }}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 w-3.5 h-3.5"
      />

      {/* Name */}
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setEditing(false); setDraft(name); }
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 text-xs px-1 border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
      ) : (
        <span className="flex-1 text-xs truncate">{name}</span>
      )}

      {/* Rename pencil */}
      <button
        title="Rename"
        onClick={(e) => { e.stopPropagation(); setEditing(true); setDraft(name); }}
        className="shrink-0 p-0.5 text-slate-300 hover:text-slate-600"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 0l.172.172a2 2 0 010 2.828L12 16H9v-3z" />
        </svg>
      </button>

      {/* Confirmed indicator */}
      <span
        title={confirmed ? 'Face confirmed' : 'No face selected yet'}
        className="shrink-0"
      >
        {confirmed ? (
          <svg className="w-3.5 h-3.5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="7" strokeWidth="1.5" strokeDasharray="3 2" />
          </svg>
        )}
      </span>
    </div>
  );
}
