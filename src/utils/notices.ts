/**
 * The DM console's error/warning list.
 *
 * It was two single slots — one error, one warning — so the next thing that went
 * wrong erased the last one. A failed map render followed by a failed memory
 * write showed only the memory write, and nobody learned the map had gone. That
 * matters more here than in most UIs: during a live session the DM is looking at
 * the table, not the screen, so a message that was up for two seconds was never
 * shown at all.
 *
 * Pure so the rules below can be tested without rendering a 6,800-line console.
 */

export type NoticeKind = 'error' | 'warning';

export interface Notice {
  id: number;
  kind: NoticeKind;
  text: string;
}

/** How many undismissed notices to keep. Enough to show that several things went
 *  wrong, few enough that a failing poll can't bury the console under retries. */
export const MAX_NOTICES = 4;

/**
 * Adds one notice, or clears every notice of `kind` when `text` is null — which
 * is what the old `setError(null)` did, and why call sites didn't have to change.
 *
 * De-duplicated by (kind, text): a retry loop that fails the same way forty times
 * is one problem, and showing it forty times would push everything else out. The
 * repeat moves to the end rather than being dropped, so the newest occurrence is
 * what the DM sees at the bottom of the list.
 */
export function pushNotice(prev: Notice[], kind: NoticeKind, text: string | null, nextId: number): Notice[] {
  if (text === null) return prev.filter((n) => n.kind !== kind);
  const withoutDupe = prev.filter((n) => !(n.kind === kind && n.text === text));
  return [...withoutDupe, { id: nextId, kind, text }].slice(-MAX_NOTICES);
}

/** Drops one notice by id — the click-to-dismiss path. */
export function dismissNotice(prev: Notice[], id: number): Notice[] {
  return prev.filter((n) => n.id !== id);
}
