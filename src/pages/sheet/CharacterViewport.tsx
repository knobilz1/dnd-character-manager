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
  '/models/Human_Badass_Idle.fbx',
  '/models/Human_Walk_Relaxed.fbx',
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
 *  - The Mixamo/AccuRig FBX lost its embedded texture; we render a clean solid
 *    sculpted material until a matching texture is re-exported.
 *  - FBX is in cm → scale 0.01.
 */
function FBXCharacter({ animationState }: { animationState: AnimationState }) {
  const idle0 = useLoader(FBXLoader, IDLE_URLS[0]);
  const idle1 = useLoader(FBXLoader, IDLE_URLS[1]);
  const hit = useLoader(FBXLoader, HIT_URL);

  // Apply a clean sculpted material once.
  React.useEffect(() => {
    idle0.traverse((o) => {
      o.frustumCulled = false;
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.material = new THREE.MeshStandardMaterial({
          color: '#b9a78f',
          roughness: 0.65,
          metalness: 0.05,
        });
      }
    });
  }, [idle0]);

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
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 0.95, 2.2], fov: 42 }}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[3, 5, 2]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-3, 2, -2]} intensity={0.5} />
        <React.Suspense fallback={null}>
          <FBXCharacter animationState={animationState} />
        </React.Suspense>
        <ContactShadows position={[0, 0, 0]} opacity={0.5} scale={4} blur={2.2} far={3} />
        <OrbitControls enablePan={false} minDistance={1.2} maxDistance={5} target={[0, 0.7, 0]} />
      </Canvas>
    </div>
  );
}
