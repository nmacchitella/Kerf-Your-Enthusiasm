import { Stock, Cut, Sheet, OptimizationResult, PlacedCut, Rect, PinnedPlacement, SheetAssignment } from '@/types';
import { MaxRectsPacker, PACKING_LOGIC } from 'maxrects-packer';
import { expandCutsWithKeys, makeInstanceKey } from '@/lib/instance-key';

interface Placement {
  rectIndex: number;
  rotated: boolean;
  score: number;
}

/**
 * Check if a cut fits in a rectangle
 * Kerf is only needed if there's remaining space (for the next cut)
 */
function cutFitsInRect(
  cutW: number,
  cutH: number,
  rect: Rect,
  kerf: number
): boolean {
  // If cut fills the entire width, no kerf needed on right
  // If cut fills the entire height, no kerf needed on bottom
  const needsKerfRight = cutW < rect.w;
  const needsKerfBottom = cutH < rect.h;

  const requiredW = cutW + (needsKerfRight ? kerf : 0);
  const requiredH = cutH + (needsKerfBottom ? kerf : 0);

  return requiredW <= rect.w && requiredH <= rect.h;
}

/**
 * Score a placement - lower is better
 * Prefers orientations that leave usable space rather than consuming full dimensions
 */
function scorePlacement(
  cutW: number,
  cutH: number,
  rect: Rect,
  kerf: number,
  remainingCuts: Array<{ w: number; l: number }>
): number {
  const leftoverW = rect.w - cutW - kerf;
  const leftoverH = rect.h - cutH - kerf;

  // Check if remaining cuts could fit in the leftover strips
  let rightStripUsable = 0;
  let bottomStripUsable = 0;

  for (const cut of remainingCuts.slice(0, 5)) {
    // Right strip: width = leftoverW, height = cutH
    if (leftoverW >= cut.w && cutH >= cut.l) rightStripUsable++;
    if (leftoverW >= cut.l && cutH >= cut.w) rightStripUsable++;

    // Bottom strip: width = rect.w, height = leftoverH
    if (rect.w >= cut.w && leftoverH >= cut.l) bottomStripUsable++;
    if (rect.w >= cut.l && leftoverH >= cut.w) bottomStripUsable++;
  }

  let score = 0;

  // BONUS for filling entire dimension (creates clean edge, no wasted strip)
  // This is GOOD because it maximizes the remaining contiguous space
  if (leftoverW <= 0) score -= 5000;  // Filled full width - good!
  if (leftoverH <= 0) score -= 5000;  // Filled full height - good!

  // Only penalize if we created a small UNUSABLE strip (wasted space)
  // A strip is "created" if leftoverW/H > 0, and "unusable" if nothing fits
  const minUsefulStrip = 10; // Minimum strip size that could be useful
  if (leftoverW > 0 && leftoverW < minUsefulStrip && rightStripUsable === 0) {
    score += 50000; // Created a useless thin strip
  }
  if (leftoverH > 0 && leftoverH < minUsefulStrip && bottomStripUsable === 0) {
    score += 50000; // Created a useless thin strip
  }

  // Bonus for leaving usable space
  score -= rightStripUsable * 1000;
  score -= bottomStripUsable * 1000;

  // Prefer placements that leave larger contiguous areas
  // Calculate area of the larger remaining strip
  const rightStripArea = Math.max(0, leftoverW) * cutH;
  const bottomStripArea = rect.w * Math.max(0, leftoverH);
  const maxStripArea = Math.max(rightStripArea, bottomStripArea);
  score -= maxStripArea * 0.1; // Bonus for larger remaining area

  // Tiebreaker: minimize the shorter leftover (BSSF - Best Short Side Fit)
  const shortSide = Math.min(Math.max(0, leftoverW), Math.max(0, leftoverH));
  score += shortSide * 10;

  // Final tiebreaker: total leftover
  score += Math.max(0, leftoverW) + Math.max(0, leftoverH);

  return score;
}

/**
 * Generate guillotine split rectangles
 * Try both split directions and return both options
 */
function splitRectangle(
  rect: Rect,
  cutW: number,
  cutH: number,
  kerf: number
): { horizontal: Rect[]; vertical: Rect[] } {
  const horizontal: Rect[] = [];
  const vertical: Rect[] = [];

  // Calculate remaining space
  const rightSpace = rect.w - cutW;
  const bottomSpace = rect.h - cutH;

  // Horizontal-first split: narrow right strip, wide bottom strip
  if (rightSpace > kerf) {
    horizontal.push({
      x: rect.x + cutW + kerf,
      y: rect.y,
      w: rightSpace - kerf,
      h: cutH,
    });
  }
  if (bottomSpace > kerf) {
    horizontal.push({
      x: rect.x,
      y: rect.y + cutH + kerf,
      w: rect.w,
      h: bottomSpace - kerf,
    });
  }

  // Vertical-first split: tall right strip, narrow bottom strip
  if (rightSpace > kerf) {
    vertical.push({
      x: rect.x + cutW + kerf,
      y: rect.y,
      w: rightSpace - kerf,
      h: rect.h,
    });
  }
  if (bottomSpace > kerf) {
    vertical.push({
      x: rect.x,
      y: rect.y + cutH + kerf,
      w: cutW,
      h: bottomSpace - kerf,
    });
  }

  return { horizontal, vertical };
}

/**
 * Merge adjacent free rectangles to recover usable space lost by guillotine splits.
 * Without this, free rects that share an edge are never recombined, wasting potential space.
 */
function mergeFreeRects(rects: Rect[]): Rect[] {
  const result = [...rects];
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const a = result[i], b = result[j];
        // Horizontal neighbors: same y and h, touching on x-axis
        if (a.h === b.h && a.y === b.y) {
          if (a.x + a.w === b.x) {
            result[i] = { ...a, w: a.w + b.w };
            result.splice(j, 1); merged = true; break outer;
          }
          if (b.x + b.w === a.x) {
            result[i] = { ...a, x: b.x, w: a.w + b.w };
            result.splice(j, 1); merged = true; break outer;
          }
        }
        // Vertical neighbors: same x and w, touching on y-axis
        if (a.w === b.w && a.x === b.x) {
          if (a.y + a.h === b.y) {
            result[i] = { ...a, h: a.h + b.h };
            result.splice(j, 1); merged = true; break outer;
          }
          if (b.y + b.h === a.y) {
            result[i] = { ...a, y: b.y, h: a.h + b.h };
            result.splice(j, 1); merged = true; break outer;
          }
        }
      }
    }
  }
  return result;
}

