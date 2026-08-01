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

STATE 2026-08-01 — TRUSTWORTHY, in the only sense that matters: it CANNOT silently miss.

  coverage    155 of 155 feats located (from 122)
  findings    4 (from 60) — 2.6% of located, and ALL FOUR are explained: none is a data bug
  control     impossible 43/43 (100%) · plausible 37/42 (88%)

TWO CONTROLS, because one is blind to what the comparison window costs. Impossible corruptions
(930 ft, 92d6) prove the sweep can fail at all and read 100% at ANY width, since nothing satisfies
930 ft. Plausible ones (30 ft -> 10 ft, d8 -> d10) can be satisfied by the feat next door, so they
price the window. Run both from scratchpad/plausible.py; scratchpad/featwidth.py sweeps the knobs.

    spots  width   findings  impossible  plausible
      12    2200       4        100%        80%
      12    1400       4        100%        88%   <- chosen: 8 points, free
       3    1400       6        100%        88%
       1    1400      10        100%        92%

Narrowing to 1,400 changed no finding and recovered 8 points of detection, so the earlier 2,200 was
pure loss. Below that, detection is bought with false positives and is no longer free.

88% is the honest ceiling: 5 plausible corruptions go unreported (Mobile, Speedy, Telepathic,
Unarmed Fighting, Boon of Dimensional Travel) because a neighbouring feat genuinely states the
swapped value. Findings are trustworthy; the ABSENCE of a finding is weaker.

The control is the claim. Every distance and die in every feat description is bumped (30 ft -> 930
ft, 2d6 -> 92d6) and the sweep must report all of them; a sweep that has gone quiet by degrading is
indistinguishable from a correct one without it. Re-run it after ANY scoring change:
that is how the bare-dice reading below was caught putting both Lucky halflings on the list.

Seven instrument bugs found on the way here, none of them in the app's data:
  1. racepdf's BOOK_PDF covers only books with RACES, so every TCE and XGtE feat was silently
     skipped as "no PDF" — 30 of 155 — while the run looked healthy.
  2. Sibling-density scoring finds the densest cluster of feat names, which is a LIST every time.
  3. The app's 2024 descriptions open with their filing category ("General feat", "Origin feat"),
     and the 2024 feats chapter opens with a TABLE built from those same words, so identity
     matching scored the table above every real entry — see FILING.
  4. Anchoring only on RARE identity words fails for any feat written in common vocabulary. Alert
     is all initiative/roll/ally/immediately, so every anchor was filtered out and it fell back to
     its heading, 109,000 characters from its real text.
  5. feat_chapter demanded a window hold half of all entry-like name occurrences. Feat names are
     quoted all over a rulebook, so that was never met on the 2024 PHB and it fell through to
     (first, last) — an 807,000-character "chapter". It takes the densest window now.
  6. Flat identity counts let a window full of common words outscore the right entry; weights are
     by rarity now, from one tokenisation per book.
  7. TCE injects a space INSIDE the unit word — "you can move it 5 fe et to an unoccupied space",
     183 times and in no other book — so Crusher, Gunner and Telekinetic were all reported as
     inventing the 5 feet they state, with their headings 207 characters away the whole time.
     Repaired in debook(); TCE is born-digital, so that is the only fix it can ever get.

THE REMAINING 4, none of them confirmed:
  Gift of the Gem Dragon  FToD writes save DCs as "8 + your ..." and never the literal "DC 8" —
                          0 occurrences book-wide. A MECH pattern gap, like "4 extra feet".
  Greater Dragonmark      known-blocked: ERLW's house tables are not in the extract.
  Mage Slayer             the 2024 entry truncates at the next heading and loses its own body —
                          it lacks "Disadvantage" too, which app and 2024 rules both have.
  Heavily Armored         the only one not yet explained; it has no uppercase heading to bound.

WHY IT REPORTS CONSERVATIVELY. Headings and bodies extract from different columns, inconsistently:
"Boon of Truesight" sits 493 characters above its body, "Blind Fighting" and "Polearm Master" have
none within 700 of theirs. That cannot be scored away — a heading bonus strong enough to fix
Athlete and two Boons regressed Blind Fighting, and the strict tie-break traded them back. So a
token counts as present if it appears near ANY occurrence of the feat's name or near the best
identity match. False negatives are traded for false positives deliberately; the control proves the
trade did not cost detection.

DEAD METRIC, do not revive: position-vs-alphabetical "inversions" measured HEADING order. Once
entries are located by BODY, interleaved columns make inversions rise as accuracy improves — PHB
went 14% -> 17% on the very run that fixed Inspiring Leader.

