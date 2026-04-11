'use client';

import { useMemo, useRef, useState, useCallback } from 'react';

interface EdgeLine {
  type: 'line';
  start: [number, number];
  end: [number, number];
  layer?: string;
}

interface EdgeArc {
  type: 'arc';
  center: [number, number];
  radius: number;
  start_angle: number;
  end_angle: number;
  is_full_circle?: boolean;
  start: [number, number];
  end: [number, number];
  layer?: string;
}

interface EdgePolyline {
  type: 'polyline';
  points: [number, number][];
  layer?: string;
}

type Edge = EdgeLine | EdgeArc | EdgePolyline;

export interface SheetPreviewData {
  sheet_width_mm: number;
  sheet_length_mm: number;
  edges: Edge[];
}

function layerColor(layer?: string): string {
  if (layer === 'SHEET_BOUNDARY') return '#94a3b8';
  if (!layer || layer === 'PROFILE') return '#334155';
  if (layer === 'HOLES') return '#dc2626';
  if (layer.startsWith('DEPTH_')) return '#2563eb';
  return '#94a3b8';
}

function layerWidth(layer?: string): string {
  if (layer === 'SHEET_BOUNDARY') return '1.5';
  return '0.5';
}

export function SheetDxfPreview({ data }: { data: SheetPreviewData }) {
  const { viewBox, paths } = useMemo(() => {
    const { edges, sheet_width_mm: sw, sheet_length_mm: sl } = data;
    if (!edges.length) return { viewBox: `0 0 ${sw} ${sl}`, paths: [] };

    const pad = Math.max(sw, sl) * 0.03;
    const vbX = -pad, vbY = -pad;
    const vbW = sw + pad * 2, vbH = sl + pad * 2;
    const flip = (y: number) => sl - y;
    const result: { d: string; color: string; strokeWidth: string; key: number }[] = [];

    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const color = layerColor(e.layer);
      const sw = layerWidth(e.layer);
      if (e.type === 'line') {
        result.push({ d: `M ${e.start[0]} ${flip(e.start[1])} L ${e.end[0]} ${flip(e.end[1])}`, color, strokeWidth: sw, key: i });
      } else if (e.type === 'arc') {
        if (e.is_full_circle) {
          result.push({ d: `M ${e.center[0] - e.radius} ${flip(e.center[1])} A ${e.radius} ${e.radius} 0 1 0 ${e.center[0] + e.radius} ${flip(e.center[1])} A ${e.radius} ${e.radius} 0 1 0 ${e.center[0] - e.radius} ${flip(e.center[1])}`, color, strokeWidth: sw, key: i });
        } else {
          const cx = e.center[0], cy = flip(e.center[1]), r = e.radius;
          const startRad = (e.start_angle * Math.PI) / 180, endRad = (e.end_angle * Math.PI) / 180;
          const sx = cx + r * Math.cos(startRad), sy = cy - r * Math.sin(startRad);
          const ex = cx + r * Math.cos(endRad), ey = cy - r * Math.sin(endRad);
          let sweep = e.end_angle - e.start_angle; if (sweep <= 0) sweep += 360;
          result.push({ d: `M ${sx} ${sy} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 0 ${ex} ${ey}`, color, strokeWidth: sw, key: i });
        }
      } else if (e.type === 'polyline') {
        const pts = e.points; if (pts.length < 2) continue;
        result.push({ d: pts.map(([x, y], idx) => `${idx === 0 ? 'M' : 'L'} ${x} ${flip(y)}`).join(' '), color, strokeWidth: sw, key: i });
      }
    }
    return { viewBox: `${vbX} ${vbY} ${vbW} ${vbH}`, paths: result };
  }, [data]);

  // Pan / zoom
  const [xform, setXform] = useState({ scale: 1, tx: 0, ty: 0 });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
    setXform((prev) => {
      const newScale = Math.max(0.1, Math.min(80, prev.scale * factor));
      const ratio = newScale / prev.scale;
      return { scale: newScale, tx: mx - ratio * (mx - prev.tx), ty: my - ratio * (my - prev.ty) };
    });
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setXform((prev) => ({ ...prev, tx: prev.tx + dx, ty: prev.ty + dy }));
  }, []);

  const onPointerUp = useCallback(() => { dragging.current = false; }, []);

  const isTransformed = xform.scale !== 1 || xform.tx !== 0 || xform.ty !== 0;

  return (
    <div
      className="w-full h-full relative overflow-hidden cursor-grab active:cursor-grabbing select-none bg-slate-50"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
    >
      <div
        style={{
          transform: `translate(${xform.tx}px, ${xform.ty}px) scale(${xform.scale})`,
          transformOrigin: '0 0',
          width: '100%',
          height: '100%',
        }}
      >
        <svg
          viewBox={viewBox}
          className="w-full h-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {paths.map(({ d, color, strokeWidth, key }) => (
            <path key={key} d={d} stroke={color} strokeWidth={strokeWidth} fill="none" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      </div>

      {/* Controls */}
      <div className="absolute bottom-2 right-2 flex items-center gap-2">
        {isTransformed && (
          <button
            className="text-xs text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded px-2 py-1 shadow-sm"
            onClick={(e) => { e.stopPropagation(); setXform({ scale: 1, tx: 0, ty: 0 }); }}
          >
            Reset
          </button>
        )}
        <span className="text-xs text-slate-400 bg-white/80 rounded px-1.5 py-0.5">
          {Math.round(xform.scale * 100)}%
        </span>
      </div>

      {/* Legend */}
      <div className="absolute top-2 left-2 bg-white/90 border border-slate-200 rounded px-2 py-1.5 text-xs space-y-0.5">
        <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-slate-400 inline-block" /> Sheet</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-slate-700 inline-block" /> Profile</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-red-600 inline-block" /> Holes</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-blue-600 inline-block" /> Depth</div>
      </div>

      {/* Hint */}
      <div className="absolute bottom-2 left-2 text-xs text-slate-400 bg-white/70 rounded px-1.5 py-0.5 pointer-events-none">
        Scroll: zoom · Drag: pan
      </div>
    </div>
  );
}
