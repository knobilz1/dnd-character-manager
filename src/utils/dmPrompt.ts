import type { BookId, Character } from '../types';
import type { BattleLog, BattleMode } from './dmActions';
import { BATTLE_MODE_LABELS } from './dmActions';
import { BOOKS } from '../data/books';
import { hasKnownHp } from './partyHp';
import { activeCompanions, computeCompanionDerived } from './companion';
import { computeCharacterDerived } from '../hooks/useCharacterDerived';
import type { AbilityKey } from '../types';

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

/** How an absent player's character is being handled tonight.
 *  - `dm`        — the DM bot plays them.
 *  - `autopilot` — they tag along behind `anchor`, defending themselves but
 *                  never initiating. Cheaper than `dm` on purpose: a character
 *                  making no tactical choices needs no sheet digest.
 *  - `proxy`     — `proxyBy`'s player runs them as a second sheet. */
export type AbsenceMode = 'dm' | 'autopilot' | 'proxy';

export interface Absence {
  mode: AbsenceMode;
  /** autopilot: the present character they follow. */
  anchor?: string;
  /** proxy: the present character whose player is running them. */
  proxyBy?: string;
}

/** Absences keyed by `partyKey(name)`. */
export type AbsenceMap = Record<string, Absence>;

/** The one way a character name becomes a lookup key, anywhere absence is
 *  involved. `usePartyStore.upsert` and party.md's upsert both key on the
 *  lowercased trimmed name, and a marker that silently fails to attach because
 *  one site trimmed and another didn't is invisible at the table — the DM just
 *  never hears that someone is out. */
export function partyKey(name: string): string {
  return name.trim().toLowerCase();
}

function absenceSuffix(a: Absence | undefined): string {
  if (!a) return '';
  switch (a.mode) {
    case 'dm':
      return ' — ABSENT tonight; you are running this character';
    case 'autopilot':
      return ` — ABSENT tonight; tagging along ${a.anchor ? `behind ${a.anchor}` : 'with the party'}, defending itself but initiating nothing`;
    case 'proxy':
      return ` — ABSENT tonight; being run at the table by ${a.proxyBy ? `${a.proxyBy}'s player` : 'another player'}`;
  }
}

function classLine(c: Character): string {
  return (c.classes || [])
    .map((cl) => `${cl.classId}${cl.subclassId ? `(${cl.subclassId})` : ''} ${cl.level}`)
    .join(' / ');
}

function totalLevel(c: Character): number {
  return (c.classes || []).reduce((s, cl) => s + (cl.level || 0), 0);
}

const SAVE_ORDER: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const sign = (n: number) => (n >= 0 ? `+${n}` : String(n));

/** The numbers a DM needs to resolve something AGAINST this character without stopping to
 *  ask: what an attack has to beat, what they roll on a save, what they notice without
 *  looking, and the DC their own spells impose on everyone else. Skills, attacks and
 *  prepared spells are deliberately NOT here — those are the player's own side of the
 *  table, and they'd cost this line ten times the tokens.
 *
 *  The full sheet digest (buildSheetDigest, now sent for the whole party at roll call)
 *  already carries these and much more. This repeats the four that decide EVERY roll,
 *  every turn, for the same reason the battle log is re-sent every turn: the digest is a
 *  one-shot and the model's context compacts. Losing an AC mid-fight is not theoretical
 *  — it is what this line was added after watching: three turns in a row of "Dagna — AC,
 *  what is it?" with the fight frozen. ~30 tokens per character to never repeat that.
 *
 *  Returns '' when the sheet won't compute: computeCharacterDerived assumes a COMPLETE
 *  Character and throws on one that arrived over LAN half-populated (see sheetDigest.ts,
 *  where the same throw once took down the whole roll call). Saying nothing is right —
 *  the HP branch above already tells the DM that sheet is incomplete and not to guess. */
function combatNumbers(c: Character): string {
  let d: ReturnType<typeof computeCharacterDerived>;
  try {
    d = computeCharacterDerived(c);
  } catch {
    return '';
  }
  const saves = SAVE_ORDER.map((k) => `${k.toUpperCase()}${sign(d.savingThrows[k] ?? 0)}`).join(' ');
  // A pure fighter has spellSaveDC 0 — that's "no spellcasting", not a DC of zero.
  const dc = d.spellSaveDC ? ` | spell DC ${d.spellSaveDC}` : '';
  return ` | AC ${d.ac} | saves ${saves} | passive Perception ${d.passivePerception}${dc}`;
}

