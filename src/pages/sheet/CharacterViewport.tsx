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
}

// ── Asset URLs ───────────────────────────────────────────────────────────────
// Male (original) assets
const M_IDLE_URL       = '/models/Human_Idle_Textured.fbx';
const M_WALK_URL       = '/models/Human_Walk_Relaxed.glb';
const M_HIT_LIGHT_URL  = '/models/Human_Hit_Light.glb';
const M_HIT_HEAVY_URL  = '/models/Human_White_Punched.glb';
const M_DIFFUSE_URL    = '/models/tripo_mat_a9e3ea13_Diffuse.png';

// Female assets
const F_IDLE_URL       = '/models/Human_Female_Idle_Textured.fbx';
const F_LIMP1_URL      = '/models/Human_Female_Limp_Lv1.glb';
const F_LIMP2_URL      = '/models/Human_Female_Limp_Lv2.glb';
const F_LIMP3_URL      = '/models/Human_Female_Limp_Lv3.glb';
const F_DYING_URL      = '/models/Human_Female_Dying.glb';
const F_HIT_HARD_URL   = '/models/Human_Female_Hit_Hard.glb';
const F_HIT_EXTREME_URL= '/models/Human_Female_Hit_Extreme.glb';
const F_WALK_START_URL = '/models/Human_Female_Walk_Start.glb';
const F_WALK_LOOP_URL  = '/models/Human_Female_Walk_Loop.glb';
const F_WALK_END_URL   = '/models/Human_Female_Walk_End.glb';
const F_DIFFUSE_URL    = '/models/tripo_mat_db0ac1f6_Diffuse.png';

// ── Shared helpers ───────────────────────────────────────────────────────────
const realClip = (clips: THREE.AnimationClip[]) =>
  clips.find((a) => !/open a|_ue5/i.test(a.name)) ??
  clips[clips.length - 1] ??
  clips[0];

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

// ── Male character ───────────────────────────────────────────────────────────
function MaleCharacter({ animationState }: { animationState: AnimationState }) {
  const idle0        = useLoader(FBXLoader,  M_IDLE_URL);
  const walkGltf     = useLoader(GLTFLoader, M_WALK_URL);
  const hitLightGltf = useLoader(GLTFLoader, M_HIT_LIGHT_URL);
  const hitHeavyGltf = useLoader(GLTFLoader, M_HIT_HEAVY_URL);
  const diffuseTex   = useLoader(THREE.TextureLoader, M_DIFFUSE_URL);

  React.useEffect(() => { applyTexture(idle0, diffuseTex); }, [idle0, diffuseTex]);

  const { mixer, actions, idleKeys } = React.useMemo(() => {
    const mixer   = new THREE.AnimationMixer(idle0);
    const actions: Record<string, THREE.AnimationAction> = {};
    const add = (clip: THREE.AnimationClip | undefined, name: string) => {
      if (!clip) return;
      const c = clip.clone(); c.name = name;
      actions[name] = mixer.clipAction(c);
    };
    add(realClip(idle0.animations),               'idle');
    add(realClip(walkGltf.animations     ?? []),   'idle2');
    add(realClip(hitLightGltf.animations ?? []),   'hurt-light');
    add(realClip(hitHeavyGltf.animations ?? []),   'hurt-heavy');
    const idleKeys = ['idle', 'idle2'].filter(k => actions[k]);
    return { mixer, actions, idleKeys };
  }, [idle0, walkGltf, hitLightGltf, hitHeavyGltf]);

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

  const started = React.useRef(false);
  React.useEffect(() => {
    if (started.current || !idleKeys.length) return;
    started.current = true;
    play(idleKeys[0], true, 0);
  }, [idleKeys, play]);

  React.useEffect(() => {
    if (!isBaseState(animationState) || idleKeys.length < 2) return;
    const id = setInterval(() => playRandomIdle(0.8), 7000);
    return () => clearInterval(id);
  }, [animationState, idleKeys, playRandomIdle]);

  React.useEffect(() => {
    if (animationState === 'hurt-heavy' || animationState === 'hurt-light') {
      const key = animationState;
      if (!actions[key]) { playRandomIdle(0.3); return; }
      play(key, false, 0.10);
      const dur = (actions[key].getClip().duration ?? 1) * 1000 + 150;
      const t = setTimeout(() => playRandomIdle(0.4), dur);
      return () => clearTimeout(t);
    }
    if (animationState === 'down') {
      const fallback = actions['hurt-heavy'] ?? actions['hurt-light'];
      if (fallback) play(fallback.getClip().name, false, 0.12);
      return;
    }
    // Male has no limp animations yet — fall back to idle for all limp levels
    playRandomIdle(0.3);
  }, [animationState]); // eslint-disable-line react-hooks/exhaustive-deps

  return <primitive object={idle0} scale={0.01} position={[0, 0, 0]} />;
}

