"""Find race traits with a limited-use rule that have no tracked resource (root cause R3).

Carries every lesson the subclass sweeps cost:
  - unescape \\' in BOTH the name and the description groups (artifacts #6 and #7)
  - match the paraphrased phrasings the data actually uses, not just PHB wording
  - controls at EVERY level that filters: file, entry, and trait
"""
import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
P = r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src\data\races\index.ts'
src = open(P, encoding='utf-8').read()

starts = [m.start() for m in re.finditer(r"\n  \{\s*\n?\s*id: '", src)] or \
         [m.start() for m in re.finditer(r"\n  \{ id: '", src)]
starts.append(len(src))
entries = []
for a, b in zip(starts, starts[1:]):
    blk = src[a:b]
    m = re.search(r"id: '([a-z0-9\-]+)'", blk)
    if not m:
        continue
    nm = re.search(r"name: '((?:[^'\\]|\\.)+)'", blk)
    entries.append((m.group(1), nm.group(1) if nm else '?', blk))

# ENTRY-LEVEL CONTROL
assert len(entries) >= 30, 'entry parse looks wrong: %d' % len(entries)
have = {e[0] for e in entries}
for k in ['dragonborn', 'half-orc', 'tiefling']:
    assert k in have, 'ENTRY CONTROL FAILED: %s missing (parsed %d)' % (k, len(entries))
assert 'bogus-race' not in have, 'NEGATIVE CONTROL FAILED'
print('entry controls ok — %d races parsed' % len(entries))

TRAIT = re.compile(r"\{ name: '((?:[^'\\]|\\.)+)', description: '((?:[^'\\]|\\.)*)' \}")
# TRAIT-LEVEL CONTROL: a known trait with an apostrophe in its name must parse.
_all = {}
for rid, _, blk in entries:
    _all[rid] = [n for n, _ in TRAIT.findall(blk)]
assert any('Breath Weapon' in v for v in _all.values()), 'TRAIT CONTROL FAILED (Breath Weapon)'
print('trait controls ok — %d traits parsed' % sum(len(v) for v in _all.values()))

PATS = [r'once per (?:short|long) rest', r'once per (?:short or long|long or short) rest',
        r'until you finish a (?:short|long) rest', r'regain(?:s)? (?:all )?(?:expended|the) use',
        r'uses of this (?:feature|trait)', r'number of times equal to your proficiency bonus',
        r'proficiency bonus.{0,40}?times', r"can't use (?:it|this feature|this trait) again until",
        r'expend(?:ed)? uses', r'uses?\s*=', r'uses equal to', r'per (?:short|long) rest',
        r'per short or long rest', r'\d\s*/\s*(?:short|long) rest', r'once per day']
PAT = re.compile('|'.join(PATS), re.I)
assert PAT.search("Uses = proficiency bonus per long rest"), 'PAT CONTROL FAILED'
assert not PAT.search('You have darkvision out to 60 feet.'), 'PAT NEGATIVE CONTROL FAILED'

out, tot = [], 0
for rid, rname, blk in entries:
    tracked = set(re.findall(r"key: '([a-z_0-9]+)'", blk))
    hits = []
    for name, desc in TRAIT.findall(blk):
        if not PAT.search(desc.replace("\\'", "'")):
            continue
        slug = re.sub(r'[^a-z]', '_', name.lower().replace("\\'", ''))
        if any(k in slug or slug.startswith(k[:8]) for k in tracked):
            continue
        hits.append(name)
    if hits:
        tot += len(hits)
        out.append((rid, rname, hits, sorted(tracked)))

# Spell-granting traits are covered by the SEPARATE innateSpells system, which SpellPanel
# renders with its own per-spell use counter. Flagging those as "untracked" would be wrong.
# Split on it rather than guessing from the trait text.
CASTY = re.compile(r'\bcast\b|\bspell\b', re.I)
spell_covered, real = [], []
for rid, rname, hits, tracked in sorted(out):
    blk = next(b for i, _, b in entries if i == rid)
    has_innate = 'innateSpells' in blk
    for h in hits:
        desc = next((d for n, d in TRAIT.findall(blk) if n == h), '')
        if has_innate and CASTY.search(desc):
            spell_covered.append((rid, h))
        else:
            real.append((rid, rname, h, tracked))

print('\n### Covered by the innateSpells system (%d) — not R3 work' % len(spell_covered))
byrace = {}
for rid, h in spell_covered:
    byrace.setdefault(rid, []).append(h)
for rid in sorted(byrace):
    print('   %-26s %s' % (rid, '; '.join(byrace[rid])))

print('\n### GENUINELY UNTRACKED (%d)' % len(real))
for rid, rname, h, tracked in real:
    print('   %-26s %-30s %s' % (rid, h, ('[has: %s]' % ','.join(tracked)) if tracked else ''))
print('\n%d races flagged, %d traits; %d genuinely untracked' % (len(out), tot, len(real)))
