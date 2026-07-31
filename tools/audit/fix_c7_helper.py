"""C7 step 1: make the C6a ability-increase helper serve backgrounds as well as races.

PHB 2024 moved the ability score increase off the species and onto the BACKGROUND, and the shape is
identical to the flexible racial ASI already solved in C6a: three named abilities, distributed as
+2/+1 or +1/+1/+1. Rather than write a second copy that would drift the first time one of them
gained a rule, the existing helper's parameter is widened to a structural type and renamed to suit
both callers. Nothing about the behaviour changes.
"""
import re, io, sys, os
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
os.chdir(r'C:\Users\nabil\Desktop\Code\dnd-character-manager')

P = 'src/utils/racialAsi.ts'
s = open(P, encoding='utf-8').read()
orig = s

s = s.replace(
    "import type { AbilityKey, Race } from '../types';",
    "import type { AbilityKey } from '../types';\n"
    "\n"
    "/** Anything that grants an ability increase, fixed or chosen.\n"
    " *\n"
    " *  Races (C6a) and PHB 2024 backgrounds (C7) have exactly the same shape here — three candidate\n"
    " *  abilities and a set of legal distributions — so they share one implementation. Two copies\n"
    " *  would drift the moment either gained a rule, which is how C1, C3 and C6a all arose. */\n"
    "export interface AsiSource {\n"
    "  flexibleAsi?: number[][];\n"
    "  abilityScoreIncreases?: Partial<Record<AbilityKey, number>>;\n"
    "}", 1)
assert s != orig, 'import line not found'

s = s.replace("export function racialAsi(\n  race: Race | undefined,",
              "export function chosenAsi(\n  race: AsiSource | undefined,", 1)
s = s.replace("export function needsRacialAsi(\n  race: Race | undefined,",
              "export function needsAsiChoice(\n  race: AsiSource | undefined,", 1)
assert 'export function chosenAsi(' in s and 'export function needsAsiChoice(' in s, 'rename failed'
open(P, 'w', encoding='utf-8').write(s)

changed = []
for root, _, files in os.walk('src'):
    for fn in files:
        if not fn.endswith(('.ts', '.tsx')):
            continue
        fp = os.path.join(root, fn)
        if os.path.normpath(fp) == os.path.normpath(P):
            continue
        t = open(fp, encoding='utf-8').read()
        if 'racialAsi' not in t and 'needsRacialAsi' not in t:
            continue
        t2 = re.sub(r'\bneedsRacialAsi\b', 'needsAsiChoice', t)
        # only the identifier, never the module path in the import specifier
        t2 = re.sub(r"\bracialAsi\b(?!')", 'chosenAsi', t2)
        if t2 != t:
            open(fp, 'w', encoding='utf-8').write(t2)
            changed.append(fp)

print('helper widened; %d call-site files updated:' % len(changed))
for c in changed:
    print('   ' + c.replace('\\', '/'))

# CONTROL: no stale identifier anywhere, and the module path is intact.
for root, _, files in os.walk('src'):
    for fn in files:
        if fn.endswith(('.ts', '.tsx')):
            t = open(os.path.join(root, fn), encoding='utf-8').read()
            assert not re.search(r'\bneedsRacialAsi\b', t), 'stale needsRacialAsi in ' + fn
            assert not re.search(r"\bracialAsi\b(?!')", t), 'stale racialAsi identifier in ' + fn
print("control ok: no stale identifiers; import path 'utils/racialAsi' untouched")
