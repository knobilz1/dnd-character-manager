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

type Tier = 'crit-fail' | 'bad' | 'neutral' | 'good' | 'crit-success';

function getTier(result: number, die: Die): Tier {
  if (result === 1) return 'crit-fail';
  if (result === die) return 'crit-success';
  const pct = result / die;
  if (pct <= 0.5) return 'bad';
  if (pct <= 0.7) return 'neutral';
  return 'good';
}

const TIER: Record<Tier, { color: string; shadow: string; flash: string; anim: string; scale: number; label: string }> = {
  'crit-fail':    { color: '#ef4444', shadow: '0 0 30px #dc2626, 0 0 70px #991b1b, 0 0 120px #7f1d1d', flash: '#7f1d1d', anim: 'dice-crit-fail 0.9s forwards',    scale: 1.7,  label: '💀 Critical Fail' },
  'bad':          { color: '#f87171', shadow: '0 0 18px #dc262688, 0 0 40px #dc262644',                 flash: '#3b0000', anim: 'dice-land-bad 0.55s forwards',      scale: 1.0,  label: '' },
  'neutral':      { color: '#fbbf24', shadow: '0 0 18px #fbbf2488, 0 0 40px #fbbf2444',                 flash: '#3b2000', anim: 'dice-land 0.55s forwards',          scale: 1.0,  label: '' },
  'good':         { color: '#4ade80', shadow: '0 0 18px #4ade8088, 0 0 40px #4ade8044',                 flash: '#003b15', anim: 'dice-land-good 0.55s forwards',     scale: 1.0,  label: '' },
  'crit-success': { color: '#bbf7d0', shadow: '0 0 30px #4ade80, 0 0 60px #22c55e, 0 0 110px #166534', flash: '#003b15', anim: 'dice-crit-success 0.9s forwards',  scale: 1.15, label: '🎉 Natural 20!' },
};

const SPARKS = [0, 45, 90, 135, 180, 225, 270, 315];

const DIE_SHAPE: Record<Die, React.ReactElement> = {
  4:   <polygon points="50,5 93,87 7,87" />,
  6:   <rect x="10" y="10" width="80" height="80" rx="6" />,
  8:   <polygon points="50,6 90,50 50,94 10,50" />,
  10:  <polygon points="50,5 88,54 50,94 12,54" />,
  12:  <polygon points="50,8 90,37 75,84 25,84 10,37" />,
  20:  <polygon points="50,12 88,78 12,78" />,
  100: <circle cx="50" cy="50" r="43" />,
};

interface HistoryEntry { die: Die; result: number; tier: Tier }

