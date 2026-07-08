import React from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { ArrowLeft, Mic, Square, Radio, Trash2, BookOpen, ScrollText, FileUp, Plus, Upload, Map, ClipboardList, Cpu, Landmark } from 'lucide-react';
import { Button, Card, Badge, Dialog } from '../../components/ui';
import { usePartyStore } from '../../store/usePartyStore';
import { useCampaignStore } from '../../store/useCampaignStore';
import { useSettingsStore } from '../../store/useSettingsStore';
import { buildTurnPrompt, buildRecapPrompt } from '../../utils/dmPrompt';
import { parseDmReply, applyDmActions, VOICE_CATALOG_IDS, PITCH_TAG_IDS } from '../../utils/dmActions';
import type { HexPosition } from '../../utils/dmActions';
import { startRecording, stopAndTranscribe, warmupSTT, speak, stopSpeaking, prepareSpeech, playPrepared, discardPrepared } from '../../utils/dmSpeech';
import type { PreparedSpeech } from '../../utils/dmSpeech';
import { getRace } from '../../data/races';
import { getClass } from '../../data/classes';
import { getBackground } from '../../data/backgrounds';
import { ALL_SUBCLASSES } from '../../data/subclasses';
import type { Character } from '../../types';

const DM_PORT = 7777;

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

/** Human-readable label per catalog id, for the voice-override panel's
 *  dropdown — purely cosmetic, doesn't affect anything sent to Piper.
 *  "narrator" deliberately excluded: NPCs pick from this list, and
 *  "(narrator default)" is offered as its own separate option instead (see
 *  the panel's <select>) rather than listing "narrator" as if it were just
 *  another NPC voice choice. Keep in sync with VOICE_CATALOG_IDS (imported
 *  from dmActions.ts, which itself mirrors tts.rs's VOICE_CATALOG). */
