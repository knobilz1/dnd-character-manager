import type { Character, Condition } from '../types';
import { hasKnownHp } from './partyHp';

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

/** The three combat-positioning styles, chosen per campaign (persisted by the
 *  backend's read_battle_mode/set_battle_mode) and sent to the DM every turn.
 *  See campaign.rs's DM_RULES "Running combat & positioning" for what each
 *  means; must stay in sync with that BATTLE_MODES list. */
export type BattleMode = 'theater' | 'grid' | 'hex';
export const BATTLE_MODE_LABELS: Record<BattleMode, string> = {
  theater: 'Theater of the Mind',
  grid: 'Grid (minis, no terrain)',
  hex: 'Hex terrain (3D-printed)',
};
export const BATTLE_MODES = Object.keys(BATTLE_MODE_LABELS) as BattleMode[];
export const isBattleMode = (x: unknown): x is BattleMode =>
  typeof x === 'string' && (BATTLE_MODES as string[]).includes(x);

/** A numeric map coordinate for a combatant — axial (q,r) in hex mode, square
 *  offsets in grid mode, unused in Theater of the Mind. Internal bookkeeping
 *  only: never read aloud (see DM_RULES) — narration always translates it to a
 *  count from a named anchor. */
export interface HexPosition { q: number; r: number }

/** One combatant's live state within the Active Battle Log. Not a Character:
 *  monsters/NPCs aren't Characters, and the DM tracks all sides here. Every
 *  field but `name` is optional so the DM can send only what changed (see
 *  applyBattleLog's upsert-by-name). */
export interface BattleCombatant {
  name: string;
  /** For grouping/coloring in the sidebar; not load-bearing. */
  side?: 'party' | 'enemy' | 'ally' | 'neutral';
  /** Free-text health band — "healthy" | "bloodied" | "12/28" | "down" — the
   *  DM's call, deliberately not a strict number (it also covers monsters with
   *  no sheet). */
  hp?: string;
  conditions?: string[];
  /** Narrative placement (Theater of the Mind): "flanking Thorin in the doorway". */
  position?: string;
  /** Numeric placement (grid/hex). */
  coord?: HexPosition;
  /** Ongoing effects / readied actions — "concentrating on Bless". */
  notes?: string;
}

/** The whole running state of the current fight — held authoritatively by the
 *  app and fed back to the DM every turn as ground truth (see dmPrompt.ts's
 *  battleLogStatusText), so nothing about a fight is lost when the model's
 *  context compacts. Ephemeral: lives for the encounter, never persisted to
 *  disk (only the `battleResult` outcome is saved, on endBattle). */
export interface BattleLog {
  round?: number;
  active?: string;         // whose turn it is right now
  initiative?: string[];   // names in initiative order
  environment?: string;    // lighting, hazards, cover, terrain that matters
  notes?: string;          // free-form running scene notes
  combatants: BattleCombatant[];
}

/** The `battleLog` dm-action: a PARTIAL update (any combatant listed is
 *  upserted by name; scalar fields replace only when present) — see
 *  applyBattleLog. `combatants` is optional so a turn can update just `active`
 *  or `environment`. */
export type BattleLogUpdate = Partial<Omit<BattleLog, 'combatants'>> & { combatants?: BattleCombatant[] };

/** Every valid `voiceId` for `rememberEntity` (see tts.rs's VOICE_CATALOG,
 *  which is the source of truth this must stay in sync with) plus
 *  BASE_CLAUDE_MD's matching catalog list. An id outside this set is dropped
 *  (not the whole entry) — see sanitizeArray's per-entry tolerance — and
 *  falls back to the narrator voice at speak time regardless, so a
 *  hallucinated id degrades gracefully rather than breaking playback. */
