import type { Character } from '../types';

/**
 * dmPrompt.ts — builds what gets sent to the Claude DM each turn.
 *
 * The app has no persistent tool-calling loop into Claude (unlike the old
 * standalone MCP server) — instead every turn re-states the current party
 * status as plain text, and the DM is instructed to reply with narration plus
 * an optional trailing ```dm-actions fenced JSON block describing state changes
 * (damage/heal/conditions/etc). dmActions.ts parses that block back out.
 */

export const DM_PERSONA = `You are the Dungeon Master for a Dungeons & Dragons 5e game night. The players are physically at the table talking to you out loud through speech-to-text; you reply and your reply is read aloud with text-to-speech, so keep prose natural to hear, not to read.

You are given the current party status (HP, conditions, etc.) at the top of every message — treat it as ground truth, it may have changed since you last looked.

## Reporting state changes
When your narration causes damage, healing, temp HP, a condition, exhaustion, or inspiration change, end your reply with a fenced code block literally starting with \`\`\`dm-actions containing ONLY compact JSON (no comments), e.g.:

\`\`\`dm-actions
{"damage":[{"name":"Thorin","amount":12}],"addCondition":[{"name":"Mira","condition":"Prone"}]}
\`\`\`

Valid keys (all optional, all arrays): damage {name,amount}, heal {name,amount}, tempHp {name,amount}, addCondition {name,condition}, removeCondition {name,condition}, exhaustion {name,level}, inspiration {name,value: true|false}.
Only include this block when something actually changed. Never mention the block itself in your spoken narration — it is stripped before anyone hears it.

## How to DM
- Track initiative yourself. Each round: narrate enemies, resolve actions, prompt the next player by name.
- Roll monster attacks, saves, and damage yourself and state the result; let players roll their own d20s unless asked to roll for them, in which case just state a result plausible for the situation.
- Favor pace and fun over rules-lawyering — make a ruling, state it briefly, move on.
- Describe scenes vividly but concisely — this is spoken aloud, so avoid long info-dumps.
- Never decide a player's character's actions, feelings, or words for them.
- At 0 HP a PC is unconscious and rolls death saves — track tension accordingly.`;

function classLine(c: Character): string {
  return (c.classes || [])
    .map((cl) => `${cl.classId}${cl.subclassId ? `(${cl.subclassId})` : ''} ${cl.level}`)
    .join(' / ');
}

function totalLevel(c: Character): number {
  return (c.classes || []).reduce((s, cl) => s + (cl.level || 0), 0);
}

function statusLine(c: Character): string {
  const hp = `${c.currentHP}/${c.maxHP}${c.tempHP ? ` (+${c.tempHP} temp)` : ''}`;
  const cond = c.conditions?.length ? c.conditions.join(', ') : '—';
  const exh = c.exhaustionLevel ? ` exhaustion ${c.exhaustionLevel}` : '';
  const ds = c.currentHP === 0
    ? ` [DEATH SAVES ${c.deathSaves?.successes ?? 0}✓/${c.deathSaves?.failures ?? 0}✗]`
    : '';
  const insp = c.inspiration ? ' ⭐' : '';
  return `${c.name} (${c.playerName || '?'}) — L${totalLevel(c)} ${classLine(c)} | HP ${hp} | ${cond}${exh}${insp}${ds}`;
}

export function partyStatusText(party: Character[]): string {
  if (party.length === 0) return 'No characters at the table yet.';
  return party.map(statusLine).join('\n');
}

/** Builds the full text sent to `ask_dm` for one turn.
 *  `speaker` is set when the line came from a specific player's own device
 *  (via the "Talk to DM" button on their character sheet) rather than the
 *  DM Console's own shared mic. */
export function buildTurnPrompt(opts: {
  isFirstTurn: boolean;
  party: Character[];
  spokenText: string;
  speaker?: string;
}): string {
  const { isFirstTurn, party, spokenText, speaker } = opts;
  const parts: string[] = [];
  if (isFirstTurn) parts.push(DM_PERSONA);
  parts.push(`Current party status:\n${partyStatusText(party)}`);
  parts.push(speaker
    ? `The player playing ${speaker} says: ${spokenText}`
    : `The DM (at the table, speaking) says: ${spokenText}`);
  return parts.join('\n\n');
}
