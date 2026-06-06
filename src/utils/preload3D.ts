/**
 * preload3D.ts
 *
 * Kick off background parsing of all 3D assets as soon as the app boots.
 * Import this file once (side-effect import) in main.tsx so assets are
 * cached long before the user navigates to a character sheet or creator.
 *
 * Idle GLBs are ~1MB each — parse time with GLTFLoader is <100ms.
 * Texture PNGs are ~1–2MB each.
 * Merged anim GLBs are ~78MB — these stream and cache in the background.
 */
import { useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { ALL_ASSET_SETS } from '../pages/sheet/CharacterViewport';

for (const assets of ALL_ASSET_SETS) {
  useLoader.preload(GLTFLoader, assets.idle);
  useLoader.preload(THREE.TextureLoader, assets.diffuse);
}
