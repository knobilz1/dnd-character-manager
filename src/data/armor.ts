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
import { modelRace, type ModelRace } from './hair';
import { GARMENT_SECTION_DATA } from './armorSections.generated';

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
  /** Baked-in section fit (see resolveGarmentSections). `sections` is the base every body gets;
   *  `sectionsByBody` keys are `<family>` or `<family>:<gender>` and merge over it. Dialled on
   *  /model-review, pasted here — data, not art. */
  sections?: GarmentSections;
  sectionsByBody?: Record<string, GarmentSections>;
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

/**
 * Per-SECTION live fit — named regions (neck hole, pauldron L/R, arm hole L/R, breastplate,
 * backplate, waist, hem), each a map of param -> CENTIMETRES of displacement. The region masks
 * and the deformation itself live in scripts/garment-sections.mjs, shared verbatim with the
 * offline baker (skin-garment.mjs --sections) so the panel and the bake cannot drift.
 *
 * Dev-only: applied on /model-review against the RAW (pre-meshopt) copy of the piece under
 * public/models/armor-dev/ — the shipped GLB is quantized, so its vertex data is not in cm and
 * cannot be sculpted directly. The dialled values are baked via the printed --sections arg.
 */
export type GarmentSections = Record<string, Record<string, number>>;
export const GARMENT_SECTIONS_EVENT = 'garmentsections';

/**
 * Section values resolve per BODY, base -> family -> family+gender, each layer merged over the
 * last. Skinning re-proportions a garment by BONE spacing, which is why one mesh serves 88
 * bodies — but two things it cannot know: silhouette that lives in the MESH (a giff's barrel
 * chest, a tortle's shell — same skeleton, different body), and that a centimetre dialled on
 * human is stretched by whatever the skinning does to that region elsewhere (the shipped piece
 * is ~0.056 file-units/cm; the deform is applied in the garment's authored space, so a +3cm
 * back push on human lands as more on a wider body). Hence per-race, per-gender residue —
 * measured per body, stored as DATA, applied at runtime. Still one mesh, no per-body art.
 *
 * Most bodies should need nothing: dial the outliers, let the rest inherit the base.
 */
export function resolveGarmentSections(
  piece: ArmorPiece, family: ModelRace, gender: string, override?: GarmentSections,
): GarmentSections {
  const merge = (a: GarmentSections, b?: GarmentSections) => {
    if (!b) return a;
    const out: GarmentSections = { ...a };
    for (const [sec, params] of Object.entries(b)) out[sec] = { ...out[sec], ...params };
    return out;
  };
  // Saved data first (written by the /model-review Save button), then any hand-authored literal
  // on the piece, then the live dev override for exactly this body.
  const saved = GARMENT_SECTION_DATA[piece.id];
  let out = merge({}, saved?.sections);
  out = merge(out, saved?.sectionsByBody?.[family]);
  out = merge(out, saved?.sectionsByBody?.[`${family}:${gender}`]);
  out = merge(out, piece.sections);
  out = merge(out, piece.sectionsByBody?.[family]);
  out = merge(out, piece.sectionsByBody?.[`${family}:${gender}`]);
  return merge(out, override);
}
/** Viewport -> panel: user clicked the garment; detail = { id, section } (max-weight section at
 *  the picked face). The panel opens that section's sliders. */
export const GARMENT_PICK_EVENT = 'garmentsectionpick';
/** Dev overrides are stored PER BODY (`<id>:<race>:<gender>`), because that is the grain the
 *  values are actually true at — see resolveGarmentSections. */
const garmentSectionsKey = (id: string, bodyKey?: string) =>
  bodyKey ? `garmentSections:${id}:${bodyKey}` : `garmentSections:${id}`;

export function loadGarmentSections(id: string, bodyKey?: string): GarmentSections {
  try { return JSON.parse(localStorage.getItem(garmentSectionsKey(id, bodyKey)) || '{}'); } catch { return {}; }
}

/** True when this body has its own dialled override (vs inheriting the base). */
export function hasGarmentSectionsOverride(id: string, bodyKey: string): boolean {
  try { return localStorage.getItem(garmentSectionsKey(id, bodyKey)) !== null; } catch { return false; }
}

