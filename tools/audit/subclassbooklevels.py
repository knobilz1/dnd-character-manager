"""Phase B: diff every subclass feature's LEVEL against the rulebook markdown.

The brief said this layer "cannot be swept" and needed 97 hand comparisons. That was wrong:
reference-books/md carries the levels in a regular shape. It just carries them in FOUR different
container shapes and TWO different feature-line shapes, which is presumably why it looked unswept.

Containers, all four of which appear in phb-players-handbook.md alone:
    ### Path of the Berserker (p.49)          barbarian/bard/druid/fighter/monk
    #### Knowledge Domain (p.59)              cleric domains
    **Sacred Oath — Oath of Devotion (PHB 85):**   paladin/ranger/rogue/sorcerer/warlock
    **School of Evocation (PHB 117):**        wizard

Feature lines:
    - **Improved Critical (3rd).**            most classes
    - **7th — Aura of Devotion:**             paladin, and scattered elsewhere

DRIVEN FROM THE DATA SIDE, deliberately. Enumerating book headings and guessing which ones are
subclasses is how a sweep silently skips the ones whose heading it did not recognise; instead every
subclass in the codebase is looked up by name and anything not found is REPORTED, not dropped.
That accounting assert is the whole point — five artifacts in this audit were caught only by one.
"""
import re, sys, io, os, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

REPO = r'C:\Users\nabil\Desktop\Code\dnd-character-manager'
BOOKS = r'C:\Users\nabil\Desktop\Code\reference-books\md'

BOOK_FILES = {
    'PHB': 'phb-players-handbook.md',
    'XGtE': 'xge-xanathars-guide.md',
    'TCE': 'tce-tashas-cauldron.md',
    'SCAG': 'scag-sword-coast-adventurers-guide.md',
    'ERLW': 'erlw-eberron-rising-last-war.md',
    'EGtW': 'egtw-explorers-guide-wildemount.md',
    'FToD': 'ftod-fizbans-treasury-of-dragons.md',
    'GGR': 'ggr-guildmasters-guide-ravnica.md',
    'MToF': 'mtof-mordenkainens-tome-of-foes.md',
    'SCoC': 'scoc-strixhaven-curriculum-of-chaos.md',
    'ToB': 'tob-tides-of-blood.md',
    'PHB2024': 'phb2024-players-handbook.md',
}

ORD = r'(?:st|nd|rd|th)'

# The book calls these something other than what the app calls them, so the LEVEL comparison cannot
# reach them by name alone. Every entry was confirmed by reading the book section, not guessed.
#
# The PHB2024 block is itself a finding, logged separately: the 2024 book RENAMED thirteen
# subclasses and the app kept the 2014 display name for each. The app's ids already carry the new
# names ('abjurer-2024', 'archfey-patron-2024'), so only the user-visible `name` is stale.
BOOK_ALIASES = {
    'aberrant-mind-2024': 'Aberrant Sorcery',
    'clockwork-soul-2024': 'Clockwork Sorcery',
    'draconic-bloodline-2024': 'Draconic Sorcery',
    'wild-magic-2024': 'Wild Magic Sorcery',
    'circle-of-stars-2024': 'Circle of the Stars',
    'archfey-patron-2024': 'Archfey Patron',
    'celestial-patron-2024': 'Celestial Patron',
    'fiend-patron-2024': 'Fiend Patron',
    'great-old-one-2024': 'Great Old One Patron',
    'abjurer-2024': 'Abjurer',
    'diviner-2024': 'Diviner',
    'evoker-2024': 'Evoker',
    'illusionist-2024': 'Illusionist',
    # SCAG names the section after the class, and qualifies two of them differently to the app.
    'scag-totem-warrior-elk-tiger': 'Path of the Totem Warrior',
    'scag-purple-dragon-knight': 'Purple Dragon Knight',
}

# SCAG prints these two as "Also reprinted in XGtE. Identical mechanics" and carries no feature text,
# so there is nothing in SCAG to diff against. They are checked against the app's own XGtE copy
# instead — if the two app entries disagree, one of them is wrong whatever the book says.
SCAG_REPRINTS = {'scag-mastermind': 'mastermind', 'scag-swashbuckler': 'swashbuckler'}


# ---------------------------------------------------------------- data side

