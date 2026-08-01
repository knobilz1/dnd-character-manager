"""How trustworthy is each book's extracted text?

Every sweep that compares the app against a PDF is only as good as the text it reads, and that
text turned out to be damaged in book-specific ways nobody had measured: MMoM and VGM render dice
as "ld6", FToD encodes the fi-ligature as a NUL byte, the 2024 PHB was character-mangled until it
was re-OCR'd, and Spelljammer had no text layer at all. Each of those silently changed what a
sweep concluded — usually into false findings, but a sweep that reports "clean" because it could
not read the source is the same failure wearing a friendlier face.

So: measure the SOURCE before trusting any result derived from it.

The probes are words and shapes that MUST appear in a 5e rulebook. "proficiency" appearing zero
times in 690,000 characters is not a fact about the book, it is a fact about the extraction.

Usage: python tools/audit/bookquality.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
import r6verify as V  # noqa: E402
from racepdf import BOOK_PDF as RACE_PDF, debook  # noqa: E402

# racepdf only maps the books that contain RACES. Prior sweeps read others — r6verify reads the
# DMG for item charges, spellpdf reads XGtE/TCE/ToB for spells — and their text quality matters
# just as much, so the profile covers every book on disk.
BOOK_PDF = dict(RACE_PDF, **{
    'DMG': "D&D 5E - Dungeon Master's Guide.pdf",
    'XGtE': "Xanathar's Guide To Everything.pdf",
    'TCE': 'Tasha’s Cauldron of Everything.pdf',
    'ToB': '1064478-Tides_of_Blood_-_A_5th_Edition_Subclass_Background_and_Spell_Collection.pdf',
})

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# Vocabulary no 5e rulebook can lack. A zero here means the extraction is broken, not the book.
MUST = ['proficiency', 'advantage', 'damage', 'saving throw', 'spell', 'creature']


def profile(pdf):
    raw = V.book_text(pdf)
    fixed = debook(raw)
    words = re.findall(r'[A-Za-z]+', raw)
    frag = 100 * sum(1 for w in words if len(w) <= 2) / max(1, len(words))
    return {
        'chars': len(raw),
        'missing': [w for w in MUST if not re.search(w, fixed, re.I)],
        # Dice written with a letter l instead of the digit 1.
        'ld': len(re.findall(r'\bld\d', raw)),
        '1d': len(re.findall(r'\b1d\d', raw)),
        'nul': raw.count('\x00'),
        'lig': sum(raw.count(c) for c in 'ﬀﬁﬂﬃﬄ'),
        'frag': frag,
    }


def report():
    rows = []
    for book, pdf in BOOK_PDF.items():
        if not os.path.exists(os.path.join(V.REF, pdf)):
            continue
        try:
            rows.append((book, profile(pdf)))
        except Exception as e:                                        # noqa: BLE001
            rows.append((book, {'error': str(e)[:60]}))

    print('| book | chars | vocab missing | dice as "ld" | NUL | ligatures | fragments | verdict |')
    print('|---|---|---|---|---|---|---|---|')
    suspect = []
    for book, p in rows:
        if 'error' in p:
            print(f"| {book} | — | — | — | — | — | — | EXTRACT FAILED: {p['error']} |")
            suspect.append(book)
            continue
        bad = []
        if p['missing']:
            bad.append('missing core vocabulary')
        if p['ld'] > p['1d']:
            bad.append('dice mis-read')
        if p['nul']:
            bad.append('NUL ligatures')
        if p['lig']:
            bad.append('unicode ligatures')
        if p['chars'] < 200_000:
            bad.append('almost no text')
        verdict = 'OK' if not bad else '⚠ ' + ', '.join(bad)
        if bad:
            suspect.append(book)
        print(f"| {book} | {p['chars']:,} | {','.join(p['missing']) or '—'} | {p['ld']} vs {p['1d']} | "
              f"{p['nul']} | {p['lig']} | {p['frag']:.0f}% | {verdict} |")

    print(f'\n{len(rows) - len(suspect)} of {len(rows)} books extract cleanly.')
    if suspect:
        print('Needs handling before any sweep against it is believable: ' + ', '.join(suspect))
    print('\nNote: `debook()` in racepdf.py already repairs the ligature and dice cases at COMPARISON\n'
          'time, so a flagged book is not necessarily giving wrong answers today — it is a book whose\n'
          'raw text a NEW sweep must not read naively.')


if __name__ == '__main__':
    report()
