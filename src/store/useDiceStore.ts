import { create } from 'zustand';

export type RollDie = 4 | 6 | 8 | 10 | 12 | 20 | 100;

export interface PendingRoll {
  die: RollDie;
  modifier: number;
  label: string;
  mode?: 'normal' | 'advantage' | 'disadvantage';
  nonce: number; // increments so the same params still re-trigger
}

interface DiceStoreState {
  pending: PendingRoll | null;
  openNonce: number; // increments to force the panel open externally
  triggerRoll: (die: RollDie, modifier: number, label: string, mode?: 'normal' | 'advantage' | 'disadvantage') => void;
  openPanel: () => void;
  consume: () => PendingRoll | null;
}

export const useDiceStore = create<DiceStoreState>((set, get) => ({
  pending: null,
  openNonce: 0,

  triggerRoll: (die, modifier, label, mode) =>
    set(s => ({
      pending: { die, modifier, label, mode, nonce: (s.pending?.nonce ?? 0) + 1 },
    })),

  openPanel: () => set(s => ({ openNonce: s.openNonce + 1 })),

  consume: () => {
    const p = get().pending;
    if (p) set({ pending: null });
    return p;
  },
}));