def read_object(s, i):
    """Return (text, end) for the {...} object starting at s[i] == '{'. Brace-matching, not regex.

    classfeatures.py originally used a regex with a fixed field order and silently captured 363 of
    494 features because isASI/featOnly sit between the fields it wanted. Never again.
    """
    assert s[i] == '{'
    depth, j, in_str, esc = 0, i, None, False
    while j < len(s):
        c = s[j]
        if in_str:
            if esc:
                esc = False
            elif c == '\\':
                esc = True
            elif c == in_str:
                in_str = None
        elif c in '\'"`':
            in_str = c
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return s[i:j + 1], j + 1
        j += 1
    raise AssertionError('unterminated object at %d' % i)


def parse_subclasses():
    """Every subclass in the codebase: id, name, classId, sourceBook, [(feature, level)]."""
    out = []
    for path in (os.path.join(REPO, 'src/data/subclasses/index.ts'),
                 os.path.join(REPO, 'src/data/subclasses/phb2024.ts')):
        s = open(path, encoding='utf-8').read()
        for m in re.finditer(r"\{ id: '", s):
            obj, _ = read_object(s, m.start())
            sid = re.search(r"id: '([^']+)'", obj).group(1)
            name = re.search(r"name: '((?:[^'\\]|\\.)*)'", obj)
            book = re.search(r"sourceBook: '([^']+)'", obj)
            cls = re.search(r"classId: '([^']+)'", obj)
            if not (name and book and cls):
                continue                      # not a subclass object (nested feature etc.)
            feats = []
            fm = re.search(r'features: \[', obj)
            if fm:
                k = obj.index('[', fm.start())
                depth, j = 0, k
                while j < len(obj):           # find the matching ] to bound the features array
                    if obj[j] == '[':
                        depth += 1
                    elif obj[j] == ']':
                        depth -= 1
                        if depth == 0:
                            break
                    j += 1
                arr = obj[k:j + 1]
                for f in re.finditer(r"\{ name: '((?:[^'\\]|\\.)*)', level: (\d+)", arr):
                    feats.append((f.group(1).replace("\\'", "'"), int(f.group(2))))
            out.append(dict(id=sid, name=name.group(1).replace("\\'", "'"),
                            classId=cls.group(1), book=book.group(1),
                            hidden="hidden: true" in obj, features=feats))
    return out


# ---------------------------------------------------------------- book side

def container_match(text, name):
    """Where a subclass's own container line sits, or None. Four shapes; see the module docstring.

    The bold shapes bury the identity name after an em dash ("Sacred Oath — Oath of Devotion"),
    so the name is matched as a suffix of the line, not as the whole line.
    """
    esc = re.escape(name)
    # A heading may prefix the identity name with a class ("Fighter: Echo Knight", "Artificer
    # Specialist: Armorer") and may end it with a page ref, an em dash or nothing at all. ToB spells
    # its headings in caps ("### CORSAIR (Fighter)"), hence IGNORECASE throughout.
    for pat, shape in (
        (r'^#{3,4}\s+(?:[^\n]*?:\s*)?%s\s*(?:\(|—|–|-\s|$)' % esc, 'heading'),
        (r'^\*\*(?:[^*]*?—\s*)?%s\s*\((?:p\.|PHB |XGE |TCE |[A-Z]{2,5} )' % esc, 'bold'),
        (r'^\*\*(?:[^*]*?—\s*)?%s\s*:?\*\*' % esc, 'bold-nopage'),
    ):
        m = re.search(pat, text, re.M | re.I)
        if m:
            return m, shape
    return None, None


def find_block(text, name, siblings=()):
    """Body of a subclass's section, bounded by the NEXT REAL CONTAINER — not by any bold line.

    The first version ended the block at the next line that merely looked like a container, and
    Eldritch Knight's section contains "**Eldritch Knight Spellcasting table (p.75):**" before its
    features. Its body was cut to zero feature lines, which the sweep would happily have called
    "clean" if that subclass had matched on anything at all. Any interior bold caption did this.

    So the bound is computed from the actual sibling subclass names in the same book, plus real
    markdown structure (## / ### / #### headings and --- rules). A caption cannot be mistaken for
    a container because a caption is nobody's name.
    """
    m, shape = container_match(text, name)
    if not m:
        return None, None
    start = m.end()
    ends = [len(text)]
    nxt = re.search(r'^(?:#{2,4}\s|---\s*$)', text[start:], re.M)
    if nxt:
        ends.append(start + nxt.start())
    for sib in siblings:
        if sib == name:
            continue
        sm, _ = container_match(text, sib)
        if sm and sm.start() > start:
            ends.append(sm.start())
    return text[start:min(ends)], shape


