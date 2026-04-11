'use client';

import dynamic from 'next/dynamic';
import type { PlacedCut, Sheet, ManualOverrides, PartInstanceKey } from '@/types';

// Must be a dynamic import with ssr:false — Konva accesses window at module load time.
const KonvaSheet = dynamic(() => import('./KonvaSheet'), { ssr: false });

interface SheetCanvasProps {
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

export default function SheetCanvas(props: SheetCanvasProps) {
  return <KonvaSheet {...props} />;
}