// ── Female character ─────────────────────────────────────────────────────────
function FemaleCharacter({ animationState }: { animationState: AnimationState }) {
  const idle0        = useLoader(FBXLoader,  F_IDLE_URL);
  const limp1Gltf    = useLoader(GLTFLoader, F_LIMP1_URL);
  const limp2Gltf    = useLoader(GLTFLoader, F_LIMP2_URL);
  const limp3Gltf    = useLoader(GLTFLoader, F_LIMP3_URL);
  const dyingGltf    = useLoader(GLTFLoader, F_DYING_URL);
  const hitHardGltf  = useLoader(GLTFLoader, F_HIT_HARD_URL);
  const hitExtrGltf  = useLoader(GLTFLoader, F_HIT_EXTREME_URL);
  const walkStGltf   = useLoader(GLTFLoader, F_WALK_START_URL);
  const walkLoGltf   = useLoader(GLTFLoader, F_WALK_LOOP_URL);
  const walkEndGltf  = useLoader(GLTFLoader, F_WALK_END_URL);
  const diffuseTex   = useLoader(THREE.TextureLoader, F_DIFFUSE_URL);

  React.useEffect(() => { applyTexture(idle0, diffuseTex); }, [idle0, diffuseTex]);

  const { mixer, actions, idleKeys } = React.useMemo(() => {
    const mixer   = new THREE.AnimationMixer(idle0);
    const actions: Record<string, THREE.AnimationAction> = {};
    const add = (clip: THREE.AnimationClip | undefined, name: string) => {
      if (!clip) return;
      const c = clip.clone(); c.name = name;
      actions[name] = mixer.clipAction(c);
    };
    add(realClip(idle0.animations),            'idle');
    add(realClip(walkLoGltf.animations ?? []), 'idle2');   // walk loop as alt idle
    add(realClip(walkStGltf.animations ?? []), 'walk-start');
    add(realClip(walkEndGltf.animations ?? []),'walk-end');
    add(realClip(limp1Gltf.animations  ?? []), 'limp-lv1');
    add(realClip(limp2Gltf.animations  ?? []), 'limp-lv2');
    add(realClip(limp3Gltf.animations  ?? []), 'limp-lv3');
    add(realClip(hitHardGltf.animations ?? []),'hurt-light');
    add(realClip(hitExtrGltf.animations ?? []),'hurt-heavy');
    add(realClip(dyingGltf.animations  ?? []), 'down');
    const idleKeys = ['idle', 'idle2'].filter(k => actions[k]);
    return { mixer, actions, idleKeys };
  }, [idle0, limp1Gltf, limp2Gltf, limp3Gltf, dyingGltf, hitHardGltf, hitExtrGltf, walkStGltf, walkLoGltf, walkEndGltf]);

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

  // Cycle idle ↔ walk loop every 7s when at full health
  React.useEffect(() => {
    if (!isBaseState(animationState) || animationState !== 'idle' || idleKeys.length < 2) return;
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
      const key = animationState; // now wired to real hit clips
      if (!actions[key]) { playRandomIdle(0.3); return; }
      play(key, false, 0.10);
      const dur = (actions[key].getClip().duration ?? 1) * 1000 + 150;
      const t = setTimeout(() => playRandomIdle(0.4), dur);
      return () => clearTimeout(t);
    }

    // Base looping states (limp levels loop; idle cycles via interval above)
    if (isBaseState(animationState) && animationState !== 'idle') {
      const key = actions[animationState] ? animationState : 'idle';
      play(key, true, 0.5);
      return;
    }

    // 'idle' — play first idle key; interval handles cycling
    play(idleKeys[0] ?? 'idle', true, 0.5);
  }, [animationState]); // eslint-disable-line react-hooks/exhaustive-deps

  return <primitive object={idle0} scale={0.01} position={[0, 0, 0]} />;
}

// ── Canvas wrapper ───────────────────────────────────────────────────────────
export default function CharacterViewport({
  animationState = 'idle',
  gender = 'male',
  className,
}: CharacterViewportProps) {
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
          {gender === 'female'
            ? <FemaleCharacter animationState={animationState} />
            : <MaleCharacter   animationState={animationState} />}
        </React.Suspense>
        <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={4} blur={2.2} far={3} />
        <OrbitControls enablePan={false} minDistance={1.2} maxDistance={5} target={[0, 0.7, 0]} />
      </Canvas>
    </div>
  );
}
