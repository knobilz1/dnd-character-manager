import type { Character } from '../types';

/** FNV-1a 32-bit — fast, deterministic, good distribution for short strings */
function fnv1a(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/**
 * Returns an 8-character hex checksum of the character's gameplay data.
 * Excludes `id`, `createdAt`, and `updatedAt` (metadata, not game state)
 * so the hash only changes when something meaningful changes.
 */
export function hashCharacter(char: Character): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id, createdAt, updatedAt, ...data } = char;
  const keys = Object.keys(data).sort();
  const json = JSON.stringify(data, keys);
  return fnv1a(json).toString(16).padStart(8, '0');
}
