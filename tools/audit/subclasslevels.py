"""Subclass feature levels vs the level the subclass is actually gained.

A subclass feature listed below its class's `subclassLevel` can never fire: the character does not
have the subclass yet, and LevelUpDialog computes what to grant from the level table, so the feature
is silently skipped forever. This is a pure internal-consistency check — no book needed — which makes
it cheap and fully reproducible, and it bounds the much larger "levels vs the book" pass by finding
the impossible ones first.

Also flags levels outside 1-20, and features that duplicate a level within one subclass (usually a
copy-paste, occasionally correct).
"""
import re, sys, io, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
SRC = r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src\data'

# ── subclassLevel per class, both editions ───────────────────────────────────
sub_level = {}
for path in (r'classes\index.ts', r'classes\phb2024.ts'):
    s = open(SRC + '\\' + path, encoding='utf-8').read()
    starts = [m.start() for m in re.finditer(r"^    id: '([a-z0-9-]+)',", s, re.M)]
    starts.append(len(s))
    for i in range(len(starts) - 1):
        chunk = s[starts[i]:starts[i + 1]]
        cid = re.search(r"id: '([a-z0-9-]+)'", chunk).group(1)
        m = re.search(r"subclassLevel: (\d+)", chunk)
        if m:
            sub_level[cid] = int(m.group(1))
assert len(sub_level) == 25, 'class parse collapsed: %d classes with subclassLevel' % len(sub_level)
assert sub_level.get('fighter') == 3 and sub_level.get('cleric') == 1, \
    'control failed: fighter=%s cleric=%s' % (sub_level.get('fighter'), sub_level.get('cleric'))
print('classes with subclassLevel: %d  (fighter=3, cleric=1 as expected)' % len(sub_level))

# ── every subclass and its feature levels ────────────────────────────────────
rows = []
for label, path in (('2014', r'subclasses\index.ts'), ('2024', r'subclasses\phb2024.ts')):
    s = open(SRC + '\\' + path, encoding='utf-8').read()
    starts = [m.start() for m in re.finditer(r"\{\s*id: '[a-z0-9-]+'", s)]
    starts.append(len(s))
    for i in range(len(starts) - 1):
        chunk = s[starts[i]:starts[i + 1]]
        sid = re.search(r"id: '([a-z0-9-]+)'", chunk).group(1)
        cls = re.search(r"classId: '([a-z0-9-]+)'", chunk)
        bk = re.search(r"sourceBook: '(\w+)'", chunk)
        if not cls:
            continue
        # feature entries look like: { name: '...', level: N, description: '...' }
        feats = [(m.group(1), int(m.group(2)))
                 for m in re.finditer(r"name: '((?:[^'\\]|\\.)*)',\s*level: (\d+)", chunk)]
        rows.append({'ed': label, 'id': sid, 'classId': cls.group(1),
                     'book': bk.group(1) if bk else '?', 'feats': feats})

assert len(rows) == 189, 'subclass parse collapsed: %d entries' % len(rows)
total_feats = sum(len(r['feats']) for r in rows)
assert total_feats > 600, 'feature parse collapsed: only %d features' % total_feats
nofeat = [r['id'] for r in rows if not r['feats']]
assert not nofeat, 'these subclasses parsed with zero features — sweep is blind to them: %s' % nofeat[:8]
print('subclasses: %d, features: %d, every subclass has >=1 parsed feature' % (len(rows), total_feats))

byid = {r['id']: r for r in rows}
assert any(l == 3 for _, l in byid['champion']['feats']), 'control failed: champion has no level-3 feature'
print('controls ok\n')

early, oob, dupes = [], [], []
unknown_class = set()
for r in rows:
    need = sub_level.get(r['classId'])
    if need is None:
        unknown_class.add(r['classId'])
    seen = collections.Counter(l for _, l in r['feats'])
    for nm, lvl in r['feats']:
        if not (1 <= lvl <= 20):
            oob.append((r, nm, lvl, '-'))
        elif need is not None and lvl < need:
            early.append((r, nm, lvl, need))
    for lvl, c in seen.items():
        if c > 2:
            dupes.append((r, '%d features share this level' % c, lvl, '-'))

assert not unknown_class, 'subclasses reference classes with no subclassLevel: %s' % unknown_class

def show(title, rows_, fmt):
    print('### %s (%d)' % (title, len(rows_)))
    for r, nm, lvl, extra in rows_:
        print('   %-26s %-16s %-6s %s' % (r['id'][:26], r['classId'][:16], r['book'], fmt(nm, lvl, extra)))
    print()

show('FEATURE BELOW THE SUBCLASS LEVEL — unreachable', early,
     lambda nm, lvl, need: 'lv%-3s "%s"  (subclass gained at lv%s)' % (lvl, nm[:40], need))
show('FEATURE LEVEL OUT OF RANGE 1-20', oob, lambda nm, lvl, _: 'lv%s "%s"' % (lvl, nm[:40]))
show('3+ FEATURES AT ONE LEVEL (usually fine, sometimes a paste)', dupes,
     lambda nm, lvl, _: 'lv%-3s %s' % (lvl, nm))

print('subclasses swept: %d   unreachable features: %d   out-of-range: %d' % (len(rows), len(early), len(oob)))
