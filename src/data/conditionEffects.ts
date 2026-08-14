import type { Condition } from '../types';

/**
 * The mechanical half of each condition, in one table.
 *
 * The condition list on the sheet was a set of labels with rules text and nothing
 * behind it: `character.conditions` was read by no derived code at all, so
 * Poisoned promised "disadvantage on attack rolls and ability checks" in its own
 * tooltip and changed no roll. That made the automation inconsistent inside a
 * single system, since exhaustion and armour penalties already applied themselves.
 *
 * Only effects on rolls the PLAYER makes are modelled. Effects on rolls made
 * AGAINST the character (attacks against you have advantage, hits within 5 ft are
 * critical) belong to the DM's side of the screen and are left in the tooltip.
 *
 * `situational` marks a rule whose trigger the sheet cannot see. Those are still
 * applied — at a table the source of fear is usually visible and an invisible
 * character is usually unseen — because the common case is right far more often
 * than not, and the dice roller's manual advantage/disadvantage toggles are the
 * escape hatch for when it isn't. The same call the existing Danger Sense
 * advantage already makes.
 */
export interface ConditionEffect {
  /** Disadvantage on the character's own attack rolls. */
  disadvAttacks?: boolean;
  /** Advantage on the character's own attack rolls. */
  advAttacks?: boolean;
  /** Disadvantage on ability checks (and therefore skill checks). */
  disadvChecks?: boolean;
  /** Disadvantage on Dexterity saving throws specifically. */
  disadvDexSaves?: boolean;
  /** Strength and Dexterity saves fail automatically — no roll is worth making. */
  autoFailStrDexSaves?: boolean;
  /** Speed drops to 0. */
  speedZero?: boolean;
  /** Why this one may not apply, when the sheet cannot tell. */
  situational?: string;
}

export const CONDITION_EFFECTS: Partial<Record<Condition, ConditionEffect>> = {
  Blinded: { disadvAttacks: true },
  Frightened: {
    disadvAttacks: true,
    disadvChecks: true,
    situational: 'only while the source of fear is in line of sight',
  },
  Grappled: { speedZero: true },
  Invisible: {
    advAttacks: true,
    situational: 'only against creatures that cannot see you',
  },
  Paralyzed: { autoFailStrDexSaves: true, speedZero: true },
  Petrified: { autoFailStrDexSaves: true, speedZero: true },
  Poisoned: { disadvAttacks: true, disadvChecks: true },
  Prone: { disadvAttacks: true },
  Restrained: { disadvAttacks: true, disadvDexSaves: true, speedZero: true },
  Stunned: { autoFailStrDexSaves: true, speedZero: true },
  Unconscious: { autoFailStrDexSaves: true, speedZero: true },
  // Charmed, Deafened and Incapacitated change what you MAY do rather than how a
  // die lands, so they carry no roll effect. Exhaustion is tracked separately as a
  // level, not as a member of this list.
};

/** Conditions the character has that produce a given effect, for both the roll
 *  mode and the tooltip that has to explain it. */
export function conditionsCausing(
  conditions: Condition[] | undefined,
  key: keyof Omit<ConditionEffect, 'situational'>,
): Condition[] {
  return (conditions ?? []).filter(c => CONDITION_EFFECTS[c]?.[key]);
}
