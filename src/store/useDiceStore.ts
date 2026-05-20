import { create } from 'zustand';

export type RollDie = 4 | 6 | 8 | 10 | 12 | 20 | 100;

export interface PendingRoll {
  die: RollDie;
  modifier: number;
  label: string;
  nonce: number; // increments so the same params still re-trigger
}

interface DiceStoreState {
  pending: PendingRoll | null;
  triggerRoll: (die: RollDie, modifier: number, label: string) => void;
  consume: () => PendingRoll | null;
}

export const useDiceStore = create<DiceStoreState>((set, get) => ({
  pending: null,

  triggerRoll: (die, modifier, label) =>
    set(s => ({
      pending: { die, modifier, label, nonce: (s.pending?.nonce ?? 0) + 1 },
    })),

  consume: () => {
    const p = get().pending;
    if (p) set({ pending: null });
    return p;
  },
}));
