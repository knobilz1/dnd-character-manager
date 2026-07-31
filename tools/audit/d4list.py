"""D4 worksheet: every subclass feature containing choice language, with the choice CLAUSE extracted.

The earlier automated attempt failed (build=142/usetime=25, more than the 103 candidates it started
from) because it classified on targeting language, which does not correlate with persistence. This
script deliberately does NOT classify. It extracts the sentence containing the choice so a human pass
can judge persistence — which is the actual discriminator:

  BUILD    the choice is made once and must be stored on the sheet, or the feature cannot work
  USE-TIME re-chosen every activation or every rest, so storing it would be wrong

Emits a stable, sorted worksheet so successive runs diff cleanly.
"""
import re, sys, io, os, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
SRC = r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src\data'

CHOICE = re.compile(r"\b(of your choice|choose|chosen|you select|you pick|select one|pick one)\b", re.I)

# PHB boilerplate: nearly every 2014 subclass feature opens "when you choose this archetype at Nth
# level". That "choose" is the SUBCLASS pick, not a choice the feature grants — and it is almost
# certainly why the earlier automated attempt produced 167 candidates from a 103-item list. Strip it
# before matching, or the sweep is mostly measuring boilerplate.
BOILERPLATE = re.compile(
    r"\b(?:beginning\s+|starting\s+)?(?:when|at the time)\s+you\s+"
    r"(?:choose|select|pick|adopt|join|take|enter)\s+this\s+"
    r"(?:archetype|domain|oath|tradition|circle|patron|path|college|school|specialty|subclass|order|discipline|origin)"
    r"[^.,;]*", re.I)
# "…if you so choose" and "a direction/target of your choice" made by the OPPONENT are also not
# player build choices, but they are rare enough to leave to the hand pass rather than risk a
# pattern that silently eats real candidates.


def unesc(x):
    return x.replace("\\'", "'")


def brace_object(s, start):
    depth, in_str, esc = 0, False, False
    for i in range(start, len(s)):
        ch = s[i]
        if in_str:
            if esc: esc = False
            elif ch == '\\': esc = True
            elif ch == "'": in_str = False
        elif ch == "'": in_str = True
        elif ch == '{': depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return s[start:i + 1]
    return None


rows, seen_subclasses = [], set()
for label, path in (('2014', r'subclasses\index.ts'), ('2024', r'subclasses\phb2024.ts')):
    s = open(os.path.join(SRC, path), encoding='utf-8').read()
    sub_at = [(m.start(), m.group(1)) for m in re.finditer(r"\{\s*id: '([a-z0-9-]+)'", s)]

    def owner(pos):
        best = '?'
        for start, sid in sub_at:
            if start <= pos:
                best = sid
            else:
                break
        return best

    for m in re.finditer(r"\{\s*name: '", s):
        obj = brace_object(s, m.start())
        if obj is None:
            continue
        nm = re.search(r"name: '((?:[^'\\]|\\.)*)'", obj)
        lv = re.search(r"level: (\d+)", obj)
        de = re.search(r"description: '((?:[^'\\]|\\.)*)'", obj)
        if not (nm and lv and de):
            continue
        desc = unesc(de.group(1))
        sid = owner(m.start())
        seen_subclasses.add(sid)
        stripped = BOILERPLATE.sub('', desc)
        if not CHOICE.search(stripped):
            continue
        # the sentence carrying the choice — that is what decides persistence
        sentences = re.split(r'(?<=[.;])\s+', stripped)
        clause = next((x for x in sentences if CHOICE.search(x)), stripped)
        rows.append({'ed': label, 'subclass': sid, 'name': unesc(nm.group(1)),
                     'level': int(lv.group(1)), 'clause': clause.strip()})

assert len(seen_subclasses) >= 185, 'only saw %d subclasses — parser is blind to some' % len(seen_subclasses)
print('subclasses seen: %d   features with choice language: %d' % (len(seen_subclasses), len(rows)))

# controls: one known build choice must be present, one known non-choice must be absent
ids = {(r['subclass'], r['name']) for r in rows}
assert ('circle-of-the-land', 'Circle Spells') in ids or any(
    r['subclass'] == 'circle-of-the-land' for r in rows), 'positive control: land druid absent'
assert not any(r['subclass'] == 'champion' and r['name'] == 'Improved Critical' for r in rows), \
    'negative control: Improved Critical has no choice and must not appear'
print('controls ok\n')

by_class = collections.defaultdict(list)
for r in sorted(rows, key=lambda x: (x['subclass'], x['level'])):
    by_class[r['subclass']].append(r)

for sid in sorted(by_class):
    for r in by_class[sid]:
        print('%-30s lv%-3s %-34s %s' % (sid[:30], r['level'], r['name'][:34], r['clause'][:150]))

print('\ncandidates: %d across %d subclasses' % (len(rows), len(by_class)))
