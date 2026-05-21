// RageOverlay — full-screen berserker rage effect.
//
// Layers (back → front):
//   1. Pulsing blood-red tint  — covers entire viewport, heartbeat rhythm
//   2. Heavy vignette          — transparent center, searing red at screen edges
//   3. Blood drips             — hang from the top, varying lengths / widths
//   4. Rising cinders          — hot ember sparks rising from the bottom
//   5. Corner burns            — intense red radial glow at all four corners
//
// All animations: transform + opacity only — GPU composited, no paint.

import React from 'react';

// ── Blood streams that run from the top all the way down the screen ──────────
// Each stream elongates from the ceiling then slides the full viewport height.
const DRIPS = Array.from({ length: 14 }, (_, i) => ({
  id: i,
  left:     `${3  + ((i * 6.3  + (i % 5) * 4.1) % 93).toFixed(1)}%`,
  width:    3 + (i % 6),                           // 3–8 px
  length:   60 + (i % 8) * 20,                     // 60–200 px stream body
  duration: `${3.8 + (i % 7) * 0.65}s`,            // 3.8–8.3 s — slow is menacing
  delay:    `${-((i * 0.71 + (i % 4) * 1.1) % 9).toFixed(2)}s`,
  opacity:  +(0.7 + (i % 4) * 0.075).toFixed(2),   // 0.70–0.92
  sway:     -10 + (i % 5) * 5,                     // –10 to +10 px horizontal drift
}));

// ── Leading drops — smaller teardrops that fall ahead of each stream ──────────
// They "break off" the tip and accelerate downward, giving the effect depth.
const DROPS = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  left:     `${5  + ((i * 9.1  + (i % 4) * 3.7) % 89).toFixed(1)}%`,
  w:        4 + (i % 4),                           // 4–7 px wide
  h:        7 + (i % 5) * 3,                       // 7–19 px tall teardrop
  duration: `${2.6 + (i % 5) * 0.55}s`,
  delay:    `${-((i * 0.58 + (i % 3) * 1.3) % 8).toFixed(2)}s`,
  sway:     -8 + (i % 5) * 4,
}));

// ── Rising ember sparks from the bottom ──────────────────────────────────────
const EMBERS = Array.from({ length: 24 }, (_, i) => ({
  id: i,
  left:     `${1  + ((i * 4.1  + (i % 6) * 2.7) % 97).toFixed(1)}%`,
  size:     2 + (i % 5),                          // 2–6 px
  duration: `${1.6 + (i % 6) * 0.45}s`,
  delay:    `${-((i * 0.41 + (i % 5) * 0.73) % 5).toFixed(2)}s`,
  drift:    -18 + (i % 7) * 6,                    // –18 to +18 px horizontal drift
}));

interface RageOverlayProps {
  onEnd: () => void;
}

