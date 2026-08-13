#!/usr/bin/env node
/**
 * skin-garment.mjs — fit a garment to the 88-body wardrobe ONCE, offline.
 *
 * This is the MetaTailor replacement. MetaTailor's auto-fit produced 2.31x shoulders on a
 * 0.98x waist (uniform scale can't fix that, Shrinkwrap destroys rigid plate), and manual
 * Blender fitting isn't scriptable. The mechanism here instead:
 *
 *   Every body shares one AccuRig skeleton BY BONE NAME but has its own bind pose. Skin the
 *   garment once against a reference body, and at runtime bind it to any body's bones — the
 *   GPU re-proportions it automatically, because shoulder width, torso length and hip breadth
 *   all live in the skeleton. It also follows every animation for free.
 *
 * REFERENCE BODY: Human_Male_Idle.glb, and this is not arbitrary. Measured across all 88
 * bodies, its 100-joint set IS EXACTLY the intersection of every body's joint set (14 bodies
 * have 100 joints, 74 have 118, and the 118 are a strict superset). Authoring against it
 * guarantees every garment joint resolves on every body. Authoring against a 118-joint body
 * would silently fail on the 14 legacy ones.
 *
 * ⚠️ INVERSE-BIND MATRICES ARE DERIVED, NEVER COPIED. The 14 legacy bodies store mesh POSITION
 * data Z-up; their G_j*IBM_j is a constant Rx(-90 deg) while the 74 newer ones are identity
 * (measured). Copying reference IBMs would render garments rotated on one era. Instead the
 * garment is authored in BIND-WORLD space (where both eras agree) and gets IBM_j =
 * inverse(jointWorld_j) from the joint tree this script writes — so G*IBM is identity by
 * construction and the up-axis quirk cancels.
 *
 * The written joint tree is FLAT (one node per joint, world matrix baked as TRS). Hierarchy is
 * irrelevant: this file never enters the runtime scene — the app reads the mesh's geometry and
 * bone NAMES and rebinds to the body's real skeleton. (Adding it to the scene would be a bug:
 * three's PropertyBinding resolves animation tracks by depth-first name search, so duplicate
 * bones would capture the body's tracks.)
 *
 * Usage:
 *   node scripts/skin-garment.mjs --garment public/models/armor/heavy_torso.glb --slot torso
 *   ... --out <path> --ref <body.glb> --profile full|skirt --inflate <cm>
 *   ... --scale <mult> --sx/--sy/--sz <mult> --dx/--dy/--dz <cm> --rotY <deg> --height <mult>
 *   ... --no-fit          (skip auto-fit; use the garment's own units, offsets still apply)
 *
 * The scale/offset/inflate knobs ARE the fit panel: iterating them is free, and the numbers
 * this script prints (target box vs achieved box) are what you iterate against.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { MeshBVH } from 'three-mesh-bvh';
import * as THREE from 'three';
import path from 'node:path';
import fs from 'node:fs';
import { computeSectionWeights, applySections } from './garment-sections.mjs';

// ── args ───────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; };
const flag = (k) => argv.includes(`--${k}`);
const num = (k, d) => { const v = arg(k); return v === undefined ? d : Number(v); };

const garmentPath = arg('garment');
const slot = arg('slot', 'torso');
const refPath = arg('ref', 'public/models/Human_Male_Idle.glb');
const profile = arg('profile', 'full');
const inflateCm = num('inflate', 0);
const outPath = arg('out', garmentPath?.replace(/\.glb$/i, '_skinned.glb'));
if (!garmentPath) { console.error('usage: skin-garment.mjs --garment <glb> --slot torso [...]'); process.exit(1); }

const uni = num('scale', 1);
const S = { x: num('sx', 1) * uni, y: num('sy', 1) * uni, z: num('sz', 1) * uni };
const D = { x: num('dx', 0), y: num('dy', 0), z: num('dz', 0) };
const rotY = num('rotY', 0) * Math.PI / 180;
const yaw = num('yaw', 0) * Math.PI / 180;   // PRE-fit turn; --rotY runs after fitting, too late to help it
const pitch = num('pitch', 0) * Math.PI / 180; // PRE-fit lean about X; positive = top backward
const heightFactor = num('height', 1.15);   // garment height as a multiple of the slot's bone span
const ease = num('ease', 1);                // x/z slack over the body silhouette (>1 = looser shell)
const core = num('core', 0.6);              // fraction of the garment's half-width that is "body"
const pauldron = num('pauldron', 1);        // scale applied to everything outside the core
const smoothPasses = num('smooth', 2);      // Laplacian weight-smoothing passes
const maxHops = num('hops', 4);
const topJoint = arg('top');                 // hang the piece FROM this joint instead of centring it
const topDy = num('topdy', 0);
const noArms = flag('no-arms');              // skip aligning shell geometry onto the bind-pose arm
const rigid = flag('rigid');                // bind each vertex 100% to one bone (plate, not cloth)             // how far apart in the bone tree two co-driving joints may be
const autoFit = !flag('no-fit');

/**
 * Deforming joints per slot. These are REAL names verified present on all 88 bodies —
 * note spine_01 and spine_05 exist ONLY on the 118-joint era and are deliberately absent.
 * A garment weighted to them would fail to resolve on the 14 legacy bodies.
 */
