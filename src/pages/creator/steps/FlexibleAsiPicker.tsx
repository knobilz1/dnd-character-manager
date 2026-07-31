import React from 'react';
import { cn } from '../../../utils/cn';
import { needsRacialAsi } from '../../../utils/racialAsi';
import type { AbilityKey, Race } from '../../../types';

const ABILITIES: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/**
 * Picker for races whose ability increase the player chooses (MMoM, SJA, FToD, SCoC, Variant Human).
 *
 * Shared by the creator's race step and the sheet, because race cannot change after creation — a
 * creator-only picker would leave every existing character permanently unable to supply the value.
 * That is the same trap the Circle of the Land land-type choice fell into.
 *
 * Each distribution is offered as a row of slots; assigning an ability to a slot writes the whole
 * map at once, so a partially-filled row simply is not a legal answer and `needsRacialAsi` keeps
 * reporting it as outstanding.
 */
export function FlexibleAsiPicker({ race, value, onChange, compact }: {
  race: Race;
  value: Partial<Record<AbilityKey, number>> | undefined;
  onChange: (v: Partial<Record<AbilityKey, number>>) => void;
  compact?: boolean;
}) {
  const dists = race.flexibleAsi ?? [];
  const current = value ?? {};

  // which distribution does the current choice belong to? (-1 = none yet)
  const activeIdx = dists.findIndex(d => {
    const picked = Object.values(current).filter(Boolean).sort((a, b) => b - a);
    const want = [...d].sort((a, b) => b - a);
    return want.length === picked.length && want.every((n, i) => n === picked[i]);
  });
  const [openIdx, setOpenIdx] = React.useState(activeIdx >= 0 ? activeIdx : 0);

  function assign(dist: number[], slot: number, ability: AbilityKey | '') {
    // rebuild from scratch each time: slots map 1:1 onto increments, and an ability may hold
    // only one increment, so re-deriving avoids a stale key surviving a re-pick
    const slots = slotsFor(dist);
    const next: Partial<Record<AbilityKey, number>> = {};
    slots.forEach((inc, i) => {
      const a = i === slot ? ability : slotAbility(dist, i);
      if (a && !(a in next)) next[a] = inc;
    });
    onChange(next);
  }

  function slotsFor(dist: number[]) { return dist; }

  function slotAbility(dist: number[], i: number): AbilityKey | '' {
    // recover which ability currently holds the i-th increment of this distribution
    const inc = dist[i];
    const used: AbilityKey[] = [];
    for (let j = 0; j < i; j++) {
      const a = slotAbility(dist, j);
      if (a) used.push(a);
    }
    const match = ABILITIES.find(a => current[a] === inc && !used.includes(a));
    return match ?? '';
  }

  const outstanding = needsRacialAsi(race, value);

  return (
    <div className={cn('w-full', compact ? 'space-y-1.5' : 'space-y-2')}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400">Ability Score Increase</span>
        <span className={cn('text-xs font-bold', outstanding ? 'text-amber-300' : 'text-green-400')}>
          {outstanding ? 'choice required' : 'set'}
        </span>
      </div>

      {dists.length > 1 && (
        <div className="flex gap-1.5">
          {dists.map((d, i) => (
            <button
              key={i}
              onClick={() => setOpenIdx(i)}
              className={cn('text-xs px-2 py-1 rounded border transition-colors',
                openIdx === i ? 'border-red-500 bg-red-950/40 text-white' : 'border-slate-600 text-slate-400 hover:text-white')}
            >
              {d.map(n => `+${n}`).join(' / ')}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {(dists[openIdx] ?? []).map((inc, i) => (
          <label key={i} className="flex items-center gap-1 text-xs bg-slate-900 border border-slate-600 rounded px-1.5 py-1">
            <span className="text-green-400 font-bold">+{inc}</span>
            <select
              className="bg-slate-900 text-white text-xs outline-none"
              value={slotAbility(dists[openIdx], i)}
              onChange={e => assign(dists[openIdx], i, e.target.value as AbilityKey | '')}
            >
              <option value="">—</option>
              {ABILITIES.map(a => (
                <option key={a} value={a}>{a.toUpperCase()}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}
