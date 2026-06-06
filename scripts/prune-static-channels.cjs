#!/usr/bin/env node
/**
 * prune-static-channels.cjs
 *
 * Removes animation channels where every keyframe has an identical value
 * (within a small epsilon). These "static" channels waste space because
 * the bone never actually moves in this clip — the rig just bakes its
 * rest-pose for every frame.
 *
 * Usage:
 *   node scripts/prune-static-channels.cjs input.glb output.glb
 *
 * When to apply (and when NOT to):
 *   ✅ Walk start / loop / end  — most of the 118-bone UE5 rig is unused
 *   ✅ Idle animation           — same story
 *   ❌ Limp animations          — preserve all bone channels; facial/upper-body
 *                                  grimace data will be added here later
 *   ❌ Hit animations           — fast transient motion; keep every channel
 *   ❌ Dying                    — full-body fall; keep every channel
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const [,, inputGlb, outputGlb] = process.argv;
if (!inputGlb || !outputGlb) {
  console.error('Usage: node scripts/prune-static-channels.cjs input.glb output.glb');
  process.exit(1);
}

const EPSILON = 1e-4;
const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

// ── Parse GLB ────────────────────────────────────────────────────────────────
const buf     = fs.readFileSync(path.resolve(inputGlb));
const jsonLen = buf.readUInt32LE(12);
const json    = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8').replace(/\0+$/, ''));
const binStart = 20 + jsonLen;
const binLen   = buf.readUInt32LE(binStart);
const binData  = buf.slice(binStart + 8, binStart + 8 + binLen);

// ── Read all values for one accessor ─────────────────────────────────────────
function readAccessor(accIdx) {
  const acc = json.accessors[accIdx];
  const bv  = json.bufferViews[acc.bufferView];
  const off = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const n   = COMP[acc.type] ?? 1;
  const out = [];
  for (let i = 0; i < acc.count; i++) {
    const f = [];
    for (let j = 0; j < n; j++) f.push(binData.readFloatLE(off + (i * n + j) * 4));
    out.push(f);
  }
  return out;
}

// A channel is static if every frame has the same value (within epsilon).
// Single-frame channels are kept — they may be intentional rest-pose overrides.
function isStatic(frames) {
  if (frames.length <= 1) return false;
  const ref = frames[0];
  return frames.every(f => f.every((v, k) => Math.abs(v - ref[k]) < EPSILON));
}

// ── Prune each animation ──────────────────────────────────────────────────────
let totalRemoved = 0;
let totalKept    = 0;

for (const anim of (json.animations || [])) {
  const usedSamplers = new Set();
  const keptChannels = [];

  for (const ch of (anim.channels || [])) {
    const sampler = anim.samplers[ch.sampler];
    const frames  = readAccessor(sampler.output);
    if (isStatic(frames)) {
      totalRemoved++;
    } else {
      usedSamplers.add(ch.sampler);
      keptChannels.push(ch);
      totalKept++;
    }
  }

  // Rebuild samplers array, remapping channel → sampler indices
  const oldSamplers = anim.samplers;
  const newSamplers = [];
  const samplerRemap = {};
  for (const oldIdx of [...usedSamplers].sort((a, b) => a - b)) {
    samplerRemap[oldIdx] = newSamplers.length;
    newSamplers.push(oldSamplers[oldIdx]);
  }

  anim.channels = keptChannels.map(ch => ({ ...ch, sampler: samplerRemap[ch.sampler] }));
  anim.samplers = newSamplers;
}

// ── Rebuild accessors (keep only those still referenced by animations) ────────
const usedAccessors = new Set();
for (const anim of (json.animations || [])) {
  for (const s of (anim.samplers || [])) {
    usedAccessors.add(s.input);
    usedAccessors.add(s.output);
  }
}

const oldAccs  = json.accessors || [];
const newAccs  = oldAccs.filter((_, i) => usedAccessors.has(i));
const accRemap = {};
oldAccs.forEach((a, i) => {
  const ni = newAccs.indexOf(a);
  if (ni >= 0) accRemap[i] = ni;
});
json.accessors = newAccs;

for (const anim of (json.animations || [])) {
  for (const s of (anim.samplers || [])) {
    s.input  = accRemap[s.input]  ?? s.input;
    s.output = accRemap[s.output] ?? s.output;
  }
}

// ── Rebuild bufferViews ───────────────────────────────────────────────────────
const usedBVs = new Set(newAccs.map(a => a.bufferView).filter(v => v != null));
const oldBVs  = json.bufferViews || [];
const newBVs  = oldBVs.filter((_, i) => usedBVs.has(i));
const bvRemap = {};
oldBVs.forEach((bv, i) => {
  const ni = newBVs.indexOf(bv);
  if (ni >= 0) bvRemap[i] = ni;
});
json.bufferViews = newBVs;
newAccs.forEach(a => {
  if (a.bufferView != null) a.bufferView = bvRemap[a.bufferView] ?? a.bufferView;
});

// ── Rebuild BIN (only the slices that survived) ───────────────────────────────
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

// ── Write GLB ─────────────────────────────────────────────────────────────────
const jsonStr    = JSON.stringify(json);
const jsonPadded = jsonStr + ' '.repeat((4 - (jsonStr.length % 4)) % 4);
const binPadded  = Buffer.alloc(Math.ceil(newBin.length / 4) * 4);
newBin.copy(binPadded);

const totalLen = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
const out = Buffer.alloc(totalLen);
let p = 0;
out.writeUInt32LE(0x46546C67, p); p += 4;  // magic: glTF
out.writeUInt32LE(2,          p); p += 4;  // version
out.writeUInt32LE(totalLen,   p); p += 4;
out.writeUInt32LE(jsonPadded.length, p); p += 4;
out.writeUInt32LE(0x4E4F534A, p); p += 4;  // JSON chunk type
Buffer.from(jsonPadded).copy(out, p); p += jsonPadded.length;
out.writeUInt32LE(binPadded.length, p); p += 4;
out.writeUInt32LE(0x004E4942, p); p += 4;  // BIN chunk type
binPadded.copy(out, p);

fs.writeFileSync(path.resolve(outputGlb), out);

const inMB  = (fs.statSync(path.resolve(inputGlb)).size / 1024 / 1024).toFixed(1);
const outMB = (out.length / 1024 / 1024).toFixed(1);
const pct   = (100 * (1 - out.length / fs.statSync(path.resolve(inputGlb)).size)).toFixed(1);

console.log(`Pruned: ${inMB}MB → ${outMB}MB  (−${pct}%)`);
console.log(`Channels: ${totalKept} kept, ${totalRemoved} removed`);
console.log(`Output: ${path.resolve(outputGlb)}`);
