import { cn } from '../utils/cn';

export interface ProficiencyChoice {
  /** Storage key AND display label. Grants are identified by their own wording, which says
   *  exactly what may be chosen; restating it in our words would be one more thing to keep
   *  in sync. Feat grants key on the feat id instead, and pass the label separately. */
  key: string;
  label: string;
  count: number;
  options: string[];
  /** Offered but not selectable — already held some other way. Shown rather than hidden, because
   *  a missing option reads as a bug while a greyed one reads as an explanation. */
  disabled?: string[];
  /** Display text for options whose stored value is an id — fighting styles, invocations,
   *  metamagic and maneuvers are all stored by id and would otherwise read "two-weapon-fighting".
   *  Skills, tools and weapons store their printed name and pass nothing. */
  labels?: Record<string, string>;
}

/**
 * One picker per grant, rather than one pooled picker.
 *
 * Grants are scoped — a bard's three picks must be musical instruments, a Squat Nimbleness pick
 * may only be Acrobatics or Athletics — so pooling them would let instrument picks be spent on
 * smith's tools. Each grant keeps its own allowance, its own option list and its own storage key.
 *
 * Started as the tool picker; feats needed exactly the same thing for skills, tools and weapons,
 * so it takes plain option lists now rather than a parsed tool grant.
 */
export function ProficiencyPicker({ title, choices, value, onChange, compact }: {
  title?: string;
  choices: ProficiencyChoice[];
  value: Record<string, string[]> | undefined;
  onChange: (next: Record<string, string[]>) => void;
  compact?: boolean;
}) {
  if (choices.length === 0) return null;
  const current = value ?? {};

  function toggle(key: string, option: string, max: number) {
    const picked = current[key] ?? [];
    const next = picked.includes(option)
      ? picked.filter(x => x !== option)
      : picked.length >= max ? picked : [...picked, option];
    onChange({ ...current, [key]: next });
  }

  return (
    <div className={cn('space-y-2', compact ? 'text-xs' : 'text-sm')}>
      {choices.map(({ key, label, count, options, disabled, labels }) => {
        const picked = current[key] ?? [];
        const outstanding = picked.length < count;
        const blocked = new Set(disabled ?? []);
        return (
          <div key={key} className="bg-slate-900 border border-amber-700/40 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-slate-400">{title ? `${title} — ${label}` : label}</span>
              <span className={cn('text-xs font-bold', outstanding ? 'text-amber-300' : 'text-green-400')}>
                {picked.length} / {count}{outstanding ? ' — choice required' : ''}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {options.map(option => {
                const on = picked.includes(option);
                const off = blocked.has(option) || (!on && picked.length >= count);
                return (
                  <button
                    key={option}
                    disabled={off}
                    onClick={() => toggle(key, option, count)}
                    title={blocked.has(option) ? 'Already held another way' : undefined}
                    className={cn(
                      'px-2 py-1 rounded border text-xs transition-colors',
                      on ? 'border-red-500 bg-red-950/40 text-white'
                         : 'border-slate-600 text-slate-300 hover:text-white',
                      off && 'opacity-30 cursor-not-allowed',
                    )}
                  >
                    {labels?.[option] ?? option}
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
