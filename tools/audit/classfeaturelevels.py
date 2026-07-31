"""Phase H — base-class feature levels vs the rulebook class tables.

The 16 outstanding "per-class feature-by-feature passes" done as a sweep instead of by hand.

Source of truth is the **class table** in each book's markdown ("| 5 | +3 | Extra Attack |"),
which is machine-readable and states the level for every feature.

Discipline carried over from the subclass sweep (tools/audit/subclassbooklevels.py):
  * the TS parse is validated against RUNTIME ground truth (level sequence per class, captured
    from the live app) before any comparison runs — a parser that disagrees aborts the run;
  * first-grant by MIN level, because features that improve ("Action Surge (one use)" at 2,
    "(two uses)" at 17) legitimately appear on several rows;
  * accounting assert: compared + skipped == considered;
  * coverage assert: a "clean" result is vacuous if the two sides never paired.

Usage: python tools/audit/classfeaturelevels.py [classIdFilter]
"""
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

MD = r'C:\Users\nabil\Desktop\Code\reference-books\md'
BOOK_MD = {
    'PHB': 'phb-players-handbook.md',
    'PHB2024': 'phb2024-players-handbook.md',
    'TCE': 'tce-tashas-cauldron.md',
    'XGtE': 'xge-xanathars-guide.md',
}

# Runtime truth: "<id>=<count>/<level.level...>" straight from the live app.
GROUND_TRUTH = (
    "barbarian=20/1.1.2.2.3.4.5.5.7.8.9.11.12.13.15.16.17.18.19.20 "
    "bard=24/1.1.2.2.3.3.4.5.5.6.8.9.10.10.10.12.13.14.15.16.17.18.19.20 "
    "cleric=18/1.1.2.2.4.5.6.8.8.10.11.12.14.16.17.18.19.20 "
    "druid=14/1.1.2.2.4.4.8.8.12.16.18.18.19.20 "
    "fighter=18/1.1.2.3.4.5.6.8.9.11.12.13.14.16.17.17.19.20 "
    "monk=27/1.1.2.2.2.2.2.3.3.4.4.5.5.6.7.7.8.9.10.12.13.14.15.16.18.19.20 "
    "paladin=20/1.1.2.2.2.3.3.3.4.5.6.8.10.11.12.14.16.18.19.20 "
    "ranger=21/1.1.2.2.3.3.4.5.6.6.8.8.10.10.12.14.14.16.18.19.20 "
    "rogue=19/1.1.1.2.3.4.5.6.7.8.10.11.12.14.15.16.18.19.20 "
    "sorcerer=12/1.1.2.3.4.8.10.12.16.17.19.20 "
    "warlock=14/1.1.2.3.4.8.11.12.13.15.16.17.19.20 "
    "wizard=10/1.1.2.4.8.12.16.19.18.20 "
    "artificer=17/1.1.2.3.3.4.6.7.8.10.11.12.14.16.18.19.20 "
    "barbarian-2024=26/1.1.1.2.2.3.3.4.5.5.6.7.7.8.9.10.11.12.13.14.15.16.17.18.19.20 "
    "bard-2024=18/1.1.2.2.3.4.5.6.7.8.9.10.12.14.16.18.19.20 "
    "cleric-2024=16/1.1.2.3.4.5.6.7.8.10.14.12.17.16.19.20 "
    "druid-2024=19/1.1.1.2.2.3.4.5.6.7.8.10.12.14.15.16.18.19.20 "
    "fighter-2024=27/1.1.1.2.2.3.4.5.5.6.7.8.9.9.10.11.12.13.13.14.15.16.17.17.18.19.20 "
    "monk-2024=29/1.1.1.2.2.2.3.3.4.4.5.5.6.6.7.8.9.10.10.11.12.13.14.15.18.16.17.20.19 "
    "paladin-2024=23/1.1.1.2.2.3.3.4.5.5.6.7.8.9.10.11.12.15.14.16.18.19.20 "
    "ranger-2024=23/1.1.1.2.2.3.4.5.6.7.8.9.10.11.12.13.14.15.16.17.18.19.20 "
    "rogue-2024=26/1.6.1.1.1.2.5.5.3.3.4.7.7.8.9.10.11.12.13.14.15.16.17.18.19.20 "
    "sorcerer-2024=19/1.1.2.2.3.4.4.5.7.6.8.10.14.12.16.17.18.19.20 "
    "warlock-2024=18/1.1.2.3.4.6.8.9.10.11.12.13.14.15.16.17.19.20 "
    "wizard-2024=16/1.1.1.2.3.4.5.6.8.10.12.14.16.18.19.20"
)