export const VOICE_CATALOG_IDS = new Set([
  'narrator',
  'male-us-1', 'male-us-2', 'male-us-3', 'male-us-4', 'male-us-5', 'male-us-6', 'male-us-7', 'male-us-8', 'male-us-9',
  'male-gb-1', 'male-gb-2', 'male-gb-3', 'male-gb-4',
  'female-us-1', 'female-us-2', 'female-us-3', 'female-us-4', 'female-us-5', 'female-us-6', 'female-us-7', 'female-us-8', 'female-us-9', 'female-us-10',
  'female-gb-1', 'female-gb-2', 'female-gb-3', 'female-gb-4',
  // F5-exclusive archetype voices (tts.rs's ARCHETYPE_VOICES, the source of
  // truth) -- real recorded speakers curated per D&D race/monster archetype,
  // 5 male + 5 female each. Only resolve to real audio under F5; under
  // Kokoro (or F5 unavailable) each falls back to its declared nearest
  // VOICE_CATALOG id, same graceful-degradation shape as everything else
  // in this set.
  'orc-m-1', 'orc-m-2', 'orc-m-3', 'orc-m-4', 'orc-m-5', 'orc-f-1', 'orc-f-2', 'orc-f-3', 'orc-f-4', 'orc-f-5',
  'giant-m-1', 'giant-m-2', 'giant-m-3', 'giant-m-4', 'giant-m-5', 'giant-f-1', 'giant-f-2', 'giant-f-3', 'giant-f-4', 'giant-f-5',
  'dwarf-m-1', 'dwarf-m-2', 'dwarf-m-3', 'dwarf-m-4', 'dwarf-m-5', 'dwarf-f-1', 'dwarf-f-2', 'dwarf-f-3', 'dwarf-f-4', 'dwarf-f-5',
  'elf-m-1', 'elf-m-2', 'elf-m-3', 'elf-m-4', 'elf-m-5', 'elf-f-1', 'elf-f-2', 'elf-f-3', 'elf-f-4', 'elf-f-5',
  'gnome-m-1', 'gnome-m-2', 'gnome-m-3', 'gnome-m-4', 'gnome-m-5', 'gnome-f-1', 'gnome-f-2', 'gnome-f-3', 'gnome-f-4', 'gnome-f-5',
  'halfling-m-1', 'halfling-m-2', 'halfling-m-3', 'halfling-m-4', 'halfling-m-5', 'halfling-f-1', 'halfling-f-2', 'halfling-f-3', 'halfling-f-4', 'halfling-f-5',
  'sinister-m-1', 'sinister-m-2', 'sinister-m-3', 'sinister-m-4', 'sinister-m-5', 'sinister-f-1', 'sinister-f-2', 'sinister-f-3', 'sinister-f-4', 'sinister-f-5',
  'sage-m-1', 'sage-m-2', 'sage-m-3', 'sage-m-4', 'sage-m-5', 'sage-f-1', 'sage-f-2', 'sage-f-3', 'sage-f-4', 'sage-f-5',
]);

/** Old Piper-catalog accent ids a pre-Kokoro campaign's npc_voices.json (or an
 *  LLM turn re-asserting an existing NPC's voiceId) may still carry, mapped to
 *  a same-gender replacement in the current catalog — mirrors tts.rs's
 *  LEGACY_VOICE_ALIASES exactly (that is the source of truth; keep in sync).
 *  Without this, VOICE_CATALOG_IDS.has() rejects the legacy id as "unknown"
 *  before it ever reaches the Rust side, which has its own equivalent
 *  fallback for synthesis but never gets the chance to apply it. */
const LEGACY_VOICE_ALIASES: Record<string, string> = {
  'male-scottish-1': 'male-gb-2',
  'male-scottish-2': 'male-gb-3',
  'female-scottish-1': 'female-gb-2',
  'male-irish-1': 'male-gb-1',
  'male-irish-2': 'male-gb-4',
  'female-irish-1': 'female-gb-3',
  'female-welsh-1': 'female-gb-4',
  'male-northernirish-1': 'male-us-6',
  'female-northernirish-1': 'female-gb-1',
  'male-australian-1': 'male-us-7',
  'male-southafrican-1': 'male-us-8',
  'female-southafrican-1': 'female-us-5',
};

