"""Upcasting: check the DIE AGAINST ITS CLAUSE, not against a bag of tokens.

`entitypdf --kind=spell` reduces a spell to a SET of mechanical tokens and asks whether each one
appears somewhere in the book's window. That is the right shape for most claims and it is
structurally blind to one thing: which die belongs to which sentence. Swapping Fireball's base and
upcast dice — "1d6 base, increases by 8d6 per slot level", a catastrophic bug — produces an
IDENTICAL token set and can never be reported.

The other half of the same blindness: 172 of 547 spells name a slot level in their upcast line
("for each slot level above 1st") and MECH extracts nothing at all from it, because ordinals are
not mechanical vocabulary. Adding them to MECH would not work either — "3rd" appears on nearly
every page of a rulebook, so the requirement would be satisfied by any window whatsoever. That is
the same trap as a control value that is always present: a token that can never be missing tests
nothing.

So this compares STRUCTURE. Both sides are parsed into (die, threshold) and the pairs are matched.

Two checks, and they are worth different amounts:

  SELF   the app's threshold vs the app's own spell level. Needs no book, so it covers every spell
         including the ones no PDF can reach. 143 have a threshold; 3 disagree, and all 3 were
         verified as faithful transcriptions of ToB, which prints a 3rd-level spell scaling
         "above 2nd". The app is right and the third-party book is sloppy.

  BOOK   the app's upcast die vs the book's upcast die, from the same clause. 82 spells state one,
         72 have a clause the book states too. Control: 100% of those 72, 87% of all 82 — the gap
         is coverage, not detection, and is printed rather than hidden.

STATE 2026-08-01 — 6 findings became 1 once the window was bounded by the source's own structure
rather than by a character count, which is the fix the item sweep still owes:
  FIXED   Pulse Wave [EGtW] scaled by 2d6, book says 1d6 · Gravity Fissure [EGtW] 2d8, book 1d8.
          Both confirmed by the BASE damage die sitting in the same bounded entry, which proves the
          clause belongs to that spell and not a neighbour.
  APP OK  Rime's Binding Ice, Tasha's Caustic Brew, Screaming Wind — all reported only because the
          window reached 100 characters BACK into the previous entry's At Higher Levels line.
  OPEN    Mind Spike [XGtE]: its own entry holds 3d8 and 1d6 and no 1d8 anywhere, so the book reads
          as scaling by 1d6 while the app says 1d8. 1d8 is the pattern every other same-die spell
          follows, and 6/8 is a plausible OCR confusion, so this needs a human to look at the page.
          NOT changed on the strength of one damaged source.

Usage: ENTITY_BUNDLE=<bundled .mjs> python tools/audit/spellupcast.py [book] [--control]
"""
import math
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
import entitypdf as E  # noqa: E402
import r6verify as V  # noqa: E402
from racepdf import debook, flat, trait_variants  # noqa: E402
from featpdf import content_words  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# "the damage increases by 1d6 for each slot level above 3rd" — the books' fixed idiom, and the
# app's house style follows it. Anchored on the verb so a stray die elsewhere in the sentence
# cannot be mistaken for the scaling one.
UPCAST = re.compile(r'increas\w*\s+by\s+(?:an?\s+)?(\d+d\d+)', re.I)
THRESHOLD = re.compile(r'above\s+(\d+)(?:st|nd|rd|th)', re.I)


def app_upcast(row):
    """(die, threshold) as the APP states them, or (None, None)."""
    line = (row['d'] or '').split('\n')[-1]
    die = UPCAST.search(line)
    thr = THRESHOLD.search(line)
    return (die.group(1).lower() if die else None,
            int(thr.group(1)) if thr else None)


