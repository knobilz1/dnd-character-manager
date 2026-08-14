/**
 * Resolve advantage/disadvantage for a triggered roll.
 *
 * Both at once cancel to a straight roll (PHB p.173: they never stack, and one of
 * each means you roll normally), and so does neither — which is why this returns
 * `undefined` rather than a boolean pair.
 *
 * Shared rather than copied: the sheet and the sidebar both offer attack rolls,
 * and the sidebar's copy of the surrounding logic had already drifted far enough
 * to pass no mode at all.
 */
export function rollMode(adv: boolean, dis: boolean): 'advantage' | 'disadvantage' | undefined {
  if (adv === dis) return undefined;
  return adv ? 'advantage' : 'disadvantage';
}