/**
 * MaxRects-style space subtraction: for each free rect that overlaps the occupied
 * area, split it into up to 4 non-overlapping sub-rects covering the remaining free
 * space. This is correct for arbitrary (non-top-left-aligned) occupied positions,
 * unlike guillotine splitRectangle which always assumes top-left placement.
 */
function subtractOccupied(
  freeRects: Rect[],
  ox: number, oy: number, ow: number, oh: number,
  kerf: number
): Rect[] {
  // The occupied footprint including kerf buffer (prevents adjacent cuts from being
  // placed right up against the occupied area without the kerf gap)
  const ox2 = ox + ow + kerf;
  const oy2 = oy + oh + kerf;

  const result: Rect[] = [];
  for (const fr of freeRects) {
    // No overlap — keep unchanged
    if (ox >= fr.x + fr.w || ox2 <= fr.x || oy >= fr.y + fr.h || oy2 <= fr.y) {
      result.push(fr);
      continue;
    }
    // Left strip: fr.x → ox, full height — no corner overlap with top/bottom
    if (ox > fr.x)
      result.push({ x: fr.x, y: fr.y, w: ox - fr.x, h: fr.h });
    // Right strip: ox2 → fr.x+fr.w, full height
    if (ox2 < fr.x + fr.w)
      result.push({ x: ox2, y: fr.y, w: fr.x + fr.w - ox2, h: fr.h });
    // Top/bottom strips span only the horizontal band between the left and right
    // strips — this prevents corner overlap with left/right strips
    const innerX  = Math.max(fr.x, ox);
    const innerX2 = Math.min(fr.x + fr.w, ox2);
    if (oy > fr.y && innerX < innerX2)
      result.push({ x: innerX, y: fr.y, w: innerX2 - innerX, h: oy - fr.y });
    if (oy2 < fr.y + fr.h && innerX < innerX2)
      result.push({ x: innerX, y: oy2, w: innerX2 - innerX, h: fr.y + fr.h - oy2 });
  }
  return result;
}

/**
 * Score a set of rectangles based on how useful they are for remaining cuts
 */
function scoreRectangles(rects: Rect[], remainingCuts: Cut[], kerf: number): number {
  let score = 0;

  for (const r of rects) {
    // Base score: area
    score += r.w * r.h;

    // Bonus if any remaining cuts can fit
    for (const cut of remainingCuts.slice(0, 5)) {
      if (cutFitsInRect(cut.w, cut.l, r, kerf) || cutFitsInRect(cut.l, cut.w, r, kerf)) {
        score += cut.w * cut.l * 3;
        break; // Only count first fit per rect
      }
    }
  }

  return score;
}

/**
 * Find the best placement for a cut
 */
function findBestPlacement(
  cut: Cut,
  rects: Rect[],
  kerf: number,
  remainingCuts: Cut[],
  placedCuts: PlacedCut[] = []
): Placement | null {
  let best: Placement | null = null;

  // Convert remaining cuts to simple {w, l} for scoring
  const remaining = remainingCuts.map(c => ({ w: c.w, l: c.l }));

  // Check if we already placed a cut with the same label - prefer same orientation
  const sameLabel = placedCuts.find(p => p.label === cut.label);
  const preferredRotation = sameLabel?.rot;

  // Orientation consistency penalty (very soft - only a tiebreaker, never affects sheet count)
  const ORIENTATION_PENALTY = 500;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];

    // Try normal orientation
    if (cutFitsInRect(cut.w, cut.l, r, kerf)) {
      let score = scorePlacement(cut.w, cut.l, r, kerf, remaining);
      // Add penalty if this doesn't match preferred orientation
      if (preferredRotation !== undefined && preferredRotation !== false) {
        score += ORIENTATION_PENALTY;
      }
      if (!best || score < best.score) {
        best = { rectIndex: i, rotated: false, score };
      }
    }

    // Try rotated orientation
    if (cutFitsInRect(cut.l, cut.w, r, kerf)) {
      let score = scorePlacement(cut.l, cut.w, r, kerf, remaining);
      // Add penalty if this doesn't match preferred orientation
      if (preferredRotation !== undefined && preferredRotation !== true) {
        score += ORIENTATION_PENALTY;
      }
      if (!best || score < best.score) {
        best = { rectIndex: i, rotated: true, score };
      }
    }
  }

  return best;
}

/**
 * Sort cuts for optimal packing
 * Priority: area (largest first), then longest dimension
 */
function sortCuts(cuts: Cut[]): Cut[] {
  return [...cuts].sort((a, b) => {
    // Primary: area
    const aArea = a.l * a.w;
    const bArea = b.l * b.w;
    if (bArea !== aArea) return bArea - aArea;

    // Secondary: longest dimension
    const aMax = Math.max(a.l, a.w);
    const bMax = Math.max(b.l, b.w);
    return bMax - aMax;
  });
}

/**
 * Check if a stock can fit a cut (accounting for kerf properly)
 * t=0 means "unspecified thickness" — matches any stock
 */
function stockCanFitCut(stock: Stock, cut: Cut): boolean {
  const thicknessOk =
    (stock.t ?? 0) === 0 || (cut.t ?? 0) === 0 ||
    Math.abs((stock.t ?? 0) - (cut.t ?? 0)) < 0.001;
  if (!thicknessOk) return false;
  return (cut.w <= stock.w && cut.l <= stock.l) ||
         (cut.l <= stock.w && cut.w <= stock.l);
}

/**
 * Select the best stock for remaining cuts
 */
