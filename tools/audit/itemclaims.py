"""Judge item findings by PAIRING like with like, instead of asking whether a token is present.

The token sweep is a filter and it is now a good one — magic items sit at 99-100% recall, so a
wrong value almost never escapes it. What it cannot do is tell a BUG from a PARAPHRASE: "the app
says 3d6 and this window does not contain 3d6" is equally true when the app is wrong and when the
book simply worded it differently.

Exact text comparison cannot settle that either, because the app paraphrases rather than quotes —
diffing the two would flag all 785 entries. What settles it is comparing like with like: if the app
claims a die and the entry states exactly one die, those two values are talking about the same
thing and can be compared directly. That is how Investiture of Wind was confirmed (app 3d10, entry
holds only 2d10) and how Tasha's Caustic Brew was cleared (app 2d4, entry holds 2d4 twice).

Prints values only — never book prose — so the copyright rule holds while still being decisive.

Verdicts:
  CONFLICT   entry states exactly one value of that kind and it is NOT the app's   <- likely bug
  PRESENT    the app's value IS in the entry; the sweep's window missed it         <- tool artifact
  ABSENT     entry states no value of that kind at all                             <- unjudgeable
  AMBIGUOUS  entry states several; cannot pair without reading                     <- needs a human

Usage: ENTITY_BUNDLE=<items.mjs> python tools/audit/itemclaims.py [book]
"""
import bisect
import math
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
import entitypdf as E  # noqa: E402
import r6verify as V  # noqa: E402
from racepdf import debook, flat, trait_variants  # noqa: E402
from featpdf import content_words, feat_chapter, locate  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# Each token kind, and how to read every value of that kind out of the book's entry. Pairing is only
# meaningful within a kind: a die can be compared with a die, never with a distance.
KINDS = (
    ('die', re.compile(r'^\d+d\d+$'), re.compile(r'\b\d+d\d+\b')),
    ('distance', re.compile(r'^\d+ft$'), re.compile(r'\b(\d+)\s*(?:feet|foot|ft)\b')),
    ('dc', re.compile(r'^dc\d+$'), re.compile(r'\bDC\s*(\d+)\b', re.I)),
)


def kind_of(tok):
    for name, is_tok, _ in KINDS:
        if is_tok.match(tok):
            return name
    return None


def book_values(kind, seg):
    for name, _, rx in KINDS:
        if name == kind:
            return sorted({(m.group(0) if name == 'die' else
                            (m.group(1) + 'ft' if name == 'distance' else 'dc' + m.group(1)))
                           .lower().replace(' ', '')
                           for m in rx.finditer(seg)})
    return []


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    rows = E.entities('item')
    _, findings, _, _, _, _ = E.sweep(rows, only)
    by = {(f[1], f[2]): f for f in findings if f[0] == 'MECHANICS NOT IN SOURCE'}

    books, out = {}, {'CONFLICT': [], 'PRESENT': [], 'ABSENT': [], 'AMBIGUOUS': []}
    for e in rows:
        key = (e['name'], e['book'])
        if key not in by:
            continue
        if e['book'] not in books:
            raw = V.book_text(E.BOOK_PDF[e['book']])
            book, idx = V._flatten(raw)
            sib = sorted({flat(v) for x in rows if x['book'] == e['book']
                          for v in trait_variants(x['name']) if len(flat(v)) >= 4})
            c = Counter(re.findall(r'[a-z]{4,}', raw.lower()))
            books[e['book']] = (raw, book, idx, sib,
                                E._item_marks(e['book'], raw, book, idx, sib),
                                feat_chapter(book, raw, idx, sib),
                                {w: 1.0 / (1.0 + math.log(1 + n)) for w, n in c.items()})
        raw, book, idx, sib, marks, chapter, weight = books[e['book']]
        names = [flat(v) for v in trait_variants(e['name']) if len(flat(v)) >= 4]
        pos = E.item_entry(book, raw, idx, names, marks, content_words(e['d']), weight)
        anchored = pos is not None
        if pos is None:
            keys = [flat(x['name']) for x in rows
                    if x['book'] == e['book'] and x['name'] != e['name'] and flat(x['name'])]
            pos = locate(book, raw, idx, names, keys, content_words(e['d']), chapter, weight)
        if pos is None:
            continue
        j = bisect.bisect_right(marks, pos)
        end = marks[j] if j < len(marks) else pos + 1400
        seg = debook(raw[idx[pos]: idx[min(len(idx) - 1, min(end, pos + 1400))]])

        for tok in sorted(set(by[key][4].replace('app states ', '').split(', '))):
            kind = kind_of(tok)
            if kind is None:
                continue                       # ability names, damage types — not pairable
            vals = book_values(kind, seg)
            tag = ('PRESENT' if tok in vals else
                   'ABSENT' if not vals else
                   'CONFLICT' if len(vals) == 1 else 'AMBIGUOUS')
            out[tag].append((e['name'], e['book'], tok, vals, anchored))

    for tag in ('CONFLICT', 'AMBIGUOUS', 'PRESENT', 'ABSENT'):
        lst = out[tag]
        print(f'\n## {tag} ({len(lst)})')
        for nm, bid, tok, vals, anch in lst[:40]:
            mark = '' if anch else '  [no entry anchor - locator fallback]'
            print(f'  - {nm} [{bid}] app {tok} | entry has {vals or "none"}{mark}')
        if len(lst) > 40:
            print(f'  … {len(lst) - 40} more')


if __name__ == '__main__':
    main()
