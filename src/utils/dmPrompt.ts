import type { Character } from '../types';
import type { HexPosition } from './dmActions';

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

/** Renders the current battle map (axial hex coordinates per combatant) as
 *  ground truth fed back to Claude every turn — small enough that, unlike the
 *  campaign plan, there's no reason to withhold it. Empty when no encounter
 *  is active (positions cleared, or none ever set). See dmActions.ts's
 *  `HexPosition`/`position`/`clearPositions` and BASE_CLAUDE_MD's positioning
 *  section for the full convention (never read coordinates aloud). */
export function battleMapStatusText(positions: Record<string, HexPosition>): string {
  const entries = Object.entries(positions);
  if (entries.length === 0) return '';
  return entries.map(([name, { q, r }]) => `${name}: (${q},${r})`).join(', ');
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
 *  change, and every few turns otherwise) instead of every turn.
 *  `battleMap`, when non-empty, is the current hex positions — sent every
 *  turn (unlike planCheckIn) since it's tiny and needs to stay exact.
 *  `interruption` is set on the first turn after a player barged in mid-
 *  narration: the previous reply was cut off, and `heard` is exactly how much
 *  of it actually finished playing aloud before the cutoff (empty string =
 *  none of it was ever spoken). Without this, Claude's own session history
 *  contains everything it generated while the players only heard part of it
 *  — so the next reply could casually reference things nobody at the table
 *  ever heard. This note re-anchors Claude's model of the conversation to
 *  what the table actually experienced. */
export function buildTurnPrompt(opts: {
  party: Character[];
  spokenText: string;
  speaker?: string;
  planCheckIn?: string;
  battleMap?: Record<string, HexPosition>;
  interruption?: { heard: string };
}): string {
  const { party, spokenText, speaker, planCheckIn, battleMap, interruption } = opts;
  const parts: string[] = [];
  if (interruption) {
    parts.push(interruption.heard
      ? `(Heads-up: your previous reply was cut off by the player mid-speech. Out loud, the players only heard this much of it: "${interruption.heard}" — anything you said after that was never heard. Don't assume they know it; if something important was lost, work it back in naturally.)`
      : `(Heads-up: your previous reply was cut off by the player before any of it was spoken aloud — the players heard none of it. Treat it as unsaid; don't reference anything from it.)`);
  }
  if (planCheckIn) {
    parts.push(`Campaign-arc plan check-in (periodic reminder, not every turn — use it to keep pacing, NPCs, and foreshadowing consistent with the whole story, then continue):\n${planCheckIn}`);
  }
  parts.push(`Current party status:\n${partyStatusText(party)}`);
  const battleMapText = battleMap ? battleMapStatusText(battleMap) : '';
  if (battleMapText) {
    parts.push(`Current hex positions (axial q,r — internal bookkeeping only, never read aloud): ${battleMapText}`);
  }
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
