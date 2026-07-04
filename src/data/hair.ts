/**
 * hair.ts — modular hairstyle registry.
 *
 * Hair is a rigid GLB prop attached to the character's `head` bone (same
 * bone-socket system as armor; see CharacterViewport `BoneAttachment`). Each
 * style is one shared mesh reused across races with per-race fit offsets; a
 * per-race mesh override (`perRaceUrl`) can be supplied where a style clips badly
 * on a divergent head shape (hybrid approach).
 *
 * URLs are BARE filenames (e.g. 'hair/short_crop.glb') — `modelUrl()` resolves
 * them for dev (/models/…) and prod Tauri (side-loaded resource asset:// URLs).
 * GLBs in public/models/hair/ are bundled via the hair glob in tauri.conf.json.
 *
 * ⚠️ Until bald base bodies ship, selected hair renders ON TOP of the baked-in
 * hair of the current fused meshes. That's expected during framework bring-up.
 */
import type { CharacterGender } from '../types';
import type { AttachmentFit } from '../pages/sheet/CharacterViewport';

/** Canonical model-race keys (one 3D body family each). */
export type ModelRace = 'human' | 'elf' | 'dwarf' | 'halforc' | 'halfling' | 'tiefling' | 'gnome';

/** Map a raceId string to a canonical model-race key. Unmapped → 'human'.
 *  Lives here (a lightweight leaf module) so UI like the creator can map races
 *  without importing the heavy three.js viewport. */
export function modelRace(raceId?: string): ModelRace {
  if (!raceId) return 'human';
  const id = raceId.toLowerCase();
  // No dedicated half-elf model — 'half-elf' doesn't match the `startsWith('elf')`
  // check below (it starts with 'half'), so without this it silently fell through
  // to the generic 'human' default. Elf is the closer visual fit.
  if (id.includes('half-elf')) return 'elf';
  if (id.startsWith('elf') || id.includes('drow') || id.includes('eladrin')) return 'elf';
  if (id.startsWith('dwarf') || id.includes('duergar')) return 'dwarf';
  if (id.includes('orc')) return 'halforc';           // half-orc, orc-2024
  if (id.startsWith('halfling')) return 'halfling';
  if (id.startsWith('tiefling')) return 'tiefling';
  if (id.startsWith('gnome') || id.includes('svirfneblin')) return 'gnome';
  return 'human';
}

export interface HairStyle {
  /** Stable id stored on Character.appearance.hairId. 'none' = bald. */
  id: string;
  label: string;
  /** Shared mesh, bare filename. Omit for 'none'. */
  url?: string;
  /** Restrict to one gender (e.g. a masculine cut). Undefined = any. */
  gender?: CharacterGender;
  /** Per-race mesh override when the shared mesh doesn't fit a head shape. */
  perRaceUrl?: Partial<Record<ModelRace, string>>;
  /** Per-race fit offsets; falls back to DEFAULT_HAIR_FIT when unset. */
  defaultFitByRace?: Partial<Record<ModelRace, AttachmentFit>>;
  /** Per-race-per-gender fit; wins over defaultFitByRace when both exist. */
  defaultFitByRaceGender?: Partial<Record<ModelRace, Partial<Record<CharacterGender, AttachmentFit>>>>;
  /** Whether runtime color tint applies (default true). */
  tintable?: boolean;
}

export const HAIR_STYLES: HairStyle[] = [
  { id: 'none', label: 'Bald' },
  { id: 'short_crop', label: 'Short Crop', url: 'hair/short_crop.glb', tintable: true,
    defaultFitByRaceGender: {
      elf: { male: { s: 0.190, px: 0.105, py: -0.015, pz: 0.005, rx: 1.070, ry: -0.430, rz: -1.170 } },
    },
  },
  { id: 'long_straight', label: 'Long Straight', url: 'hair/long_straight.glb', tintable: true,
    defaultFitByRaceGender: {
      elf: { female: { s: 0.600, px: 0.000, py: 0.055, pz: 0.015, rx: -1.470, ry: 0.390, rz: -1.510 } },
      // Human-male crown sits higher than the elf-female auto-calibration assumes,
      // so the shared wig rode low and exposed scalp; lift py to seat it. (Tuned
      // via scripts/hair-shot.mjs headless rear/crown capture, 2026-06-25.)
      human: { male: { s: 0.600, px: 0.000, py: 0.100, pz: 0.015, rx: -1.470, ry: 0.390, rz: -1.510 } },
    },
  },
];

export function getHairStyle(id?: string): HairStyle | undefined {
  if (!id) return undefined;
  return HAIR_STYLES.find((h) => h.id === id);
}

/** Styles available for a given race+gender (gender-restricted ones filtered). */
export function hairStylesFor(_race: ModelRace, gender: CharacterGender): HairStyle[] {
  return HAIR_STYLES.filter((h) => !h.gender || h.gender === gender);
}

/** Resolve the mesh URL for a style on a given race (per-race override wins). */
export function hairUrlFor(style: HairStyle, race: ModelRace): string | undefined {
  return style.perRaceUrl?.[race] ?? style.url;
}
