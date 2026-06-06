import * as React from 'react';
import { Canvas, useLoader, useFrame } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';

// ── Animation state ──────────────────────────────────────────────────────────
export type AnimationState =
  | 'idle'        // full HP   — normal idle / walk cycle
  | 'limp-lv1'   // ≤ 75 % HP — slight limp  (looping)
  | 'limp-lv2'   // ≤ 50 % HP — bad limp     (looping)
  | 'limp-lv3'   // ≤ 25 % HP — severe limp  (looping)
  | 'hurt-light' // damage reaction < 25 % max HP in one hit (transient)
  | 'hurt-heavy' // damage reaction ≥ 25 % max HP in one hit (transient)
  | 'down';      // 0 HP / Unconscious — dying animation, holds last frame

/** Returns true for looping "base" states (as opposed to transient reactions). */
function isBaseState(s: AnimationState) {
  return s === 'idle' || s === 'limp-lv1' || s === 'limp-lv2' || s === 'limp-lv3';
}

export type CharacterGender = 'male' | 'female' | 'nonbinary';

interface CharacterViewportProps {
  animationState?: AnimationState;
  gender?: CharacterGender;
  className?: string;
  /** Minimal mode: only loads the idle FBX (no merged anims GLB). Use in creator. */
  minimal?: boolean;
}

// ── Asset sets ───────────────────────────────────────────────────────────────
const MALE_ASSETS = {
  idle:    '/models/Human_Idle_Textured.fbx',
  anims:   '/models/Human_Male_Anims.glb',
  diffuse: '/models/tripo_mat_a9e3ea13_Diffuse.png',
};
const FEMALE_ASSETS = {
  idle:    '/models/Human_Female_Idle_Textured.fbx',
  anims:   '/models/Human_Female_Anims.glb',
  diffuse: '/models/tripo_mat_db0ac1f6_Diffuse.png',
};

// ── Clip name → action key (same for both genders) ──────────────────────────
const CLIP_TO_KEY: Record<string, string> = {
  '14-limping-walk-1':           'limp-lv1',
  'lame-walk-m':                 'limp-lv2',
  'fall-down-m':                 'limp-lv3',
  'sos-lie-down-m':              'down',
  'hit-heavy-460344':            'hurt-light',
  'being-heavily-attacked':      'hurt-heavy',
  'walk-relaxed-1start-379003':  'walk-start',
  'walk-relaxed-2loop-378986':   'idle2',
  'walk-relaxed-3end-378968':    'walk-end',
};

// ── Shared helpers ───────────────────────────────────────────────────────────
const realClip = (clips: THREE.AnimationClip[]) =>
  clips.find((a) => !/open a|_ue5/i.test(a.name)) ?? clips[clips.length - 1] ?? clips[0];

function applyTexture(fbx: THREE.Group, tex: THREE.Texture) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, metalness: 0.0 });
  fbx.traverse((o) => {
    o.frustumCulled = false;
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    mesh.material      = mat;
  });
}

// Kick off background loads for both genders as soon as this module is imported.
// By the time the user hits the gender toggle in the creator, assets are cached.
useLoader.preload(FBXLoader, MALE_ASSETS.idle);
useLoader.preload(FBXLoader, FEMALE_ASSETS.idle);
useLoader.preload(THREE.TextureLoader, MALE_ASSETS.diffuse);
useLoader.preload(THREE.TextureLoader, FEMALE_ASSETS.diffuse);

