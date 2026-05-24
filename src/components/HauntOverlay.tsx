import React from 'react';

type HauntEmoji = '👻' | '🎃' | '💀' | '🧟' | '🦇';

interface Flake {
  id: number;
  emoji: HauntEmoji;
  left: string;
  size: number;
  duration: string;
  delay: string;
  variant: string;
  sway: number;   // px — constant horizontal bias applied via --sway in the keyframes
}

// Each creature type gets its own fall variant + size/speed range
const SPECS: {
  emoji: HauntEmoji;
  variant: string;
  count: number;
  sizes: number[];
  durMin: number;
  durSpan: number;
}[] = [
  { emoji: '👻', variant: 'haunt-ghost',   count: 8, sizes: [16,18,20,22], durMin: 10, durSpan: 7  },
  { emoji: '🎃', variant: 'haunt-pumpkin', count: 6, sizes: [14,16,18],    durMin:  9, durSpan: 6  },
  { emoji: '💀', variant: 'haunt-shamble', count: 5, sizes: [13,15,17],    durMin: 10, durSpan: 6  },
  { emoji: '🧟', variant: 'haunt-shamble', count: 5, sizes: [15,17,19],    durMin: 12, durSpan: 7  },
  { emoji: '🦇', variant: 'haunt-bat',     count: 6, sizes: [12,14,16],    durMin:  5, durSpan: 5  },
];

// Minimal seeded LCG — deterministic so positions are stable across re-renders,
// but the sequence looks random (no visible columns or arithmetic regularity).
function makeLCG(seed: number) {
  let s = seed >>> 0;
  return (): number => {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    return s / 0x100000000;   // [0, 1)
  };
}

// Build all flakes once at module load. seed=13 chosen to give good visual spread.
const FLAKES: Flake[] = (() => {
  const rng = makeLCG(13);
  const out: Flake[] = [];
  let id = 0;
  for (const s of SPECS) {
    for (let i = 0; i < s.count; i++) {
      const dur = s.durMin + Math.round(rng() * s.durSpan);
      out.push({
        id,
        emoji:    s.emoji,
        // 3%–95% keeps creatures off the very edges so they don't clip
        left:     `${(rng() * 92 + 3).toFixed(1)}%`,
        size:     s.sizes[Math.floor(rng() * s.sizes.length)],
        duration: `${dur}s`,
        // Negative delay → already mid-fall when Halloween mode switches on
        delay:    `-${(rng() * dur).toFixed(2)}s`,
        variant:  s.variant,
        // ±60 px bias — each creature traces a completely different horizontal path
        sway:     Math.round(rng() * 120 - 60),
      });
      id++;
    }
  }
  return out;
})();

export function HauntOverlay() {
  return (
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 45 }}
      aria-hidden="true"
    >
      {FLAKES.map(f => (
        <span
          key={f.id}
          className="absolute select-none"
          style={{
            top: 0,
            left: f.left,
            fontSize: f.size,
            lineHeight: 1,
            '--sway': `${f.sway}px`,
            animation: `${f.variant} ${f.duration} ${f.delay} linear infinite`,
          } as React.CSSProperties}
        >
          {f.emoji}
        </span>
      ))}
    </div>
  );
}
