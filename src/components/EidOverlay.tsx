// Eid Mubarak overlay — crescent moon, twinkling stars, hanging lanterns.
// All animations use only transform + opacity (GPU composited).

// 55 deterministic stars spread across the sky
const STARS = Array.from({ length: 55 }, (_, i) => ({
  id: i,
  top:  `${2  + ((i * 1.8  + (i % 7) * 0.9)  % 55).toFixed(1)}%`,
  left: `${0  + ((i * 1.84 + (i % 5) * 1.3)  % 99).toFixed(1)}%`,
  size: 1 + (i % 3),                            // 1–3 px
  duration: `${2 + (i % 4)}s`,
  delay:    `${-((i * 0.6 + (i % 5) * 0.4) % 4).toFixed(2)}s`,
}));

// 6 lanterns hanging from the top
const LANTERNS = Array.from({ length: 6 }, (_, i) => ({
  id: i,
  left: `${8 + i * 15}%`,
  ropePct: 6 + (i % 3) * 4,   // rope length as % of viewport height
  swayDur: `${3.5 + (i % 3) * 0.8}s`,
  glowDur: `${2   + (i % 4) * 0.5}s`,
  delay:   `${-(i * 0.55).toFixed(2)}s`,
  color:   ['#c9a84c','#d4246e','#1e8c45','#b5451b','#2255aa','#9b2dd4'][i],
}));

export function EidOverlay() {
  return (
    <div
      className="fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 5 }}
      aria-hidden
    >
      {/* Stars */}
      {STARS.map(s => (
        <div
          key={s.id}
          style={{
            position: 'absolute',
            top:  s.top,
            left: s.left,
            width:  s.size,
            height: s.size,
            borderRadius: '50%',
            background: '#fff8e7',
            boxShadow: `0 0 ${s.size + 1}px 1px #e2c97e99`,
            animation: `eid-star-twinkle ${s.duration} ${s.delay} ease-in-out infinite`,
            willChange: 'transform, opacity',
          }}
        />
      ))}

      {/* Crescent moon — top-right */}
      <div
        style={{
          position: 'absolute',
          top: '4%',
          right: '6%',
          animation: 'eid-crescent-float 6s ease-in-out infinite',
          willChange: 'transform',
        }}
      >
        {/* Crescent via two overlapping circles */}
        <div style={{ position: 'relative', width: 52, height: 52 }}>
          {/* Full circle */}
          <div style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: '#e2c97e',
            boxShadow: '0 0 18px 6px #c9a84c88, 0 0 40px 10px #c9a84c44',
          }} />
          {/* Mask — offset circle that "bites" the crescent */}
          <div style={{
            position: 'absolute',
            top: -4, left: 12,
            width: 52, height: 52,
            borderRadius: '50%',
            // Match the night-sky gradient to create the crescent cutout illusion
            background: 'linear-gradient(160deg, #050a0f 30%, #0a1628 100%)',
          }} />
        </div>
        {/* Star next to crescent */}
        <div style={{
          position: 'absolute',
          top: 8, right: -10,
          fontSize: 14,
          color: '#e2c97e',
          textShadow: '0 0 8px #c9a84c',
          lineHeight: 1,
        }}>★</div>
      </div>

      {/* Hanging lanterns */}
      {LANTERNS.map(l => (
        <div
          key={l.id}
          style={{
            position: 'absolute',
            top: 0,
            left: l.left,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            transformOrigin: 'top center',
            animation: `eid-lantern-sway ${l.swayDur} ${l.delay} ease-in-out infinite`,
            willChange: 'transform',
          }}
        >
          {/* Rope */}
          <div style={{
            width: 1,
            height: `${l.ropePct}vh`,
            background: `linear-gradient(to bottom, #c9a84c88, #c9a84c44)`,
          }} />
          {/* Lantern body */}
          <div
            style={{
              width: 18, height: 28,
              borderRadius: '4px 4px 8px 8px',
              background: `linear-gradient(180deg, ${l.color}dd, ${l.color}88)`,
              border: `1px solid ${l.color}`,
              boxShadow: `0 0 12px 4px ${l.color}55, 0 0 24px 8px ${l.color}22`,
              animation: `eid-lantern-glow ${l.glowDur} ${l.delay} ease-in-out infinite`,
              willChange: 'opacity',
              position: 'relative',
            }}
          >
            {/* Lantern ribs */}
            {[30, 50, 70].map(pct => (
              <div key={pct} style={{
                position: 'absolute',
                top: `${pct}%`,
                left: 0, right: 0,
                height: 1,
                background: `${l.color}66`,
              }} />
            ))}
            {/* Inner glow */}
            <div style={{
              position: 'absolute',
              inset: 4,
              borderRadius: 3,
              background: `radial-gradient(ellipse at center, #fff8e766, transparent)`,
            }} />
          </div>
          {/* Tassel */}
          <div style={{
            width: 1, height: 8,
            background: `linear-gradient(to bottom, ${l.color}, transparent)`,
          }} />
        </div>
      ))}

      {/* "Eid Mubarak" text — faint, top-left */}
      <div style={{
        position: 'absolute',
        top: '3%',
        left: '3%',
        color: '#c9a84c44',
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        pointerEvents: 'none',
        userSelect: 'none',
      }}>
        عيد مبارك
      </div>
    </div>
  );
}
