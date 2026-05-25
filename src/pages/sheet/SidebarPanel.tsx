import React from 'react';
import { X, ChevronUp, ChevronDown, Plus } from 'lucide-react';
import {
  useSidebarStore,
  SIDEBAR_MODULE_IDS,
  SIDEBAR_MODULE_LABELS,
  SIDEBAR_MODULE_ICONS,
  type SidebarModuleId,
} from '../../store/useSidebarStore';
import { useCharacterStore } from '../../store/useCharacterStore';
import { useCharacterDerived } from '../../hooks/useCharacterDerived';
import { useDiceStore } from '../../store/useDiceStore';
import { cn } from '../../utils/cn';
import { lookupWeapon, damageLine } from '../../data/weapons';
import { getClass } from '../../data/classes';
import { getSpell } from '../../data/spells';
import type { SlotLevel } from '../../types';
import type { RollDie } from '../../store/useDiceStore';

// ── Helpers ─────────────────────────────────────────────────────────────────

const VALID_DAMAGE_DICE: RollDie[] = [4, 6, 8, 10, 12, 20, 100];
function parseDamageDie(dice: string): RollDie | null {
  if (!dice || dice === '—' || !dice.includes('d')) return null;
  const sides = parseInt(dice.split('d')[1], 10);
  return VALID_DAMAGE_DICE.includes(sides as RollDie) ? (sides as RollDie) : null;
}

// ── ModuleCard wrapper ───────────────────────────────────────────────────────