function selectBestStock(stocks: Stock[], remainingCuts: Cut[], stockUsage: Map<number, number>): Stock | null {
  console.log('  selectBestStock called with', stocks.length, 'stocks and', remainingCuts.length, 'remaining cuts');

  if (remainingCuts.length === 0) return null;

  // Filter stocks that have remaining quantity AND can fit at least one remaining cut.
  // Using "any cut" (not just the largest) is critical when cuts have mixed thickness/
  // material: if 0.5" stock is exhausted, 0.75" stock should still be picked up for
  // the 0.75" cuts rather than aborting the whole optimization.
  const viableStocks = stocks.filter(s => {
    const used = stockUsage.get(s.id) || 0;
    const available = (s.qty ?? 1) - used;
    if (available <= 0) {
      console.log(`    Stock ${s.name} - no more available (used ${used}/${s.qty ?? 1})`);
      return false;
    }
    const canFitAny = remainingCuts.some(cut => {
      const cMat = cut.mat || '';
      const sMat = s.mat || '';
      if (cMat && sMat && cMat !== sMat) return false;
      return stockCanFitCut(s, cut);
    });
    console.log(`    Stock ${s.name} (${s.w}×${s.l}) qty:${available}/${s.qty ?? 1} canFitAny: ${canFitAny}`);
    return canFitAny;
  });

  console.log('  Viable stocks:', viableStocks.map(s => s.name));

  if (viableStocks.length === 0) return null;

  // Score each stock by how many cuts could theoretically fit
  const scored = viableStocks.map(stock => {
    let totalCutArea = 0;
    let fittableCuts = 0;

    for (const cut of remainingCuts) {
      const cMat = cut.mat || '';
      const sMat = stock.mat || '';
      if (cMat && sMat && cMat !== sMat) continue;

      if (stockCanFitCut(stock, cut)) {
        fittableCuts++;
        totalCutArea += cut.w * cut.l;
      }
    }

    const stockArea = stock.w * stock.l;
    // DON'T cap at 1 - we need to know if cuts exceed stock capacity
    const fillRatio = totalCutArea / stockArea;
    // Can all cuts potentially fit? (with ~20% margin for kerf/waste)
    const canFitAll = fillRatio <= 0.85;

    return { stock, fittableCuts, fillRatio, canFitAll, stockArea, totalCutArea };
  });

  console.log('  Stock scores:', scored.map(s =>
    `${s.stock.name}: fits=${s.fittableCuts}, fill=${(s.fillRatio * 100).toFixed(1)}%, canFitAll=${s.canFitAll}, area=${s.stockArea}`
  ));

  // Prefer stocks that can fit all remaining cuts
  // Among those, prefer highest fill ratio (least waste)
  // If none can fit all, prefer largest stock (can fit the most)
  scored.sort((a, b) => {
    // Stocks that can fit all cuts come first
    if (a.canFitAll && !b.canFitAll) return -1;
    if (b.canFitAll && !a.canFitAll) return 1;

    if (a.canFitAll && b.canFitAll) {
      // Both can fit all - prefer higher fill ratio (less waste)
      if (Math.abs(a.fillRatio - b.fillRatio) > 0.05) {
        return b.fillRatio - a.fillRatio;
      }
      // Similar fill ratio - prefer smaller stock
      return a.stockArea - b.stockArea;
    }

    // Neither can fit all - prefer larger stock (can fit more per sheet)
    return b.stockArea - a.stockArea;
  });

  console.log('  Selected:', scored[0]?.stock.name);
  return scored[0]?.stock || null;
}

/**
 * Pack cuts onto a single sheet, optionally forcing the first cut's orientation.
 * pinnedOnThisSheet: already-placed cuts that pre-occupy space (they're added as-is).
 */
function packSheet(
  stock: Stock,
  cuts: Cut[],
  kerf: number,
  forceFirstRotation?: boolean,
  pinnedOnThisSheet?: PlacedCut[]
): { sheet: Sheet; placed: Cut[]; unplaced: Cut[] } {
  const sheet: Sheet = {
    w: stock.w,
    l: stock.l,
    name: stock.name,
    mat: stock.mat,
    cuts: [],
    rects: [{ x: 0, y: 0, w: stock.w, h: stock.l }],
  };

  // Pre-occupy space for pinned parts using MaxRects-style subtraction.
  // subtractOccupied handles arbitrary positions correctly (splitRectangle would
  // only work if the pinned cut is at the top-left of a free rect).
  if (pinnedOnThisSheet && pinnedOnThisSheet.length > 0) {
    for (const pinned of pinnedOnThisSheet) {
      sheet.cuts.push(pinned);
      sheet.rects = subtractOccupied(sheet.rects, pinned.x, pinned.y, pinned.pw, pinned.ph, kerf);
      sheet.rects = mergeFreeRects(sheet.rects);
      sheet.rects.sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
    }
  }

  const placed: Cut[] = [];
  const unplaced: Cut[] = [];

  for (let i = 0; i < cuts.length; i++) {
    const c = cuts[i];
    const cMat = c.mat || '';
    const sMat = stock.mat || '';
    const thicknessOk =
      (stock.t ?? 0) === 0 || (c.t ?? 0) === 0 ||
      Math.abs((stock.t ?? 0) - (c.t ?? 0)) < 0.001;

    if ((cMat && sMat && cMat !== sMat) || !thicknessOk) {
      unplaced.push(c);
      continue;
    }

    const cutsAfterThis = cuts.slice(i + 1).concat(unplaced);
    let placement = findBestPlacement(c, sheet.rects, kerf, cutsAfterThis, sheet.cuts);

    // Force rotation for the first cut if specified
    if (i === 0 && forceFirstRotation !== undefined && placement) {
      const r = sheet.rects[placement.rectIndex];
      const wantedRotated = forceFirstRotation;

      // Check if the forced rotation fits
      const forcedW = wantedRotated ? c.l : c.w;
      const forcedH = wantedRotated ? c.w : c.l;
      if (cutFitsInRect(forcedW, forcedH, r, kerf)) {
        placement = { ...placement, rotated: wantedRotated };
      }
    }

    if (placement) {
      const r = sheet.rects[placement.rectIndex];
      const pw = placement.rotated ? c.l : c.w;
      const ph = placement.rotated ? c.w : c.l;

      sheet.cuts.push({
        ...c,
        x: r.x,
        y: r.y,
        pw,
        ph,
        rot: placement.rotated,
        instanceKey: (c as Cut & { instanceKey?: string }).instanceKey ?? makeInstanceKey(c.id, 0),
      });
      placed.push(c);

      const splits = splitRectangle(r, pw, ph, kerf);
      const remainingForScore = cuts.slice(i + 1).concat(unplaced);
      const hScore = scoreRectangles(splits.horizontal, remainingForScore, kerf);
      const vScore = scoreRectangles(splits.vertical, remainingForScore, kerf);
      const newRects = vScore > hScore ? splits.vertical : splits.horizontal;

      sheet.rects.splice(placement.rectIndex, 1, ...newRects);
      sheet.rects = mergeFreeRects(sheet.rects);
      sheet.rects.sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
    } else {
      unplaced.push(c);
    }
  }

  return { sheet, placed, unplaced };
}

/**
 * Main optimization: Guillotine with Best-Fit
 * Tries multiple strategies and picks the best result
 */
