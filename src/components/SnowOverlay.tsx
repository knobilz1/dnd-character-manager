import React from 'react';

// Four distinct sway paths so flakes don't all drift the same way.
// Named snow-a … snow-d — keyframes are in index.css.
const VARIANTS = ['snow-a', 'snow-b', 'snow-c', 'snow-d'] as const;

// Deterministic configs — no Math.random so they're stable across re-renders.
// ~40 flakes spread across the viewport with varied sizes, speeds, and delays.
const FLAKES = Array.from({ length: 40 }, (_, i) => ({
  id: i,
  // Spread left positions evenly with a slight stagger per group of 5
  left: `${((i * 2.5 + (i % 5) * 0.6) % 100).toFixed(1)}%`,
  // 2–5 px diameter — larger ones feel heavier / closer
  size: 2 + (i % 4),
  // 9–19 s fall time — spreads out so they don't arrive in waves
  duration: `${9 + (i % 11)}s`,
  // Negative delay puts each flake mid-animation from the start (no initial empty sky)
  delay: `${-((i * 0.47) % 18).toFixed(2)}s`,
  variant: VARIANTS[i % 4],
}));

export function SnowOverlay() {
  return (
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 45 }}
      aria-hidden="true"
    >
      {FLAKES.map(f => (
        <div
          key={f.id}
          className="absolute rounded-full bg-white"
          style={{
            top: 0,
            left: f.left,
            width: f.size,
            height: f.size,
            animation: `${f.variant} ${f.duration} ${f.delay} linear infinite`,
          }}
        />
      ))}
    </div>
  );
}