function statusLine(c: Character, absent?: AbsenceMap): string {
  // A party member whose sheet arrived without HP (see partyHp.ts) would
  // otherwise be described to the DM, every single turn, as `HP NaN/undefined`.
  // Say plainly that it's unknown instead — the one thing that must NOT happen
  // is inventing a number, least of all 0, which reads as "dying" and gets them
  // narrated into death saves.
  const hp = hasKnownHp(c)
    ? `${c.currentHP}/${c.maxHP}${c.tempHP ? ` (+${c.tempHP} temp)` : ''}`
    : 'UNKNOWN (their sheet reached the table incomplete — do not guess it, and do not narrate them as hurt or dying; ask them to re-send it)';
  const cond = c.conditions?.length ? c.conditions.join(', ') : '—';
  const exh = c.exhaustionLevel ? ` exhaustion ${c.exhaustionLevel}` : '';
  const ds = c.currentHP === 0
    ? ` [DEATH SAVES ${c.deathSaves?.successes ?? 0}✓/${c.deathSaves?.failures ?? 0}✗]`
    : '';
  const insp = c.inspiration ? ' ⭐' : '';
  const away = absenceSuffix(absent?.[partyKey(c.name)]);
  return `${c.name} (${c.playerName || '?'}) — L${totalLevel(c)} ${classLine(c)} | HP ${hp}${combatNumbers(c)} | ${cond}${exh}${insp}${ds}${away}`;
}

/** A companion that is OUT is a real creature standing on the battlefield, so the DM has to place
 *  it and track it like any other combatant — it can't do that if it never hears the beast exists.
 *  One indented line under its owner, and only while it's out: nothing at all for the tables that
 *  have no companions, which is most of them.
 *
 *  Sent as pure data. What the DM should DO with it (an ally combatant, a body in the party's start
 *  zone, whose HP its own player tracks) is a standing rule in DM_RULES, paid for once in the cached
 *  block rather than restated every single turn. */
function companionLines(c: Character): string[] {
  return activeCompanions(c).map((k) => {
    const d = computeCompanionDerived(c, k);
    // A stat block that no longer resolves still gets a line: the beast is on the table either way,
    // and silence would read as "no companion out".
    if (!d) return `  ↳ ${k.name} — ${c.name}'s companion, out (stat block unavailable)`;
    const speed = Object.entries(d.speed).map(([k2, v]) => `${k2} ${v}`).join(', ');
    const attacks = d.attacks
      .map((a) => `${a.name} ${a.toHit >= 0 ? '+' : ''}${a.toHit} to hit, ${a.damage} ${a.damageType}`)
      .join('; ');
    const multi = d.attacksPerAction > 1 ? ` (${d.attacksPerAction} attacks per Attack action)` : '';
    return `  ↳ ${k.name} — ${c.name}'s companion, OUT: ${d.beastName}, ${d.size} beast, AC ${d.ac}, HP ${k.currentHP}/${d.maxHP}, speed ${speed} | ${attacks}${multi}`;
  });
}

/** `absent` marks who isn't at the table tonight and how their character is
 *  being covered (see the roll call in DMConsolePage). Threaded here rather
 *  than pushed as its own prompt section because every character already gets
 *  a line — a suffix costs ~10 tokens and no new structure. Omitted entirely
 *  when everyone showed up. */
export function partyStatusText(party: Character[], absent?: AbsenceMap): string {
  if (party.length === 0) return 'No characters at the table yet.';
  return party.flatMap((c) => [statusLine(c, absent), ...companionLines(c)]).join('\n');
}

/** Which sourcebooks this table actually plays with — the union of every
 *  present character's own enabled-books list (the creator's StepBooks).
 *
 *  Sent so the DM improvises from shelves the table can open. A monster or
 *  magic item pulled from a book nobody owns sounds every bit as authoritative
 *  as one they can look up, which is exactly what makes it a problem. Derived
 *  rather than asked for at campaign creation, so it can't drift as players
 *  join, leave, or rebuild a sheet — and so there's nothing to migrate for
 *  campaigns that already exist.
 *
 *  Returns '' when nobody carries a list (sheets predating `enabledBooks`):
 *  saying nothing is better than telling the DM the table owns no books. Note
 *  this constrains what the DM INVENTS, never the adventure — a published
 *  module routinely uses monsters from books the table never bought, and its
 *  own content stands regardless. */
