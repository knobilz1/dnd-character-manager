"""Phase J fix — 15 PHB spells were missing their At Higher Levels scaling entirely.

Found by sweeping all 334 levelled PHB spells: the book body carries a "Higher Levels" clause and
the app has no `atHigherLevels` field. The reverse direction was clean — no spell invents scaling.

Text is written in the app's existing full-sentence PHB style, not the extract's shorthand.
Create Undead and Etherealness are quoted from the PHB PDF verbatim; the rest are the PHB wording
for clauses the extract states in shorthand.
"""
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
SRC = 'src/data/spells/index.ts'

FIX = {
    'enhance-ability':
        'When you cast this spell using a spell slot of 3rd level or higher, you can target one '
        'additional creature for each slot level above 2nd.',
    'glyph-of-warding':
        'When you cast this spell using a spell slot of 4th level or higher, the damage of an '
        'explosive runes glyph increases by 1d8 for each slot level above 3rd. If you create a '
        'spell glyph, you can store any spell of up to the same level as the slot you use for the '
        'glyph of warding.',
    'major-image':
        'When you cast this spell using a spell slot of 6th level or higher, the spell lasts until '
        'dispelled, without requiring your concentration.',
    'conjure-minor-elementals':
        'When you cast this spell using certain higher-level spell slots, you choose one of the '
        'summoning options above, and more creatures appear: twice as many with a 6th-level slot '
        'and three times as many with an 8th-level slot.',
    'conjure-woodland-beings':
        'When you cast this spell using certain higher-level spell slots, you choose one of the '
        'summoning options above, and more creatures appear: twice as many with a 6th-level slot '
        'and three times as many with an 8th-level slot.',
    'mordenkainens-private-sanctum':
        'When you cast this spell using a spell slot of 5th level or higher, you can increase the '
        'size of the cube by 100 feet for each slot level beyond 4th.',
    'bigbys-hand':
        'When you cast this spell using a spell slot of 6th level or higher, the damage from the '
        'clenched fist option increases by 2d8 and the damage from the grasping hand increases by '
        '2d6 for each slot level above 5th.',
    'conjure-elemental':
        'When you cast this spell using a spell slot of 6th level or higher, the challenge rating '
        'increases by 1 for each slot level above 5th.',
    'creation':
        'When you cast this spell using a spell slot of 6th level or higher, the cube increases by '
        '5 feet for each slot level above 5th.',
    'modify-memory':
        "When you cast this spell using a spell slot of 6th level or higher, you can alter the "
        "target's memories of an event that took place up to 7 days ago (6th level), 30 days ago "
        "(7th level), 1 year ago (8th level), or any time in the creature's past (9th level).",
    'planar-binding':
        'When you cast this spell using a spell slot of a higher level, the duration increases to '
        '10 days with a 6th-level slot, to 30 days with a 7th-level slot, to 180 days with an '
        '8th-level slot, and to a year and a day with a 9th-level spell slot.',
    'conjure-fey':
        'When you cast this spell using a spell slot of 7th level or higher, the challenge rating '
        'increases by 1 for each slot level above 6th.',
    'create-undead':
        'When you cast this spell using a 7th-level spell slot, you can animate or reassert control '
        'over four ghouls. When you cast this spell using an 8th-level spell slot, you can animate '
        'or reassert control over five ghouls or two ghasts or wights. When you cast this spell '
        'using a 9th-level spell slot, you can animate or reassert control over six ghouls, three '
        'ghasts or wights, or two mummies.',
    'globe-of-invulnerability':
        'When you cast this spell using a spell slot of 7th level or higher, the barrier blocks '
        'spells of one level higher for each slot level above 6th.',
    'etherealness':
        'When you cast this spell using a spell slot of 8th level or higher, you can target up to '
        'three willing creatures (including you) for each slot level above 7th. The creatures must '
        'be within 10 feet of you when you cast the spell.',
}

lines = open(SRC, encoding='utf-8').read().split('\n')
done, missed = 0, []
for sid, text in FIX.items():
    idx = [i for i, l in enumerate(lines) if ("id: '%s'" % sid) in l]
    if len(idx) != 1:
        missed.append('%s (matched %d lines)' % (sid, len(idx)))
        continue
    i = idx[0]
    if 'atHigherLevels' in lines[i]:
        missed.append('%s (already has atHigherLevels)' % sid)
        continue
    # insert before `classes:` so the field order matches every other entry
    m = re.search(r",\s*classes:", lines[i])
    if not m:
        missed.append('%s (no classes: anchor)' % sid)
        continue
    esc = text.replace("\\", "\\\\").replace("'", "\\'")
    lines[i] = lines[i][:m.start()] + ", atHigherLevels: '" + esc + "'" + lines[i][m.start():]
    print('  + %s' % sid)
    done += 1

if missed:
    print('\nNOT APPLIED:')
    for m in missed:
        print('  ! ' + m)
open(SRC, 'w', encoding='utf-8', newline='').write('\n'.join(lines))
print('\napplied %d of %d' % (done, len(FIX)))
