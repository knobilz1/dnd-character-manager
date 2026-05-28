/**
 * fillCharacterPDF.ts
 *
 * Fills the official WotC D&D 5E fillable character sheet PDF with character data.
 * Accepts the template PDF as a Uint8Array and returns the filled PDF bytes.
 *
 * Field names are derived directly from the PDF form (confirmed via pypdf inspection).
 */
import { PDFDocument, PDFCheckBox, PDFTextField } from 'pdf-lib';
import type { Character } from '../types';
import { computeCharacterDerived } from '../hooks/useCharacterDerived';
import { getRace } from '../data/races';
import { getClass } from '../data/classes';
import { ALL_SUBCLASSES } from '../data/subclasses';
import { getBackground } from '../data/backgrounds';
import { getSpell } from '../data/spells';
import { lookupWeapon, damageLine } from '../data/weapons';

function fmt(n: number) { return n >= 0 ? `+${n}` : String(n); }

// Safe field setter — silently skips if field is missing or wrong type
function setTextField(form: ReturnType<PDFDocument['getForm']>, name: string, value: string | number) {
  try {
    const field = form.getField(name);
    if (field instanceof PDFTextField) {
      field.setText(String(value ?? ''));
    }
  } catch {
    // field doesn't exist or wrong type — skip
  }
}

function setCheckBox(form: ReturnType<PDFDocument['getForm']>, name: string, checked: boolean) {
  try {
    const field = form.getField(name);
    if (field instanceof PDFCheckBox) {
      if (checked) field.check(); else field.uncheck();
    }
  } catch {
    // skip
  }
}

// Check box names mapped from the PDF field inspection (cy coordinates matched to skill/save positions)
// Saving throw proficiency checkboxes:
const SAVE_CHECKBOXES: Record<string, string> = {
  str: 'Check Box 11',
  dex: 'Check Box 18',
  con: 'Check Box 19',
  int: 'Check Box 20',
  wis: 'Check Box 21',
  cha: 'Check Box 22',
};
// Skill proficiency checkboxes (cy matched to skill field cy):
const SKILL_CHECKBOXES: Record<string, string> = {
  'Acrobatics':      'Check Box 23',
  'Animal Handling': 'Check Box 24',
  'Arcana':          'Check Box 25',
  'Athletics':       'Check Box 26',
  'Deception':       'Check Box 27',
  'History':         'Check Box 28',
  'Insight':         'Check Box 29',
  'Intimidation':    'Check Box 30',
  'Investigation':   'Check Box 31',
  'Medicine':        'Check Box 32',
  'Nature':          'Check Box 33',
  'Perception':      'Check Box 34',
  'Performance':     'Check Box 35',
  'Persuasion':      'Check Box 36',
  'Religion':        'Check Box 37',
  'Sleight of Hand': 'Check Box 38',
  'Stealth':         'Check Box 39',
  'Survival':        'Check Box 40',
};
// Death save checkboxes (successes = 12,13,14 / failures = 15,16,17)
const DS_SUCCESS = ['Check Box 12', 'Check Box 13', 'Check Box 14'];
const DS_FAILURE = ['Check Box 15', 'Check Box 16', 'Check Box 17'];

