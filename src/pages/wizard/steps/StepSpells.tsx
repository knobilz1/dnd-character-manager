import React from 'react';
import { useWizardStore } from '../../../store/useWizardStore';
import { ALL_SPELLS } from '../../../data/spells';
import { Badge, Dialog } from '../../../components/ui';
import { cn } from '../../../utils/cn';
import { getClass } from '../../../data/classes';
import type { Spell, SpellLevel } from '../../../types';

const SCHOOL_COLORS: Record<string, string> = {
  Abjuration: 'blue', Conjuration: 'purple', Divination: 'indigo',
  Enchantment: 'pink', Evocation: 'red', Illusion: 'violet',
  Necromancy: 'slate', Transmutation: 'green',
};

export function StepSpells() {
  const { draft, updateDraft } = useWizardStore();
  const [search, setSearch] = React.useState('');
  const [filterLevel, setFilterLevel] = React.useState<number | 'all'>('all');
  const [detailSpell, setDetailSpell] = React.useState<Spell | null>(null);

  const primaryClass = draft.classes?.[0];
  const classDef = primaryClass ? getClass(primaryClass.classId) : null;

  if (!classDef || classDef.spellcastingType === 'none') {
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

  const classSpells = ALL_SPELLS.filter(s =>
    s.classes.includes(primaryClass!.classId) &&
    draft.enabledBooks.includes(s.sourceBook) &&
    (filterLevel === 'all' || s.level === filterLevel) &&
    (search === '' || s.name.toLowerCase().includes(search.toLowerCase()))
  );

  const selectedIds = new Set(draft.spellbook?.map(s => s.spellId) ?? []);

  function toggleSpell(spell: Spell) {
    const current = draft.spellbook ?? [];
    if (selectedIds.has(spell.id)) {
      updateDraft({ spellbook: current.filter(s => s.spellId !== spell.id) });
    } else {
      updateDraft({ spellbook: [...current, { spellId: spell.id, isPrepared: true, isAlwaysPrepared: false }] });
    }
  }

  const levels: SpellLevel[] = [0,1,2,3,4,5,6,7,8,9];

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-2">Spells</h2>
      <p className="text-slate-400 mb-4">
        Select the spells you know or have in your spellbook. You can add or remove them on your character sheet.
      </p>

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
          {levels.map(l => (
            <button
              key={l}
              onClick={() => setFilterLevel(l)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all', filterLevel === l ? 'bg-red-700 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600')}
            >{l === 0 ? 'Cantrip' : `L${l}`}</button>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-500 mb-3">{selectedIds.size} spells selected · {classSpells.length} shown</p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {classSpells.map(spell => {
          const isSelected = selectedIds.has(spell.id);
          return (
            <div
              key={spell.id}
              className={cn(
                'p-3 rounded-lg border-2 transition-all',
                isSelected ? 'border-red-500 bg-red-950/30' : 'border-slate-700 bg-slate-800 hover:border-slate-500',
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
                  onClick={() => toggleSpell(spell)}
                  className={cn(
                    'text-xs px-2 py-1 rounded font-medium transition-all',
                    isSelected ? 'bg-red-700 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600',
                  )}
                >
                  {isSelected ? 'Remove' : 'Add'}
                </button>
              </div>
            </div>
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
