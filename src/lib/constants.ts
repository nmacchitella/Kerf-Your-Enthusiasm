import { StockPreset } from '@/types';

export const STOCK_PRESETS: StockPreset[] = [
  { name: "4×8 Plywood", length: 96, width: 48 },
  { name: "4×4 Plywood", length: 48, width: 48 },
  { name: "5×5 Baltic Birch", length: 60, width: 60 },
  { name: "4×8 MDF", length: 96, width: 48 },
];

export const MATERIALS = [
  "Plywood",
  "Baltic Birch",
  "MDF",
  "Melamine",
  "Hardwood",
  "Softwood",
  "Other",
] as const;

export type Material = (typeof MATERIALS)[number];

export const KERF_PRESETS = [
  { value: 0.0625, label: '1/16"' },
  { value: 0.125, label: '1/8"' },
  { value: 0.15625, label: '5/32"' },
] as const;

export const CONDITION_COLORS: Record<string, string> = {
  excellent: 'bg-emerald-600',
  good: 'bg-amber-600',
  fair: 'bg-orange-600',
  poor: 'bg-red-600',
};

export const CUT_COLORS = [
  '#f59e0b',
  '#84cc16',
  '#06b6d4',
  '#a855f7',
  '#f43f5e',
  '#10b981',
];

export const FRACTION_REFERENCE = [
  ['1/16', '.0625'],
  ['1/8', '.125'],
  ['3/16', '.1875'],
  ['1/4', '.25'],
  ['5/16', '.3125'],
  ['3/8', '.375'],
  ['7/16', '.4375'],
  ['1/2', '.5'],
  ['9/16', '.5625'],
  ['5/8', '.625'],
  ['11/16', '.6875'],
  ['3/4', '.75'],
  ['13/16', '.8125'],
  ['7/8', '.875'],
  ['15/16', '.9375'],
  ['1', '1.0'],
] as const;

export const PHI = 1.618;