def book_features(body, split=False):
    """Extract (name, level) from a subclass body. Four shapes across the twelve book files.

    PHB-style bullets:      - **Improved Critical (3rd).**
                            - **7th — Aura of Devotion:**
    XGtE/TCE-style:         | 3rd | Divine Fury, Warrior of the Gods |     (feature table)
                            **Divine Fury** (3rd): ...                     (prose heading)

    The XGtE/TCE books state each level TWICE — once in the table, once on the prose line. They are
    returned separately when split=True so the two can be checked against each other: if the book
    disagrees with itself about a subclass, any verdict about the app's data for that subclass is
    worthless, and the run should say so rather than pick a side.

    Indented sub-bullets ("  - *Bear.*", "- **Psi-Bolstered Knack**") are options WITHIN a feature,
    not features — including them would invent entries the data is right not to have.
    """
    bullets, table, prose = [], [], []
    for line in body.split('\n'):
        if line.startswith('- **'):
            m = re.match(r'- \*\*(.+?)\s*\((\d+)%s\)\.?\*\*' % ORD, line)
            if m:
                bullets.append((m.group(1).strip(), int(m.group(2))))
                continue
            # Level-first bullets. PHB writes "- **7th — Aura of Devotion:**"; PHB2024 writes
            # "- **Level 3 — Frenzy:**" — no ordinal suffix, and a "Level" prefix. Both here.
            m = re.match(r'- \*\*(?:Level\s+)?(\d+)%s?\s*[—–-]\s*(.+?)\s*:?\*\*' % ORD, line)
            if m:
                bullets.append((m.group(2).strip(), int(m.group(1))))
            continue
        m = re.match(r'\|\s*(\d+)%s\s*\|\s*(.+?)\s*\|\s*$' % ORD, line)
        if m:
            for nm in m.group(2).split(','):
                nm = nm.strip().strip('*')
                # A subclass block can also contain a PROGRESSION table (Sneak Attack dice, spell
                # slots). Those rows are shaped identically but their cells are numbers, dice or
                # dashes, never feature names — taking them would invent features out of nothing.
                if nm and not re.fullmatch(r'[\d\s+\-—–/dx×.]*', nm, re.I):
                    table.append((nm, int(m.group(1))))
            continue
        # Bold prose headings. Five spellings across the books, all naming one feature and one level:
        #   **Divine Fury** (3rd):              XGtE, TCE
        #   **Battlerager Armor** *(3rd level)* SCAG
        #   **Master of the Deep (20th level):** ToB
        #   **Level 3: Improved Critical.**     PHB2024
        for pat, gname, glvl in (
            (r'\*\*(.+?)\*\*\s*\*?\((\d+)%s(?: level)?\)' % ORD, 1, 2),
            (r'\*\*(.+?)\s*\((\d+)%s(?: level)?\)\s*:?\*\*' % ORD, 1, 2),
            (r'\*\*Level (\d+)%s?:\s*(.+?)\.?\*\*' % ORD, 2, 1),
        ):
            m = re.match(pat, line)
            if m:
                prose.append((m.group(gname).strip(), int(m.group(glvl))))
                break
    if split:
        return bullets, table, prose
    return bullets + table + prose


def norm(n):
    n = n.lower().replace('’', "'").strip()
    n = re.sub(r'^channel divinity:\s*', '', n)
    n = re.sub(r'\s*\(.*?\)\s*', ' ', n)
    return re.sub(r'[^a-z0-9]+', '', n)


# ---------------------------------------------------------------- controls

