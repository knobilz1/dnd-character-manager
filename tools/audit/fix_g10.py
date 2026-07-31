"""G10: splice the 48 PHB 2024 subclass tips into subclassTips.ts and prove the coverage is exact.

The tips themselves were written by hand against each subclass's own 2024 features, not copied from
its 2014 namesake — the 2024 rewrite moved Champion's Remarkable Athlete to level 3 and gave it
Initiative advantage, made Hunter's Prey re-choosable on a rest, and replaced Beast Master's
companion with a summoned stat block, so the 2014 text would have been confidently wrong in exactly
the way a player would not notice.

This script only does the splice and the accounting: every 2024 subclass gets exactly one tip, no
2014 tip is disturbed, and no tip is written for an id that does not exist.
"""
import re, io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
os.chdir(r'C:\Users\nabil\Desktop\Code\dnd-character-manager')

TIPS = 'src/data/subclassTips.ts'
NEW = (r'C:\Users\nabil\AppData\Local\Temp\claude\C--'
       r'\5805bbac-0194-4ca9-8afd-b3dccbd274d9\scratchpad\tips2024.ts')

block = open(NEW, encoding='utf-8').read()
tips = open(TIPS, encoding='utf-8').read()
subs = open('src/data/subclasses/phb2024.ts', encoding='utf-8').read()

real_ids = set(re.findall(r"\{ id: '([a-z0-9-]+)'", subs))
new_ids = re.findall(r"^  '([a-z0-9-]+)':$", block, re.M)
assert len(new_ids) == len(set(new_ids)), 'duplicate tip id in the new block'

# NEGATIVE CONTROL: a tip for an id that does not exist is dead data, and dead data keyed by id is
# how G10 was found in the first place (subclassTips covered 2014 completely and 2024 not at all).
ghost = [i for i in new_ids if i not in real_ids]
assert not ghost, 'tips written for non-existent subclasses: %s' % ghost

# POSITIVE CONTROL: every 2024 subclass must be covered, not merely most of them.
uncovered = sorted(real_ids - set(new_ids) - set(re.findall(r"^  '([a-z0-9-]+)':$", tips, re.M)))
assert not uncovered, 'these 2024 subclasses would still have no tip: %s' % uncovered

before = len(re.findall(r"^  '([a-z0-9-]+)':$", tips, re.M))
assert "'berserker-2024':" not in tips, 'already applied'

marker = '\n};\n'
assert tips.count(marker) >= 1, 'closing brace not found'
tips = tips[:tips.rindex(marker)] + '\n' + block.strip('\n') + '\n' + tips[tips.rindex(marker):]
open(TIPS, 'w', encoding='utf-8').write(tips)

after = len(re.findall(r"^  '([a-z0-9-]+)':$", tips, re.M))
print('tips: %d -> %d (+%d)' % (before, after, after - before))
assert after - before == 48, 'expected 48 new tips, added %d' % (after - before)

# CONTROL: the 2014 entries are untouched, both in count and by spot check.
for k in ('champion', 'berserker', 'college-of-lore', 'circle-of-stars'):
    assert ("'%s':" % k) in tips, 'CONTROL FAILED: 2014 tip %s disappeared' % k
print('control ok: 48 added, all 2024 ids real, all 2024 subclasses covered, 2014 untouched')
