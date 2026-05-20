// Fireworks overlay for party theme.
// Each firework: a rocket trails up from the bottom, then a burst of sparks
// fans out in all directions. Pure transform+opacity — no paint triggers.

const COLORS = [
  '#f87171', // red
  '#fb923c', // orange
  '#facc15', // yellow
  '#4ade80', // green
  '#60a5fa', // blue
  '#c084fc', // purple
  '#f472b6', // pink
  '#34d399', // teal
  '#fde68a', // gold
  '#a5b4fc', // indigo
];

// 18 deterministic fireworks spread across the viewport.
const FIREWORKS = Array.from({ length: 18 }, (_, i) => ({
  id: i,
  left: `${5 + ((i * 5.5 + (i % 4) * 3) % 90).toFixed(1)}%`,
  // burst height: 10–55% from top
  burstTop: `${10 + (i * 2.7 % 45).toFixed(1)}%`,
  // total cycle: 3.5–7s
  duration: `${(3.5 + (i % 7) * 0.5).toFixed(1)}s`,
  // stagger so they don't all fire at once
  delay: `${-((i * 0.8 + (i % 3) * 1.1) % 6).toFixed(2)}s`,
  color: COLORS[i % COLORS.length],
  // 12 or 16 sparks
  sparkCount: i % 3 === 0 ? 16 : 12,
}));

// Spark angles — evenly distributed around the circle.
function getSparks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    angle: (360 / count) * i,
    // stagger spark length slightly for natural look
    length: 55 + (i % 3) * 20,
  }));
}

export function FireworksOverlay() {
  return (
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 5 }}
      aria-hidden
    >
      {FIREWORKS.map(fw => (
        <div
          key={fw.id}
          className="absolute"
          style={{
            left: fw.left,
            bottom: 0,
            animation: `fw-cycle ${fw.duration} ${fw.delay} infinite`,
          }}
        >
          {/* Rocket trail */}
          <div
            style={{
              position: 'absolute',
              left: '50%',
              bottom: 0,
              transform: 'translateX(-50%)',
              width: 3,
              height: 14,
              borderRadius: 2,
              background: `linear-gradient(to top, ${fw.color}cc, transparent)`,
              animation: `fw-rocket ${fw.duration} ${fw.delay} infinite`,
              willChange: 'transform, opacity',
            }}
          />
          {/* Burst container — positioned at the burst height */}
          <div
            style={{
              position: 'fixed',
              left: fw.left,
              top: fw.burstTop,
              animation: `fw-burst-fade ${fw.duration} ${fw.delay} infinite`,
              willChange: 'opacity',
            }}
          >
            {getSparks(fw.sparkCount).map((spark, si) => (
              <div
                key={si}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: 3,
                  height: 3,
                  borderRadius: '50%',
                  background: fw.color,
                  boxShadow: `0 0 4px 1px ${fw.color}88`,
                  transformOrigin: '0 0',
                  animation: `fw-spark ${fw.duration} ${fw.delay} infinite`,
                  willChange: 'transform, opacity',
                  // Custom properties for per-spark direction + length
                  ['--fw-angle' as string]: `${spark.angle}deg`,
                  ['--fw-len' as string]: `${spark.length}px`,
                  // Slight stagger per spark for the "pop" feel
                  animationDelay: `calc(${fw.delay} + ${(si * 0.012).toFixed(3)}s)`,
                }}
              />
            ))}
          </div>
        </div>
      ))}

      <style>{`
        /* Rocket flies up from bottom to the burst point, then resets */
        @keyframes fw-rocket {
          0%   { transform: translateX(-50%) translateY(0)    scaleY(1);   opacity: 0.9; }
          35%  { transform: translateX(-50%) translateY(-60vh) scaleY(1.4); opacity: 0.8; }
          36%  { opacity: 0; }
          100% { opacity: 0; }
        }

        /* Burst container fades in at the burst height, then fades out */
        @keyframes fw-burst-fade {
          0%    { opacity: 0; }
          34%   { opacity: 0; }
          37%   { opacity: 1; }
          70%   { opacity: 0.6; }
          90%   { opacity: 0; }
          100%  { opacity: 0; }
        }

        /* Each spark shoots outward in its own direction then falls */
        @keyframes fw-spark {
          0%   { transform: rotate(var(--fw-angle)) translateX(0)               translateY(0);   opacity: 0; }
          34%  { transform: rotate(var(--fw-angle)) translateX(0)               translateY(0);   opacity: 0; }
          36%  { opacity: 1; }
          55%  { transform: rotate(var(--fw-angle)) translateX(var(--fw-len))    translateY(0);   opacity: 0.9; }
          80%  { transform: rotate(var(--fw-angle)) translateX(var(--fw-len))    translateY(30px); opacity: 0.3; }
          90%  { opacity: 0; }
          100% { opacity: 0; }
        }

        /* Dummy — just keeps the outer div cycling in sync */
        @keyframes fw-cycle {
          0%, 100% { }
        }
      `}</style>
    </div>
  );
}
