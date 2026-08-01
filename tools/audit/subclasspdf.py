"""Subclass features vs the PDFs — the largest population nobody has checked against the books.

189 subclasses, every one of them previously verified either by hand or against the `md/` extracts,
which are SUMMARIES. Structurally a subclass is a race: a named entity carrying named sub-features.
So this follows racepdf rather than featpdf — the entry is located by scoring windows on the
subclass's own FEATURE names, which is the same trick that separates two similarly-named races.

Reuses, deliberately, everything both earlier sweeps paid for: de-hyphenation, split dice, TCE's
split unit word, bare dice read source-side only, the index-vs-entry discriminator, dual
extraction, and the coverage gate.

THE CONTROL IS THE CLAIM, exactly as in featpdf — but TWO controls, because one of them is blind
to the thing most likely to go wrong.

  --control              corrupt every distance, die and DC to an IMPOSSIBLE value (930 ft, 92d6).
                         Answers "can the sweep still fail at all". 148/148.
  --control --plausible  swap them for values the books DO contain (30 ft -> 10 ft, d8 -> d10).
                         Answers "what is the comparison window costing". 139/148 = 93%.

The second exists because findings fall as the window widens and that looks like progress. It is
not. Measured:

    window   findings   impossible   plausible
      2400      49         100%         93%     <- chosen
      4000      47         100%         87%
      6000      44         100%         81%
      9000      39         100%         77%

Ten fewer findings costs sixteen points of real detection, and the impossible control reads 100%
the whole way down. **A quieter report is not a better one — prove the difference before taking
it.** 2,400 is the widest window that costs nothing measurable.

93% is not 100%, and that is the honest ceiling here: 9 plausible corruptions go unreported
(Circle of Spores, School of Abjuration, Sea Domain and 6 more) because a neighbouring feature
genuinely states the swapped value. Findings are trustworthy; ABSENCE of a finding is weaker.

Usage: SUBCLASS_BUNDLE=<bundled subclasses.mjs> python tools/audit/subclasspdf.py [book] [--full]
       ... --control      run the negative control instead and report the detection rate
"""
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
import r6verify as V  # noqa: E402
from racepdf import (_best_window, alt_flat, alt_text, flat, mech_tokens,  # noqa: E402
                     name_variants, trait_variants)
from bookquality import BOOK_PDF  # noqa: E402
from featpdf import content_words  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

SPAN = 12000


def subclasses(bundle=None):
    """The app's real subclass data, through the bundler — parsing the TS is how five parser bugs
    got in, and none of the runtime sweeps has hit one."""
    scratch = bundle or os.environ.get('SUBCLASS_BUNDLE')
    if not scratch:
        sys.exit('set SUBCLASS_BUNDLE to a bundled subclasses.mjs path')
    out = subprocess.run(
        ['node', '-e',
         'const {pathToFileURL}=await import("node:url");'
         'const m=await import(pathToFileURL(process.argv[1]).href);'
         'console.log(JSON.stringify(m.ALL_SUBCLASSES.map(s=>({id:s.id,name:s.name,'
         'cls:s.classId,book:s.sourceBook,'
         'features:(s.features??[]).map(f=>({name:f.name,level:f.level,d:f.description??""}))}))));',
         scratch],
        capture_output=True, text=True, encoding='utf-8')
    if out.returncode:
        sys.exit(out.stderr[:800])
    return json.loads(out.stdout)


