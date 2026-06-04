import * as React from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, ContactShadows, useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';

/**
 * Phase 0 spike — 3D character viewport.
 *
 * KayKit Adventurers pack structure:
 *   - Characters/gltf/*.glb  → mesh + skeleton, NO embedded animations
 *   - Animations/gltf/Rig_Medium/Rig_Medium_General.glb → animation clips
 *     (Idle_A, Idle_B, Hit_A, Hit_B, Death_A, Death_B, …)
 *
 * Both share the same bone names, so we load the character for its mesh and the
 * animation rig for its clips, then retarget the clips onto the character's root.
 *
 * `animationState` prop is wired now — Phase 1 (HP-reactive) will drive it without
 * needing a rewrite.
 */
export type AnimationState = 'idle' | 'hurt' | 'down';

interface CharacterViewportProps {
  characterUrl?: string;   // e.g. '/models/Knight.glb'
  animUrl?: string;        // e.g. '/models/Rig_Medium_General.glb'
  animationState?: AnimationState;
  className?: string;
}

// Preload both GLBs so they're ready before the canvas mounts.
useGLTF.preload('/models/Knight.glb');
useGLTF.preload('/models/Rig_Medium_General.glb');

/** Step A — procedural humanoid placeholder (zero asset dependency). */
function PlaceholderCharacter() {
  const group = React.useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!group.current) return;
    const t = state.clock.elapsedTime;
    group.current.position.y = Math.sin(t * 1.5) * 0.04;
    group.current.rotation.y = Math.sin(t * 0.4) * 0.15;
  });
  const skin = '#c9a17a';
  const tunic = '#5b6b8c';
  return (
    <group ref={group}>
      <mesh position={[0, 1.5, 0]} castShadow>
        <boxGeometry args={[0.42, 0.42, 0.42]} />
        <meshStandardMaterial color={skin} />
      </mesh>
      <mesh position={[0, 1.0, 0]} castShadow>
        <boxGeometry args={[0.6, 0.7, 0.35]} />
        <meshStandardMaterial color={tunic} />
      </mesh>
      <mesh position={[-0.42, 1.0, 0]} castShadow>
        <boxGeometry args={[0.18, 0.65, 0.22]} />
        <meshStandardMaterial color={tunic} />
      </mesh>
      <mesh position={[0.42, 1.0, 0]} castShadow>
        <boxGeometry args={[0.18, 0.65, 0.22]} />
        <meshStandardMaterial color={tunic} />
      </mesh>
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

/**
 * KayKit character: loads mesh from characterUrl, animations from animUrl.
 * The rig GLB has clips named Idle_A, Hit_A, Hit_B, Death_A, Death_B, etc.
 * `animationState` drives which clip plays.
 */
function KayKitCharacter({
  characterUrl,
  animUrl,
  animationState,
}: {
  characterUrl: string;
  animUrl: string;
  animationState: AnimationState;
}) {
  const group = React.useRef<THREE.Group>(null);

  // Load character mesh (no embedded animations).
  const { scene: charScene } = useGLTF(characterUrl);
  // Load animation rig (has all the clips).
  const { animations } = useGLTF(animUrl);

  // Bind the rig's clips to our character group root.
  const { actions } = useAnimations(animations, group);

  // Map state → clip name. Prefer _A variants; fall back gracefully.
  const clipFor = React.useCallback((state: AnimationState): string => {
    switch (state) {
      case 'hurt': return 'Hit_A';
      case 'down': return 'Death_A';
      case 'idle':
      default:     return 'Idle_A';
    }
  }, []);

  const prevClip = React.useRef<string | null>(null);

  React.useEffect(() => {
    const target = clipFor(animationState);
    const action = actions[target];
    if (!action) return;

    // Fade out the previous clip, fade in the new one.
    if (prevClip.current && prevClip.current !== target) {
      actions[prevClip.current]?.fadeOut(0.3);
    }

    const isOneShot = animationState !== 'idle';
    action.reset().fadeIn(0.3);
    if (isOneShot) {
      // Hit/Death play once then return to idle.
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
    }
    action.play();
    prevClip.current = target;

    // After a hit, automatically return to idle.
    if (animationState === 'hurt') {
      const dur = (action.getClip().duration * 1000) + 100;
      const t = setTimeout(() => {
        action.fadeOut(0.3);
        const idle = actions['Idle_A'];
        idle?.reset().fadeIn(0.3).setLoop(THREE.LoopRepeat, Infinity).play();
        prevClip.current = 'Idle_A';
      }, dur);
      return () => clearTimeout(t);
    }
  }, [animationState, actions, clipFor]);

  // Scale the character up slightly — KayKit models are in ~1m units.
  return (
    <group ref={group} scale={1.0}>
      <primitive object={charScene} />
    </group>
  );
}

export default function CharacterViewport({
  characterUrl = '/models/Knight.glb',
  animUrl = '/models/Rig_Medium_General.glb',
  animationState = 'idle',
  className,
}: CharacterViewportProps) {
  const hasAssets = !!characterUrl && !!animUrl;

  return (
    <div className={className} style={{ width: '100%', height: '100%' }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 1.1, 3.0], fov: 38 }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight
          position={[3, 5, 2]}
          intensity={1.2}
          castShadow
          shadow-mapSize={[1024, 1024]}
        />
        <React.Suspense fallback={null}>
          {hasAssets
            ? <KayKitCharacter
                characterUrl={characterUrl}
                animUrl={animUrl}
                animationState={animationState}
              />
            : <PlaceholderCharacter />
          }
        </React.Suspense>
        <ContactShadows position={[0, 0, 0]} opacity={0.45} scale={5} blur={2} far={3} />
        <OrbitControls
          enablePan={false}
          minDistance={1.5}
          maxDistance={5}
          target={[0, 0.9, 0]}
        />
      </Canvas>
    </div>
  );
}
