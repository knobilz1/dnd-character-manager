import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Character } from '../types';

const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface LibraryState {
  characters: Character[];
  /** Tombstone map: characterId → deletion timestamp (ms). Used for multi-device sync. */
  deletedIds: Record<string, number>;
  createCharacter: (c: Character) => void;
  updateCharacter: (c: Character) => void;
  deleteCharacter: (id: string) => void;
  sendToGraveyard: (id: string) => void;
  /** Removes tombstone entries older than 30 days. Call on app start and after each sync. */
  pruneOldTombstones: () => void;
  /** Replaces the full character list and tombstone map (used by Drive restore / merge). */
  setLibraryFromDrive: (characters: Character[], deletedIds: Record<string, number>) => void;
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set) => ({
      characters: [],
      deletedIds: {},

      createCharacter: (c) =>
        set((s) => ({ characters: [...s.characters, c] })),

      updateCharacter: (c) =>
        set((s) => ({
          characters: s.characters.map((ch) =>
            ch.id === c.id ? { ...c, updatedAt: Date.now() } : ch
          ),
        })),

      deleteCharacter: (id) =>
        set((s) => ({
          characters: s.characters.filter((c) => c.id !== id),
          deletedIds: { ...s.deletedIds, [id]: Date.now() },
        })),

      sendToGraveyard: (id) =>
        set((s) => ({
          characters: s.characters.map((c) =>
            c.id === id ? { ...c, inGraveyard: true, updatedAt: Date.now() } : c
          ),
        })),

      pruneOldTombstones: () =>
        set((s) => {
          const cutoff = Date.now() - TOMBSTONE_TTL_MS;
          const pruned: Record<string, number> = {};
          for (const [id, ts] of Object.entries(s.deletedIds)) {
            if (ts > cutoff) pruned[id] = ts;
          }
          return { deletedIds: pruned };
        }),

      setLibraryFromDrive: (characters, deletedIds) =>
        set({ characters, deletedIds }),
    }),
    { name: 'dnd_cm_library_v1' }
  )
);
