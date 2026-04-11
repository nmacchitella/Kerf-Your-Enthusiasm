import { UnitSystem } from '@/types';

export const MM_PER_INCH = 25.4;

export const mmToIn = (mm: number): number => mm / MM_PER_INCH;
export const inToMM = (inches: number): number => inches * MM_PER_INCH;

export function convertDim(val: number, from: UnitSystem, to: UnitSystem): number {
  if (from === to) return val;
  return from === 'mm' ? mmToIn(val) : inToMM(val);
}
