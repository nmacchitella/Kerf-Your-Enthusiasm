/**
 * Cut Optimizer Test Suite
 * Run with: npx tsx --tsconfig tsconfig.json src/lib/cut-optimizer.test.ts
 */
import {
  optimizeCuts,
  optimizeCutsShelf,
  optimizeCutsMaxRects,
  optimizeCutsOptimal,
  optimizeCutsBest,
  calculateStats,
} from './cut-optimizer';
import { expandCutsWithKeys } from './instance-key';
import { isOutOfBounds, partsOverlap } from './layout-utils';
import type { Stock, Cut, PlacedCut, OptimizationResult, PinnedPlacement, PartInstanceKey, Sheet } from '@/types';

// ─── Helpers ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function assertEq<T>(actual: T, expected: T, message: string) {
  assert(actual === expected, `${message} (got ${actual}, expected ${expected})`);
}

/** Verify no two placed cuts overlap on a sheet. */
function noOverlaps(cuts: PlacedCut[], kerf: number): boolean {
  for (let i = 0; i < cuts.length; i++) {
    for (let j = i + 1; j < cuts.length; j++) {
      const a = cuts[i], b = cuts[j];
      const aRight = a.x + a.pw + kerf;
      const aBottom = a.y + a.ph + kerf;
      const bRight = b.x + b.pw + kerf;
      const bBottom = b.y + b.ph + kerf;
      const overlaps =
        a.x < bRight && aRight > b.x &&
        a.y < bBottom && aBottom > b.y;
      if (overlaps) {
        console.error(
          `    OVERLAP: ${a.label}(${a.x},${a.y} ${a.pw}×${a.ph}) ↔ ${b.label}(${b.x},${b.y} ${b.pw}×${b.ph})`
        );
        return false;
      }
    }
  }
  return true;
}

/** Verify all placed cuts are within sheet bounds. */
function withinBounds(cuts: PlacedCut[], sheetW: number, sheetL: number): boolean {
  for (const c of cuts) {
    if (c.x < 0 || c.y < 0 || c.x + c.pw > sheetW + 0.001 || c.y + c.ph > sheetL + 0.001) {
      console.error(
        `    OUT OF BOUNDS: ${c.label} at (${c.x},${c.y}) ${c.pw}×${c.ph} on ${sheetW}×${sheetL}`
      );
      return false;
    }
  }
  return true;
}

/** Run structural checks on a full result. */
function validateResult(result: OptimizationResult, kerf: number, label: string) {
  for (let i = 0; i < result.sheets.length; i++) {
    const sheet = result.sheets[i];
    assert(
      noOverlaps(sheet.cuts, kerf),
      `${label}: sheet ${i + 1} — no overlapping cuts`
    );
    assert(
      withinBounds(sheet.cuts, sheet.w, sheet.l),
      `${label}: sheet ${i + 1} — all cuts within bounds`
    );
  }
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

const STOCK_PLYWOOD: Stock = { id: 1, name: '4×8 Plywood', w: 48, l: 96, t: 0.75, qty: 10, mat: 'plywood' };
const STOCK_MDF: Stock    = { id: 2, name: '4×8 MDF',     w: 48, l: 96, t: 0.75, qty: 5,  mat: 'mdf' };

function makeSquareCuts(count: number, size: number, mat = 'plywood'): Cut[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1, label: `P${i + 1}`, l: size, w: size, t: 0.75, qty: 1, mat,
  }));
}

// ─── Test 1: Single cut fits on one sheet ──────────────────────────────────

console.log('\nTest 1: Single cut');
{
  const cuts: Cut[] = [{ id: 1, label: 'A', l: 20, w: 10, t: 0.75, qty: 1, mat: 'plywood' }];
  const r = optimizeCutsBest([STOCK_PLYWOOD], cuts, 0.125);
  assertEq(r.sheets.length, 1, 'one sheet used');
  assertEq(r.unplaced.length, 0, 'zero unplaced');
  assertEq(r.sheets[0].cuts.length, 1, 'one cut placed');
  validateResult(r, 0.125, 'single-cut');
}

