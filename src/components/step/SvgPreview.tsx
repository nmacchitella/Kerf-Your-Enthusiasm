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

interface EdgeData {
  edges: Edge[];
}

function layerColor(layer?: string): string {
  if (!layer || layer === 'PROFILE') return '#334155';
  if (layer === 'HOLES') return '#dc2626';
  if (layer.startsWith('DEPTH_')) return '#2563eb';
  return '#94a3b8';
}

export function SvgPreview({ edgeData }: { edgeData: EdgeData }) {
  const { viewBox, paths } = useMemo(() => {
    const { edges } = edgeData;
    if (!edges.length) return { viewBox: '0 0 100 100', paths: [] };

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function expand(x: number, y: number) {
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }

    for (const e of edges) {
      if (e.type === 'line') { expand(e.start[0], e.start[1]); expand(e.end[0], e.end[1]); }
      else if (e.type === 'arc') {
        if (e.is_full_circle) { expand(e.center[0] - e.radius, e.center[1] - e.radius); expand(e.center[0] + e.radius, e.center[1] + e.radius); }
        else { expand(e.start[0], e.start[1]); expand(e.end[0], e.end[1]); expand(e.center[0], e.center[1]); }
      } else if (e.type === 'polyline') { for (const [x, y] of e.points) expand(x, y); }
    }

    const pad = Math.max((maxX - minX), (maxY - minY)) * 0.04 + 1;
    const vbX = minX - pad, vbY = minY - pad;
    const vbW = maxX - minX + pad * 2, vbH = maxY - minY + pad * 2;
    const flip = (y: number) => vbY + vbH - (y - vbY);
    const result: { d: string; color: string; key: number }[] = [];

    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const color = layerColor(e.layer);
      if (e.type === 'line') {
        result.push({ d: `M ${e.start[0]} ${flip(e.start[1])} L ${e.end[0]} ${flip(e.end[1])}`, color, key: i });
      } else if (e.type === 'arc') {
        if (e.is_full_circle) {
          result.push({ d: `M ${e.center[0] - e.radius} ${flip(e.center[1])} A ${e.radius} ${e.radius} 0 1 0 ${e.center[0] + e.radius} ${flip(e.center[1])} A ${e.radius} ${e.radius} 0 1 0 ${e.center[0] - e.radius} ${flip(e.center[1])}`, color, key: i });
        } else {
          const cx = e.center[0], cy = flip(e.center[1]), r = e.radius;
          const startRad = (e.start_angle * Math.PI) / 180, endRad = (e.end_angle * Math.PI) / 180;
          const sx = cx + r * Math.cos(startRad), sy = cy - r * Math.sin(startRad);
          const ex = cx + r * Math.cos(endRad), ey = cy - r * Math.sin(endRad);
          let sweep = e.end_angle - e.start_angle; if (sweep <= 0) sweep += 360;
          result.push({ d: `M ${sx} ${sy} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 0 ${ex} ${ey}`, color, key: i });
        }
      } else if (e.type === 'polyline') {
        const pts = e.points; if (pts.length < 2) continue;
        result.push({ d: pts.map(([x, y], idx) => `${idx === 0 ? 'M' : 'L'} ${x} ${flip(y)}`).join(' '), color, key: i });
      }
    }
    return { viewBox: `${vbX} ${vbY} ${vbW} ${vbH}`, paths: result };
  }, [edgeData]);

  // ── Pan / zoom ─────────────────────────────────────────────────────────────
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
      className="w-full h-full relative overflow-hidden cursor-grab active:cursor-grabbing select-none"
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
          style={{ background: 'transparent' }}
        >
          {paths.map(({ d, color, key }) => (
            <path key={key} d={d} stroke={color} strokeWidth="0.5" fill="none" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      </div>

      {/* Zoom hint / reset */}
      <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1.5 pointer-events-none">
        {isTransformed && (
          <button
            className="pointer-events-auto text-xs text-slate-500 hover:text-slate-800 bg-white/80 border border-slate-200 rounded px-1.5 py-0.5"
            onClick={(e) => { e.stopPropagation(); setXform({ scale: 1, tx: 0, ty: 0 }); }}
          >
            Reset
          </button>
        )}
        <span className="text-xs text-slate-400 bg-white/70 rounded px-1.5 py-0.5">
          {Math.round(xform.scale * 100)}%
        </span>
      </div>
    </div>
  );
}
