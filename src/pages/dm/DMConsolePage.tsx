import React from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { openPath } from '@tauri-apps/plugin-opener';
import { ArrowLeft, Mic, Square, Radio, Trash2, BookOpen, ScrollText, FileUp, Plus, Upload, Download, Map, ClipboardList, Cpu, Landmark, RotateCcw, Volume2, Swords } from 'lucide-react';
import { Button, Card, Badge, Dialog } from '../../components/ui';
import { usePartyStore } from '../../store/usePartyStore';
import { useCampaignStore } from '../../store/useCampaignStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { buildTurnPrompt, buildRecapPrompt } from '../../utils/dmPrompt';
import { hasKnownHp } from '../../utils/partyHp';
import { parseDmReply, applyDmActions, applyBattleLog, VOICE_CATALOG_IDS, PITCH_TAG_IDS, BATTLE_MODE_LABELS, BATTLE_MODES, isBattleMode } from '../../utils/dmActions';
import type { BattleLog, BattleMode } from '../../utils/dmActions';
import { battleMapToPngDataUrl, battleMapToPdfBytes, preloadBattleTileSprites, preloadResolvedTileArt, setActiveTileStyle, type MapTileArt, type MapTerrain } from '../../utils/battleMapRender';
import type { TileStyleId } from '../../utils/battleMapRender';
import { TILE_STYLES } from '../../data/tileStyles';
import { startRecording, stopAndTranscribe, warmupSTT, previewVoice, stopSpeaking, prepareSpeech, playPrepared, discardPrepared } from '../../utils/dmSpeech';
import type { PreparedSpeech } from '../../utils/dmSpeech';
import { pickEphemeralVoice, pickVoiceForGender, inferGender, inferGenderStrict } from '../../utils/dmVoices';
import { getRace } from '../../data/races';
import { getClass } from '../../data/classes';
import { getBackground } from '../../data/backgrounds';
import { ALL_SUBCLASSES } from '../../data/subclasses';
import type { Character } from '../../types';

const DM_PORT = 7777;

/** GPU info from tts.rs's probe_cuda (None → no NVIDIA card). */
interface CudaInfo { name: string; vram_mb: number; }

/** Minimum VRAM (MB) to offer the F5 high-quality voice engine. F5 and the
 *  WebGL character viewport share the GPU, so a small card would stutter —
 *  ~6 GB is the floor. Below this the F5 option is shown but disabled. */
const F5_MIN_VRAM_MB = 6000;

/** How often (in turns) the campaign-arc plan gets re-included in the turn
 *  prompt when nothing else has already triggered a check-in. See dmPrompt.ts
 *  and campaign.rs for why this isn't just always-on via CLAUDE.md. */
const PLAN_CHECK_INTERVAL = 8;

/** Canned reply for any turn (local mic or a remote player's /talk) that
 *  arrives while a one-shot ingestion call — establish_campaign_lore,
 *  chapterize_and_import_module, update_campaign_lore, NPC-voice
 *  reconciliation, all surfaced via moduleBusy — is actively (re)writing this
 *  campaign's memory/CLAUDE.md files. Short-circuits runTurn entirely: no
 *  callDm, no session/memory/action side effects, just this line spoken. */
const CAMPAIGN_BUILDING_MESSAGE = "I am currently building our campaign, please wait until I'm finished.";

/** Reserved npc_voices.json key for the campaign's own narrator voice pick —
 *  see campaign.rs's NARRATOR_VOICE_KEY/establish_campaign_lore_at. Must
 *  match that Rust constant exactly (already lowercase, so no normalization
 *  needed on this side). */
const NARRATOR_VOICE_KEY = '__narrator__';

/** One npc_voices.json entry, mirroring campaign.rs's NpcVoiceAssignment —
 *  `speed` is this app's own pace-factor convention (bigger = slower; see
 *  DEFAULT_PACE_FACTOR's doc comment in tts.rs), independent of `pitch`.
 *  Converted to Kokoro's own (inverted) native speed scale only at the
 *  actual synthesis call, so this stored value's meaning never changed
 *  across the Piper->Kokoro engine swap. */
type NpcVoiceEntry = { voice_id: string; pitch?: string; speed?: number };

/** Human-readable label per catalog id, for the voice-override panel's
 *  dropdown — purely cosmetic, doesn't affect anything sent to Kokoro.
 *  "narrator" deliberately excluded: NPCs pick from this list, and
 *  "(narrator default)" is offered as its own separate option instead (see
 *  the panel's <select>) rather than listing "narrator" as if it were just
 *  another NPC voice choice. Keep in sync with VOICE_CATALOG_IDS (imported
 *  from dmActions.ts, which itself mirrors tts.rs's VOICE_CATALOG). Only
 *  American/British — Kokoro (unlike the Piper VCTK pack this replaced) has
 *  no Scottish/Irish/Welsh/Australian/South African voices at all. */
const VOICE_LABELS: Record<string, string> = {
  'male-us-1': 'American (male 1)',
  'male-us-2': 'American (male 2)',
  'male-us-3': 'American (male 3)',
  'male-us-4': 'American (male 4)',
  'male-us-5': 'American (male 5)',
  'male-us-6': 'American (male 6)',
  'male-us-7': 'American (male 7)',
  'male-us-8': 'American (male 8)',
  'male-us-9': 'American (male 9)',
  'male-gb-1': 'English (male 1)',
  'male-gb-2': 'English (male 2)',
  'male-gb-3': 'English (male 3)',
  'male-gb-4': 'English (male 4)',
  'female-us-1': 'American (female 1)',
  'female-us-2': 'American (female 2)',
  'female-us-3': 'American (female 3)',
  'female-us-4': 'American (female 4)',
  'female-us-5': 'American (female 5)',
  'female-us-6': 'American (female 6)',
  'female-us-7': 'American (female 7)',
  'female-us-8': 'American (female 8)',
  'female-us-9': 'American (female 9)',
  'female-us-10': 'American (female 10)',
  'female-gb-1': 'English (female 1)',
  'female-gb-2': 'English (female 2)',
  'female-gb-3': 'English (female 3)',
  'female-gb-4': 'English (female 4)',
  // F5-exclusive archetype voices (tts.rs's ARCHETYPE_VOICES) -- only
  // resolve to real audio under F5, hence the "HD" suffix; under Kokoro
  // each falls back to its declared nearest catalog voice.
  'orc-m-1': 'Orc (male 1) — HD',
  'orc-m-2': 'Orc (male 2) — HD',
  'orc-m-3': 'Orc (male 3) — HD',
  'orc-m-4': 'Orc (male 4) — HD',
  'orc-m-5': 'Orc (male 5) — HD',
  'orc-f-1': 'Orc (female 1) — HD',
  'orc-f-2': 'Orc (female 2) — HD',
  'orc-f-3': 'Orc (female 3) — HD',
  'orc-f-4': 'Orc (female 4) — HD',
  'orc-f-5': 'Orc (female 5) — HD',
  'giant-m-1': 'Giant-kin (male 1) — HD',
  'giant-m-2': 'Giant-kin (male 2) — HD',
  'giant-m-3': 'Giant-kin (male 3) — HD',
  'giant-m-4': 'Giant-kin (male 4) — HD',
  'giant-m-5': 'Giant-kin (male 5) — HD',
  'giant-f-1': 'Giant-kin (female 1) — HD',
  'giant-f-2': 'Giant-kin (female 2) — HD',
  'giant-f-3': 'Giant-kin (female 3) — HD',
  'giant-f-4': 'Giant-kin (female 4) — HD',
  'giant-f-5': 'Giant-kin (female 5) — HD',
  'dwarf-m-1': 'Dwarf (male 1) — HD',
  'dwarf-m-2': 'Dwarf (male 2) — HD',
  'dwarf-m-3': 'Dwarf (male 3) — HD',
  'dwarf-m-4': 'Dwarf (male 4) — HD',
  'dwarf-m-5': 'Dwarf (male 5) — HD',
  'dwarf-f-1': 'Dwarf (female 1) — HD',
  'dwarf-f-2': 'Dwarf (female 2) — HD',
  'dwarf-f-3': 'Dwarf (female 3) — HD',
  'dwarf-f-4': 'Dwarf (female 4) — HD',
  'dwarf-f-5': 'Dwarf (female 5) — HD',
  'elf-m-1': 'Elf (male 1) — HD',
  'elf-m-2': 'Elf (male 2) — HD',
  'elf-m-3': 'Elf (male 3) — HD',
  'elf-m-4': 'Elf (male 4) — HD',
  'elf-m-5': 'Elf (male 5) — HD',
  'elf-f-1': 'Elf (female 1) — HD',
  'elf-f-2': 'Elf (female 2) — HD',
  'elf-f-3': 'Elf (female 3) — HD',
  'elf-f-4': 'Elf (female 4) — HD',
  'elf-f-5': 'Elf (female 5) — HD',
  'gnome-m-1': 'Gnome (male 1) — HD',
  'gnome-m-2': 'Gnome (male 2) — HD',
  'gnome-m-3': 'Gnome (male 3) — HD',
  'gnome-m-4': 'Gnome (male 4) — HD',
  'gnome-m-5': 'Gnome (male 5) — HD',
  'gnome-f-1': 'Gnome (female 1) — HD',
  'gnome-f-2': 'Gnome (female 2) — HD',
  'gnome-f-3': 'Gnome (female 3) — HD',
  'gnome-f-4': 'Gnome (female 4) — HD',
  'gnome-f-5': 'Gnome (female 5) — HD',
  'halfling-m-1': 'Halfling (male 1) — HD',
  'halfling-m-2': 'Halfling (male 2) — HD',
  'halfling-m-3': 'Halfling (male 3) — HD',
  'halfling-m-4': 'Halfling (male 4) — HD',
  'halfling-m-5': 'Halfling (male 5) — HD',
  'halfling-f-1': 'Halfling (female 1) — HD',
  'halfling-f-2': 'Halfling (female 2) — HD',
  'halfling-f-3': 'Halfling (female 3) — HD',
  'halfling-f-4': 'Halfling (female 4) — HD',
  'halfling-f-5': 'Halfling (female 5) — HD',
  'sinister-m-1': 'Sinister (male 1) — HD',
  'sinister-m-2': 'Sinister (male 2) — HD',
  'sinister-m-3': 'Sinister (male 3) — HD',
  'sinister-m-4': 'Sinister (male 4) — HD',
  'sinister-m-5': 'Sinister (male 5) — HD',
  'sinister-f-1': 'Sinister (female 1) — HD',
  'sinister-f-2': 'Sinister (female 2) — HD',
  'sinister-f-3': 'Sinister (female 3) — HD',
  'sinister-f-4': 'Sinister (female 4) — HD',
  'sinister-f-5': 'Sinister (female 5) — HD',
  'sage-m-1': 'Elderly sage (male 1) — HD',
  'sage-m-2': 'Elderly sage (male 2) — HD',
  'sage-m-3': 'Elderly sage (male 3) — HD',
  'sage-m-4': 'Elderly sage (male 4) — HD',
  'sage-m-5': 'Elderly sage (male 5) — HD',
  'sage-f-1': 'Elderly sage (female 1) — HD',
  'sage-f-2': 'Elderly sage (female 2) — HD',
  'sage-f-3': 'Elderly sage (female 3) — HD',
  'sage-f-4': 'Elderly sage (female 4) — HD',
  'sage-f-5': 'Elderly sage (female 5) — HD',
};

/** Ordered options for the voice-override panel's dropdown — every catalog
 *  id except "narrator" (see VOICE_LABELS' doc comment), in the same order
 *  VOICE_LABELS lists them so the dropdown groups by accent consistently. */
const NPC_VOICE_OPTIONS = Object.keys(VOICE_LABELS).filter((id) => VOICE_CATALOG_IDS.has(id));

/** Label per pitch tag for the voice-override panel — mirrors
 *  PITCH_TAG_IDS (dmActions.ts) plus the "no shift" default. */
const PITCH_LABELS: Record<string, string> = {
  '': 'No pitch shift',
  small: 'Small (higher, quicker)',
  gruff: 'Gruff (mild deepen)',
  large: 'Large (deep, slow)',
};
const NPC_PITCH_OPTIONS = ['', ...Array.from(PITCH_TAG_IDS)];

/** Label per speed override for the voice-override panel — the value is the
 *  literal pace-factor string passed to tts.rs's speak_text (smaller =
 *  faster; see DEFAULT_PACE_FACTOR's doc comment for why 1.15 is "default"
 *  rather than a neutral 1.0 — tts.rs converts this to Kokoro's own
 *  inverted native speed scale right before synthesis, so this value's
 *  meaning here is unchanged from before the Piper->Kokoro swap).
 *  Independent of pitch — this only changes pace, never tone. */
const SPEED_LABELS: Record<string, string> = {
  '': 'Default pace',
  // 0.65/0.55 push past what the Piper-era list offered. tts.rs inverts these
  // into Kokoro's native scale (1/0.55 ≈ 1.82), which it accepts without
  // clamping — kokoro_cli.py passes `speed` straight through to
  // kokoro.create. Intelligibility at the top end is a matter of taste, so
  // audition with the panel's Preview button before committing a voice to it.
  '0.55': 'Fastest',
  '0.65': 'Extremely fast',
  '0.75': 'Very fast',
  '0.85': 'Fast',
  '0.95': 'Faster',
  '1.05': 'Slightly faster',
  '1.30': 'Slower',
  '1.45': 'Slow',
  '1.60': 'Very slow',
};
const NPC_SPEED_OPTIONS = ['', '0.55', '0.65', '0.75', '0.85', '0.95', '1.05', '1.30', '1.45', '1.60'];

/** A fixed sample line for the voice-override panel's Preview button. Kept
 *  short on purpose — Kokoro synthesis time scales with text length, and this
 *  is auditioned repeatedly on CPU-only machines, so a shorter line makes each
 *  first-time preview noticeably faster while still carrying two beats (a
 *  greeting + a fall) to judge the voice's timbre and prosody. Same text for
 *  every voice so previews are comparable; re-plays are cached (see
 *  dmSpeech's previewVoice). */
const VOICE_PREVIEW_LINE = "Well met, traveler. Night draws near.";

/** Deliberate silence inserted between spoken sentences (see enqueueSentence's
 *  playback loop). Before synthesis/playback pipelining, the time it took to
 *  synthesize sentence N+1 while sentence N was already playing incidentally
 *  acted as a natural inter-sentence beat; now that a sentence's audio is
 *  usually already sitting ready the instant the previous one finishes, lines
 *  play back completely back-to-back with zero gap — most noticeable (reads
 *  as "speeding up") through a run of short punchy sentences, exactly the
 *  style dramatic narration tends to favor. This restores that beat on
 *  purpose instead of relying on synthesis latency to provide it by accident. */
const SENTENCE_GAP_MS = 260;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Pure: parses entities.md's "- **Name:** description" lines (see
 *  campaign.rs's parse_entities_md, the format this must match) into a
 *  simple name list for the voice-override panel — the panel only needs
 *  names, not descriptions, since voice assignment is purely by name. */
function parseEntityNamesForVoicePanel(entitiesText: string): string[] {
  const names: string[] = [];
  for (const line of entitiesText.split('\n')) {
    const match = line.match(/^- \*\*(.+?):\*\*/);
    if (match) names.push(match[1].trim());
  }
  return names;
}

interface Turn {
  /** 'dm' for narration, 'you' for the DM Console's own mic, or a player's
   *  character name when the line arrived remotely via dm-player-turn. */
  who: string;
  text: string;
}

interface PlayerTurn {
  /** Absent for a turn queued from the DM Console's own mic (see
   *  handleTalkToggle's barge-in path) — present for anything that arrived
   *  via dm-player-turn (a remote player's TalkToDMButton). */
  name?: string;
  text: string;
  /** Present only for remote-originated turns — see party_listener.rs's
   *  `/talk` handler, which blocks on this id until respond_to_player_turn
   *  is called (drainQueue), so the player's own device can see the DM's
   *  actual reply instead of just a delivery ack. */
  requestId?: string;
}

/** What runTurn actually did, so callers (drainQueue, in particular) can
 *  react — e.g. respond to a still-blocked remote `/talk` request with the
 *  real outcome instead of leaving it to time out. */
interface TurnResult {
  narration: string | null;
  interrupted: boolean;
  error: string | null;
}

interface CampaignMeta {
  id: string;
  name: string;
}

interface CampaignIntake {
  name: string;
  edition: string;
  players: string;
  module: string;
  notes: string;
  lore: string;
}

const BLANK_INTAKE: CampaignIntake = { name: '', edition: '2014', players: '', module: '', notes: '', lore: '' };

interface ChapterSummary {
  id: string;
  title: string;
  summary: string;
}

/** One prepared battle map's headline info — mirrors campaign.rs's
 *  BattleMapMeta (slug + name + a grid-size summary). */
interface BattleMapMeta {
  slug: string;
  name: string;
  summary: string;
}

/** Mirrors campaign.rs's SessionPlanResult — the merged "Plan Next Session"
 *  response (plan text + the battle maps derived from it). */
interface SessionPlanResult {
  plan_text: string;
  maps: BattleMapMeta[];
  /** Combat encounters whose map generation failed — see campaign.rs's
   *  generate_battle_maps_for_plan_at. Shown as a warning so a partial set
   *  is never mistaken for "that's all the maps there are." */
  failed_maps: string[];
}

/** Pulls the `Deployment:` section's Enemies/Party lines out of a map spec so
 *  the card can show where each side starts up front, instead of leaving it
 *  buried in the raw-spec textarea. Fields are undefined for maps generated
 *  before the section existed. Pure. */
function parseDeployment(spec: string): { enemies?: string; party?: string } {
  const grab = (label: string) =>
    spec.match(new RegExp(`^\\s*-\\s*${label}\\s*:\\s*(.+)$`, 'im'))?.[1].trim();
  return { enemies: grab('Enemies'), party: grab('Party') };
}

/** A battle map card as rendered in the merged Plan Next Session dialog —
 *  BattleMapMeta plus the full spec text and its rendered preview PNG. */
/** One PLACE the map resolver knows about, as pack_profile.rs derived it, plus
 *  the evidence a human needs to judge whether it's right — how much art is
 *  actually in that biome, and a thumbnail of what its ground query resolves
 *  to. A wrong ground query is invisible in text and obvious in a picture. */
interface BiomeProfileView {
  scene: string;
  folder: string;
  floor_query: string | null;
  natural_walls: boolean;
  liquid_query: string | null;
  tiles: number;
  ground_thumb: string | null;
  ground_options: string[];
}

interface PackProfileView {
  universal_biome: string | null;
  object_categories: string[];
  terrain_categories: string[];
  all_categories: string[];
  biomes: BiomeProfileView[];
  /** False means nothing has been profiled and these are the built-in
   *  Forgotten Adventures defaults — i.e. a guess about someone else's pack. */
  profiled: boolean;
}

/** Only the fields a correction actually names are sent, so fixing one biome's
 *  ground doesn't freeze the rest against a later re-profile. `null` for a
 *  query means "this biome genuinely has no ground art, keep the built-in
 *  floor" — distinct from omitting the field, which means "not corrected". */
type BiomeEdit = { folder?: string; floor_query?: string | null; natural_walls?: boolean; liquid_query?: string | null };
type ProfileOverrides = { biomes: Record<string, BiomeEdit | undefined> };

interface MapCard {
  slug: string;
  name: string;
  summary: string;
  spec: string;
  png: string | null;
  /** Resolved catalog tiles (vision-picked at generation) — the render draws
   *  these over the base grid. Empty when no library / nothing resolved. */
  tiles: MapTileArt[];
  /** Resolved catalog terrain — ground, water, and whether `#` is living
   *  rock. Empty object keeps the built-in tileset (dungeon / no library). */
  terrain: MapTerrain;
}

/** One imported module's headline info — mirrors campaign.rs's ModuleSummary.
 *  A campaign can have several; exactly one is active at a time. */
interface ModuleSummary {
  id: string;
  title: string;
  summary: string;
}

/** chapterize_and_import_module's return shape — mirrors campaign.rs's
 *  ChapterizeImportResult. Field names are snake_case because Tauri
 *  serializes Rust structs with serde's default casing (see get_module_chapters's
 *  existing current_id field for the same convention). */
interface ChapterizeImportResult {
  module_id: string;
  module_title: string;
  chapters: ChapterSummary[];
  /** Spoiler-free structural concerns from the ingestion self-audit (see
   *  campaign.rs's ChapterizeReply::concerns + coverage_concern) — never
   *  plot content, safe to surface even if you're a player, not the DM. */
  concerns: string[];
}

/** Source for a `[Name]:` / `[Name|gender]:` NPC-dialogue cue — shared by
 *  SPEAKER_TAG (anchored, for parsing a cue that's already at the start of a
 *  sentence) and TAG_ANYWHERE below (unanchored, for finding one mid-buffer). */
const TAG_BODY = '\\[([^\\]]{1,60})\\]:\\s*';

/** Matches a speaker cue occurring anywhere in a buffer, not just at the
 *  start — used by extractCompleteSentences to treat a mid-sentence cue as
 *  its own boundary. The DM sometimes writes a cue right after a colon
 *  instead of starting a fresh sentence (`...bellows: [Guard|male]: "..."`),
 *  and without this the cue stays glued to the prose before it — it's never
 *  at position 0 of anything, so parseSpeakerTag's `^` anchor never fires
 *  and the raw `[Guard|male]:` leaks straight into what's shown/spoken. */
const TAG_ANYWHERE = new RegExp(TAG_BODY);

/** Splits an accumulating narration buffer into any newly-complete sentences
 *  plus the remaining (possibly incomplete) tail. A sentence only counts as
 *  complete when its ending punctuation is followed by whitespace — not
 *  just because the buffer happens to end there, since more text may still
 *  be streaming in. Doesn't need to be perfect (abbreviations, decimals,
 *  etc. can occasionally split oddly) — worst case a sentence gets spoken
 *  in two slightly-early pieces, not a correctness issue. A speaker cue
 *  found past the very start of the remaining buffer is ALSO treated as a
 *  boundary (see TAG_ANYWHERE) — whichever comes first wins. */
