import React from 'react';
import { Dice5, X } from 'lucide-react';
import { cn } from '../../utils/cn';

const DICE = [4, 6, 8, 10, 12, 20, 100] as const;
type Die = typeof DICE[number];

const DIE_STYLE: Record<Die, { btn: string; label: string; glow: string }> = {
  4:   { btn: 'from-red-800 to-red-950 border-red-600 hover:border-red-400',         label: 'D4',   glow: '#f87171' },
  6:   { btn: 'from-orange-800 to-orange-950 border-orange-600 hover:border-orange-400', label: 'D6',   glow: '#fb923c' },
  8:   { btn: 'from-yellow-700 to-yellow-950 border-yellow-600 hover:border-yellow-400', label: 'D8',   glow: '#facc15' },
  10:  { btn: 'from-green-800 to-green-950 border-green-600 hover:border-green-400',     label: 'D10',  glow: '#4ade80' },
  12:  { btn: 'from-teal-800 to-teal-950 border-teal-600 hover:border-teal-400',         label: 'D12',  glow: '#2dd4bf' },
  20:  { btn: 'from-blue-800 to-blue-950 border-blue-600 hover:border-blue-400',         label: 'D20',  glow: '#60a5fa' },
  100: { btn: 'from-purple-800 to-purple-950 border-purple-600 hover:border-purple-400', label: 'D100', glow: '#c084fc' },
};

interface HistoryEntry { die: Die; result: number }

export function DiceRoller() {
  const [open, setOpen] = React.useState(false);
  const [activeDie, setActiveDie] = React.useState<Die | null>(null);
  const [display, setDisplay] = React.useState<number | null>(null);
  const [resultKey, setResultKey] = React.useState(0);
  const [rolling, setRolling] = React.useState(false);
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const intervalRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drag state
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const dragging = React.useRef(false);
  const dragOffset = React.useRef({ x: 0, y: 0 });
  const panelRef = React.useRef<HTMLDivElement>(null);

  function onDragStart(e: React.MouseEvent) {
    if (!panelRef.current) return;
    dragging.current = true;
    const rect = panelRef.current.getBoundingClientRect();
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    e.preventDefault();
  }

  React.useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const x = Math.max(0, Math.min(e.clientX - dragOffset.current.x, window.innerWidth - (panelRef.current?.offsetWidth ?? 288)));
      const y = Math.max(0, Math.min(e.clientY - dragOffset.current.y, window.innerHeight - (panelRef.current?.offsetHeight ?? 400)));
      setPos({ x, y });
    }
    function onUp() { dragging.current = false; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  function roll(sides: Die) {
    if (rolling) return;
    if (intervalRef.current) clearTimeout(intervalRef.current);
    setActiveDie(sides);
    setRolling(true);

    let frame = 0;
    const frames = 22;
    const delay = (f: number) => f < frames * 0.5 ? 30 : f < frames * 0.75 ? 55 : f < frames * 0.9 ? 90 : 130;

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
    intervalRef.current = setTimeout(tick, 30);
  }

  React.useEffect(() => () => { if (intervalRef.current) clearTimeout(intervalRef.current); }, []);

  const glowColor = activeDie ? DIE_STYLE[activeDie].glow : '#ffffff';

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn('p-1.5 rounded transition-colors', open ? 'text-red-400' : 'text-slate-500 hover:text-red-400')}
        title="Dice roller"
      >
        <Dice5 size={18} />
      </button>

      {open && (
        <div
          ref={panelRef}
          className="fixed z-40 w-72 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden"
          style={pos ? { left: pos.x, top: pos.y } : { bottom: 24, right: 24 }}
        >
          {/* Header — drag handle */}
          <div
            className="flex items-center justify-between px-4 py-2.5 bg-slate-800 border-b border-slate-700 cursor-grab active:cursor-grabbing select-none"
            onMouseDown={onDragStart}
          >
            <span className="text-sm font-bold text-white flex items-center gap-2">
              <Dice5 size={14} className="text-red-400" /> Dice Roller
            </span>
            <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white transition-colors">
              <X size={14} />
            </button>
          </div>

          {/* Result display */}
          <div
            className="flex flex-col items-center justify-center py-6 min-h-[120px] relative overflow-hidden"
            style={rolling ? { animation: 'dice-shake 0.12s infinite' } : undefined}
          >
            {/* Background flash on land */}
            {display !== null && !rolling && (
              <div
                key={`flash-${resultKey}`}
                className="absolute inset-0 rounded-none pointer-events-none"
                style={{ animation: 'dice-flash 0.6s ease-out forwards', background: glowColor }}
              />
            )}

            {display !== null ? (
              <>
                <div
                  key={resultKey}
                  className="text-7xl font-black tabular-nums relative z-10"
                  style={rolling
                    ? { color: '#94a3b8', filter: 'blur(1.5px)', transform: 'scale(0.92)' }
                    : {
                        animation: 'dice-land 0.55s cubic-bezier(0.22, 1, 0.36, 1) both',
                        color: '#ffffff',
                        textShadow: `0 0 24px ${glowColor}, 0 0 60px ${glowColor}`,
                      }
                  }
                >
                  {display}
                </div>
                {activeDie && (
                  <p className="text-xs text-slate-500 mt-2 relative z-10">
                    {rolling ? `Rolling d${activeDie}…` : `d${activeDie}`}
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
                  'bg-gradient-to-b border rounded-lg py-2.5 flex flex-col items-center transition-all active:scale-90 disabled:opacity-40',
                  DIE_STYLE[sides].btn,
                  activeDie === sides && !rolling ? 'ring-2 ring-white/40 scale-105' : '',
                  sides === 20 ? 'col-span-2' : '',
                )}
                style={activeDie === sides && !rolling ? { boxShadow: `0 0 12px ${DIE_STYLE[sides].glow}88` } : undefined}
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
                    style={i === 0 ? { borderColor: DIE_STYLE[h.die].glow + '66' } : undefined}
                  >
                    d{h.die} <span className="text-white font-bold">{h.result}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes dice-shake {
          0%   { transform: translate(0, 0) rotate(0deg); }
          20%  { transform: translate(-4px, 2px) rotate(-4deg); }
          40%  { transform: translate(4px, -2px) rotate(4deg); }
          60%  { transform: translate(-3px, 3px) rotate(-3deg); }
          80%  { transform: translate(3px, -1px) rotate(3deg); }
          100% { transform: translate(-1px, 1px) rotate(-1deg); }
        }
        @keyframes dice-land {
          0%   { transform: perspective(600px) rotateX(90deg) scale(0.3); opacity: 0; }
          45%  { transform: perspective(600px) rotateX(-18deg) scale(1.35); opacity: 1; }
          70%  { transform: perspective(600px) rotateX(8deg) scale(0.95); }
          85%  { transform: perspective(600px) rotateX(-4deg) scale(1.04); }
          100% { transform: perspective(600px) rotateX(0deg) scale(1); }
        }
        @keyframes dice-flash {
          0%   { opacity: 0.18; }
          100% { opacity: 0; }
        }
      `}</style>
    </>
  );
}
