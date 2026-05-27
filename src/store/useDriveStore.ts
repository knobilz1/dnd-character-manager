import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke, isTauri } from '@tauri-apps/api/core';
import {
  connectGoogleDrive,
  refreshAccessToken,
  fetchUserEmail,
  ensureDriveFolder,
  findLibraryFile,
  downloadLibrary,
  uploadLibrary,
  mergeLibraries,
  snapshotAllForRestore,
  type TokenState,
  type DrivePayload,
} from '../utils/driveApi';
import { useLibraryStore } from './useLibraryStore';
import { useSnapshotStore } from './useSnapshotStore';

interface DriveState {
  // ── Persisted ──────────────────────────────────────────────────────────────
  isConnected: boolean;
  lastSyncedAt: number | null;
  userEmail: string;

  // ── Session-only (not persisted) ───────────────────────────────────────────
  isSyncing: boolean;
  error: string | null;
  /** Names of characters that were updated from another device on the last sync. */
  lastConflicts: string[];

  // ── Internal session cache ─────────────────────────────────────────────────
  _tokens: TokenState | null;
  _folderId: string | null;
  _fileId: string | null;
  _connectCancelled: boolean;

  // ── Actions ────────────────────────────────────────────────────────────────
  connect: () => Promise<void>;
  cancelConnect: () => void;
  disconnect: () => Promise<void>;
  pushToDrive: () => Promise<void>;
  pullFromDrive: () => Promise<void>;
  restoreFromDrive: () => Promise<void>;
  checkOnStartup: () => Promise<void>;
  clearError: () => void;
}

/**
 * Ensures the access token is valid, refreshing it if needed.
 * The refresh token lives only in the OS keychain — Rust reads it transparently.
 */
async function getValidAccessToken(state: DriveState): Promise<string> {
  if (!state._tokens) throw new Error('Not connected to Google Drive');

  if (Date.now() < state._tokens.expiresAt - 60_000) {
    return state._tokens.accessToken;
  }

  // Token expired — ask Rust to refresh using the keychain-stored refresh token.
  const refreshed = await refreshAccessToken();
  usesDriveStore.setState((s) => ({
    _tokens: s._tokens ? { ...s._tokens, ...refreshed } : null,
  }));
  return refreshed.accessToken;
}

/** Ensures folder + file IDs are cached for the session. */
async function ensureIds(
  accessToken: string,
): Promise<{ folderId: string; fileId: string | null }> {
  const state = usesDriveStore.getState();
  let folderId = state._folderId;
  let fileId = state._fileId;

  if (!folderId) {
    folderId = await ensureDriveFolder(accessToken);
    usesDriveStore.setState({ _folderId: folderId });
  }

  if (fileId === null) {
    const info = await findLibraryFile(accessToken, folderId);
    fileId = info?.id ?? null;
    usesDriveStore.setState({ _fileId: fileId });
  }

  return { folderId, fileId };
}

