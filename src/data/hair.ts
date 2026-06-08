/**
 * hair.ts — modular hairstyle registry.
 *
 * Hair is a rigid GLB prop attached to the character's `head` bone (same
 * bone-socket system as armor; see CharacterViewport `BoneAttachment`). Each
 * style is one shared mesh reused across races with per-race fit offsets; a
 * per-race mesh override (`perRaceUrl`) can be supplied where a style clips badly
 * on a divergent head shape (hybrid approach).
 *
 * URLs are BARE filenames (e.g. 'hair/short.glb') — `modelUrl()` resolves them
 * for dev (/models/…) and prod Tauri (side-loaded resource asset:// URLs).
 *
 * ⚠️ When the first REAL hair GLB lands in public/models/hair/, add this line to
 * `bundle.resources` in src-tauri/tauri.conf.json:
 *     "../public/models/hair/*.glb": "models/hair/"
 * Do NOT add it before a file exists there — an empty glob fails the Tauri build
 * ("glob didn't match any files"). The 'test' style below reuses the already-
 * bundled armor/helmet.glb, so no resources change is needed for the spike.
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
  /** Whether runtime color tint applies (default true). */
  tintable?: boolean;
}

export const HAIR_STYLES: HairStyle[] = [
  { id: 'none', label: 'Bald' },
  // ── Framework spike placeholder ──────────────────────────────────────────
  // Reuses the helmet GLB as a stand-in "hair" so the full loop (picker →
  // attachment → tint → hide-under-helmet → per-race fit) is testable before
  // real hair art exists. Replace with real entries once hair GLBs land in
  // public/models/hair/.
  { id: 'test', label: 'Test (placeholder)', url: 'armor/helmet.glb', tintable: true },
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