const SLOTS = {
  torso: {
    // Includes the ARM CHAIN, not just the trunk. heavy_torso is a fused chest+pauldron+arm
    // shell, and with the allowlist stopping at upperarm its lower shells were rigidly welded to
    // the shoulder: 1557 vertices fell through to the nearest-joint fallback and the armour's
    // elbows did not bend when the body's did. A garment must be allowed to deform with every
    // bone it actually covers; the closest-point transfer only assigns a joint where the garment
    // genuinely sits over that part of the body, so listing them costs nothing on a piece that
    // stops at the shoulder.
    // NO twist or share bones. They are there to spread flesh deformation along a limb's axis,
    // and a rigid plate weighted to them shears: with forearmtwist/upperarmtwist in this list the
    // `down` pose tore the shoulder shells into black shards. The plain limb bones rotate the
    // plate as one solid piece, which is what steel does.
    joints: [
      'pelvis', 'spine_02', 'spine_03', 'spine_04', 'neck_01',
      'clavicle_l', 'clavicle_r',
      'upperarm_l', 'upperarm_r',
      'lowerarm_l', 'lowerarm_r',
    ],
    // vertical span the garment is normalized onto, and the joint whose x defines centre
    spanFrom: 'pelvis', spanTo: 'clavicle_l', centre: 'spine_03',
    // Joints whose skin defines the SILHOUETTE the garment is sized against. Deliberately
    // excludes upperarm: bodies are bound in an A-pose, so a plain height-band measurement of
    // the body catches both arms and reports a 67cm "torso" — sizing to that is precisely the
    // 2.31x-shoulder failure MetaTailor produced. The body's own skin weights say exactly which
    // vertices are torso, so use them rather than a geometric guess.
    measure: ['pelvis', 'spine_02', 'spine_03', 'spine_04', 'clavicle_l', 'clavicle_r'],
    // Height (as a fraction up the garment) of the slab whose width is matched to the body.
    // Mid-chest, deliberately BELOW the shoulders — see the note on `slab` in pass 2.
    slab: 0.45,
    armFit: true,
  },
  /**
   * A shoulder yoke: pauldrons plus arm shells, with a bib at the sternum but NO chest plate.
   * heavy_torso is one of these, whatever its filename says — rendered on its own it is two
   * shoulder assemblies and an open arch (armor/manifest.json half-caught this).
   *
   * It must be sized against the SHOULDER, not the torso. Normalising its height onto the
   * clavicle->pelvis span made everything ~2x too big: the shells engulfed the deltoid and hung
   * well past the elbow, and their back halves arced out behind the body. Shoulder->elbow is the
   * span the art actually covers.
   */
  shoulders: {
    joints: ['spine_04', 'neck_01', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r'],
    spanFrom: 'lowerarm_l', spanTo: 'clavicle_l', centre: 'spine_04',
    measure: ['spine_04', 'clavicle_l', 'clavicle_r'],
    slab: 0.5,
    armFit: true,
    // Skip the anisotropic X/Z pass. At the height of a shoulder yoke the garment's cross-section
    // is two shells with a gap between them, not a torso band — matching that to the body's chest
    // box asked for a 2x depth stretch. The art's own proportions are already right for a humanoid
    // shoulder; all it needs is the correct overall size and the arm swing.
    uniformOnly: true,
  },
  legs: {
    joints: ['pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r'],
    spanFrom: 'calf_l', spanTo: 'pelvis', centre: 'pelvis',
    measure: ['pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r'],
    slab: 0.75,
  },
};
const slotDef = SLOTS[slot];
if (!slotDef) { console.error(`unknown slot "${slot}" (have: ${Object.keys(SLOTS).join(', ')})`); process.exit(1); }

// ── io ─────────────────────────────────────────────────────────────────────────
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const read = async (p) => { const d = await io.read(p); await d.transform(dequantize()); return d; };

/** World matrix per node, from node TRS. Nothing in this pipeline poses a scene before write,
 *  so node TRS is the bind pose (the same assumption retarget-baked-idle.mjs relies on). */
function worldMatrices(doc) {
  const parent = new Map();
  for (const n of doc.getRoot().listNodes()) for (const c of n.listChildren()) parent.set(c, n);
  const cache = new Map();
  const local = (n) => new THREE.Matrix4().compose(
    new THREE.Vector3(...n.getTranslation()),
    new THREE.Quaternion(...n.getRotation()),
    new THREE.Vector3(...n.getScale()));
  const world = (n) => {
    if (cache.has(n)) return cache.get(n);
    const p = parent.get(n);
    const m = p ? new THREE.Matrix4().multiplyMatrices(world(p), local(n)) : local(n);
    cache.set(n, m); return m;
  };
  return world;
}

/** The one skinned primitive of a body file. Every body measured has exactly one; assert
 *  rather than silently fitting to a fragment. */
function soleSkinnedPrim(doc, label) {
  const prims = [];
  for (const n of doc.getRoot().listNodes()) {
    if (!n.getMesh() || !n.getSkin()) continue;
    for (const p of n.getMesh().listPrimitives()) prims.push({ prim: p, node: n, skin: n.getSkin() });
  }
  if (prims.length !== 1) { console.error(`${label}: expected exactly 1 skinned primitive, found ${prims.length}`); process.exit(1); }
  return prims[0];
}

// ── 1. reference body → bind-world ─────────────────────────────────────────────
const refDoc = await read(refPath);
const refWorld = worldMatrices(refDoc);
const { prim: refPrim, skin: refSkin } = soleSkinnedPrim(refDoc, path.basename(refPath));
const refJoints = refSkin.listJoints();
const refIbmArr = refSkin.getInverseBindMatrices().getArray();

/**
 * Hop distance between joints in the skeleton, used to decide which pairs may co-drive a vertex.
 *
 * Straight-line distance cannot make this call. In an A-pose bind the humerus is ~25cm long, so a
 * legitimate elbow blend (upperarm+lowerarm) spans further than the bogus hip blend that streaks
 * the plate (pelvis+lowerarm, ~30cm) — no threshold separates them. Skeletal adjacency does:
 * upperarm->lowerarm is 1 hop, pelvis->lowerarm is 6.
 */
const jointHops = (() => {
  // Walk the FULL node tree, not just the skinned joints. spine_01 and spine_05 exist as nodes on
  // this body but are absent from its 100-joint skin, so a joints-only graph leaves the entire arm
  // chain in its own island, disconnected from the spine — every cross-limb pair then reads as
  // unreachable and 25644 perfectly good assignments got thrown away.
  const nodes = refDoc.getRoot().listNodes();
  const idx = new Map(nodes.map((n, i) => [n, i]));
  const adj = nodes.map(() => []);
  for (const n of nodes) for (const c of n.listChildren()) { adj[idx.get(n)].push(idx.get(c)); adj[idx.get(c)].push(idx.get(n)); }
  return refJoints.map((src) => {
    const d = new Int16Array(nodes.length).fill(-1);
    const s = idx.get(src);
    d[s] = 0;
    const q = [s];
    for (let h = 0; h < q.length; h++) for (const nb of adj[q[h]]) if (d[nb] < 0) { d[nb] = d[q[h]] + 1; q.push(nb); }
    return refJoints.map((j) => d[idx.get(j)]);
  });
})();

/** Bind-world skinning matrix per joint: G_j * IBM_j. Identity on the 118-joint era, a
 *  constant Rx(-90) on the Z-up legacy era — either way this is what puts the body's mesh
 *  into the same space as its joint world positions. */
const refBindMat = refJoints.map((j, i) =>
  new THREE.Matrix4().multiplyMatrices(refWorld(j), new THREE.Matrix4().fromArray(refIbmArr, i * 16)));

const refPos = refPrim.getAttribute('POSITION');
const refJnt = refPrim.getAttribute('JOINTS_0');
const refWgt = refPrim.getAttribute('WEIGHTS_0');
const refIdx = refPrim.getIndices();
const nRef = refPos.getCount();

const bodyVerts = new Float32Array(nRef * 3);
/** The body's AUTHORED normals, skinned with the same blend. Winding-derived normals are
 *  disqualified for anything directional: Tripo meshes carry inconsistently-wound patches, and a
 *  flipped normal turns an inside/outside test into its own opposite (learned in
 *  validate-garment, where recomputed normals reported healthy standoffs as burials). */
const refNrmAttr = refPrim.getAttribute('NORMAL');
const bodyNrms = refNrmAttr ? new Float32Array(nRef * 3) : null;
{
  const v = new THREE.Vector3(), acc = new THREE.Vector3(), tmp = new THREE.Vector3();
  const nv = new THREE.Vector3(), nacc = new THREE.Vector3();
  const m3 = new THREE.Matrix3();
  const je = [0, 0, 0, 0], we = [0, 0, 0, 0];
  for (let i = 0; i < nRef; i++) {
    v.fromArray(refPos.getElement(i, [0, 0, 0]));
    refJnt.getElement(i, je); refWgt.getElement(i, we);
    acc.set(0, 0, 0); nacc.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      if (!we[k]) continue;
      tmp.copy(v).applyMatrix4(refBindMat[je[k]]).multiplyScalar(we[k]);
      acc.add(tmp);
      if (bodyNrms) { nv.fromArray(refNrmAttr.getElement(i, [0, 0, 0])); nacc.add(nv.applyMatrix3(m3.setFromMatrix4(refBindMat[je[k]])).multiplyScalar(we[k])); }
    }
    bodyVerts[i * 3] = acc.x; bodyVerts[i * 3 + 1] = acc.y; bodyVerts[i * 3 + 2] = acc.z;
    if (bodyNrms) { nacc.normalize(); bodyNrms[i * 3] = nacc.x; bodyNrms[i * 3 + 1] = nacc.y; bodyNrms[i * 3 + 2] = nacc.z; }
  }
}

const jointWorldPos = new Map();
refJoints.forEach((j) => jointWorldPos.set(j.getName(), new THREE.Vector3().setFromMatrixPosition(refWorld(j))));
const jp = (n) => { const p = jointWorldPos.get(n); if (!p) { console.error(`ref body has no joint "${n}"`); process.exit(1); } return p; };

/**
 * Fold AccuRig's helper bones into the limb they belong to, BEFORE filtering to the slot.
 *
 * The body's own skin leans heavily on twist and "share" bones — the deltoid is mostly
 * upperarmtwist, not upperarm — so a garment vertex over the shoulder blends to a joint no slot
 * list would name. Excluding them orphaned 1557 vertices into a crude nearest-joint fallback and
 * left upperarm_l with no weight at all while upperarm_r kept some; including them sheared the
 * plate into shards in the `down` pose, because a twist bone rotates about the limb's axis.
 * Remapping gets both: the correct limb, rotating as one rigid piece.
 */
