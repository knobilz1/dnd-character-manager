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

STATE 2026-08-01 — FINDINGS ARE NOT YET TRUSTWORTHY. Do not act on one without reading the book
yourself. This is where racepdf sat at "the locator works, the comparison does not yet", and
racepdf went 306 findings -> 48 from there.

  coverage   155 of 155 located, from 122 (0 missing PDFs)
  findings   19, from 60 — still ~12% of located, and hand-checks keep coming back app-correct

Four instrument bugs found and fixed so far, none of them in the app's data:
  1. racepdf's BOOK_PDF covers only books with RACES, so every TCE and XGtE feat was silently
     skipped as "no PDF" — 30 of 155 — while the run looked healthy.
  2. Sibling-density scoring finds the densest cluster of feat names, which is a LIST every time.
  3. The app's 2024 descriptions open with their filing category ("General feat", "Origin feat"),
     and the 2024 feats chapter opens with a TABLE built from those same words, so identity
     matching scored the table above every real entry — see FILING.
  4. Anchoring only on RARE identity words fails for any feat written in common vocabulary. Alert
     is all initiative/roll/ally/immediately, so every anchor was filtered out and it fell back to
     its heading, 109,000 characters from its real text.

WHAT IS STILL WRONG, measured not guessed. Headings and bodies extract from different columns, and
inconsistently: "Boon of Truesight" sits 493 characters above its body, while "Blind Fighting" and
"Polearm Master" have no heading within 700 characters of theirs. Every remaining finding checked
by hand has been a locator miss — the book DOES print "Blindsight with a range of 10 feet" and
"Truesight with a range of 60 feet". `feat_chapter` also still falls through to its fallback on the
2024 PHB and returns an 807,000-character "chapter", i.e. most of the book.

NOTE the ordering metric used earlier is now INVALID. Position-vs-alphabetical inversions measured
HEADING order; once entries are located by body, interleaved columns make inversions rise even as
accuracy improves — PHB went 14% -> 17% on the same run that fixed Inspiring Leader.

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


STOP = set("""you your the a an and or of to in on for with is are be can that this it as at from
by not their its his her they them when if each other one two three all any some more most into
than then so such which who whom whose there here what while during until after before between
have has had do does did been being was were will would shall should may might must gain gains
gained make makes made take takes taken use uses used you're don't can't isn't""".split())
MECH_WORDS = set("""strength dexterity constitution intelligence wisdom charisma rest short long
bonus action reaction advantage disadvantage resistance immunity proficiency feet foot ft damage
acid cold fire force lightning necrotic poison psychic radiant thunder level levels""".split())
# How the app FILES a feat, not what the feat IS. The 2024 descriptions open with their category
# ("General feat (Str or Dex 13+)", "Origin feat."), and the 2024 PHB's feats chapter opens with a
# TABLE built from exactly those words — so identity matching scored the table above every real
# entry and Athlete, Alert and Magic Initiate all located to the same intro page.
FILING = set("""feat feats general origin epic boon boons fighting style styles prerequisite
prerequisites repeatable ability score improvement background class""".split())


def content_words(text):
    """Words that carry a feat's IDENTITY, with everything that carries its mechanics removed.

    Deliberately disjoint from `mech_tokens`: identity words locate the entry, mechanical tokens
    are what gets tested. Anchoring on the heading cannot work in the PHB, whose feat headings and
    bodies extract from different columns, and anchoring on the mechanics would be circular — a
    genuine mismatch would present as a missing entry rather than as the finding it is.
    """
    return {w for w in re.findall(r'[a-z]{4,}', (text or '').lower())
            if w not in STOP and w not in MECH_WORDS and w not in FILING}


def locate(book, raw, idx, names, keys, want_words=None, chapter=None):
    """Flat offset of the feat's BODY.

    Two anchors, because neither alone is enough. The heading works when extraction is clean and
    is meaningless when it is not; the body's own vocabulary survives column scrambling but can
    drift onto a similar feat. Every candidate from both is scored on how much of the feat's
    identity vocabulary sits in the window, with sibling feat names as a tie-break so the feats
    chapter beats a passing mention elsewhere.
    """
    cands = []
    for n in names:
        start = 0
        while True:
            i = book.find(n, start)
            if i < 0:
                break
            start = i + 1
            if _is_entry(raw, idx, i, len(n)):
                cands.append(i)
    # Sweep the chapter itself. Anchoring only on RARE identity words silently fails whenever a
    # feat has none: Alert is written entirely in common vocabulary (initiative, roll, ally,
    # immediately), every candidate word was filtered as too common, and it fell back to the
    # heading — which in the 2024 PHB is a table entry 109,000 characters from the real text.
    if chapter:
        lo, hi = chapter
        cands.extend(range(lo, hi, 250))

    want = want_words or set()
    best, best_score = None, -1
    for i in sorted(set(cands)):
        seg = raw[idx[i]: idx[min(len(idx) - 1, i + 1300)]]
        score = 3 * len(want & content_words(seg))
        # The sibling tie-break exists to prefer the feats chapter over a passing mention. Inside
        # a known chapter it is both redundant and quadratic — 74 names re-scanned for each of ~560
        # windows, for each of 155 feats, which ran past ten minutes.
        if not chapter:
            score += sum(1 for k in keys if 0 <= book.find(k, max(0, i - 200)) < i + SPAN)
        if score > best_score:
            best, best_score = i, score
    return best


def feat_chapter(book, raw, idx, keys):
    """Flat (lo, hi) of the region where this book actually prints its feats.

    Found once per book so the per-feat sweep stays cheap, and bounded by entry-like occurrences
    only — a table of contents or a chapter-intro list holds the same names but none of them read
    as entries, so the region lands on the prose.
    """
    at = []
    for k in keys:
        start = 0
        while True:
            i = book.find(k, start)
            if i < 0:
                break
            start = i + 1
            if _is_entry(raw, idx, i, len(k)):
                at.append(i)
    if len(at) < 3:
        return None
    at.sort()
    # Densest span holding the most entry-like feat names.
    best, span = (at[0], at[-1]), 10 ** 9
    for w in (60_000, 90_000, 140_000):
        for a in at:
            n = sum(1 for p in at if a <= p < a + w)
            if n >= max(3, len(at) * 0.5) and w < span:
                best, span = (a, a + w), w
                break
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

    stats, findings, notes, chapters = {}, [], [], {}
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
        if f['book'] not in chapters:
            chapters[f['book']] = feat_chapter(
                book, raw, idx, [k for k in siblings[f['book']] if k])

        keys = [k for k in siblings[f['book']] if k and k != flat(f['name'])]
        names = [flat(v) for v in trait_variants(f['name']) if flat(v)]
        pos = locate(book, raw, idx, names, keys, content_words(f['d']),
                     chapters[f['book']])
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

        # `pos` is already the body's offset. Re-finding the NAME inside the window here would
        # undo the whole point of anchoring on the body: in the PHB the heading sits in a
        # different column from the text it names.
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
