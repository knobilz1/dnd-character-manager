"""Backgrounds and magic items vs the PDFs — the last two unchecked categories.

73 backgrounds and 785 items, none of them ever compared against the BOOKS: both were read by hand
or against the `md/` extracts, which are summaries.

ONE tool for both, because both are the same shape — a named entity carrying a single description,
which is a FEAT. So this reuses featpdf's locator (identity-word anchoring, the second-person
entry test, the chapter sweep, rarity weighting) rather than becoming the fifth near-copy of the
same code. Races/subclasses/classes are the other shape — entity with named sub-features — and
live in racepdf/subclasspdf.

BOTH CONTROLS, as everywhere else:
  --control              impossible values (930 ft, 92d6). Can the sweep fail at all?
  --control --plausible  values the books contain (30 ft -> 10 ft, d8 -> d10, Wisdom -> Charisma).
                         What is the comparison window costing?
Re-run both after ANY scoring change. On subclasses the plausible control showed that widening the
window traded 16 points of real detection for 10 fewer findings, which the impossible control read
as a flat 100%.

STATE 2026-08-01
  backgrounds  72/73 located · 19 findings · controls 93% impossible / 93% plausible
  items       784/784 located · 90 findings · controls 99% impossible / 64% PLAUSIBLE

TRUST BACKGROUNDS, DO NOT YET TRUST ITEMS. 64% means a third of plausible wrong values go
unreported: magic-item entries are short and packed adjacently, so any window that reaches the
entry also reaches its neighbours, and a neighbour genuinely states the swapped value. Fix that
before reading the 90 item findings as a work list.

THE BACKGROUND SWEEP WAS BLIND AND THE CONTROL IS THE ONLY REASON ANYONE KNOWS. Comparing
mech_tokens over a background's FEATURE prose detected 0 of 16 corruptions — 57 of 73 feature texts
contain no die, distance or ability at all ("you command the respect of those who share your
faith"), so `want` was empty and nothing was ever compared, while the report said "72 located, 1
finding". A background's checkable claims are its GRANTS, which the books state plainly as "Skill
Proficiencies: Insight, Religion". 0% -> 93%.

Usage: ENTITY_BUNDLE=<bundled .mjs> python tools/audit/entitypdf.py --kind=background|item
                                                                   [book] [--full] [--control]
"""
import json
import math
import os
import re
import subprocess
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(__file__))
import r6verify as V  # noqa: E402
from racepdf import alt_flat, alt_text, flat, mech_tokens, trait_variants  # noqa: E402
from bookquality import BOOK_PDF  # noqa: E402
from featpdf import content_words, feat_chapter, heading_positions, locate  # noqa: E402
from subclasspdf import _impossible, _plausible  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

EXPORTS = {'background': 'ALL_BACKGROUNDS', 'item': 'ALL_ITEMS'}


def entities(kind, bundle=None):
    """Name + book + the text that carries the mechanics.

    A background's mechanics live in `feature.description`, not in the flavour; an item's live in
    `description`. Both are reduced to the same shape so one sweep can read them.
    """
    scratch = bundle or os.environ.get('ENTITY_BUNDLE')
    if not scratch:
        sys.exit('set ENTITY_BUNDLE to a bundled .mjs path')
    # A background's checkable claims are its GRANTS, not its feature prose. 57 of 73 feature
    # descriptions yield no mechanical token whatsoever — "you command the respect of those who
    # share your faith" contains no die, distance or ability — so a mech_tokens comparison verifies
    # nothing while the report still says "72 located". The books state the grants plainly:
    # "Skill Proficiencies: Insight, Religion".
    pick = ('({name:x.name,book:x.sourceBook,d:((x.feature&&x.feature.description)||""),'
            'grants:[].concat(x.skillProficiencies||[],x.toolProficiencies||[])})'
            if kind == 'background' else '({name:x.name,book:x.sourceBook,d:x.description??""})')
    out = subprocess.run(
        ['node', '-e',
         'const {pathToFileURL}=await import("node:url");'
         'const m=await import(pathToFileURL(process.argv[1]).href);'
         f'console.log(JSON.stringify(m.{EXPORTS[kind]}.map(x=>{pick})));',
         scratch],
        capture_output=True, text=True, encoding='utf-8')
    if out.returncode:
        sys.exit(out.stderr[:800])
    rows, seen = [], set()
    for r in json.loads(out.stdout):
        key = (r['name'], r['book'])
        if key not in seen:                       # items.ts re-exports the same entry in groups
            seen.add(key)
            rows.append(r)
    return rows