function extractCompleteSentences(buffer: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let rest = buffer;
  const boundary = /[.!?]+["')\]]?\s+/;
  for (;;) {
    const punctMatch = rest.match(boundary);
    const punctEnd = punctMatch && punctMatch.index !== undefined ? punctMatch.index + punctMatch[0].length : undefined;
    const tagMatch = rest.match(TAG_ANYWHERE);
    const tagStart = tagMatch && tagMatch.index !== undefined && tagMatch.index > 0 ? tagMatch.index : undefined;
    const end = tagStart !== undefined && (punctEnd === undefined || tagStart < punctEnd) ? tagStart : punctEnd;
    if (end === undefined) break;
    sentences.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  return { sentences, remainder: rest };
}

/** Matches a leading `[Name]:` NPC-dialogue cue (see BASE_CLAUDE_MD's "Giving
 *  NPCs distinct voices") at the very start of a sentence. Every sentence
 *  handed here has already been split so any cue is at position 0 — see
 *  TAG_ANYWHERE above, which is what makes that guarantee hold even when the
 *  DM wrote the cue mid-buffer instead of starting a fresh sentence with it. */
const SPEAKER_TAG = new RegExp(`^\\s*${TAG_BODY}`);

/** How much recent narrator prose to keep as a gender signal for an untagged
 *  NPC (see resolveEphemeralVoice). Roughly a sentence or two — long enough to
 *  catch "an old man shuffles from the pews" right before he speaks, short
 *  enough that a gendered noun from an earlier beat has already fallen out. */
const NARRATION_GENDER_WINDOW = 240;

/** True when a sentence begins with an OPENING double quote — the signature of
 *  dialogue, as opposed to prose that merely contains a quotation somewhere in
 *  the middle. Used to decide whether an untagged sentence is an NPC resuming
 *  speech (see enqueueSentence's dialogue-resume branch). A closing curly quote
 *  never opens dialogue, so it is deliberately not matched here. */
function opensWithQuote(sentence: string): boolean {
  return /^\s*["“]/.test(sentence);
}

/** Strips a leading `[Name]:` cue from one sentence, returning the cue-free
 *  text plus whichever name it names (or null when the sentence carries no
 *  tag of its own). Purely parses this one sentence — the stickiness that
 *  carries a speaker across untagged continuation sentences lives one level
 *  up in enqueueSentence, so a null here means "no tag on this sentence,"
 *  NOT "revert to narrator." BASE_CLAUDE_MD documents the sticky convention
 *  (and the `[Narrator]:` reset) to the DM.
 *
 *  Also accepts an optional gender marker: `[Ismark|male]:`. A proper name
 *  carries no gender word of its own, so for an NPC who has no voice on file
 *  yet — every NPC on the turn that introduces them, since the `dm-actions`
 *  block that could assign one only arrives AFTER the narration has already
 *  streamed and been spoken — the marker is the only thing that can pick a
 *  correctly-gendered voice for their very first line. BASE_CLAUDE_MD asks
 *  for it on first mention only; it's stripped from the spoken text either
 *  way, and an absent or unrecognized marker just yields a null hint. */
function parseSpeakerTag(sentence: string): { speaker: string | null; text: string; genderHint: 'male' | 'female' | null } {
  const match = sentence.match(SPEAKER_TAG);
  if (!match) return { speaker: null, text: sentence, genderHint: null };
  const [rawName, rawGender] = match[1].split('|');
  const gender = rawGender?.trim().toLowerCase();
  return {
    speaker: rawName.trim(),
    text: sentence.slice(match[0].length),
    genderHint: gender === 'male' || gender === 'female' ? gender : null,
  };
}

/** Counts double-quote characters (straight " plus curly “ ”) in a string.
 *  Used to track whether we're mid-quote across sentences — NPC dialogue is
 *  quoted, narration isn't, so quote state is what lets a sticky NPC voice
 *  auto-revert to the narrator when the speech ends (see enqueueSentence).
 *  Single quotes/apostrophes are deliberately ignored — they're contractions
 *  ("don't"), not speech delimiters. */
function countDoubleQuotes(s: string): number {
  return (s.match(/["“”]/g) || []).length;
}

/** Strips every `[Name]:` cue out of a full (already-complete) narration
 *  block before it's shown in the chat transcript or sent to a remote
 *  player — the cue is purely a TTS voice-selection signal (see
 *  parseSpeakerTag), never meant to be read. Reuses extractCompleteSentences
 *  so the per-sentence stripping logic stays in exactly one place, whether
 *  applied live (streaming) or to a final assembled reply (here). */
function stripSpeakerTagsForDisplay(text: string): string {
  const { sentences, remainder } = extractCompleteSentences(text);
  const cleanedSentences = sentences.map((s) => parseSpeakerTag(s).text).join('');
  return cleanedSentences + parseSpeakerTag(remainder).text;
}

/** mm:ss (or h:mm:ss past an hour) for the moduleBusy elapsed-time ticker.
 *  These ingestion calls return one big JSON blob at the end (chapter
 *  breakdown, plan, lore doc) — there's no meaningful partial content to
 *  stream mid-call the way spoken narration streams sentence-by-sentence, so
 *  a running clock next to the busy message is the honest signal to show:
 *  proof the app hasn't hung, not a progress bar with a real percentage. */
function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Opens the OS file picker filtered to module documents and returns the
 *  extracted text (Rust does PDF text-extraction or plain UTF-8 read — see
 *  campaign.rs's extract_module_text) plus the picked filename, or null if
 *  the user cancelled. `concern` is set when the PDF looks like a scanned/
 *  image-only document (see scanned_pdf_concern) — surfaced by every call
 *  site before any expensive ingestion call runs on what might be near-
 *  empty/garbled text. */
async function pickAndExtractModuleFile(): Promise<{ name: string; text: string; concern: string | null } | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: 'Module document', extensions: ['pdf', 'md', 'txt'] }],
  });
  if (!path || typeof path !== 'string') return null;
  const { text, concern } = await invoke<{ text: string; concern: string | null }>('extract_module_text', { path });
  const name = path.split(/[\\/]/).pop() ?? path;
  return { name, text, concern };
}

/** One character's identity + backstory as a single line for the campaign's
 *  memory/party.md (see campaign.rs's upsert_party_member) — what lets the DM
 *  actually play off who these characters ARE (bonds, flaws, backstory),
 *  rather than only the combat state (HP/conditions) in the per-turn party
 *  status. Single-line because party.md reuses entities.md's line-based
 *  upsert-by-name machinery; the player-written notes get their newlines
 *  flattened rather than truncated (arbitrary truncation of a backstory is
 *  exactly the kind of silent loss the memory files are designed to avoid —
 *  a few KB in an always-loaded file is a fair price for the DM knowing it). */
function buildPartyMemberSummary(c: Character): string {
  const race = getRace(c.raceId)?.name ?? c.raceId ?? '';
  const background = getBackground(c.backgroundId)?.name;
  const totalLevel = (c.classes ?? []).reduce((s, cl) => s + (cl.level || 0), 0);
  const classText = (c.classes ?? [])
    .map((cl) => {
      const className = getClass(cl.classId)?.name ?? cl.classId;
      const subclassName = cl.subclassId ? ALL_SUBCLASSES.find((s) => s.id === cl.subclassId)?.name : undefined;
      return subclassName ? `${className} (${subclassName})` : className;
    })
    .join(' / ');
  const parts = [
    c.playerName?.trim() ? `Played by ${c.playerName.trim()}.` : undefined,
    // Join only the identity parts that actually exist. A character with no
    // race (or no classes) used to stringify `undefined` straight into the
    // line — "Level 1 undefined Fighter" — and party.md is a STANDING import,
    // so the DM was being told that verbatim on every single turn.
    [`Level ${totalLevel}`, race, classText].filter((p) => p.trim()).join(' ') +
      (c.alignment?.trim() ? `, ${c.alignment.trim()}` : '') +
      (background ? `, ${background} background.` : '.'),
    c.notes?.trim() ? `Player-written backstory/notes: ${c.notes.replace(/\s+/g, ' ').trim()}` : undefined,
  ];
  return parts.filter(Boolean).join(' ');
}

/**
 * DMConsolePage — the in-app spoken-word Dungeon Master.
 *
 * Each campaign is its own local Claude Code project (see campaign.rs): a
 * folder with a CLAUDE.md (persona + house rules + world lore) and a
 * memory/MEMORY.md that accumulates a session recap plus any standalone facts
 * the DM flags as worth remembering (dm-actions `remember`). ask_dm runs
 * `claude` with that folder as its working directory, so CLAUDE.md auto-loads
 * every turn — that's how the DM "remembers" the campaign week to week
 * instead of relying on --resume surviving the gap between sessions.
 *
 * An imported module is chaptered, not dumped whole: only the current
 * chapter's full text loads per turn (module/current.md) alongside a small
 * always-loaded index of every chapter's title + summary (module/index.md).
 * Claude signals when to advance via dm-actions `advanceToChapter` — handled
 * below in runTurn — so the player never has to name a chapter themselves.
 *
 * Push-to-talk: click Talk, speak, click Stop. The mic audio is transcribed
 * locally (Whisper), sent to Claude (the user's own subscription via ask_dm —
 * no per-token API), and the reply is read aloud. A trailing ```dm-actions
 * block in the reply (see dmActions.ts) updates the party's HP/conditions/etc.
 * Other players push their characters here over LAN via "Send to DM" in
 * Tavern Sheet, received by party_listener.rs and merged into usePartyStore.
 *
 * Players can also talk without ever opening this page: TalkToDMButton on
 * their own character sheet POSTs a transcribed line to /talk, which
 * party_listener.rs re-emits here as `dm-player-turn`. Since only one Claude
 * turn can run at a time, remote turns land in a queue (queueRef) and drain
 * one at a time — see drainQueue/runTurn below.
 */
export function DMConsolePage() {
  const navigate = useNavigate();
  const { party, upsert, remove, clear } = usePartyStore();
  const { activeCampaignId, setActiveCampaignId } = useCampaignStore();
  const { dmProvider, setDmProvider, localLlmBaseUrl, setLocalLlmBaseUrl, localLlmModel, setLocalLlmModel, localLlmHistoryTurns, setLocalLlmHistoryTurns, ingestionProvider, setIngestionProvider, ttsEngine, setTtsEngine, battleTileStyle, setBattleTileStyle, setTileLibraryPath } = useSettingsStore();

  const [listening, setListening] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [dmModelOpen, setDmModelOpen] = React.useState(false);
  const [localModels, setLocalModels] = React.useState<string[]>([]);
  const [localModelsLoading, setLocalModelsLoading] = React.useState(false);
  const [localModelsError, setLocalModelsError] = React.useState<string | null>(null);
  const [voiceEngineOpen, setVoiceEngineOpen] = React.useState(false);
  const [cudaInfo, setCudaInfo] = React.useState<CudaInfo | null>(null);
  const [f5Installed, setF5Installed] = React.useState(false);
  const [f5ConfirmOpen, setF5ConfirmOpen] = React.useState(false);
  const [f5Installing, setF5Installing] = React.useState(false);
  const [f5Progress, setF5Progress] = React.useState<{ phase: string; downloaded: number; total: number } | null>(null);
  const [hdPromptOpen, setHdPromptOpen] = React.useState(false);
  const [hdPromptCount, setHdPromptCount] = React.useState(0);
  /** Campaign ids already checked for archetype voices this app session — so
   *  switching back to a campaign the user already dismissed the prompt for
   *  doesn't ask again every time (see the effect below). Resets on restart,
   *  which is fine: worst case is one repeat prompt per campaign per launch. */
  const hdPromptedRef = React.useRef<Set<string>>(new Set());
  const [lanIp, setLanIp] = React.useState<string | null>(null);
  const [sttReady, setSttReady] = React.useState(false);

  const [campaigns, setCampaigns] = React.useState<CampaignMeta[]>([]);
  const [newCampaignOpen, setNewCampaignOpen] = React.useState(false);
  const [newCampaign, setNewCampaign] = React.useState<CampaignIntake>(BLANK_INTAKE);
  const [pendingModuleFile, setPendingModuleFile] = React.useState<{ name: string; text: string } | null>(null);
  const [pendingLoreFile, setPendingLoreFile] = React.useState<{ name: string; text: string } | null>(null);
  const [moduleBusy, setModuleBusy] = React.useState<string | null>(null);
  /** Step progress for the currently-running module import ONLY — see
   *  campaign.rs's IngestProgress ("ingest-progress" event). The other
   *  moduleBusy consumers (attach lore, reconcile NPC voices/hooks, create
   *  campaign) are single opaque calls with nothing to report, so they stay
   *  on the plain elapsed-time ticker below; this is layered on top just for
   *  handleImportModuleForNewCampaign/handleImportModuleForExisting. */
  const [ingestProgress, setIngestProgress] = React.useState<{ phase: string; done: number; total: number } | null>(null);
  // Elapsed-time ticker for moduleBusy — one-shot Opus ingestion calls
  // (establish_campaign_lore, chapterize_and_import_module, update_campaign_lore)
  // can run for minutes on a long PDF with nothing else changing on screen, so
  // a running clock is the cheapest way to signal "still working" rather than
  // a truly hung UI. Not real token-streaming progress (see the doc comment
  // on formatElapsed for why that's not a good fit for these JSON-producing
  // calls) — just proof of life. Deliberately doesn't store the elapsed
  // *value* in state (a synchronous setState in an effect body triggers a
  // lint error and risks a stale flash from a previous busy period) — the
  // start time lives in a ref, forceModuleBusyTick just triggers a re-render
  // every second, and moduleBusyLabel below computes the live elapsed value
  // fresh from Date.now() each render.
  const moduleBusyStartRef = React.useRef(0);
  const [, forceModuleBusyTick] = React.useReducer((c: number) => c + 1, 0);
  React.useEffect(() => {
    if (!moduleBusy) return;
    moduleBusyStartRef.current = Date.now();
    const interval = setInterval(forceModuleBusyTick, 1000);
    return () => clearInterval(interval);
  }, [moduleBusy]);
  // Mirrors moduleBusy for runTurn/drainQueue/handleTalkToggle, which close
  // over refs rather than state to avoid stale reads from listeners
  // registered once at mount (same reasoning as campaignIdRef etc.).
  const moduleBusyRef = React.useRef<string | null>(null);
  React.useEffect(() => { moduleBusyRef.current = moduleBusy; }, [moduleBusy]);
  const [creatingCampaign, setCreatingCampaign] = React.useState(false);
  const [exportingCampaign, setExportingCampaign] = React.useState(false);
  const [importingCampaign, setImportingCampaign] = React.useState(false);
  // "Claude isn't connected — connect now?" gate (see dm.rs's
  // check_claude_auth/connect_claude doc comments). Without this, a dead
  // `claude` connection only surfaces deep inside an ingestion call or a
  // silent campaign-selection warmup, as an opaque OS pipe error. `resolve`
  // holds whatever ensureClaudeConnected's caller is awaiting — Connect
  // resolves true/false depending on whether login actually succeeded,
  // Cancel resolves false — so both handleCreateCampaign and the campaign-
  // selection effect can just `await ensureClaudeConnected()` and treat it as
  // a normal boolean gate regardless of which path triggered the dialog.
  const [connectPromptOpen, setConnectPromptOpen] = React.useState(false);
  const [connecting, setConnecting] = React.useState(false);
  // Set when the backend's error carries CLAUDE_NOT_INSTALLED_MARKER (see
  // dm.rs's resolve_claude_exe/claude_not_installed_error) — distinguishes
  // "Claude Code CLI isn't installed at all" from the ordinary "installed but
  // not logged in" case, since those need completely different messaging (an
  // install command vs. a login prompt).
  const [claudeNotInstalled, setClaudeNotInstalled] = React.useState(false);
  // Set when even *installing* the CLI can't proceed because Node.js/npm
  // itself isn't present (see dm.rs's node_not_installed_error) — the one
  // remaining case that genuinely needs the user to go do something outside
  // the app, since bundling a full Node runtime is a much bigger commitment
  // than shelling out to npm.
  const [nodeNotInstalled, setNodeNotInstalled] = React.useState(false);
  const [installing, setInstalling] = React.useState(false);
  const pendingConnectResolveRef = React.useRef<((connected: boolean) => void) | null>(null);

  function isClaudeNotInstalledError(e: unknown): boolean {
    const message = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
    return message.includes('CLAUDE_NOT_INSTALLED');
  }

  function isNodeNotInstalledError(e: unknown): boolean {
    const message = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
    return message.includes('NODE_NOT_INSTALLED');
  }

  /** Broader than isClaudeNotInstalledError/isNodeNotInstalledError — catches
   *  every shape of "the `claude` process itself never got a chance to work"
   *  failure (see dm.rs's spawn_claude/run_claude/run_claude_streaming):
   *  couldn't spawn it at all, died before/while we wrote its prompt (the
   *  original "pipe has been ended" bug), or exited non-zero without ever
   *  producing real output. Used as a recovery trigger everywhere a live
   *  `claude` call happens (a DM turn, campaign-lore ingestion, module
   *  ingestion) — previously only campaign CREATION checked connectivity up
   *  front, so a connection that died sometime after that check (or that a
   *  fresh reinstall never had working in the first place) surfaced as a
   *  raw, unhelpful error with no way to fix it from inside the app. NOT
   *  matched: an ordinary "Claude returned an error" from a process that DID
   *  run — that's a real model/content-side error, and offering "reconnect"
   *  for one would be actively misleading. */
  function isClaudeConnectivityError(e: unknown): boolean {
    const message = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
    return (
      message.includes('CLAUDE_NOT_INSTALLED') ||
      message.includes('NODE_NOT_INSTALLED') ||
      message.includes("Couldn't start Claude Code") ||
      message.includes('failed writing prompt') ||
      message.includes('pipe has been ended')
    );
  }

  /** Installs the CLI for the user with one click (see dm.rs's
   *  install_claude_cli) instead of telling them to open a terminal — then,
   *  on success, immediately continues into the same login flow
   *  handleConnectClaude already does, so "Install" reads as one smooth step
   *  rather than "install it yourself, then come back and click Connect too." */
  async function handleInstallClaude() {
    setInstalling(true);
    try {
      await invoke('install_claude_cli');
      setClaudeNotInstalled(false);
      await handleConnectClaude();
    } catch (e) {
      if (isNodeNotInstalledError(e)) {
        setNodeNotInstalled(true);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setInstalling(false);
    }
  }

  async function ensureClaudeConnected(): Promise<boolean> {
    setClaudeNotInstalled(false);
    setNodeNotInstalled(false);
    try {
      if (await invoke<boolean>('check_claude_auth')) return true;
    } catch (e) {
      // Couldn't even run the check (e.g. `claude` not on PATH at all) —
      // still offer the same Connect flow (unless it's the not-installed
      // case, which gets its own dialog content); connect_claude's own
      // error will explain further if that attempt also fails.
      if (isClaudeNotInstalledError(e)) setClaudeNotInstalled(true);
    }
    return new Promise<boolean>((resolve) => {
      pendingConnectResolveRef.current = resolve;
      setConnectPromptOpen(true);
    });
  }

  async function handleConnectClaude() {
    setConnecting(true);
    try {
      const loggedIn = await invoke<boolean>('connect_claude');
      if (!loggedIn) setError('Still not connected — please try again.');
      pendingConnectResolveRef.current?.(loggedIn);
    } catch (e) {
      if (isClaudeNotInstalledError(e)) {
        setClaudeNotInstalled(true);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      pendingConnectResolveRef.current?.(false);
    } finally {
      pendingConnectResolveRef.current = null;
      setConnecting(false);
      setConnectPromptOpen(false);
    }
  }

  function handleCancelConnectClaude() {
    pendingConnectResolveRef.current?.(false);
    pendingConnectResolveRef.current = null;
    setConnectPromptOpen(false);
  }

  const [notesOpen, setNotesOpen] = React.useState(false);
  const [notesText, setNotesText] = React.useState('');
  const [notesSaving, setNotesSaving] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyText, setHistoryText] = React.useState('');
  const [flaggedFactsText, setFlaggedFactsText] = React.useState('');
  const [entitiesText, setEntitiesText] = React.useState('');
  const [locationsText, setLocationsText] = React.useState('');
  // Result of the last manual "Assign NPC voices" click (see
  // handleReconcileNpcVoices) — cleared each time History reopens so a stale
  // result from a previous visit never lingers.
  const [voiceReconcileResult, setVoiceReconcileResult] = React.useState<string | null>(null);
  const [moduleOpen, setModuleOpen] = React.useState(false);
  const [modules, setModules] = React.useState<ModuleSummary[]>([]);
  const [activeModuleId, setActiveModuleId] = React.useState<string | null>(null);
  const [chapters, setChapters] = React.useState<ChapterSummary[]>([]);
  const [currentChapterId, setCurrentChapterId] = React.useState<string | null>(null);
  // Terrain catalog is global (real-world inventory, not tied to any one
  // campaign) — see terrain.rs. Plan mode is per-campaign but read-only/
  // callable any time, not just at session start.
  const [terrainOpen, setTerrainOpen] = React.useState(false);
  const [terrainText, setTerrainText] = React.useState('');
  const [terrainSaving, setTerrainSaving] = React.useState(false);
  // Plan Next Session — merged with battle maps (see campaign.rs's
  // plan_next_session_at + battleMapRender.ts). `planText` is the cached/fresh
  // plan; `planMapCards` are the maps the plan itself owns (one per combat
  // encounter, replaced wholesale on regenerate); `adHocMapCards` are extra
  // "describe one encounter" maps that survive a plan regenerate untouched.
  // `planBusy` covers both the plan/maps LLM calls and any per-card
  // export/save work.
  const [planOpen, setPlanOpen] = React.useState(false);
  const [planText, setPlanText] = React.useState('');
  const [planLoading, setPlanLoading] = React.useState(false);
  const [planBusy, setPlanBusy] = React.useState<string | null>(null);
  /** Step progress for the currently-running plan/maps generation — see
   *  campaign.rs's PlanProgress ("plan-progress" event). `phase` is "plan"
   *  (the single session-plan-text call, nothing to increment mid-call) or
   *  "maps" (done/total combat-encounter maps generated, ticking up in real
   *  completion order). Reset to null whenever a new generate/regenerate
   *  starts, same lifecycle as planBusy. */
  const [planProgress, setPlanProgress] = React.useState<{ phase: string; done: number; total: number } | null>(null);
  /** Live phase + age of an in-flight map generation, re-emitted every ~2s by
   *  the backend (see MapProgress). Its whole job is to prove the thing is
   *  still alive while one silent model call runs for minutes. */
  const [mapProgress, setMapProgress] = React.useState<{ phase: string; elapsed_s: number } | null>(null);
  const [planMapCards, setPlanMapCards] = React.useState<MapCard[]>([]);
  const [adHocMapCards, setAdHocMapCards] = React.useState<MapCard[]>([]);
  // Draw the translucent Enemies/Party start-zones over the map previews. On by
  // default for planning; the DM turns it OFF to print/export a clean map. The
  // flag flows into both the preview render and the PNG/PDF export.
  const [showZones, setShowZones] = React.useState(true);
  // Re-render every loaded card's preview when the toggle flips (no-op on mount
  // while the lists are still empty). Art is already cached from the first load.
  React.useEffect(() => {
    const rerender = (c: MapCard) => ({ ...c, png: battleMapToPngDataUrl(c.spec, 64, c.tiles, c.terrain, showZones) });
    setPlanMapCards((cards) => cards.map(rerender));
    setAdHocMapCards((cards) => cards.map(rerender));
  }, [showZones]);
  const [failedMaps, setFailedMaps] = React.useState<string[]>([]);
  const [packProfile, setPackProfile] = React.useState<PackProfileView | null>(null);
  const [profileEdits, setProfileEdits] = React.useState<ProfileOverrides>({ biomes: {} });
  const [profileBusy, setProfileBusy] = React.useState(false);
  const [profileOpen, setProfileOpen] = React.useState(false);
  const [tileLibraryTotal, setTileLibraryTotal] = React.useState<number | null>(null);
  const [tileLibraryRootCount, setTileLibraryRootCount] = React.useState(0);
  const [tileLibraryBusy, setTileLibraryBusy] = React.useState(false);
  const [mapEncounterHint, setMapEncounterHint] = React.useState('');
  const [modulePlan, setModulePlan] = React.useState('');
  // Lore dialog — view the established campaign_lore.md and fold in new
  // material any time after creation (a sourcebook picked up mid-campaign, a
  // later plot decision), not just once at creation. Uses moduleBusy/
  // moduleBusyLabel for its busy state — same "one-shot Opus call, could take
  // a while" shape as the module-import flow, so it gets the same ticker.
  const [loreOpen, setLoreOpen] = React.useState(false);
  const [loreText, setLoreText] = React.useState('');
  const [loreAddition, setLoreAddition] = React.useState('');
  const [pendingLoreUpdateFile, setPendingLoreUpdateFile] = React.useState<{ name: string; text: string } | null>(null);
  // Result of the last manual "Personalize campaign hooks" click (see
  // handleReconcileCampaignHooks) — cleared each time the Lore dialog reopens
  // so a stale result from a previous visit never lingers.
  const [campaignHooksResult, setCampaignHooksResult] = React.useState<string | null>(null);

  const sessionIdRef = React.useRef<string | undefined>(undefined);
  const processingRef = React.useRef(false);
  const queueRef = React.useRef<PlayerTurn[]>([]);
  const partyRef = React.useRef(party);
  partyRef.current = party;
  // dm-player-turn's listener is registered once (mount) and would otherwise
  // close over a stale activeCampaignId — mirror it into a ref like partyRef.
  const campaignIdRef = React.useRef(activeCampaignId);
  campaignIdRef.current = activeCampaignId;
  // Mirrors activeModuleId for the same reason campaignIdRef exists — runTurn
  // can fire from a listener registered once at mount (drainQueue) and would
  // otherwise close over a stale value. Also lets resolveChapterSection
  // capture whatever module was active at the moment it's dispatched, rather
  // than racing a later switchActiveModule (see campaign.rs's
  // trim_resolved_chapter_section_at doc comment for why that matters).
  const activeModuleIdRef = React.useRef(activeModuleId);
  activeModuleIdRef.current = activeModuleId;
  // Mirrors dmProvider for the campaign-switch effect below, which needs to
  // read the CURRENT provider at the moment a campaign is picked, not react
  // to the provider changing on its own — listing dmProvider as a dependency
  // would re-run the whole (expensive) DM-rules/plan/party sync every time
  // someone just toggles Claude/Local mid-campaign.
  const dmProviderRef = React.useRef(dmProvider);
  dmProviderRef.current = dmProvider;
  // The active campaign's module/plan.md, fetched once per campaign switch —
  // NOT re-read every turn (see dmPrompt.ts's planCheckIn doc comment for why).
  // Starts each sitting/campaign "due" (Infinity) so the very first turn
  // includes it; reset to due again on a chapter change or a new sitting.
  const campaignPlanRef = React.useRef('');
  const turnsSincePlanCheckRef = React.useRef(Infinity);
  // Holds a past session's full verbatim record between the turn the DM asks
  // for it (recallSession dm-action) and the next turn, where buildTurnPrompt
  // injects it once and clears this. Null the vast majority of the time.
  const pendingRecalledSessionRef = React.useRef<{ id: string; record: string } | null>(null);
  // Same one-shot pattern for a battle map the DM asked to pull up (recallMap
  // dm-action) — the full spec is injected into the next turn once, then cleared.
  const pendingRecalledMapRef = React.useRef<{ slug: string; spec: string } | null>(null);
  // name (lowercased) → voice assignment for this campaign's NPCs (see
  // campaign.rs's npc_voices.json) — fetched once per campaign switch, same
  // "not re-read every turn" shape as campaignPlanRef, and updated locally
  // the instant a turn's rememberEntity assigns a new one (see runTurn) so
  // that NPC's voice is usable on their very next line without waiting for a
  // re-fetch. Field names mirror campaign.rs's NpcVoiceAssignment struct
  // as-is (snake_case) — no serde rename_all anywhere in this codebase, same
  // convention as ChapterizeImportResult's module_id/module_title.
  const npcVoicesRef = React.useRef<Record<string, NpcVoiceEntry>>({});
  /** Tag → auto-minted voice for unnamed walk-on NPCs (see
   *  resolveEphemeralVoice). In-memory only, cleared on campaign switch; these
   *  are deliberately never persisted to npc_voices.json. */
  const ephemeralVoicesRef = React.useRef<Record<string, NpcVoiceEntry>>({});
  /** The narrator-voiced prose most recently spoken this turn, used as a
   *  last-resort gender signal for an NPC whose tag carries none (see
   *  resolveEphemeralVoice). Trimmed to the last NARRATION_GENDER_WINDOW chars
   *  so a gendered noun from several beats ago can't misattribute a voice. */
  const recentNarrationRef = React.useRef('');
  /** Which branch of resolveVoiceAssignment produced the last voice, for
   *  voice_debug.log. Set by the resolver, read by enqueueSentence. */
  const resolveSourceRef = React.useRef('');
  /** One line per spoken sentence this turn, flushed to voice_debug.log when
   *  the turn ends. Records the state machine's INPUTS (raw tag, sticky
   *  speaker, quote parity) beside its output, so a wrong voice at the table
   *  traces back to the exact sentence and branch that caused it. */
  const voiceDebugRef = React.useRef<string[]>([]);
  /** The last NPC the DM explicitly tagged this turn, and whether the sticky
   *  speaker was cleared by the automatic quote-aware revert (as opposed to an
   *  explicit `[Narrator]:`). Together these let a dialogue line that resumes
   *  without a tag return to its speaker — see enqueueSentence. */
  const lastTaggedSpeakerRef = React.useRef<string | null>(null);
  const autoRevertedRef = React.useRef(false);
  // State mirror of npcVoicesRef, purely so the History dialog's voice-
  // preview/override panel re-renders when an assignment changes — the ref
  // above stays the source of truth for the hot playback path (enqueueSentence
  // reads a ref, not state, to avoid a re-render on every spoken line).
  const [npcVoices, setNpcVoices] = React.useState<Record<string, NpcVoiceEntry>>({});
  // Per-NPC-name pending edits in the voice-override panel, keyed the same
  // way as npcVoices (lowercased name) — separate from npcVoices itself so
  // an in-progress edit isn't clobbered by an unrelated npcVoices refresh
  // (e.g. a live turn assigning some other NPC's voice) before it's saved.
  const [voiceEdits, setVoiceEdits] = React.useState<Record<string, { voiceId: string; pitch: string; speed: string }>>({});
  // Which row's Preview button is currently playing (disables that button
  // and prevents overlapping playback) — null when nothing's previewing.
  const [previewingKey, setPreviewingKey] = React.useState<string | null>(null);
  // The Active Battle Log for the current encounter — full combat state (round,
  // initiative, per-combatant status, positions, environment) held here as
  // ground truth, NOT stored in Character and NOT persisted to disk (per-sitting;
  // only the outcome is saved, on endBattle). The DM updates it via the
  // `battleLog`/`removeCombatant` dm-actions (merged by applyBattleLog) and
  // `endBattle`; it's fed back every turn via dmPrompt.ts's battleLogStatusText
  // so a long fight can't lose state when the model's context compacts.
  const [battleLog, setBattleLog] = React.useState<BattleLog | null>(null);
  const battleLogRef = React.useRef(battleLog);
  battleLogRef.current = battleLog;
  // The campaign's positioning style (theater / grid / hex), loaded per campaign
  // from the backend (read_battle_mode) and sent to the DM every turn. Ref so
  // runTurn/drainQueue (which close over refs, not state) read the live value.
  const [battleMode, setBattleMode] = React.useState<BattleMode>('theater');
  const battleModeRef = React.useRef(battleMode);
  battleModeRef.current = battleMode;

  // Streamed-narration playback pipeline (see dm.rs's run_claude_streaming
  // and the dm-narration-chunk event it emits). Claude's reply streams in
  // incrementally; as complete sentences accumulate we speak each one right
  // away instead of waiting for the whole reply, so TTS/playback for earlier
  // sentences overlaps with Claude still generating later ones. Local LLM
  // turns never emit chunks (see local_llm.rs — that path isn't streamed),
  // so streamedAnyChunkRef staying false is exactly how runTurn knows to
  // fall back to speaking the whole final narration in one shot, same as
  // before this pipeline existed.
  const narrationBufferRef = React.useRef('');
  const streamedAnyChunkRef = React.useRef(false);
  const sentenceQueueRef = React.useRef<{ text: string; voiceId?: string; pitch?: string; speed?: number }[]>([]);
  const drainingPromiseRef = React.useRef<Promise<void> | null>(null);
  // The speaker whose `[Name]:` tag was seen most recently within the current
  // narration — the voice cue is now STICKY across sentences (see
  // enqueueSentence). Reset to null at the start of every fresh narration (a
  // new turn or a replay) so a speech that trailed the previous turn never
  // bleeds into the next one's opening narration.
  const currentSpeakerRef = React.useRef<string | null>(null);
  // Whether we're currently inside an open quote (odd number of double-quote
  // marks seen so far this narration). Lets a sticky NPC voice auto-revert to
  // the narrator once the NPC's quoted speech closes and plain prose follows,
  // even if the DM forgot the explicit `[Narrator]:` tag — see enqueueSentence.
  const quoteOpenRef = React.useRef(false);
  // Set whenever the currently in-flight turn gets cut short — either a
  // player barging in mid-narration (handleTalkToggle) or the console tearing
  // down the current turn outright (stopSpeakingAndClearQueue, called from
  // End session / campaign switch). Reset to false at the top of every new
  // runTurn call. Checked by the dm-narration-chunk listener (stop turning
  // further chunks into spoken sentences) and by runTurn's own tail (treat
  // the interrupted turn's outcome as void — never spoken, never applied to
  // party/memory state, since the player signalled "that's not what's
  // happening" by cutting in before it finished).
  const suppressNarrationRef = React.useRef(false);
  // Sentences of the current turn that actually FINISHED playing aloud —
  // reset at the top of every runTurn. This is the ground truth for "what
  // did the table hear" when a barge-in cuts a reply short: Claude's own
  // session history keeps everything it generated, but the players only
  // heard up to wherever playback got — see interruptedTurnRef below and
  // dmPrompt.ts's `interruption` note for how the gap gets reconciled.
  const spokenThisTurnRef = React.useRef<string[]>([]);
  // Set at barge-in time (handleTalkToggle's busy branch) with what had been
  // heard; consumed (and cleared) by the NEXT runTurn, which passes it into
  // buildTurnPrompt so Claude knows exactly how much of its cut-off reply
  // ever reached the players' ears.
  const interruptedTurnRef = React.useRef<{ heard: string } | null>(null);
  // The most recently completed DM turn's raw narration — `[Name]:` speech
  // tags intact (not the display-stripped version shown in the transcript),
  // so "Replay last response" (see handleReplayLastResponse) can re-run it
  // through enqueueSentence and get the same per-NPC voices as the original,
  // not everything flattened onto the narrator. Purely local re-synthesis via
  // Piper — no Claude call, so replaying costs zero tokens. Only ever set for
  // a turn that actually completed (see runTurn's suppressNarrationRef guard
  // above it) — an interrupted, never-fully-delivered reply never overwrites
  // whatever the last real one was.
  const lastDmNarrationRef = React.useRef('');

  /** Resolves a `[Name]:` speech tag to its stored voice assignment.
   *  npc_voices.json keys off the NPC's *full* name as given to rememberEntity
   *  (e.g. "gundren rockseeker"), but BASE_CLAUDE_MD's own worked example tags
   *  dialogue with just the first name (`[Gundren]:`) — an exact-key-only
   *  lookup would silently miss every such tag and fall back to the narrator
   *  voice, defeating the feature for what's actually the natural, common
   *  case. Falls back to matching the tag against any individual word of a
   *  stored key (not just the first) when there's no exact match — plenty of
   *  natural NPC names lead with a title/descriptor rather than the name
   *  itself ("Old Xoblob", "Sister Garaele", "Captain Harbin"), and Claude
   *  reasonably tags dialogue with the NPC's actual name, not whichever word
   *  happens to come first in the stored key. A first-word-only match would
   *  silently and PERMANENTLY miss every such NPC, every single time they
   *  spoke, since the mismatch never resolves itself turn to turn.
   *
   *  That word-match must be UNIQUE across the whole roster before it's
   *  trusted. Common title words ("Sister", "Captain", "Old", ...) are
   *  exactly the words most likely to be shared by two unrelated NPCs — an
   *  any-match-wins lookup would silently pick whichever of them happened to
   *  be inserted first into npc_voices.json, which reads to a player as the
   *  wrong (and sometimes wrong-gender) voice firing at effectively random
   *  moments. An ambiguous tag falls back to the narrator voice instead of
   *  guessing — a plain, predictable miss beats an occasional wrong guess. */
  function resolveVoiceAssignment(speaker: string | null, genderHint: 'male' | 'female' | null = null): NpcVoiceEntry | undefined {
    if (!speaker) { resolveSourceRef.current = 'narration'; return npcVoicesRef.current[NARRATOR_VOICE_KEY]; }
    const key = speaker.trim().toLowerCase();
    // Explicit `[Narrator]:` tag (the DM's way of ending a sticky NPC speech
    // and returning to narration mid-turn — see enqueueSentence) resolves to
    // the very same narrator entry plain untagged narration does, so a custom
    // narrator-voice override is honored either way.
    if (key === 'narrator') { resolveSourceRef.current = 'explicit-narrator'; return npcVoicesRef.current[NARRATOR_VOICE_KEY]; }
    if (npcVoicesRef.current[key]) { resolveSourceRef.current = 'assigned'; return npcVoicesRef.current[key]; }
    const wordMatches = Object.entries(npcVoicesRef.current).filter(([storedKey]) => storedKey.split(' ').includes(key));
    if (wordMatches.length === 1) { resolveSourceRef.current = 'word-match'; return wordMatches[0][1]; }
    // Several stored NPCs share this word — a real named NPC we can't
    // disambiguate, NOT an unnamed walk-on, so don't mint a voice for them.
    // (This branch used to `return undefined`, which the comment above called
    // "the narrator voice" but which tts.rs actually resolves to af_heart —
    // see resolveEphemeralVoice. Now it really is the narrator's voice.)
    if (wordMatches.length > 1) {
      console.warn(`Ambiguous NPC voice tag "${speaker}" matches ${wordMatches.length} entries; using narrator voice.`);
      resolveSourceRef.current = 'AMBIGUOUS->narrator';
      return npcVoicesRef.current[NARRATOR_VOICE_KEY];
    }
    return resolveEphemeralVoice(speaker, genderHint);
  }

  /** An unnamed walk-on the DM tagged but never `rememberEntity`'d, so it has
   *  no npc_voices.json entry (BASE_CLAUDE_MD tells it not to bother giving a
   *  permanent voice to someone with one throwaway line). Returning undefined
   *  here used to send `voiceId: undefined` to tts.rs, whose
   *  `voice_id.unwrap_or(DEFAULT_VOICE_ID)` picks the catalog's `"narrator"`
   *  id — `af_heart`, a FEMALE voice, and NOT the campaign's configured
   *  narrator override. Observed at the table: an old man and a woman in one
   *  scene both spoke in that same stock female voice, matching neither each
   *  other's gender nor the (correct, dark, low) narration around them.
   *
   *  So mint a voice from the tag's own words instead, cached per session and
   *  never written to npc_voices.json — the same "don't persist throwaways"
   *  invariant that keeps them out of entities.md. A tag with no gender signal
   *  (`[Innkeeper]:`) deliberately gets the narrator's voice rather than a
   *  coin flip: BASE_CLAUDE_MD calls a wrong-gender voice the single most
   *  jarring mistake this system can make. */
  function resolveEphemeralVoice(speaker: string, genderHint: 'male' | 'female' | null): NpcVoiceEntry | undefined {
    const key = speaker.trim().toLowerCase();
    const cached = ephemeralVoicesRef.current[key];
    if (cached) { resolveSourceRef.current = 'ephemeral-cached'; return cached; }
    const taken = new Set<string>();
    for (const a of Object.values(npcVoicesRef.current)) taken.add(a.voice_id);
    for (const a of Object.values(ephemeralVoicesRef.current)) taken.add(a.voice_id);
    // Tag first (`[Ismark|male]:`, or a descriptive `[Old Man]:`), then the
    // narration that just introduced them — the DM reliably writes "an old man
    // shuffles from the pews" a beat before he speaks, even on the turns it
    // forgets the marker. That last resort demands unanimity (inferGenderStrict),
    // so a two-NPC introduction naming both a woman and her brother declines to
    // guess instead of coin-flipping on a majority.
    const fromTag = pickEphemeralVoice(speaker, taken, genderHint);
    const fromNarration = fromTag ? null : pickEphemeralVoice(speaker, taken, inferGenderStrict(recentNarrationRef.current));
    const voiceId = fromTag ?? fromNarration;
    if (!voiceId) {
      console.warn(`No assigned voice and no gender signal for tag "${speaker}"; using narrator voice.`);
      resolveSourceRef.current = 'NO-SIGNAL->narrator';
      return npcVoicesRef.current[NARRATOR_VOICE_KEY];
    }
    resolveSourceRef.current = fromTag ? (genderHint ? 'ephemeral-marker' : 'ephemeral-tagwords') : 'ephemeral-narration';
    const entry: NpcVoiceEntry = { voice_id: voiceId };
    ephemeralVoicesRef.current = { ...ephemeralVoicesRef.current, [key]: entry };
    return entry;
  }

  /** Picks a permanent voice for an NPC the DM remembered but gave no
   *  `voiceId`. Gender comes from their name + description together, since a
   *  bare name carries no signal but the description almost always does ("a
   *  young woman", "the old priest, he..."). Returns null when even that is
   *  genderless — better an unvoiced NPC (who speaks as the narrator) than a
   *  permanently wrong-gender one, and the manual override panel and
   *  reconcile_npc_voices both remain available to fix them. Skips NPCs who
   *  already have a voice so a re-sent rememberEntity can't churn it. */
  function autoAssignVoiceId(name: string, description: string): string | null {
    const key = name.trim().toLowerCase();
    if (npcVoicesRef.current[key]) return null;
    // If this NPC already spoke this turn under a tag, they were given an
    // ephemeral voice — keep it. The tag ("Ireena") and the remembered name
    // ("Ireena Kolyana") hash differently, so minting a fresh voice here would
    // make the same NPC audibly change voice between the turn that introduced
    // them and the next one.
    const spokenAs = ephemeralVoicesRef.current[key] ?? findEphemeralByNamePart(key);
    if (spokenAs) return spokenAs.voice_id;
    const gender = inferGender(`${name} ${description}`);
    if (!gender) {
      console.warn(`No gender signal in "${name}"'s description; leaving unvoiced.`);
      return null;
    }
    const taken = new Set<string>();
    for (const a of Object.values(npcVoicesRef.current)) taken.add(a.voice_id);
    for (const a of Object.values(ephemeralVoicesRef.current)) taken.add(a.voice_id);
    return pickVoiceForGender(gender, name, taken);
  }

  /** An ephemeral voice minted under a short tag ("ireena") that belongs to a
   *  longer remembered name ("ireena kolyana"). Requires a UNIQUE match, on
   *  the same reasoning as resolveVoiceAssignment's word-match: two NPCs
   *  sharing a word must not silently inherit each other's voice. */
  function findEphemeralByNamePart(fullNameKey: string): NpcVoiceEntry | undefined {
    const nameWords = new Set(fullNameKey.split(' '));
    const hits = Object.entries(ephemeralVoicesRef.current).filter(([tagKey]) =>
      tagKey.split(' ').every((w) => nameWords.has(w))
    );
    return hits.length === 1 ? hits[0][1] : undefined;
  }

  function enqueueSentence(sentence: string) {
    const { speaker, text, genderHint } = parseSpeakerTag(sentence);
    // Sticky voice cue: a `[Name]:` tag applies to its own sentence AND every
    // following untagged sentence until the next tag, instead of each untagged
    // sentence silently reverting to the narrator. The old per-sentence
    // behavior required the DM to repeat `[Name]:` on every single sentence of
    // a multi-sentence speech; when it didn't (the common case), an NPC's
    // continuation sentences dropped onto the narrator voice mid-speech — an
    // NPC could sound half-themselves, half-narrator within one line. The DM
    // returns to narration with an explicit `[Narrator]:` tag (see
    // BASE_CLAUDE_MD); currentSpeakerRef is also reset to null at the start of
    // each fresh narration so a trailing NPC line never carries into the next
    // turn's opening prose.
    if (speaker !== null) {
      currentSpeakerRef.current = speaker;
      autoRevertedRef.current = false;
      if (speaker.toLowerCase() !== 'narrator') lastTaggedSpeakerRef.current = speaker;
    } else if (currentSpeakerRef.current && currentSpeakerRef.current.toLowerCase() !== 'narrator') {
      // No tag on this sentence and a non-narrator NPC is sticky. If the NPC's
      // quoted speech has ended — we're not mid-quote AND this sentence doesn't
      // OPEN with a quote — it's almost certainly narration the DM resumed
      // without the explicit `[Narrator]:` tag, so revert to the narrator
      // rather than voicing the description as the NPC.
      //
      // The test is "opens with a quote", not "contains one": prose routinely
      // quotes a word mid-sentence (`the word "mist" hung between them`), and a
      // contains-check let that block the revert, leaving narration in the
      // NPC's voice.
      if (!quoteOpenRef.current && !opensWithQuote(sentence)) {
        currentSpeakerRef.current = null;
        autoRevertedRef.current = true;
      }
    } else if (
      currentSpeakerRef.current === null &&
      autoRevertedRef.current &&
      lastTaggedSpeakerRef.current &&
      opensWithQuote(sentence)
    ) {
      // Dialogue resuming without a tag. The DM reliably writes an NPC's block
      // as `[Carrow]: "..." He rises from the pews. "..."` — tagging only the
      // first line. The revert above correctly hands the narration beat back to
      // the narrator, but before this branch existed nothing could hand the
      // NEXT quoted line back to Carrow, so an NPC's voice fired exactly once
      // per turn and every later line of theirs spoke as the narrator.
      //
      // Only fires when the revert was AUTOMATIC: if the DM explicitly said
      // `[Narrator]:`, it meant it, and a quoted line after that stays
      // narration (someone reading an inscription aloud, say). And only when
      // the sentence OPENS with a quote — mid-sentence quotes in real prose
      // ("the sign read \"turn back\"") must not hijack a voice.
      currentSpeakerRef.current = lastTaggedSpeakerRef.current;
    }
    // Advance the running mid-quote state (an odd count flips it) so the next
    // sentence knows whether it's still inside the NPC's quoted speech.
    if (countDoubleQuotes(sentence) % 2 === 1) quoteOpenRef.current = !quoteOpenRef.current;
    if (!text.trim()) return;
    // The hint only rides the sentence that carried the tag. Continuation
    // sentences of the same speech resolve by name against the ephemeral cache
    // that first sentence populated, so the DM never has to repeat it.
    // Read AFTER this sentence flips parity — the revert check above used the
    // pre-flip value, so label it honestly.
    const quoteOpenPost = quoteOpenRef.current;
    resolveSourceRef.current = '';
    const assignment = resolveVoiceAssignment(currentSpeakerRef.current, genderHint);
    voiceDebugRef.current.push(
      `  tag=${speaker === null ? '(none)' : JSON.stringify(speaker)}` +
        ` hint=${genderHint ?? '-'}` +
        ` sticky=${currentSpeakerRef.current ?? '(narrator)'}` +
        ` quoteOpenPost=${quoteOpenPost}` +
        ` -> voice=${assignment?.voice_id ?? 'undefined(af_heart)'}` +
        ` src=${resolveSourceRef.current || '?'}` +
        ` | ${text.trim().slice(0, 60)}`
    );
    // Record narration AFTER resolving, never before: this sentence's own text
    // must not be a gender signal for the speaker it introduces (an NPC line
    // is full of "he"/"she" spoken BY that NPC about someone else). Only
    // narrator-voiced prose counts.
    const speakingAsNarrator = !currentSpeakerRef.current || currentSpeakerRef.current.toLowerCase() === 'narrator';
    if (speakingAsNarrator) {
      recentNarrationRef.current = (recentNarrationRef.current + ' ' + text).slice(-NARRATION_GENDER_WINDOW);
    }
    sentenceQueueRef.current.push({ text, voiceId: assignment?.voice_id, pitch: assignment?.pitch, speed: assignment?.speed });
    if (!drainingPromiseRef.current) {
      drainingPromiseRef.current = (async () => {
        // Pipelines synthesis with playback: previously each iteration
        // awaited speak() (synthesize THEN play) before even starting the
        // next one, so line N+1's synthesis never began until line N
        // finished PLAYING — an audible gap on every sentence transition,
        // not just at voice switches. Here, whichever item's audio was
        // already prepared by the PREVIOUS iteration's lookahead gets
        // played immediately (or prepared fresh, for the very first item),
        // and the item after that starts preparing in parallel with this
        // item's playback — so by the time playback ends, the next line is
        // usually already sitting ready.
        let prepared: PreparedSpeech | null = null;
        while (sentenceQueueRef.current.length > 0) {
          const next = sentenceQueueRef.current.shift()!;
          const current = prepared ?? (await prepareSpeech(next.text, next.voiceId, next.pitch, next.speed));
          prepared = null;

          const upcoming = sentenceQueueRef.current[0];
          const lookahead = upcoming ? prepareSpeech(upcoming.text, upcoming.voiceId, upcoming.pitch, upcoming.speed) : null;

          await playPrepared(current);
          // Only count a sentence as "heard" if it wasn't the one force-cut
          // mid-play by an interruption (stopSpeaking force-resolves the
          // pending playPrepared(), but suppressNarrationRef is already set
          // by then).
          if (!suppressNarrationRef.current) spokenThisTurnRef.current.push(next.text);

          if (lookahead) {
            const result = await lookahead;
            // A barge-in (stopSpeakingAndClearQueue) replaces the queue array
            // outright, so `upcoming` — captured from the OLD array — no
            // longer matches what's actually next (or there's nothing next
            // at all) once that's happened. Using a stale lookahead result
            // for whatever's next now would attach the wrong line's audio to
            // it, so discard it instead and let the next loop iteration
            // prepare fresh.
            if (sentenceQueueRef.current[0] === upcoming) {
              prepared = result;
            } else {
              discardPrepared(result);
            }
          }

          // A deliberate beat before the next line — see SENTENCE_GAP_MS's
          // doc comment. Skipped when the queue's already empty (either
          // nothing left to say, or a barge-in just cleared it), so this
          // never adds trailing dead air after the last sentence of a turn.
          if (sentenceQueueRef.current.length > 0) await sleep(SENTENCE_GAP_MS);
        }
        drainingPromiseRef.current = null;
      })();
    }
  }

  /** Re-reads campaign_lore.md + the active module's plan.md into
   *  campaignPlanRef. This ref is the ONLY channel by which either file reaches
   *  the live DM (neither is a standing CLAUDE.md import — see dmPrompt.ts's
   *  planCheckIn), so it has to be refreshed at every point those files change
   *  or the DM keeps being handed a stale blend for the rest of the sitting:
   *  a module switch would inject the PREVIOUS module's arc plan alongside the
   *  new module's chapter text, and a freshly-created campaign would go its
   *  entire first session with an empty ref (which also suppresses check-ins
   *  outright, since dueForPlanCheck requires non-empty text).
   *  Takes the id explicitly rather than reading activeCampaignId, so callers
   *  that already captured an id can't race a campaign switch into writing some
   *  other campaign's plan into the ref. */
  async function refreshCampaignPlan(campaignId: string) {
    const plan = await invoke<string>('read_campaign_plan', { id: campaignId }).catch((e) => {
      console.warn('Failed to re-read the campaign plan:', e);
      return null;
    });
    if (plan !== null && campaignIdRef.current === campaignId) campaignPlanRef.current = plan;
  }

  React.useEffect(() => {
    turnsSincePlanCheckRef.current = Infinity;
    // Walk-on voices are scoped to the campaign that minted them — a tag like
    // "[Old Man]:" means a different person in a different campaign.
    ephemeralVoicesRef.current = {};
    if (!activeCampaignId) {
      campaignPlanRef.current = '';
      npcVoicesRef.current = {};
      setNpcVoices({});
      setBattleMode('theater');
      return;
    }
    // Refresh the campaign's generated DM rules (memory/dm_rules.md) before
    // anything warms the DM session. CLAUDE.md is written once at creation and
    // never rewritten, so without this an old campaign never sees rule changes
    // shipped after the day it was made — which is exactly how the `|male`
    // speaker-tag marker failed to reach a live campaign through three builds.
    invoke('sync_dm_rules', { id: activeCampaignId }).catch((e) =>
      console.warn('Failed to sync DM rules:', e)
    );
    // Cleared BEFORE the refresh, not just on failure: a read that errors must
    // not leave the previous campaign's lore/plan sitting in the ref to be
    // injected into this campaign's turns.
    campaignPlanRef.current = '';
    refreshCampaignPlan(activeCampaignId);
    // The campaign's saved positioning style (defaults to theater for any
    // campaign that predates this feature — see campaign.rs's read_battle_mode).
    invoke<string>('read_battle_mode', { id: activeCampaignId })
      .then((mode) => { if (isBattleMode(mode)) setBattleMode(mode); })
      .catch(() => { setBattleMode('theater'); });
    invoke<Record<string, NpcVoiceEntry>>('read_npc_voices', { id: activeCampaignId })
      .then((voices) => {
        npcVoicesRef.current = voices;
        setNpcVoices(voices);
      })
      .catch(() => { npcVoicesRef.current = {}; setNpcVoices({}); });

    // Sync everyone already at the table into this campaign's party.md —
    // characters are often pushed over LAN before the campaign gets picked
    // (or were pushed while a different campaign was active), and the
    // per-push sync in the dm-party-character listener no-ops without an
    // active campaign, so this catch-up is what guarantees the DM knows the
    // whole table's backstories regardless of join-vs-select order.
    partyRef.current.forEach(syncPartyMemberToCampaign);

    // Fire-and-forget: pays turn 1's real extra cold-start cost (live-
    // measured ~11s to first spoken word vs ~3-4s steady-state) the moment a
    // campaign is picked, not when the player actually starts talking — see
    // dm.rs's warmup_dm_session doc comment. Claude-only; the local LLM path
    // has no equivalent prompt-cache cold start to warm.
    if (dmProviderRef.current === 'claude') {
      ensureClaudeConnected().then((connected) => {
        if (!connected) return;
        invoke('warmup_dm_session', { campaignId: activeCampaignId }).catch((e) =>
          console.warn('DM session warmup failed (first turn will just be slower):', e)
        );
        // Backfill a voice for any NPC in entities.md that doesn't have one yet
        // — one the DM introduced live but never voiced, or a manually-added
        // entity (see the History dialog's editable entities.md). Without this,
        // such an NPC keeps speaking in the narrator's voice until the DM
        // happens to run "Assign NPC voices" or ends a session. This is the
        // same reconciliation pass End Session already runs, just also fired on
        // load; it's a FREE no-op unless there's a genuinely unvoiced NPC (the
        // Rust side early-returns without any Opus call when none are missing —
        // see reconcile_npc_voices_at), so it costs nothing in steady state.
        invoke<number>('reconcile_npc_voices', { id: activeCampaignId })
          .then((assigned) => {
            // Only refresh if it actually assigned something AND the user
            // hasn't switched campaigns out from under this async call — a
            // stale refresh would clobber the now-active campaign's voices.
            if (assigned > 0 && campaignIdRef.current === activeCampaignId) {
              invoke<Record<string, NpcVoiceEntry>>('read_npc_voices', { id: activeCampaignId })
                .then((voices) => {
                  if (campaignIdRef.current === activeCampaignId) { npcVoicesRef.current = voices; setNpcVoices(voices); }
                })
                .catch(() => {});
            }
          })
          .catch((e) => console.warn('NPC voice auto-reconcile on load failed (unvoiced NPCs use the narrator until End Session):', e));
      });
    }
    // ensureClaudeConnected is a plain function redefined every render (not
    // useCallback-wrapped) — deliberately not a reactive dependency here,
    // same reasoning as dmProviderRef above: this effect calls whatever it
    // currently resolves to at campaign-switch time, and doesn't need (or
    // want) to re-run just because that reference changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCampaignId]);

  // Start the LAN listener + resolve this machine's LAN IP once, on mount.
  React.useEffect(() => {
    invoke<number>('start_party_listener', { port: DM_PORT }).catch((e) =>
      setError(`Couldn't start the LAN listener: ${e}`)
    );
    invoke<string | null>('local_lan_ip').then(setLanIp).catch(() => setLanIp(null));
    warmupSTT().then(() => setSttReady(true)).catch((e) => setError(`Speech recognition failed to load: ${e.message || e}`));
    invoke<CampaignMeta[]>('list_campaigns').then(setCampaigns).catch((e) => setError(`Couldn't load campaigns: ${e}`));
    // Decodes battle-map tile art once up front so the first real map render
    // (which is synchronous — see battleMapRender.ts) already has it cached,
    // and applies whichever style the user last picked (persisted setting).
    preloadBattleTileSprites();
    setActiveTileStyle(battleTileStyle as TileStyleId);
    // Sync the Rust engine selection to the persisted setting, THEN warm that
    // engine ahead of the first real turn so it doesn't also pay the one-time
    // spawn (+ first-ever model download, or F5's ~16s model-load) cost.
    // Chained so warmup always sees the right engine.
    invoke('set_tts_engine', { engine: useSettingsStore.getState().ttsEngine })
      .catch(() => {})
      .finally(() => {
        invoke('warmup_tts').catch((e) => console.warn('TTS warmup failed (will retry on first use):', e));
      });
  }, []);

  // F5 voice engine: probe the GPU (gates the enable control), check whether the
  // runtime is already installed, and subscribe to install-progress events.
  React.useEffect(() => {
    invoke<CudaInfo | null>('probe_cuda').then(setCudaInfo).catch(() => setCudaInfo(null));
    invoke<boolean>('f5_runtime_installed').then(setF5Installed).catch(() => setF5Installed(false));
    const unlisten = listen<{ phase: string; downloaded: number; total: number }>(
      'f5-install-progress',
      (e) => {
        setF5Progress(e.payload);
        if (e.payload.phase === 'done') setF5Installed(true);
      }
    );
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Plan Next Session / module ingestion step progress — same event/listen
  // pattern as f5-install-progress just above, two separate events since
  // each operation's phases are its own vocabulary (see campaign.rs's
  // PlanProgress/IngestProgress).
  React.useEffect(() => {
    const unlistenPlan = listen<{ phase: string; done: number; total: number }>('plan-progress', (e) => setPlanProgress(e.payload));
    const unlistenIngest = listen<{ phase: string; done: number; total: number }>('ingest-progress', (e) => setIngestProgress(e.payload));
    // Map generation re-emits on a timer while it works, so a climbing
    // elapsed_s is visible proof it hasn't hung during the one long, silent
    // model call. 'done' clears it.
    const unlistenMap = listen<{ phase: string; elapsed_s: number }>('map-progress', (e) =>
      setMapProgress(e.payload.phase === 'done' ? null : e.payload)
    );
    return () => {
      unlistenPlan.then((f) => f());
      unlistenIngest.then((f) => f());
      unlistenMap.then((f) => f());
    };
  }, []);

  /** Queries local_llm.rs's /v1/models proxy for the DM Model dialog's model
   *  dropdown. Called on demand (dialog open, Refresh click) rather than on
   *  page mount, so an idle DM Console never pings a local server that may
   *  not even be running. */
  async function refreshLocalModels() {
    setLocalModelsLoading(true);
    setLocalModelsError(null);
    try {
      const models = await invoke<string[]>('list_local_llm_models', { baseUrl: localLlmBaseUrl });
      setLocalModels(models);
    } catch (e) {
      setLocalModels([]);
      setLocalModelsError(String(e));
    } finally {
      setLocalModelsLoading(false);
    }
  }

  React.useEffect(() => {
    if (dmModelOpen) refreshLocalModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dmModelOpen]);

  /** Whether this machine's GPU clears the bar to even offer F5 (see probe_cuda
   *  + F5_MIN_VRAM_MB). Below it, the F5 option is shown but disabled. */
  const f5Capable = cudaInfo != null && cudaInfo.vram_mb >= F5_MIN_VRAM_MB;

  /** Confirmed download → install the F5 runtime (with progress), then flip the
   *  engine to F5 and mirror it to Rust. One-way: there's no UI path back to
   *  Kokoro once this succeeds (see useSettingsStore's ttsEngine). install is
   *  idempotent, so if the runtime's already present this just flips the engine. */
  const handleConfirmInstallF5 = async () => {
    setF5ConfirmOpen(false);
    setF5Installing(true);
    setF5Progress(null);
    setError(null);
    try {
      await invoke('install_f5_runtime');
      setF5Installed(true);
      setTtsEngine('f5');
      await invoke('set_tts_engine', { engine: 'f5' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Couldn't install the high-quality voice engine: ${message}`);
    } finally {
      setF5Installing(false);
      setF5Progress(null);
    }
  };

  /** Detects a campaign that was curated with HD archetype voices (tts.rs's
   *  ARCHETYPE_VOICES) — e.g. imported from a table that had the engine
   *  enabled — landing on a machine that isn't using it yet. Never
   *  auto-enables: F5 is a ~4 GB, GPU-gated, one-way download, so this only
   *  *offers* it (via the existing confirm-download modal) once per campaign
   *  per app session, gated on this machine actually being capable at all —
   *  no point prompting for a feature the hardware can't run. */
  React.useEffect(() => {
    if (!activeCampaignId || ttsEngine === 'f5' || !f5Capable) return;
    if (hdPromptedRef.current.has(activeCampaignId)) return;
    hdPromptedRef.current.add(activeCampaignId);
    invoke<number>('campaign_archetype_voice_count', { id: activeCampaignId })
      .then((count) => {
        if (count > 0 && campaignIdRef.current === activeCampaignId) {
          setHdPromptCount(count);
          setHdPromptOpen(true);
        }
      })
      .catch(() => {});
  }, [activeCampaignId, ttsEngine, f5Capable]);

  /** Mirrors one character's identity/backstory into the active campaign's
   *  memory/party.md (see buildPartyMemberSummary + campaign.rs's
   *  upsert_party_member). Best-effort fire-and-forget: a failed write just
   *  means the DM is missing that character's backstory until the next push,
   *  never worth blocking the actual party upsert over. No-op with no active
   *  campaign — the campaign-switch effect below re-syncs the whole party the
   *  moment one is picked, so nothing pushed early is lost. */
  function syncPartyMemberToCampaign(character: Character) {
    const campaignId = campaignIdRef.current;
    if (!campaignId || !character.name?.trim()) return;
    invoke('upsert_party_member', { id: campaignId, name: character.name, description: buildPartyMemberSummary(character) })
      .catch((e) => console.warn('Failed to sync a party member to party.md:', e));
  }

  // Receive characters players push over LAN.
  React.useEffect(() => {
    // Capture the PROMISE itself (not `let unlisten; listen(...).then(fn =>
    // unlisten = fn)`) so cleanup is safe no matter when it runs relative to
    // the promise resolving. That older pattern has a real race under
    // StrictMode's dev-only double-invoke (setup -> cleanup -> setup again,
    // synchronously): cleanup fires before listen()'s promise has resolved,
    // so `unlisten` is still undefined and `unlisten?.()` is a silent no-op —
    // the FIRST subscription is never torn down, and the second setup
    // registers a SECOND, independent one. Both then stay alive for the rest
    // of the session, each firing on every event. Confirmed live: this was
    // exactly why dm-narration-chunk below was double-appending every
    // streamed chunk into narrationBufferRef, producing the overlapping/
    // duplicated sentence fragments that made every line sound like it
    // repeated 2-3 times once F5's slower playback made the gap audible
    // (Kokoro was doing the same thing, just too fast to notice). Chaining
    // .then() on the promise directly works regardless of timing — it always
    // fires exactly once, whenever the promise resolves.
    const unlisten = listen<Character>('dm-party-character', (event) => {
      upsert(event.payload);
      syncPartyMemberToCampaign(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [upsert]);

  // Streamed narration chunks from the current Claude turn (see dm.rs's
  // run_claude_streaming) — only one turn ever runs at a time (processingRef
  // gating in handleTalkToggle/drainQueue), so a single shared buffer here is
  // safe. Local LLM turns never fire this event at all.
  React.useEffect(() => {
    // See the dm-party-character effect above for why the promise is
    // captured directly rather than via `let unlisten; ...then(fn => ...)`.
    const unlisten = listen<string>('dm-narration-chunk', (event) => {
      if (suppressNarrationRef.current) return;
      streamedAnyChunkRef.current = true;
      narrationBufferRef.current += event.payload;
      const { sentences, remainder } = extractCompleteSentences(narrationBufferRef.current);
      narrationBufferRef.current = remainder;
      for (const sentence of sentences) enqueueSentence(sentence);
    });
    return () => { unlisten.then((fn) => fn()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Receive spoken lines pushed from a player's own device (TalkToDMButton).
  React.useEffect(() => {
    // See the dm-party-character effect above for why the promise is
    // captured directly rather than via `let unlisten; ...then(fn => ...)`.
    const unlisten = listen<PlayerTurn>('dm-player-turn', (event) => {
      queueRef.current.push(event.payload);
      drainQueue();
    });
    return () => { unlisten.then((fn) => fn()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A Claude session id and a local-LLM session id are not interchangeable
   *  (one only means something to `claude --resume`, the other only to
   *  local_llm.rs's in-memory SESSIONS map) — resuming across a provider
   *  switch either silently drops context (Claude session id handed to a
   *  local server, which just finds no history and starts blank) or errors
   *  outright (a local session id handed to `claude --resume`, which fails
   *  with "No conversation found with session ID"). So a provider switch
   *  always starts a fresh conversation on the newly-selected engine, same
   *  as ending a session does — end_local_dm_session is a harmless no-op if
   *  the id wasn't actually a local session. */
  React.useEffect(() => {
    if (sessionIdRef.current) {
      invoke('end_local_dm_session', { sessionId: sessionIdRef.current }).catch(() => {});
    }
    sessionIdRef.current = undefined;
  }, [dmProvider]);

  /** Mirrors the ingestion-provider setting (and the local server address/model
   *  it would use) down to the Rust backend, which holds it in a global that
   *  every one-shot ingestion call reads (see local_llm.rs's
   *  set_ingestion_provider/ask_ingest_once). Runs on mount (syncing the
   *  persisted setting after an app restart, since the backend global resets to
   *  its Claude default each launch) and on any change to those three values —
   *  so the backend is always in step with what the UI shows. */
  React.useEffect(() => {
    invoke('set_ingestion_provider', {
      useLocal: ingestionProvider === 'local',
      baseUrl: localLlmBaseUrl,
      model: localLlmModel,
    }).catch((e) => console.warn('Failed to sync the ingestion provider to the backend:', e));
  }, [ingestionProvider, localLlmBaseUrl, localLlmModel]);

  /** Routes one turn to whichever DM engine is configured (see
   *  useSettingsStore's dmProvider) — a locally-hosted LLM (local_llm.rs's
   *  ask_dm_local) or the Claude subscription (dm.rs's ask_dm). Both return
   *  the identical `{text, session_id}` shape, so every caller below stays
   *  provider-agnostic. `effort` is Claude-only (extended-thinking depth —
   *  see dm.rs's build_claude_args doc comment for the live measurements
   *  behind this); local models have no equivalent knob, so it's ignored on
   *  that path rather than plumbed through to ask_dm_local. */
  async function callDm(prompt: string, sessionId: string | undefined, campaignId: string | undefined, effort: 'low' | 'medium') {
    if (dmProvider === 'local') {
      return invoke<{ text: string; session_id?: string }>('ask_dm_local', {
        prompt,
        sessionId,
        campaignId,
        baseUrl: localLlmBaseUrl,
        model: localLlmModel,
        historyLimitTurns: localLlmHistoryTurns,
      });
    }
    return invoke<{ text: string; session_id?: string }>('ask_dm', { prompt, sessionId, campaignId, effort });
  }

  /** Runs one full turn through the configured DM engine and speaks the
   *  reply. `speaker` is the character name for a remote turn, undefined for
   *  the DM Console's own mic. Never throws — errors are caught internally
   *  and reported via `setError`/the returned `error` field, so callers
   *  (drainQueue in particular) can always inspect the outcome. */
  async function runTurn(spokenText: string, speaker: string | undefined, who: string, isReconnectRetry = false): Promise<TurnResult> {
    if (!isReconnectRetry) setTurns((t) => [...t, { who, text: spokenText }]);

    // An ingestion call is actively (re)writing this campaign's memory/
    // CLAUDE.md files right now (see moduleBusy/CAMPAIGN_BUILDING_MESSAGE) —
    // don't call Claude at all, just log/speak the canned line and bail.
    if (moduleBusyRef.current) {
      setTurns((t) => [...t, { who: 'dm', text: CAMPAIGN_BUILDING_MESSAGE }]);
      currentSpeakerRef.current = null; // untagged canned line: never inherit a prior turn's sticky speaker
      quoteOpenRef.current = false;
      recentNarrationRef.current = '';
      voiceDebugRef.current = [];
      lastTaggedSpeakerRef.current = null;
      autoRevertedRef.current = false;
      enqueueSentence(CAMPAIGN_BUILDING_MESSAGE);
      if (drainingPromiseRef.current) await drainingPromiseRef.current;
      return { narration: CAMPAIGN_BUILDING_MESSAGE, interrupted: false, error: null };
    }

    narrationBufferRef.current = '';
    streamedAnyChunkRef.current = false;
    suppressNarrationRef.current = false;
    spokenThisTurnRef.current = [];
    currentSpeakerRef.current = null;
    quoteOpenRef.current = false;
    recentNarrationRef.current = '';
    voiceDebugRef.current = [];
    lastTaggedSpeakerRef.current = null;
    autoRevertedRef.current = false;
    // Consume any pending "the previous reply was cut off, here's what was
    // actually heard" note exactly once — see interruptedTurnRef's doc comment.
    const interruption = interruptedTurnRef.current ?? undefined;
    interruptedTurnRef.current = null;
    try {
      const dueForPlanCheck = !!campaignPlanRef.current && turnsSincePlanCheckRef.current >= PLAN_CHECK_INTERVAL;
      // A session the DM asked to recall last turn (recallSession dm-action) —
      // consumed exactly once here, then cleared, since the full record is
      // large and only the turn that referenced it needs it.
      const recalledSession = pendingRecalledSessionRef.current ?? undefined;
      pendingRecalledSessionRef.current = null;
      // Same one-shot consume for a recalled battle map.
      const recalledMap = pendingRecalledMapRef.current ?? undefined;
      pendingRecalledMapRef.current = null;
      const prompt = buildTurnPrompt({
        party: partyRef.current,
        spokenText,
        battleMode: battleModeRef.current,
        speaker,
        planCheckIn: dueForPlanCheck ? campaignPlanRef.current : undefined,
        recalledSession,
        recalledMap,
        battleLog: battleLogRef.current,
        interruption,
      });
      turnsSincePlanCheckRef.current = dueForPlanCheck ? 0 : turnsSincePlanCheckRef.current + 1;

      // Ordinary turns stay on low effort (fast — see callDm's doc comment);
      // only the rare plan-check-in turns, where the DM is deliberately asked
      // to reconcile more context than usual, get bumped to medium.
      const reply = await callDm(prompt, sessionIdRef.current, campaignIdRef.current ?? undefined, dueForPlanCheck ? 'medium' : 'low');
      if (reply.session_id) sessionIdRef.current = reply.session_id;

      if (suppressNarrationRef.current) {
        // Interrupted before this turn finished — stopSpeakingAndClearQueue
        // already killed the underlying `claude` process for real (see
        // dm.rs's cancel_dm_turn), so it's no longer burning cost/time
        // generating unheard narration in the background. Whether Claude's
        // own --resume session transcript ends up with a clean gap or a
        // truncated partial turn from the kill isn't fully verified either
        // way — but locally this is always treated as void regardless: never
        // spoken, never shown, no HP/condition/memory changes applied.
        // session_id above is still kept so continuity survives.
        return { narration: null, interrupted: true, error: null };
      }

      const { narration, actions, warnings: parseWarnings } = parseDmReply(reply.text);
      lastDmNarrationRef.current = narration;
      const displayNarration = stripSpeakerTagsForDisplay(narration);
      setTurns((t) => [...t, { who: 'dm', text: displayNarration }]);
      setWarning(parseWarnings.length ? parseWarnings.join(' ') : null);
      // Lets every connected player device catch up on what the DM said —
      // not just whoever's own /talk request happened to carry the reply
      // back (see party_listener.rs's narration_log). Fire-and-forget: a
      // player missing one line because their device briefly couldn't reach
      // the DM isn't worth blocking this turn over, and the next poll picks
      // up wherever they left off regardless.
      if (displayNarration.trim()) {
        invoke('push_narration', { text: displayNarration }).catch((e) =>
          console.warn('Failed to push narration to connected players:', e)
        );
      }

      if (actions) {
        const { updated, warnings } = applyDmActions(partyRef.current, actions);
        updated.forEach((c, i) => { if (c !== partyRef.current[i]) upsert(c); });
        const allWarnings = [...parseWarnings, ...warnings];
        if (allWarnings.length) setWarning(allWarnings.join(' '));

        const campaignId = campaignIdRef.current;
        if (campaignId && actions.remember?.length) {
          const date = new Date().toISOString().slice(0, 10);
          for (const note of actions.remember) {
            await invoke('append_memory_note', { id: campaignId, date, note }).catch((e) =>
              console.warn('Failed to save a remembered fact:', e)
            );
          }
        }
        if (campaignId && actions.resolveFact?.length) {
          const date = new Date().toISOString().slice(0, 10);
          for (const fact of actions.resolveFact) {
            // Local file move, no LLM call — cheap to await. A false return
            // (no/ambiguous match — see campaign.rs's remove_flagged_fact)
            // is a deliberately tolerated no-op, not an error.
            await invoke<boolean>('resolve_flagged_fact', { id: campaignId, date, fact }).catch((e) =>
              console.warn('Failed to resolve a flagged fact:', e)
            );
          }
        }
        if (campaignId && actions.rememberEntity?.length) {
          for (const { name, description, voiceId, pitch } of actions.rememberEntity) {
            await invoke('append_entity_fact', { id: campaignId, name, description }).catch((e) =>
              console.warn('Failed to save an entity fact:', e)
            );
            // The DM is asked to send a voiceId when introducing an NPC, but
            // often doesn't — and an NPC with no assignment has no voice this
            // session OR any future one, since reconcile_npc_voices only runs
            // at campaign load / session end / the manual button. Rather than
            // leave them to fall through to the narrator forever, derive one
            // from their own name + description (which nearly always carries
            // pronouns or a gendered noun). Deterministic and instant — no
            // Opus call on a live turn. A later reconcile pass won't touch
            // them, since it only fills NPCs that have no voice at all.
            const resolvedVoiceId = voiceId ?? autoAssignVoiceId(name, description);
            if (resolvedVoiceId) {
              // enforceUnique: this id was chosen by a machine (the DM inline,
              // or autoAssignVoiceId), and neither checks whether another NPC
              // already holds it. Rust moves it to a free id in the same
              // gender/accent bucket and returns whatever it actually wrote —
              // cache THAT, not what we asked for, or the hot playback path
              // speaks a voice that isn't in npc_voices.json.
              const writtenVoiceId = await invoke<string>('set_npc_voice', {
                id: campaignId,
                name,
                voiceId: resolvedVoiceId,
                pitch,
                enforceUnique: true,
              }).catch((e) => {
                console.warn('Failed to save an NPC voice assignment:', e);
                return resolvedVoiceId;
              });
              // Update the local cache immediately (not just after the next
              // campaign switch's read_npc_voices fetch) so this NPC's voice
              // is usable the moment they speak again, even later this same
              // turn's remaining narration.
              npcVoicesRef.current = { ...npcVoicesRef.current, [name.toLowerCase()]: { voice_id: writtenVoiceId, pitch } };
              setNpcVoices(npcVoicesRef.current);
            }
          }
        }
        if (campaignId && actions.rememberLocation?.length) {
          for (const { name, description } of actions.rememberLocation) {
            await invoke('append_location_fact', { id: campaignId, name, description }).catch((e) =>
              console.warn('Failed to save a location fact:', e)
            );
          }
        }
        if (campaignId && actions.advanceToChapter) {
          // Unlike the other dm-action handlers around this one, a failure
          // here can't stay a console.warn: set_current_chapter validates the
          // DM's own chapter id against the real manifest (see campaign.rs's
          // advance_chapter_at) and rejects a mismatch, but the DM has no way
          // to know its own action silently didn't take — it'll keep talking
          // as if the party moved on while current.md is still the old
          // chapter. Surfacing it as a visible warning (same banner as
          // import-time `concerns`) at least tells a human something's wrong
          // instead of the party being invisibly stuck. Appends rather than
          // replacing, since parseWarnings/applyDmActions may have already
          // set a warning earlier this same turn.
          const advanced = await invoke('set_current_chapter', { id: campaignId, chapterId: actions.advanceToChapter })
            .then(() => true)
            .catch((e) => {
              const message = e instanceof Error ? e.message : String(e);
              console.warn('Failed to advance chapter:', e);
              setWarning((prev) =>
                (prev ? `${prev} ` : '') +
                  `The DM tried to move the story to a new chapter, but it didn't take (${message}). Still on the same chapter — switch manually via the Module button if needed.`
              );
              return false;
            });
          if (advanced) {
            // A chapter just turned over — make sure the *next* turn re-checks
            // the plan instead of waiting out the rest of the interval.
            turnsSincePlanCheckRef.current = Infinity;
          }
        }
        if (campaignId && actions.resolveChapterSection) {
          // Deliberately NOT awaited — this makes a real LLM call that could
          // take several seconds, and it's background housekeeping (ready by
          // the next turn), not worth delaying this turn's own reply for.
          // moduleId is captured NOW (whatever's active this instant), not
          // re-resolved lazily inside the backend call, so a module switch
          // racing this in-flight trim can't apply it to the wrong module.
          const moduleId = activeModuleIdRef.current;
          if (moduleId) {
            invoke('resolve_chapter_section', { id: campaignId, moduleId, description: actions.resolveChapterSection }).catch((e) =>
              console.warn('Failed to trim resolved chapter section:', e)
            );
          }
        }
        if (campaignId && actions.switchActiveModule) {
          // Same failure-visibility fix as advanceToChapter above, plus one
          // more risk this one had that block didn't: setActiveModuleId used
          // to run UNCONDITIONALLY, so a rejected switch (bad module id)
          // still left local state claiming the new module was active while
          // the backend silently kept the old one — a desync where every
          // subsequent read (activeModuleIdRef, resolve_chapter_section's
          // moduleId) targets a module the backend disagrees with. Only
          // commit the local state (and force a plan re-check) once the
          // backend confirms the switch actually happened.
          const switched = await invoke('set_active_module', { id: campaignId, moduleId: actions.switchActiveModule })
            .then(() => true)
            .catch((e) => {
              const message = e instanceof Error ? e.message : String(e);
              console.warn('Failed to switch active module:', e);
              setWarning((prev) =>
                (prev ? `${prev} ` : '') +
                  `The DM tried to switch to a different module, but it didn't take (${message}). Still on the same module — switch manually via the Module button if needed.`
              );
              return false;
            });
          if (switched) {
            setActiveModuleId(actions.switchActiveModule);
            // A module switch is at least as big a context shift as a chapter
            // change — force the next turn to re-check the plan. The ref must
            // be re-read too, not just marked due: active_module/plan.md now
            // mirrors a DIFFERENT module, so without this the forced check-in
            // hands the DM the OLD module's arc plan labelled as the active
            // one, contradicting the new module's chapter text it's reading
            // from @active_module/current.md in the same turn.
            await refreshCampaignPlan(campaignId);
            turnsSincePlanCheckRef.current = Infinity;
          }
        }
        if (campaignId && actions.recallSession) {
          // The DM asked to pull a past session's full record (see campaign.rs's
          // read_session_record). Fetch it now and stash it for the NEXT turn's
          // buildTurnPrompt — the backend already returns a friendly "not found"
          // string for a bad/hallucinated id rather than throwing, so a wrong id
          // just means the DM gets told the record wasn't there. A fetch failure
          // is non-fatal: worst case the DM answers from the index line alone,
          // exactly as it would have without recall.
          const record = await invoke<string>('read_session_record', { id: campaignId, sessionId: actions.recallSession }).catch((e) => {
            console.warn('Failed to read a recalled session record:', e);
            return '';
          });
          if (record) pendingRecalledSessionRef.current = { id: actions.recallSession, record };
        }
        if (campaignId && actions.recallMap) {
          // Same one-shot fetch-and-stash for a prepared battle map (see
          // campaign.rs's read_battle_map) — backend returns a friendly
          // "not found" string for a bad slug rather than throwing, so a wrong
          // slug is harmless. Stashed for the next turn's buildTurnPrompt.
          const spec = await invoke<string>('read_battle_map', { id: campaignId, slug: actions.recallMap }).catch((e) => {
            console.warn('Failed to read a recalled battle map:', e);
            return '';
          });
          if (spec) pendingRecalledMapRef.current = { slug: actions.recallMap, spec };
        }
        // Active Battle Log: endBattle wins (save the outcome, then wipe);
        // otherwise merge any battleLog update + removeCombatant into the
        // running log. Kept as one authoritative object the app owns and feeds
        // back every turn, so a fight's state survives context compaction.
        if (actions.endBattle) {
          if (campaignId && actions.battleResult?.trim()) {
            const date = new Date().toISOString().slice(0, 10);
            await invoke('append_memory_note', { id: campaignId, date, note: actions.battleResult.trim() }).catch((e) =>
              console.warn('Failed to save a battle result:', e)
            );
          }
          setBattleLog(null);
        } else if (actions.battleLog || actions.removeCombatant?.length) {
          setBattleLog((prev) => applyBattleLog(prev, actions.battleLog, actions.removeCombatant));
        }
      }

      // Claude turns: most of the narration was already spoken sentence-by-
      // sentence as it streamed in (see the dm-narration-chunk listener) —
      // just flush whatever's left in the buffer that never completed a
      // sentence boundary. Local LLM turns (never streamed) fall back to
      // speaking the whole final narration in one shot, same as before this
      // pipeline existed.
      const leftover = narrationBufferRef.current;
      narrationBufferRef.current = '';
      if (streamedAnyChunkRef.current) {
        if (leftover.trim()) enqueueSentence(leftover);
      } else {
        enqueueSentence(narration);
      }
      // Ground truth for voice bugs: the RAW reply (tags intact) plus the
      // decision each sentence produced. Written AFTER the trailing-sentence
      // flush above — that leftover sentence is spoken, so its decision belongs
      // in the log; writing earlier silently dropped the last line of every
      // turn. Fire-and-forget — a diagnostic must never break a live turn.
      const debugCampaignId = campaignIdRef.current;
      if (debugCampaignId) {
        const voiceMap = Object.entries(npcVoicesRef.current)
          .map(([k, v]) => `${k}=${v.voice_id}`)
          .join(', ');
        const entry = [
          `=== turn ${new Date().toISOString()} ===`,
          `npc_voices: ${voiceMap || '(none)'}`,
          `ephemeral: ${Object.entries(ephemeralVoicesRef.current).map(([k, v]) => `${k}=${v.voice_id}`).join(', ') || '(none)'}`,
          '--- raw reply (tags intact) ---',
          narration,
          '--- per-sentence voice decisions ---',
          ...voiceDebugRef.current,
        ].join('\n');
        invoke('log_voice_debug', { id: debugCampaignId, entry }).catch((e) =>
          console.warn('Failed to write voice debug log:', e)
        );
      }
      // Strip any [Name]: voice cues before this reaches a human anywhere —
      // they're a TTS-only signal (see parseSpeakerTag). The raw `narration`
      // (cues intact) is kept for the local-LLM enqueue fallback further
      // below, which still needs to detect them for voice selection.
      if (drainingPromiseRef.current) await drainingPromiseRef.current;
      return { narration: displayNarration, interrupted: false, error: null };
    } catch (e) {
      // A live turn never used to check connectivity at all — only campaign
      // CREATION did (see ensureClaudeConnected's doc comment). That left a
      // real gap: a connection that died sometime after that one-time check
      // (or a fresh install/reinstall that never worked in the first place)
      // surfaced here as a raw "Claude returned an error"-shaped message with
      // no way to fix it without leaving the app. Give it the same
      // connect/install flow now, and retry the turn once automatically if
      // it succeeds — don't retry more than once, so a genuinely broken
      // setup still fails visibly instead of silently looping.
      if (!isReconnectRetry && isClaudeConnectivityError(e)) {
        const reconnected = await ensureClaudeConnected();
        // isReconnectRetry=true on the retry: the transcript entry for this
        // line was already added above on this (the first) attempt, so the
        // retry must not push it again.
        if (reconnected) return runTurn(spokenText, speaker, who, true);
      }
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      return { narration: null, interrupted: false, error: message };
    }
  }

  /** Processes queued turns (remote players' pushed lines, and the DM
   *  Console's own mic when it got queued behind an in-flight turn — see
   *  handleTalkToggle) one at a time. No-ops if a turn is already running —
   *  the caller that finishes will drain again. A remote-originated turn
   *  (has a requestId) gets its still-blocked `/talk` request completed with
   *  the real outcome once its turn resolves, so the player's own device
   *  sees the DM's actual reply instead of a bare delivery ack. */
  async function drainQueue() {
    if (processingRef.current) return;
    processingRef.current = true;
    setBusy(true);
    while (queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      const result = await runTurn(next.text, next.name, next.name || 'you');
      if (next.requestId) {
        const replyText =
          result.narration ??
          (result.interrupted
            ? 'The DM was interrupted before finishing a reply to this.'
            : `Something went wrong: ${result.error ?? 'unknown error'}`);
        invoke('respond_to_player_turn', { requestId: next.requestId, replyText }).catch((e) =>
          console.warn('Failed to send a reply back to the player device:', e)
        );
      }
    }
    processingRef.current = false;
    setBusy(false);
  }

  /** Re-speaks the last completed DM turn (see lastDmNarrationRef) — for
   *  "wait, what did the DM just say" without spending a single token: this
   *  is pure local Kokoro re-synthesis of text already generated, not a new
   *  Claude call. Stops whatever's currently playing first (a plain audio
   *  stop, not stopSpeakingAndClearQueue's heavier "kill the in-flight Claude
   *  turn" behavior — there's no live turn to cancel here, just old audio to
   *  get out of the way), then re-splits and re-enqueues the same raw text
   *  through the normal pipeline so per-NPC voices replay correctly instead
   *  of collapsing everything onto the narrator. */
  function handleReplayLastResponse() {
    if (!lastDmNarrationRef.current.trim()) return;
    stopSpeaking();
    sentenceQueueRef.current = [];
    currentSpeakerRef.current = null;
    quoteOpenRef.current = false;
    recentNarrationRef.current = '';
    voiceDebugRef.current = [];
    lastTaggedSpeakerRef.current = null;
    autoRevertedRef.current = false;
    const { sentences } = extractCompleteSentences(lastDmNarrationRef.current);
    for (const sentence of sentences) enqueueSentence(sentence);
  }

  async function handleTalkToggle() {
    setError(null);
    if (!listening) {
      if (busy) {
        // Barge-in: don't make the player wait for the DM to finish
        // talking — silence it immediately and start listening.
        // stopSpeakingAndClearQueue both kills the in-flight `claude`
        // subprocess for real (cancel_dm_turn — it doesn't just keep
        // generating unheard in the background anymore) and sets
        // suppressNarrationRef so runTurn treats whatever settles as void
        // rather than resuming speech or applying state a few seconds into
        // the player's next line.
        // Snapshot what the table actually heard BEFORE tearing playback
        // down — the next turn's prompt tells Claude exactly where its
        // cut-off reply stopped being audible (see interruptedTurnRef).
        interruptedTurnRef.current = { heard: spokenThisTurnRef.current.join(' ') };
        stopSpeakingAndClearQueue();
      } else {
        // A replay (see handleReplayLastResponse) can still be playing here
        // even though busy is false — replaying old audio isn't a live turn,
        // so it never sets busy. Stop it before recording so the player's
        // own line doesn't overlap with old DM audio. Plain stopSpeaking()
        // + clearing the queue, not the heavier stopSpeakingAndClearQueue():
        // there's no live Claude turn to cancel and nothing worth recording
        // as "interrupted" for the next prompt.
        stopSpeaking();
        sentenceQueueRef.current = [];
      }
      try {
        await startRecording();
        setListening(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not access the microphone.');
      }
      return;
    }

    setListening(false);
    let spokenText: string;
    try {
      spokenText = await stopAndTranscribe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!spokenText) return;

    if (processingRef.current) {
      // Whatever we just interrupted (or a remote player's turn) hasn't
      // finished resolving in the background yet — queue behind it, the
      // same mechanism already used for remote players. Its own `finally`
      // drains this the moment it settles (see drainQueue above).
      queueRef.current.push({ text: spokenText });
      return;
    }

    processingRef.current = true;
    setBusy(true);
    try {
      await runTurn(spokenText, undefined, 'you');
    } finally {
      processingRef.current = false;
      setBusy(false);
      drainQueue(); // pick up anything a player sent while this turn ran
    }
  }

  /** Wraps up whatever campaign/session is currently active: if anything
   *  actually happened, asks the configured DM engine for a short recap, appends it to that
   *  campaign's memory/MEMORY.md, compacts memory if it's grown large, then
   *  resets the in-memory conversation so next time starts a fresh --resume
   *  chain. Used both by the explicit "End session" button AND by the
   *  campaign switcher below — a `claude` session_id only resolves against
   *  the project directory it was created in (confirmed live: resuming a
   *  session from a different cwd fails with "No conversation found"), so
   *  switching the active campaign without closing out the old one first
   *  would make the very next turn error out. */
  async function wrapUpCurrentSession() {
    const campaignId = campaignIdRef.current;
    if (campaignId && turns.length > 0) {
      setBusy(true);
      try {
        const date = new Date().toISOString().slice(0, 10);
        // The verbatim transcript of everything said this sitting — the input
        // to the Opus session digest. 'dm' is narration, 'you' the Console's
        // own mic, anything else a remote player's character name.
        const transcript = turns
          .map((t) => (t.who === 'dm' ? `DM: ${t.text}` : t.who === 'you' ? `Player: ${t.text}` : `Player (${t.who}): ${t.text}`))
          .join('\n');
        try {
          // Primary path: one Opus map-reduce over the verbatim transcript
          // (see campaign.rs's digest_session) extracts durable facts into the
          // registries, saves the transcript losslessly for later recall,
          // writes the compact session_index line, and returns a summary we
          // reuse for the short MEMORY.md recap. Far more reliable capture than
          // a fast live model deciding mid-turn what's worth remembering.
          const summary = await invoke<string>('digest_session', { id: campaignId, date, transcript });
          await invoke('append_session_recap', { id: campaignId, date, recap: summary }).catch((e) =>
            console.warn('Failed to append the session recap:', e)
          );
          // The digest also reconciles the active module's arc plan against what
          // actually happened (campaign.rs's reconcile_module_plan_at). Re-read it
          // here or that revision never reaches the DM: campaignPlanRef is only
          // otherwise fetched on a campaign SWITCH, so a new sitting in this same
          // campaign would keep injecting the stale pre-reconciliation copy at its
          // next plan check-in — silently defeating the reconciliation entirely.
          await refreshCampaignPlan(campaignId);
        } catch (digestErr) {
          // Fallback for a DM running on a local LLM with no Claude available
          // (the digest uses Opus, same as every other ingestion call): drop
          // back to the old provider-respecting recap + best-effort entity/
          // location catch-up, so a local-only session still gets a MEMORY.md
          // recap and captures what it can.
          console.warn('Opus session digest unavailable — falling back to a provider recap:', digestErr);
          const reply = await callDm(buildRecapPrompt(partyRef.current), sessionIdRef.current, campaignId, 'low');
          const { narration, actions } = parseDmReply(reply.text);
          await invoke('append_session_recap', { id: campaignId, date, recap: narration });
          if (actions?.rememberEntity?.length) {
            for (const { name, description, voiceId, pitch } of actions.rememberEntity) {
              await invoke('append_entity_fact', { id: campaignId, name, description }).catch((e) =>
                console.warn('Failed to save an entity fact:', e)
              );
              if (voiceId) {
                const writtenVoiceId = await invoke<string>('set_npc_voice', {
                  id: campaignId,
                  name,
                  voiceId,
                  pitch,
                  enforceUnique: true,
                }).catch((e) => {
                  console.warn('Failed to save an NPC voice assignment:', e);
                  return voiceId;
                });
                npcVoicesRef.current = { ...npcVoicesRef.current, [name.toLowerCase()]: { voice_id: writtenVoiceId, pitch } };
                setNpcVoices(npcVoicesRef.current);
              }
            }
          }
          if (actions?.rememberLocation?.length) {
            for (const { name, description } of actions.rememberLocation) {
              await invoke('append_location_fact', { id: campaignId, name, description }).catch((e) =>
                console.warn('Failed to save a location fact:', e)
              );
            }
          }
        }
        // Only actually does anything once memory.md has grown past a size
        // threshold — cheap no-op most session ends (see campaign.rs).
        await invoke('compact_campaign_memory', { id: campaignId }).catch((e) =>
          console.warn('Memory compaction failed (memory.md left as-is):', e)
        );
        // Defensive fallback for entities.md/locations.md — normally a no-op,
        // since those are upserted-in-place rather than an ever-growing log.
        await invoke('compact_campaign_knowledge', { id: campaignId }).catch((e) =>
          console.warn('Entity/location compaction failed (left as-is):', e)
        );
        // Assigns voices to any NPC this sitting introduced but never got
        // around to voicing live (see campaign.rs's reconcile_npc_voices_at)
        // — a free no-op when everyone's already voiced, a real Opus call
        // otherwise. Refresh the local cache either way so a new sitting in
        // this same campaign has them ready immediately.
        await invoke('reconcile_npc_voices', { id: campaignId }).catch((e) =>
          console.warn('NPC voice reconciliation failed (unvoiced NPCs will just use the narrator voice):', e)
        );
        await invoke<Record<string, NpcVoiceEntry>>('read_npc_voices', { id: campaignId })
          .then((voices) => { npcVoicesRef.current = voices; setNpcVoices(voices); })
          .catch(() => {});
        // Ties any party member missing a personal campaign-lore hook to
        // something already established (see campaign.rs's
        // reconcile_campaign_hooks_at) — a free no-op once everyone at the
        // table already has one, a real Opus call otherwise.
        await invoke('reconcile_campaign_hooks', { id: campaignId }).catch((e) =>
          console.warn('Campaign-hooks reconciliation failed (PCs will rely on live improv only):', e)
        );
        // Freeform campaigns (no imported module) never fire
        // advance_chapter_at's own cached-plan invalidation — "End session"
        // is the equivalent signal there: tonight's content is behind the
        // party, so the next "Plan Next Session" open should regenerate
        // fresh instead of still showing what was just played.
        await invoke('invalidate_session_plan', { id: campaignId }).catch((e) =>
          console.warn('Failed to invalidate the cached session plan:', e)
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    }
    // Frees a local-LLM session's in-memory history (local_llm.rs) — a
    // harmless no-op if the session was actually running on Claude.
    if (sessionIdRef.current) {
      invoke('end_local_dm_session', { sessionId: sessionIdRef.current }).catch(() => {});
    }
    sessionIdRef.current = undefined;
    turnsSincePlanCheckRef.current = Infinity; // a new sitting starts with a fresh plan check-in
    queueRef.current = [];
    setTurns([]);
    setWarning(null);
    setBattleLog(null); // the battle log is per-sitting/per-campaign, never persisted to disk
  }

  /** Stops whatever's currently playing AND clears any sentences still
   *  queued from a streamed reply — otherwise a turn wrapped up mid-stream
   *  would keep talking for a few more sentences after "End session"/
   *  switching campaigns. Clearing the array (not the in-flight promise) is
   *  enough: stopSpeaking() forces the currently-awaited speak() call to
   *  resolve, and the drain loop then finds the queue empty and stops on
   *  its own. */
  function stopSpeakingAndClearQueue() {
    sentenceQueueRef.current = [];
    suppressNarrationRef.current = true;
    stopSpeaking();
    // Actually kill whatever `claude` turn is in flight (see dm.rs's
    // DmTurnControl/cancel_dm_turn) instead of just discarding its eventual
    // reply locally while it keeps generating in the background — a no-op
    // if nothing's running. Fire-and-forget: this function stays sync (it's
    // called from several non-async spots), and there's nothing useful to
    // do differently if the kill itself fails.
    invoke('cancel_dm_turn').catch((e) => console.warn('Failed to cancel the in-flight DM turn:', e));
  }

  async function handleEndSession() {
    stopSpeakingAndClearQueue();
    await wrapUpCurrentSession();
  }

  /** Switching campaigns via the picker below — closes out whatever was
   *  active first (see wrapUpCurrentSession's doc comment for why this is
   *  required, not just tidy) before pointing the console at the new one. */
  async function handleSelectCampaign(newId: string) {
    stopSpeakingAndClearQueue();
    await wrapUpCurrentSession();
    setActiveCampaignId(newId || null);
  }

  /** Wraps a `claude`-calling invoke so a connection that died sometime after
   *  the last check (or a fresh install/reinstall that never actually worked)
   *  gets the same connect/install remediation runTurn's catch offers,
   *  instead of failing silently mid-ingestion with an error easy to miss
   *  next to a busy-spinner overlay (this is what made lore/module ingestion
   *  look like it "did nothing" — it failed, but nothing offered a fix).
   *  Retries the given action ONCE after a successful reconnect. */
  async function withClaudeReconnect<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (e) {
      if (isClaudeConnectivityError(e)) {
        const reconnected = await ensureClaudeConnected();
        if (reconnected) return action();
      }
      throw e;
    }
  }

  async function handleCreateCampaign() {
    if (!newCampaign.name.trim()) return;
    // Check (and, if needed, offer to fix) the Claude connection BEFORE
    // creating anything — see ensureClaudeConnected's doc comment. A
    // cancelled/failed connect leaves nothing behind: no campaign, no
    // half-written lore.
    if (!(await ensureClaudeConnected())) return;
    setCreatingCampaign(true);
    try {
      const meta = await invoke<CampaignMeta>('create_campaign', { intake: newCampaign });
      setCampaigns((c) => [...c, meta].sort((a, b) => a.name.localeCompare(b.name)));
      stopSpeakingAndClearQueue();
      await wrapUpCurrentSession(); // in case a different campaign was already active/mid-session
      setActiveCampaignId(meta.id);
      setNewCampaignOpen(false);

      // Always establish the campaign's overarching lore (a separate Opus
      // call from create_campaign, which stays fast/LLM-free) — a failure
      // here doesn't roll back the already-created campaign, same tolerance
      // as the module-import step below.
      setModuleBusy('Establishing your campaign’s overarching story…');
      try {
        const combinedLore = [newCampaign.lore.trim(), pendingLoreFile?.text].filter(Boolean).join('\n\n');
        await withClaudeReconnect(() =>
          invoke<string>('establish_campaign_lore', { id: meta.id, intake: { ...newCampaign, lore: combinedLore } })
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setModuleBusy(null);
      }

      // A module was picked before the campaign existed to write it into —
      // chapterize it now that we have a real campaign id.
      if (pendingModuleFile) {
        setModuleBusy('Reading your module and building a chapter breakdown + campaign plan… this can take a few minutes for long documents.');
        setIngestProgress(null);
        try {
          const result = await withClaudeReconnect(() =>
            invoke<ChapterizeImportResult>('chapterize_and_import_module', { id: meta.id, text: pendingModuleFile.text })
          );
          if (result.concerns.length) setWarning(result.concerns.join(' '));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setModuleBusy(null);
          setIngestProgress(null);
        }
      }
      // Both ingestion steps above wrote the very files campaignPlanRef caches,
      // and they ran AFTER setActiveCampaignId already fired the campaign-switch
      // effect's own read — which therefore saw an empty campaign and cached ''.
      // An empty ref doesn't just mean stale content, it suppresses check-ins
      // entirely (dueForPlanCheck requires non-empty text), so without this the
      // brand-new campaign plays its whole first session having never once been
      // shown the lore doc and arc plan that were just generated for it.
      await refreshCampaignPlan(meta.id);
      turnsSincePlanCheckRef.current = Infinity;
      setNewCampaign(BLANK_INTAKE);
      setPendingModuleFile(null);
      setPendingLoreFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingCampaign(false);
    }
  }

  /** Backs up the active campaign's entire on-disk folder to a zip the user
   *  picks a destination for via the native Save dialog — this app's only
   *  backup mechanism, so a faithful whole-folder export matters (see
   *  export_campaign_at in campaign.rs). */
  async function handleExportCampaign() {
    if (!activeCampaignId) return;
    const safeName = (activeCampaignName ?? 'campaign').replace(/[\\/:*?"<>|]/g, '_');
    const destPath = await save({
      defaultPath: `${safeName}-backup.zip`,
      filters: [{ name: 'Campaign backup', extensions: ['zip'] }],
    });
    if (!destPath) return;
    setExportingCampaign(true);
    try {
      await invoke('export_campaign', { id: activeCampaignId, destPath });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExportingCampaign(false);
    }
  }

  /** Restores a campaign from a previously-exported zip as a brand-new
   *  campaign (see import_campaign_at's collision handling — a name already
   *  in use is a clear error, never a silent overwrite). */
  async function handleImportCampaign() {
    const path = await open({
      multiple: false,
      filters: [{ name: 'Campaign backup', extensions: ['zip'] }],
    });
    if (!path || typeof path !== 'string') return;
    setImportingCampaign(true);
    try {
      const { renamed_from, ...meta } = await invoke<CampaignMeta & { renamed_from: string | null }>('import_campaign', { zipPath: path });
      setCampaigns((c) => [...c, meta].sort((a, b) => a.name.localeCompare(b.name)));
      stopSpeakingAndClearQueue();
      await wrapUpCurrentSession(); // in case a different campaign was already active/mid-session
      setActiveCampaignId(meta.id);
      if (renamed_from) setWarning(`Imported as "${meta.name}" — "${renamed_from}" already existed, so the restored copy got a new name. Nothing about the original was touched.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImportingCampaign(false);
    }
  }

  /** "Import module file…" inside the New Campaign dialog — just extracts and
   *  stashes the text; chapterizing needs a real campaign id, so that happens
   *  in handleCreateCampaign right after the campaign is actually created. */
  async function handleImportModuleForNewCampaign() {
    setModuleBusy('Reading file…');
    try {
      const picked = await pickAndExtractModuleFile();
      if (!picked) return;
      setPendingModuleFile(picked);
      setNewCampaign((n) => ({ ...n, module: n.module || picked.name.replace(/\.[^.]+$/, '') }));
      if (picked.concern) setWarning(picked.concern);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setModuleBusy(null);
    }
  }

  /** "Attach campaign PDF" — same extraction pipeline as module files (PDF
   *  text-extraction is generic, nothing module-specific about it). The
   *  extracted text isn't dumped into the visible lore textarea (could be a
   *  whole published campaign book); it's stashed alongside whatever's typed
   *  and combined in handleCreateCampaign before the establish_campaign_lore
   *  call — same "chip below the button" pattern as pendingModuleFile. */
  async function handleAttachLoreFile() {
    setModuleBusy('Reading file…');
    try {
      const picked = await pickAndExtractModuleFile();
      if (!picked) return;
      setPendingLoreFile(picked);
      if (picked.concern) setWarning(picked.concern);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setModuleBusy(null);
    }
  }

/** Imports another module into an already-created campaign — extracts the
   *  file, then chapterize_and_import_module does the LLM chapter-boundary
   *  call + file writes. Coexists with any already-imported modules (never
   *  replaces) and automatically becomes the active one; refreshes both the
   *  modules list and the newly-active module's chapter list. */
  async function handleImportModuleForExisting() {
    if (!activeCampaignId) return;
    setModuleBusy('Reading file…');
    try {
      const picked = await pickAndExtractModuleFile();
      if (!picked) return;
      // Surface a likely-scanned-PDF warning right away, not just after the
      // (possibly minutes-long) chapterize call finishes.
      if (picked.concern) setWarning(picked.concern);
      setModuleBusy('Reading your module and building a chapter breakdown + campaign plan… this can take a few minutes for long documents.');
      setIngestProgress(null);
      const result = await withClaudeReconnect(() =>
        invoke<ChapterizeImportResult>('chapterize_and_import_module', { id: activeCampaignId, text: picked.text })
      );
      const campaignModules = await invoke<{ modules: ModuleSummary[]; active_id: string | null }>('list_campaign_modules', { id: activeCampaignId });
      setModules(campaignModules.modules);
      setActiveModuleId(campaignModules.active_id);
      setChapters(result.chapters);
      setCurrentChapterId(result.chapters[0]?.id ?? null);
      // The new module is now the active one, so active_module/plan.md is a
      // brand-new arc plan — pick it up and make the next turn check it in,
      // rather than carrying the previous module's plan for the rest of the
      // sitting.
      await refreshCampaignPlan(activeCampaignId);
      turnsSincePlanCheckRef.current = Infinity;
      const allConcerns = [picked.concern, ...result.concerns].filter((c): c is string => Boolean(c));
      if (allConcerns.length) setWarning(allConcerns.join(' '));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setModuleBusy(null);
      setIngestProgress(null);
    }
  }

  async function handleSetCurrentChapter(chapterId: string) {
    if (!activeCampaignId) return;
    try {
      await invoke('set_current_chapter', { id: activeCampaignId, chapterId });
      setCurrentChapterId(chapterId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Manually switches which already-imported module is active — mirrors
   *  handleSetCurrentChapter but one level up. Also fetches that module's
   *  own chapter list/current chapter so the dialog reflects it immediately. */
  async function handleSetActiveModule(moduleId: string) {
    if (!activeCampaignId) return;
    try {
      await invoke('set_active_module', { id: activeCampaignId, moduleId });
      setActiveModuleId(moduleId);
      const result = await invoke<{ chapters: ChapterSummary[]; current_id: string | null }>('get_module_chapters', { id: activeCampaignId, moduleId });
      setChapters(result.chapters);
      setCurrentChapterId(result.current_id);
      // Same reasoning as the `switchActiveModule` dm-action path — a manual
      // switch changes which plan.md active_module/ mirrors just as much as
      // the DM deciding to switch does.
      await refreshCampaignPlan(activeCampaignId);
      turnsSincePlanCheckRef.current = Infinity;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function openModule() {
    if (!activeCampaignId) return;
    try {
      const campaignModules = await invoke<{ modules: ModuleSummary[]; active_id: string | null }>('list_campaign_modules', { id: activeCampaignId });
      setModules(campaignModules.modules);
      setActiveModuleId(campaignModules.active_id);
      if (campaignModules.active_id) {
        const result = await invoke<{ chapters: ChapterSummary[]; current_id: string | null }>('get_module_chapters', {
          id: activeCampaignId,
          moduleId: campaignModules.active_id,
        });
        setChapters(result.chapters);
        setCurrentChapterId(result.current_id);
      } else {
        setChapters([]);
        setCurrentChapterId(null);
      }
      setModulePlan(await invoke<string>('read_campaign_plan', { id: activeCampaignId }).catch(() => ''));
      setModuleOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function openNotes() {
    if (!activeCampaignId) return;
    try {
      const content = await invoke<string>('read_campaign_notes', { id: activeCampaignId });
      setNotesText(content);
      setNotesOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveNotes() {
    if (!activeCampaignId) return;
    setNotesSaving(true);
    try {
      await invoke('save_campaign_notes', { id: activeCampaignId, content: notesText });
      setNotesOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setNotesSaving(false);
    }
  }

  async function openHistory() {
    if (!activeCampaignId) return;
    try {
      const [memory, flaggedFacts, entities, locations, voices] = await Promise.all([
        invoke<string>('read_campaign_memory', { id: activeCampaignId }),
        invoke<string>('read_campaign_flagged_facts', { id: activeCampaignId }),
        invoke<string>('read_campaign_entities', { id: activeCampaignId }),
        invoke<string>('read_campaign_locations', { id: activeCampaignId }),
        invoke<Record<string, NpcVoiceEntry>>('read_npc_voices', { id: activeCampaignId }),
      ]);
      setHistoryText(memory);
      setFlaggedFactsText(flaggedFacts);
      setEntitiesText(entities);
      npcVoicesRef.current = voices;
      setNpcVoices(voices);
      setVoiceEdits({});
      setLocationsText(locations);
      setVoiceReconcileResult(null);
      setHistoryOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Manual trigger for the same voice-reconciliation pass wrapUpCurrentSession
   *  already runs automatically at "End session" — lets you assign voices
   *  on demand instead of waiting (e.g. right after importing a module that
   *  names a bunch of NPCs up front). Reuses moduleBusy/moduleBusyLabel for
   *  its busy state, same "one-shot Opus call, could take a while" shape as
   *  the rest of the ingestion-style actions. */
  async function handleReconcileNpcVoices() {
    if (!activeCampaignId) return;
    setVoiceReconcileResult(null);
    setModuleBusy('Reviewing entities.md for any NPC missing a voice…');
    try {
      const assigned = await invoke<number>('reconcile_npc_voices', { id: activeCampaignId });
      setVoiceReconcileResult(assigned === 0 ? 'Every named NPC already has a voice.' : `Assigned voices to ${assigned} NPC${assigned === 1 ? '' : 's'}.`);
      const voices = await invoke<Record<string, NpcVoiceEntry>>('read_npc_voices', { id: activeCampaignId });
      npcVoicesRef.current = voices;
      setNpcVoices(voices);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setModuleBusy(null);
    }
  }

  /** Manual trigger for the same campaign-hooks pass wrapUpCurrentSession
   *  already runs automatically at "End session" — lets you tie PC
   *  backstories into the campaign's lore on demand instead of waiting (e.g.
   *  right after everyone's connected for the first time). Reuses moduleBusy/
   *  moduleBusyLabel for its busy state, same shape as handleReconcileNpcVoices. */
  async function handleReconcileCampaignHooks() {
    if (!activeCampaignId) return;
    setCampaignHooksResult(null);
    setModuleBusy('Reviewing party.md for any PC missing a campaign hook…');
    try {
      const added = await invoke<number>('reconcile_campaign_hooks', { id: activeCampaignId });
      setCampaignHooksResult(added === 0 ? 'Every known party member already has a hook.' : `Added a hook for ${added} PC${added === 1 ? '' : 's'}.`);
      const content = await invoke<string>('read_campaign_lore', { id: activeCampaignId });
      setLoreText(content);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setModuleBusy(null);
    }
  }

  /** Plays VOICE_PREVIEW_LINE through a candidate voice/pitch — reuses
   *  dmSpeech's speak() directly rather than hand-rolling playback, same
   *  Kokoro-with-browser-speechSynthesis-fallback path a real turn uses. Not
   *  tied to any NPC or saved anywhere; purely "let the DM hear this pick
   *  before committing to it" (see the voice-override panel in the History
   *  dialog). Disabled while a turn is actively speaking (see the panel's
   *  `disabled={busy}`) since speak() shares dmSpeech's single currentAudio
   *  slot with the live playback queue — previewing mid-turn would fight
   *  over the same audio element. `key` disables just this row's button
   *  while its own preview plays; unrelated rows stay usable. */
  async function handlePreviewVoice(key: string, voiceId: string, pitch: string, speed: string) {
    if (previewingKey) return;
    setPreviewingKey(key);
    try {
      await previewVoice(VOICE_PREVIEW_LINE, voiceId, pitch || undefined, speed ? Number(speed) : undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewingKey(null);
    }
  }

  /** Persists a manual voice/pitch/speed override for one NPC — the same
   *  set_npc_voice command rememberEntity's live assignment already uses
   *  (campaign.rs doesn't distinguish "the DM picked this" from "a human
   *  overrode it," so this is a normal, permanent assignment afterward, not
   *  a special pinned state). `speed` is this app's own pace-factor
   *  (independent of pitch — pace, not tone), stored as the literal string
   *  from NPC_SPEED_OPTIONS and parsed to a number here. Updates both
   *  npcVoicesRef (the hot playback path) and npcVoices (the panel's own
   *  display) immediately, same as every other npc_voices.json write site in
   *  this file. */
  async function handleSaveVoiceOverride(name: string, voiceId: string, pitch: string, speed: string) {
    if (!activeCampaignId || !voiceId) return;
    const pitchArg = pitch || undefined;
    const speedArg = speed ? Number(speed) : undefined;
    try {
      await invoke('set_npc_voice', { id: activeCampaignId, name, voiceId, pitch: pitchArg, speed: speedArg });
      const updated = { ...npcVoicesRef.current, [name.trim().toLowerCase()]: { voice_id: voiceId, pitch: pitchArg, speed: speedArg } };
      npcVoicesRef.current = updated;
      setNpcVoices(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** One voice/pitch/speed override row — select + select + select + Preview
   *  + Save — shared by the narrator's own row and every per-NPC row below
   *  it, since both need identical controls over the exact same underlying
   *  npc_voices.json map (see set_npc_voice_at's doc comment on why the
   *  narrator is "just another key" there). `key` is the already-lowercased
   *  lookup key (NARRATOR_VOICE_KEY for the narrator, or an NPC's lowercased
   *  name); `label` is what's actually displayed. `speed` is independent of
   *  `pitch` — this app's own pace factor (pace only, no tone change), see
   *  SPEED_LABELS/NPC_SPEED_OPTIONS. */
  function renderVoiceOverrideRow(key: string, label: string) {
    const current = npcVoices[key];
    const edit = voiceEdits[key] ?? { voiceId: current?.voice_id ?? '', pitch: current?.pitch ?? '', speed: current?.speed !== undefined ? String(current.speed) : '' };
    const previewKey = `${key}|${edit.voiceId}|${edit.pitch}|${edit.speed}`;
    return (
      <div key={key} className="flex flex-wrap items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2">
        <span className="text-sm text-slate-100 min-w-[9rem]">{label}</span>
        <select
          className="bg-slate-800 border border-slate-600 rounded text-xs px-1 py-1"
          value={edit.voiceId}
          onChange={(e) => setVoiceEdits((v) => ({ ...v, [key]: { ...edit, voiceId: e.target.value } }))}
        >
          <option value="">(narrator default)</option>
          {NPC_VOICE_OPTIONS.map((id) => (
            <option key={id} value={id}>{VOICE_LABELS[id]}</option>
          ))}
        </select>
        <select
          className="bg-slate-800 border border-slate-600 rounded text-xs px-1 py-1"
          value={edit.pitch}
          onChange={(e) => setVoiceEdits((v) => ({ ...v, [key]: { ...edit, pitch: e.target.value } }))}
        >
          {NPC_PITCH_OPTIONS.map((tag) => (
            <option key={tag} value={tag}>{PITCH_LABELS[tag]}</option>
          ))}
        </select>
        <select
          className="bg-slate-800 border border-slate-600 rounded text-xs px-1 py-1"
          value={edit.speed}
          onChange={(e) => setVoiceEdits((v) => ({ ...v, [key]: { ...edit, speed: e.target.value } }))}
        >
          {NPC_SPEED_OPTIONS.map((tag) => (
            <option key={tag} value={tag}>{SPEED_LABELS[tag]}</option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={!edit.voiceId || previewingKey !== null || busy}
          onClick={() => handlePreviewVoice(previewKey, edit.voiceId, edit.pitch, edit.speed)}
        >
          {previewingKey === previewKey ? 'Playing…' : 'Preview'}
        </Button>
        <Button
          size="sm"
          disabled={!edit.voiceId || busy}
          onClick={() => handleSaveVoiceOverride(key, edit.voiceId, edit.pitch, edit.speed)}
        >
          Save
        </Button>
      </div>
    );
  }

  /** Persist the campaign's positioning style when the DM picks one. Optimistic:
   *  the dropdown updates immediately; a write failure reverts and surfaces. */
  async function handleChangeBattleMode(mode: BattleMode) {
    const campaignId = activeCampaignId;
    if (!campaignId) return;
    const prev = battleModeRef.current;
    setBattleMode(mode);
    try {
      await invoke('set_battle_mode', { id: campaignId, mode });
    } catch (e) {
      setBattleMode(prev);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // ── Plan Next Session + its battle maps (merged — see campaign.rs's
  // plan_next_session_at) ─────────────────────────────────────────────────────
  // Battle Maps has no independent entry point anymore: it's derived from
  // whatever the (cached) session plan says is coming up. One card per
  // combat encounter the plan identified.

  /** The vision-resolved catalog tiles for one map, with their art preloaded
   *  so the synchronous render can draw them. Empty (silent) when no library is
   *  imported or nothing resolved — the render then uses built-in sprites. */
  async function fetchMapTiles(slug: string): Promise<{ tiles: MapTileArt[]; terrain: MapTerrain }> {
    try {
      const res = await invoke<{ tiles: MapTileArt[]; floor: string | null; liquid: string | null; natural_walls: boolean }>('get_map_tiles', { id: activeCampaignId, slug });
      const terrain: MapTerrain = { floor: res.floor, liquid: res.liquid, naturalWalls: res.natural_walls };
      await preloadResolvedTileArt(res.tiles, terrain);
      return { tiles: res.tiles, terrain };
    } catch {
      return { tiles: [], terrain: {} };
    }
  }

  async function loadMapCard(meta: BattleMapMeta): Promise<MapCard> {
    const spec = await invoke<string>('read_battle_map', { id: activeCampaignId, slug: meta.slug });
    const { tiles, terrain } = await fetchMapTiles(meta.slug);
    return { slug: meta.slug, name: meta.name, summary: meta.summary, spec, tiles, terrain, png: battleMapToPngDataUrl(spec, 64, tiles, terrain, showZones) };
  }

  /** Loads the currently-imported tile library's summary (if any) — called
   *  on Plan dialog open so the count shown is never stale after a restart. */
  async function refreshTileLibrarySummary() {
    try {
      const summary = await invoke<{ total: number; roots: string[] } | null>('get_tile_library_summary');
      setTileLibraryTotal(summary?.total ?? null);
      setTileLibraryRootCount(summary?.roots.length ?? 0);
    } catch {
      setTileLibraryTotal(null);
      setTileLibraryRootCount(0);
    }
  }

  /** What the resolver believes about the imported pack — see pack_profile.rs.
   *  Worth showing rather than trusting silently: a wrong ground query or a
   *  mis-detected universal biome doesn't fail, it just quietly makes every
   *  map render as generic stone, three sessions later. */
  async function refreshPackProfile() {
    try {
      setPackProfile(await invoke<PackProfileView | null>('get_pack_profile'));
      setProfileEdits(await invoke<ProfileOverrides>('get_pack_profile_overrides'));
    } catch {
      setPackProfile(null);
    }
  }

  React.useEffect(() => {
    if (planOpen) {
      void refreshTileLibrarySummary();
      void refreshPackProfile();
    }
  }, [planOpen]);

  /** Re-derives the profile from the pack itself (two model passes over its
   *  folder structure and MEASURED texture evidence). Human corrections live in
   *  a separate file and survive this. */
  async function reprofilePack() {
    if (!(await ensureClaudeConnected())) return;
    setProfileBusy(true);
    try {
      await invoke('profile_tile_library');
      await refreshPackProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProfileBusy(false);
    }
  }

  /** Records one correction and re-reads the profile so the row shows the
   *  corrected value (and its new ground thumbnail) immediately. Keyed by scene
   *  word, matching ProfileOverrides. */
  async function editBiome(scene: string, patch: BiomeEdit) {
    const next: ProfileOverrides = { ...profileEdits, biomes: { ...profileEdits.biomes, [scene]: { ...profileEdits.biomes?.[scene], ...patch } } };
    setProfileEdits(next);
    try {
      await invoke('save_pack_profile_overrides', { overrides: next });
      await refreshPackProfile();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** "Import…"/"Add another folder…"/"Replace…" for the optional local tile
   *  library (see tile_library.rs) — a folder picker, then a one-shot
   *  scan+index command. `merge` folds the picked folder into whatever's
   *  already imported, so a second asset pack can be added without losing
   *  the first; without it, the picked folder REPLACES the whole catalog
   *  (see import_tile_library's doc comment — re-picking the SAME folder
   *  either way just refreshes that folder's own entries, never dupes).
   *  Nothing here ever touches git or the app bundle: the art stays exactly
   *  where the DM put it, only a small filename manifest is cached locally. */
  async function importTileLibrary(merge: boolean) {
    const root = await open({ directory: true, multiple: false });
    if (!root || typeof root !== 'string') return;
    setTileLibraryBusy(true);
    try {
      const summary = await invoke<{ total: number; roots: string[] }>('import_tile_library', { root, merge });
      setTileLibraryPath(root);
      setTileLibraryTotal(summary.total);
      setTileLibraryRootCount(summary.roots.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTileLibraryBusy(false);
    }
  }

  /** Re-renders every currently-shown card's preview PNG from its own spec —
   *  battleMapToPngDataUrl reads whichever tile style is currently active
   *  (see setActiveTileStyle), so switching styles doesn't touch any map's
   *  saved spec, just what art the already-loaded cards redraw with. */
  function refreshMapCardPreviews() {
    const rerender = (c: MapCard) => ({ ...c, png: battleMapToPngDataUrl(c.spec, 64, c.tiles, c.terrain, showZones) });
    setPlanMapCards((cards) => cards.map(rerender));
    setAdHocMapCards((cards) => cards.map(rerender));
  }

  /** Per-card "Regenerate" — redoes ONLY this one plan-owned map, using the
   *  same encounter name/description the plan originally gave it
   *  (campaign.rs's regenerate_one_plan_map_at). The only regenerate action
   *  used to be the whole-plan one below, which silently redid every
   *  encounter's map — a DM regenerating one bad map was actually paying
   *  for the whole plan every time. Plan-owned maps only; an ad-hoc map has
   *  no encounter context to regenerate from (re-describe it instead). */
  async function regenerateOneMap(card: MapCard) {
    if (!activeCampaignId) return;
    if (!(await ensureClaudeConnected())) return;
    setPlanBusy(`Regenerating "${card.name}"…`);
    try {
      const meta = await withClaudeReconnect(() => invoke<BattleMapMeta>('regenerate_one_plan_map', { id: activeCampaignId, slug: card.slug }));
      const fresh = await loadMapCard(meta);
      setPlanMapCards((cards) => cards.map((c) => (c.slug === fresh.slug ? fresh : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanBusy(null);
    }
  }

  async function exportMapPng(card: MapCard) {
    const dest = await save({ defaultPath: `${card.slug}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }] });
    if (!dest) return;
    setPlanBusy('Exporting PNG…');
    try {
      await preloadResolvedTileArt(card.tiles, card.terrain);
      const dataUrl = battleMapToPngDataUrl(card.spec, 96, card.tiles, card.terrain, showZones);
      if (!dataUrl) { setError('This map couldn’t be rendered — its grid may be malformed.'); return; }
      const b64 = dataUrl.split(',')[1];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      await writeFile(dest, bytes);
      await openPath(dest);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanBusy(null);
    }
  }

  async function exportMapPdf(card: MapCard) {
    const dest = await save({ defaultPath: `${card.slug}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (!dest) return;
    setPlanBusy('Exporting print-scaled PDF…');
    try {
      await preloadResolvedTileArt(card.tiles, card.terrain);
      const bytes = await battleMapToPdfBytes(card.spec, card.tiles, card.terrain, showZones);
      if (!bytes) { setError('This map couldn’t be rendered — its grid may be malformed.'); return; }
      await writeFile(dest, bytes);
      await openPath(dest);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanBusy(null);
    }
  }

  /** Patches one card's spec text in whichever of the two lists it's in
   *  (plan-owned or ad-hoc), without touching the others. `updatePreview`
   *  also re-renders the png — set false on every keystroke (cheap text
   *  update only) and true on "Re-render preview" / after a successful save. */
  async function patchMapCardSpec(slug: string, spec: string, updatePreview: boolean) {
    // Hand edits keep the card's already-resolved tiles (a live edit doesn't
    // re-run the vision resolver — that happens on regenerate); the preview
    // just redraws the edited grid under the existing tile art.
    const patch = (cards: MapCard[]) => cards.map((c) => (c.slug === slug ? { ...c, spec, png: updatePreview ? battleMapToPngDataUrl(spec, 64, c.tiles, c.terrain, showZones) : c.png } : c));
    setPlanMapCards(patch);
    setAdHocMapCards(patch);
  }

  /** Persist hand edits to a map spec, then re-render its card's preview. */
  async function saveMapEdits(card: MapCard) {
    if (!activeCampaignId) return;
    setPlanBusy('Saving…');
    try {
      await invoke('save_battle_map', { id: activeCampaignId, slug: card.slug, content: card.spec });
      await patchMapCardSpec(card.slug, card.spec, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanBusy(null);
    }
  }

  /** "…or describe one more encounter" — the on-demand secondary path
   *  (campaign.rs's generate_battle_map). Additive: the new map lands in
   *  adHocMapCards, never touching the plan's own owned set, so it survives
   *  the next Regenerate untouched. Diffs the returned (whole-campaign) list
   *  against what's already known here, since the command itself has no
   *  concept of "just the new one." */
  async function generateHintMap() {
    if (!activeCampaignId || !mapEncounterHint.trim()) return;
    if (!(await ensureClaudeConnected())) return;
    const known = new Set([...planMapCards, ...adHocMapCards].map((c) => c.slug));
    setPlanBusy('Designing a map for that encounter…');
    try {
      const all = await withClaudeReconnect(() => invoke<BattleMapMeta[]>('generate_battle_map', { id: activeCampaignId, hint: mapEncounterHint.trim() }));
      const fresh = all.filter((m) => !known.has(m.slug));
      const cards = await Promise.all(fresh.map(loadMapCard));
      setAdHocMapCards((prev) => [...prev, ...cards]);
      setMapEncounterHint('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanBusy(null);
    }
  }

  /** Global — not tied to any campaign, so this button is always available. */
  async function openTerrain() {
    try {
      const content = await invoke<string>('read_terrain_catalog');
      setTerrainText(content);
      setTerrainOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveTerrain() {
    setTerrainSaving(true);
    try {
      await invoke('save_terrain_catalog', { content: terrainText });
      setTerrainOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTerrainSaving(false);
    }
  }

  /** "Plan mode" — callable any time, not just at session start (e.g. days
   *  ahead of actually playing). A PURE READ: never calls Claude, just shows
   *  whatever's cached (campaign.rs's read_cached_session_plan) or nothing.
   *  Opening the dialog should never silently kick off an LLM call just from
   *  a click — generating (first time or a regenerate) is always the
   *  explicit "Generate"/"Regenerate" button (see generatePlan below). */
  async function openPlanMode() {
    if (!activeCampaignId) return;
    setPlanOpen(true);
    setPlanText('');
    setPlanMapCards([]);
    setAdHocMapCards([]);
    setFailedMaps([]);
    try {
      const cached = await invoke<SessionPlanResult | null>('read_cached_session_plan', { id: activeCampaignId });
      const planned = cached?.maps ?? [];
      if (cached) {
        setPlanText(cached.plan_text);
        setPlanMapCards(await Promise.all(planned.map(loadMapCard)));
      }
      // Rehydrate the ad-hoc maps too. They persist on disk exactly like the
      // plan's own, but nothing ever read them back: `adHocMapCards` was only
      // ever appended to by generateHintMap, so every map made with "…or
      // describe one more encounter" disappeared from the console on the next
      // reload or campaign switch and could never be reached again.
      const ownedSlugs = new Set(planned.map((m) => m.slug));
      const onDisk = await invoke<BattleMapMeta[]>('list_battle_maps', { id: activeCampaignId });
      const extras = onDisk.filter((m) => !ownedSlugs.has(m.slug));
      setAdHocMapCards(await Promise.all(extras.map(loadMapCard)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** The explicit "Generate"/"Regenerate" button — the only thing that
   *  actually calls Claude for the plan/maps. `force` picks which command:
   *  plain `suggest_session_plan` (first-ever generate — still cache-aware
   *  server-side, though openPlanMode already established nothing's cached
   *  by the time this button is even shown) vs `regenerate_session_plan`
   *  (always fresh, replacing whatever the previous plan owned). */
  async function generatePlan(force: boolean) {
    if (!activeCampaignId) return;
    if (!(await ensureClaudeConnected())) return;
    setPlanLoading(true);
    setPlanProgress(null);
    setAdHocMapCards([]);
    setFailedMaps([]);
    try {
      const cmd = force ? 'regenerate_session_plan' : 'suggest_session_plan';
      const result = await withClaudeReconnect(() => invoke<SessionPlanResult>(cmd, { id: activeCampaignId }));
      setPlanText(result.plan_text);
      setPlanMapCards(await Promise.all(result.maps.map(loadMapCard)));
      setFailedMaps(result.failed_maps ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanLoading(false);
      setPlanProgress(null);
    }
  }

  async function openLore() {
    if (!activeCampaignId) return;
    try {
      const content = await invoke<string>('read_campaign_lore', { id: activeCampaignId });
      setLoreText(content);
      setLoreAddition('');
      setPendingLoreUpdateFile(null);
      setCampaignHooksResult(null);
      setLoreOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Same extraction pipeline as everywhere else a PDF gets picked — see
   *  pickAndExtractModuleFile's doc comment. */
  async function handleAttachLoreUpdateFile() {
    setModuleBusy('Reading file…');
    try {
      const picked = await pickAndExtractModuleFile();
      if (!picked) return;
      setPendingLoreUpdateFile(picked);
      if (picked.concern) setWarning(picked.concern);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setModuleBusy(null);
    }
  }

  /** Folds whatever's typed + attached into the existing campaign_lore.md via
   *  one Opus call (update_campaign_lore) — callable any time, unlike the
   *  one-shot establish_campaign_lore that only ever runs at creation. */
  async function handleUpdateLore() {
    if (!activeCampaignId) return;
    const addition = [loreAddition.trim(), pendingLoreUpdateFile?.text].filter(Boolean).join('\n\n');
    if (!addition) return;
    setModuleBusy('Folding new material into your campaign lore…');
    try {
      const updated = await invoke<string>('update_campaign_lore', { id: activeCampaignId, addition });
      setLoreText(updated);
      setLoreAddition('');
      setPendingLoreUpdateFile(null);
      // campaign_lore.md just changed — without this the DM keeps being handed
      // the pre-merge lore at every check-in until the next campaign switch or
      // session digest, which is the whole point of having attached it.
      await refreshCampaignPlan(activeCampaignId);
      turnsSincePlanCheckRef.current = Infinity;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setModuleBusy(null);
    }
  }

  const activeCampaignName = campaigns.find((c) => c.id === activeCampaignId)?.name;
  // Only non-null while a chapterize_and_import_module call is actually in
  // flight (see the two setIngestProgress(null) call sites bracketing it) —
  // every other moduleBusy consumer never touches it, so no extra check for
  // WHICH action is running is needed here.
  const ingestStepSuffix =
    ingestProgress?.phase === 'extracting'
      ? ` — chunk ${ingestProgress.done} of ${ingestProgress.total}`
      : ingestProgress?.phase === 'synthesizing'
        ? ' — writing the plan'
        : ingestProgress?.phase === 'critiquing'
          ? ' — polishing the plan'
          : '';
  const moduleBusyLabel = moduleBusy
    ? `${moduleBusy} (${formatElapsed(Math.floor((Date.now() - moduleBusyStartRef.current) / 1000))})${ingestStepSuffix}`
    : null;

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => navigate('/')} className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={18} /> Home
          </button>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">🧙 DM Console</h1>
          <Button variant="outline" size="sm" onClick={handleEndSession} disabled={busy}>End session</Button>
        </div>

        {/* Campaign picker */}
        <div className="flex items-center justify-center gap-2 mb-2 flex-wrap">
          <select
            value={activeCampaignId ?? ''}
            onChange={(e) => handleSelectCampaign(e.target.value)}
            disabled={busy}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-red-600 disabled:opacity-50"
          >
            <option value="">Select a campaign…</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <Button size="sm" variant="outline" onClick={() => { setNewCampaign(BLANK_INTAKE); setPendingModuleFile(null); setPendingLoreFile(null); setNewCampaignOpen(true); }}>
            <Plus size={14} /> New campaign
          </Button>

          <Button size="sm" variant="ghost" onClick={handleExportCampaign} disabled={!activeCampaignId || exportingCampaign} title="Back up the selected campaign to a zip file you choose the location for">
            <Download size={14} /> {exportingCampaign ? 'Exporting…' : 'Export'}
          </Button>

          <Button size="sm" variant="ghost" onClick={handleImportCampaign} disabled={importingCampaign} title="Restore a campaign from a previously-exported zip file, as a new campaign">
            <Upload size={14} /> {importingCampaign ? 'Importing…' : 'Import'}
          </Button>

          <Button size="sm" variant="ghost" onClick={openTerrain} title="Your catalog of physical terrain pieces (not tied to any one campaign)">
            <Map size={14} /> Terrain
          </Button>

          <Button size="sm" variant="ghost" onClick={() => setDmModelOpen(true)} title="Which engine runs the DM — Claude or a local LLM">
            <Cpu size={14} /> DM Model{dmProvider === 'local' ? ' (Local)' : ''}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setVoiceEngineOpen(true)} title="Which engine gives the DM its voice — Standard or high-quality">
            <Volume2 size={14} /> Voice{ttsEngine === 'f5' ? ' (HQ)' : ''}
          </Button>

          {activeCampaignId && (
            <>
              <Button size="sm" variant="ghost" onClick={openNotes} title="Edit persona, house rules, and world lore (CLAUDE.md)">
                <BookOpen size={14} /> Notes
              </Button>
              <Button size="sm" variant="ghost" onClick={openHistory} title="Past session recaps (memory/MEMORY.md)">
                <ScrollText size={14} /> History
              </Button>
              <Button size="sm" variant="ghost" onClick={openModule} title="Imported module chapters, and which one is current">
                <FileUp size={14} /> Module
              </Button>
              <Button size="sm" variant="ghost" onClick={openLore} title="The overarching campaign-lore doc, and a way to fold in new material any time">
                <Landmark size={14} /> Lore
              </Button>
              <Button size="sm" variant="ghost" onClick={openPlanMode} title="Suggest terrain to set up, plus battle maps for any upcoming fights — usable days ahead">
                <ClipboardList size={14} /> Plan next session
              </Button>
              <label className="flex items-center gap-1.5 text-sm text-slate-300" title="How this table handles combat positioning — the DM narrates placement to match">
                <Swords size={14} />
                <select
                  value={battleMode}
                  onChange={(e) => handleChangeBattleMode(e.target.value as BattleMode)}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-red-600"
                >
                  {BATTLE_MODES.map((m) => <option key={m} value={m}>{BATTLE_MODE_LABELS[m]}</option>)}
                </select>
              </label>
            </>
          )}
        </div>

        {lanIp && (
          <p className="text-xs text-slate-500 mb-4 text-center">
            Players: enter <span className="text-slate-300 font-mono">{lanIp}</span> in their app's "Send to DM" dialog to join the table.
          </p>
        )}

        <div className="grid gap-6 md:grid-cols-[1fr_260px]">
          {/* Conversation */}
          <Card className="p-5 flex flex-col h-[60vh]">
            <div className="flex-1 overflow-y-auto space-y-3 mb-4 scrollbar-thin">
              {turns.length === 0 && (
                <p className="text-slate-500 text-sm">
                  {activeCampaignId
                    ? `Press Talk and say "start the session" to begin ${activeCampaignName ? `— ${activeCampaignName}` : ''}.`
                    : 'Pick or create a campaign above to begin.'}
                </p>
              )}
              {turns.map((t, i) => (
                <div key={i} className={t.who === 'dm' ? 'text-slate-100' : 'text-slate-400 italic'}>
                  <span className="text-xs uppercase tracking-wide mr-2 opacity-60">
                    {t.who === 'dm' ? 'DM' : t.who === 'you' ? 'You' : t.who}
                  </span>
                  {t.text}
                </div>
              ))}
            </div>

            {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
            {warning && <p className="text-xs text-amber-400 mb-3">⚠️ {warning}</p>}

            <div className="flex items-center justify-center gap-3">
              <Button
                size="lg"
                variant={listening ? 'danger' : 'primary'}
                // Deliberately NOT gated on `busy` — a player should be able
                // to click Talk to interrupt the DM at any time, not just
                // once it's finished talking (see handleTalkToggle's
                // barge-in path). Only "can't record/send at all" reasons
                // (model still loading, no campaign picked) actually disable it.
                disabled={!listening && (!sttReady || !activeCampaignId)}
                onClick={handleTalkToggle}
              >
                {listening ? <Square size={20} /> : <Mic size={20} />}
                {listening
                  ? 'Stop'
                  : !activeCampaignId
                    ? 'Pick a campaign first'
                    : !sttReady
                      ? 'Loading speech recognition…'
                      : busy
                        ? 'Interrupt & Talk'
                        : 'Talk'}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={handleReplayLastResponse}
                disabled={!lastDmNarrationRef.current.trim()}
                title="Re-hear the DM's last response — free, no new turn is generated"
              >
                <RotateCcw size={18} />
                Replay
              </Button>
            </div>
          </Card>

          {/* Sidebar: party + (when active) battle map */}
          <div className="space-y-6">
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-slate-300 flex items-center gap-1.5"><Radio size={14} /> Party ({party.length})</h2>
                {party.length > 0 && (
                  <button onClick={clear} title="Clear party" className="text-slate-500 hover:text-red-400 transition-colors">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
              {party.length === 0 && (
                <p className="text-xs text-slate-500">No one has joined yet.</p>
              )}
              <div className="space-y-2">
                {party.map((c) => {
                  // Not every party member has HP: the LAN handler only checks
                  // name + classes, so an incomplete send lands here with none
                  // (see partyHp.ts). Rendered raw that read "NaN/ HP".
                  const knownHp = hasKnownHp(c);
                  const hpPct = knownHp && c.maxHP > 0 ? Math.round((c.currentHP / c.maxHP) * 100) : 0;
                  return (
                    // party_listener.rs's /character handler only validates name +
                    // classes before emitting 'dm-party-character', not id — so a
                    // sent character can land here with no id. Fall back to name
                    // (which usePartyStore's own upsert already treats as identity).
                    <div key={c.id || c.name} className="bg-slate-900 border border-slate-700 rounded-lg p-2 group relative">
                      <button
                        onClick={() => remove(c.id)}
                        className="absolute top-1.5 right-1.5 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove from table"
                      >
                        <Trash2 size={12} />
                      </button>
                      <p className="text-sm font-bold text-white pr-4">{c.name}</p>
                      {knownHp ? (
                        <>
                          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden my-1">
                            <div
                              className={`h-full rounded-full ${hpPct > 50 ? 'bg-green-500' : hpPct > 25 ? 'bg-yellow-500' : 'bg-red-500'}`}
                              style={{ width: `${hpPct}%` }}
                            />
                          </div>
                          <p className="text-[11px] text-slate-400">{c.currentHP}/{c.maxHP} HP</p>
                        </>
                      ) : (
                        // No empty HP bar here — an unfilled bar reads as "at 0 HP",
                        // which is the one thing this must never imply.
                        <p className="text-[11px] text-amber-400 my-1">HP unknown — ask them to re-send their sheet</p>
                      )}
                      {(c.conditions?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.conditions.map((cond) => <Badge key={cond} color="red">{cond}</Badge>)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            {battleLog && battleLog.combatants.length > 0 && (
              <Card className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-bold text-slate-300 flex items-center gap-1.5">
                    <Swords size={14} /> Active Battle Log
                    {battleLog.round !== undefined && <span className="text-[11px] font-normal text-slate-500">round {battleLog.round}</span>}
                  </h2>
                  <button onClick={() => setBattleLog(null)} title="End battle (clears the log)" className="text-slate-500 hover:text-red-400 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
                {battleLog.initiative && battleLog.initiative.length > 0 && (
                  <p className="text-[11px] text-slate-500 mb-2">Initiative: {battleLog.initiative.join(' → ')}</p>
                )}
                <div className="space-y-1.5">
                  {battleLog.combatants.map((c) => {
                    const sideColor = c.side === 'party' ? 'text-green-400'
                      : c.side === 'enemy' ? 'text-red-400'
                      : c.side === 'ally' ? 'text-sky-400' : 'text-slate-300';
                    const isActive = !!battleLog.active && c.name.trim().toLowerCase() === battleLog.active.trim().toLowerCase();
                    const place = c.position ?? (c.coord ? `(${c.coord.q},${c.coord.r})` : '');
                    return (
                      <div key={c.name} className={`text-xs ${isActive ? 'bg-slate-800 rounded px-1.5 py-1' : ''}`}>
                        <div className="flex justify-between gap-2">
                          <span className={`font-medium ${sideColor}`}>{isActive ? '▶ ' : ''}{c.name}</span>
                          {c.hp && <span className="text-slate-500 whitespace-nowrap">{c.hp}</span>}
                        </div>
                        {(place || c.notes) && (
                          <div className="text-slate-500">{place}{place && c.notes ? ' — ' : ''}{c.notes ?? ''}</div>
                        )}
                        {c.conditions && c.conditions.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {c.conditions.map((cond) => <Badge key={cond} color="red">{cond}</Badge>)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {battleLog.environment && (
                  <p className="text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-800">{battleLog.environment}</p>
                )}
                <button
                  onClick={() => setBattleLog(null)}
                  className="mt-3 w-full text-xs text-slate-400 hover:text-red-400 border border-slate-700 rounded-lg py-1.5 transition-colors"
                >
                  End battle
                </button>
              </Card>
            )}
          </div>
        </div>
      </div>

      <Dialog open={newCampaignOpen} onClose={() => setNewCampaignOpen(false)} title="New Campaign" wide>
        <p className="text-xs text-slate-400 mb-3">
          This bakes straight into the campaign's CLAUDE.md, so the DM already knows it on session one instead of starting blank. You can always add more later via Notes.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Campaign name</label>
            <input
              autoFocus
              value={newCampaign.name}
              onChange={(e) => setNewCampaign((n) => ({ ...n, name: e.target.value }))}
              placeholder="e.g. Curse of Strahd, or The Sunken City"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">D&D edition</label>
              <select
                value={newCampaign.edition}
                onChange={(e) => setNewCampaign((n) => ({ ...n, edition: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-600"
              >
                <option value="2014">2014 (original 5e)</option>
                <option value="2024">2024 (revised 5e)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Module / scenario</label>
              <input
                value={newCampaign.module}
                onChange={(e) => setNewCampaign((n) => ({ ...n, module: e.target.value }))}
                placeholder="e.g. Lost Mine of Phandelver, or Homebrew"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-600"
              />
            </div>
          </div>

          <div>
            <Button size="sm" variant="outline" onClick={handleImportModuleForNewCampaign} disabled={!!moduleBusy}>
              <Upload size={14} /> {moduleBusyLabel ?? 'Import module file (PDF or text)…'}
            </Button>
            {pendingModuleFile && (
              <p className="text-xs text-emerald-400 mt-1">
                ✓ {pendingModuleFile.name} ({pendingModuleFile.text.length.toLocaleString()} characters) — will be chapterized automatically once the campaign is created.
                <button type="button" onClick={() => setPendingModuleFile(null)} className="ml-2 text-slate-500 hover:text-red-400">
                  ✕ remove
                </button>
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Players &amp; characters</label>
            <textarea
              value={newCampaign.players}
              onChange={(e) => setNewCampaign((n) => ({ ...n, players: e.target.value }))}
              rows={3}
              placeholder={'Alex — Thorin (Fighter)\nSam — Mira (Wizard)'}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-red-600"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Anything else? (tone, house rules, starting situation…)</label>
            <textarea
              value={newCampaign.notes}
              onChange={(e) => setNewCampaign((n) => ({ ...n, notes: e.target.value }))}
              rows={4}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-red-600"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Campaign lore / overarching story</label>
            <p className="text-xs text-slate-500 mb-1">
              The persistent frame this campaign lives in — a home base, recurring NPCs/factions, a slow-burn plot — that stays consistent across whatever self-contained modules/side-quests you import over time. Can be as brief as "homebrew, figure it out" — Claude will still build a serviceable frame from it.
            </p>
            <textarea
              value={newCampaign.lore}
              onChange={(e) => setNewCampaign((n) => ({ ...n, lore: e.target.value }))}
              rows={4}
              placeholder={'e.g. "The party is based out of Phandalin, hired for odd jobs by the Adventurer\'s Guild. A cult of dragon-worshippers works in the shadows..." or just "Homebrew — figure it out from the notes above."'}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-red-600"
            />
            <div className="mt-1.5">
              <Button size="sm" variant="outline" onClick={handleAttachLoreFile} disabled={!!moduleBusy}>
                <Upload size={14} /> {moduleBusyLabel ?? 'Attach official campaign PDF…'}
              </Button>
              {pendingLoreFile && (
                <p className="text-xs text-emerald-400 mt-1">
                  ✓ {pendingLoreFile.name} ({pendingLoreFile.text.length.toLocaleString()} characters) — will be combined with the text above.
                  <button type="button" onClick={() => setPendingLoreFile(null)} className="ml-2 text-slate-500 hover:text-red-400">
                    ✕ remove
                  </button>
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setNewCampaignOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateCampaign} disabled={creatingCampaign || !newCampaign.name.trim()}>
            {moduleBusyLabel ?? (creatingCampaign ? 'Creating…' : 'Create campaign')}
          </Button>
        </div>
      </Dialog>

      <Dialog open={notesOpen} onClose={() => setNotesOpen(false)} title={`${activeCampaignName ?? 'Campaign'} — Notes (CLAUDE.md)`} wide>
        <p className="text-xs text-slate-400 mb-2">
          Persona, house rules, and world lore. Loads fresh into every turn — edit freely.
        </p>
        <textarea
          value={notesText}
          onChange={(e) => setNotesText(e.target.value)}
          rows={20}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-red-600"
        />
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="outline" onClick={() => setNotesOpen(false)}>Cancel</Button>
          <Button onClick={saveNotes} disabled={notesSaving}>{notesSaving ? 'Saving…' : 'Save'}</Button>
        </div>
      </Dialog>

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} title={`${activeCampaignName ?? 'Campaign'} — History`} wide>
        <div className="max-h-[65vh] overflow-y-auto space-y-4">
          <div>
            <p className="text-xs font-bold text-slate-300 mb-1">Session recaps (memory/MEMORY.md)</p>
            <p className="text-xs text-slate-400 mb-2">Appended automatically each time you click "End session" — periodically compressed once it grows large.</p>
            <pre className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 whitespace-pre-wrap">{historyText}</pre>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-300 mb-1">Flagged facts (memory/flagged_facts.md)</p>
            <p className="text-xs text-slate-400 mb-2">Standalone facts flagged as worth remembering (promises, secrets, consequences) — never compacted or summarized away, unlike the recap above.</p>
            <pre className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 whitespace-pre-wrap">{flaggedFactsText}</pre>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-300 mb-1">Entities (memory/entities.md)</p>
            <p className="text-xs text-slate-400 mb-2">Named NPCs/factions/creatures — updated in place, never summarized away.</p>
            <pre className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 whitespace-pre-wrap mb-2">{entitiesText}</pre>
            <Button size="sm" variant="outline" onClick={handleReconcileNpcVoices} disabled={!!moduleBusy}>
              {moduleBusyLabel ?? 'Assign NPC voices'}
            </Button>
            <p className="text-xs text-slate-400 mt-1">
              Runs automatically at "End session" too — this is for assigning them on demand instead of waiting.
            </p>
            {voiceReconcileResult && <p className="text-xs text-emerald-400 mt-1">{voiceReconcileResult}</p>}
          </div>
          <div>
            <p className="text-xs font-bold text-slate-300 mb-1">Narrator voice</p>
            <p className="text-xs text-slate-400 mb-2">
              Auto-picked once, from this campaign's tone, at the moment it was created (see the Lore dialog) — never re-evaluated after that, and campaigns created before this existed never got a pick at all. Set or change it here any time.
            </p>
            <div className="mb-4">{renderVoiceOverrideRow(NARRATOR_VOICE_KEY, 'Narrator')}</div>

            <p className="text-xs font-bold text-slate-300 mb-1">NPC voices</p>
            <p className="text-xs text-slate-400 mb-2">
              The DM's own picks (live or via "Assign NPC voices" above) are a starting point, not final — preview any candidate before committing, or override one you don't like.
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {parseEntityNamesForVoicePanel(entitiesText).map((name) => renderVoiceOverrideRow(name.trim().toLowerCase(), name))}
              {parseEntityNamesForVoicePanel(entitiesText).length === 0 && (
                <p className="text-xs text-slate-500">No named NPCs yet.</p>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-slate-300 mb-1">Locations (memory/locations.md)</p>
            <p className="text-xs text-slate-400 mb-2">Named places and their current state — updated in place.</p>
            <pre className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 whitespace-pre-wrap">{locationsText}</pre>
          </div>
        </div>
        <div className="flex justify-end mt-3">
          <Button variant="outline" onClick={() => setHistoryOpen(false)}>Close</Button>
        </div>
      </Dialog>

      <Dialog open={moduleOpen} onClose={() => setModuleOpen(false)} title={`${activeCampaignName ?? 'Campaign'} — Modules`} wide>
        <p className="text-xs text-slate-400 mb-2">
          Self-contained modules/side-quests imported into this campaign — each import ADDS a module, it never replaces one. Only the active module's current chapter loads every turn; Claude switches modules and advances chapters itself as the story moves, but you can override either here anytime.
        </p>
        <div className="mb-3">
          <Button size="sm" variant="outline" onClick={handleImportModuleForExisting} disabled={!!moduleBusy}>
            <Upload size={14} /> {moduleBusyLabel ?? 'Import another module (PDF or text)…'}
          </Button>
        </div>
        {modulePlan && (
          <div className="mb-3 border border-slate-700 rounded-lg p-2.5 bg-slate-900/60">
            <p className="text-xs font-bold text-slate-300 mb-1">Campaign-arc plan</p>
            <p className="text-xs text-slate-400 whitespace-pre-wrap">{modulePlan}</p>
          </div>
        )}
        {modules.length ? (
          <div className="space-y-3 max-h-[55vh] overflow-y-auto">
            {modules.map((m) => {
              const isActive = m.id === activeModuleId;
              return (
                <div
                  key={m.id}
                  className={`border rounded-lg p-2.5 ${isActive ? 'bg-emerald-900/20 border-emerald-700' : 'bg-slate-900 border-slate-700'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-white">{m.title} {isActive && <span className="text-emerald-400 text-xs font-normal">← active</span>}</p>
                    {!isActive && (
                      <button
                        onClick={() => handleSetActiveModule(m.id)}
                        className="shrink-0 text-xs text-slate-400 hover:text-emerald-400 border border-slate-600 hover:border-emerald-600 rounded px-2 py-0.5 transition-colors"
                      >
                        Set as active
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{m.summary}</p>

                  {isActive && (
                    <div className="mt-2 space-y-1.5 pl-2 border-l-2 border-emerald-800/60">
                      {chapters.map((c, i) => {
                        const isCurrent = c.id === currentChapterId;
                        return (
                          <div key={c.id} className="flex items-start justify-between gap-2">
                            <p className="text-xs text-slate-300">{i + 1}. {c.title} {isCurrent && <span className="text-emerald-400 font-normal">← current</span>}</p>
                            {!isCurrent && (
                              <button
                                onClick={() => handleSetCurrentChapter(c.id)}
                                className="shrink-0 text-xs text-slate-500 hover:text-emerald-400 border border-slate-700 hover:border-emerald-600 rounded px-1.5 py-0.5 transition-colors"
                              >
                                Set as current
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No modules imported yet for this campaign.</p>
        )}
        <div className="flex justify-end mt-3">
          <Button variant="outline" onClick={() => setModuleOpen(false)}>Close</Button>
        </div>
      </Dialog>

      <Dialog open={terrainOpen} onClose={() => setTerrainOpen(false)} title="Terrain Catalog" wide>
        <p className="text-xs text-slate-400 mb-2">
          The physical terrain pieces you own — not tied to any one campaign. List each piece's name, appearance, and what it does mechanically (blocks line of sight, difficult terrain, elevation, cover). Referenced by "Plan next session" below.
        </p>
        <textarea
          value={terrainText}
          onChange={(e) => setTerrainText(e.target.value)}
          className="w-full h-[50vh] bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-red-600"
        />
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="outline" onClick={() => setTerrainOpen(false)}>Cancel</Button>
          <Button onClick={saveTerrain} disabled={terrainSaving}>{terrainSaving ? 'Saving…' : 'Save'}</Button>
        </div>
      </Dialog>

      <Dialog open={planOpen} onClose={() => setPlanOpen(false)} title={`${activeCampaignName ?? 'Campaign'} — Plan Next Session`} wide>
        <p className="text-xs text-slate-400 mb-2">
          Cached once generated — reopening this shows the same plan (and the same battle maps) until you Regenerate or the party advances a chapter, based on the upcoming chapter, the campaign's arc plan, recent memory, and your terrain catalog.
        </p>
        {planLoading ? (
          <div className="py-2">
            <p className="text-sm text-slate-400 mb-1">
              {planProgress?.phase === 'maps'
                ? `Generating battle maps… (${planProgress.done} of ${planProgress.total})`
                : "Thinking through what's coming up…"}
            </p>
            <div className="h-1.5 w-full bg-slate-800 rounded overflow-hidden">
              <div
                className="h-full bg-red-600 transition-all"
                style={{
                  width:
                    planProgress?.phase === 'maps' && planProgress.total > 0
                      ? `${Math.min(100, (planProgress.done / planProgress.total) * 100)}%`
                      : '25%',
                }}
              />
            </div>
          </div>
        ) : !planText ? (
          <div className="text-center py-6">
            <p className="text-sm text-slate-400 mb-3">No plan generated yet for what's coming up.</p>
            <Button onClick={() => generatePlan(false)}>Generate</Button>
          </div>
        ) : (
          <>
            <div className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 whitespace-pre-wrap max-h-[35vh] overflow-y-auto mb-3">{planText}</div>

            {battleMode === 'grid' && (
              <div className="mb-3">
                <h4 className="text-xs font-semibold text-slate-300 mb-2">Battle maps for this plan's encounters</h4>
                {failedMaps.length > 0 && (
                  <p className="text-xs text-amber-400 mb-2">
                    {failedMaps.length} map{failedMaps.length > 1 ? 's' : ''} didn't generate ({failedMaps.join(', ')}) — this set is partial. Try Regenerate.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  <span className="text-xs text-slate-400 mr-1">Tile art:</span>
                  {TILE_STYLES.map((style) => (
                    <button
                      key={style.id}
                      type="button"
                      onClick={() => { setBattleTileStyle(style.id); setActiveTileStyle(style.id); refreshMapCardPreviews(); }}
                      className={`px-2 py-1 rounded-full text-xs border transition-colors ${
                        battleTileStyle === style.id
                          ? 'bg-red-600 border-red-600 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500'
                      }`}
                    >
                      {style.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xs text-slate-400">
                    Tileset library:{' '}
                    {tileLibraryTotal != null
                      ? `${tileLibraryTotal.toLocaleString()} objects imported${tileLibraryRootCount > 1 ? ` (${tileLibraryRootCount} folders)` : ''}`
                      : 'not imported'}
                  </span>
                  {tileLibraryTotal == null ? (
                    <Button size="sm" variant="outline" onClick={() => importTileLibrary(false)} disabled={tileLibraryBusy}>
                      {tileLibraryBusy ? 'Importing…' : 'Import…'}
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => importTileLibrary(true)} disabled={tileLibraryBusy}>
                        {tileLibraryBusy ? 'Importing…' : 'Add another folder…'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => importTileLibrary(false)} disabled={tileLibraryBusy}>
                        {tileLibraryBusy ? 'Importing…' : 'Replace…'}
                      </Button>
                    </>
                  )}
                </div>
                {tileLibraryTotal != null && (
                  <p className="text-xs text-slate-500 mb-2">
                    "Add another folder…" keeps everything already imported; "Replace…" wipes it and starts over with only the new folder. Re-picking the same folder either way just refreshes it, never duplicates.
                  </p>
                )}

                {/* Detected biomes. Every failure this panel exists to catch is
                    SILENT — a pack whose folders aren't recognised still reports
                    "imported ✓" and then resolves nothing, so the only symptom is
                    maps that look like the library was never there. */}
                {tileLibraryTotal != null && packProfile && (
                  <div className="border border-slate-800 rounded-lg mb-3">
                    <button
                      type="button"
                      onClick={() => setProfileOpen((o) => !o)}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
                    >
                      <span className="text-sm text-slate-200">
                        Detected biomes{' '}
                        <span className="text-slate-500">
                          ({packProfile.biomes.length} place{packProfile.biomes.length === 1 ? '' : 's'})
                        </span>
                        {!packProfile.profiled && <span className="ml-2 text-amber-400 text-xs">not profiled — using built-in defaults</span>}
                      </span>
                      <span className="text-slate-500 text-xs">{profileOpen ? '▾' : '▸'}</span>
                    </button>

                    {profileOpen && (
                      <div className="px-3 pb-3">
                        <p className="text-xs text-slate-500 mb-2">
                          How the map resolver reads this pack. {packProfile.profiled
                            ? 'Derived from the pack itself.'
                            : 'These are the built-in Forgotten Adventures defaults — if you imported a different pack, profile it so its own folders are understood.'}{' '}
                          Universal set:{' '}
                          <span className="text-slate-300">{packProfile.universal_biome ?? 'none'}</span> — art from there is never penalised for being off-biome.
                        </p>
                        <Button size="sm" variant="outline" onClick={() => void reprofilePack()} disabled={profileBusy} className="mb-3">
                          {profileBusy ? 'Reading the pack…' : packProfile.profiled ? 'Re-profile this pack' : 'Profile this pack'}
                        </Button>

                        <div className="space-y-2 max-h-[30vh] overflow-y-auto pr-1">
                          {packProfile.biomes.map((b) => (
                            <div key={b.scene} className="flex items-start gap-3 border border-slate-800 rounded p-2">
                              {/* The ground this biome's query actually lands on.
                                  An empty slot is itself the finding. */}
                              {b.ground_thumb ? (
                                <img src={b.ground_thumb} alt="" className="w-12 h-12 rounded object-cover border border-slate-700 shrink-0" />
                              ) : (
                                <div className="w-12 h-12 rounded border border-dashed border-slate-700 shrink-0 flex items-center justify-center text-[10px] text-slate-600 text-center leading-tight">
                                  built-in floor
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="text-sm text-slate-100">
                                  {b.scene} <span className="text-xs text-slate-500">→ {b.folder || '(no biome)'} · {b.tiles.toLocaleString()} tiles</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                  <label className="text-xs text-slate-400">
                                    ground{' '}
                                    <select
                                      value={b.floor_query ?? ''}
                                      onChange={(e) => void editBiome(b.scene, { floor_query: e.target.value || null })}
                                      className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-xs text-slate-200"
                                    >
                                      <option value="">(built-in floor)</option>
                                      {/* Whatever the profile already chose stays
                                          selectable even if it isn't one of this
                                          biome's own measured candidates — `alien`
                                          deliberately borrows another biome's. */}
                                      {[...new Set([...(b.floor_query ? [b.floor_query] : []), ...b.ground_options])].map((w) => (
                                        <option key={w} value={w}>{w}</option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="text-xs text-slate-400 flex items-center gap-1 cursor-pointer select-none">
                                    <input
                                      type="checkbox"
                                      checked={b.natural_walls}
                                      onChange={(e) => void editBiome(b.scene, { natural_walls: e.target.checked })}
                                      className="accent-emerald-600"
                                    />
                                    natural walls
                                  </label>
                                  {b.liquid_query && <span className="text-xs text-slate-500">~ {b.liquid_query}</span>}
                                  {profileEdits.biomes?.[b.scene] && <span className="text-xs text-emerald-400">edited</span>}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {planBusy && (
                  <p className="text-xs text-amber-400 mb-2">
                    {planBusy}
                    {mapProgress && (
                      // The climbing clock is the point: it says "still alive"
                      // through the multi-minute model call that reports nothing.
                      <span className="text-amber-300/70"> {mapProgress.phase} — {formatElapsed(mapProgress.elapsed_s)}</span>
                    )}
                  </p>
                )}

                {[...planMapCards, ...adHocMapCards].length > 0 && (
                  <label className="flex items-center gap-2 mb-2 text-xs text-slate-300 cursor-pointer select-none">
                    <input type="checkbox" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} className="accent-red-600" />
                    Show start-zone overlay (<span className="text-red-400">Enemies</span> / <span className="text-sky-400">Party</span>) — turn off to print a clean map
                  </label>
                )}

                <div className="space-y-3 max-h-[35vh] overflow-y-auto pr-1">
                  {[...planMapCards, ...adHocMapCards].length === 0 && !planBusy && (
                    <p className="text-xs text-slate-500">No combat encounters in this plan called for a map yet.</p>
                  )}
                  {(() => {
                    const planOwnedSlugs = new Set(planMapCards.map((c) => c.slug));
                    return [...planMapCards, ...adHocMapCards].map((card) => (
                    <div key={card.slug} className="border border-slate-800 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div>
                          <div className="text-sm font-medium text-slate-100">{card.name}</div>
                          {card.summary && <div className="text-xs text-slate-500">{card.summary}</div>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {planOwnedSlugs.has(card.slug) && (
                            <Button size="sm" variant="ghost" onClick={() => regenerateOneMap(card)} disabled={!!planBusy}>
                              <RotateCcw size={14} /> Regenerate
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => exportMapPdf(card)} disabled={!!planBusy}><Download size={14} /> PDF</Button>
                          <Button size="sm" variant="outline" onClick={() => exportMapPng(card)} disabled={!!planBusy}><Download size={14} /> PNG</Button>
                        </div>
                      </div>
                      {card.png ? (
                        <img src={card.png} alt={`${card.name} preview`} className="max-w-full rounded-lg border border-slate-700 bg-slate-950" />
                      ) : (
                        <p className="text-xs text-amber-400">This map's grid didn't parse — check the spec below.</p>
                      )}

                      {(() => {
                        const dep = parseDeployment(card.spec);
                        if (!dep.enemies && !dep.party) return null;
                        return (
                          <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs space-y-1">
                            <div className="text-[10px] uppercase tracking-wide text-slate-500">Starting positions — place the minis here</div>
                            {dep.enemies && <div><span className="font-medium text-red-400">Enemies:</span> <span className="text-slate-300">{dep.enemies}</span></div>}
                            {dep.party && <div><span className="font-medium text-sky-400">Party:</span> <span className="text-slate-300">{dep.party}</span></div>}
                          </div>
                        );
                      })()}

                      <details className="mt-2">
                        <summary className="text-xs text-slate-400 cursor-pointer">View / edit the raw spec</summary>
                        <textarea
                          value={card.spec}
                          onChange={(e) => patchMapCardSpec(card.slug, e.target.value, false)}
                          spellCheck={false}
                          className="w-full h-48 mt-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-red-600"
                        />
                        <div className="flex justify-end gap-2 mt-2">
                          <Button size="sm" variant="ghost" onClick={() => patchMapCardSpec(card.slug, card.spec, true)} disabled={!!planBusy}>Re-render preview</Button>
                          <Button size="sm" onClick={() => saveMapEdits(card)} disabled={!!planBusy}>Save edits</Button>
                        </div>
                      </details>
                    </div>
                    ));
                  })()}
                </div>

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <input
                    value={mapEncounterHint}
                    onChange={(e) => setMapEncounterHint(e.target.value)}
                    placeholder="…or describe one more encounter (e.g. 'a bridge ambush by goblins')"
                    className="flex-1 min-w-[16rem] bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-100 focus:outline-none focus:border-red-600"
                  />
                  <Button size="sm" variant="outline" onClick={generateHintMap} disabled={!!planBusy || !mapEncounterHint.trim()}>
                    Generate this
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
        <div className="flex justify-end gap-2 mt-3">
          {planText && (
            <Button variant="outline" onClick={() => generatePlan(true)} disabled={planLoading || !!planBusy}>Regenerate</Button>
          )}
          <Button onClick={() => setPlanOpen(false)}>Close</Button>
        </div>
      </Dialog>

      <Dialog open={dmModelOpen} onClose={() => setDmModelOpen(false)} title="DM Model">
        <p className="text-xs text-slate-400 mb-3">
          Global for this device — switchable any time, including mid-campaign. A local model needs its own reliability tradeoffs in mind: HP/condition changes are still applied automatically, but skipped or clamped entries show up as a warning under the transcript instead of silently vanishing.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Engine</label>
            <select
              value={dmProvider}
              onChange={(e) => setDmProvider(e.target.value as 'claude' | 'local')}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-600"
            >
              <option value="claude">Claude (your subscription)</option>
              <option value="local">Local LLM (Ollama / LM Studio / llama.cpp server…)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Ingestion &amp; memory</label>
            <select
              value={ingestionProvider}
              onChange={(e) => setIngestionProvider(e.target.value as 'claude' | 'local')}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-600"
            >
              <option value="claude">Claude (best quality)</option>
              <option value="local">Local LLM (free, lower quality)</option>
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Which engine handles module import, campaign lore, and the end-of-session memory digest — separate from the live-turn engine above. Local keeps these off your Claude budget, but a smaller model is less reliable on big imports; best for small one-shot content.
            </p>
          </div>
          {(dmProvider === 'local' || ingestionProvider === 'local') && (
            <>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Server address</label>
                <input
                  value={localLlmBaseUrl}
                  onChange={(e) => setLocalLlmBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-red-600"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs text-slate-400">Model</label>
                  <button
                    type="button"
                    onClick={refreshLocalModels}
                    disabled={localModelsLoading}
                    className="text-xs text-slate-400 hover:text-white disabled:opacity-50"
                  >
                    {localModelsLoading ? 'Checking…' : 'Refresh'}
                  </button>
                </div>
                {localModels.length > 0 ? (
                  <select
                    value={localLlmModel}
                    onChange={(e) => setLocalLlmModel(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-red-600"
                  >
                    {!localModels.includes(localLlmModel) && localLlmModel && (
                      <option value={localLlmModel}>{localLlmModel} (current)</option>
                    )}
                    {!localLlmModel && <option value="">Choose a model…</option>}
                    {localModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={localLlmModel}
                    onChange={(e) => setLocalLlmModel(e.target.value)}
                    placeholder="e.g. llama3.2, qwen2.5"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-red-600"
                  />
                )}
                {localModelsError && (
                  <p className="text-xs text-amber-500 mt-1">
                    Couldn't detect models from that server ({localModelsError}) — enter the model name manually.
                  </p>
                )}
              </div>
            </>
          )}
          {dmProvider === 'local' && (
            <>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Conversation memory (turns)</label>
                <input
                  type="number"
                  min={0}
                  value={localLlmHistoryTurns}
                  onChange={(e) => setLocalLlmHistoryTurns(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-red-600"
                />
                <p className="text-xs text-slate-500 mt-1">
                  How many past turns get resent to the local model each time. Unlike Claude, a local model has no lightweight session token — it replays the whole conversation every turn, and most local models have a much smaller context window. Lower this if replies get slow, confused, or error out on a long session.
                </p>
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end mt-4">
          <Button onClick={() => setDmModelOpen(false)}>Done</Button>
        </div>
      </Dialog>

      <Dialog open={voiceEngineOpen} onClose={() => setVoiceEngineOpen(false)} title="Voice Engine">
        <p className="text-xs text-slate-400 mb-3">
          Which engine gives the DM and its NPCs their voices. <span className="text-slate-200">Standard</span> runs on any computer. <span className="text-slate-200">High-quality</span> is a large, GPU-only upgrade with richer, more natural voices — worth it if you have a strong NVIDIA graphics card.
        </p>
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
            <div>
              <p className="text-sm text-slate-100">Standard voices</p>
              <p className="text-xs text-slate-500">Fast, runs anywhere. The default.</p>
            </div>
            {ttsEngine === 'kokoro' && <Badge>Active</Badge>}
          </div>

          <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-slate-100">High-quality voices</p>
                <p className="text-xs text-slate-500">{cudaInfo ? `GPU: ${cudaInfo.name}` : 'Requires an NVIDIA GPU'}</p>
              </div>
              {ttsEngine === 'f5' && <Badge>Active</Badge>}
            </div>

            {ttsEngine === 'f5' ? (
              <p className="text-xs text-emerald-400 mt-2">Enabled. Cannot be disabled once enabled.</p>
            ) : !f5Capable ? (
              <p className="text-xs text-amber-400 mt-2">
                Needs an NVIDIA GPU with at least 6 GB of memory{cudaInfo ? ` (this card reports ${(cudaInfo.vram_mb / 1024).toFixed(0)} GB)` : ''}. Not available on this computer.
              </p>
            ) : f5Installing ? (
              <div className="mt-2">
                <p className="text-xs text-slate-300 mb-1">
                  {f5Progress?.phase === 'extract'
                    ? 'Unpacking…'
                    : f5Progress && f5Progress.total > 0
                      ? `Downloading… ${(f5Progress.downloaded / 1e9).toFixed(2)} / ${(f5Progress.total / 1e9).toFixed(2)} GB`
                      : 'Downloading…'}
                </p>
                <div className="h-1.5 w-full bg-slate-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-red-600 transition-all"
                    style={{ width: f5Progress && f5Progress.total > 0 ? `${Math.min(100, (f5Progress.downloaded / f5Progress.total) * 100)}%` : '25%' }}
                  />
                </div>
              </div>
            ) : (
              <button
                onClick={() => (f5Installed ? handleConfirmInstallF5() : setF5ConfirmOpen(true))}
                className="mt-2 text-xs text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 rounded px-2 py-1 transition-colors"
              >
                {/* Already downloaded (rare: installed but never activated) → enable
                    directly; otherwise gate on the confirm-download modal first. */}
                {f5Installed ? 'Enable high-quality voices' : 'Enable high-quality voices…'}
              </button>
            )}
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <Button onClick={() => setVoiceEngineOpen(false)}>Done</Button>
        </div>
      </Dialog>

      <Dialog open={f5ConfirmOpen} onClose={() => setF5ConfirmOpen(false)} title="Download high-quality voices?">
        <p className="text-sm text-slate-300 mb-3">
          This downloads about <span className="text-slate-100 font-semibold">4&nbsp;GB</span> — the high-quality voice engine and its model — and installs it on this computer. It runs entirely offline afterward.
        </p>
        <p className="text-sm text-amber-400 mb-4">
          Heads up: this <span className="font-semibold">can't be turned off once enabled.</span> Some high-quality voices have no standard equivalent, so switching back could leave NPCs without their assigned voice.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setF5ConfirmOpen(false)}>Cancel</Button>
          <Button onClick={handleConfirmInstallF5}>Download &amp; enable</Button>
        </div>
      </Dialog>

      <Dialog open={hdPromptOpen} onClose={() => setHdPromptOpen(false)} title="This campaign has HD voices">
        <p className="text-sm text-slate-300 mb-4">
          {campaigns.find((c) => c.id === activeCampaignId)?.name || 'This campaign'} has {hdPromptCount === 1 ? '1 NPC' : `${hdPromptCount} NPCs`} voiced with the high-quality archetype voices (orcs, dwarves, and the like). Standard voices still work for them, just without the distinct sound they were given.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setHdPromptOpen(false)}>Not now</Button>
          <Button
            onClick={() => {
              setHdPromptOpen(false);
              if (f5Installed) handleConfirmInstallF5();
              else setF5ConfirmOpen(true);
            }}
          >
            Enable HD voices…
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={connectPromptOpen}
        onClose={handleCancelConnectClaude}
        title={
          nodeNotInstalled
            ? "Node.js needed first"
            : claudeNotInstalled
              ? "Claude Code isn't installed"
              : "Claude isn't connected"
        }
      >
        {nodeNotInstalled ? (
          <>
            <p className="text-sm text-slate-300 mb-4">
              Installing Claude Code needs Node.js, which isn't on this computer. Install it from{' '}
              <span className="text-emerald-400">nodejs.org</span>, then come back and try again.
            </p>
            <div className="flex justify-end">
              <Button variant="outline" onClick={handleCancelConnectClaude}>Close</Button>
            </div>
          </>
        ) : claudeNotInstalled ? (
          <>
            <p className="text-sm text-slate-300 mb-4">
              The DM Console needs the Claude Code CLI installed on this computer, and it couldn't be found. Install it now?
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleCancelConnectClaude} disabled={installing}>Cancel</Button>
              <Button onClick={handleInstallClaude} disabled={installing}>{installing ? 'Installing…' : 'Install now'}</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-300 mb-4">
              Connect now? This opens a terminal window to sign in through your browser.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleCancelConnectClaude} disabled={connecting}>Cancel</Button>
              <Button onClick={handleConnectClaude} disabled={connecting}>{connecting ? 'Waiting for you to finish connecting…' : 'Connect now'}</Button>
            </div>
          </>
        )}
      </Dialog>

      <Dialog open={loreOpen} onClose={() => setLoreOpen(false)} title={`${activeCampaignName ?? 'Campaign'} — Lore`} wide>
        <p className="text-xs text-slate-400 mb-2">
          The persistent frame this campaign lives in — surfaced to the DM periodically, not every turn (see "Plan next session" for how it's used). Fold in new material any time, e.g. a sourcebook picked up mid-campaign: it's merged into the existing doc, not just appended.
        </p>
        <div className="mb-3">
          <p className="text-xs font-bold text-slate-300 mb-1">Currently established</p>
          <pre className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 whitespace-pre-wrap max-h-[35vh] overflow-y-auto">{loreText || '(nothing established yet)'}</pre>
        </div>
        <div className="mb-3">
          <Button size="sm" variant="outline" onClick={handleReconcileCampaignHooks} disabled={!!moduleBusy}>
            {moduleBusyLabel ?? 'Personalize campaign hooks'}
          </Button>
          <p className="text-xs text-slate-400 mt-1">
            Ties any player character's backstory (from memory/party.md) to something already established above — runs automatically at "End session" too, once everyone's connected.
          </p>
          {campaignHooksResult && <p className="text-xs text-emerald-400 mt-1">{campaignHooksResult}</p>}
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Add new material</label>
          <textarea
            value={loreAddition}
            onChange={(e) => setLoreAddition(e.target.value)}
            rows={4}
            placeholder={'e.g. "The party has since made an enemy of the Zhentarim" or paste a new sourcebook\'s lore.'}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-red-600"
          />
          <div className="mt-1.5">
            <Button size="sm" variant="outline" onClick={handleAttachLoreUpdateFile} disabled={!!moduleBusy}>
              <Upload size={14} /> {moduleBusyLabel ?? 'Attach a PDF…'}
            </Button>
            {pendingLoreUpdateFile && (
              <p className="text-xs text-emerald-400 mt-1">
                ✓ {pendingLoreUpdateFile.name} ({pendingLoreUpdateFile.text.length.toLocaleString()} characters) — will be combined with the text above.
                <button type="button" onClick={() => setPendingLoreUpdateFile(null)} className="ml-2 text-slate-500 hover:text-red-400">
                  ✕ remove
                </button>
              </p>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setLoreOpen(false)}>Close</Button>
          <Button onClick={handleUpdateLore} disabled={!!moduleBusy || (!loreAddition.trim() && !pendingLoreUpdateFile)}>
            {moduleBusyLabel ?? 'Fold into campaign lore'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
