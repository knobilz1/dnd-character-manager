"""G8: give the twelve PHB 2024 classes their starting equipment.

getClassStartingEquipment() looks up by exact classId, so 'barbarian-2024' matched nothing and every
2024 character began with an empty inventory. Falling back to baseClassId() would have been a
one-line fix and WRONG: the 2024 rules replaced the 2014 per-slot picks with a small number of
complete packages ("(A) Greataxe + 4 Handaxes + Explorer's Pack + 15 gp; (B) 75 gp"), so the 2014
list is not merely differently phrased, it is different equipment. Showing it would present wrong
data as right, which is worse than showing nothing.

Parsed from phb2024-players-handbook.md. Item categories and weights are inherited from the entries
the 2014 file already carries, matched by name, and anything that fails to resolve is REPORTED
rather than guessed — a silently miscategorised item would break encumbrance and the equip toggle.
"""
import re, io, sys, os, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
os.chdir(r'C:\Users\nabil\Desktop\Code\dnd-character-manager')

BOOK = r'C:\Users\nabil\Desktop\Code\reference-books\md\phb2024-players-handbook.md'
SRC = 'src/data/startingEquipment.ts'

book = open(BOOK, encoding='utf-8').read()
lines = book.split('\n')

# Map each "Starting Equipment" line to the class whose section it sits in, by walking back to the
# nearest "## <Class> (...)" heading. Deliberately not by assuming the lines come in class order.
CLASSES = ['Barbarian', 'Bard', 'Cleric', 'Druid', 'Fighter', 'Monk', 'Paladin', 'Ranger',
           'Rogue', 'Sorcerer', 'Warlock', 'Wizard']
found = {}
for i, ln in enumerate(lines):
    if not ln.startswith('**Starting Equipment:**'):
        continue
    for j in range(i, -1, -1):
        m = re.match(r'^#{2,3}\s+([A-Za-z]+)\s*\(', lines[j])
        if m and m.group(1) in CLASSES:
            found.setdefault(m.group(1).lower(), ln)
            break
assert len(found) == 12, 'expected 12 classes, resolved %d: %s' % (len(found), sorted(found))
print('resolved %d class equipment lines from the book' % len(found))

# ---- item metadata already known to the app ------------------------------
src = open(SRC, encoding='utf-8').read()
known = {}
for m in re.finditer(r"\{ name: '((?:[^'\\]|\\.)*)',([^}]*)\}", src):
    name = m.group(1).replace("\\'", "'")
    rest = m.group(2)
    cat = re.search(r"category: '([^']+)'", rest)
    wt = re.search(r"weight: ([\d.]+)", rest)
    if cat:
        known.setdefault(name.lower(), (cat.group(1), float(wt.group(1)) if wt else None))

CATEGORY_HINTS = [
    (r"pack$", 'pack'), (r"armor$|chain shirt|chain mail|studded leather|robe", 'armor'),
    (r"^shield$", 'shield'), (r"tools$|kit$|supplies$", 'tool'),
    (r"focus|holy symbol|spellbook|book|instrument", 'gear'),
    (r"arrows|quiver", 'gear'),
]


# The book pluralises quantities ("4 Handaxes", "8 Javelins") and names weapons the 2014 starting
# lists never happened to include (Flail, Sickle, Spear, Greatsword). Letting those fall through to
# 'gear' would be the worst outcome available: WeaponAttacksPanel filters on category === 'weapon',
# so a 2024 fighter's greatsword would silently never appear as an attack.
# src/data/items.ts is the authority: it carries the canonical DISPLAY name, the category and a real
# weight. Matching against it also CORRECTS the name — the book writes "8 Javelins", and both the
# weapon-attack panel and the equip toggle resolve items by name, so storing the plural would leave
# a real weapon permanently unrecognised.
catalog = {}
for m in re.finditer(r"\{ name: '((?:[^'\\]|\\.)*)', category: '([^']+)'(?:, weight: ([\d.]+))?",
                     open('src/data/items.ts', encoding='utf-8').read()):
    nm = m.group(1).replace("\\'", "'")
    catalog[nm.lower()] = (nm, m.group(2), float(m.group(3)) if m.group(3) else None)