// Spell field mapping: level → [slot count field, slot expended field, spell name fields]
// SlotsTotal 19-27 = levels 1-9; SlotsRemaining 19-27 = remaining slots
// Spell name fields for each level (from Spells 10xx series):
const SPELL_SLOTS: Record<number, { total: string; remaining: string }> = {
  1: { total: 'SlotsTotal 19', remaining: 'SlotsRemaining 19' },
  2: { total: 'SlotsTotal 20', remaining: 'SlotsRemaining 20' },
  3: { total: 'SlotsTotal 21', remaining: 'SlotsRemaining 21' },
  4: { total: 'SlotsTotal 22', remaining: 'SlotsRemaining 22' },
  5: { total: 'SlotsTotal 23', remaining: 'SlotsRemaining 23' },
  6: { total: 'SlotsTotal 24', remaining: 'SlotsRemaining 24' },
  7: { total: 'SlotsTotal 25', remaining: 'SlotsRemaining 25' },
  8: { total: 'SlotsTotal 26', remaining: 'SlotsRemaining 26' },
  9: { total: 'SlotsTotal 27', remaining: 'SlotsRemaining 27' },
};
// Spell name fields by level (confirmed from PDF field numbering):
// Level 0 (cantrips): Spells 1014-1021 (8 slots)
// Level 1: Spells 1022-1033 (12 slots, with prepared checkbox from Check Box 30xx series on page 3)
// The spell name fields for each level:
const SPELL_NAME_FIELDS: Record<number, string[]> = {
  0:  ['Spells 1014','Spells 1015','Spells 1016','Spells 1017','Spells 1018','Spells 1019','Spells 1020','Spells 1021'],
  1:  ['Spells 1022','Spells 1023','Spells 1024','Spells 1025','Spells 1026','Spells 1027','Spells 1028','Spells 1029','Spells 1030','Spells 1031','Spells 1032','Spells 1033'],
  2:  ['Spells 1034','Spells 1035','Spells 1036','Spells 1037','Spells 1038','Spells 1039','Spells 1040','Spells 1041','Spells 1042','Spells 1043','Spells 1044','Spells 1045','Spells 1046'],
  3:  ['Spells 1047','Spells 1048','Spells 1049','Spells 1050','Spells 1051','Spells 1052','Spells 1053','Spells 1054','Spells 1055','Spells 1056','Spells 1057','Spells 1058','Spells 1059'],
  4:  ['Spells 1060','Spells 1061','Spells 1062','Spells 1063','Spells 1064','Spells 1065','Spells 1066','Spells 1067','Spells 1068','Spells 1069','Spells 1070','Spells 1071','Spells 1072'],
  5:  ['Spells 1073','Spells 1074','Spells 1075','Spells 1076','Spells 1077','Spells 1078','Spells 1079','Spells 1080','Spells 1081'],
  6:  ['Spells 1082','Spells 1083','Spells 1084','Spells 1085','Spells 1086','Spells 1087','Spells 1088','Spells 1089','Spells 1090'],
  7:  ['Spells 1091','Spells 1092','Spells 1093','Spells 1094','Spells 1095','Spells 1096','Spells 1097','Spells 1098','Spells 1099'],
  8:  ['Spells 10100','Spells 10101','Spells 10102','Spells 10103','Spells 10104','Spells 10105','Spells 10106'],
  9:  ['Spells 10107','Spells 10108','Spells 10109','Spells 101010','Spells 101011','Spells 101012','Spells 101013'],
};