def controls(books, by_book):
    """Positive, negative, and shape controls. Any failure means the sweep is not trustworthy."""
    phb = books['PHB']

    # POSITIVE: Champion's five levels, read by eye off phb-players-handbook.md:620.
    body, shape = find_block(phb, 'Champion')
    got = dict((norm(n), l) for n, l in book_features(body or ''))
    want = {'improvedcritical': 3, 'remarkableathlete': 7, 'additionalfightingstyle': 10,
            'superiorcritical': 15, 'survivor': 18}
    assert got == want, 'POSITIVE CONTROL FAILED (### shape): %r' % got

    # POSITIVE, other container + other feature-line shape: Oath of Devotion is a **bold** container
    # whose features use "- **20th — Holy Nimbus:**". If only the ### / paren shapes worked, every
    # paladin, ranger, rogue, sorcerer, warlock and wizard subclass would read as zero features and
    # the sweep would look clean by finding nothing.
    body, shape = find_block(phb, 'Oath of Devotion')
    got = dict((norm(n), l) for n, l in book_features(body or ''))
    assert shape == 'bold', 'expected bold container for Oath of Devotion, got %r' % shape
    for k, v in {'channeldivinity': 3, 'auraofdevotion': 7, 'purityofspirit': 15,
                 'holynimbus': 20}.items():
        assert got.get(k) == v, 'POSITIVE CONTROL FAILED (bold shape): %s=%r' % (k, got.get(k))

    # POSITIVE, #### shape (cleric domains).
    body, _ = find_block(phb, 'Knowledge Domain')
    got = dict((norm(n), l) for n, l in book_features(body or ''))
    assert got.get('potentspellcasting') == 8 and got.get('visionsofthepast') == 17, \
        'POSITIVE CONTROL FAILED (#### shape): %r' % got

    # NEGATIVE: a subclass that is not in the PHB must not resolve against it. Storm Herald is XGtE.
    body, _ = find_block(phb, 'Path of the Storm Herald')
    assert body is None, 'NEGATIVE CONTROL FAILED: XGtE subclass found inside the PHB'

    # NEGATIVE: the differ must actually fire. Perturb a known-good level and confirm.
    perturbed = [('Improved Critical', 3), ('Remarkable Athlete', 8), ('Survivor', 18)]
    body, _ = find_block(phb, 'Champion')
    diffs = compare(perturbed, book_features(body))
    assert any(d[0] == 'LEVEL' for d in diffs), 'NEGATIVE CONTROL FAILED: differ ignored a bad level'

    # NEGATIVE: the block must END. If find_block ran to end-of-file the "diff" would be noise.
    body, _ = find_block(phb, 'Champion')
    assert 'Battle Master' not in body, 'block bleed: Champion body swallowed the next subclass'

    # REGRESSION, the bug this sweep actually found in itself: Eldritch Knight's section carries
    # "**Eldritch Knight Spellcasting table (p.75):**" ABOVE its feature list. The first version
    # ended the block there and read 0 features. A truncated block does not fail loudly — it just
    # stops disagreeing with the data, which is indistinguishable from being correct.
    body, _ = find_block(phb, 'Eldritch Knight', ['Champion', 'Battle Master'])
    got = dict((norm(n), l) for n, l in book_features(body or ''))
    assert got.get('improvedwarmagic') == 18 and len(got) == 5, \
        'REGRESSION CONTROL FAILED: interior bold caption truncated the block again: %r' % got

    # POSITIVE, the XGtE/TCE table + prose shapes. Read by eye off xge-xanathars-guide.md:101.
    # Without these, all 31 XGtE and 25 TCE subclasses parse as zero features — which the first run
    # of this sweep did, and which is silent unless something counts it.
    xge = books['XGtE']
    bullets, table, prose = find_block(xge, 'Path of the Zealot')[0], None, None
    bullets, table, prose = book_features(bullets, split=True)
    assert not bullets, 'unexpected bullet features in an XGtE subclass: %r' % bullets
    want = {'divinefury': 3, 'warriorofthegods': 3, 'fanaticalfocus': 6,
            'zealouspresence': 10, 'ragebeyonddeath': 14}
    assert dict((norm(n), l) for n, l in table) == want, 'TABLE SHAPE CONTROL FAILED: %r' % table
    assert dict((norm(n), l) for n, l in prose) == want, 'PROSE SHAPE CONTROL FAILED: %r' % prose

    # NEGATIVE for the table shape: a PROGRESSION table must not be read as subclass features.
    # Sneak Attack dice and spell-slot rows are shaped exactly like a feature row.
    junk = book_features('| 3rd | 2d6 |\n| 5th | +2 |\n| 7th | — |\n| 9th | Evasion |', split=True)[1]
    assert junk == [('Evasion', 9)], 'TABLE NEGATIVE CONTROL FAILED: %r' % junk

    # REGRESSION: a feature listed at several levels because it IMPROVES resolves to its first
    # grant, whichever order the rows are read in. Getting this wrong made the sweep's table reader
    # and prose reader disagree with each other and accuse 13 books of contradicting themselves.
    body, _ = find_block(xge, 'Path of the Ancestral Guardian', by_book.get('XGtE', ()))
    t, p = book_features(body, split=True)[1:]
    assert first_grant(t)['spiritshield'][1] == 6 and first_grant(p)['spiritshield'][1] == 6, \
        'IMPROVEMENT CONTROL FAILED: Spirit Shield is granted at 6th and improves at 10th and 14th'
    print('controls ok: 6 positive shapes, 5 negative, 2 regressions')


