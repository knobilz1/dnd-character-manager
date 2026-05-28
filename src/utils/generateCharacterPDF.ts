/**
 * generateCharacterPDF.ts
 * Builds a complete D&D 5e character sheet PDF from scratch using pdf-lib.
 * No external template required — works immediately on every print.
 */

import { PDFDocument, PDFPage, PDFFont, rgb, StandardFonts } from 'pdf-lib';
import type { Character } from '../types';
import { computeCharacterDerived } from '../hooks/useCharacterDerived';
import { getClass } from '../data/classes';
import { getSubclass } from '../data/subclasses';
import { getSpell } from '../data/spells';
import { totalCharacterLevel } from '../data/mechanics';
import { SKILL_ABILITY } from '../data/mechanics';

// ── Page constants ────────────────────────────────────────────────────────────
const PW = 612;   // US Letter width  (pt)
const PH = 792;   // US Letter height (pt)
const M  = 18;    // outer margin

// ── Colour palette ────────────────────────────────────────────────────────────
const C = {
  ink:    rgb(0.06, 0.07, 0.10),
  muted:  rgb(0.44, 0.48, 0.55),
  border: rgb(0.70, 0.74, 0.81),
  fill:   rgb(0.94, 0.96, 0.98),
  hdrBg:  rgb(0.09, 0.13, 0.23),
  hdrFg:  rgb(0.96, 0.97, 1.00),
  secBg:  rgb(0.86, 0.90, 0.97),
  dotOn:  rgb(0.16, 0.37, 0.73),
  white:  rgb(1, 1, 1),
  red:    rgb(0.75, 0.12, 0.12),
  green:  rgb(0.10, 0.55, 0.25),
};

// ── Coordinate helpers (top-down thinking → PDF bottom-left) ─────────────────
/** Bottom-left y for a rect whose top is `topY` and height is `h`. */
const ry = (topY: number, h: number) => PH - topY - h;
/** Text baseline y for text that should sit with its top at `topY`, given font size `sz`. */
const ty = (topY: number, sz: number) => PH - topY - sz * 0.78;

// ── Low-level drawing helpers ─────────────────────────────────────────────────
type RGB = ReturnType<typeof rgb>;

function sanitize(s: string): string {
  return (s ?? '')
    .replace(/['']/g, "'").replace(/[""]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[^\x00-\xFF]/g, '?');
}

function tw(text: string, font: PDFFont, size: number): number {
  return font.widthOfTextAtSize(text, size);
}

function drawRect(pg: PDFPage, x: number, y: number, w: number, h: number,
  fill?: RGB, stroke?: RGB, bw = 0.6) {
  pg.drawRectangle({ x, y, width: w, height: h,
    ...(fill   ? { color: fill }                    : {}),
    ...(stroke ? { borderColor: stroke, borderWidth: bw } : {}),
  });
}

function drawText(pg: PDFPage, s: string, x: number, y: number, font: PDFFont, size: number, color: RGB = C.ink) {
  const clean = sanitize(s);
  if (!clean) return;
  pg.drawText(clean, { x, y, font, size, color });
}

function drawTextC(pg: PDFPage, s: string, cx: number, y: number, font: PDFFont, size: number, color: RGB = C.ink) {
  drawText(pg, s, cx - tw(s, font, size) / 2, y, font, size, color);
}

function drawLine(pg: PDFPage, x1: number, y1: number, x2: number, y2: number, col: RGB = C.border, thickness = 0.5) {
  pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color: col, thickness });
}

function drawDot(pg: PDFPage, cx: number, cy: number, filled: boolean) {
  pg.drawCircle({ x: cx, y: cy, size: 3.5,
    color: filled ? C.dotOn : C.white,
    borderColor: filled ? C.dotOn : C.border, borderWidth: 0.7 });
}

/** Draws a small section header band with all-caps label. */
function drawSecLabel(pg: PDFPage, label: string, x: number, topY: number, w: number, reg: PDFFont) {
  drawRect(pg, x, ry(topY, 11), w, 11, C.secBg);
  drawTextC(pg, label.toUpperCase(), x + w / 2, ty(topY + 1, 7), reg, 7, C.muted);
}