export function DiceRoller() {
  const [open, setOpen] = React.useState(false);
  const [activeDie, setActiveDie] = React.useState<Die | null>(null);
  const [display, setDisplay] = React.useState<number | null>(null);
  const [tier, setTier] = React.useState<Tier>('neutral');
  const [resultKey, setResultKey] = React.useState(0);
  const [rolling, setRolling] = React.useState(false);
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const y = Math.max(0, Math.min(e.clientY - dragOffset.current.y, window.innerHeight - (panelRef.current?.offsetHeight ?? 420)));
      setPos({ x, y });
    }
    function onUp() { dragging.current = false; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  function roll(sides: Die) {
    if (rolling) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setActiveDie(sides);
    setRolling(true);

    let frame = 0;
    const frames = 22;
    const delay = (f: number) => f < frames * 0.5 ? 30 : f < frames * 0.75 ? 55 : f < frames * 0.9 ? 90 : 130;

    const tick = () => {
      frame++;
      setDisplay(Math.ceil(Math.random() * sides));
      if (frame < frames) {
        timerRef.current = setTimeout(tick, delay(frame));
      } else {
        const result = Math.ceil(Math.random() * sides);
        const t = getTier(result, sides);
        setDisplay(result);
        setTier(t);
        setResultKey(k => k + 1);
        setHistory(h => [{ die: sides, result, tier: t }, ...h].slice(0, 8));
        setRolling(false);
      }
    };
    timerRef.current = setTimeout(tick, 30);
  }

  React.useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const t = TIER[tier];
  const isCritFail = tier === 'crit-fail';
  const isCritSuccess = tier === 'crit-success';

  const TIER_HISTORY_COLOR: Record<Tier, string> = {
    'crit-fail': '#ef444488',
    'bad': '#f8717188',
    'neutral': '#fbbf2488',
    'good': '#4ade8088',
    'crit-success': '#fde04788',
  };

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
          {/* Header */}
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

          {/* Result area */}
          <div
            className="flex flex-col items-center justify-center min-h-[140px] relative overflow-hidden py-4"
            style={rolling ? { animation: 'dice-shake 0.12s infinite' } : undefined}
          >
            {/* Background flash */}
            {display !== null && !rolling && (
              <div
                key={`flash-${resultKey}`}
                className="absolute inset-0 pointer-events-none"
                style={{ background: t.flash, animation: 'dice-flash 0.7s ease-out forwards' }}
              />
            )}

            {/* Die shape outline */}
            {activeDie !== null && (
              <svg
                viewBox="0 0 100 100"
                className="absolute pointer-events-none"
                style={{ width: 160, height: 160, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: rolling ? 0.1 : 0.2 }}
              >
                <g fill="none" stroke={rolling ? '#64748b' : t.color} strokeWidth="2.5">
                  {DIE_SHAPE[activeDie]}
                </g>
              </svg>
            )}

            {/* Celebration sparks for nat 20 */}
            {isCritSuccess && !rolling && display !== null && (
              <div key={`sparks-${resultKey}`} className="absolute inset-0 pointer-events-none flex items-center justify-center">
                {SPARKS.map((deg, i) => (
                  <div
                    key={i}
                    className="absolute w-1.5 h-1.5 rounded-full"
                    style={{
                      background: ['#fde047','#fb923c','#4ade80','#60a5fa','#c084fc','#f472b6','#fde047','#4ade80'][i],
                      animation: `spark-out 0.7s ${i * 0.04}s ease-out forwards`,
                      '--deg': `${deg}deg`,
                    } as React.CSSProperties}
                  />
                ))}
              </div>
            )}

            {display !== null ? (
              <>
                <div
                  key={resultKey}
                  className="font-black tabular-nums relative z-10 leading-none"
                  style={rolling
                    ? { color: '#64748b', filter: 'blur(2px)', fontSize: '4.5rem', transform: 'scale(0.9)' }
                    : {
                        fontSize: isCritFail ? '6rem' : isCritSuccess ? '5.5rem' : '4.5rem',
                        color: t.color,
                        textShadow: t.shadow,
                        animation: t.anim,
                        transform: `scale(${t.scale})`,
                      }
                  }
                >
                  {display}
                </div>
                <p
                  className="text-xs mt-3 relative z-10 font-semibold"
                  style={{ color: rolling ? '#475569' : t.color, opacity: rolling ? 1 : 0.85 }}
                >
                  {rolling
                    ? `Rolling d${activeDie}…`
                    : t.label || `d${activeDie}`}
                </p>
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
                style={activeDie === sides && !rolling ? { boxShadow: `0 0 14px ${DIE_STYLE[sides].glow}99` } : undefined}
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
                    className="text-xs bg-slate-800 border rounded px-2 py-0.5 text-slate-300"
                    style={{ borderColor: TIER_HISTORY_COLOR[h.tier] }}
                  >
                    d{h.die} <span className="font-bold" style={{ color: TIER[h.tier].color }}>{h.result}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes dice-shake {
          0%   { transform: translate(0,0) rotate(0deg); }
          20%  { transform: translate(-4px,2px) rotate(-4deg); }
          40%  { transform: translate(4px,-2px) rotate(4deg); }
          60%  { transform: translate(-3px,3px) rotate(-3deg); }
          80%  { transform: translate(3px,-1px) rotate(3deg); }
          100% { transform: translate(-1px,1px) rotate(-1deg); }
        }
        @keyframes dice-land {
          0%   { transform: perspective(600px) rotateX(90deg) scale(0.3); opacity:0; }
          45%  { transform: perspective(600px) rotateX(-18deg) scale(1.35); opacity:1; }
          70%  { transform: perspective(600px) rotateX(8deg) scale(0.95); }
          85%  { transform: perspective(600px) rotateX(-4deg) scale(1.04); }
          100% { transform: perspective(600px) rotateX(0deg) scale(1); }
        }
        @keyframes dice-land-bad {
          0%   { transform: perspective(600px) rotateX(90deg) scale(0.3); opacity:0; }
          40%  { transform: perspective(600px) rotateX(-10deg) scale(1.1); opacity:1; }
          70%  { transform: perspective(600px) rotateX(4deg) scale(0.97); }
          100% { transform: perspective(600px) rotateX(0deg) scale(1); }
        }
        @keyframes dice-land-good {
          0%   { transform: perspective(600px) rotateX(90deg) scale(0.3); opacity:0; }
          40%  { transform: perspective(600px) rotateX(-22deg) scale(1.45); opacity:1; }
          65%  { transform: perspective(600px) rotateX(10deg) scale(0.92); }
          80%  { transform: perspective(600px) rotateX(-5deg) scale(1.06); }
          100% { transform: perspective(600px) rotateX(0deg) scale(1); }
        }
        @keyframes dice-crit-fail {
          0%   { transform: scale(0.2) rotate(-15deg); opacity:0; filter:blur(8px); }
          25%  { transform: scale(1.9) rotate(3deg); opacity:1; filter:blur(0); }
          35%  { transform: scale(1.7) rotate(-6deg) translateX(-8px); }
          45%  { transform: scale(1.72) rotate(6deg) translateX(8px); }
          55%  { transform: scale(1.70) rotate(-4deg) translateX(-5px); }
          65%  { transform: scale(1.71) rotate(4deg) translateX(5px); }
          75%  { transform: scale(1.70) rotate(-2deg) translateX(-2px); }
          85%  { transform: scale(1.71) rotate(1deg); }
          100% { transform: scale(1.7) rotate(0deg); }
        }
        @keyframes dice-crit-success {
          0%   { transform: scale(0.1) rotate(-30deg); opacity:0; }
          30%  { transform: scale(1.4) rotate(8deg); opacity:1; }
          50%  { transform: scale(0.95) rotate(-4deg); }
          65%  { transform: scale(1.3) rotate(3deg); }
          80%  { transform: scale(1.05) rotate(-2deg); }
          90%  { transform: scale(1.18) rotate(1deg); }
          100% { transform: scale(1.15) rotate(0deg); }
        }
        @keyframes dice-flash {
          0%   { opacity:0.22; }
          100% { opacity:0; }
        }
        @keyframes spark-out {
          0%   { transform: rotate(var(--deg)) translateX(0) scale(1); opacity:1; }
          100% { transform: rotate(var(--deg)) translateX(70px) scale(0); opacity:0; }
        }
      `}</style>
    </>
  );
}
