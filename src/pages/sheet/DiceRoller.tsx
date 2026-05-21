import React from 'react';
import { Dice5, X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useDiceStore } from '../../store/useDiceStore';

const DICE = [4, 6, 8, 10, 12, 20, 100] as const;
type Die = typeof DICE[number];
type Mode = 'normal' | 'advantage' | 'disadvantage';

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

const SHAKE_ANIM: Record<0 | 1 | 2, string> = {
  0: 'dice-shake-heavy 0.10s infinite',
  1: 'dice-shake-med   0.18s infinite',
  2: 'dice-shake-light 0.32s infinite',
};

const DIE_SHAPE: Record<Die, React.ReactElement> = {
  4:   <polygon points="50,5 93,87 7,87" />,
  6:   <rect x="10" y="10" width="80" height="80" rx="6" />,
  8:   <polygon points="50,6 90,50 50,94 10,50" />,
  10:  <polygon points="50,5 88,54 50,94 12,54" />,
  12:  <polygon points="50,8 86,29 86,71 50,92 14,71 14,29" />,
  20:  <polygon points="50,7 80,20 93,50 80,80 50,93 20,80 7,50 20,20" />,
  100: <circle cx="50" cy="50" r="43" />,
};

interface HistoryEntry { die: Die; result: number; tier: Tier; mode?: Mode }

// ── TwoDie ─────────────────────────────────────────────────────────────────
// Renders one die in the side-by-side advantage/disadvantage layout.
function TwoDie({ die, value, rolling, shakePhase, dieState, dir, resultKey, tier }: {
  die: Die;
  value: number | null;
  rolling: boolean;
  shakePhase: 0 | 1 | 2;
  dieState: 'idle' | 'winner' | 'loser';
  dir: 'left' | 'right'; // physical position of this die
  resultKey: number;
  tier: Tier;
}) {
  const t = TIER[tier];
  // winner lunges toward opposite side; loser gets smacked in the same direction as lunge
  const winnerAnim = dir === 'left'
    ? 'dice-winner-lunge-right 0.45s forwards'
    : 'dice-winner-lunge-left 0.45s forwards';
  const loserAnim = dir === 'left'
    ? 'dice-smacked-left 0.9s 0.12s forwards'
    : 'dice-smacked-right 0.9s 0.12s forwards';

  const anim = dieState === 'winner' ? winnerAnim : dieState === 'loser' ? loserAnim : undefined;
  const color = dieState === 'winner' ? t.color : dieState === 'loser' ? '#475569' : '#64748b';
  const shadow = dieState === 'winner' ? t.shadow : undefined;

  const EXPLOSION_COLORS = ['#f59e0b','#ef4444','#fbbf24','#f97316','#fde047','#fb923c','#ef4444','#fbbf24'];
  const EXPLOSION_DEGS = [0, 45, 90, 135, 180, 225, 270, 315];

  return (
    <div
      className="relative flex flex-col items-center justify-center"
      style={{ width: 80, height: 80 }}
    >
      {/* Comical explosion — fires when this die loses */}
      {dieState === 'loser' && (
        <div key={`exp-${resultKey}-${dir}`} className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          {/* 💥 emoji burst */}
          <span
            style={{
              fontSize: '2.4rem',
              position: 'absolute',
              animation: 'smack-boom 0.65s 0.12s ease-out forwards',
              opacity: 0,
              lineHeight: 1,
            }}
          >💥</span>
          {/* Radiating particles */}
          {EXPLOSION_DEGS.map((deg, i) => (
            <div
              key={i}
              className="absolute rounded-full"
              style={{
                width: 7, height: 7,
                background: EXPLOSION_COLORS[i],
                animation: `smack-particle 0.55s ${0.12 + i * 0.018}s ease-out forwards`,
                opacity: 0,
                '--deg': `${deg}deg`,
              } as React.CSSProperties}
            />
          ))}
          {/* Star flashes */}
          {[22, 112, 202, 292].map((deg, i) => (
            <div
              key={`star-${i}`}
              className="absolute"
              style={{
                fontSize: '0.85rem',
                animation: `smack-particle 0.48s ${0.15 + i * 0.03}s ease-out forwards`,
                opacity: 0,
                '--deg': `${deg}deg`,
              } as React.CSSProperties}
            >★</div>
          ))}
        </div>
      )}

      {/* Die shape outline */}
      {die != null && (
        <svg
          viewBox="0 0 100 100"
          className="absolute pointer-events-none"
          style={{ width: 76, height: 76, top: 2, left: 2, opacity: rolling ? 0.12 : dieState === 'loser' ? 0.18 : 0.25 }}
        >
          <g fill="none" stroke={color} strokeWidth="2.5">{DIE_SHAPE[die]}</g>
        </svg>
      )}
      {/* Number */}
      {value !== null && (
        <span
          key={`${resultKey}-${dir}`}
          className="font-black tabular-nums relative z-10 leading-none select-none"
          style={rolling
            ? { color: '#64748b', filter: ['blur(2px)', 'blur(1px)', 'none'][shakePhase], fontSize: '2.2rem' }
            : {
                fontSize: dieState === 'winner' ? '2.5rem' : '2rem',
                color,
                textShadow: shadow,
                animation: anim,
              }
          }
        >
          {value}
        </span>
      )}
    </div>
  );
}

