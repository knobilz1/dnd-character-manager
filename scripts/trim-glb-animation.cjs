#!/usr/bin/env node
/**
 * trim-glb-animation.cjs
 * Trims all animation keyframes in a GLB to a given max time (in seconds).
 * Useful for removing unwanted tails (e.g. a fall at the end of a limp animation).
 *
 * Usage:
 *   node scripts/trim-glb-animation.cjs input.glb output.glb <maxSeconds>
 *
 * Example:
 *   node scripts/trim-glb-animation.cjs Human_Female_Limp_Lv3_raw.glb Human_Female_Limp_Lv3.glb 7.5
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const [,, inputPath, outputPath, maxSecondsStr] = process.argv;
if (!inputPath || !outputPath || !maxSecondsStr) {
  console.error('Usage: node trim-glb-animation.cjs input.glb output.glb <maxSeconds>');
  process.exit(1);
}
const MAX_T = parseFloat(maxSecondsStr);
if (isNaN(MAX_T) || MAX_T <= 0) { console.error('maxSeconds must be a positive number'); process.exit(1); }

// ── Read GLB ────────────────────────────────────────────────────────────────
const buf = fs.readFileSync(inputPath);
const magic   = buf.readUInt32LE(0);
if (magic !== 0x46546C67) { console.error('Not a GLB file'); process.exit(1); }

const jsonLen  = buf.readUInt32LE(12);
const jsonChunk = buf.slice(20, 20 + jsonLen);
const json = JSON.parse(jsonChunk.toString('utf8'));

const binChunkOffset = 20 + jsonLen;
const binLen = buf.readUInt32LE(binChunkOffset);
// original BIN data (mutable copy)
let binData = Buffer.from(buf.slice(binChunkOffset + 8, binChunkOffset + 8 + binLen));

// ── For each animation, trim keyframes > MAX_T ───────────────────────────────
for (const anim of (json.animations ?? [])) {
  // We need to process in sampler order and rebuild the BIN for each affected accessor.
  // Strategy: re-pack each sampler's input (time) and output (values) arrays.

  for (const sampler of (anim.samplers ?? [])) {
    const tAcc = json.accessors[sampler.input];
    const vAcc = json.accessors[sampler.output];
    const tBv  = json.bufferViews[tAcc.bufferView];
    const vBv  = json.bufferViews[vAcc.bufferView];

    const tOffset = tBv.byteOffset + (tAcc.byteOffset ?? 0);
    const vOffset = vBv.byteOffset + (vAcc.byteOffset ?? 0);

    const componentCount = vAcc.type === 'SCALAR' ? 1
                         : vAcc.type === 'VEC2'   ? 2
                         : vAcc.type === 'VEC3'   ? 3
                         : vAcc.type === 'VEC4'   ? 4 : 4;

    // Read all time values and find how many are ≤ MAX_T
    let keepCount = 0;
    for (let i = 0; i < tAcc.count; i++) {
      const t = binData.readFloatLE(tOffset + i * 4);
      if (t <= MAX_T) keepCount++;
      else break;
    }

    if (keepCount === tAcc.count) continue; // nothing to trim for this sampler
    if (keepCount === 0) keepCount = 1;     // always keep at least 1 frame

    // Build new time buffer
    const newTBytes = keepCount * 4;
    const newTBuf = Buffer.alloc(newTBytes);
    binData.copy(newTBuf, 0, tOffset, tOffset + newTBytes);

    // Build new value buffer
    const valStride = componentCount * 4;
    const newVBytes = keepCount * valStride;
    const newVBuf = Buffer.alloc(newVBytes);
    binData.copy(newVBuf, 0, vOffset, vOffset + newVBytes);

    // Update accessor counts and min/max
    const oldTCount = tAcc.count;
    tAcc.count = keepCount;
    vAcc.count = keepCount;

    // Remove min/max from time accessor (will recompute below)
    delete tAcc.min; delete tAcc.max;
    // Recompute min/max for time accessor
    let minT = Infinity, maxT = -Infinity;
    for (let i = 0; i < keepCount; i++) {
      const t = newTBuf.readFloatLE(i * 4);
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    }
    tAcc.min = [minT]; tAcc.max = [maxT];

    // Patch the BIN buffer: overwrite the old region with new data
    // (same offset, potentially shorter — we'll compact at the end)
    newTBuf.copy(binData, tOffset);
    newVBuf.copy(binData, vOffset);

    // Update bufferView byteLengths
    tBv.byteLength = newTBytes;
    vBv.byteLength = newVBytes;
  }
}

// ── Compact the BIN buffer ───────────────────────────────────────────────────
// Re-pack all bufferViews sequentially to eliminate gaps from trimmed data.
// Sort bufferViews by their current byteOffset so we process them in order.
const sortedBVs = json.bufferViews
  .map((bv, i) => ({ bv, i }))
  .sort((a, b) => a.bv.byteOffset - b.bv.byteOffset);

let writePos = 0;
const newBin = Buffer.alloc(binLen); // upper bound; we'll slice at end

for (const { bv } of sortedBVs) {
  if (bv.byteLength === 0) continue;
  // Align to 4 bytes
  while (writePos % 4 !== 0) writePos++;
  binData.copy(newBin, writePos, bv.byteOffset, bv.byteOffset + bv.byteLength);
  bv.byteOffset = writePos;
  writePos += bv.byteLength;
}
// Align final size
while (writePos % 4 !== 0) writePos++;
const compactBin = newBin.slice(0, writePos);

// Update buffer.byteLength
if (json.buffers?.[0]) json.buffers[0].byteLength = compactBin.byteLength;

// ── Write new GLB ────────────────────────────────────────────────────────────
const newJsonStr  = JSON.stringify(json);
let   jsonPadded  = newJsonStr;
while (jsonPadded.length % 4 !== 0) jsonPadded += ' ';
const jsonBuf = Buffer.from(jsonPadded, 'utf8');

const totalLen = 12 + 8 + jsonBuf.length + 8 + compactBin.length;
const out = Buffer.alloc(totalLen);
let p = 0;
out.writeUInt32LE(0x46546C67, p); p += 4; // magic
out.writeUInt32LE(2,           p); p += 4; // version
out.writeUInt32LE(totalLen,    p); p += 4; // total length
// JSON chunk
out.writeUInt32LE(jsonBuf.length,    p); p += 4;
out.writeUInt32LE(0x4E4F534A,        p); p += 4;
jsonBuf.copy(out, p); p += jsonBuf.length;
// BIN chunk
out.writeUInt32LE(compactBin.length, p); p += 4;
out.writeUInt32LE(0x004E4942,        p); p += 4;
compactBin.copy(out, p);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, out);

const origMB  = (buf.length        / 1024 / 1024).toFixed(1);
const newMB   = (out.length        / 1024 / 1024).toFixed(1);
console.log(`Trimmed: ${origMB}MB → ${newMB}MB (cut at ${MAX_T}s)`);
console.log(`Output: ${outputPath}`);
