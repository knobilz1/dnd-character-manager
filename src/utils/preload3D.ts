/**
 * preload3D.ts
 *
 * Kick off background parsing of all 3D assets as soon as the app boots.
 * Import this file once (side-effect import) in main.tsx so assets are
 * cached long before the user navigates to a character sheet or creator.
 *
 * Idle GLBs are ~2–6MB each — parse time with GLTFLoader is <100ms.
 * Texture PNGs are ~1–2MB each.
 * Merged anim GLBs are meshopt-compressed (~1–3MB) and stream in on demand.
 *
 * In production Tauri builds the model URLs resolve asynchronously (side-loaded
 * resources), so we wait for initModelUrls() before warming the cache. The cache
 * keys (URL + withMeshopt loader) match CharacterViewport's useLoader calls so
 * the preload actually warms the same entries.
 */
import { useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { ALL_ASSET_SETS, withMeshopt } from '../pages/sheet/CharacterViewport';
import { modelUrl, initModelUrls, NEEDS_TAURI_MODEL_INIT } from './modelUrl';

async function preloadAll() {
  if (NEEDS_TAURI_MODEL_INIT) await initModelUrls();
  for (const assets of ALL_ASSET_SETS) {
    useLoader.preload(GLTFLoader, modelUrl(assets.idle), withMeshopt);
    useLoader.preload(THREE.TextureLoader, modelUrl(assets.diffuse));
  }
}

void preloadAll();
