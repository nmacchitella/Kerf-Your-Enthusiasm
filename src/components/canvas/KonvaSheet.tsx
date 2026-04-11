'use client';

import React, { useRef, useState, useCallback } from 'react';
import { Stage, Layer, Rect, Text, Group, Line } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import type { PlacedCut, Sheet, ManualOverrides, PartInstanceKey } from '@/types';
import { snapToGrid } from '@/lib/layout-utils';

// Single colour for all parts — blueprint style
const PART_FILL = '#bfdbfe';   // blue-200
const PART_STROKE = '#60a5fa'; // blue-400
const PART_STROKE_SEL = '#1d4ed8'; // blue-700
const PART_TEXT = '#1e3a8a';   // blue-900

interface KonvaSheetProps {
  sheet: Sheet;
  sheetIndex: number;
  mergedCuts: PlacedCut[];
  overrides: ManualOverrides;
  selectedKeys: Set<PartInstanceKey>;
  conflictKeys: Set<PartInstanceKey>;
  gridSize: number;
  showLabels: boolean;
  scale: number;
  onPartDrop: (key: PartInstanceKey, x: number, y: number, sheetIndex: number, clientX: number, clientY: number) => void;
  onPartSelect: (key: PartInstanceKey, additive: boolean) => void;
  onPartInfo?: (key: PartInstanceKey, clientX: number, clientY: number) => void;
  onRubberBandSelect: (keys: PartInstanceKey[]) => void;
  onContextMenu: (key: PartInstanceKey | null, clientX: number, clientY: number) => void;
  onStageClick: () => void;
  onPartDragStart?: (key: PartInstanceKey) => void;
  onPartDragEnd?: () => void;
}

const MIN_LABEL_PX = 12;

