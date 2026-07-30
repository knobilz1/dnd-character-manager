"""Completeness re-check for subclasses ALREADY carrying a resources block.

The main scan skips those entries, so any limited-use feature added to them later --
or missed at the time by an under-matching regex -- stays invisible. This lists every
limited-use feature in a done subclass whose name has no obvious matching resource.
"""
import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
src = open(r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src\data\subclasses\index.ts', encoding='utf-8').read()
starts = [m.start() for m in re.finditer(r"\n  \{ id: '", src)]
starts.append(len(src))
entries = []
for a, b in zip(starts, starts[1:]):
    blk = src[a:b]
    entries.append((re.search(r"id: '([a-z0-9\-]+)'", blk).group(1), blk))
assert len(entries) == 141, len(entries)

FEAT = re.compile(r"\{ name: '((?:[^'\\]|\\.)+)', level: (\d+), description: '((?:[^'\\]|\\.)*)' \}")
PATS = [r'once per (?:short|long) rest', r'once per (?:short or long|long or short) rest',
        r'until you finish a (?:short|long) rest', r'regain(?:s)? (?:all )?(?:expended|the) use',
        r'uses of this feature', r'number of times equal to your proficiency bonus',
        r'proficiency bonus.{0,40}?times', r"can't use (?:it|this feature) again until",
        r'expend(?:ed)? uses', r'uses?\s*=', r'uses equal to', r'per (?:short|long) rest',
        r'per short or long rest', r'\d\s*/\s*(?:short|long) rest']
PAT = re.compile('|'.join(PATS), re.I)
assert PAT.search("Uses = 1 + Charisma modifier per long rest"), 'PAT control failed'
assert not PAT.search('You gain proficiency in three skills.'), 'PAT negative control failed'

def norm(x):
    return re.sub(r'[^a-z]', '', x.lower())

total = 0
for sid, blk in entries:
    if 'resources: [' not in blk:
        continue
    # Three layouts exist in this file: name+key on one line single-quoted, the same
    # double-quoted ("Dark One's Own Luck", to dodge escaping), and name/key on separate
    # lines (battle-master). Slice the resources array by bracket matching and take every
    # name inside it, rather than assuming name and key are adjacent.
    i = blk.index('resources: [') + len('resources: ')
    depth, j = 0, i
    while j < len(blk):
        if blk[j] == '[':
            depth += 1
        elif blk[j] == ']':
            depth -= 1
            if depth == 0:
                break
        j += 1
    rblk = blk[i:j + 1]
    resnames = re.findall(r"""name: '((?:[^'\\]|\\.)+)'""", rblk) + \
               re.findall(r'''name: "([^"]+)"''', rblk)
    assert resnames, 'resource-name control failed for ' + sid
    rn = [norm(r) for r in resnames]
    for name, lvl, desc in FEAT.findall(blk):
        if not PAT.search(desc.replace("\\'", "'")):
            continue
        n = norm(name)
        if any(n in r or r in n for r in rn):
            continue
        total += 1
        print('%-32s %-28s (L%s)   resources: %s' % (sid, name, lvl, resnames or '(none)'))
print('\n%d limited-use features in already-done subclasses with no matching resource' % total)
