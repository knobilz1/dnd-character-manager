"""Add the fixed cantrips a subclass grants outright into its `alwaysPreparedSpells`.

Only GRANTS are listed. 42 subclass features mention cantrips, but most MODIFY them
(Potent Spellcasting, Potent Cantrip, War Magic) rather than grant one; those are excluded.
Choice-based grants (Nature Domain, Circle of the Land, Arcana Domain, Arcane Archer) need a
picker and are handled separately.
"""
import io
import re

GRANTS = {
    'light-domain':                    (1, ['light']),
    'the-celestial':                   (1, ['light', 'sacred-flame']),
    'way-of-shadow':                   (3, ['minor-illusion']),
    'school-of-illusion':              (2, ['minor-illusion']),
    'grave-domain':                    (1, ['spare-the-dying']),
    'circle-of-stars':                 (2, ['guidance']),
    'aberrant-mind':                   (1, ['mind-sliver']),
    'drakewarden':                     (3, ['thaumaturgy']),
    'tob-school-of-the-tide-watchers': (2, ['shape-water']),
    'scag-the-undying':                (1, ['spare-the-dying']),
    'illusionist-2024':                (3, ['minor-illusion']),
}

BACKSLASH = chr(92)


def obj_end(s, open_idx):
    """Index just past the `}` that closes the object opening at s[open_idx]."""
    depth = 0
    i = open_idx
    n = len(s)
    while i < n:
        c = s[i]
        # Comments must be skipped BEFORE quote handling: an apostrophe inside a `//` note
        # ("PHB p.61: the creature's turn") otherwise opens a phantom string literal and the
        # brace depth goes wrong for the rest of the file. This is the same bug that truncated
        # the class array after 4 of 25 entries in an earlier sweep.
        if c == '/' and i + 1 < n and s[i + 1] == '/':
            i = s.find(chr(10), i)
            if i == -1:
                return -1
        elif c == '/' and i + 1 < n and s[i + 1] == '*':
            i = s.find('*/', i)
            assert i != -1, 'unterminated block comment'
            i += 1
        elif c in "'\"`":
            quote = c
            i += 1
            while i < n and s[i] != quote:
                i += 2 if s[i] == BACKSLASH else 1
        elif c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise AssertionError('unbalanced braces from %d' % open_idx)


def main():
    applied = []
    for path in ['src/data/subclasses/index.ts', 'src/data/subclasses/phb2024.ts']:
        s = io.open(path, encoding='utf-8').read()
        for sid, (lvl, cantrips) in GRANTS.items():
            m = re.search(r"\{ id: '%s'," % re.escape(sid), s)
            if not m:
                continue
            a = m.start()
            b = obj_end(s, a)
            chunk = s[a:b]
            lit = ', '.join("'%s'" % c for c in cantrips)
            aps = re.search(r"alwaysPreparedSpells: \{([^}]*)\}", chunk)
            if aps:
                body = aps.group(1)
                key = re.search(r"(\b%d: \[)" % lvl, body)
                assert key, (sid, 'no level %d key in %r' % (lvl, body))
                new = (chunk[:aps.start(1)] + body[:key.end()] + lit + ', '
                       + body[key.end():] + chunk[aps.end(1):])
            else:
                assert chunk.endswith('}'), (sid, repr(chunk[-40:]))
                # rstrip the trailing comma too: `features: [...],` already ends with one, and
                # appending straight onto it produced `],,` — a syntax error, not a silent bug,
                # but only because tsc ran. Strip it and re-add exactly one.
                head = chunk[:-1].rstrip().rstrip(',')
                new = head + ', alwaysPreparedSpells: { %d: [%s] } }' % (lvl, lit)
            s = s[:a] + new + s[b:]
            applied.append(sid)
        io.open(path, 'w', encoding='utf-8', newline='').write(s)

    missing = [k for k in GRANTS if k not in applied]
    assert not missing, 'NOT APPLIED: %s' % missing
    assert len(applied) == len(GRANTS), 'applied %d, expected %d' % (len(applied), len(GRANTS))
    print('all %d fixed cantrip grants written' % len(applied))


if __name__ == '__main__':
    main()
