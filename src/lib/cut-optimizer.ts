import { Stock, Cut, Sheet, OptimizationResult, Rect } from '@/types';

export function optimizeCuts(
  stocks: Stock[],
  cuts: Cut[],
  kerf: number
): OptimizationResult {
  const results: Sheet[] = [];

  // Expand cuts by quantity and sort by area (largest first)
  let allCuts = cuts.flatMap((c) =>
    Array(c.qty).fill(null).map(() => ({ ...c, qty: 1 }))
  );
  allCuts.sort((a, b) => b.l * b.w - a.l * a.w);

  let remaining = [...allCuts];
  let sheetCount = 0;

  while (remaining.length > 0 && sheetCount < 50) {
    // Find a stock that can fit at least one remaining cut
    let stock: Stock | null = null;
    for (const c of remaining) {
      for (const s of stocks) {
        const cMat = c.mat || '';
        const sMat = s.mat || '';
        if (cMat && sMat && cMat !== sMat) continue;

        // Check if cut fits (either orientation)
        if ((c.w <= s.w && c.l <= s.l) || (c.l <= s.w && c.w <= s.l)) {
          stock = s;
          break;
        }
      }
      if (stock) break;
    }

    if (!stock) break;

    // Create a new sheet
    const sheet: Sheet = {
      w: stock.w,
      l: stock.l,
      name: stock.name,
      mat: stock.mat,
      cuts: [],
      rects: [{ x: 0, y: 0, w: stock.w, h: stock.l }],
    };

    const left: Cut[] = [];

    for (const c of remaining) {
      const cMat = c.mat || '';
      const sMat = stock.mat || '';

      // Skip if material doesn't match
      if (cMat && sMat && cMat !== sMat) {
        left.push(c);
        continue;
      }

      let placed = false;

      // Try to place in each available rectangle
      for (let i = 0; i < sheet.rects.length && !placed; i++) {
        const r = sheet.rects[i];
        const fits = c.w + kerf <= r.w && c.l + kerf <= r.h;
        const fitsRotated = c.l + kerf <= r.w && c.w + kerf <= r.h;

        if (fits || fitsRotated) {
          const rotated = !fits && fitsRotated;
          const pw = rotated ? c.l : c.w;
          const ph = rotated ? c.w : c.l;

          // Place the cut
          sheet.cuts.push({
            ...c,
            x: r.x,
            y: r.y,
            pw,
            ph,
            rot: rotated,
          });

          // Remove used rectangle
          sheet.rects.splice(i, 1);

          // Add remaining rectangles (guillotine cut)
          if (r.w - pw - kerf > 0) {
            sheet.rects.push({
              x: r.x + pw + kerf,
              y: r.y,
              w: r.w - pw - kerf,
              h: ph,
            });
          }
          if (r.h - ph - kerf > 0) {
            sheet.rects.push({
              x: r.x,
              y: r.y + ph + kerf,
              w: r.w,
              h: r.h - ph - kerf,
            });
          }

          placed = true;
        }
      }

      if (!placed) {
        left.push(c);
      }
    }

    if (sheet.cuts.length > 0) {
      results.push(sheet);
      sheetCount++;
    }

    remaining = left;

    // Break if we couldn't place anything
    if (sheet.cuts.length === 0) break;
  }

  return { sheets: results, unplaced: remaining };
}

export function calculateStats(result: OptimizationResult) {
  let total = 0;
  let used = 0;

  result.sheets.forEach((s) => {
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
