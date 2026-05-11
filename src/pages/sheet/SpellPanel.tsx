import React from 'react';
import { Plus, Sparkles, X } from 'lucide-react';
import { ALL_SPELLS, getSpell } from '../../data/spells';
import { Dialog, Badge, Button } from '../../components/ui';
import { cn } from '../../utils/cn';
import { SpellDetail } from '../wizard/steps/StepSpells';
import type { Character, Spell, SpellLevel } from '../../types';
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
}

export function SpellPanel({ character, derived, toggleSpellPrepared, startConcentration, endConcentration, addSpellToBook, removeSpellFromBook }: SpellPanelProps) {
  const [detailSpell, setDetailSpell] = React.useState<Spell | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [filterLevel, setFilterLevel] = React.useState<number | 'all'>('all');

  const primaryClass = character.classes[0];
  const classDef = primaryClass ? getClass(primaryClass.classId) : null;
  const { maxPreparedSpells } = derived;

  // Group spellbook by level
  const spellbookMap = new Map(character.spellbook.map(sp => [sp.spellId, sp]));
  const preparedCount = character.spellbook.filter(sp => sp.isPrepared && !sp.isAlwaysPrepared).length;

  const byLevel: Record<number, { spell: Spell; prepared: boolean; alwaysPrepared: boolean }[]> = {};
  for (const sp of character.spellbook) {
    const spell = getSpell(sp.spellId);
    if (!spell) continue;
    if (!byLevel[spell.level]) byLevel[spell.level] = [];
    byLevel[spell.level].push({ spell, prepared: sp.isPrepared, alwaysPrepared: sp.isAlwaysPrepared });
  }

  // Spells for add browser
  const availableToAdd = ALL_SPELLS.filter(s =>
    character.enabledBooks.includes(s.sourceBook) &&
    (classDef ? s.classes.includes(primaryClass.classId) : true) &&
    !spellbookMap.has(s.id) &&
    (filterLevel === 'all' || s.level === filterLevel) &&
    (search === '' || s.name.toLowerCase().includes(search.toLowerCase()))
  );

  const isPreparedCaster = classDef && ['cleric','druid','paladin','wizard'].includes(classDef.id);
  const levels = [0,1,2,3,4,5,6,7,8,9] as SpellLevel[];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          {isPreparedCaster && maxPreparedSpells > 0 && (
            <p className="text-sm text-slate-400">
              Prepared: <span className="font-bold text-white">{preparedCount}/{maxPreparedSpells}</span>
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus size={14} /> Add Spell
        </Button>
      </div>

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
          return (
            <div key={lvl} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
              <div className="px-4 py-2 bg-slate-750 border-b border-slate-700 flex items-center gap-2">
                <h3 className="font-bold text-slate-300 text-sm">
                  {lvl === 0 ? 'Cantrips' : `Level ${lvl} Spells`}
                </h3>
                <span className="text-xs text-slate-500">({entries.length})</span>
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
                    {spell.concentration && prepared && (
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
                      >
                        <Sparkles size={12} />
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
