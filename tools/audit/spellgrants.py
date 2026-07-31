"""Which subclasses SHOULD grant spells, and which actually do?

Cleric domains, Paladin oaths, Warlock patrons, Druid circles, Artificer specialists and a handful
of others all grant a fixed spell list in RAW — always-prepared (cleric/paladin/druid/artificer) or
expanded-list (warlock/sorcerer). In this codebase that is `alwaysPreparedSpells` / `landSpells` /
`expandedSpells`. A subclass of one of those classes with NO grant field is either a genuine
exception or a silent coverage gap, and the two are indistinguishable from the description text —
which is why the earlier text-accuracy audit could not have caught it.

Emits the full per-class roster so the gap can be triaged by hand against the books, rather than a
bare count that hides which ones are missing.
"""
import re, os, sys, io, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
SRC = r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src'

# classes whose subclasses grant spells in RAW
GRANTING = {'cleric', 'paladin', 'warlock', 'druid', 'artificer', 'sorcerer', 'ranger', 'wizard',
            'fighter', 'rogue', 'barbarian', 'bard', 'monk'}
ALWAYS_GRANTS = {'cleric', 'paladin', 'artificer'}   # every subclass of these grants spells in RAW

rows = []
for label, path in (('2014', r'data\subclasses\index.ts'), ('2024', r'data\subclasses\phb2024.ts')):
    full = os.path.join(SRC, path)
    if not os.path.exists(full):
        continue
    s = open(full, encoding='utf-8').read()
    # split on top-level entries: each begins with `{ id: '...'`
    starts = [m.start() for m in re.finditer(r"\{\s*id:\s*'[a-z0-9-]+'", s)]
    starts.append(len(s))
    for i in range(len(starts) - 1):
        chunk = s[starts[i]:starts[i + 1]]
        m = re.search(r"id:\s*'([a-z0-9-]+)'", chunk)
        c = re.search(r"classId:\s*'([a-z0-9-]+)'", chunk)
        n = re.search(r"name:\s*'((?:[^'\\]|\\.)*)'", chunk)
        b = re.search(r"sourceBook:\s*'(\w+)'", chunk)
        if not (m and c):
            continue
        grants = [f for f in ('alwaysPreparedSpells', 'landSpells', 'expandedSpells')
                  if re.search(f + r'\s*:', chunk)]
        rows.append({'ed': label, 'id': m.group(1), 'name': n.group(1) if n else '?',
                     'classId': c.group(1), 'book': b.group(1) if b else '?', 'grants': grants})

assert len(rows) >= 185, 'subclass parse collapsed: only %d entries' % len(rows)
print('subclasses parsed: %d (2014=%d, 2024=%d)' % (
    len(rows), sum(r['ed'] == '2014' for r in rows), sum(r['ed'] == '2024' for r in rows)))

# control: a subclass known to grant, and one known not to
byid = {r['id']: r for r in rows}
assert byid.get('circle-of-the-land', {}).get('grants'), 'positive control failed — land druid has no grant'
assert not byid.get('champion', {}).get('grants'), 'negative control failed — champion should grant nothing'
print('controls ok\n')

per_class = collections.defaultdict(lambda: {'with': [], 'without': []})
for r in rows:
    base = r['classId'].replace('-2024', '')
    per_class[base]['with' if r['grants'] else 'without'].append(r)

print('%-11s %-5s %-7s  %s' % ('CLASS', 'WITH', 'WITHOUT', 'subclasses with NO spell-grant field'))
print('-' * 100)
gap_total = 0
for cls in sorted(per_class):
    d = per_class[cls]
    flag = ' <<< every one of these grants spells in RAW' if cls in ALWAYS_GRANTS and d['without'] else ''
    names = ', '.join('%s[%s]' % (r['id'], r['book']) for r in d['without'])
    if cls in ALWAYS_GRANTS:
        gap_total += len(d['without'])
    print('%-11s %-5d %-7d  %s%s' % (cls, len(d['with']), len(d['without']), names[:200], flag))

print('\nSubclasses of always-granting classes (cleric/paladin/artificer) with no grant field: %d' % gap_total)
