import React from 'react';
import { Plus, Sparkles, X, Zap } from 'lucide-react';
import { ALL_SPELLS, getSpell } from '../../data/spells';
import { summonSpecFor } from '../../data/summonOptions';
import { SummonPicker } from '../../components/SummonPicker';
import { featGrantedSpells, featSpellChoices, spellPickOptions } from '../../data/feats';
import { ProficiencyPicker } from '../../components/ProficiencyPicker';
import { Dialog, Badge, Button } from '../../components/ui';
import { cn } from '../../utils/cn';
import { bookEnabled } from '../../utils/bookEnabled';
import { SpellDetail } from '../creator/steps/StepSpells';
import type { AbilityKey, Character, Spell, SpellLevel, SlotLevel } from '../../types';
import { getClass } from '../../data/classes';
import { getSubclass } from '../../data/subclasses';
import { getRace } from '../../data/races';
import { isPreparedCaster as isPreparedCasterId } from '../../data/mechanics';
import { casterClassOf } from '../../hooks/useCharacterDerived';
import { castingForSpell } from '../../utils/perSpellCasting';
import { canRitualCast } from '../../utils/ritualCasting';
import { useCharacterStore } from '../../store/useCharacterStore';
import { useDiceStore } from '../../store/useDiceStore';
import { spellAttackKind, spellRoll, formatSpellRoll } from '../../utils/spellRoll';
import { rollMode } from '../../utils/rollMode';

const SCHOOL_COLORS: Record<string, string> = {
  Abjuration: 'blue', Conjuration: 'purple', Divination: 'indigo',
  Enchantment: 'pink', Evocation: 'red', Illusion: 'violet',
  Necromancy: 'slate', Transmutation: 'green',
};

interface SpellPanelProps {
  character: Character;
  derived: any;
  toggleSpellPrepared: (id: string, maxPrepared?: number | null) => void;
  startConcentration: (id: string) => void;
  endConcentration: () => void;
  addSpellToBook: (id: string, limits?: { known?: number | null; cantrips?: number | null; spellbook?: number | null }) => void;
  removeSpellFromBook: (id: string) => void;
  useSpellSlot: (level: SlotLevel) => void;
  usePactSlot: () => void;
  useInnateSpell: (spellId: string) => void;
  useFeatSpell: (featId: string, spellId: string) => void;
  setInnateSpellAbility: (ability: AbilityKey) => void;
}

// The prepared-caster identity is derived from mechanics.ts, not restated here — the hardcoded
// list this replaced omitted every 2024 class, so a 2024 cleric/druid/wizard/bard/paladin/ranger
// was rendered as a known caster with no prepared-spell UI at all.

/**
 * Attack and damage/healing dice for one spell. Weapons have had roll buttons since the
 * beginning while 547 spells had none, so a wizard rolled Fireball's 8d6 by hand next to a
 * fighter clicking a button.
 *
 * Takes the bonus and modifier as props rather than reading `derived`, because the three lists
 * that use it cast from three different abilities: the spellbook uses the casting class's, while
 * a racial or feat-granted spell uses whichever ability that grant names.
 */
function SpellRollButtons({ spell, charLevel, attackBonus, spellMod, slotLevel, advAttacks, disadvAttacks }: {
  spell: Spell;
  charLevel: number;
  attackBonus: number;
  spellMod: number;
  /** The slot last spent on this spell, so an upcast Fireball rolls what it dealt. */
  slotLevel?: number;
  advAttacks: string[];
  disadvAttacks: string[];
}) {
  const triggerRoll = useDiceStore(s => s.triggerRoll);
  const attack = spellAttackKind(spell);
  const roll = spellRoll(spell, { charLevel, slotLevel, spellMod });
  if (!attack && !roll) return null;

  const sign = attackBonus >= 0 ? '+' : '';
  const kindLabel = roll?.kind === 'healing' ? 'Healing' : 'Damage';
  return (
    <>
      {attack && (
        <button
          // A spell attack IS an attack roll, so Poisoned, Prone and exhaustion 3+ reach it
          // exactly as they reach a greatsword. Armour penalties deliberately don't: those
          // apply to Strength and Dexterity attack rolls, and this one uses the casting ability.
          onClick={() => triggerRoll(20, attackBonus, `${spell.name} Attack`, rollMode(advAttacks.length > 0, disadvAttacks.length > 0))}
          className="shrink-0 text-xs px-2 py-1 rounded border border-red-700/60 bg-red-950/40 text-red-200 hover:bg-red-800/50 transition-all font-medium"
          title={`Roll ${attack} spell attack: d20 ${sign}${attackBonus}`
            + (disadvAttacks.length ? ` — disadvantage (${disadvAttacks.join(', ')})` : '')
            + (advAttacks.length ? ` — advantage (${advAttacks.join(', ')})` : '')}
        >
          {sign}{attackBonus} 🎲
        </button>
      )}
      {roll && (
        <button
          onClick={() => triggerRoll(roll.dice.sides, roll.modifier, `${spell.name} ${kindLabel}`, undefined, roll.dice.count)}
          className={cn(
            'shrink-0 text-xs px-2 py-1 rounded border transition-all font-medium',
            roll.kind === 'healing'
              ? 'border-green-700/60 bg-green-950/40 text-green-200 hover:bg-green-800/50'
              : 'border-orange-700/60 bg-orange-950/40 text-orange-200 hover:bg-orange-800/50',
          )}
          title={`Roll ${kindLabel.toLowerCase()}: ${formatSpellRoll(roll)}`
            + (slotLevel && slotLevel > spell.level ? ` (cast at level ${slotLevel})` : '')
            // Never let an under-scaled upcast pass as final — see SpellRoll.unscaled.
            + (roll.unscaled ? `\n\n⚠ This spell's "At Higher Levels" text couldn't be read automatically, so these dice are its base amount. Check the spell description.` : '')}
        >
          {formatSpellRoll(roll)}{roll.unscaled ? '?' : ''} 🎲
        </button>
      )}
    </>
  );
}

