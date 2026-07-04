import type { Character } from '../types';

/**
 * dmPrompt.ts — builds what gets sent to the Claude DM each turn.
 *
 * The DM's persona, house rules, and campaign lore/history no longer travel
 * in this text — they live in the active campaign's own CLAUDE.md (see
 * campaign.rs), which `claude` auto-loads because dm.rs runs it with that
 * campaign's folder as its working directory, exactly like any other Claude
 * Code project. This file only sends what changes turn to turn: the party's
 * live status and what was just said. The DM is still expected (per that
 * CLAUDE.md) to reply with narration plus an optional trailing ```dm-actions
 * fenced JSON block describing state changes — dmActions.ts parses that back out.
 */

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

/** Builds the text sent to `ask_dm` for one turn.
 *  `speaker` is set when the line came from a specific player's own device
 *  (via the "Talk to DM" button on their character sheet) rather than the
 *  DM Console's own shared mic.
 *  `planCheckIn`, when set, is the module's campaign-arc plan text (see
 *  campaign.rs's read_campaign_plan) — deliberately NOT a standing CLAUDE.md
 *  import, since that gets reprocessed on every single turn even mid-session
 *  (confirmed live: editing CLAUDE.md and resuming picks up the edit next
 *  turn). The plan is high-level pacing/NPC/foreshadowing guidance, not
 *  something that needs re-reading every line, so DMConsolePage only passes
 *  it here periodically (first turn of a sitting, right after a chapter
 *  change, and every few turns otherwise) instead of every turn. */
export function buildTurnPrompt(opts: {
  party: Character[];
  spokenText: string;
  speaker?: string;
  planCheckIn?: string;
}): string {
  const { party, spokenText, speaker, planCheckIn } = opts;
  const parts: string[] = [];
  if (planCheckIn) {
    parts.push(`Campaign-arc plan check-in (periodic reminder, not every turn — use it to keep pacing, NPCs, and foreshadowing consistent with the whole story, then continue):\n${planCheckIn}`);
  }
  parts.push(`Current party status:\n${partyStatusText(party)}`);
  parts.push(speaker
    ? `The player playing ${speaker} says: ${spokenText}`
    : `The DM (at the table, speaking) says: ${spokenText}`);
  return parts.join('\n\n');
}

/** Prompt sent when a session ends, asking for a short recap to persist into
 *  the campaign's memory/MEMORY.md for next week (see campaign.rs). */
export function buildRecapPrompt(party: Character[]): string {
  return `The session is ending. In 3-4 sentences, summarize tonight's session for next week's recap — what happened, where the party ended up, and any open threads. Reply with ONLY the summary text, no dm-actions block.\n\nCurrent party status:\n${partyStatusText(party)}`;
}
