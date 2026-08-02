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
  backgrounds  72/73 located ·  19 findings · controls 93% impossible / 93% plausible
  items       784/784 located · 258 findings · controls 99% impossible / 86% plausible
                                              BUT SEE THE KNOBS NOTE — that 86% is the average of
                                              94-100% on magic items and 53% on PHB equipment.
  spells      530/543 located ·  34 findings · controls 97% impossible / 91% plausible

AND A THIRD BLINDNESS THE TWO CONTROLS SHARE, found on spells. Both read 99%/90% while the sweep
was comparing nearly half the PHB's spells against a window that did not contain them, because a
corrupted value is absent from a WRONG window exactly as reliably as from a right one. Neither
control can see a locator that lands in the wrong place. What caught it was Fireball being reported
for "1d6" and Magic Missile for "force damage" — claims the book obviously makes. The check that
generalises: after any locator change, look at whether the most famous entries are being flagged
for their most famous numbers. See `spell_entry`.

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
import bisect
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

EXPORTS = {'background': 'ALL_BACKGROUNDS', 'item': 'ALL_ITEMS', 'spell': 'ALL_SPELLS'}

# Comparison-window knobs, per kind, each priced by the plausible control rather than guessed.
# Feats and backgrounds are printed as generously-spaced entries; magic items are short and packed
# one after another, so a window sized for a feat reads three neighbouring items and accepts their
# numbers as this item's.
#     spots  back  width   findings  impossible  plausible
#       12    700   1400       90       99%         64%
#       12    300    700      115       99%         75%
#        6    200    500      155       99%         81%   <- chosen
#        3    150    400      224       99%         86%
#        1    100    300      333       99%         92%
#        1     60    200      339       99%         96%
#
# That table has been superseded. It read as "no free setting — every point of detection costs
# findings", and the real reason was that a character width cannot separate entries printed
# shoulder to shoulder. Bounding each window at the NEXT entry's heading removes the trade, and the
# aggregate was ALSO hiding that this corpus is two populations with very different instruments:
#
#   spots 1 / back 0 / width 1400, bounded      located  findings  plausible
#     EGtW   magic items                            83        35      100%
#     TCE    magic items                            83        26       96%
#     DMG    magic items                           265       114       94%   (was 85%)
#     PHB    mundane equipment                     252        30       53%   (was 57%)
#
# 81% aggregate was the average of a 94-100% instrument and a 53% one. Magic items — where the
# mechanics actually live — are now on par with every other sweep.
#
# PHB's 253 entries are rope, torches and rations, printed in EQUIPMENT TABLES with no entry header
# to bound against and often no prose at all. That is the same shape as the background sweep before
# it was fixed: the claims are tabular (cost, weight, damage, properties) and comparing them as
# prose windows checks almost nothing. The fix is to compare the table columns, not to tune a
# window. NOT BUILT — and 53% is printed rather than averaged away so it cannot be mistaken for
# coverage this sweep does not have.
KNOBS = {
    'background': {'spots': 12, 'back': 700, 'width': 1400},
    'item': {'spots': 1, 'back': 0, 'width': 1400},
    'spell': {'spots': 1, 'back': 200, 'width': 1500},
}
# Spells, same measurement (547 entries, 320 of them carrying a corruptible number — 58%, against
# 10% for class features, so this rate is measured over most of the data rather than a corner).
#
# The FIRST table here was priced against `locate`, and every number in it was meaningless:
#     spots 6 / back 150 / width 600 -> 87 findings, 99% impossible, 90% plausible
# Both controls passed while the sweep was reading a window that did not contain the spell (see
# `spell_entry`). Re-priced against the entry anchor:
#     spots  back  width   findings  impossible  plausible
#        6    150    600       52       97%         90%    (the old setting, re-measured)
#        1    150    600       54       97%         93%
#        1    200   1500       40       97%         91%   <- chosen
#        1    200   2500       36       97%         88%
#        1    300   4000       33       97%         81%
#
# `spots: 1` — the entry alone, not every occurrence of the name — is better on BOTH axes than
# spots 6, so the extra windows were never buying coverage, only hiding gaps. Width 1,500 then
# reaches the At Higher Levels paragraph, which sits at the END of a spell entry and is where a
# third of the app's dice live; 600 cut it off and reported the book as never stating an upcasting
# line it prints for every spell. 40 findings at 91% beats the previous setting on both counts,
# which is rare and is the only reason to take it — a quieter report is otherwise a worse one.
#
# THESE TABLES ARE ONLY MEANINGFUL BECAUSE OF THE id()-CACHE FIX in r6verify._flatten. Built before
# it, width 550 read 256 findings between 500's 92 and 600's 87 — a table looping settings in one
# process was reading windows computed against a different book's character index.


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
    # A spell's upcasting line carries as many dice as its body ("2d6 for each slot level above
    # 1st") and lives in a separate field, so it is appended rather than left unchecked.
    pick = {
        'background': ('({name:x.name,book:x.sourceBook,d:((x.feature&&x.feature.description)||""),'
                       'grants:[].concat(x.skillProficiencies||[],x.toolProficiencies||[])})'),
        'item': '({name:x.name,book:x.sourceBook,d:x.description??""})',
        'spell': ('({name:x.name,book:x.sourceBook,'
                  'd:(x.description??"")+"\\n"+(x.atHigherLevels??""),'
                  'damageType:x.damageType??null,savingThrow:x.savingThrow??null,'
                  'level:x.level})'),
    }[kind]
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
            r['kind'] = kind
            rows.append(r)
    return rows