/** Every valid `pitch` tag for `rememberEntity` (see tts.rs's pitch_factor,
 *  the source of truth) — a size/build-based pitch shift layered on top of
 *  `voiceId`, not a replacement for it. `small`/`large` track actual D&D size
 *  category (Small/Tiny vs. Large-or-bigger); `gruff` is a milder version of
 *  `large`'s direction for Medium-size-but-naturally-rougher-voiced races
 *  (half-orcs, goliaths, firbolgs, bugbears) that aren't mechanically Large.
 *  Ordinary Medium NPCs should just omit the field entirely rather than
 *  sending a tag for it. */
export const PITCH_TAG_IDS = new Set(['small', 'gruff', 'large']);

interface NamedEntityFact { name: string; description: string; voiceId?: string; pitch?: string }

export interface DmActionSet {
  damage?: NameAmount[];
  heal?: NameAmount[];
  tempHp?: NameAmount[];
  addCondition?: NameCondition[];
  removeCondition?: NameCondition[];
  exhaustion?: NameLevel[];
  inspiration?: NameBool[];
  /** Short standalone facts worth recalling much later that aren't about one
   *  specific named entity/location — appended immediately to memory/MEMORY.md
   *  (see campaign.rs's append_memory_note), which loads every turn regardless
   *  of which module chapter is currently active. Prefer rememberEntity/
   *  rememberLocation below for facts that ARE about a specific named thing. */
  remember?: string[];
  /** Facts from flagged_facts.md whose story has fully concluded (promise
   *  fulfilled, secret revealed) — each is matched against that file's bullet
   *  lines and moved to resolved_facts.md (see campaign.rs's
   *  resolve_flagged_fact), archived rather than deleted, so the always-
   *  loaded file stays relevant over a long campaign without reintroducing
   *  lossy compaction. Conservative by design: an ambiguous or missing match
   *  is a tolerated no-op, never a guess. */
  resolveFact?: string[];
  /** Named NPCs/factions/creatures worth recalling long-term — upserted by
   *  name into memory/entities.md (see campaign.rs's append_entity_fact), so
   *  a name introduced session 1 is still recognized session 100 without
   *  ever being summarized away like the recap log. `voiceId` (optional,
   *  entity-only — see BASE_CLAUDE_MD's "Giving NPCs distinct voices") is
   *  persisted separately via campaign.rs's set_npc_voice the first time an
   *  NPC worth voicing is introduced. */
  rememberEntity?: NamedEntityFact[];
  /** Same idea as rememberEntity, for named places (memory/locations.md, see
   *  campaign.rs's append_location_fact). */
  rememberLocation?: { name: string; description: string }[];
  /** A chapter id from module/index.md — the DM's own signal that the party's
   *  actions concluded the current chapter, handled by DMConsolePage calling
   *  set_current_chapter. Absent unless this campaign has an imported module. */
  advanceToChapter?: string;
  /** A short description of a clearly-concluded, bounded portion of the
   *  *current* chapter — trims that resolved content out of the active
   *  module's current.md (see campaign.rs's resolve_chapter_section) so it
   *  stops taking up space once it's no longer relevant. This makes a real
   *  LLM call, so it's fired without awaiting it (see DMConsolePage's
   *  runTurn) — it's background housekeeping, not something worth delaying
   *  the turn's own reply for. */
  resolveChapterSection?: string;
  /** A module id from modules_index.md — the DM's own signal that the
   *  party's actions moved them from one self-contained module/side-quest to
   *  a different already-imported one, handled by DMConsolePage calling
   *  set_active_module. Absent unless this campaign has more than one
   *  imported module. */
  switchActiveModule?: string;
  /** A `session-NN` id from memory/session_index.md — the DM's request to pull
   *  the full verbatim record of a past session into its NEXT turn, when the
   *  one-line index entry isn't enough detail to answer a player accurately
   *  (see campaign.rs's read_session_record + DMConsolePage's runTurn, which
   *  fetches it and stashes it for the next buildTurnPrompt). A pure read —
   *  never changes campaign state. Absent on the vast majority of turns. */
  recallSession?: string;
  /** A battle-map slug from memory/battle_maps/index.md — the DM's request to
   *  pull that map's full ASCII layout + tactics into its NEXT turn, so it can
   *  place enemies on the real cells before running a fight there (see
   *  campaign.rs's read_battle_map + DMConsolePage's runTurn, which fetches it
   *  and stashes it for the next buildTurnPrompt). A pure read, like
   *  recallSession — never changes campaign state. */
  recallMap?: string;
  /** A partial update to the Active Battle Log — any combatant listed is
   *  upserted by name, scalar fields (round/active/initiative/environment/
   *  notes) replace only when present. Merged into DMConsolePage's battleLog
   *  state via applyBattleLog and fed back every turn as ground truth (see
   *  dmPrompt.ts's battleLogStatusText). Replaces the old hex-only `position`. */
  battleLog?: BattleLogUpdate;
  /** Names of combatants who've left the fight for good (dead and gone, fled
   *  off-scene) — dropped from the battle log. A downed-but-present PC stays
   *  in the log with hp:"down" rather than being removed. */
  removeCombatant?: string[];
  /** The DM's signal that the fight is over — wipes the live battle log so
   *  stale state from one encounter can't bleed into the next. Replaces the
   *  old `clearPositions`. */
  endBattle?: boolean;
  /** A one-or-two-sentence outcome saved to campaign memory when `endBattle`
   *  fires (see DMConsolePage's runTurn → append_memory_note) — the ONLY part
   *  of a fight that's persisted; the blow-by-blow log is discarded. */
  battleResult?: string;
}

