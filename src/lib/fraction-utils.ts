import { FractionState } from '@/types';

/**
 * Convert a decimal to a fraction string (using common woodworking denominators)
 */
export function toFraction(d: number): string {
  if (!isFinite(d)) return '0';

  const whole = Math.floor(Math.abs(d));
  const dec = Math.abs(d) - whole;
  const denoms = [1, 2, 4, 8, 16, 32];

  let best = { n: 0, d: 1, err: dec };

  for (const den of denoms) {
    const n = Math.round(dec * den);
    const err = Math.abs(dec - n / den);
    if (err < best.err) {
      best = { n, d: den, err };
    }
  }

  const sign = d < 0 ? '-' : '';

  if (best.n === 0) return sign + whole.toString();
  if (whole === 0) return `${sign}${best.n}/${best.d}`;
  return `${sign}${whole} ${best.n}/${best.d}`;
}

/**
 * Calculate the result of a fraction operation
 */
export function calculateFraction(state: FractionState): number {
  const f1 = state.w1 + state.n1 / state.d1;
  const f2 = state.w2 + state.n2 / state.d2;

  switch (state.op) {
    case '+':
      return f1 + f2;
    case '-':
      return f1 - f2;
    case '×':
      return f1 * f2;
    case '÷':
      return f2 !== 0 ? f1 / f2 : 0;
    default:
      return 0;
  }
}

/**
 * Calculate angle in degrees from rise and run
 */
export function calculateAngle(rise: number, run: number): number {
  return Math.atan2(rise, run) * (180 / Math.PI);
}

/**
 * Calculate hypotenuse from rise and run
 */
export function calculateHypotenuse(rise: number, run: number): number {
  return Math.sqrt(rise ** 2 + run ** 2);
}

/**
 * Calculate shelf spacing
 */
export function calculateShelfSpacing(
  height: number,
  numShelves: number,
  thickness: number
): number {
  return (height - numShelves * thickness) / (numShelves + 1);
}

/**
 * Calculate taper per side
 */
export function calculateTaperPerSide(topWidth: number, bottomWidth: number): number {
  return (bottomWidth - topWidth) / 2;
}

/**
 * Calculate taper angle in degrees
 */
export function calculateTaperAngle(
  topWidth: number,
  bottomWidth: number,
  length: number
): number {
  const taperSide = calculateTaperPerSide(topWidth, bottomWidth);
  return Math.atan2(taperSide, length) * (180 / Math.PI);
}

/**
 * Calculate board feet
 */
export function calculateBoardFeet(
  thickness: number,
  width: number,
  lengthFeet: number
): number {
  return (thickness * width * lengthFeet) / 144;
}

/**
 * Estimate wood movement based on width and moisture change
 * Flat-sawn wood moves approximately 0.25% per 1% moisture change
 */
export function estimateWoodMovement(width: number, moistureChange: number): number {
  return width * moistureChange * 0.0025;
}
