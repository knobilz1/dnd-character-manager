"""Which fix-plan items are actually still outstanding?

The plan in AUDIT-FINDINGS.md was written across many sessions and several items have since been
fixed in passing (D1, G3 and G4 were all already done when this was written). Checking them one at
a time by hand costs a tool call each and gets stale again immediately, so each item states its own
test here and the whole plan is re-checked in one run.

Each probe returns True when the item is FIXED. A probe that cannot decide says so rather than
guessing — an item silently reported "fixed" because its probe was wrong is the same failure mode
this audit keeps hitting, so UNKNOWN is a valid and visible answer.
"""
import re, sys, io, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
REPO = r'C:\Users\nabil\Desktop\Code\dnd-character-manager'

_cache = {}


def f(rel):
    if rel not in _cache:
        p = os.path.join(REPO, rel)
        _cache[rel] = open(p, encoding='utf-8').read() if os.path.exists(p) else None
    return _cache[rel]


def probe(fn):
    try:
        return fn()
    except Exception as e:
        return ('UNKNOWN', str(e))


# ---- Tier 1 ---------------------------------------------------------------

def d1():
    s = f('src/pages/sheet/LevelUpDialog.tsx')
    return 'newLevel >= classDef.subclassLevel' in s


def d4():
    # 23 build choices need somewhere to live: a subclassOptions slice mirroring classOptions.
    s = f('src/types/index.ts')
    return 'subclassOptions' in (s or '')


# ---- Tier 2 ---------------------------------------------------------------

def r2_prepared():
    s = f('src/store/useCharacterStore.ts')
    m = re.search(r'toggleSpellPrepared:.*?\n  \w+:', s, re.S)
    return bool(m and re.search(r'maxPrepared|maxPreparedSpellsFor|cap', m.group(0)))


def r2_spellbook():
    s = f('src/store/useCharacterStore.ts')
    m = re.search(r'addSpellToBook:.*?\n  \w+:', s, re.S)
    return bool(m and re.search(r'max|cap|known', m.group(0), re.I))


def r4():
    s = f('src/types/index.ts')
    m = re.search(r"rechargeOn\??:\s*([^;\n]+)", s or '')
    if not m:
        return ('UNKNOWN', 'no rechargeOn in types')
    # widened if it can express more than the original three
    return len(re.findall(r"'[a-z-]+'", m.group(1))) > 3


def c1():
    s = f('src/data/classes/phb2024.ts')
    m = re.search(r"id: 'cleric-2024'.*?(?=\n  \{ id:|\Z)", s or '', re.S)
    if not m:
        return ('UNKNOWN', 'cleric-2024 not found')
    cd = re.search(r"channel_divinity.*?\}", m.group(0), re.S)
    return bool(cd and 'short' in cd.group(0) and 'long' in cd.group(0))


# ---- Tier 3 ---------------------------------------------------------------

def r5():
    s = f('src/data/subclasses/index.ts')
    return ('COUNT', len(re.findall(r'resources: \[', s or '')), 'of 141 subclasses define resources')


def r3():
    s = f('src/types/index.ts')
    m = re.search(r'export interface Race \{.*?\n\}', s or '', re.S)
    return bool(m and 'resources' in m.group(0))


def r6():
    s = f('src/data/items/index.ts') or f('src/data/items.ts')
    if s is None:
        return ('UNKNOWN', 'items file not found')
    return ('COUNT', len(re.findall(r'maxCharges:', s)), 'item templates carry maxCharges')


# ---- Tier 4 / 5 -----------------------------------------------------------

def d2():
    s = f('src/pages/sheet/LevelUpDialog.tsx')
    m = re.search(r'const isPreparedCaster = \[([^\]]*)\]', s)
    return bool(m and 'bard-2024' in m.group(1) and 'ranger-2024' in m.group(1))


def d3():
    # Epic Boon is a feat, not a stat bump. Fixed = flagged featOnly AND the UI honours featOnly.
    s = f('src/data/classes/phb2024.ts')
    tagged = len(re.findall(r"name: 'Epic Boon'.*?featOnly: true", s or ''))
    ui = f('src/pages/sheet/LevelUpDialog.tsx')
    return tagged >= 12 and 'featOnly' in (ui or '')


def a1_rage():
    # 99 in the DATA is not the bug — it is the deliberate "unlimited" sentinel, documented at the
    # ResourceCounter. The bug was the DISPLAY showing "99 / 99", so that is what to probe.
    return 'max === 99' in (f('src/pages/sheet/SheetPage.tsx') or '')


def b1_berserker():
    s = f('src/data/subclasses/index.ts')
    m = re.search(r"id: 'berserker'.*?(?=\n  \{ id:)", s or '', re.S)
    if not m:
        return ('UNKNOWN', 'berserker not found')
    return '24 hours' in m.group(0)


def a1_monk2024():
    s = f('src/data/classes/phb2024.ts')
    return 'Disciplined Survivor' in (s or '')


# ---- later rounds ---------------------------------------------------------

def g1():
    s = f('src/data/subclasses/index.ts')
    m = re.search(r"id: 'twilight-domain'.*?(?=\n  \{ id:)", s or '', re.S)
    return bool(m and 'tiny-hut' in m.group(0))


def g2():
    s = f('src/data/subclasses/phb2024.ts')
    m = re.search(r"id: 'oath-of-devotion-2024'.*?(?=\n  \{ id:)", s or '', re.S)
    return bool(m and 'protection-from-evil' in m.group(0))


def g3():
    return "id: 'circle-of-stars-2024'" in (f('src/data/subclasses/phb2024.ts') or '')


