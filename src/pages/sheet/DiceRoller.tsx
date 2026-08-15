import React from 'react';
import { Dice5, X, Send } from 'lucide-react';
import { cn } from '../../utils/cn';
import { useDiceStore } from '../../store/useDiceStore';
import { useCharacterStore } from '../../store/useCharacterStore';
import { useDmConnection } from '../../hooks/useDmConnection';
import { useSettingsStore } from '../../store/useSettingsStore';
import { sendTalkToDM } from '../../utils/dmConnect';

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

/**
 * The "18 +5 +3d4 = 26" line under a settled roll.
 *
 * One component because the panel renders this twice — once for advantage/
 * disadvantage and once for a single die — and a rider added to only one of them
 * would make the total depend on how the roll happened to be made.
 */
function TotalRow({ display, modifier, rider, color, shadow, big }: {
  display: number;
  modifier: number | null;
  rider: { die: Die; value: number } | null;
  color: string;
  shadow: string;
  /** The single-die layout has more room than the adv/dis one. */
  big: boolean;
}) {
  if (modifier === null && rider === null) return null;
  return (
    <div className="flex items-center gap-1.5 mt-1 relative z-10">
      {modifier !== null && (
        <span className={cn('text-slate-400 font-bold', big ? 'text-base' : 'text-sm')}>
          {modifier >= 0 ? `+${modifier}` : `${modifier}`}
        </span>
      )}
      {rider !== null && (
        <span className={cn('text-amber-300 font-bold', big ? 'text-base' : 'text-sm')}
              title={`Rider: 1d${rider.die} rolled ${rider.value}`}>
          +{rider.value}
          <span className="text-amber-500/70 text-[10px] ml-0.5">d{rider.die}</span>
        </span>
      )}
      <span className={cn('text-slate-500', big ? 'text-base' : 'text-sm')}>=</span>
      <span className={cn('font-black', big ? 'text-2xl' : 'text-xl')} style={{ color, textShadow: shadow }}>
        {display + (modifier ?? 0) + (rider?.value ?? 0)}
      </span>
    </div>
  );
}

/** Sum of `count` fresh dice — the one place a roll's randomness comes from. */
function rollSum(sides: Die, count: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) total += Math.ceil(Math.random() * sides);
  return total;
}

/**
 * Tiering for a settled roll. `count` matters: the crit tiers are a d20 idea
 * (a natural 1 or a natural max on ONE die), and a 2 or a 12 on 2d6 is neither
 * — it's just the tail of a bell curve. So multi-die rolls get the proportional
 * tiers only, and never the "💀 Critical Fail" / "🎉 Natural 20!" banners.
 */