export function saveGarmentSections(id: string, sections: GarmentSections, bodyKey?: string) {
  try { localStorage.setItem(garmentSectionsKey(id, bodyKey), JSON.stringify(sections)); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(GARMENT_SECTIONS_EVENT, { detail: { id, bodyKey, sections } }));
}

export function clearGarmentSections(id: string, bodyKey?: string) {
  try { localStorage.removeItem(garmentSectionsKey(id, bodyKey)); } catch { /* private mode */ }
  window.dispatchEvent(new CustomEvent(GARMENT_SECTIONS_EVENT, { detail: { id, bodyKey, sections: {} } }));
}

/**
 * Persist every dialled fit into the repo (src/data/armorSections.generated.ts) via the dev-only
 * vite endpoint, so what was tuned by eye becomes what ships — no copy-paste step.
 *
 * Collects from localStorage: the base key becomes `sections` (every body inherits it), each
 * per-body key becomes `sectionsByBody['<family>:<gender>']`. Existing saved data is carried
 * forward, so saving from one machine/session doesn't drop another body's entry.
 */
export async function saveGarmentSectionsToRepo(): Promise<{ ok: boolean; bodies?: number; error?: string }> {
  const out: Record<string, { sections?: GarmentSections; sectionsByBody?: Record<string, GarmentSections> }> = {};
  for (const [pieceId, data] of Object.entries(GARMENT_SECTION_DATA)) {
    out[pieceId] = {
      ...(data.sections ? { sections: data.sections } : {}),
      ...(data.sectionsByBody ? { sectionsByBody: { ...data.sectionsByBody } } : {}),
    };
  }
  /**
   * Drops empty SECTIONS but keeps zero-valued params: the panel only ever writes params this
   * body owns, and a deliberate 0 is how an inherited value gets cancelled. Pruning zeros here
   * (the first version did) made that cancellation vanish on save, so the inherited number came
   * straight back and the body looked untouched.
   */
  const strip = (s: GarmentSections) => {
    const kept: GarmentSections = {};
    for (const [sec, params] of Object.entries(s)) {
      if (params && Object.keys(params).length) kept[sec] = params;
    }
    return kept;
  };
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith('garmentSections:')) continue;
    const rest = key.slice('garmentSections:'.length);
    const [pieceId, race, gender] = rest.split(':');
    let sections: GarmentSections;
    try { sections = JSON.parse(localStorage.getItem(key) || '{}'); } catch { continue; }
    sections = strip(sections);
    const entry = (out[pieceId] ||= {});
    if (race && gender) {
      entry.sectionsByBody ||= {};
      if (Object.keys(sections).length) entry.sectionsByBody[`${race}:${gender}`] = sections;
      else delete entry.sectionsByBody[`${race}:${gender}`];
    } else if (Object.keys(sections).length) entry.sections = sections;
    else delete entry.sections;
  }
  try {
    const res = await fetch('/__save-garment-sections', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(out),
    });
    return await res.json();
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/**
 * What the panel should SHOW for a body: saved data (base -> family -> family:gender) with the
 * live dev override on top. Sliders reading zero while the armour is visibly fitted — which is
 * what raw override-only state looks like after a save — is a trap, so the panel seeds from the
 * resolved total and edits from there.
 */
export function resolvedSectionsForBody(pieceId: string, bodyKey: string): GarmentSections {
  const [raceId, gender = 'male'] = bodyKey.split(':');
  const piece = getArmorPiece(pieceId);
  if (!piece) return {};
  return resolveGarmentSections(piece, modelRace(raceId), gender, loadGarmentSections(pieceId, bodyKey));
}

/** Promote this body's dialled values to the BASE every body inherits. */
export function promoteGarmentSectionsToBase(id: string, bodyKey: string) {
  const mine = loadGarmentSections(id, bodyKey);
  saveGarmentSections(id, mine);                    // base key
  window.dispatchEvent(new CustomEvent(GARMENT_SECTIONS_EVENT, { detail: { id, bodyKey, sections: mine } }));
}
