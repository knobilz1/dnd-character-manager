import type { Spell } from '../types';

/**
 * Structured area geometry recovered from spell prose.
 *
 * The Spell type carries no structured area field — the shape and size live only in
 * `description` / `range` text. The prose is regular enough to parse ("20-foot-radius
 * sphere", "20-foot cube", "Self (15-foot cone)"), with a small exception table for the
 * irregulars. `ft` is the spell's RADIUS for sphere/cylinder and the SIDE/LENGTH for
 * cube/line/cone — callers converting to grid cells must remember a radius spans
 * 2*ft/cellFeet cells across (10-ft radius = 4 squares, not 2: radius vs diameter).
 */
export interface SpellArea {
  shape: 'sphere' | 'cylinder' | 'cube' | 'cone' | 'line';
  ft: number;
  /** Lines only: width in feet (default 5). */
  widthFt?: number;
}

// Irregular prose the regexes below would misread. Checked against the book text.
const AREA_EXCEPTIONS: Record<string, SpellArea> = {
  'flaming-sphere': { shape: 'sphere', ft: 2.5 }, // "5-foot-diameter sphere" — one cell
  'leomund-tiny-hut': { shape: 'sphere', ft: 10 }, // hemisphere
  // Walls, v1: drawn as straight lines (ring forms deferred).
  'wall-of-fire': { shape: 'line', ft: 60, widthFt: 5 },
  'wall-of-stone': { shape: 'line', ft: 60, widthFt: 5 },
  'wall-of-force': { shape: 'line', ft: 60, widthFt: 5 },
  'wall-of-thorns': { shape: 'line', ft: 60, widthFt: 5 },
  'wall-of-ice': { shape: 'line', ft: 60, widthFt: 5 },
  'prismatic-wall': { shape: 'line', ft: 90, widthFt: 5 },
  'wind-wall': { shape: 'line', ft: 50, widthFt: 5 },
  'blade-barrier': { shape: 'line', ft: 100, widthFt: 5 },
};

export function parseSpellArea(spell: Pick<Spell, 'id' | 'range' | 'description'>): SpellArea | null {
  const ex = AREA_EXCEPTIONS[spell.id];
  if (ex) return ex;

  const range = spell.range ?? '';
  const desc = spell.description ?? '';

  // Range forms first — "Self (15-foot cone)" is authoritative when present.
  let m = /Self \((\d+)-foot cone\)/i.exec(range);
  if (m) return { shape: 'cone', ft: +m[1] };
  m = /Self \((\d+)-foot line\)/i.exec(range);
  if (m) return { shape: 'line', ft: +m[1], widthFt: 5 };
  m = /Self \((\d+)-foot[- ]radius\)/i.exec(range);
  if (m) return { shape: 'sphere', ft: +m[1] };

  // Description forms, most specific first.
  m = /(\d+)-foot-diameter sphere/i.exec(desc);
  if (m) return { shape: 'sphere', ft: +m[1] / 2 };
  m = /(\d+)-foot[- ]radius,? *(?:\d+)-foot-(?:high|tall) cylinder/i.exec(desc);
  if (m) return { shape: 'cylinder', ft: +m[1] };
  m = /cylinder with a (\d+)-foot radius/i.exec(desc); // sleet-storm reverses the order
  if (m) return { shape: 'cylinder', ft: +m[1] };
  m = /(\d+)-foot[- ]radius/i.exec(desc);
  if (m) return { shape: 'sphere', ft: +m[1] };
  m = /(\d+)-foot (?:cube|square)/i.exec(desc);
  if (m) return { shape: 'cube', ft: +m[1] };
  m = /(\d+)-foot cone/i.exec(desc);
  if (m) return { shape: 'cone', ft: +m[1] };
  m = /line (?:that is )?(\d+) feet long and (\d+) f(?:ee|oo)t wide/i.exec(desc);
  if (m) return { shape: 'line', ft: +m[1], widthFt: +m[2] };
  m = /a line (\d+) feet long/i.exec(desc);
  if (m) return { shape: 'line', ft: +m[1], widthFt: 5 };

  return null;
}

/**
 * Duration prose → combat rounds (6s each). null = no automatic expiry (instantaneous
 * spells never reach the effect system; "Until dispelled"/8-hour spells outlive any
 * fight and are removed by the DM instead).
 */
export function parseDurationRounds(duration: string): number | null {
  const d = duration ?? '';
  let m = /(\d+) round/i.exec(d);
  if (m) return +m[1];
  m = /(\d+) minute/i.exec(d);
  if (m) return +m[1] * 10;
  // Hours and longer never expire on the initiative clock.
  return null;
}