_CT_MARKS = {}
_ITEM_MARKS = {}

# How far past an item's name its OWN type/rarity line can sit. Marks nearer than this belong to
# the entry being read; the first one beyond it starts the next entry.
OWN_HEADER = 120


def _item_marks(bookid, raw, book, idx, siblings):
    """Flat offsets of every item ENTRY heading in a book.

    The item analogue of a spell's "Casting Time", and it has to be the same TWO-part test: an item
    NAME followed closely by a type/rarity line. The rarity line alone is not an entry marker —
    "rare", "common" and "requires attunement" all occur in ordinary body prose, which made the
    marks 4x the item count in the DMG and 25x in XGtE and GGR, so the bound landed INSIDE entries
    and cut them short. Findings went up while detection barely moved, which is the signature of a
    boundary that is firing on the wrong thing rather than of a sweep that got stricter.

    V.ENTRY_MARK is matched on RAW text so word boundaries still exist ('rare' inside 'rarely'
    would match a flat search), then mapped into flat space.
    """
    if bookid not in _ITEM_MARKS:
        rarity = sorted({bisect.bisect_left(idx, m.start())
                         for m in V.ENTRY_MARK.finditer(raw)})
        out = []
        for n in siblings:
            start = 0
            while True:
                i = book.find(n, start)
                if i < 0:
                    break
                start = i + 1
                j = bisect.bisect_left(rarity, i)
                if j < len(rarity) and rarity[j] - i < OWN_HEADER:
                    out.append(i)
        _ITEM_MARKS[bookid] = sorted(set(out))
    return _ITEM_MARKS[bookid]


def _ct_marks(bookid, book):
    """Flat offsets of every "Casting Time" in a book — one per spell entry, near enough."""
    if bookid not in _CT_MARKS:
        _CT_MARKS[bookid] = [m.start() for m in re.finditer('castingtime', book)]
    return _CT_MARKS[bookid]


