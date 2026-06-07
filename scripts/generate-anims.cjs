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
const compress = path.join(__dirname, 'compress-glb.cjs');

function run(output, inputs) {
  console.log(`\nGenerating ${path.basename(output)}…`);
  execFileSync('node', [merge, output, ...inputs], { stdio: 'inherit' });
  // Compress the merged anims GLB in-place: resample (collapse constant tracks)
  // + meshopt encode. ~78–113MB → ~1.5MB, no visible quality loss. Decoded at
  // runtime via MeshoptDecoder (registered in CharacterViewport). Mesh-free
  // anims only — never run on *_Idle.glb (holds the skeleton + armor sockets).
  execFileSync('node', [compress, output], { stdio: 'inherit' });
}

/** Check whether assimp CLI is available. */
function assimpAvailable() {
  try { execFileSync('assimp', ['version'], { stdio: 'pipe' }); return true; } catch { return false; }
}

/** Convert an idle FBX → compact GLB (mesh-stripped textures, static channels pruned).
 *  Skipped automatically if assimp is not installed (CI uses pre-built committed GLBs). */
function buildIdleGlb(inputFbx, outputGlb) {
  if (!assimpAvailable()) {
    console.log(`  Skipping ${path.basename(outputGlb)} — assimp not found (using committed GLB)`);
    return;
  }
  console.log(`\nBuilding idle GLB: ${path.basename(outputGlb)}…`);
  const tmp = outputGlb.replace(/\.glb$/, '_raw.glb');
  execFileSync('node', [convertIdle, inputFbx, tmp], { stdio: 'inherit' });
  execFileSync('node', [prune, tmp, outputGlb], { stdio: 'inherit' });
  require('fs').unlinkSync(tmp);
}

// ── Idle GLBs (FBX → GLB, static channels pruned) ────────────────────────────
// Only entries where the source FBX is committed to the repo.
// All other idle GLBs (Elf Female, Dwarf Male, Half Orc, Halfling, Tiefling, …)
// are committed as pre-built GLBs and skipped here — CI uses them directly.
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

run(path.join(models, 'Elf_Female_Anims.glb'), [
  path.join(models, 'Elf_Female_Limp_Lv1.glb'),
  path.join(models, 'Elf_Female_Limp_Lv2.glb'),
  path.join(models, 'Elf_Female_Limp_Lv3.glb'),
  path.join(models, 'Elf_Female_Dying.glb'),
  path.join(models, 'Elf_Female_Hit_Hard.glb'),
  path.join(models, 'Elf_Female_Hit_Extreme.glb'),
  path.join(models, 'Elf_Female_Walk_Start.glb'),
  path.join(models, 'Elf_Female_Walk_Loop.glb'),
  path.join(models, 'Elf_Female_Walk_End.glb'),
]);

run(path.join(models, 'Dwarf_Male_Anims.glb'), [
  path.join(models, 'Dwarf_Male_Limp_Lv1.glb'),
  path.join(models, 'Dwarf_Male_Limp_Lv2.glb'),
  path.join(models, 'Dwarf_Male_Limp_Lv3.glb'),
  path.join(models, 'Dwarf_Male_Dying.glb'),
  path.join(models, 'Dwarf_Male_Hit_Hard.glb'),
  path.join(models, 'Dwarf_Male_Hit_Extreme.glb'),
  path.join(models, 'Dwarf_Male_Walk_Start.glb'),
  path.join(models, 'Dwarf_Male_Walk_Loop.glb'),
  path.join(models, 'Dwarf_Male_Walk_End.glb'),
]);

run(path.join(models, 'Dwarf_Female_Anims.glb'), [
  path.join(models, 'Dwarf_Female_Limp_Lv1.glb'),
  path.join(models, 'Dwarf_Female_Limp_Lv2.glb'),
  path.join(models, 'Dwarf_Female_Limp_Lv3.glb'),
  path.join(models, 'Dwarf_Female_Dying.glb'),
  path.join(models, 'Dwarf_Female_Hit_Hard.glb'),
  path.join(models, 'Dwarf_Female_Hit_Extreme.glb'),
  path.join(models, 'Dwarf_Female_Walk_Start.glb'),
  path.join(models, 'Dwarf_Female_Walk_Loop.glb'),
  path.join(models, 'Dwarf_Female_Walk_End.glb'),
]);

run(path.join(models, 'Half_Orc_Male_Anims.glb'), [
  path.join(models, 'Half_Orc_Male_Limp_Lv1.glb'),
  path.join(models, 'Half_Orc_Male_Limp_Lv2.glb'),
  path.join(models, 'Half_Orc_Male_Limp_Lv3.glb'),
  path.join(models, 'Half_Orc_Male_Dying.glb'),
  path.join(models, 'Half_Orc_Male_Hit_Hard.glb'),
  path.join(models, 'Half_Orc_Male_Hit_Extreme.glb'),
  path.join(models, 'Half_Orc_Male_Walk_Start.glb'),
  path.join(models, 'Half_Orc_Male_Walk_Loop.glb'),
  path.join(models, 'Half_Orc_Male_Walk_End.glb'),
]);

run(path.join(models, 'Half_Orc_Female_Anims.glb'), [
  path.join(models, 'Half_Orc_Female_Limp_Lv1.glb'),
  path.join(models, 'Half_Orc_Female_Limp_Lv2.glb'),
  path.join(models, 'Half_Orc_Female_Limp_Lv3.glb'),
  path.join(models, 'Half_Orc_Female_Dying.glb'),
  path.join(models, 'Half_Orc_Female_Hit_Hard.glb'),
  path.join(models, 'Half_Orc_Female_Hit_Extreme.glb'),
  path.join(models, 'Half_Orc_Female_Walk_Start.glb'),
  path.join(models, 'Half_Orc_Female_Walk_Loop.glb'),
  path.join(models, 'Half_Orc_Female_Walk_End.glb'),
]);

// Halfling + Tiefling: no dedicated animation clips yet — they borrow human anims at runtime.
// Merged GLBs will be added here once Nabil uploads their animation sets.

console.log('\nDone — merged animation GLBs ready.\n');
