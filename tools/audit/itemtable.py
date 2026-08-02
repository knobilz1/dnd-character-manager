"""PHB weapon and armor claims vs the equipment TABLES.

itemweight.py fixed one column of this. The prose sweep reads PHB equipment at 69% plausible
because 253 entries of rope and rations have no prose to read — but 49 of them are weapons and
armor, and those DO make mechanical claims. They just make them in a table, not a paragraph:

    Armor    | Cost | Armor Class (AC)      | Strength | Stealth      | Weight
    Weapon   | Cost | Damage                | Weight   | Properties

The app keeps those claims inside `description` in a fixed shorthand — "1d8 slashing. Versatile
(1d10)." / "AC 14 + Dex modifier (max 2). Disadvantage on Stealth checks." — so both sides parse
to comparable fields and nothing has to be matched as text.

Anchoring is the whole problem, exactly as it was for weight: the first version took the first
dice within 150 characters of the name and agreed with everything, because the next row's dice is
as good a match as this row's. Requiring the COST column between the name and the value ties the
read to this item's own row. Weapon properties sit AFTER the weight column, so the window has to
run past `lb` to the next row rather than stopping at the first number.

Cost itself is not checked: ItemTemplate has no cost field, so the app never claims one.

Known matcher limits — the app is right and the read is wrong in all three; do not re-investigate:
  Leather armor  — lands on Padded's row (both parse AC 11 / 8 lb, and 8 lb is Padded's weight),
                   so it inherits Padded's Stealth disadvantage. Leather has none.
  Plate armor    — never reaches the Heavy Armor row at all: its own row is preceded by
                   Breastplate and Half plate, both correctly rejected as longer names, and the
                   next cost-bearing "plate" is ~110k characters further into the book. Parses no
                   AC, so its Stealth read is empty rather than wrong.
  Crossbow, heavy — the one row of 49 the matcher cannot find. Reported as unreachable, not passed.

Both controls read 100% until Net's description gained the words "5 slashing damage", and then 97%.
That is not a regression: Net's Damage column is "—", so the table states no damage type for it and
the corrupted one has nothing to disagree with. The clause is a Special-rules claim, which this
sweep does not read. Left at 97% rather than excluded — a control tuned until it reports 100% is
measuring the tuning, and fighting styles already read a false 100% that way once.

Prints parsed values only, never book text.

Usage: ENTITY_BUNDLE=<items.mjs> python tools/audit/itemtable.py [--control [--plausible]]
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import entitypdf as E  # noqa: E402
import r6verify as V  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

COST = re.compile(r'\d+(?:,\d+)?\s*(?:cp|sp|ep|gp|pp)\b', re.I)
DICE = re.compile(r'(\d+)\s?[dD]\s?(\d+)')
DMG_TYPE = re.compile(r'\b(bludgeoning|piercing|slashing)\b', re.I)
PROPS = ('ammunition', 'finesse', 'heavy', 'light', 'loading', 'reach',
         'special', 'thrown', 'two-handed', 'versatile')

# How far past the name the row can run. Weapons need the properties column, which is the last one
# and the widest; armor needs only through Stealth. Both stop at the next row in practice because
# the parse keys on position, not on greedy matching.
SPAN = {'weapon': 230, 'armor': 200}


def row_text(book, raw, idx, names, span, others=(), others_flat=()):
    """Raw text of this item's own table row, or None.

    Requires the cost column inside the window: that is what distinguishes a table row from the
    same word appearing in a chapter's prose, and what stops the read drifting into the next row.
    """
    for n in names:
        start = 0
        while True:
            i = book.find(n, start)
            if i < 0:
                break
            start = i + 1
            # A stem match can land INSIDE a longer name: "Plate armor" found "plate" in
            # "Breastplate" and read Breastplate's row, reporting Plate as having no Stealth
            # penalty. The flat index has no spaces, so there is no word boundary to test against
            # — checking for a non-letter before the match rejected 39 of 49 rows, because every
            # name abuts the previous column. What works is asking whether a LONGER known name
            # covers this same match.
            if any(len(o) > len(n) and book[i + len(n) - len(o): i + len(n)] == o
                   for o in others_flat):
                continue
            j = min(len(idx) - 1, i + len(n))
            seg = E.debook(raw[idx[j]: idx[min(len(idx) - 1, i + len(n) + span)]])
            m = COST.search(seg[:40])
            if m:
                # Right edge matters as much as the anchor. Without one the properties column —
                # the last and widest — runs straight into the following rows, and every weapon
                # came back carrying the union of its neighbours' properties (Lance as finesse,
                # ammunition AND two-handed). Each row holds exactly one cost, so the next cost is
                # where this row ends.
                rest = seg[m.end():]
                nxt = COST.search(rest)
                rest = rest[:nxt.start()] if nxt else rest
                # The next row's NAME sits before its cost, so cutting at the cost still leaves it
                # attached — which is why Javelin came back "light" (the next row is Light hammer)
                # and Spear too (Crossbow, light). Cut at the next row name instead. Locating by
                # names while testing properties keeps the two disjoint.
                ends = [mm.start() for o in others
                        for mm in [re.search(rf'\b{re.escape(o)}\b', rest, re.I)] if mm]
                return rest[:min(ends)] if ends else rest
    return None


def row_names(name):
    """Row names to try, longest first.

    The armor table's rows are "Padded", "Leather", "Studded leather", "Hide", "Splint" — the app
    writes "Padded armor". Six of the twelve armors were unreachable for exactly this reason, and
    an unreachable row is one the controls score as a miss rather than a pass, so it shows up as
    lost detection rather than as a matching bug. Trying the stem is safe here because the cost
    column still has to follow within 40 characters, which a bare "hide" in prose never does.
    """
    out = [E.flat(name)]
    stem = re.sub(r'\s+armor$', '', name, flags=re.I)
    if stem != name:
        out.append(E.flat(stem))
    out += [n for n in E.weight_names(name) if n not in out]
    return out


def app_weapon(desc):
    d = DICE.search(desc)
    ver = re.search(r'versatile\s*\((\d+)\s?d\s?(\d+)\)', desc, re.I)
    t = DMG_TYPE.search(desc)
    return {
        'die': f'{d.group(1)}d{d.group(2)}' if d else None,
        'type': t.group(1).lower() if t else None,
        'versatile': f'{ver.group(1)}d{ver.group(2)}' if ver else None,
        'props': {p for p in PROPS if re.search(rf'\b{re.escape(p)}\b', desc, re.I)},
    }


def book_weapon(seg):
    """Damage sits before the weight column; properties after it. Split on `lb` so a versatile or
    thrown die in the properties column can never be mistaken for the damage die."""
    cut = re.search(r'\blb\.?', seg, re.I)
    dmg_col, prop_col = (seg[:cut.start()], seg[cut.end():]) if cut else (seg, '')
    d = DICE.search(dmg_col)
    t = DMG_TYPE.search(dmg_col)
    ver = re.search(r'versatile\s*\((\d+)\s?d\s?(\d+)\)', prop_col, re.I)
    return {
        'die': f'{d.group(1)}d{d.group(2)}' if d else None,
        'type': t.group(1).lower() if t else None,
        'versatile': f'{ver.group(1)}d{ver.group(2)}' if ver else None,
        'props': {p for p in PROPS if re.search(rf'\b{re.escape(p)}\b', prop_col, re.I)},
    }


def app_armor(desc):
    ac = re.search(r'\bAC\s*(\d+)', desc, re.I)
    cap = re.search(r'max\s*(\d+)', desc, re.I)
    strq = re.search(r'Str\s*(\d+)', desc, re.I)
    return {
        'ac': int(ac.group(1)) if ac else None,
        'dex': 'cap' + cap.group(1) if cap else ('dex' if re.search(r'Dex', desc, re.I) else 'none'),
        'str': int(strq.group(1)) if strq else None,
        'stealth': bool(re.search(r'disadvantage', desc, re.I)),
    }


def book_armor(seg):
    ac = re.search(r'^\D{0,4}(\d+)', seg)
    cap = re.search(r'max\s*(\d+)', seg, re.I)
    strq = re.search(r'Str\s*(\d+)', seg, re.I)
    return {
        'ac': int(ac.group(1)) if ac else None,
        'dex': 'cap' + cap.group(1) if cap else ('dex' if re.search(r'Dex', seg, re.I) else 'none'),
        'str': int(strq.group(1)) if strq else None,
        'stealth': bool(re.search(r'disadvantage', seg, re.I)),
    }


def compare(rows, book_id='PHB'):
    raw = V.book_text(E.BOOK_PDF[book_id])
    book, idx = V._flatten(raw)
    reached, agree, bad = 0, 0, []
    table_names = [e['name'] for e in rows
                   if e['book'] == book_id and e.get('category') in SPAN]
    for e in rows:
        cat = e.get('category')
        if e['book'] != book_id or cat not in SPAN or not e.get('d'):
            continue
        others = [re.sub(r'\s+armor$', '', o, flags=re.I) for o in table_names if o != e['name']]
        seg = row_text(book, raw, idx, row_names(e['name']), SPAN[cat], others,
                       [E.flat(o) for o in others] + [E.flat(o) for o in table_names
                                                     if o != e['name']])
        if seg is None:
            continue
        reached += 1
        a = app_weapon(e['d']) if cat == 'weapon' else app_armor(e['d'])
        b = book_weapon(seg) if cat == 'weapon' else book_armor(seg)
        # A field the book row does not state is not a disagreement — it is an unreachable column.
        diff = {k: (a[k], b[k]) for k in a
                if b.get(k) not in (None, set()) and a[k] != b[k]}
        if diff:
            bad.append((e['name'], diff))
        else:
            agree += 1
    return reached, agree, bad


def corrupt(rows, plausible):
    """Corrupt the description's mechanical values, leaving the identity words alone."""
    out, changed = [], set()
    for e in rows:
        d = e.get('d') or ''
        if e['book'] != 'PHB' or e.get('category') not in SPAN or not d:
            out.append(e)
            continue
        if plausible:
            # Values the tables genuinely contain elsewhere: a d8 weapon becomes a d10 weapon, a
            # slashing weapon becomes piercing, AC 14 becomes AC 15.
            n = DICE.sub(lambda m: f'{m.group(1)}d{ {4:6,6:8,8:10,10:12,12:6}.get(int(m.group(2)), 8) }', d)
            n = DMG_TYPE.sub(lambda m: {'slashing': 'piercing', 'piercing': 'bludgeoning',
                                        'bludgeoning': 'slashing'}[m.group(1).lower()], n)
            n = re.sub(r'\bAC (\d+)', lambda m: f'AC {int(m.group(1)) + 1}', n)
        else:
            n = DICE.sub(lambda m: f'{m.group(1)}d92', d)
            n = DMG_TYPE.sub('radiant', n)
            n = re.sub(r'\bAC (\d+)', 'AC 93', n)
        if n != d:
            changed.add(e['name'])
        out.append(dict(e, d=n))
    return out, changed


