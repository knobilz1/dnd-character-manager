import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { ArrowLeft, Moon, Sun, Star, Plus, RefreshCw, Sparkles, ChevronUp, Dice5, Download, History, Camera } from 'lucide-react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useCharacterStore } from '../../store/useCharacterStore';
import { useCharacterDerived } from '../../hooks/useCharacterDerived';
import { Button, Tabs, Dialog, StatBox, SectionHeader, NumberStepper, ThemeToggleButton } from '../../components/ui';
import { cn } from '../../utils/cn';
import type { Condition, SlotLevel } from '../../types';
import { SpellPanel } from './SpellPanel';
import { LevelUpDialog } from './LevelUpDialog';
import { TraitsPanel } from './TraitsPanel';
import { InventoryPanel } from './InventoryPanel';
import { DiceRoller } from './DiceRoller';
import { SnapshotPanel } from './SnapshotPanel';
import { useSnapshotStore } from '../../store/useSnapshotStore';
import { useThemeStore } from '../../store/useThemeStore';
import { getClass } from '../../data/classes';
import { getSubclass } from '../../data/subclasses';
import { getSpell } from '../../data/spells';
import { useDiceStore } from '../../store/useDiceStore';
import { lookupWeapon, rollDamage, damageLine } from '../../data/weapons';
import { getRace } from '../../data/races';

// Find a resource definition by key, checking both class and subclass.
function getResourceDef(character: any, key: string) {
  for (const cl of character.classes ?? []) {
    const def = getClass(cl.classId);
    const fromClass = def?.resources.find((rd: any) => rd.key === key);
    if (fromClass) return fromClass;
    const sub = cl.subclassId ? getSubclass(cl.subclassId) : undefined;
    const fromSub = sub?.resources?.find((rd: any) => rd.key === key);
    if (fromSub) return fromSub;
  }
  return undefined;
}

// Exhaustion is tracked separately via exhaustionLevel; it has its own +/- UI
// and a dedicated button in the Add Condition dialog, so it's omitted here to
// prevent duplicate tracking on a single character.
const CONDITION_LIST: Condition[] = [
  'Blinded','Charmed','Deafened','Frightened','Grappled',
  'Incapacitated','Invisible','Paralyzed','Petrified','Poisoned','Prone',
  'Restrained','Stunned','Unconscious',
];

const CONDITION_DESC: Partial<Record<Condition, string>> = {
  Blinded:        "Can't see. Auto-fail sight-based ability checks. Attack rolls against you have advantage; your attack rolls have disadvantage.",
  Charmed:        "Can't attack the charmer. The charmer has advantage on Charisma checks against you.",
  Deafened:       "Can't hear. Auto-fail hearing-based ability checks.",
  Frightened:     "Disadvantage on ability checks and attack rolls while source of fear is in line of sight. Can't willingly move closer to source.",
  Grappled:       "Speed becomes 0. Ends if grappler is incapacitated or you are moved out of reach.",
  Incapacitated:  "Can't take actions or reactions.",
  Invisible:      "Impossible to see without magic. Considered heavily obscured. Your attacks have advantage; attacks against you have disadvantage.",
  Paralyzed:      "Incapacitated, can't move or speak. Auto-fail STR & DEX saves. Attacks against you have advantage. Any hit within 5 ft is a critical hit.",
  Petrified:      "Turned to stone. Incapacitated, can't move. Auto-fail STR & DEX saves. Resistance to all damage; immune to poison and disease.",
  Poisoned:       "Disadvantage on attack rolls and ability checks.",
  Prone:          "Disadvantage on attack rolls. Melee attacks against you have advantage; ranged attacks have disadvantage. Must spend half speed to stand up.",
  Restrained:     "Speed 0. Attack rolls against you have advantage; your attack rolls have disadvantage. Disadvantage on DEX saves.",
  Stunned:        "Incapacitated, can't move, can only speak falteringly. Auto-fail STR & DEX saves. Attacks against you have advantage.",
  Unconscious:    "Incapacitated, can't move or speak. Unaware of surroundings. Drop held items, fall prone. Auto-fail STR & DEX saves. Attacks against you have advantage. Hits within 5 ft are critical hits.",
};