const ACTIONS_BLOCK = /```dm-actions\s*([\s\S]*?)```/i;

// ── Field-level validation ──────────────────────────────────────────────────
// JSON.parse only guarantees *some* value came out the other side — a weaker
// local model (see local_llm.rs) can emit a syntactically valid dm-actions
// block whose individual fields are the wrong primitive type (e.g. amount as
// the string "12" instead of the number 12). Left unchecked that flows
// straight into arithmetic in applyDmActions (`c.currentHP - dmg` → NaN) or
// into a Tauri command argument, silently corrupting a character's HP or a
// memory file with no visible sign anything was wrong. Every array/scalar
// field is validated here before anything downstream ever sees it; malformed
// entries are dropped (not the whole action set) and reported as a warning.

type PlainObject = Record<string, unknown>;
const isPlainObject = (x: unknown): x is PlainObject => x !== null && typeof x === 'object' && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isFiniteNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';

/** Validates and filters an array field down to well-typed entries, warning
 *  about (and dropping) anything else. Missing entirely is fine (returns
 *  `[]`); present but not an array at all warns once for the whole field. */
function sanitizeArray<T>(raw: unknown, fieldName: string, isValid: (x: unknown) => x is T, warnings: string[]): T[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push(`Ignored dm-actions "${fieldName}": expected an array.`);
    return [];
  }
  const out: T[] = [];
  for (const entry of raw) {
    if (isValid(entry)) out.push(entry);
    else warnings.push(`Dropped a malformed dm-actions "${fieldName}" entry: ${JSON.stringify(entry)}`);
  }
  return out;
}

const isNameAmount = (x: unknown): x is NameAmount => isPlainObject(x) && isStr(x.name) && isFiniteNum(x.amount);
const isNameCondition = (x: unknown): x is NameCondition => isPlainObject(x) && isStr(x.name) && isStr(x.condition);
const isNameLevel = (x: unknown): x is NameLevel => isPlainObject(x) && isStr(x.name) && isFiniteNum(x.level);
const isNameBool = (x: unknown): x is NameBool => isPlainObject(x) && isStr(x.name) && isBool(x.value);
const isNamedFact = (x: unknown): x is { name: string; description: string } =>
  isPlainObject(x) && isStr(x.name) && isStr(x.description);
/** Like isNamedFact, but for rememberEntity specifically: only checks that
 *  voiceId/pitch, if present, are strings — catalog/tag-set membership is
 *  checked separately in sanitizeDmActionSet so an out-of-catalog value can
 *  be stripped from just that one field (with a warning) rather than
 *  rejecting the whole entry, which would otherwise lose a perfectly good
 *  name/description over one bad voice/pitch pick. */
