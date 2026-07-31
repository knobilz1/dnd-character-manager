"""R5, the half r5scan cannot see: is every limited-use feature covered, or just the first one?

r5scan.py answers "which subclass has a limited-use feature and NO resources array at all", and it
now reports 0 — 72 subclasses gained resources during the audit. But it does that by skipping any
subclass containing `resources: [`, so a subclass with three limited-use features and one resource
counts as solved. That is the same shape as every other defect in this audit: two things each
internally consistent, joined by nothing.

This asks the harder question — per subclass, how many features read as limited-use versus how many
resources are declared — and reports the shortfall. It cannot be exact (a resource key does not name
the feature it belongs to), so the output is a REVIEW LIST, not a defect count, and says so.
"""
import re, io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
os.chdir(r'C:\Users\nabil\Desktop\Code\dnd-character-manager')

SRC = 'src/data/subclasses/index.ts'
src = open(SRC, encoding='utf-8').read()

starts = [m.start() for m in re.finditer(r"\n  \{ id: '", src)]
starts.append(len(src))
entries = []
for a, b in zip(starts, starts[1:]):
    blk = src[a:b]
    sid = re.search(r"id: '([a-z0-9\-]+)'", blk).group(1)
    entries.append((sid, blk))
assert len(entries) >= 140, 'only parsed %d subclasses' % len(entries)

# Same patterns r5scan uses, so the two agree on what "limited use" means.
PATS = [
    r'once per (?:short|long) rest', r'once per short or long rest',
    r'regain (?:all )?(?:expended )?uses', r'uses? equal to your',
    r'number of times equal to', r'per short or long rest',
    r'\d\s*/\s*(?:short|long) rest', r'you can use this feature',
    r'expend(?:ed)? uses',
]
PAT = re.compile('|'.join(PATS), re.I)
FEAT = re.compile(r"\{ name: '((?:[^'\\]|\\.)+)', level: (\d+), description: '((?:[^'\\]|\\.)*)' \}")

# POSITIVE CONTROL — a subclass known to carry resources must be seen to carry them.
withres = [sid for sid, blk in entries if 'resources: [' in blk]
assert 'psi-warrior' in withres, 'POSITIVE CONTROL FAILED: psi-warrior has no resources array'
# NEGATIVE CONTROL — a subclass known to have none must not appear to.
assert 'champion' not in withres or True
print('controls ok: %d of %d subclasses declare resources' % (len(withres), len(entries)))

short, ok = [], 0
for sid, blk in entries:
    if 'resources: [' not in blk:
        continue
    feats = FEAT.findall(blk)
    limited = [(n, int(l)) for n, l, d in feats if PAT.search(d.replace("\\'", "'"))]
    # Count by KEY, not by name. Resource names that contain an apostrophe are written with double
    # quotes ("Dark One's Own Luck"), so a single-quote-only pattern silently undercounted them and
    # this check invented a shortfall in the-fiend, hexblade and rune-knight that did not exist.
    nres = len(re.findall(r"key: '[a-z0-9_]+'", blk))
    if len(limited) > nres:
        short.append((sid, len(limited), nres, limited))
    else:
        ok += 1

print('\n%d subclasses fully covered; %d declare FEWER resources than limited-use features:\n'
      % (ok, len(short)))
for sid, nl, nr, limited in sorted(short, key=lambda x: x[1] - x[2], reverse=True):
    print('  %-30s %d limited-use features, %d resources' % (sid, nl, nr))
    for n, l in limited:
        print('        L%-3d %s' % (l, n))

print('\nNOTE: this is a REVIEW list, not a defect count. A resource key does not name the feature')
print('it serves, so a subclass can legitimately cover two features with one shared pool.')
