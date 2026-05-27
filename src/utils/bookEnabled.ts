import type { BookId } from '../types';

/**
 * Returns true if the item's sourceBook OR any of its alsoIn books is in the
 * enabled-books collection. Accepts either an array or a Set for flexibility.
 */
export function bookEnabled(
  item: { sourceBook: BookId; alsoIn?: BookId[] },
  enabledBooks: BookId[] | Set<BookId>,
): boolean {
  const set = enabledBooks instanceof Set ? enabledBooks : new Set(enabledBooks);
  return set.has(item.sourceBook) || (item.alsoIn?.some(b => set.has(b)) ?? false);
}