export function optimizeCuts(
  stocks: Stock[],
  cuts: Cut[],
  kerf: number
): OptimizationResult {
  console.group('🪚 Cut Optimizer - Guillotine');
  console.log('Input stocks:', stocks.map(s => `${s.name} (${s.w}×${s.l})`));
  console.log('Input cuts:', cuts.map(c => `${c.label} ${c.w}×${c.l} qty:${c.qty}`));
  console.log('Kerf:', kerf);

  const results: Sheet[] = [];
  const stockUsage = new Map<number, number>();

  // Expand cuts by quantity with stable instance keys
  const allCutsExpanded = expandCutsWithKeys(cuts);
  const allCuts = sortCuts(allCutsExpanded) as typeof allCutsExpanded;
  console.log('Sorted cuts (by area):', allCuts.map(c => `${c.label} ${c.w}×${c.l} = ${c.w * c.l} sq in`));

  let remaining: Cut[] = [...allCuts];
  let sheetCount = 0;

  while (remaining.length > 0 && sheetCount < 50) {
    const stock = selectBestStock(stocks, remaining, stockUsage);
    console.log(`Sheet ${sheetCount + 1}: Selected stock:`, stock ? `${stock.name} (${stock.w}×${stock.l})` : 'NONE');
    if (!stock) break;

    // Try both orientations for the first cut and pick the better result
    const resultNormal = packSheet(stock, remaining, kerf, false);
    const resultRotated = packSheet(stock, remaining, kerf, true);

    // Pick the one that places more cuts (or has less unplaced)
    let bestResult = resultNormal;
    if (resultRotated.placed.length > resultNormal.placed.length) {
      bestResult = resultRotated;
      console.log(`    Using rotated first cut (places ${resultRotated.placed.length} vs ${resultNormal.placed.length})`);
    } else if (resultRotated.placed.length === resultNormal.placed.length) {
      // Same number placed - prefer lower total waste
      const normalUsed = resultNormal.sheet.cuts.reduce((a, c) => a + c.pw * c.ph, 0);
      const rotatedUsed = resultRotated.sheet.cuts.reduce((a, c) => a + c.pw * c.ph, 0);
      if (rotatedUsed > normalUsed) {
        bestResult = resultRotated;
      }
    }

    // Log the placements
    for (const c of bestResult.sheet.cuts) {
      console.log(`    Placed ${c.label} (${c.pw}×${c.ph}${c.rot ? ' ROTATED' : ''}) at (${c.x}, ${c.y})`);
    }
    for (const c of bestResult.unplaced.slice(0, 3)) {
      console.log(`    ❌ Could NOT place ${c.label} (${c.w}×${c.l})`);
    }

    // Track stock usage
    stockUsage.set(stock.id, (stockUsage.get(stock.id) || 0) + 1);

    if (bestResult.sheet.cuts.length > 0) {
      results.push(bestResult.sheet);
      sheetCount++;
    }

    remaining = bestResult.unplaced;
    if (bestResult.sheet.cuts.length === 0) break;
  }

  console.log('Result:', results.length, 'sheets,', remaining.length, 'unplaced');
  console.groupEnd();

  return { sheets: results, unplaced: remaining };
}

/**
 * Shelf packing algorithm
 */
export function optimizeCutsShelf(
  stocks: Stock[],
  cuts: Cut[],
  kerf: number
): OptimizationResult {
  const results: Sheet[] = [];
  const stockUsage = new Map<number, number>();

  const allCuts = expandCutsWithKeys(cuts);

  // Sort by height for shelf packing
  allCuts.sort((a, b) => Math.max(b.l, b.w) - Math.max(a.l, a.w));

  let remaining: Cut[] = [...allCuts];
  let sheetCount = 0;

  while (remaining.length > 0 && sheetCount < 50) {
    const stock = selectBestStock(stocks, remaining, stockUsage);
    if (!stock) break;

    // Track stock usage
    stockUsage.set(stock.id, (stockUsage.get(stock.id) || 0) + 1);

    const sheet: Sheet = {
      w: stock.w,
      l: stock.l,
      name: stock.name,
      mat: stock.mat,
      cuts: [],
      rects: [],
    };

    let currentY = 0;
    let currentX = 0;
    let shelfHeight = 0;
    const left: Cut[] = [];

    for (const c of remaining) {
      const cMat = c.mat || '';
      const sMat = stock.mat || '';
      const thicknessOkShelf =
        (stock.t ?? 0) === 0 || (c.t ?? 0) === 0 ||
        Math.abs((stock.t ?? 0) - (c.t ?? 0)) < 0.001;
      if ((cMat && sMat && cMat !== sMat) || !thicknessOkShelf) {
        left.push(c);
        continue;
      }

      // Determine best orientation
      let pw = c.w;
      let ph = c.l;
      let rotated = false;

      // Try to fit in current shelf (prefer taller orientation for shelf packing)
      if (c.l > c.w) {
        pw = c.w;
        ph = c.l;
      } else {
        pw = c.l;
        ph = c.w;
        rotated = true;
      }

      // Check if we need to rotate to fit width
      if (currentX + pw > stock.w && currentX + ph <= stock.w) {
        const temp = pw;
        pw = ph;
        ph = temp;
        rotated = !rotated;
      }

      const needsKerfX = currentX > 0 ? kerf : 0;
      const needsKerfY = currentY > 0 ? kerf : 0;

      // Try current shelf
      if (currentX + needsKerfX + pw <= stock.w && currentY + needsKerfY + ph <= stock.l) {
        sheet.cuts.push({
          ...c,
          x: currentX + needsKerfX,
          y: currentY + needsKerfY,
          pw,
          ph,
          rot: rotated,
          instanceKey: (c as Cut & { instanceKey?: string }).instanceKey ?? makeInstanceKey(c.id, 0),
        });
        currentX += needsKerfX + pw;
        shelfHeight = Math.max(shelfHeight, ph);
      }
      // Try new shelf
      else if (currentY + shelfHeight + kerf + ph <= stock.l) {
        currentY += shelfHeight + kerf;
        currentX = 0;
        shelfHeight = 0;

        if (pw <= stock.w && currentY + ph <= stock.l) {
          sheet.cuts.push({
            ...c,
            x: 0,
            y: currentY,
            pw,
            ph,
            rot: rotated,
            instanceKey: (c as Cut & { instanceKey?: string }).instanceKey ?? makeInstanceKey(c.id, 0),
          });
          currentX = pw;
          shelfHeight = ph;
        } else {
          left.push(c);
        }
      } else {
        left.push(c);
      }
    }

    if (sheet.cuts.length > 0) {
      results.push(sheet);
      sheetCount++;
    }

    remaining = left;
    if (sheet.cuts.length === 0) break;
  }

  return { sheets: results, unplaced: remaining };
}

