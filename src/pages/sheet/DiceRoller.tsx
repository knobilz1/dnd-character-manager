import React from 'react';
import { Dice5, X } from 'lucide-react';
import { cn } from '../../utils/cn';

const DICE = [4, 6, 8, 10, 12, 20, 100] as const;
type Die = typeof DICE[number];

const DIE_STYLE: Record<Die, { btn: string; label: string }> = {
  4:   { btn: 'from-red-800 to-red-950 border-red-600 hover:border-red-400',     label: 'D4'   },
  6:   { btn: 'from-orange-800 to-orange-950 border-orange-600 hover:border-orange-400', label: 'D6'  },
  8:   { btn: 'from-yellow-700 to-yellow-950 border-yellow-600 hover:border-yellow-400', label: 'D8'  },
  10:  { btn: 'from-green-800 to-green-950 border-green-600 hover:border-green-400',   label: 'D10' },
  12:  { btn: 'from-teal-800 to-teal-950 border-teal-600 hover:border-teal-400',     label: 'D12' },
  20:  { btn: 'from-blue-800 to-blue-950 border-blue-600 hover:border-blue-400',     label: 'D20' },
  100: { btn: 'from-purple-800 to-purple-950 border-purple-600 hover:border-purple-400', label: 'D100'},
};

interface HistoryEntry { die: Die; result: number }

export function DiceRoller() {
  const [open, setOpen] = React.useState(false);
  const [activeDie, setActiveDie] = React.useState<Die | null>(null);
  const [display, setDisplay] = React.useState<number | null>(null);
  const [resultKey, setResultKey] = React.useState(0);
  const [rolling, setRolling] = React.useState(false);
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  function roll(sides: Die) {
    if (rolling) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    setActiveDie(sides);
    setRolling(true);

    let frame = 0;
    const frames = 20;
    // Speed up then slow down
    const delay = (f: number) => f < frames * 0.6 ? 35 : f < frames * 0.85 ? 70 : 110;

    const tick = () => {
      frame++;
      setDisplay(Math.ceil(Math.random() * sides));
      if (frame < frames) {
        intervalRef.current = setTimeout(tick, delay(frame));
      } else {
        const result = Math.ceil(Math.random() * sides);
        setDisplay(result);
        setResultKey(k => k + 1);
        setHistory(h => [{ die: sides, result }, ...h].slice(0, 8));
        setRolling(false);
      }
    };
    intervalRef.current = setTimeout(tick, 35);
  }

  React.useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'p-1.5 rounded transition-colors',
          open ? 'text-red-400' : 'text-slate-500 hover:text-red-400',
        )}
        title="Dice roller"
      >
        <Dice5 size={18} />
      </button>

      {open && (
        <div className="fixed bottom-6 right-6 z-40 w-72 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800 border-b border-slate-700">
            <span className="text-sm font-bold text-white flex items-center gap-2">
              <Dice5 size={14} className="text-red-400" /> Dice Roller
            </span>
            <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white transition-colors">
              <X size={14} />
            </button>
          </div>

          {/* Result display */}
          <div className="flex flex-col items-center justify-center py-5 min-h-[100px]">
            {display !== null ? (
              <>
                <div
                  key={resultKey}
                  className={cn(
                    'text-6xl font-black tabular-nums transition-none',
                    rolling ? 'text-slate-400 scale-95' : 'text-white',
                  )}
                  style={!rolling ? { animation: 'dice-pop 0.35s cubic-bezier(0.34,1.56,0.64,1) both' } : undefined}
                >
                  {display}
                </div>
                {activeDie && (
                  <p className="text-xs text-slate-500 mt-1">
                    {rolling ? `Rolling d${activeDie}…` : `d${activeDie === 100 ? '100' : activeDie}`}
                  </p>
                )}
              </>
            ) : (
              <p className="text-slate-600 text-sm">Pick a die to roll</p>
            )}
          </div>

          {/* Dice grid */}
          <div className="grid grid-cols-4 gap-2 px-4 pb-3">
            {DICE.map(sides => (
              <button
                key={sides}
                onClick={() => roll(sides)}
                disabled={rolling}
                className={cn(
                  'bg-gradient-to-b border rounded-lg py-2 flex flex-col items-center gap-0.5 transition-all active:scale-95 disabled:opacity-40',
                  DIE_STYLE[sides].btn,
                  activeDie === sides && !rolling ? 'ring-2 ring-white/30' : '',
                  sides === 20 ? 'col-span-2' : '',
                )}
              >
                <span className="text-xs font-bold text-white">{DIE_STYLE[sides].label}</span>
              </button>
            ))}
          </div>

          {/* History */}
          {history.length > 0 && (
            <div className="px-4 pb-3 border-t border-slate-800 pt-2">
              <p className="text-[10px] text-slate-600 uppercase tracking-wide mb-1.5">Recent</p>
              <div className="flex flex-wrap gap-1.5">
                {history.map((h, i) => (
                  <span
                    key={i}
                    className="text-xs bg-slate-800 border border-slate-700 rounded px-2 py-0.5 text-slate-300"
                  >
                    d{h.die} <span className="text-white font-bold">{h.result}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pop animation keyframe */}
      <style>{`
        @keyframes dice-pop {
          0%   { transform: scale(0.4); opacity: 0; }
          70%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1);   opacity: 1; }
        }
      `}</style>
    </>
  );
}
