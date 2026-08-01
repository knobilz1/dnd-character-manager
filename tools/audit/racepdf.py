"""Race trait text vs the source books, straight from the PDFs.

STATUS (2026-08-01): working. **120 of 122 races pair.** PHB is the control and is clean:
15/15 races, 67/67 trait names, one finding — and that one is the app being MORE current than the
source (see errata below). From 306 findings when the sweep was first stood up.

Why this is harder than it looks, all of it learned by getting it wrong first:

1. The md extracts are SUMMARIES. A word-level diff against them is noise end to end, so anything
   about WORDING has to come from the PDFs.
2. The app's race descriptions are deliberate PARAPHRASE, not quotation. Firbolg Magic says
   "Once per short or long rest each" where the book takes a sentence. So a verbatim diff is also
   noise — 261 findings, none real. What cannot differ without being wrong is the mechanical
   vocabulary: numbers, rest type, ability, damage type, action cost. That is what MECH matches.
3. The OCR layer must be SEARCHED flat ("60feet") but COMPARED raw ("60 feet"), or a
   word-boundary regex matches nothing. `r6verify._flatten` provides the index map.
4. The BACK-OF-BOOK INDEX out-scores the real entry if you rank windows by "how many trait names
   are nearby" — an index crams them into a few hundred characters. Discriminated by what FOLLOWS
   the name: a page number means index, prose means entry. This alone took PHB from 17 findings
   to 1.
5. `parentRaceId` is DANGLING in this data. The app flattens the base races away — there is no
   race with id 'elf', only 'elf-high' and friends carrying the merged trait list — so looking the
   parent up returns None for all four PHB base races. The id string is used as a name instead.
6. The PDFs are PRE-ERRATA printings. The one PHB finding is Tiefling Infernal Legacy: the book
   says "once per day", the app says "regain when you finish a long rest", which is WotC's
   corrected text. A finding here means the two differ, NOT that the app is wrong — read the trait
   before changing anything.

GATED ON PAIRING: the matched/total table prints before any finding, because "0 mismatches" over
3% pairing is a failure this audit has already hit once.

7. A 2014 VARIANT is printed as trait REPLACEMENTS, not as a race. SCAG's Feral tiefling is one
   line — "This trait replaces the Ability Score Increase trait" — while the app models it as a
   full race carrying the base tiefling's Darkvision, Hellish Resistance and Infernal Legacy, all
   of which are printed in the PHB. A race its own book cannot account for is retried against the
   PHB, and the finding says which book verified it. This took MMoM 21→30 and SCAG 6→10.

STILL UNPAIRED (2), and BOTH are findings about the app's data rather than about this tool:
- **Leonin (MMoM)**. It appears in no book on disk, including MMoM itself, whose other 30 races
  all pair. Leonin is a Mythic Odysseys of Theros race and MMoM did not reprint it, so
  `sourceBook: 'MMoM'` looks wrong — a player enabling MMoM is offered a race that book has never
  contained. MOoT is not a BookId in the app at all.
- **Giff (SJA)**. The published giff has Creature Type, Size, Astral Spark, Firearms Mastery and
  Hippo Build. The app has Ability Score Increase, Damage Dealer, Firearms Expert, Hippogriff
  Build, Percussive Repair and Swim Speed — not one mechanical trait name matches, and 2022 races
  do not grant a fixed Ability Score Increase at all. This looks like a playtest or invented
  version rather than the book's.

Usage: python tools/audit/racepdf.py [BookId] [--full]
"""
import json
import os
import re
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
import r6verify as V  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BOOK_PDF = {
    'PHB': 'Players Handbook.pdf',
    'PHB2024': 'PlayersHandbook2024.pdf',
    'MMoM': 'mordenkainen-presents-monsters-of-the-multiverse.pdf',
    'VGM': "D&D 5E - Volo's Guide to Monsters.pdf",
    'ERLW': 'D&D 5e - Eberron - Rising from the Last War.pdf',
    'SCAG': "D&D 5E - Sword Coast Adventurer's Guide.pdf",
    'EGtW': "Explorer's Guide To Wildemount.pdf",
    'FToD': 'fizban-tresury-of-dragons.pdf',
    'GGR': 'Guildmasters guide to Ravnica.pdf',
    'SCoC': 'Strixhaven- A Curriculum of Chaos.pdf',
    'MToF': "dampd-5e-mordenkainenx27s-tome-of-foes_compress.pdf",
    'SJA': 'Spelljammer - Adventures in Space - Bob Flip PDF _ AnyFlip.pdf',
    'AcqInc': 'Acquisitions Incorporated.pdf',
}

