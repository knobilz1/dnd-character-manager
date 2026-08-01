"""Feat text vs the PDFs — the second pass, starting with the population nobody has checked.

Races and spells are the only categories ever compared against the BOOKS. Feats were read by hand
against the `md/` extracts, and those extracts are SUMMARIES — the race sweep proved a word-level
diff against them is noise end to end. PHB 2024's 75 feats were never audited at all, and the
unchecked population is reliably where the bugs are: PHB 2024's spells ran a 25% defect rate
against ~2% in the sets that had already been read.

Everything hard here was already solved for races, so this imports it rather than repeating it:
the scored window, the index-vs-entry discriminator, de-hyphenation, split dice, and the habit of
consulting both extractions of a re-OCR'd book.

HOW A FEAT IS LOCATED, and why it is not scored on its own mechanics. Feats are printed together
in a chapter, alphabetically, so every occurrence of a feat's name is scored by how many OTHER
feat names from the same book sit near it. A mention in a class blurb scores 0 and loses to the
chapter. Scoring on the feat's own mechanics instead would be circular — a feat whose mechanic the
book lacks would simply fail to locate, and the sweep could never report the thing it exists to
find.

STATE 2026-08-01 — LOCATES WELL, FINDINGS NOT YET TRUSTWORTHY. Do not act on a finding from this
sweep without checking it by hand; it is where racepdf was at "the locator works, the comparison
does not yet", and racepdf went 306 findings -> 48 from that point.

  coverage   149 of 155 feats located (0 missing PDFs)
  findings   40, i.e. 27% of located — far too high to be real
  ordering   the books print feats alphabetically, so position order should match name order.
             Measured inversions: TCE 7%, PHB 14%, PHB2024 14%, **XGtE 41%**.

The 14% tells you roughly how often the located offset is the wrong entry, and the PHB has a
specific reason: its feat headings and bodies extract from different columns. "Inspiring Leader"
is followed by Grappler's body ("close-quarters grappling") while Grappler's own heading sits
1,776 characters earlier. A forward window from a heading therefore reads a NEIGHBOUR's mechanics,
which produces findings that look exactly like data bugs. Fix the ordering before believing counts.

Usage: FEAT_BUNDLE=<bundled feats.mjs> python tools/audit/featpdf.py [book] [--full]
"""
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
import r6verify as V  # noqa: E402
from racepdf import (alt_flat, flat,  # noqa: E402
                     mech_tokens, trait_variants)
# racepdf's map covers only the books that contain RACES, so importing it here silently reported
# every TCE and XGtE feat as "no PDF" — 30 of 155 feats skipped while the run looked healthy.
from bookquality import BOOK_PDF  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

SPAN = 6000

# A feat is written AT you: "you gain", "your Speed increases". A list of feat names is not.
SECOND_PERSON = re.compile(r'\byou\b|\byour\b', re.I)


def _is_entry(raw, idx, p, klen):
    """Is this occurrence the feat's ENTRY, or its name in a list?

    Scoring windows by how many sibling feat names are nearby finds the densest cluster of feat
    names — which is a LIST, every time. The 2024 PHB's chapter intro scored 67 siblings, the
    FToD table of contents won with 2 of 3. racepdf's page-number test cannot separate these: a
    feat list is names followed by names, with no folio to key on.

    What does separate them is that a feat entry is addressed to the reader and a list is not.
    """
    j = idx[min(p + klen, len(idx) - 1)]
    return bool(SECOND_PERSON.search(raw[j:j + 300]))


def locate(book, raw, idx, names, keys):
    """Flat offset of the feat's entry: among occurrences that READ like an entry, the one sitting
    in the densest cluster of sibling feat names — i.e. inside the feats chapter."""
    best, best_score = None, -1
    for n in names:
        start = 0
        while True:
            i = book.find(n, start)
            if i < 0:
                break
            start = i + 1
            if not _is_entry(raw, idx, i, len(n)):
                continue
            lo, hi = max(0, i - 200), i + SPAN
            score = sum(1 for k in keys if 0 <= book.find(k, lo) < hi)
            if score > best_score:
                best, best_score = i, score
    return best


