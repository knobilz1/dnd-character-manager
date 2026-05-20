// Fireworks overlay for party theme.
//
// Architecture: every element (rocket + sparks) is a direct position:fixed
// child of the overlay, anchored at the BURST POINT (top: burstTop).
//
// • Rocket:  starts translateY(100vh) below burst point → travels to translateY(0)
//            then fades out at 34 %.
// • Sparks:  start at the burst point (translateY(0)), fan out radially with
//            pre-computed dx/dy screen-space offsets so gravity (+ 40 px Y) is
//            always downward regardless of spark angle.
//
// All animations use only transform + opacity — GPU composited, no paint.

import React from 'react';

const COLORS = [
  '#f87171', '#fb923c', '#facc15', '#4ade80',
  '#60a5fa', '#c084fc', '#f472b6', '#34d399',
  '#fde68a', '#a5b4fc',
];

interface Spark { dx: number; dy: number }

function makeSparks(count: number, radiusPx: number): Spark[] {
  return Array.from({ length: count }, (_, i) => {
    const rad = (2 * Math.PI / count) * i;
    // vary radius slightly so they don't all land on the same circle
    const r = radiusPx + (i % 4) * 18;
    return { dx: Math.cos(rad) * r, dy: Math.sin(rad) * r };
  });
}

// 14 deterministic fireworks
const FIREWORKS = Array.from({ length: 14 }, (_, i) => {
  const color = COLORS[i % COLORS.length];
  const sparkCount = i % 2 === 0 ? 16 : 12;
  return {
    id: i,
    left:     `${5  + ((i * 6.1  + (i % 5) * 2.5) % 88).toFixed(1)}%`,
    burstTop: `${8  + ((i * 3.5  + (i % 4) * 4.8) % 48).toFixed(1)}%`,
    duration: `${(3.6 + (i % 6) * 0.55).toFixed(1)}s`,
    delay:    `${-((i * 0.85 + (i % 4) * 1.15) % 7).toFixed(2)}s`,
    color,
    sparks: makeSparks(sparkCount, 55),
  };
});

export function FireworksOverlay() {
  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: 5 }}
      aria-hidden
    >
      {FIREWORKS.map(fw => (
        <React.Fragment key={fw.id}>

          {/* ── Rocket trail ── */}
          <div
            style={{
              position: 'fixed',
              left: fw.left,
              top:  fw.burstTop,
              // centre the 3 px wide trail on the left anchor
              marginLeft: -1.5,
              width:  3,
              height: 16,
              borderRadius: 2,
              background: `linear-gradient(to top, ${fw.color}dd, transparent)`,
              animation: `fw-rocket ${fw.duration} ${fw.delay} infinite`,
              willChange: 'transform, opacity',
            }}
          />

          {/* ── Burst sparks ── */}
          {fw.sparks.map((_spark, si) => (
            <div
              key={si}
              style={{
                position: 'fixed',
                left: fw.left,
                top:  fw.burstTop,
                marginLeft: -2,
                marginTop:  -2,
                width:  4,
                height: 4,
                borderRadius: '50%',
                background: fw.color,
                boxShadow:   `0 0 5px 2px ${fw.color}77`,
                animation:   `fw-spark ${fw.duration} infinite`,
                // stagger each spark slightly so the burst "pops"
                animationDelay: `calc(${fw.delay} + ${(si * 0.008).toFixed(3)}s)`,
                willChange: 'transform, opacity',
                // pre-computed screen-space offsets so gravity is always downward
                ['--dx' as string]: fw.sparks[si].dx,
                ['--dy' as string]: fw.sparks[si].dy,
              } as React.CSSProperties}
            />
          ))}

        </React.Fragment>
      ))}

      <style>{`
        /* Rocket rises from off-screen bottom to burst point (translateY 0),
           then disappears just before sparks fire. */
        @keyframes fw-rocket {
          0%   { transform: translateX(-50%) translateY(100vh); opacity: 0;   }
          4%   {                                                 opacity: 0.9; }
          32%  { transform: translateX(-50%) translateY(0);     opacity: 0.8; }
          35%  {                                                 opacity: 0;   }
          100% { transform: translateX(-50%) translateY(0);     opacity: 0;   }
        }

        /* Sparks explode outward from burst point using screen-space dx/dy,
           then drift down with gravity (+40 px) and fade out. */
        @keyframes fw-spark {
          0%   { transform: translate(0, 0);
                 opacity: 0; }
          33%  { transform: translate(0, 0);
                 opacity: 0; }
          36%  { opacity: 1; }
          60%  { transform: translate(
                   calc(var(--dx) * 1px),
                   calc(var(--dy) * 1px)
                 );
                 opacity: 0.9; }
          84%  { transform: translate(
                   calc(var(--dx) * 1px),
                   calc(var(--dy) * 1px + 40px)
                 );
                 opacity: 0.15; }
          90%  { opacity: 0; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
