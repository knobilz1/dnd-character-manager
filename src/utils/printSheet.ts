/**
 * printSheet.ts — self-contained HTML character sheet matching the
 * official WotC D&D 5E character sheet layout (3 pages).
 *
 * Page 1: Ability scores · saves · skills · combat stats · attacks · personality / features
 * Page 2: Spells (only if character has spells)
 * Page 3: Campaign journal + notes (only if content exists)
 */
import type { Character } from '../types';
import { getRace } from '../data/races';
import { getClass } from '../data/classes';
import { ALL_SUBCLASSES } from '../data/subclasses';
import { getBackground } from '../data/backgrounds';
import { getSpell } from '../data/spells';
import { lookupWeapon, damageLine } from '../data/weapons';
import { totalCharacterLevel } from '../data/mechanics';
import { computeCharacterDerived } from '../hooks/useCharacterDerived';

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) { return n >= 0 ? `+${n}` : String(n); }
function esc(s: string) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function dsPips(total: number, filled: number): string {
  return Array.from({ length: total }, (_, i) =>
    `<span class="ds-pip${i < filled ? ' dsp-filled' : ''}"></span>`
  ).join('');
}
function emptyRows(n: number, cols: number): string {
  return Array.from({ length: n }, () =>
    `<tr class="empty-row">${Array.from({ length: cols }, () => '<td></td>').join('')}</tr>`
  ).join('');
}

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
const ABILITY_LABELS: Record<string, string> = {
  str: 'Strength', dex: 'Dexterity', con: 'Constitution',
  int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
};
const SKILL_LIST: { name: string; ability: string }[] = [
  { name: 'Acrobatics',      ability: 'Dex' },
  { name: 'Animal Handling', ability: 'Wis' },
  { name: 'Arcana',          ability: 'Int' },
  { name: 'Athletics',       ability: 'Str' },
  { name: 'Deception',       ability: 'Cha' },
  { name: 'History',         ability: 'Int' },
  { name: 'Insight',         ability: 'Wis' },
  { name: 'Intimidation',    ability: 'Cha' },
  { name: 'Investigation',   ability: 'Int' },
  { name: 'Medicine',        ability: 'Wis' },
  { name: 'Nature',          ability: 'Int' },
  { name: 'Perception',      ability: 'Wis' },
  { name: 'Performance',     ability: 'Cha' },
  { name: 'Persuasion',      ability: 'Cha' },
  { name: 'Religion',        ability: 'Int' },
  { name: 'Sleight of Hand', ability: 'Dex' },
  { name: 'Stealth',         ability: 'Dex' },
  { name: 'Survival',        ability: 'Wis' },
];

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Gill Sans', 'Gill Sans MT', Calibri, 'Trebuchet MS', sans-serif;
    font-size: 8pt;
    color: #111;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── Pages ── */
  .page {
    width: 7.9in;
    margin: 0 auto;
    padding: 0.32in 0.28in 0.28in;
    background: #fff;
  }
  .page-break { page-break-before: always; }

  /* ── Shared panel style (label below, inside border) ── */
  .panel {
    border: 1.5px solid #2a2a2a;
    border-radius: 6px;
    background: #f9f9f9;
    position: relative;
  }
  .panel > .panel-label {
    position: absolute;
    bottom: -7px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 5.5pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1.1px;
    background: #f9f9f9;
    padding: 0 5px;
    white-space: nowrap;
    color: #111;
  }

  /* ── HEADER (page 1) ── */
  .sheet-header {
    display: flex;
    align-items: stretch;
    margin-bottom: 9px;
    border-bottom: 3px solid #222;
    padding-bottom: 7px;
  }
  .name-banner {
    flex: 0 0 230px;
    border: 2px solid #222;
    border-radius: 5px 0 0 5px;
    padding: 4px 10px 5px;
    background: #f5f5f5;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  .name-val {
    font-family: 'Palatino Linotype', 'Book Antiqua', Georgia, serif;
    font-size: 17pt;
    font-weight: 700;
    border-bottom: 1.5px solid #555;
    min-height: 22px;
    line-height: 1.15;
    letter-spacing: 0.3px;
  }
  .name-lbl {
    font-size: 5.5pt;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: #555;
    margin-top: 3px;
  }
  .meta-grid {
    flex: 1;
    border: 2px solid #222;
    border-left: none;
    border-radius: 0 5px 5px 0;
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    grid-template-rows: 1fr 1fr;
  }
  .mc {
    padding: 3px 8px;
    border-right: 1px solid #ccc;
    border-bottom: 1px solid #ccc;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  .mc:nth-child(3n) { border-right: none; }
  .mc:nth-child(n+4) { border-bottom: none; }
  .mc .mc-v {
    font-size: 9pt;
    font-weight: 600;
    border-bottom: 1px solid #999;
    min-height: 14px;
    line-height: 1.3;
  }
  .mc .mc-l {
    font-size: 5.5pt;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #555;
    margin-top: 2px;
  }

  /* ── MAIN BODY GRID ── */
  .sheet-body {
    display: grid;
    grid-template-columns: 86px 192px 1fr 185px;
    gap: 5px;
    align-items: start;
  }

  /* ── ABILITY SCORES (col A) ── */
  .ability-col { display: flex; flex-direction: column; gap: 7px; }

  .ability-block {
    text-align: center;
    position: relative;
    padding-bottom: 14px;
  }
  .ab-name {
    display: block;
    font-size: 5.5pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    background: #dcdcdc;
    border: 1.5px solid #333;
    border-bottom: none;
    border-radius: 5px 5px 0 0;
    padding: 2px 2px;
    line-height: 1.2;
  }
  .ab-frame {
    border: 1.5px solid #333;
    border-radius: 0 0 7px 7px;
    padding: 4px 2px 20px;
    background: #fff;
    position: relative;
  }
  /* decorative inner line */
  .ab-frame::after {
    content: '';
    position: absolute;
    inset: 3px;
    border: 0.5px solid #ccc;
    border-radius: 4px;
    pointer-events: none;
  }
  .ab-score {
    display: block;
    font-size: 23pt;
    font-weight: 900;
    line-height: 1;
  }
  .ab-mod {
    position: absolute;
    bottom: -14px;
    left: 50%;
    transform: translateX(-50%);
    width: 33px;
    height: 33px;
    border-radius: 50%;
    border: 1.5px solid #333;
    background: #fff;
    font-size: 10.5pt;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2;
    letter-spacing: -0.5px;
  }

  /* ── LEFT STATS (col B) ── */
  .left-stats-col { display: flex; flex-direction: column; gap: 5px; }

  /* Inspiration + Prof Bonus row */
  .insp-prof-row { display: flex; gap: 4px; }

  .insp-box {
    flex: 1;
    border: 1.5px solid #333;
    border-radius: 5px;
    padding: 3px 6px;
    background: #f5f5f5;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .insp-check {
    width: 22px; height: 18px;
    border: 1.5px solid #444;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13pt;
    font-weight: 900;
  }
  .insp-lbl {
    font-size: 5.5pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    line-height: 1.2;
    text-align: right;
  }

  .prof-box {
    flex: 1;
    border: 1.5px solid #333;
    border-radius: 5px;
    padding: 3px 6px;
    background: #f5f5f5;
    display: flex;
    align-items: center;
    gap: 5px;
    justify-content: space-between;
  }
  .prof-circle {
    width: 30px; height: 30px;
    border-radius: 50%;
    border: 1.5px solid #333;
    background: #fff;
    font-size: 12pt;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .prof-lbl {
    font-size: 5.5pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    line-height: 1.2;
    text-align: right;
    flex: 1;
  }

  /* Saving throws / skills panels */
  .saves-panel, .skills-panel {
    border: 1.5px solid #333;
    border-radius: 7px;
    padding: 5px 7px 14px;
    background: #f5f5f5;
    position: relative;
  }
  .saves-panel .pl, .skills-panel .pl {
    position: absolute;
    bottom: -7px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 5.5pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1px;
    background: #f5f5f5;
    padding: 0 6px;
    white-space: nowrap;
  }

  /* Check rows */
  .ck-row {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-bottom: 0.8px;
    min-height: 10.5px;
  }
  .pip-o {
    width: 7px; height: 7px;
    border-radius: 50%;
    border: 1px solid #333;
    background: #fff;
    flex-shrink: 0;
  }
  .pip-o.filled { background: #333; }
  .ck-v {
    width: 17px;
    font-size: 6.5pt;
    font-weight: 600;
    text-align: right;
    flex-shrink: 0;
  }
  .ck-n { font-size: 6.5pt; flex: 1; }
  .ck-ab { font-size: 6pt; color: #666; font-style: italic; }

  /* Passive perception */
  .passive-row {
    border: 1.5px solid #333;
    border-radius: 5px;
    padding: 3px 8px;
    background: #f5f5f5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 2px;
    margin-bottom: 5px;
  }
  .passive-v { font-size: 13pt; font-weight: 700; }
  .passive-lbl { font-size: 5pt; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 800; text-align: right; }

  /* Other proficiencies panel */
  .other-prof-panel {
    border: 1.5px solid #333;
    border-radius: 7px;
    padding: 5px 7px 14px;
    background: #f5f5f5;
    position: relative;
    flex: 1;
    font-size: 6.5pt;
    line-height: 1.55;
    min-height: 70px;
  }
  .other-prof-panel .pl {
    position: absolute;
    bottom: -7px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 5.5pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 1px;
    background: #f5f5f5;
    padding: 0 6px;
    white-space: nowrap;
  }

  /* ── COMBAT (col C) ── */
  .combat-col { display: flex; flex-direction: column; gap: 4px; }

  .combat-top-row {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 2px;
  }

  /* Shield AC */
  .ac-shield-wrap {
    width: 60px; height: 68px;
    flex-shrink: 0;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ac-shield-wrap svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
  .ac-inner {
    position: relative;
    z-index: 1;
    text-align: center;
    padding-top: 6px;
  }
  .ac-lbl { font-size: 5pt; font-weight: 800; text-transform: uppercase; letter-spacing: 0.3px; line-height: 1.2; }
  .ac-v { font-size: 18pt; font-weight: 900; line-height: 1; }

  /* Initiative / Speed boxes */
  .c-stat {
    border: 1.5px solid #333;
    border-radius: 6px;
    background: #f5f5f5;
    text-align: center;
    padding: 5px 4px 16px;
    flex: 1;
    position: relative;
  }
  .c-stat-v { font-size: 15pt; font-weight: 700; line-height: 1; display: block; }
  .c-stat-lbl {
    position: absolute;
    bottom: 4px; left: 0; right: 0;
    font-size: 5.5pt;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    font-weight: 800;
    text-align: center;
  }

  /* HP block */
  .hp-block {
    border: 1.5px solid #333;
    border-radius: 6px;
    background: #f5f5f5;
    overflow: hidden;
    margin-bottom: 2px;
  }
  .hp-max-line {
    padding: 3px 8px;
    border-bottom: 1px solid #ccc;
    font-size: 6.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .hp-max-line .hpmax-v {
    font-size: 9pt;
    font-weight: 700;
    margin-left: 5px;
    border-bottom: 1px solid #888;
    padding-bottom: 1px;
  }
  .hp-current-area {
    padding: 7px 8px 20px;
    text-align: center;
    position: relative;
    border-bottom: 1px dashed #bbb;
  }
  .hp-big { font-size: 24pt; font-weight: 900; line-height: 1; display: block; }
  .hp-area-lbl {
    position: absolute;
    bottom: 4px; left: 0; right: 0;
    font-size: 5.5pt;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    font-weight: 800;
    text-align: center;
  }
  .hp-temp-area {
    padding: 5px 8px 18px;
    text-align: center;
    position: relative;
  }
  .hp-temp-v { font-size: 18pt; font-weight: 700; line-height: 1; display: block; color: #777; }
  .hp-temp-v.has-temp { color: #111; }

  /* Hit Dice + Death Saves */
  .hd-ds-row { display: flex; gap: 4px; margin-bottom: 3px; }
  .hd-box {
    flex: 1;
    border: 1.5px solid #333;
    border-radius: 6px;
    padding: 5px 7px 15px;
    background: #f5f5f5;
    position: relative;
    font-size: 7.5pt;
    font-weight: 600;
  }
  .ds-box {
    flex: 1;
    border: 1.5px solid #333;
    border-radius: 6px;
    padding: 5px 7px 15px;
    background: #f5f5f5;
    position: relative;
  }
  .ds-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 3px;
  }
  .ds-row-lbl {
    font-size: 6.5pt;
    font-weight: 700;
    text-transform: uppercase;
    width: 52px;
    flex-shrink: 0;
  }
  .ds-pip {
    width: 11px; height: 11px;
    border-radius: 50%;
    border: 1.5px solid #333;
    background: #fff;
    display: inline-block;
    margin-left: 2px;
  }
  .dsp-filled { background: #333 !important; }
  .box-lbl {
    position: absolute;
    bottom: -7px; left: 50%; right: auto;
    transform: translateX(-50%);
    font-size: 5.5pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    background: #f5f5f5;
    padding: 0 5px;
    white-space: nowrap;
  }

  /* Attacks & Spellcasting */
  .attacks-section {
    border: 1.5px solid #333;
    border-radius: 6px;
    padding: 5px 5px 16px;
    background: #f5f5f5;
    position: relative;
    margin-bottom: 5px;
  }
  .atk-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 7pt;
  }
  .atk-table th {
    font-size: 5.5pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 800;
    border-bottom: 1px solid #333;
    padding: 1px 4px 2px;
    text-align: left;
    background: #e8e8e8;
  }
  .atk-table td { padding: 2.5px 4px; border-bottom: 0.5px solid #ddd; }
  .atk-table tr:last-child td { border-bottom: none; }
  .atk-table .empty-row td { height: 14px; background: #f2f2f2; }

  /* Equipment */
  .equip-section {
    border: 1.5px solid #333;
    border-radius: 6px;
    padding: 5px 7px 15px;
    background: #f5f5f5;
    position: relative;
    flex: 1;
    font-size: 7pt;
    line-height: 1.6;
  }

  /* Currency row */
  .currency-row {
    display: flex;
    gap: 5px;
    margin-top: 5px;
    flex-wrap: wrap;
  }
  .coin {
    text-align: center;
    border: 1px solid #aaa;
    border-radius: 50%;
    width: 28px; height: 28px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-size: 5.5pt;
    line-height: 1.1;
    background: #fff;
  }
  .coin .coin-v { font-size: 7.5pt; font-weight: 700; }

  /* ── RIGHT COLUMN (col D) ── */
  .right-col { display: flex; flex-direction: column; gap: 5px; }

  .pers-box {
    border: 1.5px solid #333;
    border-radius: 6px;
    padding: 5px 7px 14px;
    background: #f5f5f5;
    position: relative;
    font-size: 7pt;
    line-height: 1.45;
    min-height: 50px;
  }
  .pers-box .pl {
    position: absolute;
    bottom: -7px; left: 50%;
    transform: translateX(-50%);
    font-size: 5.5pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    background: #f5f5f5;
    padding: 0 5px;
    white-space: nowrap;
  }
  .features-box {
    border: 1.5px solid #333;
    border-radius: 6px;
    padding: 5px 7px 14px;
    background: #f5f5f5;
    position: relative;
    flex: 1;
    font-size: 7pt;
    line-height: 1.4;
    min-height: 60px;
  }
  .features-box .pl {
    position: absolute;
    bottom: -7px; left: 50%;
    transform: translateX(-50%);
    font-size: 5.5pt;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    background: #f5f5f5;
    padding: 0 5px;
    white-space: nowrap;
  }
  .ft-item { margin-bottom: 5px; }
  .ft-name { font-size: 7.5pt; font-weight: 700; }
  .ft-src { font-size: 6.5pt; color: #555; font-style: italic; margin-left: 3px; }
  .ft-desc { font-size: 6.5pt; color: #333; line-height: 1.35; max-height: 4.5em; overflow: hidden; margin-top: 1px; }

  /* ── SPELL PAGE ── */
  .spell-header {
    display: flex;
    align-items: stretch;
    gap: 0;
    margin-bottom: 8px;
    border-bottom: 3px solid #222;
    padding-bottom: 6px;
  }
  .spell-class-box {
    flex: 0 0 210px;
    border: 1.5px solid #333;
    border-radius: 5px 0 0 5px;
    padding: 4px 10px;
    background: #f5f5f5;
  }
  .sc-lbl { font-size: 5.5pt; text-transform: uppercase; letter-spacing: 1px; font-weight: 800; color: #555; }
  .sc-v { font-size: 12pt; font-weight: 700; border-bottom: 1px solid #888; line-height: 1.25; }
  .spell-top-stats {
    flex: 1;
    border: 1.5px solid #333;
    border-left: none;
    border-radius: 0 5px 5px 0;
    display: flex;
  }
  .sts-box {
    flex: 1;
    text-align: center;
    padding: 4px 6px;
    border-right: 1px solid #ccc;
  }
  .sts-box:last-child { border-right: none; }
  .sts-v { font-size: 15pt; font-weight: 900; display: block; line-height: 1; }
  .sts-l { font-size: 5.5pt; text-transform: uppercase; letter-spacing: 0.3px; font-weight: 800; display: block; margin-top: 3px; color: #444; }

  .spell-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 5px;
    align-items: start;
  }
  .sl-col { display: flex; flex-direction: column; gap: 6px; }
  .sl-section {}

  .sl-header {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-bottom: 3px;
  }
  .sl-badge {
    border: 2px solid #333;
    border-radius: 3px;
    width: 19px; height: 19px;
    font-size: 9.5pt; font-weight: 900;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
    background: #fff;
  }
  .sl-banner {
    flex: 1;
    border: 1.5px solid #333;
    border-radius: 4px;
    padding: 2px 5px;
    background: #f5f5f5;
    font-size: 5.5pt;
    font-weight: 700;
    text-transform: uppercase;
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 16px;
  }
  .sl-slots { font-size: 6pt; color: #444; }
  .sl-row {
    display: flex;
    align-items: center;
    gap: 3px;
    border-bottom: 0.5px solid #ddd;
    padding: 1px 0;
    min-height: 11px;
  }
  .sl-row:last-child { border-bottom: none; }
  .sl-pip {
    width: 7px; height: 7px;
    border-radius: 50%;
    border: 1px solid #333;
    background: #fff;
    flex-shrink: 0;
  }
  .sl-pip.prepared { background: #333; }
  .sl-name { font-size: 7pt; flex: 1; }
  .sl-conc { font-size: 6pt; color: #666; margin-left: 2px; }
  .sl-school { font-size: 6pt; color: #888; }

  /* ── JOURNAL PAGE ── */
  .j-section-title {
    font-size: 12pt;
    font-weight: 700;
    border-bottom: 2px solid #333;
    padding-bottom: 5px;
    margin-bottom: 10px;
    font-family: 'Palatino Linotype', Georgia, serif;
    letter-spacing: 0.3px;
  }
  .je {
    border-bottom: 1px solid #ddd;
    padding-bottom: 8px;
    margin-bottom: 8px;
  }
  .je:last-child { border-bottom: none; }
  .je-hdr { font-size: 9pt; font-weight: 700; margin-bottom: 2px; }
  .je-sub { font-size: 7pt; color: #666; margin-bottom: 3px; }
  .je-body { font-size: 8pt; white-space: pre-wrap; line-height: 1.45; }
  .notes-panel {
    border: 1.5px solid #333;
    border-radius: 6px;
    padding: 8px;
    background: #f5f5f5;
    font-size: 8pt;
    white-space: pre-wrap;
    line-height: 1.5;
    min-height: 100px;
    margin-top: 10px;
  }

  /* ── Footer ── */
  .sheet-footer {
    text-align: right;
    font-size: 6pt;
    color: #aaa;
    margin-top: 8px;
    padding-top: 4px;
    border-top: 0.5px solid #ddd;
  }

  @media print {
    @page { margin: 0; size: letter portrait; }
    body { padding: 0; }
    .page { padding: 0.32in 0.28in; }
  }
`;

// ── Section builders ──────────────────────────────────────────────────────────

function buildAbilityCol(mods: Record<string, number>, finalScores: Record<string, number>): string {
  return `<div class="ability-col">` +
    ABILITY_KEYS.map(k => `
      <div class="ability-block">
        <span class="ab-name">${ABILITY_LABELS[k].toUpperCase()}</span>
        <div class="ab-frame">
          <span class="ab-score">${finalScores[k] ?? 10}</span>
        </div>
        <div class="ab-mod">${fmt(mods[k] ?? 0)}</div>
      </div>
    `).join('') +
  `</div>`;
}

function buildLeftStatsCol(
  mods: Record<string, number>,
  profBonus: number,
  inspiration: boolean,
  savingThrows: Record<string, number>,
  savingProfSet: Set<string>,
  skills: Record<string, number>,
  skillProfSet: Set<string>,
  passivePerception: number,
  proficiencies: string[],
  languages: string[],
): string {
  const savingRows = ABILITY_KEYS.map(k => `
    <div class="ck-row">
      <span class="pip-o${savingProfSet.has(k) ? ' filled' : ''}"></span>
      <span class="ck-v">${fmt(savingThrows[k] ?? 0)}</span>
      <span class="ck-n">${ABILITY_LABELS[k].slice(0, 3)}</span>
    </div>
  `).join('');

  const skillRows = SKILL_LIST.map(s => `
    <div class="ck-row">
      <span class="pip-o${skillProfSet.has(s.name) ? ' filled' : ''}"></span>
      <span class="ck-v">${fmt(skills[s.name] ?? mods[s.ability.toLowerCase()] ?? 0)}</span>
      <span class="ck-n">${esc(s.name)} <span class="ck-ab">(${s.ability})</span></span>
    </div>
  `).join('');

  const profText = proficiencies.length
    ? `<div style="margin-bottom:3px;"><span style="font-weight:700;">Proficiencies:</span> ${proficiencies.map(esc).join(', ')}</div>` : '';
  const langText = languages.length
    ? `<div><span style="font-weight:700;">Languages:</span> ${languages.map(esc).join(', ')}</div>` : '';

  return `
    <div class="left-stats-col">
      <!-- Inspiration + Prof Bonus -->
      <div class="insp-prof-row">
        <div class="insp-box">
          <div class="insp-check">${inspiration ? '★' : ''}</div>
          <div class="insp-lbl">Inspiration</div>
        </div>
        <div class="prof-box">
          <div class="prof-circle">${fmt(profBonus)}</div>
          <div class="prof-lbl">Proficiency Bonus</div>
        </div>
      </div>

      <!-- Saving Throws -->
      <div class="saves-panel" style="margin-bottom:7px;">
        ${savingRows}
        <span class="pl">Saving Throws</span>
      </div>

      <!-- Skills -->
      <div class="skills-panel" style="margin-bottom:7px;">
        ${skillRows}
        <span class="pl">Skills</span>
      </div>

      <!-- Passive Perception -->
      <div class="passive-row">
        <span class="passive-v">${passivePerception}</span>
        <span class="passive-lbl">Passive Wisdom<br/>(Perception)</span>
      </div>

      <!-- Other Proficiencies & Languages -->
      <div class="other-prof-panel">
        ${profText}${langText}
        <span class="pl">Other Proficiencies &amp; Languages</span>
      </div>
    </div>
  `;
}

function buildCombatCol(
  character: Character,
  ac: number,
  initiative: number,
  speed: number,
  mods: Record<string, number>,
  profBonus: number,
  slotTotals: Record<number, number>,
): string {
  const dSucc = character.deathSaves?.successes ?? 0;
  const dFail = character.deathSaves?.failures ?? 0;
  const tempHP = character.tempHP ?? 0;

  // Hit dice
  const hitDiceStr = character.classes.map(cl => {
    const def = getClass(cl.classId);
    const used = (character.hitDiceUsed ?? {})[cl.classId] ?? 0;
    return `${cl.level - used}d${def?.hitDie ?? '?'} (${cl.level - used}/${cl.level})`;
  }).join(', ');

  // Attacks
  const equipped = (character.inventory ?? []).filter((i: any) => i.equipped && i.category === 'weapon');
  const atkRows = equipped.slice(0, 3).map((item: any) => {
    const w = lookupWeapon(item.name);
    const abilMod = w?.ability === 'finesse'
      ? Math.max(mods.str ?? 0, mods.dex ?? 0)
      : (w?.ability === 'dex' || w?.ranged) ? (mods.dex ?? 0) : (mods.str ?? 0);
    const toHit = abilMod + profBonus;
    const dmg = w ? damageLine(w.damageDice, abilMod) : '—';
    const type = w?.damageType ?? '—';
    return `<tr><td>${esc(item.name)}</td><td>${fmt(toHit)}</td><td>${esc(dmg)} ${esc(type)}</td></tr>`;
  }).join('');
  const emptyAtk = emptyRows(Math.max(0, 3 - equipped.slice(0, 3).length), 3);

  // Spell slots
  const hasSlots = Object.values(slotTotals).some(v => v > 0) || character.pactMagic;
  let slotHtml = '';
  if (hasSlots) {
    const slotRows: string[] = [];
    if (character.pactMagic) {
      const pm = character.pactMagic;
      const pips = Array.from({ length: pm.slotsTotal }, (_, i) =>
        `<span class="ds-pip${i < pm.slotsUsed ? ' dsp-filled' : ''}"></span>`
      ).join('');
      slotRows.push(`<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;font-size:7pt;"><strong>Pact (L${pm.slotLevel})</strong> ${pips}</div>`);
    }
    for (let lvl = 1; lvl <= 9; lvl++) {
      const total = slotTotals[lvl] ?? 0;
      if (!total) continue;
      const used = (character.spellSlotsUsed ?? {})[lvl as 1] ?? 0;
      const pips = Array.from({ length: total }, (_, i) =>
        `<span class="ds-pip${i < used ? ' dsp-filled' : ''}"></span>`
      ).join('');
      slotRows.push(`<div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;font-size:7pt;"><strong>L${lvl}</strong> ${pips}</div>`);
    }
    slotHtml = `
      <div class="equip-section" style="margin-bottom:5px;">
        ${slotRows.join('')}
        <span class="box-lbl">Spell Slots</span>
      </div>
    `;
  }

  // Equipment / inventory
  const allItems = (character.inventory ?? []);
  const itemLines = allItems.slice(0, 20).map((i: any) =>
    `${esc(i.name)}${(i.quantity ?? 1) > 1 ? ` ×${i.quantity}` : ''}${i.equipped ? ' ✦' : ''}`
  ).join('<br/>');

  const currencies = character.currencies ?? { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  const coinDisplay = (['pp', 'gp', 'ep', 'sp', 'cp'] as const).map(c => {
    const val = currencies[c] ?? 0;
    return `<div class="coin"><span class="coin-v">${val}</span><span>${c.toUpperCase()}</span></div>`;
  }).join('');

  return `
    <div class="combat-col">
      <!-- AC / Initiative / Speed -->
      <div class="combat-top-row">
        <!-- Shield AC -->
        <div class="ac-shield-wrap">
          <svg viewBox="0 0 60 68" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 14 L30 3 L56 14 L56 46 L30 65 L4 46 Z"
              fill="#f5f5f5" stroke="#333" stroke-width="2"/>
            <path d="M7 15.5 L30 5.5 L53 15.5 L53 45 L30 62 L7 45 Z"
              fill="none" stroke="#aaa" stroke-width="0.8"/>
          </svg>
          <div class="ac-inner">
            <div class="ac-lbl">Armor<br/>Class</div>
            <div class="ac-v">${ac}</div>
          </div>
        </div>

        <!-- Initiative -->
        <div class="c-stat">
          <span class="c-stat-v">${fmt(initiative)}</span>
          <span class="c-stat-lbl">Initiative</span>
        </div>

        <!-- Speed -->
        <div class="c-stat">
          <span class="c-stat-v">${speed}</span>
          <span class="c-stat-lbl">Speed</span>
        </div>
      </div>

      <!-- HP -->
      <div class="hp-block">
        <div class="hp-max-line">
          Hit Point Maximum <span class="hpmax-v">${character.maxHP}</span>
        </div>
        <div class="hp-current-area">
          <span class="hp-big">${character.currentHP}</span>
          <span class="hp-area-lbl">Current Hit Points</span>
        </div>
        <div class="hp-temp-area">
          <span class="hp-temp-v${tempHP > 0 ? ' has-temp' : ''}">${tempHP > 0 ? tempHP : '—'}</span>
          <span class="hp-area-lbl">Temporary Hit Points</span>
        </div>
      </div>

      <!-- Hit Dice + Death Saves -->
      <div class="hd-ds-row">
        <div class="hd-box">
          <div style="font-size:6.5pt;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px;">Total</div>
          <div>${esc(hitDiceStr)}</div>
          <span class="box-lbl">Hit Dice</span>
        </div>
        <div class="ds-box">
          <div class="ds-row">
            <span class="ds-row-lbl">Successes</span>
            ${dsPips(3, dSucc)}
          </div>
          <div class="ds-row">
            <span class="ds-row-lbl">Failures</span>
            ${dsPips(3, dFail)}
          </div>
          <span class="box-lbl">Death Saves</span>
        </div>
      </div>

      <!-- Attacks & Spellcasting -->
      <div class="attacks-section">
        <table class="atk-table">
          <thead>
            <tr><th>Name</th><th>ATK Bonus</th><th>Damage / Type</th></tr>
          </thead>
          <tbody>
            ${atkRows}
            ${emptyAtk}
          </tbody>
        </table>
        <span class="box-lbl">Attacks &amp; Spellcasting</span>
      </div>

      ${slotHtml}

      <!-- Equipment -->
      <div class="equip-section" style="flex:1;">
        <div>${itemLines || '<span style="color:#bbb;">—</span>'}</div>
        <div class="currency-row">${coinDisplay}</div>
        <span class="box-lbl">Equipment</span>
      </div>
    </div>
  `;
}

function buildRightCol(character: Character, classDef: any, subclass: any, bg: any): string {
  // Personality boxes: pull from background tables if no custom data
  const bgPT = (bg?.personalityTraits ?? []).slice(0, 1).join(' ');
  const bgI  = (bg?.ideals ?? []).slice(0, 1).join(' ');
  const bgB  = (bg?.bonds ?? []).slice(0, 1).join(' ');
  const bgF  = (bg?.flaws ?? []).slice(0, 1).join(' ');

  // Features
  const race = getRace(character.raceId);
  const primary = character.classes[0];
  const items: { name: string; source: string; desc: string }[] = [];

  (race?.traits ?? []).slice(0, 2).forEach(t =>
    items.push({ name: t.name, source: race!.name, desc: t.description })
  );
  if (classDef && primary) {
    classDef.features
      .filter((f: any) => f.level <= primary.level && !f.isASI)
      .slice(-5)
      .forEach((f: any) => items.push({ name: f.name, source: classDef.name, desc: f.description }));
  }
  if (subclass && primary) {
    subclass.features
      .filter((f: any) => f.level <= primary.level)
      .slice(-2)
      .forEach((f: any) => items.push({ name: f.name, source: subclass.name, desc: f.description }));
  }

  const featureHtml = items.map(it => `
    <div class="ft-item">
      <span class="ft-name">${esc(it.name)}</span>
      <span class="ft-src">(${esc(it.source)})</span>
      <div class="ft-desc">${esc(it.desc)}</div>
    </div>
  `).join('');

  return `
    <div class="right-col">
      <div class="pers-box">
        <div>${esc(bgPT)}</div>
        <span class="pl">Personality Traits</span>
      </div>
      <div class="pers-box">
        <div>${esc(bgI)}</div>
        <span class="pl">Ideals</span>
      </div>
      <div class="pers-box">
        <div>${esc(bgB)}</div>
        <span class="pl">Bonds</span>
      </div>
      <div class="pers-box">
        <div>${esc(bgF)}</div>
        <span class="pl">Flaws</span>
      </div>
      <div class="features-box" style="flex:1;">
        ${featureHtml || '<span style="color:#bbb;font-size:7pt;">—</span>'}
        <span class="pl">Features &amp; Traits</span>
      </div>
    </div>
  `;
}

function buildSpellPage(
  character: Character,
  spellSaveDC: number,
  spellAttackBonus: number,
  slotTotals: Record<number, number>,
  classDef: any,
): string {
  const spellbook = (character.spellbook ?? []);
  if (spellbook.length === 0) return '';

  const byLevel: Record<number, { name: string; prepared: boolean; conc: boolean; school: string }[]> = {};
  spellbook.forEach((sp: any) => {
    const spell = getSpell(sp.spellId);
    if (!spell) return;
    const lvl = spell.level;
    if (!byLevel[lvl]) byLevel[lvl] = [];
    byLevel[lvl].push({
      name: spell.name,
      prepared: sp.isPrepared || sp.isAlwaysPrepared || lvl === 0,
      conc: spell.concentration,
      school: spell.school.slice(0, 4),
    });
  });

  const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
  if (!levels.length) return '';

  // Distribute into 3 columns: col 0 = lvl 0,1,2  col 1 = lvl 3,4,5  col 2 = lvl 6,7,8,9
  const colAssign: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 1, 6: 2, 7: 2, 8: 2, 9: 2 };
  const cols: [number[], number[], number[]] = [[], [], []];
  levels.forEach(l => cols[colAssign[l] ?? 2].push(l));

  const levelNames = ['Cantrips', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];

  function renderLevelSection(lvl: number): string {
    const spells = byLevel[lvl] ?? [];
    const total = slotTotals[lvl] ?? 0;
    const used = (character.spellSlotsUsed ?? {})[lvl as 1] ?? 0;
    const slotsText = lvl > 0 && total > 0
      ? `<span class="sl-slots">Slots: ${total - used}/${total}</span>` : '';

    const rows = spells.map(s => `
      <div class="sl-row">
        <span class="sl-pip${s.prepared ? ' prepared' : ''}"></span>
        <span class="sl-name">${esc(s.name)}</span>
        ${s.conc ? '<span class="sl-conc">©</span>' : ''}
        <span class="sl-school">${esc(s.school)}</span>
      </div>
    `).join('');

    return `
      <div class="sl-section">
        <div class="sl-header">
          <div class="sl-badge">${lvl}</div>
          <div class="sl-banner">
            <span>${levelNames[lvl] ?? `L${lvl}`}</span>
            ${slotsText}
          </div>
        </div>
        ${rows}
      </div>
    `;
  }

  const spellcastingAbility = classDef?.spellcastingAbility
    ? ABILITY_LABELS[classDef.spellcastingAbility]?.slice(0, 3).toUpperCase() ?? '—'
    : '—';

  return `
    <div class="page page-break">

      <!-- Spell page header -->
      <div class="spell-header">
        <div class="spell-class-box">
          <div class="sc-lbl">Spellcasting Class</div>
          <div class="sc-v">${esc(classDef?.name ?? '—')}</div>
          <div class="sc-lbl" style="margin-top:2px;">Spellcasting Class</div>
        </div>
        <div class="spell-top-stats">
          <div class="sts-box">
            <span class="sts-v">${esc(spellcastingAbility)}</span>
            <span class="sts-l">Spellcasting Ability</span>
          </div>
          <div class="sts-box">
            <span class="sts-v">${spellSaveDC}</span>
            <span class="sts-l">Spell Save DC</span>
          </div>
          <div class="sts-box">
            <span class="sts-v">${fmt(spellAttackBonus)}</span>
            <span class="sts-l">Spell Attack Bonus</span>
          </div>
        </div>
      </div>

      <!-- Spell grid: 3 columns -->
      <div class="spell-grid">
        <div class="sl-col">${cols[0].map(renderLevelSection).join('')}</div>
        <div class="sl-col">${cols[1].map(renderLevelSection).join('')}</div>
        <div class="sl-col">${cols[2].map(renderLevelSection).join('')}</div>
      </div>

    </div>
  `;
}

function buildJournalPage(character: Character): string {
  const entries = character.journal ?? [];
  const hasNotes = character.notes?.trim();
  if (!entries.length && !hasNotes) return '';

  const entryHtml = entries.map(e => {
    const dateLabel = e.date
      ? new Date(e.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    const meta = [e.sessionNumber != null ? `Session ${e.sessionNumber}` : '', dateLabel].filter(Boolean).join(' · ');
    return `
      <div class="je">
        <div class="je-hdr">${esc(e.title)}</div>
        ${meta ? `<div class="je-sub">${esc(meta)}</div>` : ''}
        <div class="je-body">${esc(e.content)}</div>
      </div>
    `;
  }).join('');

  const notesHtml = hasNotes ? `
    <div>
      <div style="font-size:9pt;font-weight:700;margin-bottom:5px;margin-top:${entries.length ? '10px' : '0'};">General Notes</div>
      <div class="notes-panel">${esc(character.notes)}</div>
    </div>
  ` : '';

  return `
    <div class="page page-break">
      <div class="j-section-title">
        Campaign Journal${character.campaignName ? ` — ${esc(character.campaignName)}` : ''}
      </div>
      ${entryHtml}
      ${notesHtml}
    </div>
  `;
}

// ── Public interface ──────────────────────────────────────────────────────────

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

// ── Internal page builder (no HTML/head wrapper) ─────────────────────────────

function buildSheetPages(character: Character, d: SheetDerivedData, addBreakBefore = false): string {
  const race = getRace(character.raceId);
  const primary = character.classes[0];
  const classDef = primary ? getClass(primary.classId) : null;
  const subclass = primary?.subclassId
    ? ALL_SUBCLASSES.find(s => s.id === primary.subclassId)
    : null;
  const bg = getBackground(character.backgroundId);
  const totalLevel = totalCharacterLevel(character.classes);

  const multiclassLabel = character.classes.length > 1
    ? character.classes.map(cl => `${getClass(cl.classId)?.name ?? cl.classId} ${cl.level}`).join(' / ')
    : `${classDef?.name ?? ''} ${primary?.level ?? ''}`;

  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const proficiencies: string[] = [];
  if (bg?.toolProficiencies?.length) proficiencies.push(...bg.toolProficiencies);
  if (classDef?.weaponProficiencies) proficiencies.push(...classDef.weaponProficiencies);
  if (classDef?.armorProficiencies)  proficiencies.push(...classDef.armorProficiencies);
  if (race?.proficiencies?.length)   proficiencies.push(...race.proficiencies);
  const languages = race?.languages ?? [];

  const spellPage = buildSpellPage(character, d.spellSaveDC, d.spellAttackBonus, d.slotTotals, classDef);
  const journalPage = buildJournalPage(character);
  const breakClass = addBreakBefore ? ' page-break' : '';

  return `
<!-- ════════════════ ${esc(character.name)} ════════════════ -->
<div class="page${breakClass}">

  <div class="sheet-header">
    <div class="name-banner">
      <div class="name-val">${esc(character.name)}</div>
      <div class="name-lbl">Character Name</div>
    </div>
    <div class="meta-grid">
      <div class="mc"><div class="mc-v">${esc(multiclassLabel)}</div><div class="mc-l">Class &amp; Level</div></div>
      <div class="mc"><div class="mc-v">${esc(bg?.name ?? '—')}</div><div class="mc-l">Background</div></div>
      <div class="mc"><div class="mc-v">${esc(character.playerName || '—')}</div><div class="mc-l">Player Name</div></div>
      <div class="mc"><div class="mc-v">${esc(race?.name ?? '—')}</div><div class="mc-l">Race</div></div>
      <div class="mc"><div class="mc-v">${esc(character.alignment || '—')}</div><div class="mc-l">Alignment</div></div>
      <div class="mc"><div class="mc-v">${(character.experiencePoints ?? 0).toLocaleString()}</div><div class="mc-l">Experience Points</div></div>
    </div>
  </div>

  <div class="sheet-body">
    ${buildAbilityCol(d.mods, d.finalScores)}
    ${buildLeftStatsCol(
      d.mods, d.profBonus, character.inspiration,
      d.savingThrows, d.savingThrowProficiencies,
      d.skills, d.allSkillProficiencies,
      d.passivePerception, proficiencies, languages,
    )}
    ${buildCombatCol(character, d.ac, d.initiative, d.speed, d.mods, d.profBonus, d.slotTotals)}
    ${buildRightCol(character, classDef, subclass, bg)}
  </div>

  <div class="sheet-footer">
    Tavern Sheet · ${esc(today)} · Level ${totalLevel} ${esc(race?.name ?? '')} ${esc(classDef?.name ?? '')}
  </div>
</div>
${spellPage}
${journalPage}
`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function generateCharacterSheetHTML(
  character: Character,
  d: SheetDerivedData,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(character.name)} — Character Sheet</title>
<style>${CSS}</style>
</head>
<body>
${buildSheetPages(character, d)}
</body>
</html>`;
}

/**
 * Generate a single HTML document containing sheets for multiple characters.
 * Derives all stats internally — callers just pass the raw Character objects.
 */
export function generateMultiCharacterSheetHTML(characters: Character[]): string {
  const pages = characters.map((character, i) => {
    const derived = computeCharacterDerived(character);
    const d: SheetDerivedData = {
      finalScores: derived.finalScores as unknown as Record<string, number>,
      mods:         derived.mods         as unknown as Record<string, number>,
      savingThrows: derived.savingThrows  as unknown as Record<string, number>,
      profBonus:    derived.profBonus,
      ac:           derived.ac,
      initiative:   derived.initiative,
      speed:        derived.speed,
      savingThrowProficiencies: derived.savingThrowProficiencies,
      skills:       derived.skills,
      allSkillProficiencies: derived.allSkillProficiencies,
      passivePerception: derived.passivePerception,
      spellSaveDC:  derived.spellSaveDC,
      spellAttackBonus: derived.spellAttackBonus,
      slotTotals:   derived.slotTotals,
      totalLevel:   derived.totalLevel,
    };
    return buildSheetPages(character, d, i > 0);
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Character Sheets</title>
<style>${CSS}</style>
</head>
<body>
${pages}
</body>
</html>`;
}
