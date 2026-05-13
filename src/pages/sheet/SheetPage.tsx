import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Moon, Sun, Star, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useCharacterStore } from '../../store/useCharacterStore';
import { useCharacterDerived } from '../../hooks/useCharacterDerived';
import { Button, Tabs, Dialog, StatBox, SectionHeader, NumberStepper } from '../../components/ui';
import { cn } from '../../utils/cn';
import type { Condition, SlotLevel } from '../../types';
import { SpellPanel } from './SpellPanel';
import { TraitsPanel } from './TraitsPanel';
import { InventoryPanel } from './InventoryPanel';
import { getClass } from '../../data/classes';
import { getSubclass } from '../../data/subclasses';

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
import { getRace } from '../../data/races';

// Exhaustion is tracked separately via exhaustionLevel; it has its own +/- UI
// and a dedicated button in the Add Condition dialog, so it's omitted here to
// prevent duplicate tracking on a single character.
const CONDITION_LIST: Condition[] = [
  'Blinded','Charmed','Deafened','Frightened','Grappled',
  'Incapacitated','Invisible','Paralyzed','Petrified','Poisoned','Prone',
  'Restrained','Stunned','Unconscious',
];

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
    toggleInventoryEquipped, renameInventoryItem } = useCharacterStore();

  const [tab, setTab] = React.useState('combat');
  const [hpInput, setHpInput] = React.useState('');
  const [hpMode, setHpMode] = React.useState<'heal'|'damage'>('damage');
  const [addConditionOpen, setAddConditionOpen] = React.useState(false);
  const [restConfirm, setRestConfirm] = React.useState<'short'|'long'|null>(null);
  const [saved, setSaved] = React.useState(false);

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

  if (!character || !derived) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">Loading...</div>;
  }

  const { finalScores, mods, profBonus, ac, initiative, speed, savingThrows, skills, passivePerception, spellSaveDC, spellAttackBonus, slotTotals, totalLevel } = derived;

  const race = getRace(character.raceId);
  const primaryClass = character.classes[0];
  const classDef = primaryClass ? getClass(primaryClass.classId) : null;
  const hpPercent = Math.min(100, Math.round((character.currentHP / character.maxHP) * 100));

  function applyHP() {
    const amount = parseInt(hpInput);
    if (isNaN(amount) || amount <= 0) return;
    if (hpMode === 'heal') healHP(amount); else damageHP(amount);
    setHpInput('');
  }

  function doRest(type: 'short'|'long') {
    if (type === 'short') shortRest(); else longRest();
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
          <div>
            <h1 className="font-bold text-white text-lg leading-tight">{character.name}</h1>
            <p className="text-xs text-slate-400">
              Level {totalLevel} {race?.name ?? ''} {classDef?.name ?? ''} · {character.alignment}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {saved && <span className="text-xs text-green-400">Saved ✓</span>}
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
              {[
                { label: 'AC', value: ac },
                { label: 'Init', value: initiative >= 0 ? `+${initiative}` : initiative },
                { label: 'Speed', value: `${speed}` },
                { label: 'Prof', value: `+${profBonus}` },
                { label: 'Pass. Perc', value: passivePerception },
              ].map(({ label, value }) => (
                <div key={label} className="bg-slate-900 border border-slate-700 rounded-lg py-2 px-1 text-center">
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="font-bold text-white">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Saving throws */}
          <div>
            <SectionHeader>Saving Throws</SectionHeader>
            <div className="space-y-1">
              {abilityKeys.map(k => {
                const val = savingThrows[k];
                const isProficient = classDef?.savingThrows.includes(k);
                return (
                  <div key={k} className="flex items-center justify-between py-1 px-2 rounded hover:bg-slate-800">
                    <div className="flex items-center gap-2">
                      <div className={cn('w-2 h-2 rounded-full', isProficient ? 'bg-green-400' : 'bg-slate-600')} />
                      <span className="text-sm text-slate-300">{abilityLabels[k]}</span>
                    </div>
                    <span className={cn('text-sm font-bold', val >= 0 ? 'text-white' : 'text-red-400')}>
                      {val >= 0 ? '+' : ''}{val}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Skills */}
          <div>
            <SectionHeader>Skills</SectionHeader>
            <div className="space-y-0.5">
              {Object.entries(skills).map(([skill, bonus]) => {
                const isProficient = character.selectedSkillProficiencies.includes(skill as any);
                return (
                  <div key={skill} className="flex items-center justify-between py-0.5 px-2 rounded hover:bg-slate-800">
                    <div className="flex items-center gap-1.5">
                      <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', isProficient ? 'bg-green-400' : 'bg-slate-600')} />
                      <span className="text-xs text-slate-300 truncate">{skill}</span>
                    </div>
                    <span className={cn('text-xs font-bold shrink-0', bonus >= 0 ? 'text-slate-300' : 'text-red-400')}>
                      {bonus >= 0 ? '+' : ''}{bonus}
                    </span>
                  </div>
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
              />
            )}
            {tab === 'character' && (
              <TraitsPanel character={character} setNotes={setNotes} />
            )}
          </div>
        </div>
      </div>

      {/* Rest confirm */}
      <Dialog open={!!restConfirm} onClose={() => setRestConfirm(null)} title={restConfirm === 'long' ? 'Long Rest' : 'Short Rest'}>
        <p className="text-slate-300 mb-6">
          {restConfirm === 'long'
            ? 'Taking a long rest will restore all HP, spell slots, and class resources. Conditions (except Exhaustion) are cleared.'
            : 'Taking a short rest will restore short-rest resources (Ki, Channel Divinity, Action Surge, Warlock pact slots).'}
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setRestConfirm(null)}>Cancel</Button>
          <Button onClick={() => doRest(restConfirm!)}>
            {restConfirm === 'long' ? <Moon size={14} /> : <Sun size={14} />}
            Take {restConfirm === 'long' ? 'Long' : 'Short'} Rest
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function CombatTab({ character, hpPercent, hpInput, hpMode, setHpInput, setHpMode, applyHP,
  setCurrentHP, setTempHP, setMaxHP, addDeathSuccess, addDeathFailure, resetDeathSaves,
  addConditionOpen, setAddConditionOpen, addCondition, removeCondition, setExhaustion,
  classDef, resources, setResource, spellSaveDC, spellAttackBonus, slotTotals,
  useSpellSlot, restoreSpellSlot, restoreAllSpellSlots, pactMagic, usePactSlot,
  restorePactSlots, spellSlotsUsed, concentrationSpellId, endConcentration }: any) {

  return (
    <div className="space-y-4">
      {/* Concentration banner */}
      {concentrationSpellId && (
        <div className="bg-amber-900/30 border border-amber-600 rounded-xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-amber-400" />
            <span className="text-amber-300 font-medium text-sm">
              Concentrating on: <span className="text-amber-200 font-bold">{concentrationSpellId.replace(/-/g,' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}</span>
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
            <span className="font-bold text-white">{character.currentHP} / {character.maxHP}</span>
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

        {/* Death saves — only show at 0 HP */}
        {character.currentHP === 0 && (
          <div className="mt-4 border-t border-slate-700 pt-3">
            <SectionHeader className="mb-2">Death Saving Throws</SectionHeader>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs text-green-400 mb-1">Successes</p>
                <div className="flex gap-2">
                  {[0,1,2].map(i => (
                    <button
                      key={i}
                      onClick={() => i < character.deathSaves.successes ? null : addDeathSuccess()}
                      className={cn('w-8 h-8 rounded-full border-2 transition-all', i < character.deathSaves.successes ? 'border-green-500 bg-green-500' : 'border-slate-500')}
                    />
                  ))}
                </div>
              </div>
              <button onClick={resetDeathSaves} className="text-xs text-slate-400 hover:text-white">Reset</button>
              <div>
                <p className="text-xs text-red-400 mb-1 text-right">Failures</p>
                <div className="flex gap-2">
                  {[0,1,2].map(i => (
                    <button
                      key={i}
                      onClick={() => i < character.deathSaves.failures ? null : addDeathFailure()}
                      className={cn('w-8 h-8 rounded-full border-2 transition-all', i < character.deathSaves.failures ? 'border-red-500 bg-red-500' : 'border-slate-500')}
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
        <div className="flex items-center justify-between mb-2">
          <SectionHeader className="mb-0">Conditions</SectionHeader>
          <button
            onClick={() => setAddConditionOpen(true)}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1 px-2 py-1 rounded border border-slate-600 hover:border-slate-400 transition-colors"
          >
            <Plus size={12} /> Add
          </button>
        </div>
        {character.exhaustionLevel > 0 && (
          <div className="flex items-center gap-2 mb-2">
            <span className="bg-orange-900/50 text-orange-300 px-2 py-1 rounded-lg text-xs font-medium border border-orange-700">
              Exhaustion {character.exhaustionLevel}
            </span>
            <button onClick={() => setExhaustion(Math.max(0, character.exhaustionLevel - 1) as any)} className="text-xs text-slate-500 hover:text-white">−</button>
            <button onClick={() => setExhaustion(Math.min(6, character.exhaustionLevel + 1) as any)} className="text-xs text-slate-500 hover:text-white">+</button>
          </div>
        )}
        {character.conditions.length === 0 && character.exhaustionLevel === 0 ? (
          <p className="text-slate-500 text-sm">No active conditions</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {character.conditions.map((c: Condition) => (
              <span
                key={c}
                onClick={() => removeCondition(c)}
                className="bg-red-900/40 text-red-300 border border-red-700 px-2 py-0.5 rounded-lg text-xs cursor-pointer hover:bg-red-800/50 transition-colors"
                title="Click to remove"
              >
                {c} ×
              </span>
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
      {resources.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Class Resources</SectionHeader>
          <div className="space-y-3">
            {resources.map((r: any) => {
              const resourceDef = getResourceDef(character, r.key);
              return (
                <div key={r.key} className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">{resourceDef?.name ?? r.key}</p>
                    {resourceDef && <p className="text-xs text-slate-500">Recharges on {resourceDef.rechargeOn} rest</p>}
                  </div>
                  <NumberStepper value={r.current} min={0} max={r.max === 99 ? 999 : r.max} onChange={v => setResource(r.key, v)} />
                </div>
              );
            })}
          </div>
        </div>
      )}

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
    </div>
  );
}
