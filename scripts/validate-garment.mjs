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
  const n = P.getCount(), out = new Float32Array(n * 3);
  const v = new THREE.Vector3(), acc = new THREE.Vector3(), tmp = new THREE.Vector3();
  const je = [0, 0, 0, 0], we = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    v.fromArray(P.getElement(i, [0, 0, 0])); J.getElement(i, je); W.getElement(i, we);
    acc.set(0, 0, 0);
    for (let k = 0; k < 4; k++) if (we[k]) acc.add(tmp.copy(v).applyMatrix4(mats[je[k]]).multiplyScalar(we[k]));
    acc.toArray(out, i * 3);
  }
  return out;
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

  // 3. body surface, same space, with normals
  const bodyVerts = toBindWorld(bDoc, bPrim, bSkin);
  const bIdx = bPrim.getIndices();
  const bodyGeom = new THREE.BufferGeometry();
  bodyGeom.setAttribute('position', new THREE.BufferAttribute(bodyVerts, 3));
  bodyGeom.setIndex(new THREE.BufferAttribute(Uint32Array.from({ length: bIdx.getCount() }, (_, i) => bIdx.getScalar(i)), 1));
  bodyGeom.computeVertexNormals();
  const bodyNrm = bodyGeom.getAttribute('normal').array;

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
  const IN_REACH = 3;     // cm; further in than this and the ray has crossed the torso and hit
                          // the garment's FAR wall — which says nothing about this vertex
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

  rows.push({ name, pokePct: +pokePct.toFixed(1), p95: +p95.toFixed(2), max: +worstPoke.toFixed(2), coverPct: +coverPct.toFixed(1), ratio: +ratio.toFixed(3), explode, hot });
  console.log(`${name.padEnd(22)} poke ${pokePct.toFixed(1).padStart(5)}%  p95 ${p95.toFixed(2).padStart(5)}cm  max ${worstPoke.toFixed(2).padStart(5)}cm  ` +
    `cover ${coverPct.toFixed(1).padStart(5)}%  h/H ${ratio.toFixed(3)}${explode ? '  *** EXPLOSION ***' : ''}${where ? `  where=[${where}]` : ''}`);
}

const bad = rows.filter((r) => r.verdict === 'UNRESOLVED' || r.explode || r.pokePct > 2 || r.coverPct < 20);
console.log(`\n${rows.length} bodies checked, ${bad.length} flagged` + (bad.length ? `: ${bad.map((r) => r.name).join(', ')}` : ''));
console.log('gate: no UNRESOLVED, no explosion, body pokes through < 2% of the covered region, coverage > 20%');
if (arg('json')) { fs.writeFileSync(arg('json'), JSON.stringify(rows, null, 2)); console.log(`wrote ${arg('json')}`); }
process.exit(bad.length ? 1 : 0);
