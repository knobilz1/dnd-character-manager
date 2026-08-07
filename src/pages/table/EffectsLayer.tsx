import React from 'react';
import type { PlacedEffect, EffectFamily } from '../../utils/dmActions';

/**
 * Procedural AoE spell areas drawn over the TV map's <img>.
 *
 * Everything here is CSS — gradients, clip-paths and keyframes — with no canvas and no
 * rAF. That is what makes an arbitrary radius exact: a 15-ft and a 30-ft sphere are the
 * same rule with a different pixel size, where pre-rendered art would have to be
 * rescaled (and its baked-in alpha could never be turned down).
 *
 * Geometry: the map PNG places cell (q,r) at `ruler + q*cellPx` pixels (see
 * battleMapRender.ts's composeRulerFrame). The <img> is object-contain, so we recompute
 * the fit scale + centering offsets from the natural size and apply them here — there is
 * no layout hook that gives us the drawn rect otherwise.
 *
 * Sizes come from the spell's real numbers: `ft` is a RADIUS for sphere/cylinder, so the
 * drawn diameter is 2*ft/cellFeet cells (a 10-ft radius covers 4 squares, not 2).
 */

/** Single tunable. Minis stand on these squares in real life, so the terrain and grid
 *  underneath must stay readable — an opaque blob would hide the thing the effect is
 *  meant to be affecting. */
const EFFECT_OPACITY = 0.5;

export interface EffectGrid {
  cols: number;
  rows: number;
  cellPx: number;
  ruler: number;
  cellFeet: number;
}

const FAMILY_CLASS: Record<EffectFamily, string> = {
  fire: 'fx-fire',
  cold: 'fx-cold',
  poison: 'fx-poison',
  web: 'fx-web',
  radiant: 'fx-radiant',
  necrotic: 'fx-necrotic',
  force: 'fx-force',
  fog: 'fx-fog',
  nature: 'fx-nature',
  lightning: 'fx-lightning',
};

/** Live drawn rect of an object-contain <img> inside its box. */
function useContainFit(img: HTMLImageElement | null) {
  const [fit, setFit] = React.useState<{ scale: number; dx: number; dy: number } | null>(null);
  React.useEffect(() => {
    if (!img) return;
    const measure = () => {
      const { naturalWidth: nw, naturalHeight: nh } = img;
      if (!nw || !nh) return;
      const { width: bw, height: bh } = img.getBoundingClientRect();
      const scale = Math.min(bw / nw, bh / nh);
      setFit({ scale, dx: (bw - nw * scale) / 2, dy: (bh - nh * scale) / 2 });
    };
    measure();
    if (!img.complete) img.addEventListener('load', measure);
    const ro = new ResizeObserver(measure);
    ro.observe(img);
    return () => { img.removeEventListener('load', measure); ro.disconnect(); };
  }, [img]);
  return fit;
}

