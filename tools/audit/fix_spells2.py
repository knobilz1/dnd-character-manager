"""Phase I, round 2 — two more spell fixes found once named spells started being compared."""
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
SRC = 'src/data/spells/index.ts'

lines = open(SRC, encoding='utf-8').read().split('\n')


def one(sid):
    idx = [i for i, l in enumerate(lines) if ("id: '%s'" % sid) in l]
    assert len(idx) == 1, '%s: expected 1 line, got %d' % (sid, len(idx))
    return idx[0]


# 1. Divine Smite is a PALADIN CLASS FEATURE in 2014 (the app already has it at paladin L2) and
#    only became a spell in PHB 2024, whose paladin feature is "Paladin's Smite". Tagged PHB, it
#    let a 2014 paladin ALSO prepare it as a 1st-level spell. Convention for 2024 spells is
#    sourceBook PHB2024 + both class ids; bookEnabled() does the edition gating.
i = one('divine-smite')
assert "sourceBook: 'PHB'" in lines[i], 'divine-smite: already retagged?'
lines[i] = lines[i].replace("sourceBook: 'PHB'", "sourceBook: 'PHB2024'")
assert "classes: ['paladin']" in lines[i], 'divine-smite: unexpected classes shape'
lines[i] = lines[i].replace("classes: ['paladin']", "classes: ['paladin', 'paladin-2024']")
print("  divine-smite      sourceBook PHB -> PHB2024, classes += paladin-2024")
print("      2014 Divine Smite is a class feature (PHB p.85); the app already has it at paladin L2")

# 2. Crusader's Mantle — the PHB Range line is literally "Self"; the 30-foot radius is body text.
i = one('crusaders-mantle')
assert "range: 'Self (30-foot radius)'" in lines[i], "crusaders-mantle: unexpected range"
lines[i] = lines[i].replace("range: 'Self (30-foot radius)'", "range: 'Self'")
print("  crusaders-mantle  range 'Self (30-foot radius)' -> 'Self'")
print("      PHB: \"Crusader's Mantle 3rd-level evocation ... Range: Self\"")

open(SRC, 'w', encoding='utf-8', newline='').write('\n'.join(lines))
print('\napplied 2 fixes to %s' % SRC)