// ============================================================================
// MAXRECTS PACKING ALGORITHM
// ============================================================================

/**
 * MaxRects packing algorithm — superior to guillotine because it maintains up to
 * 4 free sub-rectangles per placement (vs 2 with guillotine), giving future cuts
 * far more fitting options. Runs MAX_EDGE and MAX_AREA strategies, picks the better.
 */
export function optimizeCutsMaxRects(
  stocks: Stock[],
  cuts: Cut[],
  kerf: number
): OptimizationResult {
  const results: Sheet[] = [];
  const stockUsage = new Map<number, number>();

  const allCuts = sortCuts(expandCutsWithKeys(cuts)) as Array<Cut & { instanceKey: string }>;

  let remaining: Cut[] = [...allCuts];
  let sheetCount = 0;

  while (remaining.length > 0 && sheetCount < 50) {
    const stock = selectBestStock(stocks, remaining, stockUsage);
    if (!stock) break;

    // Split remaining cuts into eligible (match this stock) and ineligible
    const eligible: Cut[] = [];
    const ineligible: Cut[] = [];
    for (const c of remaining) {
      const cMat = c.mat || '';
      const sMat = stock.mat || '';
      const thicknessOk =
        (stock.t ?? 0) === 0 || (c.t ?? 0) === 0 ||
        Math.abs((stock.t ?? 0) - (c.t ?? 0)) < 0.001;
      if ((cMat && sMat && cMat !== sMat) || !thicknessOk) {
        ineligible.push(c);
      } else {
        eligible.push(c);
      }
    }

    // maxrects-packer's allowRotation only picks the better-scoring orientation when
    // BOTH orientations fit — it won't rotate to make an oversized piece fit.
    // Solution: pre-rotate cuts that only fit one way, track the pre-rotation state,
    // and skip cuts that truly don't fit either way.
    interface PackerInput {
      width: number;
      height: number;
      cut: Cut;
      preRotated: boolean;
    }
    const packerInputs: PackerInput[] = [];
    const trulyIneligible: Cut[] = [];

    for (const c of eligible) {
      const normalFits  = c.w <= stock.w && c.l <= stock.l;
      const rotatedFits = c.l <= stock.w && c.w <= stock.l;
      if (normalFits) {
        packerInputs.push({ width: c.w, height: c.l, cut: c, preRotated: false });
      } else if (rotatedFits) {
        packerInputs.push({ width: c.l, height: c.w, cut: c, preRotated: true });
      } else {
        trulyIneligible.push(c);
      }
    }

    // Run MAX_EDGE and MAX_AREA strategies, keep the one placing more cuts on this sheet
    let bestPlacedOnSheet: Cut[] = [];
    let bestSheet: Sheet | null = null;

    for (const logic of [PACKING_LOGIC.MAX_EDGE, PACKING_LOGIC.MAX_AREA] as const) {
      const packer = new MaxRectsPacker(stock.w, stock.l, kerf, {
        smart: false,
        pot: false,
        square: false,
        allowRotation: true,
        logic,
      });

      for (const input of packerInputs) {
        packer.add(input.width, input.height, input);
      }

      // bins[0] is always the primary sheet bin (smart: false keeps size fixed)
      const bin = packer.bins[0];
      const placed = (bin?.rects ?? []).filter(r => !r.oversized);
      if (placed.length === 0) continue;

      if (placed.length > bestPlacedOnSheet.length) {
        bestPlacedOnSheet = placed.map(r => (r.data as PackerInput).cut);
        bestSheet = {
          w: stock.w,
          l: stock.l,
          name: stock.name,
          mat: stock.mat,
          cuts: placed.map(r => {
            const input = r.data as PackerInput;
            // r.rot means the packer additionally rotated our (possibly pre-rotated) input.
            // Overall rotation relative to original cut: preRotated XOR r.rot
            const overallRot = input.preRotated !== r.rot;
            const pw = r.width;
            const ph = r.height;
            const x = r.x;
            const y = r.y;
            return {
              ...input.cut,
              x, y, pw, ph,
              rot: overallRot,
              instanceKey: (input.cut as Cut & { instanceKey?: string }).instanceKey ?? makeInstanceKey(input.cut.id, 0),
            };
          }),
          rects: [],
        };
      }
    }

    if (bestSheet && bestPlacedOnSheet.length > 0) {
      stockUsage.set(stock.id, (stockUsage.get(stock.id) || 0) + 1);
      results.push(bestSheet);
      sheetCount++;

      const placedSet = new Set(bestPlacedOnSheet);
      remaining = [
        ...eligible.filter(c => !placedSet.has(c)),
        ...trulyIneligible,
        ...ineligible,
      ];
    } else {
      break;
    }
  }

  return { sheets: results, unplaced: remaining };
}

// ============================================================================
// BRANCH AND BOUND OPTIMAL SEARCH
// ============================================================================

interface SearchState {
  rects: Rect[];
  placed: PlacedCut[];
  remaining: Cut[];
  totalArea: number;
  usedArea: number;
}

interface SearchResult {
  placed: PlacedCut[];
  allPlaced: boolean;
}

/**
 * Check if it's still possible to fit all remaining cuts
 * Returns false if we should prune this branch
 */
function canPossiblyFitAll(state: SearchState, kerf: number): boolean {
  if (state.remaining.length === 0) return true;

  // Quick area check: can remaining cuts fit in remaining space?
  const remainingCutArea = state.remaining.reduce((sum, c) => sum + c.w * c.l, 0);
  const remainingRectArea = state.rects.reduce((sum, r) => sum + r.w * r.h, 0);

  // Need some margin for kerf waste (~15%)
  if (remainingCutArea > remainingRectArea * 1.15) {
    return false;
  }

  // Check if the largest remaining cut can fit somewhere
  const largest = state.remaining[0];
  const canFitLargest = state.rects.some(r =>
    cutFitsInRect(largest.w, largest.l, r, kerf) ||
    cutFitsInRect(largest.l, largest.w, r, kerf)
  );

  return canFitLargest;
}

