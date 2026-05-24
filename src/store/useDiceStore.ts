import { create } from 'zustand';

export type RollDie = 4 | 6 | 8 | 10 | 12 | 20 | 100;

export interface PendingRoll {
  die: RollDie;
  modifier: number;
  label: string;
  mode?: 'normal' | 'advantage' | 'disadvantage';
  nonce: number; // increments so the same params still re-trigger
}

/** Broadcast by DiceRoller when any roll settles. Subscribers use the nonce
 *  to deduplicate (ignore if nonce hasn't changed). */
export interface RollResult {
  value: number;
  die: RollDie;
  label: string;
  nonce: number;
}

interface DiceStoreState {
  pending: PendingRoll | null;
  openNonce: number; // increments to force the panel open externally
  lastResult: RollResult | null;
  triggerRoll: (die: RollDie, modifier: number, label: string, mode?: 'normal' | 'advantage' | 'disadvantage') => void;
  openPanel: () => void;
  consume: () => PendingRoll | null;
  /** Called by DiceRoller the moment a roll settles (after animation). */
  publishResult: (value: number, die: RollDie, label: string) => void;
}

export const useDiceStore = create<DiceStoreState>((set, get) => ({
  pending: null,
  openNonce: 0,
  lastResult: null,

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

  publishResult: (value, die, label) =>
    set(s => ({
      lastResult: { value, die, label, nonce: (s.lastResult?.nonce ?? 0) + 1 },
    })),
}));
