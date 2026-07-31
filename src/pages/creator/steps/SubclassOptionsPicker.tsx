import { cn } from '../../../utils/cn';
import { getSubclassOptions, picksAllowed } from '../../../data/subclassOptions';

/**
 * D4 — picker for a subclass's persistent build choices.
 *
 * Rendered in BOTH the creator and the sheet, for the same reason as the flexible-ASI picker: a
 * character created before the choice existed, or levelled past it, would otherwise never be able
 * to supply it. That is exactly how Circle of the Land's land type stayed unreachable — the data
 * and the consumer both existed, with no way for the player to fill the gap between them.
 *
 * Over-picking is prevented by disabling unchosen options once the allowance is spent, rather than
 * by silently dropping the extra: a click that does nothing with no explanation reads as a bug.
 */
export function SubclassOptionsPicker({ subclassId, classLevel, value, onChange, compact }: {
  subclassId: string | undefined;
  classLevel: number;
  value: Record<string, string[]> | undefined;
  onChange: (next: Record<string, string[]>) => void;
  compact?: boolean;
}) {
  const groups = getSubclassOptions(subclassId).filter(g => picksAllowed(g, classLevel) > 0);
  if (groups.length === 0) return null;

  const current = value ?? {};

  function toggle(key: string, id: string, max: number) {
    const picked = current[key] ?? [];
    const next = picked.includes(id)
      ? picked.filter(x => x !== id)
      : picked.length >= max ? picked : [...picked, id];
    onChange({ ...current, [key]: next });
  }

  return (
    <div className={cn('space-y-3', compact ? 'text-xs' : 'text-sm')}>
      {groups.map(group => {
        const max = picksAllowed(group, classLevel);
        const picked = current[group.key] ?? [];
        const outstanding = picked.length < max;
        return (
          <div key={group.key} className="bg-slate-900 border border-amber-700/40 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-slate-400">{group.label}</span>
              <span className={cn('text-xs font-bold', outstanding ? 'text-amber-300' : 'text-green-400')}>
                {picked.length} / {max}{outstanding ? ' — choice required' : ''}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.choices.map(c => {
                const on = picked.includes(c.id);
                // A level-gated option (Rune Knight's Hill and Storm runes) is offered only once
                // the character qualifies; the level lives in the choice name, per the book.
                const gate = /\((\d+)(?:st|nd|rd|th)\)/.exec(c.name);
                const locked = gate ? classLevel < Number(gate[1]) : false;
                const full = !on && picked.length >= max;
                return (
                  <button
                    key={c.id}
                    disabled={locked || full}
                    onClick={() => toggle(group.key, c.id, max)}
                    title={locked ? `Available at level ${gate?.[1]}` : c.description}
                    className={cn(
                      'px-2 py-1 rounded border text-xs transition-colors text-left',
                      on ? 'border-red-500 bg-red-950/40 text-white'
                         : 'border-slate-600 text-slate-300 hover:text-white',
                      (locked || full) && 'opacity-30 cursor-not-allowed',
                    )}
                  >
                    {c.name}
                    {c.description && <span className="block text-[10px] text-slate-400">{c.description}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