// Exhaustion reminders shown under roll results.
const EXHAUSTION_REMINDER: Record<number, string> = {
  1: 'Disadvantage on ability checks (Exhaustion 1)',
  2: 'Disadvantage on ability checks · Speed halved (Exhaustion 2)',
  3: 'Disadvantage on checks, attacks & saves (Exhaustion 3)',
  4: 'Disadvantage on checks, attacks & saves · HP max halved (Exhaustion 4)',
  5: 'Disadvantage on all rolls · Speed 0 · HP max halved (Exhaustion 5)',
  6: '☠ Dead (Exhaustion 6)',
};

// ── Main component ──────────────────────────────────────────────────────────
export function DiceRoller({ exhaustionLevel = 0 }: { exhaustionLevel?: number }) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>('normal');
  const [activeDie, setActiveDie] = React.useState<Die | null>(null);

  // Single-die state
  const [display, setDisplay] = React.useState<number | null>(null);
  const [tier, setTier] = React.useState<Tier>('neutral');
  const [resultKey, setResultKey] = React.useState(0);

  // Two-dice state
  const [twoDisplay, setTwoDisplay] = React.useState<{ v1: number; v2: number } | null>(null);
  const [twoFinal, setTwoFinal] = React.useState<{ v1: number; v2: number; winner: 1 | 2 } | null>(null);

  const [rolling, setRolling] = React.useState(false);
  const [shakePhase, setShakePhase] = React.useState<0 | 1 | 2>(0);
  const [history, setHistory] = React.useState<HistoryEntry[]>([]);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // External trigger state (skill/save/initiative rolls)
  const [rollModifier, setRollModifier] = React.useState<number | null>(null);
  const [rollLabel, setRollLabel] = React.useState<string | null>(null);
  const { pending, consume } = useDiceStore();

  // Watch for pending external rolls
  React.useEffect(() => {
    if (!pending) return;
    const req = consume();
    if (!req) return;
    const reqMode = req.mode ?? 'normal';
    setOpen(true);
    setMode(reqMode);
    setRollModifier(req.modifier);
    setRollLabel(req.label);
    if (reqMode !== 'normal') {
      rollTwo(req.die as Die, reqMode);
    } else {
      rollWithSides(req.die as Die);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  // Dragging
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

  React.useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  function rollWithSides(sides: Die) {
    if (timerRef.current) clearTimeout(timerRef.current);
    setActiveDie(sides);
    setRolling(true);
    setShakePhase(0);
    setTwoDisplay(null);
    setTwoFinal(null);

    let frame = 0;
    const frames = 28;
    const delay = (f: number) => Math.round(22 + Math.pow(f / frames, 2.5) * 300);

    const tick = () => {
      frame++;
      const progress = frame / frames;
      setShakePhase(progress < 0.45 ? 0 : progress < 0.75 ? 1 : 2);
      setDisplay(Math.ceil(Math.random() * sides));
      if (frame < frames) {
        timerRef.current = setTimeout(tick, delay(frame));
      } else {
        const result = Math.ceil(Math.random() * sides);
        const t = getTier(result, sides);
        setDisplay(result);
        setTier(t);
        setResultKey(k => k + 1);
        setHistory(h => [{ die: sides, result, tier: t, mode: 'normal' as Mode }, ...h].slice(0, 8));
        setRolling(false);
      }
    };
    timerRef.current = setTimeout(tick, 30);
  }

  function roll(sides: Die) {
    if (rolling) return;
    // Manual clicks always clear the external label
    setRollModifier(null);
    setRollLabel(null);
    if (mode !== 'normal') { rollTwo(sides); return; }
    rollWithSides(sides);
  }

  function rollTwo(sides: Die, modeOverride?: Mode) {
    if (rolling) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setActiveDie(sides);
    setRolling(true);
    setShakePhase(0);
    setTwoFinal(null);
    setDisplay(null);

    let frame = 0;
    const frames = 28;
    const delay = (f: number) => Math.round(22 + Math.pow(f / frames, 2.5) * 300);

    const tick = () => {
      frame++;
      const progress = frame / frames;
      setShakePhase(progress < 0.45 ? 0 : progress < 0.75 ? 1 : 2);
      setTwoDisplay({ v1: Math.ceil(Math.random() * sides), v2: Math.ceil(Math.random() * sides) });
      if (frame < frames) {
        timerRef.current = setTimeout(tick, delay(frame));
      } else {
        const v1 = Math.ceil(Math.random() * sides);
        const v2 = Math.ceil(Math.random() * sides);
        const effectiveMode = modeOverride ?? mode;
        // Advantage: take higher; disadvantage: take lower. Tie → die 1 wins.
        const winner: 1 | 2 = effectiveMode === 'advantage'
          ? (v1 >= v2 ? 1 : 2)
          : (v1 <= v2 ? 1 : 2);
        const finalVal = winner === 1 ? v1 : v2;
        const t = getTier(finalVal, sides);
        setTwoDisplay({ v1, v2 });
        setTwoFinal({ v1, v2, winner });
        setDisplay(finalVal);
        setTier(t);
        setResultKey(k => k + 1);
        setHistory(h => [{ die: sides, result: finalVal, tier: t, mode: effectiveMode }, ...h].slice(0, 8));
        setRolling(false);
      }
    };
    timerRef.current = setTimeout(tick, 30);
  }

  const t = TIER[tier];
  const isCritFail = tier === 'crit-fail';
  const isCritSuccess = tier === 'crit-success';
  const isTwoDice = mode !== 'normal';

  const TIER_HISTORY_COLOR: Record<Tier, string> = {
    'crit-fail': '#ef444488', 'bad': '#f8717188', 'neutral': '#fbbf2488',
    'good': '#4ade8088', 'crit-success': '#fde04788',
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
          className="fixed z-50 w-72 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden"
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

          {/* Mode toggle */}
          <div className="flex gap-1 px-4 pt-3 pb-1">
            {(['normal', 'advantage', 'disadvantage'] as Mode[]).map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setTwoDisplay(null); setTwoFinal(null); setDisplay(null); }}
                className={cn(
                  'flex-1 text-[11px] font-bold py-1 rounded border transition-all',
                  mode === m
                    ? m === 'advantage'   ? 'bg-green-800/60 border-green-500 text-green-300'
                    : m === 'disadvantage' ? 'bg-red-900/60 border-red-600 text-red-300'
                    : 'bg-slate-700 border-slate-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500',
                )}
              >
                {m === 'normal' ? 'Normal' : m === 'advantage' ? '⬆ ADV' : '⬇ DIS'}
              </button>
            ))}
          </div>

          {/* Exhaustion reminder — always visible when panel is open */}
          {exhaustionLevel >= 1 && EXHAUSTION_REMINDER[Math.min(exhaustionLevel, 6)] && (
            <div className="mx-4 mb-1 px-2.5 py-1.5 rounded-lg bg-orange-950/60 border border-orange-800/60 flex items-start gap-1.5">
              <span className="text-orange-400 text-[11px] shrink-0 mt-px">⚠</span>
              <p className="text-[11px] text-orange-300 leading-tight">
                {EXHAUSTION_REMINDER[Math.min(exhaustionLevel, 6)]}
              </p>
            </div>
          )}

          {/* Result area */}
          <div
            className="flex flex-col items-center justify-center min-h-[140px] relative overflow-hidden py-4"
            style={rolling ? { animation: SHAKE_ANIM[shakePhase] } : undefined}
          >
            {/* Background flash */}
            {display !== null && !rolling && !isTwoDice && (
              <div key={`flash-${resultKey}`} className="absolute inset-0 pointer-events-none"
                style={{ background: t.flash, animation: 'dice-flash 0.7s ease-out forwards' }} />
            )}
            {display !== null && !rolling && isTwoDice && (
              <div key={`flash2-${resultKey}`} className="absolute inset-0 pointer-events-none"
                style={{ background: t.flash, animation: 'dice-flash 0.7s ease-out forwards' }} />
            )}

            {isTwoDice ? (
              // ── Two-dice layout ──────────────────────────────────────────
              <>
                {twoDisplay !== null ? (
                  <div className="flex items-center justify-around w-full px-6 gap-2">
                    <TwoDie
                      die={activeDie!}
                      value={twoDisplay.v1}
                      rolling={rolling}
                      shakePhase={shakePhase}
                      dieState={rolling ? 'idle' : twoFinal ? (twoFinal.winner === 1 ? 'winner' : 'loser') : 'idle'}
                      dir="left"
                      resultKey={resultKey}
                      tier={twoFinal?.winner === 1 ? tier : 'neutral'}
                    />

                    {/* VS divider */}
                    <div className="flex flex-col items-center shrink-0">
                      <span className="text-[10px] font-bold text-slate-600">
                        {rolling ? '…' : mode === 'advantage' ? 'ADV' : 'DIS'}
                      </span>
                    </div>

                    <TwoDie
                      die={activeDie!}
                      value={twoDisplay.v2}
                      rolling={rolling}
                      shakePhase={shakePhase}
                      dieState={rolling ? 'idle' : twoFinal ? (twoFinal.winner === 2 ? 'winner' : 'loser') : 'idle'}
                      dir="right"
                      resultKey={resultKey}
                      tier={twoFinal?.winner === 2 ? tier : 'neutral'}
                    />
                  </div>
                ) : (
                  <p className="text-slate-600 text-sm">Pick a die to roll</p>
                )}

                {/* Winner result label */}
                {!rolling && twoFinal && display !== null && (
                  <>
                    <p className="text-xs mt-3 relative z-10 font-semibold" style={{ color: t.color }}>
                      {tier === 'crit-success'
                        ? activeDie === 20 ? '🎉 Natural 20!' : '🎉 Max roll!'
                        : tier === 'crit-fail'
                        ? '💀 Critical Fail'
                        : `${mode === 'advantage' ? '⬆ Adv' : '⬇ Dis'} → ${display} (took ${twoFinal.winner === 1 ? twoFinal.v1 : twoFinal.v2})`}
                    </p>
                  </>
                )}
              </>
            ) : (
              // ── Single-die layout (unchanged) ───────────────────────────
              <>
                {/* Die shape outline */}
                {activeDie !== null && (
                  <svg viewBox="0 0 100 100" className="absolute pointer-events-none"
                    style={{ width: 160, height: 160, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', opacity: rolling ? 0.1 : 0.2 }}>
                    <g fill="none" stroke={rolling ? '#64748b' : t.color} strokeWidth="2.5">
                      {DIE_SHAPE[activeDie]}
                    </g>
                  </svg>
                )}

                {/* Celebration sparks */}
                {isCritSuccess && !rolling && display !== null && (
                  <div key={`sparks-${resultKey}`} className="absolute inset-0 pointer-events-none flex items-center justify-center">
                    {SPARKS.map((deg, i) => (
                      <div key={i} className="absolute w-1.5 h-1.5 rounded-full"
                        style={{ background: ['#fde047','#fb923c','#4ade80','#60a5fa','#c084fc','#f472b6','#fde047','#4ade80'][i],
                          animation: `spark-out 0.7s ${i * 0.04}s ease-out forwards`, '--deg': `${deg}deg` } as React.CSSProperties} />
                    ))}
                  </div>
                )}

                {display !== null ? (
                  <>
                    {/* Roll label (skill name, save name, etc.) */}
                    {rollLabel && !rolling && (
                      <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1 relative z-10">{rollLabel}</p>
                    )}
                    <div key={resultKey} className="font-black tabular-nums relative z-10 leading-none"
                      style={rolling
                        ? { color: '#64748b', filter: ['blur(2px)','blur(1px)','none'][shakePhase], fontSize: rollModifier !== null ? '3.5rem' : '4.5rem', transform: ['scale(0.88)','scale(0.94)','scale(1)'][shakePhase] }
                        : { fontSize: isCritFail ? '6rem' : isCritSuccess ? '5.5rem' : (rollModifier !== null ? '3.5rem' : '4.5rem'), color: t.color, textShadow: t.shadow, animation: t.anim, transform: `scale(${t.scale})` }
                      }>
                      {display}
                    </div>
                    {/* Modifier + total row */}
                    {rollModifier !== null && !rolling && (
                      <div className="flex items-center gap-1.5 mt-1 relative z-10">
                        <span className="text-slate-400 text-base font-bold">
                          {rollModifier >= 0 ? `+${rollModifier}` : `${rollModifier}`}
                        </span>
                        <span className="text-slate-500 text-base">=</span>
                        <span className="text-2xl font-black" style={{ color: t.color, textShadow: t.shadow }}>
                          {display + rollModifier}
                        </span>
                      </div>
                    )}
                    <p className="text-xs mt-2 relative z-10 font-semibold"
                      style={{ color: rolling ? '#475569' : t.color, opacity: rolling ? 1 : 0.85 }}>
                      {rolling ? `Rolling d${activeDie}…`
                        : tier === 'crit-success' ? activeDie === 20 ? '🎉 Natural 20!' : '🎉 Max roll!'
                        : t.label || `d${activeDie}`}
                    </p>
                  </>
                ) : (
                  <p className="text-slate-600 text-sm">Pick a die to roll</p>
                )}
              </>
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
                  <span key={i} className="text-xs bg-slate-800 border rounded px-2 py-0.5 text-slate-300"
                    style={{ borderColor: TIER_HISTORY_COLOR[h.tier] }}>
                    {h.mode === 'advantage' ? <span className="text-green-500 text-[10px]">▲ </span>
                      : h.mode === 'disadvantage' ? <span className="text-red-500 text-[10px]">▼ </span>
                      : null}
                    d{h.die} <span className="font-bold" style={{ color: TIER[h.tier].color }}>{h.result}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes dice-shake-heavy {
          0%   { transform: translate(0,0) rotate(0deg); }
          20%  { transform: translate(-5px,3px) rotate(-5deg); }
          40%  { transform: translate(5px,-3px) rotate(5deg); }
          60%  { transform: translate(-4px,3px) rotate(-3deg); }
          80%  { transform: translate(4px,-2px) rotate(3deg); }
          100% { transform: translate(-2px,1px) rotate(-1deg); }
        }
        @keyframes dice-shake-med {
          0%   { transform: translate(0,0) rotate(0deg); }
          20%  { transform: translate(-2px,1px) rotate(-2deg); }
          40%  { transform: translate(2px,-1px) rotate(2deg); }
          60%  { transform: translate(-2px,2px) rotate(-1.5deg); }
          80%  { transform: translate(2px,-1px) rotate(1deg); }
          100% { transform: translate(-1px,0px) rotate(-0.5deg); }
        }
        @keyframes dice-shake-light {
          0%   { transform: translate(0,0) rotate(0deg); }
          20%  { transform: translate(-1px,0px) rotate(-0.8deg); }
          40%  { transform: translate(1px,-1px) rotate(0.8deg); }
          60%  { transform: translate(-1px,0px) rotate(-0.4deg); }
          80%  { transform: translate(0px,-1px) rotate(0.4deg); }
          100% { transform: translate(0px,0px) rotate(0deg); }
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
        /* Two-dice: winner lunges toward the opposite die */
        @keyframes dice-winner-lunge-right {
          0%   { transform: translateX(0) scale(1); }
          22%  { transform: translateX(28px) scale(1.3); }
          40%  { transform: translateX(4px) scale(1.22); }
          60%  { transform: translateX(10px) scale(1.25); }
          78%  { transform: translateX(2px) scale(1.18); }
          100% { transform: translateX(0) scale(1.2); }
        }
        @keyframes dice-winner-lunge-left {
          0%   { transform: translateX(0) scale(1); }
          22%  { transform: translateX(-28px) scale(1.3); }
          40%  { transform: translateX(-4px) scale(1.22); }
          60%  { transform: translateX(-10px) scale(1.25); }
          78%  { transform: translateX(-2px) scale(1.18); }
          100% { transform: translateX(0) scale(1.2); }
        }
        /* Two-dice: loser gets violently smacked out of frame */
        @keyframes dice-smacked-left {
          0%   { transform: translateX(0)    rotate(0deg)   scale(1);    opacity: 1; }
          6%   { transform: translateX(10px)  rotate(12deg)  scale(1.15); opacity: 1; }
          18%  { transform: translateX(-30px) rotate(-35deg) scale(0.85); opacity: 1; }
          32%  { transform: translateX(-80px) rotate(-75deg) scale(0.65); opacity: 0.9; }
          55%  { transform: translateX(-160px) rotate(-130deg) scale(0.38); opacity: 0.55; }
          100% { transform: translateX(-300px) rotate(-200deg) scale(0.05); opacity: 0; }
        }
        @keyframes dice-smacked-right {
          0%   { transform: translateX(0)    rotate(0deg)   scale(1);    opacity: 1; }
          6%   { transform: translateX(-10px) rotate(-12deg) scale(1.15); opacity: 1; }
          18%  { transform: translateX(30px)  rotate(35deg)  scale(0.85); opacity: 1; }
          32%  { transform: translateX(80px)  rotate(75deg)  scale(0.65); opacity: 0.9; }
          55%  { transform: translateX(160px) rotate(130deg) scale(0.38); opacity: 0.55; }
          100% { transform: translateX(300px) rotate(200deg) scale(0.05); opacity: 0; }
        }
        /* Explosion emoji pop */
        @keyframes smack-boom {
          0%   { transform: scale(0) rotate(-15deg); opacity: 0; }
          25%  { transform: scale(1.6) rotate(8deg);  opacity: 1; }
          55%  { transform: scale(1.3) rotate(-4deg); opacity: 0.85; }
          80%  { transform: scale(1.1) rotate(2deg);  opacity: 0.4; }
          100% { transform: scale(0.8) rotate(0deg);  opacity: 0; }
        }
        /* Explosion particles & stars */
        @keyframes smack-particle {
          0%   { transform: rotate(var(--deg)) translateX(0px)  scale(1.2); opacity: 1; }
          40%  { opacity: 1; }
          100% { transform: rotate(var(--deg)) translateX(52px) scale(0);   opacity: 0; }
        }
      `}</style>
    </>
  );
}
