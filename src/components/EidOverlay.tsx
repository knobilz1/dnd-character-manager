// Eid Mubarak overlay — v2
//
// • Large crescent moon with glow rays + companion star
// • 80 twinkling stars (dot + diamond shapes)
// • 3 shooting stars
// • 22 rising gold dust particles
// • 10 ornate hanging lanterns on a festival string
// • Glowing "Eid Mubarak" / عيد مبارك header
//
// All animations: transform + opacity only (GPU composited).

const LANTERN_COLORS = [
  '#c9a84c', // gold
  '#d4246e', // rose
  '#1e8c45', // emerald
  '#b5451b', // amber
  '#2255aa', // sapphire
  '#9b2dd4', // violet
  '#c9a84c',
  '#1e8c45',
  '#d4246e',
  '#2255aa',
];

// ── Stars ────────────────────────────────────────────────────────────────────
const STARS = Array.from({ length: 80 }, (_, i) => ({
  id: i,
  top:    `${2  + ((i * 1.62 + (i % 7) * 0.8)  % 58).toFixed(1)}%`,
  left:   `${0  + ((i * 1.27 + (i % 6) * 1.4)  % 99).toFixed(1)}%`,
  size:   1 + (i % 4),          // 1–4 px
  isDiamond: i % 5 === 0,       // every 5th star is a ✦ shape
  duration: `${1.8 + (i % 5)}s`,
  delay:    `${-((i * 0.55 + (i % 6) * 0.3) % 5).toFixed(2)}s`,
}));

// ── Shooting stars ────────────────────────────────────────────────────────────
const SHOOTING_STARS = Array.from({ length: 3 }, (_, i) => ({
  id: i,
  top:   `${6  + i * 9}%`,
  left:  `${70 + i * 10}%`,
  duration: `${5 + i * 3}s`,
  delay:    `${-(i * 2.8).toFixed(1)}s`,
}));

// ── Gold dust particles ───────────────────────────────────────────────────────
const SPARKLES = Array.from({ length: 22 }, (_, i) => ({
  id: i,
  left:    `${3  + ((i * 4.3 + (i % 5) * 2.1) % 94).toFixed(1)}%`,
  size:    2 + (i % 3),         // 2–4 px
  duration: `${5 + (i % 6)}s`,
  delay:    `${-((i * 0.7 + (i % 4) * 1.1) % 9).toFixed(2)}s`,
}));

// ── Lanterns ──────────────────────────────────────────────────────────────────
const LANTERNS = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  // spread across 8–92 % horizontally
  left:     `${8 + i * 8.5}%`,
  // stagger rope lengths so they hang at different heights
  ropeVh:   5 + (i % 4) * 3.5,
  swayDur:  `${3.2 + (i % 4) * 0.7}s`,
  glowDur:  `${1.8 + (i % 5) * 0.5}s`,
  delay:    `${-(i * 0.48).toFixed(2)}s`,
  color:    LANTERN_COLORS[i],
  // scale varies slightly for depth
  scale:    0.85 + (i % 3) * 0.15,
}));

// ── String light bulbs ────────────────────────────────────────────────────────
const BULBS = Array.from({ length: 24 }, (_, i) => ({
  id: i,
  left: `${(i / 23) * 100}%`,
  color: LANTERN_COLORS[i % LANTERN_COLORS.length],
  dur:  `${1.5 + (i % 5) * 0.4}s`,
  delay: `${-(i * 0.18).toFixed(2)}s`,
}));