const VOICE_LABELS: Record<string, string> = {
  'male-us-1': 'American (male 1)',
  'male-us-2': 'American (male 2)',
  'male-us-3': 'American (male 3)',
  'male-us-4': 'American (male 4)',
  'male-us-5': 'American (male 5)',
  'male-gb-1': 'English (male 1)',
  'male-gb-2': 'English (male 2, regional)',
  'male-gb-3': 'English (male 3, regional)',
  'female-us-1': 'American (female 1)',
  'female-us-2': 'American (female 2)',
  'female-us-3': 'American (female 3)',
  'female-us-4': 'American (female 4, regional)',
  'female-gb-1': 'English (female 1)',
  'female-gb-2': 'English (female 2)',
  'female-gb-3': 'English (female 3)',
  'female-gb-4': 'English (female 4, regional)',
  'male-scottish-1': 'Scottish (male 1)',
  'male-scottish-2': 'Scottish (male 2)',
  'female-scottish-1': 'Scottish (female)',
  'male-irish-1': 'Irish (male 1)',
  'male-irish-2': 'Irish (male 2)',
  'female-irish-1': 'Irish (female)',
  'female-welsh-1': 'Welsh (female)',
  'male-northernirish-1': 'Northern Irish (male)',
  'female-northernirish-1': 'Northern Irish (female)',
  'male-australian-1': 'Australian (male)',
  'male-southafrican-1': 'South African (male)',
  'female-southafrican-1': 'South African (female)',
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

/** A fixed sample line for the voice-override panel's Preview button — long
 *  enough to actually hear the voice's character, short enough to preview
 *  quickly. Same text for every voice so previews are comparable. */
const VOICE_PREVIEW_LINE = "Well met, traveler. The road ahead grows dark.";

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

/** Splits an accumulating narration buffer into any newly-complete sentences
 *  plus the remaining (possibly incomplete) tail. A sentence only counts as
 *  complete when its ending punctuation is followed by whitespace — not
 *  just because the buffer happens to end there, since more text may still
 *  be streaming in. Doesn't need to be perfect (abbreviations, decimals,
 *  etc. can occasionally split oddly) — worst case a sentence gets spoken
 *  in two slightly-early pieces, not a correctness issue. */
function extractCompleteSentences(buffer: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let rest = buffer;
  const boundary = /[.!?]+["')\]]?\s+/;
  for (;;) {
    const match = rest.match(boundary);
    if (!match || match.index === undefined) break;
    const end = match.index + match[0].length;
    sentences.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  return { sentences, remainder: rest };
}

/** Matches a leading `[Name]:` NPC-dialogue cue (see BASE_CLAUDE_MD's "Giving
 *  NPCs distinct voices") at the very start of a sentence. */
const SPEAKER_TAG = /^\s*\[([^\]]{1,60})\]:\s*/;

/** Strips a leading `[Name]:` cue from one sentence, returning the cue-free
 *  text plus whichever name it names (or null for plain narration).
 *  Deliberately per-sentence, not sticky across a multi-sentence speech — a
 *  long NPC monologue needs the tag repeated on each sentence to keep
 *  sounding like that NPC; an untagged sentence always falls back to the
 *  narrator voice. BASE_CLAUDE_MD documents this convention to the DM. */
function parseSpeakerTag(sentence: string): { speaker: string | null; text: string } {
  const match = sentence.match(SPEAKER_TAG);
  if (!match) return { speaker: null, text: sentence };
  return { speaker: match[1].trim(), text: sentence.slice(match[0].length) };
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
  const race = getRace(c.raceId)?.name ?? c.raceId;
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
    `Level ${totalLevel} ${race} ${classText}`.trim() + (c.alignment?.trim() ? `, ${c.alignment.trim()}` : '') + (background ? `, ${background} background.` : '.'),
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
  const { dmProvider, setDmProvider, localLlmBaseUrl, setLocalLlmBaseUrl, localLlmModel, setLocalLlmModel } = useSettingsStore();

  const [listening, setListening] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [dmModelOpen, setDmModelOpen] = React.useState(false);
  const [lanIp, setLanIp] = React.useState<string | null>(null);
  const [sttReady, setSttReady] = React.useState(false);

  const [campaigns, setCampaigns] = React.useState<CampaignMeta[]>([]);
  const [newCampaignOpen, setNewCampaignOpen] = React.useState(false);
  const [newCampaign, setNewCampaign] = React.useState<CampaignIntake>(BLANK_INTAKE);
  const [pendingModuleFile, setPendingModuleFile] = React.useState<{ name: string; text: string } | null>(null);
  const [pendingLoreFile, setPendingLoreFile] = React.useState<{ name: string; text: string } | null>(null);
  const [moduleBusy, setModuleBusy] = React.useState<string | null>(null);
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
  const [planOpen, setPlanOpen] = React.useState(false);
  const [planText, setPlanText] = React.useState('');
  const [planLoading, setPlanLoading] = React.useState(false);
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
  // The active campaign's module/plan.md, fetched once per campaign switch —
  // NOT re-read every turn (see dmPrompt.ts's planCheckIn doc comment for why).
  // Starts each sitting/campaign "due" (Infinity) so the very first turn
  // includes it; reset to due again on a chapter change or a new sitting.
  const campaignPlanRef = React.useRef('');
  const turnsSincePlanCheckRef = React.useRef(Infinity);
  // name (lowercased) → voice assignment for this campaign's NPCs (see
  // campaign.rs's npc_voices.json) — fetched once per campaign switch, same
  // "not re-read every turn" shape as campaignPlanRef, and updated locally
  // the instant a turn's rememberEntity assigns a new one (see runTurn) so
  // that NPC's voice is usable on their very next line without waiting for a
  // re-fetch. Field names mirror campaign.rs's NpcVoiceAssignment struct
  // as-is (snake_case) — no serde rename_all anywhere in this codebase, same
  // convention as ChapterizeImportResult's module_id/module_title.
  const npcVoicesRef = React.useRef<Record<string, { voice_id: string; pitch?: string }>>({});
  // State mirror of npcVoicesRef, purely so the History dialog's voice-
  // preview/override panel re-renders when an assignment changes — the ref
  // above stays the source of truth for the hot playback path (enqueueSentence
  // reads a ref, not state, to avoid a re-render on every spoken line).
  const [npcVoices, setNpcVoices] = React.useState<Record<string, { voice_id: string; pitch?: string }>>({});
  // Per-NPC-name pending edits in the voice-override panel, keyed the same
  // way as npcVoices (lowercased name) — separate from npcVoices itself so
  // an in-progress edit isn't clobbered by an unrelated npcVoices refresh
  // (e.g. a live turn assigning some other NPC's voice) before it's saved.
  const [voiceEdits, setVoiceEdits] = React.useState<Record<string, { voiceId: string; pitch: string }>>({});
  // Which row's Preview button is currently playing (disables that button
  // and prevents overlapping playback) — null when nothing's previewing.
  const [previewingKey, setPreviewingKey] = React.useState<string | null>(null);
  // Ephemeral hex-position tracking for the current encounter (axial q,r per
  // combatant, PC or monster/NPC — not stored in Character, not persisted to
  // disk). Claude reports updates via dm-actions `position`/`clearPositions`
  // (see dmActions.ts, campaign.rs's "Physical hex-grid positioning" section);
  // fed back every turn as ground truth via dmPrompt.ts's battleMapStatusText.
  const [battleMap, setBattleMap] = React.useState<Record<string, HexPosition>>({});
  const battleMapRef = React.useRef(battleMap);
  battleMapRef.current = battleMap;

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
  const sentenceQueueRef = React.useRef<{ text: string; voiceId?: string; pitch?: string }[]>([]);
  const drainingPromiseRef = React.useRef<Promise<void> | null>(null);
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

  /** Resolves a `[Name]:` speech tag to its stored voice assignment.
   *  npc_voices.json keys off the NPC's *full* name as given to rememberEntity
   *  (e.g. "gundren rockseeker"), but BASE_CLAUDE_MD's own worked example tags
   *  dialogue with just the first name (`[Gundren]:`) — an exact-key-only
   *  lookup would silently miss every such tag and fall back to the narrator
   *  voice, defeating the feature for what's actually the natural, common
   *  case. Falls back to matching the tag against the first word of a stored
   *  key when there's no exact match, mirroring dmActions.ts's findIndex
   *  prefix-match tolerance for character names. */
  function resolveVoiceAssignment(speaker: string | null): { voice_id: string; pitch?: string } | undefined {
    if (!speaker) return npcVoicesRef.current[NARRATOR_VOICE_KEY];
    const key = speaker.trim().toLowerCase();
    if (npcVoicesRef.current[key]) return npcVoicesRef.current[key];
    const firstNameMatch = Object.entries(npcVoicesRef.current).find(([storedKey]) => storedKey.split(' ')[0] === key);
    return firstNameMatch?.[1];
  }

  function enqueueSentence(sentence: string) {
    const { speaker, text } = parseSpeakerTag(sentence);
    if (!text.trim()) return;
    const assignment = resolveVoiceAssignment(speaker);
    sentenceQueueRef.current.push({ text, voiceId: assignment?.voice_id, pitch: assignment?.pitch });
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
          const current = prepared ?? (await prepareSpeech(next.text, next.voiceId, next.pitch));
          prepared = null;

          const upcoming = sentenceQueueRef.current[0];
          const lookahead = upcoming ? prepareSpeech(upcoming.text, upcoming.voiceId, upcoming.pitch) : null;

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

  React.useEffect(() => {
    turnsSincePlanCheckRef.current = Infinity;
    if (!activeCampaignId) {
      campaignPlanRef.current = '';
      npcVoicesRef.current = {};
      setNpcVoices({});
      return;
    }
    invoke<string>('read_campaign_plan', { id: activeCampaignId })
      .then((plan) => { campaignPlanRef.current = plan; })
      .catch(() => { campaignPlanRef.current = ''; });
    invoke<Record<string, { voice_id: string; pitch?: string }>>('read_npc_voices', { id: activeCampaignId })
      .then((voices) => {
        npcVoicesRef.current = voices;
        setNpcVoices(voices);
        // Pre-warm this campaign's already-assigned NPC voices (not just the
        // narrator, which warmup_piper already covers at app mount) — the
        // pool self-manages capacity (see tts.rs's acquire_piper/LRU
        // eviction), so it's fine to fire one request per distinct voice_id
        // without pre-filtering to a count; a campaign with more assigned
        // voices than warm slots just means the pool settles on whichever
        // ones actually got used most recently, same as it would anyway.
        // Fire-and-forget: a failure here just means that NPC's first real
        // line this sitting pays the one-time spawn cost instead.
        const distinctVoiceIds = new Set(Object.values(voices).map((v) => v.voice_id));
        for (const voiceId of distinctVoiceIds) {
          invoke('warmup_voice', { voiceId }).catch((e) => console.warn(`Voice warmup failed for "${voiceId}" (will retry on first use):`, e));
        }
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
    if (dmProvider === 'claude') {
      ensureClaudeConnected().then((connected) => {
        if (!connected) return;
        invoke('warmup_dm_session', { campaignId: activeCampaignId }).catch((e) =>
          console.warn('DM session warmup failed (first turn will just be slower):', e)
        );
      });
    }
  }, [activeCampaignId]);

  // Start the LAN listener + resolve this machine's LAN IP once, on mount.
  React.useEffect(() => {
    invoke<number>('start_party_listener', { port: DM_PORT }).catch((e) =>
      setError(`Couldn't start the LAN listener: ${e}`)
    );
    invoke<string | null>('local_lan_ip').then(setLanIp).catch(() => setLanIp(null));
    warmupSTT().then(() => setSttReady(true)).catch((e) => setError(`Speech recognition failed to load: ${e.message || e}`));
    invoke<CampaignMeta[]>('list_campaigns').then(setCampaigns).catch((e) => setError(`Couldn't load campaigns: ${e}`));
    // Starts the persistent Piper process ahead of the first real turn, so
    // that turn doesn't also pay the one-time process-spawn cost.
    invoke('warmup_piper').catch((e) => console.warn('Piper warmup failed (will retry on first use):', e));
  }, []);

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
    let unlisten: (() => void) | undefined;
    listen<Character>('dm-party-character', (event) => {
      upsert(event.payload);
      syncPartyMemberToCampaign(event.payload);
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, [upsert]);

  // Streamed narration chunks from the current Claude turn (see dm.rs's
  // run_claude_streaming) — only one turn ever runs at a time (processingRef
  // gating in handleTalkToggle/drainQueue), so a single shared buffer here is
  // safe. Local LLM turns never fire this event at all.
  React.useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>('dm-narration-chunk', (event) => {
      if (suppressNarrationRef.current) return;
      streamedAnyChunkRef.current = true;
      narrationBufferRef.current += event.payload;
      const { sentences, remainder } = extractCompleteSentences(narrationBufferRef.current);
      narrationBufferRef.current = remainder;
      for (const sentence of sentences) enqueueSentence(sentence);
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Receive spoken lines pushed from a player's own device (TalkToDMButton).
  React.useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<PlayerTurn>('dm-player-turn', (event) => {
      queueRef.current.push(event.payload);
      drainQueue();
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      enqueueSentence(CAMPAIGN_BUILDING_MESSAGE);
      if (drainingPromiseRef.current) await drainingPromiseRef.current;
      return { narration: CAMPAIGN_BUILDING_MESSAGE, interrupted: false, error: null };
    }

    narrationBufferRef.current = '';
    streamedAnyChunkRef.current = false;
    suppressNarrationRef.current = false;
    spokenThisTurnRef.current = [];
    // Consume any pending "the previous reply was cut off, here's what was
    // actually heard" note exactly once — see interruptedTurnRef's doc comment.
    const interruption = interruptedTurnRef.current ?? undefined;
    interruptedTurnRef.current = null;
    try {
      const dueForPlanCheck = !!campaignPlanRef.current && turnsSincePlanCheckRef.current >= PLAN_CHECK_INTERVAL;
      const prompt = buildTurnPrompt({
        party: partyRef.current,
        spokenText,
        speaker,
        planCheckIn: dueForPlanCheck ? campaignPlanRef.current : undefined,
        battleMap: battleMapRef.current,
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
      // Strip any [Name]: voice cues before this reaches a human anywhere —
      // they're a TTS-only signal (see parseSpeakerTag). The raw `narration`
      // (cues intact) is kept for the local-LLM enqueue fallback further
      // below, which still needs to detect them for voice selection.
      const displayNarration = stripSpeakerTagsForDisplay(narration);
      setTurns((t) => [...t, { who: 'dm', text: displayNarration }]);
      setWarning(parseWarnings.length ? parseWarnings.join(' ') : null);

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
            if (voiceId) {
              // Update the local cache immediately (not just after the next
              // campaign switch's read_npc_voices fetch) so this NPC's voice
              // is usable the moment they speak again, even later this same
              // turn's remaining narration.
              npcVoicesRef.current = { ...npcVoicesRef.current, [name.toLowerCase()]: { voice_id: voiceId, pitch } };
              setNpcVoices(npcVoicesRef.current);
              await invoke('set_npc_voice', { id: campaignId, name, voiceId, pitch }).catch((e) =>
                console.warn('Failed to save an NPC voice assignment:', e)
              );
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
          await invoke('set_current_chapter', { id: campaignId, chapterId: actions.advanceToChapter }).catch((e) =>
            console.warn('Failed to advance chapter:', e)
          );
          // A chapter just turned over — make sure the *next* turn re-checks
          // the plan instead of waiting out the rest of the interval.
          turnsSincePlanCheckRef.current = Infinity;
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
          await invoke('set_active_module', { id: campaignId, moduleId: actions.switchActiveModule }).catch((e) =>
            console.warn('Failed to switch active module:', e)
          );
          setActiveModuleId(actions.switchActiveModule);
          // A module switch is at least as big a context shift as a chapter
          // change — force the next turn to re-check the plan.
          turnsSincePlanCheckRef.current = Infinity;
        }
        if (actions.clearPositions) {
          setBattleMap({});
        } else if (actions.position?.length) {
          setBattleMap((bm) => {
            const next = { ...bm };
            for (const p of actions.position!) next[p.name] = { q: p.q, r: p.r };
            return next;
          });
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
        const prompt = buildRecapPrompt(partyRef.current);
        // Not part of the live back-and-forth (fires once, at session end),
        // but a plain summarization task same as an ordinary turn — no
        // reason to pay for extra deliberation here either.
        const reply = await callDm(prompt, sessionIdRef.current, campaignId, 'low');
        const { narration } = parseDmReply(reply.text);
        const date = new Date().toISOString().slice(0, 10);
        await invoke('append_session_recap', { id: campaignId, date, recap: narration });
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
        await invoke<Record<string, { voice_id: string; pitch?: string }>>('read_npc_voices', { id: campaignId })
          .then((voices) => { npcVoicesRef.current = voices; setNpcVoices(voices); })
          .catch(() => {});
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
    setBattleMap({}); // positions are per-sitting/per-campaign, never persisted to disk
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
        try {
          const result = await withClaudeReconnect(() =>
            invoke<ChapterizeImportResult>('chapterize_and_import_module', { id: meta.id, text: pendingModuleFile.text })
          );
          if (result.concerns.length) setWarning(result.concerns.join(' '));
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setModuleBusy(null);
        }
      }
      setNewCampaign(BLANK_INTAKE);
      setPendingModuleFile(null);
      setPendingLoreFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingCampaign(false);
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
      const result = await withClaudeReconnect(() =>
        invoke<ChapterizeImportResult>('chapterize_and_import_module', { id: activeCampaignId, text: picked.text })
      );
      const campaignModules = await invoke<{ modules: ModuleSummary[]; active_id: string | null }>('list_campaign_modules', { id: activeCampaignId });
      setModules(campaignModules.modules);
      setActiveModuleId(campaignModules.active_id);
      setChapters(result.chapters);
      setCurrentChapterId(result.chapters[0]?.id ?? null);
      const allConcerns = [picked.concern, ...result.concerns].filter((c): c is string => Boolean(c));
      if (allConcerns.length) setWarning(allConcerns.join(' '));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setModuleBusy(null);
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
        invoke<Record<string, { voice_id: string; pitch?: string }>>('read_npc_voices', { id: activeCampaignId }),
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
      const voices = await invoke<Record<string, { voice_id: string; pitch?: string }>>('read_npc_voices', { id: activeCampaignId });
      npcVoicesRef.current = voices;
      setNpcVoices(voices);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setModuleBusy(null);
    }
  }

  /** Plays VOICE_PREVIEW_LINE through a candidate voice/pitch — reuses
   *  dmSpeech's speak() directly rather than hand-rolling playback, same
   *  Piper-with-browser-speechSynthesis-fallback path a real turn uses. Not
   *  tied to any NPC or saved anywhere; purely "let the DM hear this pick
   *  before committing to it" (see the voice-override panel in the History
   *  dialog). Disabled while a turn is actively speaking (see the panel's
   *  `disabled={busy}`) since speak() shares dmSpeech's single currentAudio
   *  slot with the live playback queue — previewing mid-turn would fight
   *  over the same audio element. `key` disables just this row's button
   *  while its own preview plays; unrelated rows stay usable. */
  async function handlePreviewVoice(key: string, voiceId: string, pitch: string) {
    if (previewingKey) return;
    setPreviewingKey(key);
    try {
      await speak(VOICE_PREVIEW_LINE, voiceId, pitch || undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewingKey(null);
    }
  }

  /** Persists a manual voice/pitch override for one NPC — the same
   *  set_npc_voice command rememberEntity's live assignment already uses
   *  (campaign.rs doesn't distinguish "the DM picked this" from "a human
   *  overrode it," so this is a normal, permanent assignment afterward, not
   *  a special pinned state). Updates both npcVoicesRef (the hot playback
   *  path) and npcVoices (the panel's own display) immediately, same as
   *  every other npc_voices.json write site in this file. */
  async function handleSaveVoiceOverride(name: string, voiceId: string, pitch: string) {
    if (!activeCampaignId || !voiceId) return;
    const pitchArg = pitch || undefined;
    try {
      await invoke('set_npc_voice', { id: activeCampaignId, name, voiceId, pitch: pitchArg });
      const updated = { ...npcVoicesRef.current, [name.trim().toLowerCase()]: { voice_id: voiceId, pitch: pitchArg } };
      npcVoicesRef.current = updated;
      setNpcVoices(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
   *  ahead of actually playing). Read-only: makes one Claude call, no state
   *  changes to the campaign or terrain catalog. */
  async function openPlanMode() {
    if (!activeCampaignId) return;
    setPlanOpen(true);
    setPlanLoading(true);
    setPlanText('');
    try {
      const suggestion = await invoke<string>('suggest_session_plan', { id: activeCampaignId });
      setPlanText(suggestion);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPlanOpen(false);
    } finally {
      setPlanLoading(false);
    }
  }

  async function openLore() {
    if (!activeCampaignId) return;
    try {
      const content = await invoke<string>('read_campaign_lore', { id: activeCampaignId });
      setLoreText(content);
      setLoreAddition('');
      setPendingLoreUpdateFile(null);
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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setModuleBusy(null);
    }
  }

  const activeCampaignName = campaigns.find((c) => c.id === activeCampaignId)?.name;
  const moduleBusyLabel = moduleBusy
    ? `${moduleBusy} (${formatElapsed(Math.floor((Date.now() - moduleBusyStartRef.current) / 1000))})`
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

          <Button size="sm" variant="ghost" onClick={openTerrain} title="Your catalog of physical terrain pieces (not tied to any one campaign)">
            <Map size={14} /> Terrain
          </Button>

          <Button size="sm" variant="ghost" onClick={() => setDmModelOpen(true)} title="Which engine runs the DM — Claude or a local LLM">
            <Cpu size={14} /> DM Model{dmProvider === 'local' ? ' (Local)' : ''}
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
              <Button size="sm" variant="ghost" onClick={openPlanMode} title="Suggest terrain to set up (or print) for your next session — usable days ahead">
                <ClipboardList size={14} /> Plan next session
              </Button>
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
                  const hpPct = c.maxHP > 0 ? Math.round((c.currentHP / c.maxHP) * 100) : 0;
                  return (
                    <div key={c.id} className="bg-slate-900 border border-slate-700 rounded-lg p-2 group relative">
                      <button
                        onClick={() => remove(c.id)}
                        className="absolute top-1.5 right-1.5 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Remove from table"
                      >
                        <Trash2 size={12} />
                      </button>
                      <p className="text-sm font-bold text-white pr-4">{c.name}</p>
                      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden my-1">
                        <div
                          className={`h-full rounded-full ${hpPct > 50 ? 'bg-green-500' : hpPct > 25 ? 'bg-yellow-500' : 'bg-red-500'}`}
                          style={{ width: `${hpPct}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-slate-400">{c.currentHP}/{c.maxHP} HP</p>
                      {c.conditions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.conditions.map((cond) => <Badge key={cond} color="red">{cond}</Badge>)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            {Object.keys(battleMap).length > 0 && (
              <Card className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-bold text-slate-300 flex items-center gap-1.5"><Map size={14} /> Battle Map</h2>
                  <button onClick={() => setBattleMap({})} title="Clear tracked positions" className="text-slate-500 hover:text-red-400 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mb-2">Claude's own hex bookkeeping (axial q,r) — for your reference only; it narrates placement in relative terms, not these coordinates.</p>
                <div className="space-y-1">
                  {Object.entries(battleMap).map(([name, { q, r }]) => (
                    <div key={name} className="flex justify-between text-xs">
                      <span className="text-slate-300">{name}</span>
                      <span className="text-slate-500 font-mono">({q},{r})</span>
                    </div>
                  ))}
                </div>
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
            <p className="text-xs font-bold text-slate-300 mb-1">NPC voices</p>
            <p className="text-xs text-slate-400 mb-2">
              The DM's own picks (live or via "Assign NPC voices" above) are a starting point, not final — preview any candidate before committing, or override one you don't like.
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {parseEntityNamesForVoicePanel(entitiesText).map((name) => {
                const key = name.trim().toLowerCase();
                const current = npcVoices[key];
                const edit = voiceEdits[key] ?? { voiceId: current?.voice_id ?? '', pitch: current?.pitch ?? '' };
                const previewKey = `${key}|${edit.voiceId}|${edit.pitch}`;
                return (
                  <div key={name} className="flex flex-wrap items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2">
                    <span className="text-sm text-slate-100 min-w-[9rem]">{name}</span>
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
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!edit.voiceId || previewingKey !== null || busy}
                      onClick={() => handlePreviewVoice(previewKey, edit.voiceId, edit.pitch)}
                    >
                      {previewingKey === previewKey ? 'Playing…' : 'Preview'}
                    </Button>
                    <Button
                      size="sm"
                      disabled={!edit.voiceId || busy}
                      onClick={() => handleSaveVoiceOverride(name, edit.voiceId, edit.pitch)}
                    >
                      Save
                    </Button>
                  </div>
                );
              })}
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
          {dmProvider === 'local' && (
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
                <label className="block text-xs text-slate-400 mb-1">Model name</label>
                <input
                  value={localLlmModel}
                  onChange={(e) => setLocalLlmModel(e.target.value)}
                  placeholder="e.g. llama3.2, qwen2.5"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-red-600"
                />
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end mt-4">
          <Button onClick={() => setDmModelOpen(false)}>Done</Button>
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

      <Dialog open={planOpen} onClose={() => setPlanOpen(false)} title={`${activeCampaignName ?? 'Campaign'} — Plan Next Session`} wide>
        <p className="text-xs text-slate-400 mb-2">
          A read-only suggestion based on the upcoming chapter, the campaign's arc plan, recent memory, and your terrain catalog — safe to check days ahead of actually playing.
        </p>
        {planLoading ? (
          <p className="text-sm text-slate-400">Thinking through what's coming up…</p>
        ) : (
          <div className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 whitespace-pre-wrap max-h-[60vh] overflow-y-auto">{planText}</div>
        )}
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="outline" onClick={openPlanMode} disabled={planLoading}>Regenerate</Button>
          <Button onClick={() => setPlanOpen(false)}>Close</Button>
        </div>
      </Dialog>
    </div>
  );
}
