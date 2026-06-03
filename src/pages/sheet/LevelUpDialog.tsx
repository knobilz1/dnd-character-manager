import React from 'react';
import { Dialog, Button, Badge, HoverCard } from '../../components/ui';
import { cn } from '../../utils/cn';
import { getClass } from '../../data/classes';
import { getSubclass, ALL_SUBCLASSES } from '../../data/subclasses';
import { getRace } from '../../data/races';
import { getBackground } from '../../data/backgrounds';
import {
  abilityMod, cantripsKnownFor, maxPreparedSpellsFor, spellsKnownFor,
  FULL_CASTER_SLOTS, HALF_CASTER_SLOTS, ARTIFICER_SLOTS, THIRD_CASTER_SLOTS, PACT_MAGIC_TABLE,
} from '../../data/mechanics';
import { ALL_FEATS, getEligibleFeats } from '../../data/feats';
import { ALL_SPELLS } from '../../data/spells';
import { ALL_INVOCATIONS } from '../../data/invocations';
import { ALL_PACT_BOONS } from '../../data/pactBoons';
import { ALL_METAMAGIC } from '../../data/metamagic';
import { ALL_MANEUVERS } from '../../data/maneuvers';
import { ALL_INFUSIONS } from '../../data/infusions';
import { ALL_OPTIONAL_CLASS_FEATURES } from '../../data/optionalClassFeatures';
import { BOOKS } from '../../data/books';
import { bookEnabled } from '../../utils/bookEnabled';
import { useCharacterStore } from '../../store/useCharacterStore';
import { useCharacterDerived } from '../../hooks/useCharacterDerived';
import type { Character, AbilityKey, ASIChoice, BookId } from '../../types';

const BOOK_COLOR = Object.fromEntries(BOOKS.map(b => [b.id, b.color])) as Record<BookId, string>;

interface LevelUpDialogProps {
  open: boolean;
  onClose: () => void;
  character: Character;
  onConfirm: (classId: string, hpGained: number, hpRoll: number, subclassPick?: string, asiChoice?: ASIChoice, expertiseToAdd?: string[]) => void;
}

type HpMethod = 'average' | 'roll';
type ASIMode = 'asi' | 'feat';

const ABILITY_KEYS: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_LABELS: Record<AbilityKey, string> = {
  str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
};

function warlockInvocationCount(level: number): number {
  if (level < 2) return 0;
  if (level >= 18) return 8;
  if (level >= 15) return 7;
  if (level >= 12) return 6;
  if (level >= 9) return 5;
  if (level >= 7) return 4;
  if (level >= 5) return 3;
  return 2;
}

function sorcererMetamagicCount(level: number): number {
  if (level >= 17) return 4;
  if (level >= 10) return 3;
  if (level >= 3) return 2;
  return 0;
}

function battleMasterManeuverCount(level: number): number {
  if (level >= 15) return 9;
  if (level >= 10) return 7;
  if (level >= 7) return 5;
  return 3;
}

function artificerInfusionCount(level: number): number {
  if (level < 2) return 0;
  if (level >= 18) return 12;
  if (level >= 14) return 10;
  if (level >= 10) return 8;
  if (level >= 6) return 6;
  return 4;
}