const isNamedEntityFact = (x: unknown): x is NamedEntityFact =>
  isPlainObject(x) && isStr(x.name) && isStr(x.description) &&
  (x.voiceId === undefined || isStr(x.voiceId)) && (x.pitch === undefined || isStr(x.pitch));
const isStrArray = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const isHexPosition = (x: unknown): x is HexPosition =>
  isPlainObject(x) && isFiniteNum(x.q) && isFiniteNum(x.r);
const BATTLE_SIDES = new Set(['party', 'enemy', 'ally', 'neutral']);
/** Requires a name; any present optional must be the correct type, else the
 *  whole combatant is dropped (with a warning) — same per-entry tolerance as
 *  sanitizeArray. Value-level cleaning (an out-of-set `side`) happens in
 *  cleanCombatant. */
const isBattleCombatant = (x: unknown): x is BattleCombatant =>
  isPlainObject(x) && isStr(x.name) &&
  (x.side === undefined || isStr(x.side)) &&
  (x.hp === undefined || isStr(x.hp)) &&
  (x.conditions === undefined || isStrArray(x.conditions)) &&
  (x.position === undefined || isStr(x.position)) &&
  (x.coord === undefined || isHexPosition(x.coord)) &&
  (x.notes === undefined || isStr(x.notes));

/** Copies only known fields, dropping an out-of-set `side` (with a warning)
 *  rather than the whole combatant — same shape as rememberEntity's voiceId
 *  cleaning. */
function cleanCombatant(c: BattleCombatant, warnings: string[]): BattleCombatant {
  const out: BattleCombatant = { name: c.name };
  if (c.side !== undefined) {
    if (BATTLE_SIDES.has(c.side)) out.side = c.side;
    else warnings.push(`Ignored unknown combatant side "${c.side}" for "${c.name}".`);
  }
  if (c.hp !== undefined) out.hp = c.hp;
  if (c.conditions !== undefined) out.conditions = c.conditions;
  if (c.position !== undefined) out.position = c.position;
  if (c.coord !== undefined) out.coord = { q: c.coord.q, r: c.coord.r };
  if (c.notes !== undefined) out.notes = c.notes;
  return out;
}

/** Validates a `battleLog` partial update field-by-field. Scalars are dropped
 *  if wrong-typed; combatants are filtered per-entry (a malformed one is
 *  dropped, not the whole update). Returns undefined only when the value isn't
 *  an object at all. */
function sanitizeBattleLogUpdate(raw: unknown, warnings: string[]): BattleLogUpdate | undefined {
  if (!isPlainObject(raw)) {
    warnings.push('Ignored dm-actions "battleLog": expected an object.');
    return undefined;
  }
  const update: BattleLogUpdate = {};
  const round = sanitizeScalar(raw.round, 'battleLog.round', isFiniteNum, warnings);
  if (round !== undefined) update.round = round;
  const active = sanitizeScalar(raw.active, 'battleLog.active', isStr, warnings);
  if (active !== undefined) update.active = active;
  const environment = sanitizeScalar(raw.environment, 'battleLog.environment', isStr, warnings);
  if (environment !== undefined) update.environment = environment;
  const notes = sanitizeScalar(raw.notes, 'battleLog.notes', isStr, warnings);
  if (notes !== undefined) update.notes = notes;
  // Only treat initiative/combatants as "sent" when they're actually arrays, so
  // a wrong-typed value warns-and-ignores rather than clobbering existing state
  // with an empty list.
  if (raw.initiative !== undefined) {
    update.initiative = sanitizeArray(raw.initiative, 'battleLog.initiative', isStr, warnings);
  }
  if (raw.combatants !== undefined) {
    update.combatants = sanitizeArray(raw.combatants, 'battleLog.combatants', isBattleCombatant, warnings)
      .map((c) => cleanCombatant(c, warnings));
  }
  return update;
}

/** Validates a scalar (non-array) field's type, warning and dropping it if
 *  wrong rather than passing a wrongly-typed value through. */
function sanitizeScalar<T>(raw: unknown, fieldName: string, isValid: (x: unknown) => x is T, warnings: string[]): T | undefined {
  if (raw === undefined) return undefined;
  if (isValid(raw)) return raw;
  warnings.push(`Ignored dm-actions "${fieldName}": wrong type.`);
  return undefined;
}

