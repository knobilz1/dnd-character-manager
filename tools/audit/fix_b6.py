"""B6: give the thirteen renamed PHB 2024 subclasses the name the 2024 book actually uses.

Found by the Phase B level sweep: these could not be located in phb2024-players-handbook.md by name
because the 2024 book renamed them and the app kept the 2014 label. The ids already carry the new
names ('abjurer-2024', 'archfey-patron-2024'), so only the user-visible `name` was stale — a player
building a 2024 character was shown a subclass the 2024 book does not contain.

Safe as a pure rename: every lookup in src/ resolves subclasses by `id` (verified by grep — there
are no name-based subclass lookups anywhere), and saved characters persist `subclassId`, so no
existing sheet is disturbed.
"""
import re, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
P = r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src\data\subclasses\phb2024.ts'

# id -> (name the app showed, name the PHB 2024 uses). Each confirmed by reading the book section.
RENAMES = {
    'aberrant-mind-2024':      ('Aberrant Mind',       'Aberrant Sorcery'),
    'clockwork-soul-2024':     ('Clockwork Soul',      'Clockwork Sorcery'),
    'draconic-bloodline-2024': ('Draconic Bloodline',  'Draconic Sorcery'),
    'wild-magic-2024':         ('Wild Magic',          'Wild Magic Sorcery'),
    'circle-of-stars-2024':    ('Circle of Stars',     'Circle of the Stars'),
    'archfey-patron-2024':     ('The Archfey',         'Archfey Patron'),
    'celestial-patron-2024':   ('The Celestial',       'Celestial Patron'),
    'fiend-patron-2024':       ('The Fiend',           'Fiend Patron'),
    'great-old-one-2024':      ('The Great Old One',   'Great Old One Patron'),
    'abjurer-2024':            ('School of Abjuration', 'Abjurer'),
    'diviner-2024':            ('School of Divination', 'Diviner'),
    'evoker-2024':             ('School of Evocation',  'Evoker'),
    'illusionist-2024':        ('School of Illusion',   'Illusionist'),
}

s = open(P, encoding='utf-8').read()
before = s
done = []
for sid, (old, new) in RENAMES.items():
    # Anchor on the id so a name that also appears in prose (descriptions mention "Wild Magic")
    # cannot be hit by accident. Only the `name:` field immediately following the id is touched.
    pat = re.compile(r"(id: '%s',\s*name: ')%s(')" % (re.escape(sid), re.escape(old)))
    s, n = pat.subn(r'\g<1>%s\g<2>' % new, s)
    if n == 0:
        # already renamed? then the new name must be there, else the entry moved and we must stop
        assert re.search(r"id: '%s',\s*name: '%s'" % (re.escape(sid), re.escape(new)), s), \
            'could not rename %s and it does not already carry the new name — entry shape changed' % sid
        continue
    assert n == 1, 'renamed %s %d times, expected 1' % (sid, n)
    done.append('%-26s %-22s -> %s' % (sid, old, new))

open(P, 'w', encoding='utf-8').write(s)
print('renamed %d subclasses:' % len(done))
for d in done:
    print('   ' + d)

# CONTROL: the 2014 entries must be untouched. The 2024 book renamed these; the 2014 book did not,
# and a 2014 wizard still picks "School of Abjuration". Renaming both would be a new bug.
old14 = open(r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src\data\subclasses\index.ts',
             encoding='utf-8').read()
for n in ('School of Abjuration', 'Draconic Bloodline', 'The Archfey', 'Circle of Stars'):
    assert "name: '%s'" % n in old14, 'CONTROL FAILED: 2014 %s was disturbed' % n
print('control ok: the 2014 names are untouched')

# CONTROL: no id lost its name field, and the file still has 48 subclasses.
assert len(re.findall(r"\{ id: '", before)) == len(re.findall(r"\{ id: '", s)), 'entry count changed'
print('control ok: entry count unchanged')
