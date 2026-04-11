'use client';

import { createContext, useContext, useState, ReactNode } from 'react';
import { UnitSystem } from '@/types';
import { mmToIn, inToMM } from '@/lib/unit-utils';

interface UnitContextValue {
  units: UnitSystem;
  setUnits: (u: UnitSystem) => void;
  display: (val: number, projectUnits?: UnitSystem) => number;
  label: string;
}

const UnitContext = createContext<UnitContextValue>({
  units: 'in',
  setUnits: () => {},
  display: (v) => v,
  label: 'in',
});

export function UnitProvider({
  children,
  defaultUnits = 'in',
}: {
  children: ReactNode;
  defaultUnits?: UnitSystem;
}) {
  const [units, setUnits] = useState<UnitSystem>(defaultUnits);

  const display = (val: number, projectUnits: UnitSystem = units): number => {
    if (projectUnits === units) return val;
    if (projectUnits === 'in' && units === 'mm') return inToMM(val);
    return mmToIn(val);
  };

  return (
    <UnitContext.Provider value={{ units, setUnits, display, label: units }}>
      {children}
    </UnitContext.Provider>
  );
}

export function useUnits() {
  return useContext(UnitContext);
}

export function useDisplayDim(valInProjectUnits: number, projectUnits: UnitSystem, displayUnits: UnitSystem): number {
  if (projectUnits === displayUnits) return valInProjectUnits;
  if (projectUnits === 'in' && displayUnits === 'mm') return inToMM(valInProjectUnits);
  return mmToIn(valInProjectUnits);
}
