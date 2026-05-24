import React from 'react';
import { Plus, Sparkles, X, Zap } from 'lucide-react';
import { ALL_SPELLS, getSpell } from '../../data/spells';
import { Dialog, Badge, Button } from '../../components/ui';
import { cn } from '../../utils/cn';
import { SpellDetail } from '../creator/steps/StepSpells';
import type { Character, Spell, SpellLevel, SlotLevel } from '../../types';
import { getClass } from '../../data/classes';

const SCHOOL_COLORS: Record<string, string> = {
  Abjuration: 'blue', Conjuration: 'purple', Divination: 'indigo',
  Enchantment: 'pink', Evocation: 'red', Illusion: 'violet',
  Necromancy: 'slate', Transmutation: 'green',
};

interface SpellPanelProps {
  character: Character;
  derived: any;
  toggleSpellPrepared: (id: string) => void;
  startConcentration: (id: string) => void;
  endConcentration: () => void;
  addSpellToBook: (id: string) => void;
  removeSpellFromBook: (id: string) => void;
  useSpellSlot: (level: SlotLevel) => void;
  usePactSlot: () => void;
}

const PREPARED_CASTER_CLASSES = ['cleric', 'druid', 'paladin', 'wizard', 'artificer'];

export function SpellPanel({ character, derived, toggleSpellPrepared, startConcentration, endConcentration, addSpellToBook, removeSpellFromBook, useSpellSlot, usePactSlot }: SpellPanelProps) {
  const [detailSpell, setDetailSpell] = React.useState<Spell | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [filterLevel, setFilterLevel] = React.useState<number | 'all'>('all');

  const [castSpell, setCastSpell] = React.useState<Spell | null>(null);

  const primaryClass = character.classes[0];
  const classDef = primaryClass ? getClass(primaryClass.classId) : null;
  const { maxPreparedSpells, slotTotals, cantripsKnown, maxSpellLevel } = derived;
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
  const allClassIds = character.classes.map((cl: any) => cl.classId);
  const availableToAdd = ALL_SPELLS.filter(s =>
    character.enabledBooks.includes(s.sourceBook) &&
    (classDef ? allClassIds.some(id => s.classes.includes(id)) : true) &&
    !spellbookMap.has(s.id) &&
    (filterLevel === 'all' || s.level === filterLevel) &&
    (search === '' || s.name.toLowerCase().includes(search.toLowerCase()))
  );

  const isPreparedCaster = classDef && PREPARED_CASTER_CLASSES.includes(classDef.id);
  const levels = [0,1,2,3,4,5,6,7,8,9] as SpellLevel[];

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
            const cantripCount = (byLevel[0]?.length ?? 0);
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
                {entries.sort((a,b) => a.spell.name.localeCompare(b.spell.name)).map(({ spell, prepared, alwaysPrepared }) => (
                  <div key={spell.id} className="px-4 py-3 flex items-center gap-3 hover:bg-slate-750 group">
                    {/* Prepared toggle — only for prepared casters, not cantrips */}
                    {lvl > 0 && isPreparedCaster && (
                      <button
                        onClick={() => !alwaysPrepared && toggleSpellPrepared(spell.id)}
                        disabled={alwaysPrepared}
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
                      <p className="text-xs text-slate-500">{spell.castingTime} · {spell.range} · {spell.school}</p>
                    </div>

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
                ))}
              </div>
            </div>
          );
        })
      )}

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
                  if (castSpell.concentration) startConcentration(castSpell.id);
                  setCastSpell(null);
                }}
              >
                <p className="text-sm font-bold text-purple-300">Pact Magic Slot (L{pactMagic.slotLevel})</p>
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
                        if (castSpell.concentration) startConcentration(castSpell.id);
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
            <div key={spell.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-700 cursor-pointer" onClick={() => { addSpellToBook(spell.id); }}>
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