const HELPER_PARENT = [
  [/^cc_base_([lr])_upperarmtwist\d+$/, 'upperarm_$1'],
  [/^cc_base_([lr])_forearmtwist\d+$/, 'lowerarm_$1'],
  [/^cc_base_([lr])_elbowsharebone$/, 'lowerarm_$1'],
  [/^cc_base_([lr])_thightwist\d+$/, 'thigh_$1'],
  [/^cc_base_([lr])_calftwist\d+$/, 'calf_$1'],
  [/^cc_base_([lr])_kneesharebone$/, 'calf_$1'],
  [/^cc_base_([lr])_breast$/, 'spine_04'],
  [/^cc_base_([lr])_ribstwist$/, 'spine_03'],
  [/^cc_base_pelvis$/, 'pelvis'],
];
const canonicalName = (n) => {
  for (const [re, to] of HELPER_PARENT) if (re.test(n)) return n.replace(re, to);
  return n;
};

const jointIndex = new Map(refJoints.map((j, i) => [j.getName(), i]));
const idxOf = (n) => { const i = jointIndex.get(n); if (i === undefined) { console.error(`ref body lacks joint "${n}"`); process.exit(1); } return i; };
const allow = new Set(slotDef.joints);
/**
 * --no-arms also bars the ARM CHAIN from the weight transfer, not just the shell-swing pass.
 * Measured on the cuirass (a piece with zero arm coverage): 5,500 verts of its side and skirt
 * panels grabbed >25% upperarm weight anyway, because in the A-pose bind the arms hang right
 * beside the torso and the closest body surface to a hip-level hem corner is the elbow. Every
 * animation that moves the arms then drags the hem with them — the idle dropped the arms ~40°
 * and the rear hem swung out into a rigid fin behind the hips (Nabil: "the bottom isn't
 * correctly rigged"). A no-arms piece must be driven by the trunk alone.
 */
if (noArms) for (const n of [...allow]) if (/^(upperarm|lowerarm|hand)_[lr]$/.test(n)) allow.delete(n);
const allowIdx = new Set([...allow].map(idxOf));
const measureIdx = new Set(slotDef.measure.map(idxOf));
/** Body joint index -> the index this slot should treat it as (identity unless it's a helper). */
const canonIdx = refJoints.map((j) => {
  const c = canonicalName(j.getName());
  const i = jointIndex.get(c);
  return i === undefined ? jointIndex.get(j.getName()) : i;
});
{
  const folded = refJoints.filter((j, i) => canonIdx[i] !== i && allowIdx.has(canonIdx[i])).map((j) => j.getName());
  console.log(`helper bones folded into slot limbs: ${folded.length}${folded.length ? ` (${folded.slice(0, 6).join(', ')}${folded.length > 6 ? ', …' : ''})` : ' — none matched, weights come straight from the body'}`);
}

const bodyGeom = new THREE.BufferGeometry();
bodyGeom.setAttribute('position', new THREE.BufferAttribute(bodyVerts, 3));
bodyGeom.setIndex(new THREE.BufferAttribute(Uint32Array.from({ length: refIdx.getCount() }, (_, i) => refIdx.getScalar(i)), 1));
const bvh = new MeshBVH(bodyGeom);

const bodyBox = new THREE.Box3().setFromBufferAttribute(bodyGeom.getAttribute('position'));
console.log(`ref ${path.basename(refPath)}: ${nRef} verts, ${refJoints.length} joints, bind-world box ` +
  `x[${bodyBox.min.x.toFixed(1)},${bodyBox.max.x.toFixed(1)}] y[${bodyBox.min.y.toFixed(1)},${bodyBox.max.y.toFixed(1)}] z[${bodyBox.min.z.toFixed(1)},${bodyBox.max.z.toFixed(1)}] cm`);

// ── 2. garment → bake node TRS, then fit ───────────────────────────────────────
const gDoc = await read(garmentPath);
const gPrims = [];
for (const n of gDoc.getRoot().listNodes()) if (n.getMesh()) for (const p of n.getMesh().listPrimitives()) gPrims.push({ prim: p, node: n });
if (gPrims.length !== 1) { console.error(`garment: expected exactly 1 primitive, found ${gPrims.length}`); process.exit(1); }
const { prim: gPrim, node: gNode } = gPrims[0];
const gWorld = worldMatrices(gDoc)(gNode);
const gNormalMat = new THREE.Matrix3().getNormalMatrix(gWorld);

const gPosAttr = gPrim.getAttribute('POSITION');
const gNrmAttr = gPrim.getAttribute('NORMAL');
const nG = gPosAttr.getCount();
const gPos = new Float32Array(nG * 3), gNrm = new Float32Array(nG * 3);
{
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < nG; i++) {
    v.fromArray(gPosAttr.getElement(i, [0, 0, 0])).applyMatrix4(gWorld).toArray(gPos, i * 3);
    if (gNrmAttr) n.fromArray(gNrmAttr.getElement(i, [0, 0, 0])).applyMatrix3(gNormalMat).normalize().toArray(gNrm, i * 3);
  }
}

/**
 * Pre-fit yaw. Tripo does not guarantee which way a piece faces: the raw torso cuirasses come out
 * 0.40 wide x 0.58 deep, i.e. turned 90 degrees, and a torso is wider than it is deep. That has to
 * be corrected BEFORE the auto-fit measures anything, or every width/depth number it computes is
 * about the wrong axis (--rotY is applied after fitting and cannot help).
 */
if (yaw) {
  const m = new THREE.Matrix4().makeRotationY(yaw);
  const v = new THREE.Vector3();
  for (let i = 0; i < nG; i++) {
    v.fromArray(gPos, i * 3).applyMatrix4(m).toArray(gPos, i * 3);
    v.fromArray(gNrm, i * 3).applyMatrix4(m).normalize().toArray(gNrm, i * 3);
  }
  console.log(`pre-fit yaw: turned ${(yaw * 180 / Math.PI).toFixed(0)}deg about Y before measuring`);
}

/**
 * Pre-fit pitch, about the garment's own centre. Same reasoning as yaw, different defect: the
 * medium cuirass sat pitched FORWARD relative to the body — validate-garment --clearance read
 * front +5cm standoff and back -2cm BURIED, worsening with height, on the very body it was fitted
 * to. That gradient is a rotation, not a size or shift problem: positive --pitch leans the top
 * backward, trading front slack for back clearance at the shoulder blades while the waist stays
 * put. Applied before the fit so every measurement sees the corrected lean.
 */
if (pitch) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < nG; i++) box.expandByPoint(v.fromArray(gPos, i * 3));
  const c = box.getCenter(new THREE.Vector3());
  // makeRotationX(+θ) sends the top toward +z (forward); negate so positive --pitch = top backward
  const m = new THREE.Matrix4().makeRotationX(-pitch);
  for (let i = 0; i < nG; i++) {
    v.fromArray(gPos, i * 3).sub(c).applyMatrix4(m).add(c).toArray(gPos, i * 3);
    v.fromArray(gNrm, i * 3).applyMatrix4(m).normalize().toArray(gNrm, i * 3);
  }
  console.log(`pre-fit pitch: leaned ${(pitch * 180 / Math.PI).toFixed(0)}deg about X (top ${pitch > 0 ? 'backward' : 'forward'}) before measuring`);
}

let slabHalfX = 0;   // body chest half-width x ease, set by auto-fit pass 2; used by --tuck

const boxOf = (arr) => {
  const b = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < arr.length; i += 3) b.expandByPoint(v.fromArray(arr, i));
  return b;
};

