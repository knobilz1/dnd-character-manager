import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Character } from '../types';

/**
 * useBorrowedStore — characters this device is running on someone else's
 * behalf tonight.
 *
 * When a player can't make it, the table can hand their character to whoever
 * is sitting next to them (see the roll call in DMConsolePage). The DM lends
 * the sheet over LAN and it lands here.
 *
 * It is deliberately NOT useLibraryStore, and that is the whole point of the
 * file. useDriveStore uploads useLibraryStore to the signed-in user's Google
 * Drive — so a borrowed character put in the library would sync someone else's
 * sheet into the borrower's personal cloud backup, permanently, for a character
 * they were only holding for one evening.
 *
 * Keeping the two apart also means the two windows a proxying player has open
 * (their own sheet, and the borrowed one) write to different localStorage keys.
 * WebView2 doesn't deliver cross-window `storage` events reliably — see
 * TableView.tsx, which polls instead — so disjoint writers is what makes the
 * second window safe rather than luck.
 */
/** WebviewWindow label prefix for a borrowed sheet's own window. The label is
 *  how the app tells the two windows apart at runtime — see useDmPushSync,
 *  which uses it to decide which store this window is allowed to push. */
export const BORROWED_WINDOW_PREFIX = 'borrowed-';

interface BorrowedState {
  borrowed: Character[];
  /** Mirrors useLibraryStore's method name so useCharacterStore.save() can
   *  branch on ownership without caring which store it ended up in. */
  updateCharacter: (c: Character) => void;
  upsert: (c: Character) => void;
  has: (id: string) => boolean;
  /** Drop anyone no longer assigned, and report which of `names` we don't hold
   *  yet so the caller can go fetch them. Names are compared lowercased and
   *  trimmed, the same key the DM and party.md use. */
  reconcile: (names: string[]) => string[];
  clear: () => void;
}

const key = (s: string) => s.trim().toLowerCase();

export const useBorrowedStore = create<BorrowedState>()(
  persist(
    (set, get) => ({
      borrowed: [],

      updateCharacter: (c) =>
        set((s) => ({ borrowed: s.borrowed.map((b) => (b.id === c.id ? { ...c, updatedAt: Date.now() } : b)) })),

      upsert: (c) =>
        set((s) => {
          const idx = s.borrowed.findIndex((b) => b.id === c.id || key(b.name) === key(c.name));
          if (idx === -1) return { borrowed: [...s.borrowed, c] };
          const next = [...s.borrowed];
          next[idx] = c;
          return { borrowed: next };
        }),

      has: (id) => get().borrowed.some((b) => b.id === id),

      reconcile: (names) => {
        const wanted = new Set(names.map(key));
        const held = get().borrowed;
        const keep = held.filter((b) => wanted.has(key(b.name)));
        if (keep.length !== held.length) set({ borrowed: keep });
        const haveNames = new Set(keep.map((b) => key(b.name)));
        return names.filter((n) => !haveNames.has(key(n)));
      },

      clear: () => set({ borrowed: [] }),
    }),
    { name: 'dnd_cm_borrowed_v1' }
  )
);
