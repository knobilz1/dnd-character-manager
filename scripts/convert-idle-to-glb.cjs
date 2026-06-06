#!/usr/bin/env node
/**
 * convert-idle-to-glb.cjs
 *
 * Converts a character idle FBX (mesh + skeleton + animation) to GLB format.
 * GLTFLoader parses GLB ~5-10x faster than FBXLoader parses FBX.
 *
 * Steps:
 *   1. assimp converts FBX → raw GLB (includes embedded textures)
 *   2. This script strips embedded images/textures from the GLB binary
 *      (we load textures separately via TextureLoader so they're wasted space)
 *   3. Writes a clean GLB with mesh + skeleton + animations only
 *
 * Usage:
 *   node scripts/convert-idle-to-glb.cjs <input.fbx> <output.glb>
 */

'use strict';

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const [,, inputFbx, outputGlb] = process.argv;
if (!inputFbx || !outputGlb) {
  console.error('Usage: node scripts/convert-idle-to-glb.cjs <input.fbx> <output.glb>');
  process.exit(1);
}

const absInput  = path.resolve(inputFbx);
const absOutput = path.resolve(outputGlb);
const tmpGlb    = absOutput.replace(/\.glb$/, '_raw.glb');

if (!fs.existsSync(absInput)) {
  console.error('Input not found:', absInput);
  process.exit(1);
}

// ── Step 1: FBX → full GLB via assimp ────────────────────────────────────────
console.log('Step 1: assimp converting', path.basename(absInput), '→ raw GLB');
try {
  execSync(`assimp export "${absInput}" "${tmpGlb}"`, { stdio: 'pipe' });
} catch (e) {
  console.error('assimp failed:', e.stderr?.toString());
  process.exit(1);
}
console.log('       ', (fs.statSync(tmpGlb).size / 1024 / 1024).toFixed(1) + 'MB raw GLB');

// ── Step 2: Strip embedded images & textures from GLB binary ─────────────────
console.log('Step 2: stripping embedded textures');

const buf     = fs.readFileSync(tmpGlb);
const jsonLen = buf.readUInt32LE(12);
const json    = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8').replace(/\0+$/, ''));

const binStart = 20 + jsonLen;
const binLen   = buf.readUInt32LE(binStart);
const binData  = buf.slice(binStart + 8, binStart + 8 + binLen);

// Collect bufferViews used by images (to exclude from rebuilt BIN)
const imageBVs = new Set(
  (json.images || [])
    .map(img => img.bufferView)
    .filter(bv => bv != null)
);

// Strip image & texture data from JSON
delete json.images;
delete json.textures;

// Clear texture references from materials (we override in applyTexture())
for (const mat of (json.materials || [])) {
  if (mat.pbrMetallicRoughness) {
    delete mat.pbrMetallicRoughness.baseColorTexture;
    delete mat.pbrMetallicRoughness.metallicRoughnessTexture;
  }
  delete mat.normalTexture;
  delete mat.occlusionTexture;
  delete mat.emissiveTexture;
}

// ── Rebuild bufferViews, excluding image-only ones ────────────────────────────
const oldBVs   = json.bufferViews || [];
const newBVs   = oldBVs.filter((_, i) => !imageBVs.has(i));
const bvRemap  = {};
oldBVs.forEach((bv, i) => {
  if (!imageBVs.has(i)) {
    bvRemap[i] = newBVs.indexOf(bv);
  }
});

json.bufferViews = newBVs;

// Remap all accessor bufferView indices
for (const acc of (json.accessors || [])) {
  if (acc.bufferView != null && bvRemap[acc.bufferView] != null) {
    acc.bufferView = bvRemap[acc.bufferView];
  }
}

// Rebuild BIN (skip image bufferViews)
const parts  = [];
let   offset = 0;
newBVs.forEach(bv => {
  const slice = binData.slice(bv.byteOffset, bv.byteOffset + bv.byteLength);
  parts.push(slice);
  bv.byteOffset = offset;
  offset += bv.byteLength;
});
const newBin = Buffer.concat(parts);
json.buffers = [{ byteLength: newBin.length }];

// ── Write output GLB ──────────────────────────────────────────────────────────
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
fs.unlinkSync(tmpGlb);

const inMB  = (fs.statSync(absInput).size / 1024 / 1024).toFixed(1);
const outMB = (out.length / 1024 / 1024).toFixed(1);
const anims = (json.animations || []).map(a => `"${a.name}"`).join(', ');
const meshCount = (json.meshes || []).length;

console.log(`Done: ${inMB}MB FBX → ${outMB}MB GLB`);
console.log(`Meshes: ${meshCount}, Animations: ${anims}`);
console.log(`Output: ${absOutput}`);
