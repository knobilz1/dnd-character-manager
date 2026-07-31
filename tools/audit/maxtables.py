"""maxPerLevel tables must cover levels 1..20 with numbers (or 'unlimited').

load() reads `rd.maxPerLevel[level] ?? 0`, so a gap silently becomes 0 — the resource is
inserted with max 0 (or, once inserted, re-synced DOWN to 0 on the next load). A resource
that reads 0/0 on the sheet looks like an expended feature rather than a data hole, which is
why this needs a sweep rather than spot checks.

Tables built by a helper (profBonusByLevel(), fromLevel(n, x)) are complete by construction
and are counted separately rather than skipped silently — a silent skip is how a sweep ends
up reporting "clean" over half the corpus.
"""
import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
SRC = r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src'
FILES = [('class', r'data\classes\index.ts'), ('subclass', r'data\subclasses\index.ts'),
         ('race', r'data\races\index.ts'), ('feat', r'data\feats.ts')]

# every declared key, so nothing can fall out of the sweep unnoticed
KEY = re.compile(r"key:\s*'([a-z0-9_]+)'")
LITERAL = re.compile(r"key:\s*'([a-z0-9_]+)'[\s\S]{0,400}?maxPerLevel:\s*\{([^}]*)\}")
HELPER = re.compile(r"key:\s*'([a-z0-9_]+)'[\s\S]{0,400}?maxPerLevel:\s*(\w+)\(")

problems, literal_keys, helper_keys, all_keys = [], set(), {}, set()
for label, path in FILES:
    s = open(SRC + '\\' + path, encoding='utf-8').read()
    all_keys |= set(KEY.findall(s))
    for m in HELPER.finditer(s):
        helper_keys[m.group(1)] = m.group(2)
    for m in LITERAL.finditer(s):
        key, body = m.group(1), m.group(2)
        if key in helper_keys:
            continue
        literal_keys.add(key)
        levels = {int(lm.group(1)): lm.group(2)
                  for lm in re.finditer(r"(\d+)\s*:\s*('unlimited'|\d+)", body)}
        missing = [L for L in range(1, 21) if L not in levels]
        if missing:
            problems.append((label, key, 'missing levels %s' % missing[:6]))
        elif all(levels[L] == '0' for L in range(1, 21)):
            problems.append((label, key, 'every level is 0 — can never appear'))

# feat grantedResources carry a flat `max:` instead of a level table — a different shape,
# not a gap. Name them explicitly so they are excluded on purpose, not by a loose assert.
FLAT = set(re.findall(r"key:\s*'([a-z0-9_]+)',\s*name:[^}]*?\bmax:\s*\d+",
                      open(SRC + r'\data\feats.ts', encoding='utf-8').read()))
print('flat-max (feat)    : %d  %s' % (len(FLAT), sorted(FLAT)))
covered = literal_keys | set(helper_keys) | FLAT
unaccounted = sorted(all_keys - covered)
print('declared keys      : %d' % len(all_keys))
print('literal tables     : %d' % len(literal_keys))
print('helper-built tables: %d  %s' % (len(helper_keys), sorted(set(helper_keys.values()))))
print('unaccounted        : %d  %s' % (len(unaccounted), unaccounted[:12]))
assert not unaccounted, 'these keys were never checked — fix the sweep, do not report clean'
print('\nproblems: %d' % len(problems))
for p in problems:
    print('  %-9s %-32s %s' % p)

assert [L for L in range(1, 21) if L not in {1: '1'}], 'negative control failed'
print('control ok (a partial table is detected as partial)')
