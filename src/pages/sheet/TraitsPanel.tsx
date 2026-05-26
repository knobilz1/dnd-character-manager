import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { SectionHeader, HoverCard } from '../../components/ui';
import { cn } from '../../utils/cn';
import { getBackground } from '../../data/backgrounds';
import { getRace } from '../../data/races';
import { getClass } from '../../data/classes';
import { ALL_SUBCLASSES } from '../../data/subclasses';
import { ALL_FEATS } from '../../data/feats';
import { ALL_FIGHTING_STYLES } from '../../data/fightingStyles';
import { ALL_INVOCATIONS } from '../../data/invocations';
import { ALL_PACT_BOONS } from '../../data/pactBoons';
import { ALL_METAMAGIC } from '../../data/metamagic';
import { ALL_MANEUVERS } from '../../data/maneuvers';
import { ALL_INFUSIONS } from '../../data/infusions';
import { totalCharacterLevel } from '../../data/mechanics';
import { useCharacterStore } from '../../store/useCharacterStore';
import type { Character } from '../../types';

export function TraitsPanel({ character, setNotes }: { character: Character; setNotes: (n: string) => void }) {
  const { setExperiencePoints } = useCharacterStore();
  const bg = getBackground(character.backgroundId);
  const race = getRace(character.raceId);
  const primaryClass = character.classes[0];
  const classDef = primaryClass ? getClass(primaryClass.classId) : null;
  const subclass = primaryClass?.subclassId ? ALL_SUBCLASSES.find(s => s.id === primaryClass.subclassId) : null;
  const feats = ALL_FEATS.filter(f => character.selectedFeats.includes(f.id));
  const totalLevel = totalCharacterLevel(character.classes);

  const co = character.classOptions ?? { fightingStyles: [], invocations: [], metamagic: [], maneuvers: [], infusions: [] };
  const fightingStyles = ALL_FIGHTING_STYLES.filter(x => co.fightingStyles?.includes(x.id));
  const invocations = ALL_INVOCATIONS.filter(x => co.invocations?.includes(x.id));
  const pactBoon = co.pactBoon ? ALL_PACT_BOONS.find(p => p.id === co.pactBoon) : null;
  const metamagic = ALL_METAMAGIC.filter(x => co.metamagic?.includes(x.id));
  const maneuvers = ALL_MANEUVERS.filter(x => co.maneuvers?.includes(x.id));
  const infusions = ALL_INFUSIONS.filter(x => co.infusions?.includes(x.id));

  return (
    <div className="space-y-4">
      {/* Character Info */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <SectionHeader>Character Info</SectionHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {[
            { label: 'Level', value: totalLevel },
            { label: 'XP', value: character.experiencePoints.toLocaleString() },
            { label: 'Race', value: race?.name ?? '—' },
            { label: 'Background', value: bg?.name ?? '—' },
            { label: 'Class', value: classDef?.name ?? '—' },
            { label: 'Subclass', value: subclass?.name ?? '—' },
            { label: 'Alignment', value: character.alignment },
            { label: 'Player', value: character.playerName || '—' },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-xs text-slate-400">{label}</p>
              <p className="text-white font-medium">{value}</p>
            </div>
          ))}
        </div>

        {/* XP editor */}
        <div className="mt-3 flex items-center gap-2">
          <label className="text-xs text-slate-400 shrink-0">XP:</label>
          <input
            type="number"
            min={0}
            value={character.experiencePoints}
            onChange={e => {
              const xp = Number(e.target.value);
              if (!isNaN(xp) && xp >= 0) setExperiencePoints(xp);
            }}
            className="w-28 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm"
          />
        </div>
      </div>

      {/* Background Traits */}
      {bg && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Background: {bg.name}</SectionHeader>
          <div className="mb-3 bg-slate-900 rounded-lg p-3">
            <p className="text-xs font-bold text-slate-300 mb-1">Feature: {bg.feature.name}</p>
            <p className="text-xs text-slate-400 leading-relaxed">{bg.feature.description}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <TraitSection title="Personality Traits" items={bg.personalityTraits.slice(0, 2)} />
            <TraitSection title="Ideals" items={bg.ideals.slice(0, 1)} />
            <TraitSection title="Bonds" items={bg.bonds.slice(0, 1)} />
            <TraitSection title="Flaws" items={bg.flaws.slice(0, 1)} />
          </div>
        </div>
      )}

      {/* Racial Traits */}
      {race && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Racial Traits: {race.name}</SectionHeader>
          <div className="space-y-2">
            {race.traits.map(trait => (
              <div key={trait.name} className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs font-bold text-white mb-1">{trait.name}</p>
                <p className="text-xs text-slate-400 leading-relaxed">{trait.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Class Features */}
      {classDef && primaryClass && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Class Features: {classDef.name} {primaryClass.level}</SectionHeader>
          <div className="space-y-2">
            {classDef.features
              .filter(f => f.level <= primaryClass.level)
              .sort((a, b) => a.level - b.level)
              .map((f, i) => (
                <HoverCard
                  key={i}
                  content={
                    <div>
                      <div className="flex items-center gap-1 mb-2">
                        <span className="text-xs bg-slate-700 text-slate-300 px-1 py-0.5 rounded">Lv.{f.level}</span>
                        <span className="text-xs font-bold text-white">{f.name}</span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{f.description}</p>
                    </div>
                  }
                >
                <div className="bg-slate-900 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">Lv.{f.level}</span>
                    <p className="text-xs font-bold text-white">{f.name}</p>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">{f.description}</p>
                </div>
                </HoverCard>
              ))}
          </div>
        </div>
      )}

      {/* Subclass Features */}
      {subclass && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>{classDef?.subclassLabel}: {subclass.name}</SectionHeader>
          <div className="space-y-2">
            {subclass.features
              .filter(f => f.level <= (primaryClass?.level ?? 1))
              .map((f, i) => (
                <div key={i} className="bg-slate-900 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">Lv.{f.level}</span>
                    <p className="text-xs font-bold text-white">{f.name}</p>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{f.description}</p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Feats */}
      {feats.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Feats</SectionHeader>
          <div className="space-y-2">
            {feats.map(feat => (
              <HoverCard
                key={feat.id}
                content={
                  <div>
                    <p className="font-bold text-white text-sm mb-2">{feat.name}</p>
                    <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{feat.description}</p>
                  </div>
                }
              >
              <div className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs font-bold text-white mb-1">{feat.name}</p>
                <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line line-clamp-4">{feat.description}</p>
              </div>
              </HoverCard>
            ))}
          </div>
        </div>
      )}

      {/* Fighting Styles */}
      {fightingStyles.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Fighting Style{fightingStyles.length > 1 ? 's' : ''}</SectionHeader>
          <div className="space-y-2">
            {fightingStyles.map(fs => (
              <div key={fs.id} className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs font-bold text-white mb-1">{fs.name}</p>
                <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line">{fs.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pact Boon */}
      {pactBoon && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Pact Boon</SectionHeader>
          <div className="bg-slate-900 rounded-lg p-3">
            <p className="text-xs font-bold text-white mb-1">{pactBoon.name}</p>
            <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line">{pactBoon.description}</p>
          </div>
        </div>
      )}

      {/* Eldritch Invocations */}
      {invocations.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Eldritch Invocations</SectionHeader>
          <div className="space-y-2">
            {invocations.map(inv => (
              <div key={inv.id} className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs font-bold text-white mb-1">{inv.name}</p>
                <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line">{inv.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metamagic */}
      {metamagic.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Metamagic</SectionHeader>
          <div className="space-y-2">
            {metamagic.map(m => (
              <div key={m.id} className="bg-slate-900 rounded-lg p-3">
                <div className="flex items-baseline justify-between mb-1">
                  <p className="text-xs font-bold text-white">{m.name}</p>
                  <p className="text-[10px] text-yellow-400">{m.cost}</p>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line">{m.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Maneuvers */}
      {maneuvers.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Battle Master Maneuvers</SectionHeader>
          <div className="space-y-2">
            {maneuvers.map(m => (
              <div key={m.id} className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs font-bold text-white mb-1">{m.name}</p>
                <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line">{m.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Infusions */}
      {infusions.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Artificer Infusions Known</SectionHeader>
          <div className="space-y-2">
            {infusions.map(inf => (
              <div key={inf.id} className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs font-bold text-white mb-1">{inf.name}</p>
                {inf.prerequisite && <p className="text-[10px] text-yellow-400 mb-1">Requires: {inf.prerequisite}</p>}
                <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line">{inf.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      <NotesSection notes={character.notes ?? ''} setNotes={setNotes} />
    </div>
  );
}

// ── Notes with built-in search ─────────────────────────────────────────────────
function NotesSection({ notes, setNotes }: { notes: string; setNotes: (n: string) => void }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery]           = useState('');
  const [matchIdx, setMatchIdx]     = useState(0);
  const taRef    = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Compute all match positions (case-insensitive)
  const matches = useMemo<{ start: number; end: number }[]>(() => {
    if (!query.trim()) return [];
    const lower = notes.toLowerCase();
    const q     = query.toLowerCase();
    const found: { start: number; end: number }[] = [];
    let i = 0;
    while (i <= lower.length - q.length) {
      const idx = lower.indexOf(q, i);
      if (idx === -1) break;
      found.push({ start: idx, end: idx + q.length });
      i = idx + 1;
    }
    return found;
  }, [notes, query]);

  // Reset to first match whenever query changes
  useEffect(() => { setMatchIdx(0); }, [query]);

  // Jump to the current match inside the textarea
  useEffect(() => {
    if (!matches.length || !taRef.current) return;
    const { start, end } = matches[Math.min(matchIdx, matches.length - 1)];
    const ta = taRef.current;
    ta.focus();
    ta.setSelectionRange(start, end);
    // Scroll so the selection is roughly centred
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    const linesBefore = notes.slice(0, start).split('\n').length - 1;
    ta.scrollTop = Math.max(0, linesBefore * lineHeight - ta.clientHeight / 2);
  }, [matchIdx, matches, notes]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
    setMatchIdx(0);
  }, []);

  const next = useCallback(() =>
    setMatchIdx(i => matches.length ? (i + 1) % matches.length : 0),
  [matches.length]);

  const prev = useCallback(() =>
    setMatchIdx(i => matches.length ? (i - 1 + matches.length) % matches.length : 0),
  [matches.length]);

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter')     { e.preventDefault(); next(); }
    if (e.key === 'Escape')    { closeSearch(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); next(); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); prev(); }
  }

  const hasResults   = matches.length > 0;
  const noResults    = query.trim().length > 0 && matches.length === 0;
  const currentLabel = hasResults ? `${matchIdx + 1}/${matches.length}` : null;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      {/* Header row */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={searchOpen ? closeSearch : openSearch}
          title={searchOpen ? 'Close search' : 'Search notes'}
          className={cn(
            'p-0.5 rounded transition-colors shrink-0',
            searchOpen ? 'text-sky-400 hover:text-sky-300' : 'text-slate-500 hover:text-slate-300',
          )}
        >
          <Search size={13} />
        </button>
        <SectionHeader className="mb-0">Notes</SectionHeader>
      </div>

      {/* Search bar — slides in when open */}
      {searchOpen && (
        <div className="flex items-center gap-1.5 mb-2 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1">
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Find in notes…"
            className="flex-1 min-w-0 bg-transparent text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
          />
          {currentLabel && (
            <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">{currentLabel}</span>
          )}
          {noResults && (
            <span className="text-[10px] text-red-400 shrink-0">no results</span>
          )}
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={prev}
              disabled={!hasResults}
              title="Previous match"
              className="p-0.5 rounded text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-colors"
            >
              <ChevronUp size={13} />
            </button>
            <button
              onClick={next}
              disabled={!hasResults}
              title="Next match"
              className="p-0.5 rounded text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-colors"
            >
              <ChevronDown size={13} />
            </button>
            <button
              onClick={closeSearch}
              title="Close search"
              className="p-0.5 rounded text-slate-500 hover:text-slate-300 transition-colors ml-0.5"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Textarea — raw element so we can attach a ref */}
      <textarea
        ref={taRef}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Adventure notes, reminders, contacts, lore..."
        className="w-full min-h-32 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-red-500 transition-colors resize-none"
      />
    </div>
  );
}

function TraitSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-slate-900 rounded-lg p-3">
      <p className="text-xs font-bold text-slate-400 mb-1">{title}</p>
      {items.map((item, i) => (
        <p key={i} className="text-xs text-slate-300 italic leading-relaxed">"{item}"</p>
      ))}
    </div>
  );
}
