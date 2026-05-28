import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { save as saveDialog, open as openDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readFile, writeFile } from '@tauri-apps/plugin-fs';
import { openPath } from '@tauri-apps/plugin-opener';
import { generateCharacterSheetHTML } from '../../utils/printSheet';
import { fillCharacterPDF } from '../../utils/fillCharacterPDF';
import { ArrowLeft, Moon, Sun, Star, Plus, RefreshCw, Sparkles, ChevronUp, Dice5, Download, History, Camera, Zap, Eye, Printer } from 'lucide-react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useCharacterStore } from '../../store/useCharacterStore';
import { useCharacterDerived } from '../../hooks/useCharacterDerived';
import { Button, Tabs, Dialog, StatBox, SectionHeader, ThemeToggleButton } from '../../components/ui';
import { cn } from '../../utils/cn';
import type { Condition, SlotLevel } from '../../types';
import { SpellPanel } from './SpellPanel';
import { LevelUpDialog } from './LevelUpDialog';
import { TraitsPanel } from './TraitsPanel';
import { InventoryPanel } from './InventoryPanel';
import { DiceRoller } from './DiceRoller';
import { SnapshotPanel } from './SnapshotPanel';
import { RageOverlay } from '../../components/RageOverlay';
import { InspirationOverlay } from '../../components/InspirationOverlay';
import { YouAreDeadOverlay } from '../../components/YouAreDeadOverlay';
import { useSnapshotStore } from '../../store/useSnapshotStore';
import { useThemeStore } from '../../store/useThemeStore';
import { getClass } from '../../data/classes';
import { getSubclass } from '../../data/subclasses';
import { getSpell } from '../../data/spells';
import { useDiceStore } from '../../store/useDiceStore';
import type { RollDie } from '../../store/useDiceStore';
import { lookupWeapon, damageLine } from '../../data/weapons';
import { getRace } from '../../data/races';
import { useSidebarStore, type SidebarModuleId } from '../../store/useSidebarStore';
import { SidebarPanel } from './SidebarPanel';
import { AlternateFormPanel } from '../../components/AlternateFormPanel';
import { WildShapeModal } from '../../components/WildShapeModal';

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
  const { characters, sendToGraveyard } = useLibraryStore();
  const { character, load, save, setCurrentHP, healHP, damageHP, setTempHP, setMaxHP,
    addDeathSuccess, addDeathFailure, resetDeathSaves, addCondition, removeCondition,
    setExhaustion, useSpellSlot, restoreSpellSlot, restoreAllSpellSlots, usePactSlot,
    restorePactSlots, toggleSpellPrepared, startConcentration, endConcentration,
    setResource, shortRest, longRest, toggleInspiration, setNotes, addSpellToBook,
    removeSpellFromBook, addInventoryItem, removeInventoryItem, setInventoryQuantity,
    toggleInventoryEquipped, renameInventoryItem, setInventoryDescription, setItemCharges, useItemCharge, levelUp, useHitDie, restoreHitDie, setPortrait, updateCurrency, useInnateSpell,
    activateWildShape, deactivateWildShape, damageWildShape, healWildShape, setArmorerMode, setPathOfBeastForm } = useCharacterStore();

  const [tab, setTab] = React.useState('combat');
  const [round, setRound] = React.useState(1);
  const [activeEffects, setActiveEffects] = React.useState<Record<string, number>>({}); // key → round when activated
  const [showRageOverlay, setShowRageOverlay] = React.useState(false);
  const [showDeadOverlay, setShowDeadOverlay] = React.useState(false);
  const prevDeathFailures = React.useRef<number | null>(null);
  const [hpInput, setHpInput] = React.useState('');
  const [hpMode, setHpMode] = React.useState<'heal'|'damage'>('damage');
  const [addConditionOpen, setAddConditionOpen] = React.useState(false);
  const [restConfirm, setRestConfirm] = React.useState<'short'|'long'|null>(null);
  const [arcaneOpen, setArcaneOpen] = React.useState(false);
  const [levelUpOpen, setLevelUpOpen] = React.useState(false);
  const [snapshotOpen, setSnapshotOpen] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [wildShapeModalOpen, setWildShapeModalOpen] = React.useState(false);
  const portraitInputRef = React.useRef<HTMLInputElement>(null);

  const { saveSnapshot } = useSnapshotStore();
  const { theme, toggleTheme } = useThemeStore();
  const { sidebarOpen, setSidebarOpen } = useSidebarStore();

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

  const isRaging = 'rage' in activeEffects;

  // data-raging drives the full-screen page tint + global card glows — only
  // active while the overlay is showing. After "End Effect" the overlay is gone
  // so the page returns to normal; only the class resources card stays red (via isRaging).
  React.useEffect(() => {
    if (showRageOverlay) {
      document.documentElement.setAttribute('data-raging', '');
    } else {
      document.documentElement.removeAttribute('data-raging');
    }
    return () => document.documentElement.removeAttribute('data-raging');
  }, [showRageOverlay]);

  // Trigger "YOU ARE DEAD" overlay only when the 3rd failure is actually clicked
  // (not on initial load when failures may already be 3).
  React.useEffect(() => {
    if (!character) return;
    const curr = character.deathSaves.failures;
    if (prevDeathFailures.current !== null && prevDeathFailures.current < 3 && curr === 3) {
      setShowDeadOverlay(true);
    }
    prevDeathFailures.current = curr;
  }, [character?.deathSaves?.failures]);

  const derived = useCharacterDerived(character);
  const { triggerRoll } = useDiceStore();

  if (!character || !derived) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</div>;
  }

  const { finalScores, mods, profBonus, ac, initiative, speed, baseSpeed, savingThrows, savingThrowProficiencies, skills, allSkillProficiencies, passivePerception, passiveInsight, spellSaveDC, spellAttackBonus, slotTotals, totalLevel, exhaustionLevel, exhaustionDisadvChecks, exhaustionDisadvSaves, resourceMaxOverrides } = derived;

  const race = getRace(character.raceId);
  const primaryClass = character.classes[0];
  const classDef = primaryClass ? getClass(primaryClass.classId) : null;

  // ── Alternate form flags ─────────────────────────────────────────────────────
  const druidEntry = character.classes.find(cl => cl.classId === 'druid');
  const isDruid = !!druidEntry;
  const druidLevel = druidEntry?.level ?? 0;
  const isMoonDruid = druidEntry?.subclassId === 'circle-of-the-moon';
  const isPathOfBeast = character.classes.some(cl => cl.classId === 'barbarian' && cl.subclassId === 'path-of-the-beast');
  const isArmorer = character.classes.some(cl => cl.classId === 'artificer' && cl.subclassId === 'armorer');
  const hasAlternateForm = isDruid || isPathOfBeast || isArmorer;

  // At exhaustion 4 the HP maximum is halved (PHB p. 291)
  const effectiveMaxHP = (character.exhaustionLevel ?? 0) >= 4
    ? Math.floor(character.maxHP / 2)
    : character.maxHP;
  const hpPercent = Math.min(100, Math.round((character.currentHP / effectiveMaxHP) * 100));

  function applyHP(mode?: 'heal' | 'damage') {
    const amount = parseInt(hpInput);
    if (isNaN(amount) || amount <= 0) return;
    const m = mode ?? hpMode;
    if (m === 'heal') healHP(amount); else damageHP(amount);
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
      {/* Full-screen rage overlay — shows while overlay is active; "End Effect" only
          dismisses the visual. Rage itself ends via "End Rage" in Class Resources. */}
      {showRageOverlay && (
        <RageOverlay onEnd={() => setShowRageOverlay(false)} />
      )}
      {/* Inspiration overlay — subtle golden sparkle every ~20s while inspired */}
      {character.inspiration && <InspirationOverlay />}
      {/* Death overlay — Dark Souls style when 3 death save failures are reached */}
      {showDeadOverlay && (
        <YouAreDeadOverlay
          onDismiss={() => setShowDeadOverlay(false)}
          onSendToGraveyard={character.inGraveyard ? undefined : () => {
            sendToGraveyard(character.id);
            navigate('/');
          }}
        />
      )}
      {/* Floating d20 quick-launch button */}
      <DiceFAB />
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
              Level {totalLevel} {race?.name ?? ''}{' '}
              {character.classes.length > 1
                ? character.classes.map(cl => {
                    const d = getClass(cl.classId);
                    return `${d?.name ?? cl.classId} ${cl.level}`;
                  }).join(' / ')
                : classDef?.name ?? ''}{' '}
              · {character.alignment}
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
              // Try PDF first — ask user to select the WotC template
              const templatePath = await openDialog({
                title: 'Select D&D 5E Character Sheet PDF template',
                filters: [{ name: 'PDF', extensions: ['pdf'] }],
                multiple: false,
                directory: false,
              });
              if (templatePath && typeof templatePath === 'string') {
                // Fill the official PDF form
                try {
                  const templateBytes = await readFile(templatePath);
                  const filled = await fillCharacterPDF(character, templateBytes);
                  const outPath = await saveDialog({
                    defaultPath: `${character.name || 'character'}-sheet.pdf`,
                    filters: [{ name: 'PDF', extensions: ['pdf'] }],
                  });
                  if (outPath) {
                    await writeFile(outPath, filled);
                    await openPath(outPath);
                  }
                } catch (err) {
                  // Fall back to HTML if PDF filling fails
                  console.error('PDF fill failed, falling back to HTML:', err);
                  const html = generateCharacterSheetHTML(character, {
                    finalScores: finalScores as unknown as Record<string, number>,
                    mods: mods as unknown as Record<string, number>,
                    profBonus, ac, initiative, speed,
                    savingThrows: savingThrows as unknown as Record<string, number>,
                    savingThrowProficiencies, skills, allSkillProficiencies,
                    passivePerception, spellSaveDC, spellAttackBonus, slotTotals, totalLevel,
                  });
                  const path = await saveDialog({
                    defaultPath: `${character.name || 'character'}-sheet.html`,
                    filters: [{ name: 'HTML', extensions: ['html'] }],
                  });
                  if (path) { await writeTextFile(path, html); await openPath(path); }
                }
              } else if (templatePath === null) {
                // User cancelled — fall back to HTML
                const html = generateCharacterSheetHTML(character, {
                  finalScores: finalScores as unknown as Record<string, number>,
                  mods: mods as unknown as Record<string, number>,
                  profBonus, ac, initiative, speed,
                  savingThrows: savingThrows as unknown as Record<string, number>,
                  savingThrowProficiencies, skills, allSkillProficiencies,
                  passivePerception, spellSaveDC, spellAttackBonus, slotTotals, totalLevel,
                });
                const path = await saveDialog({
                  defaultPath: `${character.name || 'character'}-sheet.html`,
                  filters: [{ name: 'HTML', extensions: ['html'] }],
                });
                if (path) { await writeTextFile(path, html); await openPath(path); }
              }
            }}
            className="p-1.5 rounded text-slate-500 hover:text-emerald-400 transition-colors"
            title="Print character sheet — select WotC PDF template to fill, or cancel for HTML"
          >
            <Printer size={18} />
          </button>
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
            title="Export character data (JSON)"
          >
            <Download size={18} />
          </button>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={cn(
              'p-1.5 rounded transition-colors',
              sidebarOpen ? 'text-sky-400 hover:text-sky-300' : 'text-slate-500 hover:text-sky-400',
            )}
            title={sidebarOpen ? 'Close sidebar' : 'Open customizable sidebar'}
          >
            <Eye size={18} />
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
                    onClick={() => triggerRoll(20, val, `${abilityLabels[k]} Save`, exhaustionDisadvSaves ? 'disadvantage' : undefined)}
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
                    onClick={() => triggerRoll(20, bonus, `${skill} Check`, exhaustionDisadvChecks ? 'disadvantage' : undefined)}
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

        {/* Main content — shrinks when sidebar is open */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 min-w-0">
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
                startConcentration={startConcentration}
                endConcentration={endConcentration}
                useHitDie={useHitDie}
                restoreHitDie={restoreHitDie}
                effectiveMaxHP={effectiveMaxHP}
                mods={mods}
                profBonus={profBonus}
                resourceMaxOverrides={resourceMaxOverrides}
                activeEffects={activeEffects}
                setActiveEffects={setActiveEffects}
                isRaging={isRaging}
                showRageOverlay={showRageOverlay}
                setShowRageOverlay={setShowRageOverlay}
                sendToGraveyard={sendToGraveyard}
                navigate={navigate}
                useItemCharge={useItemCharge}
                hasAlternateForm={hasAlternateForm}
                isDruid={isDruid}
                druidLevel={druidLevel}
                isMoonDruid={isMoonDruid}
                isPathOfBeast={isPathOfBeast}
                isArmorer={isArmorer}
                onOpenWildShapeModal={() => setWildShapeModalOpen(true)}
                deactivateWildShape={deactivateWildShape}
                damageWildShape={damageWildShape}
                healWildShape={healWildShape}
                setPathOfBeastForm={setPathOfBeastForm}
                setArmorerMode={setArmorerMode}
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
                useInnateSpell={useInnateSpell}
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
                updateCurrency={updateCurrency}
              />
            )}
            {tab === 'character' && (
              <TraitsPanel character={character} setNotes={setNotes} />
            )}
          </div>
        </div>

        {/* Right customizable sidebar */}
        {sidebarOpen && <SidebarPanel />}
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
            ? 'Taking a long rest will restore HP, spell slots, and class resources. Exhaustion is reduced by 1. Conditions are not cleared by rest.'
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

      {/* Wild Shape form picker */}
      <WildShapeModal
        open={wildShapeModalOpen}
        onClose={() => setWildShapeModalOpen(false)}
        druidLevel={druidLevel}
        isMoon={isMoonDruid}
        onActivate={(form) => {
          activateWildShape(form);
          // Consume one wild_shape use
          const wsRes = character.resources.find((r: any) => r.key === 'wild_shape');
          if (wsRes && wsRes.current > 0) setResource('wild_shape', wsRes.current - 1);
        }}
      />

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