def main():
    only = next((a for a in sys.argv[1:] if not a.startswith('--')), None)
    control = '--control' in sys.argv
    rows = E.entities('spell')
    lvl = {}
    for r in rows:                       # spell level, straight off the bundle
        lvl[(r['name'], r['book'])] = r.get('level')
    if control:
        # Corrupt the upcast die only. A control that also moved the base die would be detected by
        # the token sweep and prove nothing about THIS check.
        rows = [dict(r, d=UPCAST.sub(lambda m: m.group(0).replace(m.group(1),
                     re.sub(r'd(\d+)', lambda d: 'd' + {'4': '6', '6': '8', '8': '10', '10': '12',
                                                        '12': '20', '20': '12'}.get(d.group(1),
                                                                                    d.group(1)),
                            m.group(1))), r['d'])) for r in rows]

    self_bad, book_bad, checked, located, corrupted, caught = [], [], 0, 0, set(), set()
    books = {}
    for e in rows:
        if only and e['book'] != only:
            continue
        die, thr = app_upcast(e)
        if not die:
            continue
        checked += 1
        if control:
            corrupted.add(e['name'])
        # SELF — no book needed.
        mylvl = lvl.get((e['name'], e['book']))
        if thr is not None and mylvl is not None and thr != mylvl:
            self_bad.append((e['name'], e['book'], mylvl, thr))
        # BOOK — the same clause, parsed out of the source.
        pdf = E.BOOK_PDF.get(e['book'])
        if not pdf or not os.path.exists(os.path.join(V.REF, pdf)):
            continue
        if e['book'] not in books:
            raw = V.book_text(pdf)
            book, idx = V._flatten(raw)
            c = Counter(re.findall(r'[a-z]{4,}', raw.lower()))
            books[e['book']] = (raw, book, idx,
                                {w: 1.0 / (1.0 + math.log(1 + n)) for w, n in c.items()})
        raw, book, idx, weight = books[e['book']]
        names = [flat(v) for v in trait_variants(e['name']) if len(flat(v)) >= 4]
        if not names:
            continue
        pos = E.spell_entry(book, raw, idx, names, E._ct_marks(e['book'], book),
                            content_words(e['d']), weight)
        if pos is None:
            continue
        # Bounded at the NEXT spell's header, not at a fixed width. A fixed 2,200-char window
        # reported Vitriolic Sphere and Tasha's Caustic Brew — both of which the app states
        # correctly — because it ran into the following entry and read ITS scaling clause. This is
        # the structural fix the item sweep still owes: let the source's own entry boundary end the
        # window, so a neighbour cannot answer for this entry however the width is tuned.
        marks = E._ct_marks(e['book'], book)
        nxt = next((c for c in marks if c > pos + 60), len(idx) - 1)
        # No back-reach. A spell entry BEGINS at its name, so reading even 100 characters earlier
        # can only pick up the previous entry's tail — which is where its At Higher Levels line
        # sits. That reported Rime's Binding Ice, Tasha's Caustic Brew and Screaming Wind, all
        # three of which state their upcast die correctly and have it in their own entry.
        a, b = pos, min(len(idx) - 1, min(nxt, pos + 2200))
        found = {m.group(1).lower() for m in UPCAST.finditer(debook(raw[idx[a]: idx[b]]))}
        if not found:
            continue                     # book states no scaling clause here — nothing to compare
        located += 1
        if die not in found:
            book_bad.append((e['name'], e['book'], die, sorted(found)))
            caught.add(e['name'])

    if control:
        print(f'CONTROL[upcast die]: {len(corrupted)} corrupted, {len(caught)} detected '
              f'({100 * len(caught) // max(1, len(corrupted))}% of all, '
              f'{100 * len(caught) // max(1, located)}% of those whose clause was found in the book)')
        return

    print(f'# {checked} spells state an upcast die; {located} had a scaling clause '
          f'found in the book to compare against\n')
    print(f'## SELF — app threshold vs the app\'s own spell level ({len(self_bad)})')
    for n, b, mylvl, thr in self_bad:
        print(f'  - **{n}** [{b}] level {mylvl} but scales "above {thr}"')
    print(f'\n## BOOK — app upcast die not the book\'s ({len(book_bad)})')
    for n, b, die, found in book_bad:
        print(f'  - **{n}** [{b}] app scales by {die}, book scales by {", ".join(found)}')


if __name__ == '__main__':
    main()