// ─── Test 2: Cut larger than stock → unplaced ──────────────────────────────

console.log('\nTest 2: Oversized cut');
{
  const cuts: Cut[] = [{ id: 1, label: 'Big', l: 100, w: 50, t: 0.75, qty: 1, mat: 'plywood' }];
  const r = optimizeCutsBest([STOCK_PLYWOOD], cuts, 0.125);
  assertEq(r.unplaced.length, 1, 'oversized cut goes to unplaced');
  assertEq(r.sheets.length, 0, 'no sheets created');
}

// ─── Test 3: Material mismatch → unplaced ─────────────────────────────────

console.log('\nTest 3: Material mismatch');
{
  const cuts: Cut[] = [{ id: 1, label: 'X', l: 10, w: 10, t: 0.75, qty: 1, mat: 'oak' }];
  const r = optimizeCutsBest([STOCK_PLYWOOD], cuts, 0.125);
  assertEq(r.unplaced.length, 1, 'material-mismatched cut is unplaced');
}

// ─── Test 4: Thickness mismatch → unplaced ────────────────────────────────

console.log('\nTest 4: Thickness mismatch');
{
  const cuts: Cut[] = [{ id: 1, label: 'T', l: 10, w: 10, t: 0.5, qty: 1, mat: 'plywood' }];
  const r = optimizeCutsBest([STOCK_PLYWOOD], cuts, 0.125); // stock is 0.75
  assertEq(r.unplaced.length, 1, 'thickness-mismatched cut is unplaced');
}

// ─── Test 5: Kerf respected — two cuts side by side ───────────────────────

console.log('\nTest 5: Kerf gap enforcement');
{
  const kerf = 0.125;
  // Two 24" wide cuts in a 48" sheet — need kerf between them
  const cuts: Cut[] = [
    { id: 1, label: 'L', l: 10, w: 24, t: 0.75, qty: 1, mat: 'plywood' },
    { id: 2, label: 'R', l: 10, w: 24, t: 0.75, qty: 1, mat: 'plywood' },
  ];
  // 24 + 0.125 + 24 = 48.125 > 48 → should not fit side-by-side on width
  // but they can stack vertically: 10 + 0.125 + 10 = 20.125 ≤ 96
  const r = optimizeCutsMaxRects([STOCK_PLYWOOD], cuts, kerf);
  assertEq(r.unplaced.length, 0, 'both cuts placed');
  validateResult(r, kerf, 'kerf-gap');
  // Check minimum gap between any two cuts
  if (r.sheets.length > 0) {
    const [a, b] = r.sheets[0].cuts;
    if (a && b) {
      // Horizontal gap
      const hGap = Math.abs((a.x + a.pw) - b.x);
      const vGap = Math.abs((a.y + a.ph) - b.y);
      const minGap = Math.min(hGap, vGap);
      assert(minGap >= kerf - 0.001 || r.sheets[0].cuts.length === 1, 'kerf gap ≥ kerf value');
    }
  }
}

// ─── Test 6: Multi-sheet when cuts don't fit on one ───────────────────────

console.log('\nTest 6: Multi-sheet layout');
{
  // 20 cuts of 24×24 on 48×96 sheets — each sheet fits (48/24)*(96/24) = 2*4 = 8 cuts → 3 sheets
  const cuts = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1, label: `P${i + 1}`, l: 24, w: 24, t: 0.75, qty: 1, mat: 'plywood',
  }));
  const r = optimizeCutsBest([STOCK_PLYWOOD], cuts, 0.125);
  assertEq(r.unplaced.length, 0, 'all 20 cuts placed');
  assert(r.sheets.length >= 3, `at least 3 sheets used (got ${r.sheets.length})`);
  validateResult(r, 0.125, 'multi-sheet');
}

// ─── Test 7: Rotation allows fit ─────────────────────────────────────────