def main():
    rows = E.entities('item')
    if '--control' in sys.argv:
        mode = 'plausible' if '--plausible' in sys.argv else 'impossible'
        bad_rows, changed = corrupt(rows, mode == 'plausible')
        reached, _, bad = compare(bad_rows)
        flagged = {n for n, _ in bad}
        clean_reached, _, _ = compare(rows)
        print(f'CONTROL[{mode}]: {len(changed)} corrupted, {len(changed & flagged)} detected')
        print(f'  of the {clean_reached} whose row the matcher can find: '
              f'{100 * len(changed & flagged) // max(1, clean_reached)}%')
        print(f'  unreachable rows (never compared, so never detectable): '
              f'{len(changed) - clean_reached}')
        missed = sorted(changed - flagged)
        print('  missed: none' if not missed else f'  MISSED ({len(missed)}): ' + ', '.join(missed))
        return

    reached, agree, bad = compare(rows)
    total = sum(1 for e in rows if e['book'] == 'PHB' and e.get('category') in SPAN)
    print('# PHB weapon + armor table claims\n')
    print(f'  weapons/armor in the app : {total}')
    print(f'  row found in a table     : {reached}')
    print(f'  agree with the book      : {agree}')
    print(f'  DISAGREE                 : {len(bad)}\n')
    for nm, diff in bad:
        for k, (a, b) in diff.items():
            print(f'  - {nm} [{k}]: app {a!r}, book {b!r}')


if __name__ == '__main__':
    main()