/**
 * Generate all valid placements for a cut
 * Prefers consistent orientation for parts with the same label (soft constraint)
 */
function generatePlacements(
  cut: Cut,
  rects: Rect[],
  kerf: number,
  remainingCuts: Cut[],
  placedCuts: PlacedCut[] = []
): Array<{ rectIndex: number; rotated: boolean; splitDir: 'h' | 'v'; score: number }> {
  const placements: Array<{ rectIndex: number; rotated: boolean; splitDir: 'h' | 'v'; score: number }> = [];
  const remaining = remainingCuts.map(c => ({ w: c.w, l: c.l }));

  // Check if we already placed a cut with the same label - prefer same orientation
  const sameLabel = placedCuts.find(p => p.label === cut.label);
  const preferredRotation = sameLabel?.rot;

  // Orientation consistency penalty (very soft - only a tiebreaker, never affects sheet count)
  const ORIENTATION_PENALTY = 500;

  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];

    // Try normal orientation
    if (cutFitsInRect(cut.w, cut.l, r, kerf)) {
      let score = scorePlacement(cut.w, cut.l, r, kerf, remaining);
      // Add penalty if this doesn't match preferred orientation
      if (preferredRotation !== undefined && preferredRotation !== false) {
        score += ORIENTATION_PENALTY;
      }
      placements.push({ rectIndex: i, rotated: false, splitDir: 'h', score });
      placements.push({ rectIndex: i, rotated: false, splitDir: 'v', score: score + 1 });
    }

    // Try rotated orientation (only if different dimensions)
    if (cut.w !== cut.l && cutFitsInRect(cut.l, cut.w, r, kerf)) {
      let score = scorePlacement(cut.l, cut.w, r, kerf, remaining);
      // Add penalty if this doesn't match preferred orientation
      if (preferredRotation !== undefined && preferredRotation !== true) {
        score += ORIENTATION_PENALTY;
      }
      placements.push({ rectIndex: i, rotated: true, splitDir: 'h', score });
      placements.push({ rectIndex: i, rotated: true, splitDir: 'v', score: score + 1 });
    }
  }

  // Sort by score (best first) for better pruning
  placements.sort((a, b) => a.score - b.score);

  return placements;
}

/**
 * Apply a placement and return new state
 */
function applyPlacement(
  state: SearchState,
  cut: Cut,
  placement: { rectIndex: number; rotated: boolean; splitDir: 'h' | 'v' },
  kerf: number
): SearchState {
  const rect = state.rects[placement.rectIndex];
  const pw = placement.rotated ? cut.l : cut.w;
  const ph = placement.rotated ? cut.w : cut.l;

  const placedCut: PlacedCut = {
    ...cut,
    x: rect.x,
    y: rect.y,
    pw,
    ph,
    rot: placement.rotated,
    instanceKey: (cut as Cut & { instanceKey?: string }).instanceKey ?? makeInstanceKey(cut.id, 0),
  };

  // Generate splits
  const splits = splitRectangle(rect, pw, ph, kerf);
  const newRects = placement.splitDir === 'h' ? splits.horizontal : splits.vertical;

  // Create new rectangles array
  const updatedRects = [...state.rects];
  updatedRects.splice(placement.rectIndex, 1, ...newRects);

  return {
    rects: updatedRects,
    placed: [...state.placed, placedCut],
    remaining: state.remaining.slice(1), // Already sorted, just remove first
    totalArea: state.totalArea,
    usedArea: state.usedArea + pw * ph,
  };
}

/**
 * Recursive branch-and-bound search
 */
function searchOptimal(
  state: SearchState,
  kerf: number,
  bestSoFar: SearchResult,
  startTime: number,
  timeLimit: number,
  stats: { nodes: number }
): SearchResult {
  stats.nodes++;

  // Timeout check
  if (Date.now() - startTime > timeLimit) {
    return bestSoFar;
  }

  // Base case: all cuts placed!
  if (state.remaining.length === 0) {
    return { placed: state.placed, allPlaced: true };
  }

  // Pruning: can we possibly do better than best?
  if (bestSoFar.allPlaced) {
    // Already found a complete solution, no need to continue
    return bestSoFar;
  }

  // Pruning: is it still possible to fit all remaining cuts?
  if (!canPossiblyFitAll(state, kerf)) {
    // Can't fit all - but maybe we placed more than best so far
    if (state.placed.length > bestSoFar.placed.length) {
      return { placed: state.placed, allPlaced: false };
    }
    return bestSoFar;
  }

  const cut = state.remaining[0];
  const placements = generatePlacements(cut, state.rects, kerf, state.remaining.slice(1), state.placed);

  let best = bestSoFar;

  for (const placement of placements) {
    // Early exit if we found a complete solution
    if (best.allPlaced) break;

    const newState = applyPlacement(state, cut, placement, kerf);
    const result = searchOptimal(newState, kerf, best, startTime, timeLimit, stats);

    if (result.allPlaced) {
      return result; // Found complete solution, return immediately
    }

    if (result.placed.length > best.placed.length) {
      best = result;
    }
  }

  // If no placements possible for this cut, record current state
  if (placements.length === 0 && state.placed.length > best.placed.length) {
    return { placed: state.placed, allPlaced: false };
  }

  return best;
}

/**
 * Optimal cut optimizer using branch-and-bound search
 * Finds the mathematically optimal solution for small inputs
 */