console.log('\nTest 7: Rotation enables placement');
{
  const kerf = 0;
  // 50×10 cut on a 12×50 sheet — fits only if rotated to 10×50
  const stock: Stock = { id: 1, name: 'narrow', w: 12, l: 50, t: 0, qty: 1, mat: '' };
  const cuts: Cut[] = [{ id: 1, label: 'A', l: 10, w: 50, t: 0, qty: 1, mat: '' }];
  const r = optimizeCutsMaxRects([stock], cuts, kerf);
  assertEq(r.unplaced.length, 0, 'cut placed via rotation');
  if (r.sheets.length > 0 && r.sheets[0].cuts.length > 0) {
    assert(r.sheets[0].cuts[0].rot === true, 'cut is marked as rotated');
  }
  validateResult(r, kerf, 'rotation');
}

// ─── Test 8: Multi-material routing ──────────────────────────────────────

console.log('\nTest 8: Multi-material — each cut goes to matching stock');
{
  const cuts: Cut[] = [
    { id: 1, label: 'P1', l: 10, w: 10, t: 0.75, qty: 1, mat: 'plywood' },
    { id: 2, label: 'M1', l: 10, w: 10, t: 0.75, qty: 1, mat: 'mdf' },
  ];
  const r = optimizeCutsBest([STOCK_PLYWOOD, STOCK_MDF], cuts, 0.125);
  assertEq(r.unplaced.length, 0, 'both cuts placed');
  // Each material cut must land on the correct stock sheet
  const plywoodSheets = r.sheets.filter(s => s.mat === 'plywood');
  const mdfSheets     = r.sheets.filter(s => s.mat === 'mdf');
  assert(
    plywoodSheets.some(s => s.cuts.some(c => c.label === 'P1')),
    'plywood cut placed on plywood sheet'
  );
  assert(
    mdfSheets.some(s => s.cuts.some(c => c.label === 'M1')),
    'mdf cut placed on mdf sheet'
  );
}

// ─── Test 9: Quantity expansion ──────────────────────────────────────────

console.log('\nTest 9: Quantity expansion (qty > 1)');
{
  const cuts: Cut[] = [{ id: 1, label: 'Q', l: 10, w: 10, t: 0.75, qty: 5, mat: 'plywood' }];
  const r = optimizeCutsBest([STOCK_PLYWOOD], cuts, 0.125);
  const totalPlaced = r.sheets.reduce((s, sh) => s + sh.cuts.length, 0);
  assertEq(totalPlaced, 5, '5 individual pieces placed');
  assertEq(r.unplaced.length, 0, 'no unplaced');
  validateResult(r, 0.125, 'qty-expansion');
}

// ─── Test 10: MaxRects ≥ Guillotine on utilization ────────────────────────

console.log('\nTest 10: MaxRects quality vs Guillotine');
{
  const kerf = 0.125;
  // Mix of awkward sizes that stress-test the packing
  const cuts: Cut[] = [
    { id: 1,  label: 'A', l: 30, w: 20, t: 0.75, qty: 2, mat: 'plywood' },
    { id: 2,  label: 'B', l: 15, w: 12, t: 0.75, qty: 3, mat: 'plywood' },
    { id: 3,  label: 'C', l: 8,  w: 8,  t: 0.75, qty: 4, mat: 'plywood' },
    { id: 4,  label: 'D', l: 40, w: 10, t: 0.75, qty: 2, mat: 'plywood' },
    { id: 5,  label: 'E', l: 24, w: 6,  t: 0.75, qty: 3, mat: 'plywood' },
  ];
  const gResult = optimizeCuts([STOCK_PLYWOOD], cuts, kerf);
  const mResult = optimizeCutsMaxRects([STOCK_PLYWOOD], cuts, kerf);
  const gStats  = calculateStats(gResult);
  const mStats  = calculateStats(mResult);

  console.log(`    Guillotine: ${gStats.sheets} sheets, ${gStats.waste}% waste, ${gResult.unplaced.length} unplaced`);
  console.log(`    MaxRects:   ${mStats.sheets} sheets, ${mStats.waste}% waste, ${mResult.unplaced.length} unplaced`);

  assert(
    mResult.unplaced.length <= gResult.unplaced.length,
    `MaxRects unplaced (${mResult.unplaced.length}) ≤ Guillotine unplaced (${gResult.unplaced.length})`
  );
  assert(
    mStats.sheets <= gStats.sheets + 1,
    `MaxRects sheets (${mStats.sheets}) ≤ Guillotine + 1`
  );
  validateResult(mResult, kerf, 'maxrects-quality');
  validateResult(gResult, kerf, 'guillotine-quality');
}