/** Field-by-field validation of an already-parsed dm-actions object. Returns
 *  a sanitized DmActionSet containing only well-typed entries, plus warnings
 *  for anything dropped. */
function sanitizeDmActionSet(raw: PlainObject): { actions: DmActionSet; warnings: string[] } {
  const warnings: string[] = [];
  const actions: DmActionSet = {};

  const damage = sanitizeArray(raw.damage, 'damage', isNameAmount, warnings);
  if (damage.length) actions.damage = damage;
  const heal = sanitizeArray(raw.heal, 'heal', isNameAmount, warnings);
  if (heal.length) actions.heal = heal;
  const tempHp = sanitizeArray(raw.tempHp, 'tempHp', isNameAmount, warnings);
  if (tempHp.length) actions.tempHp = tempHp;
  const addCondition = sanitizeArray(raw.addCondition, 'addCondition', isNameCondition, warnings);
  if (addCondition.length) actions.addCondition = addCondition;
  const removeCondition = sanitizeArray(raw.removeCondition, 'removeCondition', isNameCondition, warnings);
  if (removeCondition.length) actions.removeCondition = removeCondition;
  const exhaustion = sanitizeArray(raw.exhaustion, 'exhaustion', isNameLevel, warnings);
  if (exhaustion.length) actions.exhaustion = exhaustion;
  const inspiration = sanitizeArray(raw.inspiration, 'inspiration', isNameBool, warnings);
  if (inspiration.length) actions.inspiration = inspiration;
  const rememberEntity = sanitizeArray(raw.rememberEntity, 'rememberEntity', isNamedEntityFact, warnings).map((entry) => {
    const cleaned: NamedEntityFact = { name: entry.name, description: entry.description };
    if (entry.voiceId !== undefined) {
      const resolvedVoiceId = LEGACY_VOICE_ALIASES[entry.voiceId] ?? entry.voiceId;
      if (VOICE_CATALOG_IDS.has(resolvedVoiceId)) cleaned.voiceId = resolvedVoiceId;
      else warnings.push(`Ignored unknown voiceId "${entry.voiceId}" for "${entry.name}" — falling back to the narrator voice.`);
    }
    if (entry.pitch !== undefined) {
      if (PITCH_TAG_IDS.has(entry.pitch)) cleaned.pitch = entry.pitch;
      else warnings.push(`Ignored unknown pitch "${entry.pitch}" for "${entry.name}" — using normal pitch.`);
    }
    return cleaned;
  });
  if (rememberEntity.length) actions.rememberEntity = rememberEntity;
  const rememberLocation = sanitizeArray(raw.rememberLocation, 'rememberLocation', isNamedFact, warnings);
  if (rememberLocation.length) actions.rememberLocation = rememberLocation;
  if (raw.battleLog !== undefined) {
    const battleLog = sanitizeBattleLogUpdate(raw.battleLog, warnings);
    if (battleLog) actions.battleLog = battleLog;
  }
  const removeCombatant = sanitizeArray(raw.removeCombatant, 'removeCombatant', isStr, warnings);
  if (removeCombatant.length) actions.removeCombatant = removeCombatant;

  const remember = sanitizeArray(raw.remember, 'remember', isStr, warnings);
  if (remember.length) actions.remember = remember;
  const resolveFact = sanitizeArray(raw.resolveFact, 'resolveFact', isStr, warnings);
  if (resolveFact.length) actions.resolveFact = resolveFact;

  const advanceToChapter = sanitizeScalar(raw.advanceToChapter, 'advanceToChapter', isStr, warnings);
  if (advanceToChapter !== undefined) actions.advanceToChapter = advanceToChapter;
  const resolveChapterSection = sanitizeScalar(raw.resolveChapterSection, 'resolveChapterSection', isStr, warnings);
  if (resolveChapterSection !== undefined) actions.resolveChapterSection = resolveChapterSection;
  const switchActiveModule = sanitizeScalar(raw.switchActiveModule, 'switchActiveModule', isStr, warnings);
  if (switchActiveModule !== undefined) actions.switchActiveModule = switchActiveModule;
  const recallSession = sanitizeScalar(raw.recallSession, 'recallSession', isStr, warnings);
  if (recallSession !== undefined) actions.recallSession = recallSession;
  const recallMap = sanitizeScalar(raw.recallMap, 'recallMap', isStr, warnings);
  if (recallMap !== undefined) actions.recallMap = recallMap;
  const endBattle = sanitizeScalar(raw.endBattle, 'endBattle', isBool, warnings);
  if (endBattle !== undefined) actions.endBattle = endBattle;
  const battleResult = sanitizeScalar(raw.battleResult, 'battleResult', isStr, warnings);
  if (battleResult !== undefined) actions.battleResult = battleResult;

  return { actions, warnings };
}