Usage: FEAT_BUNDLE=<bundled feats.mjs> python tools/audit/featpdf.py [book] [--full]
"""
import json
import math
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


def locate(book, raw, idx, names, keys, want_words=None, chapter=None, weight=None):
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

    want, weight = want_words or set(), weight or {}
    # Where the heading actually appears, so a window can be rewarded for sitting under it.
    # "Boon of Truesight" reduces to ONE identity word once its filing category is stripped, so
    # every window in the chapter holding "truesight" tied and the FIRST one won on position
    # alone — 99,000 characters from the real entry. The heading is not always adjacent, so this
    # is a tie-break and not a filter, and it stays independent of the mechanics under test.
    heads = []
    for n in names:
        start = 0
        while True:
            i = book.find(n, start)
            if i < 0:
                break
            heads.append(i)
            start = i + 1

    best, best_score = None, (-1, -1)
    for i in sorted(set(cands)):
        seg = raw[idx[i]: idx[min(len(idx) - 1, i + 1300)]]
        # Weighted by rarity, not counted flat. "blindsight" identifies one feat; "creature"
        # identifies nothing, and a window dense with common words was outscoring the right entry.
        score = 3 * sum(weight.get(w, 1.0) for w in want & content_words(seg))
        # A strict TIE-BREAK, not a bonus. Added to the score it was worth more than a rare-word
        # match and dragged windows onto headings even in the books where headings and bodies are
        # columns apart — it cleared Athlete and two Boons while regressing Blind Fighting.
        near = 1 if any(i - 900 <= h <= i + 600 for h in heads) else 0
        score = (score, near)
        # The sibling tie-break exists to prefer the feats chapter over a passing mention. Inside
        # a known chapter it is both redundant and quadratic — 74 names re-scanned for each of ~560
        # windows, for each of 155 feats, which ran past ten minutes.
        if not chapter:
            score += sum(1 for k in keys if 0 <= book.find(k, max(0, i - 200)) < i + SPAN)
        if score > best_score:
            best, best_score = i, score
    return best


def heading_positions(book, names):
    """Every occurrence of the feat's name, entry-like or not — used to widen the check, not to
    choose a window, so an index line is harmless here."""
    out = []
    for n in names:
        start = 0
        while True:
            i = book.find(n, start)
            if i < 0:
                break
            out.append(i)
            start = i + 1
    return out


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
    # The DENSEST fixed-width window, found by sliding. An earlier version demanded that a window
    # hold half of all entry-like name occurrences; feat names are quoted all over a rulebook —
    # backgrounds grant them, class features reference them — so that threshold was never met on
    # the 2024 PHB and it fell through to (first, last): an 807,000-character "chapter", i.e. most
    # of the book. Taking the maximum instead always returns the real region.
    width = 130_000
    best_a, best_n, j = at[0], 0, 0
    for i, a in enumerate(at):
        while j < len(at) and at[j] < a + width:
            j += 1
        if j - i > best_n:
            best_a, best_n = a, j - i
    return (max(0, best_a - 3000), best_a + width)


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

    stats, findings, notes, chapters, weights = {}, [], [], {}, {}
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
            # One tokenisation per book gives every identity word a rarity weight. Calling
            # book.count() per word instead is 3,000 full scans of a megabyte.
            from collections import Counter
            c = Counter(re.findall(r'[a-z]{4,}', raw.lower()))
            weights[f['book']] = {w: 1.0 / (1.0 + math.log(1 + n)) for w, n in c.items()}

        keys = [k for k in siblings[f['book']] if k and k != flat(f['name'])]
        names = [flat(v) for v in trait_variants(f['name']) if flat(v)]
        pos = locate(book, raw, idx, names, keys, content_words(f['d']),
                     chapters[f['book']], weights[f['book']])
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
        # Report only what is missing from EVERY plausible place this feat could be printed.
        #
        # The locator is good but not perfect, and it cannot be made perfect against a text whose
        # headings and bodies come from different columns. Chasing that produced a scoring
        # tug-of-war: a heading bonus strong enough to fix Athlete and two Boons regressed Blind
        # Fighting, and the strict tie-break traded them straight back. So the uncertainty is
        # absorbed here instead — a token still counts as present if it sits near ANY occurrence of
        # the feat's name or near the best identity match.
        #
        # This deliberately trades false NEGATIVES for false positives. An audit's job is to hand a
        # human a list worth reading; a survivor here means the book does not state the mechanic
        # anywhere near the feat, which is a claim worth checking by hand.
        spots = [pos] + [h for h in heading_positions(book, names)]
        have = set()
        for s in spots[:12]:
            a = max(0, s - 700)
            b = min(len(idx) - 1, s + max(len(flat(f['d'])) * 2, 1400))
            have |= mech_tokens(raw[idx[a]: idx[b]], source=True)
        gap = sorted(t for t in want if t not in have)
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
