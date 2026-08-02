"""Generate src/data/summonForms.ts — stat blocks for creatures you SUMMON but cannot become.

These deliberately do NOT go into beastForms.ts. That file is the Wild Shape and Beast Master pool,
filtered by CR alone, so dropping a griffon (monstrosity), a nightmare (fiend) or an air elemental
into it would silently let a druid turn into one. Separate file, separate array, same shape, so
utils/companion.ts can look in both without either pool contaminating the other.

Generated rather than typed for the reason gen_beasts.py already records: the 10 wrong stat blocks
an earlier audit found were every one of them a transcription error. The SRD is the only D&D source
here that is BOTH machine-readable and redistributable, so what it covers should never be retyped.

Writes the file directly (unlike gen_beasts.py, which prints for pasting) because there is no
existing content to merge with — the whole file is generated.

Usage: python tools/audit/gen_summon_forms.py
"""
import json
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

SRD = r'C:\Users\nabil\Desktop\Code\reference-books\srd\5e-SRD-Monsters-2014.json'
OUT = 'src/data/summonForms.ts'

# Every creature reachable through a summoning spell or a magic item the app already carries.
# Grouped by what brings them, so a reader can see why each one is here.
WANTED = {
    'Find Steed':            ['Warhorse', 'Pony', 'Camel', 'Elk', 'Mastiff'],
    'Find Greater Steed':    ['Griffon', 'Pegasus', 'Peryton', 'Dire Wolf', 'Rhinoceros',
                              'Saber-Toothed Tiger'],
    'Figurine of Wondrous Power': ['Raven', 'Griffon', 'Giant Wasp', 'Lion', 'Goat', 'Giant Goat',
                                   'Elephant', 'Nightmare', 'Mastiff', 'Giant Owl'],
    'Elemental commanders / gems': ['Air Elemental', 'Earth Elemental', 'Fire Elemental',
                                    'Water Elemental'],
    'Ring of Djinni Summoning': ['Djinni'],
    'Horn of Valhalla':      ['Berserker'],
    'Pipes of the Sewers':   ['Swarm of Rats'],
}

CR_TEXT = {0.0: '0', 0.125: '1/8', 0.25: '1/4', 0.5: '1/2'}


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def speed_obj(sp):
    out = {}
    for k in ('walk', 'climb', 'swim', 'fly', 'burrow'):
        v = sp.get(k)
        if not v:
            continue
        m = re.search(r'(\d+)', str(v))
        if m:
            out[k] = int(m.group(1))
    return out


def ts_string(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"


def entry(m):
    cr = CR_TEXT.get(m['challenge_rating'], str(m['challenge_rating']))
    ac = (m.get('armor_class') or [{}])[0].get('value')
    sp = speed_obj(m.get('speed') or {})
    atks = []
    for a in m.get('actions') or []:
        if a.get('attack_bonus') is None:
            continue
        dmg = a.get('damage') or []
        dice = dmg[0].get('damage_dice') if dmg else None
        dtype = (dmg[0].get('damage_type') or {}).get('index') if dmg else None
        if not dice:
            continue
        extra = ''
        if len(dmg) > 1 and dmg[1].get('damage_dice'):
            t2 = (dmg[1].get('damage_type') or {}).get('name', '').lower()
            extra = ', notes: ' + ts_string(f"plus {dmg[1]['damage_dice']} {t2}")
        atks.append(f"{{ name: {ts_string(a['name'])}, toHit: {a['attack_bonus']}, "
                    f"damage: {ts_string(dice)}, damageType: {ts_string(dtype or 'bludgeoning')}"
                    f"{extra} }}")
    specials = [s['name'] for s in (m.get('special_abilities') or [])][:4]
    lines = [f"  {{",
             f"    id: {ts_string(slug(m['name']))}, name: {ts_string(m['name'])}, "
             f"cr: {ts_string(cr)}, size: {ts_string(m['size'])}, hp: {m['hit_points']}, ac: {ac},",
             f"    str: {m['strength']}, dex: {m['dexterity']}, con: {m['constitution']},",
             f"    speed: {{ {', '.join(f'{k}: {v}' for k, v in sp.items())} }},",
             f"    attacks: [{', '.join(atks)}],"]
    if specials:
        lines.append(f"    specialAbilities: [{', '.join(ts_string(s) for s in specials)}],")
    lines.append("  },")
    return '\n'.join(lines)


def main():
    srd = json.load(open(SRD, encoding='utf-8'))
    by_name = {m['name'].lower(): m for m in srd}

    wanted, missing, why = [], [], {}
    for source, names in WANTED.items():
        for n in names:
            key = n.lower()
            if key not in by_name:
                missing.append(f'{n} (for {source})')
                continue
            why.setdefault(key, []).append(source)
            if key not in [w['name'].lower() for w in wanted]:
                wanted.append(by_name[key])

    wanted.sort(key=lambda m: m['name'])

    out = [
        "import type { BeastForm } from './beastForms';",
        "",
        "/**",
        " * Creatures you can SUMMON but never become.",
        " *",
        " * Kept out of beastForms.ts on purpose. That array is the Wild Shape and Beast Master pool",
        " * and is filtered by challenge rating alone, so a griffon (monstrosity), a nightmare (fiend)",
        " * or an air elemental sitting in it would quietly become a legal druid form. Same shape,",
        " * different list, and utils/companion.ts looks in both.",
        " *",
        " * GENERATED by tools/audit/gen_summon_forms.py from the SRD — do not hand-edit the numbers.",
        " * The SRD is the only D&D source here that is both machine-readable and redistributable, so",
        " * anything it covers is generated rather than retyped; the last audit found ten hand-typed",
        " * stat blocks and every one of them was wrong.",
        " */",
        "export const ALL_SUMMON_FORMS: BeastForm[] = [",
    ]
    for m in wanted:
        srcs = ', '.join(sorted(set(why[m['name'].lower()])))
        out.append(f"  // {srcs}")
        out.append(entry(m))
    out.append('];')
    out.append('')
    out.append('export function getSummonForm(id: string): BeastForm | undefined {')
    out.append('  return ALL_SUMMON_FORMS.find(f => f.id === id);')
    out.append('}')
    out.append('')

    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))

    print(f'wrote {OUT}: {len(wanted)} creatures')
    if missing:
        print('NOT IN SRD (nothing written for these):')
        for x in missing:
            print('  -', x)


if __name__ == '__main__':
    main()
