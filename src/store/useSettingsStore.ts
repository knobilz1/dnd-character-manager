import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * App-wide UI/feature settings (persisted to localStorage).
 *
 * `show3DCharacter` gates the experimental 3D character viewport (Phase 0 spike).
 * Default OFF so existing users are unaffected and the heavy three/R3F chunk is
 * never loaded unless explicitly enabled.
 */
interface SettingsState {
  show3DCharacter: boolean;
  setShow3DCharacter: (v: boolean) => void;
  /** LAN address of the DM bot (dnd-dm server), e.g. "192.168.1.50" or
   *  "192.168.1.50:7777". Empty until the player sets it for game night. */
  dmIp: string;
  setDmIp: (v: string) => void;
  /** Tonight's table PIN, shown in the DM Console for the DM to read out. Sent
   *  as `X-Tavern-Pin` on every DM request except the reachability probe — see
   *  utils/dmConnect.ts. The DM's listener mints a new one each app run, so
   *  this is expected to go stale between sessions; a wrong or empty PIN comes
   *  back as a 401 telling the player to ask for tonight's. */
  dmPin: string;
  setDmPin: (v: string) => void;
  /** DM SIDE ONLY: whether this machine's listener demands the PIN. Default true.
   *  The Rust flag it drives lives in memory and resets to ON every app start, so
   *  the DM console re-applies this on mount — a gate that silently stayed off
   *  across restarts because of a forgotten setting would be worse than one that
   *  occasionally has to be switched off again. See party_listener.rs PIN_REQUIRED. */
  dmPinRequired: boolean;
  setDmPinRequired: (v: boolean) => void;
  /** DM SIDE ONLY: whether one player may hold the "table controller" role and
   *  drive a fixed set of console buttons from their sheet. Default true — the
   *  Rust gate itself resets OFF each app start and the console re-applies this
   *  persisted value on mount (same stance as dmPinRequired above), so a fresh
   *  install lands on-by-default rather than every table having to discover and
   *  flip the checkbox before a player can use the feature at all. */
  dmRemoteControlEnabled: boolean;
  setDmRemoteControlEnabled: (v: boolean) => void;
  /** Which speaker/output device DM voice audio plays through (both Kokoro/F5
   *  `<audio>` playback and the browser-TTS fallback where supported — see
   *  dmSpeech.ts's applyAudioOutputDevice). Empty = system default. Persisted
   *  per-device like tableCameraDeviceId, since a DM's rig (speakers vs. a
   *  headset vs. an HDMI monitor with no speakers) doesn't change session to
   *  session the way campaigns do. */
  dmAudioOutputDeviceId: string;
  setDmAudioOutputDeviceId: (v: string) => void;
  /** Ids of characters that have been sent to the DM at least once (via the
   *  "Send to DM"/"Send All" buttons). Marks a character as "connected" —
   *  see hooks/useDmPushSync.ts, which auto-pushes further edits only for
   *  characters in this set, so configuring a DM address doesn't silently
   *  start broadcasting every character in the library. */
  dmSyncedCharacterIds: string[];
  addDmSyncedCharacter: (id: string) => void;
  /** Which engine runs the DM Console — the `claude` CLI subscription, or a
   *  locally-hosted LLM speaking the OpenAI-compatible /v1/chat/completions
   *  API (Ollama, LM Studio, llama.cpp server, koboldcpp all support this).
   *  Global for the device, changeable any time (see hooks/dm.rs's
   *  ask_dm_local/local_llm.rs). */
  /** `codex` and `gemini` join `claude` as SUBSCRIPTION engines — each runs via
   *  that vendor's own CLI against a plan the user already pays for, never a
   *  per-token API key (see cli_provider.rs). `local` remains the only
   *  self-hosted option. Adding members needs no persist migration: every
   *  previously stored value is still valid. */
  dmProvider: 'claude' | 'local' | 'codex' | 'gemini';
  setDmProvider: (v: 'claude' | 'local' | 'codex' | 'gemini') => void;
  localLlmBaseUrl: string;
  setLocalLlmBaseUrl: (v: string) => void;
  localLlmModel: string;
  setLocalLlmModel: (v: string) => void;
  /** How many past user+DM turns to resend as conversational history on a
   *  local-LLM turn (local_llm.rs's trim_history) — local models resend the
   *  whole transcript every turn (no lightweight session token like Claude's
   *  --resume) and typically have far smaller context windows, so this
   *  bounds it. Claude-only sessions ignore this entirely. */
  localLlmHistoryTurns: number;
  setLocalLlmHistoryTurns: (v: number) => void;
  /** Which engine runs one-shot INGESTION/memory work (module import,
   *  campaign lore, the session digest, compaction) — SEPARATE from dmProvider
   *  (the live-turn engine), so quality Claude turns can pair with cheap local
   *  ingestion, or vice versa. 'claude' (default) keeps ingestion on the
   *  subscription; 'local' routes it to the same local server the live-turn
   *  local path uses (see local_llm.rs's set_ingestion_provider/ask_ingest_once).
   *  Best for small throwaway one-shot campaigns where ingestion quality matters
   *  less than not spending Claude budget. */
  ingestionProvider: 'claude' | 'local' | 'codex' | 'gemini';
  setIngestionProvider: (v: 'claude' | 'local' | 'codex' | 'gemini') => void;
  /** Use more than one engine to check the work of the primary one.
   *
   *  OFF by default and deliberately opt-in: it spends a second engine's quota
   *  on every checked operation, and rate limits — not money — are the real
   *  constraint on a subscription plan. What it buys is DISAGREEMENT: a board
   *  read that two engines place differently is flagged instead of silently
   *  wrong, and a campaign-lore draft is critiqued by a model that didn't write
   *  it. See cli_provider.rs and the multi-llm-plan memory. */
  crossCheckEnabled: boolean;
  setCrossCheckEnabled: (v: boolean) => void;
  /** Which engines review the primary's work. Never includes the primary — a
   *  model checking itself shares its own blind spots, which is the entire
   *  thing this exists to avoid. */
  crossCheckEngines: Array<'claude' | 'codex' | 'gemini'>;
  setCrossCheckEngines: (v: Array<'claude' | 'codex' | 'gemini'>) => void;
  /** Which engine synthesizes the DM/NPC voices. 'kokoro' (default) is the
   *  fast, CPU, always-available preset-voice engine; 'f5' is the optional
   *  high-fidelity GPU voice-cloning engine (see src-tauri/src/tts.rs). ONE-WAY
   *  by design: once 'f5', it stays 'f5' — future F5-only voices have no Kokoro
   *  equivalent, so a revert would strand any NPC assigned one (the Voice Engine
   *  panel enforces this). The Rust side mirrors this via the set_tts_engine
   *  command; this persisted value is the source of truth, re-synced on mount. */
  ttsEngine: 'kokoro' | 'f5';
  setTtsEngine: (v: 'kokoro' | 'f5') => void;
  /** Which sprite art battle maps render with (see battleMapRender.ts's
   *  TILE_STYLES / setActiveTileStyle). Replaced the old AI img2img
   *  atmosphere pass (ComfyUI/Gemini) entirely — that pass never saw the
   *  actual grid content, was slow, and gave inconsistent results per map;
   *  a real sprite tileset the DM never has to wait on is the whole map,
   *  every time, deterministically. */
  battleTileStyle: string;
  setBattleTileStyle: (v: string) => void;
  /** Source folder last picked for a battle-map tile import — remembered for
   *  display only. Rust copies the art into Tavern Sheet's private app-data
   *  library and builds its manifest there; it is never committed or bundled
   *  into the public installer. `null` (the default, and every install before this feature)
   *  means map generation never even mentions the Objects: layer. */
  tileLibraryPath: string | null;
  setTileLibraryPath: (v: string | null) => void;
  /** Where a "read the board" photo of the physical table comes from (#39):
   *  'off' = nowhere, and the console says nothing about photos at all;
   *  'direct' = a camera on this (the DM's) machine; 'player' = the table is in
   *  the players' room, so whichever player holds the table-camera role takes it
   *  and pushes it over the LAN. Only meaningful on the DM's device.
   *
   *  'off' is the default and the whole feature is opt-in from there: a table
   *  most groups play at has no camera pointed at it, and a console that offers
   *  to photograph the board implies the DM is meant to. Nothing downstream
   *  depends on this — dmPrompt.ts never mentions cameras, so the DM itself has
   *  no idea the feature exists either way. */
  tableCameraSource: 'off' | 'direct' | 'player';
  setTableCameraSource: (v: 'off' | 'direct' | 'player') => void;
  /** Which local camera to use when tableCameraSource is 'direct'. Remembered so
   *  a DM with a webcam AND an overhead table cam doesn't re-pick every session.
   *  Empty = whatever the browser gives us first. */
  tableCameraDeviceId: string;
  setTableCameraDeviceId: (v: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      show3DCharacter: true,
      setShow3DCharacter: (v) => set({ show3DCharacter: v }),
      dmIp: '',
      setDmIp: (v) => set({ dmIp: v }),
      dmPin: '',
      setDmPin: (v) => set({ dmPin: v.trim().toUpperCase() }),
      dmPinRequired: true,
      setDmPinRequired: (v) => set({ dmPinRequired: v }),
      dmRemoteControlEnabled: true,
      setDmRemoteControlEnabled: (v) => set({ dmRemoteControlEnabled: v }),
      dmSyncedCharacterIds: [],
      addDmSyncedCharacter: (id) => {
        if (get().dmSyncedCharacterIds.includes(id)) return;
        set((s) => ({ dmSyncedCharacterIds: [...s.dmSyncedCharacterIds, id] }));
      },
      dmProvider: 'claude',
      setDmProvider: (v) => set({ dmProvider: v }),
      localLlmBaseUrl: 'http://localhost:11434',
      setLocalLlmBaseUrl: (v) => set({ localLlmBaseUrl: v }),
      localLlmModel: '',
      setLocalLlmModel: (v) => set({ localLlmModel: v }),
      localLlmHistoryTurns: 12,
      setLocalLlmHistoryTurns: (v) => set({ localLlmHistoryTurns: v }),
      ingestionProvider: 'claude',
      setIngestionProvider: (v) => set({ ingestionProvider: v }),
      crossCheckEnabled: false,
      setCrossCheckEnabled: (v) => set({ crossCheckEnabled: v }),
      crossCheckEngines: [],
      setCrossCheckEngines: (v) => set({ crossCheckEngines: v }),
      ttsEngine: 'kokoro',
      setTtsEngine: (v) => set({ ttsEngine: v }),
      battleTileStyle: 'default',
      setBattleTileStyle: (v) => set({ battleTileStyle: v }),
      tileLibraryPath: null,
      setTileLibraryPath: (v) => set({ tileLibraryPath: v }),
      tableCameraSource: 'off',
      setTableCameraSource: (v) => set({ tableCameraSource: v }),
      tableCameraDeviceId: '',
      setTableCameraDeviceId: (v) => set({ tableCameraDeviceId: v }),
      dmAudioOutputDeviceId: '',
      setDmAudioOutputDeviceId: (v) => set({ dmAudioOutputDeviceId: v }),
    }),
    {
      name: 'tavern-sheet-settings',
      /** v1 made board photos opt-in — a default only applies to a fresh install,
       *  so without this every console that had ever been opened would keep the
       *  stored 'direct' and go on advertising a camera, which is the thing
       *  turning it off was for. v2 turns the table-controller role ON by
       *  default (was off) — same reasoning in reverse: an existing table that
       *  never touched the checkbox would otherwise stay silently off forever.
       *  Each version touches exactly the one key it's for. */
      version: 2,
      migrate: (persisted, from) => {
        const s = { ...(persisted as SettingsState) };
        if (from < 1) s.tableCameraSource = 'off';
        if (from < 2) s.dmRemoteControlEnabled = true;
        return s as SettingsState;
      },
    }
  )
);
