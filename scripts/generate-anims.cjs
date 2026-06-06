#!/usr/bin/env node
/**
 * generate-anims.cjs
 * Generates the merged animation GLBs for each gender.
 * Run automatically via "prebuild" npm hook before every Vite build.
 *
 * Individual animation GLBs are committed to git; merged files are gitignored
 * (they exceed GitHub's 100MB file limit). This script regenerates them.
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');

const root   = path.join(__dirname, '..');
const models = path.join(root, 'public', 'models');
const merge  = path.join(__dirname, 'merge-animations-glb.cjs');
const convertIdle = path.join(__dirname, 'convert-idle-to-glb.cjs');
const prune  = path.join(__dirname, 'prune-static-channels.cjs');

function run(output, inputs) {
  console.log(`\nGenerating ${path.basename(output)}…`);
  execFileSync('node', [merge, output, ...inputs], { stdio: 'inherit' });
}

/** Convert an idle FBX → compact GLB (mesh-stripped textures, static channels pruned). */
function buildIdleGlb(inputFbx, outputGlb) {
  console.log(`\nBuilding idle GLB: ${path.basename(outputGlb)}…`);
  const tmp = outputGlb.replace(/\.glb$/, '_raw.glb');
  execFileSync('node', [convertIdle, inputFbx, tmp], { stdio: 'inherit' });
  execFileSync('node', [prune, tmp, outputGlb], { stdio: 'inherit' });
  require('fs').unlinkSync(tmp);
}

// ── Idle GLBs (FBX → GLB, static channels pruned) ────────────────────────────
buildIdleGlb(path.join(models, 'Human_Idle_Textured.fbx'),        path.join(models, 'Human_Male_Idle.glb'));
buildIdleGlb(path.join(models, 'Human_Female_Idle_Textured.fbx'), path.join(models, 'Human_Female_Idle.glb'));
buildIdleGlb(path.join(models, 'Elf_Male_Idle_Textured.fbx'),     path.join(models, 'Elf_Male_Idle.glb'));

// ── Merged animation GLBs ─────────────────────────────────────────────────────
run(path.join(models, 'Human_Female_Anims.glb'), [
  path.join(models, 'Human_Female_Limp_Lv1.glb'),
  path.join(models, 'Human_Female_Limp_Lv2.glb'),
  path.join(models, 'Human_Female_Limp_Lv3.glb'),
  path.join(models, 'Human_Female_Dying.glb'),
  path.join(models, 'Human_Female_Hit_Hard.glb'),
  path.join(models, 'Human_Female_Hit_Extreme.glb'),
  path.join(models, 'Human_Female_Walk_Start.glb'),
  path.join(models, 'Human_Female_Walk_Loop.glb'),
  path.join(models, 'Human_Female_Walk_End.glb'),
]);

run(path.join(models, 'Human_Male_Anims.glb'), [
  path.join(models, 'Human_Male_Limp_Lv1.glb'),
  path.join(models, 'Human_Male_Limp_Lv2.glb'),
  path.join(models, 'Human_Male_Limp_Lv3.glb'),
  path.join(models, 'Human_Male_Dying.glb'),
  path.join(models, 'Human_Male_Walk_Start.glb'),
  path.join(models, 'Human_Male_Walk_Loop.glb'),
  path.join(models, 'Human_Male_Walk_End.glb'),
  path.join(models, 'Human_Hit_Light.glb'),
  path.join(models, 'Human_White_Punched.glb'),
]);

run(path.join(models, 'Elf_Male_Anims.glb'), [
  path.join(models, 'Elf_Male_Limp_Lv1.glb'),
  path.join(models, 'Elf_Male_Limp_Lv2.glb'),
  path.join(models, 'Elf_Male_Limp_Lv3.glb'),
  path.join(models, 'Elf_Male_Dying.glb'),
  path.join(models, 'Elf_Male_Hit_Hard.glb'),
  path.join(models, 'Elf_Male_Hit_Extreme.glb'),
  path.join(models, 'Elf_Male_Walk_Start.glb'),
  path.join(models, 'Elf_Male_Walk_Loop.glb'),
  path.join(models, 'Elf_Male_Walk_End.glb'),
]);

console.log('\nDone — merged animation GLBs ready.\n');
