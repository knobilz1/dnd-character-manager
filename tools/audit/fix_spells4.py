"""Phase I, part 2 fixes — three PHB 2024 spells, all confirmed against the PHB 2024 PDF.

These were invisible to the extract sweep: the PHB2024 markdown has no spell-description section
at all, so all 12 of its spells went uncompared until the PDF fallback was built.
"""
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
SRC = 'src/data/spells/phb2024.ts'

lines = open(SRC, encoding='utf-8').read().split('\n')


def line_of(sid):
    idx = [i for i, l in enumerate(lines) if ("id: '%s'" % sid) in l]
    assert len(idx) == 1, '%s: expected 1 line, got %d' % (sid, len(idx))
    return idx[0]


def sub(sid, old, new, why):
    i = line_of(sid)
    assert lines[i].count(old) == 1, '%s: %r not found once — already fixed?' % (sid, old)
    lines[i] = lines[i].replace(old, new)
    print('  %-28s %s' % (sid, why))


# Mind Sliver's duration is 1 round — the OCR renders it "l round" (lowercase L).
# The 2014/TCE Mind Sliver in index.ts already says "1 round"; only the 2024 copy was wrong.
sub('mind-sliver-2024', "duration: 'Instantaneous'", "duration: '1 round'",
    'duration Instantaneous -> 1 round   [PHB2024: "Duration: 1 round"]')

# Both of these have a material component the app omitted entirely.
sub('jallarzi-storm-of-radiance',
    "components: ['V', 'S']",
    "components: ['V', 'S', 'M'], materialComponent: 'a pinch of phosphorus'",
    "+M component 'a pinch of phosphorus'   [PHB2024: \"Component: V, S, M (a pinch of phosphorus)\"]")

sub('yolandes-regal-presence',
    "components: ['V', 'S']",
    "components: ['V', 'S', 'M'], materialComponent: 'a miniature tiara'",
    "+M component 'a miniature tiara'   [PHB2024: \"Component: V, S, M (a miniature tiara)\"]")

open(SRC, 'w', encoding='utf-8', newline='').write('\n'.join(lines))
print('\napplied 3 fixes to %s' % SRC)
