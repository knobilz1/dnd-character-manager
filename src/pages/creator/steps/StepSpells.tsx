import React from 'react';
import { useCreatorStore } from '../../../store/useCreatorStore';
import { ALL_SPELLS } from '../../../data/spells';
import { Badge, Dialog, HoverCard } from '../../../components/ui';
import { cn } from '../../../utils/cn';
import { getClass } from '../../../data/classes';
import { getSubclass } from '../../../data/subclasses';
import { bookEnabled } from '../../../utils/bookEnabled';
import {
  cantripsKnownFor,
  spellsKnownFor,
  maxPreparedSpellsFor,
  FULL_CASTER_SLOTS,
  HALF_CASTER_SLOTS,
  ARTIFICER_SLOTS,
  THIRD_CASTER_SLOTS,
  PACT_MAGIC_TABLE,
} from '../../../data/mechanics';
import type { Spell, SpellLevel } from '../../../types';

const SCHOOL_COLORS: Record<string, string> = {
  Abjuration: 'blue', Conjuration: 'purple', Divination: 'indigo',
  Enchantment: 'pink', Evocation: 'red', Illusion: 'violet',
  Necromancy: 'slate', Transmutation: 'green',
};

/** Returns the highest spell level the character can cast based on their slot table. */
function computeMaxSpellLevel(
  spellcastingType: string,
  classId: string,
  level: number,
): number {
  let slots: number[];
  if (spellcastingType === 'pact') {
    return PACT_MAGIC_TABLE[Math.min(level, 20)]?.slotLevel ?? 1;
  } else if (classId === 'artificer') {
    slots = ARTIFICER_SLOTS[Math.min(level, 20)] ?? Array(9).fill(0);
  } else if (spellcastingType === 'full') {
    slots = FULL_CASTER_SLOTS[Math.min(level, 20)] ?? Array(9).fill(0);
  } else if (spellcastingType === 'half') {
    slots = HALF_CASTER_SLOTS[Math.min(level, 20)] ?? Array(9).fill(0);
  } else if (spellcastingType === 'third') {
    slots = THIRD_CASTER_SLOTS[Math.min(level, 20)] ?? Array(9).fill(0);
  } else {
    return 0;
  }
  // slots[0] = 1st-level slots, slots[8] = 9th-level slots
  const highestIdx = slots.reduce((max, count, i) => (count > 0 ? i : max), -1);
  return highestIdx + 1; // convert 0-based index → spell level number
}

