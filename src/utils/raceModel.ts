/**
 * Returns the 3D model URL for a given race ID.
 *
 * Currently only one human model exists. As new race models are added to
 * public/models/, register them here. All unknown races fall back to human.
 *
 * Future:
 *   'tiefling'   → '/models/Tiefling_Idle_Textured.fbx'
 *   'dragonborn' → '/models/Dragonborn_Idle_Textured.fbx'
 *   etc.
 */
const RACE_MODELS: Record<string, string> = {
  // human + common subraces → same human model
  human: '/models/Human_Idle_Textured.fbx',
};

const FALLBACK_MODEL = '/models/Human_Idle_Textured.fbx';

export function getRaceModelUrl(raceId: string): string {
  // Normalise: strip variant suffixes like '-variant', check prefix matches too
  if (RACE_MODELS[raceId]) return RACE_MODELS[raceId];
  // Walk prefix: e.g. 'human-mark-of-finding' → 'human'
  const prefix = raceId.split('-')[0];
  return RACE_MODELS[prefix] ?? FALLBACK_MODEL;
}
