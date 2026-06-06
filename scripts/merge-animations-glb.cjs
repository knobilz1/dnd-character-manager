#!/usr/bin/env node
/**
 * merge-animations-glb.cjs
 * Merges multiple animation-only GLBs (same skeleton) into a single GLB.
 * The node/scene structure is taken from the first input file.
 * Calibration clips ("0_Open A_UE5") are filtered out.
 *
 * Usage:
 *   node scripts/merge-animations-glb.cjs output.glb input1.glb input2.glb ...
 *
 * Example:
 *   node scripts/merge-animations-glb.cjs public/models/Human_Male_Anims.glb \
 *     public/models/Human_Male_Limp_Lv1.glb public/models/Human_Male_Limp_Lv2.glb ...
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const [,, outputPath, ...inputPaths] = process.argv;
if (!outputPath || inputPaths.length < 1) {
  console.error('Usage: node merge-animations-glb.cjs output.glb input1.glb [input2.glb ...]');
  process.exit(1);
}

const isCalibration = name => /open\s*a|_ue5/i.test(name ?? '');

function readGLB(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.readUInt32LE(0) !== 0x46546C67) throw new Error(`Not a GLB: ${filePath}`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen;
  let bin = Buffer.alloc(0);
  if (buf.length > binStart + 8) {
    const binLen = buf.readUInt32LE(binStart);
    bin = Buffer.from(buf.slice(binStart + 8, binStart + 8 + binLen));
  }
  return { json, bin };
}

const files = inputPaths.map(p => ({ path: p, ...readGLB(p) }));
console.log(`Merging ${files.length} GLB(s)…`);

// Take skeleton/scene structure from file[0]
const base = files[0].json;
// Strip skin/mesh references from every node. These merged GLBs are
// animation-ONLY (the mesh + skin live in the idle GLB), so a leftover
// node.skin pointing at a skins array we don't emit makes GLTFLoader call
// loadSkin → json.skins[i] is undefined → "Cannot read properties of
// undefined (reading '0')" → the whole anims GLB fails to load → the 3D
// viewport throws → grey character sheet. We only consume the AnimationClips
// from this file, and TRS animation tracks target nodes by index without
// needing skin/mesh, so dropping these is safe.
const cleanNodes = (base.nodes ?? []).map((n) => {
  const { skin, mesh, ...rest } = n; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
});
const result = {
  asset: base.asset ?? { version: '2.0' },
  scene: base.scene ?? 0,
  scenes: base.scenes ?? [{ nodes: [] }],
  nodes: cleanNodes,
  accessors: [],
  bufferViews: [],
  animations: [],
  buffers: [{ byteLength: 0 }],
};

const binParts = [];

for (const file of files) {
  const { json, bin } = file;
  const bvOffset  = result.bufferViews.length;
  const accOffset = result.accessors.length;
  const binOffset = binParts.reduce((s, b) => s + b.length, 0);

  // Merge bufferViews (shift byteOffset into combined BIN)
  for (const bv of (json.bufferViews ?? [])) {
    result.bufferViews.push({
      ...bv,
      buffer: 0,
      byteOffset: (bv.byteOffset ?? 0) + binOffset,
    });
  }

  // Merge accessors (shift bufferView index)
  for (const acc of (json.accessors ?? [])) {
    result.accessors.push({
      ...acc,
      bufferView: (acc.bufferView ?? 0) + bvOffset,
    });
  }

  // Merge animations, filtering calibration clips
  const realAnims = (json.animations ?? []).filter(a => !isCalibration(a.name));
  for (const anim of realAnims) {
    result.animations.push({
      ...anim,
      samplers: (anim.samplers ?? []).map(s => ({
        ...s,
        input:  s.input  + accOffset,
        output: s.output + accOffset,
      })),
      // channels reference sampler indices within this animation — no remapping needed
    });
  }

  // Pad BIN to 4-byte boundary before concatenating
  const padded = bin.length % 4 === 0
    ? bin
    : Buffer.concat([bin, Buffer.alloc(4 - (bin.length % 4))]);
  binParts.push(padded);

  const names = realAnims.map(a => `"${a.name}"`).join(', ');
  console.log(`  ${path.basename(file.path)}: ${names || '(no real clips)'}`);
}

// Combine BIN
const combinedBin = Buffer.concat(binParts);
result.buffers[0].byteLength = combinedBin.length;

// Write GLB
const jsonStr    = JSON.stringify(result);
let   jsonPadded = jsonStr;
while (jsonPadded.length % 4 !== 0) jsonPadded += ' ';
const jsonBuf  = Buffer.from(jsonPadded, 'utf8');
const totalLen = 12 + 8 + jsonBuf.length + 8 + combinedBin.length;
const out      = Buffer.alloc(totalLen);
let p = 0;
out.writeUInt32LE(0x46546C67, p); p += 4; // magic
out.writeUInt32LE(2,           p); p += 4; // version
out.writeUInt32LE(totalLen,    p); p += 4;
out.writeUInt32LE(jsonBuf.length,    p); p += 4;
out.writeUInt32LE(0x4E4F534A,        p); p += 4; // JSON chunk
jsonBuf.copy(out, p); p += jsonBuf.length;
out.writeUInt32LE(combinedBin.length, p); p += 4;
out.writeUInt32LE(0x004E4942,         p); p += 4; // BIN chunk
combinedBin.copy(out, p);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, out);

const inMB  = (inputPaths.reduce((s, f) => s + fs.statSync(f).size, 0) / 1024 / 1024).toFixed(1);
const outMB = (out.length / 1024 / 1024).toFixed(1);
console.log(`\nMerged ${files.length} files (${inMB} MB total) → ${outMB} MB`);
console.log(`Output: ${outputPath}`);
console.log(`\nAnimations in merged file:`);
result.animations.forEach((a, i) => console.log(`  [${i}] "${a.name}"`));
