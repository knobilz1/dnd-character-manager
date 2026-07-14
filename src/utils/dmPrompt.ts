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
 *  `recalledSession`, when set, is the full verbatim record of a past session
 *  the DM asked for last turn via the `recallSession` dm-action (see
 *  campaign.rs's read_session_record) — injected once into the very next turn
 *  so the DM can answer a player accurately about that session, then dropped
 *  (it's large, and only needed for the turn that references it).
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
  recalledSession?: { id: string; record: string };
  battleMap?: Record<string, HexPosition>;
  interruption?: { heard: string };
}): string {
  const { party, spokenText, speaker, planCheckIn, recalledSession, battleMap, interruption } = opts;
  const parts: string[] = [];
  if (interruption) {
    parts.push(interruption.heard
      ? `(Heads-up: your previous reply was cut off by the player mid-speech. Out loud, the players only heard this much of it: "${interruption.heard}" — anything you said after that was never heard. Don't assume they know it; if something important was lost, work it back in naturally.)`
      : `(Heads-up: your previous reply was cut off by the player before any of it was spoken aloud — the players heard none of it. Treat it as unsaid; don't reference anything from it.)`);
  }
  if (planCheckIn) {
    parts.push(`Campaign-arc plan check-in (periodic reminder, not every turn — use it to keep pacing, NPCs, and foreshadowing consistent with the whole story, then continue):\n${planCheckIn}`);
  }
  if (recalledSession) {
    parts.push(`Recalled record of ${recalledSession.id} (you asked to pull this up last turn — the full verbatim transcript of that past session, for your reference only; use it to answer accurately, don't read it aloud):\n${recalledSession.record}`);
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
 *  the campaign's memory/MEMORY.md for next week (see campaign.rs). Also
 *  gives Claude one last explicit chance to catch up entities.md/locations.md
 *  for this session — a live turn's own judgment about when an NPC/place is
 *  "worth remembering" can reasonably hold off mid-conversation (see
 *  BASE_CLAUDE_MD's rememberEntity guidance), and if the table calls it a
 *  night before that conversation ever resolves, nothing else was catching
 *  that gap: next sitting would see no entities.md entry at all and treat
 *  someone the party is mid-conversation with as a stranger. Deliberately
 *  scoped to ONLY rememberEntity/rememberLocation here, unlike a live turn's
 *  dm-actions block — damage/conditions/chapter-advance etc. don't make
 *  sense retroactively at session end. */
export function buildRecapPrompt(party: Character[]): string {
  return `The session is ending. In 3-4 sentences, summarize tonight's session for next week's recap — what happened, where the party ended up, and any open threads. Then check memory/entities.md and memory/locations.md above: go back through everyone and everywhere in tonight's actual session (not just ones that felt like a formal "introduction") — anyone who spoke to the party, was spoken about by name, or was visited, even mid-conversation and even if things weren't fully resolved — and if they're missing from those files, end your reply with a \`\`\`dm-actions block containing ONLY rememberEntity/rememberLocation for those (same shape as any other turn — see "Reporting state changes"). This explicitly INCLUDES an NPC who never gave a proper name but who spoke to the party, gave them real information, or clearly matters going forward (an unnamed elder, a hooded stranger, a village priest) — remember them exactly as you would a named one; unlike a live turn, where you'd skip a nameless walk-on, this end-of-session pass is the one place to capture the unnamed-but-important. When you do, give them a name specific enough to be unique — anchor it to their place or a distinctive trait ("Blind Elder of Fogreach", "Milky-Eyed Elder", "Raven-Shawled Priestess"), NOT a bare role like "Elder Woman" or "Old Man". This matters because entities.md is upserted by name: a generic role name will silently OVERWRITE a different NPC of the same role from another session (a second "Elder Woman" met months later would erase this one), and a bland key also leaves you unable to tell two of them apart when you read it back. The description should carry the same distinguishing detail, so next session you know precisely who this was. Err on the side of including a borderline case: a redundant re-add is harmless (upserted by name), but missing someone genuinely important to tonight's session — especially whoever the session ended on, mid-scene with — means next week's DM greets them as a total stranger. Omit the block entirely if nothing's missing. Never include any other dm-actions key here, and never invent an entry for anything that was only an out-of-character exchange (see "Out-of-character requests").\n\nCurrent party status:\n${partyStatusText(party)}`;
}
