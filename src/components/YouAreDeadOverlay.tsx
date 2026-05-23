// YouAreDeadOverlay — Dark Souls "YOU ARE DEAD" death screen.
//
// Triggered when 3 death save failures are recorded.
//
// Sequence:
//   0.0 – 1.2s  Black overlay fades in, obscuring the sheet
//   1.4s        "YOU ARE DEAD" text begins to materialise
//   1.4 – 3.4s  Text spreads horizontally, sharpens, red glow builds
//   3.4s+       Glow pulses gently; text holds
//   4.5s        "Click anywhere to dismiss" hint fades in
//
// Clicking while the hint is visible triggers a fade-out → onDismiss callback.

import React from 'react';

interface Props {
  onDismiss: () => void;
}

export function YouAreDeadOverlay({ onDismiss }: Props) {
  const [showText,    setShowText]    = React.useState(false);
  const [showHint,    setShowHint]    = React.useState(false);
  const [dismissing,  setDismissing]  = React.useState(false);

  React.useEffect(() => {
    const t1 = setTimeout(() => setShowText(true),  1400);
    const t2 = setTimeout(() => setShowHint(true),  4600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  function handleClick() {
    if (!showHint || dismissing) return;
    setDismissing(true);
    setTimeout(onDismiss, 750);
  }

  return (
    <div
      onClick={handleClick}
      style={{
        position:       'fixed',
        inset:          0,
        zIndex:         300,
        display:        'flex',
        flexDirection:  'column',
        alignItems:     'center',
        justifyContent: 'center',
        cursor:         showHint && !dismissing ? 'pointer' : 'default',
        animation:      dismissing ? 'yad-out 0.75s ease-in forwards' : undefined,
      }}
    >
      <style>{`
        /* ── entrance / exit ───────────────────────────────────── */
        @keyframes yad-blackout {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes yad-out {
          from { opacity: 1; }
          to   { opacity: 0; }
        }

        /* ── vignette pulse (subtle heartbeat on the dark bg) ──── */
        @keyframes yad-vignette-pulse {
          0%, 100% { opacity: 0.65; }
          50%      { opacity: 0.85; }
        }

        /* ── text: horizontal spread + blur clear + glow build ─── */
        @keyframes yad-text-in {
          0%   {
            opacity:     0;
            transform:   scaleX(0.68);
            filter:      blur(14px);
            text-shadow: none;
          }
          20%  {
            opacity:     0.35;
            transform:   scaleX(0.82);
            filter:      blur(6px);
          }
          55%  {
            opacity:     0.85;
            transform:   scaleX(0.96);
            filter:      blur(1.5px);
            text-shadow: 0 0 50px rgba(160,15,15,0.75), 0 0 100px rgba(110,5,5,0.45);
          }
          100% {
            opacity:     1;
            transform:   scaleX(1);
            filter:      blur(0);
            text-shadow: 0 0 28px rgba(160,15,15,0.7), 0 0 70px rgba(110,5,5,0.4);
          }
        }

        /* ── slow glow pulse while text holds ─────────────────── */
        @keyframes yad-glow-pulse {
          0%, 100% {
            text-shadow: 0 0 28px rgba(160,15,15,0.7),  0 0 70px rgba(110,5,5,0.4);
          }
          50% {
            text-shadow: 0 0 50px rgba(190,20,20,0.95), 0 0 110px rgba(140,5,5,0.6);
          }
        }

        /* ── dismiss hint fade ─────────────────────────────────── */
        @keyframes yad-hint-in {
          from { opacity: 0; }
          to   { opacity: 0.38; }
        }
      `}</style>

      {/* ── solid black fill ──────────────────────────────────── */}
      <div style={{
        position:        'absolute',
        inset:           0,
        backgroundColor: '#000',
        animation:       'yad-blackout 1.2s ease-out forwards',
      }} />

      {/* ── radial vignette (edges darker / reddish) ──────────── */}
      <div style={{
        position:   'absolute',
        inset:      0,
        background: 'radial-gradient(ellipse at center, transparent 35%, rgba(60,0,0,0.7) 100%)',
        animation:  'yad-vignette-pulse 4s ease-in-out 2s infinite',
        opacity:    0.65,
      }} />

      {/* ── YOU ARE DEAD ──────────────────────────────────────── */}
      {showText && (
        <div
          style={{
            position:    'relative',
            zIndex:      1,
            fontFamily:  '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif',
            fontSize:    'clamp(2.8rem, 7.5vw, 5.8rem)',
            fontWeight:  700,
            color:       '#A01212',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            userSelect:  'none',
            // text-in animation, then hand off to glow-pulse at 2 s
            animation:   'yad-text-in 2s cubic-bezier(0.22, 0.8, 0.35, 1) forwards, yad-glow-pulse 3.5s ease-in-out 2s infinite',
          }}
        >
          YOU ARE DEAD
        </div>
      )}

      {/* ── dismiss hint ──────────────────────────────────────── */}
      {showHint && !dismissing && (
        <div style={{
          position:      'absolute',
          bottom:        '12%',
          left:          '50%',
          transform:     'translateX(-50%)',
          color:         'rgba(255,255,255,0.38)',
          fontSize:      '0.68rem',
          letterSpacing: '0.28em',
          textTransform: 'uppercase',
          fontFamily:    'sans-serif',
          whiteSpace:    'nowrap',
          userSelect:    'none',
          animation:     'yad-hint-in 1.2s ease-out forwards',
        }}>
          Click anywhere to dismiss
        </div>
      )}
    </div>
  );
}
