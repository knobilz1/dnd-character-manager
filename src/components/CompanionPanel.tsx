/**
 * CompanionPanel — creatures the character controls but is not.
 *
 * Separate from AlternateFormPanel: Wild Shape *transforms* the character, a companion is a second
 * creature that acts on its own initiative and holds its own HP. Running a companion to 0 does not
 * touch the character.
 *
 * Only the 2014 Beast Master is wired so far. The picker offers the legal pool from the SRD —
 * every beast at CR 1/4 or lower and size Medium or smaller — rather than whichever beasts the
 * druid Wild Shape table happened to contain, which was 12 of the 43.
 */
import { useState } from 'react';
import { PawPrint, X, Plus, ExternalLink, Eye, EyeOff } from 'lucide-react';
import type { Character, Companion } from '../types';
import { ALL_BEAST_FORMS } from '../data/beastForms';
import { computeCompanionDerived } from '../utils/companion';
import { crToNumber } from '../data/beastForms';
import { cn } from '../utils/cn';
import { useCharacterStore } from '../store/useCharacterStore';

/** The legal Beast Master pool: PHB p.93 — "no larger than Medium and CR 1/4 or lower". */
export function beastMasterPool() {
  return ALL_BEAST_FORMS
    .filter(b => crToNumber(b.cr) <= 0.25 && ['Tiny', 'Small', 'Medium'].includes(b.size))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function CompanionPanel({ character, onPopOut }: {
  character: Character;
  onPopOut?: (c: Companion) => void;
}) {
  // Pulled from the store rather than drilled through CombatTab — the same thing TraitsPanel does.
  const { addCompanion: onAdd, removeCompanion: onRemove,
          setCompanionHP: onSetHP, setCompanionActive: onSetActive } = useCharacterStore();
  const [picking, setPicking] = useState(false);
  const companions = character.companions ?? [];
  const bmClass = character.classes.find(c => c.subclassId === 'beast-master');
  // Nothing to show and nothing to offer — render nothing rather than an empty card.
  if (!bmClass && companions.length === 0) return null;

  function pick(beastId: string) {
    const beast = ALL_BEAST_FORMS.find(b => b.id === beastId);
    if (!beast || !bmClass) return;
    const draft: Companion = {
      id: crypto.randomUUID(),
      kind: 'beast-master',
      classId: bmClass.classId,
      beastId,
      name: beast.name,
      currentHP: Math.max(beast.hp, 4 * bmClass.level),
      active: true,
    };
    onAdd(draft);
    setPicking(false);
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
          <PawPrint size={14} /> Companions
        </span>
        {bmClass && (
          <button
            onClick={() => setPicking(p => !p)}
            className="text-[11px] px-2 py-0.5 rounded border border-emerald-700 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-800/50 transition-colors flex items-center gap-1"
          >
            <Plus size={11} /> {picking ? 'Cancel' : 'Bond a beast'}
          </button>
        )}
      </div>

      {picking && (
        <div className="mb-3 bg-slate-900 border border-emerald-700/40 rounded-lg p-3">
          <p className="text-[11px] text-slate-400 mb-2">
            Any beast of CR 1/4 or lower and size Medium or smaller ({beastMasterPool().length} available).
          </p>
          <div className="flex flex-wrap gap-1.5">
            {beastMasterPool().map(b => (
              <button
                key={b.id}
                onClick={() => pick(b.id)}
                className="px-2 py-1 rounded border border-slate-600 bg-slate-800 text-slate-200 hover:border-emerald-500 hover:text-white text-xs transition-colors"
                title={`CR ${b.cr} · ${b.size} · AC ${b.ac} · ${b.hp} hp`}
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {companions.length === 0 && !picking && (
        <p className="text-xs text-slate-500">No companion bonded.</p>
      )}

      <div className="space-y-2">
        {companions.map(c => {
          const d = computeCompanionDerived(character, c);
          if (!d) {
            return (
              <div key={c.id} className="bg-slate-900 rounded-lg p-3 text-xs text-amber-300">
                {c.name} — stat block “{c.beastId}” not found.
                <button onClick={() => onRemove(c.id)} className="ml-2 text-slate-400 hover:text-red-400">remove</button>
              </div>
            );
          }
          const pct = d.maxHP > 0 ? (c.currentHP / d.maxHP) * 100 : 0;
          return (
            <div key={c.id} className={cn('bg-slate-900 rounded-lg p-3 border', c.active ? 'border-emerald-700/50' : 'border-slate-700')}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-white">{c.name}</span>
                <span className="text-[10px] text-slate-500">
                  {d.beastName} · {d.size} · CR {d.cr}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => onSetActive(c.id, !c.active)}
                    title={c.active ? 'Out — the DM places and tracks it' : 'Not out'}
                    className={cn('p-1 rounded transition-colors',
                      c.active ? 'text-emerald-400 hover:text-emerald-200' : 'text-slate-600 hover:text-slate-400')}
                  >
                    {c.active ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                  {onPopOut && (
                    <button onClick={() => onPopOut(c)} title="Open in its own window"
                      className="p-1 rounded text-slate-500 hover:text-slate-200 transition-colors">
                      <ExternalLink size={13} />
                    </button>
                  )}
                  <button onClick={() => onRemove(c.id)} title="Release"
                    className="p-1 rounded text-slate-600 hover:text-red-400 transition-colors">
                    <X size={13} />
                  </button>
                </div>
              </div>

              {/* HP — its own pool; 0 does not touch the character */}
              <div className="flex items-center gap-2 mb-2">
                <button onClick={() => onSetHP(c.id, c.currentHP - 1)}
                  className="w-6 h-6 rounded bg-slate-800 border border-slate-600 text-slate-300 hover:border-red-500 text-xs">−</button>
                <div className="flex-1 h-2 bg-slate-800 rounded overflow-hidden">
                  <div className={cn('h-full transition-all',
                    pct > 50 ? 'bg-emerald-500' : pct > 25 ? 'bg-amber-500' : 'bg-red-500')}
                    style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                </div>
                <button onClick={() => onSetHP(c.id, Math.min(d.maxHP, c.currentHP + 1))}
                  className="w-6 h-6 rounded bg-slate-800 border border-slate-600 text-slate-300 hover:border-emerald-500 text-xs">+</button>
                <span className="text-xs font-mono text-slate-300 w-14 text-right">{c.currentHP}/{d.maxHP}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-[11px] mb-2">
                <span className="text-slate-500">AC <span className="text-white font-bold">{d.ac}</span></span>
                <span className="text-slate-500">Speed <span className="text-slate-300">
                  {Object.entries(d.speed).map(([k, v]) => `${k} ${v}`).join(', ')}</span></span>
                <span className="text-slate-500">Attacks <span className="text-slate-300">{d.attacksPerAction}/action</span></span>
              </div>

              <div className="space-y-0.5">
                {d.attacks.map((a, i) => (
                  <p key={i} className="text-[11px] text-slate-300">
                    <span className="text-slate-500">{a.name}</span> {a.toHit >= 0 ? '+' : ''}{a.toHit} to hit,{' '}
                    {a.damage} {a.damageType}
                    {a.notes && <span className="text-slate-500"> — {a.notes}</span>}
                  </p>
                ))}
              </div>

              {d.specialAbilities.length > 0 && (
                <p className="text-[10px] text-slate-500 mt-1.5">{d.specialAbilities.join(' · ')}</p>
              )}
              <p className="text-[10px] text-slate-600 mt-1.5">
                Proficiency +{d.profBonusApplied} already folded into AC, to-hit and damage.
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