function ModuleCard({ id, children }: { id: SidebarModuleId; children: React.ReactNode }) {
  const { moveUp, moveDown, togglePin, pinnedModules } = useSidebarStore();
  const idx = pinnedModules.indexOf(id);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
      {/* Card header */}
      <div className="flex items-center gap-0.5 px-3 py-2 border-b border-slate-700/60 bg-slate-800/80">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex-1 truncate">
          {SIDEBAR_MODULE_LABELS[id]}
        </span>
        <button
          onClick={() => moveUp(id)}
          disabled={idx <= 0}
          className="p-0.5 rounded text-slate-600 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          title="Move up"
        >
          <ChevronUp size={11} />
        </button>
        <button
          onClick={() => moveDown(id)}
          disabled={idx === pinnedModules.length - 1}
          className="p-0.5 rounded text-slate-600 hover:text-slate-300 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          title="Move down"
        >
          <ChevronDown size={11} />
        </button>
        <button
          onClick={() => togglePin(id)}
          className="p-0.5 rounded text-slate-500 hover:text-red-400 transition-colors ml-0.5"
          title="Unpin from sidebar"
        >
          <X size={11} />
        </button>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

// ── Character Glance ─────────────────────────────────────────────────────────

function CharacterGlanceModule() {
  const { character, healHP, damageHP } = useCharacterStore();
  const derived = useCharacterDerived(character);
  if (!character || !derived) return null;

  const { totalLevel } = derived;
  const primaryClass = character.classes[0];
  const classDef = primaryClass ? getClass(primaryClass.classId) : null;
  const effectiveMaxHP = (character.exhaustionLevel ?? 0) >= 4
    ? Math.floor(character.maxHP / 2)
    : character.maxHP;
  const hpPct = Math.min(100, Math.round((character.currentHP / effectiveMaxHP) * 100));
  const equippedWeapons = (character.inventory ?? []).filter(
    (item: any) => item.equipped && item.category === 'weapon',
  );

  return (
    <div className="space-y-3">
      {/* Portrait + identity */}
      <div className="flex items-center gap-2.5">
        <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-slate-600 shrink-0">
          {character.portrait
            ? <img src={character.portrait} alt="Portrait" className="w-full h-full object-cover" />
            : <div className="w-full h-full bg-slate-700 flex items-center justify-center text-slate-500 text-xs">?</div>
          }
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-white truncate">{character.name}</p>
          <p className="text-[10px] text-slate-400">Lv{totalLevel} · {classDef?.name ?? '?'}</p>
        </div>
      </div>

      {/* HP bar + quick buttons */}
      <div>
        <div className="flex justify-between text-xs mb-1">
          <span className="text-slate-400">HP</span>
          <span className="font-bold text-white">
            {character.currentHP}/{effectiveMaxHP}
            {character.tempHP > 0 && <span className="text-blue-400 ml-1">+{character.tempHP}</span>}
          </span>
        </div>
        <div className="h-2.5 bg-slate-700 rounded-full overflow-hidden mb-2">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              hpPct > 50 ? 'bg-green-500' : hpPct > 25 ? 'bg-yellow-500' : 'bg-red-500',
            )}
            style={{ width: `${hpPct}%` }}
          />
        </div>
        <div className="grid grid-cols-4 gap-1">
          {([-5, -1, +1, +5] as const).map(delta => (
            <button
              key={delta}
              onClick={() => delta < 0 ? damageHP(-delta) : healHP(delta)}
              className={cn(
                'py-1.5 rounded-lg text-xs font-bold transition-colors border',
                delta < 0
                  ? 'border-red-700/50 bg-red-900/30 text-red-300 hover:bg-red-800/50'
                  : 'border-green-700/50 bg-green-900/30 text-green-300 hover:bg-green-800/50',
              )}
            >
              {delta > 0 ? `+${delta}` : delta}
            </button>
          ))}
        </div>
      </div>

      {/* Equipped weapons */}
      {equippedWeapons.length > 0 && (
        <div className="space-y-0.5">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide">Equipped</p>
          {equippedWeapons.map((item: any) => {
            const w = lookupWeapon(item.name);
            return (
              <p key={item.id} className="text-xs text-slate-300 truncate">
                ⚔ {item.name}{w ? ` · ${w.damageDice} ${w.damageType}` : ''}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Journal ──────────────────────────────────────────────────────────────────

function JournalModule() {
  const { character, setNotes } = useCharacterStore();
  if (!character) return null;
  return (
    <textarea
      value={character.notes ?? ''}
      onChange={e => setNotes(e.target.value)}
      placeholder="Session notes, loot, NPCs met…"
      className="w-full h-40 bg-slate-900 border border-slate-600 rounded-lg px-2.5 py-2 text-xs text-slate-200 placeholder:text-slate-600 resize-y focus:outline-none focus:border-slate-400"
    />
  );
}

// ── Hit Points ────────────────────────────────────────────────────────────────

function HpModule() {
  const { character, setCurrentHP, healHP, damageHP, setTempHP } = useCharacterStore();
  if (!character) return null;

  const effectiveMaxHP = (character.exhaustionLevel ?? 0) >= 4
    ? Math.floor(character.maxHP / 2)
    : character.maxHP;
  const hpPct = Math.min(100, Math.round((character.currentHP / effectiveMaxHP) * 100));

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">Current / Max</span>
        <span className="font-bold text-white">{character.currentHP} / {effectiveMaxHP}</span>
      </div>
      <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            hpPct > 50 ? 'bg-green-500' : hpPct > 25 ? 'bg-yellow-500' : 'bg-red-500',
          )}
          style={{ width: `${hpPct}%` }}
        />
      </div>
      {character.tempHP > 0 && <p className="text-xs text-blue-400">+{character.tempHP} temp HP</p>}

      {/* Quick ±1 / ±5 buttons */}
      <div className="grid grid-cols-4 gap-1">
        {([-5, -1, +1, +5] as const).map(delta => (
          <button
            key={delta}
            onClick={() => delta < 0 ? damageHP(-delta) : healHP(delta)}
            className={cn(
              'py-1.5 rounded-lg text-xs font-bold transition-colors border',
              delta < 0
                ? 'border-red-700/50 bg-red-900/30 text-red-300 hover:bg-red-800/50'
                : 'border-green-700/50 bg-green-900/30 text-green-300 hover:bg-green-800/50',
            )}
          >
            {delta > 0 ? `+${delta}` : delta}
          </button>
        ))}
      </div>

      {/* Direct edit */}
      <div className="grid grid-cols-2 gap-1.5">
        <div>
          <label className="text-[10px] text-slate-500">Current</label>
          <input
            type="number"
            value={character.currentHP}
            onChange={e => setCurrentHP(Number(e.target.value))}
            className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-xs text-center"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500">Temp HP</label>
          <input
            type="number"
            min={0}
            value={character.tempHP}
            onChange={e => setTempHP(Number(e.target.value))}
            className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-xs text-center"
          />
        </div>
      </div>
    </div>
  );
}

// ── Weapon Attacks ────────────────────────────────────────────────────────────

function WeaponAttacksSideModule() {
  const { character } = useCharacterStore();
  const derived = useCharacterDerived(character);
  const { triggerRoll } = useDiceStore();
  if (!character || !derived) return null;

  const { mods, profBonus } = derived;
  const equippedWeapons = (character.inventory ?? []).filter(
    (item: any) => item.equipped && item.category === 'weapon',
  );
  if (equippedWeapons.length === 0) {
    return <p className="text-xs text-slate-500 italic">No weapons equipped.</p>;
  }

  function abilityModForWeapon(w: ReturnType<typeof lookupWeapon>) {
    if (!w) return mods.str;
    if (w.ability === 'finesse') return Math.max(mods.str, mods.dex);
    if (w.ability === 'dex' || w.ranged) return mods.dex;
    return mods.str;
  }

  return (
    <div className="space-y-2">
      {equippedWeapons.map((item: any) => {
        const w = lookupWeapon(item.name);
        const abilityMod = abilityModForWeapon(w);
        const toHit = abilityMod + profBonus;
        const dmgDice = w?.damageDice ?? '1d6';
        const dmgLabel = damageLine(dmgDice, abilityMod);
        const dmgDie = parseDamageDie(dmgDice);

        return (
          <div key={item.id} className="bg-slate-900/60 rounded-lg p-2">
            <p className="text-xs font-semibold text-white mb-1.5 truncate">{item.name}</p>
            <div className="flex gap-1.5">
              <button
                onClick={() => triggerRoll(20, toHit, `${item.name} Attack`)}
                className="flex-1 bg-red-900/40 hover:bg-red-800/50 border border-red-700/60 rounded py-1.5 text-center transition-colors"
                title={`d20 + ${toHit}`}
              >
                <p className="text-[9px] text-slate-400">ATK</p>
                <p className="text-xs font-bold text-white">{toHit >= 0 ? '+' : ''}{toHit} 🎲</p>
              </button>
              <button
                onClick={() => dmgDie && triggerRoll(dmgDie, abilityMod, `${item.name} Damage`)}
                disabled={!dmgDie}
                className="flex-1 bg-orange-900/40 hover:bg-orange-800/50 border border-orange-700/60 rounded py-1.5 text-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title={`Roll ${dmgLabel}`}
              >
                <p className="text-[9px] text-slate-400">DMG</p>
                <p className="text-xs font-bold text-white">{dmgLabel} 🎲</p>
              </button>
            </div>
            {w?.versatile && (
              <button
                onClick={() => {
                  const vd = parseDamageDie(w.versatile!);
                  if (vd) triggerRoll(vd, abilityMod, `${item.name} (2H) Damage`);
                }}
                className="mt-1 w-full text-[9px] text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded py-1 transition-colors"
              >
                Two-handed: {damageLine(w.versatile, abilityMod)} 🎲
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Spell Slots ───────────────────────────────────────────────────────────────

function SpellSlotsSideModule() {
  const { character, useSpellSlot, restoreSpellSlot, usePactSlot, restorePactSlots } = useCharacterStore();
  const derived = useCharacterDerived(character);
  if (!character || !derived) return null;

  const { slotTotals } = derived;
  const spellSlotsUsed: Record<number, number> = character.spellSlotsUsed ?? {};
  const pactMagic = character.pactMagic;
  const hasSlots = Object.values(slotTotals).some(v => v > 0) || !!pactMagic;
  if (!hasSlots) return <p className="text-xs text-slate-500 italic">No spell slots.</p>;

  return (
    <div className="space-y-2">
      {pactMagic && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] text-slate-500">Pact (L{pactMagic.slotLevel})</p>
            <p className="text-[10px] text-slate-500">
              {pactMagic.slotsTotal - pactMagic.slotsUsed}/{pactMagic.slotsTotal}
            </p>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {Array.from({ length: pactMagic.slotsTotal }).map((_, i) => (
              <button
                key={i}
                onClick={() => i < pactMagic.slotsUsed ? restorePactSlots() : usePactSlot()}
                className={cn(
                  'w-7 h-7 rounded border-2 text-xs font-bold transition-all',
                  i < pactMagic.slotsUsed
                    ? 'border-slate-600 bg-slate-700 text-slate-500'
                    : 'border-purple-500 bg-purple-900/30 text-purple-300 hover:bg-purple-800/40',
                )}
                title={i < pactMagic.slotsUsed ? 'Click to restore' : 'Click to use'}
              >
                {i < pactMagic.slotsUsed ? '×' : pactMagic.slotLevel}
              </button>
            ))}
          </div>
        </div>
      )}
      {([1, 2, 3, 4, 5, 6, 7, 8, 9] as SlotLevel[]).map(lvl => {
        const total = slotTotals[lvl] ?? 0;
        if (total === 0) return null;
        const used = spellSlotsUsed[lvl] ?? 0;
        const avail = total - used;
        return (
          <div key={lvl}>
            <div className="flex items-center justify-between mb-0.5">
              <p className="text-[10px] text-slate-500">Level {lvl}</p>
              <p className="text-[10px] text-slate-500">{avail}/{total}</p>
            </div>
            <div className="flex gap-1.5">
              {Array.from({ length: total }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => i < used ? restoreSpellSlot(lvl) : useSpellSlot(lvl)}
                  className={cn(
                    'flex-1 h-6 rounded border-2 text-xs font-bold transition-all',
                    i < used
                      ? 'border-slate-600 bg-slate-700 text-slate-600'
                      : 'border-red-600 bg-red-900/20 text-red-300 hover:bg-red-800/30',
                  )}
                  title={i < used ? 'Restore' : 'Use'}
                >
                  {i < used ? '×' : lvl}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Class Resources ───────────────────────────────────────────────────────────

function ClassResourcesSideModule() {
  const { character, setResource } = useCharacterStore();
  const derived = useCharacterDerived(character);
  if (!character || !derived) return null;

  const { resourceMaxOverrides } = derived;
  const resources = (character.resources ?? []).filter((r: any) => r.key !== 'arcane_recovery');
  if (resources.length === 0) return <p className="text-xs text-slate-500 italic">No class resources.</p>;

  return (
    <div className="space-y-2.5">
      {resources.map((r: any) => {
        const displayMax = resourceMaxOverrides?.[r.key] ?? r.max;
        const cappedMax = Math.min(displayMax === 99 ? 20 : displayMax, 20);
        const cappedCurrent = Math.min(r.current, cappedMax);
        return (
          <div key={r.key}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-white capitalize">{r.key.replace(/_/g, ' ')}</p>
              <button
                onClick={() => setResource(r.key, displayMax === 99 ? r.max : displayMax)}
                className="text-[9px] text-slate-500 hover:text-white transition-colors"
                title="Reset"
              >
                Reset
              </button>
            </div>
            <div className="flex gap-1 flex-wrap">
              {Array.from({ length: cappedMax }).map((_, i) => {
                const avail = i < cappedCurrent;
                return (
                  <button
                    key={i}
                    onClick={() => setResource(r.key, avail ? cappedCurrent - 1 : cappedCurrent + 1)}
                    title={avail ? 'Use one' : 'Restore one'}
                    className={cn(
                      'w-4 h-4 rounded-full border-2 transition-all',
                      avail
                        ? 'border-blue-400 bg-blue-400/30 hover:bg-blue-400/50'
                        : 'border-slate-600 hover:border-slate-400',
                    )}
                  />
                );
              })}
              {displayMax === 99 && (
                <span className="text-xs text-slate-400 self-center ml-1">{r.current}/∞</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Conditions ────────────────────────────────────────────────────────────────

function ConditionsSideModule() {
  const { character, removeCondition } = useCharacterStore();
  if (!character) return null;

  const hasAny = character.conditions.length > 0 || (character.exhaustionLevel ?? 0) > 0;
  if (!hasAny) return <p className="text-xs text-slate-500 italic">No active conditions.</p>;

  return (
    <div className="space-y-1">
      {(character.exhaustionLevel ?? 0) > 0 && (
        <div className="flex items-center bg-orange-950/40 border border-orange-700/50 rounded-lg px-2.5 py-1.5">
          <span className="text-xs text-orange-300 flex-1">Exhaustion {character.exhaustionLevel}</span>
        </div>
      )}
      {character.conditions.map((c: string) => (
        <div key={c} className="flex items-center bg-red-950/40 border border-red-800/50 rounded-lg px-2.5 py-1.5">
          <span className="text-xs text-red-300 flex-1">{c}</span>
          <button
            onClick={() => removeCondition(c as any)}
            className="text-slate-500 hover:text-red-300 text-sm leading-none transition-colors ml-1"
            title="Remove"
          >×</button>
        </div>
      ))}
    </div>
  );
}

// ── Hit Dice ──────────────────────────────────────────────────────────────────

function HitDiceSideModule() {
  const { character, useHitDie, restoreHitDie } = useCharacterStore();
  if (!character) return null;

  return (
    <div className="space-y-2">
      {character.classes.map((cl: any) => {
        const def = getClass(cl.classId);
        if (!def) return null;
        const used = character.hitDiceUsed?.[cl.classId] ?? 0;
        const total = cl.level;
        const remaining = total - used;
        return (
          <div key={cl.classId}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-slate-300">{def.name} d{def.hitDie}</p>
              <p className="text-[10px] text-slate-500">{remaining}/{total}</p>
            </div>
            <div className="flex gap-1 flex-wrap">
              {Array.from({ length: total }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => i < used ? restoreHitDie(cl.classId) : useHitDie(cl.classId)}
                  title={i < used ? 'Click to restore' : `Spend d${def.hitDie}`}
                  className={cn(
                    'px-1.5 py-0.5 rounded border-2 text-[10px] font-bold transition-all',
                    i < used
                      ? 'border-slate-600 bg-slate-700 text-slate-600'
                      : 'border-emerald-700 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-800/40',
                  )}
                >
                  d{def.hitDie}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <p className="text-[10px] text-slate-600">Click to spend · click spent die to restore</p>
    </div>
  );
}

// ── Combat Abilities ──────────────────────────────────────────────────────────

function CombatAbilitiesSideModule() {
  const { character } = useCharacterStore();
  const derived = useCharacterDerived(character);
  if (!character || !derived) return null;

  const { slotTotals, spellSaveDC, spellAttackBonus } = derived;
  const isPreparedCaster = ['cleric', 'druid', 'paladin', 'wizard', 'artificer']
    .includes(character.classes[0]?.classId ?? '');

  type SpellEntry = { spell: ReturnType<typeof getSpell>; alwaysPrepared: boolean };
  const combatSpells: SpellEntry[] = ((character.spellbook ?? [])
    .map((sp: any): SpellEntry | null => {
      const spell = getSpell(sp.spellId);
      if (!spell) return null;
      if (spell.level === 0) return { spell, alwaysPrepared: false };
      if (sp.isPrepared || sp.isAlwaysPrepared) return { spell, alwaysPrepared: sp.isAlwaysPrepared };
      if (!isPreparedCaster) return { spell, alwaysPrepared: false };
      return null;
    })
    .filter(Boolean) as SpellEntry[])
    .sort((a, b) => (a.spell?.level ?? 0) - (b.spell?.level ?? 0));

  const totalSlots = Object.values(slotTotals).reduce((s: number, n) => s + (n as number), 0);
  const hasSlots = totalSlots > 0 || !!character.pactMagic;

  if (combatSpells.length === 0) {
    return <p className="text-xs text-slate-500 italic">No prepared spells.</p>;
  }

  const displayed = combatSpells.slice(0, 10);
  const overflow = combatSpells.length - displayed.length;

  return (
    <div className="space-y-0.5">
      {(spellSaveDC > 0 || spellAttackBonus !== 0) && (
        <div className="flex gap-3 pb-2 border-b border-slate-700/50 mb-1">
          {spellSaveDC > 0 && (
            <p className="text-[10px] text-slate-500">DC <span className="text-white font-bold">{spellSaveDC}</span></p>
          )}
          {spellAttackBonus !== 0 && (
            <p className="text-[10px] text-slate-500">
              Atk <span className="text-white font-bold">{spellAttackBonus >= 0 ? '+' : ''}{spellAttackBonus}</span>
            </p>
          )}
          <p className="text-[10px] text-slate-500 ml-auto">
            {combatSpells.length} spell{combatSpells.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}
      {displayed.map(({ spell }: SpellEntry) => spell && (
        <div
          key={spell.id}
          className="flex items-center gap-1.5 py-1 px-1 rounded transition-colors hover:bg-slate-700/30"
        >
          <span className={cn(
            'text-[9px] font-bold rounded px-1 py-0.5 shrink-0 min-w-[20px] text-center',
            spell.level === 0 ? 'bg-slate-700/80 text-slate-400' : hasSlots ? 'bg-red-900/60 text-red-300' : 'bg-slate-700/60 text-slate-500',
          )}>
            {spell.level === 0 ? 'C' : `L${spell.level}`}
          </span>
          <span className="text-xs text-white flex-1 truncate">{spell.name}</span>
          {spell.concentration && (
            <span className="text-yellow-400/70 text-[9px] shrink-0" title="Concentration">⊙</span>
          )}
        </div>
      ))}
      {overflow > 0 && (
        <p className="text-[10px] text-slate-600 pt-1 pl-1">+{overflow} more · see Spells tab</p>
      )}
    </div>
  );
}

// ── Module dispatcher ─────────────────────────────────────────────────────────

function SidebarModule({ id }: { id: SidebarModuleId }) {
  return (
    <ModuleCard id={id}>
      {id === 'character-glance'  && <CharacterGlanceModule />}
      {id === 'journal'           && <JournalModule />}
      {id === 'hp'                && <HpModule />}
      {id === 'weapon-attacks'    && <WeaponAttacksSideModule />}
      {id === 'spell-slots'       && <SpellSlotsSideModule />}
      {id === 'class-resources'   && <ClassResourcesSideModule />}
      {id === 'conditions'        && <ConditionsSideModule />}
      {id === 'hit-dice'          && <HitDiceSideModule />}
      {id === 'combat-abilities'  && <CombatAbilitiesSideModule />}
    </ModuleCard>
  );
}

// ── Main SidebarPanel export ──────────────────────────────────────────────────

export function SidebarPanel() {
  const { pinnedModules, togglePin, isPinned, setSidebarOpen } = useSidebarStore();
  const [addOpen, setAddOpen] = React.useState(false);

  return (
    <div className="lg:w-72 xl:w-80 bg-slate-850 border-l border-slate-700 flex flex-col overflow-hidden shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-700 shrink-0 bg-slate-800/60">
        <span className="text-xs font-bold text-slate-300 uppercase tracking-widest flex-1">Sidebar</span>
        <button
          onClick={() => setAddOpen(o => !o)}
          className={cn(
            'flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-medium transition-all',
            addOpen
              ? 'bg-sky-900/40 border-sky-600/70 text-sky-300'
              : 'border-slate-600 text-slate-400 hover:border-slate-400 hover:text-white',
          )}
          title="Manage pinned modules"
        >
          <Plus size={10} />
          <span>Modules</span>
        </button>
        <button
          onClick={() => setSidebarOpen(false)}
          className="p-1 rounded text-slate-500 hover:text-white transition-colors"
          title="Close sidebar"
        >
          <X size={14} />
        </button>
      </div>

      {/* Module picker panel */}
      {addOpen && (
        <div className="border-b border-slate-700 px-3 py-2.5 bg-slate-900/60 shrink-0">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">
            Click to pin / unpin
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SIDEBAR_MODULE_IDS.map(id => {
              const pinned = isPinned(id);
              return (
                <button
                  key={id}
                  onClick={() => togglePin(id)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-medium transition-all',
                    pinned
                      ? 'bg-sky-900/40 border-sky-500/70 text-sky-300'
                      : 'bg-slate-800 border-slate-600 text-slate-400 hover:border-slate-400 hover:text-white',
                  )}
                >
                  <span>{SIDEBAR_MODULE_ICONS[id]}</span>
                  <span>{SIDEBAR_MODULE_LABELS[id]}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Pinned module list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-3">
        {pinnedModules.length === 0 ? (
          <div className="text-center pt-10 px-4 select-none">
            <p className="text-3xl mb-3">👁</p>
            <p className="text-sm font-medium text-slate-400 mb-2">No modules pinned yet</p>
            <p className="text-xs text-slate-500 leading-relaxed">
              Click <span className="text-sky-400 font-medium">+ Modules</span> above, or click the{' '}
              <span className="text-sky-400">👁</span> icon on any module in the Combat tab to pin it here.
            </p>
          </div>
        ) : (
          pinnedModules.map(id => <SidebarModule key={id} id={id} />)
        )}
      </div>
    </div>
  );
}
