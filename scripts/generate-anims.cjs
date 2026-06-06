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

function run(output, inputs) {
  console.log(`\nGenerating ${path.basename(output)}…`);
  execFileSync('node', [merge, output, ...inputs], { stdio: 'inherit' });
}

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

console.log('\nDone — merged animation GLBs ready.\n');
