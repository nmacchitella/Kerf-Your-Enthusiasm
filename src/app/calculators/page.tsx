'use client';

import { useState } from 'react';
import { Result } from '@/components/ui/Card';
import {
  toFraction,
  calculateFraction,
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
  'bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm text-slate-800 focus:border-slate-400 outline-none transition-colors';

const calculators = [
  { id: 'board-feet', name: 'Board Feet', desc: 'Calculate lumber volume and cost' },
  { id: 'fraction', name: 'Fraction Math', desc: 'Add, subtract, multiply, divide fractions' },
  { id: 'golden', name: 'Golden Ratio', desc: 'Find proportional dimensions using φ' },
  { id: 'angle', name: 'Angle & Slope', desc: 'Right triangle calculator — any two values' },
  { id: 'shelf', name: 'Shelf Spacing', desc: 'Even shelf placement in a cabinet' },
  { id: 'taper', name: 'Taper Jig', desc: 'Calculate taper cuts for legs' },
  { id: 'reference', name: 'Fraction Reference', desc: 'Quick decimal-to-fraction lookup' },
  { id: 'movement', name: 'Wood Movement', desc: 'Estimate seasonal expansion' },
] as const;

type CalculatorId = (typeof calculators)[number]['id'];

export default function CalculatorsPage() {
  const [active, setActive] = useState<CalculatorId>('board-feet');
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
  const [angleMode, setAngleMode] = useState<'rise-run' | 'angle-rise' | 'angle-run' | 'angle-hyp'>('rise-run');
  const [angleDegInput, setAngleDegInput] = useState(26.57);
  const [hypInput, setHypInput] = useState(13.42);
  const [shelf, setShelf] = useState<ShelfState>({ h: 72, n: 5, t: 0.75 });
  const [taper, setTaper] = useState<TaperState>({ top: 2, bot: 4, len: 24 });
  const [mvWidth, setMvWidth] = useState(12);
  const [mvMoisture, setMvMoisture] = useState(4);

  const bfVal = calculateBoardFeet(bf.t, bf.w, bf.l);
  const fracVal = calculateFraction(frac);
  const shelfSpace = calculateShelfSpacing(shelf.h, shelf.n, shelf.t);
  const taperSide = calculateTaperPerSide(taper.top, taper.bot);
  const taperAng = calculateTaperAngle(taper.top, taper.bot, taper.len);
  const woodMovement = estimateWoodMovement(mvWidth, mvMoisture);

  const activeCalc = calculators.find((c) => c.id === active)!;

  return (
    <div className="pt-6 flex flex-col lg:flex-row gap-6">
      {/* Sidebar Navigation */}
      <nav className="lg:w-64 flex-shrink-0">
        <div className="bg-white rounded-md p-2 shadow-sm border border-slate-200 space-y-1">
          {calculators.map((calc) => (
            <button
              key={calc.id}
              onClick={() => setActive(calc.id)}
              className={`w-full text-left px-3 py-2.5 rounded transition-colors ${
                active === calc.id
                  ? 'bg-slate-100 text-slate-800 border-l-2 border-slate-600'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              <div className="font-medium text-sm">{calc.name}</div>
              <div className="text-xs text-slate-400 mt-0.5">{calc.desc}</div>
            </button>
          ))}
        </div>
      </nav>

      {/* Main Calculator Area */}
      <div className="flex-1 max-w-xl">
        <div className="mb-4">
          <h2 className="text-xl font-medium text-slate-800">{activeCalc.name}</h2>
          <p className="text-slate-500 text-sm">{activeCalc.desc}</p>
        </div>

        <div className="bg-white rounded-md p-6 shadow-sm border border-slate-200">
          {active === 'board-feet' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Thickness (in)</label>
                  <input
                    type="number"
                    step="0.25"
                    value={bf.t}
                    onChange={(e) => setBf({ ...bf, t: parseFloat(e.target.value) || 0 })}
                    className={inputCls + ' w-full'}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Width (in)</label>
                  <input
                    type="number"
                    step="0.25"
                    value={bf.w}
                    onChange={(e) => setBf({ ...bf, w: parseFloat(e.target.value) || 0 })}
                    className={inputCls + ' w-full'}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Length (ft)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={bf.l}
                    onChange={(e) => setBf({ ...bf, l: parseFloat(e.target.value) || 0 })}
                    className={inputCls + ' w-full'}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Price ($/BF)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={bf.p}
                    onChange={(e) => setBf({ ...bf, p: parseFloat(e.target.value) || 0 })}
                    className={inputCls + ' w-full'}
                  />
                </div>
              </div>
              <div className="border-t border-slate-200 pt-4 space-y-2">
                <Result label="Board Feet" value={`${bfVal.toFixed(2)} BF`} />
                <Result label="Total Cost" value={`$${(bfVal * bf.p).toFixed(2)}`} />
              </div>
            </div>
          )}

          {active === 'fraction' && (
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <input
                  type="number"
                  value={frac.w1}
                  onChange={(e) => setFrac({ ...frac, w1: parseInt(e.target.value) || 0 })}
                  className={`${inputCls} w-12 text-center`}
                  title="Whole number"
                />
                <div className="flex flex-col">
                  <input
                    type="number"
                    value={frac.n1}
                    onChange={(e) => setFrac({ ...frac, n1: parseInt(e.target.value) || 0 })}
                    className={`${inputCls} w-12 text-center text-xs rounded-b-none`}
                    title="Numerator"
                  />
                  <input
                    type="number"
                    value={frac.d1}
                    onChange={(e) => setFrac({ ...frac, d1: parseInt(e.target.value) || 1 })}
                    className={`${inputCls} w-12 text-center text-xs rounded-t-none border-t-0`}
                    title="Denominator"
                  />
                </div>
                <select
                  value={frac.op}
                  onChange={(e) => setFrac({ ...frac, op: e.target.value as FractionState['op'] })}
                  className={`${inputCls} w-14 text-slate-700 font-medium text-center`}
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
                  className={`${inputCls} w-12 text-center`}
                  title="Whole number"
                />
                <div className="flex flex-col">
                  <input
                    type="number"
                    value={frac.n2}
                    onChange={(e) => setFrac({ ...frac, n2: parseInt(e.target.value) || 0 })}
                    className={`${inputCls} w-12 text-center text-xs rounded-b-none`}
                    title="Numerator"
                  />
                  <input
                    type="number"
                    value={frac.d2}
                    onChange={(e) => setFrac({ ...frac, d2: parseInt(e.target.value) || 1 })}
                    className={`${inputCls} w-12 text-center text-xs rounded-t-none border-t-0`}
                    title="Denominator"
                  />
                </div>
              </div>
              <div className="border-t border-slate-200 pt-4 text-center">
                <div className="text-2xl font-medium text-slate-700">{toFraction(fracVal)}&quot;</div>
                <div className="text-sm text-slate-400 mt-1">= {fracVal.toFixed(4)}&quot;</div>
              </div>
            </div>
          )}

          {active === 'golden' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Known dimension (in)</label>
                <input
                  type="number"
                  step="0.5"
                  value={gold}
                  onChange={(e) => setGold(parseFloat(e.target.value) || 0)}
                  className={`${inputCls} w-full`}
                />
              </div>
              <div className="border-t border-slate-200 pt-4 space-y-2">
                <Result label="Larger (× φ)" value={`${(gold * PHI).toFixed(2)}"`} />
                <Result label="Smaller (÷ φ)" value={`${(gold / PHI).toFixed(2)}"`} />
              </div>
              <p className="text-xs text-slate-400">φ (phi) ≈ 1.618 — the golden ratio for pleasing proportions</p>
            </div>
          )}

          {active === 'angle' && (() => {
            // Calculate derived values based on mode
            const toRad = (deg: number) => (deg * Math.PI) / 180;
            const toDeg = (rad: number) => (rad * 180) / Math.PI;

            let calcAngle = 0, calcRise = 0, calcRun = 0, calcHyp = 0;

            if (angleMode === 'rise-run') {
              calcRise = angle.rise;
              calcRun = angle.run;
              calcAngle = toDeg(Math.atan2(angle.rise, angle.run));
              calcHyp = Math.sqrt(angle.rise ** 2 + angle.run ** 2);
            } else if (angleMode === 'angle-rise') {
              calcAngle = angleDegInput;
              calcRise = angle.rise;
              calcRun = angle.rise / Math.tan(toRad(angleDegInput));
              calcHyp = angle.rise / Math.sin(toRad(angleDegInput));
            } else if (angleMode === 'angle-run') {
              calcAngle = angleDegInput;
              calcRun = angle.run;
              calcRise = angle.run * Math.tan(toRad(angleDegInput));
              calcHyp = angle.run / Math.cos(toRad(angleDegInput));
            } else if (angleMode === 'angle-hyp') {
              calcAngle = angleDegInput;
              calcHyp = hypInput;
              calcRise = hypInput * Math.sin(toRad(angleDegInput));
              calcRun = hypInput * Math.cos(toRad(angleDegInput));
            }

            return (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">I know...</label>
                  <select
                    value={angleMode}
                    onChange={(e) => setAngleMode(e.target.value as typeof angleMode)}
                    className={inputCls + ' w-full'}
                  >
                    <option value="rise-run">Rise & Run</option>
                    <option value="angle-rise">Angle & Rise</option>
                    <option value="angle-run">Angle & Run</option>
                    <option value="angle-hyp">Angle & Hypotenuse</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {(angleMode === 'angle-rise' || angleMode === 'angle-run' || angleMode === 'angle-hyp') && (
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Angle (°)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={angleDegInput}
                        onChange={(e) => setAngleDegInput(parseFloat(e.target.value) || 0)}
                        className={inputCls + ' w-full'}
                      />
                    </div>
                  )}
                  {(angleMode === 'rise-run' || angleMode === 'angle-rise') && (
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Rise</label>
                      <input
                        type="number"
                        step="0.125"
                        value={angle.rise}
                        onChange={(e) => setAngle({ ...angle, rise: parseFloat(e.target.value) || 0 })}
                        className={inputCls + ' w-full'}
                      />
                    </div>
                  )}
                  {(angleMode === 'rise-run' || angleMode === 'angle-run') && (
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Run</label>
                      <input
                        type="number"
                        step="0.125"
                        value={angle.run}
                        onChange={(e) => setAngle({ ...angle, run: parseFloat(e.target.value) || 0 })}
                        className={inputCls + ' w-full'}
                      />
                    </div>
                  )}
                  {angleMode === 'angle-hyp' && (
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Hypotenuse</label>
                      <input
                        type="number"
                        step="0.125"
                        value={hypInput}
                        onChange={(e) => setHypInput(parseFloat(e.target.value) || 0)}
                        className={inputCls + ' w-full'}
                      />
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-200 pt-4 space-y-2">
                  {angleMode === 'rise-run' && (
                    <Result label="Angle" value={`${calcAngle.toFixed(2)}°`} />
                  )}
                  {angleMode !== 'rise-run' && angleMode !== 'angle-rise' && (
                    <Result label="Rise" value={`${calcRise.toFixed(3)}"`} />
                  )}
                  {angleMode !== 'rise-run' && angleMode !== 'angle-run' && (
                    <Result label="Run" value={`${calcRun.toFixed(3)}"`} />
                  )}
                  {angleMode !== 'angle-hyp' && (
                    <Result label="Hypotenuse" value={`${calcHyp.toFixed(3)}"`} />
                  )}
                </div>
              </div>
            );
          })()}

          {active === 'shelf' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Total Height</label>
                  <input
                    type="number"
                    value={shelf.h}
                    onChange={(e) => setShelf({ ...shelf, h: parseFloat(e.target.value) || 0 })}
                    className={inputCls + ' w-full'}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1"># of Shelves</label>
                  <input
                    type="number"
                    value={shelf.n}
                    onChange={(e) => setShelf({ ...shelf, n: parseInt(e.target.value) || 1 })}
                    className={inputCls + ' w-full'}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Thickness</label>
                  <input
                    type="number"
                    step="0.125"
                    value={shelf.t}
                    onChange={(e) => setShelf({ ...shelf, t: parseFloat(e.target.value) || 0 })}
                    className={inputCls + ' w-full'}
                  />
                </div>
              </div>
              <div className="border-t border-slate-200 pt-4">
                <Result label="Space between shelves" value={`${shelfSpace.toFixed(2)}"`} />
              </div>
            </div>
          )}

          {active === 'taper' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Top Width</label>
                  <input
                    type="number"
                    step="0.125"
                    value={taper.top}
                    onChange={(e) => setTaper({ ...taper, top: parseFloat(e.target.value) || 0 })}
                    className={inputCls + ' w-full'}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Bottom Width</label>
                  <input
                    type="number"
                    step="0.125"
                    value={taper.bot}
                    onChange={(e) => setTaper({ ...taper, bot: parseFloat(e.target.value) || 0 })}
                    className={inputCls + ' w-full'}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Length</label>
                  <input
                    type="number"
                    value={taper.len}
                    onChange={(e) => setTaper({ ...taper, len: parseFloat(e.target.value) || 0 })}
                    className={inputCls + ' w-full'}
                  />
                </div>
              </div>
              <div className="border-t border-slate-200 pt-4 space-y-2">
                <Result label="Taper per side" value={`${taperSide.toFixed(3)}"`} />
                <Result label="Taper angle" value={`${taperAng.toFixed(2)}°`} />
              </div>
            </div>
          )}

          {active === 'reference' && (
            <div className="grid grid-cols-4 gap-2 text-sm">
              {FRACTION_REFERENCE.map(([f, d]) => (
                <div
                  key={f}
                  className="flex justify-between bg-slate-50 rounded px-2 py-1.5 border border-slate-100"
                >
                  <span className="text-slate-700 font-medium">{f}</span>
                  <span className="text-slate-400">{d}</span>
                </div>
              ))}
            </div>
          )}

          {active === 'movement' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Flat-sawn wood moves approximately 0.25% for every 1% change in moisture content.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Board Width (in)</label>
                  <input
                    type="number"
                    value={mvWidth}
                    onChange={(e) => setMvWidth(parseFloat(e.target.value) || 0)}
                    className={inputCls + ' w-full'}
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Moisture Change (%)</label>
                  <input
                    type="number"
                    value={mvMoisture}
                    onChange={(e) => setMvMoisture(parseFloat(e.target.value) || 0)}
                    className={inputCls + ' w-full'}
                  />
                </div>
              </div>
              <div className="border-t border-slate-200 pt-4">
                <Result label="Estimated movement" value={`±${woodMovement.toFixed(3)}"`} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