if (autoFit) {
  // Pass 1 — uniform scale so the garment's height matches the slot's bone span x heightFactor,
  // centred on the slot's centre joint.
  const span = Math.abs(jp(slotDef.spanTo).y - jp(slotDef.spanFrom).y);
  const g0 = boxOf(gPos);
  const k = (span * heightFactor) / (g0.max.y - g0.min.y);
  const centre = jp(slotDef.centre);
  const midY = (jp(slotDef.spanTo).y + jp(slotDef.spanFrom).y) / 2;
  const g0c = g0.getCenter(new THREE.Vector3());
  for (let i = 0; i < nG; i++) {
    gPos[i * 3] = (gPos[i * 3] - g0c.x) * k + centre.x;
    gPos[i * 3 + 1] = (gPos[i * 3 + 1] - g0c.y) * k + midY;
    gPos[i * 3 + 2] = (gPos[i * 3 + 2] - g0c.z) * k + centre.z;
  }

  if (!slotDef.uniformOnly) {
  // Pass 2 — the body is not a cylinder: match the garment's X/Z to what the body ACTUALLY
  // measures. This is the step uniform scale can't do, and the step MetaTailor got wrong
  // (2.31x shoulders on a 0.98x waist).
  //
  // Compare a horizontal SLAB at mid-chest, not the two bounding boxes. Matching whole boxes
  // fails on exactly the pieces that matter: heavy_torso's box width is set by its fused
  // pauldrons, so squeezing that box down to torso width shrank the breastplate to 0.6x and
  // rendered a thin V down the sternum with the tunic showing on both sides — visible in the
  // real app, invisible to every number until then. A slab below the shoulders is measuring the
  // same thing on both shapes: the chest.
  const g1 = boxOf(gPos);
  const slabY = g1.min.y + (g1.max.y - g1.min.y) * slotDef.slab;
  const halfSlab = (g1.max.y - g1.min.y) * 0.08;
  const inSlab = (y) => Math.abs(y - slabY) <= halfSlab;

  const bodySlab = new THREE.Box3(), gSlab = new THREE.Box3();
  const v = new THREE.Vector3();
  const je0 = [0, 0, 0, 0], we0 = [0, 0, 0, 0];
  let counted = 0;
  for (let i = 0; i < nRef; i++) {
    v.fromArray(bodyVerts, i * 3);
    if (!inSlab(v.y)) continue;
    refJnt.getElement(i, je0); refWgt.getElement(i, we0);
    let dom = je0[0], dw = we0[0];
    for (let k = 1; k < 4; k++) if (we0[k] > dw) { dw = we0[k]; dom = je0[k]; }
    if (!measureIdx.has(dom)) continue;      // arm/hand/head vertex — not part of the silhouette
    bodySlab.expandByPoint(v); counted++;
  }
  let gCount = 0;
  const slabX = [];
  for (let i = 0; i < nG; i++) { v.fromArray(gPos, i * 3); if (inSlab(v.y)) { gSlab.expandByPoint(v); slabX.push(v.x); gCount++; } }
  if (!counted || !gCount) { console.error(`auto-fit: empty slab at y=${slabY.toFixed(1)} (body ${counted}, garment ${gCount})`); process.exit(1); }

  const bs = bodySlab.getSize(new THREE.Vector3()), gs = gSlab.getSize(new THREE.Vector3());
  const bc = bodySlab.getCenter(new THREE.Vector3()), gc = gSlab.getCenter(new THREE.Vector3());

  /**
   * GRADED width: squeeze the core onto the body, leave the shoulder shells their authored size.
   *
   * One flat x scale cannot fit this piece. heavy_torso is ~41cm wide at EVERY height (measured),
   * against a 22cm torso, because its pauldrons are fused to the chest — so scaling the whole
   * thing to torso width collapses the pauldrons onto the sternum and leaves a thin V with the
   * tunic showing beside it, while scaling it to look right at the shoulders leaves the chest
   * swimming. Both were rendered and both are wrong.
   *
   * So scale x piecewise instead: the inner |x| < split is the cuirass core and is mapped onto
   * the body's measured half-width; everything beyond it is pauldron and keeps its own scale,
   * translated outward to stay attached. Continuous, order-preserving, and it decouples the two
   * things that genuinely have different targets.
   */
  const halfW = gs.x / 2;
  const split = halfW * core;
  const kIn = ((bs.x / 2) * ease) / split;
  const kz = (bs.z / gs.z) * ease;
  slabHalfX = (bs.x / 2) * ease;   // remembered for the --tuck pass
  for (let i = 0; i < nG; i++) {
    const d = gPos[i * 3] - gc.x, s = Math.sign(d), a = Math.abs(d);
    gPos[i * 3] = s * (kIn * Math.min(a, split) + pauldron * Math.max(a - split, 0)) + bc.x;
    gPos[i * 3 + 2] = (gPos[i * 3 + 2] - gc.z) * kz + bc.z;
  }
  const finalHalf = kIn * split + pauldron * (halfW - split);
  console.log(`auto-fit: uniform x${k.toFixed(2)} onto ${span.toFixed(1)}cm span; chest slab y=${slabY.toFixed(1)}cm ` +
    `garment ${gs.x.toFixed(1)}x${gs.z.toFixed(1)} -> body ${bs.x.toFixed(1)}x${bs.z.toFixed(1)}cm (ease ${ease})`);
  console.log(`auto-fit: graded width — core |x|<${split.toFixed(1)}cm scaled x${kIn.toFixed(2)} onto the torso, ` +
    `shells beyond it x${pauldron}; total width ${(2 * finalHalf).toFixed(1)}cm, depth x${kz.toFixed(2)}`);
  } else {
    console.log('auto-fit: uniform only — X/Z left at the authored proportions');
  }
}

/**
 * Hang the piece from a joint instead of centring it on the slot's span.
 *
 * Centring is right for something that wraps a whole region, but a shoulder yoke hangs FROM the
 * shoulders: centring it on the clavicle->pelvis midpoint left its top 5cm below the collarbone,
 * so the bib slid down the chest and read as a separate floating badge. Pinning the top to the
 * clavicle puts the pauldron caps where a pauldron cap goes and everything else follows.
 */
if (autoFit && topJoint) {
  const gb = boxOf(gPos);
  const dy = (jp(topJoint).y + topDy) - gb.max.y;
  for (let i = 0; i < nG; i++) gPos[i * 3 + 1] += dy;
  console.log(`top-anchor: moved ${dy >= 0 ? '+' : ''}${dy.toFixed(1)}cm so the top sits at ${topJoint}${topDy ? ` ${topDy >= 0 ? '+' : ''}${topDy}cm` : ''}`);
}

/**
 * Swing the shoulder shells onto the arm.
 *
 * The bodies bind in an A-pose: the humerus points 52 degrees out from vertical (measured, both
 * sides). Tripo authors a shoulder piece hanging straight DOWN, because that is how armour looks
 * on a figure standing at ease. Skinning the two together as-authored leaves the shells beside the
 * arm rather than on it — the armour's elbow nowhere near the body's elbow, which is exactly what
 * reads as broken. Nothing downstream can fix it: the weight transfer will happily bind a shell to
 * whatever body part it is nearest, and being near the wrong part is the whole problem.
 *
 * So rotate the outer region about the shoulder joint until its long axis lies along the humerus,
 * ramped in from the core edge so the fused bib is not creased.
 */
if (autoFit && !noArms && slotDef.armFit) {
  const gb = boxOf(gPos);
  const cx = (gb.min.x + gb.max.x) / 2, halfW = (gb.max.x - gb.min.x) / 2;
  const splitX = halfW * core;
  for (const side of ['l', 'r']) {
    const sign = side === 'l' ? 1 : -1;
    const shoulder = jp(`upperarm_${side}`);
    const target = jp(`lowerarm_${side}`).clone().sub(shoulder).normalize();
    // Current shell axis: shoulder -> centroid of that side's outer region.
    const cen = new THREE.Vector3(); let n = 0;
    const v = new THREE.Vector3();
    for (let i = 0; i < nG; i++) {
      const d = gPos[i * 3] - cx;
      if (Math.sign(d) !== sign || Math.abs(d) <= splitX) continue;
      cen.add(v.fromArray(gPos, i * 3)); n++;
    }
    if (n < 50) { console.log(`arm-fit ${side}: only ${n} shell vertices — skipped`); continue; }
    cen.divideScalar(n);
    const from = cen.clone().sub(shoulder).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(from, target);
    const deg = 2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI;
    const ident = new THREE.Quaternion();
    const qv = new THREE.Quaternion(), nrm = new THREE.Vector3();
    for (let i = 0; i < nG; i++) {
      const d = gPos[i * 3] - cx;
      if (Math.sign(d) !== sign) continue;
      const t = Math.min(1, Math.max(0, (Math.abs(d) - splitX) / Math.max(halfW - splitX, 1e-6)));
      if (t <= 0) continue;
      const smooth = t * t * (3 - 2 * t);                       // smoothstep, no crease at the seam
      qv.copy(ident).slerp(q, smooth);
      v.fromArray(gPos, i * 3).sub(shoulder).applyQuaternion(qv).add(shoulder).toArray(gPos, i * 3);
      nrm.fromArray(gNrm, i * 3).applyQuaternion(qv).normalize().toArray(gNrm, i * 3);
    }
    console.log(`arm-fit ${side}: swung ${n} shell vertices ${deg.toFixed(0)}deg onto the humerus`);
  }
}

