/**
 * Structural invariants over the 5e content data.
 *
 * These are the checks that used to exist only as one-off sweeps in tools/audit
 * (and therefore only ran when someone remembered). Every failure mode below has
 * actually shipped at least once — see AUDIT-FINDINGS.md:
 *
 *  - duplicate ids: a 2024 Druid picking Circle of Stars silently received the
 *    2014 TCE subclass, because every lookup is a first-wins `.find()` (G3/G12).
 *  - a BookId that isn't in BOOKS: 65 entries became permanently unreachable in
 *    every picker, with no error anywhere (B1).
 *  - a dangling spell id: an always-prepared spell that resolves to nothing just
 *    doesn't appear, which reads as "the subclass has no spells" (R16 family).
 *
 * Nothing here needs the rulebook PDFs, so it is cheap enough to run in CI on
 * every push — unlike the tools/audit sweeps, which compare against the books.
 */
import { describe, it, expect } from 'vitest';
import { ALL_RACES } from './races';
import { ALL_CLASSES } from './classes';
import { ALL_SUBCLASSES } from './subclasses';
import { ALL_SPELLS } from './spells';
import { ALL_FEATS } from './feats';
import { ALL_ITEMS } from './items';
import { ALL_BACKGROUNDS } from './backgrounds';
import { BOOKS } from './books';

/** Each registry with the field its lookups actually key on. Everything is
 *  `id` except items, which are templates looked up by `name` (ItemTemplate has
 *  no id) — so a duplicate *name* is the item-shaped version of the same
 *  first-wins-`.find()` bug. */
const REGISTRIES: Record<string, { entries: Array<Record<string, unknown>>; key: 'id' | 'name' }> = {
  races: { entries: ALL_RACES as never, key: 'id' },
  classes: { entries: ALL_CLASSES as never, key: 'id' },
  subclasses: { entries: ALL_SUBCLASSES as never, key: 'id' },
  spells: { entries: ALL_SPELLS as never, key: 'id' },
  feats: { entries: ALL_FEATS as never, key: 'id' },
  items: { entries: ALL_ITEMS as never, key: 'name' },
  backgrounds: { entries: ALL_BACKGROUNDS as never, key: 'id' },
};

/** Ids that appear more than once in a list, with how many times. */
function duplicates(ids: string[]): Record<string, number> {
  const seen = new Map<string, number>();
  for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1);
  return Object.fromEntries([...seen].filter(([, n]) => n > 1));
}

describe('content registries', () => {
  it.each(Object.entries(REGISTRIES))('%s: every lookup key is unique', (_name, { entries, key }) => {
    expect(duplicates(entries.map(e => String(e[key])))).toEqual({});
  });

  it.each(Object.entries(REGISTRIES))('%s: every entry has a non-empty key and name', (_name, { entries, key }) => {
    const bad = entries.filter(e => !String(e[key] ?? '').trim() || !String(e.name ?? '').trim());
    expect(bad.map(e => e[key] ?? '(missing)')).toEqual([]);
  });

  /** A sourceBook the registry has never heard of hides the entry everywhere,
   *  silently — bookEnabled() simply never matches it. */
  it.each(Object.entries(REGISTRIES))('%s: every sourceBook/alsoIn is a registered book', (_name, { entries, key }) => {
    const known = new Set<string>(BOOKS.map(b => String(b.id)));
    const bad: string[] = [];
    for (const e of entries) {
      const label = String(e[key]);
      if (e.sourceBook && !known.has(String(e.sourceBook))) bad.push(`${label} → ${String(e.sourceBook)}`);
      for (const b of (e.alsoIn as string[] | undefined) ?? []) {
        if (!known.has(String(b))) bad.push(`${label} → alsoIn ${String(b)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('cross-references resolve', () => {
  it('every subclass belongs to a real class', () => {
    const classIds = new Set(ALL_CLASSES.map(c => c.id));
    const orphans = ALL_SUBCLASSES
      .filter(s => !classIds.has(s.classId))
      .map(s => `${s.id} → ${s.classId}`);
    expect(orphans).toEqual([]);
  });

  it('every subclass spell grant names a real spell', () => {
    const spellIds = new Set(ALL_SPELLS.map(s => s.id));
    const dangling: string[] = [];
    for (const sc of ALL_SUBCLASSES) {
      const byLevel: Record<number, string[]>[] = [];
      if (sc.alwaysPreparedSpells) byLevel.push(sc.alwaysPreparedSpells);
      if (sc.expandedSpells) byLevel.push(sc.expandedSpells);
      for (const land of Object.values(sc.landSpells ?? {})) byLevel.push(land);
      for (const table of byLevel) {
        for (const ids of Object.values(table)) {
          for (const id of ids) if (!spellIds.has(id)) dangling.push(`${sc.id} → ${id}`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });

  it('every racial innate spell names a real spell', () => {
    const spellIds = new Set(ALL_SPELLS.map(s => s.id));
    const dangling: string[] = [];
    for (const race of ALL_RACES as Array<{ id: string; innateSpells?: Array<{ spellId: string }> }>) {
      for (const inn of race.innateSpells ?? []) {
        if (!spellIds.has(inn.spellId)) dangling.push(`${race.id} → ${inn.spellId}`);
      }
    }
    expect(dangling).toEqual([]);
  });

  /** The instrument check the audit README insists on: if these registries were
   *  empty, every assertion above would pass while proving nothing. */
  it('the registries are actually populated', () => {
    for (const [name, { entries }] of Object.entries(REGISTRIES)) {
      expect(entries.length, `${name} is empty — the checks above prove nothing`).toBeGreaterThan(0);
    }
    expect(ALL_SPELLS.length).toBeGreaterThan(400);
    expect(ALL_SUBCLASSES.length).toBeGreaterThan(100);
  });
});