/** Splits a DM reply into spoken narration + parsed actions (if any), plus
 *  any warnings from dropped/malformed fields. */
export function parseDmReply(reply: string): { narration: string; actions: DmActionSet | null; warnings: string[] } {
  const match = reply.match(ACTIONS_BLOCK);
  if (!match) return { narration: reply.trim(), actions: null, warnings: [] };

  const narration = reply.replace(ACTIONS_BLOCK, '').trim();
  try {
    const parsed: unknown = JSON.parse(match[1].trim());
    // Valid JSON isn't necessarily the right *shape* — live-tested against a
    // local model (llama3 via Ollama) that sometimes emits a syntactically
    // valid but wrongly-shaped block (e.g. ["damage",[...]] instead of
    // {"damage":[...]}), which would otherwise silently no-op downstream
    // (actions.damage reads as undefined) with no visible sign anything was
    // dropped. Treat "not a plain object" the same as a parse failure.
    if (!isPlainObject(parsed)) {
      console.warn('dm-actions block parsed but was not a plain object:', parsed);
      return { narration: reply.trim(), actions: null, warnings: [] };
    }
    const { actions, warnings } = sanitizeDmActionSet(parsed);
    if (warnings.length) console.warn('dm-actions block had malformed fields:', warnings);
    return { narration, actions, warnings };
  } catch (e) {
    console.warn('dm-actions block failed to parse:', e);
    return { narration: reply.trim(), actions: null, warnings: [] };
  }
}

function findIndex(party: Character[], name: string): number {
  const key = name.trim().toLowerCase();
  const exact = party.findIndex((c) => c.name.trim().toLowerCase() === key);
  if (exact !== -1) return exact;
  return party.findIndex((c) => c.name.trim().toLowerCase().startsWith(key));
}

/** Amount fields (damage/heal/tempHp) beyond this are almost certainly a
 *  hallucinated/malformed value rather than a real ruling — clamped rather
 *  than applied as-is, with a warning surfaced to the DM operator. Mainly a
 *  defense against weaker local models (see local_llm.rs), but applies to
 *  either provider since it's cheap and never wrong to have. */
const MAX_PLAUSIBLE_AMOUNT = 999;

export interface ApplyDmActionsResult {
  updated: Character[];
  /** Anything skipped (unknown character name) or clamped (implausible
   *  amount) — surfaced in the DM Console UI so a silently-dropped or
   *  suspicious change is never invisible, even though it's still
   *  auto-applied rather than gated behind a confirmation step. */
  warnings: string[];
}

/** Applies a parsed action set to the party, returning a new array plus any
 *  warnings for entries that were skipped or clamped. Characters with no
 *  matching action keep their original object reference (so callers can
 *  cheaply detect which ones actually changed). */
