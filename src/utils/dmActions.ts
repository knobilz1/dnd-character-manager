import type { Character, Condition } from '../types';

/**
 * dmActions.ts — parses the ```dm-actions block the DM persona is instructed to
 * emit (see dmPrompt.ts) and applies it to the party's Character objects.
 *
 * Mirrors the damage/heal/condition semantics from the original standalone
 * dnd-dm MCP server (temp HP absorbed before real HP, heal clears death saves
 * when reviving from 0, etc.) but operating on plain Character objects instead
 * of a party-tools protocol.
 */

interface NameAmount { name: string; amount: number }
interface NameCondition { name: string; condition: string }
interface NameLevel { name: string; level: number }
interface NameBool { name: string; value: boolean }

export interface DmActionSet {
  damage?: NameAmount[];
  heal?: NameAmount[];
  tempHp?: NameAmount[];
  addCondition?: NameCondition[];
  removeCondition?: NameCondition[];
  exhaustion?: NameLevel[];
  inspiration?: NameBool[];
}

const ACTIONS_BLOCK = /```dm-actions\s*([\s\S]*?)```/i;

/** Splits a DM reply into spoken narration + parsed actions (if any). */
export function parseDmReply(reply: string): { narration: string; actions: DmActionSet | null } {
  const match = reply.match(ACTIONS_BLOCK);
  if (!match) return { narration: reply.trim(), actions: null };

  const narration = reply.replace(ACTIONS_BLOCK, '').trim();
  try {
    const actions = JSON.parse(match[1].trim()) as DmActionSet;
    return { narration, actions };
  } catch (e) {
    console.warn('dm-actions block failed to parse:', e);
    return { narration: reply.trim(), actions: null };
  }
}

function findIndex(party: Character[], name: string): number {
  const key = name.trim().toLowerCase();
  const exact = party.findIndex((c) => c.name.trim().toLowerCase() === key);
  if (exact !== -1) return exact;
  return party.findIndex((c) => c.name.trim().toLowerCase().startsWith(key));
}

/** Applies a parsed action set to the party, returning a new array. Characters
 *  with no matching action keep their original object reference (so callers can
 *  cheaply detect which ones actually changed). */
export function applyDmActions(party: Character[], actions: DmActionSet): Character[] {
  const next = [...party];

  const mutate = (name: string, fn: (c: Character) => Character) => {
    const idx = findIndex(next, name);
    if (idx === -1) return;
    next[idx] = fn(next[idx]);
  };

  for (const { name, amount } of actions.damage ?? []) {
    mutate(name, (c) => {
      let dmg = amount;
      let tempHP = c.tempHP ?? 0;
      if (tempHP > 0) { const absorbed = Math.min(tempHP, dmg); tempHP -= absorbed; dmg -= absorbed; }
      return { ...c, tempHP, currentHP: Math.max(0, c.currentHP - dmg) };
    });
  }

  for (const { name, amount } of actions.heal ?? []) {
    mutate(name, (c) => {
      const was = c.currentHP;
      const currentHP = Math.min(c.maxHP, c.currentHP + amount);
      const deathSaves = was === 0 && currentHP > 0 ? { successes: 0, failures: 0 } : c.deathSaves;
      return { ...c, currentHP, deathSaves };
    });
  }

  for (const { name, amount } of actions.tempHp ?? []) {
    mutate(name, (c) => ({ ...c, tempHP: Math.max(0, amount) }));
  }

  for (const { name, condition } of actions.addCondition ?? []) {
    mutate(name, (c) => (
      c.conditions.some((x) => x.toLowerCase() === condition.toLowerCase())
        ? c
        : { ...c, conditions: [...c.conditions, condition as Condition] }
    ));
  }

  for (const { name, condition } of actions.removeCondition ?? []) {
    mutate(name, (c) => ({
      ...c,
      conditions: c.conditions.filter((x) => x.toLowerCase() !== condition.toLowerCase()),
    }));
  }

  for (const { name, level } of actions.exhaustion ?? []) {
    mutate(name, (c) => ({ ...c, exhaustionLevel: Math.max(0, Math.min(6, level)) as Character['exhaustionLevel'] }));
  }

  for (const { name, value } of actions.inspiration ?? []) {
    mutate(name, (c) => ({ ...c, inspiration: value }));
  }

  return next;
}
