'use client';

import { useState, useMemo } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { Stock, Cut, OptimizationResult } from '@/types';
import { optimizeCuts, calculateStats } from '@/lib/cut-optimizer';
import { STOCK_PRESETS, MATERIALS, KERF_PRESETS, CUT_COLORS } from '@/lib/constants';
import { Button, Input, Select } from '@/components/ui/Input';
import { StatCard } from '@/components/ui/Card';

const inputCls =
  'bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-sm focus:border-amber-500 outline-none';

export default function CutListPage() {
  const [stocks, setStocks] = useLocalStorage<Stock[]>('kerfuffle-stocks', [
    { id: 1, name: '4×8 Plywood', l: 96, w: 48, mat: 'Plywood' },
  ]);
  const [cuts, setCuts] = useLocalStorage<Cut[]>('kerfuffle-cuts', [
    { id: 1, label: 'Shelf', l: 24, w: 12, qty: 4, mat: '' },
    { id: 2, label: 'Side', l: 36, w: 18, qty: 2, mat: '' },
    { id: 3, label: 'Top', l: 48, w: 24, qty: 1, mat: '' },
  ]);
  const [kerf, setKerf] = useState(0.125);
  const [showAdv, setShowAdv] = useState(false);
  const [result, setResult] = useState<OptimizationResult | null>(null);

  const addStock = (preset?: { name: string; length: number; width: number }) => {
    const s = preset || { name: 'Custom', length: 96, width: 48 };
    setStocks([
      ...stocks,
      { id: Date.now(), name: s.name, l: s.length, w: s.width, mat: 'Plywood' },
    ]);
  };

  const stats = useMemo(() => {
    if (!result) return null;
    return calculateStats(result);
  }, [result]);

  return (
    <div className="space-y-6">
      {/* Settings */}
      <div className="bg-stone-800 rounded-lg p-4">
        <h3 className="text-amber-400 font-medium mb-3">Settings</h3>
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="text-xs text-stone-500 block mb-1">Kerf (in)</label>
            <input
              type="number"
              step="0.0625"
              value={kerf}
              onChange={(e) => setKerf(parseFloat(e.target.value) || 0)}
              className={`${inputCls} w-24`}
            />
          </div>
          <div className="flex gap-2">
            {KERF_PRESETS.map((k) => (
              <button
                key={k.value}
                onClick={() => setKerf(k.value)}
                className={`px-2 py-1 text-xs rounded ${
                  kerf === k.value
                    ? 'bg-amber-600 text-stone-900'
                    : 'bg-stone-700 text-stone-300'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-stone-400">
            <input
              type="checkbox"
              checked={showAdv}
              onChange={(e) => setShowAdv(e.target.checked)}
              className="rounded"
            />
            Show material types
          </label>
        </div>
      </div>

      {/* Stock Sheets */}
      <div className="bg-stone-800 rounded-lg p-4">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-amber-400 font-medium">Stock Sheets</h3>
          <div className="flex gap-2">
            <select
              onChange={(e) => {
                if (e.target.value) {
                  const preset = STOCK_PRESETS.find((p) => p.name === e.target.value);
                  if (preset) addStock(preset);
                }
              }}
              className={`${inputCls} text-xs`}
              value=""
            >
              <option value="">+ Quick Add</option>
              {STOCK_PRESETS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => addStock()}
              className="text-xs text-amber-400 hover:text-amber-300"
            >
              + Custom
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {stocks.map((s) => (
            <div key={s.id} className="flex gap-2 items-center flex-wrap">
              <input
                value={s.name}
                onChange={(e) =>
                  setStocks(
                    stocks.map((x) =>
                      x.id === s.id ? { ...x, name: e.target.value } : x
                    )
                  )
                }
                className={`${inputCls} flex-1 min-w-[120px]`}
                placeholder="Name"
              />
              <input
                type="number"
                value={s.l}
                onChange={(e) =>
                  setStocks(
                    stocks.map((x) =>
                      x.id === s.id
                        ? { ...x, l: parseFloat(e.target.value) || 0 }
                        : x
                    )
                  )
                }
                className={`${inputCls} w-20`}
                placeholder="Length"
              />
              <span className="text-stone-500">×</span>
              <input
                type="number"
                value={s.w}
                onChange={(e) =>
                  setStocks(
                    stocks.map((x) =>
                      x.id === s.id
                        ? { ...x, w: parseFloat(e.target.value) || 0 }
                        : x
                    )
                  )
                }
                className={`${inputCls} w-20`}
                placeholder="Width"
              />
              {showAdv && (
                <select
                  value={s.mat}
                  onChange={(e) =>
                    setStocks(
                      stocks.map((x) =>
                        x.id === s.id ? { ...x, mat: e.target.value } : x
                      )
                    )
                  }
                  className={`${inputCls} w-28`}
                >
                  {MATERIALS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              )}
              <span className="text-xs text-stone-500 w-16">
                {((s.l * s.w) / 144).toFixed(1)} sqft
              </span>
              <button
                onClick={() =>
                  stocks.length > 1 &&
                  setStocks(stocks.filter((x) => x.id !== s.id))
                }
                className="text-stone-500 hover:text-red-400 text-lg"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Required Parts */}
      <div className="bg-stone-800 rounded-lg p-4">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-amber-400 font-medium">Required Parts</h3>
          <button
            onClick={() =>
              setCuts([
                ...cuts,
                {
                  id: Date.now(),
                  label: `Part ${cuts.length + 1}`,
                  l: 12,
                  w: 12,
                  qty: 1,
                  mat: '',
                },
              ])
            }
            className="text-xs text-amber-400 hover:text-amber-300"
          >
            + Add Part
          </button>
        </div>
        <div className="space-y-2">
          {cuts.map((c) => (
            <div key={c.id} className="flex gap-2 items-center flex-wrap">
              <input
                value={c.label}
                onChange={(e) =>
                  setCuts(
                    cuts.map((x) =>
                      x.id === c.id ? { ...x, label: e.target.value } : x
                    )
                  )
                }
                className={`${inputCls} flex-1 min-w-[100px]`}
                placeholder="Label"
              />
              <input
                type="number"
                value={c.l}
                onChange={(e) =>
                  setCuts(
                    cuts.map((x) =>
                      x.id === c.id
                        ? { ...x, l: parseFloat(e.target.value) || 0 }
                        : x
                    )
                  )
                }
                className={`${inputCls} w-16`}
                placeholder="L"
              />
              <span className="text-stone-500">×</span>
              <input
                type="number"
                value={c.w}
                onChange={(e) =>
                  setCuts(
                    cuts.map((x) =>
                      x.id === c.id
                        ? { ...x, w: parseFloat(e.target.value) || 0 }
                        : x
                    )
                  )
                }
                className={`${inputCls} w-16`}
                placeholder="W"
              />
              <input
                type="number"
                value={c.qty}
                onChange={(e) =>
                  setCuts(
                    cuts.map((x) =>
                      x.id === c.id
                        ? { ...x, qty: parseInt(e.target.value) || 1 }
                        : x
                    )
                  )
                }
                className={`${inputCls} w-14`}
                placeholder="Qty"
              />
              {showAdv && (
                <select
                  value={c.mat}
                  onChange={(e) =>
                    setCuts(
                      cuts.map((x) =>
                        x.id === c.id ? { ...x, mat: e.target.value } : x
                      )
                    )
                  }
                  className={`${inputCls} w-28`}
                >
                  <option value="">Any</option>
                  {MATERIALS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              )}
              <span className="text-xs text-stone-500 w-16">
                {c.l * c.w * c.qty} in²
              </span>
              <button
                onClick={() => setCuts(cuts.filter((x) => x.id !== c.id))}
                className="text-stone-500 hover:text-red-400 text-lg"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Optimize Button */}
      <div className="text-center">
        <button
          onClick={() => setResult(optimizeCuts(stocks, cuts, kerf))}
          className="px-6 py-2 bg-amber-600 hover:bg-amber-500 text-stone-900 font-semibold rounded-lg"
        >
          Optimize Layout
        </button>
      </div>

      {/* Results */}
      {result && stats && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <StatCard label="Sheets" value={stats.sheets} />
            <StatCard label="Used" value={`${(stats.used / 144).toFixed(1)} sqft`} />
            <StatCard
              label="Waste"
              value={`${stats.waste}%`}
              warn={parseFloat(stats.waste) > 30}
            />
            <StatCard label="Unplaced" value={stats.unplaced} warn={stats.unplaced > 0} />
          </div>

          {result.sheets.map((sheet, i) => (
            <div key={i} className="bg-stone-800 rounded-lg p-4">
              <div className="flex justify-between mb-2">
                <span className="font-medium">Sheet {i + 1}</span>
                <span className="text-xs text-stone-500">
                  {sheet.name} - {sheet.w}×{sheet.l}&quot;
                </span>
              </div>
              <div
                className="relative bg-amber-900/20 rounded"
                style={{ paddingBottom: `${(sheet.l / sheet.w) * 100}%` }}
              >
                <svg
                  viewBox={`0 0 ${sheet.w} ${sheet.l}`}
                  className="absolute inset-0 w-full h-full"
                >
                  <rect
                    width={sheet.w}
                    height={sheet.l}
                    fill="none"
                    stroke="#78350f"
                    strokeWidth="0.3"
                  />
                  {sheet.cuts.map((c, j) => {
                    const col = CUT_COLORS[j % CUT_COLORS.length];
                    return (
                      <g key={j}>
                        <rect
                          x={c.x}
                          y={c.y}
                          width={c.pw}
                          height={c.ph}
                          fill={col}
                          fillOpacity="0.3"
                          stroke={col}
                          strokeWidth="0.3"
                        />
                        <text
                          x={c.x + c.pw / 2}
                          y={c.y + c.ph / 2}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="white"
                          fontSize={Math.min(c.pw, c.ph) / 4}
                        >
                          {c.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {sheet.cuts.map((c, j) => (
                  <span
                    key={j}
                    className="text-xs bg-stone-700 px-2 py-0.5 rounded"
                  >
                    {c.label}: {c.pw}×{c.ph}&quot;{' '}
                    {c.rot && <span className="text-amber-400">(R)</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}

          {result.unplaced.length > 0 && (
            <div className="bg-red-900/30 border border-red-700 rounded-lg p-3">
              <p className="text-red-400 text-sm">
                {result.unplaced.length} parts couldn&apos;t fit. Add larger stock or
                split parts.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