export function RageOverlay({ onEnd }: RageOverlayProps) {
  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{ zIndex: 46, pointerEvents: 'none' }}
    >

      {/* ── 1. Full-screen blood-red tint — lub-dub heartbeat ──────────── */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(100, 0, 0, 0.38)',
        animation: 'rage-heartbeat 0.68s ease-in-out infinite',
        willChange: 'opacity',
      }} />

      {/* ── 2. Heavy vignette — searing red edges, see-through center ──── */}
      <div style={{
        position: 'absolute', inset: 0,
        background:
          'radial-gradient(ellipse 68% 60% at 50% 50%, ' +
          'transparent 0%, rgba(160,0,0,0.42) 65%, rgba(210,0,0,0.92) 100%)',
        animation: 'rage-vignette 0.68s ease-in-out infinite',
        willChange: 'opacity',
      }} />

      {/* ── 3. Blood drips hanging from the top ───────────────────────── */}
      {DRIPS.map(d => (
        <div key={d.id} style={{
          position: 'absolute',
          top: 0,
          left: d.left,
          width:  d.width,
          height: d.length,
          background: 'linear-gradient(to bottom, #6b0000 0%, #cc1111 55%, rgba(160,0,0,0) 100%)',
          borderRadius: `0 0 ${d.width * 2}px ${d.width * 2}px`,
          opacity: d.opacity,
          transformOrigin: 'top center',
          ['--sway' as string]: d.sway,
          animation: `rage-drip ${d.duration} ${d.delay} ease-in infinite`,
          willChange: 'transform, opacity',
        } as React.CSSProperties} />
      ))}

      {/* ── 3b. Leading teardrops — break off ahead of each stream ────── */}
      {DROPS.map(d => (
        <div key={d.id} style={{
          position: 'absolute',
          top: 0,
          left: d.left,
          width:  d.w,
          height: d.h,
          background: 'radial-gradient(ellipse at 50% 30%, #ee1111 0%, #6b0000 100%)',
          borderRadius: '50% 50% 60% 60% / 40% 40% 60% 60%',
          ['--sway' as string]: d.sway,
          animation: `rage-drop ${d.duration} ${d.delay} ease-in infinite`,
          willChange: 'transform, opacity',
        } as React.CSSProperties} />
      ))}

      {/* ── 4. Rising cinders / ember sparks ─────────────────────────── */}
      {EMBERS.map(e => (
        <div key={e.id} style={{
          position: 'absolute',
          bottom: 0,
          left: e.left,
          width:  e.size,
          height: e.size,
          borderRadius: '50%',
          background: 'radial-gradient(circle, #ff9944, #cc2200)',
          boxShadow: `0 0 ${e.size * 2}px ${e.size}px rgba(255,60,0,0.55)`,
          ['--drift' as string]: e.drift,
          animation: `rage-ember ${e.duration} ${e.delay} ease-out infinite`,
          willChange: 'transform, opacity',
        } as React.CSSProperties} />
      ))}

      {/* ── 5. Corner burns — intense radial glow at every corner ──────── */}
      {([
        { top: 0,    left:  0,     origin: '0% 0%'     },
        { top: 0,    right: 0,     origin: '100% 0%'   },
        { bottom: 0, left:  0,     origin: '0% 100%'   },
        { bottom: 0, right: 0,     origin: '100% 100%' },
      ] as const).map((pos, ci) => (
        <div key={ci} style={{
          position: 'absolute',
          ...pos,
          width:  220,
          height: 220,
          background: `radial-gradient(ellipse at ${pos.origin}, rgba(220,0,0,0.55) 0%, transparent 70%)`,
          animation: `rage-corner 1.1s ${-(ci * 0.28).toFixed(2)}s ease-in-out infinite`,
          willChange: 'opacity',
        }} />
      ))}

      {/* ── 6. End Rage button — always visible, pointer-events re-enabled ─ */}
      <button
        onClick={onEnd}
        style={{
          position:       'absolute',
          bottom:         28,
          left:           '50%',
          transform:      'translateX(-50%)',
          pointerEvents:  'auto',
          background:     'rgba(20, 0, 0, 0.88)',
          border:         '1px solid rgba(200, 0, 0, 0.75)',
          borderRadius:   10,
          color:          '#ff9999',
          fontWeight:     700,
          fontSize:       13,
          letterSpacing:  '0.06em',
          padding:        '9px 22px',
          cursor:         'pointer',
          boxShadow:      '0 0 18px rgba(180,0,0,0.5), inset 0 1px 0 rgba(255,80,80,0.15)',
          backdropFilter: 'blur(6px)',
          whiteSpace:     'nowrap',
          animation:      'rage-endbtn 2.2s ease-in-out infinite',
          willChange:     'opacity, box-shadow',
          userSelect:     'none',
        }}
      >
        ⚔ End Effect
      </button>

      <style>{`
        /* Lub-dub heartbeat: two quick pulses then rest */
        @keyframes rage-heartbeat {
          0%   { opacity: 0.55; }
          10%  { opacity: 1.00; }   /* lub */
          22%  { opacity: 0.65; }
          34%  { opacity: 1.00; }   /* dub */
          52%  { opacity: 0.50; }
          100% { opacity: 0.55; }
        }
        /* Vignette pulses slightly out of phase for depth */
        @keyframes rage-vignette {
          0%   { opacity: 0.65; }
          10%  { opacity: 1.00; }
          22%  { opacity: 0.70; }
          34%  { opacity: 1.00; }
          52%  { opacity: 0.60; }
          100% { opacity: 0.65; }
        }
        /* Blood stream: materialises at ceiling, elongates, then slides the full
           viewport height with a gentle horizontal sway — ease-in so it
           accelerates like real blood under gravity */
        @keyframes rage-drip {
          0%   { transform: translateY(0)    translateX(0)                              scaleY(0);   opacity: 0;   }
          6%   {                                                                                      opacity: 0.9; }
          18%  { transform: translateY(0)    translateX(calc(var(--sway) * 0.3px))      scaleY(1);               }
          80%  { transform: translateY(78vh) translateX(calc(var(--sway) * 1px))        scaleY(1);   opacity: 0.8; }
          100% { transform: translateY(96vh) translateX(calc(var(--sway) * 1.4px))      scaleY(0.6); opacity: 0;   }
        }
        /* Leading teardrop: breaks off the tip and accelerates ahead of the stream */
        @keyframes rage-drop {
          0%   { transform: translateY(-8px)  translateX(0)                           scale(1);   opacity: 0;   }
          5%   {                                                                                   opacity: 1;   }
          65%  { transform: translateY(62vh)  translateX(calc(var(--sway) * 1px))     scale(0.9); opacity: 0.9; }
          100% { transform: translateY(94vh)  translateX(calc(var(--sway) * 1.6px))   scale(0.4); opacity: 0;   }
        }
        /* Ember: rises fast from the bottom, drifts sideways, burns out */
        @keyframes rage-ember {
          0%   { transform: translateY(0)     translateX(0)                          scale(1.0); opacity: 0;   }
          8%   {                                                                                  opacity: 0.9; }
          45%  { transform: translateY(-35vh) translateX(calc(var(--drift) * 0.5px)) scale(0.6); }
          82%  { transform: translateY(-70vh) translateX(calc(var(--drift) * 1px))   scale(0.2); opacity: 0.4; }
          100% { transform: translateY(-95vh) translateX(calc(var(--drift) * 1.3px)) scale(0);   opacity: 0;   }
        }
        /* Corner burns pulse on staggered timing */
        @keyframes rage-corner {
          0%, 100% { opacity: 0.45; }
          50%       { opacity: 1.00; }
        }
        /* End Rage button: slow glow pulse so it draws the eye */
        @keyframes rage-endbtn {
          0%, 100% { opacity: 0.75; box-shadow: 0 0 18px rgba(180,0,0,0.5), inset 0 1px 0 rgba(255,80,80,0.15); }
          50%       { opacity: 1.00; box-shadow: 0 0 32px rgba(220,0,0,0.8), inset 0 1px 0 rgba(255,80,80,0.25); }
        }
      `}</style>
    </div>
  );
}