def strip_comments(text):
    """Same-length copy with // and /* */ comment bodies blanked (newlines kept).

    Load-bearing: these files are full of prose comments containing apostrophes
    ("// the character's ..."). To a naive tokenizer that apostrophe opens a string
    literal and swallows every brace until the next one, which truncated the class
    array after 4 of 25 entries.
    """
    out, i, n = [], 0, len(text)
    instr = None
    while i < n:
        c = text[i]
        if instr:
            out.append(c)
            if c == '\\' and i + 1 < n:
                out.append(text[i + 1]); i += 2; continue
            if c == instr:
                instr = None
            i += 1
        elif c in '"\'`':
            instr = c; out.append(c); i += 1
        elif c == '/' and i + 1 < n and text[i + 1] == '/':
            while i < n and text[i] != '\n':
                out.append(' '); i += 1
        elif c == '/' and i + 1 < n and text[i + 1] == '*':
            while i < n and not (text[i] == '*' and i + 1 < n and text[i + 1] == '/'):
                out.append('\n' if text[i] == '\n' else ' '); i += 1
            out.append('  '); i += 2
        else:
            out.append(c); i += 1
    return ''.join(out)


def blank_strings(o):
    out, instr, esc = [], None, False
    for c in o:
        if instr:
            if esc:
                esc = False; out.append(' ')
            elif c == '\\':
                esc = True; out.append(' ')
            elif c == instr:
                instr = None; out.append(c)
            else:
                out.append(' ')
        else:
            out.append(c)
            if c in '"\'`':
                instr = c
    return ''.join(out)


def balanced(s, start, open_c, close_c):
    depth, instr, esc, j = 0, None, False, start
    while j < len(s):
        c = s[j]
        if instr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == instr: instr = None
        elif c in '"\'`':
            instr = c
        elif c == open_c:
            depth += 1
        elif c == close_c:
            depth -= 1
            if depth == 0:
                return s[start:j + 1]
        j += 1
    return None


def objects(body):
    depth, instr, esc, start = 0, None, False, None
    for j, c in enumerate(body):
        if instr:
            if esc: esc = False
            elif c == '\\': esc = True
            elif c == instr: instr = None
            continue
        if c in '"\'`':
            instr = c
        elif c == '{':
            if depth == 0: start = j
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                yield body[start:j + 1]


def field(o, key):
    masked = blank_strings(o)
    m = re.search(r'(?:^|[{,])\s*%s:\s*' % key, masked)
    if not m: return None
    v = re.match(r'(\'(?:[^\'\\]|\\.)*\'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|[\w.\-]+)', o[m.end():])
    if not v: return None
    v = v.group(1)
    return v[1:-1] if v[0] in '"\'`' else v


def parse_classes():
    """id -> (sourceBook, [(featureName, level), ...]) from the TS sources.

    Each file is ONE top-level `const X: DClass[] = [...]`, so iterate that array's own
    objects. (An earlier version hunted for `id:` and walked back to the nearest `{`, which
    landed inside nested objects and silently dropped 10 of 25 classes — caught by validate().)
    """
    out = {}
    for path in ('src/data/classes/index.ts', 'src/data/classes/phb2024.ts'):
        text = strip_comments(open(path, encoding='utf-8').read())
        m = re.search(r'^(?:export )?const \w+: DClass\[\] = \[', text, re.M)
        if not m:
            continue
        arr = balanced(text, m.end() - 1, '[', ']')
        for blk in objects(arr):          # each top-level object is one class
            idv = field(blk, 'id')
            if not idv:
                continue
            mm = re.search(r'(?:^|[{,])\s*features:\s*\[', blank_strings(blk))
            if not mm:
                continue
            farr = balanced(blk, mm.end() - 1, '[', ']')
            if not farr:
                continue
            feats = []
            for o in objects(farr):
                n, lv = field(o, 'name'), field(o, 'level')
                if n and lv and lv.isdigit():
                    feats.append((n, int(lv)))
            if feats:
                out[idv] = (field(blk, 'sourceBook'), feats)
    return out


