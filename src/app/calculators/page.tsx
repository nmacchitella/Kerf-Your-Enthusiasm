'use client';

import { useState } from 'react';
import { Card, Result } from '@/components/ui/Card';
import {
  toFraction,
  calculateFraction,
  calculateAngle,
  calculateHypotenuse,
  calculateShelfSpacing,
  calculateTaperPerSide,
  calculateTaperAngle,
  calculateBoardFeet,
  estimateWoodMovement,
} from '@/lib/fraction-utils';
import { FRACTION_REFERENCE, PHI } from '@/lib/constants';
import {
  FractionState,
  BoardFeetState,
  AngleState,
  ShelfState,
  TaperState,
} from '@/types';

const inputCls =
  'bg-stone-800 border border-stone-700 rounded px-2 py-1.5 text-sm focus:border-amber-500 outline-none';

export default function CalculatorsPage() {
  const [bf, setBf] = useState<BoardFeetState>({ t: 1, w: 6, l: 8, p: 8 });
  const [frac, setFrac] = useState<FractionState>({
    w1: 0,
    n1: 1,
    d1: 2,
    op: '+',
    w2: 0,
    n2: 1,
    d2: 4,
  });
  const [gold, setGold] = useState(100);
  const [angle, setAngle] = useState<AngleState>({ rise: 6, run: 12 });
  const [shelf, setShelf] = useState<ShelfState>({ h: 72, n: 5, t: 0.75 });
  const [taper, setTaper] = useState<TaperState>({ top: 2, bot: 4, len: 24 });
  const [mvWidth, setMvWidth] = useState(12);
  const [mvMoisture, setMvMoisture] = useState(4);

  const bfVal = calculateBoardFeet(bf.t, bf.w, bf.l);
  const fracVal = calculateFraction(frac);
  const angleDeg = calculateAngle(angle.rise, angle.run);
  const hyp = calculateHypotenuse(angle.rise, angle.run);
  const shelfSpace = calculateShelfSpacing(shelf.h, shelf.n, shelf.t);
  const taperSide = calculateTaperPerSide(taper.top, taper.bot);
  const taperAng = calculateTaperAngle(taper.top, taper.bot, taper.len);
  const woodMovement = estimateWoodMovement(mvWidth, mvMoisture);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* Board Feet */}
      <Card title="Board Feet">
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            step="0.25"
            value={bf.t}
            onChange={(e) => setBf({ ...bf, t: parseFloat(e.target.value) || 0 })}
            className={inputCls}
            placeholder="Thickness"
          />
          <input
            type="number"
            step="0.25"
            value={bf.w}
            onChange={(e) => setBf({ ...bf, w: parseFloat(e.target.value) || 0 })}
            className={inputCls}
            placeholder="Width"
          />
          <input
            type="number"
            step="0.5"
            value={bf.l}
            onChange={(e) => setBf({ ...bf, l: parseFloat(e.target.value) || 0 })}
            className={inputCls}
            placeholder="Length (ft)"
          />
          <input
            type="number"
            step="0.5"
            value={bf.p}
            onChange={(e) => setBf({ ...bf, p: parseFloat(e.target.value) || 0 })}
            className={inputCls}
            placeholder="$/BF"
          />
        </div>
        <Result label="Board Feet" value={`${bfVal.toFixed(2)} BF`} />
        <Result label="Cost" value={`$${(bfVal * bf.p).toFixed(2)}`} />
      </Card>

      {/* Fraction Math */}
      <Card title="Fraction Math">
        <div className="flex items-center gap-1 flex-wrap">
          <input
            type="number"
            value={frac.w1}
            onChange={(e) => setFrac({ ...frac, w1: parseInt(e.target.value) || 0 })}
            className={`${inputCls} w-10 text-center`}
          />
          <div className="flex flex-col">
            <input
              type="number"
              value={frac.n1}
              onChange={(e) =>
                setFrac({ ...frac, n1: parseInt(e.target.value) || 0 })
              }
              className={`${inputCls} w-10 text-center text-xs rounded-b-none`}
            />
            <input
              type="number"
              value={frac.d1}
              onChange={(e) =>
                setFrac({ ...frac, d1: parseInt(e.target.value) || 1 })
              }
              className={`${inputCls} w-10 text-center text-xs rounded-t-none border-t-0`}
            />
          </div>
          <select
            value={frac.op}
            onChange={(e) =>
              setFrac({ ...frac, op: e.target.value as FractionState['op'] })
            }
            className={`${inputCls} w-12 text-amber-400 font-bold`}
          >
            <option>+</option>
            <option>-</option>
            <option>×</option>
            <option>÷</option>
          </select>
          <input
            type="number"
            value={frac.w2}
            onChange={(e) => setFrac({ ...frac, w2: parseInt(e.target.value) || 0 })}
            className={`${inputCls} w-10 text-center`}
          />
          <div className="flex flex-col">
            <input
              type="number"
              value={frac.n2}
              onChange={(e) =>
                setFrac({ ...frac, n2: parseInt(e.target.value) || 0 })
              }
              className={`${inputCls} w-10 text-center text-xs rounded-b-none`}
            />
            <input
              type="number"
              value={frac.d2}
              onChange={(e) =>
                setFrac({ ...frac, d2: parseInt(e.target.value) || 1 })
              }
              className={`${inputCls} w-10 text-center text-xs rounded-t-none border-t-0`}
            />
          </div>
        </div>
        <Result label="Result" value={`${toFraction(fracVal)}"`} />
        <div className="text-right text-xs text-stone-500 mt-1">
          = {fracVal.toFixed(4)}&quot;
        </div>
      </Card>

      {/* Golden Ratio */}
      <Card title="Golden Ratio (φ = 1.618)">
        <input
          type="number"
          step="0.5"
          value={gold}
          onChange={(e) => setGold(parseFloat(e.target.value) || 0)}
          className={`${inputCls} w-full`}
          placeholder="Known dimension"
        />
        <Result label="Larger" value={`${(gold * PHI).toFixed(2)}"`} />
        <Result label="Smaller" value={`${(gold / PHI).toFixed(2)}"`} />
      </Card>

      {/* Angle & Slope */}
      <Card title="Angle & Slope">
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            value={angle.rise}
            onChange={(e) =>
              setAngle({ ...angle, rise: parseFloat(e.target.value) || 0 })
            }
            className={inputCls}
            placeholder="Rise"
          />
          <input
            type="number"
            value={angle.run}
            onChange={(e) =>
              setAngle({ ...angle, run: parseFloat(e.target.value) || 0 })
            }
            className={inputCls}
            placeholder="Run"
          />
        </div>
        <Result label="Angle" value={`${angleDeg.toFixed(2)}°`} />
        <Result label="Hypotenuse" value={`${hyp.toFixed(3)}"`} />
      </Card>

      {/* Shelf Spacing */}
      <Card title="Shelf Spacing">
        <div className="grid grid-cols-3 gap-2">
          <input
            type="number"
            value={shelf.h}
            onChange={(e) =>
              setShelf({ ...shelf, h: parseFloat(e.target.value) || 0 })
            }
            className={inputCls}
            placeholder="Height"
          />
          <input
            type="number"
            value={shelf.n}
            onChange={(e) =>
              setShelf({ ...shelf, n: parseInt(e.target.value) || 1 })
            }
            className={inputCls}
            placeholder="# Shelves"
          />
          <input
            type="number"
            step="0.125"
            value={shelf.t}
            onChange={(e) =>
              setShelf({ ...shelf, t: parseFloat(e.target.value) || 0 })
            }
            className={inputCls}
            placeholder="Thickness"
          />
        </div>
        <Result label="Spacing" value={`${shelfSpace.toFixed(2)}"`} />
      </Card>

      {/* Taper Jig */}
      <Card title="Taper Jig">
        <div className="grid grid-cols-3 gap-2">
          <input
            type="number"
            step="0.125"
            value={taper.top}
            onChange={(e) =>
              setTaper({ ...taper, top: parseFloat(e.target.value) || 0 })
            }
            className={inputCls}
            placeholder="Top W"
          />
          <input
            type="number"
            step="0.125"
            value={taper.bot}
            onChange={(e) =>
              setTaper({ ...taper, bot: parseFloat(e.target.value) || 0 })
            }
            className={inputCls}
            placeholder="Bottom W"
          />
          <input
            type="number"
            value={taper.len}
            onChange={(e) =>
              setTaper({ ...taper, len: parseFloat(e.target.value) || 0 })
            }
            className={inputCls}
            placeholder="Length"
          />
        </div>
        <Result label="Taper/side" value={`${taperSide.toFixed(3)}"`} />
        <Result label="Angle" value={`${taperAng.toFixed(2)}°`} />
      </Card>

      {/* Fraction Reference */}
      <Card title="Fraction Reference">
        <div className="grid grid-cols-4 gap-1 text-xs">
          {FRACTION_REFERENCE.map(([f, d]) => (
            <div
              key={f}
              className="flex justify-between bg-stone-700/50 rounded px-1 py-0.5"
            >
              <span className="text-amber-400">{f}</span>
              <span className="text-stone-400">{d}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Wood Movement */}
      <Card title="Wood Movement">
        <p className="text-xs text-stone-500 mb-2">
          Flat-sawn moves ~0.25% per 1% moisture change
        </p>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            placeholder="Width (in)"
            value={mvWidth}
            onChange={(e) => setMvWidth(parseFloat(e.target.value) || 0)}
            className={inputCls}
          />
          <input
            type="number"
            placeholder="Δ Moisture %"
            value={mvMoisture}
            onChange={(e) => setMvMoisture(parseFloat(e.target.value) || 0)}
            className={inputCls}
          />
        </div>
        <Result label="Est. movement" value={`±${woodMovement.toFixed(3)}"`} />
      </Card>
    </div>
  );
}
