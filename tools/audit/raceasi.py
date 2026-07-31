"""Racial ability score increases: is the bonus reachable at all?

2014 races carry a FIXED ASI (+2 Str, +1 Con...). MMoM and PHB 2024 replaced that with a FLEXIBLE
one — "increase one score by 2 and a different one by 1, or three different scores by 1" — chosen by
the player. The app models flexible races as `abilityScoreIncreases: {}`.

The mechanical question is therefore not whether the numbers are right, but whether a player can ever
supply them. Every read site takes the static object; if nothing writes a chosen value, a flexible
race contributes +0 to every ability, permanently.

Cross-references the empty-ASI races against their trait text so the two halves are checked together:
a race whose prose describes a flexible increase but whose data is empty is only a defect if there is
no picker — which the code check below settles.
"""
import re, sys, io, os, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
ROOT = r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src'
RACES = os.path.join(ROOT, 'data', 'races')


def parse(path, label):
    s = open(path, encoding='utf-8').read()
    starts = [m.start() for m in re.finditer(r"^\s+id: '([a-z0-9-]+)',", s, re.M)]
    starts.append(len(s))
    out = []
    for i in range(len(starts) - 1):
        chunk = s[starts[i]:starts[i + 1]]
        asi = re.search(r"abilityScoreIncreases: \{([^}]*)\}", chunk)
        tr = re.search(r"traits: \[([\s\S]*?)\n    \]", chunk)
        out.append({
            'file': label,
            'id': re.search(r"id: '([a-z0-9-]+)'", chunk).group(1),
            'book': (re.search(r"sourceBook: '(\w+)'", chunk) or [None, '?'])[1],
            'asi': (asi.group(1).strip() if asi else None),
            'traitText': tr.group(1) if tr else '',
        })
    return out


races = parse(os.path.join(RACES, 'index.ts'), '2014') + parse(os.path.join(RACES, 'phb2024.ts'), '2024')
assert len(races) == 122, 'race parse collapsed: %d' % len(races)
assert all(r['asi'] is not None for r in races), \
    'races with no abilityScoreIncreases field at all: %s' % [r['id'] for r in races if r['asi'] is None]
print('races parsed: %d, every one has an abilityScoreIncreases field' % len(races))

byid = {r['id']: r for r in races}
assert byid['dwarf-hill']['asi'], 'positive control: dwarf-hill should have a fixed ASI'
assert not byid['deep-gnome']['asi'], 'negative control: deep-gnome (MMoM) should be empty'
print('controls ok\n')

empty = [r for r in races if not r['asi']]
fixed = [r for r in races if r['asi']]

# does the prose describe a flexible increase?
FLEX = re.compile(r'increase one score by 2|three different scores by 1|increase one ability score by 2', re.I)
flex_prose = [r for r in empty if FLEX.search(r['traitText'])]
silent = [r for r in empty if not FLEX.search(r['traitText'])]

# ── is there anywhere to PUT a chosen racial ASI? ────────────────────────────
code = ''
for base, _, files in os.walk(ROOT):
    for fn in files:
        if fn.endswith(('.ts', '.tsx')) and os.sep + 'data' not in base:
            code += open(os.path.join(base, fn), encoding='utf-8', errors='replace').read()
types_src = open(os.path.join(ROOT, 'types', 'index.ts'), encoding='utf-8').read()

storage = [p for p in ('racialAsi', 'raceAsi', 'racialChoice', 'racialAbilityChoice', 'asiChoices')
           if p in types_src]
writers = re.findall(r'abilityScoreIncreases\s*[=:]\s*[^,;\n]{0,40}', code)
readers = len(re.findall(r'abilityScoreIncreases', code))

print('races with a FIXED ASI          : %d' % len(fixed))
print('races with an EMPTY ASI         : %d' % len(empty))
print('   ...whose prose says flexible : %d' % len(flex_prose))
print('   ...with no such prose        : %d' % len(silent))
print()
print('Character-level storage for a chosen racial ASI : %s' % (storage or 'NONE'))
print('code sites reading abilityScoreIncreases        : %d' % readers)
print('code sites assigning abilityScoreIncreases      : %d' % len(writers))
print()

by_book = collections.Counter(r['book'] for r in empty)
print('empty-ASI races by book:')
for bk, n in by_book.most_common():
    ids = [r['id'] for r in empty if r['book'] == bk]
    print('   %-8s %-3d  %s' % (bk, n, ', '.join(ids[:6]) + (' ...' if len(ids) > 6 else '')))

if silent:
    print('\nempty ASI and no flexible-ASI prose either (check these by hand):')
    for r in silent:
        print('   %-28s %s' % (r['id'], r['book']))

print('\nraces swept: %d   flexible-but-unreachable: %d (%.0f%%)'
      % (len(races), len(empty), 100.0 * len(empty) / len(races)))
