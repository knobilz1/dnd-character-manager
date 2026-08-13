#!/usr/bin/env node
/**
 * validate-garment.mjs — does a skinned garment actually land on each body? No credits, no GPU.
 *
 * Run this on the OPTIMIZED, shipped GLB. Checking the intermediate would miss exactly the
 * failures compression introduces (weight requantization, accessor type changes, a pruned skin).
 *
 * It reproduces the runtime's own math rather than approximating it. three's SkinnedMesh with
 * the default AttachedBindMode recomputes bindMatrixInverse from the mesh's world matrix every
 * frame, so the parent transform cancels and the rendered world position of a vertex is exactly
 *     p = sum_j  w_j * (boneWorld_j * IBM_j) * v
 * At rest boneWorld_j is the body's joint world matrix, and IBM_j came from the reference body,
 * so delta_j = G_body,j * inverse(G_ref,j) — the bone's rest-to-rest change from reference to
 * target. That is the whole re-proportioning mechanism, and this is where it gets measured.
 *
 * POSED states are deliberately NOT computed here. Faking the mixer offline would just be a
 * second implementation to be wrong in a new way; app-shot.mjs drives the real one.
 *
 * Usage:
 *   node scripts/validate-garment.mjs <garment.glb>                    # canary bodies
 *   node scripts/validate-garment.mjs <garment.glb> --all              # all 88
 *   node scripts/validate-garment.mjs <garment.glb> --bodies Giff_Male,Elf_Female
 *   ... --json <path>     also write the table as JSON (feeds easeByFamily / excludeFamilies)
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';
import { MeshBVH } from 'three-mesh-bvh';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; };
const garmentPath = argv.find((a) => !a.startsWith('--') && a.endsWith('.glb'));
if (!garmentPath) { console.error('usage: validate-garment.mjs <garment.glb> [--all|--bodies a,b] [--json out]'); process.exit(1); }

const MODELS = 'public/models';
/** Canaries span both joint eras AND both proportion extremes: human (100-joint reference),
 *  elf (100-joint, different build), giff (118-joint, broadest), minotaur (118-joint, tallest
 *  torso with a radically different chest). A garment that survives these four survives most. */
const CANARIES = ['Human_Male', 'Elf_Female', 'Giff_Male', 'Minotaur_Male'];
const bodies = argv.includes('--all')
  ? fs.readdirSync(MODELS).filter((f) => f.endsWith('_Idle.glb')).map((f) => f.replace('_Idle.glb', '')).sort()
  : (arg('bodies') ? arg('bodies').split(',') : CANARIES);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const read = async (p) => { const d = await io.read(p); await d.transform(dequantize()); return d; };

function worldMatrices(doc) {
  const parent = new Map();
  for (const n of doc.getRoot().listNodes()) for (const c of n.listChildren()) parent.set(c, n);
  const cache = new Map();
  const local = (n) => new THREE.Matrix4().compose(
    new THREE.Vector3(...n.getTranslation()), new THREE.Quaternion(...n.getRotation()), new THREE.Vector3(...n.getScale()));
  const world = (n) => {
    if (cache.has(n)) return cache.get(n);
    const p = parent.get(n);
    const m = p ? new THREE.Matrix4().multiplyMatrices(world(p), local(n)) : local(n);
    cache.set(n, m); return m;
  };
  return world;
}
function soleSkinned(doc, label) {
  const out = [];
  for (const n of doc.getRoot().listNodes()) if (n.getMesh() && n.getSkin()) for (const p of n.getMesh().listPrimitives()) out.push({ prim: p, skin: n.getSkin() });
  if (out.length !== 1) { console.error(`${label}: expected 1 skinned primitive, found ${out.length}`); process.exit(1); }
  return out[0];
}
/** Skin a primitive into bind-world using its own file's G*IBM (identity on the 118-joint era,
 *  a constant Rx(-90) on the Z-up legacy era — this is what makes both comparable). */