export function SheetPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { characters } = useLibraryStore();
  const { character, load, save, setCurrentHP, healHP, damageHP, setTempHP, setMaxHP,
    addDeathSuccess, addDeathFailure, resetDeathSaves, addCondition, removeCondition,
    setExhaustion, useSpellSlot, restoreSpellSlot, restoreAllSpellSlots, usePactSlot,
    restorePactSlots, toggleSpellPrepared, startConcentration, endConcentration,
    setResource, shortRest, longRest, toggleInspiration, setNotes, addSpellToBook,
    removeSpellFromBook, addInventoryItem, removeInventoryItem, setInventoryQuantity,
    toggleInventoryEquipped, renameInventoryItem, setInventoryDescription, setItemCharges, levelUp, useHitDie, restoreHitDie, setPortrait } = useCharacterStore();

  const [tab, setTab] = React.useState('combat');
  const [round, setRound] = React.useState(1);
  const [activeEffects, setActiveEffects] = React.useState<Record<string, number>>({}); // key → round when activated
  const [hpInput, setHpInput] = React.useState('');
  const [hpMode, setHpMode] = React.useState<'heal'|'damage'>('damage');
  const [addConditionOpen, setAddConditionOpen] = React.useState(false);
  const [restConfirm, setRestConfirm] = React.useState<'short'|'long'|null>(null);
  const [arcaneOpen, setArcaneOpen] = React.useState(false);
  const [levelUpOpen, setLevelUpOpen] = React.useState(false);
  const [snapshotOpen, setSnapshotOpen] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const portraitInputRef = React.useRef<HTMLInputElement>(null);

  const { saveSnapshot } = useSnapshotStore();
  const { theme, toggleTheme } = useThemeStore();

  function handlePortraitUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const result = ev.target?.result;
      if (typeof result === 'string') setPortrait(result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  // Load character on mount
  React.useEffect(() => {
    const c = characters.find(c => c.id === id);
    if (c) load(c);
    else navigate('/');
  }, [id]);

  // Auto-save
  React.useEffect(() => {
    if (!character) return;
    const t = setTimeout(() => { save(); setSaved(true); setTimeout(() => setSaved(false), 1500); }, 1000);
    return () => clearTimeout(t);
  }, [character]);

  const derived = useCharacterDerived(character);
  const { triggerRoll } = useDiceStore();

  if (!character || !derived) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</div>;
  }

  const { finalScores, mods, profBonus, ac, initiative, speed, baseSpeed, savingThrows, savingThrowProficiencies, skills, allSkillProficiencies, passivePerception, passiveInsight, spellSaveDC, spellAttackBonus, slotTotals, totalLevel, exhaustionLevel, exhaustionDisadvChecks, exhaustionDisadvSaves, resourceMaxOverrides } = derived;

  const race = getRace(character.raceId);
  const primaryClass = character.classes[0];
  const classDef = primaryClass ? getClass(primaryClass.classId) : null;
  // At exhaustion 4 the HP maximum is halved (PHB p. 291)
  const effectiveMaxHP = (character.exhaustionLevel ?? 0) >= 4
    ? Math.floor(character.maxHP / 2)
    : character.maxHP;
  const hpPercent = Math.min(100, Math.round((character.currentHP / effectiveMaxHP) * 100));

  function applyHP() {
    const amount = parseInt(hpInput);
    if (isNaN(amount) || amount <= 0) return;
    if (hpMode === 'heal') healHP(amount); else damageHP(amount);
    setHpInput('');
  }

  function doRest(type: 'short'|'long') {
    if (type === 'long') {
      saveSnapshot(character!, 'Before Long Rest');
      longRest();
    } else {
      shortRest();
    }
    setRestConfirm(null);
  }

  const abilityKeys = ['str','dex','con','int','wis','cha'] as const;
  const abilityLabels: Record<string, string> = { str:'STR',dex:'DEX',con:'CON',int:'INT',wis:'WIS',cha:'CHA' };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      {/* Top bar */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </button>
          {/* Portrait avatar */}
          <input ref={portraitInputRef} type="file" accept="image/*" className="hidden" onChange={handlePortraitUpload} />
          <button
            onClick={() => portraitInputRef.current?.click()}
            className="relative w-10 h-10 rounded-full overflow-hidden border-2 border-slate-600 hover:border-red-500 transition-colors shrink-0 group"
            title="Upload portrait"
          >
            {character.portrait
              ? <img src={character.portrait} alt="Portrait" className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-slate-700 flex items-center justify-center text-slate-500 group-hover:text-red-400 transition-colors">
                  <Camera size={16} />
                </div>
            }
          </button>
          <div>
            <h1 className="font-bold text-white text-lg leading-tight">{character.name}</h1>
            <p className="text-xs text-slate-400">
              Level {totalLevel} {race?.name ?? ''} {classDef?.name ?? ''} · {character.alignment}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-green-400">Saved ✓</span>}
          <ThemeToggleButton theme={theme} onToggle={toggleTheme} size={18} />
          <button
            onClick={() => setSnapshotOpen(true)}
            className="p-1.5 rounded text-slate-500 hover:text-violet-400 transition-colors"
            title="Character history"
          >
            <History size={18} />
          </button>
          <DiceRoller exhaustionLevel={exhaustionLevel} />
          <button
            onClick={async () => {
              const snapshots = useSnapshotStore.getState().snapshotsFor(character.id);
              const payload = { tavernSheet: true, version: 1, character, snapshots };
              const json = JSON.stringify(payload, null, 2);
              const path = await saveDialog({
                defaultPath: `${character.name || 'character'}.json`,
                filters: [{ name: 'JSON', extensions: ['json'] }],
              });
              if (path) await writeTextFile(path, json);
            }}
            className="p-1.5 rounded text-slate-500 hover:text-blue-400 transition-colors"
            title="Export character"
          >
            <Download size={18} />
          </button>
          {character.inspiration && (
            <span className="text-xs bg-yellow-700/50 text-yellow-300 px-2 py-0.5 rounded border border-yellow-600">✦ Inspired</span>
          )}
          <button
            onClick={toggleInspiration}
            className={cn('p-1.5 rounded transition-colors', character.inspiration ? 'text-yellow-400 hover:text-yellow-300' : 'text-slate-500 hover:text-yellow-400')}
            title="Toggle Inspiration"
          >
            <Star size={18} />
          </button>
          {totalLevel < 20 && (
            <Button variant="outline" size="sm" onClick={() => setLevelUpOpen(true)}>
              <ChevronUp size={14} /> Level Up
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setRestConfirm('short')}>
            <Sun size={14} /> Short Rest
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setRestConfirm('long')}>
            <Moon size={14} /> Long Rest
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left sidebar — ability scores & skills */}
        <div className="lg:w-64 xl:w-72 bg-slate-850 border-b lg:border-b-0 lg:border-r border-slate-700 overflow-y-auto scrollbar-thin p-4 flex flex-col gap-4">
          {/* Ability scores */}
          <div>
            <SectionHeader>Abilities</SectionHeader>
            <div className="grid grid-cols-3 gap-2">
              {abilityKeys.map(k => (
                <StatBox key={k} label={abilityLabels[k]} score={finalScores[k]} modifier={mods[k]} />
              ))}
            </div>
          </div>

          {/* Core stats row */}
          <div>
            <SectionHeader>Core Stats</SectionHeader>
            <div className="grid grid-cols-3 gap-2">
              {/* AC — static */}
              <div className="bg-slate-900 border border-slate-700 rounded-lg py-2 px-1 text-center">
                <p className="text-xs text-slate-400">AC</p>
                <p className="font-bold text-white">{ac}</p>
              </div>
              {/* Initiative — clickable to roll */}
              <button
                onClick={() => triggerRoll(20, initiative, 'Initiative')}
                className="bg-slate-900 border border-slate-700 rounded-lg py-2 px-1 text-center hover:border-blue-500/60 hover:bg-slate-800 transition-colors cursor-pointer group"
                title="Click to roll initiative"
              >
                <p className="text-xs text-slate-400 group-hover:text-blue-400 transition-colors">Init <span className="text-[10px] opacity-60">🎲</span></p>
                <p className="font-bold text-white">{initiative >= 0 ? `+${initiative}` : `${initiative}`}</p>
              </button>
              {/* Speed */}
              <div className={cn('bg-slate-900 border rounded-lg py-2 px-1 text-center', exhaustionLevel >= 2 ? 'border-orange-700/60' : 'border-slate-700')}
                title={exhaustionLevel >= 5 ? 'Speed reduced to 0 (Exhaustion 5)' : exhaustionLevel >= 2 ? `Speed halved from ${baseSpeed} ft (Exhaustion 2)` : undefined}>
                <p className="text-xs text-slate-400">Speed</p>
                <p className={cn('font-bold', exhaustionLevel >= 2 ? 'text-orange-300' : 'text-white')}>{speed} ft</p>
              </div>
              {/* Prof */}
              <div className="bg-slate-900 border border-slate-700 rounded-lg py-2 px-1 text-center">
                <p className="text-xs text-slate-400">Prof</p>
                <p className="font-bold text-white">+{profBonus}</p>
              </div>
              {/* Passive Perception */}
              <div className="bg-slate-900 border border-slate-700 rounded-lg py-2 px-1 text-center" title="10 + Perception bonus">
                <p className="text-xs text-slate-400">Pass. Perc</p>
                <p className="font-bold text-white">{passivePerception}</p>
              </div>
              {/* Passive Insight */}
              <div className="bg-slate-900 border border-slate-700 rounded-lg py-2 px-1 text-center" title="10 + Insight bonus">
                <p className="text-xs text-slate-400">Pass. Ins</p>
                <p className="font-bold text-white">{passiveInsight}</p>
              </div>
            </div>
          </div>

          {/* Saving throws */}
          <div>
            <SectionHeader>Saving Throws</SectionHeader>
            <div className="space-y-1">
              {exhaustionDisadvSaves && (
                <p className="text-[11px] text-orange-400 flex items-center gap-1 px-2 pb-0.5">
                  <span>⚠</span> Disadvantage on all saves (Exhaustion {exhaustionLevel})
                </p>
              )}
              {abilityKeys.map(k => {
                const val = savingThrows[k];
                const isProficient = savingThrowProficiencies.has(k);
                return (
                  <button
                    key={k}
                    onClick={() => triggerRoll(20, val, `${abilityLabels[k]} Save`)}
                    className="flex items-center justify-between py-1 px-2 rounded hover:bg-slate-800 w-full transition-colors group"
                    title={`Roll ${abilityLabels[k]} saving throw`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={cn('w-2 h-2 rounded-full', isProficient ? 'bg-green-400' : 'bg-slate-600')} />
                      <span className={cn('text-sm', exhaustionDisadvSaves ? 'text-orange-300' : 'text-slate-300 group-hover:text-white')}>{abilityLabels[k]}</span>
                    </div>
                    <span className={cn('text-sm font-bold', val >= 0 ? (exhaustionDisadvSaves ? 'text-orange-300' : 'text-white') : 'text-red-400')}>
                      {val >= 0 ? '+' : ''}{val}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Skills */}
          <div>
            <SectionHeader>Skills</SectionHeader>
            <div className="space-y-0.5">
              {exhaustionDisadvChecks && (
                <p className="text-[11px] text-orange-400 flex items-center gap-1 px-2 pb-0.5">
                  <span>⚠</span> Disadvantage on all ability checks (Exhaustion {exhaustionLevel})
                </p>
              )}
              {Object.entries(skills).map(([skill, bonus]) => {
                const isProficient = allSkillProficiencies.has(skill);
                return (
                  <button
                    key={skill}
                    onClick={() => triggerRoll(20, bonus, `${skill} Check`)}
                    className="flex items-center justify-between py-0.5 px-2 rounded hover:bg-slate-800 w-full transition-colors group"
                    title={`Roll ${skill} check`}
                  >
                    <div className="flex items-center gap-1.5">
                      <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', isProficient ? 'bg-green-400' : 'bg-slate-600')} />
                      <span className={cn('text-xs truncate', exhaustionDisadvChecks ? 'text-orange-300' : 'text-slate-300 group-hover:text-white')}>{skill}</span>
                    </div>
                    <span className={cn('text-xs font-bold shrink-0', bonus >= 0 ? (exhaustionDisadvChecks ? 'text-orange-300' : 'text-slate-300') : 'text-red-400')}>
                      {bonus >= 0 ? '+' : ''}{bonus}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
          <Tabs
            tabs={[
              { id: 'combat', label: 'Combat' },
              { id: 'spells', label: 'Spells' },
              { id: 'inventory', label: 'Inventory' },
              { id: 'character', label: 'Character' },
            ]}
            active={tab}
            onChange={setTab}
          />

          <div className="mt-4">
            {tab === 'combat' && (
              <CombatTab
                character={character}
                round={round}
                setRound={setRound}
                hpPercent={hpPercent}
                hpInput={hpInput}
                hpMode={hpMode}
                setHpInput={setHpInput}
                setHpMode={setHpMode}
                applyHP={applyHP}
                setCurrentHP={setCurrentHP}
                setTempHP={setTempHP}
                setMaxHP={setMaxHP}
                addDeathSuccess={addDeathSuccess}
                addDeathFailure={addDeathFailure}
                resetDeathSaves={resetDeathSaves}
                addConditionOpen={addConditionOpen}
                setAddConditionOpen={setAddConditionOpen}
                addCondition={addCondition}
                removeCondition={removeCondition}
                setExhaustion={setExhaustion}
                classDef={classDef}
                resources={character.resources}
                setResource={setResource}
                spellSaveDC={spellSaveDC}
                spellAttackBonus={spellAttackBonus}
                slotTotals={slotTotals}
                useSpellSlot={useSpellSlot}
                restoreSpellSlot={restoreSpellSlot}
                restoreAllSpellSlots={restoreAllSpellSlots}
                pactMagic={character.pactMagic}
                usePactSlot={usePactSlot}
                restorePactSlots={restorePactSlots}
                spellSlotsUsed={character.spellSlotsUsed}
                concentrationSpellId={character.concentrationSpellId}
                endConcentration={endConcentration}
                useHitDie={useHitDie}
                restoreHitDie={restoreHitDie}
                effectiveMaxHP={effectiveMaxHP}
                mods={mods}
                profBonus={profBonus}
                resourceMaxOverrides={resourceMaxOverrides}
                activeEffects={activeEffects}
                setActiveEffects={setActiveEffects}
              />
            )}
            {tab === 'spells' && (
              <SpellPanel
                character={character}
                derived={derived}
                toggleSpellPrepared={toggleSpellPrepared}
                startConcentration={startConcentration}
                endConcentration={endConcentration}
                addSpellToBook={addSpellToBook}
                removeSpellFromBook={removeSpellFromBook}
                useSpellSlot={useSpellSlot}
                usePactSlot={usePactSlot}
              />
            )}
            {tab === 'inventory' && (
              <InventoryPanel
                character={character}
                addInventoryItem={addInventoryItem}
                removeInventoryItem={removeInventoryItem}
                setInventoryQuantity={setInventoryQuantity}
                toggleInventoryEquipped={toggleInventoryEquipped}
                renameInventoryItem={renameInventoryItem}
                setInventoryDescription={setInventoryDescription}
                setItemCharges={setItemCharges}
              />
            )}
            {tab === 'character' && (
              <TraitsPanel character={character} setNotes={setNotes} />
            )}
          </div>
        </div>
      </div>

      {/* Snapshot history */}
      <SnapshotPanel
        open={snapshotOpen}
        onClose={() => setSnapshotOpen(false)}
        character={character}
      />

      {/* Level Up */}
      <LevelUpDialog
        open={levelUpOpen}
        onClose={() => setLevelUpOpen(false)}
        character={character}
        onConfirm={(classId, hpGained, hpRoll, subclassPick, asiChoice) => {
          saveSnapshot(character!, 'Before Level Up');
          levelUp(classId, hpGained, hpRoll, subclassPick, asiChoice);
        }}
      />

      {/* Rest confirm */}
      <Dialog open={!!restConfirm} onClose={() => setRestConfirm(null)} title={restConfirm === 'long' ? 'Long Rest' : 'Short Rest'}>
        <p className="text-slate-300 mb-4">
          {restConfirm === 'long'
            ? 'Taking a long rest will restore all HP, spell slots, and class resources. Conditions (except Exhaustion) are cleared.'
            : 'Taking a short rest will restore short-rest resources (Ki, Channel Divinity, Action Surge, Warlock pact slots). Spend hit dice below to recover HP.'}
        </p>

        {/* Hit Dice — shown on short rest */}
        {restConfirm === 'short' && (
          <div className="mb-5 p-3 bg-slate-900 rounded-lg border border-slate-700">
            <p className="text-sm font-medium text-white mb-0.5">Hit Dice</p>
            <p className="text-xs text-slate-400 mb-3">Click a die to spend it and roll HP. Click a spent die to restore it.</p>
            <div className="space-y-3">
              {character.classes.map((cl: any) => {
                const def = getClass(cl.classId);
                if (!def) return null;
                const used = character.hitDiceUsed?.[cl.classId] ?? 0;
                const total = cl.level;
                const remaining = total - used;
                return (
                  <div key={cl.classId}>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-medium text-slate-300">
                        {def.name} <span className="text-slate-500">d{def.hitDie}</span>
                      </p>
                      <p className="text-xs text-slate-500">{remaining}/{total}</p>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {Array.from({ length: total }).map((_, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            if (i < used) {
                              restoreHitDie(cl.classId);
                            } else {
                              const roll = Math.ceil(Math.random() * def.hitDie);
                              const gained = Math.max(1, roll + mods.con);
                              useHitDie(cl.classId);
                              healHP(gained);
                            }
                          }}
                          className={cn(
                            'h-7 px-2 rounded border-2 transition-all text-xs font-bold flex items-center gap-1',
                            i < used
                              ? 'border-slate-600 bg-slate-700 text-slate-600'
                              : 'border-emerald-700 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-800/40',
                          )}
                          title={i < used ? 'Click to restore' : `Roll d${def.hitDie} + CON (${mods.con >= 0 ? '+' : ''}${mods.con}) HP`}
                        >
                          <Dice5 size={10} />
                          d{def.hitDie}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Arcane Recovery — shown on short rest */}
        {restConfirm === 'short' && (() => {
          const ar = character.resources.find((r: any) => r.key === 'arcane_recovery');
          if (!ar || ar.current <= 0) return null;
          return (
            <div className="mb-5 p-3 bg-slate-900 rounded-lg border border-slate-700">
              <p className="text-sm font-medium text-white mb-0.5">Arcane Recovery</p>
              <p className="text-xs text-slate-400 mb-2">{ar.current}/{ar.max} charge{ar.max !== 1 ? 's' : ''} remaining · recover expended spell slots (max 5th level)</p>
              <Button size="sm" variant="outline" onClick={() => setArcaneOpen(true)}>Use Arcane Recovery</Button>
            </div>
          );
        })()}

        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setRestConfirm(null)}>Cancel</Button>
          <Button onClick={() => doRest(restConfirm!)}>
            {restConfirm === 'long' ? <Moon size={14} /> : <Sun size={14} />}
            Take {restConfirm === 'long' ? 'Long' : 'Short'} Rest
          </Button>
        </div>
      </Dialog>

      {/* Arcane Recovery (accessible from short rest) */}
      {(() => {
        const ar = character.resources.find((r: any) => r.key === 'arcane_recovery');
        if (!ar) return null;
        return (
          <ArcaneRecoveryDialog
            open={arcaneOpen}
            onClose={() => setArcaneOpen(false)}
            budget={ar.current}
            slotTotals={slotTotals}
            spellSlotsUsed={character.spellSlotsUsed}
            onConfirm={(recovering: Record<number, number>) => {
              for (const [lvlStr, count] of Object.entries(recovering)) {
                const lvl = Number(lvlStr) as SlotLevel;
                for (let i = 0; i < count; i++) restoreSpellSlot(lvl);
              }
              const spent = Object.entries(recovering).reduce((s, [lvl, n]) => s + Number(lvl) * n, 0);
              setResource('arcane_recovery', ar.current - spent);
            }}
          />
        );
      })()}
    </div>
  );
}

// ── Sustained Ability Metadata ───────────────────────────────────────────────
// Resources listed here get an "Activate / End" toggle + round countdown when active.
// durationRounds: undefined = no automatic expiry countdown (e.g. Wild Shape).
interface SustainedMeta {
  durationRounds?: number;
  bg: string; border: string; text: string;
  progressBg: string; dotBg: string; label: string;
}
const SUSTAINED_ABILITIES: Record<string, SustainedMeta> = {
  // ── Barbarian ──────────────────────────────────────────────────────────────
  rage:             { durationRounds: 10, bg: 'bg-red-950/60',    border: 'border-red-600',    text: 'text-red-300',    progressBg: 'bg-red-500',    dotBg: 'bg-red-300',    label: 'Raging'           },
  // ── Druid ──────────────────────────────────────────────────────────────────
  wild_shape:       {                     bg: 'bg-green-950/50',  border: 'border-green-600',  text: 'text-green-300',  progressBg: 'bg-green-500',  dotBg: 'bg-green-300',  label: 'Wild Shaped'      },
  // ── Paladin / Cleric — Channel Divinity (duration-based uses) ──────────────
  channel_divinity: { durationRounds: 10, bg: 'bg-amber-950/50',  border: 'border-amber-600',  text: 'text-amber-300',  progressBg: 'bg-amber-500',  dotBg: 'bg-amber-300',  label: 'Channel Active'   },
  // ── Warlock / Hexblade ─────────────────────────────────────────────────────
  hexblade_curse:   { durationRounds: 10, bg: 'bg-violet-950/60', border: 'border-violet-600', text: 'text-violet-300', progressBg: 'bg-violet-500', dotBg: 'bg-violet-300', label: 'Hexblade Cursed'  },
  // ── Wizard / Bladesinging ──────────────────────────────────────────────────
  bladesong:        { durationRounds: 10, bg: 'bg-teal-950/60',   border: 'border-teal-500',   text: 'text-teal-300',   progressBg: 'bg-teal-400',   dotBg: 'bg-teal-300',   label: 'Bladesinging'     },
};

// ── Combat Abilities Panel ───────────────────────────────────────────────────
// Shows prepared/known spells, class features, and magic-item abilities at the
// bottom of the Combat tab so everything needed in a fight is in one place.

const PREPARED_CASTER_IDS = ['cleric', 'druid', 'paladin', 'wizard', 'artificer'];

const SPELL_SCHOOL_COLORS: Record<string, string> = {
  Abjuration: 'text-blue-400',   Conjuration: 'text-purple-400',
  Divination: 'text-indigo-400', Enchantment: 'text-pink-400',
  Evocation:  'text-red-400',    Illusion: 'text-violet-400',
  Necromancy: 'text-slate-300',  Transmutation: 'text-green-400',
};

function castTimeShort(ct: string): string {
  const l = ct.toLowerCase();
  if (l.includes('bonus action')) return 'BA';
  if (l.includes('reaction'))    return 'RXN';
  if (l.match(/\d+ (minute|hour)/)) return l.replace(/1 (minute|hour)/, '1min').replace(/(\d+) minutes?/, '$1min').replace(/(\d+) hours?/, '$1hr').split(' ').slice(0,2).join(' ');
  return 'A';
}

function spellLevelLabel(lvl: number): string {
  if (lvl === 0) return 'Cantrip';
  const ord = ['','1st','2nd','3rd','4th','5th','6th','7th','8th','9th'];
  return ord[lvl] ?? `${lvl}th`;
}

// Defined outside CombatAbilitiesPanel so it isn't recreated on every render.
function SectionToggle({ label, open, onToggle, count }: { label: string; open: boolean; onToggle: () => void; count: number }) {
  return (
    <button onClick={onToggle} className="flex items-center justify-between w-full group">
      <span className="text-xs font-bold uppercase tracking-widest text-slate-400 group-hover:text-slate-300 transition-colors">
        {label}
        <span className="ml-2 text-slate-600 font-normal normal-case tracking-normal">({count})</span>
      </span>
      <span className="text-slate-500 text-xs">{open ? '▲' : '▼'}</span>
    </button>
  );
}

function CombatAbilitiesPanel({ character, spellSaveDC, spellAttackBonus }: {
  character: any;
  spellSaveDC: number;
  spellAttackBonus: number;
}) {
  const [spellsOpen,     setSpellsOpen]     = React.useState(true);
  const [abilitiesOpen,  setAbilitiesOpen]  = React.useState(true);
  const [itemsOpen,      setItemsOpen]      = React.useState(true);
  const [expandedKey,    setExpandedKey]    = React.useState<string | null>(null);

  function toggleExpand(key: string) {
    setExpandedKey(prev => prev === key ? null : key);
  }

  const primaryClassId  = character.classes[0]?.classId ?? '';
  const isPreparedCaster = PREPARED_CASTER_IDS.includes(primaryClassId);

  // ── Spells ──────────────────────────────────────────────────────────────────
  // Prepared casters: show cantrips + spells marked isPrepared or isAlwaysPrepared.
  // Known casters (Bard, Sorcerer, Warlock, Ranger…): all spells in book are always
  // available — show everything.
  type SpellEntry = { spell: ReturnType<typeof getSpell>; alwaysPrepared: boolean };
  const combatSpells: SpellEntry[] = (character.spellbook ?? [])
    .map((sp: any): SpellEntry | null => {
      const spell = getSpell(sp.spellId);
      if (!spell) return null;
      if (spell.level === 0)                    return { spell, alwaysPrepared: false };
      if (sp.isPrepared || sp.isAlwaysPrepared) return { spell, alwaysPrepared: sp.isAlwaysPrepared };
      if (!isPreparedCaster)                    return { spell, alwaysPrepared: false }; // known caster
      return null;
    })
    .filter(Boolean)
    .sort((a: SpellEntry, b: SpellEntry) =>
      (a.spell?.level ?? 0) - (b.spell?.level ?? 0) ||
      (a.spell?.name ?? '').localeCompare(b.spell?.name ?? ''),
    ) as SpellEntry[];

  // ── Class & subclass features ────────────────────────────────────────────────
  const classAbilities: { name: string; description: string; source: string; level: number }[] =
    character.classes.flatMap((cl: any) => {
      const def = getClass(cl.classId);
      const sub = cl.subclassId ? getSubclass(cl.subclassId) : undefined;
      return [
        ...(def?.features.filter((f: any) => f.level <= cl.level && !f.isASI) ?? [])
          .map((f: any) => ({ name: f.name, description: f.description, source: def!.name, level: f.level })),
        ...(sub?.features.filter((f: any) => f.level <= cl.level) ?? [])
          .map((f: any) => ({ name: f.name, description: f.description, source: sub!.name, level: f.level })),
      ];
    });

  // ── Magic-item abilities ─────────────────────────────────────────────────────
  // Show any item categorised as 'magic' that has a description or charge tracking.
  const magicItems = (character.inventory ?? []).filter(
    (item: any) => item.category === 'magic' && (item.description || item.maxCharges != null),
  );

  const hasSpells    = combatSpells.length > 0;
  const hasAbilities = classAbilities.length > 0;
  const hasItems     = magicItems.length > 0;
  if (!hasSpells && !hasAbilities && !hasItems) return null;

  return (
    <div className="space-y-3">

      {/* ── Spells ── */}
      {hasSpells && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionToggle
            label={isPreparedCaster ? 'Prepared Spells' : 'Known Spells'}
            open={spellsOpen}
            onToggle={() => setSpellsOpen(o => !o)}
            count={combatSpells.length}
          />
          {spellsOpen && (
            <div className="mt-3 space-y-px">
              {combatSpells.map(({ spell, alwaysPrepared }) => spell && (
                <div key={spell.id} className="rounded-lg overflow-hidden">
                  {/* Summary row */}
                  <button
                    onClick={() => toggleExpand(`spell-${spell.id}`)}
                    className="flex items-center gap-2 w-full px-2 py-1.5 hover:bg-slate-700/50 transition-colors text-left"
                  >
                    <span className={cn(
                      'text-[10px] font-bold rounded px-1.5 py-0.5 min-w-[28px] text-center shrink-0',
                      castTimeShort(spell.castingTime) === 'BA'  ? 'bg-amber-900/60 text-amber-300' :
                      castTimeShort(spell.castingTime) === 'RXN' ? 'bg-purple-900/60 text-purple-300' :
                      'bg-slate-700 text-slate-300',
                    )}>
                      {castTimeShort(spell.castingTime)}
                    </span>
                    <span className="text-[10px] text-slate-500 w-[38px] shrink-0">{spellLevelLabel(spell.level)}</span>
                    <span className="text-sm text-white font-medium flex-1 truncate">{spell.name}</span>
                    <span className={cn('text-[10px] hidden sm:inline shrink-0 w-[28px]', SPELL_SCHOOL_COLORS[spell.school] ?? 'text-slate-400')}>
                      {spell.school.slice(0, 4)}
                    </span>
                    <span className="text-[10px] text-slate-500 shrink-0 w-[42px] text-right">
                      {spell.range.replace(' feet', 'ft').replace(' foot', 'ft')}
                    </span>
                    {spell.concentration && <span className="text-yellow-400/80 text-[10px] shrink-0" title="Concentration">⊙</span>}
                    {alwaysPrepared && spell.level > 0 && <span className="text-teal-400/80 text-[10px] shrink-0" title="Always prepared">✦</span>}
                    <span className="text-slate-500 text-[10px] shrink-0 ml-1">
                      {expandedKey === `spell-${spell.id}` ? '▲' : '▼'}
                    </span>
                  </button>
                  {/* Expanded detail */}
                  {expandedKey === `spell-${spell.id}` && (
                    <div className="px-3 pb-3 pt-1 bg-slate-900/60 border-t border-slate-700/50 text-xs space-y-1.5">
                      <div className="flex flex-wrap gap-1.5 items-center">
                        <span className="text-slate-400">{spellLevelLabel(spell.level)} {spell.school}</span>
                        {spell.concentration && <span className="bg-yellow-900/50 text-yellow-300 px-1.5 py-0.5 rounded text-[10px]">Concentration</span>}
                        {spell.ritual && <span className="bg-teal-900/50 text-teal-300 px-1.5 py-0.5 rounded text-[10px]">Ritual</span>}
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                        <span className="text-slate-500">Cast time <span className="text-slate-300">{spell.castingTime}</span></span>
                        <span className="text-slate-500">Range <span className="text-slate-300">{spell.range}</span></span>
                        <span className="text-slate-500">Duration <span className="text-slate-300">{spell.duration}</span></span>
                        {spell.components?.length > 0 && <span className="text-slate-500">Components <span className="text-slate-300">{spell.components.join(', ')}</span></span>}
                      </div>
                      {(spell.savingThrow || spell.damageType) && (
                        <p className="text-[11px] text-slate-300">
                          {spell.savingThrow && <><span className="text-slate-500">Save </span>DC {spellSaveDC} {spell.savingThrow.toUpperCase()}</>}
                          {spell.savingThrow && spell.damageType && '  ·  '}
                          {spell.damageType && <><span className="text-slate-500">Damage </span>{spell.damageType}</>}
                        </p>
                      )}
                      <p className="text-slate-300 leading-relaxed">{spell.description}</p>
                      {spell.atHigherLevels && (
                        <p className="text-slate-400 italic border-t border-slate-700/50 pt-1.5">
                          <span className="not-italic text-slate-500">At higher levels: </span>{spell.atHigherLevels}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {/* Spell stats footer */}
              {(spellAttackBonus !== 0 || spellSaveDC !== 0) && (
                <div className="flex gap-4 pt-2 mt-1 border-t border-slate-700/50">
                  {spellAttackBonus !== 0 && (
                    <p className="text-[10px] text-slate-400">Spell Attack <span className="text-white font-bold">{spellAttackBonus >= 0 ? '+' : ''}{spellAttackBonus}</span></p>
                  )}
                  {spellSaveDC !== 0 && (
                    <p className="text-[10px] text-slate-400">Save DC <span className="text-white font-bold">{spellSaveDC}</span></p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Class Abilities ── */}
      {hasAbilities && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionToggle
            label="Class Abilities"
            open={abilitiesOpen}
            onToggle={() => setAbilitiesOpen(o => !o)}
            count={classAbilities.length}
          />
          {abilitiesOpen && (
            <div className="mt-3 space-y-px">
              {classAbilities.map((ability, idx) => {
                const key = `ability-${ability.name}-${idx}`;
                return (
                  <div key={key} className="rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleExpand(key)}
                      className="flex items-center gap-2 w-full px-2 py-1.5 hover:bg-slate-700/50 transition-colors text-left"
                    >
                      <span className="text-sm text-white font-medium flex-1 truncate">{ability.name}</span>
                      <span className="text-[10px] text-slate-500 shrink-0">{ability.source}</span>
                      <span className="text-[10px] text-slate-600 shrink-0 w-[28px] text-right">Lv{ability.level}</span>
                      <span className="text-slate-500 text-[10px] shrink-0 ml-1">
                        {expandedKey === key ? '▲' : '▼'}
                      </span>
                    </button>
                    {expandedKey === key && (
                      <div className="px-3 pb-3 pt-1 bg-slate-900/60 border-t border-slate-700/50">
                        <p className="text-[11px] text-slate-400 mb-1.5">{ability.source} · Level {ability.level}</p>
                        <p className="text-xs text-slate-300 leading-relaxed">{ability.description}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Magic Item Abilities ── */}
      {hasItems && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionToggle
            label="Magic Item Abilities"
            open={itemsOpen}
            onToggle={() => setItemsOpen(o => !o)}
            count={magicItems.length}
          />
          {itemsOpen && (
            <div className="mt-3 space-y-px">
              {magicItems.map((item: any) => {
                const key = `item-${item.id}`;
                return (
                  <div key={item.id} className="rounded-lg overflow-hidden">
                    <button
                      onClick={() => toggleExpand(key)}
                      className="flex items-center gap-2 w-full px-2 py-1.5 hover:bg-slate-700/50 transition-colors text-left"
                    >
                      <span className="text-sm text-white font-medium flex-1 truncate">{item.name}</span>
                      {item.maxCharges != null && (
                        <span className="text-[10px] text-amber-300 shrink-0">{item.charges ?? 0}/{item.maxCharges} charges</span>
                      )}
                      <span className="text-slate-500 text-[10px] shrink-0 ml-1">
                        {expandedKey === key ? '▲' : '▼'}
                      </span>
                    </button>
                    {expandedKey === key && (
                      <div className="px-3 pb-3 pt-1 bg-slate-900/60 border-t border-slate-700/50">
                        {item.maxCharges != null && (
                          <p className="text-[11px] text-amber-400 mb-1.5">Charges: {item.charges ?? 0} / {item.maxCharges}</p>
                        )}
                        <p className="text-xs text-slate-300 leading-relaxed">{item.description || '(No description added)'}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// ── Weapon Attacks Panel ────────────────────────────────────────────────────
function WeaponAttacksPanel({ character, mods, profBonus }: { character: any; mods: any; profBonus: number }) {
  const { triggerRoll } = useDiceStore();
  const [damageResults, setDamageResults] = React.useState<Record<string, { result: number; label: string } | null>>({});

  const equippedWeapons = (character.inventory ?? []).filter((item: any) => item.equipped && item.category === 'weapon');
  if (equippedWeapons.length === 0) return null;

  function abilityModForWeapon(w: ReturnType<typeof lookupWeapon>) {
    if (!w) return mods.str;
    if (w.ability === 'finesse') return Math.max(mods.str, mods.dex);
    if (w.ability === 'dex' || w.ranged) return mods.dex;
    return mods.str;
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <SectionHeader>Weapon Attacks</SectionHeader>
      <div className="space-y-2">
        {equippedWeapons.map((item: any) => {
          const w = lookupWeapon(item.name);
          const abilityMod = abilityModForWeapon(w);
          const toHit = abilityMod + profBonus;
          const dmgDice = w?.damageDice ?? '1d6';
          const dmgType = w?.damageType ?? '—';
          const dmgLabel = w ? damageLine(dmgDice, abilityMod) : `?d? + ${abilityMod >= 0 ? '+' : ''}${abilityMod}`;
          const dmgResult = damageResults[item.id];

          return (
            <div key={item.id} className="bg-slate-900/60 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-white">{item.name}</p>
                {w && <span className="text-[10px] text-slate-500 capitalize">{dmgType}</span>}
              </div>
              <div className="flex items-center gap-2">
                {/* Attack roll */}
                <button
                  onClick={() => triggerRoll(20, toHit, `${item.name} Attack`)}
                  className="flex-1 bg-red-900/40 hover:bg-red-800/50 border border-red-700/60 hover:border-red-500 rounded-lg py-1.5 text-center transition-colors group"
                  title={`Roll attack: d20 + ${toHit >= 0 ? '+' : ''}${toHit}`}
                >
                  <p className="text-[10px] text-slate-400 group-hover:text-red-300 transition-colors">Attack</p>
                  <p className="text-sm font-bold text-white">{toHit >= 0 ? '+' : ''}{toHit} 🎲</p>
                </button>
                {/* Damage roll */}
                <button
                  onClick={() => {
                    if (dmgDice === '—') return;
                    const raw = rollDamage(dmgDice);
                    const total = raw + abilityMod;
                    setDamageResults(prev => ({ ...prev, [item.id]: { result: total, label: dmgLabel } }));
                  }}
                  className="flex-1 bg-orange-900/40 hover:bg-orange-800/50 border border-orange-700/60 hover:border-orange-500 rounded-lg py-1.5 text-center transition-colors group"
                  title={`Roll damage: ${dmgLabel}`}
                >
                  <p className="text-[10px] text-slate-400 group-hover:text-orange-300 transition-colors">Damage</p>
                  <p className="text-sm font-bold text-white">
                    {dmgResult ? (
                      <span className="text-orange-300">{dmgResult.result}</span>
                    ) : (
                      <span>{dmgLabel} 🎲</span>
                    )}
                  </p>
                </button>
              </div>
              {/* Versatile option */}
              {w?.versatile && (
                <button
                  onClick={() => {
                    const raw = rollDamage(w.versatile!);
                    const total = raw + abilityMod;
                    setDamageResults(prev => ({ ...prev, [`${item.id}-v`]: { result: total, label: damageLine(w.versatile!, abilityMod) } }));
                  }}
                  className="mt-1.5 w-full text-[10px] text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded py-1 transition-colors"
                >
                  Two-handed: {damageLine(w.versatile, abilityMod)} 🎲
                  {damageResults[`${item.id}-v`] && (
                    <span className="ml-1 text-orange-300 font-bold">→ {damageResults[`${item.id}-v`]!.result}</span>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {equippedWeapons.some((item: any) => !lookupWeapon(item.name)) && (
        <p className="text-[10px] text-slate-600 mt-2">* Unknown weapons use estimated stats. Equip in Inventory tab.</p>
      )}
    </div>
  );
}

function CombatTab({ character, round, setRound, hpPercent, hpInput, hpMode, setHpInput, setHpMode, applyHP,
  setCurrentHP, setTempHP, setMaxHP, addDeathSuccess, addDeathFailure, resetDeathSaves,
  addConditionOpen, setAddConditionOpen, addCondition, removeCondition, setExhaustion,
  resources, setResource, spellSaveDC, spellAttackBonus, slotTotals,
  useSpellSlot, restoreSpellSlot, restoreAllSpellSlots, pactMagic, usePactSlot,
  restorePactSlots, spellSlotsUsed, concentrationSpellId, endConcentration,
  useHitDie, restoreHitDie, effectiveMaxHP, mods, profBonus, resourceMaxOverrides,
  activeEffects, setActiveEffects }: any) {
  const [expandedCondition, setExpandedCondition] = React.useState<string | null>(null);

  return (
    <div className="space-y-4">
      {/* Round counter */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Round</span>
          <span className="text-2xl font-bold text-white tabular-nums">{round}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRound((r: number) => r + 1)}
            className="px-3 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-medium transition-colors flex items-center gap-1.5"
          >
            Next Round →
          </button>
          <button
            onClick={() => { setRound(1); setActiveEffects({}); }}
            className="px-2 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs transition-colors"
            title="Reset round counter and end all active effects"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Weapon Attacks */}
      <WeaponAttacksPanel character={character} mods={mods} profBonus={profBonus} />

      {/* Concentration banner */}
      {concentrationSpellId && (
        <div className="bg-amber-900/30 border border-amber-600 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-amber-400" />
            <span className="text-amber-300 font-medium text-sm">
              Concentrating on: <span className="text-amber-200 font-bold">{getSpell(concentrationSpellId)?.name ?? concentrationSpellId}</span>
            </span>
          </div>
          <button onClick={endConcentration} className="text-xs text-amber-400 hover:text-amber-200 px-2 py-1 rounded border border-amber-700 hover:border-amber-500 transition-colors">
            End
          </button>
        </div>
      )}

      {/* HP Section */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <SectionHeader>Hit Points</SectionHeader>

        {/* HP bar */}
        <div className="mb-4">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-slate-400">Current HP</span>
            <span className="font-bold text-white">
              {character.currentHP} / {effectiveMaxHP}
              {effectiveMaxHP < character.maxHP && (
                <span className="text-red-400 text-xs ml-1">(halved)</span>
              )}
            </span>
          </div>
          <div className="h-4 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                hpPercent > 50 ? 'bg-green-500' : hpPercent > 25 ? 'bg-yellow-500' : 'bg-red-500',
              )}
              style={{ width: `${hpPercent}%` }}
            />
          </div>
          {character.tempHP > 0 && (
            <p className="text-xs text-blue-400 mt-1">+{character.tempHP} temporary HP</p>
          )}
        </div>

        {/* HP controls */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setHpMode('damage')}
            className={cn('flex-1 py-1.5 rounded-lg text-sm font-medium transition-all', hpMode === 'damage' ? 'bg-red-700 text-white' : 'bg-slate-700 text-slate-400 hover:text-white')}
          >
            Damage
          </button>
          <button
            onClick={() => setHpMode('heal')}
            className={cn('flex-1 py-1.5 rounded-lg text-sm font-medium transition-all', hpMode === 'heal' ? 'bg-green-700 text-white' : 'bg-slate-700 text-slate-400 hover:text-white')}
          >
            Heal
          </button>
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            value={hpInput}
            onChange={e => setHpInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyHP()}
            placeholder="Amount..."
            className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-red-500"
          />
          <button
            onClick={applyHP}
            className={cn(
              'px-4 py-2 rounded-lg font-medium text-sm transition-all',
              hpMode === 'damage' ? 'bg-red-700 hover:bg-red-600 text-white' : 'bg-green-700 hover:bg-green-600 text-white',
            )}
          >
            Apply
          </button>
        </div>

        {/* Direct HP edit */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Current</label>
            <input
              type="number"
              value={character.currentHP}
              onChange={e => setCurrentHP(Number(e.target.value))}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm text-center w-full"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Max</label>
            <input
              type="number"
              value={character.maxHP}
              onChange={e => setMaxHP(Number(e.target.value))}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm text-center w-full"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Temp HP</label>
            <input
              type="number"
              min={0}
              value={character.tempHP}
              onChange={e => setTempHP(Number(e.target.value))}
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm text-center w-full"
            />
          </div>
        </div>

        {/* Death saves — only shown at 0 HP */}
        {character.currentHP === 0 && (
          <div className="mt-4 border-t border-red-700 pt-3">
            <div className="flex items-center justify-between mb-2">
              <SectionHeader className="mb-0">Death Saving Throws</SectionHeader>
              <button onClick={resetDeathSaves} className="text-xs text-slate-400 hover:text-white transition-colors">Reset</button>
            </div>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs text-green-400 mb-1">Successes</p>
                <div className="flex gap-2">
                  {[0,1,2].map(i => (
                    <button
                      key={i}
                      onClick={() => i < character.deathSaves.successes ? null : addDeathSuccess()}
                      className={cn('w-8 h-8 rounded-full border-2 transition-all', i < character.deathSaves.successes ? 'border-green-500 bg-green-500' : 'border-slate-500 hover:border-green-600')}
                    />
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-red-400 mb-1 text-right">Failures</p>
                <div className="flex gap-2">
                  {[0,1,2].map(i => (
                    <button
                      key={i}
                      onClick={() => i < character.deathSaves.failures ? null : addDeathFailure()}
                      className={cn('w-8 h-8 rounded-full border-2 transition-all', i < character.deathSaves.failures ? 'border-red-500 bg-red-500' : 'border-slate-500 hover:border-red-600')}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Conditions */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <SectionHeader className="mb-0">Conditions</SectionHeader>
          <button
            onClick={() => setAddConditionOpen(true)}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded border border-slate-600 hover:border-slate-400 transition-colors"
          >
            <Plus size={12} /> Add
          </button>
        </div>
        {/* Exhaustion tracker — always visible */}
        <ExhaustionTracker
          level={character.exhaustionLevel}
          maxHP={character.maxHP}
          speed={character.classes.length ? (getRace(character.raceId)?.speed ?? 30) : 30}
          onChange={lvl => setExhaustion(lvl as any)}
        />
        {character.conditions.length === 0 && character.exhaustionLevel === 0 ? (
          <p className="text-slate-500 text-sm mt-3">No active conditions</p>
        ) : (
          <div className="space-y-1.5 mt-1">
            {character.conditions.map((c: Condition) => (
              <div key={c} className="bg-red-950/40 border border-red-800/60 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-2.5 py-1.5">
                  <button
                    onClick={() => setExpandedCondition(expandedCondition === c ? null : c)}
                    className="text-xs font-semibold text-red-300 hover:text-red-100 transition-colors flex items-center gap-1"
                  >
                    <span>{expandedCondition === c ? '▾' : '▸'}</span> {c}
                  </button>
                  <button
                    onClick={() => { removeCondition(c); if (expandedCondition === c) setExpandedCondition(null); }}
                    className="text-xs text-slate-500 hover:text-red-300 transition-colors px-1"
                    title="Remove condition"
                  >
                    ×
                  </button>
                </div>
                {expandedCondition === c && CONDITION_DESC[c] && (
                  <p className="text-[11px] text-slate-300 leading-relaxed px-2.5 pb-2">{CONDITION_DESC[c]}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add condition dialog */}
        <Dialog open={addConditionOpen} onClose={() => setAddConditionOpen(false)} title="Add Condition">
          <div className="grid grid-cols-2 gap-2">
            {CONDITION_LIST.map(c => (
              <button
                key={c}
                onClick={() => { addCondition(c); setAddConditionOpen(false); }}
                disabled={character.conditions.includes(c)}
                className={cn(
                  'py-2 px-3 rounded-lg text-sm text-left transition-all border',
                  character.conditions.includes(c)
                    ? 'border-red-600 bg-red-900/30 text-red-400 cursor-not-allowed'
                    : 'border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white',
                )}
              >
                {c}
              </button>
            ))}
            <button
              onClick={() => { setExhaustion(Math.min(6, character.exhaustionLevel + 1) as any); setAddConditionOpen(false); }}
              className="py-2 px-3 rounded-lg text-sm text-left border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white transition-all"
            >
              Exhaustion (+1)
            </button>
          </div>
        </Dialog>
      </div>

      {/* Class Resources */}
      {resources.filter((r: any) => r.key !== 'arcane_recovery').length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Class Resources</SectionHeader>
          <div className="space-y-3">
            {resources.filter((r: any) => r.key !== 'arcane_recovery').map((r: any) => {
              const resourceDef = getResourceDef(character, r.key);
              const displayMax = (resourceMaxOverrides?.[r.key] ?? r.max);
              const sustained = SUSTAINED_ABILITIES[r.key];
              const activatedRound: number | undefined = activeEffects[r.key];
              const isActive = activatedRound !== undefined;

              if (sustained && isActive) {
                // ── Active state ─────────────────────────────────────────
                const roundsElapsed = round - activatedRound;
                const expired = sustained.durationRounds !== undefined && roundsElapsed >= sustained.durationRounds;
                const roundsLeft = sustained.durationRounds !== undefined
                  ? Math.max(0, sustained.durationRounds - roundsElapsed)
                  : null;
                const progressPct = sustained.durationRounds !== undefined
                  ? Math.max(0, Math.min(100, (roundsLeft! / sustained.durationRounds) * 100))
                  : null;

                return (
                  <div key={r.key} className={cn('rounded-xl border p-3 transition-all', expired ? 'border-slate-600 bg-slate-900' : `${sustained.border} ${sustained.bg}`)}>
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2">
                        {!expired && <div className={cn('w-2 h-2 rounded-full animate-pulse', sustained.dotBg)} />}
                        <p className={cn('text-sm font-bold', expired ? 'text-slate-400' : sustained.text)}>
                          {expired ? `${resourceDef?.name ?? r.key} — Expired!` : sustained.label}
                        </p>
                      </div>
                      <button
                        onClick={() => setActiveEffects((prev: Record<string, number>) => { const n = { ...prev }; delete n[r.key]; return n; })}
                        className={cn('text-xs px-2 py-1 rounded-lg font-medium transition-colors', expired ? 'bg-slate-700 hover:bg-slate-600 text-slate-300' : 'bg-black/30 hover:bg-black/50 text-white')}
                      >
                        End
                      </button>
                    </div>

                    {/* Countdown bar */}
                    {!expired && sustained.durationRounds !== undefined && (
                      <div className="mb-2">
                        <div className="flex justify-between text-xs mb-1">
                          <span className={sustained.text}>{roundsLeft} round{roundsLeft !== 1 ? 's' : ''} left</span>
                          <span className="text-slate-500">{roundsElapsed} elapsed</span>
                        </div>
                        <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
                          <div
                            className={cn('h-full rounded-full transition-all', sustained.progressBg)}
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </div>
                    )}
                    {!expired && sustained.durationRounds === undefined && (
                      <p className="text-xs text-slate-400 mb-2">No time limit — end manually.</p>
                    )}

                    {/* Counter row */}
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-400">{resourceDef?.name ?? r.key} uses remaining</p>
                      <NumberStepper value={Math.min(r.current, displayMax)} min={0} max={displayMax === 99 ? 999 : displayMax} onChange={v => setResource(r.key, v)} />
                    </div>
                  </div>
                );
              }

              // ── Inactive state ───────────────────────────────────────
              return (
                <div key={r.key} className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">{resourceDef?.name ?? r.key}</p>
                    {resourceDef && <p className="text-xs text-slate-500">Recharges on {resourceDef.rechargeOn} rest</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {sustained && r.current > 0 && (
                      <button
                        onClick={() => {
                          setResource(r.key, r.current - 1);
                          setActiveEffects((prev: Record<string, number>) => ({ ...prev, [r.key]: round }));
                        }}
                        className="text-xs px-2 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white font-medium transition-colors border border-slate-600"
                      >
                        Activate
                      </button>
                    )}
                    <NumberStepper value={Math.min(r.current, displayMax)} min={0} max={displayMax === 99 ? 999 : displayMax} onChange={v => setResource(r.key, v)} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Hit Dice */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <SectionHeader>Hit Dice</SectionHeader>
        <div className="space-y-3">
          {character.classes.map((cl: any) => {
            const def = getClass(cl.classId);
            if (!def) return null;
            const used = character.hitDiceUsed?.[cl.classId] ?? 0;
            const total = cl.level;
            const remaining = total - used;
            return (
              <div key={cl.classId}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-white">
                    {def.name} <span className="text-slate-400 font-normal">d{def.hitDie}</span>
                  </p>
                  <p className="text-xs text-slate-500">{remaining}/{total} remaining</p>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {Array.from({ length: total }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => i < used ? restoreHitDie(cl.classId) : useHitDie(cl.classId)}
                      className={cn(
                        'h-7 px-2 rounded border-2 transition-all text-xs font-bold flex items-center gap-1',
                        i < used
                          ? 'border-slate-600 bg-slate-700 text-slate-600'
                          : 'border-emerald-700 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-800/40',
                      )}
                      title={i < used ? 'Click to restore (long rest gives back half rounded down)' : 'Click to spend on a short rest'}
                    >
                      <Dice5 size={10} />
                      d{def.hitDie}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          <p className="text-[11px] text-slate-500 mt-1">
            Long rest recovers up to half your max hit dice (rounded down, minimum 1) per class.
          </p>
        </div>
      </div>

      {/* Spell slots */}
      {(Object.values(slotTotals).some((v: any) => v > 0) || pactMagic) && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <SectionHeader className="mb-0">Spell Slots</SectionHeader>
            <button
              onClick={restoreAllSpellSlots}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded border border-slate-600 hover:border-slate-400 transition-colors"
            >
              <RefreshCw size={10} /> Restore All
            </button>
          </div>

          {/* Spellcasting stats */}
          {spellSaveDC > 0 && (
            <div className="flex gap-3 mb-3">
              <div className="bg-slate-900 rounded-lg px-3 py-1 text-center">
                <p className="text-xs text-slate-400">Save DC</p>
                <p className="font-bold text-white">{spellSaveDC}</p>
              </div>
              <div className="bg-slate-900 rounded-lg px-3 py-1 text-center">
                <p className="text-xs text-slate-400">Attack</p>
                <p className="font-bold text-white">{spellAttackBonus >= 0 ? '+' : ''}{spellAttackBonus}</p>
              </div>
            </div>
          )}

          {/* Pact magic */}
          {pactMagic && (
            <div className="mb-3">
              <p className="text-xs text-slate-400 mb-1">Pact Magic (Level {pactMagic.slotLevel})</p>
              <div className="flex gap-2">
                {Array.from({ length: pactMagic.slotsTotal }).map((_, i) => (
                  <button
                    key={i}
                    onClick={() => i < pactMagic.slotsUsed ? restorePactSlots() : usePactSlot()}
                    className={cn(
                      'w-10 h-10 rounded-lg border-2 transition-all font-bold text-sm',
                      i < pactMagic.slotsUsed
                        ? 'border-slate-600 bg-slate-700 text-slate-500'
                        : 'border-purple-500 bg-purple-900/30 text-purple-300 hover:bg-purple-800/40',
                    )}
                  >
                    {i < pactMagic.slotsUsed ? '×' : pactMagic.slotLevel}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Regular slots */}
          {([1,2,3,4,5,6,7,8,9] as SlotLevel[]).map(lvl => {
            const total = slotTotals[lvl] ?? 0;
            if (total === 0) return null;
            const used = spellSlotsUsed[lvl] ?? 0;
            const available = total - used;
            return (
              <div key={lvl} className="mb-2">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs text-slate-400">Level {lvl}</p>
                  <p className="text-xs text-slate-500">{available}/{total}</p>
                </div>
                <div className="flex gap-1.5">
                  {Array.from({ length: total }).map((_, i) => (
                    <button
                      key={i}
                      onClick={() => i < used ? restoreSpellSlot(lvl) : useSpellSlot(lvl)}
                      className={cn(
                        'flex-1 h-7 rounded border-2 transition-all text-xs font-bold',
                        i < used
                          ? 'border-slate-600 bg-slate-700 text-slate-600'
                          : 'border-red-600 bg-red-900/20 text-red-300 hover:bg-red-800/30',
                      )}
                      title={i < used ? 'Click to restore slot' : 'Click to use slot'}
                    >
                      {i < used ? '×' : lvl}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Combat Spells & Abilities ── */}
      <CombatAbilitiesPanel
        character={character}
        spellSaveDC={spellSaveDC}
        spellAttackBonus={spellAttackBonus}
      />

    </div>
  );
}


function ArcaneRecoveryDialog({ open, onClose, budget, slotTotals, spellSlotsUsed, onConfirm }: {
  open: boolean;
  onClose: () => void;
  budget: number;
  slotTotals: Record<number, number>;
  spellSlotsUsed: Record<number, number>;
  onConfirm: (recovering: Record<number, number>) => void;
}) {
  const [recovering, setRecovering] = React.useState<Record<number, number>>({});

  React.useEffect(() => { if (open) setRecovering({}); }, [open]);

  const spent = Object.entries(recovering).reduce((s, [lvl, count]) => s + Number(lvl) * count, 0);
  const remaining = budget - spent;

  function adjust(level: number, delta: number) {
    setRecovering(prev => {
      const current = prev[level] ?? 0;
      const newVal = current + delta;
      if (newVal < 0) return prev;
      if (newVal > (spellSlotsUsed[level] ?? 0)) return prev;
      if (delta > 0 && level > remaining) return prev;
      return { ...prev, [level]: newVal };
    });
  }

  const hasAnythingExpired = [1, 2, 3, 4, 5].some(
    lvl => (slotTotals[lvl] ?? 0) > 0 && (spellSlotsUsed[lvl] ?? 0) > 0
  );

  return (
    <Dialog open={open} onClose={onClose} title="Arcane Recovery">
      <p className="text-sm text-slate-400 mb-1">
        Choose expended spell slots to recover. Each slot costs charges equal to its level —
        combined cost must not exceed <span className="text-white font-bold">{budget}</span> charge{budget !== 1 ? 's' : ''}.
        Slots of 6th level or higher cannot be recovered.
      </p>
      <p className="text-xs text-slate-500 mb-4">
        Charges used: <span className={cn('font-bold', spent > 0 ? 'text-white' : 'text-slate-400')}>{spent}/{budget}</span>
      </p>

      <div className="space-y-2 mb-5">
        {[1, 2, 3, 4, 5].map(lvl => {
          const total = slotTotals[lvl] ?? 0;
          const expended = spellSlotsUsed[lvl] ?? 0;
          if (total === 0 || expended === 0) return null;
          const count = recovering[lvl] ?? 0;
          const canAdd = expended > count && remaining >= lvl;
          return (
            <div key={lvl} className="flex items-center justify-between bg-slate-900 rounded-lg p-3">
              <div>
                <p className="text-sm font-medium text-white">Level {lvl} slot</p>
                <p className="text-xs text-slate-500">{expended} expended · costs {lvl} charge{lvl !== 1 ? 's' : ''}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => adjust(lvl, -1)}
                  disabled={count <= 0}
                  className="w-7 h-7 rounded bg-slate-700 text-white font-bold text-sm hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                >−</button>
                <span className="w-6 text-center text-white font-bold text-sm">{count}</span>
                <button
                  onClick={() => adjust(lvl, +1)}
                  disabled={!canAdd}
                  className="w-7 h-7 rounded bg-slate-700 text-white font-bold text-sm hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
                >+</button>
              </div>
            </div>
          );
        })}
        {!hasAnythingExpired && (
          <p className="text-sm text-slate-500 italic py-2">No expended spell slots (levels 1–5) to recover.</p>
        )}
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => { onConfirm(recovering); onClose(); }} disabled={spent === 0}>
          Recover Slots
        </Button>
      </div>
    </Dialog>
  );
}

// ── Exhaustion Tracker ──────────────────────────────────────────────────────

const EXHAUSTION_EFFECTS: Record<number, string[]> = {
  1: ['Disadvantage on all ability checks (skills, tools, etc.)'],
  2: ['Speed halved', 'Disadvantage on ability checks'],
  3: ['Disadvantage on attack rolls', 'Disadvantage on saving throws', 'Disadvantage on ability checks', 'Speed halved'],
  4: ['Hit point maximum halved', 'Disadvantage on attack rolls & saving throws', 'Disadvantage on ability checks', 'Speed halved'],
  5: ['Speed reduced to 0', 'HP maximum halved', 'Disadvantage on attack rolls, saves & checks'],
  6: ['Death'],
};

function ExhaustionTracker({ level, maxHP, speed, onChange }: {
  level: number;
  maxHP: number;
  speed: number;
  onChange: (lvl: number) => void;
}) {
  const [tooltipVisible, setTooltipVisible] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleMouseEnter() {
    timerRef.current = setTimeout(() => setTooltipVisible(true), 1000);
  }
  function handleMouseLeave() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setTooltipVisible(false);
  }

  const effects = level > 0 ? EXHAUSTION_EFFECTS[level] ?? [] : [];
  const effectiveSpeed = level >= 5 ? 0 : level >= 2 ? Math.floor(speed / 2) : speed;
  const effectiveMaxHP = level >= 4 ? Math.floor(maxHP / 2) : maxHP;

  return (
    <div className="relative mb-2" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-400 shrink-0 w-20">Exhaustion</span>
        <div className="flex gap-1">
          {[1,2,3,4,5,6].map(pip => (
            <button
              key={pip}
              onClick={() => onChange(level === pip ? 0 : pip)}
              title={`Set exhaustion to ${pip}`}
              className={cn(
                'w-6 h-6 rounded border text-xs font-bold transition-all',
                pip <= level
                  ? pip === 6
                    ? 'bg-red-700 border-red-500 text-red-100'
                    : pip >= 5
                    ? 'bg-red-900/80 border-red-600 text-red-200'
                    : pip >= 3
                    ? 'bg-orange-800/70 border-orange-600 text-orange-200'
                    : 'bg-orange-900/50 border-orange-700 text-orange-300'
                  : 'bg-slate-800 border-slate-600 text-slate-500 hover:border-slate-400',
              )}
            >
              {pip}
            </button>
          ))}
        </div>
        {level === 0 && <span className="text-xs text-slate-500">None</span>}
        {level > 0 && level < 6 && (
          <span className={cn('text-xs font-medium', level >= 5 ? 'text-red-300' : level >= 3 ? 'text-orange-300' : 'text-orange-400')}>
            Lvl {level}
          </span>
        )}
        {level === 6 && <span className="text-xs font-bold text-red-400 animate-pulse">☠ Dead</span>}
      </div>

      {/* Delayed tooltip */}
      {tooltipVisible && level > 0 && (
        <div className="absolute left-0 top-8 z-50 bg-slate-900 border border-orange-700/60 rounded-xl p-3 shadow-2xl w-72">
          <p className="text-xs font-bold text-orange-300 mb-2">Exhaustion Level {level} — Current Effects</p>
          <ul className="space-y-1">
            {effects.map((e, i) => (
              <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
                <span className="text-orange-500 shrink-0 mt-0.5">•</span>
                <span>{e}</span>
              </li>
            ))}
          </ul>
          {level >= 2 && level < 5 && (
            <p className="text-[11px] text-slate-400 mt-2 border-t border-slate-700 pt-2">
              Speed: {effectiveSpeed} ft (base {speed} ft, halved)
            </p>
          )}
          {level >= 5 && (
            <p className="text-[11px] text-slate-400 mt-2 border-t border-slate-700 pt-2">
              Speed: 0 ft (reduced from {speed} ft)
            </p>
          )}
          {level >= 4 && (
            <p className="text-[11px] text-slate-400 mt-1">
              HP maximum: {effectiveMaxHP} (halved from {maxHP})
            </p>
          )}
          <p className="text-[10px] text-slate-500 mt-2">Click a pip to set level · Click active pip to clear</p>
        </div>
      )}
    </div>
  );
}
