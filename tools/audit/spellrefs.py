"""Every spell id referenced by a subclass/race/feat must resolve to a real spell.

A dangling id is silent: getSpell() returns undefined and the render path skips the entry, so an
always-prepared spell the subclass is supposed to grant simply never appears. Nothing logs, nothing
reddens — the feature is just absent. That is invisible to a text-accuracy audit, which reads the
description, not the id.

Checks alwaysPreparedSpells, landSpells, expandedSpells, innateSpells and feat grantedSpells against
the union of every spell id defined in src/data/spells/.
"""
import re, os, sys, io, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
SRC = r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src'

# ── the spell corpus ──────────────────────────────────────────────────────────
spell_ids = set()
spell_dir = os.path.join(SRC, 'data', 'spells')
for fn in os.listdir(spell_dir):
    if not fn.endswith('.ts'):
        continue
    s = open(os.path.join(spell_dir, fn), encoding='utf-8').read()
    # entries are one-per-line objects: `  { id: 'fire-bolt', name: ... }`
    spell_ids |= set(re.findall(r"\{\s*id:\s*'([a-z0-9-]+)'", s))
assert len(spell_ids) > 300, 'spell corpus scan collapsed: only %d ids' % len(spell_ids)
print('spell corpus: %d ids across %d files' % (len(spell_ids), len(os.listdir(spell_dir))))

# positive/negative controls on the corpus itself
assert 'fireball' in spell_ids, 'positive control failed — fireball missing'
assert 'not-a-real-spell' not in spell_ids, 'negative control failed'

# ── every reference ───────────────────────────────────────────────────────────
FILES = [
    ('subclass-2014', r'data\subclasses\index.ts'),
    ('subclass-2024', r'data\subclasses\phb2024.ts'),
    ('race-2014',     r'data\races\index.ts'),
    ('race-2024',     r'data\races\phb2024.ts'),
    ('feat',          r'data\feats.ts'),
    ('feat-2024',     r'data\feats-phb2024.ts'),
    ('class-2014',    r'data\classes\index.ts'),
    ('class-2024',    r'data\classes\phb2024.ts'),
]
# the fields whose values are spell-id lists
FIELD = re.compile(
    r"(alwaysPreparedSpells|landSpells|expandedSpells|innateSpells|grantedSpells|spellList)\s*:\s*",
)

refs = collections.defaultdict(set)   # spell id -> {"file:owner"}
owner_of = {}                          # crude: nearest preceding id: '...'
total_refs = 0
for label, path in FILES:
    full = os.path.join(SRC, path)
    if not os.path.exists(full):
        print('  (skip, absent) %s' % path)
        continue
    s = open(full, encoding='utf-8').read()
    # index of every entity id so a reference can be attributed
    entities = [(m.start(), m.group(1)) for m in re.finditer(r"id:\s*'([a-z0-9-]+)'", s)]

    def owner_at(pos):
        best = '?'
        for start, eid in entities:
            if start <= pos:
                best = eid
            else:
                break
        return best

    for fm in FIELD.finditer(s):
        # take the balanced region after the field name
        start = fm.end()
        depth, i = 0, start
        while i < len(s):
            if s[i] in '{[':
                depth += 1
            elif s[i] in '}]':
                depth -= 1
                if depth == 0:
                    break
            i += 1
        region = s[start:i + 1]
        for sid in re.findall(r"'([a-z0-9-]{3,})'", region):
            # field keys like 'swamp' or ability keys like 'int' are not spell ids;
            # only count strings that look like ids AND are referenced as spells
            if sid in ('int', 'wis', 'cha', 'str', 'dex', 'con', 'long', 'short', 'cantrip'):
                continue
            total_refs += 1
            refs[sid].add('%s/%s (%s)' % (label, owner_at(fm.start()), fm.group(1)))

print('spell references found: %d raw, %d distinct ids' % (total_refs, len(refs)))
assert total_refs > 200, 'reference scan collapsed: only %d refs' % total_refs

# ── the diff ──────────────────────────────────────────────────────────────────
# land names and other non-spell keys will show up; filter to ids that at least
# LOOK like spells by excluding ones that are land/option keys used as object keys
LAND_KEYS = {'arctic', 'coast', 'desert', 'forest', 'grassland', 'mountain', 'swamp', 'underdark'}
dangling = {k: v for k, v in refs.items() if k not in spell_ids and k not in LAND_KEYS}

print('\n### DANGLING SPELL REFERENCES (%d)' % len(dangling))
for sid in sorted(dangling):
    for src in sorted(dangling[sid])[:4]:
        print('  %-34s <- %s' % (sid, src))

resolved = len(refs) - len(dangling) - len(LAND_KEYS & set(refs))
print('\nresolved: %d / %d distinct references' % (resolved, len(refs) - len(LAND_KEYS & set(refs))))