// Compact selector for class options (invocations, metamagic, maneuvers, infusions)
interface OptionPickerProps {
  items: { id: string; name: string; description: string; meta?: string }[];
  selected: string[];
  max: number;
  onToggle: (id: string) => void;
}
function CompactOptionPicker({ items, selected, max, onToggle }: OptionPickerProps) {
  const sel = new Set(selected);
  const [search, setSearch] = React.useState('');
  const filtered = items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));
  return (
    <div>
      <input
        type="text"
        placeholder="Search…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 mb-2 focus:outline-none focus:border-red-500"
      />
      <div className="grid gap-1.5 sm:grid-cols-2 max-h-52 overflow-y-auto scrollbar-thin pr-1">
        {filtered.map(item => {
          const isSelected = sel.has(item.id);
          const canSelect = isSelected || sel.size < max;
          return (
            <HoverCard key={item.id} content={
              <div>
                <p className="font-bold text-white text-sm mb-1">{item.name}</p>
                {item.meta && <p className="text-xs text-yellow-400 mb-1">{item.meta}</p>}
                <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{item.description}</p>
              </div>
            }>
              <button
                onClick={() => { if (canSelect || isSelected) onToggle(item.id); }}
                className={cn(
                  'w-full p-2 rounded-lg border text-left transition-all',
                  isSelected ? 'border-red-500 bg-red-950/30' : 'border-slate-700 bg-slate-800',
                  canSelect ? 'hover:border-slate-500 cursor-pointer' : 'opacity-50 cursor-not-allowed',
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="text-xs font-bold text-white leading-snug flex-1">{item.name}</span>
                  {isSelected && <span className="text-red-400 text-xs shrink-0">✓</span>}
                </div>
                {item.meta && <p className="text-[10px] text-yellow-400 mt-0.5">{item.meta}</p>}
                <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">{item.description}</p>
              </button>
            </HoverCard>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-xs text-slate-500 italic col-span-2">No results.</p>
        )}
      </div>
    </div>
  );
}

export function LevelUpDialog({ open, onClose, character, onConfirm }: LevelUpDialogProps) {
  const { addSpellToBook, updateClassOptions } = useCharacterStore();
  const derived = useCharacterDerived(character);
  const [selectedClassIdx, setSelectedClassIdx] = React.useState(0);
  const [pendingSubclass, setPendingSubclass] = React.useState<string | undefined>(undefined);

  const primary = character.classes[selectedClassIdx] ?? character.classes[0];
  const classDef = primary ? getClass(primary.classId) : null;
  const currentLevel = primary?.level ?? 1;
  const newLevel = currentLevel + 1;

  const conMod = derived?.mods.con ?? abilityMod(character.baseAbilityScores.con);
  const hitDie = classDef?.hitDie ?? 8;
  // Per-level HP bonuses from subclass (e.g. Draconic Bloodline: +1), race (e.g. Hill Dwarf: +1),
  // and feats already owned (e.g. Tough: +2). The feat being PICKED this level is handled
  // separately in hpGained below so its retroactive bonus can be applied correctly.
  const subHPBonusPerLevel =
    getSubclass(primary?.subclassId ?? pendingSubclass ?? '')?.hpBonusPerLevel ?? 0;
  const raceHPBonusPerLevel = getRace(character.raceId)?.hpBonusPerLevel ?? 0;
  const existingFeatHPBonusPerLevel = (character.selectedFeats ?? []).reduce((sum, fid) => {
    const feat = ALL_FEATS.find(f => f.id === fid);
    return sum + (feat?.hpBonusPerLevel ?? 0);
  }, 0);
  const totalHPBonusPerLevel = subHPBonusPerLevel + raceHPBonusPerLevel + existingFeatHPBonusPerLevel;
  const averagePerLevel = Math.max(1, Math.floor(hitDie / 2) + 1 + conMod) + totalHPBonusPerLevel;

  const [method, setMethod] = React.useState<HpMethod>('average');
  const [rollResult, setRollResult] = React.useState<number | null>(null);
  const [asiMode, setASIMode] = React.useState<ASIMode>('asi');
  const [asiIncreases, setASIIncreases] = React.useState<Partial<Record<AbilityKey, number>>>({});
  const [selectedFeat, setSelectedFeat] = React.useState<string | undefined>(undefined);
  const [featASIChoice, setFeatASIChoice] = React.useState<AbilityKey | undefined>(undefined);
  const [featSearch, setFeatSearch] = React.useState('');
  const [pendingExpertise, setPendingExpertise] = React.useState<string[]>([]);

  // Spell / option selection state
  const [pendingCantrips, setPendingCantrips] = React.useState<string[]>([]);
  const [pendingSpells, setPendingSpells] = React.useState<string[]>([]);
  const [spellSearch, setSpellSearch] = React.useState('');
  const [spellLevelFilter, setSpellLevelFilter] = React.useState<number | 'all'>('all');
  const [pendingPactBoon, setPendingPactBoon] = React.useState<string | undefined>(undefined);
  const [pendingTotemSpirit, setPendingTotemSpirit] = React.useState<string | undefined>(undefined);
  const [pendingAspectTotem, setPendingAspectTotem] = React.useState<string | undefined>(undefined);
  const [pendingTotemicAttunement, setPendingTotemicAttunement] = React.useState<string | undefined>(undefined);
  const [pendingInvocations, setPendingInvocations] = React.useState<string[]>([]);
  const [pendingMetamagic, setPendingMetamagic] = React.useState<string[]>([]);
  const [pendingManeuvers, setPendingManeuvers] = React.useState<string[]>([]);
  const [pendingInfusions, setPendingInfusions] = React.useState<string[]>([]);
  const [pendingOptionalFeatures, setPendingOptionalFeatures] = React.useState<string[]>([]);

  // Reset all per-class choices when the selected class changes mid-dialog.
  React.useEffect(() => {
    setMethod('average');
    setRollResult(null);
    setPendingSubclass(undefined);
    setASIMode('asi');
    setASIIncreases({});
    setSelectedFeat(undefined);
    setFeatSearch('');
    setPendingCantrips([]);
    setPendingSpells([]);
    setSpellSearch('');
    setSpellLevelFilter('all');
    setPendingPactBoon(undefined);
    setPendingTotemSpirit(undefined);
    setPendingAspectTotem(undefined);
    setPendingTotemicAttunement(undefined);
    setPendingInvocations([]);
    setPendingMetamagic([]);
    setPendingManeuvers([]);
    setPendingInfusions([]);
    setPendingOptionalFeatures([]);
    setPendingExpertise([]);
  }, [selectedClassIdx]);

  React.useEffect(() => {
    if (open) {
      setSelectedClassIdx(0);
      setMethod('average');
      setRollResult(null);
      setPendingSubclass(undefined);
      setASIMode('asi');
      setASIIncreases({});
      setSelectedFeat(undefined);
      setFeatSearch('');
      setPendingCantrips([]);
      setPendingSpells([]);
      setSpellSearch('');
      setSpellLevelFilter('all');
      setPendingPactBoon(undefined);
      setPendingTotemSpirit(undefined);
      setPendingAspectTotem(undefined);
      setPendingTotemicAttunement(undefined);
      setPendingInvocations([]);
      setPendingMetamagic([]);
      setPendingManeuvers([]);
      setPendingInfusions([]);
      setPendingOptionalFeatures([]);
      setPendingExpertise([]);
    }
  }, [open]);

  if (!classDef) return null;

  const classId = classDef.id;

  function rollHitDie() {
    const roll = Math.floor(Math.random() * hitDie) + 1;
    setRollResult(roll);
  }

  // Use the already-assigned subclass, or the pending pick if this is the first subclass selection.
  // This ensures the subclass's entry-level features appear in "Features Gained" as soon as
  // the player selects a subclass in this level-up dialog.
  const sub = getSubclass(primary?.subclassId ?? pendingSubclass ?? '');

  // Subclass-granted spellcasting (EK, AT): class itself has spellcastingType 'none'
  // but the subclass grants third-caster spellcasting from a different class's list.
  const isSubclassSpellcaster =
    classDef.spellcastingType === 'none' &&
    !!sub?.spellcastingType && sub.spellcastingType !== 'none';
  // Which class's spell list to use for filtering available cantrips/spells.
  const spellListClassId = isSubclassSpellcaster ? (sub!.spellListClassId ?? classId) : classId;

  // EK/AT school restrictions: certain levels grant a free pick from any school;
  // all others are limited to the subclass's restricted schools (cantrips are never restricted).
  const isFreePick = isSubclassSpellcaster && (sub?.freePickLevels ?? []).includes(newLevel);
  const schoolRestriction: string[] | null =
    isSubclassSpellcaster && !isFreePick && (sub?.restrictedSchools?.length ?? 0) > 0
      ? sub!.restrictedSchools!
      : null;

  const newFeatures = [
    ...classDef.features.filter(f => f.level === newLevel).map(f => ({ source: 'Class', ...f })),
    ...(sub?.features ?? []).filter(f => f.level === newLevel).map(f => ({ source: sub!.name, ...f })),
  ];

  const needsSubclass = newLevel === classDef.subclassLevel && !primary?.subclassId;
  const availableSubclasses = needsSubclass
    ? ALL_SUBCLASSES.filter(s => s.classId === classDef.id && bookEnabled(s, character.enabledBooks))
    : [];

  const isASI = newFeatures.some(f => (f as any).isASI);

  // hpRoll is the raw die result (before Con mod) stored in hitPointsRolled history.
  // For average, this is always floor(hitDie/2)+1 — never derived from the clamped
  // averagePerLevel, which would inflate the stored value when Con is very negative.
  const hpRoll = method === 'roll' ? (rollResult ?? 0) : Math.floor(hitDie / 2) + 1;
  // Per-level bonus from the feat chosen THIS level-up (e.g. Tough: +2).
  const newFeatHPBonus = selectedFeat
    ? (ALL_FEATS.find(f => f.id === selectedFeat)?.hpBonusPerLevel ?? 0)
    : 0;
  // Retroactive one-time HP boost for feats that grant bonus for all past levels (e.g. Tough:
  // "+2 × your level when you gain this feat"). derived.totalLevel is pre-level-up, so
  // multiplying by it covers the previous levels; the current level's +2 is already in
  // newFeatHPBonus. Total Tough benefit = newFeatHPBonus(2) + retroactive(2×T) = 2×(T+1). ✓
  const newFeatRetroactive = selectedFeat
    ? (ALL_FEATS.find(f => f.id === selectedFeat)?.hpRetroactiveBonusPerPastLevel ?? 0) * (derived?.totalLevel ?? 1)
    : 0;
  const hpGained = method === 'roll'
    ? Math.max(1, (rollResult ?? 0) + conMod) + totalHPBonusPerLevel + newFeatHPBonus + newFeatRetroactive
    : averagePerLevel + newFeatHPBonus + newFeatRetroactive;

  // Effective scores (base + racial + feat bonuses) for display and cap-checking
  const race = getRace(character.raceId);
  const racialBonuses = race?.abilityScoreIncreases ?? {};
  const effectiveScore = (k: AbilityKey) =>
    derived?.finalScores[k] ?? ((character.baseAbilityScores[k] ?? 0) + ((racialBonuses as Partial<Record<AbilityKey, number>>)[k] ?? 0));

  const pointsSpent = Object.values(asiIncreases).reduce((a, b) => a + (b ?? 0), 0);

  function adjustIncrease(key: AbilityKey, delta: number) {
    const current = asiIncreases[key] ?? 0;
    const newVal = current + delta;
    if (newVal < 0) return;
    if (newVal > 2) return;
    const effective = effectiveScore(key);
    if (delta > 0 && effective + newVal > 20) return;
    if (delta > 0 && pointsSpent >= 2) return;
    setASIIncreases(prev => ({ ...prev, [key]: newVal === 0 ? 0 : newVal }));
  }

  const eligibleFeats = React.useMemo(
    () => getEligibleFeats(character, character.enabledBooks),
    [character]
  );
  const filteredFeats = eligibleFeats.filter(f =>
    f.name.toLowerCase().includes(featSearch.toLowerCase())
  );

  const selectedFeatDef = selectedFeat ? ALL_FEATS.find(f => f.id === selectedFeat) : undefined;
  const featNeedsASIChoice = !!(selectedFeatDef?.abilityScoreChoice?.length);

  const asiChoiceValid = !isASI || (
    asiMode === 'feat'
      ? selectedFeat != null && (!featNeedsASIChoice || featASIChoice != null)
      : pointsSpent === 2
  );

  function buildASIChoice(): ASIChoice | undefined {
    if (!isASI) return undefined;
    if (asiMode === 'feat' && selectedFeat) {
      const abilityIncrease = (featNeedsASIChoice && featASIChoice)
        ? { [featASIChoice]: 1 } as Partial<Record<AbilityKey, number>>
        : undefined;
      return { type: 'feat', featId: selectedFeat, abilityIncrease };
    }
    if (asiMode === 'asi' && pointsSpent === 2) {
      const increases: Partial<Record<AbilityKey, number>> = {};
      for (const [k, v] of Object.entries(asiIncreases)) {
        if ((v ?? 0) > 0) increases[k as AbilityKey] = v;
      }
      return { type: 'asi', increases };
    }
    return undefined;
  }

  function confirm() {
    if (!primary) return;
    if (needsSubclass && !pendingSubclass) return;

    // Add spells and cantrips to the spellbook
    for (const id of [...pendingCantrips, ...pendingSpells]) {
      addSpellToBook(id);
    }

    // Merge pending class options with existing
    const existing = character.classOptions ?? { fightingStyles: [], invocations: [], metamagic: [], maneuvers: [], infusions: [], optionalFeatures: [] };
    if (pendingPactBoon || pendingTotemSpirit || pendingAspectTotem || pendingTotemicAttunement ||
        pendingInvocations.length || pendingMetamagic.length || pendingManeuvers.length ||
        pendingInfusions.length || pendingOptionalFeatures.length) {
      updateClassOptions({
        ...(pendingPactBoon ? { pactBoon: pendingPactBoon } : {}),
        ...(pendingTotemSpirit ? { totemSpirit: pendingTotemSpirit } : {}),
        ...(pendingAspectTotem ? { aspectTotem: pendingAspectTotem } : {}),
        ...(pendingTotemicAttunement ? { totemicAttunement: pendingTotemicAttunement } : {}),
        invocations: [...new Set([...existing.invocations, ...pendingInvocations])],
        metamagic: [...new Set([...existing.metamagic, ...pendingMetamagic])],
        maneuvers: [...new Set([...existing.maneuvers, ...pendingManeuvers])],
        infusions: [...new Set([...existing.infusions, ...pendingInfusions])],
        optionalFeatures: [...new Set([...(existing.optionalFeatures ?? []), ...pendingOptionalFeatures])],
      });
    }

    onConfirm(primary.classId, hpGained, hpRoll, pendingSubclass, buildASIChoice(), pendingExpertise.length > 0 ? pendingExpertise : undefined);
    onClose();
  }

  // ── Spell slot changes ───────────────────────────────────────────────────
  const isWarlock = classId === 'warlock';

  // Eldritch Knight and Arcane Trickster have spellcastingType: 'third' on
  // their subclass, not on the Fighter/Rogue class def (which stays 'none').
  // Fall back to subclass spellcasting type so their slot gains show up here.
  const effectiveSpellcastingType = classDef.spellcastingType !== 'none'
    ? classDef.spellcastingType
    : (sub?.spellcastingType ?? 'none');
  const slotTable =
    effectiveSpellcastingType === 'full'  ? FULL_CASTER_SLOTS  :
    effectiveSpellcastingType === 'half'  ? (classId === 'artificer' ? ARTIFICER_SLOTS : HALF_CASTER_SLOTS) :
    effectiveSpellcastingType === 'third' ? THIRD_CASTER_SLOTS : null;
  const oldSlots: number[] = slotTable?.[currentLevel] ?? Array(9).fill(0);
  const newSlots: number[] = slotTable?.[newLevel] ?? Array(9).fill(0);
  const slotsGained = oldSlots.map((old, i) => Math.max(0, (newSlots[i] ?? 0) - old));

  const oldPact = isWarlock ? PACT_MAGIC_TABLE[currentLevel] : null;
  const newPact = isWarlock ? PACT_MAGIC_TABLE[newLevel] : null;
  const pactSlotsGained = (oldPact && newPact) ? Math.max(0, newPact.slots - oldPact.slots) : 0;
  const pactLevelGained = (oldPact && newPact) ? Math.max(0, newPact.slotLevel - oldPact.slotLevel) : 0;

  const hasSlotChanges = slotsGained.some(g => g > 0) || pactSlotsGained > 0 || pactLevelGained > 0;

  // ── Cantrip changes ──────────────────────────────────────────────────────
  // For EK/AT the class itself (fighter/rogue) has no cantrip table; use the
  // subclass's per-class-level table instead.
  const oldCantripCount = isSubclassSpellcaster
    ? (sub?.cantripsKnownByClassLevel?.[currentLevel - 1] ?? 0)
    : cantripsKnownFor(classId, currentLevel);
  const newCantripCount = isSubclassSpellcaster
    ? (sub?.cantripsKnownByClassLevel?.[newLevel - 1] ?? 0)
    : cantripsKnownFor(classId, newLevel);
  const cantripsGained = newCantripCount - oldCantripCount;

  const spellbookIds = new Set(character.spellbook.map(sp => sp.spellId));
  const enabledBooks = character.enabledBooks;

  const availableCantrips = ALL_SPELLS.filter(s =>
    s.level === 0 &&
    bookEnabled(s, enabledBooks) &&
    s.classes.includes(spellListClassId) &&
    !spellbookIds.has(s.id) &&
    !pendingCantrips.includes(s.id)
  );

  // ── Spell known/prepared changes ─────────────────────────────────────────
  // EK/AT: class has spellcastingType 'none' but subclass grants it — use effectiveSpellcastingType.
  const hasSpellcasting = classDef.spellcastingType !== 'none' || isSubclassSpellcaster;
  // EK/AT are known casters with their own per-class-level spell table.
  const isSubclassKnownCaster = isSubclassSpellcaster && !!sub?.spellsKnownByClassLevel;
  const isKnownCaster = ['bard', 'sorcerer', 'warlock', 'ranger'].includes(classId) || isSubclassKnownCaster;
  const isPreparedCaster = ['cleric', 'druid', 'paladin', 'wizard', 'artificer'].includes(classId);

  const spellsKnownGained = isSubclassKnownCaster
    ? Math.max(0, (sub!.spellsKnownByClassLevel![newLevel - 1] ?? 0) - (sub!.spellsKnownByClassLevel![currentLevel - 1] ?? 0))
    : isKnownCaster
      ? Math.max(0, spellsKnownFor(classId, newLevel) - spellsKnownFor(classId, currentLevel))
      : 0;

  const spellcastingAbility = classDef.spellcastingAbility as AbilityKey | undefined;
  const spellMod = spellcastingAbility
    ? (derived?.mods[spellcastingAbility] ?? abilityMod((character.baseAbilityScores[spellcastingAbility] ?? 10) + ((racialBonuses as any)[spellcastingAbility] ?? 0)))
    : 0;
  const oldMaxPrepared = isPreparedCaster ? (maxPreparedSpellsFor(classId, currentLevel, spellMod) ?? 0) : 0;
  const newMaxPrepared = isPreparedCaster ? (maxPreparedSpellsFor(classId, newLevel, spellMod) ?? 0) : 0;

  // Max spell level unlocked at new level (from regular slot table)
  const newMaxSpellLevel = newSlots.reduce((max, count, i) => count > 0 ? i + 1 : max, 0);
  // Also account for pact magic
  const effectiveMaxSpellLevel = isWarlock ? (newPact?.slotLevel ?? 0) : newMaxSpellLevel;

  const availableSpells = ALL_SPELLS.filter(s =>
    s.level > 0 &&
    s.level <= effectiveMaxSpellLevel &&
    bookEnabled(s, enabledBooks) &&
    s.classes.includes(spellListClassId) &&
    (!schoolRestriction || schoolRestriction.includes(s.school)) &&
    !spellbookIds.has(s.id) &&
    !pendingSpells.includes(s.id) &&
    (spellLevelFilter === 'all' || s.level === spellLevelFilter) &&
    (spellSearch === '' || s.name.toLowerCase().includes(spellSearch.toLowerCase()))
  );

  // Level options for the spell level filter (only levels up to effectiveMaxSpellLevel)
  const spellLevelOptions = Array.from({ length: effectiveMaxSpellLevel }, (_, i) => i + 1);

  // ── Class options ────────────────────────────────────────────────────────
  // Cast to Partial so the spread defaults compile when all fields are required in the type
  // (old/imported characters may be missing fields at runtime, so the defaults are still needed).
  const _rawOpts = character.classOptions as Partial<typeof character.classOptions>;
  const classOpts = { fightingStyles: [], invocations: [], metamagic: [], maneuvers: [], infusions: [], optionalFeatures: [], ..._rawOpts };

  const needsPactBoon = isWarlock && newLevel >= 3 && !classOpts.pactBoon;

  // ── Totem Warrior checks ──────────────────────────────────────────────────
  const isTotemWarrior = classId === 'barbarian' && (
    (primary?.subclassId === 'totem-warrior' || primary?.subclassId === 'scag-totem-warrior-elk-tiger') ||
    (pendingSubclass === 'totem-warrior' || pendingSubclass === 'scag-totem-warrior-elk-tiger')
  );
  const hasScagTotems = isTotemWarrior && enabledBooks.includes('SCAG');
  const needsTotemSpirit = isTotemWarrior && newLevel >= 3 && !classOpts.totemSpirit;
  const needsAspectTotem = isTotemWarrior && newLevel >= 6 && !classOpts.aspectTotem;
  const needsTotemicAttunement = isTotemWarrior && newLevel >= 14 && !classOpts.totemicAttunement;

  type TotemAnimal = { id: string; emoji: string; name: string; description: string };
  const TOTEM_SPIRIT_OPTIONS: TotemAnimal[] = [
    { id: 'bear',  emoji: '🐻', name: 'Bear',  description: 'While raging, resistance to all damage except psychic.' },
    { id: 'eagle', emoji: '🦅', name: 'Eagle', description: 'While raging, enemies have disadvantage on opportunity attacks against you; Dash as bonus action.' },
    { id: 'wolf',  emoji: '🐺', name: 'Wolf',  description: 'While raging, allies have advantage on melee attacks vs. creatures within 5 ft. of you.' },
    ...(hasScagTotems ? [
      { id: 'elk',   emoji: '🦌', name: 'Elk',   description: 'While raging (no heavy armor), +15 ft. walking speed.' },
      { id: 'tiger', emoji: '🐯', name: 'Tiger', description: 'While raging, +10 ft. long jump and +3 ft. high jump.' },
    ] : []),
  ];
  const ASPECT_TOTEM_OPTIONS: TotemAnimal[] = [
    { id: 'bear',  emoji: '🐻', name: 'Bear',  description: 'Carrying capacity doubles; advantage on Str checks to push, pull, lift, or break.' },
    { id: 'eagle', emoji: '🦅', name: 'Eagle', description: 'See 1 mile clearly; dim light doesn\'t impose disadvantage on Perception.' },
    { id: 'wolf',  emoji: '🐺', name: 'Wolf',  description: 'Track at fast pace; move stealthily at normal pace.' },
    ...(hasScagTotems ? [
      { id: 'elk',   emoji: '🦌', name: 'Elk',   description: 'Travel pace doubles for you and up to 10 companions within 60 ft.' },
      { id: 'tiger', emoji: '🐯', name: 'Tiger', description: 'Gain proficiency in 2 skills: Athletics, Acrobatics, Stealth, or Survival.' },
    ] : []),
  ];
  const TOTEMIC_ATTUNEMENT_OPTIONS: TotemAnimal[] = [
    { id: 'bear',  emoji: '🐻', name: 'Bear',  description: 'While raging, hostile creatures within 5 ft. have disadvantage on attacks against targets other than you.' },
    { id: 'eagle', emoji: '🦅', name: 'Eagle', description: 'While raging, flying speed equals your walking speed (short bursts; fall if you end turn in the air).' },
    { id: 'wolf',  emoji: '🐺', name: 'Wolf',  description: 'While raging, bonus action to knock Large or smaller creature prone when you hit it with a melee attack.' },
    ...(hasScagTotems ? [
      { id: 'elk',   emoji: '🦌', name: 'Elk',   description: 'While raging, bonus action to charge through a creature\'s space (Str save or prone + 1d12+Str damage).' },
      { id: 'tiger', emoji: '🐯', name: 'Tiger', description: 'While raging, move 20+ ft. toward target before attacking for bonus additional melee attack.' },
    ] : []),
  ];

  // ── Expertise ────────────────────────────────────────────────────────────
  // Bard expertise: 2 skills at class level 3, 2 more at class level 10
  // Rogue expertise: 2 skills at class level 1 (multiclass dip only), 2 more at class level 6
  const expertiseCount =
    (classId === 'bard' && (newLevel === 3 || newLevel === 10)) ? 2 :
    (classId === 'rogue' && (newLevel === 1 || newLevel === 6)) ? 2 : 0;
  const allProfSkills = React.useMemo(() => {
    const bgDef = getBackground(character.backgroundId);
    return new Set<string>([
      ...character.selectedSkillProficiencies,
      ...(bgDef?.skillProficiencies ?? []),
    ]);
  }, [character.backgroundId, character.selectedSkillProficiencies]);
  const existingExpertise = new Set<string>(character.expertiseSkills ?? []);
  const expertiseEligible = Array.from(allProfSkills).filter(s => !existingExpertise.has(s) && !pendingExpertise.includes(s));

  const canConfirm =
    (method === 'average' || rollResult != null) &&
    (!needsSubclass || pendingSubclass != null) &&
    (!needsPactBoon || pendingPactBoon != null) &&
    (!needsTotemSpirit || pendingTotemSpirit != null) &&
    (!needsAspectTotem || pendingAspectTotem != null) &&
    (!needsTotemicAttunement || pendingTotemicAttunement != null) &&
    asiChoiceValid &&
    pendingExpertise.length >= Math.min(expertiseCount, pendingExpertise.length + expertiseEligible.length);

  const pactBoonsAvail = needsPactBoon
    ? ALL_PACT_BOONS.filter(p => bookEnabled(p, enabledBooks))
    : [];

  // totalNew* measures what the level-up TABLE grants (newLevel count minus prevLevel count),
  // NOT the difference against what's stored. Using stored length was wrong: if options were
  // set during the wizard they'd be counted as "already leveled-up", showing 0 new picks at
  // levels that do grant new ones.
  const totalNewInvocations = isWarlock ? Math.max(0, warlockInvocationCount(newLevel) - warlockInvocationCount(currentLevel)) : 0;
  const invocationsRemaining = Math.max(0, totalNewInvocations - pendingInvocations.length);
  const allPickedInvocations = [...classOpts.invocations, ...pendingInvocations];

  const isSorcerer = classId === 'sorcerer';
  const totalNewMetamagic = isSorcerer ? Math.max(0, sorcererMetamagicCount(newLevel) - sorcererMetamagicCount(currentLevel)) : 0;
  const metamagicRemaining = Math.max(0, totalNewMetamagic - pendingMetamagic.length);
  const allPickedMetamagic = [...classOpts.metamagic, ...pendingMetamagic];

  const isBattleMaster = classId === 'fighter' && (primary?.subclassId === 'battle-master' || pendingSubclass === 'battle-master');
  const totalNewManeuvers = isBattleMaster ? Math.max(0, battleMasterManeuverCount(newLevel) - battleMasterManeuverCount(currentLevel)) : 0;
  const maneuversRemaining = Math.max(0, totalNewManeuvers - pendingManeuvers.length);
  const allPickedManeuvers = [...classOpts.maneuvers, ...pendingManeuvers];

  const isArtificer = classId === 'artificer';
  const totalNewInfusions = isArtificer ? Math.max(0, artificerInfusionCount(newLevel) - artificerInfusionCount(currentLevel)) : 0;
  const infusionsRemaining = Math.max(0, totalNewInfusions - pendingInfusions.length);
  const allPickedInfusions = [...classOpts.infusions, ...pendingInfusions];

  const invocationsAvail = ALL_INVOCATIONS
    .filter(i => bookEnabled(i, enabledBooks))
    .filter(i => i.minLevel <= newLevel)
    .filter(i => !i.prerequisitePact || i.prerequisitePact === (classOpts.pactBoon?.replace('pact-of-the-', '') as any))
    .filter(i => !allPickedInvocations.includes(i.id));

  const metamagicAvail = ALL_METAMAGIC
    .filter(m => bookEnabled(m, enabledBooks))
    .filter(m => !allPickedMetamagic.includes(m.id));

  const maneuversAvail = ALL_MANEUVERS
    .filter(m => bookEnabled(m, enabledBooks))
    .filter(m => !allPickedManeuvers.includes(m.id));

  const infusionsAvail = ALL_INFUSIONS
    .filter(i => bookEnabled(i, enabledBooks))
    .filter(i => i.minLevel <= newLevel)
    .filter(i => !allPickedInfusions.includes(i.id));

  const existingOptionalFeatures = classOpts.optionalFeatures ?? [];
  const optionalFeaturesNewAtLevel = ALL_OPTIONAL_CLASS_FEATURES
    .filter(f => bookEnabled(f, enabledBooks))
    .filter(f => f.classId === classId)
    .filter(f => f.minLevel === newLevel);

  return (
    <Dialog open={open} onClose={onClose} title={currentLevel === 0 && character.classes.length > 1 ? `New Class: ${classDef.name}` : `Level Up: ${classDef.name} ${currentLevel} → ${newLevel}`} wide>
      <div className="space-y-5">
        {/* Multiclass proficiency gains — only shown when taking first level in a new class */}
        {currentLevel === 0 && character.classes.length > 1 && (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
              Multiclass Proficiency Gains
            </h3>
            <div className="bg-slate-900 rounded-lg p-3">
              <p className="text-xs text-slate-500 mb-2">
                Your first level in {classDef.name} grants these additional proficiencies (plus all level 1 class features below):
              </p>
              {classDef.multiclassGains && classDef.multiclassGains.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {classDef.multiclassGains.map((gain, i) => (
                    <Badge key={i} color="blue">{gain}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic">No additional proficiencies — only the level 1 class features below.</p>
              )}
            </div>
          </section>
        )}

        {/* Class selector — only shown for multiclass characters */}
        {character.classes.length > 1 && (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Level Up Which Class?</h3>
            <div className="flex flex-wrap gap-2">
              {character.classes.map((cl, idx) => {
                const def = getClass(cl.classId);
                return (
                  <button
                    key={cl.classId}
                    onClick={() => setSelectedClassIdx(idx)}
                    className={cn(
                      'px-3 py-2 rounded-lg border-2 text-sm font-medium transition-all',
                      selectedClassIdx === idx
                        ? 'border-red-500 bg-red-950/30 text-white'
                        : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-500 hover:text-white',
                    )}
                  >
                    {def?.name ?? cl.classId} <span className="text-slate-500 font-normal">Lv{cl.level}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* HP gain */}
        <section>
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
            Hit Points Gained
          </h3>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              onClick={() => setMethod('average')}
              className={cn(
                'p-3 rounded-lg border-2 text-left transition-all',
                method === 'average' ? 'border-red-500 bg-red-950/30' : 'border-slate-700 bg-slate-800 hover:border-slate-500'
              )}
            >
              <p className="text-sm font-bold text-white">Take Average</p>
              <p className="text-xs text-slate-400">
                +{averagePerLevel} HP <span className="text-slate-500">({Math.floor(hitDie / 2) + 1}{conMod !== 0 ? ` ${conMod >= 0 ? '+' : ''}${conMod} Con` : ''}{subHPBonusPerLevel > 0 ? ` +${subHPBonusPerLevel} subclass` : ''})</span>
              </p>
            </button>
            <button
              onClick={() => setMethod('roll')}
              className={cn(
                'p-3 rounded-lg border-2 text-left transition-all',
                method === 'roll' ? 'border-red-500 bg-red-950/30' : 'border-slate-700 bg-slate-800 hover:border-slate-500'
              )}
            >
              <p className="text-sm font-bold text-white">Roll d{hitDie}</p>
              <p className="text-xs text-slate-400">
                {rollResult != null
                  ? <>+{Math.max(1, rollResult + conMod) + subHPBonusPerLevel} HP <span className="text-slate-500">({rollResult}{conMod !== 0 ? ` ${conMod >= 0 ? '+' : ''}${conMod}` : ''}{subHPBonusPerLevel > 0 ? ` +${subHPBonusPerLevel} subclass` : ''})</span></>
                  : 'Click Roll to roll your hit die'}
              </p>
            </button>
          </div>
          {method === 'roll' && (
            <Button size="sm" variant="outline" onClick={rollHitDie} className="w-full">
              {rollResult == null ? `Roll d${hitDie}` : 'Reroll'}
            </Button>
          )}
          <p className="text-xs text-slate-500 mt-2">
            Per RAW, each level's HP gain is at least 1 even with negative Constitution.
            Current Max HP: {character.maxHP} → <span className="text-white font-bold">{character.maxHP + hpGained}</span>
          </p>
        </section>

        {/* Subclass pick if needed */}
        {needsSubclass && (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
              Choose Your {classDef.subclassLabel}
            </h3>
            <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
              {availableSubclasses.map(s => (
                <HoverCard
                  key={s.id}
                  content={
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-bold text-white text-sm">{s.name}</span>
                        <Badge color="slate">{s.sourceBook}</Badge>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed mb-3">{s.description}</p>
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Features</p>
                      <div className="space-y-2">
                        {s.features.map((f, i) => (
                          <div key={i}>
                            <div className="flex items-center gap-1 mb-0.5">
                              <span className="text-xs bg-slate-700 text-slate-300 px-1 py-0.5 rounded">Lv.{f.level}</span>
                              <span className="text-xs font-bold text-white">{f.name}</span>
                            </div>
                            <p className="text-xs text-slate-400 leading-relaxed">{f.description}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  }
                >
                <button
                  onClick={() => setPendingSubclass(s.id === pendingSubclass ? undefined : s.id)}
                  className={cn(
                    'w-full p-3 rounded-lg border-2 text-left transition-all',
                    pendingSubclass === s.id ? 'border-red-500 bg-red-950/30' : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-bold text-white">{s.name}</p>
                    <Badge color="slate">{s.sourceBook}</Badge>
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-2">{s.description}</p>
                </button>
                </HoverCard>
              ))}
            </div>
          </section>
        )}

        {/* New features */}
        <section>
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
            Features Gained at Level {newLevel}
          </h3>
          {newFeatures.length === 0 ? (
            <p className="text-sm text-slate-500 italic">
              No new named features at this level — but your class table may grant new spell slots, more class-resource uses, or higher cantrip damage.
            </p>
          ) : (
            <div className="space-y-2">
              {newFeatures.map((f, i) => (
                <div key={i} className="bg-slate-900 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge color="slate">{(f as any).source}</Badge>
                    <p className="text-sm font-bold text-white">{f.name}</p>
                    {(f as any).isASI && <Badge color="amber">ASI / Feat</Badge>}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{f.description}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ASI / Feat picker */}
        {isASI && (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
              Ability Score Improvement or Feat
            </h3>

            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                onClick={() => setASIMode('asi')}
                className={cn(
                  'p-3 rounded-lg border-2 text-left transition-all',
                  asiMode === 'asi' ? 'border-amber-500 bg-amber-950/20' : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                )}
              >
                <p className="text-sm font-bold text-white">Ability Score Improvement</p>
                <p className="text-xs text-slate-400">+2 to one score, or +1 to two scores</p>
              </button>
              <button
                onClick={() => setASIMode('feat')}
                className={cn(
                  'p-3 rounded-lg border-2 text-left transition-all',
                  asiMode === 'feat' ? 'border-amber-500 bg-amber-950/20' : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                )}
              >
                <p className="text-sm font-bold text-white">Take a Feat</p>
                <p className="text-xs text-slate-400">
                  {eligibleFeats.length} feat{eligibleFeats.length !== 1 ? 's' : ''} available
                </p>
              </button>
            </div>

            {asiMode === 'asi' && (
              <div>
                <p className="text-xs text-slate-400 mb-3">
                  Points to spend: <span className={cn('font-bold', pointsSpent === 2 ? 'text-green-400' : 'text-amber-300')}>{pointsSpent}/2</span>
                  <span className="text-slate-500 ml-2">· Scores shown are effective (base + racial)</span>
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {ABILITY_KEYS.map(key => {
                    const increase = asiIncreases[key] ?? 0;
                    const effective = effectiveScore(key);
                    const atCap = effective + increase >= 20;
                    const canAdd = !atCap && pointsSpent < 2;
                    const canSub = increase > 0;
                    return (
                      <div key={key} className={cn(
                        'bg-slate-900 rounded-lg p-2 text-center border',
                        increase > 0 ? 'border-amber-600/60' : 'border-slate-700'
                      )}>
                        <div className="text-xs font-bold text-slate-400 mb-1">{ABILITY_LABELS[key]}</div>
                        <div className="text-xl font-bold text-white leading-none">
                          {effective + increase}
                        </div>
                        {increase > 0 && (
                          <div className="text-xs text-green-400 font-medium">+{increase}</div>
                        )}
                        {atCap && increase === 0 && (
                          <div className="text-xs text-slate-500">max</div>
                        )}
                        <div className="flex items-center justify-center gap-1 mt-2">
                          <button
                            onClick={() => adjustIncrease(key, -1)}
                            disabled={!canSub}
                            className="w-6 h-6 rounded bg-slate-700 text-white text-sm font-bold hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                          >−</button>
                          <button
                            onClick={() => adjustIncrease(key, +1)}
                            disabled={!canAdd}
                            className="w-6 h-6 rounded bg-slate-700 text-white text-sm font-bold hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                          >+</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {pointsSpent === 2 && (
                  <p className="text-xs text-green-400 mt-2">
                    ✓ Ability score increases locked in — confirm to apply.
                  </p>
                )}
              </div>
            )}

            {asiMode === 'feat' && (
              <div>
                {eligibleFeats.length === 0 ? (
                  <p className="text-sm text-slate-500 italic">
                    No feats are available for your character (check enabled books or prerequisites).
                  </p>
                ) : (
                  <>
                    <input
                      type="text"
                      placeholder="Search feats…"
                      value={featSearch}
                      onChange={e => setFeatSearch(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 mb-3 focus:outline-none focus:border-amber-500"
                    />
                    <div className="grid gap-2 sm:grid-cols-2 max-h-64 overflow-y-auto scrollbar-thin pr-1">
                      {filteredFeats.map(feat => {
                        const isSelected = selectedFeat === feat.id;
                        const prereq = feat.prerequisite;
                        return (
                          <HoverCard
                            key={feat.id}
                            content={
                              <div>
                                <p className="font-bold text-white text-sm mb-1">{feat.name}</p>
                                {prereq && (
                                  <p className="text-xs text-yellow-400 mb-2">
                                    Requires: {prereq.other ?? prereq.race ?? (prereq.spellcasting ? 'Spellcasting' : prereq.ability ? Object.entries(prereq.ability).map(([k,v]) => `${k.toUpperCase()} ${v}+`).join(', ') : prereq.proficiency ?? '')}
                                  </p>
                                )}
                                <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{feat.description}</p>
                              </div>
                            }
                          >
                          <button
                            onClick={() => { setSelectedFeat(isSelected ? undefined : feat.id); setFeatASIChoice(undefined); }}
                            className={cn(
                              'p-3 rounded-lg border-2 text-left transition-all w-full',
                              isSelected
                                ? 'border-amber-500 bg-amber-950/20'
                                : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                            )}
                          >
                            <div className="flex items-start justify-between gap-1 mb-1">
                              <span className="text-sm font-bold text-white leading-tight">{feat.name}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                {isSelected && <span className="text-amber-400 text-xs">✓</span>}
                                <Badge color={BOOK_COLOR[feat.sourceBook as BookId] ?? 'slate'}>
                                  {feat.sourceBook}
                                </Badge>
                              </div>
                            </div>
                            {prereq && (prereq.ability || prereq.spellcasting || prereq.proficiency || prereq.race || prereq.other) && (
                              <p className="text-xs text-yellow-400 mb-1">
                                Req: {
                                  prereq.other ? prereq.other :
                                  prereq.race ? `${prereq.race} race` :
                                  prereq.spellcasting ? 'Spellcasting' :
                                  prereq.ability ? Object.entries(prereq.ability).map(([k, v]) => `${k.toUpperCase()} ${v}+`).join(', ') :
                                  prereq.proficiency ?? ''
                                }
                              </p>
                            )}
                            <p className="text-xs text-slate-400 line-clamp-2">{feat.description.split('\n')[0]}</p>
                          </button>
                          </HoverCard>
                        );
                      })}
                      {filteredFeats.length === 0 && (
                        <p className="text-sm text-slate-500 italic col-span-2">No feats match "{featSearch}".</p>
                      )}
                    </div>
                    {selectedFeat && featNeedsASIChoice && (
                      <div className="mt-3 pt-3 border-t border-slate-700">
                        <p className="text-xs text-amber-300 font-semibold mb-2">
                          {selectedFeatDef?.name} — choose +1 ability score:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {selectedFeatDef!.abilityScoreChoice!.map(key => {
                            const score = effectiveScore(key);
                            const atCap = score >= 20;
                            const chosen = featASIChoice === key;
                            return (
                              <button
                                key={key}
                                disabled={atCap}
                                onClick={() => setFeatASIChoice(chosen ? undefined : key)}
                                className={cn(
                                  'px-3 py-1.5 rounded-lg border-2 text-sm font-bold transition-all',
                                  chosen
                                    ? 'border-amber-500 bg-amber-950/40 text-amber-200'
                                    : atCap
                                      ? 'border-slate-700 bg-slate-800 text-slate-600 cursor-not-allowed'
                                      : 'border-slate-600 bg-slate-800 text-white hover:border-amber-500/60',
                                )}
                              >
                                {key.toUpperCase()} ({score}{atCap ? ' — max' : chosen ? ' → ' + (score + 1) : ''})
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {selectedFeat && (!featNeedsASIChoice || featASIChoice) && (
                      <p className="text-xs text-green-400 mt-2">
                        ✓ {eligibleFeats.find(f => f.id === selectedFeat)?.name} selected{featASIChoice ? ` (+1 ${featASIChoice.toUpperCase()})` : ''} — confirm to apply.
                      </p>
                    )}
                    {selectedFeat && featNeedsASIChoice && !featASIChoice && (
                      <p className="text-xs text-amber-400 mt-2">↑ Choose an ability score to continue.</p>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {/* ─── Spell Slots Gained ───────────────────────────────────────────── */}
        {hasSlotChanges && (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
              Spell Slots Gained
            </h3>
            <div className="flex flex-wrap gap-2">
              {slotsGained.map((gain, idx) =>
                gain > 0 ? (
                  <span key={idx} className="text-xs bg-blue-900/40 border border-blue-700 text-blue-200 rounded-lg px-2 py-1 font-medium">
                    +{gain} Level {idx + 1} slot{gain > 1 ? 's' : ''}
                  </span>
                ) : null
              )}
              {pactSlotsGained > 0 && (
                <span className="text-xs bg-purple-900/40 border border-purple-700 text-purple-200 rounded-lg px-2 py-1 font-medium">
                  +{pactSlotsGained} Pact slot{pactSlotsGained > 1 ? 's' : ''}
                </span>
              )}
              {pactLevelGained > 0 && (
                <span className="text-xs bg-purple-900/40 border border-purple-700 text-purple-200 rounded-lg px-2 py-1 font-medium">
                  Pact slots now Level {newPact?.slotLevel}
                </span>
              )}
            </div>
          </section>
        )}

        {/* ─── Cantrip Picker ───────────────────────────────────────────────── */}
        {cantripsGained > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                New Cantrip{cantripsGained > 1 ? 's' : ''}
              </h3>
              <span className={cn('text-xs font-bold', pendingCantrips.length >= cantripsGained ? 'text-green-400' : 'text-amber-300')}>
                {pendingCantrips.length}/{cantripsGained} chosen
              </span>
            </div>
            {pendingCantrips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {pendingCantrips.map(id => {
                  const sp = ALL_SPELLS.find(s => s.id === id);
                  return sp ? (
                    <button
                      key={id}
                      onClick={() => setPendingCantrips(prev => prev.filter(x => x !== id))}
                      className="text-xs bg-red-900/40 border border-red-700 text-red-200 rounded-lg px-2 py-0.5 hover:bg-red-800/50 transition-colors"
                    >
                      {sp.name} ×
                    </button>
                  ) : null;
                })}
              </div>
            )}
            <div className="grid gap-1.5 sm:grid-cols-2 max-h-44 overflow-y-auto scrollbar-thin pr-1">
              {availableCantrips.map(sp => {
                const canAdd = pendingCantrips.length < cantripsGained;
                return (
                  <HoverCard key={sp.id} content={
                    <div>
                      <p className="font-bold text-white text-sm mb-1">{sp.name}</p>
                      <p className="text-xs text-slate-400 mb-1">{sp.school} cantrip</p>
                      <p className="text-xs text-slate-300 leading-relaxed">{sp.description}</p>
                    </div>
                  }>
                    <button
                      onClick={() => { if (canAdd) setPendingCantrips(prev => [...prev, sp.id]); }}
                      disabled={!canAdd}
                      className={cn(
                        'w-full p-2 rounded-lg border text-left transition-all',
                        canAdd ? 'border-slate-700 bg-slate-800 hover:border-slate-500 cursor-pointer' : 'border-slate-700 bg-slate-800 opacity-50 cursor-not-allowed',
                      )}
                    >
                      <p className="text-xs font-bold text-white">{sp.name}</p>
                      <p className="text-[10px] text-slate-500">{sp.school}</p>
                    </button>
                  </HoverCard>
                );
              })}
              {availableCantrips.length === 0 && (
                <p className="text-xs text-slate-500 italic col-span-2">No more cantrips available from enabled books.</p>
              )}
            </div>
          </section>
        )}

        {/* ─── Spell Picker ─────────────────────────────────────────────────── */}
        {hasSpellcasting && effectiveMaxSpellLevel > 0 && (isPreparedCaster || spellsKnownGained > 0) && (
          <section>
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Spells</h3>
              <span className="text-xs text-slate-400">
                {isKnownCaster && spellsKnownGained > 0 && (
                  <span className={cn('font-bold', pendingSpells.length >= spellsKnownGained ? 'text-green-400' : 'text-amber-300')}>
                    {pendingSpells.length}/{spellsKnownGained} learned
                  </span>
                )}
                {isPreparedCaster && newMaxPrepared > oldMaxPrepared && (
                  <span className="text-white font-bold">
                    Prepared limit: {oldMaxPrepared} → {newMaxPrepared}
                  </span>
                )}
                {isPreparedCaster && newMaxPrepared === oldMaxPrepared && (
                  <span className="text-slate-500">
                    Prepared limit: {newMaxPrepared}
                  </span>
                )}
              </span>
            </div>
            {isKnownCaster && spellsKnownGained > 0 && (
              <p className="text-xs text-slate-400 mb-2">
                You learn {spellsKnownGained} new spell{spellsKnownGained > 1 ? 's' : ''}. Pick from the list below.
              </p>
            )}
            {isPreparedCaster && (
              <p className="text-xs text-slate-400 mb-2">
                Add spells to your spellbook — you can choose which to prepare each day.
              </p>
            )}
            {schoolRestriction && (
              <p className="text-xs text-yellow-400/90 mb-2">
                School restriction: <span className="font-semibold">{schoolRestriction.join(' or ')}</span> only
                {sub?.freePickLevels?.length ? ` — free pick (any school) at levels ${sub.freePickLevels.join(', ')}` : ''}.
              </p>
            )}
            {isFreePick && (
              <p className="text-xs text-green-400 mb-2">
                ✓ Level {newLevel} free pick — any wizard school allowed.
              </p>
            )}

            {/* Selected spells */}
            {pendingSpells.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {pendingSpells.map(id => {
                  const sp = ALL_SPELLS.find(s => s.id === id);
                  return sp ? (
                    <button
                      key={id}
                      onClick={() => setPendingSpells(prev => prev.filter(x => x !== id))}
                      className="text-xs bg-red-900/40 border border-red-700 text-red-200 rounded-lg px-2 py-0.5 hover:bg-red-800/50 transition-colors"
                    >
                      L{sp.level} {sp.name} ×
                    </button>
                  ) : null;
                })}
              </div>
            )}

            {/* Search + level filter */}
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                placeholder="Search spells…"
                value={spellSearch}
                onChange={e => setSpellSearch(e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500"
              />
              <select
                value={spellLevelFilter}
                onChange={e => setSpellLevelFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-red-500"
              >
                <option value="all">All levels</option>
                {spellLevelOptions.map(lvl => (
                  <option key={lvl} value={lvl}>Level {lvl}</option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5 sm:grid-cols-2 max-h-52 overflow-y-auto scrollbar-thin pr-1">
              {availableSpells.map(sp => {
                const canAdd = isPreparedCaster || (isKnownCaster && pendingSpells.length < spellsKnownGained);
                return (
                  <HoverCard key={sp.id} content={
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-white text-sm">{sp.name}</span>
                        <Badge color="slate">L{sp.level}</Badge>
                      </div>
                      <p className="text-xs text-slate-400 mb-2">{sp.school} · {sp.castingTime} · {sp.range}</p>
                      <p className="text-xs text-slate-300 leading-relaxed">{sp.description}</p>
                    </div>
                  }>
                    <button
                      onClick={() => { if (canAdd) setPendingSpells(prev => [...prev, sp.id]); }}
                      disabled={!canAdd}
                      className={cn(
                        'w-full p-2 rounded-lg border text-left transition-all',
                        canAdd ? 'border-slate-700 bg-slate-800 hover:border-slate-500 cursor-pointer' : 'border-slate-700 bg-slate-800 opacity-50 cursor-not-allowed',
                      )}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-xs font-bold text-white leading-snug">{sp.name}</p>
                        <Badge color="slate" className="shrink-0">L{sp.level}</Badge>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-0.5">{sp.school} · {sp.castingTime}</p>
                    </button>
                  </HoverCard>
                );
              })}
              {availableSpells.length === 0 && (
                <p className="text-xs text-slate-500 italic col-span-2">
                  {spellSearch || spellLevelFilter !== 'all' ? 'No spells match your filter.' : 'No more spells available from enabled books.'}
                </p>
              )}
            </div>
          </section>
        )}

        {/* ─── Pact Boon ───────────────────────────────────────────────────── */}
        {needsPactBoon && (
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Pact Boon</h3>
              {pendingPactBoon
                ? <span className="text-xs font-bold text-green-400">1/1 chosen</span>
                : <span className="text-xs font-bold text-amber-300">0/1 chosen</span>}
            </div>
            <div className="space-y-2">
              {pactBoonsAvail.map(boon => (
                <HoverCard
                  key={boon.id}
                  content={
                    <div>
                      <p className="font-bold text-white text-sm mb-2">{boon.name}</p>
                      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{boon.description}</p>
                    </div>
                  }
                >
                  <button
                    onClick={() => setPendingPactBoon(pendingPactBoon === boon.id ? undefined : boon.id)}
                    className={cn(
                      'w-full p-3 rounded-lg border-2 text-left transition-all',
                      pendingPactBoon === boon.id ? 'border-purple-500 bg-purple-950/30' : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-bold text-white">{boon.name}</p>
                      {pendingPactBoon === boon.id && <span className="text-purple-400 text-xs">✓</span>}
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-2">{boon.description}</p>
                  </button>
                </HoverCard>
              ))}
            </div>
          </section>
        )}

        {/* ─── Totem Spirit (Totem Warrior lv.3+) ──────────────────────────── */}
        {needsTotemSpirit && (
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Totem Spirit</h3>
              {pendingTotemSpirit
                ? <span className="text-xs font-bold text-green-400">1/1 chosen</span>
                : <span className="text-xs font-bold text-amber-300">0/1 chosen — required</span>}
            </div>
            <p className="text-xs text-slate-500 mb-2">Choose a totem animal whose spirit guides your rage.</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {TOTEM_SPIRIT_OPTIONS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setPendingTotemSpirit(pendingTotemSpirit === t.id ? undefined : t.id)}
                  className={cn(
                    'p-3 rounded-lg border-2 text-left transition-all',
                    pendingTotemSpirit === t.id ? 'border-amber-500 bg-amber-950/20' : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-bold text-white">{t.emoji} {t.name}</p>
                    {pendingTotemSpirit === t.id && <span className="text-amber-400 text-xs">✓</span>}
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-3">{t.description}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ─── Aspect of the Beast (Totem Warrior lv.6+) ───────────────────── */}
        {needsAspectTotem && (
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Aspect of the Beast</h3>
              {pendingAspectTotem
                ? <span className="text-xs font-bold text-green-400">1/1 chosen</span>
                : <span className="text-xs font-bold text-amber-300">0/1 chosen — required</span>}
            </div>
            <p className="text-xs text-slate-500 mb-2">Choose a totem animal for your beast aspect. Can differ from your Totem Spirit.</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {ASPECT_TOTEM_OPTIONS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setPendingAspectTotem(pendingAspectTotem === t.id ? undefined : t.id)}
                  className={cn(
                    'p-3 rounded-lg border-2 text-left transition-all',
                    pendingAspectTotem === t.id ? 'border-amber-500 bg-amber-950/20' : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-bold text-white">{t.emoji} {t.name}</p>
                    {pendingAspectTotem === t.id && <span className="text-amber-400 text-xs">✓</span>}
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-3">{t.description}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ─── Totemic Attunement (Totem Warrior lv.14+) ───────────────────── */}
        {needsTotemicAttunement && (
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Totemic Attunement</h3>
              {pendingTotemicAttunement
                ? <span className="text-xs font-bold text-green-400">1/1 chosen</span>
                : <span className="text-xs font-bold text-amber-300">0/1 chosen — required</span>}
            </div>
            <p className="text-xs text-slate-500 mb-2">Choose a totem animal for your ultimate attunement. Can differ from your earlier choices.</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {TOTEMIC_ATTUNEMENT_OPTIONS.map(t => (
                <button
                  key={t.id}
                  onClick={() => setPendingTotemicAttunement(pendingTotemicAttunement === t.id ? undefined : t.id)}
                  className={cn(
                    'p-3 rounded-lg border-2 text-left transition-all',
                    pendingTotemicAttunement === t.id ? 'border-amber-500 bg-amber-950/20' : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-bold text-white">{t.emoji} {t.name}</p>
                    {pendingTotemicAttunement === t.id && <span className="text-amber-400 text-xs">✓</span>}
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-3">{t.description}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ─── Eldritch Invocations ─────────────────────────────────────────── */}
        {isWarlock && totalNewInvocations > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Eldritch Invocations</h3>
              <span className={cn('text-xs font-bold', pendingInvocations.length >= totalNewInvocations ? 'text-green-400' : 'text-amber-300')}>
                {pendingInvocations.length}/{totalNewInvocations} chosen
              </span>
            </div>
            {pendingInvocations.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {pendingInvocations.map(id => {
                  const inv = ALL_INVOCATIONS.find(i => i.id === id);
                  return inv ? (
                    <button key={id} onClick={() => setPendingInvocations(prev => prev.filter(x => x !== id))}
                      className="text-xs bg-purple-900/40 border border-purple-700 text-purple-200 rounded-lg px-2 py-0.5 hover:bg-purple-800/50 transition-colors">
                      {inv.name} ×
                    </button>
                  ) : null;
                })}
              </div>
            )}
            <CompactOptionPicker
              items={invocationsAvail.map(i => ({
                id: i.id, name: i.name, description: i.description,
                meta: [
                  i.minLevel > 1 ? `Lvl ${i.minLevel}` : null,
                  i.prerequisitePact ? `Pact of the ${i.prerequisitePact[0].toUpperCase() + i.prerequisitePact.slice(1)}` : null,
                  i.prerequisiteSpell ? `Req: ${i.prerequisiteSpell.replace(/-/g, ' ')}` : null,
                ].filter(Boolean).join(' · ') || undefined,
              }))}
              selected={[]}
              max={invocationsRemaining}
              onToggle={id => {
                if (pendingInvocations.includes(id)) {
                  setPendingInvocations(prev => prev.filter(x => x !== id));
                } else if (pendingInvocations.length < totalNewInvocations) {
                  setPendingInvocations(prev => [...prev, id]);
                }
              }}
            />
          </section>
        )}

        {/* ─── Metamagic ────────────────────────────────────────────────────── */}
        {isSorcerer && totalNewMetamagic > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Metamagic</h3>
              <span className={cn('text-xs font-bold', pendingMetamagic.length >= totalNewMetamagic ? 'text-green-400' : 'text-amber-300')}>
                {pendingMetamagic.length}/{totalNewMetamagic} chosen
              </span>
            </div>
            {pendingMetamagic.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {pendingMetamagic.map(id => {
                  const mm = ALL_METAMAGIC.find(m => m.id === id);
                  return mm ? (
                    <button key={id} onClick={() => setPendingMetamagic(prev => prev.filter(x => x !== id))}
                      className="text-xs bg-orange-900/40 border border-orange-700 text-orange-200 rounded-lg px-2 py-0.5 hover:bg-orange-800/50 transition-colors">
                      {mm.name} ×
                    </button>
                  ) : null;
                })}
              </div>
            )}
            <CompactOptionPicker
              items={metamagicAvail.map(m => ({ id: m.id, name: m.name, description: m.description, meta: m.cost }))}
              selected={[]}
              max={metamagicRemaining}
              onToggle={id => {
                if (pendingMetamagic.includes(id)) {
                  setPendingMetamagic(prev => prev.filter(x => x !== id));
                } else if (pendingMetamagic.length < totalNewMetamagic) {
                  setPendingMetamagic(prev => [...prev, id]);
                }
              }}
            />
          </section>
        )}

        {/* ─── Battle Master Maneuvers ──────────────────────────────────────── */}
        {isBattleMaster && totalNewManeuvers > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Battle Master Maneuvers</h3>
              <span className={cn('text-xs font-bold', pendingManeuvers.length >= totalNewManeuvers ? 'text-green-400' : 'text-amber-300')}>
                {pendingManeuvers.length}/{totalNewManeuvers} chosen
              </span>
            </div>
            {pendingManeuvers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {pendingManeuvers.map(id => {
                  const man = ALL_MANEUVERS.find(m => m.id === id);
                  return man ? (
                    <button key={id} onClick={() => setPendingManeuvers(prev => prev.filter(x => x !== id))}
                      className="text-xs bg-green-900/40 border border-green-700 text-green-200 rounded-lg px-2 py-0.5 hover:bg-green-800/50 transition-colors">
                      {man.name} ×
                    </button>
                  ) : null;
                })}
              </div>
            )}
            <CompactOptionPicker
              items={maneuversAvail.map(m => ({ id: m.id, name: m.name, description: m.description }))}
              selected={[]}
              max={maneuversRemaining}
              onToggle={id => {
                if (pendingManeuvers.includes(id)) {
                  setPendingManeuvers(prev => prev.filter(x => x !== id));
                } else if (pendingManeuvers.length < totalNewManeuvers) {
                  setPendingManeuvers(prev => [...prev, id]);
                }
              }}
            />
          </section>
        )}

        {/* ─── Artificer Infusions ──────────────────────────────────────────── */}
        {isArtificer && totalNewInfusions > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Artificer Infusions</h3>
              <span className={cn('text-xs font-bold', pendingInfusions.length >= totalNewInfusions ? 'text-green-400' : 'text-amber-300')}>
                {pendingInfusions.length}/{totalNewInfusions} chosen
              </span>
            </div>
            {pendingInfusions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {pendingInfusions.map(id => {
                  const inf = ALL_INFUSIONS.find(i => i.id === id);
                  return inf ? (
                    <button key={id} onClick={() => setPendingInfusions(prev => prev.filter(x => x !== id))}
                      className="text-xs bg-teal-900/40 border border-teal-700 text-teal-200 rounded-lg px-2 py-0.5 hover:bg-teal-800/50 transition-colors">
                      {inf.name} ×
                    </button>
                  ) : null;
                })}
              </div>
            )}
            <CompactOptionPicker
              items={infusionsAvail.map(i => ({
                id: i.id, name: i.name, description: i.description,
                meta: i.minLevel > 2 ? `Lvl ${i.minLevel}` : (i.prerequisite ?? undefined),
              }))}
              selected={[]}
              max={infusionsRemaining}
              onToggle={id => {
                if (pendingInfusions.includes(id)) {
                  setPendingInfusions(prev => prev.filter(x => x !== id));
                } else if (pendingInfusions.length < totalNewInfusions) {
                  setPendingInfusions(prev => [...prev, id]);
                }
              }}
            />
          </section>
        )}

        {/* ─── Optional Class Features (TCE) ───────────────────────────────── */}
        {optionalFeaturesNewAtLevel.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Optional Class Features</h3>
              <span className="text-xs text-slate-500">TCE · toggle to enable</span>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {optionalFeaturesNewAtLevel.map(f => {
                const alreadyEnabled = existingOptionalFeatures.includes(f.id);
                const isPending = pendingOptionalFeatures.includes(f.id);
                const isOn = alreadyEnabled || isPending;
                return (
                  <HoverCard key={f.id} content={
                    <div>
                      <p className="font-bold text-white text-sm mb-1">{f.name}</p>
                      <p className="text-xs text-purple-300 mb-1">Optional Feature · Lvl {f.minLevel}</p>
                      <p className="text-xs text-slate-300 leading-relaxed">{f.description}</p>
                    </div>
                  }>
                    <button
                      onClick={() => {
                        if (alreadyEnabled) return;
                        setPendingOptionalFeatures(prev =>
                          prev.includes(f.id) ? prev.filter(x => x !== f.id) : [...prev, f.id]
                        );
                      }}
                      disabled={alreadyEnabled}
                      className={cn(
                        'w-full p-2.5 rounded-lg border-2 text-left transition-all',
                        isOn
                          ? 'border-purple-500 bg-purple-950/30'
                          : 'border-slate-700 bg-slate-800 hover:border-slate-500',
                        alreadyEnabled && 'opacity-60 cursor-default',
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-white">{f.name}</p>
                        {isOn && <span className="text-purple-400 text-xs">✓</span>}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">{f.description}</p>
                    </button>
                  </HoverCard>
                );
              })}
            </div>
          </section>
        )}

        {/* ─── Expertise ───────────────────────────────────────────────────── */}
        {expertiseCount > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Expertise</h3>
              <span className={cn('text-xs font-bold', pendingExpertise.length >= expertiseCount ? 'text-green-400' : 'text-amber-300')}>
                {pendingExpertise.length}/{expertiseCount} chosen
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-2">
              Choose {expertiseCount} skills to gain Expertise in — your proficiency bonus is doubled for those skills.
            </p>
            {pendingExpertise.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {pendingExpertise.map(s => (
                  <button
                    key={s}
                    onClick={() => setPendingExpertise(prev => prev.filter(x => x !== s))}
                    className="text-xs bg-emerald-900/40 border border-emerald-700 text-emerald-200 rounded-lg px-2 py-0.5 hover:bg-emerald-800/50 transition-colors"
                  >
                    {s} ×
                  </button>
                ))}
              </div>
            )}
            <div className="grid gap-1.5 sm:grid-cols-2 max-h-44 overflow-y-auto scrollbar-thin pr-1">
              {expertiseEligible.sort().map(skill => {
                const canAdd = pendingExpertise.length < expertiseCount;
                return (
                  <button
                    key={skill}
                    onClick={() => { if (canAdd) setPendingExpertise(prev => [...prev, skill]); }}
                    disabled={!canAdd}
                    className={cn(
                      'w-full p-2 rounded-lg border text-left transition-all',
                      canAdd ? 'border-slate-700 bg-slate-800 hover:border-emerald-500/60 cursor-pointer' : 'border-slate-700 bg-slate-800 opacity-50 cursor-not-allowed',
                    )}
                  >
                    <p className="text-xs font-bold text-white">{skill}</p>
                    <p className="text-[10px] text-emerald-400 mt-0.5">Expertise</p>
                  </button>
                );
              })}
              {expertiseEligible.length === 0 && (
                <p className="text-xs text-slate-500 italic col-span-2">No eligible skills available.</p>
              )}
            </div>
          </section>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm} disabled={!canConfirm}>
            Confirm Level {newLevel}
          </Button>
        </div>
      </div>

    </Dialog>
  );
}