export function optimizeCutsOptimal(
  stocks: Stock[],
  cuts: Cut[],
  kerf: number,
  timeLimit: number = 2000 // 2 second default timeout
): OptimizationResult {
  console.group('🎯 Cut Optimizer - Branch & Bound (Optimal)');
  console.log('Input stocks:', stocks.map(s => `${s.name} (${s.w}×${s.l})`));
  console.log('Input cuts:', cuts.map(c => `${c.label} ${c.w}×${c.l} qty:${c.qty}`));
  console.log('Kerf:', kerf);
  console.log('Time limit:', timeLimit, 'ms');

  const results: Sheet[] = [];
  const stockUsage = new Map<number, number>();

  // Expand cuts by quantity and sort by area (largest first)
  const allCuts = sortCuts(expandCutsWithKeys(cuts)) as Array<Cut & { instanceKey: string }>;

  const totalCuts = allCuts.length;
  console.log('Total cuts to place:', totalCuts);

  let remaining: Cut[] = [...allCuts];
  let sheetCount = 0;
  const startTime = Date.now();

  while (remaining.length > 0 && sheetCount < 50) {
    const stock = selectBestStock(stocks, remaining, stockUsage);
    if (!stock) break;

    console.log(`Sheet ${sheetCount + 1}: Searching optimal layout for ${stock.name} (${stock.w}×${stock.l})...`);

    // Filter to only cuts that match this stock's material and thickness.
    // Without this, B&B could place material-mismatched cuts on the sheet.
    const eligibleForStock = remaining.filter(c => {
      const cMat = c.mat || '';
      const sMat = stock.mat || '';
      if (cMat && sMat && cMat !== sMat) return false;
      const thicknessOk =
        (stock.t ?? 0) === 0 || (c.t ?? 0) === 0 ||
        Math.abs((stock.t ?? 0) - (c.t ?? 0)) < 0.001;
      return thicknessOk;
    });

    // Initial state for this sheet
    const initialState: SearchState = {
      rects: [{ x: 0, y: 0, w: stock.w, h: stock.l }],
      placed: [],
      remaining: eligibleForStock,
      totalArea: stock.w * stock.l,
      usedArea: 0,
    };

    const stats = { nodes: 0 };
    const sheetStartTime = Date.now();
    const sheetTimeLimit = Math.max(500, timeLimit - (Date.now() - startTime));

    const result = searchOptimal(
      initialState,
      kerf,
      { placed: [], allPlaced: false },
      sheetStartTime,
      sheetTimeLimit,
      stats
    );

    const elapsed = Date.now() - sheetStartTime;
    console.log(`  Searched ${stats.nodes} nodes in ${elapsed}ms`);
    console.log(`  Placed ${result.placed.length}/${remaining.length} cuts${result.allPlaced ? ' (ALL PLACED!)' : ''}`);

    if (result.placed.length > 0) {
      stockUsage.set(stock.id, (stockUsage.get(stock.id) || 0) + 1);

      const sheet: Sheet = {
        w: stock.w,
        l: stock.l,
        name: stock.name,
        mat: stock.mat,
        cuts: result.placed,
        rects: [],
      };

      results.push(sheet);
      sheetCount++;

      // Count how many of each label were placed
      const placedCount = new Map<string, number>();
      for (const p of result.placed) {
        placedCount.set(p.label, (placedCount.get(p.label) || 0) + 1);
      }

      // Remove from remaining
      const newRemaining: Cut[] = [];
      const removedCount = new Map<string, number>();
      for (const c of remaining) {
        const removed = removedCount.get(c.label) || 0;
        const toRemove = placedCount.get(c.label) || 0;
        if (removed < toRemove) {
          removedCount.set(c.label, removed + 1);
        } else {
          newRemaining.push(c);
        }
      }
      remaining = newRemaining;

      // Log placements
      for (const c of result.placed) {
        console.log(`    ✓ ${c.label} (${c.pw}×${c.ph}${c.rot ? ' ROT' : ''}) at (${c.x}, ${c.y})`);
      }
    } else {
      break;
    }

    // Check total timeout
    if (Date.now() - startTime > timeLimit) {
      console.log('  Time limit reached, stopping search');
      break;
    }
  }

  const totalElapsed = Date.now() - startTime;
  console.log(`Result: ${results.length} sheets, ${remaining.length} unplaced, ${totalElapsed}ms total`);
  console.groupEnd();

  return { sheets: results, unplaced: remaining };
}

/**
 * Compare two optimization results, return the better one
 */
function compareSolutions(
  a: OptimizationResult,
  aName: string,
  b: OptimizationResult,
  bName: string
): { result: OptimizationResult; winner: string } {
  const aStats = calculateStats(a);
  const bStats = calculateStats(b);

  // Prefer: fewer unplaced, then fewer sheets, then less waste
  if (a.unplaced.length !== b.unplaced.length) {
    return a.unplaced.length < b.unplaced.length
      ? { result: a, winner: aName }
      : { result: b, winner: bName };
  }

  if (aStats.sheets !== bStats.sheets) {
    return aStats.sheets < bStats.sheets
      ? { result: a, winner: aName }
      : { result: b, winner: bName };
  }

  return parseFloat(aStats.waste) <= parseFloat(bStats.waste)
    ? { result: a, winner: aName }
    : { result: b, winner: bName };
}

/**
 * Run all algorithms and return the best result
 */
