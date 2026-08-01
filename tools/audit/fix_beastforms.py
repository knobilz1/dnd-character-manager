"""Phase K fix — 10 wrong stat blocks in beastForms.ts, corrected against the SRD.

beastForms.ts was labelled "(Monster Manual)" with no Monster Manual on disk; the entries were
typed from memory and had never been checked. With the SRD (CC-BY) available they finally can be.
These are live Wild Shape numbers — a wrong AC or damage die is wrong at the table.

Each replacement is scoped to its own entry block so it cannot leak into a neighbour, and asserts
the old value is present exactly once first.
"""
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
SRC = 'src/data/beastForms.ts'

# beast id -> [(old, new, note)]
FIX = {
    'eagle':                    [("hp: 4,", "hp: 3,", "HP 4 -> 3 (SRD: 3, 1d6)")],
    'octopus':                  [("damage: '1d4+2', damageType: 'bludgeoning'",
                                  "damage: '1', damageType: 'bludgeoning'",
                                  "Tentacles 1d4+2 -> flat 1 bludgeoning")],
    'blood-hawk':               [("ac: 12,", "ac: 12,", "")],   # placeholder, real edit below
    'poisonous-snake':          [("damage: '1d4+3', damageType: 'piercing'",
                                  "damage: '1', damageType: 'piercing'",
                                  "Bite 1d4+3 -> flat 1 piercing (poison is separate)")],
    'constrictor-snake':        [("con: 11", "con: 12", "CON 11 -> 12")],
    'black-bear':               [("name: 'Bite', toHit: 4", "name: 'Bite', toHit: 3", "Bite +4 -> +3"),
                                 ("name: 'Claws', toHit: 4", "name: 'Claws', toHit: 3", "Claws +4 -> +3"),
                                 ("damage: '2d6+2', damageType: 'slashing'",
                                  "damage: '2d4+2', damageType: 'slashing'", "Claws 2d6+2 -> 2d4+2")],
    'giant-toad':               [("con: 11", "con: 13", "CON 11 -> 13")],
    'giant-constrictor-snake':  [("damage: '1d8+4', damageType: 'piercing'",
                                  "damage: '2d6+4', damageType: 'piercing'", "Bite 1d8+4 -> 2d6+4")],
    'triceratops':              [("hp: 114,", "hp: 95,", "HP 114 -> 95")],
    'mammoth':                  [("name: 'Gore', toHit: 11", "name: 'Gore', toHit: 10", "Gore +11 -> +10"),
                                 ("name: 'Stomp', toHit: 11", "name: 'Stomp', toHit: 10", "Stomp +11 -> +10")],
}
# blood-hawk is an AC change, expressed separately because 'ac: 13' also appears in other entries
FIX['blood-hawk'] = [("ac: 13,", "ac: 12,", "AC 13 -> 12")]

text = open(SRC, encoding='utf-8').read()
applied, problems = 0, []

for bid, edits in FIX.items():
    m = re.search(r"\{\s*id: '%s',.*?\n  \}" % re.escape(bid), text, re.S)
    if not m:
        problems.append('%s: entry block not found' % bid)
        continue
    block = m.group(0)
    new_block = block
    for old, new, note in edits:
        if not note:
            continue
        n = new_block.count(old)
        if n != 1:
            problems.append('%s: %r appears %d times in its block' % (bid, old, n))
            continue
        new_block = new_block.replace(old, new)
        print('  %-26s %s' % (bid, note))
        applied += 1
    text = text[:m.start()] + new_block + text[m.end():]

if problems:
    print('\nPROBLEMS:')
    for p in problems:
        print('  ! ' + p)
    sys.exit(1)

open(SRC, 'w', encoding='utf-8', newline='').write(text)
print('\napplied %d field fixes across %d beasts' % (applied, len(FIX)))