// Manual overrides (the fit panel) applied about the garment's own centre.
if (S.x !== 1 || S.y !== 1 || S.z !== 1 || rotY || D.x || D.y || D.z) {
  const b = boxOf(gPos), c = b.getCenter(new THREE.Vector3());
  const m = new THREE.Matrix4()
    .multiply(new THREE.Matrix4().makeTranslation(c.x + D.x, c.y + D.y, c.z + D.z))
    .multiply(new THREE.Matrix4().makeRotationY(rotY))
    .multiply(new THREE.Matrix4().makeScale(S.x, S.y, S.z))
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const v = new THREE.Vector3();
  for (let i = 0; i < nG; i++) {
    v.fromArray(gPos, i * 3).applyMatrix4(m).toArray(gPos, i * 3);
    v.fromArray(gNrm, i * 3).applyMatrix3(nm).normalize().toArray(gNrm, i * 3);
  }
  console.log(`overrides: scale ${S.x}/${S.y}/${S.z} offset ${D.x}/${D.y}/${D.z}cm rotY ${(rotY * 180 / Math.PI).toFixed(0)}deg`);
}

/**
 * Per-band z registration (--zfit): fit the garment's DEPTH to the body band by band.
 *
 * The slab fit gives one affine z for the whole piece, but a torso's back is an S — shoulder
 * blades and seat both stick out with a hollow between. Measured on the very body the cuirass was
 * fitted to (validate-garment --clearance): back -1.9cm INSIDE the skin at the shoulder blades,
 * -1.2cm at the seat, +3.0cm adrift at mid-back — and no rigid transform + uniform inflate can
 * satisfy all three, because pitch trades the ends against each other and inflate floats the
 * middle. So do for depth exactly what the graded-width pass does for width: in each 4cm y-band,
 * map garment [back..front] onto body [back-zgapb .. front+zgapf] (torso-dominated body verts
 * only), clamp the band scale so degenerate bands (neck ring, skirt hem with no front panel)
 * pin to the BACK target instead of exploding, smooth A/B across bands, lerp between band
 * centres per vertex. Deterministic, measured, no solver.
 *
 * Two placement rules learned from Nabil's review of the first zfit bake:
 *  - runs AFTER the manual --dy/--dz overrides, or a deliberate lift would de-register the bands;
 *  - the warp fades out beyond the body's own half-width in each band. The first version warped
 *    the pauldron caps with the chest's band map, shearing the cap-to-chest junction — the caps
 *    keep their authored z-relation now, exactly like the graded-width pass leaves them their
 *    authored width.
 */
if (autoFit && flag('zfit')) {
  const ZGAPF = num('zgapf', 2.0), ZGAPB = num('zgapb', 1.0);
  const BAND = 4;
  const gb0 = boxOf(gPos);
  const k0 = Math.floor(gb0.min.y / BAND), k1 = Math.floor(gb0.max.y / BAND);
  const nB = k1 - k0 + 1;
  const body = Array.from({ length: nB }, () => ({ f: -1e9, b: 1e9, w: 0 }));
  const gar = Array.from({ length: nB }, () => ({ f: -1e9, b: 1e9 }));
  const v = new THREE.Vector3();
  const je0 = [0, 0, 0, 0], we0 = [0, 0, 0, 0];
  for (let i = 0; i < nRef; i++) {
    v.fromArray(bodyVerts, i * 3);
    const k = Math.floor(v.y / BAND) - k0;
    if (k < 0 || k >= nB) continue;
    refJnt.getElement(i, je0); refWgt.getElement(i, we0);
    let dom = je0[0], dw = we0[0];
    for (let q = 1; q < 4; q++) if (we0[q] > dw) { dw = we0[q]; dom = je0[q]; }
    if (!measureIdx.has(dom)) continue;
    if (v.z > body[k].f) body[k].f = v.z;
    if (v.z < body[k].b) body[k].b = v.z;
    if (Math.abs(v.x) > body[k].w) body[k].w = Math.abs(v.x);
  }
  // garment extents from CORE verts only (within the band's body half-width) — the flared wings
  // must not define the depth the chest is registered by
  for (let i = 0; i < nG; i++) {
    const y = gPos[i * 3 + 1], z = gPos[i * 3 + 2];
    const k = Math.floor(y / BAND) - k0;
    if (k < 0 || k >= nB) continue;
    if (body[k].w > 0 && Math.abs(gPos[i * 3]) > body[k].w) continue;
    if (z > gar[k].f) gar[k].f = z;
    if (z < gar[k].b) gar[k].b = z;
  }
  // per-band affine z' = A z + B; A clamped, degenerate bands pin the back
  const A = new Float64Array(nB).fill(1), B = new Float64Array(nB);
  for (let k = 0; k < nB; k++) {
    const bd = body[k], gd = gar[k];
    const bodyOk = bd.f > -1e8 && bd.b < 1e8, garOk = gd.f > -1e8 && gd.b < 1e8;
    if (!bodyOk || !garOk) { A[k] = 1; B[k] = 0; continue; }
    const tf = bd.f + ZGAPF, tb = bd.b - ZGAPB;
    const depth = gd.f - gd.b;
    let a = depth > 6 ? (tf - tb) / depth : 1;
    a = Math.min(1.6, Math.max(0.6, a));
    A[k] = a; B[k] = tb - a * gd.b;           // pin the BACK; burial is the visible defect
  }
  // fill bands with no data from neighbours, then 3-tap smooth so bands don't step
  for (let k = 0; k < nB; k++) if (B[k] === 0 && A[k] === 1) { const src = k > 0 ? k - 1 : k + 1; if (src >= 0 && src < nB) { A[k] = A[src]; B[k] = B[src]; } }
  const As = A.slice(), Bs = B.slice();
  for (let k = 1; k < nB - 1; k++) { As[k] = (A[k - 1] + A[k] + A[k + 1]) / 3; Bs[k] = (B[k - 1] + B[k] + B[k + 1]) / 3; }
  for (let i = 0; i < nG; i++) {
    const y = gPos[i * 3 + 1];
    const t = y / BAND - k0 - 0.5;
    const k = Math.min(nB - 1, Math.max(0, Math.floor(t)));
    const k2 = Math.min(nB - 1, k + 1);
    const u = Math.min(1, Math.max(0, t - k));
    const a = As[k] * (1 - u) + As[k2] * u, b2 = Bs[k] * (1 - u) + Bs[k2] * u;
    // fade the warp to identity beyond the body's half-width so wings keep their authored z
    const w = body[Math.min(nB - 1, Math.max(0, Math.round(t)))].w || 1e9;
    const excess = Math.abs(gPos[i * 3]) - w;
    const fade = excess <= 0 ? 1 : Math.max(0, 1 - excess / 8);
    const zz = gPos[i * 3 + 2];
    gPos[i * 3 + 2] = (a * zz + b2) * fade + zz * (1 - fade);
  }
  console.log(`z-fit: per-band depth registration over ${nB} bands (gaps front ${ZGAPF}cm back ${ZGAPB}cm), core-faded beyond the body's half-width`);
}