// ─── Test 11: mergeFreeRects — guillotine recovers merged space ────────────

console.log('\nTest 11: mergeFreeRects improves guillotine utilisation');
{
  const kerf = 0;
  // Place two 20×48 cuts side by side on a 48×96 sheet.
  // After first cut (20×48), guillotine splits into:
  //   right: 28×48 and bottom: nothing (cut fills height)
  // After second cut in right strip, merged rect should handle it cleanly.
  const cuts: Cut[] = [
    { id: 1, label: 'A', l: 48, w: 20, t: 0.75, qty: 1, mat: 'plywood' },
    { id: 2, label: 'B', l: 48, w: 20, t: 0.75, qty: 1, mat: 'plywood' },
    { id: 3, label: 'C', l: 48, w: 8,  t: 0.75, qty: 1, mat: 'plywood' },
  ];
  const r = optimizeCuts([STOCK_PLYWOOD], cuts, kerf);
  assertEq(r.unplaced.length, 0, 'all cuts placed with merged free rects');
  validateResult(r, kerf, 'merge-freeRects');
}

// ─── Test 12: B&B skipped for large inputs ────────────────────────────────

console.log('\nTest 12: B&B skip for >15 cuts (timing check)');
{
  const cuts = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1, label: `P${i + 1}`, l: 12, w: 8, t: 0.75, qty: 1, mat: 'plywood',
  }));
  const t0 = Date.now();
  const r = optimizeCutsBest([STOCK_PLYWOOD], cuts, 0.125);
  const elapsed = Date.now() - t0;
  // B&B with 20 cuts would take >2s; skipping it should complete in <2s
  assert(elapsed < 4000, `optimizeCutsBest with 20 cuts finishes in <4s (took ${elapsed}ms)`);
  assertEq(r.unplaced.length, 0, 'all 20 cuts placed');
  validateResult(r, 0.125, 'b&b-skip');
}

// ─── Test 13: Padding / clearance ────────────────────────────────────────

console.log('\nTest 13: Padding deflates correctly');
{
  const cuts: Cut[] = [{ id: 1, label: 'A', l: 10, w: 10, t: 0.75, qty: 1, mat: 'plywood' }];
  const r = optimizeCutsBest([STOCK_PLYWOOD], cuts, 0.125, 0.5);
  assertEq(r.unplaced.length, 0, 'cut placed with padding');
  if (r.sheets.length > 0 && r.sheets[0].cuts.length > 0) {
    const c = r.sheets[0].cuts[0];
    assertEq(c.pw, 10, 'placed width deflated back to original');
    assertEq(c.ph, 10, 'placed height deflated back to original');
  }
}

// ─── Test 14: All algorithms agree on trivial single cut ─────────────────

console.log('\nTest 14: All algorithms handle trivial single cut');
{
  const cuts: Cut[] = [{ id: 1, label: 'A', l: 10, w: 10, t: 0.75, qty: 1, mat: 'plywood' }];
  for (const [name, fn] of [
    ['guillotine', optimizeCuts],
    ['shelf',      optimizeCutsShelf],
    ['maxrects',   optimizeCutsMaxRects],
    ['optimal',    (s: Stock[], c: Cut[], k: number) => optimizeCutsOptimal(s, c, k, 1000)],
  ] as const) {
    const r = fn([STOCK_PLYWOOD], cuts, 0.125);
    assertEq(r.unplaced.length, 0, `${name}: single cut placed`);
    assertEq(r.sheets.length, 1, `${name}: exactly one sheet`);
    validateResult(r, 0.125, name);
  }
}

