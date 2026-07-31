"""Phase I, round 3 — non-PHB spell header fixes (XGtE + EGtW).

Six are confirmed against the book PDF. The seventh (Temporal Shunt) could not be: the string
does not survive OCR in the XGtE PDF at all, so its evidence is the markdown extract only —
recorded separately rather than presented as equally verified.
"""
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
SRC = 'src/data/spells/index.ts'

# (id, field, old, new, evidence, verified-against)
FIX = [
    ('tether-essence', 'school', 'Transmutation', 'Necromancy',
     'EGtW PDF: "TETHER ESSENCE 7th-level necromancy"', 'PDF'),
    ('thunderclap', 'range', 'Self (5-foot radius)', '5 feet',
     'XGtE PDF: "Thunderclap Evocation cantrip ... Range: 5 feet"', 'PDF'),
    ('earth-tremor', 'range', 'Self (10-foot radius)', '10 feet',
     'XGtE PDF: "Earth Tremor 1st-level evocation ... Range: 10 feet"', 'PDF'),
    ('transmute-rock', 'duration', 'Instantaneous', 'Until dispelled',
     'XGtE PDF: "Transmute Rock 5th-level transmutation ... Duration: Until dispelled"', 'PDF'),
    ('power-word-pain', 'duration', 'Until dispelled', 'Instantaneous',
     'XGtE PDF: "Power Word Pain 7th-level enchantment ... Duration: Instantaneous"', 'PDF'),
    ('mighty-fortress', 'duration', 'Until dispelled', 'Instantaneous',
     'XGtE PDF: "Mighty Fortress 8th-level conjuration ... Duration: Instantaneous"', 'PDF'),
    ('temporal-shunt', 'duration', 'Instantaneous', '1 round',
     'XGtE markdown extract only — the name does not survive OCR in the PDF', 'EXTRACT ONLY'),
]

lines = open(SRC, encoding='utf-8').read().split('\n')
done = 0
for sid, fld, old, new, why, src in FIX:
    idx = [i for i, l in enumerate(lines) if ("id: '%s'" % sid) in l]
    assert len(idx) == 1, '%s: expected 1 line, got %d' % (sid, len(idx))
    i = idx[0]
    pat = "%s: '%s'" % (fld, old)
    assert lines[i].count(pat) == 1, '%s: "%s" not found once — already fixed?' % (sid, pat)
    lines[i] = lines[i].replace(pat, "%s: '%s'" % (fld, new))
    print('  [%-12s] %-18s %-9s %r -> %r' % (src, sid, fld, old, new))
    print('       %s' % why)
    done += 1

assert done == len(FIX)
open(SRC, 'w', encoding='utf-8', newline='').write('\n'.join(lines))
print('\napplied %d fixes (%d PDF-verified, %d extract-only)'
      % (done, sum(1 for f in FIX if f[5] == 'PDF'), sum(1 for f in FIX if f[5] != 'PDF')))
