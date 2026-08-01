"""Give subclasses a machine-readable armour/shield proficiency grant.

Fifteen subclasses say in feature prose that they grant armour proficiency, and `armorGrants`
read only the BASE CLASS — so a Life Domain cleric in plate was told they could not cast spells,
exactly like a wizard in plate. Verified live before writing this.

Transcribed from each feature's own description; weapon, tool and skill grants in the same
sentence are ignored (those are separate systems). `scag-totem-warrior-elk-tiger` matched the
keyword search but grants nothing — "while you aren't wearing heavy armor" is a condition.
"""
import io
import re

GRANTS = {
    'college-of-valor':      ['Medium armor', 'Shields'],
    'college-of-valor-2024': ['Medium armor', 'Shields'],
    'college-of-swords':     ['Medium armor'],
    'hexblade':              ['Medium armor', 'Shields'],
    'life-domain':           ['Heavy armor'],
    'nature-domain':         ['Heavy armor'],
    'tempest-domain':        ['Heavy armor'],
    'war-domain':            ['Heavy armor'],
    'forge-domain':          ['Heavy armor'],
    'order-domain':          ['Heavy armor'],
    'twilight-domain':       ['Heavy armor'],
    'tob-sea-domain':        ['Heavy armor'],
    'armorer':               ['Heavy armor'],
    'bladesinging':          ['Light armor'],
    'scag-bladesinging':     ['Light armor'],
}

BACKSLASH = chr(92)


def obj_end(s, open_idx):
    """Index just past the `}` closing the object at s[open_idx]. Skips comments and strings —
    an apostrophe inside a // note otherwise opens a phantom string and breaks brace depth."""
    depth = 0
    i = open_idx
    n = len(s)
    while i < n:
        c = s[i]
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
        for sid, profs in GRANTS.items():
            m = re.search(r"\{ id: '%s'," % re.escape(sid), s)
            if not m:
                continue
            a = m.start()
            b = obj_end(s, a)
            chunk = s[a:b]
            assert 'armorProficiencies' not in chunk, ('already present', sid)
            assert chunk.endswith('}'), (sid, repr(chunk[-40:]))
            lit = ', '.join("'%s'" % p for p in profs)
            head = chunk[:-1].rstrip().rstrip(',')
            s = s[:a] + head + ', armorProficiencies: [%s] }' % lit + s[b:]
            applied.append(sid)
        io.open(path, 'w', encoding='utf-8', newline='').write(s)

    missing = [k for k in GRANTS if k not in applied]
    assert not missing, 'NOT APPLIED: %s' % missing
    assert len(applied) == len(GRANTS), (len(applied), len(GRANTS))
    print('armour proficiency written for %d subclasses' % len(applied))


if __name__ == '__main__':
    main()