def sweep(all_subs, only=None):
    """Returns (stats, findings, notes, paired, unpaired, nobook)."""
    stats, findings, notes = {}, [], []
    paired = unpaired = nobook = 0

    for s in all_subs:
        if only and s['book'] != only:
            continue
        st = stats.setdefault(s['book'], {'paired': 0, 'total': 0, 'nobook': 0,
                                          'feats': 0, 'found': 0})
        st['total'] += 1
        pdf = BOOK_PDF.get(s['book'])
        if not pdf or not os.path.exists(os.path.join(V.REF, pdf)):
            st['nobook'] += 1
            nobook += 1
            continue
        raw = V.book_text(pdf)
        book, idx = V._flatten(raw)

        # Score every occurrence of the subclass name by how many of ITS OWN feature names sit
        # nearby. A contents line scores 0; the real entry holds most of them. This is exactly how
        # racepdf separates two elf subraces, and it is NOT scored on the mechanics under test.
        keys = [flat(f['name']) for f in s['features'] if flat(f['name'])]
        names = [flat(v) for v in name_variants(s['name']) if len(flat(v)) >= 4]
        span = _best_window(book, names, keys, SPAN, raw=raw, raw_idx=idx) if names and keys else None
        if span is None:
            if any(alt_flat(s['book']).count(n) for n in names):
                notes.append(('ONLY IN THE OTHER EXTRACTION', s['name'], s['book'], '', ''))
            else:
                findings.append(('SUBCLASS NOT LOCATED', s['name'], s['book'], '', ''))
            unpaired += 1
            continue

        lo, hi = span
        hits = 0
        for f in s['features']:
            st['feats'] += 1
            cands = []
            for variant in trait_variants(f['name']):
                k = flat(variant)
                if not k:
                    continue
                p = book.find(k, lo)
                while 0 <= p < hi:
                    cands.append(p)
                    p = book.find(k, p + 1)
                if cands:
                    break
            if not cands:
                where = [flat(v) for v in trait_variants(f['name']) if flat(v)]
                if any(book.count(k) for k in where):
                    notes.append(('FEATURE NAME OUTSIDE ENTRY (locator)', s['name'], s['book'],
                                  f['name'], ''))
                elif any(alt_flat(s['book']).count(k) for k in where):
                    # Present in the other extraction, so CHECK IT THERE rather than shrugging.
                    # Noting it and moving on leaves the feature unverified while the report reads
                    # as if it were explained — the control caught that by missing a corrupted
                    # Draconic Sorcery whose feature name exists only in the text layer.
                    alt = alt_text(s['book'])
                    gap = None
                    if alt:
                        araw, abook, aidx = alt
                        want = mech_tokens(f['d'])
                        ahave = set()
                        for k in where:
                            q = abook.find(k)
                            while q >= 0 and len(ahave) < 400:
                                a2 = max(0, q - 500)
                                b2 = min(len(aidx) - 1,
                                         q + max(len(flat(f['d'])) * 2, 2400))
                                ahave |= mech_tokens(araw[aidx[a2]: aidx[b2]], source=True)
                                q = abook.find(k, q + 1)
                        gap = sorted(t for t in want if t not in ahave) if want else []
                    if gap:
                        findings.append(('MECHANICS NOT IN SOURCE (other extraction)', s['name'],
                                         s['book'], f"{f['name']} (L{f['level']})",
                                         'app states ' + ', '.join(gap)))
                    else:
                        notes.append(('CHECKED IN THE OTHER EXTRACTION', s['name'], s['book'],
                                      f['name'], ''))
                else:
                    findings.append(('FEATURE NAME NOT IN SOURCE', s['name'], s['book'],
                                     f['name'], ''))
                continue
            hits += 1
            st['found'] += 1

            want = mech_tokens(f['d'])
            if not want:
                continue
            # Conservative, for the reason featpdf documents: a feature's text can be columns away
            # from its heading, and that cannot be scored away. A token counts as present if it
            # appears near ANY occurrence of the feature name inside the entry.
            # RANK the occurrences, never take the first 8 in document order. "Rage" appears 94
            # times in the PHB and a class chapter is 90,000 characters wide, so the first eight
            # are a contents line and seven table rows — the real entry never got read and
            # Barbarian was reported as missing advantage, bonus action AND resistance.
            # Ranked by the feature's own identity words, which are disjoint from the mechanics
            # under test, so this cannot pull the window toward agreeing with the app.
            ident = content_words(f['d'])
            ranked = sorted(cands, key=lambda p: -len(ident & content_words(
                raw[idx[p]: idx[min(len(idx) - 1, p + 900)]])))
            have = set()
            for p in ranked[:8]:
                a = max(0, p - 500)
                b = min(len(idx) - 1, p + max(len(flat(f['d'])) * 2, 2400))
                have |= mech_tokens(raw[idx[a]: idx[b]], source=True)
            gap = sorted(t for t in want if t not in have)
            if gap:
                findings.append(('MECHANICS NOT IN SOURCE', s['name'], s['book'],
                                 f"{f['name']} (L{f['level']})",
                                 'app states ' + ', '.join(gap)))
        if hits:
            paired += 1
            st['paired'] += 1
        else:
            unpaired += 1
            findings.append(('NO FEATURE FOUND', s['name'], s['book'], '', ''))
    return stats, findings, notes, paired, unpaired, nobook


