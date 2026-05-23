// InspirationOverlay — subtle golden sparkle that appears at a random spot every ~20s
// while the character has Inspiration. Pointer-events: none so it never blocks the UI.
//
// Visual: a 4-pointed star sparkle (jewelry-glint style) that pops in, gently twirls,
// then fades — golden/white, soft glow via CSS drop-shadow filter.
//
// Layers (back → front):
//   1. Outer glow ring  — wide soft halo
//   2. Four star spikes — smooth bezier-curved diamond points
//   3. Hot white center — tiny bright nucleus

import React from 'react';

// ── Per-twinkle data ─────────────────────────────────────────────────────────
interface Twinkle {
  id: number;
  x: number;   // 0–100, percentage of viewport width
  y: number;   // 0–100, percentage of viewport height
  size: number; // diameter in px (18–34)
  rot: number;  // initial rotation offset in degrees
}

let _nextId = 0;

// ── Single sparkle ───────────────────────────────────────────────────────────
function TwinkleSparkle({ x, y, size, rot }: Omit<Twinkle, 'id'>) {
  return (
    // Outer div: positions the sparkle's origin on screen
    <div
      style={{
        position: 'absolute',
        left: `${x}%`,
        top:  `${y}%`,
        // inner div handles the scale/rotate animation; translate centres it
        width: 0, height: 0,
        pointerEvents: 'none',
      }}
    >
      {/* Inner div: animated scale + rotate, centred over the origin */}
      <div
        style={{
          transform:     `translate(-50%, -50%) rotate(${rot}deg)`,
          animation:     'insp-twinkle 1.7s ease-in-out forwards',
          willChange:    'transform, opacity',
          filter:
            'drop-shadow(0 0 5px #fde047) drop-shadow(0 0 14px rgba(245,158,11,0.6))',
        }}
      >
        <svg
          viewBox="-50 -50 100 100"
          width={size}
          height={size}
          style={{ overflow: 'visible', display: 'block' }}
        >
          {/* 4-point star path — narrow bezier diamond spikes */}
          <path
            d="M0,-46 C3,-13 13,-3 46,0 C13,3 3,13 0,46 C-3,13 -13,3 -46,0 C-13,-3 -3,-13 0,-46 Z"
            fill="#fde047"
            opacity="0.9"
          />
          {/* Bright white overlay to create a hot-centre feel */}
          <path
            d="M0,-46 C3,-13 13,-3 46,0 C13,3 3,13 0,46 C-3,13 -13,3 -46,0 C-13,-3 -3,-13 0,-46 Z"
            fill="white"
            opacity="0.45"
          />
          {/* Hot nucleus */}
          <circle cx="0" cy="0" r="5.5" fill="white" opacity="0.95" />
          {/* Soft outer halo ring */}
          <circle
            cx="0" cy="0" r="22"
            fill="none"
            stroke="#fde047"
            strokeWidth="1"
            opacity="0.25"
          />
        </svg>
      </div>
    </div>
  );
}

// ── Overlay ──────────────────────────────────────────────────────────────────
export function InspirationOverlay() {
  const [twinkles, setTwinkles] = React.useState<Twinkle[]>([]);

  React.useEffect(() => {
    function spawn() {
      const tw: Twinkle = {
        id:   _nextId++,
        x:    6 + Math.random() * 88,        // keep off edges
        y:    6 + Math.random() * 88,
        size: 20 + Math.floor(Math.random() * 16), // 20–36 px
        rot:  Math.floor(Math.random() * 45),       // 0–45° offset
      };
      setTwinkles(prev => [...prev, tw]);

      // Remove from state after animation completes so the DOM stays clean
      setTimeout(() => {
        setTwinkles(prev => prev.filter(t => t.id !== tw.id));
      }, 1900);
    }

    // Show one quickly so the user sees immediate feedback when inspiration is granted
    const firstTimer = setTimeout(spawn, 600);

    // Then repeat every 17–23 s (jittered so it doesn't feel mechanical)
    let repeatTimer: ReturnType<typeof setTimeout>;
    function scheduleNext() {
      const delay = 17000 + Math.random() * 6000;
      repeatTimer = setTimeout(() => {
        spawn();
        scheduleNext();
      }, delay);
    }
    scheduleNext();

    return () => {
      clearTimeout(firstTimer);
      clearTimeout(repeatTimer);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{ zIndex: 44, pointerEvents: 'none' }}
    >
      {twinkles.map(tw => (
        <TwinkleSparkle
          key={tw.id}
          x={tw.x}
          y={tw.y}
          size={tw.size}
          rot={tw.rot}
        />
      ))}

      <style>{`
        /* Pop in, gentle twirl, pop out */
        @keyframes insp-twinkle {
          0%   { transform: translate(-50%,-50%) rotate(var(--r,0deg)) scale(0);    opacity: 0; }
          18%  { transform: translate(-50%,-50%) rotate(var(--r,0deg)) scale(1.25); opacity: 1; }
          40%  { transform: translate(-50%,-50%) rotate(var(--r,0deg)) scale(0.92); opacity: 0.95; }
          62%  { transform: translate(-50%,-50%) rotate(var(--r,0deg)) scale(1.08); opacity: 0.85; }
          82%  { transform: translate(-50%,-50%) rotate(var(--r,0deg)) scale(0.97); opacity: 0.6; }
          100% { transform: translate(-50%,-50%) rotate(var(--r,0deg)) scale(0);    opacity: 0; }
        }
      `}</style>
    </div>
  );
}