// ─── Test 15: Heavy load — 50 mixed cuts ─────────────────────────────────

console.log('\nTest 15: Heavy load (50 cuts, validation only)');
{
  const kerf = 0.125;
  const cuts: Cut[] = [
    ...makeSquareCuts(10, 6,  'plywood'),
    ...makeSquareCuts(10, 10, 'plywood'),
    ...makeSquareCuts(10, 15, 'plywood'),
    ...makeSquareCuts(10, 20, 'plywood'),
    ...makeSquareCuts(10, 4,  'plywood'),
  ];
  const r = optimizeCutsBest([{ ...STOCK_PLYWOOD, qty: 20 }], cuts, kerf);
  assert(r.unplaced.length === 0, `all 50 cuts placed (${r.unplaced.length} unplaced)`);
  validateResult(r, kerf, 'heavy-load');
  const stats = calculateStats(r);
  console.log(`    ${stats.sheets} sheets, ${stats.waste}% waste`);
}

// ─── Test 16: Tournament picks guillotine for edge-fill cuts ─────────────

console.log('\nTest 16: optimizeCutsBest handles full-width cuts correctly');
{
  const kerf = 0.125;
  // A cut exactly as wide as the stock. MaxRects is conservative here (requires
  // w + kerf space, has only w), but guillotine handles it with edge-aware kerf.
  // The tournament should pick guillotine and place it correctly.
  const cuts: Cut[] = [{ id: 1, label: 'A', l: 40, w: 48, t: 0.75, qty: 1, mat: 'plywood' }];
  const r = optimizeCutsBest([STOCK_PLYWOOD], cuts, kerf);
  assertEq(r.unplaced.length, 0, 'full-width cut placed (tournament picks guillotine)');
  validateResult(r, kerf, 'full-width-via-tournament');

  // Two cuts that together fill the width: 24 + 0.125 + 24 = 48.125 > 48 → must stack
  const cuts2: Cut[] = [
    { id: 1, label: 'L', l: 10, w: 24, t: 0.75, qty: 1, mat: 'plywood' },
    { id: 2, label: 'R', l: 10, w: 24, t: 0.75, qty: 1, mat: 'plywood' },
  ];
  const r2 = optimizeCutsBest([STOCK_PLYWOOD], cuts2, kerf);
  assertEq(r2.unplaced.length, 0, 'two half-width cuts placed on one sheet');
  assertEq(r2.sheets.length, 1, 'one sheet used');
  validateResult(r2, kerf, 'two-halves');
}

// ─── Test 17: Pinned cut conflict fix ─────────────────────────────────────

console.log('\nTest 17: Re-optimize with pinned cut at non-corner position');
{
  const kerf = 0.125;

  // Simulate a cut pinned at (10, 5) — not at the top-left of any free rect.
  // Previously, splitRectangle wrongly assumed top-left placement, leaving
  // free rects that overlapped the pinned area → conflict on re-optimize.
  const stock = STOCK_PLYWOOD;
  const cuts: Cut[] = [
    { id: 1, label: 'A', l: 20, w: 20, t: 0.75, qty: 1, mat: 'plywood' },  // will be pinned
    { id: 2, label: 'B', l: 20, w: 20, t: 0.75, qty: 1, mat: 'plywood' },  // free
    { id: 3, label: 'C', l: 20, w: 20, t: 0.75, qty: 1, mat: 'plywood' },  // free
  ];

  // Build a fake PlacedCut for cut A at (10, 5)
  const pinnedCut = {
    ...cuts[0], x: 10, y: 5, pw: 20, ph: 20, rot: false,
    instanceKey: '1-0' as PartInstanceKey,
  };
  const pinned: PinnedPlacement[] = [{
    key: '1-0',
    cut: pinnedCut,
    x: 10, y: 5, pw: 20, ph: 20, rot: false,
    sheetIndex: 0,
  }];

  const r = optimizeCutsBest([stock], cuts, kerf, 0, pinned, []);
  assertEq(r.unplaced.length, 0, 'all cuts placed with non-corner pinned cut');
  validateResult(r, kerf, 'pinned-non-corner');
}

