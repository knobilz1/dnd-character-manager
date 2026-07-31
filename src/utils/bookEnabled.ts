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
  // Copy even when handed a Set: the 2024 widening below adds to this collection, and adding to
  // the caller's own Set would silently mutate their state (several callers pass a memoised Set).
  const set = new Set(enabledBooks);
  // Selecting the 2024 edition REPLACES 'PHB' with 'PHB2024' (StepBooks.tsx selectPhbEdition —
  // the two ids are mutually exclusive and toggle() refuses to re-add PHB). But the shared option
  // data — invocations, metamagic, maneuvers, fighting styles, pact boons — is all tagged with the
  // 2014 book it was first printed in and carries no alsoIn. Without this widening the filter is
  // arithmetically guaranteed to return an empty list for every 2024 class, so a 2024 sorcerer had
  // no metamagic to choose from, a 2024 warlock no invocations, and so on — silently, because the
  // level-up gate treats an unsatisfiable requirement as satisfied.
  // One-directional on purpose: a 2014 character must never see 2024 content.
  // StepSpells.tsx already did exactly this locally for the spell list; this lifts it to the one
  // predicate every picker in the app shares.
  if (set.has('PHB2024')) set.add('PHB');
  return set.has(item.sourceBook) || (item.alsoIn?.some(b => set.has(b)) ?? false);
}
