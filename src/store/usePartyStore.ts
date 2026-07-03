import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Character } from '../types';

/**
 * usePartyStore — the DM Console's working copy of the table.
 *
 * These are OTHER players' characters, pushed over LAN from their own Tavern
 * Sheet install (party_listener.rs → 'dm-party-character' event). They are kept
 * separate from useLibraryStore (the DM's own characters) so a receive never
 * mixes someone else's sheet into the DM's personal library.
 *
 * Session-scoped by design: DM actions (damage/heal/conditions) mutate this
 * copy directly. The player's own device remains their real source of truth —
 * re-sending overwrites the DM's copy with the player's latest saved state.
 */
interface PartyState {
  party: Character[];
  upsert: (character: Character) => void;
  remove: (id: string) => void;
  update: (id: string, patch: Partial<Character>) => void;
  clear: () => void;
}

export const usePartyStore = create<PartyState>()(
  persist(
    (set) => ({
      party: [],

      upsert: (character) =>
        set((s) => {
          const key = character.name.trim().toLowerCase();
          const idx = s.party.findIndex((c) => c.name.trim().toLowerCase() === key);
          if (idx === -1) return { party: [...s.party, character] };
          const next = [...s.party];
          next[idx] = character;
          return { party: next };
        }),

      remove: (id) => set((s) => ({ party: s.party.filter((c) => c.id !== id) })),

      update: (id, patch) =>
        set((s) => ({
          party: s.party.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        })),

      clear: () => set({ party: [] }),
    }),
    { name: 'dnd_cm_dm_party_v1' }
  )
);
