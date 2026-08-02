"""PHB equipment weights vs the equipment TABLES — the claim mundane gear actually makes.

The item sweep reads prose windows, and PHB equipment barely has prose: 253 entries of rope,
torches and rations whose whole content is a table row. That is why it sits at 69% plausible while
magic items reach 93-100%, and it is the same shape the background sweep had before it was fixed —
comparing the wrong thing, then reporting a number that looks like coverage.

What equipment states is tabular: name, cost, weight. The app keeps `weight`, so that is comparable.

Anchoring matters more than the comparison. The first version took the first "lb" within 150
characters of the name and reported 13 disagreements, every one of them the app being right and the
matcher reading the NEXT row — PHB scale mail is 45 lb, Lock is 1 lb. Requiring the COST column
between the name and the weight ties the number to this item's own row. Two more corrections after
that: the app writes "Arcane focus (orb)" where the PHB prints a category heading followed by a row
called simply "Orb" (matching the category lands on Crystal, 1 lb), and OCR renders "1½ lb" as a
bare "1/2", which made Crossbow bolts (20) look like an eighth of their real weight.

Usage: ENTITY_BUNDLE=<items.mjs> python tools/audit/itemweight.py [--control]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import entitypdf as E  # noqa: E402
import r6verify as V  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')


def compare(rows, book_id='PHB'):
    """(matched, agreements, disagreements as (name, app, book))."""
    raw = V.book_text(E.BOOK_PDF[book_id])
    book, idx = V._flatten(raw)
    matched, agree, bad = 0, 0, []
    for e in rows:
        if e['book'] != book_id or not e.get('weight'):
            continue
        w = E.row_weight(book, raw, idx, E.weight_names(e['name']))
        if w is None:
            continue
        matched += 1
        if abs(w - e['weight']) < 1e-6:
            agree += 1
        else:
            bad.append((e['name'], e['weight'], w))
    return matched, agree, bad


def main():
    rows = E.entities('item')
    if '--control' in sys.argv:
        # Corrupt every weight to a DIFFERENT plausible weight. Doubling is the right corruption
        # here: the books are full of 1, 2, 4, 8 lb items, so a doubled weight is a value the table
        # column genuinely contains elsewhere — the plausible control's whole point.
        bad_rows = [dict(e, weight=(e['weight'] * 2 if e.get('weight') else e.get('weight')))
                    for e in rows]
        changed = {e['name'] for e in rows if e.get('weight') and e['book'] == 'PHB'}
        matched, agree, bad = compare(bad_rows)
        flagged = {n for n, _, _ in bad}
        # Only entries the matcher could reach are testable; say so rather than averaging them in.
        m2, _, _ = compare(rows)
        print(f'CONTROL[weight x2]: {len(changed)} corrupted, {len(changed & flagged)} detected')
        print(f'  of the {m2} whose row the matcher can find: '
              f'{100 * len(changed & flagged) // max(1, m2)}%')
        print(f'  unreachable rows (never compared, so never detectable): {len(changed) - m2}')
        return

    matched, agree, bad = compare(rows)
    total = sum(1 for e in rows if e['book'] == 'PHB' and e.get('weight'))
    print(f'# PHB equipment weights\n')
    print(f'  entries with a weight : {total}')
    print(f'  row found in a table  : {matched}')
    print(f'  agree with the book   : {agree}')
    print(f'  DISAGREE              : {len(bad)}\n')
    for nm, app, bk in bad:
        print(f'  - {nm}: app {app} lb, book {bk} lb')


if __name__ == '__main__':
    main()
