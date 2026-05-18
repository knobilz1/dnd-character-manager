import React from 'react';
import { useWizardStore } from '../../../store/useWizardStore';
import { Tabs } from '../../../components/ui';
import { cn } from '../../../utils/cn';
import { abilityMod } from '../../../data/mechanics';
import type { AbilityKey, AbilityScoreMethod } from '../../../types';
import { getRace } from '../../../data/races';

const ABILITIES: { key: AbilityKey; label: string }[] = [
  { key: 'str', label: 'Strength' },
  { key: 'dex', label: 'Dexterity' },
  { key: 'con', label: 'Constitution' },
  { key: 'int', label: 'Intelligence' },
  { key: 'wis', label: 'Wisdom' },
  { key: 'cha', label: 'Charisma' },
];

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const POINT_BUY_COSTS: Record<number, number> = { 8:0, 9:1, 10:2, 11:3, 12:4, 13:5, 14:7, 15:9 };

const DEFAULT_SCORES: Record<AbilityKey, number> = { str:8,dex:8,con:8,int:8,wis:8,cha:8 };

export function StepAbilityScores() {
  const { draft, updateDraft, pointBuyRemaining, setPointBuyScore, assignStandardArray, standardArrayUnassigned, rolledValues, rolledDice, rollAllDice } = useWizardStore();
  const method: AbilityScoreMethod = draft.abilityScoreMethod ?? 'pointbuy';
  const scores = draft.baseAbilityScores ?? { ...DEFAULT_SCORES };
  const race = getRace(draft.raceId ?? '');

  function setMethod(m: AbilityScoreMethod) {
    if (m === 'roll') {
      updateDraft({ abilityScoreMethod: m, baseAbilityScores: { str:0,dex:0,con:0,int:0,wis:0,cha:0 } });
    } else {
      updateDraft({
        abilityScoreMethod: m,
        baseAbilityScores: m === 'standard_array'
          ? { str:8,dex:8,con:8,int:8,wis:8,cha:8 }
          : m === 'pointbuy'
          ? { ...DEFAULT_SCORES }
          : { str:10,dex:10,con:10,int:10,wis:10,cha:10 },
      });
    }
  }

  const finalScore = (key: AbilityKey) => {
    const base = scores[key];
    const racial = race?.abilityScoreIncreases[key] ?? 0;
    return base + racial;
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-2">Ability Scores</h2>
      <p className="text-slate-400 mb-4">Set your six ability scores using your preferred method.</p>

      <Tabs
        tabs={[
          { id: 'pointbuy', label: 'Point Buy' },
          { id: 'standard_array', label: 'Standard Array' },
          { id: 'roll', label: 'Roll (4d6)' },
          { id: 'manual', label: 'Manual' },
        ]}
        active={method}
        onChange={m => setMethod(m as AbilityScoreMethod)}
      />

      <div className="mt-4">
        {method === 'pointbuy' && (
          <PointBuy
            scores={scores}
            remaining={pointBuyRemaining}
            onSet={setPointBuyScore}
            finalScore={finalScore}
            racialBonus={race?.abilityScoreIncreases ?? {}}
          />
        )}
        {method === 'standard_array' && (
          <StandardArray
            scores={scores}
            unassigned={standardArrayUnassigned}
            onAssign={assignStandardArray}
            finalScore={finalScore}
            racialBonus={race?.abilityScoreIncreases ?? {}}
          />
        )}
        {method === 'roll' && (
          <RollDice
            scores={scores}
            rolledValues={rolledValues}
            rolledDice={rolledDice}
            onRollAll={rollAllDice}
            onAssign={(k, v) => updateDraft({ baseAbilityScores: { ...scores, [k]: v } })}
            finalScore={finalScore}
            racialBonus={race?.abilityScoreIncreases ?? {}}
          />
        )}
        {method === 'manual' && (
          <ManualEntry
            scores={scores}
            onChange={(k, v) => updateDraft({ baseAbilityScores: { ...scores, [k]: v } })}
            finalScore={finalScore}
            racialBonus={race?.abilityScoreIncreases ?? {}}
          />
        )}
      </div>
    </div>
  );
}