LETTERS = re.compile(r'[^a-z0-9]+')


def flat(s):
    """Letters and digits only. Survives OCR hyphenation, line breaks and dropped page furniture."""
    return LETTERS.sub('', (s or '').lower())


MECH = re.compile(
    r'\b\d+d\d+\b'                                   # dice
    r'|\b\d+\s*(?:feet|foot|ft)\b'                   # distances
    r'|\bdc\s*\d+\b'                                 # fixed DCs
    r'|\b(?:short|long)\s+rest\b'
    r'|\b(?:acid|cold|fire|force|lightning|necrotic|poison|psychic|radiant|thunder)\s+damage\b'
    r'|\b(?:strength|dexterity|constitution|intelligence|wisdom|charisma)\b'
    r'|\b(?:bonus\s+action|reaction|advantage|disadvantage|resistance|immunity)\b'
    r'|\b(?:proficiency\s+bonus)\b',
    re.I)


def mech_tokens(s):
    """The mechanical vocabulary of a trait, normalised.

    Prose can be rewritten freely; these cannot. "60 feet" and "6 0 f e e t" collapse the same way,
    and "ft"/"feet"/"foot" unify, so OCR spacing and the app's house style don't register as
    differences. Ability names are included because a trait that says Wisdom where the book says
    Charisma is a live bug and reads identically to a paraphrase otherwise.
    """
    out = set()
    for m in MECH.finditer(re.sub(r'\s+', ' ', s or '')):
        tok = m.group(0).lower()
        tok = re.sub(r'\s+', '', tok)
        tok = tok.replace('foot', 'ft').replace('feet', 'ft')
        out.add(tok)
    return out


def _is_entry(raw, raw_idx, p, klen):
    """Is the trait name at flat position `p` an ENTRY, or an index line?

    An index reads "Dwarven Resilience 20"; an entry reads "Dwarven Resilience. You have advantage
    on saving throws against poison…". Without this the PHB's back-of-book index beat the real
    dwarf entry outright — the index crams every trait name into a few hundred characters, so it
    scored higher on "how many trait names are nearby" than the pages that actually define them.
    """
    j = raw_idx[min(p + klen, len(raw_idx) - 1)]
    tail = raw[j:j + 40]
    return not re.match(r'^[\s.,·—-]*\d', tail)


def _best_window(book, names, keys, span, raw=None, raw_idx=None):
    """(lo, hi) of the best-scoring window for these names, scored by how many of `keys` it holds.

    Scored, not first-hit: a contents-page mention scores 0 and loses to the real entry, and two
    similarly-named races separate because their trait sets differ. Trait names that read as index
    lines rather than definitions score nothing — see `_is_entry`.
    """
    best, best_score = None, 0
    for nm in names:
        # 3, not 4: "Elf" is three characters, and the guard silently excluded it — so no elf
        # subrace ever got its parent's span and every one was judged against whichever elf
        # variant happened to fall inside its own window. Short names are safe here precisely
        # because the windows are SCORED: a stray "elf" inside "himself" holds none of the race's
        # traits, scores 0, and loses to the real entry.
        if len(nm) < 3:
            continue
        start = 0
        while True:
            i = book.find(nm, start)
            if i < 0:
                break
            start = i + 1
            lo, hi = max(0, i - 200), i + span
            score = 0
            for k in keys:
                q = book.find(k, lo)
                while 0 <= q < hi:
                    if raw is None or _is_entry(raw, raw_idx, q, len(k)):
                        score += 1
                        break
                    q = book.find(k, q + 1)
            if score > best_score:
                best, best_score = (lo, hi), score
    return best