function getTier(result: number, die: Die, count = 1): Tier {
  const max = die * count;
  if (count === 1) {
    if (result === 1) return 'crit-fail';
    if (result === die) return 'crit-success';
  }
  const pct = result / max;
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

interface HistoryEntry { die: Die; count?: number; result: number; tier: Tier; mode?: Mode }

/** "d20" / "2d6" — how a roll of `count` dice is written. */
function dieLabel(die: Die, count = 1): string {
  return count > 1 ? `${count}d${die}` : `d${die}`;
}

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

/** Renders one settled roll as a text line for the DM — used by both the
 *  auto-send checkbox (labeled rolls only) and the manual "Send to DM" button
 *  (any roll). `label` absent means an unlabeled manual click; `modifier`
 *  absent means no modifier was attached (always the case for manual clicks —
 *  only external skill/save/initiative dispatches carry one). */
export function describeRollForDM(opts: {
  die: Die;
  count?: number;
  label: string | null;
  modifier: number | null;
  mode: Mode;
  result: number;
  two: { v1: number; v2: number; winner: 1 | 2 } | null;
  /** A Bless/Guidance/Bardic die added to this roll, if one was armed. */
  rider?: { die: Die; value: number } | null;
}): string {
  const { die, count, label, modifier, mode, result, two, rider } = opts;
  const prefix = label ? `${label}: ` : 'Rolled ';
  const rollPart = mode !== 'normal' && two
    ? `d${die} (${mode}) — rolled ${two.v1} and ${two.v2}, took ${result}`
    : `${dieLabel(die, count)} → ${result}`;
  // The rider has to reach the DM. Sending "18 + 5 = 23" for a roll the player
  // saw as 26 puts a number the table will act on out of step with the sheet.
  const riderPart = rider ? ` + ${rider.value} (1d${rider.die})` : '';
  const total = result + (modifier ?? 0) + (rider?.value ?? 0);
  const totalPart = modifier !== null || rider
    ? `${modifier !== null ? ` + ${modifier}` : ''}${riderPart} = ${total}`
    : '';
  return `${prefix}${rollPart}${totalPart}`;
}

// ── Main component ──────────────────────────────────────────────────────────
export function DiceRoller({ exhaustionLevel = 0, characterName }: { exhaustionLevel?: number; characterName?: string }) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<Mode>('normal');
  const [activeDie, setActiveDie] = React.useState<Die | null>(null);
  /** Dice summed into the current result — 1 for everything except damage. */
  const [activeCount, setActiveCount] = React.useState(1);

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
  // Tracks the label of the currently-running roll so we can broadcast it
  // to subscribers (e.g. death save auto-apply) once the animation settles.
  const rollLabelRef = React.useRef<string>('');
  // Mirrors rollLabelRef for the modifier — deliberately a ref, not read off
  // the rollModifier STATE variable, inside the settle callbacks below:
  // rollWithSides/rollTwo are called synchronously in the same effect tick as
  // setRollModifier, so their closures would otherwise capture the PREVIOUS
  // render's (stale) rollModifier value, same reason rollLabelRef exists.
  const rollModifierRef = React.useRef<number | null>(null);

  // Hurry up: skip roll animations and show results instantly
  const [hurryUp, setHurryUpState] = React.useState<boolean>(() => {
    try { return localStorage.getItem('dnd_hurryup') === '1'; } catch { return false; }
  });
  function setHurryUp(val: boolean) {
    setHurryUpState(val);
    try { localStorage.setItem('dnd_hurryup', val ? '1' : '0'); } catch { /* ignore */ }
  }

  // Auto-send labeled rolls (skill/save/initiative) to the DM the instant
  // they settle — same persisted-preference pattern as hurryUp. Only ever
  // shown/usable when a DM listener is actually reachable (see `connected`
  // below), so this can't silently do nothing if left checked from a
  // previous session with no DM around.
  const [autoSendToDM, setAutoSendToDMState] = React.useState<boolean>(() => {
    try { return localStorage.getItem('dnd_dice_autosend_dm') === '1'; } catch { return false; }
  });
  function setAutoSendToDM(val: boolean) {
    setAutoSendToDMState(val);
    try { localStorage.setItem('dnd_dice_autosend_dm', val ? '1' : '0'); } catch { /* ignore */ }
  }
  const connected = useDmConnection();
  const dmIp = useSettingsStore((s) => s.dmIp);
  const [dmStatus, setDmStatus] = React.useState<string | null>(null);

  /** Sends one settled roll to the DM over LAN (see dmConnect.ts's
   *  sendTalkToDM) — the same blocking "/talk" flow TalkToDMButton uses, so
   *  the DM actually reacts to it as a real turn rather than it just
   *  appearing silently. Used by both the auto-send path (labeled rolls
   *  only) and the manual button (any roll). */
  async function sendRollToDM(opts: { die: Die; count?: number; result: number; mode: Mode; two: { v1: number; v2: number; winner: 1 | 2 } | null; label: string | null; modifier: number | null; rider?: { die: Die; value: number } | null }) {
    if (!connected || !characterName?.trim()) return;
    const text = describeRollForDM(opts);
    setDmStatus('Sending to DM…');
    try {
      const reply = await sendTalkToDM(text, characterName, dmIp);
      setDmStatus(reply ? `DM: ${reply}` : 'Sent to the DM.');
    } catch (e) {
      setDmStatus(e instanceof Error ? e.message : "Couldn't reach the DM.");
    }
  }

  // External trigger state (skill/save/initiative rolls)
  const [rollModifier, setRollModifier] = React.useState<number | null>(null);
  const [rollLabel, setRollLabel] = React.useState<string | null>(null);

  /**
   * Rider dice — a second die added to the next roll's total: Bless and Guidance
   * (+1d4), Bardic Inspiration (+1d6 up to +1d12), and on the damage side Hex,
   * Hunter's Mark and Divine Favor. One control covers all of them because they
   * are all the same mechanic, and it is manual because the sheet cannot know:
   * Bless is cast BY someone else ON you, so nothing on this character records it.
   *
   * ONE-SHOT on purpose. Bless would prefer to stay armed for its whole minute,
   * but a rider that silently survives into the next roll is a wrong number at the
   * table with no visible cause — the same failure this app keeps fixing. Re-arming
   * costs one tap, exactly like picking advantage.
   */
  const [armedRider, setArmedRider] = React.useState<Die | null>(null);
  const [riderResult, setRiderResult] = React.useState<{ die: Die; value: number } | null>(null);
  // Mirrored for the same reason rollModifierRef is: the settle callbacks below run
  // inside closures that would otherwise read a stale value.
  const armedRiderRef = React.useRef<Die | null>(null);
  function armRider(die: Die | null) {
    const next = armedRider === die ? null : die; // tapping the armed one disarms it
    setArmedRider(next);
    armedRiderRef.current = next;
  }
  /** Rolls the armed rider, if any, and disarms it. Called once per settled roll. */
  function consumeRider(): { die: Die; value: number } | null {
    const die = armedRiderRef.current;
    if (die === null) return null;
    const rider = { die, value: Math.ceil(Math.random() * die) };
    setRiderResult(rider);
    armedRiderRef.current = null;
    setArmedRider(null);
    return rider;
  }
  const { pending, consume, openNonce, publishResult } = useDiceStore();

  // Inspiration — pulled directly so we don't need an extra prop
  const inspiration     = useCharacterStore(s => s.character?.inspiration ?? false);
  const toggleInspiration = useCharacterStore(s => s.toggleInspiration);

  // Open panel when the FAB or any external caller fires openPanel()
  React.useEffect(() => {
    if (openNonce > 0) setOpen(true);
  }, [openNonce]);

  // Watch for pending external rolls
  React.useEffect(() => {
    if (!pending) return;
    const req = consume();
    if (!req) return;
    const reqMode = req.mode ?? 'normal';
    const count = req.count ?? 1;
    rollLabelRef.current = req.label;
    rollModifierRef.current = req.modifier;
    setOpen(true);
    setMode(reqMode);
    setRollModifier(req.modifier);
    setRollLabel(req.label);
    // Advantage/disadvantage is a d20 mechanic — roll two, take one. Damage is
    // the only thing that sends count > 1, and it is never rolled with
    // advantage, so a multi-die request always takes the summing path rather
    // than silently losing all but one of its dice to rollTwo.
    if (reqMode !== 'normal' && count === 1) {
      rollTwo(req.die as Die, reqMode, true);
    } else {
      rollWithSides(req.die as Die, count);
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

  /** Fires the auto-send path right as a roll settles — only when the
   *  checkbox is on AND this roll actually carried a label (an external
   *  skill/save/initiative dispatch), never for a bare manual click. Reads
   *  the ref-mirrored label/modifier (see rollModifierRef's doc comment),
   *  not the rollLabel/rollModifier state, since this runs inside the same
   *  settle closures that would otherwise see a stale value. */
  function maybeAutoSendRoll(sides: Die, result: number, effectiveMode: Mode, two: { v1: number; v2: number; winner: 1 | 2 } | null, count = 1, rider: { die: Die; value: number } | null = null) {
    if (!autoSendToDM || !rollLabelRef.current) return;
    sendRollToDM({ die: sides, count, result, mode: effectiveMode, two, label: rollLabelRef.current, modifier: rollModifierRef.current, rider });
  }

  function rollWithSides(sides: Die, count = 1) {
    if (timerRef.current) clearTimeout(timerRef.current);
    setActiveDie(sides);
    setActiveCount(count);
    setTwoDisplay(null);
    setTwoFinal(null);
    setDmStatus(null);
    setRiderResult(null);

    if (hurryUp) {
      const result = rollSum(sides, count);
      const t = getTier(result, sides, count);
      setDisplay(result);
      setTier(t);
      setResultKey(k => k + 1);
      setHistory(h => [{ die: sides, count, result, tier: t, mode: 'normal' as Mode }, ...h].slice(0, 8));
      setRolling(false);
      const rider = consumeRider();
      // The rider is deliberately NOT folded into publishResult or the tier: those
      // read the raw die, and the death-save tracker keys on a natural 20 or 1.
      publishResult(result, sides, rollLabelRef.current, count);
      maybeAutoSendRoll(sides, result, 'normal', null, count, rider);
      return;
    }

    setRolling(true);
    setShakePhase(0);

    let frame = 0;
    const frames = 28;
    const delay = (f: number) => Math.round(22 + Math.pow(f / frames, 2.5) * 300);

    const tick = () => {
      frame++;
      const progress = frame / frames;
      setShakePhase(progress < 0.45 ? 0 : progress < 0.75 ? 1 : 2);
      setDisplay(rollSum(sides, count));
      if (frame < frames) {
        timerRef.current = setTimeout(tick, delay(frame));
      } else {
        const result = rollSum(sides, count);
        const t = getTier(result, sides, count);
        setDisplay(result);
        setTier(t);
        setResultKey(k => k + 1);
        setHistory(h => [{ die: sides, count, result, tier: t, mode: 'normal' as Mode }, ...h].slice(0, 8));
        setRolling(false);
        const rider = consumeRider();
        publishResult(result, sides, rollLabelRef.current, count);
        maybeAutoSendRoll(sides, result, 'normal', null, count, rider);
      }
    };
    timerRef.current = setTimeout(tick, 30);
  }

  function roll(sides: Die) {
    if (rolling) return;
    // Manual clicks clear the external label and nonce tracking
    setRollModifier(null);
    setRollLabel(null);
    rollLabelRef.current = '';
    rollModifierRef.current = null;
    setDmStatus(null);
    if (mode !== 'normal') { rollTwo(sides); return; }
    rollWithSides(sides);
  }

  /** `external` marks a roll triggered from a sheet button rather than this panel's own
   *  dice grid. Those buttons are not disabled during the ~3.5s animation, and the pending
   *  request has already been consumed by the time we get here — so bailing out on
   *  `rolling` silently ate the second of two quick attacks (Extra Attack, a rogue's
   *  bonus-action dagger). rollWithSides has always restarted instead; this now matches it. */
  function rollTwo(sides: Die, modeOverride?: Mode, external = false) {
    if (rolling && !external) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setActiveDie(sides);
    setActiveCount(1); // adv/dis is always a single die taken twice

    setDisplay(null);
    setDmStatus(null);
    setRiderResult(null);

    if (hurryUp) {
      const v1 = Math.ceil(Math.random() * sides);
      const v2 = Math.ceil(Math.random() * sides);
      const effectiveMode = modeOverride ?? mode;
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
      const rider = consumeRider();
      publishResult(finalVal, sides, rollLabelRef.current);
      maybeAutoSendRoll(sides, finalVal, effectiveMode, { v1, v2, winner }, 1, rider);
      return;
    }

    setRolling(true);
    setShakePhase(0);
    setTwoFinal(null);

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
        const rider = consumeRider();
        publishResult(finalVal, sides, rollLabelRef.current);
        maybeAutoSendRoll(sides, finalVal, effectiveMode, { v1, v2, winner }, 1, rider);
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

          {/* Rider dice — added to the NEXT roll only. See armedRider's comment for
              why this is manual and why it doesn't stay armed. */}
          <div className="flex items-center gap-1 px-4 pt-1.5">
            <span className="text-[10px] text-slate-500 shrink-0 mr-0.5" title="Bless, Guidance, Bardic Inspiration, Hex, Hunter's Mark — a die added to the next roll's total">
              Add
            </span>
            {([4, 6, 8, 10, 12] as Die[]).map(d => (
              <button
                key={d}
                onClick={() => armRider(d)}
                className={cn(
                  'flex-1 text-[11px] font-bold py-1 rounded border transition-all',
                  armedRider === d
                    ? 'bg-amber-800/60 border-amber-500 text-amber-200'
                    : 'bg-slate-800 border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500',
                )}
                title={armedRider === d ? `+1d${d} armed — tap to cancel` : `Add 1d${d} to the next roll`}
              >
                +d{d}
              </button>
            ))}
          </div>

          {/* Hurry up + auto-send toggles */}
          <div className="flex items-center justify-end gap-3 px-4 pb-1 -mt-0.5">
            {/* Only offered when a DM listener is actually reachable — a
             *  checked-but-unreachable checkbox would silently do nothing. */}
            {connected && (
              <label className="flex items-center gap-1.5 cursor-pointer select-none group" title="Automatically sends labeled rolls (skill/save/initiative checks) to the DM the moment they settle">
                <input
                  type="checkbox"
                  checked={autoSendToDM}
                  onChange={e => setAutoSendToDM(e.target.checked)}
                  className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer"
                />
                <span className={cn(
                  'text-[11px] font-medium transition-colors',
                  autoSendToDM ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-400',
                )}>
                  📨 Auto-send
                </span>
              </label>
            )}
            <label className="flex items-center gap-1.5 cursor-pointer select-none group">
              <input
                type="checkbox"
                checked={hurryUp}
                onChange={e => setHurryUp(e.target.checked)}
                className="w-3.5 h-3.5 accent-amber-500 cursor-pointer"
              />
              <span className={cn(
                'text-[11px] font-medium transition-colors',
                hurryUp ? 'text-amber-400' : 'text-slate-500 group-hover:text-slate-400',
              )}>
                ⚡ Hurry up!
              </span>
            </label>
          </div>

          {/* Inspiration banner — only visible when character has inspiration */}
          {inspiration && (
            <div className="mx-4 mb-1 px-2.5 py-1.5 rounded-lg bg-yellow-950/60 border border-yellow-600/50 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-yellow-300 text-[13px] shrink-0">✨</span>
                <p className="text-[11px] text-yellow-200 leading-tight font-semibold truncate">
                  You have Inspiration!
                </p>
              </div>
              <button
                onClick={() => {
                  setMode('advantage');
                  setTwoDisplay(null);
                  setTwoFinal(null);
                  setDisplay(null);
                  toggleInspiration();
                }}
                className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded border border-yellow-500/60 bg-yellow-600/25 text-yellow-200 hover:bg-yellow-600/50 hover:border-yellow-400 transition-colors"
              >
                Use →
              </button>
            </div>
          )}

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
                    {rollLabel && (
                      <p className="text-[11px] text-slate-400 uppercase tracking-wide mt-3 relative z-10">{rollLabel}</p>
                    )}
                    <p className={cn('text-xs relative z-10 font-semibold', rollLabel ? 'mt-1' : 'mt-3')} style={{ color: t.color }}>
                      {tier === 'crit-success'
                        ? activeDie === 20 ? '🎉 Natural 20!' : '🎉 Max roll!'
                        : tier === 'crit-fail'
                        ? '💀 Critical Fail'
                        : `${mode === 'advantage' ? '⬆ Adv' : '⬇ Dis'} → ${display} (took ${twoFinal.winner === 1 ? twoFinal.v1 : twoFinal.v2})`}
                    </p>
                    <TotalRow display={display} modifier={rollModifier} rider={riderResult}
                              color={t.color} shadow={t.shadow} big={false} />
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
                    {/* Modifier + rider + total row */}
                    {!rolling && (
                      <TotalRow display={display} modifier={rollModifier} rider={riderResult}
                                color={t.color} shadow={t.shadow} big />
                    )}
                    <p className="text-xs mt-2 relative z-10 font-semibold"
                      style={{ color: rolling ? '#475569' : t.color, opacity: rolling ? 1 : 0.85 }}>
                      {rolling ? `Rolling ${dieLabel(activeDie!, activeCount)}…`
                        : tier === 'crit-success' ? activeDie === 20 ? '🎉 Natural 20!' : '🎉 Max roll!'
                        : t.label || dieLabel(activeDie!, activeCount)}
                    </p>
                  </>
                ) : (
                  <p className="text-slate-600 text-sm">Pick a die to roll</p>
                )}
              </>
            )}
          </div>

          {/* Manual "Send to DM" — works for ANY settled roll, labeled or
           *  not (the auto-send checkbox above only ever covers labeled
           *  rolls), so an unlabeled/manual click can still be shared on
           *  demand. Reads plain component state, not the refs above — a
           *  button click always sees the current render's fresh state. */}
          {connected && display !== null && !rolling && activeDie !== null && (
            <div className="flex items-center justify-center px-4 pb-1.5 -mt-1">
              <button
                onClick={() => sendRollToDM({ die: activeDie, count: activeCount, result: display, mode, two: twoFinal, label: rollLabel, modifier: rollModifier, rider: riderResult })}
                className="flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-emerald-400 transition-colors"
                title="Send this roll to the DM"
              >
                <Send size={12} /> Send to DM
              </button>
            </div>
          )}
          {dmStatus && (
            <p className="px-4 pb-2 -mt-0.5 text-[11px] text-slate-400 text-center">{dmStatus}</p>
          )}

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
                    {dieLabel(h.die, h.count)} <span className="font-bold" style={{ color: TIER[h.tier].color }}>{h.result}</span>
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
