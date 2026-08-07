import { ALL_SPELLS } from '../data/spells';
import type { Spell } from '../types';
import type { EffectFamily, PlacedEffect, PlaceEffectRequest } from './dmActions';
import { parseSpellArea, parseDurationRounds } from './spellArea';

/**
 * Resolves a `placeEffect` dm-action into a concrete PlacedEffect: looks the spell
 * up, parses its real geometry and duration, and picks a visual family.
 *
 * Kept out of DMConsolePage so the parse-and-look-up path is testable on its own —
 * the console only stores what comes back.
 */

// Spells whose look isn't obvious from damage type or school. Everything else falls
// through to the damage-type/school heuristic below.
const FAMILY_OVERRIDES: Record<string, EffectFamily> = {
  'web': 'web',
  'entangle': 'nature',
  'spike-growth': 'nature',
  'grease': 'necrotic',
  'plant-growth': 'nature',
  'wall-of-thorns': 'nature',
  'darkness': 'necrotic',
  'maddening-darkness': 'necrotic',
  'hunger-of-hadar': 'necrotic',
  'evards-black-tentacles': 'necrotic',
  'fog-cloud': 'fog',
  'stinking-cloud': 'poison',
  'cloudkill': 'poison',
  'silence': 'force',
  'zone-of-truth': 'force',
  'wall-of-force': 'force',
  'moonbeam': 'radiant',
  'spirit-guardians': 'radiant',
  'daylight': 'radiant',
  'sickening-radiance': 'radiant',
  'sleet-storm': 'cold',
  'wall-of-ice': 'cold',
  'storm-sphere': 'lightning',
  'call-lightning': 'lightning',
  'create-bonfire': 'fire',
  'flaming-sphere': 'fire',
  'wall-of-fire': 'fire',
};

const DAMAGE_FAMILY: Record<string, EffectFamily> = {
  fire: 'fire',
  cold: 'cold',
  poison: 'poison',
  acid: 'poison',
  radiant: 'radiant',
  necrotic: 'necrotic',
  force: 'force',
  psychic: 'force',
  lightning: 'lightning',
  thunder: 'lightning',
};

function familyFor(spell: Spell): EffectFamily {
  const override = FAMILY_OVERRIDES[spell.id];
  if (override) return override;
  const byDamage = spell.damageType ? DAMAGE_FAMILY[spell.damageType.toLowerCase()] : undefined;
  if (byDamage) return byDamage;
  if (spell.school === 'Conjuration') return 'fog';
  if (spell.school === 'Evocation') return 'radiant';
  return 'force';
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Spell id or display name → the spell record. The model is told to send ids, but
 *  names come through often enough to be worth accepting. */
function findSpell(query: string): Spell | undefined {
  const q = slug(query);
  return ALL_SPELLS.find((s) => s.id === q) ?? ALL_SPELLS.find((s) => slug(s.name) === q);
}

export interface ResolveFailure { reason: 'unknown-spell' | 'no-area' | 'instantaneous'; query: string }

/**
 * Returns the effect to place, or a reason it was rejected. Instantaneous spells are
 * refused on purpose: a Fireball leaves nothing on the map, and drawing one would
 * park a permanent orange circle where a one-shot blast happened.
 */
export function resolvePlacedEffect(
  req: PlaceEffectRequest,
  castRound: number,
  existingIds: readonly string[],
): { effect: PlacedEffect } | { failure: ResolveFailure } {
  const spell = findSpell(req.spell);
  if (!spell) return { failure: { reason: 'unknown-spell', query: req.spell } };
  if (/instantaneous/i.test(spell.duration)) return { failure: { reason: 'instantaneous', query: spell.name } };
  const area = parseSpellArea(spell);
  if (!area) return { failure: { reason: 'no-area', query: spell.name } };

  const base = spell.id;
  let n = 1;
  while (existingIds.includes(`${base}-${n}`)) n++;

  const effect: PlacedEffect = {
    id: `${base}-${n}`,
    name: spell.name,
    shape: area.shape,
    ft: area.ft,
    at: { q: req.at.q, r: req.at.r },
    castRound,
    durationRounds: parseDurationRounds(spell.duration),
    family: familyFor(spell),
  };
  if (area.widthFt !== undefined) effect.widthFt = area.widthFt;
  if (req.angle !== undefined) effect.angleDeg = req.angle;
  return { effect };
}

/** Effects whose duration has run out at `round`. Effects with a null duration never
 *  expire on the clock — the DM removes them. */
export function isExpired(effect: PlacedEffect, round: number): boolean {
  return effect.durationRounds !== null && round >= effect.castRound + effect.durationRounds;
}