# Words that describe how the app FILES a race rather than what the book calls it. "Tiefling
# (Feral Variant)" is headed simply "Feral" in SCAG.
FILLER = {'variant', 'variants', 'heritage', 'subrace', 'of', 'the', 'a', 'an'}


def name_variants(name):
    """Every form a book might head this race under, most specific first.

    "Tiefling (Zariel)" → tiefling(zariel), tiefling, zariel. "Draconblood Dragonborn" →
    draconblooddragonborn, draconblood, dragonborn — EGtW heads it "Draconblood" alone, so without
    the individual words it never paired despite appearing 25 times.

    Emitting extra candidates is safe because `_best_window` SCORES them: a form the book doesn't
    use finds nothing, holds none of the race's traits, and loses to one that does.
    """
    out = [flat(name)]
    bare = flat(re.sub(r'\(.*?\)', '', name))
    if bare and bare not in out:
        out.append(bare)
    out += [flat(x) for x in re.findall(r'\((.*?)\)', name) if flat(x)]
    # Individual significant words, so a race the book heads by its distinctive half is reachable.
    for w in re.split(r'[^A-Za-z]+', name):
        if len(w) >= 3 and w.lower() not in FILLER and flat(w) not in out:
            out.append(flat(w))
    return out


def race_spans(book, r, by_id, span=9000, raw=None, raw_idx=None):
    """Every slice of the book that holds part of this race's traits — a LIST, not one window.

    A subrace's traits are printed in two places: the ones it inherits sit once under the parent
    ("Elf. … Darkvision. … 60 feet"), and only its own sit under its heading. Taking whichever
    single window scored higher meant the inherited half fell outside the region entirely, which is
    why every elf and dwarf was reported as missing the 60 ft on its own Darkvision.

    Returns both spans and searches them in turn, so a trait is found wherever the book prints it.
    """
    keys = [flat(t['name']) for t in r['traits'] if flat(t['name'])]
    spans = []
    own = _best_window(book, name_variants(r['name']), keys, span, raw, raw_idx)
    if own:
        spans.append(own)
    # NOTE: `parentRaceId` is a DANGLING reference in this data — the app flattens the base races
    # away, so there is no race with id 'elf', only 'elf-high' and friends, each carrying the
    # merged trait list. Looking the parent up returns None for all four PHB base races, which is
    # why an earlier version of this guard never fired. The id string itself ('elf', 'dwarf',
    # 'gnome', 'halfling') is exactly the book's heading word, so it is used directly as a name.
    parent = r.get('parent')
    if parent and own:
        # The parent's shared traits are printed IMMEDIATELY BEFORE the subrace heading — the PHB
        # elf's Fey Ancestry and Trance sit at 60225, and High Elf's heading at 60952 — so the
        # subrace's own forward window misses them by a few hundred characters.
        #
        # Extending backward rather than searching for the parent by name, because the name is
        # unreliable in exactly this case: "elf" is a substring of "highelf", so a name search
        # re-finds the subrace's own window and adds nothing. Position is the dependable signal,
        # the layout is consistent across every book here, and a too-generous back-span costs only
        # a wider search — the candidate resolution below still picks the occurrence that matches.
        spans.insert(0, (max(0, own[0] - span), own[0] + 200))
    if parent and not own:
        p = _best_window(book, [flat(parent)], keys, span, raw, raw_idx)
        if p:
            spans.append(p)
    if not spans:
        return None
    # Judge on what the spans cover TOGETHER. One trait in a 9k window is noise (an index line);
    # two is an entry. But a race with only ONE trait — PHB Human has exactly one, "Extra
    # Language" — can never reach two, so require whichever is smaller.
    covered = sum(1 for k in set(keys) if any(k in book[lo:hi] for lo, hi in spans))
    need = min(2, len(keys)) or 1
    return spans if covered >= need else None


