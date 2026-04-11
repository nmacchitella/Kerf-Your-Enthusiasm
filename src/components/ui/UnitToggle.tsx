'use client';

import { UnitSystem } from '@/types';

interface Props {
  value: UnitSystem;
  onChange: (u: UnitSystem) => void;
}

export function UnitToggle({ value, onChange }: Props) {
  return (
    <div className="flex rounded border border-slate-200 overflow-hidden text-xs">
      {(['in', 'mm'] as UnitSystem[]).map((u) => (
        <button
          key={u}
          onClick={() => onChange(u)}
          className={`px-2 py-1 transition-colors ${
            value === u ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  );
}
