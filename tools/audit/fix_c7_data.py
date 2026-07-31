"""C7 step 2: give the sixteen PHB 2024 backgrounds a structured ability increase.

PHB 2024 moved the ability score increase off the species and onto the background. The app carried
that fact only as English inside `feature.description` ("Ability Scores: +2/+1 to Intelligence,
Wisdom, Charisma"), and `Background` had no field for it — so EVERY character built on the 2024
rules was missing the whole +2/+1. That is a bigger hole than any single subclass bug in this audit.

The three abilities per background are taken from the BOOK table
(phb2024-players-handbook.md:1639) rather than from the app's own prose, and the two are asserted
to agree — encoding the app's description would have been circular, and would have baked in any
error it already contained.

Distribution is +2/+1 to two of the three, or +1/+1/+1 to all three, exactly as `flexibleAsi`
already expresses for races.
"""
import re, io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
os.chdir(r'C:\Users\nabil\Desktop\Code\dnd-character-manager')

BOOK = r'C:\Users\nabil\Desktop\Code\reference-books\md\phb2024-players-handbook.md'
P = 'src/data/backgrounds-phb2024.ts'

ABBR = {'Str': 'str', 'Dex': 'dex', 'Con': 'con', 'Int': 'int', 'Wis': 'wis', 'Cha': 'cha'}
FULL = {'Strength': 'str', 'Dexterity': 'dex', 'Constitution': 'con',
        'Intelligence': 'int', 'Wisdom': 'wis', 'Charisma': 'cha'}

# ---- book side ------------------------------------------------------------
book = open(BOOK, encoding='utf-8').read()
rows = re.findall(r'^\|\s*\*\*([A-Za-z]+)\*\*\s*\|\s*([A-Za-z, ]+?)\s*\|', book, re.M)
from_book = {}
for name, abils in rows:
    keys = [ABBR[a.strip()] for a in abils.split(',') if a.strip() in ABBR]
    if len(keys) == 3:
        from_book[name.lower()] = keys
assert len(from_book) == 16, 'expected 16 backgrounds in the book table, parsed %d' % len(from_book)

# ---- app side, only to CROSS-CHECK ---------------------------------------
s = open(P, encoding='utf-8').read()
ids = re.findall(r"id: '([^']+)'", s)
descs = re.findall(r"feature: \{ name: '[^']*', description: '((?:[^'\\]|\\.)*)'", s)
assert len(ids) == len(descs) == 16, 'app parse mismatch: %d ids, %d descriptions' % (len(ids), len(descs))

mismatch = []
for bid, d in zip(ids, descs):
    name = bid.replace('-2024', '')
    m = re.search(r'Ability Scores?:\s*\+2/\+1 to ([^(.]+)', d)
    assert m, 'no ability line in %s' % bid
    app_keys = [FULL[a.strip()] for a in m.group(1).split(',') if a.strip() in FULL]
    assert name in from_book, '%s not in the book table' % name
    if app_keys != from_book[name]:
        mismatch.append((bid, app_keys, from_book[name]))
if mismatch:
    for bid, a, b in mismatch:
        print('MISMATCH %-18s app %s book %s' % (bid, a, b))
    raise SystemExit('app prose and book disagree — resolve before encoding')
print('cross-check ok: all 16 agree between the app prose and the book table')

# ---- write the structured fields -----------------------------------------
added = 0
for bid in ids:
    name = bid.replace('-2024', '')
    keys = from_book[name]
    anchor = "    id: '%s',\n" % bid
    assert anchor in s, 'anchor for %s not found' % bid
    if 'abilityScoreOptions' in s[s.index(anchor):s.index(anchor) + 600]:
        continue
    block = ("    abilityScoreOptions: [%s],\n"
             "    flexibleAsi: [[2, 1], [1, 1, 1]],\n"
             % ', '.join("'%s'" % k for k in keys))
    s = s.replace(anchor, anchor + block, 1)
    added += 1

open(P, 'w', encoding='utf-8').write(s)
print('added structured ability increases to %d backgrounds' % added)

# ---- controls -------------------------------------------------------------
after = open(P, encoding='utf-8').read()
assert len(re.findall(r'abilityScoreOptions:', after)) == 16, 'not all 16 got the field'
assert len(re.findall(r"id: '", after)) == 16, 'entry count changed'

# 2014 backgrounds must NOT gain an increase — in the 2014 rules the RACE grants it, and giving
# both would hand every 2014 character a bonus the rules do not grant. This is the same distinction
# that made C6 wrong on first reading, so it is asserted rather than assumed.
for f in ('src/data/backgrounds.ts', 'src/data/backgrounds-ggr.ts'):
    t = open(f, encoding='utf-8').read()
    assert 'abilityScoreOptions' not in t, 'CONTROL FAILED: 2014 backgrounds in %s were touched' % f
print('control ok: 2014 and GGR backgrounds untouched (their races grant the increase)')
