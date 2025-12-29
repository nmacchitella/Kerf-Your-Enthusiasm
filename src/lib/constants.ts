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
  excellent: 'bg-emerald-100 text-emerald-700',
  good: 'bg-slate-100 text-slate-700',
  fair: 'bg-amber-100 text-amber-700',
  poor: 'bg-red-100 text-red-700',
};

export const CUT_COLORS = [
  '#64748b',
  '#94a3b8',
  '#475569',
  '#cbd5e1',
  '#334155',
  '#e2e8f0',
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

// Pre-populated tool catalog for quick addition
export const TOOL_CATALOG = [
  // Table Saws
  { name: 'Table Saw', brand: 'DeWalt', model: 'DWE7491RS', notes: '10" blade, 32.5" rip capacity' },
  { name: 'Table Saw', brand: 'SawStop', model: 'PCS175', notes: '10" Professional Cabinet Saw' },
  { name: 'Table Saw', brand: 'Makita', model: '2705', notes: '10" contractor saw' },
  { name: 'Table Saw', brand: 'Bosch', model: '4100-10', notes: '10" worksite saw' },
  { name: 'Table Saw', brand: 'Ridgid', model: 'R4512', notes: '10" cast iron top' },

  // Miter Saws
  { name: 'Miter Saw', brand: 'DeWalt', model: 'DWS779', notes: '12" sliding compound' },
  { name: 'Miter Saw', brand: 'Makita', model: 'LS1019L', notes: '10" dual-bevel sliding' },
  { name: 'Miter Saw', brand: 'Bosch', model: 'GCM12SD', notes: '12" dual-bevel glide' },
  { name: 'Miter Saw', brand: 'Milwaukee', model: '6955-20', notes: '12" sliding compound' },
  { name: 'Miter Saw', brand: 'Festool', model: 'Kapex KS 120', notes: '10" sliding compound' },

  // Routers
  { name: 'Router', brand: 'Bosch', model: '1617EVS', notes: '2.25 HP fixed/plunge combo' },
  { name: 'Router', brand: 'DeWalt', model: 'DW618PK', notes: '2.25 HP fixed/plunge combo' },
  { name: 'Router', brand: 'Makita', model: 'RT0701C', notes: '1.25 HP compact' },
  { name: 'Router', brand: 'Festool', model: 'OF 1400 EQ', notes: '1400W plunge router' },
  { name: 'Router', brand: 'Milwaukee', model: '5615-21', notes: '1.75 HP fixed base' },

  // Sanders
  { name: 'Random Orbit Sander', brand: 'Festool', model: 'ETS 125', notes: '5" pad, dust extraction' },
  { name: 'Random Orbit Sander', brand: 'DeWalt', model: 'DWE6423', notes: '5" variable speed' },
  { name: 'Random Orbit Sander', brand: 'Makita', model: 'BO5041', notes: '5" variable speed' },
  { name: 'Belt Sander', brand: 'Makita', model: '9403', notes: '4" x 24" belt' },
  { name: 'Belt Sander', brand: 'DeWalt', model: 'DW433', notes: '3" x 21" belt' },

  // Drills & Drivers
  { name: 'Drill/Driver', brand: 'DeWalt', model: 'DCD791D2', notes: '20V MAX brushless' },
  { name: 'Drill/Driver', brand: 'Milwaukee', model: '2801-20', notes: 'M18 brushless' },
  { name: 'Drill/Driver', brand: 'Makita', model: 'XFD131', notes: '18V LXT brushless' },
  { name: 'Impact Driver', brand: 'DeWalt', model: 'DCF887B', notes: '20V MAX XR' },
  { name: 'Impact Driver', brand: 'Milwaukee', model: '2853-20', notes: 'M18 FUEL' },

  // Planers
  { name: 'Planer', brand: 'DeWalt', model: 'DW735X', notes: '13" thickness planer' },
  { name: 'Planer', brand: 'Makita', model: '2012NB', notes: '12" portable planer' },
  { name: 'Planer', brand: 'Jet', model: 'JWP-13BT', notes: '13" benchtop planer' },
  { name: 'Hand Planer', brand: 'Makita', model: 'KP0810', notes: '3-1/4" electric planer' },

  // Jointers
  { name: 'Jointer', brand: 'Jet', model: 'JJ-6CSDX', notes: '6" long bed jointer' },
  { name: 'Jointer', brand: 'DeWalt', model: 'DW682K', notes: 'Plate joiner/biscuit' },
  { name: 'Jointer', brand: 'Powermatic', model: '54HH', notes: '6" helical head' },

  // Band Saws
  { name: 'Band Saw', brand: 'Rikon', model: '10-326', notes: '14" deluxe' },
  { name: 'Band Saw', brand: 'Laguna', model: '14|12', notes: '14" resaw capacity' },
  { name: 'Band Saw', brand: 'Jet', model: 'JWBS-14DXPRO', notes: '14" deluxe pro' },
  { name: 'Band Saw', brand: 'DeWalt', model: 'DWM120K', notes: 'Portable deep cut' },

  // Jigsaws
  { name: 'Jigsaw', brand: 'Bosch', model: 'JS470E', notes: '7A barrel grip' },
  { name: 'Jigsaw', brand: 'DeWalt', model: 'DCS334B', notes: '20V MAX brushless' },
  { name: 'Jigsaw', brand: 'Makita', model: 'XVJ03Z', notes: '18V LXT brushless' },
  { name: 'Jigsaw', brand: 'Festool', model: 'PS 420 EBQ', notes: 'Carvex orbital' },

  // Circular Saws
  { name: 'Circular Saw', brand: 'Makita', model: '5007MGA', notes: '7-1/4" magnesium' },
  { name: 'Circular Saw', brand: 'DeWalt', model: 'DCS570B', notes: '20V MAX 7-1/4"' },
  { name: 'Circular Saw', brand: 'Milwaukee', model: '2732-20', notes: 'M18 FUEL 7-1/4"' },
  { name: 'Track Saw', brand: 'Festool', model: 'TS 55 REQ', notes: '55mm plunge cut' },
  { name: 'Track Saw', brand: 'Makita', model: 'SP6000J1', notes: '6-1/2" plunge cut' },

  // Dust Collection
  { name: 'Dust Collector', brand: 'Festool', model: 'CT 26 E', notes: 'HEPA dust extractor' },
  { name: 'Dust Collector', brand: 'DeWalt', model: 'DWV012', notes: '10 gallon HEPA' },
  { name: 'Shop Vac', brand: 'Ridgid', model: 'WD1450', notes: '14 gallon wet/dry' },

  // Specialty
  { name: 'Domino Joiner', brand: 'Festool', model: 'DF 500 Q', notes: 'Domino joining system' },
  { name: 'Domino Joiner', brand: 'Festool', model: 'DF 700 EQ', notes: 'Domino XL' },
  { name: 'Biscuit Joiner', brand: 'DeWalt', model: 'DW682K', notes: 'Plate joiner' },
  { name: 'Oscillating Tool', brand: 'Fein', model: 'MultiMaster', notes: 'Original oscillating' },
  { name: 'Oscillating Tool', brand: 'DeWalt', model: 'DCS356B', notes: '20V MAX XR' },
  { name: 'Scroll Saw', brand: 'DeWalt', model: 'DW788', notes: '20" variable speed' },
  { name: 'Lathe', brand: 'Jet', model: 'JWL-1221VS', notes: '12" x 21" variable speed' },
  { name: 'Lathe', brand: 'Nova', model: 'Comet II', notes: '12" midi lathe' },
  { name: 'Spindle Sander', brand: 'Ridgid', model: 'EB4424', notes: 'Oscillating edge/belt' },
  { name: 'Drill Press', brand: 'Jet', model: 'JDP-17MF', notes: '17" floor drill press' },
  { name: 'Drill Press', brand: 'DeWalt', model: 'DWE1622K', notes: 'Magnetic drill press' },
] as const;
