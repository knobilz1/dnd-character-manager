"""Verify every subclass FEATURE NAME appears in the book the entry claims.

Why this pass exists: the audit found two features that do not exist in any book --
Graviturgy's "Deprive the Unworthy" and Drakewarden's mislabelled "Reflexive
Resistance". Neither was reachable by any sweep over the app's own data, which was
internally consistent and typechecked clean. The only way to see them is to check the
NAME against the source. Two hits out of roughly fifteen subclasses read closely by
hand is a high enough base rate to be worth measuring across all of them.

Output is a candidate list, not a verdict: a miss can also mean the markdown extract
paraphrased the name, so every row needs a human read before it is called a bug.
"""
import re, sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

REPO = r'C:\Users\nabil\Desktop\Code\dnd-character-manager'
GDRIVE = r'G:\My Drive\DND Source Books'
REFMD = r'C:\Users\nabil\Desktop\Code\reference-books\md'

BOOKS = {
    'PHB': 'phb-players-handbook.md', 'XGtE': 'xge-xanathars-guide.md',
    'TCE': 'tce-tashas-cauldron.md', 'SCAG': 'scag-sword-coast-adventurers-guide.md',
    'EGtW': 'egtw-explorers-guide-wildemount.md', 'ERLW': 'erlw-eberron-rising-last-war.md',
    'FToD': 'ftod-fizbans-treasury-of-dragons.md', 'GGR': 'ggr-guildmasters-guide-ravnica.md',
    'SCoC': 'scoc-strixhaven-curriculum-of-chaos.md', 'VGM': 'vgm-volos-guide-to-monsters.md',
    'ToB': 'tob-tides-of-blood.md', 'MTF': 'mtof-mordenkainens-tome-of-foes.md',
    'MMoM': 'mmom-monsters-of-the-multiverse.md', 'PHB2024': 'phb2024-players-handbook.md',
}


def load(fn):
    for base in (GDRIVE, REFMD):
        p = os.path.join(base, fn)
        if os.path.exists(p):
            return open(p, encoding='utf-8', errors='replace').read()
    return None


def norm(t):
    """Fold apostrophe styles, dashes and whitespace so 'Drake\\'s Breath' matches
    'Drake's Breath' and 'Drake\u2019s Breath'."""
    t = t.replace('\\', '').replace('\u2019', "'").replace('\u2018', "'")
    t = t.replace('\u2014', '-').replace('\u2013', '-').replace('\u2212', '-')
    return re.sub(r'\s+', ' ', t).lower()


src = open(os.path.join(REPO, r'src\data\subclasses\index.ts'), encoding='utf-8').read()
starts = [m.start() for m in re.finditer(r"\n  \{ id: '", src)]
starts.append(len(src))
entries = []
for a, b in zip(starts, starts[1:]):
    blk = src[a:b]
    entries.append((
        re.search(r"id: '([a-z0-9\-]+)'", blk).group(1),
        (re.search(r"sourceBook: '([A-Za-z0-9]+)'", blk) or [None, '?'])[1],
        blk))
assert len(entries) == 141, len(entries)

FEAT = re.compile(r"\{ name: '((?:[^'\\]|\\.)+)', level: (\d+), description:")
# Feature-level control, same shape as r5scan: one apostrophe name, one plain.
ctl = dict((e[0], [n for n, _ in FEAT.findall(e[2])]) for e in entries)
assert "Captain\\'s Call" in ctl['tob-captain'], ctl['tob-captain']
assert 'Frenzy' in ctl['berserker'], ctl['berserker']

texts = {}
missing_books = set()
misses, checked, skipped = [], 0, 0
for sid, book, blk in entries:
    fn = BOOKS.get(book)
    if fn is None:
        missing_books.add(book)
        continue
    if fn not in texts:
        texts[fn] = load(fn)
    body = texts[fn]
    if body is None:
        missing_books.add(book + ' (' + fn + ' not on disk)')
        continue
    nbody = norm(body)
    # Book-level positive control: the subclass's own NAME should be in its book.
    subname = re.search(r"name: '((?:[^'\\]|\\.)+)'", blk).group(1)
    sub_ok = norm(subname) in nbody
    for name, lvl in FEAT.findall(blk):
        checked += 1
        if norm(name) not in nbody:
            misses.append((book, sid, name, lvl, sub_ok))

print('checked %d feature names across %d subclasses' % (checked, len(entries)))
if missing_books:
    print('NO SOURCE for books: %s  (their subclasses were skipped)' % sorted(missing_books))
print('\n%d names not found in the claimed book:\n' % len(misses))
cur = None
for book, sid, name, lvl, sub_ok in misses:
    if (book, sid) != cur:
        cur = (book, sid)
        print('\n%-6s %-32s %s' % (book, sid, '' if sub_ok else '  <-- SUBCLASS NAME ALSO ABSENT'))
    print('         L%-3s %s' % (lvl, name))