function toBindWorld(doc, prim, skin) {
  const world = worldMatrices(doc);
  const joints = skin.listJoints();
  const ibm = skin.getInverseBindMatrices().getArray();
  const mats = joints.map((j, i) => new THREE.Matrix4().multiplyMatrices(world(j), new THREE.Matrix4().fromArray(ibm, i * 16)));
  const P = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
  // The mesh's AUTHORED normals, skinned with the same blend (rotation part — G*IBM is rigid at
  // rest). Recomputing normals from winding was the first fleet run's core lie: Tripo/FBX meshes
  // carry inconsistently-wound patches, computeVertexNormals dutifully flips those normals, and a
  // flipped vertex casts "inward" that is really outward — reporting its healthy standoff as a
  // burial. The giveaway was burial p95s mirroring standoff p95s cell by cell. The app itself
  // lights with the authored normals, so they are the ground truth here.
  const N = prim.getAttribute('NORMAL');
  const n = P.getCount(), out = new Float32Array(n * 3);
  const nrm = N ? new Float32Array(n * 3) : null;
  const v = new THREE.Vector3(), acc = new THREE.Vector3(), tmp = new THREE.Vector3();
  const nv = new THREE.Vector3(), nacc = new THREE.Vector3();
  const m3 = new THREE.Matrix3();
  const je = [0, 0, 0, 0], we = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    v.fromArray(P.getElement(i, [0, 0, 0])); J.getElement(i, je); W.getElement(i, we);
    acc.set(0, 0, 0); nacc.set(0, 0, 0);
    for (let k = 0; k < 4; k++) if (we[k]) {
      acc.add(tmp.copy(v).applyMatrix4(mats[je[k]]).multiplyScalar(we[k]));
      if (nrm) { nv.fromArray(N.getElement(i, [0, 0, 0])); nacc.add(nv.applyMatrix3(m3.setFromMatrix4(mats[je[k]])).multiplyScalar(we[k])); }
    }
    acc.toArray(out, i * 3);
    if (nrm) nacc.normalize().toArray(nrm, i * 3);
  }
  return { pos: out, nrm };
}

// ── garment, once ──────────────────────────────────────────────────────────────
const gDoc = await read(garmentPath);
const { prim: gPrim, skin: gSkin } = soleSkinned(gDoc, path.basename(garmentPath));
const gJointNames = gSkin.listJoints().map((j) => j.getName());
const gIbm = gSkin.getInverseBindMatrices().getArray();
const gP = gPrim.getAttribute('POSITION'), gJ = gPrim.getAttribute('JOINTS_0'), gW = gPrim.getAttribute('WEIGHTS_0');
const nG = gP.getCount();
/** Joints that actually carry weight. A garment references the full 100-joint tree so it can be
 *  authored generically, but only a handful deform it — an unweighted joint missing on some body
 *  is harmless, a weighted one is fatal. Distinguishing them is the difference between a useful
 *  report and 88 rows of false alarms. */
const usedJoints = new Set();
{ const je = [0, 0, 0, 0], we = [0, 0, 0, 0];
  for (let i = 0; i < nG; i++) { gJ.getElement(i, je); gW.getElement(i, we); for (let k = 0; k < 4; k++) if (we[k] > 1e-4) usedJoints.add(je[k]); } }
console.log(`${path.basename(garmentPath)}: ${nG} verts, skin references ${gJointNames.length} joints, ${usedJoints.size} carry weight`);
console.log(`  weighted joints: ${[...usedJoints].map((i) => gJointNames[i]).sort().join(', ')}\n`);