export async function fillCharacterPDF(character: Character, templateBytes: Uint8Array): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: true });
  const form = pdfDoc.getForm();

  // Compute all derived stats
  const d = computeCharacterDerived(character);
  const race = getRace(character.raceId);
  const primary = character.classes[0];
  const classDef = primary ? getClass(primary.classId) : null;
  const subclass = primary?.subclassId
    ? ALL_SUBCLASSES.find(s => s.id === primary.subclassId)
    : null;
  const bg = getBackground(character.backgroundId);

  const multiclassLabel = character.classes.length > 1
    ? character.classes.map(cl => `${getClass(cl.classId)?.name ?? cl.classId} ${cl.level}`).join(' / ')
    : `${classDef?.name ?? ''} ${primary?.level ?? ''}`;

  // ── PAGE 1: Character Info ────────────────────────────────────────────────

  setTextField(form, 'CharacterName', character.name);
  setTextField(form, 'ClassLevel', multiclassLabel);
  setTextField(form, 'Background', bg?.name ?? '');
  setTextField(form, 'PlayerName', character.playerName);
  setTextField(form, 'Race ', race?.name ?? '');
  setTextField(form, 'Alignment', character.alignment);
  setTextField(form, 'XP', character.experiencePoints ?? 0);

  // ── Ability Scores ────────────────────────────────────────────────────────

  const scores = d.finalScores;
  const mods = d.mods;
  setTextField(form, 'STR',     scores.str);
  setTextField(form, 'STRmod',  fmt(mods.str));
  setTextField(form, 'DEX',     scores.dex);
  setTextField(form, 'DEXmod ', fmt(mods.dex));
  setTextField(form, 'CON',     scores.con);
  setTextField(form, 'CONmod',  fmt(mods.con));
  setTextField(form, 'INT',     scores.int);
  setTextField(form, 'INTmod',  fmt(mods.int));
  setTextField(form, 'WIS',     scores.wis);
  setTextField(form, 'WISmod',  fmt(mods.wis));
  setTextField(form, 'CHA',     scores.cha);
  setTextField(form, 'CHamod',  fmt(mods.cha));

  // ── Inspiration / Prof Bonus ───────────────────────────────────────────────

  // Inspiration is a text field in the PDF (not a checkbox)
  setTextField(form, 'Inspiration', character.inspiration ? '✓' : '');
  setTextField(form, 'ProfBonus', fmt(d.profBonus));

  // ── Combat Stats ─────────────────────────────────────────────────────────

  setTextField(form, 'AC', d.ac);
  setTextField(form, 'Initiative', fmt(d.initiative));
  setTextField(form, 'Speed', `${d.speed} ft`);

  // ── Hit Points ────────────────────────────────────────────────────────────

  setTextField(form, 'HPMax', character.maxHP);
  setTextField(form, 'HPCurrent', character.currentHP);
  setTextField(form, 'HPTemp', character.tempHP > 0 ? character.tempHP : '');

  // Hit Dice
  const hdStr = character.classes.map(cl => {
    const def = getClass(cl.classId);
    return `d${def?.hitDie ?? '?'}`;
  }).join('/');
  const hdTotal = character.classes.map(cl => {
    const spent = (character.hitDiceUsed ?? {})[cl.classId] ?? 0;
    const def = getClass(cl.classId);
    return `${cl.level - spent}/${cl.level}d${def?.hitDie ?? '?'}`;
  }).join(', ');
  setTextField(form, 'HD', hdStr);
  setTextField(form, 'HDTotal', hdTotal);

  // ── Death Saves ───────────────────────────────────────────────────────────

  const successes = character.deathSaves?.successes ?? 0;
  const failures  = character.deathSaves?.failures  ?? 0;
  DS_SUCCESS.forEach((cb, i) => setCheckBox(form, cb, i < successes));
  DS_FAILURE.forEach((cb, i) => setCheckBox(form, cb, i < failures));

  // ── Saving Throws ─────────────────────────────────────────────────────────

  const savingThrows = d.savingThrows as Record<string, number>;
  const saveProfSet = d.savingThrowProficiencies;

  setTextField(form, 'ST Strength',     fmt(savingThrows.str ?? 0));
  setTextField(form, 'ST Dexterity',    fmt(savingThrows.dex ?? 0));
  setTextField(form, 'ST Constitution', fmt(savingThrows.con ?? 0));
  setTextField(form, 'ST Intelligence', fmt(savingThrows.int ?? 0));
  setTextField(form, 'ST Wisdom',       fmt(savingThrows.wis ?? 0));
  setTextField(form, 'ST Charisma',     fmt(savingThrows.cha ?? 0));

  // Saving throw proficiency checkboxes
  for (const [key, cbName] of Object.entries(SAVE_CHECKBOXES)) {
    setCheckBox(form, cbName, saveProfSet.has(key as any));
  }

  // ── Skills ────────────────────────────────────────────────────────────────

  const skills = d.skills;
  const skillProfSet = d.allSkillProficiencies;

  setTextField(form, 'Acrobatics',     fmt(skills['Acrobatics']     ?? 0));
  setTextField(form, 'Animal',         fmt(skills['Animal Handling'] ?? 0));
  setTextField(form, 'Arcana',         fmt(skills['Arcana']         ?? 0));
  setTextField(form, 'Athletics',      fmt(skills['Athletics']      ?? 0));
  setTextField(form, 'Deception ',     fmt(skills['Deception']      ?? 0));
  setTextField(form, 'History ',       fmt(skills['History']        ?? 0));
  setTextField(form, 'Insight',        fmt(skills['Insight']        ?? 0));
  setTextField(form, 'Intimidation',   fmt(skills['Intimidation']   ?? 0));
  setTextField(form, 'Investigation ', fmt(skills['Investigation']  ?? 0));
  setTextField(form, 'Medicine',       fmt(skills['Medicine']       ?? 0));
  setTextField(form, 'Nature',         fmt(skills['Nature']         ?? 0));
  setTextField(form, 'Perception ',    fmt(skills['Perception']     ?? 0));
  setTextField(form, 'Performance',    fmt(skills['Performance']    ?? 0));
  setTextField(form, 'Persuasion',     fmt(skills['Persuasion']     ?? 0));
  setTextField(form, 'Religion',       fmt(skills['Religion']       ?? 0));
  setTextField(form, 'SleightofHand',  fmt(skills['Sleight of Hand'] ?? 0));
  setTextField(form, 'Stealth ',       fmt(skills['Stealth']        ?? 0));
  setTextField(form, 'Survival',       fmt(skills['Survival']       ?? 0));

  // Skill proficiency checkboxes
  for (const [skillName, cbName] of Object.entries(SKILL_CHECKBOXES)) {
    setCheckBox(form, cbName, skillProfSet.has(skillName));
  }

  // ── Passive Perception ────────────────────────────────────────────────────

  setTextField(form, 'Passive', d.passivePerception);

  // ── Proficiencies & Languages ─────────────────────────────────────────────

  const proficiencies: string[] = [];
  if (bg?.toolProficiencies?.length)  proficiencies.push(...bg.toolProficiencies);
  if (classDef?.weaponProficiencies)  proficiencies.push(...classDef.weaponProficiencies);
  if (classDef?.armorProficiencies)   proficiencies.push(...classDef.armorProficiencies);
  if (race?.proficiencies?.length)    proficiencies.push(...race.proficiencies);
  const languages = race?.languages ?? [];
  const profLangText = [
    proficiencies.length ? `Proficiencies: ${proficiencies.join(', ')}` : '',
    languages.length     ? `Languages: ${languages.join(', ')}` : '',
  ].filter(Boolean).join('\n');
  setTextField(form, 'ProficienciesLang', profLangText);

  // ── Attacks & Weapons ─────────────────────────────────────────────────────

  const equipped = (character.inventory ?? []).filter((i: any) => i.equipped && i.category === 'weapon');
  const weaponFields = [
    { name: 'Wpn Name',   atk: 'Wpn1 AtkBonus',    dmg: 'Wpn1 Damage'   },
    { name: 'Wpn Name 2', atk: 'Wpn2 AtkBonus ',   dmg: 'Wpn2 Damage '  },
    { name: 'Wpn Name 3', atk: 'Wpn3 AtkBonus  ',  dmg: 'Wpn3 Damage '  },
  ];
  weaponFields.forEach((wf, i) => {
    const item = equipped[i];
    if (!item) return;
    const w = lookupWeapon(item.name);
    const abilMod = w?.ability === 'finesse'
      ? Math.max(mods.str, mods.dex)
      : (w?.ability === 'dex' || w?.ranged) ? mods.dex : mods.str;
    const toHit = abilMod + d.profBonus;
    const dmg = w ? damageLine(w.damageDice, abilMod) : '—';
    const type = w?.damageType ?? '';
    setTextField(form, wf.name, item.name);
    setTextField(form, wf.atk,  fmt(toHit));
    setTextField(form, wf.dmg,  type ? `${dmg} ${type}` : dmg);
  });

  // AttacksSpellcasting: extra weapons + spell attack info
  const extraWeapons = equipped.slice(3).map((item: any) => {
    const w = lookupWeapon(item.name);
    const abilMod = w?.ability === 'finesse'
      ? Math.max(mods.str, mods.dex)
      : (w?.ability === 'dex' || w?.ranged) ? mods.dex : mods.str;
    return `${item.name}: ${fmt(abilMod + d.profBonus)} to hit`;
  });
  if (d.spellSaveDC > 0) {
    extraWeapons.push(`Spell Save DC: ${d.spellSaveDC}  Spell Attack: ${fmt(d.spellAttackBonus)}`);
  }
  if (extraWeapons.length) setTextField(form, 'AttacksSpellcasting', extraWeapons.join('\n'));

  // ── Equipment ────────────────────────────────────────────────────────────

  const allItems = (character.inventory ?? []);
  const equipLines = allItems.map((i: any) =>
    `${i.name}${(i.quantity ?? 1) > 1 ? ` ×${i.quantity}` : ''}${i.equipped ? ' ✦' : ''}`
  );
  setTextField(form, 'Equipment', equipLines.join('\n'));

  // Currency
  const cur = character.currencies ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  if (cur.cp) setTextField(form, 'CP', cur.cp);
  if (cur.sp) setTextField(form, 'SP', cur.sp);
  if (cur.ep) setTextField(form, 'EP', cur.ep);
  if (cur.gp) setTextField(form, 'GP', cur.gp);
  if (cur.pp) setTextField(form, 'PP', cur.pp);

  // ── Personality / Traits ──────────────────────────────────────────────────

  const bgPT = (bg?.personalityTraits ?? []).join('\n');
  const bgI  = (bg?.ideals ?? []).join('\n');
  const bgB  = (bg?.bonds  ?? []).join('\n');
  const bgF  = (bg?.flaws  ?? []).join('\n');
  setTextField(form, 'PersonalityTraits ', bgPT);
  setTextField(form, 'Ideals', bgI);
  setTextField(form, 'Bonds',  bgB);
  setTextField(form, 'Flaws',  bgF);

  // ── Features & Traits ─────────────────────────────────────────────────────

  const featureLines: string[] = [];
  (race?.traits ?? []).forEach(t => featureLines.push(`${t.name}: ${t.description}`));
  if (classDef && primary) {
    classDef.features
      .filter((f: any) => f.level <= primary.level && !f.isASI)
      .forEach((f: any) => featureLines.push(`${f.name} (${classDef.name}): ${f.description}`));
  }
  if (subclass && primary) {
    subclass.features
      .filter((f: any) => f.level <= primary.level)
      .forEach((f: any) => featureLines.push(`${f.name} (${subclass.name}): ${f.description}`));
  }
  setTextField(form, 'Features and Traits', featureLines.join('\n\n'));

  // ── PAGE 3: Spells ────────────────────────────────────────────────────────

  const spellbook = character.spellbook ?? [];
  if (spellbook.length > 0) {
    // Spellcasting header
    setTextField(form, 'Spellcasting Class 2', classDef?.name ?? '');
    if (classDef?.spellcastingAbility) {
      setTextField(form, 'SpellcastingAbility 2',
        classDef.spellcastingAbility.toUpperCase());
    }
    setTextField(form, 'SpellSaveDC  2',  d.spellSaveDC > 0 ? d.spellSaveDC : '');
    setTextField(form, 'SpellAtkBonus 2', d.spellSaveDC > 0 ? fmt(d.spellAttackBonus) : '');

    // Spell slots
    for (let lvl = 1; lvl <= 9; lvl++) {
      const total = d.slotTotals[lvl] ?? 0;
      if (!total) continue;
      const used  = (character.spellSlotsUsed ?? {})[lvl as 1] ?? 0;
      const remaining = total - used;
      const sf = SPELL_SLOTS[lvl];
      if (sf) {
        setTextField(form, sf.total,     total);
        setTextField(form, sf.remaining, remaining);
      }
    }

    // Spell names — group by level
    const byLevel: Record<number, string[]> = {};
    spellbook.forEach((sp: any) => {
      const spell = getSpell(sp.spellId);
      if (!spell) return;
      const lvl = spell.level;
      if (!byLevel[lvl]) byLevel[lvl] = [];
      const suffix = [
        spell.concentration ? '(C)' : '',
        spell.ritual ? '(R)' : '',
        !sp.isPrepared && !sp.isAlwaysPrepared && lvl > 0 ? '(unprepared)' : '',
      ].filter(Boolean).join(' ');
      byLevel[lvl].push(suffix ? `${spell.name} ${suffix}` : spell.name);
    });

    for (const [lvlStr, names] of Object.entries(byLevel)) {
      const lvl = Number(lvlStr);
      const fields = SPELL_NAME_FIELDS[lvl] ?? [];
      names.slice(0, fields.length).forEach((name, i) => {
        setTextField(form, fields[i], name);
      });
    }
  }

  // Flatten form so it renders correctly in all PDF viewers
  form.flatten();

  const filledBytes = await pdfDoc.save();
  return filledBytes;
}