/**
 * --tuck / --tuckdrop: rein in the shoulder-cap TIPS without touching the chest.
 *
 * The graded-width knobs cannot do this: shrinking `core` re-scales the chest plates themselves
 * (core 0.62 stretched the mid-chest 2.08x and collapsed the caps into it — the v6 mess Nabil
 * rejected on sight). This instead ramps only on |x| beyond the body's chest half-width W:
 * x' = W + (|x|-W)*tuck, y' -= (|x|-W)*tuckdrop. Continuous at W, identity inside it, and the
 * drop also lowers the armhole's outer rim ("the hole for the arm needs to come down"). Runs
 * before --clear, which then guarantees the moved tips still clear the deltoid.
 */
const tuckK = num('tuck', 1), tuckDrop = num('tuckdrop', 0);
if (tuckK !== 1 || tuckDrop) {
  const W = slabHalfX + num('tuckstart', 1);
  // Smoothstep the ramp in over BLEND cm. The first version applied the full gradient from the
  // boundary onward: triangles spanning |x|=W had one corner held and one displaced, and the
  // shear tore the stacked cap lames apart — a black gash across the shoulder (Nabil's shot).
  const BLEND = 4;
  let nT = 0;
  for (let i = 0; i < nG; i++) {
    const ax = Math.abs(gPos[i * 3]);
    if (ax <= W) continue;
    const excess = ax - W;
    const t = Math.min(1, excess / BLEND);
    const g = t * t * (3 - 2 * t);
    gPos[i * 3] = Math.sign(gPos[i * 3]) * (ax - (1 - tuckK) * excess * g);
    gPos[i * 3 + 1] -= excess * tuckDrop * g;
    nT++;
  }
  console.log(`tuck: beyond |x|=${W.toFixed(1)}cm scaled x${tuckK}${tuckDrop ? ` and dropped ${tuckDrop}cm/cm` : ''}, eased over ${BLEND}cm (${nT} verts)`);
}

/**
 * --sections '<json>': bake the values dialled on the /model-review section panel. Same masks,
 * same math, same W as the live preview — all three come from garment-sections.mjs, so what was
 * seen on the sliders is what ships. Runs before inflate/clear so the safety passes still guard
 * the sculpted result.
 */
if (arg('sections')) {
  const params = JSON.parse(arg('sections'));
  const { weights, meta } = computeSectionWeights(gPos, nG, {
    W: slabHalfX + 1,
    indices: gPrim.getIndices()?.getArray(),   // enables the real armhole-rim masks
  });
  applySections(Float32Array.from(gPos), gPos, nG, weights, params, meta);
  const dialled = Object.entries(params)
    .flatMap(([s, ps]) => Object.entries(ps).filter(([, v]) => v).map(([p, v]) => `${s}.${p}=${v}`));
  console.log(`sections: ${dialled.length ? dialled.join(' ') : '(all zero)'}`);
}

// Clearance. The bodies have clothes PAINTED ON, so there is nothing to hide behind —
// separation has to be geometric, and baking it here costs nothing at runtime.
if (inflateCm) {
  for (let i = 0; i < nG; i++) for (let k = 0; k < 3; k++) gPos[i * 3 + k] += gNrm[i * 3 + k] * inflateCm;
  console.log(`inflated ${inflateCm}cm along normals`);
}

/**
 * LOCAL clearance (--clear <cm>): push out only the vertices the body actually violates.
 *
 * Global --inflate at the size needed to stop shirt wrinkles poking through the back panel
 * (1.4cm, tried) melts the sculpt — plate edges, straps and studs balloon into blobs. The poke-
 * through is local (wrinkle bulges crossing plate concavities), so the fix must be local too:
 * per vertex, signed distance to the reference body via the existing BVH (sign from the body's
 * AUTHORED skinned normals — winding-derived normals flip on Tripo meshes), then displacement
 * = max(0, clear - signed), the FIELD smoothed over seam-welded adjacency so a pushed patch
 * carries its neighbours smoothly instead of denting, applied along the body's normal (away
 * from the skin — the garment's own normal on a strap points sideways). Deterministic single
 * pass; proud plates keep their authored shape to the millimetre.
 */
const clearCm = num('clear', 0);
if (clearCm) {
  if (!bodyNrms) { console.error('--clear needs authored NORMAL on the ref body'); process.exit(1); }
  const armClear = num('armclear', 0);
  const disp = new Float32Array(nG);
  const dirs = new Float32Array(nG * 3);
  const bIdxArr = bodyGeom.getIndex().array;
  const p = new THREE.Vector3(), bn = new THREE.Vector3(), dv = new THREE.Vector3();
  const target = {};
  const hje = [0, 0, 0, 0], hwe = [0, 0, 0, 0];
  let touched = 0, buried = 0;
  for (let i = 0; i < nG; i++) {
    p.fromArray(gPos, i * 3);
    bvh.closestPointToPoint(p, target);
    if (target.distance > clearCm + armClear + 1) continue;
    const f = target.faceIndex * 3;
    bn.set(0, 0, 0);
    for (let k = 0; k < 3; k++) {
      const vi = bIdxArr[f + k];
      bn.x += bodyNrms[vi * 3]; bn.y += bodyNrms[vi * 3 + 1]; bn.z += bodyNrms[vi * 3 + 2];
    }
    bn.normalize();
    const signed = dv.copy(p).sub(target.point).dot(bn) >= 0 ? target.distance : -target.distance;
    /**
     * Over the ARM the floor is higher (--armclear, cm on top of --clear). The bind is an
     * A-pose but the piece is trunk-weighted, so every animation that drops the arms rotates
     * the deltoid INTO a cap that fit perfectly at bind — clearance at bind must pre-pay for
     * that swing. Only garment over arm-dominated skin pays it; the chest stays snug.
     */
    const hv = bIdxArr[f];
    refJnt.getElement(hv, hje); refWgt.getElement(hv, hwe);
    let hdom = hje[0], hdw = hwe[0];
    for (let k = 1; k < 4; k++) if (hwe[k] > hdw) { hdw = hwe[k]; hdom = hje[k]; }
    const overArm = /^(upperarm|lowerarm|hand)_[lr]$/.test(canonicalName(refJoints[hdom].getName()));
    const req = overArm ? clearCm + armClear : clearCm;
    if (signed < req) {
      disp[i] = req - signed;
      dirs[i * 3] = bn.x; dirs[i * 3 + 1] = bn.y; dirs[i * 3 + 2] = bn.z;
      touched++; if (signed < 0) buried++;
    }
  }
  // smooth the displacement FIELD (not positions) over seam-welded adjacency; coincident seam
  // twins compute identical displacement (same position -> same closest point), so seams hold
  const gIdxAcc = gPrim.getIndices();
  const key = (i) => `${Math.round(gPos[i * 3] * 100)},${Math.round(gPos[i * 3 + 1] * 100)},${Math.round(gPos[i * 3 + 2] * 100)}`;
  const weld = new Map(), rep = new Int32Array(nG);
  for (let i = 0; i < nG; i++) { const k = key(i); if (!weld.has(k)) weld.set(k, i); rep[i] = weld.get(k); }
  const adj = new Map();
  const link = (u, v) => { if (u === v) return; (adj.get(u) || adj.set(u, new Set()).get(u)).add(v); };
  for (let f = 0; f < gIdxAcc.getCount(); f += 3) {
    const t = [rep[gIdxAcc.getScalar(f)], rep[gIdxAcc.getScalar(f + 1)], rep[gIdxAcc.getScalar(f + 2)]];
    for (const u of t) for (const v of t) link(u, v);
  }
  let field = new Float64Array(nG);
  for (let i = 0; i < nG; i++) field[i] = disp[rep[i]];
  for (let pass = 0; pass < 2; pass++) {
    const next = Float64Array.from(field);
    for (const [, i] of weld) {
      const nb = adj.get(i);
      if (!nb || !nb.size) continue;
      let acc = 0;
      for (const n of nb) acc += field[n];
      // max-leaning blend: a violating vertex must KEEP its full push (this is a floor, not a
      // diffusion target), while clear neighbours get carried partway out to meet it
      next[i] = Math.max(field[i], 0.6 * (acc / nb.size) + 0.4 * field[i]);
    }
    for (let i = 0; i < nG; i++) next[i] = next[rep[i]];
    field = next;
  }
  /**
   * Push DIRECTIONS live on welded reps and propagate to dragged verts from their neighbours.
   * The first version fell back to each vertex's OWN authored normal — and UV-seam twins have
   * different normals, so the two sides of a seam moved apart and the chest plate showed a
   * jagged crack down the sternum (Nabil's screenshot). Everything here keys off rep[i]; twins
   * cannot disagree by construction.
   */
  for (let pass = 0; pass < 3; pass++) {
    let filled = 0;
    for (const [, i] of weld) {
      if (field[i] <= 1e-4) continue;
      if (dirs[i * 3] || dirs[i * 3 + 1] || dirs[i * 3 + 2]) continue;
      const nb = adj.get(i);
      if (!nb) continue;
      let dx = 0, dy = 0, dz = 0;
      for (const n of nb) { dx += dirs[n * 3]; dy += dirs[n * 3 + 1]; dz += dirs[n * 3 + 2]; }
      const len = Math.hypot(dx, dy, dz);
      if (len > 1e-6) { dirs[i * 3] = dx / len; dirs[i * 3 + 1] = dy / len; dirs[i * 3 + 2] = dz / len; filled++; }
    }
    if (!filled) break;
  }
  const fallback = new THREE.Vector3();
  for (let i = 0; i < nG; i++) {
    const d = field[i];
    if (d <= 1e-4) continue;
    const r = rep[i];
    let dx = dirs[r * 3], dy = dirs[r * 3 + 1], dz = dirs[r * 3 + 2];
    if (!dx && !dy && !dz) {
      // truly isolated: use the REP twin's normal so seam twins still agree
      fallback.fromArray(gNrm, r * 3); dx = fallback.x; dy = fallback.y; dz = fallback.z;
    }
    gPos[i * 3] += dx * d; gPos[i * 3 + 1] += dy * d; gPos[i * 3 + 2] += dz * d;
  }
  console.log(`local clearance ${clearCm}cm: ${touched} verts violated (${buried} inside the skin), field-smoothed x2`);
}