export function EidOverlay() {
  return (
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 5 }}
      aria-hidden
    >

      {/* ── Stars ── */}
      {STARS.map(s => (
        s.isDiamond ? (
          /* Diamond / ✦ star */
          <div key={s.id} style={{
            position: 'absolute', top: s.top, left: s.left,
            fontSize: s.size * 4,
            color: '#fff8e7',
            textShadow: `0 0 ${s.size * 3}px #e2c97e, 0 0 ${s.size * 6}px #c9a84c88`,
            lineHeight: 1,
            animation: `eid-star-twinkle ${s.duration} ${s.delay} ease-in-out infinite`,
            willChange: 'transform, opacity',
          }}>✦</div>
        ) : (
          /* Dot star */
          <div key={s.id} style={{
            position: 'absolute', top: s.top, left: s.left,
            width: s.size, height: s.size,
            borderRadius: '50%',
            background: '#fff8e7',
            boxShadow: `0 0 ${s.size + 2}px 1px #e2c97e99`,
            animation: `eid-star-twinkle ${s.duration} ${s.delay} ease-in-out infinite`,
            willChange: 'transform, opacity',
          }} />
        )
      ))}

      {/* ── Shooting stars ── */}
      {SHOOTING_STARS.map(ss => (
        <div key={ss.id} style={{
          position: 'absolute',
          top: ss.top, left: ss.left,
          width: 120, height: 2,
          borderRadius: 2,
          background: 'linear-gradient(to left, #fff8e7cc, transparent)',
          animation: `eid-shoot ${ss.duration} ${ss.delay} ease-in infinite`,
          willChange: 'transform, opacity',
        }} />
      ))}

      {/* ── Crescent moon — top-right ── */}
      <div style={{
        position: 'absolute',
        top: '3%', right: '5%',
        animation: 'eid-crescent-float 7s ease-in-out infinite',
        willChange: 'transform',
      }}>
        {/* Outer glow rings */}
        <div style={{
          position: 'absolute',
          top: -20, left: -20, right: -20, bottom: -20,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse at center, #c9a84c22 0%, transparent 70%)',
          animation: 'eid-moon-pulse 3s ease-in-out infinite',
          willChange: 'opacity',
        }} />

        {/* Moon body */}
        <div style={{ position: 'relative', width: 76, height: 76 }}>
          {/* Full circle */}
          <div style={{
            position: 'absolute', inset: 0,
            borderRadius: '50%',
            background: 'radial-gradient(ellipse at 35% 35%, #f0dfa0, #c9a84c)',
            boxShadow: '0 0 22px 8px #c9a84caa, 0 0 60px 20px #c9a84c55, 0 0 100px 40px #c9a84c22',
          }} />
          {/* Cutout circle to form crescent */}
          <div style={{
            position: 'absolute',
            top: -5, left: 16,
            width: 76, height: 76,
            borderRadius: '50%',
            background: 'linear-gradient(150deg, #050a0f 25%, #0a1628 80%)',
          }} />
        </div>

        {/* Glow rays */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, ri) => (
          <div key={ri} style={{
            position: 'absolute',
            top: '50%', left: '50%',
            width: 40 + (ri % 3) * 12, height: 1.5,
            marginTop: -0.75,
            background: `linear-gradient(to right, transparent, #c9a84c${ri % 2 === 0 ? '55' : '33'}, transparent)`,
            transform: `rotate(${deg}deg)`,
            transformOrigin: '0 50%',
            animation: `eid-ray-pulse ${2.5 + ri * 0.18}s ${-(ri * 0.3).toFixed(1)}s ease-in-out infinite`,
            willChange: 'opacity',
          }} />
        ))}

        {/* Star companion */}
        <div style={{
          position: 'absolute', top: 10, right: -18,
          fontSize: 20,
          color: '#e2c97e',
          textShadow: '0 0 10px #c9a84c, 0 0 24px #c9a84c88',
          lineHeight: 1,
          animation: 'eid-star-twinkle 2.2s -0.8s ease-in-out infinite',
        }}>★</div>
      </div>

      {/* ── Festival string across top ── */}
      <div style={{
        position: 'absolute', top: '7.5%', left: 0, right: 0,
        height: 1,
        background: 'linear-gradient(to right, transparent 2%, #c9a84c55 10%, #c9a84c55 90%, transparent 98%)',
      }} />
      {BULBS.map(b => (
        <div key={b.id} style={{
          position: 'absolute',
          top: '7.5%',
          left: b.left,
          transform: 'translate(-50%, -1px)',
          width: 6, height: 8,
          borderRadius: '2px 2px 50% 50%',
          background: b.color,
          boxShadow: `0 0 6px 2px ${b.color}99`,
          animation: `eid-bulb-glow ${b.dur} ${b.delay} ease-in-out infinite`,
          willChange: 'opacity',
        }} />
      ))}

      {/* ── Hanging lanterns ── */}
      {LANTERNS.map(l => (
        <div key={l.id} style={{
          position: 'absolute',
          top: '7.5%',
          left: l.left,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          transformOrigin: 'top center',
          transform: `scale(${l.scale})`,
          animation: `eid-lantern-sway ${l.swayDur} ${l.delay} ease-in-out infinite`,
          willChange: 'transform',
        }}>
          {/* Rope */}
          <div style={{
            width: 1.5,
            height: `${l.ropeVh}vh`,
            background: `linear-gradient(to bottom, #c9a84c99, #c9a84c44)`,
          }} />

          {/* Top cap */}
          <div style={{
            width: 28, height: 6,
            borderRadius: '3px 3px 0 0',
            background: `linear-gradient(180deg, ${l.color}ff, ${l.color}cc)`,
            border: `1px solid ${l.color}`,
          }} />

          {/* Upper taper */}
          <div style={{
            width: 0, height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: `8px solid ${l.color}cc`,
            marginTop: -1,
          }} />

          {/* Main body */}
          <div style={{
            width: 32, height: 40,
            borderRadius: '6px',
            background: `linear-gradient(180deg, ${l.color}ee 0%, ${l.color}77 50%, ${l.color}aa 100%)`,
            border: `1px solid ${l.color}`,
            boxShadow: `0 0 16px 6px ${l.color}66, 0 0 32px 12px ${l.color}33`,
            animation: `eid-lantern-glow ${l.glowDur} ${l.delay} ease-in-out infinite`,
            willChange: 'opacity',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Horizontal ribs */}
            {[25, 50, 75].map(pct => (
              <div key={pct} style={{
                position: 'absolute', top: `${pct}%`,
                left: 0, right: 0, height: 1,
                background: `${l.color}88`,
              }} />
            ))}
            {/* Vertical centre line */}
            <div style={{
              position: 'absolute', top: 0, bottom: 0,
              left: '50%', width: 1,
              background: `${l.color}44`,
            }} />
            {/* Inner candle glow */}
            <div style={{
              position: 'absolute', inset: 0,
              background: `radial-gradient(ellipse at 50% 60%, #fff8e799, transparent 65%)`,
            }} />
          </div>

          {/* Lower point */}
          <div style={{
            width: 0, height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: `12px solid ${l.color}aa`,
          }} />

          {/* Tassel */}
          <div style={{
            display: 'flex', gap: 3, marginTop: 1,
          }}>
            {[0,1,2].map(t => (
              <div key={t} style={{
                width: 1.5, height: 6 + t * 2,
                background: `linear-gradient(to bottom, ${l.color}, transparent)`,
                borderRadius: 1,
              }} />
            ))}
          </div>
        </div>
      ))}

      {/* ── Rising gold dust ── */}
      {SPARKLES.map(sp => (
        <div key={sp.id} style={{
          position: 'absolute',
          bottom: 0,
          left: sp.left,
          width: sp.size, height: sp.size,
          borderRadius: '50%',
          background: `radial-gradient(circle, #f0dfa0, #c9a84c)`,
          boxShadow: `0 0 ${sp.size + 2}px ${sp.size}px #c9a84c55`,
          animation: `eid-sparkle-rise ${sp.duration} ${sp.delay} ease-in infinite`,
          willChange: 'transform, opacity',
        }} />
      ))}

      {/* ── Eid Mubarak header ── */}
      <div style={{
        position: 'absolute',
        top: '1.5%',
        left: '50%',
        transform: 'translateX(-50%)',
        textAlign: 'center',
        pointerEvents: 'none',
        userSelect: 'none',
      }}>
        <div style={{
          color: '#e2c97e',
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: '0.2em',
          textShadow: '0 0 12px #c9a84c, 0 0 28px #c9a84c88',
          animation: 'eid-text-glow 2.5s ease-in-out infinite',
          willChange: 'opacity',
        }}>
          عيد مبارك &nbsp;·&nbsp; Eid Mubarak
        </div>
      </div>

      <style>{`
        @keyframes eid-star-twinkle {
          0%, 100% { opacity: 0.9; transform: scale(1);    }
          50%       { opacity: 0.2; transform: scale(0.65); }
        }
        @keyframes eid-crescent-float {
          0%   { transform: translateY(0)   rotate(-5deg); }
          50%  { transform: translateY(-9px) rotate(-3deg); }
          100% { transform: translateY(0)   rotate(-5deg); }
        }
        @keyframes eid-moon-pulse {
          0%, 100% { opacity: 0.6; transform: scale(1);    }
          50%       { opacity: 1;   transform: scale(1.15); }
        }
        @keyframes eid-ray-pulse {
          0%, 100% { opacity: 0.25; }
          50%       { opacity: 0.7;  }
        }
        @keyframes eid-lantern-sway {
          0%   { transform: rotate(-8deg);  }
          50%  { transform: rotate(8deg);   }
          100% { transform: rotate(-8deg);  }
        }
        @keyframes eid-lantern-glow {
          0%, 100% { opacity: 0.7;  }
          50%       { opacity: 1.0;  }
        }
        @keyframes eid-bulb-glow {
          0%, 100% { opacity: 0.5; }
          50%       { opacity: 1.0; }
        }
        @keyframes eid-text-glow {
          0%, 100% { opacity: 0.8; }
          50%       { opacity: 1.0; }
        }
        @keyframes eid-sparkle-rise {
          0%   { transform: translateY(0)     translateX(0);      opacity: 0;    }
          8%   {                                                   opacity: 0.8;  }
          30%  { transform: translateY(-28vh) translateX(6px);                   }
          60%  { transform: translateY(-58vh) translateX(-8px);                  }
          88%  {                                                   opacity: 0.5;  }
          100% { transform: translateY(-96vh) translateX(4px);    opacity: 0;    }
        }
        @keyframes eid-shoot {
          0%   { transform: translateX(0)     translateY(0);    opacity: 0;   }
          5%   {                                                 opacity: 0.9; }
          70%  { transform: translateX(-55vw) translateY(20vh); opacity: 0.4; }
          85%  {                                                 opacity: 0;   }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
