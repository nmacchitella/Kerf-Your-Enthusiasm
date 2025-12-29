'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useSession } from '@/lib/auth-client';
import { Stock, Cut, OptimizationResult } from '@/types';
import { optimizeCutsBest, calculateStats } from '@/lib/cut-optimizer';
import { STOCK_PRESETS, MATERIALS, KERF_PRESETS, CUT_COLORS } from '@/lib/constants';
import { jsPDF } from 'jspdf';

export default function CutListPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [saving, setSaving] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [stocks, setStocks] = useLocalStorage<Stock[]>('kerf-your-enthusiasm-stocks', [
    { id: 1, name: '4×8 Plywood', l: 96, w: 48, qty: 1, mat: 'Plywood' },
  ]);
  const [cuts, setCuts] = useLocalStorage<Cut[]>('kerf-your-enthusiasm-cuts', [
    { id: 1, label: 'Shelf', l: 24, w: 12, qty: 4, mat: '' },
    { id: 2, label: 'Side', l: 36, w: 18, qty: 2, mat: '' },
    { id: 3, label: 'Top', l: 48, w: 24, qty: 1, mat: '' },
  ]);
  const [kerf, setKerf] = useState(0.125);
  const [showAdv, setShowAdv] = useState(false);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [hoveredPart, setHoveredPart] = useState<{ sheetIndex: number; cutIndex: number } | null>(null);

  const addStock = (preset?: { name: string; length: number; width: number }) => {
    const s = preset || { name: 'Custom', length: 96, width: 48 };
    setStocks([
      ...stocks,
      { id: Date.now(), name: s.name, l: s.length, w: s.width, qty: 1, mat: 'Plywood' },
    ]);
  };

  const stats = useMemo(() => {
    if (!result) return null;
    return calculateStats(result);
  }, [result]);

  const handleSaveAsProject = async () => {
    if (!session) {
      router.push('/login?callbackUrl=/cut-list');
      return;
    }
    setShowSaveModal(true);
  };

  const saveProject = async () => {
    if (!projectName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/v1/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: projectName,
          kerf,
          stocks: stocks.map(s => ({ name: s.name, l: s.l, w: s.w, qty: s.qty, mat: s.mat })),
          cuts: cuts.map(c => ({ label: c.label, l: c.l, w: c.w, qty: c.qty, mat: c.mat })),
        }),
      });
      if (res.ok) {
        const project = await res.json();
        router.push(`/projects/${project.id}`);
      }
    } catch (error) {
      console.error('Failed to save project:', error);
    } finally {
      setSaving(false);
      setShowSaveModal(false);
      setProjectName('');
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
      rows.push('');
      rows.push('UNPLACED PARTS');
      result.unplaced.forEach((c) => {
        rows.push(['N/A', c.label, c.l, c.w, '', '', ''].join(','));
      });
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cut-list.csv';
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
        svgContent += `<text x="${x + w/2}" y="${y + h/2 - 6}" text-anchor="middle" fill="white" font-size="${Math.min(w, h) / 6}">${c.label}</text>`;
        svgContent += `<text x="${x + w/2}" y="${y + h/2 + 10}" text-anchor="middle" fill="#64748b" font-size="${Math.min(w, h) / 8}">${c.pw}" × ${c.ph}"${c.rot ? ' (R)' : ''}</text>`;
      });

      yOffset += sheet.l * scale + sheetGap;
    });

    svgContent += '</svg>';

    const blob = new Blob([svgContent], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cut-layout.svg';
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

    // Calculate global scale for proportional diagrams
    const largestDim = Math.max(...result.sheets.map(s => Math.max(s.l, s.w)));
    const maxDiagramWidth = contentWidth;
    const globalScale = Math.min(maxDiagramWidth / largestDim, 3); // Cap scale for very small sheets

    // Title
    pdf.setFontSize(18);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Cut List', margin, y);
    y += 10;

    // Stats
    if (stats) {
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(100);
      y += 15;
      pdf.text(`${stats.sheets} sheet${stats.sheets !== 1 ? 's' : ''} · ${stats.waste}% waste${stats.unplaced > 0 ? ` · ${stats.unplaced} unplaced` : ''}`, margin, y);
      pdf.setTextColor(0);
    }
    y += 30;

    // Each sheet: diagram + table together
    result.sheets.forEach((sheet, i) => {
      // Calculate this sheet's diagram size using global scale
      const diagramWidth = sheet.w * globalScale;
      const diagramHeight = sheet.l * globalScale;

      // Estimate space needed for table
      const sortedCuts = [...sheet.cuts].sort((a, b) => (b.pw * b.ph) - (a.pw * a.ph));
      const tableHeight = 30 + sortedCuts.length * 14; // header + rows

      // Total height needed for this sheet section
      const sectionHeight = Math.max(diagramHeight + 25, tableHeight + 25);

      // Check if we need a new page
      if (y + sectionHeight > pageHeight - margin) {
        pdf.addPage();
        y = margin;
      }

      // Sheet header
      pdf.setFontSize(12);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(0);
      pdf.text(`Sheet ${i + 1}: ${sheet.name} (${sheet.w}" × ${sheet.l}")`, margin, y);
      y += 18;

      const sectionStartY = y;

      // Draw diagram on the left
      pdf.setDrawColor(148, 163, 184);
      pdf.setFillColor(241, 245, 249);
      pdf.rect(margin, y, diagramWidth, diagramHeight, 'FD');

      // Draw cuts on diagram
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

        // Label on diagram
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

      // Draw table on the right (or below if diagram is too wide)
      const tableX = diagramWidth < contentWidth * 0.55 ? margin + diagramWidth + 15 : margin;
      const tableStartY = diagramWidth < contentWidth * 0.55 ? sectionStartY : sectionStartY + diagramHeight + 15;
      const tableWidth = diagramWidth < contentWidth * 0.55 ? contentWidth - diagramWidth - 15 : contentWidth;

      let tableY = tableStartY;

      // Table header
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

      // Table rows
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

      // Update y to the bottom of this section
      y = Math.max(sectionStartY + diagramHeight, tableY) + 25;
    });

    // Unplaced parts
    if (result.unplaced.length > 0) {
      if (y > pageHeight - 80) {
        pdf.addPage();
        y = margin;
      }
      pdf.setFontSize(11);
      pdf.setFont('helvetica', 'bold');
      pdf.setTextColor(180, 0, 0);
      pdf.text(`Unplaced Parts (${result.unplaced.length})`, margin, y);
      y += 18;

      // Unplaced table
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

    pdf.save('cut-list.pdf');
  };

  return (
    <>
      {/* Save as Project Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-sm mx-4 shadow-xl w-full">
            <h3 className="text-lg font-medium text-slate-800 mb-4">Save as Project</h3>
            <input
              type="text"
              placeholder="Project name..."
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 mb-4"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && saveProject()}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowSaveModal(false); setProjectName(''); }}
                className="px-3 py-1.5 text-slate-600 hover:text-slate-800 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={saveProject}
                disabled={saving || !projectName.trim()}
                className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded text-sm font-medium disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

    <div className="pt-6 flex flex-col lg:flex-row gap-8 min-h-[calc(100vh-6rem)]">
      {/* LEFT PANEL - Inputs */}
      <div className="w-full lg:w-[420px] flex-shrink-0 space-y-6 lg:overflow-y-auto lg:max-h-[calc(100vh-6rem)] text-sm">

        {/* Settings Section */}
        <div className="bg-white rounded-md p-4 shadow-sm border border-slate-200 space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-slate-500 text-xs font-medium uppercase tracking-wide">Settings</h2>
            <button
              onClick={handleSaveAsProject}
              className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              {session ? 'Save as Project' : 'Sign in to Save'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-slate-500 block mb-1">Blade Kerf</label>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.0625"
                  value={kerf}
                  onChange={(e) => setKerf(parseFloat(e.target.value) || 0)}
                  className="bg-slate-50 border border-slate-200 rounded px-2 py-1.5 w-16 focus:border-slate-400 outline-none text-slate-800"
                />
                <span className="text-slate-400 text-[10px]">in</span>
              </div>
            </div>
            <div>
              <label className="text-slate-500 block mb-1">Presets</label>
              <div className="flex gap-1">
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
            <h2 className="text-slate-500 text-xs font-medium uppercase tracking-wide">Add Stock</h2>
            <div className="flex gap-1">
              <select
                onChange={(e) => { if (e.target.value) { const p = STOCK_PRESETS.find((x) => x.name === e.target.value); if (p) addStock(p); e.target.value = ''; }}}
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
            <thead><tr className="text-slate-400">
              <th className="text-left font-normal pb-1">Name</th>
              <th className="text-right font-normal pb-1 w-12">L</th>
              <th className="text-right font-normal pb-1 w-12">W</th>
              <th className="text-right font-normal pb-1 w-8">Qty</th>
              {showAdv && <th className="text-left font-normal pb-1 pl-1 w-16">Mat</th>}
              <th className="w-4"></th>
            </tr></thead>
            <tbody>
              {stocks.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="py-0.5"><input value={s.name} onChange={(e) => setStocks(stocks.map((x) => x.id === s.id ? { ...x, name: e.target.value } : x))} className="bg-transparent w-full outline-none text-slate-700" /></td>
                  <td className="py-0.5"><input type="number" value={s.l} onChange={(e) => setStocks(stocks.map((x) => x.id === s.id ? { ...x, l: parseFloat(e.target.value) || 0 } : x))} className="bg-transparent w-full text-right outline-none text-slate-700" /></td>
                  <td className="py-0.5"><input type="number" value={s.w} onChange={(e) => setStocks(stocks.map((x) => x.id === s.id ? { ...x, w: parseFloat(e.target.value) || 0 } : x))} className="bg-transparent w-full text-right outline-none text-slate-700" /></td>
                  <td className="py-0.5"><input type="number" value={s.qty ?? 1} onChange={(e) => setStocks(stocks.map((x) => x.id === s.id ? { ...x, qty: parseInt(e.target.value) || 1 } : x))} className="bg-transparent w-full text-right outline-none text-slate-700" min={1} /></td>
                  {showAdv && <td className="py-0.5 pl-1"><select value={s.mat} onChange={(e) => setStocks(stocks.map((x) => x.id === s.id ? { ...x, mat: e.target.value } : x))} className="bg-transparent outline-none text-slate-700">{MATERIALS.map((m) => <option key={m}>{m}</option>)}</select></td>}
                  <td className="py-0.5 text-right"><button onClick={() => stocks.length > 1 && setStocks(stocks.filter((x) => x.id !== s.id))} className="text-slate-300 hover:text-red-500">×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Parts */}
        <div className="bg-white rounded-md p-4 shadow-sm border border-slate-200 space-y-2">
          <div className="flex justify-between items-center">
            <h2 className="text-slate-500 text-xs font-medium uppercase tracking-wide">Add Parts</h2>
            <button onClick={() => setCuts([...cuts, { id: Date.now(), label: `Part ${cuts.length + 1}`, l: 12, w: 12, qty: 1, mat: '' }])} className="text-xs text-slate-500 hover:text-slate-700">+add</button>
          </div>
          <table className="w-full text-xs">
            <thead><tr className="text-slate-400">
              <th className="text-left font-normal pb-1">Label</th>
              <th className="text-right font-normal pb-1 w-12">L</th>
              <th className="text-right font-normal pb-1 w-12">W</th>
              <th className="text-right font-normal pb-1 w-8">Qty</th>
              {showAdv && <th className="text-left font-normal pb-1 pl-1 w-16">Mat</th>}
              <th className="w-4"></th>
            </tr></thead>
            <tbody>
              {cuts.map((c) => (
                <tr key={c.id} className="border-t border-slate-100">
                  <td className="py-0.5"><input value={c.label} onChange={(e) => setCuts(cuts.map((x) => x.id === c.id ? { ...x, label: e.target.value } : x))} className="bg-transparent w-full outline-none text-slate-700" /></td>
                  <td className="py-0.5"><input type="number" value={c.l} onChange={(e) => setCuts(cuts.map((x) => x.id === c.id ? { ...x, l: parseFloat(e.target.value) || 0 } : x))} className="bg-transparent w-full text-right outline-none text-slate-700" /></td>
                  <td className="py-0.5"><input type="number" value={c.w} onChange={(e) => setCuts(cuts.map((x) => x.id === c.id ? { ...x, w: parseFloat(e.target.value) || 0 } : x))} className="bg-transparent w-full text-right outline-none text-slate-700" /></td>
                  <td className="py-0.5"><input type="number" value={c.qty} onChange={(e) => setCuts(cuts.map((x) => x.id === c.id ? { ...x, qty: parseInt(e.target.value) || 1 } : x))} className="bg-transparent w-full text-right outline-none text-slate-700" /></td>
                  {showAdv && <td className="py-0.5 pl-1"><select value={c.mat} onChange={(e) => setCuts(cuts.map((x) => x.id === c.id ? { ...x, mat: e.target.value } : x))} className="bg-transparent outline-none text-slate-700"><option value="">Any</option>{MATERIALS.map((m) => <option key={m}>{m}</option>)}</select></td>}
                  <td className="py-0.5 text-right"><button onClick={() => setCuts(cuts.filter((x) => x.id !== c.id))} className="text-slate-300 hover:text-red-500">×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Optimize */}
        <div>
          <button
            onClick={() => setResult(optimizeCutsBest(stocks, cuts, kerf))}
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

        {/* Cut List Results */}
        {result && result.sheets.length > 0 && (
          <div className="bg-white rounded-md p-4 shadow-sm border border-slate-200 space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-slate-500 text-xs font-medium uppercase tracking-wide">Cut List</h2>
              <span className="text-slate-400 text-xs">{result.sheets.reduce((acc, s) => acc + s.cuts.length, 0)} cuts</span>
            </div>
            <div className="space-y-2">
              {result.sheets.map((sheet, i) => (
                <div key={i}>
                  <div className="text-xs text-slate-500 mb-0.5">Sheet {i + 1}: {sheet.name}</div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-400">
                        <th className="text-left font-normal pb-0.5 w-6">#</th>
                        <th className="text-left font-normal pb-0.5">Part</th>
                        <th className="text-right font-normal pb-0.5 w-12">L</th>
                        <th className="text-right font-normal pb-0.5 w-12">W</th>
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
                              <td className={`py-0.5 text-right ${isHovered ? 'text-slate-700' : 'text-slate-400'}`}>{l}</td>
                              <td className={`py-0.5 text-right ${isHovered ? 'text-slate-700' : 'text-slate-400'}`}>{w}</td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            {result.unplaced.length > 0 && (
              <div className="mt-2">
                <div className="text-xs text-red-500 mb-0.5">Unplaced ({result.unplaced.length})</div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="text-left font-normal pb-0.5 w-6">#</th>
                      <th className="text-left font-normal pb-0.5">Part</th>
                      <th className="text-right font-normal pb-0.5 w-12">L</th>
                      <th className="text-right font-normal pb-0.5 w-12">W</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.unplaced.map((p, j) => {
                      const l = Math.max(p.l, p.w);
                      const w = Math.min(p.l, p.w);
                      return (
                        <tr key={j} className="border-t border-slate-100">
                          <td className="py-0.5 text-slate-400">{j + 1}</td>
                          <td className="py-0.5 text-red-500">{p.label}</td>
                          <td className="py-0.5 text-right text-slate-400">{l}</td>
                          <td className="py-0.5 text-right text-slate-400">{w}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Export */}
            <div className="flex gap-3 pt-3 mt-3 border-t border-slate-200">
              <button onClick={downloadPDF} className="text-slate-600 hover:text-slate-800 text-xs">↓ PDF</button>
              <button onClick={downloadCutListCSV} className="text-slate-400 hover:text-slate-600 text-xs">↓ CSV</button>
              <button onClick={downloadLayoutSVG} className="text-slate-400 hover:text-slate-600 text-xs">↓ SVG</button>
            </div>
          </div>
        )}
      </div>

      {/* RIGHT PANEL - Visualization */}
      <div className="flex-1 min-w-0">
        {!result ? (
          <div className="h-full min-h-[200px] flex items-center justify-center text-slate-400 text-sm">
            Click Optimize to generate cut layout
          </div>
        ) : result.sheets.length === 0 ? (
          <div className="h-full min-h-[200px] flex items-center justify-center text-red-500 text-sm">
            No sheets generated. Parts may be too large for available stock.
          </div>
        ) : (
          (() => {
            // Calculate global scale based on the largest sheet dimension
            const maxDisplayWidth = 500;
            const largestWidth = Math.max(...result.sheets.map(s => Math.max(s.l, s.w)));
            const globalScale = maxDisplayWidth / largestWidth;

            return (
          <div className="space-y-4">
            {result.sheets.map((sheet, i) => {
              // Always show landscape (long dimension horizontal)
              const isPortrait = sheet.l > sheet.w;
              const vw = isPortrait ? sheet.l : sheet.w;
              const vh = isPortrait ? sheet.w : sheet.l;
              // Use global scale so all sheets are proportional to each other
              const displayWidth = vw * globalScale;
              const displayHeight = vh * globalScale;
              return (
                <div key={i} className="bg-white rounded-md p-3 shadow-sm border border-slate-200 inline-block">
                  <div className="flex justify-between text-xs text-slate-500 mb-2">
                    <span>Sheet {i + 1}</span>
                    <span>{sheet.name} {sheet.w}"×{sheet.l}"</span>
                  </div>
                  <svg
                    viewBox={`0 0 ${vw} ${vh}`}
                    width={displayWidth}
                    height={displayHeight}
                    className="bg-slate-100 border border-slate-200 rounded max-w-full"
                    style={{ height: 'auto' }}
                    onMouseLeave={() => setHoveredPart(null)}
                  >
                    {sheet.cuts.map((c, j) => {
                      const col = CUT_COLORS[j % CUT_COLORS.length];
                      // Transform coordinates if rotated to landscape
                      const cx = isPortrait ? c.y : c.x;
                      const cy = isPortrait ? c.x : c.y;
                      const cw = isPortrait ? c.ph : c.pw;
                      const ch = isPortrait ? c.pw : c.ph;
                      const isHovered = hoveredPart?.sheetIndex === i && hoveredPart?.cutIndex === j;
                      const l = Math.max(c.pw, c.ph);
                      const w = Math.min(c.pw, c.ph);
                      return (
                        <g
                          key={j}
                          onMouseEnter={() => setHoveredPart({ sheetIndex: i, cutIndex: j })}
                          style={{ cursor: 'pointer' }}
                        >
                          <rect
                            x={cx}
                            y={cy}
                            width={cw}
                            height={ch}
                            fill={isHovered ? '#475569' : col}
                            fillOpacity={isHovered ? 0.8 : 0.5}
                            stroke={isHovered ? '#334155' : col}
                            strokeWidth={isHovered ? 1 : 0.5}
                          />
                          {showLabels && (
                            <text x={cx + cw / 2} y={cy + ch / 2 - (isHovered ? 2 : 0)} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={Math.max(Math.min(cw, ch) / 4, 2)} fontWeight="500">
                              {c.label}
                            </text>
                          )}
                          {isHovered && (
                            <text x={cx + cw / 2} y={cy + ch / 2 + Math.max(Math.min(cw, ch) / 4, 2) + 1} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={Math.max(Math.min(cw, ch) / 5, 1.5)} fontWeight="400">
                              {l}" × {w}"
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              );
            })}
            {result.unplaced.length > 0 && (
              <div className="bg-white rounded-md p-3 shadow-sm border border-red-200">
                <div className="text-xs text-red-500 font-medium mb-2">Unplaced Parts ({result.unplaced.length})</div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="text-left font-normal pb-0.5">Part</th>
                      <th className="text-right font-normal pb-0.5 w-16">L</th>
                      <th className="text-right font-normal pb-0.5 w-16">W</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.unplaced.map((p, j) => {
                      const l = Math.max(p.l, p.w);
                      const w = Math.min(p.l, p.w);
                      return (
                        <tr key={j} className="border-t border-slate-100">
                          <td className="py-0.5 text-red-500">{p.label}</td>
                          <td className="py-0.5 text-right text-slate-500">{l}"</td>
                          <td className="py-0.5 text-right text-slate-500">{w}"</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
            );
          })()
        )}
      </div>
    </div>
    </>
  );
}
