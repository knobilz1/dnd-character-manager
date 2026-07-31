"""R6 — list every item template whose text implies a charge pool but has no maxCharges.

The source book is NOT on the objects (`sourceBook` is mostly unset) — it is encoded by which
`const X: ItemTemplate[]` array the item lives in. So parse per-array and carry the array name.

Matches are TIERED, because a single loose regex produces false positives that look identical to
real findings in a flat list:
  A  "N charges"          a real pool
  B  "1/day" / "1/dawn"   a daily use, pool of 1 (or N/day)
  C  loose 'expend' hit   almost always noise ("recover half your expended arrows")

Accounting assert: A + B + C + tracked + plain == total considered.
"""
import re, sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

SRC = 'src/data/items.ts'
text = open(SRC, encoding='utf-8').read()

ARRAY_RE = re.compile(r'^const (\w+): ItemTemplate\[\] = \[', re.M)


def arrays(s):
    """Yield (array_name, body) for each `const X: ItemTemplate[] = [ ... ]`, brace-matched."""
    for m in ARRAY_RE.finditer(s):
        depth, j, instr, esc, start = 0, m.end() - 1, None, False, m.end() - 1
        while j < len(s):
            c = s[j]
            if instr:
                if esc: esc = False
                elif c == '\\': esc = True
                elif c == instr: instr = None
            elif c in '"\'`': instr = c
            elif c == '[': depth += 1
            elif c == ']':
                depth -= 1
                if depth == 0:
                    yield m.group(1), s[start:j + 1]
                    break
            j += 1


def objects(s):
    """Yield each top-level `{...}` inside an array body."""
    depth, instr, esc, start = 0, None, False, None
    for j, c in enumerate(s):
        if instr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == instr: instr = None
            continue
        if c in '"\'`':
            instr = c
        elif c == '{':
            if depth == 0: start = j
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                yield s[start:j + 1]


def blank_strings(o):
    """Same-length copy with string CONTENTS blanked.

    Needed because a description can contain text that looks like another field —
    Lyre of Building's description literally reads "(recharge: 3 charges at dawn)",
    which a naive search reads as `recharge: 3`. Field lookup must ignore string bodies.
    """
    out, instr, esc = [], None, False
    for c in o:
        if instr:
            if esc: esc = False; out.append(' ')
            elif c == '\\': esc = True; out.append(' ')
            elif c == instr: instr = None; out.append(c)
            else: out.append(' ')
        else:
            out.append(c)
            if c in '"\'`': instr = c
    return ''.join(out)


def field(o, key):
    masked = blank_strings(o)
    m = re.search(r'(?:^|[{,])\s*%s:\s*' % key, masked)
    if not m: return None
    v = re.match(r'(\'(?:[^\'\\]|\\.)*\'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|[\w.]+)', o[m.end():])
    if not v: return None
    v = v.group(1)
    return v[1:-1] if v[0] in '"\'`' else v


POOL = re.compile(r'\b(\d+)\s+charges?\b', re.I)
DAILY = re.compile(r'\b(\d+\s*/\s*day|\d+\s*/\s*dawn|once a day|per day|daily at dawn|daily)\b', re.I)
LOOSE = re.compile(r'\bexpend|\buses?\b', re.I)

tiers = {'A': [], 'B': [], 'C': []}
total = tracked = plain = 0
tracked_rows = []

for arr, body in arrays(text):
    for o in objects(body):
        name = field(o, 'name')
        if not name:
            continue
        total += 1
        desc = field(o, 'description') or ''
        mc = field(o, 'maxCharges')
        if mc:
            tracked += 1
            tracked_rows.append((arr, name, mc, field(o, 'recharge')))
            continue
        if POOL.search(desc):
            tiers['A'].append((arr, name, desc))
        elif DAILY.search(desc):
            tiers['B'].append((arr, name, desc))
        elif LOOSE.search(desc):
            tiers['C'].append((arr, name, desc))
        else:
            plain += 1

n = sum(len(v) for v in tiers.values())
assert n + tracked + plain == total, f'accounting broke: {n}+{tracked}+{plain} != {total}'
print(f'# considered={total} tracked={tracked} A={len(tiers["A"])} B={len(tiers["B"])} '
      f'C={len(tiers["C"])} plain={plain}')

for t in 'ABC':
    print(f'\n===== TIER {t} ({len(tiers[t])}) =====')
    for arr, name, desc in sorted(tiers[t]):
        print(f'{arr:12} | {name:42} | {desc[:130]}')

print(f'\n===== ALREADY TRACKED ({tracked}) =====')
for arr, name, mc, rc in sorted(tracked_rows):
    print(f'{arr:12} | {name:42} | maxCharges={mc:4} recharge={rc}')

# Emit the machine-readable set r6verify.py consumes: everything tracked (verify it)
# plus tiers A and B (fill it in). Tier C is noise and deliberately excluded.
import json, os
out = [{'array': a, 'name': n, 'maxCharges': mc, 'recharge': rc, 'state': 'tracked'}
       for a, n, mc, rc in tracked_rows]
out += [{'array': a, 'name': n, 'maxCharges': None, 'recharge': None, 'state': t}
        for t in 'AB' for a, n, _d in tiers[t]]
json.dump(out, open(os.path.join(os.path.dirname(__file__), 'r6items.json'), 'w',
                    encoding='utf-8'), indent=1)
print(f'\nwrote r6items.json ({len(out)} entries)')