def races():
    """The app's real race data, via the bundler — parsing the TS is how five parser bugs got in."""
    scratch = os.environ.get('RACE_BUNDLE')
    if not scratch:
        sys.exit('set RACE_BUNDLE to a bundled races.mjs path')
    out = subprocess.run(
        ['node', '-e',
         'const m=await import(process.argv[1]);'
         'const f=[];const w=r=>{f.push({id:r.id,name:r.name,book:r.sourceBook,'
         'parent:r.parentRaceId??null,traits:(r.traits??[]).map(t=>({name:t.name,d:t.description}))});'
         '(r.subraces??[]).forEach(w)};m.ALL_RACES.forEach(w);console.log(JSON.stringify(f));',
         scratch],
        capture_output=True, text=True, encoding='utf-8')
    if out.returncode:
        sys.exit(out.stderr[:800])
    return json.loads(out.stdout)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    full = '--full' in sys.argv
    only = args[0] if args else None

    all_races = races()
    by_id = {r['id']: r for r in all_races}
    stats, findings = {}, []
    paired = unpaired = nobook = 0

    for r in all_races:
        if only and r['book'] != only:
            continue
        st = stats.setdefault(r['book'], {'paired': 0, 'total': 0, 'nobook': 0, 'traits': 0, 'found': 0})
        st['total'] += 1
        pdf = BOOK_PDF.get(r['book'])
        if not pdf or not os.path.exists(os.path.join(V.REF, pdf)):
            st['nobook'] += 1
            nobook += 1
            continue
        try:
            raw_book = V.book_text(pdf)
            book, raw_idx = V._flatten(raw_book)
        except Exception as e:                      # noqa: BLE001
            st['nobook'] += 1
            nobook += 1
            findings.append(('EXTRACT FAILED', r['name'], r['book'], str(e)[:80], '', ''))
            continue

        # ANCHOR ON THE RACE ENTRY, not on the trait name. "Ability Score Increase", "Darkvision"
        # and "Size" appear once per race — dozens of times per book — so a whole-book find() for
        # a trait name lands on whichever race happens to come first and then confidently diffs
        # the app against a different species. That produced 261 bogus "diverges after 0 chars".
        # Every occurrence of the race name is scored by how many of ITS traits appear nearby, and
        # the best-scoring window is the entry.
        spans = race_spans(book, r, by_id, raw=raw_book, raw_idx=raw_idx)
        via = None
        if spans is None and r['book'] != 'PHB':
            # A 2014 VARIANT is printed as a set of trait REPLACEMENTS, not as a whole race:
            # SCAG's Feral tiefling is one line saying "This trait replaces the Ability Score
            # Increase trait". The app models it as a full race carrying the base tiefling's
            # Darkvision, Hellish Resistance and Infernal Legacy — all of which are printed in the
            # PHB. So a race its own book cannot account for is retried against the base book, and
            # the finding says which book actually verified it.
            praw = V.book_text(BOOK_PDF['PHB'])
            pbook, pidx = V._flatten(praw)
            pspans = race_spans(pbook, r, by_id, raw=praw, raw_idx=pidx)
            if pspans is not None:
                spans, book, raw_book, raw_idx, via = pspans, pbook, praw, pidx, 'PHB'
        if spans is None:
            unpaired += 1
            findings.append(('RACE NOT LOCATED', r['name'], r['book'], '', '', ''))
            continue

        hits = 0
        for t in r['traits']:
            st['traits'] += 1
            key = flat(t['name'])
            if not key:
                continue
            # Collect EVERY occurrence of the trait name across the spans, not the first.
            # "Darkvision" appears under each elf subrace, so the first hit inside High Elf's
            # window is the DROW's 120-foot version — and the app was then reported as wrong for
            # saying 60 ft. Which occurrence is "this trait" is decided below, by the text.
            cands = []
            for lo, hi in spans:
                p = book.find(key, lo)
                while 0 <= p < hi:
                    cands.append(p)
                    p = book.find(key, p + 1)
            if not cands:
                findings.append(('TRAIT NAME NOT IN ENTRY', r['name'], r['book'], t['name'], '',
                                 f'checked against {via}' if via else ''))
                continue
            hits += 1
            st['found'] += 1
            app = flat(t['d'])
            if not app:
                continue
            # NOT a prose diff. The app's race descriptions are deliberate paraphrase — Firbolg
            # Magic says "Once per short or long rest each" where the book takes a sentence to say
            # the same thing — so a word-level comparison flags a few hundred non-bugs and buries
            # the real ones. What CANNOT differ without being wrong is the mechanical vocabulary:
            # the numbers, the rest type, the ability, the damage type, the action cost.
            # Map back to the RAW text before comparing. The flattened index has no spaces, so
            # a regex needing word boundaries ("60 feet") can never match "60feet" — the exact
            # trap the reference-books note records, and the reason an earlier run of this sweep
            # reported every Darkvision in the book as missing its own 60 ft.
            # The occurrence that best matches IS this trait. Reporting the first one instead is
            # how a race got blamed for its sibling's numbers; a finding only survives if NO
            # occurrence of the name inside the race's entry states what the app states.
            want = mech_tokens(t['d'])
            missing = None
            for pos in cands:
                fe = min(len(raw_idx) - 1, pos + len(key) + max(len(app) * 3, 900))
                src = raw_book[raw_idx[pos]: raw_idx[fe]]
                gap = [tok for tok in want if tok not in mech_tokens(src)]
                if missing is None or len(gap) < len(missing):
                    missing = gap
                if not missing:
                    break
            if missing:
                findings.append(('MECHANICS NOT IN SOURCE', r['name'], r['book'], t['name'],
                                 t['d'], 'app states ' + ', '.join(sorted(set(missing)))
                                 + (f' [checked against {via}]' if via else '')))
        if hits:
            paired += 1
            st['paired'] += 1
        else:
            unpaired += 1
            findings.append(('NO TRAIT FOUND', r['name'], r['book'], '', '', ''))

    considered = paired + unpaired + nobook
    print(f'# {considered} races considered\n')
    print('| book | paired | total | no PDF | traits | trait names found |')
    print('|---|---|---|---|---|---|')
    for b, s in sorted(stats.items()):
        thin = '  ⚠ THIN' if s['nobook'] == 0 and s['total'] and s['paired'] / s['total'] < 0.8 else ''
        print(f"| {b} | {s['paired']} | {s['total']} | {s['nobook']} | {s['traits']} | {s['found']} |{thin}")
    print(f'\npaired {paired} + unpaired {unpaired} + no-PDF {nobook} = {considered}')
    if paired == 0:
        sys.exit('\nNOTHING PAIRED — any findings below would be meaningless.')

    kinds = {}
    for f in findings:
        kinds.setdefault(f[0], []).append(f)
    for kind, lst in kinds.items():
        print(f'\n## {kind} ({len(lst)})')
        for k, name, book, trait, app, note in (lst if full else lst[:25]):
            print(f'- **{name}** [{book}]' + (f' — {trait}' if trait else '') + (f'  ({note})' if note else ''))
        if not full and len(lst) > 25:
            print(f'  … {len(lst) - 25} more (pass --full)')
    print(f'\n{len(findings)} findings over {paired} paired races')


if __name__ == '__main__':
    main()