def first_grant(feats):
    """name -> (display name, LOWEST level it appears at).

    A feature can be listed more than once because it IMPROVES: the Ancestral Guardian table has
    "Spirit Shield (2d6)" at 6th, "(3d6)" at 10th and "(4d6)" at 14th, and norm() collapses all
    three. The level that means anything is the first grant, so take the minimum — deliberately not
    "whichever came first in the document", which made this sweep's own two readers disagree with
    each other and report 13 phantom conflicts in the books.
    """
    out = {}
    for n, l in feats:
        k = norm(n)
        if k not in out or l < out[k][1]:
            out[k] = (n, l)
    return out


def compare(data_feats, book_feats):
    """[(kind, name, data_level, book_level)] — LEVEL mismatch, or feature only on one side."""
    dmap, bmap = first_grant(data_feats), first_grant(book_feats)
    out = []
    for k, (n, l) in dmap.items():
        # Second chance for VARIANT names. The app splits a feature whose text offers a choice into
        # one entry per option ("Totem Spirit — Elk", "Totem Spirit — Tiger") where the book keeps a
        # single feature with sub-bullets. Retry on the part before the dash — but only as a
        # fallback, so the two variants stay separate entries and a wrong level on just one of them
        # is still visible. Collapsing them into one key would hide exactly that.
        hit = bmap.get(k)
        if hit is None and ' — ' in n:
            hit = bmap.get(norm(n.split(' — ')[0]))
        if hit is not None:
            if hit[1] != l:
                out.append(('LEVEL', n, l, hit[1]))
        else:
            out.append(('DATA-ONLY', n, l, None))
    for k, (n, l) in bmap.items():
        if k not in dmap:
            out.append(('BOOK-ONLY', n, None, l))
    return out


