"""G10: list the PHB 2024 subclasses that have no gameplay tip, with what they actually do.

subclassTips.ts covers all 141 2014 subclasses and none of the 48 from 2024, so a player building a
2024 character gets no guidance at all. Writing the tips needs to be grounded in each subclass's
real features rather than in its 2014 namesake, because 2024 rewrote many of them — copying the
2014 text across would be confidently wrong, which is worse than a blank.
"""
import re, io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
os.chdir(r'C:\Users\nabil\Desktop\Code\dnd-character-manager')

src = open('src/data/subclasses/phb2024.ts', encoding='utf-8').read()
tips = open('src/data/subclassTips.ts', encoding='utf-8').read()

starts = [m.start() for m in re.finditer(r"\{ id: '", src)]
starts.append(len(src))
rows = []
for a, b in zip(starts, starts[1:]):
    blk = src[a:b]
    sid = re.search(r"id: '([a-z0-9-]+)'", blk).group(1)
    cid = re.search(r"classId: '([a-z0-9-]+)'", blk)
    nm = re.search(r"name: '((?:[^'\\]|\\.)*)'", blk)
    if not (cid and nm):
        continue
    feats = re.findall(r"\{ name: '((?:[^'\\]|\\.)+)', level: (\d+), description: '((?:[^'\\]|\\.)*)'", blk)
    rows.append({
        'id': sid,
        'name': nm.group(1).replace("\\'", "'"),
        'classId': cid.group(1),
        'has_tip': ("'%s':" % sid) in tips,
        'base_tip': ("'%s':" % sid.replace('-2024', '')) in tips,
        'features': [(n.replace("\\'", "'"), int(l), d.replace("\\'", "'")) for n, l, d in feats],
    })

missing = [r for r in rows if not r['has_tip']]
print('%d PHB 2024 subclasses, %d without a tip\n' % (len(rows), len(missing)))
for r in missing:
    print('=' * 78)
    print('%s   [%s]   %s' % (r['id'], r['classId'], 'has a 2014 namesake' if r['base_tip'] else 'NEW IN 2024'))
    for n, l, d in r['features'][:5]:
        print('   L%-3d %-28s %s' % (l, n, d[:135]))
