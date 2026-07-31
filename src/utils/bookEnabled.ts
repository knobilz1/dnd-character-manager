import type { BookId } from '../types';

/**
 * Returns true if the item's sourceBook OR any of its alsoIn books is in the
 * enabled-books collection. Accepts either an array or a Set for flexibility.
 *
 * `hidden` entries are never offered. The check lives here rather than at the call sites
 * because every picker in the app already routes through this one predicate — all 24 callers
 * are availability filters, none render an already-chosen entry, so hiding here can't make a
 * feature disappear from a character who already has it.
 */
export function bookEnabled(
  item: { sourceBook: BookId; alsoIn?: BookId[]; hidden?: boolean },
  enabledBooks: BookId[] | Set<BookId>,
): boolean {
  if (item.hidden) return false;
  const set = enabledBooks instanceof Set ? enabledBooks : new Set(enabledBooks);
  return set.has(item.sourceBook) || (item.alsoIn?.some(b => set.has(b)) ?? false);
}