const gBox = boxOf(gPos);
console.log(`garment box: x[${gBox.min.x.toFixed(1)},${gBox.max.x.toFixed(1)}] y[${gBox.min.y.toFixed(1)},${gBox.max.y.toFixed(1)}] z[${gBox.min.z.toFixed(1)},${gBox.max.z.toFixed(1)}] cm`);

// ── 3. weight transfer ─────────────────────────────────────────────────────────
// Skirt profile: below the hip a torso weighting drags cloth with the spine. Legs should
// drive it instead, but only partly — a skirt is not trousers.
const SKIRT_IDX = profile === 'skirt'
  ? { pelvis: jointIndex.get('pelvis'), l: jointIndex.get('thigh_l'), r: jointIndex.get('thigh_r'), y: jp('pelvis').y }
  : null;

const gJoints = new Uint16Array(nG * 4);
const gWeights = new Float32Array(nG * 4);
const tri = new THREE.Triangle(), bary = new THREE.Vector3(), target = {};
const posArr = bodyGeom.getAttribute('position').array;
const idxArr = bodyGeom.getIndex().array;
let fallbacks = 0, maxDist = 0, tooFar = 0;

for (let i = 0; i < nG; i++) {
  const p = new THREE.Vector3().fromArray(gPos, i * 3);
  bvh.closestPointToPoint(p, target);
  maxDist = Math.max(maxDist, target.distance);
  const f = target.faceIndex * 3;
  const a = idxArr[f], b = idxArr[f + 1], c = idxArr[f + 2];
  tri.a.fromArray(posArr, a * 3); tri.b.fromArray(posArr, b * 3); tri.c.fromArray(posArr, c * 3);
  if (!tri.getBarycoord(target.point, bary)) bary.set(1 / 3, 1 / 3, 1 / 3);   // degenerate tri

  // Blend the three corners' skin weights, then keep only joints this slot may drive.
  const acc = new Map();
  const je = [0, 0, 0, 0], we = [0, 0, 0, 0];
  for (const [vi, bw] of [[a, bary.x], [b, bary.y], [c, bary.z]]) {
    if (bw <= 0) continue;
    refJnt.getElement(vi, je); refWgt.getElement(vi, we);
    for (let k = 0; k < 4; k++) {
      if (!we[k]) continue;
      const j = canonIdx[je[k]];                 // twist/share bone -> its limb
      if (!allowIdx.has(j)) continue;
      acc.set(j, (acc.get(j) || 0) + we[k] * bw);
    }
  }
  // A pauldron vertex can land on a forearm — every blended joint filtered out. Fall back to
  // the nearest allowlisted joint by world distance; silently emitting a zero-weight vertex
  // would leave it pinned at the origin.
  if (!acc.size) {
    fallbacks++;
    let best = -1, bd = Infinity;
    for (const n of allow) { const d = jp(n).distanceTo(p); if (d < bd) { bd = d; best = jointIndex.get(n); } }
    acc.set(best, 1);
  }
  if (SKIRT_IDX && p.y < SKIRT_IDX.y) {
    // Re-cast below the hip: pelvis plus the nearer thigh, thigh capped so the cloth swings
    // with the leg without being glued to it.
    const legT = Math.min(0.5, Math.max(0, (SKIRT_IDX.y - p.y) / 15));
    const leg = p.x >= 0 ? SKIRT_IDX.l : SKIRT_IDX.r;
    acc.clear(); acc.set(SKIRT_IDX.pelvis, 1 - legT); acc.set(leg, legT);
  }
  /**
   * Reject implausibly distant joints.
   *
   * The bodies bind in an A-pose, so the forearms hang right beside the HIPS — and closest-point
   * transfer duly handed 53 waist vertices per side a mix of `lowerarm` and `pelvis`, two joints
   * 30cm apart. At rest that is invisible; in the `down` clip the arm swings away and drags the
   * waist of the cuirass with it, smearing the plate into black streaks. (Weight smoothing was
   * the obvious suspect and was measured innocent: 0 passes and 2 passes tear identically.)
   *
   * A garment vertex should only be driven by joints near it, so keep the nearest weighted joint
   * and anything within `reach` of that distance. Armpit blends (upperarm + spine_03, ~10cm
   * apart) survive; hip-to-forearm does not.
   */
  if (acc.size > 1) {
    let dom = -1, dw = -1;
    for (const [j, w] of acc) if (w > dw) { dw = w; dom = j; }
    for (const j of [...acc.keys()]) {
      const h = jointHops[dom][j];
      if (h < 0 || h > maxHops) { acc.delete(j); tooFar++; }
    }
  }
  const top = [...acc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4);
  const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
  for (let k = 0; k < 4; k++) {
    gJoints[i * 4 + k] = top[k] ? top[k][0] : 0;
    gWeights[i * 4 + k] = top[k] ? top[k][1] / sum : 0;
  }
}
console.log(`weights: max body distance ${maxDist.toFixed(2)}cm, ${fallbacks} nearest-joint fallbacks, ${tooFar} joint assignments dropped as skeletally unrelated (>${maxHops} hops)`);

