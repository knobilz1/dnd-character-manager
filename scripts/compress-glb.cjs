#!/usr/bin/env node
/**
 * compress-glb.cjs <input.glb> [output.glb]
 *
 * Compresses an animation GLB using gltf-transform. Designed for the merged
 * *_Anims.glb files, which are pure skeletal animation tracks (no mesh, no skin)
 * exported at 60fps full-float32 — the single biggest source of bundle bloat.
 *
 * The recipe is lossless-to-imperceptible:
 *   1. resample()  — collapse redundant keyframes (a constant (1,1,1) scale track
 *                    baked over 287 frames becomes ~2 keyframes). Tolerance is
 *                    tiny, so curves that actually move are preserved. THIS is the
 *                    big win — most of our scale + half our rotation tracks are
 *                    constant.
 *   2. prune()     — drop accessors/nodes left unreferenced after resampling.
 *                    SAFE on anims files (they carry no mesh/skin/armor sockets —
 *                    those live only in the *_Idle.glb).
 *   3. dedup()     — merge identical accessors across the 9 merged clips.
 *   4. meshopt()   — EXT_meshopt_compression: quantize + entropy-code the track
 *                    buffers. Requires MeshoptDecoder at runtime (registered in
 *                    CharacterViewport). Lossless decode.
 *
 * NOTE: do NOT run this on the *_Idle.glb files. Those hold the mesh, skin, and
 * the named armor socket bones (head, spine_03, hand_l, …). prune()/meshopt() on
 * the skeleton risks dropping an unused-but-intended socket bone and breaking the
 * future armor system. Idle GLBs are small (2–6MB) and stay untouched.
 */
'use strict';

const path = require('path');

async function main() {
  const input  = process.argv[2];
  const output = process.argv[3] || input;
  if (!input) {
    console.error('Usage: compress-glb.cjs <input.glb> [output.glb]');
    process.exit(1);
  }

  const { NodeIO } = require('@gltf-transform/core');
  const { resample, prune, dedup, meshopt } = require('@gltf-transform/functions');
  const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
  const { MeshoptEncoder, MeshoptDecoder } = require('meshoptimizer');

  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;

  const fs = require('fs');
  const beforeBytes = fs.statSync(input).size;

  // EXT_meshopt_compression needs the encoder/decoder registered as IO
  // dependencies — the encode happens at write time, not in the transform.
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.encoder': MeshoptEncoder,
      'meshopt.decoder': MeshoptDecoder,
    });

  const doc = await io.read(input);

  await doc.transform(
    resample({ tolerance: 1e-4 }),
    prune(),
    dedup(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );

  await io.write(output, doc);

  const afterBytes = fs.statSync(output).size;
  const pct = (100 * (1 - afterBytes / beforeBytes)).toFixed(1);
  console.log(
    `  compressed ${path.basename(input)}: ` +
    `${(beforeBytes / 1048576).toFixed(1)}MB → ${(afterBytes / 1048576).toFixed(1)}MB ` +
    `(−${pct}%)`,
  );
}

main().catch((err) => {
  console.error('compress-glb failed:', err);
  process.exit(1);
});
