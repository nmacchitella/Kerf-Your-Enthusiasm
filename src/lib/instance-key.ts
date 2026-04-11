import type { Cut, PartInstanceKey } from '@/types';

/**
 * Create a stable, unique key for a specific instance of a cut.
 * Format: `${cut.id}-${instanceIndex}` where instanceIndex is 0-based within qty.
 * The cut.id here should be the DB-sourced id for stability across re-optimizes.
 */
export function makeInstanceKey(cutId: number, instanceIndex: number): PartInstanceKey {
  return `${cutId}-${instanceIndex}`;
}

/**
 * Parse the cutId portion out of an instance key.
 */
export function keyToCutId(key: PartInstanceKey): number {
  return parseInt(key.split('-')[0], 10);
}

/**
 * Expand cuts by qty, assigning a stable instanceKey to each.
 * Returns a flat array of single-qty cuts with instanceKey attached.
 */
export function expandCutsWithKeys(cuts: Cut[]): Array<Cut & { instanceKey: PartInstanceKey }> {
  const result: Array<Cut & { instanceKey: PartInstanceKey }> = [];
  for (const cut of cuts) {
    // If the cut already carries a stable instanceKey (e.g. it's a pre-expanded
    // freeCut from the pinned re-optimize path), preserve it instead of
    // re-generating "id-0" for every instance.
    const existing = (cut as Cut & { instanceKey?: PartInstanceKey }).instanceKey;
    if (existing !== undefined) {
      result.push({ ...cut, qty: 1, instanceKey: existing });
      continue;
    }
    for (let i = 0; i < cut.qty; i++) {
      result.push({ ...cut, qty: 1, instanceKey: makeInstanceKey(cut.id, i) });
    }
  }
  return result;
}
