/**
 * armor.ts — wardrobe piece registry.
 *
 * Two kinds of piece, and the distinction is not cosmetic:
 *
 *  - `rigid`   — a static prop parented to ONE bone (see `BoneAttachment`). Only correct when
 *                the piece covers a single rigid bone: a skull. A helmet qualifies; nothing else
 *                does. Gloves span 15+ finger bones, a cuirass spans pelvis to clavicle.
 *  - `skinned` — a mesh skinned to the shared AccuRig skeleton. Every body uses the same bone
 *                NAMES with its own bind pose, so binding the mesh to a given body's bones
 *                re-proportions it on the GPU — wider shoulders push the pauldrons out because
 *                shoulder width lives in the skeleton — and it follows animation for free.
 *                Built by `scripts/skin-garment.mjs`, checked by `scripts/validate-garment.mjs`.
 *
 * URLs are BARE filenames ('armor/heavy_torso.glb'); `modelUrl()` resolves dev (/models/…) vs
 * prod Tauri (side-loaded asset:// URLs). tauri.conf.json bundles `armor/*.glb` — flat, .glb
 * only — which is why every fit/exclusion table lives here in TypeScript and never in a JSON
 * sidecar next to the mesh.
 *
 * Kept a leaf module (types-only import from the viewport) so the creator and sheet can read the
 * registry without pulling in three.js.
 */
import type { ModelRace } from './hair';

export type ArmorSlot = 'head' | 'torso' | 'legs' | 'hands' | 'feet' | 'shoulders';

export type ArmorPiece = {
  id: string;
  label: string;
  slot: ArmorSlot;
  kind: 'rigid' | 'skinned';
  /** Bare filename under public/models/, e.g. 'armor/heavy_torso.glb'. */
  url: string;
  /** `rigid` only — the bone to parent to. */
  bone?: string;
  /** Bodies this piece is not offered on (a plasmoid has no shoulders to hang a cuirass from).
   *  Populated from validate-garment.mjs results, not by eye. */
  excludeFamilies?: ModelRace[];
};

export const ARMOR_PIECES: ArmorPiece[] = [
  { id: 'helmet', label: 'Helmet', slot: 'head', kind: 'rigid', bone: 'head', url: 'armor/helmet.glb' },
  // Despite the filename, heavy_torso is a shoulder YOKE — rendered alone it is two pauldron
  // assemblies and a sternum bib with the chest and back left open. See armor/manifest.json.
  { id: 'heavy_shoulders', label: 'Plate pauldrons', slot: 'shoulders', kind: 'skinned', url: 'armor/heavy_shoulders.glb' },
  { id: 'medium_torso', label: 'Brigandine cuirass', slot: 'torso', kind: 'skinned', url: 'armor/medium_torso.glb' },
];

export const getArmorPiece = (id: string): ArmorPiece | undefined => ARMOR_PIECES.find((p) => p.id === id);

/**
 * Pieces to render for a body, minus any this family is excluded from.
 *
 * FEMALE BODIES WEAR NOTHING FOR NOW. Every piece in the wardrobe was authored on male
 * anatomy, and skinning cannot fix that: binding to a body's own skeleton re-proportions a
 * garment by BONE SPACING, so it follows wider shoulders or a longer torso, but a chest and
 * waist shape that live in the MESH have no bones to move — a male cuirass stays a male
 * cuirass on a female body and reads as armour bolted onto the wrong torso. Nabil's call
 * 2026-08-08: "lets just remove all armor from female models, they wont work as the anatomy
 * on them is male". Female variants are queued for the Tripo credit reset; when they land,
 * this gate becomes a per-piece female URL rather than an early return.
 */
export function resolveArmor(
  ids: string[] | undefined,
  family: ModelRace,
  // Widened to the app's CharacterGender, which includes 'nonbinary'. Only 'female' is gated:
  // a nonbinary character renders on the male-proportioned body, so it wears the male-authored
  // pieces correctly and there is nothing to suppress.
  gender: 'male' | 'female' | 'nonbinary' = 'male',
): ArmorPiece[] {
  if (!ids?.length || gender === 'female') return [];
  return ids
    .map(getArmorPiece)
    .filter((p): p is ArmorPiece => !!p && !p.excludeFamilies?.includes(family));
}

/**
 * Live fit for a SKINNED garment — the dev tuning loop.
 *
 * Offline `skin-garment.mjs` bakes a fit, but judging one by rebuilding, re-optimising and
 * re-screenshotting is a ~90-second round trip per guess, and numbers alone have repeatedly
 * disagreed with what actually looks right. These four values are applied live in the real
 * viewport instead, so the fit can be dialled in by eye against real animation, then baked.
 *
 * Applied in the garment's own authored space, about its bounding-box centre:
 *   scale  uniform size
 *   girth  extra width+depth only (the offline `--ease`)
 *   dy/dz  centimetres up and forward
 */
export type GarmentFit = { scale: number; girth: number; dy: number; dz: number };
export const DEFAULT_GARMENT_FIT: GarmentFit = { scale: 1, girth: 1, dy: 0, dz: 0 };
export const GARMENT_FIT_EVENT = 'garmentfit';
const garmentFitKey = (id: string) => `garmentFit:${id}`;

export function loadGarmentFit(id: string): GarmentFit {
  try {
    const raw = localStorage.getItem(garmentFitKey(id));
    if (!raw) return DEFAULT_GARMENT_FIT;
    return { ...DEFAULT_GARMENT_FIT, ...JSON.parse(raw) };
  } catch { return DEFAULT_GARMENT_FIT; }
}

export function saveGarmentFit(id: string, fit: GarmentFit) {
  try { localStorage.setItem(garmentFitKey(id), JSON.stringify(fit)); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(GARMENT_FIT_EVENT, { detail: { id, fit } }));
}

export function clearGarmentFit(id: string) {
  try { localStorage.removeItem(garmentFitKey(id)); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(GARMENT_FIT_EVENT, { detail: { id, fit: DEFAULT_GARMENT_FIT } }));
}
