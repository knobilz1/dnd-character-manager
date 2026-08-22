import type { AbilityKey, Character } from '../types';
import { getSpell } from '../data/spells';
import { lookupWeapon, damageLine } from '../data/weapons';
import { getRace } from '../data/races';
import { raceOptionGroups } from '../data/raceOptions';
import { computeCharacterDerived } from '../hooks/useCharacterDerived';

/**
 * sheetDigest.ts — a character rendered as compact plain text for the DM bot.
 *
 * Used when a player is absent and the DM is running their character (see the
 * roll call in DMConsolePage). The DM otherwise sees only the one-line party
 * status plus the identity blurb in memory/party.md — no AC, no ability
 * scores, no attacks, no spells. That is enough to *mention* a character and
 * nowhere near enough to *play* one: without this the DM invents abilities,
 * and the numbers it invents contradict the sheet the player comes back to.
 *
 * Nothing existing could be reused: printSheet.ts emits HTML with ~700 lines of
 * CSS, and generateCharacterPDF/fillCharacterPDF emit PDF bytes. This borrows
 * their data sources instead — computeCharacterDerived is a pure function of a
 * Character with no store access, so it works fine on a party member's sheet
 * that arrived over LAN.
 *
 * Sent ONCE per sitting, not per turn (see buildTurnPrompt's `absentSheets`):
 * these numbers don't change, and the CLI's resumed transcript keeps them
 * available for the rest of the session.
 *
 * Deliberately omits backstory and personality — memory/party.md already
 * carries those on every single turn, and repeating them here would be paying
 * twice for the same text.
 */

