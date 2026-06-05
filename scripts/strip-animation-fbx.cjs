#!/usr/bin/env node
/**
 * strip-animation-fbx.js
 *
 * Converts an AccuRig/Mixamo FBX animation file into a compact mesh-stripped GLB.
 *
 * Workflow:
 *   1. assimp converts FBX → full GLB (includes mesh + animations)
 *   2. This script strips meshes/materials/textures from the GLB binary,
 *      keeping only skeleton nodes + animation curves.
 *
 * Usage:
 *   node scripts/strip-animation-fbx.js <input.fbx> <output.glb>
 *
 * Requirements:
 *   - assimp installed: brew install assimp
 *
 * Why not embed textures / "Without Skin" in AccuRig:
 *   AccuRig has no "without skin" export option. assimp + this script is the
 *   equivalent: mesh data is removed post-conversion. The resulting GLB contains
 *   only AnimationClip data (bone transforms). THREE.js retargets these clips
 *   onto the idle FBX skeleton by bone name — bone names are preserved by assimp.
 *
 * Size reference (AccuRig 118-bone rig, ~1-3s animations):
 *   FBX with mesh  → ~22 MB
 *   Full GLB       → ~30 MB  (assimp uncompressed)
 *   Stripped GLB   → ~13 MB  (animation curves only)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const [,, inputFbx, outputGlb] = process.argv;

if (!inputFbx || !outputGlb) {
  console.error('Usage: node scripts/strip-animation-fbx.js <input.fbx> <output.glb>');
  process.exit(1);
}

const absInput  = path.resolve(inputFbx);
const absOutput = path.resolve(outputGlb);
const tmpGlb    = absOutput.replace(/\.glb$/, '_raw.glb');

if (!fs.existsSync(absInput)) {
  console.error('Input not found:', absInput);
  process.exit(1);
}

// Step 1: FBX → full GLB via assimp
console.log('Step 1: assimp converting', path.basename(absInput), '→', path.basename(tmpGlb));
try {
  execSync(`assimp export "${absInput}" "${tmpGlb}"`, { stdio: 'pipe' });
} catch (e) {
  console.error('assimp failed:', e.stderr?.toString());
  process.exit(1);
}
console.log('       ', (fs.statSync(tmpGlb).size / 1024 / 1024).toFixed(1) + 'MB raw GLB');

// Step 2: strip mesh, materials, textures from the GLB binary
console.log('Step 2: stripping mesh from GLB binary');

const buf = fs.readFileSync(tmpGlb);
const jsonLen = buf.readUInt32LE(12);
const json    = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8').replace(/\0+$/, ''));

// Remove mesh reference from every node (skeleton nodes stay)
(json.nodes || []).forEach(n => { delete n.mesh; });

// Drop mesh/material/texture/image arrays
delete json.meshes;
delete json.materials;
delete json.textures;
delete json.images;

// Collect accessors referenced by animations
const usedAccessors = new Set();
(json.animations || []).forEach(anim => {
  (anim.samplers || []).forEach(s => {
    usedAccessors.add(s.input);
    usedAccessors.add(s.output);
  });
});

// Rebuild accessors + remap
const oldAccessors = json.accessors || [];
const newAccessors = oldAccessors.filter((_, i) => usedAccessors.has(i));
const accRemap = {};
oldAccessors.forEach((a, oldIdx) => {
  const newIdx = newAccessors.indexOf(a);
  if (newIdx >= 0) accRemap[oldIdx] = newIdx;
});
json.accessors = newAccessors;

// Remap animation sampler refs
(json.animations || []).forEach(anim => {
  (anim.samplers || []).forEach(s => {
    s.input  = accRemap[s.input]  ?? s.input;
    s.output = accRemap[s.output] ?? s.output;
  });
});

// Rebuild bufferViews
const usedBVs = new Set(newAccessors.map(a => a.bufferView).filter(v => v != null));
const oldBVs  = json.bufferViews || [];
const newBVs  = oldBVs.filter((_, i) => usedBVs.has(i));
const bvRemap = {};
oldBVs.forEach((bv, oldIdx) => {
  const newIdx = newBVs.indexOf(bv);
  if (newIdx >= 0) bvRemap[oldIdx] = newIdx;
});
json.bufferViews = newBVs;
newAccessors.forEach(a => {
  if (a.bufferView != null) a.bufferView = bvRemap[a.bufferView] ?? a.bufferView;
});

// Extract only the used binary slices
const binChunkOffset = 20 + jsonLen;
const binChunkLen    = buf.readUInt32LE(binChunkOffset);
const binData        = buf.slice(binChunkOffset + 8, binChunkOffset + 8 + binChunkLen);

const parts = [];
let offset = 0;
newBVs.forEach(bv => {
  const slice = binData.slice(bv.byteOffset, bv.byteOffset + bv.byteLength);
  parts.push(slice);
  bv.byteOffset = offset;
  offset += bv.byteLength;
});
const newBin = Buffer.concat(parts);
json.buffers = [{ byteLength: newBin.length }];

// Write new GLB
const jsonStr    = JSON.stringify(json);
const jsonPadded = jsonStr + ' '.repeat((4 - (jsonStr.length % 4)) % 4);
const binPadded  = Buffer.alloc(Math.ceil(newBin.length / 4) * 4);
newBin.copy(binPadded);

const totalLen = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
const out = Buffer.alloc(totalLen);
let p = 0;
out.writeUInt32LE(0x46546C67, p); p += 4;
out.writeUInt32LE(2,          p); p += 4;
out.writeUInt32LE(totalLen,   p); p += 4;
out.writeUInt32LE(jsonPadded.length, p); p += 4;
out.writeUInt32LE(0x4E4F534A, p); p += 4;
Buffer.from(jsonPadded).copy(out, p); p += jsonPadded.length;
out.writeUInt32LE(binPadded.length, p); p += 4;
out.writeUInt32LE(0x004E4942, p); p += 4;
binPadded.copy(out, p);

fs.writeFileSync(absOutput, out);
fs.unlinkSync(tmpGlb); // clean up raw GLB

const inMB  = (fs.statSync(absInput).size  / 1024 / 1024).toFixed(1);
const outMB = (out.length                  / 1024 / 1024).toFixed(1);
const anims = (json.animations || []).map(a => `"${a.name}"`).join(', ');

console.log(`Done: ${inMB}MB FBX → ${outMB}MB GLB`);
console.log(`Animations: ${anims}`);
console.log(`Output: ${absOutput}`);
