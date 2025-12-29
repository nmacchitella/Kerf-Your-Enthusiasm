'use client';

import { useState, useEffect, useMemo, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { optimizeCutsBest } from '@/lib/cut-optimizer';
import { toFraction } from '@/lib/fraction-utils';
import { STOCK_PRESETS, MATERIALS, KERF_PRESETS } from '@/lib/constants';
import type { Stock as StockType, Cut as CutType, OptimizationResult } from '@/types';

interface DBStock {
  id: string;
  name: string;
  length: number;
  width: number;
  quantity: number;
  material: string;
}

interface DBCut {
  id: string;
  label: string;
  length: number;
  width: number;
  quantity: number;
  material: string;
}

interface Project {
  id: string;
  name: string;
  description: string | null;
  kerf: number;
  stocks: DBStock[];
  cuts: DBCut[];
}

// Convert DB format to app format
function toAppStock(s: DBStock, index: number): StockType {
  return { id: index + 1, name: s.name, l: s.length, w: s.width, qty: s.quantity, mat: s.material };
}

function toAppCut(c: DBCut, index: number): CutType {
  return { id: index + 1, label: c.label, l: c.length, w: c.width, qty: c.quantity, mat: c.material };
}

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stocks, setStocks] = useState<StockType[]>([]);
  const [cuts, setCuts] = useState<CutType[]>([]);
  const [kerf, setKerf] = useState(0.125);
  const [showStockForm, setShowStockForm] = useState(false);
  const [showCutForm, setShowCutForm] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // Stock form state
  const [stockName, setStockName] = useState('');
  const [stockL, setStockL] = useState(96);
  const [stockW, setStockW] = useState(48);
  const [stockQty, setStockQty] = useState(1);
  const [stockMat, setStockMat] = useState('Plywood');

  // Cut form state
  const [cutLabel, setCutLabel] = useState('');
  const [cutL, setCutL] = useState(24);
  const [cutW, setCutW] = useState(12);
  const [cutQty, setCutQty] = useState(1);
  const [cutMat, setCutMat] = useState('');

  useEffect(() => {
    fetchProject();
  }, [id]);

  const fetchProject = async () => {
    try {
      const res = await fetch(`/api/v1/projects/${id}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data);
        setStocks(data.stocks.map(toAppStock));
        setCuts(data.cuts.map(toAppCut));
        setKerf(data.kerf);
      } else if (res.status === 404) {
        router.push('/dashboard');
      }
    } catch (error) {
      console.error('Failed to fetch project:', error);
    } finally {
      setLoading(false);
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
          stocks: stocks.map((s) => ({ name: s.name, l: s.l, w: s.w, qty: s.qty, mat: s.mat })),
          cuts: cuts.map((c) => ({ label: c.label, l: c.l, w: c.w, qty: c.qty, mat: c.mat })),
        }),
      });
    } catch (error) {
      console.error('Failed to save project:', error);
    } finally {
      setSaving(false);
    }
  };

  const result: OptimizationResult = useMemo(() => {
    if (stocks.length === 0 || cuts.length === 0) {
      return { sheets: [], unplaced: [] };
    }
    return optimizeCutsBest(stocks, cuts, kerf);
  }, [stocks, cuts, kerf]);

  const addStock = () => {
    const newStock: StockType = {
      id: Date.now(),
      name: stockName || `Sheet ${stocks.length + 1}`,
      l: stockL,
      w: stockW,
      qty: stockQty,
      mat: stockMat,
    };
    setStocks([...stocks, newStock]);
    setShowStockForm(false);
    setStockName('');
  };

  const addCut = () => {
    const newCut: CutType = {
      id: Date.now(),
      label: cutLabel || `Part ${cuts.length + 1}`,
      l: cutL,
      w: cutW,
      qty: cutQty,
      mat: cutMat,
    };
    setCuts([...cuts, newCut]);
    setShowCutForm(false);
    setCutLabel('');
  };

  const removeStock = (stockId: number) => {
    setStocks(stocks.filter((s) => s.id !== stockId));
  };

  const removeCut = (cutId: number) => {
    setCuts(cuts.filter((c) => c.id !== cutId));
  };

  const applyPreset = (preset: (typeof STOCK_PRESETS)[0]) => {
    setStockL(preset.length);
    setStockW(preset.width);
    setStockName(preset.name);
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-1/4"></div>
          <div className="h-64 bg-slate-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!project) {
    return null;
  }

  const inputCls = 'w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500';

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-slate-500 hover:text-slate-700">
            &larr; Back
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">{project.name}</h1>
        </div>
        <button
          onClick={saveProject}
          disabled={saving}
          className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors text-sm font-medium disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Project'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Stocks Section */}
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Stock Sheets</h2>
            <button
              onClick={() => setShowStockForm(!showStockForm)}
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              + Add Stock
            </button>
          </div>

          {showStockForm && (
            <div className="mb-4 p-3 bg-slate-50 rounded-lg space-y-3">
              <div className="flex gap-2 flex-wrap">
                {STOCK_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => applyPreset(preset)}
                    className="text-xs px-2 py-1 bg-slate-200 rounded hover:bg-slate-300"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Name (optional)"
                value={stockName}
                onChange={(e) => setStockName(e.target.value)}
                className={inputCls}
              />
              <div className="grid grid-cols-4 gap-2">
                <input
                  type="number"
                  placeholder="Length"
                  value={stockL}
                  onChange={(e) => setStockL(+e.target.value)}
                  className={inputCls}
                />
                <input
                  type="number"
                  placeholder="Width"
                  value={stockW}
                  onChange={(e) => setStockW(+e.target.value)}
                  className={inputCls}
                />
                <input
                  type="number"
                  placeholder="Qty"
                  value={stockQty}
                  onChange={(e) => setStockQty(+e.target.value)}
                  className={inputCls}
                  min={1}
                />
                <select
                  value={stockMat}
                  onChange={(e) => setStockMat(e.target.value)}
                  className={inputCls}
                >
                  {MATERIALS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={addStock}
                className="w-full py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 text-sm font-medium"
              >
                Add Stock
              </button>
            </div>
          )}

          <div className="space-y-2">
            {stocks.map((stock) => (
              <div
                key={stock.id}
                className="flex items-center justify-between p-2 bg-slate-50 rounded"
              >
                <div>
                  <span className="font-medium">{stock.name}</span>
                  <span className="text-sm text-slate-500 ml-2">
                    {stock.l}&quot; x {stock.w}&quot; ({stock.mat}) x{stock.qty}
                  </span>
                </div>
                <button
                  onClick={() => removeStock(stock.id)}
                  className="text-red-500 hover:text-red-700 text-sm"
                >
                  Remove
                </button>
              </div>
            ))}
            {stocks.length === 0 && (
              <p className="text-slate-500 text-sm text-center py-4">
                No stocks added yet
              </p>
            )}
          </div>
        </div>

        {/* Cuts Section */}
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Parts to Cut</h2>
            <button
              onClick={() => setShowCutForm(!showCutForm)}
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              + Add Part
            </button>
          </div>

          {showCutForm && (
            <div className="mb-4 p-3 bg-slate-50 rounded-lg space-y-3">
              <input
                type="text"
                placeholder="Label (optional)"
                value={cutLabel}
                onChange={(e) => setCutLabel(e.target.value)}
                className={inputCls}
              />
              <div className="grid grid-cols-4 gap-2">
                <input
                  type="number"
                  placeholder="Length"
                  value={cutL}
                  onChange={(e) => setCutL(+e.target.value)}
                  className={inputCls}
                />
                <input
                  type="number"
                  placeholder="Width"
                  value={cutW}
                  onChange={(e) => setCutW(+e.target.value)}
                  className={inputCls}
                />
                <input
                  type="number"
                  placeholder="Qty"
                  value={cutQty}
                  onChange={(e) => setCutQty(+e.target.value)}
                  className={inputCls}
                  min={1}
                />
                <select
                  value={cutMat}
                  onChange={(e) => setCutMat(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Any Material</option>
                  {MATERIALS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={addCut}
                className="w-full py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 text-sm font-medium"
              >
                Add Part
              </button>
            </div>
          )}

          <div className="space-y-2">
            {cuts.map((cut) => (
              <div
                key={cut.id}
                className="flex items-center justify-between p-2 bg-slate-50 rounded"
              >
                <div>
                  <span className="font-medium">{cut.label}</span>
                  <span className="text-sm text-slate-500 ml-2">
                    {cut.l}&quot; x {cut.w}&quot; {cut.mat && `(${cut.mat})`} x{cut.qty}
                  </span>
                </div>
                <button
                  onClick={() => removeCut(cut.id)}
                  className="text-red-500 hover:text-red-700 text-sm"
                >
                  Remove
                </button>
              </div>
            ))}
            {cuts.length === 0 && (
              <p className="text-slate-500 text-sm text-center py-4">
                No parts added yet
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Settings */}
      <div className="mt-6 bg-white rounded-lg border border-slate-200 p-4">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Settings</h2>
        <div className="flex items-center gap-4">
          <label className="text-sm text-slate-600">Blade Kerf:</label>
          <div className="flex gap-2">
            {KERF_PRESETS.map((k) => (
              <button
                key={k.value}
                onClick={() => setKerf(k.value)}
                className={`px-3 py-1 text-sm rounded ${
                  kerf === k.value
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>
          <span className="text-sm text-slate-500">({toFraction(kerf)}&quot;)</span>
        </div>
      </div>

      {/* Results */}
      {stocks.length > 0 && cuts.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowResults(!showResults)}
            className="w-full py-3 bg-slate-800 text-white rounded-lg hover:bg-slate-700 text-sm font-medium"
          >
            {showResults ? 'Hide' : 'Show'} Optimization Results ({result.sheets.length} sheets, {result.unplaced.length} unplaced)
          </button>

          {showResults && result.sheets.length > 0 && (
            <div className="mt-4 space-y-4">
              {result.sheets.map((sheet, idx) => (
                <div key={idx} className="bg-white rounded-lg border border-slate-200 p-4">
                  <h3 className="font-medium text-slate-900 mb-2">
                    Sheet {idx + 1}: {sheet.name} ({sheet.l}&quot; x {sheet.w}&quot;)
                  </h3>
                  <div className="relative bg-slate-100 rounded overflow-hidden" style={{ paddingBottom: `${(sheet.w / sheet.l) * 100}%` }}>
                    <svg
                      viewBox={`0 0 ${sheet.l} ${sheet.w}`}
                      className="absolute inset-0 w-full h-full"
                      preserveAspectRatio="xMinYMin meet"
                    >
                      <rect x={0} y={0} width={sheet.l} height={sheet.w} fill="#f1f5f9" stroke="#cbd5e1" />
                      {sheet.cuts.map((cut, cidx) => (
                        <g key={cidx}>
                          <rect
                            x={cut.x}
                            y={cut.y}
                            width={cut.pw}
                            height={cut.ph}
                            fill="#3b82f6"
                            fillOpacity={0.3}
                            stroke="#2563eb"
                            strokeWidth={0.5}
                          />
                          <text
                            x={cut.x + cut.pw / 2}
                            y={cut.y + cut.ph / 2}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            fontSize={Math.min(cut.pw, cut.ph) * 0.15}
                            fill="#1e40af"
                          >
                            {cut.label}
                          </text>
                        </g>
                      ))}
                    </svg>
                  </div>
                  <p className="text-sm text-slate-500 mt-2">
                    {sheet.cuts.length} cuts placed
                  </p>
                </div>
              ))}

              {result.unplaced.length > 0 && (
                <div className="bg-red-50 rounded-lg border border-red-200 p-4">
                  <h3 className="font-medium text-red-900 mb-2">Unplaced Parts</h3>
                  <ul className="text-sm text-red-700">
                    {result.unplaced.map((cut, idx) => (
                      <li key={idx}>
                        {cut.label}: {cut.l}&quot; x {cut.w}&quot;
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
