import React from 'react';
import { useCreatorStore } from '../../../store/useCreatorStore';
import { ALL_RACES } from '../../../data/races';
import { Badge } from '../../../components/ui';
import { cn } from '../../../utils/cn';
import { bookEnabled } from '../../../utils/bookEnabled';
import type { Race } from '../../../types';

export function StepRace() {
  const { draft, updateDraft } = useCreatorStore();
  const [selected, setSelected] = React.useState<Race | null>(
    draft.raceId ? ALL_RACES.find(r => r.id === draft.raceId) ?? null : null
  );

  const availableRaces = ALL_RACES.filter(r =>
    bookEnabled(r, draft.enabledBooks) && !r.isSubrace
  );
  const subraceRaces = ALL_RACES.filter(r =>
    bookEnabled(r, draft.enabledBooks) && r.isSubrace
  );

  // Group subraces by parentRaceId — no parent entry required in ALL_RACES
  const subGroupIds = [...new Set(
    subraceRaces.map(r => r.parentRaceId).filter((id): id is string => !!id)
  )];
  function groupLabel(parentId: string): string {
    const parent = ALL_RACES.find(r => r.id === parentId);
    return parent ? parent.name : parentId.charAt(0).toUpperCase() + parentId.slice(1);
  }
  // Non-subrace races that aren't acting as a subrace group header
  const racesWithoutSubs = availableRaces.filter(r => !subGroupIds.includes(r.id));

  function selectRace(race: Race) {
    setSelected(race);
    updateDraft({ raceId: race.id });
  }

  function abilityStr(inc: Record<string, number>) {
    return Object.entries(inc)
      .map(([k, v]) => `${k.toUpperCase()} +${v}`)
      .join(', ') || 'Custom';
  }

  const RaceCard = ({ race }: { race: Race }) => (
    <div
      onClick={() => selectRace(race)}
      className={cn(
        'p-3 rounded-lg border-2 cursor-pointer transition-all',
        draft.raceId === race.id
          ? 'border-red-500 bg-red-950/30'
          : 'border-slate-700 hover:border-slate-500 bg-slate-800',
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <h4 className="font-bold text-white text-sm">{race.name}</h4>
        <Badge color="slate">{race.size}</Badge>
      </div>
      <p className="text-xs text-slate-400 mb-1.5">{abilityStr(race.abilityScoreIncreases)}</p>
      <p className="text-xs text-slate-500">Speed: {race.speed}ft{race.darkvision ? ` · Darkvision ${race.darkvision}ft` : ''}</p>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Choose Your Race</h2>
        <p className="text-slate-400 mb-4">Your race determines your ability score bonuses, speed, size, languages, and racial traits.</p>

        {/* Subraces */}
        {subGroupIds.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-2">Subraces</h3>
            {subGroupIds.map(parentId => (
              <div key={parentId} className="mb-3">
                <p className="text-xs text-slate-500 mb-1.5 pl-1">{groupLabel(parentId)}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {subraceRaces.filter(s => s.parentRaceId === parentId).map(race => (
                    <RaceCard key={race.id} race={race} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* No-subrace races */}
        {racesWithoutSubs.length > 0 && (
          <div>
            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-2">Races</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {racesWithoutSubs.map(race => <RaceCard key={race.id} race={race} />)}
            </div>
          </div>
        )}
      </div>

      {/* Race detail */}
      <div className="lg:sticky lg:top-0 lg:self-start">
        {selected ? (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
            <h3 className="text-xl font-bold text-white mb-1">{selected.name}</h3>
            <div className="flex flex-wrap gap-2 mb-4">
              <Badge>{selected.size}</Badge>
              <Badge>Speed {selected.speed}ft</Badge>
              {selected.darkvision && <Badge>Darkvision {selected.darkvision}ft</Badge>}
              <Badge color="slate">{selected.sourceBook}</Badge>
            </div>

            <div className="mb-4">
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Ability Score Increases</h4>
              <div className="flex flex-wrap gap-2">
                {Object.entries(selected.abilityScoreIncreases).length > 0
                  ? Object.entries(selected.abilityScoreIncreases).map(([k, v]) => (
                    <span key={k} className="text-sm bg-slate-700 px-2 py-1 rounded text-white">
                      {k.toUpperCase()} <span className="text-green-400">+{v}</span>
                    </span>
                  ))
                  : <span className="text-sm text-slate-500">Flexible (see traits)</span>
                }
              </div>
            </div>

            <div className="mb-4">
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Languages</h4>
              <p className="text-sm text-slate-300">{selected.languages.join(', ')}</p>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Racial Traits</h4>
              <div className="space-y-3">
                {selected.traits.map(trait => (
                  <div key={trait.name} className="bg-slate-900 rounded-lg p-3">
                    <h5 className="font-bold text-white text-sm mb-1">{trait.name}</h5>
                    <p className="text-xs text-slate-400 leading-relaxed">{trait.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center text-slate-500">
            Select a race to see details
          </div>
        )}
      </div>
    </div>
  );
}