/** Wraps text into lines fitting maxWidth. */
function wrapText(s: string, maxW: number, font: PDFFont, size: number): string[] {
  const words = sanitize(s).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (tw(test, font, size) > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Draws wrapped text in a box, returns next y (topY after text). */
function drawWrappedText(pg: PDFPage, text: string, x: number, topY: number, w: number,
  font: PDFFont, size: number, lineH: number, color: RGB = C.ink, maxLines?: number): number {
  const lines = wrapText(text, w, font, size);
  const toRender = maxLines ? lines.slice(0, maxLines) : lines;
  for (const line of toRender) {
    drawText(pg, line, x, ty(topY, size), font, size, color);
    topY += lineH;
  }
  return topY;
}

/** Draws a stat box: big centered number + small bottom label. */
function drawStatBox(pg: PDFPage, label: string, value: string,
  x: number, topY: number, w: number, h: number, reg: PDFFont, bld: PDFFont, vSize = 17) {
  drawRect(pg, x, ry(topY, h), w, h, C.white, C.border, 0.7);
  const vStr = String(value ?? '—');
  drawTextC(pg, vStr, x + w / 2, ty(topY + (h - vSize) / 2 - 2, vSize), bld, vSize);
  drawTextC(pg, label.toUpperCase(), x + w / 2, ty(topY + h - 8, 6), reg, 6, C.muted);
}

/** Draws a single ability score box with score, name, and modifier circle. */
function drawAbilityBox(pg: PDFPage, ability: string, score: number, mod: number,
  x: number, topY: number, w: number, h: number, reg: PDFFont, bld: PDFFont) {
  drawRect(pg, x, ry(topY, h), w, h, C.white, C.border, 0.75);
  // Ability name
  drawTextC(pg, ability.toUpperCase(), x + w / 2, ty(topY + 5, 7), reg, 7, C.muted);
  // Score (upper-center area)
  const scoreStr = String(score);
  drawTextC(pg, scoreStr, x + w / 2, ty(topY + 16, 20), bld, 20);
  // Modifier circle (bottom center)
  const modStr = mod >= 0 ? `+${mod}` : String(mod);
  const cCX = x + w / 2;
  const cCY = ry(topY, h) + 14;
  pg.drawCircle({ x: cCX, y: cCY, size: 12, color: C.white, borderColor: C.border, borderWidth: 0.75 });
  drawTextC(pg, modStr, cCX, cCY - 4.5, bld, 9);
}

/** Draws a proficiency/skill row: dot | value | label | (ability). */
function drawSkillRow(pg: PDFPage, label: string, value: number, proficient: boolean, expert: boolean,
  x: number, topY: number, w: number, h: number, reg: PDFFont, bld: PDFFont) {
  const valStr = value >= 0 ? `+${value}` : String(value);
  const rowCY = ry(topY, h) + h / 2;
  // Proficiency dot (and expert diamond)
  if (expert) {
    pg.drawRectangle({ x: x + 4, y: rowCY - 3.5, width: 7, height: 7,
      color: C.dotOn, rotate: { type: 'degrees', angle: 45 } });
  } else {
    drawDot(pg, x + 7, rowCY, proficient);
  }
  // Value (right after dot)
  drawText(pg, valStr, x + 15, rowCY - 3.5, bld, 7.5, proficient ? C.dotOn : C.ink);
  // Name
  drawText(pg, label, x + 30, rowCY - 3.5, reg, 7.5);
  // Thin divider
  drawLine(pg, x, ry(topY, h), x + w, ry(topY, h), C.fill, 0.3);
}

// ── PAGE 1 ────────────────────────────────────────────────────────────────────

function drawHeader(pg: PDFPage, character: Character, d: ReturnType<typeof computeCharacterDerived>,
  reg: PDFFont, bld: PDFFont) {
  const hH = 40;
  // Dark background
  drawRect(pg, 0, ry(0, hH), PW, hH, C.hdrBg);
  // Character name
  const nameStr = sanitize(character.name || 'Unnamed Character');
  drawText(pg, nameStr, M, ty(6, 18), bld, 18, C.hdrFg);
  // Tagline right
  drawText(pg, 'Tavern Sheet', PW - M - tw('Tavern Sheet', reg, 7), ty(16, 7), reg, 7,
    rgb(0.55, 0.65, 0.85));
}

function drawInfoRow(pg: PDFPage, character: Character, d: ReturnType<typeof computeCharacterDerived>,
  reg: PDFFont, bld: PDFFont) {
  const topY = 40;
  const h = 36;
  drawRect(pg, 0, ry(topY, h), PW, h, C.fill);
  drawLine(pg, 0, ry(topY, h), PW, ry(topY, h), C.border, 0.4);

  const totalLvl = totalCharacterLevel(character.classes);
  const classStr = character.classes
    .map(cl => { const def = getClass(cl.classId); return `${def?.name ?? cl.classId} ${cl.level}`; })
    .join(' / ');
  const subStr = character.classes
    .map(cl => cl.subclassId ? getSubclass(cl.subclassId)?.name ?? '' : '')
    .filter(Boolean).join(', ');
  const raceStr = character.raceName || character.raceId || '—';
  const bgStr = character.background || '—';
  const alignStr = character.alignment || '—';
  const xpStr = character.xp != null ? String(character.xp) : '—';
  const profStr = `+${d.profBonus}`;

  const fields = [
    { label: 'Class & Level', value: classStr || '—' },
    { label: 'Subclass', value: subStr || '—' },
    { label: 'Race', value: raceStr },
    { label: 'Background', value: bgStr },
    { label: 'Alignment', value: alignStr },
    { label: 'Total Level', value: String(totalLvl) },
    { label: 'Prof Bonus', value: profStr },
  ];

  const fieldW = (PW - 2 * M - 6 * 4) / 7;
  fields.forEach((f, i) => {
    const fx = M + i * (fieldW + 4);
    // Value
    const vStr = f.value.length > 14 ? f.value.slice(0, 13) + '…' : f.value;
    drawText(pg, vStr, fx + 2, ty(topY + 7, 8.5), bld, 8.5);
    // Label
    drawText(pg, f.label, fx + 2, ty(topY + 22, 6.5), reg, 6.5, C.muted);
    // Separator
    if (i > 0) drawLine(pg, fx, ry(topY, h) + 4, fx, ry(topY, h) + h - 4, C.border, 0.4);
  });
}

function drawAbilityScores(pg: PDFPage, d: ReturnType<typeof computeCharacterDerived>,
  x: number, topY: number, w: number, reg: PDFFont, bld: PDFFont) {
  drawSecLabel(pg, 'Ability Scores', x, topY, w, reg);
  topY += 11;

  const abilities: { key: string; label: string }[] = [
    { key: 'str', label: 'Strength'  }, { key: 'dex', label: 'Dexterity' },
    { key: 'con', label: 'Constitution' }, { key: 'int', label: 'Intelligence' },
    { key: 'wis', label: 'Wisdom'    }, { key: 'cha', label: 'Charisma'   },
  ];

  const cols = 3;
  const boxH = 72;
  const rowGap = 5;
  const boxW = Math.floor((w - (cols - 1) * 3) / cols);

  for (let i = 0; i < 6; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const bx = x + col * (boxW + 3);
    const bTopY = topY + row * (boxH + rowGap);
    const ab = abilities[i];
    const score = (d.finalScores as any)[ab.key] ?? 10;
    const mod   = (d.mods as any)[ab.key] ?? 0;
    drawAbilityBox(pg, ab.label.slice(0, 3), score, mod, bx, bTopY, boxW, boxH, reg, bld);
  }
}

function drawSavingThrows(pg: PDFPage, d: ReturnType<typeof computeCharacterDerived>,
  x: number, topY: number, w: number, reg: PDFFont, bld: PDFFont) {
  drawSecLabel(pg, 'Saving Throws', x, topY, w, reg);
  topY += 11;

  const saves = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const labels: Record<string, string> = {
    str: 'Strength', dex: 'Dexterity', con: 'Constitution',
    int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
  };
  const rowH = 15;
  saves.forEach((k, i) => {
    const val  = (d.savingThrows as any)[k] ?? 0;
    const prof = (d.savingThrowProficiencies as Set<string>).has(k);
    drawSkillRow(pg, labels[k], val, prof, false, x, topY + i * rowH, w, rowH, reg, bld);
  });
}

function drawSkills(pg: PDFPage, d: ReturnType<typeof computeCharacterDerived>,
  x: number, topY: number, w: number, reg: PDFFont, bld: PDFFont) {
  drawSecLabel(pg, 'Skills', x, topY, w, reg);
  topY += 11;

  const skillList = Object.keys(SKILL_ABILITY);
  const rowH = 14;
  skillList.forEach((skill, i) => {
    const val    = (d.skills as any)[skill] ?? 0;
    const prof   = d.allSkillProficiencies.has(skill);
    const expert = d.allSkillProficiencies.has(skill + ':expertise');
    // Short ability tag
    const ab = SKILL_ABILITY[skill].slice(0, 3).toUpperCase();
    const label = `${skill}`;
    drawSkillRow(pg, label, val, prof, expert, x, topY + i * rowH, w, rowH, reg, bld);
    // Ability tag on far right
    drawText(pg, ab, x + w - tw(ab, reg, 6) - 2, ty(topY + i * rowH + 3.5, 6), reg, 6, C.muted);
  });
}

function drawPassivePerception(pg: PDFPage, d: ReturnType<typeof computeCharacterDerived>,
  character: Character, x: number, topY: number, w: number, reg: PDFFont, bld: PDFFont) {
  drawRect(pg, x, ry(topY, 24), w, 24, C.white, C.border, 0.6);
  drawText(pg, 'Passive Perception', x + 4, ty(topY + 4, 7), reg, 7, C.muted);
  drawText(pg, String(d.passivePerception), x + w - tw(String(d.passivePerception), bld, 12) - 6, ty(topY + 4, 12), bld, 12);
}

function drawCombatStats(pg: PDFPage, character: Character, d: ReturnType<typeof computeCharacterDerived>,
  x: number, topY: number, w: number, reg: PDFFont, bld: PDFFont) {
  const h = 54;
  const bw = Math.floor((w - 2 * 4) / 3);
  const initStr = d.initiative >= 0 ? `+${d.initiative}` : String(d.initiative);
  drawStatBox(pg, 'Armor Class', String(d.ac),         x,                topY, bw, h, reg, bld, 18);
  drawStatBox(pg, 'Initiative',  initStr,               x + bw + 4,       topY, bw, h, reg, bld, 18);
  drawStatBox(pg, 'Speed',       `${d.speed} ft`,       x + 2*(bw + 4),   topY, bw, h, reg, bld, 16);
}

function drawHP(pg: PDFPage, character: Character,
  x: number, topY: number, w: number, reg: PDFFont, bld: PDFFont) {
  drawSecLabel(pg, 'Hit Points', x, topY, w, reg);
  topY += 11;
  const h = 54;
  const bw = Math.floor((w - 2 * 4) / 3);
  drawStatBox(pg, 'HP Maximum',  String(character.maxHP ?? '—'),     x,               topY, bw, h, reg, bld, 17);
  drawStatBox(pg, 'Current HP',  String(character.currentHP ?? '—'), x + bw + 4,      topY, bw, h, reg, bld, 17);
  drawStatBox(pg, 'Temporary HP',String(character.tempHP > 0 ? character.tempHP : '—'), x + 2*(bw+4), topY, bw, h, reg, bld, 17);
}

function drawHitDiceAndDeathSaves(pg: PDFPage, character: Character, d: ReturnType<typeof computeCharacterDerived>,
  x: number, topY: number, w: number, reg: PDFFont, bld: PDFFont) {
  const h = 46;

  // Hit Dice (left half)
  const hdW = Math.floor(w * 0.42);
  drawRect(pg, x, ry(topY, h), hdW, h, C.white, C.border, 0.6);
  drawTextC(pg, 'HIT DICE', x + hdW / 2, ty(topY + h - 8, 6), reg, 6, C.muted);
  const hdStrs = character.classes.map(cl => {
    const used  = (character.hitDiceUsed ?? {})[cl.classId] ?? 0;
    const def   = getClass(cl.classId);
    return `${cl.level - used}/${cl.level}d${def?.hitDie ?? '?'}`;
  });
  const hdStr = hdStrs.join(' ');
  drawTextC(pg, hdStr, x + hdW / 2, ty(topY + 14, 10), bld, 10);

  // Death Saves (right portion)
  const dsX = x + hdW + 6;
  const dsW = w - hdW - 6;
  drawRect(pg, dsX, ry(topY, h), dsW, h, C.white, C.border, 0.6);
  drawTextC(pg, 'DEATH SAVES', dsX + dsW / 2, ty(topY + h - 8, 6), reg, 6, C.muted);

  const successes = character.deathSaves?.successes ?? 0;
  const failures  = character.deathSaves?.failures  ?? 0;

  const dotY = ry(topY, h) + 18;
  const sucX  = dsX + 8;
  drawText(pg, 'Successes', sucX, dotY + 2, reg, 6.5, C.green);
  for (let i = 0; i < 3; i++) drawDot(pg, sucX + 58 + i * 14, dotY + 4.5, i < successes);
  const failX = dsX + 8;
  const failDotY = dotY - 14;
  drawText(pg, 'Failures', failX, failDotY + 2, reg, 6.5, C.red);
  for (let i = 0; i < 3; i++) drawDot(pg, failX + 58 + i * 14, failDotY + 4.5, i < failures);
}

function drawAttacks(pg: PDFPage, character: Character, d: ReturnType<typeof computeCharacterDerived>,
  x: number, topY: number, w: number, reg: PDFFont, bld: PDFFont) {
  drawSecLabel(pg, 'Attacks & Spellcasting', x, topY, w, reg);
  topY += 11;

  // Column header
  const nameW = Math.floor(w * 0.42);
  const atkW  = Math.floor(w * 0.20);
  const dmgW  = w - nameW - atkW - 2;
  drawRect(pg, x, ry(topY, 11), w, 11, C.fill);
  drawText(pg, 'NAME',        x + 3,              ty(topY + 2, 6.5), reg, 6.5, C.muted);
  drawText(pg, 'ATK BONUS',   x + nameW + 2,      ty(topY + 2, 6.5), reg, 6.5, C.muted);
  drawText(pg, 'DAMAGE/TYPE', x + nameW + atkW + 3, ty(topY + 2, 6.5), reg, 6.5, C.muted);
  topY += 11;

  // Weapons (up to 4 equipped)
  const weapons = (character.inventory ?? [])
    .filter(it => it.equipped && (it.category === 'weapon' || it.category === 'gear') && it.damage);
  const rows = Math.min(weapons.length + 1, 4); // at least 1 blank row

  for (let i = 0; i < rows; i++) {
    const rowH = 20;
    const rowY = ry(topY + i * rowH, rowH);
    drawRect(pg, x, rowY, w, rowH, i % 2 === 0 ? C.white : C.fill, C.border, 0.4);

    if (weapons[i]) {
      const wp = weapons[i];
      const nameStr = wp.name.length > 18 ? wp.name.slice(0, 17) + '…' : wp.name;
      drawText(pg, nameStr, x + 3, rowY + 6, bld, 8);
      // Atk bonus is shown from weapon data if available, otherwise blank
      const atkStr = (wp as any).atkBonus != null ? `+${(wp as any).atkBonus}` : '—';
      drawTextC(pg, atkStr, x + nameW + atkW / 2, rowY + 6, bld, 8);
      drawText(pg, (wp as any).damage || '—', x + nameW + atkW + 3, rowY + 6, reg, 8);
    }
    drawLine(pg, x + nameW, rowY, x + nameW, rowY + rowH, C.border, 0.4);
    drawLine(pg, x + nameW + atkW, rowY, x + nameW + atkW, rowY + rowH, C.border, 0.4);
  }
  topY += rows * 20;

  // Spell attack info if caster
  if (d.spellSaveDC > 0) {
    const infoH = 22;
    drawRect(pg, x, ry(topY, infoH), w, infoH, C.fill, C.border, 0.4);
    const atkBonusStr = d.spellAttackBonus >= 0 ? `+${d.spellAttackBonus}` : String(d.spellAttackBonus);
    drawText(pg, `Spell Save DC: ${d.spellSaveDC}   Spell Attack: ${atkBonusStr}`, x + 5, ty(topY + 5, 8.5), reg, 8.5);
  }
}

function drawPersonalitySection(pg: PDFPage, character: Character,
  x: number, topY: number, w: number, h: number, reg: PDFFont, bld: PDFFont) {
  const halfW  = Math.floor((w - 4) / 2);
  const halfH  = Math.floor((h - 4) / 2);

  const boxes = [
    { label: 'Personality Traits', value: character.personalityTraits ?? '', x: x,            yTop: topY },
    { label: 'Ideals',             value: character.ideals ?? '',           x: x + halfW + 4, yTop: topY },
    { label: 'Bonds',              value: character.bonds ?? '',            x: x,             yTop: topY + halfH + 4 },
    { label: 'Flaws',              value: character.flaws ?? '',            x: x + halfW + 4, yTop: topY + halfH + 4 },
  ];

  boxes.forEach(b => {
    drawRect(pg, b.x, ry(b.yTop, halfH), halfW, halfH, C.white, C.border, 0.6);
    drawText(pg, b.label.toUpperCase(), b.x + 3, ty(b.yTop + 4, 6), reg, 6, C.muted);
    const innerH = halfH - 14;
    const lineH = 9.5;
    const maxL = Math.floor(innerH / lineH);
    drawWrappedText(pg, b.value, b.x + 4, b.yTop + 12, halfW - 8, reg, 7.5, lineH, C.ink, maxL);
  });
}

function drawFeaturesSection(pg: PDFPage, character: Character,
  x: number, topY: number, w: number, h: number, reg: PDFFont, bld: PDFFont) {
  drawSecLabel(pg, 'Features & Traits', x, topY, w, reg);
  topY += 11;
  drawRect(pg, x, ry(topY, h - 11), w, h - 11, C.white, C.border, 0.6);

  const features = character.classes.flatMap(cl => {
    const def = getClass(cl.classId);
    const sub = cl.subclassId ? getSubclass(cl.subclassId) : undefined;
    return [
      ...(def?.features.filter(f => f.level <= cl.level && !f.isASI) ?? []).map(f => f.name),
      ...(sub?.features.filter(f => f.level <= cl.level) ?? []).map(f => f.name),
    ];
  });

  const featureText = features.join(' · ') || (character.features || '');
  const lineH = 9;
  const maxL = Math.floor((h - 14) / lineH);
  drawWrappedText(pg, featureText, x + 4, topY + 4, w - 8, reg, 7.5, lineH, C.ink, maxL);
}

function drawInspirationAndProf(pg: PDFPage, character: Character, d: ReturnType<typeof computeCharacterDerived>,
  x: number, topY: number, w: number, reg: PDFFont, bld: PDFFont) {
  const h = 30;
  const hw = Math.floor((w - 3) / 2);
  // Inspiration
  drawRect(pg, x, ry(topY, h), hw, h, C.white, C.border, 0.6);
  drawTextC(pg, 'INSPIRATION', x + hw / 2, ty(topY + h - 8, 6), reg, 6, C.muted);
  if (character.inspiration) {
    pg.drawCircle({ x: x + hw / 2, y: ry(topY, h) + 12, size: 8, color: C.dotOn });
  } else {
    pg.drawCircle({ x: x + hw / 2, y: ry(topY, h) + 12, size: 8, color: C.white, borderColor: C.border, borderWidth: 0.7 });
  }
  // Proficiency Bonus
  drawStatBox(pg, 'Prof Bonus', `+${d.profBonus}`, x + hw + 3, topY, hw, h, reg, bld, 13);
}

// ── MAIN PAGE 1 DRAW ──────────────────────────────────────────────────────────
function drawPage1(pg: PDFPage, character: Character, d: ReturnType<typeof computeCharacterDerived>,
  reg: PDFFont, bld: PDFFont) {
  // White background
  drawRect(pg, 0, 0, PW, PH, C.white);

  drawHeader(pg, character, d, reg, bld);
  drawInfoRow(pg, character, d, reg, bld);

  // ── Layout constants ──────────────────────────────────────────────────────
  const contentTop = 76;
  const contentBot = PH - M;    // = 774
  const contentH   = contentBot - contentTop;  // 698

  const leftX = M;
  const leftW = 187;
  const rightX = M + leftW + 8;
  const rightW = PW - M - rightX;

  // ── Left column sections (top-down) ───────────────────────────────────────
  let ly = contentTop;

  // 1. Ability scores: 11 label + 2*(72+5) = 165. Total = 176
  drawAbilityScores(pg, d, leftX, ly, leftW, reg, bld);
  ly += 176;

  // 2. Inspiration + Prof bonus: 30
  drawInspirationAndProf(pg, character, d, leftX, ly, leftW, reg, bld);
  ly += 34;

  // 3. Saving throws: 11 label + 6*15 = 90. Total = 101
  drawSavingThrows(pg, d, leftX, ly, leftW, reg, bld);
  ly += 101;

  // 4. Skills: 11 label + 18*14 = 252. Total = 263
  drawSkills(pg, d, leftX, ly, leftW, reg, bld);
  ly += 263;

  // 5. Passive perception: 24
  drawPassivePerception(pg, d, character, leftX, ly, leftW, reg, bld);
  // (remaining space in left col unused or for languages — skip for now)

  // ── Right column sections (top-down) ──────────────────────────────────────
  let ry2 = contentTop;

  // 1. Combat stats: 54
  drawCombatStats(pg, character, d, rightX, ry2, rightW, reg, bld);
  ry2 += 58;

  // 2. HP: 11 label + 54 boxes = 65
  drawHP(pg, character, rightX, ry2, rightW, reg, bld);
  ry2 += 69;

  // 3. Hit dice + death saves: 46
  drawHitDiceAndDeathSaves(pg, character, d, rightX, ry2, rightW, reg, bld);
  ry2 += 50;

  // 4. Attacks: 11 label + 11 header + 4*20 weapons + 22 spell info = ~124 (max)
  const spellInfoH = d.spellSaveDC > 0 ? 22 : 0;
  const weaponRows = Math.min((character.inventory ?? []).filter(it => it.equipped && it.damage).length + 1, 4);
  const attacksH = 11 + 11 + weaponRows * 20 + spellInfoH;
  drawAttacks(pg, character, d, rightX, ry2, rightW, reg, bld);
  ry2 += attacksH + 6;

  // 5. Personality traits (2×2 grid)
  const remainingH = contentH - (ry2 - contentTop);
  const personalityH = Math.min(Math.floor(remainingH * 0.45), 160);
  const featuresH    = remainingH - personalityH - 6;

  drawPersonalitySection(pg, character, rightX, ry2, rightW, personalityH, reg, bld);
  ry2 += personalityH + 6;

  // 6. Features & traits
  if (featuresH > 20) {
    drawFeaturesSection(pg, character, rightX, ry2, rightW, featuresH, reg, bld);
  }
}

// ── SPELL PAGE ────────────────────────────────────────────────────────────────
function drawSpellPage(pg: PDFPage, character: Character, d: ReturnType<typeof computeCharacterDerived>,
  reg: PDFFont, bld: PDFFont) {
  drawRect(pg, 0, 0, PW, PH, C.white);
  drawHeader(pg, character, d, reg, bld);

  // Spellcasting info row
  const infoTop = 40;
  const infoH   = 40;
  drawRect(pg, 0, ry(infoTop, infoH), PW, infoH, C.fill);
  drawLine(pg, 0, ry(infoTop, infoH), PW, ry(infoTop, infoH), C.border, 0.4);

  const abilityLabels: Record<string, string> = {
    str: 'Strength', dex: 'Dexterity', con: 'Constitution',
    int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma',
  };
  const spellAbility = abilityLabels[(d as any).spellcastingAbility as string ?? ''] ?? '—';
  const atkBonusStr  = d.spellAttackBonus >= 0 ? `+${d.spellAttackBonus}` : String(d.spellAttackBonus);

  const infoFields = [
    { label: 'Spellcasting Class', value: character.classes.find(cl => {
        const def = getClass(cl.classId);
        return def && def.spellcastingType !== 'none';
      })?.classId?.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) ?? '—' },
    { label: 'Spellcasting Ability', value: spellAbility },
    { label: 'Spell Save DC', value: String(d.spellSaveDC) },
    { label: 'Spell Attack Bonus', value: atkBonusStr },
  ];
  const fw = (PW - 2 * M - 3 * 6) / 4;
  infoFields.forEach((f, i) => {
    const fx = M + i * (fw + 6);
    drawText(pg, f.value, fx + 3, ty(infoTop + 7, 9), bld, 9);
    drawText(pg, f.label, fx + 3, ty(infoTop + 22, 6.5), reg, 6.5, C.muted);
    if (i > 0) drawLine(pg, fx, ry(infoTop, infoH) + 4, fx, ry(infoTop, infoH) + infoH - 4, C.border, 0.4);
  });

  // Spell slot row
  const slotTop = 80;
  const slotH = 28;
  drawRect(pg, M, ry(slotTop, slotH), PW - 2 * M, slotH, C.fill, C.border, 0.5);
  drawTextC(pg, 'SPELL SLOTS', M + 30, ty(slotTop + 3, 6), reg, 6, C.muted);

  const slotW = (PW - 2 * M - 60) / 9;
  for (let lvl = 1; lvl <= 9; lvl++) {
    const total = (d.slotTotals as any)[lvl] ?? 0;
    const used  = (character.spellSlotsUsed ?? {})[lvl as 1] ?? 0;
    const slotX = M + 60 + (lvl - 1) * slotW;
    drawTextC(pg, String(lvl), slotX + slotW / 2, ty(slotTop + 3, 7), reg, 7, C.muted);
    const avail = Math.max(0, total - used);
    const slotDotY = ry(slotTop, slotH) + 8;
    for (let d2 = 0; d2 < Math.min(total, 5); d2++) {
      pg.drawCircle({ x: slotX + (slotW / Math.min(total, 5)) * (d2 + 0.5), y: slotDotY,
        size: 4, color: d2 < avail ? C.dotOn : C.white, borderColor: C.border, borderWidth: 0.6 });
    }
    if (total > 5) {
      drawTextC(pg, `${avail}/${total}`, slotX + slotW / 2, slotDotY - 2, bld, 7.5);
    }
  }

  // Spell list
  const spellsTop = 108;
  const maxBottom = PH - M;
  let curTop = spellsTop;

  const levels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (const lvl of levels) {
    if (curTop + 18 > maxBottom) break;

    const spellsAtLevel = (character.spellbook ?? [])
      .map(entry => getSpell(entry.spellId))
      .filter(s => s && s.level === lvl)
      .sort((a, b) => (a!.name ?? '').localeCompare(b!.name ?? ''));

    if (!spellsAtLevel.length) continue;

    // Level header
    const lvlLabel = lvl === 0 ? 'Cantrips' : `Level ${lvl} Spells`;
    drawSecLabel(pg, lvlLabel, M, curTop, PW - 2 * M, reg);
    curTop += 11;

    // Two-column spell list
    const colW = Math.floor((PW - 2 * M - 8) / 2);
    const rowH  = 13;
    const colCount = 2;

    spellsAtLevel.forEach((spell, idx) => {
      if (!spell) return;
      const col = idx % colCount;
      const row = Math.floor(idx / colCount);
      const sx  = M + col * (colW + 8);
      const sTopY = curTop + row * rowH;
      if (sTopY + rowH > maxBottom) return;

      const spellBg = idx % 2 === 0 ? C.white : C.fill;
      drawRect(pg, sx, ry(sTopY, rowH), colW, rowH, spellBg);
      const maxNameW = colW - 40;
      const nameStr = spell.name.length > 24 ? spell.name.slice(0, 23) + '…' : spell.name;
      drawText(pg, nameStr, sx + 3, ty(sTopY + 2, 8), reg, 8);
      // Tags: C = concentration, R = ritual
      let tags = '';
      if (spell.concentration) tags += ' C';
      if (spell.ritual) tags += ' R';
      if (tags) drawText(pg, tags.trim(), sx + colW - 16, ty(sTopY + 2, 7), reg, 7, C.muted);

      // Thin horizontal divider
      drawLine(pg, sx, ry(sTopY, rowH), sx + colW, ry(sTopY, rowH), C.fill, 0.3);
    });

    const rows = Math.ceil(spellsAtLevel.length / colCount);
    curTop += rows * rowH + 4;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────
export async function generateCharacterPDF(character: Character): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bld = await doc.embedFont(StandardFonts.HelveticaBold);

  const d = computeCharacterDerived(character);

  const p1 = doc.addPage([PW, PH]);
  drawPage1(p1, character, d, reg, bld);

  // Add spell page if character has any spells
  const hasSpells = (character.spellbook?.length ?? 0) > 0;
  const hasSlots  = Object.values(d.slotTotals ?? {}).some(v => v > 0);
  if (hasSpells || hasSlots) {
    const p2 = doc.addPage([PW, PH]);
    drawSpellPage(p2, character, d, reg, bld);
  }

  return doc.save();
}
