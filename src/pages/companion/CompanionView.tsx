/**
 * CompanionView — one companion, alone, in its own window.
 *
 * A player running a beast alongside their character shouldn't have to scroll the sheet mid-fight,
 * which is the same reason the borrowed sheet gets its own window. Unlike `/table` this keeps the
 * normal chrome: it's a real window you move and resize, not a display surface.
 *
 * Reads the character out of the library by id rather than useCharacterStore, because this window
 * is a SEPARATE webview with its own module instances — the sheet window's in-memory store does
 * not exist here. Both windows write through the library store, so edits made here reach the sheet
 * on its next read.
 */
import { useParams } from 'react-router-dom';
import { useLibraryStore } from '../../store/useLibraryStore';
import { computeCompanionDerived } from '../../utils/companion';
import { cn } from '../../utils/cn';

export function CompanionView() {
  const { charId, companionId } = useParams<{ charId: string; companionId: string }>();
  const characters = useLibraryStore(s => s.characters);
  const updateCharacter = useLibraryStore(s => s.updateCharacter);

  const character = characters.find(c => c.id === charId);
  const companion = character?.companions?.find(c => c.id === companionId);
  const derived = character && companion ? computeCompanionDerived(character, companion) : null;

  if (!character || !companion || !derived) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-300 p-6">
        <p className="text-sm">That companion is no longer on this character.</p>
        <p className="text-xs text-slate-500 mt-1">You can close this window.</p>
      </div>
    );
  }

  function setHP(next: number) {
    if (!character || !companion) return;
    const clamped = Math.max(0, Math.min(derived!.maxHP, next));
    updateCharacter({
      ...character,
      companions: (character.companions ?? []).map(c =>
        c.id === companion.id ? { ...c, currentHP: clamped } : c),
    });
  }

  const pct = derived.maxHP > 0 ? (companion.currentHP / derived.maxHP) * 100 : 0;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-5 space-y-4">
      <div>
        <h1 className="text-lg font-bold">{companion.name}</h1>
        <p className="text-xs text-slate-400">
          {derived.beastName} · {derived.size} beast · CR {derived.cr} · companion of {character.name}
        </p>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Hit Points</span>
          <span className="text-sm font-mono text-slate-200">{companion.currentHP} / {derived.maxHP}</span>
        </div>
        <div className="h-3 bg-slate-900 rounded overflow-hidden mb-3">
          <div className={cn('h-full transition-all',
            pct > 50 ? 'bg-emerald-500' : pct > 25 ? 'bg-amber-500' : 'bg-red-500')}
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
        <div className="flex gap-2">
          {[1, 5, 10].map(n => (
            <button key={`d${n}`} onClick={() => setHP(companion.currentHP - n)}
              className="flex-1 py-1 rounded border border-red-800 bg-red-900/30 text-red-300 hover:bg-red-800/40 text-xs transition-colors">
              −{n}
            </button>
          ))}
          {[1, 5].map(n => (
            <button key={`h${n}`} onClick={() => setHP(companion.currentHP + n)}
              className="flex-1 py-1 rounded border border-emerald-800 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-800/40 text-xs transition-colors">
              +{n}
            </button>
          ))}
          <button onClick={() => setHP(derived.maxHP)}
            className="flex-1 py-1 rounded border border-slate-600 bg-slate-800 text-slate-300 hover:border-slate-400 text-xs transition-colors">
            Full
          </button>
        </div>
        {companion.currentHP === 0 && (
          <p className="text-[11px] text-red-300 mt-2">
            Down. Your own hit points are untouched — a companion is a separate creature.
          </p>
        )}
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">AC</p>
          <p className="text-xl font-bold">{derived.ac}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Attacks</p>
          <p className="text-xl font-bold">{derived.attacksPerAction}<span className="text-xs text-slate-500">/action</span></p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Speed</p>
          <p className="text-sm text-slate-300 pt-1">
            {Object.entries(derived.speed).map(([k, v]) => `${k} ${v}`).join(', ')}
          </p>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Attacks</p>
        {derived.attacks.map((a, i) => (
          <p key={i} className="text-sm text-slate-200 mb-1">
            <span className="text-slate-400">{a.name}</span>{' '}
            {a.toHit >= 0 ? '+' : ''}{a.toHit} to hit, {a.damage} {a.damageType}
            {a.notes && <span className="text-slate-500"> — {a.notes}</span>}
          </p>
        ))}
        {derived.specialAbilities.length > 0 && (
          <p className="text-[11px] text-slate-500 mt-2">{derived.specialAbilities.join(' · ')}</p>
        )}
        <p className="text-[10px] text-slate-600 mt-2">
          Your proficiency bonus of +{derived.profBonusApplied} is already included in AC, to-hit and damage.
        </p>
      </div>
    </div>
  );
}
