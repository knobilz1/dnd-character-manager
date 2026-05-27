/**
 * printSheet.ts — generates a self-contained, print-optimised HTML character sheet.
 *
 * Call generateCharacterSheetHTML() with the character + derived values already
 * computed in SheetPage, then writeTextFile + openPath to let the user print/save-as-PDF
 * from their default browser.
 */
import type { Character } from '../types';
import { getRace } from '../data/races';
import { getClass } from '../data/classes';
import { ALL_SUBCLASSES } from '../data/subclasses';
import { getBackground } from '../data/backgrounds';
import { getSpell } from '../data/spells';
import { lookupWeapon, damageLine } from '../data/weapons';
import { totalCharacterLevel } from '../data/mechanics';

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) { return n >= 0 ? `+${n}` : String(n); }
function esc(s: string) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function pip(filled: boolean) {
  return `<span class="pip${filled ? ' pip-filled' : ''}">${filled ? '●' : '○'}</span>`;
}

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const ABILITY_LABELS: Record<string, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};
const SKILL_LIST: { name: string; ability: string }[] = [
  { name: 'Acrobatics', ability: 'dex' }, { name: 'Animal Handling', ability: 'wis' },
  { name: 'Arcana', ability: 'int' },      { name: 'Athletics', ability: 'str' },
  { name: 'Deception', ability: 'cha' },   { name: 'History', ability: 'int' },
  { name: 'Insight', ability: 'wis' },     { name: 'Intimidation', ability: 'cha' },
  { name: 'Investigation', ability: 'int' },{ name: 'Medicine', ability: 'wis' },
  { name: 'Nature', ability: 'int' },      { name: 'Perception', ability: 'wis' },
  { name: 'Performance', ability: 'cha' }, { name: 'Persuasion', ability: 'cha' },
  { name: 'Religion', ability: 'int' },    { name: 'Sleight of Hand', ability: 'dex' },
  { name: 'Stealth', ability: 'dex' },     { name: 'Survival', ability: 'wis' },
];

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif;
    font-size: 9pt;
    color: #1a1a1a;
    background: #fff;
    padding: 0.4in;
  }
  h1 { font-size: 18pt; font-weight: 700; letter-spacing: 0.5px; }
  h2 { font-size: 7pt; font-weight: 700; text-transform: uppercase;
       letter-spacing: 1.5px; color: #5a0000; border-bottom: 1px solid #5a0000;
       padding-bottom: 2px; margin-bottom: 6px; }
  h3 { font-size: 8pt; font-weight: 700; margin-bottom: 3px; }
  .page { max-width: 100%; }

  /* ── Top header ── */
  .header { display: flex; align-items: flex-end; gap: 18px; margin-bottom: 12px;
            border-bottom: 2px solid #5a0000; padding-bottom: 8px; }
  .header .char-name { flex: 1; }
  .header .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 12px;
                  font-size: 8pt; }
  .meta-field { display: flex; flex-direction: column; }
  .meta-field .label { font-size: 7pt; color: #666; text-transform: uppercase; letter-spacing: 1px; }
  .meta-field .val { font-weight: 600; border-bottom: 1px solid #bbb; min-width: 90px; }

  /* ── Three-column body ── */
  .body { display: grid; grid-template-columns: 120px 1fr 1fr; gap: 10px; }

  /* ── Ability scores ── */
  .abilities { display: flex; flex-direction: column; gap: 4px; }
  .ability-box {
    border: 1.5px solid #5a0000; border-radius: 5px; text-align: center;
    padding: 4px 2px; background: #fffaf5;
  }
  .ability-box .ab-name { font-size: 6pt; text-transform: uppercase; letter-spacing: 1px; color: #5a0000; }
  .ability-box .ab-mod  { font-size: 14pt; font-weight: 700; line-height: 1.1; }
  .ability-box .ab-score{ font-size: 7pt; color: #555; }

  /* ── Left column sub-sections ── */
  .left-section { border: 1px solid #c0a060; border-radius: 4px; padding: 5px 6px;
                  margin-top: 6px; background: #fffaf5; }
  .proficiency-bonus { text-align: center; border: 1.5px solid #5a0000; border-radius: 4px;
                       padding: 4px; margin-bottom: 6px; background: #fffaf5; }
  .proficiency-bonus .pb-val { font-size: 14pt; font-weight: 700; }
  .proficiency-bonus .pb-label { font-size: 6.5pt; text-transform: uppercase; letter-spacing: 1px; color: #5a0000; }

  /* ── Saving throws / skills ── */
  .check-row { display: flex; align-items: center; gap: 4px; margin-bottom: 1.5px; font-size: 8pt; }
  .check-row .pip { font-size: 9pt; line-height: 1; }
  .pip-filled { color: #5a0000; }
  .check-row .bonus { margin-left: auto; font-weight: 600; min-width: 22px; text-align: right; }
  .check-row .skill-ab { font-size: 6.5pt; color: #777; margin-left: 2px; }

  /* ── Middle / right column boxes ── */
  .stat-row { display: flex; gap: 6px; margin-bottom: 8px; }
  .stat-box { border: 1.5px solid #5a0000; border-radius: 4px; text-align: center;
              padding: 4px 8px; background: #fffaf5; flex: 1; }
  .stat-box .s-label { font-size: 6pt; text-transform: uppercase; letter-spacing: 1px; color: #5a0000; }
  .stat-box .s-val   { font-size: 13pt; font-weight: 700; }

  .hp-section { border: 1.5px solid #5a0000; border-radius: 4px; padding: 6px;
                background: #fffaf5; margin-bottom: 8px; }
  .hp-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; }
  .hp-field { text-align: center; }
  .hp-field .hf-label { font-size: 6.5pt; text-transform: uppercase; letter-spacing: 1px; color: #5a0000; }
  .hp-field .hf-val   { font-size: 14pt; font-weight: 700; }

  .death-row { display: flex; align-items: center; gap: 8px; font-size: 8pt; margin-top: 6px; }
  .death-label { font-size: 7pt; text-transform: uppercase; letter-spacing: 1px; color: #5a0000; }

  /* ── Attacks table ── */
  .attacks-table { width: 100%; border-collapse: collapse; font-size: 8pt; margin-top: 4px; }
  .attacks-table th { font-size: 7pt; text-transform: uppercase; letter-spacing: 1px;
                      color: #5a0000; border-bottom: 1px solid #5a0000; padding: 2px 3px; text-align: left; }
  .attacks-table td { padding: 2px 3px; border-bottom: 1px solid #e0d0b0; }
  .attacks-table tr:last-child td { border-bottom: none; }

  /* ── Spell slots ── */
  .slot-grid { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; }
  .slot-level { display: flex; align-items: center; gap: 4px; font-size: 8pt; }
  .slot-pips { display: flex; gap: 2px; }
  .slot-pip { width: 10px; height: 10px; border-radius: 50%; border: 1px solid #5a0000;
              display: inline-block; background: #fffaf5; }
  .slot-pip.used { background: #5a0000; }

  /* ── Features / traits ── */
  .feature-item { margin-bottom: 5px; }
  .feature-item .fi-name { font-size: 8pt; font-weight: 700; }
  .feature-item .fi-source { font-size: 7pt; color: #777; }
  .feature-item .fi-desc { font-size: 7.5pt; color: #333; margin-top: 1px; line-height: 1.4;
                           max-height: 3.5em; overflow: hidden; }

  /* ── Notes / journal ── */
  .notes-box { border: 1px solid #c0a060; border-radius: 4px; padding: 6px;
               background: #fffaf5; min-height: 80px; font-size: 8pt; white-space: pre-wrap;
               line-height: 1.5; }
  .journal-entry { border-bottom: 1px solid #e0d0b0; padding-bottom: 6px; margin-bottom: 6px; }
  .journal-entry:last-child { border-bottom: none; }
  .je-header { font-size: 7.5pt; font-weight: 700; margin-bottom: 2px; }
  .je-meta { font-size: 7pt; color: #777; margin-bottom: 3px; }
  .je-content { font-size: 8pt; white-space: pre-wrap; line-height: 1.4; }

  /* ── Spells page ── */
  .page-break { page-break-before: always; padding-top: 0.4in; }
  .spells-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .spell-level-section { margin-bottom: 8px; }
  .spell-row { display: flex; align-items: baseline; gap: 6px; font-size: 8pt;
               padding: 2px 0; border-bottom: 1px solid #f0e8d8; }
  .spell-row:last-child { border-bottom: none; }
  .spell-row .sp-name { flex: 1; }
  .spell-row .sp-school { font-size: 7pt; color: #777; }
  .spell-row .sp-conc { font-size: 7pt; color: #b06000; }
  .spell-stats { display: flex; gap: 10px; margin-bottom: 8px; font-size: 8pt; }
  .spell-stat { display: flex; flex-direction: column; align-items: center;
                border: 1px solid #c0a060; border-radius: 4px; padding: 3px 8px; background: #fffaf5; }
  .spell-stat .ss-label { font-size: 6.5pt; text-transform: uppercase; letter-spacing: 1px; color: #5a0000; }
  .spell-stat .ss-val   { font-size: 11pt; font-weight: 700; }

  @media print {
    @page { margin: 0.4in; size: letter; }
    body { padding: 0; }
    .no-print { display: none; }
  }
`;

// ── section builders ──────────────────────────────────────────────────────────

function buildAbilityScores(mods: Record<string, number>, finalScores: Record<string, number>): string {
  return `
    <div class="abilities">
      ${ABILITY_KEYS.map(k => `
        <div class="ability-box">
          <div class="ab-name">${ABILITY_LABELS[k].slice(0, 3)}</div>
          <div class="ab-mod">${fmt(mods[k] ?? 0)}</div>
          <div class="ab-score">${finalScores[k] ?? 10}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function buildSavingThrows(
  savingThrows: Record<string, number>,
  profSet: Set<string>,
): string {
  return `
    <div class="left-section">
      <h2>Saving Throws</h2>
      ${ABILITY_KEYS.map(k => `
        <div class="check-row">
          ${pip(profSet.has(k))}
          <span>${ABILITY_LABELS[k].slice(0, 3)}</span>
          <span class="bonus">${fmt(savingThrows[k] ?? 0)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function buildSkills(
  skills: Record<string, number>,
  profSet: Set<string>,
): string {
  return `
    <div class="left-section">
      <h2>Skills</h2>
      ${SKILL_LIST.map(s => `
        <div class="check-row">
          ${pip(profSet.has(s.name))}
          <span>${esc(s.name)}</span>
          <span class="skill-ab">(${s.ability.toUpperCase()})</span>
          <span class="bonus">${fmt(skills[s.name] ?? 0)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function buildAttacksTable(character: Character, mods: Record<string, number>, profBonus: number): string {
  const equipped = (character.inventory ?? []).filter((i: any) => i.equipped && i.category === 'weapon');
  if (equipped.length === 0) return '';

  const rows = equipped.map((item: any) => {
    const w = lookupWeapon(item.name);
    const abilityMod = w?.ability === 'finesse' ? Math.max(mods.str ?? 0, mods.dex ?? 0)
      : (w?.ability === 'dex' || w?.ranged) ? (mods.dex ?? 0) : (mods.str ?? 0);
    const toHit = abilityMod + profBonus;
    const dmg = w ? damageLine(w.damageDice, abilityMod) : '—';
    const type = w?.damageType ?? '—';
    return `
      <tr>
        <td>${esc(item.name)}</td>
        <td>${fmt(toHit)}</td>
        <td>${esc(dmg)}</td>
        <td>${esc(type)}</td>
      </tr>
    `;
  }).join('');

  return `
    <div style="margin-bottom:8px;">
      <h2>Attacks &amp; Spellcasting</h2>
      <table class="attacks-table">
        <thead><tr><th>Name</th><th>ATK Bonus</th><th>Damage</th><th>Type</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function buildSpellSlots(
  slotTotals: Record<number, number>,
  spellSlotsUsed: Record<number, number>,
  pactMagic: any,
): string {
  const hasSlots = Object.values(slotTotals).some(v => (v as number) > 0) || pactMagic;
  if (!hasSlots) return '';

  const rows: string[] = [];

  if (pactMagic) {
    const pips = Array.from({ length: pactMagic.slotsTotal }, (_, i) =>
      `<span class="slot-pip${i < pactMagic.slotsUsed ? ' used' : ''}"></span>`
    ).join('');
    rows.push(`<div class="slot-level"><strong>Pact (L${pactMagic.slotLevel})</strong><div class="slot-pips">${pips}</div></div>`);
  }

  for (let lvl = 1; lvl <= 9; lvl++) {
    const total = slotTotals[lvl] ?? 0;
    if (total === 0) continue;
    const used = spellSlotsUsed[lvl] ?? 0;
    const pips = Array.from({ length: total }, (_, i) =>
      `<span class="slot-pip${i < used ? ' used' : ''}"></span>`
    ).join('');
    rows.push(`<div class="slot-level"><strong>L${lvl}</strong><div class="slot-pips">${pips}</div></div>`);
  }

  return `
    <div style="margin-bottom:8px;">
      <h2>Spell Slots</h2>
      <div class="slot-grid">${rows.join('')}</div>
    </div>
  `;
}

function buildFeaturesBox(character: Character): string {
  const race = getRace(character.raceId);
  const primary = character.classes[0];
  const classDef = primary ? getClass(primary.classId) : null;
  const subclass = primary?.subclassId ? ALL_SUBCLASSES.find(s => s.id === primary.subclassId) : null;

  const items: { name: string; source: string; desc: string }[] = [];

  // Racial traits
  (race?.traits ?? []).slice(0, 3).forEach(t =>
    items.push({ name: t.name, source: race!.name, desc: t.description })
  );

  // Class features (latest 4)
  if (classDef && primary) {
    classDef.features
      .filter(f => f.level <= primary.level && !f.isASI)
      .slice(-4)
      .forEach(f => items.push({ name: f.name, source: classDef.name, desc: f.description }));
  }

  // Subclass features
  if (subclass && primary) {
    subclass.features
      .filter(f => f.level <= primary.level)
      .slice(-2)
      .forEach(f => items.push({ name: f.name, source: subclass.name, desc: f.description }));
  }

  if (items.length === 0) return '';

  return `
    <div style="margin-bottom:8px;">
      <h2>Features &amp; Traits</h2>
      ${items.map(it => `
        <div class="feature-item">
          <div class="fi-name">${esc(it.name)} <span class="fi-source">(${esc(it.source)})</span></div>
          <div class="fi-desc">${esc(it.desc)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function buildSpellPage(
  character: Character,
  spellSaveDC: number,
  spellAttackBonus: number,
  slotTotals: Record<number, number>,
  spellSlotsUsed: Record<number, number>,
): string {
  const prepared = (character.spellbook ?? []).filter((sp: any) =>
    sp.isPrepared || sp.isAlwaysPrepared || (() => {
      const spell = getSpell(sp.spellId);
      return spell?.level === 0;
    })()
  );
  if (prepared.length === 0) return '';

  // Group by level
  const byLevel: Record<number, string[]> = {};
  prepared.forEach((sp: any) => {
    const spell = getSpell(sp.spellId);
    if (!spell) return;
    const lvl = spell.level;
    if (!byLevel[lvl]) byLevel[lvl] = [];
    const conc = spell.concentration ? '<span class="sp-conc">⊙</span>' : '';
    const ritual = spell.ritual ? '<span class="sp-conc">®</span>' : '';
    byLevel[lvl].push(`
      <div class="spell-row">
        <span class="sp-name">${esc(spell.name)}${conc}${ritual}</span>
        <span class="sp-school">${spell.school.slice(0, 4)}</span>
        <span>${esc(spell.castingTime.replace('1 action', 'A').replace('1 bonus action', 'BA').replace('1 reaction', 'R'))}</span>
        <span>${esc(spell.range.replace(' feet', 'ft').replace(' foot', 'ft'))}</span>
      </div>
    `);
  });

  const levelNames = ['Cantrips', '1st Level', '2nd Level', '3rd Level', '4th Level', '5th Level', '6th Level', '7th Level', '8th Level', '9th Level'];

  const sections = Object.keys(byLevel)
    .map(Number)
    .sort((a, b) => a - b)
    .map(lvl => {
      const total = slotTotals[lvl] ?? 0;
      const used = spellSlotsUsed[lvl] ?? 0;
      const slotInfo = lvl > 0 && total > 0
        ? ` <span style="font-size:7pt;color:#777;">(${total - used}/${total} slots)</span>` : '';
      return `
        <div class="spell-level-section">
          <h3>${levelNames[lvl] ?? `Level ${lvl}`}${slotInfo}</h3>
          ${byLevel[lvl].join('')}
        </div>
      `;
    }).join('');

  if (!sections) return '';

  return `
    <div class="page-break">
      <h2 style="font-size:12pt;margin-bottom:10px;">Spells</h2>
      <div class="spell-stats">
        <div class="spell-stat">
          <span class="ss-label">Save DC</span>
          <span class="ss-val">${spellSaveDC}</span>
        </div>
        <div class="spell-stat">
          <span class="ss-label">Attack Bonus</span>
          <span class="ss-val">${fmt(spellAttackBonus)}</span>
        </div>
      </div>
      <div class="spells-grid">${sections}</div>
    </div>
  `;
}

function buildJournal(character: Character): string {
  const entries = (character.journal ?? []);
  if (entries.length === 0 && !character.notes?.trim()) return '';

  const entryHtml = entries.map(e => {
    const dateLabel = e.date ? new Date(e.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const sessionLabel = e.sessionNumber != null ? `Session ${e.sessionNumber}` : '';
    const meta = [sessionLabel, dateLabel].filter(Boolean).join(' · ');
    return `
      <div class="journal-entry">
        <div class="je-header">${esc(e.title)}</div>
        ${meta ? `<div class="je-meta">${esc(meta)}</div>` : ''}
        <div class="je-content">${esc(e.content)}</div>
      </div>
    `;
  }).join('');

  const notesHtml = character.notes?.trim() ? `
    <div style="margin-top:${entries.length ? '12px' : '0'}">
      <h3>General Notes</h3>
      <div class="notes-box">${esc(character.notes)}</div>
    </div>
  ` : '';

  return `
    <div class="page-break">
      <h2 style="font-size:12pt;margin-bottom:10px;">
        Campaign Journal${character.campaignName ? ` — ${esc(character.campaignName)}` : ''}
      </h2>
      ${entryHtml}
      ${notesHtml}
    </div>
  `;
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface SheetDerivedData {
  finalScores: Record<string, number>;
  mods: Record<string, number>;
  profBonus: number;
  ac: number;
  initiative: number;
  speed: number;
  savingThrows: Record<string, number>;
  savingThrowProficiencies: Set<string>;
  skills: Record<string, number>;
  allSkillProficiencies: Set<string>;
  passivePerception: number;
  spellSaveDC: number;
  spellAttackBonus: number;
  slotTotals: Record<number, number>;
  totalLevel: number;
}

export function generateCharacterSheetHTML(
  character: Character,
  d: SheetDerivedData,
): string {
  const race = getRace(character.raceId);
  const primary = character.classes[0];
  const classDef = primary ? getClass(primary.classId) : null;
  const subclass = primary?.subclassId ? ALL_SUBCLASSES.find(s => s.id === primary.subclassId) : null;
  const bg = getBackground(character.backgroundId);
  const multiclassLabel = character.classes.length > 1
    ? character.classes.map(cl => `${getClass(cl.classId)?.name ?? cl.classId} ${cl.level}`).join(' / ')
    : `${classDef?.name ?? ''} ${primary?.level ?? ''}`;

  const totalLevel = totalCharacterLevel(character.classes);
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // ── Death save pips ──
  const dSucc = character.deathSaves?.successes ?? 0;
  const dFail = character.deathSaves?.failures ?? 0;
  const dsPips = (count: number, filled: number) =>
    Array.from({ length: count }, (_, i) => pip(i < filled)).join(' ');

  // ── Proficiencies & languages ──
  const proficiencies: string[] = [];
  if (race?.proficiencies?.length) proficiencies.push(...race.proficiencies);
  if (bg?.toolProficiencies?.length) proficiencies.push(...bg.toolProficiencies);
  if (classDef?.weaponProficiencies) proficiencies.push(...classDef.weaponProficiencies);
  if (classDef?.armorProficiencies)  proficiencies.push(...classDef.armorProficiencies);
  const langs = race?.languages ?? [];

  const spellSlotsSection = buildSpellSlots(d.slotTotals, character.spellSlotsUsed ?? {}, character.pactMagic ?? null);
  const spellPage = buildSpellPage(character, d.spellSaveDC, d.spellAttackBonus, d.slotTotals, character.spellSlotsUsed ?? {});
  const journalPage = buildJournal(character);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(character.name)} — Character Sheet</title>
<style>${CSS}</style>
</head>
<body>
<div class="page">

  <!-- ── Header ── -->
  <div class="header">
    <div class="char-name">
      <div style="font-size:7pt;text-transform:uppercase;letter-spacing:1.5px;color:#5a0000;margin-bottom:2px;">Character Name</div>
      <h1>${esc(character.name)}</h1>
    </div>
    <div class="meta">
      <div class="meta-field"><span class="label">Class &amp; Level</span><span class="val">${esc(multiclassLabel)}</span></div>
      <div class="meta-field"><span class="label">Background</span><span class="val">${esc(bg?.name ?? '—')}</span></div>
      <div class="meta-field"><span class="label">Player Name</span><span class="val">${esc(character.playerName || '—')}</span></div>
      <div class="meta-field"><span class="label">Race</span><span class="val">${esc(race?.name ?? '—')}</span></div>
      <div class="meta-field"><span class="label">Alignment</span><span class="val">${esc(character.alignment || '—')}</span></div>
      <div class="meta-field"><span class="label">Experience Points</span><span class="val">${(character.experiencePoints ?? 0).toLocaleString()}</span></div>
    </div>
  </div>

  <!-- ── Body ── -->
  <div class="body">

    <!-- Left column -->
    <div>
      ${buildAbilityScores(d.mods, d.finalScores)}

      <div class="proficiency-bonus" style="margin-top:8px;">
        <div class="pb-val">${fmt(d.profBonus)}</div>
        <div class="pb-label">Proficiency Bonus</div>
      </div>

      <div class="left-section" style="text-align:center;margin-bottom:6px;">
        <div style="font-size:7pt;text-transform:uppercase;letter-spacing:1px;color:#5a0000;">Inspiration</div>
        <div style="font-size:16pt;">${character.inspiration ? '★' : '☆'}</div>
      </div>

      ${buildSavingThrows(d.savingThrows, d.savingThrowProficiencies)}
      ${buildSkills(d.skills, d.allSkillProficiencies)}

      <div class="left-section" style="text-align:center;margin-top:6px;">
        <div style="font-size:7pt;text-transform:uppercase;letter-spacing:1px;color:#5a0000;">Passive Perception</div>
        <div style="font-size:13pt;font-weight:700;">${d.passivePerception}</div>
      </div>
    </div>

    <!-- Middle column -->
    <div>
      <!-- Core stats -->
      <div class="stat-row">
        <div class="stat-box"><div class="s-label">Armour Class</div><div class="s-val">${d.ac}</div></div>
        <div class="stat-box"><div class="s-label">Initiative</div><div class="s-val">${fmt(d.initiative)}</div></div>
        <div class="stat-box"><div class="s-label">Speed</div><div class="s-val">${d.speed} ft</div></div>
      </div>

      <!-- HP -->
      <div class="hp-section">
        <h2>Hit Points</h2>
        <div class="hp-row">
          <div class="hp-field">
            <div class="hf-label">Maximum</div>
            <div class="hf-val">${character.maxHP}</div>
          </div>
          <div class="hp-field">
            <div class="hf-label">Current</div>
            <div class="hf-val">${character.currentHP}</div>
          </div>
          <div class="hp-field">
            <div class="hf-label">Temporary</div>
            <div class="hf-val">${character.tempHP || '—'}</div>
          </div>
        </div>
        <div class="death-row">
          <span class="death-label">Death Saves</span>
          <span>Success ${dsPips(3, dSucc)}</span>
          <span style="margin-left:6px;">Failure ${dsPips(3, dFail)}</span>
        </div>
      </div>

      <!-- Hit Dice -->
      <div style="font-size:8pt;margin-bottom:8px;">
        <span style="font-size:7pt;text-transform:uppercase;letter-spacing:1px;color:#5a0000;">Hit Dice: </span>
        ${character.classes.map(cl => {
          const def = getClass(cl.classId);
          const used = (character.hitDiceUsed ?? {})[cl.classId] ?? 0;
          return `d${def?.hitDie ?? '?'} × ${cl.level - used}/${cl.level}`;
        }).join(', ')}
      </div>

      <!-- Attacks -->
      ${buildAttacksTable(character, d.mods, d.profBonus)}

      <!-- Spell slots -->
      ${spellSlotsSection}

      <!-- Conditions -->
      ${character.conditions?.length ? `
        <div style="margin-bottom:8px;">
          <h2>Conditions</h2>
          <div style="font-size:8pt;">${character.conditions.map(esc).join(', ')}</div>
          ${(character.exhaustionLevel ?? 0) > 0 ? `<div style="font-size:8pt;margin-top:2px;">Exhaustion ${character.exhaustionLevel}</div>` : ''}
        </div>
      ` : ''}

      <!-- Proficiencies & Languages -->
      <div style="margin-bottom:8px;">
        <h2>Proficiencies &amp; Languages</h2>
        <div style="font-size:8pt;line-height:1.5;">
          ${proficiencies.length ? `<div><strong>Prof:</strong> ${proficiencies.slice(0,8).map(esc).join(', ')}</div>` : ''}
          ${langs.length ? `<div><strong>Languages:</strong> ${langs.map(esc).join(', ')}</div>` : ''}
        </div>
      </div>
    </div>

    <!-- Right column -->
    <div>
      ${buildFeaturesBox(character)}

      <!-- Equipment summary -->
      ${(character.inventory ?? []).filter((i: any) => i.equipped).length ? `
        <div style="margin-bottom:8px;">
          <h2>Equipment (Equipped)</h2>
          <div style="font-size:8pt;line-height:1.6;">
            ${(character.inventory ?? []).filter((i: any) => i.equipped).map((i: any) =>
              `<div>• ${esc(i.name)}${(i.quantity ?? 1) > 1 ? ` ×${i.quantity}` : ''}</div>`
            ).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Currency -->
      <div style="margin-bottom:8px;">
        <h2>Currency</h2>
        <div style="display:flex;gap:8px;font-size:8pt;">
          ${(['pp','gp','ep','sp','cp'] as const).map(c => {
            const val = (character.currencies ?? {})[c] ?? 0;
            return val > 0 ? `<span><strong>${val}</strong> ${c}</span>` : '';
          }).filter(Boolean).join('') || '<span style="color:#777;">—</span>'}
        </div>
      </div>

      <!-- Subclass / Background blurb -->
      ${subclass ? `
        <div style="margin-bottom:8px;">
          <h2>${esc(classDef?.subclassLabel ?? 'Subclass')}: ${esc(subclass.name)}</h2>
          <div style="font-size:7.5pt;color:#333;line-height:1.4;">${esc(subclass.description ?? '')}</div>
        </div>
      ` : ''}

      ${bg ? `
        <div style="margin-bottom:8px;">
          <h2>Background: ${esc(bg.name)}</h2>
          <div style="font-size:7.5pt;font-weight:600;margin-bottom:2px;">${esc(bg.feature.name)}</div>
          <div style="font-size:7.5pt;color:#333;line-height:1.4;max-height:5em;overflow:hidden;">${esc(bg.feature.description)}</div>
        </div>
      ` : ''}
    </div>

  </div><!-- /.body -->

  <div style="margin-top:8px;font-size:7pt;color:#aaa;text-align:right;">
    Generated by Tavern Sheet · ${esc(today)} · Level ${totalLevel} ${esc(race?.name ?? '')} ${esc(classDef?.name ?? '')}
  </div>

</div><!-- /.page -->

${spellPage}
${journalPage}

</body>
</html>`;
}
