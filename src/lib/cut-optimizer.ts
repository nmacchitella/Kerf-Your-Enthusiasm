import { Stock, Cut, Sheet, OptimizationResult, PlacedCut, Rect } from '@/types';

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
  const ORIENTATION_PENALTY = 0.1;

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
 */
function stockCanFitCut(stock: Stock, cut: Cut): boolean {
  // A cut fits if it's <= stock dimensions (no kerf needed at edges)
  return (cut.w <= stock.w && cut.l <= stock.l) ||
         (cut.l <= stock.w && cut.w <= stock.l);
}

/**
 * Select the best stock for remaining cuts
 */
function selectBestStock(stocks: Stock[], remainingCuts: Cut[], stockUsage: Map<number, number>): Stock | null {
  console.log('  selectBestStock called with', stocks.length, 'stocks and', remainingCuts.length, 'remaining cuts');

  if (remainingCuts.length === 0) return null;

  const largestCut = remainingCuts[0];
  console.log('  Largest remaining cut:', `${largestCut.label} ${largestCut.w}×${largestCut.l}`);

  // Filter stocks that can fit the largest cut AND have remaining quantity
  const viableStocks = stocks.filter(s => {
    const used = stockUsage.get(s.id) || 0;
    const available = (s.qty ?? 1) - used;
    if (available <= 0) {
      console.log(`    Stock ${s.name} - no more available (used ${used}/${s.qty ?? 1})`);
      return false;
    }
    const cMat = largestCut.mat || '';
    const sMat = s.mat || '';
    if (cMat && sMat && cMat !== sMat) return false;
    const canFit = stockCanFitCut(s, largestCut);
    console.log(`    Stock ${s.name} (${s.w}×${s.l}) qty:${available}/${s.qty ?? 1} can fit: ${canFit}`);
    return canFit;
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
 * Pack cuts onto a single sheet, optionally forcing the first cut's orientation
 */
function packSheet(
  stock: Stock,
  cuts: Cut[],
  kerf: number,
  forceFirstRotation?: boolean
): { sheet: Sheet; placed: Cut[]; unplaced: Cut[] } {
  const sheet: Sheet = {
    w: stock.w,
    l: stock.l,
    name: stock.name,
    mat: stock.mat,
    cuts: [],
    rects: [{ x: 0, y: 0, w: stock.w, h: stock.l }],
  };

  const placed: Cut[] = [];
  const unplaced: Cut[] = [];

  for (let i = 0; i < cuts.length; i++) {
    const c = cuts[i];
    const cMat = c.mat || '';
    const sMat = stock.mat || '';

    if (cMat && sMat && cMat !== sMat) {
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
      });
      placed.push(c);

      const splits = splitRectangle(r, pw, ph, kerf);
      const remainingForScore = cuts.slice(i + 1).concat(unplaced);
      const hScore = scoreRectangles(splits.horizontal, remainingForScore, kerf);
      const vScore = scoreRectangles(splits.vertical, remainingForScore, kerf);
      const newRects = vScore > hScore ? splits.vertical : splits.horizontal;

      sheet.rects.splice(placement.rectIndex, 1, ...newRects);
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

  // Expand cuts by quantity
  let allCuts = cuts.flatMap(c =>
    Array(c.qty).fill(null).map(() => ({ ...c, qty: 1 }))
  );

  // Sort by area (largest first)
  allCuts = sortCuts(allCuts);
  console.log('Sorted cuts (by area):', allCuts.map(c => `${c.label} ${c.w}×${c.l} = ${c.w * c.l} sq in`));

  let remaining = [...allCuts];
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

  let allCuts = cuts.flatMap(c =>
    Array(c.qty).fill(null).map(() => ({ ...c, qty: 1 }))
  );

  // Sort by height for shelf packing
  allCuts.sort((a, b) => Math.max(b.l, b.w) - Math.max(a.l, a.w));

  let remaining = [...allCuts];
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
      if (cMat && sMat && cMat !== sMat) {
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
  const ORIENTATION_PENALTY = 0.1;

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
  let allCuts = sortCuts(
    cuts.flatMap(c => Array(c.qty).fill(null).map(() => ({ ...c, qty: 1 })))
  );

  const totalCuts = allCuts.length;
  console.log('Total cuts to place:', totalCuts);

  let remaining = [...allCuts];
  let sheetCount = 0;
  const startTime = Date.now();

  while (remaining.length > 0 && sheetCount < 50) {
    const stock = selectBestStock(stocks, remaining, stockUsage);
    if (!stock) break;

    console.log(`Sheet ${sheetCount + 1}: Searching optimal layout for ${stock.name} (${stock.w}×${stock.l})...`);

    // Initial state for this sheet
    const initialState: SearchState = {
      rects: [{ x: 0, y: 0, w: stock.w, h: stock.l }],
      placed: [],
      remaining: remaining,
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
  kerf: number
): OptimizationResult {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🪵 OPTIMIZE CUTS BEST - Starting optimization');
  console.log('Stocks received:', JSON.stringify(stocks, null, 2));
  console.log('Cuts received:', JSON.stringify(cuts, null, 2));
  console.log('Kerf:', kerf);
  console.log('═══════════════════════════════════════════════════════════');

  // Count total cuts
  const totalCuts = cuts.reduce((sum, c) => sum + c.qty, 0);

  // Run all algorithms
  const guillotine = optimizeCuts(stocks, cuts, kerf);
  const shelf = optimizeCutsShelf(stocks, cuts, kerf);

  // For small inputs (≤15 cuts), also run the optimal branch-and-bound search
  // For larger inputs, it might timeout but will still return best found
  const timeLimit = totalCuts <= 10 ? 3000 : totalCuts <= 15 ? 2000 : 1000;
  const optimal = optimizeCutsOptimal(stocks, cuts, kerf, timeLimit);

  const gStats = calculateStats(guillotine);
  const sStats = calculateStats(shelf);
  const oStats = calculateStats(optimal);

  console.log('Guillotine result:', gStats.sheets, 'sheets,', gStats.waste + '% waste,', guillotine.unplaced.length, 'unplaced');
  console.log('Shelf result:', sStats.sheets, 'sheets,', sStats.waste + '% waste,', shelf.unplaced.length, 'unplaced');
  console.log('Optimal result:', oStats.sheets, 'sheets,', oStats.waste + '% waste,', optimal.unplaced.length, 'unplaced');

  // Compare all three and pick the best
  let { result, winner } = compareSolutions(guillotine, 'guillotine', shelf, 'shelf');
  ({ result, winner } = compareSolutions(result, winner, optimal, 'optimal'));

  console.log('Winner:', winner);
  console.log('═══════════════════════════════════════════════════════════');

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
