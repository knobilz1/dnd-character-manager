import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Character } from '../types';
import { hashCharacter } from '../utils/hashCharacter';

export interface Snapshot {
  id: string;
  characterId: string;
  timestamp: number;
  label: string;
  hash: string;
  data: Character;
}

interface SnapshotState {
  snapshots: Snapshot[];
  saveSnapshot: (char: Character, label: string) => void;
  deleteSnapshot: (id: string) => void;
  snapshotsFor: (characterId: string) => Snapshot[];
}

const MAX_PER_CHARACTER = 30;

export const useSnapshotStore = create<SnapshotState>()(
  persist(
    (set, get) => ({
      snapshots: [],

      saveSnapshot: (char, label) => {
        const snapshot: Snapshot = {
          id: crypto.randomUUID(),
          characterId: char.id,
          timestamp: Date.now(),
          label,
          hash: hashCharacter(char),
          data: structuredClone(char),
        };
        set(state => {
          const mine = [snapshot, ...state.snapshots.filter(s => s.characterId === char.id)]
            .slice(0, MAX_PER_CHARACTER);
          const others = state.snapshots.filter(s => s.characterId !== char.id);
          return { snapshots: [...others, ...mine] };
        });
      },

      deleteSnapshot: (id) =>
        set(state => ({ snapshots: state.snapshots.filter(s => s.id !== id) })),

      snapshotsFor: (characterId) =>
        get().snapshots
          .filter(s => s.characterId === characterId)
          .sort((a, b) => b.timestamp - a.timestamp),
    }),
    { name: 'dnd_cm_snapshots_v1' }
  )
);