// ─── Test 18: isOutOfBounds epsilon ──────────────────────────────────────

console.log('\nTest 18: isOutOfBounds — no false positive from FP rounding');
{
  const sheet: Sheet = { w: 48, l: 96, name: 'S', mat: 'plywood', cuts: [], rects: [] };
  // Part that is exactly flush to the right edge — FP arithmetic can make x+pw = 48 + epsilon
  const flush: PlacedCut = {
    id: 1, label: 'A', l: 10, w: 48, t: 0.75, qty: 1, mat: 'plywood',
    x: 0, y: 0, pw: 48, ph: 10, rot: false,
    instanceKey: '1-0' as PartInstanceKey,
  };
  assert(!isOutOfBounds(flush, sheet), 'flush part not reported as out-of-bounds');

  // Simulate FP drift: x+pw = 48.0000000001
  const fpDrift: PlacedCut = { ...flush, pw: 48 + 5e-7 };
  assert(!isOutOfBounds(fpDrift, sheet), 'part with FP drift ≤1e-6 not reported as out-of-bounds');

  // Truly out-of-bounds should still be caught
  const oob: PlacedCut = { ...flush, pw: 48 + 0.01 };
  assert(isOutOfBounds(oob, sheet), 'genuinely out-of-bounds part detected');
}

// ─── Test 19: partsOverlap epsilon ───────────────────────────────────────

console.log('\nTest 19: partsOverlap — adjacent parts do not trigger false overlap');
{
  const base: Omit<PlacedCut, 'x' | 'pw'> = {
    id: 1, label: 'A', l: 10, w: 10, t: 0.75, qty: 1, mat: 'plywood',
    y: 0, ph: 10, rot: false,
    instanceKey: '1-0' as PartInstanceKey,
  };
  const a: PlacedCut = { ...base, id: 1, label: 'A', x: 0, pw: 20, instanceKey: '1-0' as PartInstanceKey };
  // Part b starts exactly where a ends (touching, not overlapping)
  const bTouching: PlacedCut = { ...base, id: 2, label: 'B', x: 20, pw: 20, instanceKey: '2-0' as PartInstanceKey };
  assert(!partsOverlap(a, bTouching), 'adjacent (touching) parts do not overlap');

  // Part b starts inside a (genuine overlap)
  const bOverlap: PlacedCut = { ...base, id: 2, label: 'B', x: 15, pw: 20, instanceKey: '2-0' as PartInstanceKey };
  assert(partsOverlap(a, bOverlap), 'genuinely overlapping parts detected');
}

// ─── Test 20: expandCutsWithKeys preserves existing instanceKey ───────────

console.log('\nTest 20: expandCutsWithKeys — preserves pre-existing instanceKey');
{
  const cut: Cut & { instanceKey: PartInstanceKey } = {
    id: 1, label: 'A', l: 10, w: 10, t: 0.75, qty: 1, mat: 'plywood',
    instanceKey: '1-42' as PartInstanceKey,
  };
  const expanded = expandCutsWithKeys([cut]);
  assertEq(expanded.length, 1, 'one item returned');
  assertEq(expanded[0].instanceKey, '1-42' as PartInstanceKey, 'existing instanceKey preserved');

  // Normal cut without instanceKey should still get generated key
  const fresh: Cut = { id: 2, label: 'B', l: 10, w: 10, t: 0.75, qty: 3, mat: 'plywood' };
  const expanded2 = expandCutsWithKeys([fresh]);
  assertEq(expanded2.length, 3, 'qty=3 expands to 3 items');
  assertEq(expanded2[0].instanceKey, '2-0' as PartInstanceKey, 'first generated key = 2-0');
  assertEq(expanded2[1].instanceKey, '2-1' as PartInstanceKey, 'second generated key = 2-1');
  assertEq(expanded2[2].instanceKey, '2-2' as PartInstanceKey, 'third generated key = 2-2');
}