export function EffectsLayer({ effects, grid, img }: {
  effects: PlacedEffect[];
  grid: EffectGrid;
  img: HTMLImageElement | null;
}) {
  const fit = useContainFit(img);
  if (!fit) return null;

  const cellFeet = grid.cellFeet || 5;
  const pxPerCell = grid.cellPx * fit.scale;
  const pxPerFoot = pxPerCell / cellFeet;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <EffectStyles />
      {effects.map((e) => {
        // Centre of the named cell, in screen pixels.
        const cx = fit.dx + (grid.ruler + (e.at.q + 0.5) * grid.cellPx) * fit.scale;
        const cy = fit.dy + (grid.ruler + (e.at.r + 0.5) * grid.cellPx) * fit.scale;

        let w: number;
        let h: number;
        let radius = '0';
        let clip: string | undefined;
        let originX = '50%';

        if (e.shape === 'sphere' || e.shape === 'cylinder') {
          w = h = e.ft * 2 * pxPerFoot;
          radius = '50%';
        } else if (e.shape === 'cube') {
          w = h = e.ft * pxPerFoot;
        } else if (e.shape === 'cone') {
          // 5e cones are as wide at the far end as they are long.
          w = e.ft * pxPerFoot;
          h = e.ft * pxPerFoot;
          clip = 'polygon(0% 50%, 100% 0%, 100% 100%)';
          originX = '0%'; // rotate about the caster, at the point of the wedge
        } else {
          w = e.ft * pxPerFoot;
          h = (e.widthFt ?? 5) * pxPerFoot;
        }

        // Three layers, each owning exactly one job, because they fight otherwise:
        //   wrapper — placement only. Unclipped and fully opaque, so the label is
        //             readable across a room and a cone's clip-path can't eat it.
        //   rotator — rotation + clip + the 50% wash.
        //   shape   — the family look, free to animate `transform` (flicker, pulse)
        //             without cancelling the rotation above it.
        const rotate = e.angleDeg ?? 0;
        const wrapper: React.CSSProperties = {
          left: cx,
          top: cy,
          width: w,
          height: h,
          transform: `translate(${originX === '0%' ? '0' : '-50%'}, -50%)`,
        };
        const rotator: React.CSSProperties = {
          borderRadius: radius,
          clipPath: clip,
          opacity: EFFECT_OPACITY,
          transform: `rotate(${rotate}deg)`,
          transformOrigin: `${originX} 50%`,
        };

        return (
          <div key={e.id} className="absolute" style={wrapper}>
            <div className="h-full w-full" style={rotator}>
              <div className={`h-full w-full ${FAMILY_CLASS[e.family]}`} style={{ borderRadius: radius }} />
            </div>
            <span className="fx-label">{e.name}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Scoped stylesheet. Inlined rather than a .css file so the whole overlay — geometry
 *  and look — stays in one reviewable place. */
function EffectStyles() {
  return (
    <style>{`
.fx-label {
  position: absolute; bottom: -22px; left: 50%; transform: translateX(-50%);
  background: rgba(0,0,0,.75); color: #eee; font: 700 13px system-ui, sans-serif;
  padding: 2px 9px; border-radius: 999px; white-space: nowrap; opacity: 1;
}
@keyframes fxFlicker { 0%,100% { transform: scale(1); filter: brightness(1);} 30% { transform: scale(1.05); filter: brightness(1.25);} 60% { transform: scale(.97); filter: brightness(.92);} }
@keyframes fxGlow    { 0%,100% { filter: brightness(1);} 45% { filter: brightness(1.35);} }
@keyframes fxDrift   { to { transform: rotate(360deg); } }
@keyframes fxPulse   { 0%,100% { filter: brightness(1); transform: scale(1);} 50% { filter: brightness(1.3); transform: scale(1.03);} }
@keyframes fxSeethe  { 0%,100% { filter: saturate(1);} 50% { filter: saturate(1.6) brightness(1.1);} }

.fx-fire {
  background: radial-gradient(circle, #fff3c4 0%, #ffb42e 30%, #ff5a1f 60%, #a3170a 85%, transparent 100%);
  box-shadow: 0 0 24px 6px rgba(255,120,30,.8);
  animation: fxFlicker 1.1s ease-in-out infinite;
}
.fx-cold {
  background: radial-gradient(circle, #f2fbff 0%, #b9e6ff 35%, #6ec1f0 70%, rgba(40,110,160,.7) 100%);
  box-shadow: 0 0 22px 6px rgba(150,215,255,.7);
  animation: fxPulse 3.2s ease-in-out infinite;
}
.fx-poison {
  background: radial-gradient(circle, rgba(154,205,50,.95) 0%, rgba(85,140,20,.9) 55%, rgba(40,80,10,.75) 80%, transparent 100%);
  position: relative; overflow: hidden;
}
.fx-poison::before {
  content: ''; position: absolute; inset: -50%;
  background: repeating-radial-gradient(circle at 40% 40%, transparent 0 18px, rgba(255,255,255,.14) 22px 30px, transparent 34px 52px);
  animation: fxDrift 9s linear infinite;
}
.fx-fog {
  background: radial-gradient(circle, rgba(228,232,238,.92) 0%, rgba(180,188,200,.85) 55%, rgba(120,130,145,.7) 82%, transparent 100%);
  position: relative; overflow: hidden;
}
.fx-fog::before {
  content: ''; position: absolute; inset: -50%;
  background: repeating-radial-gradient(circle at 55% 45%, transparent 0 20px, rgba(255,255,255,.22) 24px 34px, transparent 38px 58px);
  animation: fxDrift 13s linear infinite;
}
.fx-web {
  background:
    repeating-conic-gradient(from 0deg, rgba(240,240,235,.85) 0deg 1.5deg, transparent 1.5deg 30deg),
    radial-gradient(circle, transparent 0 8%, rgba(240,240,235,.5) 8.5% 9%, transparent 9.5% 22%, rgba(240,240,235,.5) 22.5% 23%, transparent 23.5% 36%, rgba(240,240,235,.5) 36.5% 37%, transparent 37.5% 50%, rgba(240,240,235,.5) 50.5% 51%, transparent 51.5%),
    rgba(200,200,190,.12);
}
.fx-radiant {
  background: radial-gradient(circle, #ffffff 0%, #dfe8ff 40%, #9fb4e8 70%, transparent 100%);
  box-shadow: 0 0 30px 10px rgba(200,215,255,.9);
  animation: fxPulse 2.4s ease-in-out infinite;
}
.fx-necrotic {
  background: radial-gradient(circle, #000 0%, #0b0316 55%, #1c0733 80%, transparent 100%);
  box-shadow: inset 0 0 40px 20px #000;
  animation: fxSeethe 5s ease-in-out infinite;
}
.fx-force {
  background: radial-gradient(circle, rgba(190,210,255,.55) 0%, rgba(120,150,240,.5) 60%, rgba(70,90,190,.45) 85%, transparent 100%);
  box-shadow: 0 0 18px 4px rgba(150,180,255,.6), inset 0 0 24px 6px rgba(200,220,255,.35);
  animation: fxGlow 3.5s ease-in-out infinite;
}
.fx-nature {
  background:
    repeating-conic-gradient(from 10deg, rgba(90,60,25,0) 0deg 8deg, rgba(96,70,30,.9) 9deg 11deg, rgba(90,60,25,0) 12deg 20deg),
    radial-gradient(circle, rgba(80,105,40,.85) 0%, rgba(60,80,30,.8) 70%, transparent 100%);
}
.fx-lightning {
  background: radial-gradient(circle, #ffffff 0%, #cfe4ff 25%, #6aa8ff 60%, rgba(30,70,170,.7) 100%);
  box-shadow: 0 0 26px 8px rgba(120,180,255,.85);
  animation: fxGlow 0.7s steps(2, end) infinite;
}
`}</style>
  );
}
