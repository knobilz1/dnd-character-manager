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
export type ModelRace =
  | 'human' | 'elf' | 'dwarf' | 'halforc' | 'halfling' | 'tiefling' | 'gnome'
  | 'warforged' | 'tabaxi' | 'leonin' | 'minotaur' | 'goliath' | 'triton'
  | 'kenku' | 'firbolg' | 'goblin' | 'hobgoblin' | 'bugbear' | 'changeling'
  | 'lizardfolk' | 'satyr' | 'shifter' | 'yuanti' | 'dragonborn' | 'aasimar'
  | 'kobold' | 'harengon' | 'tortle' | 'loxodon' | 'giff'
  | 'verdan' | 'aarakocra' | 'owlin' | 'hadozee' | 'fairy' | 'plasmoid'
  | 'genasi-air' | 'genasi-earth' | 'genasi-fire' | 'genasi-water'
  | 'githyanki' | 'githzerai' | 'vedalken' | 'kalashtar' | 'simic-hybrid'
  // Thri-kreen have FOUR arms and the AccuRig skeleton has two, so only the primary pair is
  // rigged — the secondary pair rides along as static geometry bound to the chest. Kept out of
  // the library until 2026-08-09 for exactly that reason; the alternative was the plain human
  // fallback, which reads worse than a mantis with still arms.
  | 'thrikreen';

/** Eberron dragonmarks are the one family whose ids carry NO hint of the underlying species —
 *  `erlw-mark-of-warding` is a Dwarf, `erlw-mark-of-shadow` an Elf. No substring rule can reach
 *  them, so they need an explicit table; without it all twelve rendered as humans. The species
 *  is the one named in the race's display name (ERLW ties each mark to a fixed race). */
const DRAGONMARK_BODY: Record<string, ModelRace> = {
  'erlw-mark-of-detection': 'elf',        // Half-Elf
  'erlw-mark-of-finding': 'halforc',      // Half-Orc / Human
  'erlw-mark-of-handling': 'human',
  'erlw-mark-of-healing': 'halfling',
  'erlw-mark-of-hospitality': 'halfling',
  'erlw-mark-of-making': 'human',
  'erlw-mark-of-passage': 'human',
  'erlw-mark-of-scribing': 'gnome',
  'erlw-mark-of-sentinel': 'human',
  'erlw-mark-of-shadow': 'elf',
  'erlw-mark-of-storm': 'elf',            // Half-Elf
  'erlw-mark-of-warding': 'dwarf',
};

/** Map a raceId string to a canonical model-race key. Unmapped → 'human'.
 *  Lives here (a lightweight leaf module) so UI like the creator can map races
 *  without importing the heavy three.js viewport. */
export function modelRace(raceId?: string): ModelRace {
  if (!raceId) return 'human';
  const id = raceId.toLowerCase();
  // Checked first: these ids match none of the substring rules below, and putting the table
  // ahead of them keeps it immune to any future rule that might accidentally catch a mark id.
  const mark = DRAGONMARK_BODY[id];
  if (mark) return mark;
  // No dedicated half-elf model — 'half-elf' doesn't match the `startsWith('elf')`
  // check below (it starts with 'half'), so without this it silently fell through
  // to the generic 'human' default. Elf is the closer visual fit.
  if (id.includes('half-elf')) return 'elf';
  // These use `includes`, not `startsWith`: book- and variant-prefixed ids are the norm here
  // ('sea-elf', 'astral-elf', 'deep-gnome', 'autognome', 'scag-tiefling-feral'), and every one
  // of them fell through to 'human' while a perfectly good body sat on disk. Same compound-id
  // trap that hid 'half-elf' for months — prefer `includes` unless a substring would collide.
  // Shadar-kai carry no 'elf' in their id but their own Creature Type trait reads
  // "You are a Humanoid (elf)" — the app's data says elf, so use the elf body.
  if (id.includes('elf') || id.includes('drow') || id.includes('eladrin') || id.includes('shadar-kai')) return 'elf';
  if (id.includes('dwarf') || id.includes('duergar')) return 'dwarf';
  // 'orc-vgm' and 'erlw-orc' render the half-orc body on purpose.
  if (id.includes('orc')) return 'halforc';
  if (id.includes('halfling')) return 'halfling';
  if (id.includes('tiefling')) return 'tiefling';
  if (id.includes('gnome') || id.includes('svirfneblin')) return 'gnome';
  // Tripo body families (2026-08). Compound-id trap: 'hobgoblin' contains
  // 'goblin' so it must match first; 'erlw-changeling' / 'erlw-warforged' /
  // 'erlw-shifter-*' match via includes().
  if (id.includes('warforged')) return 'warforged';
  if (id.includes('tabaxi')) return 'tabaxi';
  if (id.includes('leonin')) return 'leonin';
  if (id.includes('minotaur')) return 'minotaur';
  if (id.includes('goliath')) return 'goliath';
  if (id.includes('triton')) return 'triton';
  if (id.includes('kenku')) return 'kenku';
  if (id.includes('firbolg')) return 'firbolg';
  if (id.includes('hobgoblin')) return 'hobgoblin';
  if (id.includes('goblin')) return 'goblin';
  if (id.includes('bugbear')) return 'bugbear';
  if (id.includes('changeling')) return 'changeling';
  if (id.includes('lizardfolk')) return 'lizardfolk';
  if (id.includes('satyr')) return 'satyr';
  if (id.includes('shifter')) return 'shifter';
  if (id.includes('yuan-ti')) return 'yuanti';
  if (id.includes('dragonborn')) return 'dragonborn';
  if (id.includes('aasimar')) return 'aasimar';
  // Bodies generated 2026-08-05. None of these collide with an earlier substring rule.
  if (id.includes('kobold')) return 'kobold';
  if (id.includes('harengon')) return 'harengon';
  if (id.includes('tortle')) return 'tortle';
  if (id.includes('loxodon')) return 'loxodon';
  if (id.includes('giff')) return 'giff';
  if (id.includes('verdan')) return 'verdan';
  if (id.includes('aarakocra')) return 'aarakocra';
  if (id.includes('owlin')) return 'owlin';
  if (id.includes('hadozee')) return 'hadozee';
  if (id.includes('fairy')) return 'fairy';
  if (id.includes('plasmoid')) return 'plasmoid';
  // The four Genasi get four bodies, not one shared 'genasi': a fire genasi and an earth genasi
  // have nothing visually in common, so a pooled body would read worse than the human fallback.
  if (id.includes('genasi-air')) return 'genasi-air';
  if (id.includes('genasi-earth')) return 'genasi-earth';
  if (id.includes('genasi-fire')) return 'genasi-fire';
  if (id.includes('genasi-water')) return 'genasi-water';
  // 'githyanki' must precede 'githzerai'? No — they share only the 'gith' stem, and neither is a
  // substring of the other, so order is irrelevant here. Kept adjacent for readability.
  if (id.includes('githyanki')) return 'githyanki';
  if (id.includes('githzerai')) return 'githzerai';
  if (id.includes('vedalken')) return 'vedalken';
  if (id.includes('kalashtar')) return 'kalashtar';
  if (id.includes('simic')) return 'simic-hybrid';
  // Race id is 'thri-kreen'; the body key drops the hyphen to match the asset filenames.
  if (id.includes('thri')) return 'thrikreen';
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