def resolve(name):
    """-> (category, weight, canonical name). Never guesses a category silently."""
    key = name.lower()
    # Try the literal and BOTH singularisations. English needs both: "handaxes" -> "handaxe" drops
    # only the s, while "torches" -> "torch" drops the es. Guessing one rule silently mis-resolved
    # handaxes to "handax" and defaulted a real weapon to gear — which would have kept a 2024
    # fighter's greatsword out of the attack panel entirely.
    for probe in (key, key[:-1] if key.endswith('s') else key, re.sub(r'es$', '', key)):
        if probe in catalog:
            nm, cat, wt = catalog[probe]
            return (cat, wt, nm)
        if probe in known:
            cat, wt = known[probe]
            return (cat, wt, name)
    for pat, cat in CATEGORY_HINTS:
        if re.search(pat, key):
            return (cat, None, name)
    return (None, None, name)


unresolved = set()
entries = []
for cls, ln in found.items():
    body = ln.split('**Starting Equipment:**', 1)[1].strip()
    opts = []
    for chunk in body.split(';'):
        chunk = chunk.strip()
        m = re.match(r'\(([A-C])\)\s*(.+)', chunk)
        if not m:
            continue
        label, rest = m.group(1), m.group(2).strip().rstrip('.')
        items = []
        gold = None
        for tok in rest.split('+'):
            tok = tok.strip()
            g = re.match(r'^(\d+)\s*gp$', tok)
            if g:
                gold = int(g.group(1))
                continue
            q = re.match(r'^(\d+)\s+(.*)$', tok)
            qty, nm = (int(q.group(1)), q.group(2)) if q else (1, tok)
            # "Arcane Focus (crystal)" / "Druidic Focus (Quarterstaff)" keep their parenthetical —
            # it tells the player which one, and dropping it would make two classes look identical.
            cat, wt, canon = resolve(nm)
            if cat is None:
                unresolved.add(nm)
                cat = 'gear'
            items.append({'name': canon, 'quantity': qty, 'category': cat, 'weight': wt})
        opts.append({'label': label, 'items': items, 'gold': gold, 'raw': rest})
    assert opts, 'no options parsed for %s' % cls
    entries.append({'classId': cls + '-2024', 'options': opts})

print('parsed %d entries; %d item names had no known category (defaulted to gear):'
      % (len(entries), len(unresolved)))
for u in sorted(unresolved):
    print('   ' + u)

json.dump(entries, open('tools/audit/out-g8.json', 'w'), indent=1)
assert not unresolved, 'refusing to write with %d unresolved items' % len(unresolved)


def esc(t):
    return t.replace('\\', '\\\\').replace("'", "\\'")


out = []
for e in entries:
    out.append("  {\n    classId: '%s',\n    choices: [\n      {\n"
               "        label: 'Starting equipment',\n        options: [" % e['classId'])
    for o in e['options']:
        parts = []
        for it in o['items']:
            f = "{ name: '%s'" % esc(it['name'])
            if it['quantity'] != 1:
                f += ", quantity: %d" % it['quantity']
            f += ", category: '%s'" % it['category']
            if it['weight'] is not None:
                f += ", weight: %s" % (int(it['weight']) if it['weight'] == int(it['weight']) else it['weight'])
            parts.append(f + ' }')
        label = esc(o['raw'])
        out.append("\n          { label: '%s', items: [%s]%s }," %
                   (label, ', '.join(parts), (", gold: %d" % o['gold']) if o['gold'] else ''))
    out.append("\n        ],\n      },\n    ],\n    fixed: [],\n  },\n")

block = ''.join(out)
src_ts = open(SRC, encoding='utf-8').read()
assert "classId: 'barbarian-2024'" not in src_ts, 'already applied'
marker = "];\n\nexport function getClassStartingEquipment"
assert marker in src_ts, 'insertion point not found'
header = ("\n  // ── PHB 2024 ──────────────────────────────────────────────────────────────\n"
          "  // The 2024 rules replaced the 2014 per-slot picks with a few complete PACKAGES, so\n"
          "  // these are one choice group whose options each carry the whole kit. Generated from\n"
          "  // phb2024-players-handbook.md by tools/audit/fix_g8.py; item names and weights are\n"
          "  // resolved against src/data/items.ts so the attack panel and encumbrance recognise them.\n")
src_ts = src_ts.replace(marker, header + block + marker, 1)
open(SRC, 'w', encoding='utf-8').write(src_ts)
print('\nwrote %d PHB 2024 entries into %s' % (len(entries), SRC))

