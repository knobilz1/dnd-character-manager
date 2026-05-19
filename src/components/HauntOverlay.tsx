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

// Deterministic config — no Math.random so it's stable across re-renders
const FLAKES: Flake[] = (() => {
  const out: Flake[] = [];
  let g = 0; // global index for left-position spread
  for (const s of SPECS) {
    for (let i = 0; i < s.count; i++) {
      const dur = s.durMin + (g % (s.durSpan + 1));
      out.push({
        id: g,
        emoji: s.emoji,
        left: `${((g * 3.33 + i * 7.1) % 100).toFixed(1)}%`,
        size: s.sizes[i % s.sizes.length],
        duration: `${dur}s`,
        // Negative delay → already mid-animation the moment Halloween mode switches on
        delay: `-${((g * 0.55) % dur).toFixed(1)}s`,
        variant: s.variant,
      });
      g++;
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
            animation: `${f.variant} ${f.duration} ${f.delay} linear infinite`,
          }}
        >
          {f.emoji}
        </span>
      ))}
    </div>
  );
}
