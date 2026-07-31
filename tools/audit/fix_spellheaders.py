"""Phase I fixes — 6 spell header corrections, each verified against the PHB PDF this session.

Asserts the old value is present exactly once before replacing, so a re-run or a renamed
field fails loudly instead of silently doing nothing.
"""
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
SRC = 'src/data/spells/index.ts'

# (spell id, field, old, new, evidence from the PHB PDF)
FIX = [
    ('mass-cure-wounds', 'school', 'Evocation', 'Conjuration',
     'PHB: "Mass Cure Wounds  5th-level conjuration"'),
    ('mass-heal', 'school', 'Evocation', 'Conjuration',
     'PHB: "Mass Heal  9th-level conjuration"'),
    ('power-word-stun', 'duration', 'Until ended', 'Instantaneous',
     'PHB: "Power Word Stun 8th-level enchantment ... Duration: Instantaneous"'),
    ('fear', 'range', 'Self', 'Self (30-foot cone)',
     'PHB: "Fear 3rd-level illusion ... Range: Self (30-foot cone)"'),
    ('leomund-tiny-hut', 'range', 'Self', 'Self (10-foot-radius hemisphere)',
     'PHB: "Leomund’s Tiny Hut 3rd-level evocation (ritual) ... '
     'Range: Self (10-foot-radius hemisphere)"'),
    ('antimagic-field', 'range', 'Self (10-foot radius)', 'Self (10-foot-radius sphere)',
     'PHB: Antimagic Field ... Range: Self (10-foot-radius sphere)'),
]

lines = open(SRC, encoding='utf-8').read().split('\n')
done = 0
for sid, fld, old, new, why in FIX:
    idx = [i for i, l in enumerate(lines) if ("id: '%s'" % sid) in l]
    assert len(idx) == 1, '%s: expected 1 line, got %d' % (sid, len(idx))
    i = idx[0]
    pat = "%s: '%s'" % (fld, old)
    assert lines[i].count(pat) == 1, \
        '%s: expected exactly one "%s" on its line — already fixed or shape changed' % (sid, pat)
    lines[i] = lines[i].replace(pat, "%s: '%s'" % (fld, new))
    print('  %-22s %-9s %-24s -> %s' % (sid, fld, repr(old), repr(new)))
    print('      %s' % why)
    done += 1

assert done == len(FIX)
open(SRC, 'w', encoding='utf-8', newline='').write('\n'.join(lines))
print('\napplied %d spell fixes to %s' % (done, SRC))
