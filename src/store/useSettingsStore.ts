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
  dmProvider: 'claude' | 'local';
  setDmProvider: (v: 'claude' | 'local') => void;
  localLlmBaseUrl: string;
  setLocalLlmBaseUrl: (v: string) => void;
  localLlmModel: string;
  setLocalLlmModel: (v: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      show3DCharacter: true,
      setShow3DCharacter: (v) => set({ show3DCharacter: v }),
      dmIp: '',
      setDmIp: (v) => set({ dmIp: v }),
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
    }),
    { name: 'tavern-sheet-settings' }
  )
);
