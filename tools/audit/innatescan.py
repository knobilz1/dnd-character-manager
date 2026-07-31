"""Find race traits that GRANT A SPELL but have no matching `innateSpells` entry.

Worse than a missing counter: with no innateSpells entry the spell never appears in
SpellPanel, so it cannot be cast from the sheet at all. Found via R3, which turned up
deep-gnome, duergar and erlw-aberrant-dragonmark this way.

Reports candidates, not verdicts — a trait can name a spell it does not grant
("as if by the *invisibility* spell"), so every row needs a human read.
"""
import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
R = r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src\data\races\index.ts'
src = open(R, encoding='utf-8').read()

starts = [m.start() for m in re.finditer(r"\n  \{\s*\n?\s*id: '", src)]
starts.append(len(src))
races = []
for a, b in zip(starts, starts[1:]):
    blk = src[a:b]
    m = re.search(r"id: '([a-z0-9\-]+)'", blk)
    if m:
        races.append((m.group(1), blk))
assert len(races) >= 100, 'entry parse wrong: %d' % len(races)
assert any(r == 'duergar' for r, _ in races), 'ENTRY CONTROL FAILED'
print('entry control ok — %d races' % len(races))

TRAIT = re.compile(r"\{ name: '((?:[^'\\]|\\.)+)', description: '((?:[^'\\]|\\.)*)' \}")
# "you can cast X", "you know the X cantrip", "you can innately cast X"
GRANT = re.compile(r"\b(?:can (?:innately )?cast|know the)\b", re.I)
assert GRANT.search('You can cast the Dancing Lights cantrip'), 'GRANT CONTROL FAILED'
assert not GRANT.search('You have darkvision to 60 feet.'), 'GRANT NEG CONTROL FAILED'

nrace = 0
rows = []
for rid, blk in races:
    innate = 'innateSpells' in blk
    ids = set(re.findall(r"spellId: '([a-z0-9\-]+)'", blk))
    for name, desc in TRAIT.findall(blk):
        d = desc.replace("\\'", "'")
        if not GRANT.search(d):
            continue
        if innate:
            continue          # covered by the innateSpells system
        rows.append((rid, name.replace("\\'", "'"), d[:130]))
    if not innate and any(GRANT.search(d.replace("\\'", "'")) for _, d in TRAIT.findall(blk)):
        nrace += 1

print('\n%d races grant a spell in trait text but have NO innateSpells entry '
      '(%d traits):\n' % (nrace, len(rows)))
cur = None
for rid, name, snip in rows:
    if rid != cur:
        cur = rid
        print('\n### %s' % rid)
    print('   %-30s %s' % (name, snip))