// ── Sidebar pin button ───────────────────────────────────────────────────────
// Eyeball icon that toggles whether a module is pinned to the right sidebar.
// Rendered sky-blue when pinned, slate-grey when not. Lives in module headers.

function PinButton({ moduleId }: { moduleId: SidebarModuleId }) {
  const { isPinned, togglePin } = useSidebarStore();
  const pinned = isPinned(moduleId);
  return (
    <button
      onClick={() => togglePin(moduleId)}
      title={pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
      className={cn(
        'p-1 rounded transition-colors shrink-0',
        pinned ? 'text-sky-400 hover:text-sky-300' : 'text-slate-600 hover:text-slate-400',
      )}
    >
      <Eye size={13} />
    </button>
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

function CombatAbilitiesPanel({ character, spellSaveDC, spellAttackBonus,
  slotTotals, spellSlotsUsed, pactMagic, useSpellSlot, usePactSlot,
  startConcentration, useItemCharge,
}: {
  character: any;
  spellSaveDC: number;
  spellAttackBonus: number;
  slotTotals: Record<number, number>;
  spellSlotsUsed: Record<number, number>;
  pactMagic: any;
  useSpellSlot: (level: SlotLevel) => void;
  usePactSlot: () => void;
  startConcentration: (id: string) => void;
  useItemCharge: (itemId: string) => void;
}) {
  const [spellsOpen,     setSpellsOpen]     = React.useState(true);
  const [abilitiesOpen,  setAbilitiesOpen]  = React.useState(true);
  const [itemsOpen,      setItemsOpen]      = React.useState(true);
  const [expandedKey,    setExpandedKey]    = React.useState<string | null>(null);
  const [castSpell,      setCastSpell]      = React.useState<ReturnType<typeof getSpell> | null>(null);

  function toggleExpand(key: string) {
    setExpandedKey(prev => prev === key ? null : key);
  }

  const primaryClassId  = character.classes[0]?.classId ?? '';
  const isPreparedCaster = PREPARED_CASTER_IDS.includes(primaryClassId);

  const totalSlots = Object.values(slotTotals ?? {}).reduce((s: number, n) => s + (n as number), 0);
  const hasAnyCastingResource = totalSlots > 0 || (pactMagic && pactMagic.slotsTotal > 0);

  function canCast(spell: NonNullable<ReturnType<typeof getSpell>>, alwaysPrepared: boolean): boolean {
    if (spell.level === 0) return true;
    if (!hasAnyCastingResource) return false;
    if (!isPreparedCaster) return true;
    return alwaysPrepared || (character.spellbook ?? []).some((sp: any) => sp.spellId === spell.id && sp.isPrepared);
  }

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
  // Only show equipped magic items. Unequipped items leave the panel automatically.
  const magicItems = (character.inventory ?? []).filter(
    (item: any) => item.category === 'magic' && item.equipped && (item.description || item.maxCharges != null),
  );

  const hasSpells    = combatSpells.length > 0;
  const hasAbilities = classAbilities.length > 0;
  const hasItems     = magicItems.length > 0;
  if (!hasSpells && !hasAbilities && !hasItems) return null;

  return (
    <div className="space-y-3">

      {/* Panel-level pin button */}
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] text-slate-600 uppercase tracking-wide">Combat Abilities</span>
        <PinButton moduleId="combat-abilities" />
      </div>

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
                        {canCast(spell, alwaysPrepared) && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              if (spell.level === 0) {
                                if (spell.concentration && character.concentrationSpellId !== spell.id)
                                  startConcentration(spell.id);
                                return;
                              }
                              setCastSpell(spell);
                            }}
                            className="ml-auto flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-red-700 bg-red-900/30 text-red-300 hover:bg-red-800/50 transition-all"
                            title="Cast spell"
                          >
                            <Zap size={10} />
                            Cast
                          </button>
                        )}
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

      {/* ── Cast slot picker ── */}
      <Dialog open={!!castSpell} onClose={() => setCastSpell(null)} title={castSpell ? `Cast ${castSpell.name}` : ''}>
        {castSpell && (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">
              Choose a spell slot. Base level is {castSpell.level === 0 ? 'cantrip' : `L${castSpell.level}`}.
              {castSpell.atHigherLevels && <span className="block mt-1 text-xs text-slate-500 italic">Upcasting: {castSpell.atHigherLevels}</span>}
            </p>
            {castSpell.concentration && character.concentrationSpellId && character.concentrationSpellId !== castSpell.id && (() => {
              const current = getSpell(character.concentrationSpellId);
              return (
                <div className="text-xs text-amber-300 bg-amber-950/40 border border-amber-700/40 rounded-lg px-3 py-2">
                  ⚠ You are concentrating on <span className="font-bold">{current?.name ?? 'another spell'}</span>. Casting this will break that concentration.
                </div>
              );
            })()}
            {pactMagic && pactMagic.slotLevel >= castSpell.level && pactMagic.slotsUsed < pactMagic.slotsTotal && (
              <button
                className="w-full text-left p-3 rounded-lg border-2 border-purple-500/50 bg-purple-950/30 hover:bg-purple-900/40 transition-all"
                onClick={() => { usePactSlot(); if (castSpell.concentration) startConcentration(castSpell.id); setCastSpell(null); }}
              >
                <p className="text-sm font-bold text-purple-300">Pact Magic Slot (L{pactMagic.slotLevel})</p>
                <p className="text-xs text-slate-400">{pactMagic.slotsTotal - pactMagic.slotsUsed}/{pactMagic.slotsTotal} pact slots remaining</p>
              </button>
            )}
            <div className="grid gap-2">
              {([1,2,3,4,5,6,7,8,9] as SlotLevel[])
                .filter(lvl => lvl >= castSpell.level)
                .map(lvl => {
                  const total = slotTotals[lvl] ?? 0;
                  if (total === 0) return null;
                  const used = spellSlotsUsed[lvl] ?? 0;
                  const avail = total - used;
                  const disabled = avail <= 0;
                  return (
                    <button
                      key={lvl}
                      disabled={disabled}
                      onClick={() => { useSpellSlot(lvl); if (castSpell.concentration) startConcentration(castSpell.id); setCastSpell(null); }}
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
                      <p className="text-xs text-slate-400">{avail}/{total} remaining</p>
                    </button>
                  );
                })}
            </div>
            {([1,2,3,4,5,6,7,8,9] as SlotLevel[])
              .filter(lvl => lvl >= castSpell.level)
              .every(lvl => (slotTotals[lvl] ?? 0) === 0) &&
              !(pactMagic && pactMagic.slotLevel >= castSpell.level) && (
                <p className="text-sm text-amber-400 italic">No slots available at this level or higher.</p>
              )}
          </div>
        )}
      </Dialog>

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
                const hasCharges = item.maxCharges != null;
                const currentCharges = item.charges ?? item.maxCharges ?? 0;
                const isSpent = hasCharges && currentCharges <= 0;
                const rechargeLabel = item.recharge === 'dawn' ? 'Restores at dawn'
                  : item.recharge === 'long' ? 'Restores on long rest'
                  : item.recharge === 'short' ? 'Restores on short rest'
                  : null;
                return (
                  <div key={item.id} className="rounded-lg overflow-hidden">
                    {/* Summary row */}
                    <div className="flex items-center gap-2 w-full px-2 py-1.5">
                      <button
                        onClick={() => toggleExpand(key)}
                        className="flex items-center gap-2 flex-1 min-w-0 text-left hover:opacity-80 transition-opacity"
                      >
                        <span className={cn('text-sm font-medium flex-1 truncate', isSpent ? 'text-slate-500' : 'text-white')}>{item.name}</span>
                        {hasCharges && (
                          <span className={cn('text-[10px] shrink-0', isSpent ? 'text-slate-600' : 'text-amber-300')}>
                            {currentCharges}/{item.maxCharges}
                          </span>
                        )}
                        <span className="text-slate-500 text-[10px] shrink-0">
                          {expandedKey === key ? '▲' : '▼'}
                        </span>
                      </button>
                      {hasCharges && (
                        <button
                          disabled={isSpent}
                          onClick={() => useItemCharge(item.id)}
                          className={cn(
                            'shrink-0 text-[11px] px-2 py-0.5 rounded border transition-all',
                            isSpent
                              ? 'border-slate-700 bg-slate-800 text-slate-600 cursor-not-allowed'
                              : 'border-amber-700 bg-amber-900/30 text-amber-300 hover:bg-amber-800/50',
                          )}
                        >
                          {isSpent ? 'Spent' : 'Use'}
                        </button>
                      )}
                    </div>
                    {/* Expanded detail */}
                    {expandedKey === key && (
                      <div className="px-3 pb-3 pt-1 bg-slate-900/60 border-t border-slate-700/50">
                        {hasCharges && (
                          <div className="flex items-center gap-2 mb-2">
                            {/* Pip display for ≤ 12 charges, numeric for larger */}
                            {item.maxCharges <= 12 ? (
                              <div className="flex gap-0.5 flex-wrap">
                                {Array.from({ length: item.maxCharges as number }).map((_: unknown, i: number) => (
                                  <div
                                    key={i}
                                    className={cn('w-2.5 h-2.5 rounded-full border', i < currentCharges ? 'bg-amber-400 border-amber-300' : 'bg-slate-700 border-slate-600')}
                                  />
                                ))}
                              </div>
                            ) : (
                              <span className="text-[11px] text-amber-400">{currentCharges} / {item.maxCharges} charges</span>
                            )}
                            {rechargeLabel && (
                              <span className="text-[10px] text-slate-500 ml-auto">{rechargeLabel}</span>
                            )}
                          </div>
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
const VALID_DAMAGE_DICE: RollDie[] = [4, 6, 8, 10, 12, 20, 100];
/** Extract the die type from a weapon damage string, e.g. "1d8" → 8, "2d6" → 6. */
function parseDamageDie(dice: string): RollDie | null {
  if (!dice || dice === '—' || !dice.includes('d')) return null;
  const sides = parseInt(dice.split('d')[1], 10);
  return VALID_DAMAGE_DICE.includes(sides as RollDie) ? (sides as RollDie) : null;
}

function WeaponAttacksPanel({ character, mods, profBonus }: { character: any; mods: any; profBonus: number }) {
  const { triggerRoll } = useDiceStore();

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
      <div className="flex items-center justify-between mb-2">
        <SectionHeader className="mb-0">Weapon Attacks</SectionHeader>
        <PinButton moduleId="weapon-attacks" />
      </div>
      <div className="space-y-2">
        {equippedWeapons.map((item: any) => {
          const w = lookupWeapon(item.name);
          const abilityMod = abilityModForWeapon(w);
          const toHit = abilityMod + profBonus;
          const dmgDice = w?.damageDice ?? '1d6';
          const dmgType = w?.damageType ?? '—';
          const dmgLabel = w ? damageLine(dmgDice, abilityMod) : `?d? + ${abilityMod >= 0 ? '+' : ''}${abilityMod}`;
          const dmgDie = parseDamageDie(dmgDice);

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
                {/* Damage roll — opens the dice window */}
                <button
                  onClick={() => {
                    if (!dmgDie || dmgDice === '—') return;
                    triggerRoll(dmgDie, abilityMod, `${item.name} Damage`);
                  }}
                  disabled={!dmgDie || dmgDice === '—'}
                  className="flex-1 bg-orange-900/40 hover:bg-orange-800/50 border border-orange-700/60 hover:border-orange-500 rounded-lg py-1.5 text-center transition-colors group disabled:opacity-40 disabled:cursor-not-allowed"
                  title={`Roll damage: ${dmgLabel}`}
                >
                  <p className="text-[10px] text-slate-400 group-hover:text-orange-300 transition-colors">Damage</p>
                  <p className="text-sm font-bold text-white">{dmgLabel} 🎲</p>
                </button>
              </div>
              {/* Versatile option */}
              {w?.versatile && (
                <button
                  onClick={() => {
                    const vDie = parseDamageDie(w.versatile!);
                    if (vDie) triggerRoll(vDie, abilityMod, `${item.name} (Two-Handed) Damage`);
                  }}
                  className="mt-1.5 w-full text-[10px] text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded py-1 transition-colors"
                >
                  Two-handed: {damageLine(w.versatile, abilityMod)} 🎲
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

function CombatTab({ character, round, setRound, hpPercent, hpInput, setHpInput, applyHP,
  setCurrentHP, setTempHP, setMaxHP, addDeathSuccess, addDeathFailure, resetDeathSaves,
  addConditionOpen, setAddConditionOpen, addCondition, removeCondition, setExhaustion,
  resources, setResource, spellSaveDC, spellAttackBonus, slotTotals,
  useSpellSlot, restoreSpellSlot, restoreAllSpellSlots, pactMagic, usePactSlot,
  restorePactSlots, spellSlotsUsed, concentrationSpellId, startConcentration, endConcentration,
  useHitDie, restoreHitDie, effectiveMaxHP, mods, profBonus, resourceMaxOverrides,
  activeEffects, setActiveEffects, isRaging, setShowRageOverlay,
  sendToGraveyard, navigate, useItemCharge,
  hasAlternateForm, isDruid, druidLevel, isPathOfBeast, isArmorer,
  onOpenWildShapeModal, deactivateWildShape, damageWildShape, healWildShape,
  setPathOfBeastForm, setArmorerMode }: any) {
  const [expandedCondition, setExpandedCondition] = React.useState<string | null>(null);

  // ── Death-save die ──────────────────────────────────────────────────────
  const { triggerRoll: dsTrigger, lastResult } = useDiceStore();
  const seenDeathNonce = React.useRef<number>(-1);

  React.useEffect(() => {
    if (!lastResult) return;
    if (lastResult.label !== 'Death Save') return;
    if (lastResult.nonce === seenDeathNonce.current) return;
    seenDeathNonce.current = lastResult.nonce;

    const v = lastResult.value;
    if (v === 20) {
      // Natural 20: immediately stabilise — regain 1 HP and clear saves
      setCurrentHP(1);
      resetDeathSaves();
    } else if (v >= 10) {
      addDeathSuccess();
    } else if (v === 1) {
      // Natural 1: two failures
      addDeathFailure();
      addDeathFailure();
    } else {
      addDeathFailure();
    }
  }, [lastResult]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      {/* Round counter */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 uppercase tracking-wide font-semibold">Round</span>
          <span className="text-2xl font-bold text-white tabular-nums">{round}</span>
          <span className="text-sm text-slate-400 tabular-nums">
            {(() => { const s = round * 6; return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; })()}
          </span>
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

      {/* Alternate Forms (Wild Shape / Path of the Beast / Armorer) */}
      {hasAlternateForm && (
        <AlternateFormPanel
          character={character}
          isDruid={isDruid}
          druidLevel={druidLevel}
          isPathOfBeast={isPathOfBeast}
          isArmorer={isArmorer}
          onOpenWildShapeModal={onOpenWildShapeModal}
          deactivateWildShape={deactivateWildShape}
          damageWildShape={damageWildShape}
          healWildShape={healWildShape}
          isRaging={isRaging}
          setPathOfBeastForm={setPathOfBeastForm}
          setArmorerMode={setArmorerMode}
          mods={mods}
          profBonus={profBonus}
        />
      )}

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
        <div className="flex items-center justify-between mb-2">
          <SectionHeader className="mb-0">Hit Points</SectionHeader>
          <PinButton moduleId="hp" />
        </div>

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

        {/* HP controls — type amount, then click Damage or Heal */}
        <div className="mb-2">
          <input
            type="number"
            min={1}
            value={hpInput}
            onChange={e => setHpInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyHP('damage')}
            placeholder="Amount..."
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-slate-400"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => applyHP('damage')}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-red-700 hover:bg-red-600 text-white transition-all"
          >
            Damage
          </button>
          <button
            onClick={() => applyHP('heal')}
            className="flex-1 py-2 rounded-lg text-sm font-medium bg-green-700 hover:bg-green-600 text-white transition-all"
          >
            Heal
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
            <div className="flex items-center justify-between mb-3">
              <SectionHeader className="mb-0">Death Saving Throws</SectionHeader>
              <button onClick={resetDeathSaves} className="text-xs text-slate-400 hover:text-white transition-colors">Reset</button>
            </div>

            {/* Skull die — click to roll death save d20 */}
            <div className="flex flex-col items-center mb-3">
              <button
                onClick={() => dsTrigger(20, 0, 'Death Save')}
                title="Roll Death Save (d20)"
                className="group transition-all duration-150 active:scale-90 hover:scale-110 hover:-translate-y-0.5"
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
              >
                <svg viewBox="0 0 100 100" width="54" height="54" style={{ overflow: 'visible' }} xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <filter id="ds-drop" x="-35%" y="-30%" width="170%" height="175%">
                      <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#dc2626" floodOpacity="0.7" />
                    </filter>
                    <filter id="ds-bloom" x="-60%" y="-60%" width="220%" height="220%">
                      <feGaussianBlur in="SourceGraphic" stdDeviation="1.6" result="blur" />
                      <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                    </filter>
                    {/* Hover glow — stronger red */}
                    <filter id="ds-hover" x="-40%" y="-35%" width="180%" height="180%">
                      <feDropShadow dx="0" dy="0" stdDeviation="7" floodColor="#ef4444" floodOpacity="0.9" />
                    </filter>
                  </defs>

                  {/* Die body */}
                  <polygon points="50,4 83,18 96,50 83,82 50,96 17,82 4,50 17,18"
                    fill="#1a0505" className="group-hover:fill-[#2d0808] transition-all" />

                  {/* Outer rim with red glow */}
                  <polygon points="50,4 83,18 96,50 83,82 50,96 17,82 4,50 17,18"
                    fill="none" stroke="#991b1b" strokeWidth="2.8" strokeLinejoin="round"
                    filter="url(#ds-drop)"
                    className="group-hover:stroke-[#dc2626] transition-all" />

                  {/* Inner "20" face triangle */}
                  <polygon points="50,15 22,60 78,60"
                    fill="none" stroke="#7f1d1d" strokeWidth="1.5" strokeLinejoin="round"
                    className="group-hover:stroke-[#b91c1c] transition-all" />

                  {/* Facet spokes */}
                  {([
                    [50,15,50,4],[50,15,17,18],[50,15,83,18],
                    [22,60,17,18],[22,60,4,50],[22,60,17,82],[22,60,50,96],
                    [78,60,83,18],[78,60,96,50],[78,60,83,82],[78,60,50,96],
                  ] as [number,number,number,number][]).map(([x1,y1,x2,y2],i) => (
                    <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                      stroke="#7f1d1d" strokeWidth="1" opacity="0.55"
                      className="group-hover:stroke-[#b91c1c] transition-all" />
                  ))}

                  {/* ☠ skull — centred in the "20" face, with bloom */}
                  <text
                    x="50" y="52"
                    textAnchor="middle"
                    fontSize="26"
                    fill="#e8d5b5"
                    filter="url(#ds-bloom)"
                    className="group-hover:fill-white transition-all select-none"
                    style={{ userSelect: 'none' }}
                  >☠</text>

                  {/* Crisp rim on top */}
                  <polygon points="50,4 83,18 96,50 83,82 50,96 17,82 4,50 17,18"
                    fill="none" stroke="#991b1b" strokeWidth="2.2" strokeLinejoin="round" opacity="0.85"
                    className="group-hover:stroke-[#dc2626] transition-all" />
                </svg>
              </button>
              <p className="text-[10px] text-red-400/70 mt-1 tracking-wide uppercase select-none">Roll Death Save</p>
            </div>

            {/* Success / failure checkboxes */}
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

            {/* Send to graveyard — only when all 3 failures are set and not already buried */}
            {character.deathSaves.failures === 3 && !character.inGraveyard && (
              <button
                onClick={() => { sendToGraveyard(character.id); navigate('/'); }}
                className="mt-4 w-full text-xs text-red-300/70 hover:text-red-200 border border-red-900/50 hover:border-red-700 rounded-lg py-2 transition-colors tracking-widest uppercase"
              >
                ⚰ Send to Graveyard
              </button>
            )}
          </div>
        )}
      </div>

      {/* Conditions */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <SectionHeader className="mb-0">Conditions</SectionHeader>
          <div className="flex items-center gap-1">
            <PinButton moduleId="conditions" />
            <button
              onClick={() => setAddConditionOpen(true)}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded border border-slate-600 hover:border-slate-400 transition-colors"
            >
              <Plus size={12} /> Add
            </button>
          </div>
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
        <div className={cn(
          'border rounded-xl p-4 transition-all duration-500',
          isRaging
            ? 'bg-red-950/50 border-red-700/70 shadow-[0_0_22px_rgba(200,0,0,0.45),0_0_55px_rgba(140,0,0,0.2)]'
            : 'bg-slate-800 border-slate-700',
        )}>
          <div className="flex items-center justify-between mb-2">
            <SectionHeader className="mb-0">Class Resources</SectionHeader>
            <PinButton moduleId="class-resources" />
          </div>
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
                        onClick={() => {
                          const wasFrenzying = r.key === 'rage' && 'frenzy' in activeEffects;
                          setActiveEffects((prev: Record<string, number>) => { const n = { ...prev }; delete n[r.key]; if (r.key === 'rage') delete n['frenzy']; return n; });
                          if (r.key === 'rage') {
                            setShowRageOverlay(false);
                            if (wasFrenzying) setExhaustion(Math.min(6, (character.exhaustionLevel ?? 0) + 1) as any);
                          }
                        }}
                        className={cn(
                          'text-xs px-2 py-1 rounded-lg font-medium transition-colors',
                          expired
                            ? 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                            : r.key === 'rage'
                              ? 'bg-red-900/60 hover:bg-red-800/80 text-red-200 border border-red-700/50'
                              : 'bg-black/30 hover:bg-black/50 text-white',
                        )}
                      >
                        {r.key === 'rage' ? 'End Rage' : 'End'}
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

                    {/* Berserker subclass features during rage */}
                    {r.key === 'rage' && !expired && (() => {
                      const barEntry = character.classes.find((cl: any) => cl.classId === 'barbarian' && cl.subclassId === 'berserker');
                      if (!barEntry) return null;
                      const barLevel: number = barEntry.level;
                      const isFrenzying: boolean = 'frenzy' in activeEffects;
                      return (
                        <div className="space-y-2 mb-3">
                          <div className="h-px bg-red-700/30" />
                          {/* Frenzy toggle (level 3+) */}
                          {barLevel >= 3 && (
                            <div className="flex items-center justify-between gap-2">
                              <div className="relative group min-w-0">
                                <p className="text-xs font-semibold text-red-300 cursor-default select-none">⚔️ Frenzy</p>
                                {/* Hover tooltip — appears above to avoid bottom-of-viewport clipping */}
                                <div className="absolute left-0 bottom-full mb-1.5 w-64 bg-slate-950 border border-red-900/70 rounded-xl p-3 text-xs text-slate-300 leading-relaxed z-50 shadow-2xl opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-150">
                                  <p className="font-bold text-red-300 mb-1">Frenzy — Berserker lv.3</p>
                                  <p>When you rage, you can choose to go into a frenzy. For the duration, you can make one melee weapon attack as a <span className="text-white font-medium">bonus action</span> on each of your turns after this one.</p>
                                  <p className="mt-1.5 text-amber-300">⚠ Costs +1 Exhaustion when this rage ends.</p>
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  if (isFrenzying) {
                                    setActiveEffects((prev: Record<string, number>) => { const n = { ...prev }; delete n['frenzy']; return n; });
                                  } else {
                                    setActiveEffects((prev: Record<string, number>) => ({ ...prev, frenzy: round }));
                                  }
                                }}
                                className={cn(
                                  'shrink-0 text-xs px-2 py-1 rounded-lg font-medium border transition-all',
                                  isFrenzying
                                    ? 'bg-red-900/70 border-red-500 text-red-200'
                                    : 'bg-black/20 hover:bg-red-950/40 border-slate-600 hover:border-red-700/60 text-slate-400 hover:text-red-300',
                                )}
                              >
                                {isFrenzying ? '🔥 Frenzying' : 'Enter Frenzy'}
                              </button>
                            </div>
                          )}
                          {/* Frenzy active reminder */}
                          {barLevel >= 3 && isFrenzying && (
                            <p className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-700/40 rounded-lg px-2 py-1.5 leading-relaxed">
                              Bonus action: one melee weapon attack per turn · +1 Exhaustion on rage end
                            </p>
                          )}
                          {/* Mindless Rage passive (level 6+) */}
                          {barLevel >= 6 && (
                            <p className="text-[11px] text-slate-400">
                              🛡 <span className="text-slate-300 font-medium">Mindless Rage</span> — immune to charmed &amp; frightened
                            </p>
                          )}
                        </div>
                      );
                    })()}

                    {/* Totem Warrior subclass features during rage */}
                    {r.key === 'rage' && !expired && (() => {
                      const totemEntry = character.classes.find((cl: any) => cl.classId === 'barbarian' && (cl.subclassId === 'totem-warrior' || cl.subclassId === 'scag-totem-warrior-elk-tiger'));
                      if (!totemEntry) return null;
                      const totemLevel: number = totemEntry.level;
                      const spirit = character.classOptions?.totemSpirit;
                      const attunement = character.classOptions?.totemicAttunement;

                      const spiritBenefits: Record<string, { emoji: string; title: string; text: string }> = {
                        bear:  { emoji: '🐻', title: 'Bear Spirit', text: 'Resistance to all damage types except psychic.' },
                        eagle: { emoji: '🦅', title: 'Eagle Spirit', text: 'Enemies have disadvantage on opportunity attacks against you. Dash as a bonus action.' },
                        wolf:  { emoji: '🐺', title: 'Wolf Spirit', text: 'Allies have advantage on melee attacks vs. creatures within 5 ft. of you.' },
                        elk:   { emoji: '🦌', title: 'Elk Spirit', text: '+15 ft. walking speed (no heavy armor).' },
                        tiger: { emoji: '🐯', title: 'Tiger Spirit', text: '+10 ft. long jump · +3 ft. high jump.' },
                      };
                      const attuneBenefits: Record<string, { emoji: string; title: string; text: string }> = {
                        bear:  { emoji: '🐻', title: 'Bear Attunement', text: 'Hostile creatures within 5 ft. have disadvantage on attacks against others.' },
                        eagle: { emoji: '🦅', title: 'Eagle Attunement', text: 'Flying speed equals walking speed (short bursts; fall if you end turn in air).' },
                        wolf:  { emoji: '🐺', title: 'Wolf Attunement', text: 'Bonus action: knock Large-or-smaller creature prone on a hit.' },
                        elk:   { emoji: '🦌', title: 'Elk Attunement', text: 'Bonus action: charge through creature\'s space (Str save or prone + 1d12+Str).' },
                        tiger: { emoji: '🐯', title: 'Tiger Attunement', text: 'Move 20 ft. toward target before attacking → bonus melee attack.' },
                      };

                      const spiritInfo = spirit ? spiritBenefits[spirit] : null;
                      const attuneInfo = attunement && totemLevel >= 14 ? attuneBenefits[attunement] : null;

                      return (
                        <div className="space-y-2 mb-3">
                          <div className="h-px bg-red-700/30" />
                          {spiritInfo ? (
                            <p className="text-[11px] text-green-300 bg-green-950/30 border border-green-700/40 rounded-lg px-2 py-1.5 leading-relaxed">
                              {spiritInfo.emoji} <span className="font-semibold">{spiritInfo.title}</span> — {spiritInfo.text}
                            </p>
                          ) : (
                            <p className="text-[11px] text-slate-500 italic px-1">⚠ No totem spirit chosen — go to Character → Class Options to pick one.</p>
                          )}
                          {attuneInfo && (
                            <p className="text-[11px] text-teal-300 bg-teal-950/30 border border-teal-700/40 rounded-lg px-2 py-1.5 leading-relaxed">
                              {attuneInfo.emoji} <span className="font-semibold">{attuneInfo.title}</span> — {attuneInfo.text}
                            </p>
                          )}
                        </div>
                      );
                    })()}

                    {/* Counter row */}
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs text-slate-400 shrink-0">{resourceDef?.name ?? r.key} uses remaining</p>
                      <div className="flex gap-1.5 flex-wrap justify-end">
                        {Array.from({ length: Math.min(displayMax === 99 ? 20 : displayMax, 20) }).map((_, i) => {
                          const available = i < Math.min(r.current, displayMax === 99 ? 20 : displayMax);
                          return (
                            <button
                              key={i}
                              onClick={() => setResource(r.key, available ? Math.min(r.current, displayMax) - 1 : Math.min(r.current, displayMax) + 1)}
                              className={cn(
                                'w-4 h-4 rounded-full border-2 transition-all',
                                available
                                  ? 'border-blue-400 bg-blue-400/30 hover:bg-blue-400/50'
                                  : 'border-slate-600 bg-transparent hover:border-slate-400',
                              )}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              }

              // ── Inactive state ───────────────────────────────────────
              const cappedMax = Math.min(displayMax === 99 ? 20 : displayMax, 20);
              const cappedCurrent = Math.min(r.current, cappedMax);
              return (
                <div key={r.key} className="bg-slate-900/40 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
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
                            if (r.key === 'rage') setShowRageOverlay(true);
                          }}
                          className="text-xs px-2 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white font-medium transition-colors border border-slate-600"
                        >
                          Activate
                        </button>
                      )}
                      <button
                        onClick={() => setResource(r.key, displayMax === 99 ? r.max : displayMax)}
                        className="text-xs px-2 py-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                        title="Reset uses"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                  {/* Radio bubbles — filled = available, empty = used */}
                  <div className="flex gap-1.5 flex-wrap">
                    {Array.from({ length: cappedMax }).map((_, i) => {
                      const available = i < cappedCurrent;
                      return (
                        <button
                          key={i}
                          onClick={() => setResource(r.key, available ? cappedCurrent - 1 : cappedCurrent + 1)}
                          className={cn(
                            'w-5 h-5 rounded-full border-2 transition-all',
                            available
                              ? 'border-blue-400 bg-blue-400/30 hover:bg-blue-400/50'
                              : 'border-slate-600 bg-transparent hover:border-slate-400',
                          )}
                          title={available ? 'Use one' : 'Restore one'}
                        />
                      );
                    })}
                    {displayMax === 99 && (
                      <span className="text-xs text-slate-400 self-center ml-1">{r.current} / ∞</span>
                    )}
                  </div>
                </div>
              );
            })}
            {/* Reset All */}
            {resources.filter((r: any) => r.key !== 'arcane_recovery').length > 1 && (
              <button
                onClick={() => resources.filter((r: any) => r.key !== 'arcane_recovery').forEach((r: any) => {
                  const displayMax = resourceMaxOverrides?.[r.key] ?? r.max;
                  setResource(r.key, displayMax === 99 ? r.max : displayMax);
                })}
                className="w-full text-xs py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-white transition-colors border border-slate-700"
              >
                Reset All Resources
              </button>
            )}
          </div>
        </div>
      )}

      {/* Hit Dice */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2">
          <SectionHeader className="mb-0">Hit Dice</SectionHeader>
          <PinButton moduleId="hit-dice" />
        </div>
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
            <div className="flex items-center gap-1">
              <PinButton moduleId="spell-slots" />
              <button
                onClick={restoreAllSpellSlots}
                className="text-xs text-slate-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded border border-slate-600 hover:border-slate-400 transition-colors"
              >
                <RefreshCw size={10} /> Restore All
              </button>
            </div>
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
        slotTotals={slotTotals}
        spellSlotsUsed={character.spellSlotsUsed}
        pactMagic={character.pactMagic}
        useSpellSlot={useSpellSlot}
        usePactSlot={usePactSlot}
        startConcentration={startConcentration}
        useItemCharge={useItemCharge}
      />

    </div>
  );
}

// ── Floating d20 quick-launch button ────────────────────────────────────────
// ── 3-D isometric casino D6 ─────────────────────────────────────────────────
//
// Three visible faces of a cube, tilted ~30°:
//
//          (30,8)
//         / TOP \
//   (8,20)──────(52,20)
//   | LEFT \  / RIGHT |
//   (8,42)  \/ (52,42)
//          (30,54)
//
// Pip positions are derived from the parallelogram matrix for each face so
// they lie correctly on the angled surface rather than being placed in screen
// space independently.
//
// Face assignment (classic Western dice, 1+6=7, 2+5=7, 3+4=7):
//   Top   → 5   Left  → 3   Right → 6
//
// Matrix derivation for each face (maps [0,1]² → parallelogram):
//   Top   : origin=(8,20), X-basis=(22,-12), Y-basis=(22,12)
//   Left  : origin=(8,20), X-basis=(22,12),  Y-basis=(0,22)
//   Right : origin=(30,32), X-basis=(22,-12), Y-basis=(0,22)
//
// x(u,v) = a·u + c·v + e      y(u,v) = b·u + d·v + f
//
// All pip screen positions are pre-computed below from those formulas.
//
function DiceFAB() {
  const { openPanel } = useDiceStore();
  const { theme }     = useThemeStore();

  // Per-theme colour palette matching the template image style:
  //   face = die body fill  |  line = outline + facet lines  |  num = number fill  |  glow = drop-shadow
  // Dark themes: dark body + bright accent lines (inverted parchment look)
  // Light theme: light body + dark lines (matches the cream+teal template exactly)
  const PALETTE: Record<string, { face:string; line:string; num:string; glow:string }> = {
    dark:      { face:'#0d1f3c', line:'#60a5fa', num:'#bfdbfe', glow:'#3b82f6' },
    light:     { face:'#f0ece0', line:'#2a7a8a', num:'#1a4a55', glow:'#2a7a8a' },
    party:     { face:'#2d0018', line:'#f472b6', num:'#fce7f3', glow:'#db2777' },
    halloween: { face:'#1c0700', line:'#fb923c', num:'#fed7aa', glow:'#ea580c' },
    christmas: { face:'#052e16', line:'#4ade80', num:'#bbf7d0', glow:'#16a34a' },
    deepsea:   { face:'#031828', line:'#38bdf8', num:'#bae6fd', glow:'#0284c7' },
    eid:       { face:'#100c00', line:'#fcd34d', num:'#fef3c7', glow:'#d97706' },
    // Parchment: warm cream body, dark sepia ink lines — matches the paper aesthetic
    parchment: { face:'#f0e8cc', line:'#7a5020', num:'#2c1a08', glow:'#b87a30' },
  };
  const c  = PALETTE[theme] ?? PALETTE['dark'];
  const ns = `d20fab-${theme}`;   // unique SVG id namespace per theme

  // ── Geometry ────────────────────────────────────────────────────────────────
  // Outer octagonal boundary (100×100 viewBox) — gives a rounded-polygon d20 silhouette
  const outer = '50,4 83,18 96,50 83,82 50,96 17,82 4,50 17,18';

  // The 8 outer vertices as [x,y] pairs (clockwise from top)
  const O = [[50,4],[83,18],[96,50],[83,82],[50,96],[17,82],[4,50],[17,18]] as const;
  //          O0      O1      O2      O3      O4      O5     O6     O7

  // Inner triangle = the prominently visible "20" face
  // Apex near top, base at y=60 — matches template proportions
  const T1 = [50, 15] as const;   // apex
  const T2 = [22, 60] as const;   // bottom-left vertex
  const T3 = [78, 60] as const;   // bottom-right vertex

  // Centroid of "20" face for text placement
  const cx20 = (T1[0]+T2[0]+T3[0])/3;  // 50
  const cy20 = (T1[1]+T2[1]+T3[1])/3;  // 45

  // ── Spoke connections (inner vertex → outer vertices) ────────────────────
  // Each outer vertex is connected to exactly one inner vertex, producing clean
  // triangular faces across the whole surface — 12 faces total, matching the
  // visible-hemisphere topology of the reference illustration.
  //
  //  T1 → O7, O0, O1   (top-left tiny, top-right tiny; plus shared T1-T2 / T1-T3 edges)
  //  T2 → O7, O6, O5, O4  (left, lower-left, bottom-left; T2-T3 is inner base)
  //  T3 → O1, O2, O3, O4  (right-upper, right, lower-right)
  //
  // O4 is shared between T2 and T3 — they both converge at the bottom vertex,
  // creating the bottom-center "8" face (T2-T3-O4).

  const spokes: [number,number,number,number][] = [
    // T1 spokes
    [T1[0],T1[1], O[7][0],O[7][1]],
    [T1[0],T1[1], O[0][0],O[0][1]],
    [T1[0],T1[1], O[1][0],O[1][1]],
    // T2 spokes
    [T2[0],T2[1], O[7][0],O[7][1]],
    [T2[0],T2[1], O[6][0],O[6][1]],
    [T2[0],T2[1], O[5][0],O[5][1]],
    [T2[0],T2[1], O[4][0],O[4][1]],
    // T3 spokes
    [T3[0],T3[1], O[1][0],O[1][1]],
    [T3[0],T3[1], O[2][0],O[2][1]],
    [T3[0],T3[1], O[3][0],O[3][1]],
    [T3[0],T3[1], O[4][0],O[4][1]],
  ];

  // ── Small face numbers ───────────────────────────────────────────────────
  // Centroid of each labelled face + rotation to match face orientation
  // "2"  — upper-left face  (T1-T2-O7): centroid ≈ (30,31), rotated −38°
  // "14" — upper-right face (T1-T3-O1): centroid ≈ (70,31), rotated +38°
  // "8"  — bottom-center    (T2-T3-O4): centroid ≈ (50,72), no rotation
  const sideNums = [
    { label:'2',  x:29, y:34, rot:-38 },
    { label:'14', x:71, y:34, rot: 38 },
    { label:'8',  x:50, y:75, rot:  0 },
  ] as const;

  return (
    <button
      onClick={openPanel}
      title="Open dice roller"
      className="fixed bottom-6 right-6 z-[40] transition-all duration-200 active:scale-95 hover:scale-110 hover:-translate-y-1"
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: 60, height: 60 }}
    >
      <svg viewBox="0 0 100 100" width="60" height="60" style={{ overflow: 'visible' }} xmlns="http://www.w3.org/2000/svg">
        <defs>
          {/* Drop shadow under entire die */}
          <filter id={`${ns}-drop`} x="-35%" y="-30%" width="170%" height="175%">
            <feDropShadow dx="0" dy="5" stdDeviation="5" floodColor={c.glow} floodOpacity="0.8" />
          </filter>
          {/* Bloom glow for "20" text */}
          <filter id={`${ns}-bloom`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── Die body fill ── */}
        <polygon points={outer} fill={c.face} />

        {/* ── Outer rim — drawn last on top with glow ── */}
        {/* (drawn twice: once for glow filter, once crisp on top) */}
        <polygon points={outer} fill="none" stroke={c.line} strokeWidth="2.8"
          strokeLinejoin="round" filter={`url(#${ns}-drop)`} />

        {/* ── Main "20" face triangle ── */}
        <polygon
          points={`${T1[0]},${T1[1]} ${T2[0]},${T2[1]} ${T3[0]},${T3[1]}`}
          fill="none" stroke={c.line} strokeWidth="1.6" strokeLinejoin="round"
        />

        {/* ── Facet spoke lines from inner vertices to outer boundary ── */}
        {spokes.map(([x1,y1,x2,y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={c.line} strokeWidth="1.1" opacity="0.6" />
        ))}

        {/* ── Small face numbers (decorative, matches template illustration) ── */}
        {sideNums.map(({ label, x, y, rot }) => (
          <text
            key={label}
            x={x} y={y}
            textAnchor="middle"
            fontSize={label === '14' ? 7 : 8}
            fontWeight="700"
            fontFamily="Georgia, 'Palatino Linotype', serif"
            fill={c.num}
            opacity="0.65"
            transform={rot !== 0 ? `rotate(${rot},${x},${y})` : undefined}
          >{label}</text>
        ))}

        {/* ── "20" — large, prominent, with bloom glow ── */}
        <text
          x={cx20} y={cy20 + 7}
          textAnchor="middle"
          fontSize="20"
          fontWeight="900"
          fontFamily="Georgia, 'Palatino Linotype', serif"
          fill={c.num}
          letterSpacing="1"
          filter={`url(#${ns}-bloom)`}
        >20</text>

        {/* ── Crisp outer rim on top (no filter, no blur) ── */}
        <polygon points={outer} fill="none" stroke={c.line} strokeWidth="2.5"
          strokeLinejoin="round" opacity="0.9" />
      </svg>
    </button>
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
