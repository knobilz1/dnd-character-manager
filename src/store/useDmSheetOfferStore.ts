import { create } from 'zustand';

/**
 * useDmSheetOfferStore — "the DM has a newer copy of your character".
 *
 * The week after someone misses a session, their own device holds a sheet
 * that predates everything that happened to their character: a whole night of
 * damage, spent slots and loot lives only on the DM's machine, because whoever
 * ran them was pushing from a different device. The moment the returning
 * player reconnects, their untouched sheet would push straight over it.
 *
 * The DM reports the `updatedAt` of its copy on the narration poll that
 * already runs (see useDmNarrationFeed) — one integer, so nothing heavy moves
 * until the player actually accepts. This store is just the handoff between
 * that poll and the banner on the sheet.
 *
 * Deliberately an OFFER, never an automatic pull. A player who levelled up or
 * bought gear between sessions would otherwise have that silently replaced by
 * the DM's copy — the same bug in the other direction, and harder to notice.
 *
 * Not persisted: it's a fact about right now, re-derived on the next poll.
 */
interface DmSheetOfferState {
  /** The DM's copy of the character whose sheet is currently open. */
  remote: { name: string; updatedAt: number } | null;
  /** A remote timestamp the player has already declined, so it stops asking. */
  declined: number;
  setRemote: (name: string, updatedAt: number | null) => void;
  decline: () => void;
  /** Undo a decline — the player changed their mind. Without this "Keep mine" is a
   *  one-way door: nothing asks again until the DM's copy happens to move. */
  reopen: () => void;
}

export const useDmSheetOfferStore = create<DmSheetOfferState>()((set, get) => ({
  remote: null,
  declined: 0,

  setRemote: (name, updatedAt) => {
    const cur = get().remote;
    if (updatedAt == null) {
      if (cur) set({ remote: null });
      return;
    }
    // Same values every 3 seconds otherwise — don't churn subscribers.
    if (cur && cur.name === name && cur.updatedAt === updatedAt) return;
    set({ remote: { name, updatedAt } });
  },

  decline: () => set((s) => ({ declined: s.remote?.updatedAt ?? s.declined })),

  reopen: () => set({ declined: 0 }),
}));
