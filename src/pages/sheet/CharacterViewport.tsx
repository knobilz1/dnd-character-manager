import * as React from 'react';
import { Canvas, useLoader, useFrame } from '@react-three/fiber';
import { OrbitControls, ContactShadows } from '@react-three/drei';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as THREE from 'three';

export type AnimationState = 'idle' | 'hurt' | 'down';

interface CharacterViewportProps {
  animationState?: AnimationState;
  className?: string;
}

const IDLE_URLS = [
  '/models/Human_Idle_Textured.fbx', // textured mesh — this is the rendered object
  '/models/Human_Walk_Relaxed.fbx',  // animation clips only (no texture needed)
];
const HIT_URL = '/models/Human_White_Punched.fbx';

/**
 * 3D character built from AccuRig-rigged FBX exports (mesh + skeleton +
 * animation, all sharing one 118-bone skeleton).
 *
 * Lessons baked in:
 *  - Render the RAW loaded FBX. SkeletonUtils.clone() broke the skinning here
 *    (invisible mesh), so we do not clone — one viewport, one instance.
 *  - AccuRig bundles a "0_Open A_UE5" calibration A-pose clip in every file;
 *    the real motion is the OTHER clip. We pick the non-calibration clip.
 *  - All three FBX share identical bone names, so the walk/hit clips retarget
 *    onto the displayed mesh's skeleton by name.
 *  - Texture: loaded separately via TextureLoader (not from FBX material) because
 *    FBXLoader's MeshPhongMaterial inherits a green base-color tint from the FBX
 *    material block that tints the diffuse even when color=0xffffff. Bypassing it
 *    with a fresh MeshStandardMaterial + TextureLoader gives true colors.
 *  - FBX is in cm → scale 0.01.
 */
function FBXCharacter({ animationState }: { animationState: AnimationState }) {
  const idle0 = useLoader(FBXLoader, IDLE_URLS[0]);
  const idle1 = useLoader(FBXLoader, IDLE_URLS[1]);
  const hit = useLoader(FBXLoader, HIT_URL);

  // Load the diffuse texture directly — bypasses FBX material weirdness entirely.
  // FBXLoader's MeshPhongMaterial picks up the correct texture file path but can
  // still inherit a tinted base color or other per-channel quirks from the FBX
  // material block. Loading via TextureLoader gives us a clean, unmodified image.
  const diffuseTex = useLoader(THREE.TextureLoader, '/models/tripo_mat_a9e3ea13_Diffuse.png');

  // Prepare mesh: disable frustum culling, enable shadows, replace the FBX
  // material with a clean PBR material using the directly-loaded texture.
  React.useEffect(() => {
    // Mark texture as sRGB (colour textures must be in sRGB space for correct rendering).
    diffuseTex.colorSpace = THREE.SRGBColorSpace;
    diffuseTex.needsUpdate = true;

    // Build one shared material for all sub-meshes.
    const mat = new THREE.MeshStandardMaterial({
      map: diffuseTex,
      roughness: 0.75,
      metalness: 0.0,
    });

    idle0.traverse((o) => {
      o.frustumCulled = false;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.material = mat;
    });
  }, [idle0, diffuseTex]);

  // Build mixer + actions from the real (non-calibration) clip of each file.
  const { mixer, actions, idleKeys } = React.useMemo(() => {
    const mixer = new THREE.AnimationMixer(idle0);
    const actions: Record<string, THREE.AnimationAction> = {};
    const realClip = (o: THREE.Group) =>
      o.animations.find((a) => !/open a|_ue5/i.test(a.name)) ??
      o.animations[o.animations.length - 1] ??
      o.animations[0];
    const add = (clip: THREE.AnimationClip | undefined, name: string) => {
      if (!clip) return;
      const c = clip.clone();
      c.name = name;
      actions[name] = mixer.clipAction(c);
    };
    add(realClip(idle0), 'idle');
    add(realClip(idle1), 'idle2');
    add(realClip(hit), 'hurt');
    const idleKeys = ['idle', 'idle2'].filter((k) => actions[k]);
    return { mixer, actions, idleKeys };
  }, [idle0, idle1, hit]);

  useFrame((_, delta) => mixer.update(delta));

  const prev = React.useRef<string>('');
  const curIdle = React.useRef(0);

  const play = React.useCallback((key: string, loop: boolean, fade = 0.3) => {
    const a = actions[key];
    if (!a) return;
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
    if (idleKeys.length > 1) {
      do { n = Math.floor(Math.random() * idleKeys.length); } while (n === curIdle.current);
    }
    curIdle.current = n;
    play(idleKeys[n], true, fade);
  }, [idleKeys, play]);

  // Kick off first idle once.
  const started = React.useRef(false);
  React.useEffect(() => {
    if (started.current || !idleKeys.length) return;
    started.current = true;
    play(idleKeys[0], true, 0);
  }, [idleKeys, play]);

  // Looping clips never emit 'finished', so cycle idles on a timer for variety.
  React.useEffect(() => {
    if (animationState !== 'idle' || idleKeys.length < 2) return;
    const id = setInterval(() => playRandomIdle(0.8), 7000);
    return () => clearInterval(id);
  }, [animationState, idleKeys, playRandomIdle]);

  // React to HP-driven state changes.
  React.useEffect(() => {
    if (animationState === 'hurt' && actions.hurt) {
      play('hurt', false, 0.12);
      const dur = (actions.hurt.getClip().duration ?? 1) * 1000 + 150;
      const t = setTimeout(() => playRandomIdle(0.4), dur);
      return () => clearTimeout(t);
    }
    if (animationState === 'down' && actions.hurt) {
      play('hurt', false, 0.12); // no death clip yet → hold reaction pose
      return;
    }
    playRandomIdle(0.3);
  }, [animationState]); // eslint-disable-line react-hooks/exhaustive-deps

  return <primitive object={idle0} scale={0.01} position={[0, 0, 0]} />;
}

export default function CharacterViewport({
  animationState = 'idle',
  className,
}: CharacterViewportProps) {
  return (
    <div className={className} style={{ width: '100%', height: '100%', background: 'radial-gradient(ellipse at 50% 100%, #1e2a3a 0%, #0f1520 100%)' }}>
      <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 0.95, 2.2], fov: 42 }}
        gl={{ toneMapping: 4 /* ACESFilmicToneMapping */, toneMappingExposure: 1.1, alpha: true }}
        style={{ background: 'transparent' }}>
        <ambientLight intensity={1.6} color="#ffffff" />
        <directionalLight position={[2, 4, 3]} intensity={2.4} castShadow shadow-mapSize={[1024, 1024]} color="#fff8f0" />
        <directionalLight position={[-2, 2, -1]} intensity={0.9} color="#c8d8ff" />
        <directionalLight position={[0, -1, 3]} intensity={0.4} color="#ffffff" />
        <React.Suspense fallback={null}>
          <FBXCharacter animationState={animationState} />
        </React.Suspense>
        <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={4} blur={2.2} far={3} />
        <OrbitControls enablePan={false} minDistance={1.2} maxDistance={5} target={[0, 0.7, 0]} />
      </Canvas>
    </div>
  );
}
