import { toolOptions, type ToolGrant } from '../data/tools';
import { cn } from '../utils/cn';

export interface ToolChoice {
  /** The grant string this choice came from — also its storage key. */
  text: string;
  grant: ToolGrant;
  picked: string[];
}

/**
 * One picker per tool grant, rather than one pooled picker.
 *
 * The grants are categorised — a bard's three picks must be musical instruments, a monk's single
 * pick may be artisan's tools OR an instrument — so pooling them would let instrument picks be
 * spent on smith's tools. Each grant keeps its own allowance and its own option list, and stores
 * under its own key.
 */
export function ToolPicker({ choices, value, onChange, compact }: {
  choices: ToolChoice[];
  value: Record<string, string[]> | undefined;
  onChange: (next: Record<string, string[]>) => void;
  compact?: boolean;
}) {
  if (choices.length === 0) return null;
  const current = value ?? {};

  function toggle(key: string, tool: string, max: number) {
    const picked = current[key] ?? [];
    const next = picked.includes(tool)
      ? picked.filter(x => x !== tool)
      : picked.length >= max ? picked : [...picked, tool];
    onChange({ ...current, [key]: next });
  }

  return (
    <div className={cn('space-y-2', compact ? 'text-xs' : 'text-sm')}>
      {choices.map(({ text, grant }) => {
        const picked = current[text] ?? [];
        const outstanding = picked.length < grant.count;
        return (
          <div key={text} className="bg-slate-900 border border-amber-700/40 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              {/* The grant's own wording is the label — it says exactly what may be chosen, and
                  restating it in our words would be one more thing to keep in sync. */}
              <span className="text-xs text-slate-400">{text}</span>
              <span className={cn('text-xs font-bold', outstanding ? 'text-amber-300' : 'text-green-400')}>
                {picked.length} / {grant.count}{outstanding ? ' — choice required' : ''}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {toolOptions(grant).map(tool => {
                const on = picked.includes(tool);
                const full = !on && picked.length >= grant.count;
                return (
                  <button
                    key={tool}
                    disabled={full}
                    onClick={() => toggle(text, tool, grant.count)}
                    className={cn(
                      'px-2 py-1 rounded border text-xs transition-colors',
                      on ? 'border-red-500 bg-red-950/40 text-white'
                         : 'border-slate-600 text-slate-300 hover:text-white',
                      full && 'opacity-30 cursor-not-allowed',
                    )}
                  >
                    {tool}
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
