"""Race data fields vs the race's own trait text.

C1 established the shape: a race carries a mechanic as prose in `traits` while the structured field
that would make it *do* anything is unset or disagrees. The sheet reads the field; the player reads
the prose; nobody notices they differ. This sweeps the remaining fields the same way —
darkvision (presence AND distance), resistances, and proficiencies.

Deliberately does NOT need the source books for the first pass: any disagreement between a race's own
two representations is a defect regardless of which side is right, and the book only decides which
one to correct. That makes this cheap and fully reproducible.
"""
import re, sys, io, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
BASE = r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src\data\races'

DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
                'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder']


def parse(path, label):
    s = open(path, encoding='utf-8').read()
    starts = [m.start() for m in re.finditer(r"^\s+id: '([a-z0-9-]+)',", s, re.M)]
    starts.append(len(s))
    out = []
    for i in range(len(starts) - 1):
        chunk = s[starts[i]:starts[i + 1]]
        rid = re.search(r"id: '([a-z0-9-]+)'", chunk).group(1)
        nm = re.search(r"name: '((?:[^'\\]|\\.)*)'", chunk)
        bk = re.search(r"sourceBook: '(\w+)'", chunk)
        dv = re.search(r"darkvision: (\d+)", chunk)
        res = re.search(r"resistances: \[([^\]]*)\]", chunk)
        prof = re.search(r"proficiencies: \[([^\]]*)\]", chunk)
        tr = re.search(r"traits: \[([\s\S]*?)\n    \]", chunk)
        out.append({
            'file': label, 'id': rid,
            'name': nm.group(1) if nm else '?', 'book': bk.group(1) if bk else '?',
            'darkvision': int(dv.group(1)) if dv else None,
            'resistances': [x.strip().strip("'") for x in res.group(1).split(',') if x.strip()] if res else [],
            'proficiencies': [x.strip().strip("'") for x in prof.group(1).split(',') if x.strip()] if prof else [],
            'traitText': tr.group(1) if tr else '',
        })
    return out


races = parse(BASE + r'\index.ts', '2014') + parse(BASE + r'\phb2024.ts', '2024')
assert len(races) == 122, 'race parse collapsed: %d entries (expected 122)' % len(races)
with_traits = sum(1 for r in races if r['traitText'])
assert with_traits >= 115, 'trait-text capture failed for %d races' % (len(races) - with_traits)
print('races parsed: %d (2014=%d, 2024=%d), trait text captured for %d'
      % (len(races), sum(r['file'] == '2014' for r in races), sum(r['file'] == '2024' for r in races), with_traits))

byid = {r['id']: r for r in races}
# controls
assert byid['dwarf-hill']['darkvision'] == 60, 'positive control failed: dwarf-hill darkvision'
assert 'darkvision' in byid['dwarf-hill']['traitText'].lower(), 'positive control failed: dwarf trait text'
assert byid['human']['darkvision'] is None, 'negative control failed: human should have no darkvision'
print('controls ok\n')

dv_missing, dv_mismatch, dv_orphan, res_missing, prof_missing = [], [], [], [], []

for r in races:
    txt = r['traitText']
    low = txt.lower()

    # ── darkvision: presence and distance ────────────────────────────────
    says_dv = 'darkvision' in low or 'see in dim light' in low
    feet = None
    m = re.search(r'dim light within (\d+) f', low)
    if m:
        feet = int(m.group(1))
    if says_dv and r['darkvision'] is None:
        dv_missing.append((r, feet))
    elif says_dv and feet is not None and r['darkvision'] != feet:
        dv_mismatch.append((r, feet))
    elif not says_dv and r['darkvision'] is not None:
        dv_orphan.append((r, None))

    # ── resistances named in prose but absent from the field ─────────────
    for dt in DAMAGE_TYPES:
        if re.search(r'resistance to %s damage' % dt, low) and dt not in r['resistances']:
            res_missing.append((r, dt))

    # ── proficiency granted in prose but no proficiencies array ──────────
    if re.search(r'you (?:have|gain) proficiency with', low) and not r['proficiencies']:
        prof_missing.append((r, None))


def show(title, rows, fmt):
    print('### %s (%d)' % (title, len(rows)))
    for r, extra in rows:
        print('   %-28s %-6s %s' % (r['id'][:28], r['book'], fmt(r, extra)))
    print()


show('DARKVISION in trait text, field UNSET', dv_missing,
     lambda r, f: 'text says %s ft' % (f if f else '?'))
show('DARKVISION distance MISMATCH', dv_mismatch,
     lambda r, f: 'field=%s  text=%s ft' % (r['darkvision'], f))
show('DARKVISION field set, no trait mentions it', dv_orphan,
     lambda r, f: 'field=%s ft' % r['darkvision'])
show('RESISTANCE in trait text, absent from resistances[]', res_missing,
     lambda r, d: 'missing %-11s have=%s' % (d, r['resistances'] or '[]'))
show('PROFICIENCY granted in text, proficiencies[] empty', prof_missing,
     lambda r, _: (re.search(r'[Yy]ou (?:have|gain) proficiency with[^.]{0,60}', r['traitText']) or [''])[0][:70])

total = len(dv_missing) + len(dv_mismatch) + len(res_missing) + len(prof_missing)
print('races swept: %d   flagged (excluding orphan-darkvision): %d' % (len(races), total))