def main():
    books = {}
    for b, f in BOOK_FILES.items():
        p = os.path.join(BOOKS, f)
        if os.path.exists(p):
            books[b] = open(p, encoding='utf-8').read()
    subs = parse_subclasses()
    assert len(subs) >= 130, 'only parsed %d subclasses — parser artifact' % len(subs)
    by_book = {}
    for s in subs:
        by_book.setdefault(s['book'], []).append(BOOK_ALIASES.get(s['id'], s['name']))

    controls(books, by_book)
    print('parsed %d subclasses from the codebase' % len(subs))

    only = sys.argv[1] if len(sys.argv) > 1 else None

    matched, nobook, notfound, clean, dirty = 0, [], [], [], []
    findings, bookconflict, thin = [], [], []
    pairs, data_feats = 0, 0          # coverage: how many features actually met their book entry
    for s in subs:
        if only and s['book'] != only:
            continue
        if s['book'] not in books:
            nobook.append(s)
            continue
        lookup = BOOK_ALIASES.get(s['id'], s['name'])
        body, shape = find_block(books[s['book']], lookup, by_book[s['book']])
        if body is None:
            notfound.append(s)
            continue
        matched += 1
        bullets, tbl, prz = book_features(body, split=True)
        bf = bullets + tbl + prz
        if not bf:
            notfound.append(dict(s, note='block found but 0 feature lines parsed'))
            matched -= 1
            continue
        # Where the book states a level twice (XGtE/TCE), check it against ITSELF first. A book that
        # contradicts itself makes any verdict about the app's data for that subclass meaningless,
        # so it is reported rather than silently resolved in favour of whichever source is listed
        # first — which is what merging the two lists would quietly do.
        if tbl and prz:
            t, p = first_grant(tbl), first_grant(prz)
            for k in set(t) & set(p):
                if t[k][1] != p[k][1]:
                    bookconflict.append((s['id'], k, t[k][1], p[k][1]))
        diffs = compare(s['features'], bf)
        pairs += len(s['features']) - len([d for d in diffs if d[0] == 'DATA-ONLY'])
        data_feats += len(s['features'])
        # A GLOBAL coverage figure can sit at 94% while one subclass matched a stub block and
        # paired almost nothing — and a subclass that pairs nothing cannot produce a mismatch, so it
        # lands in the "clean" pile looking verified. Surface the thin ones individually.
        dpaired = len(s['features']) - len([d for d in diffs if d[0] == 'DATA-ONLY'])
        if s['features'] and dpaired < max(2, 0.5 * len(s['features'])):
            thin.append((s['id'], s['book'], dpaired, len(s['features'])))
        levels = [d for d in diffs if d[0] == 'LEVEL']
        if levels:
            dirty.append(s['id'])
            findings.append((s, diffs))
        else:
            clean.append(s['id'])

    byid = dict((x['id'], x) for x in subs)
    reprint = []
    for sid, xid in SCAG_REPRINTS.items():
        a, b = byid.get(sid), byid.get(xid)
        if not (a and b):
            continue
        if only and a['book'] != only:
            continue                      # else a filtered run counts them and the accounting trips
        notfound[:] = [n for n in notfound if n['id'] != sid]
        d = compare(a['features'], b['features'])
        matched += 1
        if [x for x in d if x[0] == 'LEVEL']:
            reprint.append((sid, xid, d))
            dirty.append(sid)
        else:
            clean.append(sid)

    total = matched + len(nobook) + len(notfound)
    considered = len([s for s in subs if not only or s['book'] == only])
    assert total == considered, 'ACCOUNTING FAILED: %d != %d' % (total, considered)
    print('accounting: %d considered = %d compared + %d no-book-file + %d not-found-in-book'
          % (considered, matched, len(nobook), len(notfound)))
    print('  level-clean: %d   level-mismatch: %d' % (len(clean), len(dirty)))

    # COVERAGE — the assert that makes "clean" mean anything. A LEVEL mismatch can only be found
    # for a feature that PAIRED by name on both sides; if names mostly failed to pair, zero
    # mismatches means the sweep compared almost nothing and "clean" is vacuous.
    if data_feats:
        pct = 100.0 * pairs / data_feats
        print('  coverage: %d of %d data features paired with a book line (%.1f%%)'
              % (pairs, data_feats, pct))
        assert pct >= 70.0, \
            'COVERAGE TOO LOW (%.1f%%) — a clean result here would be vacuous, not correct' % pct

    if notfound:
        print('\nNOT FOUND IN BOOK (reported, never skipped):')
        for s in notfound:
            print('  %-28s %-8s %s' % (s['id'], s['book'], s.get('note', 'no container matched')))
    if nobook:
        seen = sorted(set(s['book'] for s in nobook))
        print('\nNO BOOK FILE: %d subclasses across %s' % (len(nobook), ', '.join(seen)))

    if thin:
        print('\nTHIN MATCHES — too few features paired for "clean" to mean much here:')
        for sid, bk, got, tot in thin:
            print('  %-28s %-8s paired %d of %d' % (sid, bk, got, tot))
    else:
        print('  no thin matches: every subclass paired at least half its features')
    print('  SCAG reprints checked against their XGtE twin: %d of %d differ'
          % (len(reprint), len(SCAG_REPRINTS)))
    for sid, xid, d in reprint:
        for kind, n, dl, bl in d:
            if kind == 'LEVEL':
                print('     %-22s %-30s SCAG %-3s XGtE %s' % (sid, n, dl, bl))

    if bookconflict:
        print('\nBOOK DISAGREES WITH ITSELF (table vs prose) — verdicts here are not trustworthy:')
        for sid, k, t, p in bookconflict:
            print('  %-28s %-28s table %-3s prose %s' % (sid, k, t, p))
    else:
        print('  book self-consistency: table and prose agree everywhere both exist')

    print('\n===== LEVEL MISMATCHES =====')
    for s, diffs in findings:
        print('\n%s (%s, %s)' % (s['name'], s['classId'], s['book']))
        for kind, n, dl, bl in diffs:
            if kind == 'LEVEL':
                print('   LEVEL  %-34s data %-3s book %s' % (n, dl, bl))

    json.dump([dict(id=s['id'], name=s['name'], book=s['book'],
                    diffs=[list(d) for d in ds]) for s, ds in findings],
              open(os.path.join(REPO, 'tools/audit/out-subclassbooklevels.json'), 'w'), indent=1)


main()