// ── 4. smooth over SEAM-WELDED adjacency ───────────────────────────────────────
// Tripo meshes are split along UV seams, so two coincident vertices are separate indices with
// separate weights — smoothing over raw index adjacency would leave a hard weight seam
// straight down the middle of the garment.
{
  const gIdxAcc = gPrim.getIndices();
  const key = (i) => `${Math.round(gPos[i * 3] * 100)},${Math.round(gPos[i * 3 + 1] * 100)},${Math.round(gPos[i * 3 + 2] * 100)}`;
  const weld = new Map(), rep = new Int32Array(nG);
  for (let i = 0; i < nG; i++) { const k = key(i); if (!weld.has(k)) weld.set(k, i); rep[i] = weld.get(k); }
  const adj = new Map();
  const link = (u, v) => { if (u === v) return; (adj.get(u) || adj.set(u, new Set()).get(u)).add(v); };
  for (let f = 0; f < gIdxAcc.getCount(); f += 3) {
    const t = [rep[gIdxAcc.getScalar(f)], rep[gIdxAcc.getScalar(f + 1)], rep[gIdxAcc.getScalar(f + 2)]];
    for (const u of t) for (const v of t) link(u, v);
  }
  const lambda = 0.5;
  let cur = new Map();
  for (let i = 0; i < nG; i++) {
    if (rep[i] !== i) continue;
    const m = new Map();
    for (let k = 0; k < 4; k++) if (gWeights[i * 4 + k]) m.set(gJoints[i * 4 + k], gWeights[i * 4 + k]);
    cur.set(i, m);
  }
  for (let pass = 0; pass < smoothPasses; pass++) {
    const next = new Map();
    for (const [i, m] of cur) {
      const nb = adj.get(i);
      const acc = new Map();
      for (const [j, w] of m) acc.set(j, w * (1 - lambda));
      if (nb && nb.size) {
        const share = lambda / nb.size;
        for (const n of nb) for (const [j, w] of (cur.get(n) || [])) acc.set(j, (acc.get(j) || 0) + w * share);
      } else {
        for (const [j, w] of m) acc.set(j, (acc.get(j) || 0) + w * lambda);
      }
      next.set(i, acc);
    }
    cur = next;
  }
  for (let i = 0; i < nG; i++) {
    // Re-apply the adjacency filter: smoothing pulls in each neighbour's joints, which quietly
    // re-created the very hip+forearm blends the transfer step had just removed.
    const m = new Map(cur.get(rep[i]));
    if (m.size > 1) {
      let dom = -1, dw = -1;
      for (const [j, w] of m) if (w > dw) { dw = w; dom = j; }
      for (const j of [...m.keys()]) { const h = jointHops[dom][j]; if (h < 0 || h > maxHops) m.delete(j); }
    }
    /**
     * `--rigid`: one bone per vertex, weight 1.
     *
     * Linear blend skinning averages MATRICES, so a vertex split between two bones that rotate far
     * apart collapses toward the axis between them — the candy-wrapper. On flesh that reads as a
     * soft crease; on steel plate it smeared the cuirass into black streaks in the `down` clip,
     * and no amount of weight cleanup fixed it because the weights were not the problem. Real
     * armour is separate rigid plates, so bind it as separate rigid plates: each vertex rotates
     * with exactly one bone and the geometry stays solid. The cost is a hard seam where plates
     * meet, which is what the overlapping lames and the baked `--inflate` clearance are for.
     */
    const top = [...m.entries()].sort((x, y) => y[1] - x[1]).slice(0, rigid ? 1 : 4);
    const sum = top.reduce((s, [, w]) => s + w, 0) || 1;
    for (let k = 0; k < 4; k++) {
      gJoints[i * 4 + k] = top[k] ? top[k][0] : 0;
      gWeights[i * 4 + k] = top[k] ? top[k][1] / sum : 0;
    }
  }
  console.log(`smoothed: ${nG} verts welded to ${weld.size} positions, ${smoothPasses} passes lambda=${lambda}`);
}

// ── 5. write ───────────────────────────────────────────────────────────────────
const buf = gDoc.getRoot().listBuffers()[0];
gPosAttr.setType('VEC3').setArray(gPos).setNormalized(false);
if (gNrmAttr) gNrmAttr.setType('VEC3').setArray(gNrm).setNormalized(false);
gPrim.setAttribute('JOINTS_0', gDoc.createAccessor().setType('VEC4').setArray(gJoints).setBuffer(buf));
gPrim.setAttribute('WEIGHTS_0', gDoc.createAccessor().setType('VEC4').setArray(gWeights).setBuffer(buf));

const scene = gDoc.getRoot().listScenes()[0];
gNode.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);

const ibm = new Float32Array(refJoints.length * 16);
const jointNodes = refJoints.map((j, i) => {
  const w = refWorld(j);
  const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  w.decompose(t, q, s);
  new THREE.Matrix4().copy(w).invert().toArray(ibm, i * 16);
  const node = gDoc.createNode(j.getName())
    .setTranslation([t.x, t.y, t.z]).setRotation([q.x, q.y, q.z, q.w]).setScale([s.x, s.y, s.z]);
  scene.addChild(node);
  return node;
});
const skin = gDoc.createSkin('garment_skin')
  .setInverseBindMatrices(gDoc.createAccessor().setType('MAT4').setArray(ibm).setBuffer(buf));
for (const n of jointNodes) skin.addJoint(n);
gNode.setSkin(skin);

/**
 * Carried in the file so the RUNTIME can apply per-body section values with the same masks and
 * the same units the baker used:
 *   sectionW       cap boundary, cm — identical region borders live and baked
 *   authoredHeight garment height in CM. The shipped copy is meshopt-quantized to a normalised
 *                  ±1 range (measured: 2.00 units for a 35.72cm piece), so a runtime reading it
 *                  divides its own measured height by this to get units-per-cm. Without it a
 *                  "+3cm" section value would land as +3 NORMALISED units — half the model away.
 */
{
  const gb = boxOf(gPos);
  scene.setExtras({ sectionW: slabHalfX + 1, authoredHeight: gb.max.y - gb.min.y });
}

await io.write(outPath, gDoc);

/**
 * --devraw <name>: also drop this raw (float, pre-meshopt) build at
 * public/models/armor-dev/<name>.glb for the /model-review section sliders. The optimized file
 * that ships is quantized and cannot be sculpted; the dev copy never ships (the tauri bundle
 * glob is armor/*.glb and the vite build strips dist/models).
 */
if (arg('devraw')) {
  const devDir = 'public/models/armor-dev';
  fs.mkdirSync(devDir, { recursive: true });
  const devPath = `${devDir}/${arg('devraw')}.glb`;
  await io.write(devPath, gDoc);
  console.log(`dev raw copy: ${devPath}`);
}

// ── 6. self-check: read back and CPU-skin at rest ──────────────────────────────
// The point of the whole design is that G*IBM is identity at bind, so the written file must
// reproduce the authored positions exactly. Checking the WRITTEN file (not the in-memory doc)
// is what makes this a real check — it catches accessor type, quantization and IBM mistakes.
{
  const chk = await read(outPath);
  const w = worldMatrices(chk);
  const { prim, skin: sk } = soleSkinnedPrim(chk, 'output');
  const js = sk.listJoints(), ibmA = sk.getInverseBindMatrices().getArray();
  const mats = js.map((j, i) => new THREE.Matrix4().multiplyMatrices(w(j), new THREE.Matrix4().fromArray(ibmA, i * 16)));
  const P = prim.getAttribute('POSITION'), J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
  const v = new THREE.Vector3(), acc = new THREE.Vector3(), tmp = new THREE.Vector3();
  const je = [0, 0, 0, 0], we = [0, 0, 0, 0];
  let worst = 0, badSum = 0;
  for (let i = 0; i < P.getCount(); i++) {
    v.fromArray(P.getElement(i, [0, 0, 0]));
    J.getElement(i, je); W.getElement(i, we);
    const s = we[0] + we[1] + we[2] + we[3];
    if (Math.abs(s - 1) > 1e-3) badSum++;
    acc.set(0, 0, 0);
    for (let k = 0; k < 4; k++) if (we[k]) acc.add(tmp.copy(v).applyMatrix4(mats[je[k]]).multiplyScalar(we[k]));
    worst = Math.max(worst, acc.distanceTo(new THREE.Vector3().fromArray(gPos, i * 3)));
  }
  const names = new Set(js.map((j) => j.getName()));
  const unresolved = [...allow].filter((n) => !names.has(n));
  console.log(`\nself-check on ${outPath}:`);
  console.log(`  rest deviation from authored: ${worst.toExponential(2)} cm  (limit 1e-3)`);
  console.log(`  vertices whose weights don't sum to 1: ${badSum}`);
  console.log(`  slot joints present in output skin: ${allow.size - unresolved.length}/${allow.size}${unresolved.length ? ` MISSING ${unresolved.join(',')}` : ''}`);
  if (worst > 1e-3 || badSum || unresolved.length) { console.error('SELF-CHECK FAILED'); process.exit(1); }
  console.log('  SELF-CHECK PASSED');
}
console.log(`\nnext: node scripts/optimize-prop-glb.cjs ${outPath} ${outPath} 1024`);