def feats():
    """The app's real feat data, through the bundler — parsing the TS is how five parser bugs got in."""
    scratch = os.environ.get('FEAT_BUNDLE')
    if not scratch:
        sys.exit('set FEAT_BUNDLE to a bundled feats.mjs path')
    out = subprocess.run(
        ['node', '-e',
         'const {pathToFileURL}=await import("node:url");'
         'const m=await import(pathToFileURL(process.argv[1]).href);'
         'console.log(JSON.stringify(m.ALL_FEATS.map(f=>({id:f.id,name:f.name,'
         'book:f.sourceBook,d:f.description??""}))));',
         scratch],
        capture_output=True, text=True, encoding='utf-8')
    if out.returncode:
        sys.exit(out.stderr[:800])
    return json.loads(out.stdout)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    full = '--full' in sys.argv
    only = args[0] if args else None

    all_feats = feats()
    # Sibling names are the scoring keys: a window holding many of them IS the feats chapter.
    siblings = {}
    for f in all_feats:
        siblings.setdefault(f['book'], []).append(flat(f['name']))

    stats, findings, notes = {}, [], []
    located = unlocated = nobook = 0

    for f in all_feats:
        if only and f['book'] != only:
            continue
        st = stats.setdefault(f['book'], {'found': 0, 'total': 0, 'nobook': 0})
        st['total'] += 1
        pdf = BOOK_PDF.get(f['book'])
        if not pdf or not os.path.exists(os.path.join(V.REF, pdf)):
            st['nobook'] += 1
            nobook += 1
            continue
        raw = V.book_text(pdf)
        book, idx = V._flatten(raw)

        keys = [k for k in siblings[f['book']] if k and k != flat(f['name'])]
        names = [flat(v) for v in trait_variants(f['name']) if flat(v)]
        pos = locate(book, raw, idx, names, keys)
        span = (max(0, pos - 200), pos + SPAN) if pos is not None else None
        if span is None:
            # Absent from this extraction but present in the other one is a fact about the
            # extraction, never about the app — see racepdf.alt_flat.
            if any(alt_flat(f['book']).count(n) for n in names):
                notes.append(('ONLY IN THE OTHER EXTRACTION', f['name'], f['book'], '', ''))
            else:
                findings.append(('FEAT NOT LOCATED', f['name'], f['book'], '', ''))
            unlocated += 1
            continue

        lo, hi = span
        pos = next((book.find(n, lo) for n in names
                    if 0 <= book.find(n, lo) < hi), -1)
        if pos < 0:
            notes.append(('NAME OUTSIDE ENTRY (locator, not data)', f['name'], f['book'], '', ''))
            unlocated += 1
            continue
        located += 1
        st['found'] += 1

        # NOT a prose diff — the app's feat text is deliberate paraphrase, exactly as its race text
        # is. Only the mechanical vocabulary cannot differ without being wrong.
        want = mech_tokens(f['d'])
        if not want:
            continue
        fe = min(len(idx) - 1, pos + max(len(flat(f['d'])) * 2, 1800))
        gap = sorted(t for t in want if t not in mech_tokens(raw[idx[pos]: idx[fe]]))
        if gap:
            findings.append(('MECHANICS NOT IN SOURCE', f['name'], f['book'], f['d'],
                             'app states ' + ', '.join(gap)))

    considered = located + unlocated + nobook
    print(f'# {considered} feats considered\n')
    print('| book | located | total | no PDF |')
    print('|---|---|---|---|')
    for b, s in sorted(stats.items()):
        thin = '  ⚠ THIN' if s['nobook'] == 0 and s['total'] and s['found'] / s['total'] < 0.8 else ''
        print(f"| {b} | {s['found']} | {s['total']} | {s['nobook']} |{thin}")
    print(f'\nlocated {located} + unlocated {unlocated} + no-PDF {nobook} = {considered}')
    # The coverage gate: "0 mismatches" over 3% location is worthless, and Phase H would have
    # reported exactly that before this check existed.
    if located == 0:
        sys.exit('\nNOTHING LOCATED — any findings below would be meaningless.')

    def dump(rows):
        kinds = {}
        for r in rows:
            kinds.setdefault(r[0], []).append(r)
        for kind, lst in kinds.items():
            print(f'\n## {kind} ({len(lst)})')
            for _, name, book, _d, note in (lst if full else lst[:25]):
                print(f'- **{name}** [{book}]' + (f'  ({note})' if note else ''))
            if not full and len(lst) > 25:
                print(f'  … {len(lst) - 25} more (pass --full)')

    dump(findings)
    if notes:
        print('\n---\n# Not findings — the audit read the wrong window or the wrong extraction')
        dump(notes)
    print(f'\n{len(findings)} findings over {located} located feats'
          + (f'  (+{len(notes)} explained above)' if notes else ''))


if __name__ == '__main__':
    main()
