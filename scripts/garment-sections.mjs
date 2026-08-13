/**
 * garment-sections.mjs — named regions of a torso garment, with per-section deformation.
 *
 * ONE definition shared by the live fit panel (/model-review, via CharacterViewport) and the
 * offline baker (skin-garment.mjs --sections). The AoE lesson applies: two implementations of
 * the same geometry rule WILL drift — this module is imported by both sides so they cannot.
 *
 * Section names follow real vocabulary — tailoring's points of measure and armour part names —
 * with the symmetric ones split per side so each can be dialled alone:
 *   gorget                  the neck hole / collar ring
 *   pauldron_l, pauldron_r  shoulder caps (everything beyond the torso's half-width)
 *   armscye_l, armscye_r    the arm holes (tailoring's official word)
 *   breast                  breastplate (front core, chest band)
 *   back                    backplate  (rear core, chest band)
 *   waist                   middle band
 *   fauld                   skirt / hem lames (bottom, incl. the waist opening)
 *
 * Side convention: _l = the character's left = +x in the bodies' bind space (Reallusion/UE5
 * characters face +z with hand_l on +x). If a piece ever renders mirrored, swap the labels in
 * the panel, not the masks.
 *
 * All geometry rules are fractions of the garment's own bounding box plus one absolute width W
 * (the body chest half-width the piece was fitted to — baked into the GLB's scene extras by
 * skin-garment so the viewer uses the SAME boundary the baker used). All slider params are
 * CENTIMETRES of displacement at full weight (scale-free knobs confuse; cm read the same in the
 * panel and in the bake log). Weights are smoothstepped so a dialled section never tears at its
 * boundary — the hard-edged tuck pass shredding the cap lames is why.
 *
 * Plain JS on purpose: node imports it directly, vite bundles it for the review page.
 */

const ss = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** 0 outside [a,d], 1 inside [b,c], smooth ramps between. */
const band = (t, a, b, c, d) => ss(a, b, t) * (1 - ss(c, d, t));

/** Panel metadata: section -> params with labels and slider ranges (cm). */
export const SECTIONS = {
  gorget: { label: 'Neck hole (gorget)', params: { dy: ['up / down', -5, 5], open: ['close / open', -4, 4] } },
  pauldron_l: { label: 'Pauldron L', params: { inx: ['out / in', -5, 5], dy: ['down / up', -5, 5], dz: ['back / fwd', -4, 4] } },
  pauldron_r: { label: 'Pauldron R', params: { inx: ['out / in', -5, 5], dy: ['down / up', -5, 5], dz: ['back / fwd', -4, 4] } },
  armscye_l: { label: 'Arm hole L (armscye)', params: { dy: ['down / up', -5, 5], tight: ['widen / tighten', -4, 4] } },
  armscye_r: { label: 'Arm hole R (armscye)', params: { dy: ['down / up', -5, 5], tight: ['widen / tighten', -4, 4] } },
  breast: { label: 'Breastplate', params: { dz: ['in / out', -4, 4], widen: ['narrow / widen', -4, 4] } },
  back: { label: 'Backplate', params: { dz: ['in / out', -4, 4] } },
  // split front/back on request: "I really only want to adjust the back side at waist level".
  // The halves overlap smoothly at the sides so a girth change never creases a seam there.
  waist_f: { label: 'Waist front', params: { girth: ['tighten / loosen', -4, 4] } },
  waist_b: { label: 'Waist back', params: { girth: ['tighten / loosen', -4, 4] } },
  fauld: { label: 'Hem (fauld)', params: { dy: ['lengthen / shorten', -6, 6], flare: ['tuck / flare', -5, 5] } },
};

export const emptySectionParams = () => {
  const out = {};
  for (const [sec, def] of Object.entries(SECTIONS)) {
    out[sec] = {};
    for (const p of Object.keys(def.params)) out[sec][p] = 0;
  }
  return out;
};

/**
 * The arm holes are located by their actual RIM, not by a coordinate band. The first mask was a
 * band guess and its own cap/side factors cancelled to ~zero exactly on the armhole ("seemed to
 * do nothing" — correct, it did nothing). A hole has a precise definition: boundary edges, ones
 * referenced by a single triangle — found after welding UV-seam twins, because Tripo splits
 * seams and every seam edge would otherwise read as a boundary. Rim candidates are kept to the
 * side/upper region so the neck hole, hem edge and cap-lame edges don't join the ring.
 */
