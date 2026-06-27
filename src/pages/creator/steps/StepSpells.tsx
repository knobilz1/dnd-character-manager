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

/** Per-spell-level CUMULATIVE caps for a wizard's spellbook. A wizard may only add
 *  a spell "of a level for which you have spell slots" (PHB p.114), so the number
 *  of book spells of level ≥ k can't exceed how many spells were learned at the
 *  character levels where level-k slots already existed (6 at level 1, +2 each level
 *  after). Returns { k: maxSpellsOfLevelKOrHigher } for k = 1..maxSpellLevel.
 *
 *  caps[1] === the total spellbook size (every batch can hold a 1st-level spell), so
 *  1st level is bounded only by the total; the higher entries are the real limits.
 *  This also guarantees the ≥8 first-level spells a wizard accrues at levels 1–2. */
function spellbookCumulativeCaps(
  spellcastingType: string,
  classId: string,
  charLevel: number,
): Record<number, number> {
  const maxLvl = computeMaxSpellLevel(spellcastingType, classId, charLevel);
  const caps: Record<number, number> = {};
  for (let k = 1; k <= maxLvl; k++) {
    let n = 0;
    for (let lvl = 1; lvl <= charLevel; lvl++) {
      if (computeMaxSpellLevel(spellcastingType, classId, lvl) >= k) n += lvl === 1 ? 6 : 2;
    }
    caps[k] = n;
  }
  return caps;
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 4 → "4th"… */
const ordinal = (n: number) => `${n}${['st', 'nd', 'rd'][n - 1] ?? 'th'}`;

export function StepSpells() {
  const { draft, updateDraft } = useCreatorStore();
  const [search, setSearch] = React.useState('');
  const [filterLevel, setFilterLevel] = React.useState<number | 'all'>('all');
  const [detailSpell, setDetailSpell] = React.useState<Spell | null>(null);
  const [showAllSchools, setShowAllSchools] = React.useState(false);

  const primaryClass = draft.classes?.[0];
  const classDef = primaryClass ? getClass(primaryClass.classId) : null;
  const charLevel = primaryClass?.level ?? 1;

  // Eldritch Knight (Fighter) and Arcane Trickster (Rogue) gain spellcasting
  // via their subclass, not the base class. Check the subclass if the class itself
  // has no spellcasting.
  const subclassDef = primaryClass?.subclassId ? getSubclass(primaryClass.subclassId) : null;
  const isSubclassSpellcaster =
    !!subclassDef?.spellcastingType && subclassDef.spellcastingType !== 'none';

  // EK/AT: use per-level tables from the subclass for cantrip and spell-known limits.
  const subclassCantripLimit = isSubclassSpellcaster
    ? (subclassDef?.cantripsKnownByClassLevel?.[Math.min(charLevel, 20) - 1] ?? null)
    : null;
  const subclassSpellLimit = isSubclassSpellcaster
    ? (subclassDef?.spellsKnownByClassLevel?.[Math.min(charLevel, 20) - 1] ?? null)
    : null;
  // School restriction: EK = Abjuration/Evocation; AT = Enchantment/Illusion. Cantrips unrestricted.
  const schoolRestriction: string[] | null =
    isSubclassSpellcaster && (subclassDef?.restrictedSchools?.length ?? 0) > 0
      ? subclassDef!.restrictedSchools!
      : null;

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
  // 2024 classes carry spellListClassId pointing to the base class name used on spell entries.
  const spellListClassId = isSubclassSpellcaster
    ? (subclassDef!.spellListClassId ?? primaryClass!.classId)
    : (classDef.spellListClassId ?? primaryClass!.classId);

  // For mechanics lookups, 2024 classes use their own IDs (which are registered in mechanics tables).
  const mechClassId = primaryClass!.classId;

  // Max spell level the character can cast at their current level
  const maxSpellLevel = computeMaxSpellLevel(effectiveType, mechClassId, charLevel);

  // Cantrip and spell limits (EK/AT override via subclass level tables)
  const cantripLimit = subclassCantripLimit !== null
    ? subclassCantripLimit
    : cantripsKnownFor(mechClassId, charLevel);
  const knownSpellLimit = subclassSpellLimit !== null
    ? subclassSpellLimit
    : spellsKnownFor(mechClassId, charLevel); // >0 for known-casters only

  // For prepared casters: how many spells they can prepare each day (informational)
  const abilityScores = draft.baseAbilityScores ?? {};
  const spellAbilityMap: Record<string, string> = {
    cleric: 'wis', druid: 'wis', paladin: 'wis',
    wizard: 'int', artificer: 'int',
    bard: 'cha', sorcerer: 'cha', warlock: 'cha',
    ranger: 'wis',
    // 2024 PHB classes
    'cleric-2024': 'wis', 'druid-2024': 'wis', 'paladin-2024': 'cha',
    'wizard-2024': 'int',
    'bard-2024': 'cha', 'sorcerer-2024': 'cha', 'warlock-2024': 'cha',
    'ranger-2024': 'wis',
  };
  const spellAbility = spellAbilityMap[primaryClass!.classId] ?? 'wis';
  const spellAbilityScore = (abilityScores as Record<string, number>)[spellAbility] ?? 10;
  const spellAbilityMod = Math.floor((spellAbilityScore - 10) / 2);
  const preparedLimit = maxPreparedSpellsFor(primaryClass!.classId, charLevel, spellAbilityMod);
  const isPreparedCaster = preparedLimit !== null;
  // Wizard spellbook size: 6 spells at level 1, +2 for every level thereafter
  // (PHB p.114). So a level-3 wizard's spellbook holds 6 + 2×2 = 10 spells, all
  // of any level the wizard can cast (capped by maxSpellLevel below).
  const isSpellbookCaster = ['wizard', 'wizard-2024'].includes(primaryClass!.classId);
  const spellbookLimit = isSpellbookCaster ? 6 + 2 * Math.max(0, charLevel - 1) : 0;
  const isKnownCaster = knownSpellLimit > 0 || isSpellbookCaster;
  // How many non-cantrip spells the user may pick here: a wizard's spellbook size,
  // or a spontaneous caster's spells-known. (Prepared-only casters like cleric/druid
  // aren't "known" casters and have no pick cap — they prepare on the sheet.)
  const effectiveSpellLimit = isSpellbookCaster ? spellbookLimit : knownSpellLimit;
  // Wizards gate per spell level via cumulative "level-k-or-higher" caps; known
  // casters pick any mix up to their spells-known, so no per-level cap for them.
  const spellbookCaps = isSpellbookCaster
    ? spellbookCumulativeCaps(effectiveType, mechClassId, charLevel)
    : null;

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

  // All spells accessible to this class, filtered by level access, books, and school restriction
  const classSpells = ALL_SPELLS.filter(s =>
    (s.classes.includes(spellListClassId) || expandedSpellIds.has(s.id)) &&
    bookEnabled(s, draft.enabledBooks) &&
    (s.level === 0 || s.level <= maxSpellLevel) &&  // enforce max spell level
    (!schoolRestriction || showAllSchools || s.level === 0 || schoolRestriction.includes(s.school)) &&
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
  // How many non-cantrip spells are selected at each spell level (for per-level gating).
  const selectedByLevel: Record<number, number> = {};
  for (const s of selectedSpells) {
    const lv = ALL_SPELLS.find(sp => sp.id === s.spellId)?.level ?? 0;
    if (lv > 0) selectedByLevel[lv] = (selectedByLevel[lv] ?? 0) + 1;
  }
  // Selected spells of level ≥ k (the quantity each cumulative cap limits).
  const selectedAtOrAbove = (k: number) => {
    let n = 0;
    for (const [lv, cnt] of Object.entries(selectedByLevel)) if (Number(lv) >= k) n += cnt;
    return n;
  };
  // A wizard can't add a spell of level `lvl` if doing so would push any of the
  // "level-j-or-higher" buckets (j ≤ lvl) past its cap — including caps[1] (total).
  const spellbookFullForLevel = (lvl: number): boolean => {
    if (!isSpellbookCaster || !spellbookCaps) return false;
    for (let j = 1; j <= lvl; j++) {
      if (selectedAtOrAbove(j) >= (spellbookCaps[j] ?? Infinity)) return true;
    }
    return false;
  };

  function toggleSpell(spell: Spell) {
    const current = draft.spellbook ?? [];
    if (selectedIds.has(spell.id)) {
      updateDraft({ spellbook: current.filter(s => s.spellId !== spell.id) });
      return;
    }
    // Enforce cantrip limit
    if (spell.level === 0 && cantripLimit > 0 && selectedCantrips >= cantripLimit) return;
    // Enforce the non-cantrip pick limit. Wizards gate per spell level (cumulative);
    // known casters gate on the flat spells-known total.
    if (spell.level > 0) {
      if (isSpellbookCaster) {
        if (spellbookFullForLevel(spell.level)) return;
      } else if (isKnownCaster && selectedNonCantrips >= effectiveSpellLimit) {
        return;
      }
    }
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
            <span className="font-semibold text-white">{isSpellbookCaster ? 'Spellbook:' : 'Spells Known:'}</span>{' '}
            <span className={selectedNonCantrips >= effectiveSpellLimit ? 'text-green-400 font-bold' : 'text-amber-300'}>
              {selectedNonCantrips} / {effectiveSpellLimit}
            </span>
            {selectedNonCantrips >= effectiveSpellLimit && <span className="text-slate-400 ml-1">(full)</span>}
          </p>
        )}
        {/* Per-spell-level caps for wizards. Each entry is a CUMULATIVE limit on how
            many book spells can be of that level or higher (e.g. at L20 at most 8 can
            be 9th-level, 12 can be 8th-or-higher …). 1st level is bounded only by the
            total spellbook size, so it isn't listed. */}
        {isSpellbookCaster && spellbookCaps && maxSpellLevel >= 2 && (
          <p className="text-sm text-slate-300 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="font-semibold text-white">By level (max of that level or higher):</span>
            {Object.keys(spellbookCaps).map(Number).filter(k => k >= 2).sort((a, b) => b - a).map(k => {
              const have = selectedAtOrAbove(k);
              const cap = spellbookCaps[k];
              const full = have >= cap;
              const label = k === maxSpellLevel ? ordinal(k) : `${ordinal(k)}+`;
              return (
                <span key={k}>
                  <span className="text-slate-400">{label}:</span>{' '}
                  <span className={full ? 'text-green-400 font-bold' : 'text-amber-300'}>{have} / {cap}</span>
                  {full && <span className="text-slate-500 ml-1">(full)</span>}
                </span>
              );
            })}
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

      {/* School restriction banner for EK / Arcane Trickster */}
      {schoolRestriction && (
        <div className="bg-yellow-950/30 border border-yellow-700/50 rounded-lg px-3 py-2 mb-3 flex items-center justify-between gap-3">
          <p className="text-xs text-yellow-300">
            <span className="font-semibold">School restriction:</span>{' '}
            {schoolRestriction.join(' or ')} only (cantrips unrestricted).
            {subclassDef?.freePickLevels?.length
              ? ` Free pick (any school) at levels ${subclassDef.freePickLevels.join(', ')}.`
              : ''}
          </p>
          <button
            onClick={() => setShowAllSchools(prev => !prev)}
            className={cn(
              'shrink-0 text-xs px-2.5 py-1 rounded-md border font-medium transition-colors',
              showAllSchools
                ? 'bg-yellow-700/40 border-yellow-500 text-yellow-200'
                : 'border-yellow-700 text-yellow-400 hover:bg-yellow-900/30',
            )}
          >
            {showAllSchools ? 'Show restricted' : 'Show all schools'}
          </button>
        </div>
      )}

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
          const atSpellLimit = !isCantrip && !isSelected && (
            isSpellbookCaster
              ? spellbookFullForLevel(spell.level)
              : isKnownCaster && selectedNonCantrips >= effectiveSpellLimit
          );
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
