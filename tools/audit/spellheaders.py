"""Phase I — per-spell header accuracy vs the rulebook.

Compares the mechanical header of every spell (level, school, ritual, casting time, range,
components, duration) against the book extract, which states all of them on one line:

    ### Aid
    *2nd-level abjuration* | CT: 1 action | Range: 30 ft | C: V, S, M (...) | Dur: 8 hours

Same discipline as the class sweep: the TS parse is gated on a RUNTIME checksum before any
comparison runs, and coverage is reported so a "clean" result can't be vacuous.

Usage: python tools/audit/spellheaders.py [nameFilter]
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from classfeaturelevels import strip_comments, blank_strings, balanced, objects, field  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

MD = r'C:\Users\nabil\Desktop\Code\reference-books\md'
BOOK_MD = {'PHB': 'phb-players-handbook.md'}   # only the PHB extract uses this header format

# Runtime checksum straight from the live app.
TRUTH = dict(total=547, sum_levels=1925, conc=242, ritual=34, phb=361)

SCHOOLS = ['abjuration', 'conjuration', 'divination', 'enchantment',
           'evocation', 'illusion', 'necromancy', 'transmutation']



def nname(v):
    """Match key for a spell name.

    Two separate traps: the TS source escapes apostrophes (Bigby\'s Hand) and the book uses a
    typographic one (Bigby’s Hand). Between them, all 16 of the PHB's named spells --
    every Mordenkainen/Otiluke/Bigby -- silently went uncompared.
    """
    v = (v or '').replace("\\'", "'").replace('’', "'").replace('‘', "'")
    return re.sub(r'\s+', ' ', v).strip().lower()


def parse_spells():
    out = []
    for path in ('src/data/spells/index.ts', 'src/data/spells/phb2024.ts'):
        if not os.path.exists(path):
            continue
        text = strip_comments(open(path, encoding='utf-8').read())
        for m in re.finditer(r'^(?:export )?const \w+: Spell\[\] = \[', text, re.M):
            arr = balanced(text, m.end() - 1, '[', ']')
            if not arr:
                continue
            for blk in objects(arr):
                sid = field(blk, 'id')
                lvl = field(blk, 'level')
                if not sid or lvl is None or not lvl.isdigit():
                    continue
                comp = ''
                cm = re.search(r'(?:^|[{,])\s*components:\s*\[', blank_strings(blk))
                if cm:
                    ca = balanced(blk, cm.end() - 1, '[', ']')
                    comp = ''.join(sorted(re.findall(r"'([VSM])'", ca or '')))
                out.append(dict(
                    id=sid, name=field(blk, 'name'), level=int(lvl), school=field(blk, 'school'),
                    book=field(blk, 'sourceBook'), ct=field(blk, 'castingTime'),
                    rng=field(blk, 'range'), dur=field(blk, 'duration'), comp=comp,
                    conc=field(blk, 'concentration') == 'true',
                    ritual=field(blk, 'ritual') == 'true'))
    return out


def validate(spells):
    got = dict(total=len(spells), sum_levels=sum(s['level'] for s in spells),
               conc=sum(1 for s in spells if s['conc']),
               ritual=sum(1 for s in spells if s['ritual']),
               phb=sum(1 for s in spells if s['book'] == 'PHB'))
    return [f'{k}: parsed {got[k]} != runtime {v}' for k, v in TRUTH.items() if got[k] != v]


HEAD = re.compile(
    r'^###\s+(.+?)\s*$\n\*([^*]+)\*\s*\|(.*?)$', re.M)


def book_spells(md_text):
    """name(lower) -> parsed header dict, from the '### Name' + '*Nth-level school*' shape."""
    out = {}
    for name, kind, rest in HEAD.findall(md_text):
        kind_l = kind.lower()
        school = next((s for s in SCHOOLS if s in kind_l), None)
        if not school:
            continue
        if 'cantrip' in kind_l:
            lvl = 0
        else:
            m = re.search(r'(\d+)(?:st|nd|rd|th)[- ]level', kind_l)
            if not m:
                continue
            lvl = int(m.group(1))
        fields = {}
        for part in rest.split('|'):
            p = part.strip()
            mm = re.match(r'(CT|Range|C|Dur)\s*:\s*(.+)$', p, re.I)
            if mm:
                fields[mm.group(1).upper()] = mm.group(2).strip()
        out[nname(name)] = dict(
            level=lvl, school=school, ritual='ritual' in kind_l,
            ct=fields.get('CT'), rng=fields.get('RANGE'),
            comp=''.join(sorted(set(re.findall(r'\b([VSM])\b', fields.get('C', ''))))),
            dur=fields.get('DUR'))
    return out


def norm_ct(v):
    if not v: return None
    v = v.lower().replace('1 action', 'action').replace('1 bonus action', 'bonus action')
    v = v.replace('1 reaction', 'reaction')
    v = re.sub(r'\s*\(.*?\)\s*', '', v)
    v = re.sub(r'\bmins?\b', 'minute', v); v = re.sub(r'\bhrs?\b', 'hour', v)
    return re.sub(r'\s+', ' ', v).strip(' .')


def norm_range(v):
    if not v: return None
    v = v.lower().replace('feet', 'ft').replace('foot', 'ft').replace('ft.', 'ft')
    v = v.replace('self (', 'self ').replace(')', '')
    return re.sub(r'\s+', ' ', v).strip(' .')


def norm_dur(v):
    if not v: return None
    v = v.lower().replace('concentration, up to', 'conc').replace('concentration up to', 'conc')
    v = v.replace('conc, up to', 'conc').replace('instantaneous', 'instant')
    v = re.sub(r'\bmins?\b', 'minute', v); v = re.sub(r'\bhrs?\b', 'hour', v)
    v = re.sub(r'\s*\(.*?\)\s*', ' ', v)
    return re.sub(r'\s+', ' ', v).strip(' .')


def main():
    filt = (sys.argv[1] if len(sys.argv) > 1 else '').lower()
    spells = parse_spells()
    bad = validate(spells)
    if bad:
        print('PARSER DISAGREES WITH THE RUNNING APP — aborting:')
        for b in bad: print('  ' + b)
        sys.exit(1)
    print(f'parser validated against the live app ({len(spells)} spells, checksums match)\n')

    md = open(os.path.join(MD, BOOK_MD['PHB']), encoding='utf-8').read()
    book = book_spells(md)
    print(f'book extract: {len(book)} spell headers parsed\n')

    considered = compared = notfound = 0
    diffs = {k: [] for k in ('level', 'school', 'ritual', 'ct', 'range', 'components', 'duration')}
    for s in spells:
        if s['book'] != 'PHB':
            continue
        if filt and filt not in nname(s['name']):
            continue
        considered += 1
        b = book.get(nname(s['name']))
        if not b:
            notfound += 1
            continue
        compared += 1
        tag = f"{s['name']}"
        if s['level'] != b['level']:
            diffs['level'].append(f"{tag}: app L{s['level']} book L{b['level']}")
        if (s['school'] or '').lower() != b['school']:
            diffs['school'].append(f"{tag}: app {s['school']} book {b['school']}")
        if bool(s['ritual']) != bool(b['ritual']):
            diffs['ritual'].append(f"{tag}: app ritual={s['ritual']} book ritual={b['ritual']}")
        if b['ct'] and norm_ct(s['ct']) != norm_ct(b['ct']):
            diffs['ct'].append(f"{tag}: app '{s['ct']}' book '{b['ct']}'")
        if b['rng'] and norm_range(s['rng']) != norm_range(b['rng']):
            diffs['range'].append(f"{tag}: app '{s['rng']}' book '{b['rng']}'")
        if b['comp'] and s['comp'] != b['comp']:
            diffs['components'].append(f"{tag}: app {s['comp']} book {b['comp']}")
        if b['dur'] and norm_dur(s['dur']) != norm_dur(b['dur']):
            diffs['duration'].append(f"{tag}: app '{s['dur']}' book '{b['dur']}'")

    assert compared + notfound == considered, 'accounting broke'
    print(f'# PHB spells considered={considered} compared={compared} notFoundInExtract={notfound} '
          f'({100*compared/considered:.1f}% coverage)')
    for k, v in diffs.items():
        print(f'\n===== {k.upper()} DIFFS ({len(v)}) =====')
        for x in v[:40]:
            print('  ' + x)
        if len(v) > 40:
            print(f'  ... and {len(v)-40} more')


if __name__ == '__main__':
    main()
