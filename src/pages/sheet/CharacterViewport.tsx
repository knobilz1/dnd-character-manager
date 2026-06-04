import * as React from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, ContactShadows, useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';

/**
 * Phase 0 spike — 3D character viewport.
 *
 * Step A (active): a procedural primitive figure with a code-driven idle bob.
 *   Proves React Three Fiber mounts + animates inside the Tauri webview with
 *   zero external assets.
 *
 * Step B (scaffold, opt-in via `modelUrl`): loads a real CC0 glTF/GLB and plays
 *   its bundled idle clip. Drop a model in `public/models/` and pass its URL
 *   (e.g. `/models/adventurer.glb`) to exercise the real skinned-mesh pipeline.
 *
 * `animationState` is accepted now so Phase 1 (HP-reactive flinch/wounded/down)
 * can drive this without a rewrite. The spike only renders the idle state.
 */
export type AnimationState = 'idle' | 'hurt' | 'down';

interface CharacterViewportProps {
  /** Optional path to a bundled GLB (Step B). When omitted, the procedural placeholder renders. */
  modelUrl?: string;
  /** Reserved for Phase 1; only 'idle' is implemented in the spike. */
  animationState?: AnimationState;
  className?: string;
}

/** Step A — procedural humanoid built from primitives, gently bobbing. */
function PlaceholderCharacter() {
  const group = React.useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!group.current) return;
    const t = state.clock.elapsedTime;
    // Gentle vertical bob + subtle sway to read as "alive / idle".
    group.current.position.y = Math.sin(t * 1.5) * 0.04;
    group.current.rotation.y = Math.sin(t * 0.4) * 0.15;
  });

  const skin = '#c9a17a';
  const tunic = '#5b6b8c';

  return (
    <group ref={group}>
      {/* Head */}
      <mesh position={[0, 1.5, 0]} castShadow>
        <boxGeometry args={[0.42, 0.42, 0.42]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      {/* Torso */}
      <mesh position={[0, 1.0, 0]} castShadow>
        <boxGeometry args={[0.6, 0.7, 0.35]} />
        <meshStandardMaterial color={tunic} />
      </mesh>
      {/* Arms */}
      <mesh position={[-0.42, 1.0, 0]} castShadow>
        <boxGeometry args={[0.18, 0.65, 0.22]} />
        <meshStandardMaterial color={tunic} />
      </mesh>
      <mesh position={[0.42, 1.0, 0]} castShadow>
        <boxGeometry args={[0.18, 0.65, 0.22]} />
        <meshStandardMaterial color={tunic} />
      </mesh>
      {/* Legs */}
      <mesh position={[-0.16, 0.35, 0]} castShadow>
        <boxGeometry args={[0.2, 0.7, 0.24]} />
        <meshStandardMaterial color="#3a3f4b" />
      </mesh>
      <mesh position={[0.16, 0.35, 0]} castShadow>
        <boxGeometry args={[0.2, 0.7, 0.24]} />
        <meshStandardMaterial color="#3a3f4b" />
      </mesh>
    </group>
  );
}

/** Step B — real GLB with a bundled idle animation clip. */
function GltfCharacter({ url }: { url: string }) {
  const group = React.useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(url);
  const { actions, names } = useAnimations(animations, group);

  React.useEffect(() => {
    // Prefer a clip literally named idle; otherwise fall back to the first clip.
    const idle = names.find((n) => /idle/i.test(n)) ?? names[0];
    if (idle && actions[idle]) {
      actions[idle].reset().fadeIn(0.3).play();
      return () => { actions[idle]?.fadeOut(0.3); };
    }
  }, [actions, names]);

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  );
}

export default function CharacterViewport({ modelUrl, className }: CharacterViewportProps) {
  return (
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 1.2, 3.2], fov: 40 }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight
          position={[3, 5, 2]}
          intensity={1.1}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <React.Suspense fallback={null}>
          {modelUrl ? <GltfCharacter url={modelUrl} /> : <PlaceholderCharacter />}
        </React.Suspense>
        <ContactShadows position={[0, 0, 0]} opacity={0.4} scale={6} blur={2.4} far={4} />
        <OrbitControls
          enablePan={false}
          minDistance={2}
          maxDistance={6}
          target={[0, 0.9, 0]}
        />
      </Canvas>
    </div>
  );
}