export default function KonvaSheet({
  sheet,
  sheetIndex,
  mergedCuts,
  overrides,
  selectedKeys,
  conflictKeys,
  gridSize,
  showLabels,
  scale,
  onPartDrop,
  onPartSelect,
  onPartInfo,
  onRubberBandSelect,
  onContextMenu,
  onStageClick,
  onPartDragStart,
  onPartDragEnd,
}: KonvaSheetProps) {
  const stageWidth = sheet.w * scale;
  const stageHeight = sheet.l * scale;

  const [rubberBand, setRubberBand] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const rubberStart = useRef<{ x: number; y: number } | null>(null);
  const isDraggingPart = useRef(false);

  const onStageMouseDown = useCallback((e: KonvaEventObject<MouseEvent>) => {
    if (e.target !== e.currentTarget) return;
    const pos = e.target.getStage()!.getPointerPosition()!;
    rubberStart.current = { x: pos.x, y: pos.y };
    setRubberBand({ x: pos.x, y: pos.y, w: 0, h: 0 });
  }, []);

  const onStageMouseMove = useCallback((e: KonvaEventObject<MouseEvent>) => {
    if (!rubberStart.current) return;
    const pos = e.target.getStage()!.getPointerPosition()!;
    const x = Math.min(rubberStart.current.x, pos.x);
    const y = Math.min(rubberStart.current.y, pos.y);
    const w = Math.abs(pos.x - rubberStart.current.x);
    const h = Math.abs(pos.y - rubberStart.current.y);
    setRubberBand({ x, y, w, h });
  }, []);

  const onStageMouseUp = useCallback(() => {
    if (rubberStart.current && rubberBand && (rubberBand.w > 4 || rubberBand.h > 4)) {
      const rbX = rubberBand.x / scale;
      const rbY = rubberBand.y / scale;
      const rbW = rubberBand.w / scale;
      const rbH = rubberBand.h / scale;
      const selected = mergedCuts
        .filter(c =>
          c.x < rbX + rbW && c.x + c.pw > rbX &&
          c.y < rbY + rbH && c.y + c.ph > rbY
        )
        .map(c => c.instanceKey);
      if (selected.length > 0) onRubberBandSelect(selected);
      else onStageClick();
    } else if (rubberBand && rubberBand.w <= 4 && rubberBand.h <= 4) {
      onStageClick();
    }
    rubberStart.current = null;
    setRubberBand(null);
  }, [rubberBand, mergedCuts, scale, onRubberBandSelect, onStageClick]);

  return (
    <Stage
      width={stageWidth}
      height={stageHeight}
      onMouseDown={onStageMouseDown}
      onMouseMove={onStageMouseMove}
      onMouseUp={onStageMouseUp}
    >
      {/* Background + grid */}
      <Layer>
        <Rect x={0} y={0} width={stageWidth} height={stageHeight} fill="#f1f5f9" />

        {gridSize > 0 && (() => {
          const lines: React.ReactElement[] = [];
          for (let x = gridSize; x < sheet.w; x += gridSize) {
            lines.push(
              <Line key={`gx-${x}`} points={[x * scale, 0, x * scale, stageHeight]}
                stroke="#cbd5e1" strokeWidth={0.5} listening={false} />
            );
          }
          for (let y = gridSize; y < sheet.l; y += gridSize) {
            lines.push(
              <Line key={`gy-${y}`} points={[0, y * scale, stageWidth, y * scale]}
                stroke="#cbd5e1" strokeWidth={0.5} listening={false} />
            );
          }
          return lines;
        })()}

        <Rect x={0} y={0} width={stageWidth} height={stageHeight}
          stroke="#94a3b8" strokeWidth={1} fill="transparent" listening={false} />
      </Layer>

      {/* Parts */}
      <Layer>
        {mergedCuts.map((cut) => {
          const isSelected = selectedKeys.has(cut.instanceKey);
          const isConflict = conflictKeys.has(cut.instanceKey);
          const isPinned = overrides[cut.instanceKey]?.pinned ?? false;

          const px = cut.x * scale;
          const py = cut.y * scale;
          const pw = cut.pw * scale;
          const ph = cut.ph * scale;
          const minSide = Math.min(pw, ph);

          return (
            <Group
              key={cut.instanceKey}
              x={px} y={py}
              draggable
              onDragStart={() => {
                isDraggingPart.current = true;
                onPartDragStart?.(cut.instanceKey);
              }}
              onDragEnd={(e) => {
                isDraggingPart.current = false;
                onPartDragEnd?.();
                const newX = snapToGrid(e.target.x() / scale, gridSize);
                const newY = snapToGrid(e.target.y() / scale, gridSize);
                e.target.x(newX * scale);
                e.target.y(newY * scale);
                onPartDrop(cut.instanceKey, newX, newY, sheetIndex, e.evt.clientX, e.evt.clientY);
              }}
              onClick={(e) => {
                e.cancelBubble = true;
                onPartSelect(cut.instanceKey, e.evt.shiftKey);
                onPartInfo?.(cut.instanceKey, e.evt.clientX, e.evt.clientY);
              }}
              onContextMenu={(e) => {
                e.evt.preventDefault();
                e.cancelBubble = true;
                onContextMenu(cut.instanceKey, e.evt.clientX, e.evt.clientY);
              }}
            >
              {/* Fill */}
              <Rect
                x={0} y={0} width={pw} height={ph}
                fill={PART_FILL}
                fillOpacity={isSelected ? 1 : 0.8}
                stroke={isConflict ? '#ef4444' : isSelected ? PART_STROKE_SEL : PART_STROKE}
                strokeWidth={isSelected ? 2 : 1.5}
                cornerRadius={2}
              />

              {/* Label + dimensions — stacked in centre, no overlap */}
              {showLabels && minSide > MIN_LABEL_PX && (() => {
                const showDim = minSide > 40 && pw > 40 && ph > 40;
                const nameFontSize = Math.max(Math.min(minSide / 5, 13), 8);
                const dimFontSize  = Math.max(Math.min(minSide / 7, 10), 7);
                // When both lines are shown, split vertically so neither overlaps
                const halfH = ph / 2;
                return (
                  <>
                    <Text
                      x={4}
                      y={showDim ? 4 : 4}
                      width={pw - 8}
                      height={showDim ? halfH - 4 : ph - 8}
                      text={cut.label}
                      fontSize={nameFontSize}
                      fontFamily="system-ui, sans-serif"
                      fontStyle="600"
                      fill={PART_TEXT}
                      align="center"
                      verticalAlign={showDim ? 'bottom' : 'middle'}
                      listening={false}
                      wrap="none"
                      ellipsis
                    />
                    {showDim && (
                      <Text
                        x={4}
                        y={halfH + 2}
                        width={pw - 8}
                        height={halfH - 6}
                        text={`${cut.pw}" × ${cut.ph}"`}
                        fontSize={dimFontSize}
                        fontFamily="system-ui, sans-serif"
                        fill={`${PART_TEXT}99`}
                        align="center"
                        verticalAlign="top"
                        listening={false}
                        wrap="none"
                        ellipsis
                      />
                    )}
                  </>
                );
              })()}

              {/* Pin indicator */}
              {isPinned && minSide > MIN_LABEL_PX && (
                <Text
                  x={pw - 14} y={2}
                  text="⊕"
                  fontSize={10}
                  fill={PART_STROKE_SEL}
                  listening={false}
                />
              )}

              {/* Conflict overlay */}
              {isConflict && (
                <Rect
                  x={0} y={0} width={pw} height={ph}
                  stroke="#ef4444" strokeWidth={2}
                  fill="transparent" dash={[4, 3]}
                  listening={false}
                />
              )}
            </Group>
          );
        })}

        {/* Rubber band */}
        {rubberBand && rubberBand.w > 2 && rubberBand.h > 2 && (
          <Rect
            x={rubberBand.x} y={rubberBand.y}
            width={rubberBand.w} height={rubberBand.h}
            fill="rgba(99,102,241,0.08)"
            stroke="#6366f1" strokeWidth={1} dash={[4, 3]}
            listening={false}
          />
        )}
      </Layer>
    </Stage>
  );
}