function armholeRims(pos, n, indices, { cx, yMin, H, w }) {
  const key = (i) => `${Math.round(pos[i * 3] * 100)},${Math.round(pos[i * 3 + 1] * 100)},${Math.round(pos[i * 3 + 2] * 100)}`;
  const weld = new Map(), rep = new Int32Array(n);
  for (let i = 0; i < n; i++) { const k = key(i); if (!weld.has(k)) weld.set(k, i); rep[i] = weld.get(k); }
  const edgeCount = new Map();
  for (let f = 0; f < indices.length; f += 3) {
    for (let e = 0; e < 3; e++) {
      const a = rep[indices[f + e]], b = rep[indices[f + ((e + 1) % 3)]];
      if (a === b) continue;
      const k = a < b ? a * n + b : b * n + a;
      edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
    }
  }
  const left = [], right = [];
  const seen = new Set();
  for (const [k, c] of edgeCount) {
    if (c !== 1) continue;
    for (const v of [Math.floor(k / n), k % n]) {
      if (seen.has(v)) continue;
      seen.add(v);
      const dx = pos[v * 3] - cx;
      const t = (pos[v * 3 + 1] - yMin) / H;
      if (Math.abs(dx) < w * 0.55 || t < 0.3 || t > 0.82) continue;   // not neck, hem or cap lames
      (dx >= 0 ? left : right).push(v);
    }
  }
  return { left, right };
}

/**
 * Classify every vertex once. `pos` is a flat xyz array in the garment's AUTHORED units (cm from
 * skin-garment; anything else and `unitScale` says how many units make a cm — displacements are
 * multiplied by it). `W` is the cap boundary in the same units; when absent it is estimated as
 * 80% of the garment's chest-band half-width. `indices` (flat triangle list) enables the real
 * armhole-rim masks; without it the arm holes fall back to a coarse side band.
 */
export function computeSectionWeights(pos, n, { W, unitScale = 1, indices } = {}) {
  let xMin = 1e9, xMax = -1e9, yMin = 1e9, yMax = -1e9, zMin = 1e9, zMax = -1e9;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    if (z < zMin) zMin = z; if (z > zMax) zMax = z;
  }
  const H = yMax - yMin || 1;
  const cx = (xMin + xMax) / 2, cz = (zMin + zMax) / 2;
  const halfW = (xMax - xMin) / 2 || 1;
  // chest-band half-width: widest |x - cx| among verts in the upper-middle band
  let chestHalf = 0;
  for (let i = 0; i < n; i++) {
    const t = (pos[i * 3 + 1] - yMin) / H;
    if (t < 0.45 || t > 0.7) continue;
    const ax = Math.abs(pos[i * 3] - cx);
    if (ax > chestHalf) chestHalf = ax;
  }
  const w = W ?? chestHalf * 0.8;
  const blend = 4 * unitScale;

  const weights = {};
  for (const k of Object.keys(SECTIONS)) weights[k] = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const t = (y - yMin) / H;
    const dx = x - cx;
    const ax = Math.abs(dx);
    const left = dx >= 0;                      // character's left = +x
    const cap = ss(w, w + blend, ax) * ss(0.5, 0.6, t);
    weights.gorget[i] = ss(0.84, 0.92, t) * (1 - ss(w, w + blend, ax));
    weights.pauldron_l[i] = left ? cap : 0;
    weights.pauldron_r[i] = left ? 0 : cap;
    // fallback arm-hole band, replaced below by the real rim mask when indices are given
    const scye = ss(w * 0.55, w * 0.85, ax) * band(t, 0.35, 0.5, 0.75, 0.85);
    weights.armscye_l[i] = left ? scye : 0;
    weights.armscye_r[i] = left ? 0 : scye;
    const core = 1 - ss(w, w + blend, ax);
    const chest = band(t, 0.42, 0.52, 0.78, 0.88) * core;
    weights.breast[i] = chest * ss(0, (zMax - cz) * 0.25, z - cz);
    weights.back[i] = chest * ss(0, (cz - zMin) * 0.25, cz - z);
    const wband = band(t, 0.2, 0.3, 0.48, 0.56) * core;
    weights.waist_f[i] = wband * ss(0, (zMax - cz) * 0.2, z - cz);
    weights.waist_b[i] = wband * ss(0, (cz - zMin) * 0.2, cz - z);
    weights.fauld[i] = 1 - ss(0.18, 0.4, t);
  }

  const meta = { cx, cz, halfW, W: w, unitScale, scyeL: null, scyeR: null };
  if (indices && indices.length) {
    const rims = armholeRims(pos, n, indices, { cx, yMin, H, w });
    const R = 7 * unitScale;                   // influence radius around the rim
    for (const [side, rim, wgtArr] of [['scyeL', rims.left, weights.armscye_l], ['scyeR', rims.right, weights.armscye_r]]) {
      if (rim.length < 8) continue;            // no believable ring found — keep the fallback band
      let mx = 0, my = 0, mz = 0;
      for (const v of rim) { mx += pos[v * 3]; my += pos[v * 3 + 1]; mz += pos[v * 3 + 2]; }
      meta[side] = { x: mx / rim.length, y: my / rim.length, z: mz / rim.length };
      wgtArr.fill(0);
      for (let i = 0; i < n; i++) {
        // vertices on the wrong side of the torso can't belong to this ring
        if ((pos[i * 3] - cx >= 0) !== (side === 'scyeL')) continue;
        let best = Infinity;
        for (const v of rim) {
          const ddx = pos[i * 3] - pos[v * 3], ddy = pos[i * 3 + 1] - pos[v * 3 + 1], ddz = pos[i * 3 + 2] - pos[v * 3 + 2];
          const d = ddx * ddx + ddy * ddy + ddz * ddz;
          if (d < best) best = d;
        }
        wgtArr[i] = 1 - ss(R * 0.25, R, Math.sqrt(best));
      }
    }
  }
  return { weights, meta };
}