def sweep(rows, only=None):
    stats, findings, notes = {}, [], []
    located = unlocated = nobook = 0
    chapters, weights, books = {}, {}, {}

    for e in rows:
        if only and e['book'] != only:
            continue
        st = stats.setdefault(e['book'], {'found': 0, 'total': 0, 'nobook': 0})
        st['total'] += 1
        pdf = BOOK_PDF.get(e['book'])
        if not pdf or not os.path.exists(os.path.join(V.REF, pdf)):
            st['nobook'] += 1
            nobook += 1
            continue
        if e['book'] not in books:
            raw = V.book_text(pdf)
            books[e['book']] = (raw,) + V._flatten(raw)
            sib = [flat(x['name']) for x in rows if x['book'] == e['book'] and flat(x['name'])]
            chapters[e['book']] = feat_chapter(books[e['book']][1], raw,
                                               books[e['book']][2], sib)
            c = Counter(re.findall(r'[a-z]{4,}', raw.lower()))
            weights[e['book']] = {w: 1.0 / (1.0 + math.log(1 + n)) for w, n in c.items()}
        raw, book, idx = books[e['book']]

        keys = [flat(x['name']) for x in rows
                if x['book'] == e['book'] and x['name'] != e['name'] and flat(x['name'])]
        names = [flat(v) for v in trait_variants(e['name']) if len(flat(v)) >= 4]
        if not names:
            continue
        pos = locate(book, raw, idx, names, keys, content_words(e['d']),
                     chapters[e['book']], weights[e['book']])
        if pos is None:
            if any(alt_flat(e['book']).count(n) for n in names):
                notes.append(('ONLY IN THE OTHER EXTRACTION', e['name'], e['book'], '', ''))
            else:
                findings.append(('NOT LOCATED', e['name'], e['book'], '', ''))
            unlocated += 1
            continue
        located += 1
        st['found'] += 1

        # Conservative for the reason featpdf documents: a heading can sit columns away from the
        # text it names, and that cannot be scored away. Width 1,400 is what the plausible control
        # priced there — wider was 8 points worse for no change in findings.
        spans = []
        for s in ([pos] + heading_positions(book, names))[:12]:
            a = max(0, s - 700)
            b = min(len(idx) - 1, s + max(len(flat(e['d'])) * 2, 1400))
            spans.append(raw[idx[a]: idx[b]])

        if e.get('grants'):
            # Flat containment, not MECH: a skill name is a proper noun, not mechanical vocabulary.
            flatspans = [flat(t) for t in spans]
            gap = sorted({g for g in e['grants']
                          if flat(g) and not any(flat(g) in fs for fs in flatspans)})
            # NOT retried against the other extraction, and that was measured rather than assumed.
            # Doing so removed 2 findings and cost 22 points of detection — impossible 93% -> 87%,
            # plausible down to 71% — because a background's grants are common words that appear
            # all over a second copy of the book. Same trade the window width already refused.
            if gap:
                findings.append(('GRANT NOT IN SOURCE', e['name'], e['book'], '',
                                 'app grants ' + ', '.join(gap)))
            continue

        want = mech_tokens(e['d'])
        if not want:
            continue
        have = set()
        for seg in spans:
            have |= mech_tokens(seg, source=True)
        gap = sorted(t for t in want if t not in have)
        if gap:
            findings.append(('MECHANICS NOT IN SOURCE', e['name'], e['book'], '',
                             'app states ' + ', '.join(gap)))
    return stats, findings, notes, located, unlocated, nobook


