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

interface Spark { dx: number; dy: number; color: string }

function makeSparks(count: number, radiusPx: number, fwId: number): Spark[] {
  return Array.from({ length: count }, (_, i) => {
    const rad = (2 * Math.PI / count) * i;
    // vary radius slightly so they don't all land on the same circle
    const r = radiusPx + (i % 4) * 18;
    // each spark gets its own color — offset by firework id so adjacent sparks differ
    const color = COLORS[(fwId * 7 + i * 3) % COLORS.length];
    return { dx: Math.cos(rad) * r, dy: Math.sin(rad) * r, color };
  });
}

// 14 deterministic fireworks — burst tops kept high (3–28 % from top)
const FIREWORKS = Array.from({ length: 14 }, (_, i) => {
  const sparkCount = i % 2 === 0 ? 16 : 12;
  return {
    id: i,
    left:     `${5  + ((i * 6.1  + (i % 5) * 2.5) % 88).toFixed(1)}%`,
    burstTop: `${3  + ((i * 2.3  + (i % 5) * 3.1) % 25).toFixed(1)}%`,
    duration: `${(3.6 + (i % 6) * 0.55).toFixed(1)}s`,
    delay:    `${-((i * 0.85 + (i % 4) * 1.15) % 7).toFixed(2)}s`,
    // rocket trail colour — first spark's colour
    rocketColor: COLORS[(i * 7) % COLORS.length],
    sparks: makeSparks(sparkCount, 60, i),
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
              marginLeft: -1.5,
              width:  3,
              height: 16,
              borderRadius: 2,
              background: `linear-gradient(to top, ${fw.rocketColor}dd, transparent)`,
              animation: `fw-rocket ${fw.duration} ${fw.delay} infinite`,
              willChange: 'transform, opacity',
            }}
          />

          {/* ── Burst sparks — each its own colour ── */}
          {fw.sparks.map((spark, si) => (
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
                background: spark.color,
                boxShadow:   `0 0 5px 2px ${spark.color}77`,
                animation:   `fw-spark ${fw.duration} infinite`,
                animationDelay: `calc(${fw.delay} + ${(si * 0.008).toFixed(3)}s)`,
                willChange: 'transform, opacity',
                ['--dx' as string]: spark.dx,
                ['--dy' as string]: spark.dy,
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