export function applyDmActions(party: Character[], actions: DmActionSet): ApplyDmActionsResult {
  const next = [...party];
  const warnings: string[] = [];

  const mutate = (name: string, fn: (c: Character) => Character) => {
    const idx = findIndex(next, name);
    if (idx === -1) {
      warnings.push(`Skipped an action for unknown character "${name}".`);
      return;
    }
    next[idx] = fn(next[idx]);
  };

  const clampAmount = (name: string, kind: string, amount: number): number => {
    if (amount < 0 || amount > MAX_PLAUSIBLE_AMOUNT) {
      const clamped = Math.max(0, Math.min(MAX_PLAUSIBLE_AMOUNT, amount));
      warnings.push(`Clamped an implausible ${kind} amount (${amount}) for ${name} to ${clamped}.`);
      return clamped;
    }
    return amount;
  };

  /** A party member can reach the store with no HP at all (see partyHp.ts), and
   *  `undefined - dmg` is NaN — which would then be written back and quietly
   *  poison every later turn, since the DM is told the party's HP every turn.
   *  Skip and say so, the same way an unknown name or an implausible amount is
   *  handled: never silently, never by inventing a number. */
  const withKnownHp = (name: string, kind: string, fn: (c: Character) => Character) =>
    mutate(name, (c) => {
      if (!hasKnownHp(c)) {
        warnings.push(`Couldn't apply ${kind} to ${c.name} — their sheet arrived with no HP. Ask them to re-send it from their own device.`);
        return c;
      }
      return fn(c);
    });

  for (const { name, amount } of actions.damage ?? []) {
    const dmgAmount = clampAmount(name, 'damage', amount);
    withKnownHp(name, 'damage', (c) => {
      let dmg = dmgAmount;
      let tempHP = c.tempHP ?? 0;
      if (tempHP > 0) { const absorbed = Math.min(tempHP, dmg); tempHP -= absorbed; dmg -= absorbed; }
      return { ...c, tempHP, currentHP: Math.max(0, c.currentHP - dmg) };
    });
  }

  for (const { name, amount } of actions.heal ?? []) {
    const healAmount = clampAmount(name, 'heal', amount);
    withKnownHp(name, 'healing', (c) => {
      const was = c.currentHP;
      const currentHP = Math.min(c.maxHP, c.currentHP + healAmount);
      const deathSaves = was === 0 && currentHP > 0 ? { successes: 0, failures: 0 } : c.deathSaves;
      return { ...c, currentHP, deathSaves };
    });
  }

  for (const { name, amount } of actions.tempHp ?? []) {
    const tempAmount = clampAmount(name, 'temp HP', amount);
    mutate(name, (c) => ({ ...c, tempHP: Math.max(0, tempAmount) }));
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

  return { updated: next, warnings };
}

/** Merges a partial `battleLog` dm-action (and any `removeCombatant` names)
 *  into the running Active Battle Log. This is the anti-drift core: the app
 *  holds the authoritative combat state and the DM sends only what changed, so
 *  a combatant the DM DOESN'T mention this turn is preserved unchanged rather
 *  than lost when the model's context compacts. Pure — returns a new BattleLog,
 *  never mutates `prev`.
 *
 *  - scalar fields (round/active/initiative/environment/notes) replace the
 *    previous value only when the update carries them;
 *  - combatants are upserted by name (case-insensitive, exact — so "Goblin 2"
 *    never clobbers "Goblin 1"), new fields shallow-merged over the old so a
 *    partial update (just `hp`, say) keeps the rest of that combatant's state;
 *  - names in `remove` are dropped. */
export function applyBattleLog(
  prev: BattleLog | null,
  update?: BattleLogUpdate,
  remove?: string[],
): BattleLog {
  const base: BattleLog = prev ?? { combatants: [] };
  const next: BattleLog = { ...base, combatants: [...base.combatants] };

  if (update) {
    if (update.round !== undefined) next.round = update.round;
    if (update.active !== undefined) next.active = update.active;
    if (update.initiative !== undefined) next.initiative = update.initiative;
    if (update.environment !== undefined) next.environment = update.environment;
    if (update.notes !== undefined) next.notes = update.notes;
    for (const c of update.combatants ?? []) {
      const key = c.name.trim().toLowerCase();
      const idx = next.combatants.findIndex((x) => x.name.trim().toLowerCase() === key);
      if (idx === -1) next.combatants.push(c);
      else next.combatants[idx] = { ...next.combatants[idx], ...c };
    }
  }

  if (remove?.length) {
    const drop = new Set(remove.map((n) => n.trim().toLowerCase()));
    next.combatants = next.combatants.filter((c) => !drop.has(c.name.trim().toLowerCase()));
  }

  return next;
}
