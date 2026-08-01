"""Add the four CHOICE-based subclass cantrip grants as option groups.

The eleven fixed grants (Light Domain's Light, Shadow Arts' Minor Illusion...) are plain data in
`alwaysPreparedSpells`. These four let the PLAYER choose, and the cantrip comes off another class's
list, so they need a picker:

  nature-domain       L1  Acolyte of Nature   1 druid cantrip
  circle-of-the-land  L2  Bonus Cantrip       1 druid cantrip
  scag-arcana-domain  L1  Arcane Initiate     2 wizard cantrips
  arcane-archer       L3  Arcane Archer Lore  Prestidigitation or Druidcraft

Reuses SUBCLASS_OPTIONS rather than inventing a mechanism: that picker already renders in the
creator, on the sheet, and (as of this sweep) in the level-up dialog.
"""
import io

P = 'src/data/subclassOptions.ts'

HELPER = '''
/** Cantrips from one class's spell list, as option choices.
 *
 *  Built from ALL_SPELLS rather than transcribed, because the list genuinely spans books — 20 druid
 *  and 35 wizard cantrips across seven of them — and a hand-copied list would silently rot every
 *  time a book was added. `sourceBook` rides along so the picker can hide what the table doesn't
 *  own, the same rule every other content filter in the app follows.
 */
function cantripChoices(spellListClassId: string) {
  return ALL_SPELLS
    .filter(s => s.level === 0 && s.classes.includes(spellListClassId))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(s => ({
      id: s.id,
      name: s.name,
      description: `${s.school}${s.damageType ? ' \\u00b7 ' + s.damageType : ''}`,
      sourceBook: s.sourceBook,
    }));
}

/** The named pair Arcane Archer Lore offers, rather than a whole class list. */
function namedCantripChoices(ids: string[]) {
  return ids
    .map(id => ALL_SPELLS.find(s => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map(s => ({ id: s.id, name: s.name, description: s.school, sourceBook: s.sourceBook }));
}
'''

GROUPS = {
    'nature-domain': """  'nature-domain': [
    {
      key: 'acolyteOfNatureCantrip',
      label: 'Acolyte of Nature — Druid Cantrip',
      picksByLevel: { 1: 1 },
      choices: cantripChoices('druid'),
      grants: 'cantrip',
    },
  ],
""",
    'circle-of-the-land': """  'circle-of-the-land': [
    {
      key: 'landBonusCantrip',
      label: 'Bonus Cantrip — Druid Cantrip',
      picksByLevel: { 2: 1 },
      choices: cantripChoices('druid'),
      grants: 'cantrip',
    },
  ],
""",
    'scag-arcana-domain': """  'scag-arcana-domain': [
    {
      key: 'arcaneInitiateCantrips',
      label: 'Arcane Initiate — Wizard Cantrips',
      picksByLevel: { 1: 2 },
      choices: cantripChoices('wizard'),
      grants: 'cantrip',
    },
  ],
""",
    'arcane-archer': """  'arcane-archer': [
    {
      key: 'arcaneArcherLoreCantrip',
      label: 'Arcane Archer Lore — Cantrip',
      picksByLevel: { 3: 1 },
      choices: namedCantripChoices(['prestidigitation', 'druidcraft']),
      grants: 'cantrip',
    },
  ],
""",
}


def main():
    s = io.open(P, encoding='utf-8').read()

    assert "from '../types'" in s
    if 'ALL_SPELLS' not in s:
        old = "import type { SubclassOptionGroup } from '../types';"
        assert s.count(old) == 1
        s = s.replace(old, old + "\nimport { ALL_SPELLS } from './spells';")

    anchor = 'export const SUBCLASS_OPTIONS: Record<string, SubclassOptionGroup[]> = {'
    assert s.count(anchor) == 1
    s = s.replace(anchor, HELPER + '\n' + anchor)

    added = []
    for sid, block in GROUPS.items():
        # Existing groups are written `'id': [{` on one line — arcane-archer already has Arcane
        # Shots and nature-domain already has its skill pick, so those get a SECOND group appended
        # into the same array rather than a duplicate key that would silently overwrite the first.
        key = "  '%s': [{" % sid
        if key in s:
            assert s.count(key) == 1, (sid, s.count(key))
            inner = block.split('[\n', 1)[1].rsplit('  ],\n', 1)[0].rstrip()
            assert inner.endswith('},'), repr(inner[-20:])
            s = s.replace(key, "  '%s': [\n%s\n  {" % (sid, inner))
        else:
            s = s.replace(anchor, anchor + '\n' + block)
        added.append(sid)

    io.open(P, 'w', encoding='utf-8', newline='').write(s)
    assert len(added) == 4, added
    print('added cantrip option groups for: %s' % ', '.join(added))


if __name__ == '__main__':
    main()