const rows = [];
for (const name of bodies) {
  const file = `${MODELS}/${name}_Idle.glb`;
  if (!fs.existsSync(file)) { console.log(`${name.padEnd(22)} MISSING FILE`); continue; }
  const bDoc = await read(file);
  const { prim: bPrim, skin: bSkin } = soleSkinned(bDoc, name);
  const bWorld = worldMatrices(bDoc);
  const bJointByName = new Map(bSkin.listJoints().map((j) => [j.getName(), j]));

  // 1. every WEIGHTED garment joint must resolve on this body
  const missing = [...usedJoints].map((i) => gJointNames[i]).filter((n) => !bJointByName.has(n));
  if (missing.length) { rows.push({ name, verdict: 'UNRESOLVED', missing }); console.log(`${name.padEnd(22)} UNRESOLVED joints: ${missing.join(', ')}`); continue; }

  // 2. pose the garment onto this body's rest skeleton (the runtime formula, at rest)
  const delta = gJointNames.map((jn, i) => {
    const node = bJointByName.get(jn);
    if (!node) return null;
    return new THREE.Matrix4().multiplyMatrices(bWorld(node), new THREE.Matrix4().fromArray(gIbm, i * 16));
  });
  const posed = new Float32Array(nG * 3);
  { const v = new THREE.Vector3(), acc = new THREE.Vector3(), tmp = new THREE.Vector3();
    const je = [0, 0, 0, 0], we = [0, 0, 0, 0];
    for (let i = 0; i < nG; i++) {
      v.fromArray(gP.getElement(i, [0, 0, 0])); gJ.getElement(i, je); gW.getElement(i, we);
      acc.set(0, 0, 0);
      for (let k = 0; k < 4; k++) if (we[k]) acc.add(tmp.copy(v).applyMatrix4(delta[je[k]]).multiplyScalar(we[k]));
      acc.toArray(posed, i * 3);
    } }

  // 3. body surface, same space, with the body's own skinned normals (see toBindWorld for why
  // recomputed-from-winding normals are disqualified here)
  const { pos: bodyVerts, nrm: authoredNrm } = toBindWorld(bDoc, bPrim, bSkin);
  let bodyNrm = authoredNrm;
  if (!bodyNrm) {
    console.log(`  ${name}: NO AUTHORED NORMALS — falling back to winding-derived (flip-suspect)`);
    const bIdx0 = bPrim.getIndices();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(bodyVerts, 3));
    g.setIndex(new THREE.BufferAttribute(Uint32Array.from({ length: bIdx0.getCount() }, (_, i) => bIdx0.getScalar(i)), 1));
    g.computeVertexNormals();
    bodyNrm = g.getAttribute('normal').array;
  }

  // …and a BVH over the POSED GARMENT, because the question worth asking runs this direction.
  const gIdxAcc = gPrim.getIndices();
  const gGeom = new THREE.BufferGeometry();
  gGeom.setAttribute('position', new THREE.BufferAttribute(posed, 3));
  gGeom.setIndex(new THREE.BufferAttribute(Uint32Array.from({ length: gIdxAcc.getCount() }, (_, i) => gIdxAcc.getScalar(i)), 1));
  const gBvh = new MeshBVH(gGeom);

  const gBox = new THREE.Box3(), bBox = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < nG; i++) gBox.expandByPoint(v.fromArray(posed, i * 3));
  for (let i = 0; i < bodyVerts.length; i += 3) bBox.expandByPoint(v.fromArray(bodyVerts, i));

  /**
   * 4. THE metric: does the body poke out through the armour?
   *
   * NOT "how many garment vertices are inside the body" — heavy_torso is a hollow shell, so its
   * inner wall is *supposed* to be inside the body, and that proxy scored a correctly-fitted
   * cuirass at 71% penetrating. A number that condemns a good fit is worse than no number.
   *
   * So ask it the way you would see it. From each body vertex, cast along its own normal:
   *   outward hit  -> the garment is outside the skin here: covered, correct.
   *   inward hit   -> the garment is buried INSIDE the skin here: the body pokes through. Defect.
   *   neither      -> the garment simply doesn't reach here (bare arms, legs, head). Not a defect.
   * Coverage is reported alongside so a garment that has shrunk to nothing can't score a clean
   * zero-protrusion sheet.
   */
  const OUT_REACH = 12;   // cm the garment may legitimately stand off the skin
  /** --clearance widens the inward reach so burial depth reads as a real number instead of
   *  saturating: the first fleet run reported max 3.00cm on 90/90 bodies, which was IN_REACH
   *  itself — the instrument's ceiling, not a measurement. 8cm is still shy of crossing a torso
   *  (~20cm deep) to the far wall; treat inward hits beyond ~6cm with suspicion anyway. */
  const CLEARANCE = argv.includes('--clearance');
  const IN_REACH = CLEARANCE ? 8 : 3;   // cm; further in and the ray may have crossed the torso
                                        // and hit the garment's FAR wall — says nothing here
  /** The region the garment is responsible for = body vertices whose dominant joint is one the
   *  garment actually weights. Using a plain height band instead counts the arms hanging beside
   *  the chest as "uncovered torso" and drags a good fit's coverage number down by half. */
  const region = new Set([...usedJoints].map((i) => gJointNames[i]));
  const bJointNames = bSkin.listJoints().map((j) => j.getName());
  const bJ = bPrim.getAttribute('JOINTS_0'), bW = bPrim.getAttribute('WEIGHTS_0');
  const ray = new THREE.Ray();
  const nv = new THREE.Vector3();
  const hotJoints = new Map();
  const pokeRegion = new Map();
  let covered = 0, poked = 0, worstPoke = 0, worstJoint = '';
  const pokeDepths = [];
  let band = 0;
  const bje = [0, 0, 0, 0], bwe = [0, 0, 0, 0];
  for (let i = 0; i < bodyVerts.length / 3; i++) {
    v.fromArray(bodyVerts, i * 3);
    if (v.y < gBox.min.y - 1 || v.y > gBox.max.y + 1) continue;
    bJ.getElement(i, bje); bW.getElement(i, bwe);
    let bdom = bje[0], bdw = bwe[0];
    for (let k = 1; k < 4; k++) if (bwe[k] > bdw) { bdw = bwe[k]; bdom = bje[k]; }
    if (!region.has(bJointNames[bdom])) continue;
    band++;
    nv.fromArray(bodyNrm, i * 3).normalize();
    ray.set(v, nv);
    const out = gBvh.raycastFirst(ray, THREE.DoubleSide, 0.001, OUT_REACH);
    ray.set(v, nv.clone().negate());
    const inn = gBvh.raycastFirst(ray, THREE.DoubleSide, 0.001, IN_REACH);
    if (out) covered++;
    else if (inn) {
      poked++; pokeDepths.push(inn.distance);
      if (inn.distance > worstPoke) { worstPoke = inn.distance; worstJoint = `body@y${v.y.toFixed(0)}`; }
      const f = inn.faceIndex * 3;
      const gv = gGeom.getIndex().array[f];
      const je = [0, 0, 0, 0], we = [0, 0, 0, 0];
      gJ.getElement(gv, je); gW.getElement(gv, we);
      let dom = je[0], dw = we[0];
      for (let k = 1; k < 4; k++) if (we[k] > dw) { dw = we[k]; dom = je[k]; }
      hotJoints.set(gJointNames[dom], (hotJoints.get(gJointNames[dom]) || 0) + 1);
      // WHERE, not just how much. "10% poke-through" says nothing actionable; "it is all on the
      // upper front" points straight at a too-high collar, and "spread evenly" points at ease.
      const face = nv.z > 0.35 ? 'front' : nv.z < -0.35 ? 'back' : 'side';
      const band = v.y > gBox.min.y + (gBox.max.y - gBox.min.y) * 0.66 ? 'upper'
                 : v.y > gBox.min.y + (gBox.max.y - gBox.min.y) * 0.33 ? 'mid' : 'lower';
      pokeRegion.set(`${band}-${face}`, (pokeRegion.get(`${band}-${face}`) || 0) + 1);
    }
  }
  pokeDepths.sort((x, y) => x - y);
  const p95 = pokeDepths.length ? pokeDepths[Math.floor(pokeDepths.length * 0.95)] : 0;
  const pokePct = band ? 100 * poked / (poked + covered || 1) : 0;
  const coverPct = band ? 100 * covered / band : 0;

  const gH = gBox.max.y - gBox.min.y, bH = bBox.max.y - bBox.min.y;
  const ratio = gH / bH;
  const explode = ratio < 0.1 || ratio > 1.2;
  const where = [...pokeRegion.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k}:${n}`).join(' ');
  const hot = [...hotJoints.entries()].sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k, n]) => `${k}x${n}`).join(' ');

  /**
   * --clearance: per-height-band SILHOUETTE comparison, the measurement a re-fit is chosen from.
   *
   * Two per-vertex raycast formulations were tried first and both produced uninterpretable
   * numbers: rays from arm/shoulder vertices cross the air gap and hit the cuirass wall beyond
   * it, reporting a healthy garment as "buried 7cm" (fixing normals changed nothing — the rays
   * were honest, the QUESTION was wrong). Band silhouettes cannot be fooled that way: in each
   * 4cm y-slice compare the body's outer extents (front +z / back -z / half-width |x|, torso-
   * dominated vertices only, so the A-pose arms stay out — the exact 2.31x-shoulder trap) with
   * the garment's. delta = garment_extent - body_extent, signed so NEGATIVE = the garment is
   * inside the body's skin there = buried. Garment z-extents only use verts within the body's
   * core half-width so the flared pauldron wings don't pollute the front/back reading.
   */
  if (CLEARANCE) {
    const TORSO = /^(pelvis|spine|neck|clavicle)/;
    const BAND = 4;
    const bands = new Map(); // slice index -> {body:{f,b,w}, gar:{f,b,w}}
    const at = (y) => { const k = Math.floor(y / BAND); if (!bands.has(k)) bands.set(k, { body: null, gar: null }); return bands.get(k); };
    const grow = (side, cell, x, z) => {
      const s = cell[side] ?? (cell[side] = { f: -1e9, b: 1e9, w: 0 });
      if (z > s.f) s.f = z; if (z < s.b) s.b = z; if (Math.abs(x) > s.w) s.w = Math.abs(x);
    };
    for (let i = 0; i < bodyVerts.length / 3; i++) {
      bJ.getElement(i, bje); bW.getElement(i, bwe);
      let bdom = bje[0], bdw = bwe[0];
      for (let k = 1; k < 4; k++) if (bwe[k] > bdw) { bdw = bwe[k]; bdom = bje[k]; }
      if (!TORSO.test(bJointNames[bdom])) continue;
      grow('body', at(bodyVerts[i * 3 + 1]), bodyVerts[i * 3], bodyVerts[i * 3 + 2]);
    }
    // pass 1: garment width per band (needs body width known first for the z-core filter)
    for (let i = 0; i < nG; i++) grow('gar', at(posed[i * 3 + 1]), posed[i * 3], posed[i * 3 + 2]);
    // pass 2: garment front/back within the body's core width only
    for (const cell of bands.values()) if (cell.gar) { cell.gar.f = -1e9; cell.gar.b = 1e9; }
    for (let i = 0; i < nG; i++) {
      const cell = at(posed[i * 3 + 1]);
      if (!cell.body || !cell.gar) continue;
      if (Math.abs(posed[i * 3]) > cell.body.w * 0.6) continue;
      const z = posed[i * 3 + 2];
      if (z > cell.gar.f) cell.gar.f = z; if (z < cell.gar.b) cell.gar.b = z;
    }
    console.log(`  ${'y-band'.padEnd(10)} ${'front Δ'.padStart(8)} ${'back Δ'.padStart(8)} ${'width Δ'.padStart(8)}   (+ = garment outside skin, − = buried; blank = garment absent)`);
    for (const k of [...bands.keys()].sort((a, b2) => b2 - a)) {
      const { body, gar } = bands.get(k);
      if (!body) continue;
      const y0 = k * BAND, y1 = y0 + BAND;
      const fd = gar && gar.f > -1e8 ? (gar.f - body.f).toFixed(1).padStart(8) : ''.padStart(8);
      const bd = gar && gar.b < 1e8 ? (body.b - gar.b).toFixed(1).padStart(8) : ''.padStart(8);
      const wd = gar ? (gar.w - body.w).toFixed(1).padStart(8) : ''.padStart(8);
      console.log(`  ${`${y0}-${y1}cm`.padEnd(10)} ${fd} ${bd} ${wd}`);
    }
  }
  rows.push({ name, pokePct: +pokePct.toFixed(1), p95: +p95.toFixed(2), max: +worstPoke.toFixed(2), coverPct: +coverPct.toFixed(1), ratio: +ratio.toFixed(3), explode, hot });
  console.log(`${name.padEnd(22)} poke ${pokePct.toFixed(1).padStart(5)}%  p95 ${p95.toFixed(2).padStart(5)}cm  max ${worstPoke.toFixed(2).padStart(5)}cm  ` +
    `cover ${coverPct.toFixed(1).padStart(5)}%  h/H ${ratio.toFixed(3)}${explode ? '  *** EXPLOSION ***' : ''}${where ? `  where=[${where}]` : ''}`);
}

const bad = rows.filter((r) => r.verdict === 'UNRESOLVED' || r.explode || r.pokePct > 2 || r.coverPct < 20);
console.log(`\n${rows.length} bodies checked, ${bad.length} flagged` + (bad.length ? `: ${bad.map((r) => r.name).join(', ')}` : ''));
console.log('gate: no UNRESOLVED, no explosion, body pokes through < 2% of the covered region, coverage > 20%');
if (arg('json')) { fs.writeFileSync(arg('json'), JSON.stringify(rows, null, 2)); console.log(`wrote ${arg('json')}`); }
process.exit(bad.length ? 1 : 0);
