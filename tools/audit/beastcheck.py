"""Phase K — verify beastForms.ts against the SRD.

`beastForms.ts` is labelled "Beast Stat Blocks (Monster Manual)" but no Monster Manual is on disk;
the 31 entries were typed from memory in an earlier session and have never been checked. The SRD
(CC-BY, so its content may legitimately live in this repo) provides the same stat blocks as
structured JSON, so they can finally be verified rather than trusted.

Compares: size, CR, AC, HP, STR/DEX/CON, and each attack's to-hit and damage dice.

Usage: python tools/audit/beastcheck.py [nameFilter]
"""
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

SRD = r'C:\Users\nabil\Desktop\Code\reference-books\srd\5e-SRD-Monsters-2014.json'
FORMS = 'src/data/beastForms.ts'

CR_TEXT = {0.125: '1/8', 0.25: '1/4', 0.5: '1/2'}


def srd_index():
    out = {}
    for m in json.load(open(SRD, encoding='utf-8')):
        out[m['name'].strip().lower()] = m
    return out


def parse_forms():
    """id/name -> dict of the fields we can check, straight out of the TS."""
    text = open(FORMS, encoding='utf-8').read()
    out = []
    # each entry is a `{ id: '...', name: '...', ... }` object literal
    for m in re.finditer(r"\{\s*id: '([^']+)',\s*name: '([^']+)',(.*?)\n  \}", text, re.S):
        eid, name, body = m.group(1), m.group(2), m.group(3)

        def num(key):
            mm = re.search(r"\b%s: (\d+)" % key, body)
            return int(mm.group(1)) if mm else None

        def string(key):
            mm = re.search(r"\b%s: '([^']*)'" % key, body)
            return mm.group(1) if mm else None

        cr = string('cr')
        if cr is None:
            mm = re.search(r"\bcr: ([\d.]+)", body)
            cr = mm.group(1) if mm else None
        attacks = []
        for am in re.finditer(r"\{ name: '([^']+)', toHit: (-?\d+), damage: '([^']*)'", body):
            attacks.append((am.group(1), int(am.group(2)), am.group(3)))
        out.append(dict(id=eid, name=name, cr=cr, size=string('size'), hp=num('hp'), ac=num('ac'),
                        str=num('str'), dex=num('dex'), con=num('con'), attacks=attacks))
    return out


def norm_dice(d):
    return re.sub(r'\s+', '', (d or '').lower())


def main():
    filt = (sys.argv[1] if len(sys.argv) > 1 else '').lower()
    if not os.path.exists(SRD):
        print('SRD file not found:', SRD)
        sys.exit(1)
    srd = srd_index()
    forms = parse_forms()
    print(f'{len(forms)} entries parsed from beastForms.ts; {len(srd)} SRD monsters\n')

    considered = compared = notfound = 0
    diffs = []
    clean = []
    for f in forms:
        if filt and filt not in f['name'].lower():
            continue
        considered += 1
        m = srd.get(f['name'].strip().lower())
        if not m:
            notfound += 1
            print(f"[NOT IN SRD] {f['name']}")
            continue
        compared += 1
        bad = []
        if f['size'] and f['size'] != m.get('size'):
            bad.append(f"size app={f['size']} srd={m.get('size')}")
        srd_cr = m.get('challenge_rating')
        cr_disp = CR_TEXT.get(srd_cr, str(srd_cr).rstrip('0').rstrip('.') if isinstance(srd_cr, float) else str(srd_cr))
        if f['cr'] is not None and str(f['cr']) != cr_disp:
            bad.append(f"CR app={f['cr']} srd={cr_disp}")
        ac_list = m.get('armor_class') or []
        srd_ac = ac_list[0].get('value') if ac_list else None
        if f['ac'] is not None and srd_ac is not None and f['ac'] != srd_ac:
            bad.append(f"AC app={f['ac']} srd={srd_ac}")
        if f['hp'] is not None and f['hp'] != m.get('hit_points'):
            bad.append(f"HP app={f['hp']} srd={m.get('hit_points')}")
        for k, sk in (('str', 'strength'), ('dex', 'dexterity'), ('con', 'constitution')):
            if f[k] is not None and f[k] != m.get(sk):
                bad.append(f"{k.upper()} app={f[k]} srd={m.get(sk)}")
        # attacks
        srd_atk = {}
        for a in m.get('actions') or []:
            dmg = (a.get('damage') or [{}])[0].get('damage_dice')
            if a.get('attack_bonus') is not None:
                srd_atk[a['name'].strip().lower()] = (a['attack_bonus'], dmg)
        for an, tohit, dmg in f['attacks']:
            s = srd_atk.get(an.strip().lower())
            if not s:
                continue          # named differently in the app; not evidence of a wrong number
            if s[0] != tohit:
                bad.append(f"{an} toHit app=+{tohit} srd=+{s[0]}")
            if s[1] and norm_dice(dmg) != norm_dice(s[1]):
                bad.append(f"{an} damage app={dmg} srd={s[1]}")
        if bad:
            diffs.append((f['name'], bad))
        else:
            clean.append(f['name'])

    assert compared + notfound == considered, 'accounting broke'
    print(f"# considered={considered} compared={compared} notInSRD={notfound}")
    print(f"# clean={len(clean)}  withDifferences={len(diffs)}\n")
    print(f'===== DIFFERENCES ({len(diffs)}) =====')
    for name, bad in diffs:
        print(f'  {name}')
        for b in bad:
            print(f'      {b}')


if __name__ == '__main__':
    main()