// ─── Test 21: subtractOccupied — no free-rect overlap at corners ─────────

console.log('\nTest 21: Re-optimize with two free cuts next to a non-corner pinned cut');
{
  const kerf = 0;
  const stock: Stock = { id: 1, name: 'S', w: 60, l: 60, t: 0, qty: 5, mat: '' };

  // Pinned cut at (20, 20) — centre of sheet, not a corner
  const pinnedCut: PlacedCut = {
    id: 1, label: 'P', l: 10, w: 10, t: 0, qty: 1, mat: '',
    x: 20, y: 20, pw: 10, ph: 10, rot: false,
    instanceKey: '1-0' as PartInstanceKey,
  };
  const pinned: PinnedPlacement[] = [{
    key: '1-0' as PartInstanceKey,
    cut: pinnedCut,
    x: 20, y: 20, pw: 10, ph: 10, rot: false,
    sheetIndex: 0,
  }];

  const cuts: Cut[] = [
    { id: 1, label: 'P', l: 10, w: 10, t: 0, qty: 1, mat: '' },  // the pinned one
    { id: 2, label: 'X', l: 10, w: 10, t: 0, qty: 1, mat: '' },
    { id: 3, label: 'Y', l: 10, w: 10, t: 0, qty: 1, mat: '' },
  ];

  const r = optimizeCutsBest([stock], cuts, kerf, 0, pinned, []);
  assertEq(r.unplaced.length, 0, 'all 3 cuts placed around non-corner pinned part');
  validateResult(r, kerf, 'subtract-no-corner-overlap');
}

// ─── Test 22: Sheet edge padding reserves the border ─────────────────────

console.log('\nTest 22: Sheet edge padding keeps the outer border clear');
{
  const edgePadding = 0.75;
  const exactFit: Cut[] = [{ id: 1, label: 'Inset', l: 94.5, w: 46.5, t: 0.75, qty: 1, mat: 'plywood' }];
  const exactFitResult = optimizeCutsBest([STOCK_PLYWOOD], exactFit, 0.125, 0, [], [], edgePadding);
  assertEq(exactFitResult.unplaced.length, 0, 'cut that matches the usable inset area is placed');
  assertEq(exactFitResult.sheets.length, 1, 'usable-area cut uses one sheet');
  if (exactFitResult.sheets.length > 0 && exactFitResult.sheets[0].cuts.length > 0) {
    const c = exactFitResult.sheets[0].cuts[0];
    assertEq(c.x, edgePadding, 'cut starts after left border padding');
    assertEq(c.y, edgePadding, 'cut starts after top border padding');
    assertEq(c.x + c.pw, exactFitResult.sheets[0].w - edgePadding, 'cut ends before right border padding');
    assertEq(c.y + c.ph, exactFitResult.sheets[0].l - edgePadding, 'cut ends before bottom border padding');
  }
  validateResult(exactFitResult, 0.125, 'sheet-edge-padding');

  const tooWide: Cut[] = [{ id: 2, label: 'TooWide', l: 20, w: 47, t: 0.75, qty: 1, mat: 'plywood' }];
  const tooWideResult = optimizeCutsBest([STOCK_PLYWOOD], tooWide, 0.125, 0, [], [], edgePadding);
  assertEq(tooWideResult.unplaced.length, 1, 'cut wider than the usable inset area is rejected');
  assertEq(tooWideResult.sheets.length, 0, 'no sheet generated when only cut exceeds inset width');
}

// ─── Summary ──────────────────────────────────────────────────────────────

console.log('\n─────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('SOME TESTS FAILED');
  process.exit(1);
} else {
  console.log('All tests passed ✓');
}
