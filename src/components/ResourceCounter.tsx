import { cn } from '../utils/cn';

/** Above this many uses, a row of dots stops being readable (and stops fitting), so
 *  the counter switches to a numeric stepper. Everything at or below it keeps the
 *  familiar pips — Rages, Ki, Channel Divinity, Sorcery Points and the rest are all
 *  20 or fewer at level 20, so this changes nothing for them. */
const PIP_LIMIT = 20;

/** Shared counter for a resource card.
 *
 *  This exists because call sites drift apart: each clamped the pip row to 20, but a
 *  copy also computed the NEXT value from that clamped number. A level-20 paladin has
 *  100 Lay on Hands points; spending one set the pool to 19, destroying 80 points
 *  silently. The rule the component enforces is that the display may be summarised,
 *  but the value written back is always derived from `current`.
 *
 *  It lives here, outside any page, because that is the only thing that actually stops
 *  the drift: the sheet had this fixed for months while the sidebar's hand-rolled copy
 *  still wrote back the clamped value (found again 2026-08-15). One component, every
 *  call site — a future resource UI cannot reintroduce the bug by copying the markup.
 */
export function ResourceCounter({ current, max, onChange }: {
  current: number; max: number; onChange: (next: number) => void;
}) {
  // 99 is the 'unlimited' sentinel (e.g. Archdruid's Wild Shape). There is nothing to
  // spend, so there is nothing to count — the old UI showed "99 / ∞" beside 20 pips,
  // which read as though 99 were a real remaining total.
  if (max === 99) {
    return <p className="text-sm text-slate-300">∞ — no limit</p>;
  }
  if (max > PIP_LIMIT) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => onChange(Math.max(0, current - 1))}
          disabled={current <= 0}
          className="w-6 h-6 rounded border border-slate-600 text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-30 transition-colors leading-none"
          title="Use one"
        >−</button>
        <span className="text-sm font-medium text-white tabular-nums">{current} / {max}</span>
        <button
          onClick={() => onChange(Math.min(max, current + 1))}
          disabled={current >= max}
          className="w-6 h-6 rounded border border-slate-600 text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-30 transition-colors leading-none"
          title="Restore one"
        >+</button>
      </div>
    );
  }
  return (
    <div className="flex gap-1.5 flex-wrap">
      {Array.from({ length: max }).map((_, i) => {
        const available = i < current;
        return (
          <button
            key={i}
            onClick={() => onChange(available ? current - 1 : current + 1)}
            className={cn(
              'w-5 h-5 rounded-full border-2 transition-all',
              available
                ? 'border-blue-400 bg-blue-400/30 hover:bg-blue-400/50'
                : 'border-slate-600 bg-transparent hover:border-slate-400',
            )}
            title={available ? 'Use one' : 'Restore one'}
          />
        );
      })}
    </div>
  );
}