function PointBuy({ scores, remaining, onSet, finalScore, racialBonus }: {
  scores: Record<AbilityKey, number>;
  remaining: number;
  onSet: (k: AbilityKey, v: number) => void;
  finalScore: (k: AbilityKey) => number;
  racialBonus: Partial<Record<AbilityKey, number>>;
}) {
  function canIncrease(key: AbilityKey) {
    const cur = scores[key];
    if (cur >= 15) return false;
    const cost = POINT_BUY_COSTS[cur + 1] - POINT_BUY_COSTS[cur];
    return remaining >= cost;
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-white">Point Buy</h3>
        <span className={cn('text-sm font-bold px-3 py-1 rounded-lg', remaining >= 0 ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300')}>
          {remaining} points remaining
        </span>
      </div>
      <div className="space-y-3">
        {ABILITIES.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-3">
            <span className="w-24 text-sm text-slate-300 shrink-0">{label}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onSet(key, Math.max(8, scores[key] - 1))}
                disabled={scores[key] <= 8}
                className="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center disabled:opacity-30 text-lg"
              >−</button>
              <span className="w-8 text-center font-bold text-white">{scores[key]}</span>
              <button
                onClick={() => onSet(key, Math.min(15, scores[key] + 1))}
                disabled={!canIncrease(key)}
                className="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center disabled:opacity-30 text-lg"
              >+</button>
              <span className="text-xs text-slate-500 w-12">cost {POINT_BUY_COSTS[scores[key]]}</span>
            </div>
            {(racialBonus[key] ?? 0) > 0 && <span className="text-xs text-green-400">+{racialBonus[key]} racial</span>}
            <span className="ml-auto font-bold text-white">{finalScore(key)} ({abilityMod(finalScore(key)) >= 0 ? '+' : ''}{abilityMod(finalScore(key))})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StandardArray({ scores, unassigned, onAssign, finalScore, racialBonus }: {
  scores: Record<AbilityKey, number>;
  unassigned: number[];
  onAssign: (k: AbilityKey, v: number) => void;
  finalScore: (k: AbilityKey) => number;
  racialBonus: Partial<Record<AbilityKey, number>>;
}) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-white">Standard Array</h3>
        <div className="flex gap-2">
          {unassigned.map(v => (
            <span key={v} className="bg-slate-700 text-white px-2 py-1 rounded font-bold text-sm">{v}</span>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        {ABILITIES.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-3">
            <span className="w-24 text-sm text-slate-300 shrink-0">{label}</span>
            <select
              value={scores[key]}
              onChange={e => onAssign(key, Number(e.target.value))}
              className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-white text-sm"
            >
              <option value={8}>— unassigned —</option>
              {STANDARD_ARRAY.filter(v => v === scores[key] || unassigned.includes(v)).map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            {(racialBonus[key] ?? 0) > 0 && <span className="text-xs text-green-400">+{racialBonus[key]}</span>}
            <span className="ml-auto font-bold text-white">{finalScore(key)} ({abilityMod(finalScore(key)) >= 0 ? '+' : ''}{abilityMod(finalScore(key))})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RollDice({ scores, rolledValues, rolledDice, onRollAll, onAssign, finalScore, racialBonus }: {
  scores: Record<AbilityKey, number>;
  rolledValues: number[];
  rolledDice: number[][];
  onRollAll: () => void;
  onAssign: (k: AbilityKey, v: number) => void;
  finalScore: (k: AbilityKey) => number;
  racialBonus: Partial<Record<AbilityKey, number>>;
}) {
  const hasRolled = rolledValues.length === 6;

  // Compute unassigned pool: rolledValues minus what's already assigned (score > 0)
  const pool = React.useMemo(() => {
    const p = [...rolledValues];
    for (const v of Object.values(scores)) {
      if (v > 0) {
        const idx = p.indexOf(v);
        if (idx !== -1) p.splice(idx, 1);
      }
    }
    return p;
  }, [rolledValues, scores]);

  const assignedCount = Object.values(scores).filter(v => v > 0).length;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-white">Roll Stats</h3>
        <button
          onClick={onRollAll}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-bold transition-colors"
        >
          <span>⚄</span>
          {hasRolled ? 'Reroll All' : 'Roll Stats'}
        </button>
      </div>

      {!hasRolled && (
        <p className="text-slate-400 text-sm">
          Roll 4d6 and drop the lowest die — six times. Assign each result to an ability score.
        </p>
      )}

      {hasRolled && (
        <>
          {/* Rolled results */}
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-5">
            {rolledValues.map((total, i) => {
              const dice = rolledDice[i] ?? [];
              const dropped = dice[0];
              const kept = dice.slice(1);
              return (
                <div key={i} className="bg-slate-900 border border-slate-600 rounded-lg p-2 text-center">
                  <div className="text-xl font-bold text-white mb-1">{total}</div>
                  <div className="flex justify-center gap-0.5 flex-wrap">
                    <span className="text-[10px] text-slate-600 line-through">{dropped}</span>
                    {kept.map((d, j) => (
                      <span key={j} className="text-[10px] text-slate-400">{d}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Assignment */}
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-slate-400 uppercase tracking-widest font-bold">Assign to abilities</span>
              <span className={cn('text-xs font-bold', assignedCount === 6 ? 'text-green-400' : 'text-amber-300')}>
                {assignedCount}/6 assigned
              </span>
            </div>
            {ABILITIES.map(({ key, label }) => {
              const current = scores[key];
              // Options: the unassigned pool, plus whatever is currently assigned here
              const options = [...new Set([...(current > 0 ? [current] : []), ...pool])].sort((a, b) => b - a);
              return (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-24 text-sm text-slate-300 shrink-0">{label}</span>
                  <select
                    value={current > 0 ? current : 0}
                    onChange={e => onAssign(key, Number(e.target.value))}
                    className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-white text-sm"
                  >
                    <option value={0}>— choose —</option>
                    {options.map(v => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                  {(racialBonus[key] ?? 0) > 0 && <span className="text-xs text-green-400">+{racialBonus[key]}</span>}
                  <span className="ml-auto font-bold text-white">
                    {current > 0
                      ? `${finalScore(key)} (${abilityMod(finalScore(key)) >= 0 ? '+' : ''}${abilityMod(finalScore(key))})`
                      : <span className="text-slate-500">—</span>
                    }
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ManualEntry({ scores, onChange, finalScore, racialBonus }: {
  scores: Record<AbilityKey, number>;
  onChange: (k: AbilityKey, v: number) => void;
  finalScore: (k: AbilityKey) => number;
  racialBonus: Partial<Record<AbilityKey, number>>;
}) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <h3 className="font-bold text-white mb-4">Manual Entry</h3>
      <div className="space-y-3">
        {ABILITIES.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-3">
            <span className="w-24 text-sm text-slate-300 shrink-0">{label}</span>
            <input
              type="number"
              min={1}
              max={20}
              value={scores[key]}
              onChange={e => onChange(key, Math.min(20, Math.max(1, Number(e.target.value))))}
              className="w-16 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-white text-sm text-center"
            />
            {(racialBonus[key] ?? 0) > 0 && <span className="text-xs text-green-400">+{racialBonus[key]}</span>}
            <span className="ml-auto font-bold text-white">{finalScore(key)} ({abilityMod(finalScore(key)) >= 0 ? '+' : ''}{abilityMod(finalScore(key))})</span>
          </div>
        ))}
      </div>
    </div>
  );
}