def validate(parsed):
    """Abort unless the parse reproduces the live app exactly."""
    bad = []
    for tok in GROUND_TRUTH.split():
        cid, rest = tok.split('=')
        cnt, levels = rest.split('/')
        if cid not in parsed:
            bad.append(f'{cid}: NOT PARSED'); continue
        feats = parsed[cid][1]
        got = '.'.join(str(l) for _, l in feats)
        if len(feats) != int(cnt) or got != levels:
            bad.append(f'{cid}: parsed {len(feats)} [{got}] != runtime {cnt} [{levels}]')
    return bad


ROW = re.compile(r'^\|\s*(\d{1,2})(?:st|nd|rd|th)?\s*\|[^|]*\|([^|]*)\|', re.M)
NOISE = re.compile(
    r'^(|-|see above|subclass|asi)$'
    r'|feature[s]?$'                     # "Martial Archetype feature" = a SUBCLASS feature
    r'|^\d+d\d+|^cantrips|^spells known|^spell slots|^\d+$'
    r'|^(str|dex|con|int|wis|cha)|^proficienc|^starting equipment|^hit die', re.I)

ALIAS = {
    'asi': 'ability score improvement',
    'ability score improvement/feat': 'ability score improvement',
}


def norm_feature(name):
    """Book prose carries trailing colons, bold markers and appended clauses."""
    name = name.split(':')[0]
    name = name.replace('**', '').replace('*', '')
    # Unify quotes/dashes: the books use typographic marks, the app uses ASCII. Without this,
    # "Thieves’ Cant" and "Thieves' Cant" look like a missing feature.
    for a, b in (('’', "'"), ('‘', "'"), ('“', '"'), ('”', '"'),
                 ('—', '-'), ('–', '-'), (' ', ' ')):
        name = name.replace(a, b)
    name = re.sub(r'\s*\(.*?\)\s*', ' ', name)
    name = re.sub(r'\s+', ' ', name).strip().strip('.,;: ').strip()
    k = name.lower()
    return ALIAS.get(k, k), name


BULLET_TRAILING = re.compile(r'^-\s+\*\*(.+?)\s*\(([^)]*?\d(?:st|nd|rd|th)[^)]*)\)', re.M)
BULLET_LEADING = re.compile(
    r'^-\s+\*\*((?:\d{1,2}(?:st|nd|rd|th)\s*[/,]?\s*)+)[—–-]\s*([^:*.]+)', re.M)
LEVELS_IN = re.compile(r'(\d{1,2})(?:st|nd|rd|th)')


def _add(grants, name, lv):
    k, disp = norm_feature(name)
    if not k or NOISE.match(k) or len(k) > 55:
        return
    if k not in grants or lv < grants[k][1]:
        grants[k] = (disp, lv)