export function StepSpells() {
  const { draft, updateDraft } = useCreatorStore();
  const [search, setSearch] = React.useState('');
  const [filterLevel, setFilterLevel] = React.useState<number | 'all'>('all');
  const [detailSpell, setDetailSpell] = React.useState<Spell | null>(null);

  const primaryClass = draft.classes?.[0];
  const classDef = primaryClass ? getClass(primaryClass.classId) : null;
  const charLevel = primaryClass?.level ?? 1;

  // Eldritch Knight (Fighter) and Arcane Trickster (Rogue) gain spellcasting
  // via their subclass, not the base class. Check the subclass if the class itself
  // has no spellcasting.
  const subclassDef = primaryClass?.subclassId ? getSubclass(primaryClass.subclassId) : null;
  const isSubclassSpellcaster =
    !!subclassDef?.spellcastingType && subclassDef.spellcastingType !== 'none';

  const isSpellcaster =
    (classDef && classDef.spellcastingType !== 'none') || isSubclassSpellcaster;

  if (!classDef || !isSpellcaster) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Spells</h2>
        <p className="text-slate-400">
          {classDef?.name ?? 'Your class'} is not a spellcaster and doesn't use the spell list.
          You can still add spells later if you gain spellcasting through feats or subclasses.
        </p>
      </div>
    );
  }

  // Effective spellcasting type (use subclass type for EK/AT)
  const effectiveType = isSubclassSpellcaster
    ? (subclassDef!.spellcastingType ?? 'none')
    : (classDef.spellcastingType ?? 'none');

  // Subclass-based casters (EK, AT) use a different class's spell list.
  const spellListClassId = isSubclassSpellcaster
    ? (subclassDef!.spellListClassId ?? primaryClass!.classId)
    : primaryClass!.classId;

  // Max spell level the character can cast at their current level
  const maxSpellLevel = computeMaxSpellLevel(effectiveType, primaryClass!.classId, charLevel);

  // Cantrip and spell limits
  const cantripLimit = cantripsKnownFor(primaryClass!.classId, charLevel);
  const knownSpellLimit = spellsKnownFor(primaryClass!.classId, charLevel); // >0 for known-casters only

  // For prepared casters: how many spells they can prepare each day (informational)
  const abilityScores = draft.abilityScores ?? {};
  const spellAbilityMap: Record<string, string> = {
    cleric: 'wis', druid: 'wis', paladin: 'wis',
    wizard: 'int', artificer: 'int',
    bard: 'cha', sorcerer: 'cha', warlock: 'cha',
    ranger: 'wis',
  };
  const spellAbility = spellAbilityMap[primaryClass!.classId] ?? 'wis';
  const spellAbilityScore = (abilityScores as Record<string, number>)[spellAbility] ?? 10;
  const spellAbilityMod = Math.floor((spellAbilityScore - 10) / 2);
  const preparedLimit = maxPreparedSpellsFor(primaryClass!.classId, charLevel, spellAbilityMod);
  const isPreparedCaster = preparedLimit !== null;
  const isKnownCaster = knownSpellLimit > 0;

  // Build set of expanded spell IDs from the subclass (e.g. Warlock patron spells).
  const expandedSpellIds = React.useMemo(() => {
    const ids = new Set<string>();
    if (subclassDef?.expandedSpells) {
      for (const spellIds of Object.values(subclassDef.expandedSpells)) {
        for (const id of spellIds) ids.add(id);
      }
    }
    return ids;
  }, [subclassDef]);

  // All spells accessible to this class, filtered by level access and books
  const classSpells = ALL_SPELLS.filter(s =>
    (s.classes.includes(spellListClassId) || expandedSpellIds.has(s.id)) &&
    bookEnabled(s, draft.enabledBooks) &&
    (s.level === 0 || s.level <= maxSpellLevel) &&  // enforce max spell level
    (filterLevel === 'all' || s.level === filterLevel) &&
    (search === '' || s.name.toLowerCase().includes(search.toLowerCase()))
  );

  const selectedIds = new Set(draft.spellbook?.map(s => s.spellId) ?? []);

  // Count selected cantrips and non-cantrip spells separately
  const selectedSpells = draft.spellbook ?? [];
  const selectedCantrips = selectedSpells.filter(
    s => ALL_SPELLS.find(sp => sp.id === s.spellId)?.level === 0
  ).length;
  const selectedNonCantrips = selectedSpells.filter(
    s => (ALL_SPELLS.find(sp => sp.id === s.spellId)?.level ?? 0) > 0
  ).length;

  function toggleSpell(spell: Spell) {
    const current = draft.spellbook ?? [];
    if (selectedIds.has(spell.id)) {
      updateDraft({ spellbook: current.filter(s => s.spellId !== spell.id) });
      return;
    }
    // Enforce cantrip limit
    if (spell.level === 0 && cantripLimit > 0 && selectedCantrips >= cantripLimit) return;
    // Enforce known-spell limit for spontaneous casters
    if (spell.level > 0 && isKnownCaster && selectedNonCantrips >= knownSpellLimit) return;
    updateDraft({ spellbook: [...current, { spellId: spell.id, isPrepared: true, isAlwaysPrepared: false }] });
  }

  // Only show level filter buttons for accessible levels
  const accessibleLevels: SpellLevel[] = ([0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as SpellLevel[]).filter(
    l => l === 0 ? cantripLimit > 0 : l <= maxSpellLevel
  );

  // Reset filter level if it's no longer accessible
  React.useEffect(() => {
    if (filterLevel !== 'all' && !accessibleLevels.includes(filterLevel as SpellLevel)) {
      setFilterLevel('all');
    }
  }, [accessibleLevels, filterLevel]);

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-2">Spells</h2>

      {/* Guidance banner */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 mb-4 space-y-1">
        {cantripLimit > 0 && (
          <p className="text-sm text-slate-300">
            <span className="font-semibold text-white">Cantrips:</span>{' '}
            <span className={selectedCantrips >= cantripLimit ? 'text-green-400 font-bold' : 'text-amber-300'}>
              {selectedCantrips} / {cantripLimit}
            </span>
            {selectedCantrips >= cantripLimit && <span className="text-slate-400 ml-1">(full)</span>}
          </p>
        )}
        {isKnownCaster && (
          <p className="text-sm text-slate-300">
            <span className="font-semibold text-white">Spells Known:</span>{' '}
            <span className={selectedNonCantrips >= knownSpellLimit ? 'text-green-400 font-bold' : 'text-amber-300'}>
              {selectedNonCantrips} / {knownSpellLimit}
            </span>
            {selectedNonCantrips >= knownSpellLimit && <span className="text-slate-400 ml-1">(full)</span>}
          </p>
        )}
        {isPreparedCaster && !isKnownCaster && (
          <p className="text-sm text-slate-300">
            <span className="font-semibold text-white">Prepared caster</span>
            {' — '}you have access to all {classDef.name} spells.
            {preparedLimit !== null && preparedLimit > 0 && (
              <> You can prepare <span className="text-amber-300 font-semibold">{preparedLimit}</span> spell{preparedLimit !== 1 ? 's' : ''}/day on your character sheet.</>
            )}
            {preparedLimit === 0 && <> You cannot prepare spells yet (requires level 2).</>}
          </p>
        )}
        {maxSpellLevel > 0 && (
          <p className="text-xs text-slate-500">
            Max spell level at your current level: <span className="text-slate-400">{maxSpellLevel}</span>
          </p>
        )}
        {maxSpellLevel === 0 && cantripLimit === 0 && (
          <p className="text-xs text-slate-500">You don't have spell slots yet — spells become available at higher levels.</p>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          type="search"
          placeholder="Search spells..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
        />
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setFilterLevel('all')}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all', filterLevel === 'all' ? 'bg-red-700 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600')}
          >All</button>
          {accessibleLevels.map(l => (
            <button
              key={l}
              onClick={() => setFilterLevel(l)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all', filterLevel === l ? 'bg-red-700 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600')}
            >{l === 0 ? 'Cantrip' : `L${l}`}</button>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-500 mb-3">{classSpells.length} spells shown</p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {classSpells.map(spell => {
          const isSelected = selectedIds.has(spell.id);
          const isCantrip = spell.level === 0;
          const atCantripLimit = isCantrip && cantripLimit > 0 && selectedCantrips >= cantripLimit && !isSelected;
          const atSpellLimit = !isCantrip && isKnownCaster && selectedNonCantrips >= knownSpellLimit && !isSelected;
          const isDisabled = atCantripLimit || atSpellLimit;

          return (
            <HoverCard
              key={spell.id}
              content={<SpellDetail spell={spell} />}
            >
            <div
              className={cn(
                'p-3 rounded-lg border-2 transition-all',
                isSelected
                  ? 'border-red-500 bg-red-950/30'
                  : isDisabled
                    ? 'border-slate-700 bg-slate-800/50 opacity-40'
                    : 'border-slate-700 bg-slate-800 hover:border-slate-500',
              )}
            >
              <div className="flex items-start justify-between gap-1 mb-1">
                <h4
                  className="font-bold text-white text-sm cursor-pointer hover:text-red-300 flex-1"
                  onClick={() => setDetailSpell(spell)}
                >
                  {spell.name}
                </h4>
                <Badge color={SCHOOL_COLORS[spell.school] ?? 'slate'} className="shrink-0 text-xs">
                  {spell.level === 0 ? 'C' : `L${spell.level}`}
                </Badge>
              </div>
              <div className="flex gap-1 flex-wrap mb-1">
                <span className="text-xs text-slate-500">{spell.school}</span>
                {spell.concentration && <span className="text-xs text-amber-400">Conc.</span>}
                {spell.ritual && <span className="text-xs text-blue-400">Ritual</span>}
              </div>
              <p className="text-xs text-slate-400 mb-2">{spell.castingTime} · {spell.range}</p>
              <div className="flex items-center justify-between">
                <button
                  className="text-xs text-blue-400 hover:text-blue-300"
                  onClick={() => setDetailSpell(spell)}
                >Details</button>
                <button
                  onClick={() => !isDisabled && toggleSpell(spell)}
                  disabled={isDisabled}
                  className={cn(
                    'text-xs px-2 py-1 rounded font-medium transition-all',
                    isSelected
                      ? 'bg-red-700 text-white'
                      : isDisabled
                        ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                        : 'bg-slate-700 text-slate-300 hover:bg-slate-600',
                  )}
                >
                  {isSelected ? 'Remove' : 'Add'}
                </button>
              </div>
            </div>
            </HoverCard>
          );
        })}
      </div>

      {classSpells.length === 0 && (
        <div className="text-center py-12 text-slate-500">No spells match your filters</div>
      )}

      {/* Spell detail */}
      <Dialog open={!!detailSpell} onClose={() => setDetailSpell(null)} title={detailSpell?.name} wide>
        {detailSpell && <SpellDetail spell={detailSpell} />}
      </Dialog>
    </div>
  );
}

export function SpellDetail({ spell }: { spell: Spell }) {
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4">
        <Badge color={SCHOOL_COLORS[spell.school] ?? 'slate'}>
          {spell.level === 0 ? 'Cantrip' : `${spell.level}${['st','nd','rd'][spell.level-1]??'th'}-level`} {spell.school}
        </Badge>
        <Badge color="slate">{spell.sourceBook}</Badge>
        {spell.concentration && <Badge color="amber">Concentration</Badge>}
        {spell.ritual && <Badge color="blue">Ritual</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
        <div className="bg-slate-900 rounded p-2">
          <p className="text-xs text-slate-400">Casting Time</p>
          <p className="text-white">{spell.castingTime}</p>
        </div>
        <div className="bg-slate-900 rounded p-2">
          <p className="text-xs text-slate-400">Range</p>
          <p className="text-white">{spell.range}</p>
        </div>
        <div className="bg-slate-900 rounded p-2">
          <p className="text-xs text-slate-400">Duration</p>
          <p className="text-white">{spell.duration}</p>
        </div>
        <div className="bg-slate-900 rounded p-2">
          <p className="text-xs text-slate-400">Components</p>
          <p className="text-white">{spell.components.join(', ')}</p>
        </div>
      </div>

      {spell.materialComponent && (
        <div className="bg-slate-900 rounded p-2 mb-4 text-sm">
          <p className="text-xs text-slate-400">Material</p>
          <p className="text-slate-300 italic">{spell.materialComponent}</p>
        </div>
      )}

      <p className="text-sm text-slate-300 leading-relaxed mb-4 whitespace-pre-line">{spell.description}</p>

      {spell.atHigherLevels && (
        <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-3">
          <p className="text-xs font-bold text-amber-300 mb-1">At Higher Levels</p>
          <p className="text-xs text-amber-200 leading-relaxed">{spell.atHigherLevels}</p>
        </div>
      )}

      <div className="mt-4">
        <p className="text-xs text-slate-400">Available to: {spell.classes.join(', ')}</p>
      </div>
    </div>
  );
}