export function tableBooksText(party: Character[]): string {
  const ids = new Set<BookId>();
  for (const c of party) for (const b of c.enabledBooks ?? []) ids.add(b);
  if (ids.size === 0) return '';
  // Catalog order, so the list reads the same way twice; an id with no catalog
  // entry is still named rather than silently dropped.
  const known = BOOKS.filter((b) => ids.has(b.id));
  const names = known.map((b) => b.shortName);
  for (const id of ids) {
    if (!known.some((b) => b.id === id)) names.push(id);
  }
  return names.join(', ');
}

/** Renders the Active Battle Log as ground truth fed back to the DM every turn
 *  (see dmActions.ts's `BattleLog`/`applyBattleLog` and campaign.rs's DM_RULES
 *  "Running combat & positioning"). The whole point is anti-drift: this is
 *  tracked outside the model's own memory, so a long fight can't lose state
 *  when context compacts. Returns '' when no fight is active (no combatants),
 *  so buildTurnPrompt omits the section entirely. Coordinates are internal —
 *  the DM translates them to a count-from-anchor, never reads them aloud. */
export function battleLogStatusText(log: BattleLog): string {
  if (!log.combatants || log.combatants.length === 0) return '';
  const header: string[] = [];
  if (log.round !== undefined) header.push(`Round ${log.round}`);
  if (log.active) header.push(`active: ${log.active}`);
  if (log.initiative?.length) header.push(`initiative: ${log.initiative.join(' → ')}`);
  const lines = log.combatants.map((c) => {
    const bits: string[] = [];
    if (c.side) bits.push(c.side);
    if (c.hp) bits.push(`HP ${c.hp}`);
    if (c.conditions?.length) bits.push(c.conditions.join(', '));
    if (c.position) bits.push(c.position);
    if (c.coord) bits.push(`(${c.coord.q},${c.coord.r})`);
    if (c.notes) bits.push(c.notes);
    return `- ${c.name}${bits.length ? ` — ${bits.join(' | ')}` : ''}`;
  });
  const parts: string[] = [];
  if (header.length) parts.push(header.join(' · '));
  parts.push(lines.join('\n'));
  if (log.environment) parts.push(`Environment: ${log.environment}`);
  if (log.notes) parts.push(`Notes: ${log.notes}`);
  return parts.join('\n');
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
 *  `battleMode` is the campaign's positioning style (see dmActions.ts's
 *  BattleMode / campaign.rs's battle_mode) — sent every turn as a one-liner so
 *  the DM narrates placement the way this table plays, and knows the mode the
 *  moment a fight starts. `battleLog`, when it has combatants, is the current
 *  Active Battle Log — sent every turn (unlike planCheckIn) as ground truth so
 *  a fight's state can't drift or be lost when context compacts.
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
 *  what the table actually experienced.
 *  `absent` is tonight's roll call — who didn't show and how their character
 *  is being covered. It rides as a suffix on each party status line rather
 *  than as its own section, so it costs ~10 tokens per absent character and
 *  nothing at all when everyone turned up.
 *  `partySheets` is a ONE-SHOT, same as recalledSession/Map/Chapter above: the
 *  full digest of EVERY character at the table, sent on the first turn after
 *  roll call and then dropped. It stays available for the rest of the sitting
 *  because it's in the CLI's own resumed transcript — the same reason deferring
 *  memory writes was safe (see campaign.rs's pending queue). Sending it every
 *  turn instead would cost ~400 tokens × every turn to re-state numbers that
 *  never change.
 *
 *  It used to cover only the characters the DM itself was running. That left the
 *  DM resolving attacks against present players with no AC, no saves and no
 *  spell DCs — so it stopped mid-fight to ask, or invented them. The table's
 *  secrecy runs the other way: players don't see the DM's side. */
export function buildTurnPrompt(opts: {
  party: Character[];
  spokenText: string;
  battleMode: BattleMode;
  speaker?: string;
  planCheckIn?: string;
  recalledSession?: { id: string; record: string };
  recalledMap?: { slug: string; spec: string };
  recalledChapter?: { id: string; text: string };
  battleLog?: BattleLog | null;
  interruption?: { heard: string };
  absent?: AbsenceMap;
  partySheets?: string;
}): string {
  const { party, spokenText, battleMode, speaker, planCheckIn, recalledSession, recalledMap, recalledChapter, battleLog, interruption, absent, partySheets } = opts;
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
  if (recalledChapter) {
    parts.push(`Recalled chapter "${recalledChapter.id}" (you asked to pull this up last turn — its full text, for your reference only; the party has NOT moved here, so don't narrate it as a scene change):
${recalledChapter.text}`);
  }
  if (recalledMap) {
    parts.push(`Recalled battle map "${recalledMap.slug}" (you asked to pull this up last turn — its full layout and tactics, for your reference; place enemies on these cells and describe positions by them, don't read the raw grid aloud):\n${recalledMap.spec}`);
  }
  if (partySheets) {
    parts.push(`Character sheets for the whole party (reference material — sent once, at roll call, so keep it in mind for the rest of the session). These are the real numbers: use them to resolve anything you adjudicate — what an attack has to beat, what a save comes to, what DC their spells impose — instead of asking a player for a number that is right here, and instead of inventing one. For any character you're running tonight yourself, play them from these numbers rather than inventing abilities:\n${partySheets}`);
  }
  parts.push(`Current party status:\n${partyStatusText(party, absent)}`);
  const tableBooks = tableBooksText(party);
  if (tableBooks) {
    parts.push(`Books at this table: ${tableBooks}. When you improvise a monster, magic item or optional rule, prefer these — they're what the table can actually look up. The adventure's own content stands regardless of this list.`);
  }
  parts.push(`Battle mode: ${BATTLE_MODE_LABELS[battleMode]}.`);
  if (battleMode === 'grid') {
    parts.push('Map readiness check: before replying, check battle_maps/index.md. If a real fight is taking shape here, use `recallMap` when a matching map exists; otherwise request one NOW by ending your reply with exactly ```dm-actions {"makeMap":"one-line fight and location description"} ```. Do not wait for initiative.');
  }
  const battleLogText = battleLog ? battleLogStatusText(battleLog) : '';
  if (battleLogText) {
    parts.push(`Active battle log (tracked outside your memory, ground truth, given fresh every turn — keep it current via the \`battleLog\` action):\n${battleLogText}`);
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
export function buildRecapPrompt(party: Character[], absent?: AbsenceMap): string {
  return `The session is ending. In 3-4 sentences, summarize tonight's session for next week's recap — what happened, where the party ended up, and any open threads. Then check memory/entities.md and memory/locations.md above: go back through everyone and everywhere in tonight's actual session (not just ones that felt like a formal "introduction") — anyone who spoke to the party, was spoken about by name, or was visited, even mid-conversation and even if things weren't fully resolved — and if they're missing from those files, end your reply with a \`\`\`dm-actions block containing ONLY rememberEntity/rememberLocation for those (same shape as any other turn — see "Reporting state changes"). This explicitly INCLUDES an NPC who never gave a proper name but who spoke to the party, gave them real information, or clearly matters going forward (an unnamed elder, a hooded stranger, a village priest) — remember them exactly as you would a named one; unlike a live turn, where you'd skip a nameless walk-on, this end-of-session pass is the one place to capture the unnamed-but-important. When you do, give them a name specific enough to be unique — anchor it to their place or a distinctive trait ("Blind Elder of Fogreach", "Milky-Eyed Elder", "Raven-Shawled Priestess"), NOT a bare role like "Elder Woman" or "Old Man". This matters because entities.md is upserted by name: a generic role name will silently OVERWRITE a different NPC of the same role from another session (a second "Elder Woman" met months later would erase this one), and a bland key also leaves you unable to tell two of them apart when you read it back. The description should carry the same distinguishing detail, so next session you know precisely who this was. Err on the side of including a borderline case: a redundant re-add is harmless (upserted by name), but missing someone genuinely important to tonight's session — especially whoever the session ended on, mid-scene with — means next week's DM greets them as a total stranger. Omit the block entirely if nothing's missing. Never include any other dm-actions key here, and never invent an entry for anything that was only an out-of-character exchange (see "Out-of-character requests").\n\nCurrent party status:\n${partyStatusText(party, absent)}`;
}
