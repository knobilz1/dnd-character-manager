import React from 'react';
import { useCreatorStore } from '../../../store/useCreatorStore';
import { ALL_RACES } from '../../../data/races';
import { Badge } from '../../../components/ui';
import { cn } from '../../../utils/cn';
import { bookEnabled } from '../../../utils/bookEnabled';
import { FlexibleAsiPicker } from './FlexibleAsiPicker';
import type { BookId, Race, CharacterGender } from '../../../types';
import { BOOKS } from '../../../data/books';

const CharacterViewport = React.lazy(() => import('../../sheet/CharacterViewport'));

const GENDERS: { value: CharacterGender; label: string; icon: string }[] = [
  { value: 'male',      label: 'Male',      icon: '♂' },
  { value: 'female',    label: 'Female',    icon: '♀' },
  { value: 'nonbinary', label: 'Non-binary', icon: '⚧' },
];

export function StepRace() {
  const { draft, updateDraft } = useCreatorStore();
  const [selected, setSelected] = React.useState<Race | null>(
    draft.raceId ? ALL_RACES.find(r => r.id === draft.raceId) ?? null : null
  );

  const gender = draft.appearance?.gender ?? 'male';

  // `!r.hidden` withholds a race whose source is in doubt from the picker. It stays in ALL_RACES
  // so `getRace` resolves it and an existing character built as one still opens.
  const availableRaces = ALL_RACES.filter(r =>
    bookEnabled(r, draft.enabledBooks) && !r.isSubrace && !r.hidden
  );
  const subraceRaces = ALL_RACES.filter(r =>
    bookEnabled(r, draft.enabledBooks) && r.isSubrace && !r.hidden
  );

  // A parent whose only purpose is to hold subraces is not itself selectable — you play a Hill
  // Dwarf, never a generic "Dwarf" — so those ids are dropped from the flat list below. (In this
  // data elf/dwarf/halfling/gnome have no parent entry at all; the ids are dangling. Shifter does.)
  const subGroupIds = [...new Set(
    subraceRaces.map(r => r.parentRaceId).filter((id): id is string => !!id)
  )];
  const racesWithoutSubs = availableRaces.filter(r => !subGroupIds.includes(r.id));

  /** What a card is called once it stands on its own.
   *
   *  Most subrace names already carry their family — "Rock Gnome", "High Elf", "Drow (Dark Elf)" —
   *  and reading "Rock Gnome Gnome" would be worse than the problem. The Shifters are the
   *  exception: ERLW names them Beasthide / Longtooth / Swiftstride / Wildhunt, which say nothing
   *  about being Shifters at all, so out of a group box they become four cards nobody can find. */
  function cardName(r: Race): string {
    if (!r.isSubrace || !r.parentRaceId) return r.name;
    const parent = ALL_RACES.find(x => x.id === r.parentRaceId);
    const label = parent?.name ?? r.parentRaceId.split('-').pop()!;
    const word = label.replace(/s$/i, '');
    return r.name.toLowerCase().includes(word.toLowerCase())
      ? r.name
      : `${r.name} ${word.charAt(0).toUpperCase()}${word.slice(1)}`;
  }

  // ONE flat list, ordered by BOOK and nothing else — no subrace group boxes, no parent headings.
  // The groups were an extra axis to read past: a player scanning for a race knows which books are
  // on their table and knows the name they want, and "is this a subrace" is a fact about how the
  // data is shaped rather than how anyone searches. Sorted by BOOKS (publication order, so PHB
  // leads and third-party trails), then alphabetically inside each book — with every sourcebook
  // enabled this runs to 121 races and a single A-Z run buries the PHB dozen among sixty
  // dragonmarked and Eberron options.
  const bookOrder = new Map(BOOKS.map((b, i) => [b.id, i]));
  const raceEntries = [...racesWithoutSubs, ...subraceRaces]
    .map(r => ({ key: r.id, name: cardName(r), book: r.sourceBook as BookId, race: r }))
    .sort((a, b) =>
      (bookOrder.get(a.book) ?? 99) - (bookOrder.get(b.book) ?? 99) || a.name.localeCompare(b.name));

  function selectRace(race: Race) {
    setSelected(race);
    // clear any increase chosen for the previous race — the shapes differ per race,
    // and a stale choice would silently apply to the new one
    updateDraft({ raceId: race.id, racialAbilityChoice: undefined });
  }

  function setGender(g: CharacterGender) {
    updateDraft({ appearance: { ...(draft.appearance ?? { gender: 'male' }), gender: g } });
  }

  function abilityStr(inc: Record<string, number>) {
    // Only a 2024 species reaches the fallback: every flexible-ASI race takes the branch above,
    // and the ten 2024 species are the only ones with no increase of their own. "Custom" was
    // simply wrong for them — nothing is chosen here, the background grants it.
    return Object.entries(inc)
      .map(([k, v]) => `${k.toUpperCase()} +${v}`)
      .join(', ') || 'Increase from background';
  }

  const RaceCard = ({ race, label }: { race: Race; label: string }) => (
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
        <h4 className="font-bold text-white text-sm">{label}</h4>
        <Badge color="slate">{race.size}</Badge>
      </div>
      <p className="text-xs text-slate-400 mb-1.5">{race.flexibleAsi ? 'Flexible ability increase' : abilityStr(race.abilityScoreIncreases)}</p>
      <p className="text-xs text-slate-500">Speed: {race.speed}ft{race.darkvision ? ` · Darkvision ${race.darkvision}ft` : ''}</p>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Left: race picker */}
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Choose Your Race</h2>
        <p className="text-slate-400 mb-4">Your race determines your ability score bonuses, speed, size, languages, and racial traits.</p>

        {/* The book heading spans the full row, so the order reads straight down the grid instead
            of being hoisted above it. */}
        <div className="grid gap-2 sm:grid-cols-2">
          {raceEntries.map((entry, i) => (
            <React.Fragment key={entry.key}>
              {/* A heading whenever the book changes — a sort nobody can see is just a jumble. */}
              {(i === 0 || raceEntries[i - 1].book !== entry.book) && (
                <h3 className="sm:col-span-2 text-sm font-bold text-slate-300 uppercase tracking-wider mt-3 first:mt-0 pb-1 border-b border-slate-700/60">
                  {BOOKS.find(b => b.id === entry.book)?.name ?? entry.book}
                </h3>
              )}
              <RaceCard race={entry.race} label={entry.name} />
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Right: 3D viewport + race details */}
      <div className="lg:sticky lg:top-0 lg:self-start space-y-4">
        {/* 3D character preview */}
        <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
          {/* Viewport */}
          <div className="h-72 relative">
            <React.Suspense fallback={
              <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">
                Loading character…
              </div>
            }>
              <CharacterViewport animationState="idle" gender={gender} raceId={draft.raceId} minimal className="w-full h-full" />
            </React.Suspense>

            {/* Race label overlay */}
            {selected && (
              <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm rounded-lg px-2 py-1">
                <span className="text-white text-xs font-bold">{cardName(selected)}</span>
              </div>
            )}

            {/* "More models coming soon" badge for non-human */}
            {selected && selected.id !== 'human' && (
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1 text-center">
                <span className="text-slate-400 text-xs">More race models coming soon</span>
              </div>
            )}
          </div>

          {/* Gender toggle */}
          <div className="border-t border-slate-700 p-3">
            <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-2">Gender</p>
            <div className="flex gap-2">
              {GENDERS.map(g => (
                <button
                  key={g.value}
                  onClick={() => setGender(g.value)}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-sm font-medium transition-all border',
                    gender === g.value
                      ? 'bg-red-700 border-red-600 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white',
                  )}
                >
                  <span className="text-base leading-none">{g.icon}</span>
                  <span className="text-xs">{g.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Race details */}
        {selected ? (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
            <h3 className="text-xl font-bold text-white mb-1">{cardName(selected)}</h3>
            <div className="flex flex-wrap gap-2 mb-4">
              <Badge>{selected.size}</Badge>
              <Badge>Speed {selected.speed}ft</Badge>
              {selected.darkvision && <Badge>Darkvision {selected.darkvision}ft</Badge>}
              <Badge color="slate">{selected.sourceBook}</Badge>
            </div>

            {/* A 2024 species grants no ability increase at all — the background does — so its
                `abilityScoreIncreases` is empty and it carries no `flexibleAsi`. Rendering the
                heading unconditionally left all ten of them showing a title over nothing. */}
            {(selected.flexibleAsi || Object.keys(selected.abilityScoreIncreases).length > 0) && (
              <div className="mb-4">
                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Ability Score Increases</h4>
                <div className="flex flex-wrap gap-2">
                  {selected.flexibleAsi
                    ? <FlexibleAsiPicker
                        source={selected}
                        value={draft.racialAbilityChoice}
                        onChange={v => updateDraft({ racialAbilityChoice: v })}
                      />
                    : Object.entries(selected.abilityScoreIncreases).map(([k, v]) => (
                      <span key={k} className="text-sm bg-slate-700 px-2 py-1 rounded text-white">
                        {k.toUpperCase()} <span className="text-green-400">+{v}</span>
                      </span>
                    ))
                  }
                </div>
              </div>
            )}

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
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 text-center text-slate-500 text-sm">
            Select a race to see details
          </div>
        )}
      </div>
    </div>
  );
}
