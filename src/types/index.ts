// Stock sheet for cut optimization
export interface Stock {
  id: number;
  name: string;
  l: number;  // length in inches
  w: number;  // width in inches
  qty: number; // quantity available
  mat: string;
}

// Part/cut to be made
export interface Cut {
  id: number;
  label: string;
  l: number;  // length in inches
  w: number;  // width in inches
  qty: number;
  mat: string;
}

// Placed cut with position info
export interface PlacedCut extends Cut {
  x: number;
  y: number;
  pw: number;  // placed width
  ph: number;  // placed height
  rot: boolean;
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
