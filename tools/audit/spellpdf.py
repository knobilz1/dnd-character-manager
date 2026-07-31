"""Phase I, part 2 — verify the spells the markdown extracts DON'T cover, straight from the PDFs.

47 spells were uncompared after the extract sweep: ToB (22), PHB2024 (12), AcqInc (7), SJA (2),
XGtE (2), EGtW (1), GGR (1). For ToB/PHB2024/GGR the extract simply has no spell-description
section; AcqInc and SJA have no extract at all. Every one of those books does have a PDF.

Reads the OCR'd text layer (noisy: "Casting Time:1action", "Ist-level", hyphen breaks), locates the
spell entry by letters-only match, and pulls the header fields out of the following window.

Usage: python tools/audit/spellpdf.py [book]
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from spellheaders import parse_spells, book_spells, nname, MD, BOOK_MD  # noqa: E402
import r6verify as V  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BOOK_PDF = {
    'ToB': '1064478-Tides_of_Blood_-_A_5th_Edition_Subclass_Background_and_Spell_Collection.pdf',
    'PHB2024': 'PlayersHandbook2024.pdf',
    'GGR': 'Guildmasters guide to Ravnica.pdf',
    'SJA': 'Spelljammer - Adventures in Space - Bob Flip PDF _ AnyFlip.pdf',
    'AcqInc': 'Acquisitions Incorporated.pdf',
    'XGtE': "Xanathar's Guide To Everything.pdf",
    'EGtW': "Explorer's Guide To Wildemount.pdf",
    'PHB': 'Players Handbook.pdf',
    'TCE': 'Tasha’s Cauldron of Everything.pdf',
    'FToD': 'fizban-tresury-of-dragons.pdf',
    'SCoC': 'Strixhaven- A Curriculum of Chaos.pdf',
}

SCHOOLS = ['abjuration', 'conjuration', 'divination', 'enchantment',
           'evocation', 'illusion', 'necromancy', 'transmutation']

_IDX = {}


def index(pdf):
    if pdf not in _IDX:
        t = V.book_text(pdf)
        raw, buf = [], []
        for i, ch in enumerate(t):
            c = ch.lower()
            if c.isalnum():
                buf.append(c)
                raw.append(i)
        _IDX[pdf] = (t, ''.join(buf), raw)
    return _IDX[pdf]


LEVEL = re.compile(r'\b(?:(\d)\s*(?:st|nd|rd|th)|I\s*st)[-\s]*level\s+(' + '|'.join(SCHOOLS) + r')',
                   re.I)
CANTRIP = re.compile(r'\b(' + '|'.join(SCHOOLS) + r')\s+cantrip', re.I)
FLD = {
    'ct': re.compile(r'Casting\s*Time\s*:\s*(.+?)(?=\s*(?:Range|Components|Duration)\s*:)', re.I | re.S),
    'rng': re.compile(r'Range\s*:\s*(.+?)(?=\s*(?:Components|Duration|Casting)\s*:)', re.I | re.S),
    'comp': re.compile(r'Components?\s*:\s*(.+?)(?=\s*(?:Duration|Range|Casting)\s*:)', re.I | re.S),
    'dur': re.compile(r'Duration\s*:\s*(.+?)(?=\s{2,}|\n|[A-Z][a-z]+\s+[a-z])', re.I | re.S),
}


def find_header(pdf, name):
    """Locate a spell entry and return its parsed header, or None."""
    t, flat, raw = index(pdf)
    key = re.sub(r'[^a-z0-9]', '', nname(name))
    if not key:
        return None
    pos = flat.find(key)
    tries = 0
    while pos >= 0 and tries < 60:
        end = min(pos + len(key), len(raw) - 1)
        win = ' '.join(t[raw[end]: raw[end] + 420].split())
        # Detect on a DESPACED copy. OCR splits words mid-token ("Abjura tion", "W izard",
        # "Casting Time:1action"), and the 2024 book uses "Level 2 Abjuration" where the 2014
        # book uses "2nd-level abjuration" — both fall out of this once spaces are gone.
        head = re.sub(r'[\s­]+', '', win[:130]).lower()
        school = next((s for s in SCHOOLS if s in head), None)
        lvl = None
        if school:
            if 'cantrip' in head:
                lvl = 0
            else:
                m = (re.search(r'level(\d)', head)
                     or re.search(r'(\d)(?:st|nd|rd|th)-?level', head)
                     or (re.search(r'ist-?level', head) and None))
                if m:
                    lvl = int(m.group(1))
                elif re.search(r'ist-?level', head):
                    lvl = 1          # OCR renders "1st-level" as "Ist-level"
        if school and lvl is not None and re.search(r'Casting\s*Time', win, re.I):
            out = {'level': lvl, 'school': school,
                   'ritual': bool(re.search(r'\(ritual\)', win[:120], re.I))}
            for k, rx in FLD.items():
                mm = rx.search(win)
                out[k] = re.sub(r'\s+', ' ', mm.group(1)).strip(' .') if mm else None
            if out['comp']:
                out['comp'] = ''.join(sorted(set(re.findall(r'\b([VSM])\b', out['comp']))))
            return out
        pos = flat.find(key, pos + 1)
        tries += 1
    return None


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    spells = parse_spells()
    extracts = {}
    for bid, fn in BOOK_MD.items():
        p = os.path.join(MD, fn)
        extracts[bid] = book_spells(open(p, encoding='utf-8').read()) if os.path.exists(p) else {}

    todo = [s for s in spells
            if nname(s['name']) not in (extracts.get(s['book']) or {})
            and (not only or s['book'] == only)]
    print(f'{len(todo)} spells uncovered by the markdown extracts — checking against the PDFs\n')

    found = missing = 0
    diffs = []
    by_book = {}
    for s in todo:
        pdf = BOOK_PDF.get(s['book'])
        st = by_book.setdefault(s['book'], [0, 0])
        st[1] += 1
        if not pdf or not os.path.exists(os.path.join(V.REF, pdf)):
            missing += 1
            continue
        b = find_header(pdf, s['name'])
        if not b:
            missing += 1
            continue
        found += 1
        st[0] += 1
        tag = f"{s['book']}/{s['name']}"
        if s['level'] != b['level']:
            diffs.append(f"LEVEL   {tag}: app L{s['level']} pdf L{b['level']}")
        if (s['school'] or '').lower() != b['school']:
            diffs.append(f"SCHOOL  {tag}: app {s['school']} pdf {b['school']}")
        if b['comp'] and s['comp'] != b['comp']:
            diffs.append(f"COMPS   {tag}: app {s['comp']} pdf {b['comp']}")
        for fld, key in (('dur', 'duration'), ('rng', 'range')):
            # A capture of 1-2 chars means the field terminator fired early on OCR noise, not
            # that the book says that. Reporting it produces a finding the book never made —
            # e.g. "Duration: l round" (lowercase L for 1) captured as just "l".
            if not b[fld] or len(b[fld]) < 3:
                continue
            av = (s['dur'] if fld == 'dur' else s['rng']) or ''
            # OCR renders the digit 1 as a lowercase L throughout these scans.
            a = re.sub(r'[^a-z0-9]', '', av.lower())
            p = re.sub(r'[^a-z0-9]', '', b[fld].lower().replace('l', '1'))
            a = a.replace('l', '1')
            if a and p and a != p and not (a in p or p in a):
                diffs.append(f"{key.upper():7} {tag}: app '{av}' pdf '{b[fld]}'")

    print(f'# located in PDF={found}  not located={missing}  (of {len(todo)})')
    for bid, (f, t) in sorted(by_book.items(), key=lambda kv: -kv[1][1]):
        print(f'  {bid:9} {f:3}/{t:<3} located')
    print(f'\n===== DIFFS ({len(diffs)}) =====')
    for d in diffs:
        print('  ' + d)


if __name__ == '__main__':
    main()
