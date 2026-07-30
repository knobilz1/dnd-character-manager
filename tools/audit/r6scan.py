"""Items whose description describes a limited use but carry no maxCharges/recharge (R6).

An item with maxCharges gets a tracked counter on the sheet when equipped; without it the
text says "3 charges" and nothing counts them.

Note the item data is keyed by NAME, not id, and is one item per line. A first version of
this parser assumed an `id:` field and returned zero items — the assert below caught it
before that could be reported as "nothing to fix".
"""
import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
P = r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src\data\items.ts'
src = open(P, encoding='utf-8').read()

items = []
for line in src.splitlines():
    st = line.strip()
    if not st.startswith('{ name:'):
        continue
    nm = re.search(r"name: '((?:[^'\\]|\\.)+)'", st) or re.search(r'name: "([^"]+)"', st)
    if nm:
        items.append((nm.group(1), st))

assert len(items) > 200, 'item parse looks wrong: %d' % len(items)
withmax = [i for i in items if 'maxCharges' in i[1]]
assert len(withmax) >= 40, 'expected ~47 charged items, saw %d' % len(withmax)
print('controls ok — %d items parsed, %d already carry maxCharges' % (len(items), len(withmax)))

USE = re.compile(
    r'\b\d+\s+charges?\b'
    r'|\bexpend(?:s|ing)?\s+\d*\s*charges?\b'
    r'|once per (?:short|long) rest'
    r'|once per day'
    r'|\bper day\b'
    r"|can't use (?:it|this) again until"
    r'|regain(?:s)? .{0,20}charges?',
    re.I)
assert USE.search('This wand has 7 charges.'), 'USE CONTROL FAILED'
assert USE.search('Once per day, produces 2 gallons.'), 'USE CONTROL FAILED (per day)'
assert not USE.search('A sturdy iron pot for cooking.'), 'USE NEG CONTROL FAILED'

rows = []
for name, blk in items:
    if 'maxCharges' in blk:
        continue
    d = re.search(r"description: '((?:[^'\\]|\\.)*)'", blk)
    if not d:
        continue
    text = d.group(1).replace("\\'", "'")
    m = USE.search(text)
    if m:
        rows.append((name.replace("\\'", "'"), m.group(0), text))

print('\n%d items describe a limited use but have no maxCharges:\n' % len(rows))
FULL = '--full' in sys.argv
for i, (name, frag, snip) in enumerate(rows, 1):
    if FULL:
        print('%2d. %s\n    %s\n' % (i, name, snip[:300]))
    else:
        print('  %-32s [%s]  %s' % (name[:32], frag, snip[:95]))