def book_features(md_text, class_name):
    """(grants, shape) for one class — the extracts use three different layouts."""
    m = None
    for pat in (r'^(#+)\s*%s\s*\(' % re.escape(class_name),
                r'^(#+)\s*%s\b' % re.escape(class_name)):
        m = re.search(pat, md_text, re.M | re.I)
        if m:
            break
    if not m:
        return None, None
    # Bound at the next heading of the SAME OR HIGHER level. Paladin/Ranger/Rogue/Sorcerer are
    # `###` nested under Monk's `##`; bounding on `^##` alone made Paladin's section swallow
    # three whole classes, which is why it paired at 0%.
    depth = len(m.group(1))
    nxt = re.search(r'^#{1,%d}\s+\w' % depth, md_text[m.end():], re.M)
    seg = md_text[m.end(): m.end() + (nxt.start() if nxt else 60000)]
    # A class's `##` section also contains its SUBCLASS `###` subsections (all of Monk's
    # ways, all of Wizard's schools). Those are subclass features, not class features, and
    # counting them made Monk look like a 110-feature class paired at 17%.
    sub = re.search(r'^###\s+(?!Class Features|Level features)\w', seg, re.M)
    if sub:
        seg = seg[:sub.start()]

    grants, shapes = {}, []
    for lv_s, name in BULLET_LEADING.findall(seg):
        for lv in LEVELS_IN.findall(lv_s):
            _add(grants, name, int(lv))
    if grants:
        shapes.append('lead-bullet')
    n0 = len(grants)
    for name, lv_s in BULLET_TRAILING.findall(seg):
        for lv in LEVELS_IN.findall(lv_s):
            _add(grants, name, int(lv))
    if len(grants) > n0:
        shapes.append('trail-bullet')
    n1 = len(grants)
    for lvl, feats in ROW.findall(seg):
        for f in re.split(r',(?![^()]*\))', feats):
            _add(grants, f, int(lvl))
    if len(grants) > n1:
        shapes.append('table')
    return (grants or None), '+'.join(shapes)


def main():
    filt = sys.argv[1] if len(sys.argv) > 1 else None
    parsed = parse_classes()
    bad = validate(parsed)
    if bad:
        print('PARSER DISAGREES WITH THE RUNNING APP — aborting, fix the parser first:')
        for b in bad: print('  ' + b)
        sys.exit(1)
    print(f'parser validated against the live app: {len(GROUND_TRUTH.split())} classes, exact match\n')

    shapes_used = {}
    considered = compared = skipped = 0
    paired_tot = book_tot = 0
    mismatches, missing_in_app, thin = [], [], []

    for cid, (book, feats) in sorted(parsed.items()):
        if filt and filt not in cid:
            continue
        considered += 1
        md_file = BOOK_MD.get(book or 'PHB')
        path = os.path.join(MD, md_file) if md_file else None
        if not path or not os.path.exists(path):
            skipped += 1; print(f'[NO BOOK ] {cid} ({book})'); continue
        name = cid.replace('-2024', '').capitalize()
        grants, shape = book_features(open(path, encoding='utf-8').read(), name)
        if not grants:
            skipped += 1; print(f'[NO TABLE] {cid} — no feature list found in {md_file}'); continue
        compared += 1

        app = {}
        for n, lv in feats:
            k, _ = norm_feature(n)
            if k not in app or lv < app[k]:
                app[k] = lv

        paired = [k for k in grants if k in app]
        paired_tot += len(paired); book_tot += len(grants)
        for k in paired:
            disp, blv = grants[k]
            if app[k] != blv:
                mismatches.append(f'{cid:16} {disp:34} app L{app[k]:<3} book L{blv}')
        for k in grants:
            if k not in app:
                missing_in_app.append(f'{cid:16} {grants[k][0]}  (book L{grants[k][1]})')
        shapes_used[cid] = shape
        pct = 100 * len(paired) / len(grants)
        if pct < 50:
            thin.append(f'{cid}: only {len(paired)}/{len(grants)} paired ({pct:.0f}%)')

    assert compared + skipped == considered, 'accounting broke'
    print(f'# considered={considered} compared={compared} skipped={skipped}')
    print(f'# feature pairing: {paired_tot}/{book_tot} book features matched to an app feature '
          f'({100*paired_tot/book_tot:.1f}%)')
    if thin:
        print('\n!! THIN PAIRING — a clean result for these is vacuous:')
        for t in thin: print('   ' + t)
    print(f'\n===== LEVEL MISMATCHES ({len(mismatches)}) =====')
    for m in mismatches: print('  ' + m)
    print(f'\n===== IN BOOK, NOT IN APP ({len(missing_in_app)}) =====')
    for m in missing_in_app[:80]: print('  ' + m)
    if len(missing_in_app) > 80:
        print(f'  ... and {len(missing_in_app)-80} more')


if __name__ == '__main__':
    main()
