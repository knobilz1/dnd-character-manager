import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Character } from '../types';

export interface Snapshot {
  id: string;
  characterId: string;
  timestamp: number;
  label: string;
  saveNumber: number;
  data: Character;
}

interface SnapshotState {
  snapshots: Snapshot[];
  nextSaveNumber: Record<string, number>;
  saveSnapshot: (char: Character, label: string) => void;
  deleteSnapshot: (id: string) => void;
  importSnapshots: (characterId: string, snaps: Snapshot[]) => void;
  snapshotsFor: (characterId: string) => Snapshot[];
}

const MAX_PER_CHARACTER = 30;

export const useSnapshotStore = create<SnapshotState>()(
  persist(
    (set, get) => ({
      snapshots: [],
      nextSaveNumber: {},

      saveSnapshot: (char, label) => {
        const next = (get().nextSaveNumber[char.id] ?? 1);
        const snapshot: Snapshot = {
          id: crypto.randomUUID(),
          characterId: char.id,
          timestamp: Date.now(),
          label,
          saveNumber: next,
          data: structuredClone(char),
        };
        set(state => {
          const mine = [snapshot, ...state.snapshots.filter(s => s.characterId === char.id)]
            .slice(0, MAX_PER_CHARACTER);
          const others = state.snapshots.filter(s => s.characterId !== char.id);
          return {
            snapshots: [...others, ...mine],
            nextSaveNumber: { ...state.nextSaveNumber, [char.id]: next + 1 },
          };
        });
      },

      deleteSnapshot: (id) =>
        set(state => ({ snapshots: state.snapshots.filter(s => s.id !== id) })),

      importSnapshots: (characterId, snaps) => {
        if (snaps.length === 0) return;
        const maxNum = Math.max(...snaps.map(s => s.saveNumber ?? 0));
        const remapped = snaps.map(s => ({
          ...s,
          id: crypto.randomUUID(),
          characterId,
        }));
        set(state => {
          const others = state.snapshots.filter(s => s.characterId !== characterId);
          return {
            snapshots: [...others, ...remapped],
            nextSaveNumber: { ...state.nextSaveNumber, [characterId]: maxNum + 1 },
          };
        });
      },

      snapshotsFor: (characterId) =>
        get().snapshots
          .filter(s => s.characterId === characterId)
          .sort((a, b) => b.timestamp - a.timestamp),
    }),
    { name: 'dnd_cm_snapshots_v1' }
  )
);