# Swap a granted skill for a different real one. Corrupting the feature PROSE cannot test a
# background sweep at all — the first control run corrupted 16 of 73 and detected 0, because the
# claims being checked are the grants and the prose carries none of them.
SKILL_SWAP = {
    'Acrobatics': 'Athletics', 'Athletics': 'Acrobatics', 'Arcana': 'History',
    'History': 'Arcana', 'Deception': 'Persuasion', 'Persuasion': 'Deception',
    'Insight': 'Perception', 'Perception': 'Insight', 'Intimidation': 'Performance',
    'Performance': 'Intimidation', 'Investigation': 'Nature', 'Nature': 'Investigation',
    'Medicine': 'Religion', 'Religion': 'Medicine', 'Stealth': 'Survival',
    'Survival': 'Stealth', 'Animal Handling': 'Sleight of Hand',
    'Sleight of Hand': 'Animal Handling',
}


def control(rows, mode='impossible'):
    mangle = _impossible if mode == 'impossible' else _plausible
    bad, changed = [], set()
    for e in rows:
        d = mangle(e['d'])
        grants = e.get('grants')
        if grants:
            swapped = [SKILL_SWAP.get(g, g) for g in grants]
            if swapped != grants:
                changed.add(e['name'])
            bad.append(dict(e, d=d, grants=swapped))
            continue
        if d != e['d']:
            changed.add(e['name'])
        bad.append(dict(e, d=d))
    _, findings, _, _, _, _ = sweep(bad)
    flagged = {r[1] for r in findings}
    missed = sorted(changed - flagged)
    print(f'CONTROL[{mode}]: {len(changed)} corrupted, {len(changed & flagged)} detected '
          f'({100 * len(changed & flagged) // max(1, len(changed))}%)')
    print('  missed: none — the sweep cannot silently miss a wrong number.' if not missed
          else f'  MISSED ({len(missed)}): ' + ', '.join(missed[:15]))


def main():
    kind = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--kind=')), None)
    if kind not in EXPORTS:
        sys.exit(__doc__)
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    full = '--full' in sys.argv
    rows = entities(kind)
    if '--control' in sys.argv:
        control(rows, 'plausible' if '--plausible' in sys.argv else 'impossible')
        return

    stats, findings, notes, located, unlocated, nobook = sweep(rows, args[0] if args else None)
    considered = located + unlocated + nobook
    print(f'# {considered} {kind}s considered\n')
    print('| book | located | total | no PDF |')
    print('|---|---|---|---|')
    for b, st in sorted(stats.items()):
        thin = '  ⚠ THIN' if st['nobook'] == 0 and st['total'] and st['found'] / st['total'] < 0.8 else ''
        print(f"| {b} | {st['found']} | {st['total']} | {st['nobook']} |{thin}")
    print(f'\nlocated {located} + unlocated {unlocated} + no-PDF {nobook} = {considered}')
    if located == 0:
        sys.exit('\nNOTHING LOCATED — any findings below would be meaningless.')

    def dump(rows_):
        kinds = {}
        for r in rows_:
            kinds.setdefault(r[0], []).append(r)
        for k, lst in kinds.items():
            print(f'\n## {k} ({len(lst)})')
            for _, name, book, _w, note in (lst if full else lst[:25]):
                print(f'- **{name}** [{book}]' + (f'  ({note})' if note else ''))
            if not full and len(lst) > 25:
                print(f'  … {len(lst) - 25} more (pass --full)')

    dump(findings)
    if notes:
        print('\n---\n# Not findings — the audit read the wrong window or the wrong extraction')
        dump(notes)
    print(f'\n{len(findings)} findings over {located} located {kind}s'
          + (f'  (+{len(notes)} explained above)' if notes else ''))


if __name__ == '__main__':
    main()