export function optimizeCutsBest(
  stocks: Stock[],
  cuts: Cut[],
  kerf: number,
  padding: number = 0,
  pinnedPlacements: PinnedPlacement[] = [],
  sheetAssignments: SheetAssignment[] = []
): OptimizationResult {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🪵 OPTIMIZE CUTS BEST - Starting optimization');
  console.log('Kerf:', kerf, '| Padding:', padding, '| Pinned:', pinnedPlacements.length, '| Assigned:', sheetAssignments.length);
  console.log('═══════════════════════════════════════════════════════════');

  // Keys to exclude from free packing (already pinned or manually assigned)
  const pinnedKeys = new Set(pinnedPlacements.map(p => p.key));
  const assignedKeys = new Set(sheetAssignments.map(a => a.key));

  // Inflate each cut by 2×padding so the optimizer reserves clearance space.
  // After picking the best result we'll deflate back to real dimensions.
  // Pinned cuts already carry real-world positions and are not inflated.
  const effectiveCuts = padding > 0
    ? cuts.map(c => ({ ...c, l: c.l + 2 * padding, w: c.w + 2 * padding }))
    : cuts;

  // If we have pinned placements, run a single-pass guillotine per sheet
  // with pre-occupied space, then fill the rest with the best algorithm.
  if (pinnedPlacements.length > 0 || sheetAssignments.length > 0) {
    // Group pinned placements by sheet index
    const pinnedBySheet = new Map<number, PlacedCut[]>();
    for (const pp of pinnedPlacements) {
      const existing = pinnedBySheet.get(pp.sheetIndex) ?? [];
      existing.push({
        ...pp.cut,
        x: pp.x,
        y: pp.y,
        pw: pp.pw,
        ph: pp.ph,
        rot: pp.rot,
        instanceKey: pp.key,
      });
      pinnedBySheet.set(pp.sheetIndex, existing);
    }

    // Free cuts = cuts NOT in pinned or assignment sets, expanded with keys
    const pinnedCutSet = new Set([...pinnedKeys, ...assignedKeys]);
    const expandedAll = expandCutsWithKeys(effectiveCuts);
    const freeCuts = expandedAll.filter(c => !pinnedCutSet.has(c.instanceKey));

    // Sheet-constrained cuts per sheet (non-pinned)
    const assignedBySheet = new Map<number, Array<Cut & { instanceKey: string }>>();
    for (const sa of sheetAssignments) {
      const cut = expandedAll.find(c => c.instanceKey === sa.key);
      if (!cut) continue;
      const existing = assignedBySheet.get(sa.sheetIndex) ?? [];
      existing.push(cut);
      assignedBySheet.set(sa.sheetIndex, existing);
    }

    const resultSheets: Sheet[] = [];
    const stockUsage = new Map<number, number>();

    // Process pinned sheets first (they have a predetermined stock)
    const handledSheetIndices = new Set<number>();
    for (const [sheetIdx, pinnedCuts] of pinnedBySheet.entries()) {
      // Infer stock from the pinned cuts' dimensions
      // Use the first pinned cut's dimensions to infer stock, or just use the first stock
      const stock = stocks.find(s => stocks.length === 1 || s.w >= pinnedCuts[0].pw) ?? stocks[0];
      if (!stock) continue;

      // Gather cuts for this sheet: assigned + free (try to fill remaining space)
      const sheetAssigned = assignedBySheet.get(sheetIdx) ?? [];
      const cutsForThisSheet = [...sheetAssigned, ...freeCuts];

      const used = (stockUsage.get(stock.id) || 0);
      if (used < (stock.qty ?? 1)) {
        stockUsage.set(stock.id, used + 1);
      }

      const { sheet, placed } = packSheet(stock, cutsForThisSheet, kerf, undefined, pinnedCuts);
      resultSheets.push(sheet);
      handledSheetIndices.add(sheetIdx);

      // Remove placed cuts from freeCuts
      const placedKeys = new Set(placed.map(c => (c as Cut & { instanceKey?: string }).instanceKey));
      freeCuts.splice(0, freeCuts.length, ...freeCuts.filter(c => !placedKeys.has(c.instanceKey)));
    }

    // Pack remaining free cuts with best algorithm
    if (freeCuts.length > 0) {
      // Re-aggregate free cuts back into qty>1 form for the algorithms
      // (they re-expand internally via expandCutsWithKeys)
      // Since freeCuts are already expanded, pass them as qty=1 each
      const freeResult = optimizeCutsBest(stocks, freeCuts, kerf, 0, [], []);
      resultSheets.push(...freeResult.sheets);

      const deflated = padding > 0
        ? {
          sheets: resultSheets.map(sheet => ({
            ...sheet,
            cuts: sheet.cuts.map(pc => {
              if (pinnedKeys.has(pc.instanceKey)) return pc; // don't deflate pinned
              const orig = cuts.find(c => c.id === pc.id);
              return orig ? {
                ...pc,
                l: orig.l, w: orig.w,
                x: pc.x + padding, y: pc.y + padding,
                pw: pc.pw - 2 * padding, ph: pc.ph - 2 * padding,
              } : pc;
            }),
          })),
          unplaced: freeResult.unplaced,
        }
        : { sheets: resultSheets, unplaced: freeResult.unplaced };

      return deflated;
    }

    return { sheets: resultSheets, unplaced: [] };
  }

  // ── Standard path (no pinned placements) ──────────────────────────────────
  // Count total cuts
  const totalCuts = effectiveCuts.reduce((sum, c) => sum + c.qty, 0);

  // Run all algorithms
  const guillotine = optimizeCuts(stocks, effectiveCuts, kerf);
  const shelf = optimizeCutsShelf(stocks, effectiveCuts, kerf);
  const maxrects = optimizeCutsMaxRects(stocks, effectiveCuts, kerf);

  // Branch-and-bound is exponential — only useful for small inputs
  const timeLimit = totalCuts <= 10 ? 3000 : 2000;
  const optimal = totalCuts <= 15
    ? optimizeCutsOptimal(stocks, effectiveCuts, kerf, timeLimit)
    : null;

  const gStats = calculateStats(guillotine);
  const sStats = calculateStats(shelf);
  const mStats = calculateStats(maxrects);

  console.log('Guillotine result:', gStats.sheets, 'sheets,', gStats.waste + '% waste,', guillotine.unplaced.length, 'unplaced');
  console.log('Shelf result:', sStats.sheets, 'sheets,', sStats.waste + '% waste,', shelf.unplaced.length, 'unplaced');
  console.log('MaxRects result:', mStats.sheets, 'sheets,', mStats.waste + '% waste,', maxrects.unplaced.length, 'unplaced');
  if (optimal) {
    const oStats = calculateStats(optimal);
    console.log('Optimal result:', oStats.sheets, 'sheets,', oStats.waste + '% waste,', optimal.unplaced.length, 'unplaced');
  }

  // Compare all algorithms and pick the best
  let { result, winner } = compareSolutions(guillotine, 'guillotine', shelf, 'shelf');
  ({ result, winner } = compareSolutions(result, winner, maxrects, 'maxrects'));
  if (optimal) {
    ({ result, winner } = compareSolutions(result, winner, optimal, 'optimal'));
  }

  console.log('Winner:', winner);
  console.log('═══════════════════════════════════════════════════════════');

  // Deflate placements back to real dimensions: shift x/y inward by padding,
  // shrink pw/ph, and restore original l/w on each placed cut.
  if (padding > 0) {
    const origById = new Map(cuts.map(c => [c.id, c]));
    result = {
      sheets: result.sheets.map(sheet => ({
        ...sheet,
        cuts: sheet.cuts.map(pc => {
          const orig = origById.get(pc.id)!;
          return {
            ...pc,
            l: orig.l,
            w: orig.w,
            x: pc.x + padding,
            y: pc.y + padding,
            pw: pc.pw - 2 * padding,
            ph: pc.ph - 2 * padding,
          };
        }),
      })),
      unplaced: result.unplaced.map(c => {
        const orig = origById.get(c.id);
        return orig ? { ...c, l: orig.l, w: orig.w } : c;
      }),
    };
  }

  return result;
}

export function calculateStats(result: OptimizationResult) {
  let total = 0;
  let used = 0;

  result.sheets.forEach(s => {
    total += s.l * s.w;
    used += s.cuts.reduce((a, c) => a + c.pw * c.ph, 0);
  });

  return {
    sheets: result.sheets.length,
    used,
    total,
    waste: total > 0 ? ((total - used) / total * 100).toFixed(1) : '0',
    unplaced: result.unplaced.length,
  };
}
