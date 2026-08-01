"""Generate the missing CR <= 1/4 beast entries for beastForms.ts from the SRD.

These are the legal Beast Master companion pool (and also expand druid Wild Shape at low level,
which the existing maxWildShapeCR / wildShapeCanFly / wildShapeCanSwim guards already handle).

Generated rather than typed: the 10 wrong stat blocks Phase K found were all transcription errors,
and this adds 31 more entries. Prints TS ready to paste; does not write the file itself so the
insertion point stays a human decision.
"""
import json
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

SRD = r'C:\Users\nabil\Desktop\Code\reference-books\srd\5e-SRD-Monsters-2014.json'
FORMS = 'src/data/beastForms.ts'
CR_TEXT = {0.0: '0', 0.125: '1/8', 0.25: '1/4'}


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


def main():
    srd = json.load(open(SRD, encoding='utf-8'))
    have = {m.group(1).lower() for m in re.finditer(r"name: '([^']+)'", open(FORMS, encoding='utf-8').read())}
    elig = [m for m in srd if m.get('type') == 'beast'
            and isinstance(m.get('challenge_rating'), (int, float))
            and m['challenge_rating'] <= 0.25 and m.get('size') in ('Tiny', 'Small', 'Medium')]
    missing = sorted((m for m in elig if m['name'].lower() not in have), key=lambda m: m['name'])

    print(f'  // ── SRD beasts, CR 1/4 and lower (Beast Master companion pool) ──────────────')
    print(f'  // Generated from the SRD by tools/audit/gen_beasts.py — {len(missing)} entries.')
    print(f'  // Verifiable with tools/audit/beastcheck.py; do not hand-edit the numbers.')
    for m in missing:
        cr = CR_TEXT.get(m['challenge_rating'], str(m['challenge_rating']))
        ac = (m.get('armor_class') or [{}])[0].get('value')
        sp = speed_obj(m.get('speed') or {})
        atks = []
        for a in m.get('actions') or []:
            if a.get('attack_bonus') is None:
                continue
            dmg = (a.get('damage') or [{}])
            dice = dmg[0].get('damage_dice') if dmg else None
            dtype = (dmg[0].get('damage_type') or {}).get('index') if dmg else None
            if not dice:
                continue
            extra = ''
            if len(dmg) > 1 and dmg[1].get('damage_dice'):
                t2 = (dmg[1].get('damage_type') or {}).get('name', '').lower()
                note = 'plus ' + dmg[1]['damage_dice'] + ' ' + t2
                extra = ', notes: ' + ts_string(note)
            atks.append(
                f"{{ name: {ts_string(a['name'])}, toHit: {a['attack_bonus']}, "
                f"damage: {ts_string(dice)}, damageType: {ts_string(dtype or 'bludgeoning')}{extra} }}")
        specials = [s['name'] for s in (m.get('special_abilities') or [])][:4]
        print(f"  {{")
        print(f"    id: {ts_string(slug(m['name']))}, name: {ts_string(m['name'])}, "
              f"cr: {ts_string(cr)}, size: {ts_string(m['size'])}, hp: {m['hit_points']}, ac: {ac},")
        print(f"    str: {m['strength']}, dex: {m['dexterity']}, con: {m['constitution']},")
        print(f"    speed: {{ {', '.join(f'{k}: {v}' for k, v in sp.items())} }},")
        if atks:
            print(f"    attacks: [{', '.join(atks)}],")
        else:
            print(f"    attacks: [],")
        if specials:
            print(f"    specialAbilities: [{', '.join(ts_string(s) for s in specials)}],")
        print(f"  }},")


if __name__ == '__main__':
    main()