const ABILITY_ORDER: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function fmt(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/** "arcane-recovery" → "Arcane recovery". Resource keys are ids, not labels. */
function humanize(key: string): string {
  const s = key.replace(/[-_]/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function buildSheetDigest(c: Character): string {
  const classes = (c.classes || [])
    .map((cl) => `${cl.classId}${cl.subclassId ? `(${cl.subclassId})` : ''} ${cl.level}`)
    .join(' / ');

  // computeCharacterDerived assumes a COMPLETE Character — it iterates
  // selectedFeats, baseAbilityScores and friends directly. That holds for a
  // sheet this device owns, but a party member's sheet arrived over LAN, and
  // party_listener.rs validates only name + classes before accepting it. A
  // half-populated sheet therefore reaches here and throws.
  //
  // Caught live: it took down the whole roll call, because confirmRollCall
  // builds digests synchronously — the DM couldn't start the night at all.
  // Degrade to what can be read straight off the sheet instead, and say
  // plainly that it's partial: same reasoning as the UNKNOWN-HP wording in
  // dmPrompt.ts, where the one unacceptable outcome is the DM quietly
  // inventing numbers for someone else's character.
  let d: ReturnType<typeof computeCharacterDerived>;
  try {
    d = computeCharacterDerived(c);
  } catch {
    return `${c.name} — ${classes || 'class unknown'} | HP ${c.currentHP ?? '?'}/${c.maxHP ?? '?'}\n`
      + 'Their sheet reached the table incomplete, so no ability scores, attacks or spells are available. '
      + 'Play them cautiously and do NOT invent numbers for them — ask the table to re-send the sheet.';
  }

  const lines: string[] = [];
  lines.push(
    `${c.name} — L${d.totalLevel} ${classes} | AC ${d.ac} | HP ${c.currentHP}/${c.maxHP} | Speed ${d.speed} | Init ${fmt(d.initiative)} | Prof ${fmt(d.profBonus)}`
  );

  // Race AND the racial CHOICES that decide real mechanics — Draconic
  // Ancestry, Fiendish Legacy, Giant Ancestry and kin.
  //
  // memory/party.md already carries the bare race ("Level 5 Dragonborn
  // Fighter") on every turn, but NOTHING has ever carried these picks to the
  // DM — not party.md, not this digest. That gap is mechanical, not
  // cosmetic: a dragonborn's ancestry is what decides their breath weapon's
  // damage type, its shape, and which saving throw it calls for, so an
  // unqualified "Dragonborn" leaves the DM unable to resolve the ability
  // correctly even in principle. Reported live: a bronze dragonborn's breath
  // weapon was narrated as a weapon swing and resolved as an attack roll.
  const raceName = getRace(c.raceId)?.name ?? c.raceId;
  const racePicks = raceOptionGroups(c.raceId, d.totalLevel)
    .map((g) => {
      const chosen = g.options.find((o) => o.value === c.raceOptions?.[g.key]);
      return chosen ? `${g.label}: ${chosen.label}` : null;
    })
    .filter((p): p is string => !!p);
  if (raceName?.trim()) {
    lines.push(`Race: ${raceName}${racePicks.length ? ` (${racePicks.join('; ')})` : ''}`);
  }

  lines.push(
    ABILITY_ORDER.map((k) => `${k.toUpperCase()} ${d.finalScores[k] ?? 10} (${fmt(d.mods[k] ?? 0)})`).join('  ')
  );

  const saves = ABILITY_ORDER.filter((k) => d.savingThrowProficiencies.has(k));
  if (saves.length) {
    lines.push(`Saves (proficient): ${saves.map((k) => `${k.toUpperCase()} ${fmt(d.savingThrows[k] ?? 0)}`).join(', ')}`);
  }

  const skills = [...d.allSkillProficiencies].sort();
  if (skills.length) {
    lines.push(`Skills: ${skills.map((s) => `${s} ${fmt(d.skills[s] ?? 0)}`).join(', ')}`);
  }

  // Same to-hit/damage derivation printSheet.ts uses, so the DM's numbers and
  // the printed sheet's numbers can't disagree.
  const weapons = (c.inventory ?? []).filter((i) => i.equipped && i.category === 'weapon');
  if (weapons.length) {
    const atks = weapons.map((item) => {
      const w = lookupWeapon(item.name);
      const abilMod = w?.ability === 'finesse'
        ? Math.max(d.mods.str ?? 0, d.mods.dex ?? 0)
        : (w?.ability === 'dex' || w?.ranged) ? (d.mods.dex ?? 0) : (d.mods.str ?? 0);
      const dmg = w ? `${damageLine(w.damageDice, abilMod)} ${w.damageType ?? ''}`.trim() : '?';
      return `${item.name} ${fmt(abilMod + d.profBonus)} (${dmg})`;
    });
    lines.push(`Attacks: ${atks.join(', ')}`);
  }

  const slots = Object.entries(d.slotTotals)
    .filter(([, total]) => (total ?? 0) > 0)
    .map(([lvl, total]) => {
      const used = (c.spellSlotsUsed as Record<string, number> | undefined)?.[lvl] ?? 0;
      return `L${lvl} ${Math.max(0, (total ?? 0) - used)}/${total}`;
    });
  if (d.spellSaveDC !== undefined && d.spellcastingAbility) {
    const cast = `Spellcasting: ${String(d.spellcastingAbility).toUpperCase()}, save DC ${d.spellSaveDC}, attack ${fmt(d.spellAttackBonus ?? 0)}`;
    lines.push(slots.length ? `${cast}. Slots remaining: ${slots.join(', ')}` : cast);
  }
  if (c.pactMagic) {
    const pm = c.pactMagic;
    lines.push(`Pact magic: ${Math.max(0, pm.slotsTotal - pm.slotsUsed)}/${pm.slotsTotal} slots at level ${pm.slotLevel}`);
  }

  // Names only. The DM knows what Fireball does; what it can't know is which
  // spells this particular character actually has ready.
  const prepared = (c.spellbook ?? [])
    .filter((s) => s.isPrepared || s.isAlwaysPrepared)
    .map((s) => getSpell(s.spellId)?.name)
    .filter((n): n is string => !!n);
  if (prepared.length) lines.push(`Prepared/known: ${prepared.join(', ')}`);

  const resources = (c.resources ?? []).filter((r) => r.max > 0);
  if (resources.length) {
    lines.push(`Resources: ${resources.map((r) => `${humanize(r.key)} ${r.current}/${r.max}`).join(', ')}`);
  }

  // Charged magic items are the things most likely to be spent on the owner's
  // behalf by mistake, so name them explicitly rather than leaving them buried
  // in an inventory the DM never sees.
  const charged = (c.inventory ?? []).filter((i) => (i.maxCharges ?? 0) > 0);
  if (charged.length) {
    lines.push(`Charged items: ${charged.map((i) => `${i.name} ${i.charges ?? 0}/${i.maxCharges}`).join(', ')}`);
  }

  return lines.join('\n');
}