// ── Minimal character model (creator only — idle FBX + texture, no anims GLB) ─
function CharacterModelMinimal({ assets }: { assets: typeof MALE_ASSETS }) {
  const idle0      = useLoader(FBXLoader, assets.idle);
  const diffuseTex = useLoader(THREE.TextureLoader, assets.diffuse);

  React.useEffect(() => { applyTexture(idle0, diffuseTex); }, [idle0, diffuseTex]);

  const mixer = React.useMemo(() => {
    const m = new THREE.AnimationMixer(idle0);
    const idleClip = realClip(idle0.animations);
    if (idleClip) {
      const a = m.clipAction(idleClip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
    }
    return m;
  }, [idle0]);

  useFrame((_, delta) => mixer.update(delta));

  return <primitive object={idle0} scale={0.01} position={[0, 0, 0]} />;
}

// ── Full character model (sheet — idle FBX + merged anims GLB) ───────────────
type AssetSet = typeof MALE_ASSETS;

function CharacterModel({ assets, animationState }: { assets: AssetSet; animationState: AnimationState }) {
  const idle0      = useLoader(FBXLoader,  assets.idle);
  const animsGltf  = useLoader(GLTFLoader, assets.anims);
  const diffuseTex = useLoader(THREE.TextureLoader, assets.diffuse);

  React.useEffect(() => { applyTexture(idle0, diffuseTex); }, [idle0, diffuseTex]);

  const { mixer, actions, idleKeys } = React.useMemo(() => {
    const mixer   = new THREE.AnimationMixer(idle0);
    const actions: Record<string, THREE.AnimationAction> = {};
    const add = (clip: THREE.AnimationClip, name: string) => {
      const c = clip.clone(); c.name = name;
      actions[name] = mixer.clipAction(c);
    };

    // Idle animation comes from the FBX (also the mesh source)
    const idleClip = realClip(idle0.animations);
    if (idleClip) add(idleClip, 'idle');

    // All other animations from the merged GLB (calibration clips already stripped)
    for (const clip of (animsGltf.animations ?? [])) {
      const key = CLIP_TO_KEY[clip.name];
      if (key) add(clip, key);
    }

    const idleKeys = ['idle', 'idle2'].filter(k => actions[k]);
    return { mixer, actions, idleKeys };
  }, [idle0, animsGltf]);

  useFrame((_, delta) => mixer.update(delta));

  const prev    = React.useRef('');
  const curIdle = React.useRef(0);

  const play = React.useCallback((key: string, loop: boolean, fade = 0.3) => {
    const a = actions[key]; if (!a) return;
    if (prev.current && prev.current !== key) actions[prev.current]?.fadeOut(fade);
    a.reset().fadeIn(fade);
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    a.clampWhenFinished = !loop;
    a.play();
    prev.current = key;
  }, [actions]);

  const playRandomIdle = React.useCallback((fade = 0.5) => {
    if (!idleKeys.length) return;
    let n = curIdle.current;
    if (idleKeys.length > 1) do { n = Math.floor(Math.random() * idleKeys.length); } while (n === curIdle.current);
    curIdle.current = n;
    play(idleKeys[n], true, fade);
  }, [idleKeys, play]);

  // Start idle on mount
  const started = React.useRef(false);
  React.useEffect(() => {
    if (started.current || !idleKeys.length) return;
    started.current = true;
    play(idleKeys[0], true, 0);
  }, [idleKeys, play]);

  // Cycle idle ↔ walk loop every 7s at full health
  React.useEffect(() => {
    if (animationState !== 'idle' || idleKeys.length < 2) return;
    const id = setInterval(() => playRandomIdle(0.8), 7000);
    return () => clearInterval(id);
  }, [animationState, idleKeys, playRandomIdle]);

  // Main state machine
  React.useEffect(() => {
    if (animationState === 'down') {
      play('down', false, 0.3);
      return;
    }
    if (animationState === 'hurt-light' || animationState === 'hurt-heavy') {
      const key = animationState;
      if (!actions[key]) { playRandomIdle(0.3); return; }
      play(key, false, 0.10);
      const dur = (actions[key].getClip().duration ?? 1) * 1000 + 150;
      const t = setTimeout(() => playRandomIdle(0.4), dur);
      return () => clearTimeout(t);
    }
    if (isBaseState(animationState) && animationState !== 'idle') {
      play(actions[animationState] ? animationState : 'idle', true, 0.5);
      return;
    }
    // 'idle' — start first idle key; interval handles cycling
    play(idleKeys[0] ?? 'idle', true, 0.5);
  }, [animationState]); // eslint-disable-line react-hooks/exhaustive-deps

  return <primitive object={idle0} scale={0.01} position={[0, 0, 0]} />;
}

// ── Canvas wrapper ───────────────────────────────────────────────────────────
export default function CharacterViewport({
  animationState = 'idle',
  gender = 'male',
  className,
  minimal = false,
}: CharacterViewportProps) {
  const assets = gender === 'female' ? FEMALE_ASSETS : MALE_ASSETS;

  return (
    <div
      className={className}
      style={{ width: '100%', height: '100%', background: 'radial-gradient(ellipse at 50% 100%, #1e2a3a 0%, #0f1520 100%)' }}
    >
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 0.95, 2.2], fov: 42 }}
        gl={{ toneMapping: 4 /* ACESFilmicToneMapping */, toneMappingExposure: 1.1, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={1.6} color="#ffffff" />
        <directionalLight position={[2, 4, 3]} intensity={2.4} castShadow shadow-mapSize={[1024, 1024]} color="#fff8f0" />
        <directionalLight position={[-2, 2, -1]} intensity={0.9} color="#c8d8ff" />
        <directionalLight position={[0, -1, 3]} intensity={0.4} color="#ffffff" />
        <React.Suspense fallback={null}>
          {minimal
            ? <CharacterModelMinimal assets={assets} />
            : <CharacterModel assets={assets} animationState={animationState} />}
        </React.Suspense>
        <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={4} blur={2.2} far={3} />
        <OrbitControls enablePan={false} minDistance={1.2} maxDistance={5} target={[0, 0.7, 0]} />
      </Canvas>
    </div>
  );
}