/**
 * base -> out, applying the dialled params (cm) through the weights. Deterministic, additive,
 * order-independent; safe to call every slider tick.
 */
export function applySections(base, out, n, weights, params, meta) {
  const u = meta.unitScale;
  const P = (sec, p) => (params[sec] && params[sec][p]) || 0;
  const gDy = P('gorget', 'dy') * u, gOpen = P('gorget', 'open') * u;
  const side = (sec) => ({ inx: P(sec, 'inx') * u, dy: P(sec, 'dy') * u, dz: P(sec, 'dz') * u, tight: P(sec, 'tight') * u });
  const pL = side('pauldron_l'), pR = side('pauldron_r');
  const aL = side('armscye_l'), aR = side('armscye_r');
  const brDz = P('breast', 'dz') * u, brW = P('breast', 'widen') * u;
  const bkDz = P('back', 'dz') * u;
  const wGf = P('waist_f', 'girth') * u, wGb = P('waist_b', 'girth') * u;
  const fDy = P('fauld', 'dy') * u, fFlare = P('fauld', 'flare') * u;

  for (let i = 0; i < n; i++) {
    let x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
    const dx = x - meta.cx, dzz = z - meta.cz;
    const r = Math.hypot(dx, dzz) || 1;
    const rx = dx / r, rz = dzz / r;          // radial direction off the torso axis
    const sx = Math.sign(dx) || 1;

    let wgt = weights.gorget[i];
    if (wgt) { y += gDy * wgt; x += rx * gOpen * wgt; z += rz * gOpen * wgt; }
    wgt = weights.pauldron_l[i];
    if (wgt) { x -= sx * pL.inx * wgt; y += pL.dy * wgt; z += pL.dz * wgt; }
    wgt = weights.pauldron_r[i];
    if (wgt) { x -= sx * pR.inx * wgt; y += pR.dy * wgt; z += pR.dz * wgt; }
    // arm holes: dy lifts/drops the ring; tight moves toward the ring's own centroid when the
    // real rim was found (a hole tightens toward its middle, not along any single axis)
    wgt = weights.armscye_l[i];
    if (wgt) {
      y += aL.dy * wgt;
      if (aL.tight) {
        const c = meta.scyeL;
        if (c) {
          const tx = c.x - x, ty = c.y - y, tz = c.z - z;
          const len = Math.hypot(tx, ty, tz) || 1;
          x += (tx / len) * aL.tight * wgt; y += (ty / len) * aL.tight * wgt; z += (tz / len) * aL.tight * wgt;
        } else x -= sx * aL.tight * wgt;
      }
    }
    wgt = weights.armscye_r[i];
    if (wgt) {
      y += aR.dy * wgt;
      if (aR.tight) {
        const c = meta.scyeR;
        if (c) {
          const tx = c.x - x, ty = c.y - y, tz = c.z - z;
          const len = Math.hypot(tx, ty, tz) || 1;
          x += (tx / len) * aR.tight * wgt; y += (ty / len) * aR.tight * wgt; z += (tz / len) * aR.tight * wgt;
        } else x -= sx * aR.tight * wgt;
      }
    }
    wgt = weights.breast[i];
    if (wgt) { z += brDz * wgt; x += sx * brW * wgt; }
    wgt = weights.back[i];
    if (wgt) { z -= bkDz * wgt; }
    wgt = weights.waist_f[i];
    if (wgt) { x += rx * wGf * wgt; z += rz * wGf * wgt; }
    wgt = weights.waist_b[i];
    if (wgt) { x += rx * wGb * wgt; z += rz * wGb * wgt; }
    wgt = weights.fauld[i];
    if (wgt) { y += fDy * wgt; x += rx * fFlare * wgt; z += rz * fFlare * wgt; }

    out[i * 3] = x; out[i * 3 + 1] = y; out[i * 3 + 2] = z;
  }
}
