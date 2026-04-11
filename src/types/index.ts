export type UnitSystem = 'in' | 'mm';

// Stock sheet for cut optimization
export interface Stock {
  id: number;
  name: string;
  l: number;  // length in project units
  w: number;  // width in project units
  t: number;  // thickness in project units (0 = unspecified)
  qty: number; // quantity available
  mat: string;
}

// Part/cut to be made
export interface Cut {
  id: number;
  label: string;
  l: number;  // length in project units
  w: number;  // width in project units
  t: number;  // thickness in project units (0 = unspecified)
  qty: number;
  mat: string;
  group?: string;  // UI grouping label (no structural effect)
  stepSessionId?: string;
  stepBodyIndex?: number;
  stepFaceIndex?: number;
}

// Placed cut with position info
export interface PlacedCut extends Cut {
  x: number;
  y: number;
  pw: number;  // placed width
  ph: number;  // placed height
  rot: boolean;
  instanceKey: PartInstanceKey;  // stable unique key across qty expansion
}

// Stable unique key for an expanded cut instance: `${dbId}-${instanceIndex}`
export type PartInstanceKey = string;

// Per-part manual override (all fields optional — can override position, rotation, or sheet independently)
export interface ManualOverride {
  x?: number;
  y?: number;
  rot?: boolean;
  sheetIndex?: number;  // which sheet the part is assigned to
  pinned: boolean;      // true = position is locked during re-optimize
}

// The full override map stored in state and localStorage
export type ManualOverrides = Record<PartInstanceKey, ManualOverride>;

// A pinned placement passed INTO the optimizer
export interface PinnedPlacement {
  key: PartInstanceKey;
  cut: Cut;
  x: number;
  y: number;
  pw: number;
  ph: number;
  rot: boolean;
  sheetIndex: number;
}

// A sheet-assigned (but not position-pinned) placement
export interface SheetAssignment {
  key: PartInstanceKey;
  cut: Cut;
  sheetIndex: number;
}

// Available rectangle for placement
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Single sheet result
export interface Sheet {
  w: number;
  l: number;
  name: string;
  mat: string;
  cuts: PlacedCut[];
  rects: Rect[];
}

// Full optimization result
export interface OptimizationResult {
  sheets: Sheet[];
  unplaced: Cut[];
}

// Optimization stats
export interface OptimizationStats {
  sheets: number;
  used: number;
  total: number;
  waste: string;
  unplaced: number;
}

// Tool inventory item
export interface Tool {
  id: number;
  name: string;
  brand: string;
  model: string;
  cond: 'excellent' | 'good' | 'fair' | 'poor';
  notes: string;
}

// Stock preset
export interface StockPreset {
  name: string;
  length: number;
  width: number;
  thickness?: number;
}

// Fraction calculator state
export interface FractionState {
  w1: number;
  n1: number;
  d1: number;
  op: '+' | '-' | '×' | '÷';
  w2: number;
  n2: number;
  d2: number;
}

// Board feet calculator state
export interface BoardFeetState {
  t: number;  // thickness
  w: number;  // width
  l: number;  // length in feet
  p: number;  // price per board foot
}

// Angle calculator state
export interface AngleState {
  rise: number;
  run: number;
}

// Shelf spacing state
export interface ShelfState {
  h: number;  // total height
  n: number;  // number of shelves
  t: number;  // shelf thickness
}

// Taper jig state
export interface TaperState {
  top: number;
  bot: number;
  len: number;
}
