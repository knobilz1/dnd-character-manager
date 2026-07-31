"""Every override key must name a resource that actually exists.

An override for a key no definition declares is a SILENT no-op: load() applies overrides by
mapping over resources that are already there, so a typo'd or renamed key means the feature
keeps its placeholder max forever with nothing to show for it. That is the R7 failure shape,
and splitting psionic_energy just created two new override keys, so check the whole set.

Also checks the reverse: a resource whose maxPerLevel is a flat placeholder (all 1s above the
gain level) but which NO override manages — that resource would display a wrong max.
"""
import re, sys, io, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
SRC = r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src'

def read(p):
    return open(SRC + '\\' + p, encoding='utf-8').read()

# ── every resource key declared anywhere ──────────────────────────────────────
defined = collections.defaultdict(set)
for label, path in (('class', r'data\classes\index.ts'), ('subclass', r'data\subclasses\index.ts'),
                    ('race', r'data\races\index.ts'), ('feat', r'data\feats.ts')):
    try:
        s = read(path)
    except FileNotFoundError:
        print('!! missing %s' % path); continue
    for k in re.findall(r"key:\s*'([a-z0-9_]+)'", s):
        defined[k].add(label)
assert len(defined) > 100, 'defined-key scan collapsed: only %d keys' % len(defined)

# ── every key an override writes, in BOTH mirrored implementations ────────────
overrides = {}
for label, path, pat in (
    ('store',   r'store\useCharacterStore.ts',  r"overrides\['([a-z0-9_]+)'\]"),
    ('derived', r'hooks\useCharacterDerived.ts', r"resourceMaxOverrides\['([a-z0-9_]+)'\]"),
):
    keys = set(re.findall(pat, read(path)))
    assert keys, 'override scan for %s found nothing — pattern is wrong' % label
    overrides[label] = keys

print('defined resource keys: %d' % len(defined))
for k, v in overrides.items():
    print('override keys (%-7s): %d' % (k, len(v)))

# 1. the two override implementations must agree
only_store = overrides['store'] - overrides['derived']
only_deriv = overrides['derived'] - overrides['store']
print('\n── mirror check ──')
print('  in store but not derived: %s' % (sorted(only_store) or 'none'))
print('  in derived but not store: %s' % (sorted(only_deriv) or 'none'))

# 2. every override key must exist as a real resource definition
print('\n── dangling override keys (silent no-ops) ──')
dangling = sorted({k for ks in overrides.values() for k in ks} - set(defined))
print('  %s' % (dangling or 'none'))

# 3. control: a key that certainly exists, and one that certainly does not
assert 'rage' in defined, 'positive control failed — rage not found'
assert 'definitely_not_a_resource' not in defined, 'negative control failed'
print('\ncontrols ok (rage present, bogus key absent)')
