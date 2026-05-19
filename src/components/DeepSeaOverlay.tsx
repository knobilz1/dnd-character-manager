import React from 'react';

// ── Wave layers at the top of the screen ─────────────────────────────────────
// Three overlapping arched bands. border-radius is static (no repaint);
// only transform is animated so these stay on the GPU compositor layer.
const WAVE_LAYERS = [
  { h: 95,  radius: '0 0 52% 48% / 0 0 32px 28px', color: 'rgba(8, 145, 178, 0.20)',  anim: 'wave-a', dur: '7s',  delay: '0s'   },
  { h: 70,  radius: '0 0 42% 58% / 0 0 22px 36px', color: 'rgba(6, 182, 212, 0.13)',  anim: 'wave-b', dur: '9s',  delay: '-3s'  },
  { h: 125, radius: '0 0 60% 40% / 0 0 38px 20px', color: 'rgba(2, 132, 199, 0.09)',  anim: 'wave-c', dur: '12s', delay: '-7s'  },
] as const;

// ── Bubbles (deterministic, no Math.random) ───────────────────────────────────
const BUBBLES = Array.from({ length: 30 }, (_, i) => ({
  id: i,
  left:     `${((i * 3.37 + (i % 5) * 4.9) % 100).toFixed(1)}%`,
  size:     3 + (i % 9),                          // 3 – 11 px
  duration: `${7 + (i % 12)}s`,                   // 7 – 18 s
  delay:    `-${((i * 0.73) % 16).toFixed(1)}s`,  // already mid-air on switch
  variant:  i % 2 === 0 ? 'bubble-rise-a' : 'bubble-rise-b',
  opacity:  +(0.25 + (i % 6) * 0.07).toFixed(2),  // 0.25 – 0.60
}));

// ── Jellyfish — float in place with a gentle pulsing bob ─────────────────────
const JELLIES = [
  { id: 0, left: '8%',  top: '28%', size: 24, dur: '5.5s', delay: '0s'    },
  { id: 1, left: '63%', top: '38%', size: 20, dur: '7s',   delay: '-2s'   },
  { id: 2, left: '34%', top: '60%', size: 26, dur: '6.5s', delay: '-4.5s' },
  { id: 3, left: '82%', top: '22%', size: 18, dur: '8s',   delay: '-1.5s' },
  { id: 4, left: '50%', top: '75%', size: 22, dur: '6s',   delay: '-3s'   },
] as const;

// ── Fish — swim across the screen at various depths ───────────────────────────
// 'left' = swims from right → left (flip); 'right' = swims left → right.
const FISH = [
  { id: 0, emoji: '🐠', top: '33%', size: 22, dur: '22s', delay: '-4s',  dir: 'left'  },
  { id: 1, emoji: '🐟', top: '54%', size: 18, dur: '29s', delay: '-15s', dir: 'right' },
  { id: 2, emoji: '🦑', top: '68%', size: 20, dur: '20s', delay: '-9s',  dir: 'left'  },
  { id: 3, emoji: '🐡', top: '18%', size: 16, dur: '34s', delay: '-22s', dir: 'right' },
  { id: 4, emoji: '🐙', top: '80%', size: 24, dur: '26s', delay: '-11s', dir: 'left'  },
] as const;

export function DeepSeaOverlay() {
  return (
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 45 }}
      aria-hidden="true"
    >
      {/* ── Water surface waves ─────────────────────────────────── */}
      {WAVE_LAYERS.map((w, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            top: 0,
            left: '-10%',
            width: '120%',
            height: w.h,
            background: w.color,
            borderRadius: w.radius,
            willChange: 'transform',
            animation: `${w.anim} ${w.dur} ${w.delay} ease-in-out infinite`,
          }}
        />
      ))}

      {/* ── Rising bubbles ──────────────────────────────────────── */}
      {BUBBLES.map(b => (
        <div
          key={b.id}
          className="absolute rounded-full"
          style={{
            bottom: 0,
            left: b.left,
            width:  b.size,
            height: b.size,
            background: `rgba(186, 230, 253, ${b.opacity})`,
            border: `1px solid rgba(103, 232, 249, ${b.opacity * 0.6})`,
            willChange: 'transform, opacity',
            animation: `${b.variant} ${b.duration} ${b.delay} ease-in-out infinite`,
          }}
        />
      ))}

      {/* ── Jellyfish floating in the mid-water ─────────────────── */}
      {JELLIES.map(j => (
        <span
          key={j.id}
          className="absolute select-none"
          style={{
            left: j.left,
            top:  j.top,
            fontSize:   j.size,
            lineHeight: 1,
            opacity: 0.75,
            animation: `jelly-float ${j.dur} ${j.delay} ease-in-out infinite`,
          }}
        >
          🪼
        </span>
      ))}

      {/* ── Fish swimming across the screen ─────────────────────── */}
      {FISH.map(f => (
        <span
          key={f.id}
          className="absolute select-none"
          style={{
            top:        f.top,
            left:       0,
            fontSize:   f.size,
            lineHeight: 1,
            animation:  `fish-swim-${f.dir} ${f.dur} ${f.delay} linear infinite`,
          }}
        >
          {f.emoji}
        </span>
      ))}
    </div>
  );
}
