"""Collect every recharge rule the `rechargeOn: 'short' | 'long' | 'dawn'` enum cannot express.

R4 says the enum is too narrow. Before widening it, find ALL the shapes it has to cover --
widening twice is worse than widening once. Scans every data file's feature/item text, not
just the ones that already carry a resource, because a feature with no resource is exactly
the case the enum failed to model.
"""
import re, sys, io, os, glob
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
ROOT = r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src\data'

SHAPES = [
    ('dice-many-rests', r'\d?d\d+\s+(?:long|short)\s+rests'),
    ('n-days',          r'(?:after|until|for)\s+(?:\d+|a|one|seven)\s+days?\b'),
    ('per-day-n',       r'\b\d+\s+(?:times?\s+)?per\s+day\b'),
    ('recharge-roll',   r'recharges?\s+on\s+a\s+roll'),
    ('midnight',        r'\bat\s+midnight\b'),
    ('weekly',          r'\bper\s+week\b|\beach\s+week\b'),
    ('sunset',          r'\bat\s+(?:dusk|sunset|sunrise)\b'),
]
PATS = [(n, re.compile(p, re.I)) for n, p in SHAPES]

# CONTROLS -------------------------------------------------------------------
POS = [
    ("recharges after 1d4 long rests", 'dice-many-rests'),
    ("can't use it again for 7 days", 'n-days'),
    ("3 times per day", 'per-day-n'),
]
for text, want in POS:
    hits = [n for n, p in PATS if p.search(text)]
    assert want in hits, 'POSITIVE CONTROL FAILED: %r matched %s, wanted %s' % (text, hits, want)
NEG = "Once you use this feature, you can't use it again until you finish a long rest."
assert not any(p.search(NEG) for _, p in PATS), 'NEGATIVE CONTROL FAILED on plain long-rest text'
print('controls ok\n')

FIELD = re.compile(r"(?:description|text|name): '((?:[^'\\]|\\.)*)'")
FIELD2 = re.compile(r'(?:description|text|name): "([^"]*)"')

found = {}
files = 0
for path in glob.glob(os.path.join(ROOT, '**', '*.ts'), recursive=True):
    body = open(path, encoding='utf-8', errors='replace').read()
    files += 1
    rel = os.path.relpath(path, ROOT).replace('\\', '/')
    for m in list(FIELD.finditer(body)) + list(FIELD2.finditer(body)):
        text = m.group(1).replace("\\'", "'")
        for name, pat in PATS:
            hit = pat.search(text)
            if not hit:
                continue
            # name the owning entry: nearest preceding `name: '...'` or `id: '...'`
            head = body[:m.start()]
            owner = None
            for om in re.finditer(r"(?:name|id): '((?:[^'\\]|\\.)+)'", head):
                owner = om.group(1)
            found.setdefault(name, []).append((rel, owner, hit.group(0), text[:150]))

print('scanned %d data files\n' % files)
total = 0
for name, _ in SHAPES:
    rows = found.get(name, [])
    total += len(rows)
    print('== %s : %d ==' % (name, len(rows)))
    for rel, owner, frag, snippet in rows:
        print('   %-26s %-34s "%s"' % (rel, (owner or '?')[:34], frag))
    print()
print('TOTAL %d text sites the current enum cannot express' % total)
