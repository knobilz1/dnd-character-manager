import { LANGUAGES } from '../data/languages';
import { cn } from '../utils/cn';

/**
 * The languages a character knows, plus whatever picks their race and background still owe.
 *
 * Exists because the race data expresses an unmade choice as a literal string in the languages
 * array — so a Human's sheet printed "Common, one extra language of your choice" and there was
 * nowhere to say it was Draconic. `known` is the resolved list (placeholders already stripped by
 * the derive); `owed` is how many more the player may choose.
 *
 * Languages already known are offered but disabled: picking Common a second time is not a choice,
 * and hiding it entirely reads as a missing option.
 */
export function LanguagePicker({ known, owed, selected, onChange, compact }: {
  known: string[];
  owed: number;
  selected: string[];
  onChange: (next: string[]) => void;
  compact?: boolean;
}) {
  if (owed === 0) return null;
  const picked = selected ?? [];
  const outstanding = picked.length < owed;
  // `known` already contains the picks, so the "do you have it another way" test has to exclude
  // them or every chosen language would immediately grey itself out.
  const fromElsewhere = new Set(known.filter(l => !picked.includes(l)));

  function toggle(lang: string) {
    onChange(picked.includes(lang)
      ? picked.filter(x => x !== lang)
      : picked.length >= owed ? picked : [...picked, lang]);
  }

  return (
    <div className={cn('bg-slate-900 border border-amber-700/40 rounded-lg p-3', compact ? 'text-xs' : 'text-sm')}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-slate-400">Languages — choose {owed}</span>
        <span className={cn('text-xs font-bold', outstanding ? 'text-amber-300' : 'text-green-400')}>
          {picked.length} / {owed}{outstanding ? ' — choice required' : ''}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {LANGUAGES.map(lang => {
          const on = picked.includes(lang);
          const already = fromElsewhere.has(lang);
          const full = !on && picked.length >= owed;
          return (
            <button
              key={lang}
              disabled={already || full}
              onClick={() => toggle(lang)}
              title={already ? 'Already known from your race or background' : undefined}
              className={cn(
                'px-2 py-1 rounded border text-xs transition-colors',
                on ? 'border-red-500 bg-red-950/40 text-white'
                   : 'border-slate-600 text-slate-300 hover:text-white',
                (already || full) && 'opacity-30 cursor-not-allowed',
              )}
            >
              {lang}
            </button>
          );
        })}
      </div>
    </div>
  );
}
