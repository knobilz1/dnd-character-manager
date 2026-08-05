#!/usr/bin/env node
/**
 * optimize-prop-glb.cjs <input.glb> [output.glb] [textureSize]
 *
 * Shrinks a rigid bone-socket prop (armor piece, hair style) for shipping.
 *
 * Props are NOT animation files and NOT idle bodies — they are static meshes with
 * no skeleton, no skin, and no named socket bones. So the standing "never compress
 * *_Idle.glb" rule in compress-glb.cjs does NOT apply here: there is no socket bone
 * for prune()/meshopt() to drop. BoneAttachment clones the prop and parents it to a
 * bone on the CHARACTER's skeleton; nothing inside the prop file is load-bearing.
 *
 * Measured on a Tripo HD export at 1K texture / 30k polycount:
 *   geometry 0.72MB, textures 4.20MB (85% of the file).
 * So textures — not triangles — are what actually costs. Polycount is already
 * controlled at generation time (Tripo's Geometry & Texture → Polycount); this
 * script exists to deal with the three PBR maps Tripo ships as fat PNGs.
 *
 * Recipe:
 *   1. textureCompress() — PNG → WebP and downscale. THE win. Props render small
 *      on screen (a pauldron is a few dozen pixels), so 512 is plenty; 1024 is the
 *      conservative default. WebP in glTF is EXT_texture_webp, which three.js
 *      GLTFLoader supports wherever the browser decodes WebP (WebView2 and WKWebView
 *      both do).
 *   2. prune() + dedup() — drop unreferenced accessors, merge duplicates.
 *   3. meshopt() — quantize + entropy-code geometry. Requires MeshoptDecoder at
 *      runtime, which CharacterViewport already registers on EVERY GLTFLoader via
 *      `withMeshopt` — including the BoneAttachment loader. So compressed props load
 *      with no code change.
 *
 * Usage:
 *   node scripts/optimize-prop-glb.cjs in.glb out.glb        # 1024px textures
 *   node scripts/optimize-prop-glb.cjs in.glb out.glb 512    # smaller
 */
'use strict';

const path = require('path');
const fs = require('fs');

async function main() {
  const input = process.argv[2];
  const output = process.argv[3] || input;
  const texSize = parseInt(process.argv[4] || '1024', 10);
  if (!input) {
    console.error('Usage: optimize-prop-glb.cjs <input.glb> [output.glb] [textureSize]');
    process.exit(1);
  }

  const { NodeIO } = require('@gltf-transform/core');
  const { textureCompress, prune, dedup, meshopt } = require('@gltf-transform/functions');
  const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
  const { MeshoptEncoder, MeshoptDecoder } = require('meshoptimizer');
  const sharp = require('sharp');

  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;

  const beforeBytes = fs.statSync(input).size;

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.encoder': MeshoptEncoder,
      'meshopt.decoder': MeshoptDecoder,
    });

  const doc = await io.read(input);

  await doc.transform(
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      resize: [texSize, texSize],
      // Downscale only — never upscale a map that is already smaller.
      resizeFilter: 'lanczos3',
      quality: 85,
    }),
    prune(),
    dedup(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );

  await io.write(output, doc);

  const afterBytes = fs.statSync(output).size;
  const pct = (100 * (1 - afterBytes / beforeBytes)).toFixed(1);
  console.log(
    `  optimized ${path.basename(input)}: ` +
    `${(beforeBytes / 1048576).toFixed(2)}MB → ${(afterBytes / 1048576).toFixed(2)}MB ` +
    `(−${pct}%)  [textures ${texSize}px]`,
  );
}

main().catch((err) => {
  console.error('optimize-prop-glb failed:', err);
  process.exit(1);
});
