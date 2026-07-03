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
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      show3DCharacter: true,
      setShow3DCharacter: (v) => set({ show3DCharacter: v }),
      dmIp: '',
      setDmIp: (v) => set({ dmIp: v }),
    }),
    { name: 'tavern-sheet-settings' }
  )
);
