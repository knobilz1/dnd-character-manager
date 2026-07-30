import re, sys
src = open(r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src\data\subclasses\index.ts', encoding='utf-8').read()
starts = [m.start() for m in re.finditer(r"\n  \{ id: '", src)]
starts.append(len(src))
entries = []
for a, b in zip(starts, starts[1:]):
    blk = src[a:b]
    sid = re.search(r"id: '([a-z0-9\-]+)'", blk).group(1)
    cid = re.search(r"classId: '([a-z0-9\-]+)'", blk).group(1)
    bm = re.search(r"sourceBook: '([A-Za-z0-9]+)'", blk)
    entries.append((sid, cid, bm.group(1) if bm else '?', blk))

# POSITIVE CONTROL
known = ['psi-warrior', 'soulknife', 'the-fiend', 'berserker', 'college-of-glamour']
missing = [k for k in known if not any(e[0] == k for e in entries)]
assert not missing, 'POSITIVE CONTROL FAILED: ' + str(missing)
assert not any(e[0] == 'bogus-xyz' for e in entries), 'NEGATIVE CONTROL FAILED'
print('controls ok; %d entries' % len(entries))

# The name group must allow escaped chars too: "Captain\'s Call" and every other
# possessive feature name was silently dropped by a plain [^']+ group.
FEAT = re.compile(r"\{ name: '((?:[^'\\]|\\.)+)', level: (\d+), description: '((?:[^'\\]|\\.)*)' \}")

# FEATURE-LEVEL CONTROL. The subclass-level controls above pass even when the feature
# regex is silently dropping matches, which is how two artifacts got through. Assert on
# features known to exist, including one with an apostrophe in its NAME and one in its
# DESCRIPTION -- the two escaping shapes that have each broken this scan once.
def _featnames(sid):
    blk = next(e[3] for e in entries if e[0] == sid)
    return [n for n, _, _ in FEAT.findall(blk)]
FEAT_CONTROL = {
    'tob-captain': ["Captain\\'s Call", 'All for One'],
    'the-fiend': ["Dark One\\'s Blessing", 'Hurl Through Hell'],
    'berserker': ['Frenzy', 'Retaliation'],
}
for sid, want in FEAT_CONTROL.items():
    got = _featnames(sid)
    miss = [w for w in want if w not in got]
    assert not miss, 'FEATURE CONTROL FAILED for %s: missing %s (parsed %s)' % (sid, miss, got)
print('feature-level controls ok')

PATS = [
    r'once per (?:short|long) rest',
    r'once per (?:short or long|long or short) rest',
    r'until you finish a (?:short|long) rest',
    r'regain(?:s)? (?:all )?(?:expended|the) use',
    r'uses of this feature',
    r'number of times equal to your proficiency bonus',
    r'proficiency bonus.{0,40}?times',
    r"can't use (?:it|this feature) again until",
    r'expend(?:ed)? uses',
    # Added after Captain's Call was found by hand: the app phrases some limits as
    # "Uses = 1 + Charisma modifier per long rest", which none of the above match.
    r'uses?\s*=',
    r'uses equal to',
    r'per (?:short|long) rest',
    r'per short or long rest',
    r'\d\s*/\s*(?:short|long) rest',
]
PAT = re.compile('|'.join(PATS), re.I)

out = []
for sid, cid, book, blk in entries:
    if 'resources: [' in blk:
        continue
    feats = FEAT.findall(blk)
    # descriptions store escaped apostrophes (can\'t) -- unescape before matching
    hits = [(n, int(l)) for n, l, d in feats if PAT.search(d.replace("\\'", "'"))]
    if hits:
        out.append((book, cid, sid, hits))
out.sort()
tot = 0
for book, cid, sid, hits in out:
    tot += len(hits)
    print('%-6s %-12s %-28s %s' % (book, cid, sid, '; '.join('%s(L%d)' % (n, l) for n, l in hits)))
print('\n%d subclasses, %d features' % (len(out), tot))