def spell_entry(book, raw, idx, names, marks, want, weight):
    """Flat offset of a spell's ENTRY, anchored on the header every book prints above every spell.

    Spells do not go through `locate`, and the reason is worth keeping. `feat_chapter` picks the
    DENSEST fixed-width window of entry names, which for spells is the class spell LISTS — pages of
    nothing but spell names and no mechanics at all — and its 133,000-char width is narrower than
    the PHB's 80-page description section regardless. Measured: only 188 of the PHB's 357 real
    spell entries fell inside the chapter it chose, so nearly half the book's spells were compared
    against a window that never contained them.

    That produced 87 findings which BOTH CONTROLS PASSED AT 99% AND 90%, because a corrupted value
    is missing from a wrong window exactly as reliably as from a right one. Neither control can see
    a locator that lands in the wrong place; what caught it was Fireball being reported for "1d6"
    and Magic Missile for "force damage" — claims the PHB obviously does make.

    "Casting Time" is the ideal anchor here precisely because it is disjoint from both the spell's
    identity and its mechanics: it is not a word `content_words` ranks on and not a token
    `mech_tokens` tests, so using it is neither circular nor a tie-break in disguise.
    """
    cands = [i for i in heading_positions(book, names) if any(0 < c - i < 140 for c in marks)]
    if not cands:
        return None
    best, best_score = None, -1.0
    for i in sorted(set(cands)):
        seg = raw[idx[i]: idx[min(len(idx) - 1, i + 900)]]
        score = sum(weight.get(w, 1.0) for w in want & content_words(seg))
        if score > best_score:
            best, best_score = i, score
    return best


def sweep(rows, only=None):
    stats, findings, notes = {}, [], []
    located = unlocated = nobook = 0
    chapters, weights, books, sibs = {}, {}, {}, {}

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
            sibs[e['book']] = [n for n in sib if len(n) >= 4]
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
        if e['kind'] == 'spell':
            pos = spell_entry(book, raw, idx, names, _ct_marks(e['book'], book),
                              content_words(e['d']), weights[e['book']])
        else:
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
        kn = KNOBS[e['kind']]
        # Magic items are printed shoulder to shoulder, so no character width can separate an entry
        # from its neighbour — every setting traded detection against findings and the sweep sat at
        # 81%. Ending the window at the NEXT entry's own type/rarity line removes the trade: a
        # neighbour cannot answer for this item however wide the window is. Same fix as spells.
        bounds = (_item_marks(e['book'], raw, book, idx, sibs[e['book']])
                  if e['kind'] == 'item' else None)
        spans = []
        for s in ([pos] + heading_positions(book, names))[:kn['spots']]:
            a = max(0, s - kn['back'])
            b = min(len(idx) - 1, s + max(len(flat(e['d'])) * 2, kn['width']))
            if bounds:
                nxt = bisect.bisect_right(bounds, s)   # marks ARE entry starts; take the next one
                if nxt < len(bounds):
                    b = min(b, bounds[nxt])
            spans.append(raw[idx[a]: idx[b]])

        if e['kind'] == 'background':
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
        # Retry the gap in the OTHER extraction, inside that copy's own entry — not anywhere in the
        # book. The PHB 2024's OCR drops text wholesale (it lost whole subclass feature headings,
        # which is why the text layer was recovered at all), so a spell there can be reported for a
        # die the second extraction states plainly.
        #
        # Measured, not assumed, because the same retry COST the background sweep 22 points: a
        # background's grants are common words that hit anywhere in a second copy of the book. Dice
        # and distances are specific, and confining the retry to the alt copy's own bounded entry
        # keeps it from becoming a book-wide search. Controls after: 97% / 91%, both unmoved.
        if gap and e['kind'] == 'spell':
            alt = alt_text(e['book'])
            if alt:
                araw, abook, aidx = alt
                apos = spell_entry(abook, araw, aidx, names,
                                   _ct_marks(e['book'] + '#alt', abook),
                                   content_words(e['d']), weights[e['book']])
                if apos is not None:
                    ab = min(len(aidx) - 1, apos + max(len(flat(e['d'])) * 2, kn['width']))
                    ahave = mech_tokens(araw[aidx[apos]: aidx[ab]], source=True)
                    gap = [t for t in gap if t not in ahave]
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
        if e['kind'] == 'background':
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
