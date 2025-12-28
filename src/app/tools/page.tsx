'use client';

import { useState } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { Tool } from '@/types';
import { CONDITION_COLORS } from '@/lib/constants';

const inputCls =
  'bg-stone-800 border border-stone-700 rounded px-3 py-2 text-sm focus:border-amber-500 outline-none w-full';

export default function ToolsPage() {
  const [tools, setTools] = useLocalStorage<Tool[]>('kerfuffle-tools', [
    { id: 1, name: 'Table Saw', brand: 'DeWalt', model: 'DWE7491RS', cond: 'excellent', notes: '10" blade' },
    { id: 2, name: 'Router', brand: 'Bosch', model: '1617EVS', cond: 'good', notes: '2.25 HP' },
    { id: 3, name: 'Sander', brand: 'Festool', model: 'ETS 125', cond: 'excellent', notes: '5" pad' },
  ]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Omit<Tool, 'id'>>({
    name: '',
    brand: '',
    model: '',
    cond: 'good',
    notes: '',
  });

  const addTool = () => {
    if (form.name) {
      setTools([...tools, { ...form, id: Date.now() }]);
      setForm({ name: '', brand: '', model: '', cond: 'good', notes: '' });
      setShowForm(false);
    }
  };

  const deleteTool = (id: number) => {
    setTools(tools.filter((t) => t.id !== id));
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Tool Inventory</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-amber-600 text-stone-900 rounded font-medium text-sm"
        >
          + Add Tool
        </button>
      </div>

      {showForm && (
        <div className="bg-stone-800 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Tool name *"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputCls}
            />
            <input
              placeholder="Brand"
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
              className={inputCls}
            />
            <input
              placeholder="Model"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
              className={inputCls}
            />
            <select
              value={form.cond}
              onChange={(e) =>
                setForm({ ...form, cond: e.target.value as Tool['cond'] })
              }
              className={inputCls}
            >
              <option value="excellent">Excellent</option>
              <option value="good">Good</option>
              <option value="fair">Fair</option>
              <option value="poor">Poor</option>
            </select>
          </div>
          <input
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className={inputCls}
          />
          <div className="flex gap-2">
            <button
              onClick={addTool}
              className="px-4 py-2 bg-amber-600 text-stone-900 rounded text-sm font-medium"
            >
              Save
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 bg-stone-700 rounded text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-3">
        {tools.map((t) => (
          <div
            key={t.id}
            className="bg-stone-800 rounded-lg p-4 flex justify-between items-start group"
          >
            <div>
              <div className="font-medium">{t.name}</div>
              <div className="text-sm text-stone-400">
                {t.brand} {t.model}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded ${CONDITION_COLORS[t.cond]}`}
                >
                  {t.cond}
                </span>
                {t.notes && (
                  <span className="text-xs text-stone-500 italic">{t.notes}</span>
                )}
              </div>
            </div>
            <button
              onClick={() => deleteTool(t.id)}
              className="text-stone-600 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xl"
            >
              ×
            </button>
          </div>
        ))}
        {tools.length === 0 && (
          <div className="text-center text-stone-500 py-8">
            No tools yet. Add your first tool above.
          </div>
        )}
      </div>
    </div>
  );
}