def _impossible(d):
    """Values no rulebook contains, so nothing can accidentally satisfy them."""
    d = re.sub(r'\b(\d+)(\s*(?:feet|foot|ft)\b)', lambda m: '9' + m.group(0), d)
    d = re.sub(r'\b(\d+)d(\d+)\b', lambda m: '9' + m.group(0), d)
    # DCs too, so the "save DC implies dc8" reading cannot quietly hide a wrong one.
    return re.sub(r'\bDC (\d+)\b', lambda m: 'DC 9' + m.group(1), d)


# Swaps to values the books DO contain. This is the control that constrains WINDOW WIDTH: an
# impossible 930 ft can never be satisfied by a neighbour's text however wide the window grows, so
# it cannot tell you what widening costs. A plausible 15 ft can, because the feature next door may
# genuinely say 15 feet.
PLAUSIBLE_FT = {'5': '15', '10': '30', '15': '5', '20': '10', '30': '10', '60': '30', '120': '60'}
PLAUSIBLE_DIE = {'4': '6', '6': '8', '8': '10', '10': '12', '12': '6', '20': '12'}


def _plausible(d):
    d = re.sub(r'\b(\d+)(\s*(?:feet|foot|ft)\b)',
               lambda m: PLAUSIBLE_FT.get(m.group(1), m.group(1)) + m.group(2), d)
    return re.sub(r'\b(\d+)d(\d+)\b',
                  lambda m: f'{m.group(1)}d{PLAUSIBLE_DIE.get(m.group(2), m.group(2))}', d)


def control(all_subs, mode='impossible'):
    """Corrupt every distance and die, then require the sweep to report each one."""
    mangle = _impossible if mode == 'impossible' else _plausible
    bad = json.loads(json.dumps(all_subs))
    changed = set()
    for s in bad:
        for f in s['features']:
            d = mangle(f['d'])
            if d != f['d']:
                changed.add(s['name'])
                f['d'] = d
    _, findings, _, _, _, _ = sweep(bad)
    flagged = {r[1] for r in findings}
    missed = sorted(changed - flagged)
    print(f'CONTROL[{mode}]: {len(changed)} subclasses corrupted, '
          f'{len(changed & flagged)} detected ({100 * len(changed & flagged) // max(1, len(changed))}%)')
    if missed:
        print(f'  MISSED ({len(missed)}): ' + ', '.join(missed[:20]))
    else:
        print('  missed: none — the sweep cannot silently miss a wrong number.')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    full = '--full' in sys.argv
    all_subs = subclasses()
    if '--control' in sys.argv:
        control(all_subs, 'plausible' if '--plausible' in sys.argv else 'impossible')
        return

    stats, findings, notes, paired, unpaired, nobook = sweep(all_subs, args[0] if args else None)
    considered = paired + unpaired + nobook
    print(f'# {considered} subclasses considered\n')
    print('| book | paired | total | no PDF | features | names found |')
    print('|---|---|---|---|---|---|')
    for b, st in sorted(stats.items()):
        thin = '  ⚠ THIN' if st['nobook'] == 0 and st['total'] and st['paired'] / st['total'] < 0.8 else ''
        print(f"| {b} | {st['paired']} | {st['total']} | {st['nobook']} | {st['feats']} | "
              f"{st['found']} |{thin}")
    print(f'\npaired {paired} + unpaired {unpaired} + no-PDF {nobook} = {considered}')
    if paired == 0:
        sys.exit('\nNOTHING PAIRED — any findings below would be meaningless.')

    def dump(rows):
        kinds = {}
        for r in rows:
            kinds.setdefault(r[0], []).append(r)
        for kind, lst in kinds.items():
            print(f'\n## {kind} ({len(lst)})')
            for _, name, book, what, note in (lst if full else lst[:25]):
                print(f'- **{name}** [{book}]' + (f' — {what}' if what else '')
                      + (f'  ({note})' if note else ''))
            if not full and len(lst) > 25:
                print(f'  … {len(lst) - 25} more (pass --full)')

    dump(findings)
    if notes:
        print('\n---\n# Not findings — the audit read the wrong window or the wrong extraction')
        dump(notes)
    print(f'\n{len(findings)} findings over {paired} paired subclasses'
          + (f'  (+{len(notes)} explained above)' if notes else ''))


if __name__ == '__main__':
    main()
