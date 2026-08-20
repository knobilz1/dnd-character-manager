import { getClassStartingEquipment } from '../data/startingEquipment';
import { getBackground } from '../data/backgrounds';
import { getItemByName, getPackContents } from '../data/items';
import type { InventoryItem, ItemCategory } from '../types';

/**
 * Starting equipment + gold from a class's package choices and a background's
 * kit — the ONE builder both paths share. It used to live inline inside
 * StepEquipment's effect, which meant it only ran when the player walked
 * through that step: "make one for me" skipped it, and every generated
 * character arrived with an empty pack and 0 gp.
 */

function defaultId(): string {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface StartingLoadout {
  inventory: InventoryItem[];
  /** Background gold + coin bundled into the chosen class package (PHB 2024's "... + 15 gp"). */
  gp: number;
}

export function buildStartingLoadout(
  classId: string | undefined,
  backgroundId: string | undefined,
  equipmentChoices: Record<number, number>,
  takeGold: boolean,
  makeId: () => string = defaultId,
): StartingLoadout {
  const items: InventoryItem[] = [];

  function pushItem(name: string, quantity: number, category: string | undefined, weight: number | undefined, source: 'class' | 'background') {
    const contents = getPackContents(name);
    if (contents) {
      for (const entry of contents) {
        const tpl = getItemByName(entry.name);
        items.push({
          id: makeId(),
          name: entry.name,
          quantity: entry.quantity,
          category: tpl?.category ?? 'gear',
          weight: tpl?.weight,
          description: tpl?.description,
          source,
        });
      }
    } else {
      const template = getItemByName(name);
      items.push({
        id: makeId(),
        name,
        quantity,
        category: (category ?? template?.category ?? 'other') as ItemCategory,
        weight: weight ?? template?.weight,
        description: template?.description,
        source,
      });
    }
  }

  // Coin bundled into the chosen package (PHB 2024 packages read "... + 15 gp"). Distinct from
  // the 2014 either/or `startingGold`, which the takeGold branch skips entirely.
  const classEq = classId ? getClassStartingEquipment(classId) : undefined;
  let classGP = 0;
  if (classEq && !takeGold) {
    for (const f of classEq.fixed) {
      pushItem(f.name, f.quantity ?? 1, f.category, f.weight, 'class');
    }
    classEq.choices.forEach((choice, idx) => {
      const optIdx = equipmentChoices[idx];
      if (optIdx == null) return;
      const opt = choice.options[optIdx];
      if (!opt) return;
      for (const it of opt.items) {
        pushItem(it.name, it.quantity ?? 1, it.category, it.weight, 'class');
      }
      classGP += opt.gold ?? 0;
    });
  }

  // Background equipment (always — bg equipment is a flat list of strings).
  const bg = backgroundId ? getBackground(backgroundId) : undefined;
  let bgGP = 0;
  if (bg) {
    for (const eqStr of bg.equipment) {
      const goldMatch = eqStr.trim().match(/^(\d+)\s*gp$/i);
      if (goldMatch) {
        bgGP += parseInt(goldMatch[1], 10);
      } else {
        // "20 Arrows" is twenty arrows, not one item called "20 Arrows". The 2024 background
        // kits list counts inline, so the leading number becomes the quantity and the weight
        // and encumbrance follow from it.
        const counted = eqStr.trim().match(/^(\d+)\s+(.+)$/);
        pushItem(counted ? counted[2] : eqStr.trim(), counted ? parseInt(counted[1], 10) : 1,
          undefined, undefined, 'background');
      }
    }
  }

  return { inventory: items, gp: bgGP + classGP };
}
