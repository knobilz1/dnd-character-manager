"""Race trait text vs the source books, straight from the PDFs.

⚠️ STATUS (2026-08-01): the LOCATOR works — 95 of 122 races pair, and the per-book table is
honest. The COMPARISON layer is not yet trustworthy: it still reports things like "High Elf
Darkvision — app states 60ft" when the PHB plainly says 60 feet. Do not action its findings
without reading the trait in the book first. What is left is written up at the bottom.

Why this is harder than it looks, and worth recording:

1. The md extracts are SUMMARIES. A word-level diff against them is noise end to end, so anything
   about WORDING has to come from the PDFs. (Cost a whole sweep to learn.)
2. The app's race descriptions are deliberate PARAPHRASE, not quotation. Firbolg Magic says
   "Once per short or long rest each" where the book takes a sentence. So a verbatim diff is also
   noise — 261 findings, none real. What cannot differ without being wrong is the mechanical
   vocabulary: numbers, rest type, ability, damage type, action cost. That is what MECH matches.
3. The OCR text layer must be searched FLAT (no spaces: "60feet") but compared RAW ("60 feet"),
   because a regex needing word boundaries can never match the flattened form. Keep the
   normalised→raw index map; `r6verify._flatten` already provides it.

GATED ON PAIRING: the matched/total table prints before any finding, because "0 mismatches" over
3% pairing is a failure this audit has already hit once.

KNOWN REMAINING WORK:
- A SUBRACE's window is anchored on the subrace heading, so traits printed once under the PARENT
  (elf Darkvision, dwarf Resilience) fall outside it. Needs parent+subrace spans unioned, not the
  best-scoring one of the two. This is the cause of most of the 65 mechanics findings.
- 27 races do not locate: the 9 MMoM legacy tieflings and 4 SCAG tiefling variants are printed as
  one entry with a table of options; the 6 SJA races come from an AnyFlip capture whose text does
  not survive extraction at all (0 traits found — expected, and matches the spell sweep).

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


def race_region(book, r, by_id, span=9000):
    """The slice of the book that is THIS race's entry.

    Scored, not first-hit: every occurrence of the race's name gets a window, and the window
    containing the most of that race's own trait names wins. A table of contents mention scores 0
    and loses to the real entry; two similarly-named races (Tiefling / Tiefling (Zariel)) separate
    because their trait sets differ.

    A subrace also searches under its PARENT's name, since the books print "Elf" once and then the
    subrace beneath it.
    """
    names = [flat(r['name'])]
    # Drop a parenthetical — "Tiefling (Zariel)" is printed as "Zariel Tiefling" or just "Zariel".
    bare = flat(re.sub(r'\(.*?\)', '', r['name']))
    if bare and bare not in names:
        names.append(bare)
    inner = re.findall(r'\((.*?)\)', r['name'])
    names += [flat(x) for x in inner if flat(x)]
    parent = by_id.get(r['parent']) if r.get('parent') else None
    if parent:
        names.append(flat(parent['name']))
    keys = [flat(t['name']) for t in r['traits'] if flat(t['name'])]

    best, best_score = None, 0
    for nm in names:
        if len(nm) < 4:
            continue
        start = 0
        while True:
            i = book.find(nm, start)
            if i < 0:
                break
            start = i + 1
            lo = max(0, i - 200)
            win = book[lo: i + span]
            score = sum(1 for k in keys if k in win)
            if score > best_score:
                best, best_score = (win, lo), score
    # One trait in a 9k window is noise (an index line, a stray mention); two is an entry. But a
    # race with only ONE trait in the app — PHB Human has exactly one, "Extra Language" — can never
    # reach two, and a flat threshold silently dropped it as "not located". Require whichever is
    # smaller, so a thin race is judged by what it actually has.
    need = min(2, len(keys)) or 1
    return best if best_score >= need else None


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
        located = race_region(book, r, by_id)
        if located is None:
            unpaired += 1
            findings.append(('RACE NOT LOCATED', r['name'], r['book'], '', '', ''))
            continue
        region, region_lo = located

        hits = 0
        for t in r['traits']:
            st['traits'] += 1
            key = flat(t['name'])
            if not key:
                continue
            pos = region.find(key)
            if pos < 0:
                findings.append(('TRAIT NAME NOT IN ENTRY', r['name'], r['book'], t['name'], '', ''))
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
            fs = region_lo + pos
            fe = min(len(raw_idx) - 1, fs + len(key) + max(len(app) * 3, 900))
            src = raw_book[raw_idx[fs]: raw_idx[fe]]
            missing = [tok for tok in mech_tokens(t['d']) if tok not in mech_tokens(src)]
            if missing:
                findings.append(('MECHANICS NOT IN SOURCE', r['name'], r['book'], t['name'],
                                 t['d'], 'app states ' + ', '.join(sorted(set(missing)))))
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
