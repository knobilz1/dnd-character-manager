"""Phase J — PHB 2014 spell BODY numbers: damage dice, save ability, damage type.

Phase I verified every spell's header (level/school/ritual/CT/range/components/duration).
This is the other half: the numbers inside the description, which is where a wrong value actually
changes play.

Both sides are prose, so this compares extracted FACTS rather than text:
  * the set of dice tokens (1d6, 8d6, 2d8 …) in the app's description + atHigherLevels
    vs the same set from the book entry;
  * the app's `savingThrow` field vs the ability named in the book's save clause;
  * the app's `damageType` field vs the damage types the book names.

A dice-set difference is a strong signal but not automatically a bug — the extracts abbreviate, and
one side may mention a die the other omits as flavour. Everything is reported for eyeballing rather
than auto-judged, and the summary separates "app has dice the book doesn't" (the dangerous
direction — an invented number) from the reverse (usually the extract being terse).

Usage: python tools/audit/spellbody.py [nameFilter]
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from spellheaders import parse_spells, nname, MD  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

PHB = os.path.join(MD, 'phb-players-handbook.md')

DIE = re.compile(r'\b(\d{1,2})\s*d\s*(\d{1,3})\b', re.I)
ABIL = {'strength': 'str', 'dexterity': 'dex', 'constitution': 'con',
        'intelligence': 'int', 'wisdom': 'wis', 'charisma': 'cha',
        'str': 'str', 'dex': 'dex', 'con': 'con', 'int': 'int', 'wis': 'wis', 'cha': 'cha'}
DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
                'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder']


def dice(text):
    """Normalised dice tokens, e.g. {'8d6', '1d6'}."""
    return {f'{a}d{b}' for a, b in DIE.findall(text or '')}


def book_bodies():
    """name -> body text, for the PHB spell-description section."""
    md = open(PHB, encoding='utf-8').read()
    start = md.find('## Ch11: Spell Descriptions')
    seg = md[start:] if start >= 0 else md
    out = {}
    parts = re.split(r'^###\s+(.+?)\s*$', seg, flags=re.M)
    # parts = [pre, name1, body1, name2, body2, …]
    for i in range(1, len(parts) - 1, 2):
        name, body = parts[i], parts[i + 1]
        # drop the header line (the one with CT: / Range:) — Phase I already checks it
        body = re.sub(r'^\*[^*]+\*\s*\|.*$', '', body, count=1, flags=re.M)
        out[nname(name)] = body
    return out


def main():
    filt = (sys.argv[1] if len(sys.argv) > 1 else '').lower()
    spells = [s for s in parse_spells() if s['book'] == 'PHB']
    bodies = book_bodies()
    print(f'{len(spells)} PHB spells; {len(bodies)} book bodies parsed\n')

    considered = compared = notfound = 0
    app_only, book_only, save_diff, dmg_diff = [], [], [], []
    dice_clean = 0

    # the app carries these as structured fields, parsed straight out of the TS
    src = open('src/data/spells/index.ts', encoding='utf-8').read()

    def field_of(sid, name):
        m = re.search(r"id: '%s'.*?\b%s: '([^']*)'" % (re.escape(sid), name), src)
        return m.group(1) if m else None

    def desc_of(sid):
        m = re.search(r"id: '%s'.*?(?=\n)" % re.escape(sid), src)
        return m.group(0) if m else ''

    for s in spells:
        if filt and filt not in nname(s['name']):
            continue
        considered += 1
        body = bodies.get(nname(s['name']))
        if not body:
            notfound += 1
            continue
        compared += 1
        line = desc_of(s['id'])
        a, b = dice(line), dice(body)
        if a == b:
            dice_clean += 1
        else:
            if a - b:
                app_only.append(f"{s['name']}: app has {sorted(a - b)} | book {sorted(b) or '—'}")
            if b - a:
                book_only.append(f"{s['name']}: book has {sorted(b - a)} | app {sorted(a) or '—'}")
        # save ability
        want = field_of(s['id'], 'savingThrow')
        # Only a save the spell FORCES. "advantage on Dex saves" is a benefit the spell grants —
        # matching it made Haste, Beacon of Hope and Heroes' Feast look like they were missing a
        # save they never had.
        got = None
        for m in re.finditer(
                r'\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma|'
                r'Str|Dex|Con|Int|Wis|Cha)\s+sav\w*', body, re.I):
            before = body[max(0, m.start() - 30):m.start()].lower()
            if re.search(r'(dis)?advantage on(\s+all)?\s*$|succeeds? on\s*$|immune to\s*$', before):
                continue
            got = ABIL.get(m.group(1).lower())
            break
        if got and want and got != want:
            save_diff.append(f"{s['name']}: app save={want} book={got}")
        if got and not want:
            save_diff.append(f"{s['name']}: app save=NONE book={got}")
        # damage type
        wantd = field_of(s['id'], 'damageType')
        bookd = {d for d in DAMAGE_TYPES if re.search(r'\b%s damage\b' % d, body, re.I)}
        if wantd and bookd and wantd.lower() not in bookd:
            dmg_diff.append(f"{s['name']}: app damage={wantd} book={sorted(bookd)}")

    assert compared + notfound == considered, 'accounting broke'
    print(f'# considered={considered} compared={compared} notFound={notfound} '
          f'({100 * compared / considered:.1f}% coverage)')
    print(f'# dice sets identical on {dice_clean}/{compared} ({100 * dice_clean / max(compared,1):.1f}%)\n')

    for title, rows in (('APP HAS DICE THE BOOK DOES NOT (invented numbers — check these first)', app_only),
                        ('SAVE ABILITY DIFFERS', save_diff),
                        ('DAMAGE TYPE DIFFERS', dmg_diff),
                        ('BOOK HAS DICE THE APP DOES NOT (often the extract being terse)', book_only)):
        print(f'===== {title} ({len(rows)}) =====')
        for r in rows[:45]:
            print('  ' + r)
        if len(rows) > 45:
            print(f'  … and {len(rows) - 45} more')
        print()


if __name__ == '__main__':
    main()