def g4():
    return "id: 'mind-sliver-2024'" in (f('src/data/spells/phb2024.ts') or '')


def g7():
    s = f('src/data/spells/index.ts')
    if 'getSpellsByClass' not in (s or ''):
        return True                       # removed
    hits = sum(('getSpellsByClass' in (f(p) or '')) for p in ALL_TS)
    return hits <= 1                      # only its own definition left


def g8():
    s = f('src/data/classes/phb2024.ts')
    return ('COUNT', len(re.findall(r'startingEquipment:', s or '')), 'of 12 2024 classes list equipment')


def g10():
    s = f('src/data/subclassTips.ts')
    return ('COUNT', len(re.findall(r"'[a-z0-9-]+-2024'", s or '')), '2024 subclass tip keys')


def b6():
    s = f('src/data/subclasses/phb2024.ts')
    bad = [n for n in ('Aberrant Mind', 'Clockwork Soul', 'Draconic Bloodline',
                       'School of Abjuration', 'School of Divination', 'School of Evocation',
                       'School of Illusion', 'The Archfey', 'The Celestial', 'The Fiend',
                       'The Great Old One') if "name: '%s'" % n in (s or '')]
    return not bad or ('COUNT', len(bad), 'subclasses still showing their 2014 name')


def c7():
    s = f('src/types/index.ts')
    m = re.search(r'export interface Background \{.*?\n\}', s or '', re.S)
    return bool(m and re.search(r'abilityScore|asi', m.group(0), re.I))


def a3_advantage():
    # "advantage in the file" was a FALSE DONE: the only hits were two exhaustion COMMENTS. The
    # question is whether derived output actually carries an advantage/disadvantage channel that
    # a feature can feed, so look for an exported field, not for the word.
    s = f('src/hooks/useCharacterDerived.ts') or ''
    return bool(re.search(r'^\s*(advantage|disadvantage)\w*\s*[:,]', s, re.M))


def armor_prof():
    # The enforcement is the PENALTY reaching a roll, not merely the predicate existing — a helper
    # nothing calls is exactly the C3 shape this audit keeps finding.
    s = f('src/pages/sheet/SheetPage.tsx') or ''
    return 'armorPen.strDexDisadvantage' in s and 'weaponArmorPen.strDexDisadvantage' in s


def erlw_dragonmark():
    s = f('src/data/races/index.ts')
    m = re.search(r"id: 'erlw-aberrant-dragonmark'.*?(?=\n  \{ id:)", s or '', re.S)
    return bool(m and 'innateSpells' in m.group(0))


ALL_TS = []
for root, _, files in os.walk(os.path.join(REPO, 'src')):
    for fn in files:
        if fn.endswith(('.ts', '.tsx')):
            ALL_TS.append(os.path.relpath(os.path.join(root, fn), REPO).replace('\\', '/'))

ITEMS = [
    ('T1', 'D1  subclass prompt uses >=', d1),
    ('T1', 'D4  subclassOptions storage exists', d4),
    ('T2', 'R2  toggleSpellPrepared caps prepared', r2_prepared),
    ('T2', 'R2  addSpellToBook caps spells known', r2_spellbook),
    ('T2', 'R4  rechargeOn enum widened', r4),
    ('T2', 'C1  cleric-2024 Channel Divinity partial restore', c1),
    ('T3', 'R5  subclass resources', r5),
    ('T3', 'R3  Race.resources field exists', r3),
    ('T3', 'R6  item charges', r6),
    ('T4', 'D2  bard/ranger-2024 are prepared casters', d2),
    ('T4', 'D3  Epic Boon featOnly + UI honours it', d3),
    ('T5', 'A1  level-20 Rage not 99', a1_rage),
    ('T5', 'B1  Berserker 24-hour clause', b1_berserker),
    ('A',  'A1  monk-2024 Disciplined Survivor exists', a1_monk2024),
    ('A',  'A3  advantage/disadvantage wired into derived', a3_advantage),
    ('A',  'armor proficiency enforced', armor_prof),
    ('G',  'G1  Twilight Domain grants Tiny Hut', g1),
    ('G',  'G2  2024 Devotion grants Prot. Evil and Good', g2),
    ('G',  'G3  circle-of-stars id namespaced', g3),
    ('G',  'G4  mind-sliver id namespaced', g4),
    ('G',  'G7  getSpellsByClass dead code removed', g7),
    ('G',  'G8  2024 classes have starting equipment', g8),
    ('G',  'G10 subclassTips cover 2024', g10),
    ('B',  'B6  2024 subclass display names', b6),
    ('C',  'C7  Background carries an ability increase', c7),
    ('C',  'erlw-aberrant-dragonmark innateSpells', erlw_dragonmark),
]

print('%-4s %-46s %s' % ('tier', 'item', 'status'))
print('-' * 78)
todo = []
for tier, label, fn in ITEMS:
    r = probe(fn)
    if r is True:
        st = 'DONE'
    elif r is False:
        st = '** OUTSTANDING **'
        todo.append(label)
    elif isinstance(r, tuple) and r[0] == 'COUNT':
        st = '%s %s' % (r[1], r[2])
        todo.append('%s (%s)' % (label, st))
    elif isinstance(r, tuple) and r[0] == 'UNKNOWN':
        st = 'UNKNOWN — %s' % r[1]
        todo.append('%s [probe failed]' % label)
    else:
        st = str(r)
    print('%-4s %-46s %s' % (tier, label, st))

print('\n%d of %d items still need work:' % (len(todo), len(ITEMS)))
for t in todo:
    print('   -', t)
