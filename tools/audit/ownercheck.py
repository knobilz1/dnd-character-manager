"""Ownership check: every resource key must sit inside the subclass entry that owns it.
Catches the failure mode that mislabelled Perfected Bond -- an anchor whose surrounding
entry had shifted, so the resource landed in a neighbour."""
import re, sys
src = open(r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src\data\subclasses\index.ts', encoding='utf-8').read()
starts = [m.start() for m in re.finditer(r"\n  \{ id: '", src)]
starts.append(len(src))
owner = {}
for a, b in zip(starts, starts[1:]):
    blk = src[a:b]
    sid = re.search(r"id: '([a-z0-9\-]+)'", blk).group(1)
    for k in re.findall(r"key: '([a-z_0-9]+)'", blk):
        owner.setdefault(k, []).append(sid)

EXPECT = dict(
    warding_flare='light-domain', holy_nimbus='oath-of-devotion',
    undying_sentinel='oath-of-the-ancients', elder_champion='oath-of-the-ancients',
    entropic_ward='the-great-old-one', fey_presence='the-archfey',
    misty_escape='the-archfey', dark_delirium='the-archfey',
    arcane_ward='school-of-abjuration',
    # batch 10 (XGtE)
    enthralling_performance='college-of-glamour', mantle_of_majesty='college-of-glamour',
    unbreakable_majesty='college-of-glamour', consult_the_spirits='ancestral-guardian',
    zealous_presence='zealot', detect_portal='horizon-walker', ethereal_step='horizon-walker',
    favored_by_the_gods='divine-soul', unearthly_recovery='divine-soul',
    searing_vengeance='the-celestial',
    # batch 11 (TCE)
    tentacle_of_the_deeps='the-fathomless', grasping_tentacles='the-fathomless',
    fathomless_plunge='the-fathomless', awakened_spellbook_ritual='order-of-scribes',
    manifest_mind='order-of-scribes', one_with_the_word='order-of-scribes',
    magic_awareness='path-of-wild-magic', bolstering_magic='path-of-wild-magic',
    infectious_fury='path-of-the-beast', call_the_hunt='path-of-the-beast',
    steps_of_night='twilight-domain', runic_shield='rune-knight',
    # batch 12 (SCAG + XGtE stragglers). master_duelist is deliberately absent: it is a
    # legitimate two-book duplicate, checked by the KNOWN_OK list below instead.
    exalted_champion='scag-oath-of-crown', defy_death='scag-the-undying',
    indestructible_life='scag-the-undying', walker_in_dreams='circle-of-dreams',
    strength_of_the_grave='shadow-magic',
    # batch 13 (TCE remainder)
    hand_of_ultimate_mercy='way-of-mercy', living_legend='oath-of-glory',
    mortal_bulwark='oath-of-the-watchers', elemental_gift='the-genie',
    # batch 14 (newly surfaced by the widened sweep)
    wrath_of_the_storm='tempest-domain', war_priest='war-domain',
    eyes_of_the_grave='grave-domain', sentinel_at_deaths_door='grave-domain',
    hunters_sense='monster-slayer', arcane_jolt='battle-smith',
    infectious_inspiration='college-of-eloquence', embodiment_of_the_law='order-domain',
    fungal_infestation='circle-of-spores',
    # batch 15 (ToB)
    siren_song='tob-college-of-the-siren', deep_dreams_sleep='tob-college-of-the-siren',
    spawning_season='tob-circle-of-the-shoal', captains_call='tob-captain',
    all_for_one='tob-captain', ferocious_presence='tob-corsair',
    avatar_of_greed='tob-oath-of-greed', smuggler_token='tob-smuggler',
    aspiring_alchemist='tob-gold-bloodline', gold_hoarder='tob-gold-bloodline',
    dark_depths='tob-ghost-ship-patron', voyage_of_the_damned='tob-ghost-ship-patron',
    ocean_form='tob-school-of-the-tide-watchers',
    # graviturgy correction: 'Deprive the Unworthy' does not exist in EGtW
    violent_attraction='graviturgy-magic',
    # second-pass gap fixes: limited uses inside subclasses that already had resources
    hurl_through_hell='the-fiend', accursed_specter='hexblade',
    bulwark_of_force='psi-warrior', psychic_veil='soulknife', rend_mind='soulknife',
    shadow_martyr='echo-knight', reclaim_potential='echo-knight',
    chronal_shift='chronurgy-magic', hidden_paths='circle-of-dreams',
    glorious_defense='oath-of-glory', misty_wanderer='fey-wanderer',
    restorative_reagents='alchemist', drakes_breath='drakewarden',
)
bad = 0
for k, want in EXPECT.items():
    got = owner.get(k, [])
    ok = got == [want]
    if not ok:
        bad += 1
    print('%-20s -> %-28s %s' % (k, ','.join(got) or '(ABSENT)', 'OK' if ok else '*** WRONG, expected ' + want))
# Known-acceptable duplicates: same subclass reprinted in two books, so a character
# can only ever have one of the pair. psionic_energy is NOT in here -- see AUDIT-FINDINGS.
KNOWN_OK = {
    'bladesong': ['bladesinging', 'scag-bladesinging'],
    'master_duelist': ['swashbuckler', 'scag-swashbuckler'],
}
dupes = {k: v for k, v in owner.items() if len(v) > 1 and KNOWN_OK.get(k) != v}
print('\nunexpected duplicate keys across subclasses:', dupes if dupes else 'none')
sys.exit(1 if bad or dupes else 0)
