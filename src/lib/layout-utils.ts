import type {
  Sheet,
  PlacedCut,
  ManualOverrides,
  PinnedPlacement,
  SheetAssignment,
  OptimizationResult,
  PartInstanceKey,
} from '@/types';

/** Snap a value to the nearest grid increment. gridSize=0 means no snap. */
export function snapToGrid(value: number, gridSize: number): number {
  if (!gridSize) return value;
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Merge optimizer result + manual overrides for one sheet.
 * This is the canonical read path — all rendering goes through here.
 *
 * Rules:
 * - Parts from the optimizer that have been moved to a different sheet are excluded.
 * - Parts moved TO this sheet from another sheet are appended.
 * - Override x/y/rot take precedence over optimizer values.
 */
export function buildMergedSheet(
  sheet: Sheet,
  sheetIndex: number,
  overrides: ManualOverrides,
  allSheets: Sheet[]
): PlacedCut[] {
  const merged: PlacedCut[] = [];
  const seen = new Set<PartInstanceKey>();

  for (const cut of sheet.cuts) {
    const ov = overrides[cut.instanceKey];

    // Part was explicitly moved to a different sheet — skip it here
    if (ov?.sheetIndex !== undefined && ov.sheetIndex !== sheetIndex) continue;

    const rot = ov?.rot ?? cut.rot;
    const x = ov?.x ?? cut.x;
    const y = ov?.y ?? cut.y;
    // Recompute pw/ph from base dimensions when rotation changes
    const pw = rot ? cut.l : cut.w;
    const ph = rot ? cut.w : cut.l;

    merged.push({ ...cut, x, y, rot, pw, ph });
    seen.add(cut.instanceKey);
  }

  // Append parts that were assigned TO this sheet from elsewhere
  for (const [key, ov] of Object.entries(overrides)) {
    if (ov.sheetIndex !== sheetIndex) continue;
    if (seen.has(key)) continue; // already included above

    // Find the part in other sheets
    let sourceCut: PlacedCut | undefined;
    for (const s of allSheets) {
      sourceCut = s.cuts.find((c) => c.instanceKey === key);
      if (sourceCut) break;
    }
    if (!sourceCut) continue;

    const rot = ov.rot ?? sourceCut.rot;
    const x = ov.x ?? sourceCut.x;
    const y = ov.y ?? sourceCut.y;
    const pw = rot ? sourceCut.l : sourceCut.w;
    const ph = rot ? sourceCut.w : sourceCut.l;

    merged.push({ ...sourceCut, x, y, rot, pw, ph });
  }

  return merged;
}

/** AABB overlap test between two placed cuts.
 *  A small epsilon prevents floating-point rounding from producing false conflicts
 *  on cuts that are exactly adjacent (touching but not overlapping). */
export function partsOverlap(a: PlacedCut, b: PlacedCut, eps = 1e-6): boolean {
  return (
    a.x < b.x + b.pw - eps &&
    a.x + a.pw > b.x + eps &&
    a.y < b.y + b.ph - eps &&
    a.y + a.ph > b.y + eps
  );
}

/** Returns true if the part extends outside the sheet bounds.
 *  eps prevents FP rounding (e.g. x+pw = 48.0000000001) from triggering false conflicts. */
export function isOutOfBounds(part: PlacedCut, sheet: Sheet, eps = 1e-6): boolean {
  return (
    part.x < -eps ||
    part.y < -eps ||
    part.x + part.pw > sheet.w + eps ||
    part.y + part.ph > sheet.l + eps
  );
}

/**
 * Find all parts with conflicts (overlaps or out-of-bounds) on a merged sheet.
 */
export function findConflicts(mergedCuts: PlacedCut[], sheet: Sheet): Set<PartInstanceKey> {
  const conflicts = new Set<PartInstanceKey>();

  for (let i = 0; i < mergedCuts.length; i++) {
    const a = mergedCuts[i];
    if (isOutOfBounds(a, sheet)) {
      conflicts.add(a.instanceKey);
      continue;
    }
    for (let j = i + 1; j < mergedCuts.length; j++) {
      const b = mergedCuts[j];
      if (partsOverlap(a, b)) {
        conflicts.add(a.instanceKey);
        conflicts.add(b.instanceKey);
      }
    }
  }

  return conflicts;
}

/**
 * Build the pinnedPlacements array from current overrides + optimizer result.
 * Only includes parts with pinned=true and a known position.
 */
export function buildPinnedPlacements(
  result: OptimizationResult,
  overrides: ManualOverrides
): PinnedPlacement[] {
  const pinned: PinnedPlacement[] = [];

  for (const [key, ov] of Object.entries(overrides)) {
    if (!ov.pinned || ov.x === undefined || ov.y === undefined || ov.sheetIndex === undefined) continue;

    // Find the cut in the result
    let sourceCut: PlacedCut | undefined;
    for (const sheet of result.sheets) {
      sourceCut = sheet.cuts.find((c) => c.instanceKey === key);
      if (sourceCut) break;
    }
    if (!sourceCut) continue;

    const rot = ov.rot ?? sourceCut.rot;
    pinned.push({
      key,
      cut: sourceCut,
      x: ov.x,
      y: ov.y,
      pw: rot ? sourceCut.l : sourceCut.w,
      ph: rot ? sourceCut.w : sourceCut.l,
      rot,
      sheetIndex: ov.sheetIndex,
    });
  }

  return pinned;
}

/**
 * Build sheet assignments (non-pinned parts that have been assigned to a specific sheet).
 */
export function buildSheetAssignments(
  result: OptimizationResult,
  overrides: ManualOverrides
): SheetAssignment[] {
  const assignments: SheetAssignment[] = [];

  for (const [key, ov] of Object.entries(overrides)) {
    if (ov.pinned) continue; // pinned ones are handled separately
    if (ov.sheetIndex === undefined) continue;

    let sourceCut: PlacedCut | undefined;
    for (const sheet of result.sheets) {
      sourceCut = sheet.cuts.find((c) => c.instanceKey === key);
      if (sourceCut) break;
    }
    if (!sourceCut) continue;

    assignments.push({ key, cut: sourceCut, sheetIndex: ov.sheetIndex });
  }

  return assignments;
}

/** Compute used area for a set of placed cuts. */
export function computeUsedArea(cuts: PlacedCut[]): number {
  return cuts.reduce((sum, c) => sum + c.pw * c.ph, 0);
}