export function SpellPanel({ character, derived, toggleSpellPrepared, startConcentration, endConcentration, addSpellToBook, removeSpellFromBook, useSpellSlot, usePactSlot, useInnateSpell, useFeatSpell, setInnateSpellAbility }: SpellPanelProps) {
  const [detailSpell, setDetailSpell] = React.useState<Spell | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [filterLevel, setFilterLevel] = React.useState<number | 'all'>('all');

  const [castSpell, setCastSpell] = React.useState<Spell | null>(null);
  const [summonSpell, setSummonSpell] = React.useState<Spell | null>(null);
  // The slot each spell was last cast with. Deliberately not persisted: it exists so the damage
  // button follows the slot you just spent (a 5th-level Fireball reads 10d6, not 8d6), and a
  // stale choice surviving a reload would be worse than starting over at the spell's own level.
  const [castAtLevel, setCastAtLevel] = React.useState<Record<string, number>>({});

  // Everything below reads the CASTING class, not classes[0]. On a fighter/wizard the latter meant
  // the known-caster layout for a prepared caster, and the "Paladins gain spellcasting at level 2"
  // hint never appearing for a fighter/paladin.
  const primaryClass = casterClassOf(character);
  const classDef = primaryClass ? getClass(primaryClass.classId) : null;
  const { maxPreparedSpells, slotTotals, cantripsKnown, maxSpellLevel, spellsKnown, spellbookLimit } = derived;
  const setSelectedFeatSpells = useCharacterStore(st => st.setSelectedFeatSpells);
  // Ritual Caster 2024's list grows with the proficiency bonus; every other grant has a fixed count.
  const profBonus: number = derived?.profBonus ?? 2;
  const slotsUsed = character.spellSlotsUsed;
  const pactMagic = character.pactMagic;

  // Group spellbook by level
  const spellbookMap = new Map(character.spellbook.map(sp => [sp.spellId, sp]));
  const preparedCount = character.spellbook.filter(sp => {
    if (!sp.isPrepared || sp.isAlwaysPrepared) return false;
    const spell = getSpell(sp.spellId);
    return spell && spell.level > 0;
  }).length;

  const byLevel: Record<number, { spell: Spell; prepared: boolean; alwaysPrepared: boolean }[]> = {};
  for (const sp of character.spellbook) {
    const spell = getSpell(sp.spellId);
    if (!spell) continue;
    if (!byLevel[spell.level]) byLevel[spell.level] = [];
    byLevel[spell.level].push({ spell, prepared: sp.isPrepared, alwaysPrepared: sp.isAlwaysPrepared });
  }

  // Spells for add browser — include spells for ALL character classes so
  // multiclass casters (e.g. Fighter/Wizard, Paladin/Sorcerer) can add
  // spells from their secondary casting class.
  // Resolve each class to the id spell ENTRIES actually use, not the id the class carries.
  //
  // A 2024 druid's classId is 'druid-2024' while every druid spell lists 'druid', so matching on
  // the raw id found nothing and the Add Spell dialog came up EMPTY for every 2024 caster. The
  // creator has always resolved this through spellListClassId; the sheet never did.
  //
  // Eldritch Knight and Arcane Trickster are the same shape from the other direction: the SUBCLASS
  // carries the list (both point at 'wizard'), so a fighter's own id would offer nothing at all.
  const allClassIds = character.classes.map((cl) => {
    const sub = cl.subclassId ? getSubclass(cl.subclassId) : undefined;
    if (sub?.spellListClassId) return sub.spellListClassId;
    return getClass(cl.classId)?.spellListClassId ?? cl.classId;
  });
  const availableToAdd = ALL_SPELLS.filter(s =>
    // bookEnabled, NOT a raw includes. The raw check was wrong in three ways at once: it ignored
    // `alsoIn` (a spell reprinted into an enabled book stayed hidden), it ignored `hidden`, and —
    // the one that actually bit — it missed the 2024 widening, so a PHB2024 character was offered
    // 107 spells instead of 468. All 361 PHB spells simply vanished from Add Spell for them,
    // because selecting the 2024 edition REPLACES 'PHB' in enabledBooks.
    bookEnabled(s, character.enabledBooks) &&
    (classDef ? allClassIds.some(id => s.classes.includes(id)) : true) &&
    !spellbookMap.has(s.id) &&
    (filterLevel === 'all' || s.level === filterLevel) &&
    (search === '' || s.name.toLowerCase().includes(search.toLowerCase()))
  );

  const isPreparedCaster = !!classDef && isPreparedCasterId(classDef.id);
  const levels = [0,1,2,3,4,5,6,7,8,9] as SpellLevel[];

  // Shared by every roll button below. `mods` and the condition arrays come straight from the
  // derive so a Poisoned wizard's Fire Bolt is disadvantaged for the same reason their dagger is.
  const mods = derived?.mods ?? {};
  const spellMod: number = derived?.spellcastingAbility ? (mods[derived.spellcastingAbility] ?? 0) : 0;
  const rollCtx = {
    charLevel: derived?.totalLevel ?? 1,
    advAttacks: (derived?.conditionAdvAttacks ?? []) as string[],
    disadvAttacks: [
      ...(derived?.conditionDisadvAttacks ?? []),
      ...(derived?.exhaustionDisadvAttacks ? ['exhaustion'] : []),
    ] as string[],
  };

  // Total slots available across all levels (excluding pact magic).
  const totalSlots = Object.values(slotTotals ?? {}).reduce((sum: number, n) => sum + (n as number), 0);
  const hasAnyCastingResource = totalSlots > 0 || (pactMagic && pactMagic.slotsTotal > 0);

  function canCast(spell: Spell, prepared: boolean, alwaysPrepared: boolean): boolean {
    if (spell.level === 0) return true; // cantrips always castable
    if (!hasAnyCastingResource) return false; // no spell slots yet (e.g. level-1 paladin/ranger)
    if (!isPreparedCaster) return true; // known casters
    return prepared || alwaysPrepared;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {/* Cantrips */}
          {cantripsKnown > 0 && (() => {
            // Subclass-granted cantrips (Light Domain's Light, Shadow Arts' Minor Illusion, and
            // nine more) arrive flagged alwaysPrepared and are gained IN ADDITION to the cantrips
            // the class knows — so counting them here would eat a chosen cantrip and show the
            // total in red. Slightly generous in one edge case: a player who had already chosen
            // Light and then takes Light Domain gets that pick back, where the book says they
            // simply gain nothing.
            const cantripCount = (byLevel[0] ?? []).filter(e => !e.alwaysPrepared).length;
            const ok = cantripCount <= cantripsKnown;
            return (
              <span className="text-slate-400">
                Cantrips: <span className={cn('font-bold', ok ? 'text-white' : 'text-red-400')}>{cantripCount}/{cantripsKnown}</span>
              </span>
            );
          })()}
          {/* Prepared (prepared casters only) — per-level breakdown */}
          {isPreparedCaster && maxPreparedSpells != null && maxPreparedSpells > 0 && (
            <span className="text-slate-400">
              Prepared <span className={cn('font-bold', preparedCount <= maxPreparedSpells ? 'text-white' : 'text-red-400')}>({preparedCount}/{maxPreparedSpells})</span>:{' '}
              {([1,2,3,4,5,6,7,8,9] as SpellLevel[])
                .filter(lvl => (byLevel[lvl]?.length ?? 0) > 0)
                .map(lvl => {
                  const entries = byLevel[lvl];
                  const prepAtLevel = entries.filter(e => e.prepared || e.alwaysPrepared).length;
                  return (
                    <span key={lvl} className="font-bold text-white mr-1.5">
                      {prepAtLevel}/{entries.length}<span className="font-normal text-slate-500"> L{lvl}</span>
                    </span>
                  );
                })}
            </span>
          )}
          {/* Max spell level */}
          {maxSpellLevel > 0 && (
            <span className="text-slate-400">
              Max level: <span className="font-bold text-white">L{maxSpellLevel}</span>
            </span>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus size={14} /> Add Spell
        </Button>
      </div>

      {/* Half-caster gating hint (paladin/ranger at level 1 have no slots yet). */}
      {/* Note: Artificer gets slots at level 1, so they are excluded from this hint. */}
      {classDef && ['paladin', 'ranger'].includes(classDef.id) && maxSpellLevel === 0 && (
        <div className="text-xs text-amber-300 bg-amber-950/40 border border-amber-700/40 rounded-lg px-3 py-2">
          {classDef.name}s gain spellcasting at level 2. You can still add spells you plan to learn later.
        </div>
      )}

      {character.spellbook.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <BookOpen className="mx-auto mb-3 opacity-30" size={40} />
          <p>No spells in your spellbook yet.</p>
          <p className="text-sm mt-1">Click "Add Spell" to browse available spells.</p>
        </div>
      ) : (
        levels.map(lvl => {
          const entries = byLevel[lvl];
          if (!entries?.length) return null;
          const inLevelPrepared = entries.filter(e => e.prepared || e.alwaysPrepared).length;
          const showPrepBadge = lvl > 0 && isPreparedCaster;
          const overMaxLevel = lvl > maxSpellLevel && lvl > 0;
          return (
            <div key={lvl} className={cn('bg-slate-800 border rounded-xl overflow-hidden', overMaxLevel ? 'border-amber-700/40' : 'border-slate-700')}>
              <div className="px-4 py-2 bg-slate-750 border-b border-slate-700 flex items-center gap-2">
                <h3 className="font-bold text-slate-300 text-sm">
                  {lvl === 0 ? 'Cantrips' : `Level ${lvl} Spells`}
                </h3>
                <span className="text-xs text-slate-500">
                  {showPrepBadge
                    ? <>{inLevelPrepared}/{entries.length} prepared</>
                    : <>({entries.length})</>}
                </span>
                {overMaxLevel && (
                  <span className="ml-auto text-[10px] text-amber-400 bg-amber-900/30 px-1.5 py-0.5 rounded">no slots yet</span>
                )}
              </div>
              <div className="divide-y divide-slate-700/50">
                {entries.sort((a,b) => a.spell.name.localeCompare(b.spell.name)).map(({ spell, prepared, alwaysPrepared }) => {
                  // Per spell, not per character: on a cleric/wizard the wizard spells must
                  // roll off Intelligence. Falls back to the character-wide numbers when no
                  // class claims the spell, so single-class sheets are unchanged.
                  const casting = castingForSpell(character, spell, {
                    mods: derived?.mods ?? {},
                    profBonus,
                    fallback: {
                      ability: derived?.spellcastingAbility ?? 'int',
                      saveDC: derived?.spellSaveDC ?? 0,
                      attackBonus: derived?.spellAttackBonus ?? 0,
                    },
                  });
                  return (
                  <div key={spell.id} className="px-4 py-3 flex items-center gap-3 hover:bg-slate-750 group">
                    {/* Prepared toggle — only for prepared casters, not cantrips */}
                    {lvl > 0 && isPreparedCaster && (
                      <button
                        onClick={() => !alwaysPrepared && toggleSpellPrepared(spell.id, maxPreparedSpells)}
                        disabled={alwaysPrepared || (!prepared && maxPreparedSpells != null && maxPreparedSpells > 0 && preparedCount >= maxPreparedSpells)}
                        className={cn(
                          'w-5 h-5 rounded border-2 shrink-0 flex items-center justify-center transition-all',
                          prepared ? 'border-green-500 bg-green-500/20' : 'border-slate-500',
                          alwaysPrepared && 'border-blue-500 bg-blue-500/20 cursor-not-allowed',
                        )}
                        title={alwaysPrepared ? 'Always prepared' : prepared ? 'Unprepare' : 'Prepare'}
                      >
                        {prepared && <div className="w-2 h-2 bg-green-400 rounded-sm" />}
                        {alwaysPrepared && <div className="w-2 h-2 bg-blue-400 rounded-sm" />}
                      </button>
                    )}

                    {/* School color dot */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <button
                          className="font-medium text-white text-sm hover:text-red-300 transition-colors text-left"
                          onClick={() => setDetailSpell(spell)}
                        >
                          {spell.name}
                        </button>
                        {spell.concentration && <span className="text-xs text-amber-400 bg-amber-900/30 px-1 rounded">C</span>}
                        {spell.ritual && <span className="text-xs text-blue-400 bg-blue-900/30 px-1 rounded">R</span>}
                      </div>
                      <p className="text-xs text-slate-500">
                        {spell.castingTime} · {spell.range} · {spell.school}
                        {/* Only worth saying on a multiclass caster, where this spell's DC
                            differs from the one in the header. */}
                        {casting.saveDC !== (derived?.spellSaveDC ?? 0) && (
                          <span className="text-indigo-300/80" title={`Cast as a ${getClass(casting.classId)?.name ?? casting.classId} spell — ${casting.ability.toUpperCase()} based`}>
                            {' · '}DC {casting.saveDC} ({casting.ability.toUpperCase()})
                          </span>
                        )}
                      </p>
                    </div>

                    <SpellRollButtons
                      spell={spell}
                      attackBonus={casting.attackBonus}
                      spellMod={derived?.mods?.[casting.ability] ?? spellMod}
                      slotLevel={castAtLevel[spell.id]}
                      {...rollCtx}
                    />

                    {/* Concentration toggle */}
                    {spell.concentration && canCast(spell, prepared, alwaysPrepared) && (
                      <button
                        onClick={() => {
                          if (character.concentrationSpellId === spell.id) endConcentration();
                          else startConcentration(spell.id);
                        }}
                        className={cn(
                          'shrink-0 text-xs px-2 py-1 rounded border transition-all',
                          character.concentrationSpellId === spell.id
                            ? 'border-amber-500 bg-amber-900/30 text-amber-300'
                            : 'border-slate-600 text-slate-500 hover:border-amber-500 hover:text-amber-300',
                        )}
                        title={character.concentrationSpellId === spell.id ? 'End concentration' : 'Start concentration'}
                      >
                        <Sparkles size={12} />
                      </button>
                    )}

                    {/* Ritual cast — deliberately NOT behind canCast: a ritual expends no spell
                        slot, so having slots doesn't gate it. It IS gated on actually having
                        Ritual Casting (a sorcerer never gets this button) and, for everyone
                        except a wizard reading from their spellbook, on the spell being
                        prepared. Separate button rather than a mode on Cast, because the two
                        consume different things. */}
                    {spell.ritual && spell.level > 0 && canRitualCast(character, prepared || alwaysPrepared) && (
                      <button
                        onClick={() => {
                          if (spell.concentration && character.concentrationSpellId !== spell.id) {
                            startConcentration(spell.id);
                          }
                          // Find Familiar is a ritual far more often than it is slotted, so the
                          // summon picker has to hang off this button too, not just Cast.
                          if (summonSpecFor(spell.id)) setSummonSpell(spell);
                        }}
                        className="shrink-0 text-xs px-2 py-1 rounded border border-blue-700 bg-blue-900/30 text-blue-300 hover:bg-blue-800/50 transition-all flex items-center gap-1"
                        title="Cast as ritual — takes 10 minutes longer and expends no spell slot"
                      >
                        <BookOpen size={12} />
                        <span className="hidden sm:inline">Ritual</span>
                      </button>
                    )}

                    {/* Cast button */}
                    {canCast(spell, prepared, alwaysPrepared) && (
                      <button
                        onClick={() => {
                          if (spell.level === 0) {
                            // Cantrips: nothing to consume, but still trigger concentration if needed
                            if (spell.concentration && character.concentrationSpellId !== spell.id) {
                              startConcentration(spell.id);
                            }
                            return;
                          }
                          setCastSpell(spell);
                        }}
                        className="shrink-0 text-xs px-2 py-1 rounded border border-red-700 bg-red-900/30 text-red-300 hover:bg-red-800/50 transition-all flex items-center gap-1"
                        title="Cast spell"
                      >
                        <Zap size={12} />
                        <span className="hidden sm:inline">Cast</span>
                      </button>
                    )}

                    {/* Remove */}
                    <button
                      onClick={() => removeSpellFromBook(spell.id)}
                      className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all"
                      title="Remove from spellbook"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      {/* Racial Innate Spells */}
      {(() => {
        const race = getRace(character.raceId);
        if (!race?.innateSpells?.length) return null;
        const totalLevel = character.classes.reduce((sum, cl) => sum + cl.level, 0);
        const available = race.innateSpells.filter(s => (s.minCharLevel ?? 1) <= totalLevel);
        if (!available.length) return null;
        // MMoM Duergar / Deep Gnome let the player pick Int, Wis or Cha for these spells.
        // The picker lives here rather than in the creator because the race can't change after
        // creation — so one control on the sheet reaches new and existing characters alike.
        const abilityChoices = race.innateSpellAbilityChoice;
        return (
          <div className="bg-slate-800 border border-indigo-700/50 rounded-xl overflow-hidden">
            <div className="px-4 py-2 bg-slate-750 border-b border-slate-700 flex items-center gap-2">
              <h3 className="font-bold text-indigo-300 text-sm">Racial Innate Spells</h3>
              <span className="text-xs text-slate-500">({race.name})</span>
              {abilityChoices && (
                <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
                  Ability
                  <select
                    className="bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-white"
                    value={character.innateSpellAbility ?? available[0].ability}
                    onChange={e => setInnateSpellAbility(e.target.value as AbilityKey)}
                  >
                    {abilityChoices.map(a => (
                      <option key={a} value={a}>{a.toUpperCase()}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="divide-y divide-slate-700/50">
              {available.map(innate => {
                const spell = getSpell(innate.spellId);
                if (!spell) return null;
                const isCantrip = innate.recharge === 'cantrip';
                const used = character.innateSpellUses?.[innate.spellId] ?? 1;
                const isAvailable = isCantrip || used > 0;
                const rechargeLabel = innate.recharge === 'long' ? 'Long rest' : innate.recharge === 'short' ? 'Short rest' : '';
                return (
                  <div key={innate.spellId} className="px-4 py-3 flex items-center gap-3 hover:bg-slate-750/50 group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <button
                          className="font-medium text-white text-sm hover:text-red-300 transition-colors text-left"
                          onClick={() => setDetailSpell(spell)}
                        >{spell.name}</button>
                        <Badge color={SCHOOL_COLORS[spell.school] ?? 'slate'} className="text-xs shrink-0">
                          {spell.level === 0 ? 'C' : `L${spell.level}`}
                        </Badge>
                        {spell.concentration && <span className="text-xs text-amber-400 bg-amber-900/30 px-1 rounded">C</span>}
                        {spell.ritual && <span className="text-xs text-blue-400 bg-blue-900/30 px-1 rounded">R</span>}
                      </div>
                      <p className="text-xs text-slate-500">
                        {spell.castingTime} · {spell.range} · {(abilityChoices ? (character.innateSpellAbility ?? innate.ability) : innate.ability).toUpperCase()}
                        {rechargeLabel && <span className="text-slate-600"> · {rechargeLabel}</span>}
                      </p>
                    </div>
                    {/* Cast off the ability the RACE names, not the class's — a tiefling
                        fighter's Hellish Rebuke is Charisma-based whatever they multiclass into. */}
                    {(() => {
                      const ability = abilityChoices ? (character.innateSpellAbility ?? innate.ability) : innate.ability;
                      const mod = mods[ability] ?? 0;
                      return (
                        <SpellRollButtons
                          spell={spell}
                          attackBonus={profBonus + mod}
                          spellMod={mod}
                          {...rollCtx}
                        />
                      );
                    })()}
                    {isCantrip ? (
                      <span className="text-xs text-slate-400 shrink-0">At will</span>
                    ) : (
                      <button
                        disabled={!isAvailable}
                        onClick={() => useInnateSpell(innate.spellId)}
                        className={cn(
                          'shrink-0 text-xs px-2 py-1 rounded border transition-all',
                          isAvailable
                            ? 'border-indigo-600 bg-indigo-900/30 text-indigo-300 hover:bg-indigo-800/50'
                            : 'border-slate-700 bg-slate-900 text-slate-600 cursor-not-allowed',
                        )}
                        title={isAvailable ? `Use (${rechargeLabel} to recharge)` : `Spent — recharges on ${rechargeLabel}`}
                      >
                        {isAvailable ? 'Use' : 'Spent'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Feat spell CHOICES. Magic Initiate, Ritual Caster, Spell Sniper, Artificer Initiate,
          Aberrant Dragonmark and Strixhaven Initiate all say "you learn a spell of your choice"
          and there was nowhere to record which — so the most-taken feat in the game granted
          nothing. Rendered above the granted list, which is where the picks land once made. */}
      <ProficiencyPicker
        title="Feat spells"
        choices={featSpellChoices(character, profBonus).map(c => {
          const options = spellPickOptions(c.grant, character.enabledBooks ?? ['PHB']);
          return {
            key: c.key,
            label: `${c.featName} — ${c.label}`,
            count: c.count,
            options: options.map(sp => sp.id),
            labels: Object.fromEntries(options.map(sp => [sp.id, sp.name])),
          };
        })}
        value={character.selectedFeatSpells}
        onChange={setSelectedFeatSpells}
        compact
      />

      {/* Feat-Granted Spells */}
      {(() => {
        // Fixed grants AND the player's picks — one resolver, so a Magic Initiate cantrip lands
        // here exactly as Fey Touched's Misty Step does.
        const featSpells = featGrantedSpells(character);
        if (!featSpells.length) return null;
        return (
          <div className="bg-slate-800 border border-amber-700/40 rounded-xl overflow-hidden">
            <div className="px-4 py-2 bg-slate-750 border-b border-slate-700 flex items-center gap-2">
              <h3 className="font-bold text-amber-300 text-sm">Feat-Granted Spells</h3>
            </div>
            <div className="divide-y divide-slate-700/50">
              {featSpells.map(({ featId, featName, spellId, recharge, ability }) => {
                const spell = getSpell(spellId);
                if (!spell) return null;
                const key = `feat:${featId}:${spellId}`;
                const isCantrip = recharge === 'cantrip';
                const used = character.innateSpellUses?.[key] ?? 1;
                const isAvailable = isCantrip || used > 0;
                const rechargeLabel = recharge === 'long' ? 'Long rest' : recharge === 'short' ? 'Short rest' : '';
                return (
                  <div key={key} className="px-4 py-3 flex items-center gap-3 hover:bg-slate-750/50 group">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <button
                          className="font-medium text-white text-sm hover:text-red-300 transition-colors text-left"
                          onClick={() => setDetailSpell(spell)}
                        >{spell.name}</button>
                        <Badge color={SCHOOL_COLORS[spell.school] ?? 'slate'} className="text-xs shrink-0">
                          {spell.level === 0 ? 'C' : `L${spell.level}`}
                        </Badge>
                        {spell.concentration && <span className="text-xs text-amber-400 bg-amber-900/30 px-1 rounded">C</span>}
                        {spell.ritual && <span className="text-xs text-blue-400 bg-blue-900/30 px-1 rounded">R</span>}
                      </div>
                      <p className="text-xs text-slate-500">
                        {spell.castingTime} · {spell.range} · {ability.toUpperCase()}
                        {rechargeLabel && <span className="text-slate-600"> · {rechargeLabel}</span>}
                        <span className="text-slate-600"> · {featName}</span>
                      </p>
                    </div>
                    <SpellRollButtons
                      spell={spell}
                      attackBonus={profBonus + (mods[ability] ?? 0)}
                      spellMod={mods[ability] ?? 0}
                      {...rollCtx}
                    />
                    {isCantrip ? (
                      <span className="text-xs text-slate-400 shrink-0">At will</span>
                    ) : (
                      <button
                        disabled={!isAvailable}
                        onClick={() => useFeatSpell(featId, spellId)}
                        className={cn(
                          'shrink-0 text-xs px-2 py-1 rounded border transition-all',
                          isAvailable
                            ? 'border-amber-600 bg-amber-900/30 text-amber-300 hover:bg-amber-800/50'
                            : 'border-slate-700 bg-slate-900 text-slate-600 cursor-not-allowed',
                        )}
                        title={isAvailable ? `Use (${rechargeLabel} to recharge)` : `Spent — recharges on ${rechargeLabel}`}
                      >
                        {isAvailable ? 'Use' : 'Spent'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Cast slot picker dialog */}
      <Dialog open={!!castSpell} onClose={() => setCastSpell(null)} title={castSpell ? `Cast ${castSpell.name}` : ''}>
        {castSpell && (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">
              Choose a spell slot to cast this spell. Spell base level is {castSpell.level === 0 ? 'cantrip' : `L${castSpell.level}`}.
              {castSpell.atHigherLevels && <span className="block mt-1 text-xs text-slate-500 italic">Upcasting: {castSpell.atHigherLevels}</span>}
            </p>

            {/* Concentration overlap warning */}
            {castSpell.concentration && character.concentrationSpellId && character.concentrationSpellId !== castSpell.id && (() => {
              const current = getSpell(character.concentrationSpellId);
              return (
                <div className="text-xs text-amber-300 bg-amber-950/40 border border-amber-700/40 rounded-lg px-3 py-2">
                  ⚠ You are concentrating on <span className="font-bold">{current?.name ?? 'another spell'}</span>. Casting this will break that concentration.
                </div>
              );
            })()}

            {/* Pact slot option */}
            {pactMagic && pactMagic.slotLevel >= castSpell.level && pactMagic.slotsUsed < pactMagic.slotsTotal && (
              <button
                className="w-full text-left p-3 rounded-lg border-2 border-purple-500/50 bg-purple-950/30 hover:bg-purple-900/40 transition-all"
                onClick={() => {
                  usePactSlot();
                  // A pact slot is always the warlock's highest, so this is genuinely an upcast —
                  // Armor of Agathys off a level-3 pact slot is a 3rd-level casting.
                  setCastAtLevel(m => ({ ...m, [castSpell.id]: pactMagic.slotLevel }));
                  if (summonSpecFor(castSpell.id)) setSummonSpell(castSpell);
                  if (castSpell.concentration) startConcentration(castSpell.id);
                  setCastSpell(null);
                }}
              >
                <p className="text-sm font-bold text-purple-300">Pact Magic Slot (L{pactMagic.slotLevel})</p>
                {/* Every pact slot is the warlock's highest level and there is no downcasting, so
                    a 1st-level spell cast this way IS a 3rd-level casting — Hex runs 8 hours
                    instead of 1, Armor of Agathys gives 15 temp HP instead of 5. The button named
                    the slot's level but never said what that did to the spell, which is the half
                    of Pact Magic people actually miss. */}
                {pactMagic.slotLevel > castSpell.level && (
                  <p className="text-xs text-purple-200/90">
                    Casts at level {pactMagic.slotLevel} — pact slots are always your highest level and can&apos;t be spent lower.
                  </p>
                )}
                <p className="text-xs text-slate-400">{pactMagic.slotsTotal - pactMagic.slotsUsed}/{pactMagic.slotsTotal} pact slots remaining</p>
              </button>
            )}

            {/* Regular slot options >= spell level */}
            <div className="grid gap-2">
              {([1,2,3,4,5,6,7,8,9] as SlotLevel[])
                .filter(lvl => lvl >= castSpell.level)
                .map(lvl => {
                  const total = slotTotals[lvl] ?? 0;
                  if (total === 0) return null;
                  const used = slotsUsed[lvl] ?? 0;
                  const avail = total - used;
                  const disabled = avail <= 0;
                  return (
                    <button
                      key={lvl}
                      disabled={disabled}
                      onClick={() => {
                        useSpellSlot(lvl);
                        setCastAtLevel(m => ({ ...m, [castSpell.id]: lvl }));
                        if (castSpell.concentration) startConcentration(castSpell.id);
                        if (summonSpecFor(castSpell.id)) setSummonSpell(castSpell);
                        setCastSpell(null);
                      }}
                      className={cn(
                        'w-full text-left p-3 rounded-lg border-2 transition-all',
                        disabled ? 'border-slate-700 bg-slate-900 opacity-50 cursor-not-allowed'
                                 : lvl === castSpell.level
                                   ? 'border-red-600 bg-red-950/30 hover:bg-red-900/40'
                                   : 'border-slate-600 bg-slate-800 hover:border-amber-500 hover:bg-amber-950/20',
                      )}
                    >
                      <p className="text-sm font-bold text-white">
                        Level {lvl} Slot {lvl > castSpell.level && <span className="text-xs text-amber-400 font-normal">(upcast)</span>}
                      </p>
                      {/* What this slot is actually worth. "Upcasting: …" above quotes the rules
                          text; this answers the question the player opened the dialog to ask. */}
                      {(() => {
                        const r = spellRoll(castSpell, { charLevel: rollCtx.charLevel, slotLevel: lvl, spellMod });
                        if (!r) return null;
                        return (
                          <p className={cn('text-xs font-medium', r.kind === 'healing' ? 'text-green-300' : 'text-orange-300')}>
                            {formatSpellRoll(r)}{r.unscaled ? '?' : ''} {r.kind === 'healing' ? 'healing' : (castSpell.damageType ?? 'damage')}
                          </p>
                        );
                      })()}
                      <p className="text-xs text-slate-400">{avail}/{total} remaining</p>
                    </button>
                  );
                })}
            </div>

            {/* No slots at all */}
            {([1,2,3,4,5,6,7,8,9] as SlotLevel[])
              .filter(lvl => lvl >= castSpell.level)
              .every(lvl => (slotTotals[lvl] ?? 0) === 0) &&
              !(pactMagic && pactMagic.slotLevel >= castSpell.level) && (
                <p className="text-sm text-amber-400 italic">You don&apos;t have any slots at this level or higher.</p>
              )}
          </div>
        )}
      </Dialog>

      <SummonPicker
        spec={summonSpell ? summonSpecFor(summonSpell.id) : undefined}
        character={character}
        title={summonSpell ? summonSpecFor(summonSpell.id)?.title : undefined}
        onClose={() => setSummonSpell(null)}
      />

      {/* Spell detail dialog */}
      <Dialog open={!!detailSpell} onClose={() => setDetailSpell(null)} title={detailSpell?.name} wide>
        {detailSpell && <SpellDetail spell={detailSpell} />}
      </Dialog>

      {/* Add spell dialog */}
      <Dialog open={addOpen} onClose={() => { setAddOpen(false); setSearch(''); setFilterLevel('all'); }} title="Add Spell to Spellbook" wide>
        <div className="flex gap-2 mb-3 flex-wrap">
          <input
            type="search"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-[160px] bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-red-500"
          />
          <div className="flex gap-1 flex-wrap">
            {(['all',0,1,2,3,4,5,6,7,8,9] as const).map(l => (
              <button
                key={l}
                onClick={() => setFilterLevel(l)}
                className={cn('px-2 py-1 rounded text-xs font-medium transition-all', filterLevel === l ? 'bg-red-700 text-white' : 'bg-slate-700 text-slate-300')}
              >
                {l === 'all' ? 'All' : l === 0 ? 'C' : `L${l}`}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1 max-h-96 overflow-y-auto scrollbar-thin">
          {availableToAdd.map(spell => (
            <div key={spell.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-700 cursor-pointer" onClick={() => { addSpellToBook(spell.id, { known: spellsKnown, cantrips: cantripsKnown, spellbook: spellbookLimit }); }}>
              <Badge color={SCHOOL_COLORS[spell.school] ?? 'slate'} className="shrink-0 w-8 text-center justify-center">
                {spell.level === 0 ? 'C' : spell.level}
              </Badge>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white">{spell.name}</p>
                <p className="text-xs text-slate-500">{spell.school} · {spell.castingTime}</p>
              </div>
              <Plus size={14} className="text-slate-400 shrink-0" />
            </div>
          ))}
          {availableToAdd.length === 0 && (
            <p className="text-center py-8 text-slate-500 text-sm">No spells found</p>
          )}
        </div>
      </Dialog>
    </div>
  );
}

function BookOpen({ className, size }: { className?: string; size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
    </svg>
  );
}
