#!/usr/bin/env node
/**
 * armor-prompt.cjs [pieceId]
 *
 * Prints the Tripo prompt for a wardrobe piece from public/models/armor/manifest.json.
 * With no argument, prints every NOT_STARTED piece (id + prompt) so a generation run
 * can be driven straight down the list.
 *
 * Prompts are assembled, not hand-written, so all 30 stay consistent: one wardrobe
 * material language x one slot definition x a shared style/negative suffix. Hand-writing
 * them drifts, and drift is invisible until two wardrobes stop looking distinct.
 *
 * The ANTI-FUSION line exists because of a measured failure: a SHOULDERS prompt that
 * merely listed "chest armor" among the negatives still came back with the two pauldrons
 * joined by a full breastplate. Naming the forbidden neighbour slot in the NEGATIVES is
 * not enough — the requirement has to be stated positively ("exactly one separate piece,
 * nothing bridging left and right") or Tripo fills the gap between two symmetric halves.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST = path.join(__dirname, '..', 'public', 'models', 'armor', 'manifest.json');

/** Slot definition + the specific fusion each slot is prone to. */
const SLOTS = {
  TORSO: {
    what: 'A single isolated torso wearable, chest and back covering only,',
    only: 'Generate only the torso wearable.',
    antiFusion: 'It must END at the shoulder seam and the waist. Nothing covering the upper arms, no shoulder pads or pauldrons attached, no sleeves, no skirt, no belt.',
    exclude: 'shoulder pads, pauldrons, gloves, pants, skirt, belt, boots, helmet, cape',
  },
  LEGS: {
    what: 'A single isolated lower-body wearable, hips to ankles,',
    only: 'Generate only the lower-body wearable.',
    antiFusion: 'It must END at the waist and at the ankle. No boots or footwear attached at the bottom, no belt or torso garment at the top.',
    exclude: 'torso clothing, gloves, shoulder pads, boots, belt, helmet, cape',
  },
  HANDS: {
    what: 'A matched left-and-right pair of armored gloves with individual articulated fingers as one isolated wearable asset,',
    only: 'Generate only the matched left-and-right hand pair as one asset.',
    antiFusion: 'Each glove covers the WHOLE HAND: palm, back, and five articulated fingers with a thumb. Left and right gloves SEPARATE. Each ends at the wrist, no bracer or forearm armour up the arm.',
    exclude: 'sleeves, arms, torso armor, weapons',
  },
  SHOULDERS: {
    what: 'A matched left-and-right pair of shoulder pauldrons as one isolated wearable asset,',
    only: 'Generate only the matched left-and-right shoulder pair as one asset.',
    antiFusion: 'The left and right pauldrons must be SEPARATE, free-floating pieces with EMPTY SPACE between them. Absolutely no chest plate, breastplate, gorget, yoke, collar or strap bridging or connecting the two sides.',
    exclude: 'chest armor, breastplate, sleeves, cape, helmet',
  },
  FEET: {
    what: 'A matched left-and-right pair of boots as one isolated wearable asset,',
    only: 'Generate only the matched left-and-right boot pair as one asset.',
    antiFusion: 'The left and right boots must be SEPARATE from each other. Each ends at mid-calf; no trousers, greaves or leg armour continuing up the leg.',
    exclude: 'pants, legs, leg armor, floor',
  },
  HEAD: {
    what: 'A single isolated piece of headwear,',
    only: 'Generate only the headwear.',
    antiFusion: 'It must END at the jaw and the nape. Nothing covering the neck or shoulders, no gorget, no attached collar or mantle.',
    exclude: 'head, face, hair, neck, gorget, shoulder armor',
  },
};

function buildPrompt(m, piece) {
  const s = SLOTS[piece.slot];
  if (!s) throw new Error(`unknown slot ${piece.slot}`);
  const material = m.wardrobes[piece.wardrobe];
  return [
    `${s.what} for an adult fantasy character. ${material}`,
    m.styleSuffix,
    s.antiFusion,
    `${s.only} Do not include ${s.exclude}, or a body.`,
    m.negativeSuffix,
  ].join(' ');
}

function main() {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const want = process.argv[2];
  const pieces = want
    ? m.pieces.filter((p) => p.id === want)
    : m.pieces.filter((p) => p.status === 'NOT_STARTED');

  if (!pieces.length) {
    console.error(want ? `no piece with id "${want}"` : 'nothing NOT_STARTED');
    process.exit(1);
  }
  for (const p of pieces) {
    const prompt = buildPrompt(m, p);
    console.log(`=== ${p.id} (${p.wardrobe}/${p.slot}) [${prompt.length} chars] ===`);
    console.log(prompt);
    console.log('');
  }
}

main();