export const usesDriveStore = create<DriveState>()(
  persist(
    (set, get) => ({
      // ── Persisted defaults ───────────────────────────────────────────────
      isConnected: false,
      lastSyncedAt: null,
      userEmail: '',

      // ── Session-only defaults ────────────────────────────────────────────
      isSyncing: false,
      error: null,
      lastConflicts: [],
      _tokens: null,
      _folderId: null,
      _fileId: null,
      _connectCancelled: false,

      clearError: () => set({ error: null }),

      // ── Connect ──────────────────────────────────────────────────────────
      connect: async () => {
        set({ isSyncing: true, error: null, _connectCancelled: false });
        try {
          // connectGoogleDrive() asks Rust to generate PKCE, start the loopback
          // listener, and return the auth URL.  Rust also exchanges the code for
          // tokens using embedded credentials and stores the refresh token in the
          // OS keychain — the frontend only receives the short-lived access token.
          const tokens = await connectGoogleDrive();
          // If user cancelled while the browser was open, bail out silently.
          if (get()._connectCancelled) return;
          const email = await fetchUserEmail(tokens.accessToken);
          set({
            isConnected: true,
            userEmail: email,
            _tokens: tokens,
            _folderId: null,
            _fileId: null,
          });
          // Immediately push local library to Drive.
          await get().pushToDrive();
        } catch (e) {
          if (!get()._connectCancelled) {
            const msg = String(e);
            // Surface a readable error instead of internal Tauri bridge noise.
            const friendly =
              msg.includes('invoke') || msg.includes('TAURI')
                ? 'Drive sync requires the desktop app — it cannot run in a browser.'
                : msg;
            set({ error: friendly });
          }
        } finally {
          set({ isSyncing: false, _connectCancelled: false });
        }
      },

      // ── Cancel connect ────────────────────────────────────────────────────
      cancelConnect: () => set({ isSyncing: false, _connectCancelled: true, error: null }),

      // ── Disconnect ───────────────────────────────────────────────────────
      disconnect: async () => {
        await invoke<void>('clear_google_token').catch(() => {});
        set({
          isConnected: false,
          userEmail: '',
          lastSyncedAt: null,
          _tokens: null,
          _folderId: null,
          _fileId: null,
          error: null,
          lastConflicts: [],
        });
      },

      // ── Push (merge then upload) ─────────────────────────────────────────
      pushToDrive: async () => {
        const state = get();
        if (!state.isConnected || state.isSyncing) return;
        set({ isSyncing: true, error: null });

        try {
          const accessToken = await getValidAccessToken(state);
          const { folderId, fileId } = await ensureIds(accessToken);

          const lib = useLibraryStore.getState();
          const local = { characters: lib.characters, deletedIds: lib.deletedIds };

          let payload: DrivePayload;
          let newFileId = fileId;

          if (fileId) {
            // Download remote, merge, then upload merged result.
            const remote = await downloadLibrary(accessToken, fileId);
            const { saveSnapshot } = useSnapshotStore.getState();
            const result = mergeLibraries(
              local,
              { characters: remote.characters, deletedIds: remote.deletedIds ?? {} },
              saveSnapshot,
            );

            // Update local store with the merged result.
            lib.setLibraryFromDrive(result.merged, result.mergedDeletedIds);
            lib.pruneOldTombstones();

            payload = {
              version: 1,
              savedAt: Date.now(),
              characters: result.merged,
              deletedIds: result.mergedDeletedIds,
            };

            if (result.conflicted.length > 0) {
              set({ lastConflicts: result.conflicted });
            }
          } else {
            // No remote file yet — just upload local.
            payload = {
              version: 1,
              savedAt: Date.now(),
              characters: local.characters,
              deletedIds: local.deletedIds,
            };
          }

          newFileId = await uploadLibrary(accessToken, folderId, fileId, payload);
          usesDriveStore.setState({ _fileId: newFileId, lastSyncedAt: Date.now() });
        } catch (e) {
          set({ error: String(e) });
        } finally {
          set({ isSyncing: false });
        }
      },

      // ── Pull (same as push — merge both ways) ────────────────────────────
      pullFromDrive: async () => {
        return get().pushToDrive();
      },

      // ── Full restore (bypass merge, overwrite local) ─────────────────────
      restoreFromDrive: async () => {
        const state = get();
        if (!state.isConnected) return;
        set({ isSyncing: true, error: null });

        try {
          const accessToken = await getValidAccessToken(state);
          const { folderId, fileId } = await ensureIds(accessToken);

          if (!fileId) throw new Error('No backup found on Google Drive.');

          const remote = await downloadLibrary(accessToken, fileId);
          const lib = useLibraryStore.getState();
          const { saveSnapshot } = useSnapshotStore.getState();

          // Snapshot every local character before overwrite.
          snapshotAllForRestore(lib.characters, saveSnapshot);

          // Replace local with Drive content.
          lib.setLibraryFromDrive(remote.characters, remote.deletedIds ?? {});
          lib.pruneOldTombstones();

          set({ lastSyncedAt: Date.now() });
        } catch (e) {
          set({ error: String(e) });
        } finally {
          set({ isSyncing: false });
        }
      },

      // ── Startup check ────────────────────────────────────────────────────
      checkOnStartup: async () => {
        // Only run inside the Tauri runtime — not in a plain browser context.
        if (!isTauri()) return;

        try {
          // Rust reads the refresh token from the OS keychain and exchanges it for
          // a fresh access token — all transparently, without touching JavaScript.
          // Returns Err("no-token") if the user has never connected.
          const { accessToken, expiresAt } = await refreshAccessToken();
          const email = await fetchUserEmail(accessToken);

          set({
            isConnected: true,
            userEmail: email,
            _tokens: { accessToken, expiresAt },
            _folderId: null,
            _fileId: null,
          });

          // Silent startup merge (pushToDrive handles merge automatically).
          await get().pushToDrive();
        } catch {
          // "no-token" → never connected; any other error → token was revoked.
          // In both cases: ensure the UI shows disconnected and the keychain is clean.
          set({ isConnected: false, userEmail: '', _tokens: null });
          await invoke<void>('clear_google_token').catch(() => {});
        }
      },
    }),
    {
      name: 'tavern-drive-sync',
      // Only persist user-facing state, never tokens (keychain handles those).
      partialize: (s) => ({
        isConnected: s.isConnected,
        lastSyncedAt: s.lastSyncedAt,
        userEmail: s.userEmail,
      }),
    },
  ),
);

// Named export alias for ergonomics
export const useDriveStore = usesDriveStore;
