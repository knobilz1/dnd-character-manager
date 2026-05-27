import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Character } from '../types';
import type { Snapshot } from '../store/useSnapshotStore';

// ── Note on credentials ───────────────────────────────────────────────────────
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are embedded in the Rust binary at
// compile time via env!() — they never appear in this JavaScript bundle.
// All PKCE generation, token exchange, and refresh token handling happen in Rust.
// ─────────────────────────────────────────────────────────────────────────────

const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

// ── OAuth types ───────────────────────────────────────────────────────────────

export interface OAuthTokens {
  accessToken: string;
  expiresAt: number; // Date.now() + expires_in * 1000
}

// ── OAuth flow ────────────────────────────────────────────────────────────────

/**
 * Full authorization code + PKCE exchange, handled entirely in Rust.
 *
 * 1. Registers event listeners for `oauth-complete` / `oauth-error`
 * 2. Calls `start_oauth_server` — Rust generates PKCE, starts a loopback listener,
 *    and returns the Google auth URL
 * 3. Opens the auth URL in the system browser
 * 4. Rust's listener receives the callback, exchanges the code (using embedded
 *    credentials), stores the refresh token in the OS keychain, and emits the event
 * 5. Returns tokens on success; throws on error or timeout
 */
export async function connectGoogleDrive(): Promise<OAuthTokens> {
  return new Promise<OAuthTokens>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('OAuth timed out — please try connecting again')),
      2 * 60 * 1000,
    );

    let unlistenComplete: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;

    const cleanup = () => {
      clearTimeout(timeout);
      unlistenComplete?.();
      unlistenError?.();
    };

    // Register listeners BEFORE invoking so we don't miss a fast event.
    Promise.all([
      listen<{ access_token: string; expires_at: number }>('oauth-complete', (event) => {
        cleanup();
        resolve({
          accessToken: event.payload.access_token,
          expiresAt: event.payload.expires_at,
        });
      }),
      listen<string>('oauth-error', (event) => {
        cleanup();
        reject(new Error(event.payload));
      }),
    ])
      .then(([ul1, ul2]) => {
        unlistenComplete = ul1;
        unlistenError = ul2;
        // Rust generates PKCE + auth URL, starts listener thread, returns URL.
        return invoke<string>('start_oauth_server');
      })
      .then(async (authUrl) => {
        // Open the auth URL in the system browser.
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(authUrl);
      })
      .catch((err) => {
        cleanup();
        reject(err);
      });
  });
}

/**
 * Asks the Rust layer to refresh the access token using the refresh token stored
 * in the OS keychain — credentials never touch JavaScript.
 */
export async function refreshAccessToken(): Promise<{
  accessToken: string;
  expiresAt: number;
}> {
  const result = await invoke<{ access_token: string; expires_at: number }>(
    'get_fresh_access_token',
  );
  return {
    accessToken: result.access_token,
    expiresAt: result.expires_at,
  };
}

/** Fetches the user's Google account email for display. */
export async function fetchUserEmail(accessToken: string): Promise<string> {
  const res = await tauriFetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return '';
  const data = await res.json() as { email?: string };
  return data.email ?? '';
}

// ── Google Drive REST helpers ─────────────────────────────────────────────────

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_NAME = 'TavernSheet';
const FILE_NAME = 'library.json';

/** Returns the TavernSheet folder ID, creating it if it doesn't exist. */
export async function ensureDriveFolder(accessToken: string): Promise<string> {
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`,
  );
  const res = await tauriFetch(`${DRIVE_FILES}?q=${q}&fields=files(id)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive folder search failed: ${res.status}`);
  const data = await res.json() as { files: { id: string }[] };

  if (data.files.length > 0) return data.files[0].id;

  // Create folder
  const create = await tauriFetch(DRIVE_FILES, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  });
  if (!create.ok) throw new Error(`Drive folder creation failed: ${create.status}`);
  const folder = await create.json() as { id: string };
  return folder.id;
}

export interface DriveFileInfo {
  id: string;
  modifiedTime: string;
}

/** Finds library.json in the TavernSheet folder. Returns null if not found. */
export async function findLibraryFile(
  accessToken: string,
  folderId: string,
): Promise<DriveFileInfo | null> {
  const q = encodeURIComponent(
    `name='${FILE_NAME}' and '${folderId}' in parents and trashed=false`,
  );
  const res = await tauriFetch(
    `${DRIVE_FILES}?q=${q}&fields=files(id,modifiedTime)`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Drive file search failed: ${res.status}`);
  const data = await res.json() as { files: DriveFileInfo[] };
  return data.files[0] ?? null;
}

export interface DrivePayload {
  version: number;
  savedAt: number;
  characters: Character[];
  deletedIds: Record<string, number>;
}

/** Downloads and parses library.json from Drive. */
export async function downloadLibrary(
  accessToken: string,
  fileId: string,
): Promise<DrivePayload> {
  const res = await tauriFetch(`${DRIVE_FILES}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Drive download failed: ${res.status}`);
  return (await res.json()) as DrivePayload;
}

/** Uploads (creates or updates) library.json on Drive. */
export async function uploadLibrary(
  accessToken: string,
  folderId: string,
  fileId: string | null,
  payload: DrivePayload,
): Promise<string> {
  const body = JSON.stringify(payload);
  const boundary = '---TavernSheetBoundary';

  if (fileId) {
    // Update existing file (media only, no metadata change needed)
    const res = await tauriFetch(`${UPLOAD_URL}/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    if (!res.ok) throw new Error(`Drive update failed: ${res.status}`);
    const data = await res.json() as { id: string };
    return data.id;
  }

  // Create new file (multipart: metadata + media)
  const metadata = JSON.stringify({ name: FILE_NAME, parents: [folderId] });
  const multipart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n${body}\r\n` +
    `--${boundary}--`;

  const res = await tauriFetch(`${UPLOAD_URL}?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipart,
  });
  if (!res.ok) throw new Error(`Drive upload failed: ${res.status}`);
  const data = await res.json() as { id: string };
  return data.id;
}

// ── Conflict resolution / merge ───────────────────────────────────────────────

export interface MergeResult {
  merged: Character[];
  mergedDeletedIds: Record<string, number>;
  /** Names of characters whose local version was replaced by a remote version. */
  conflicted: string[];
}

/**
 * Merges two character libraries by ID, respecting tombstones.
 * Losing side of a conflict is auto-saved as a snapshot before being replaced.
 */
export function mergeLibraries(
  local: { characters: Character[]; deletedIds: Record<string, number> },
  remote: { characters: Character[]; deletedIds: Record<string, number> },
  saveSnapshot: (char: Character, reason: string) => void,
): MergeResult {
  // 1. Merge tombstone maps — per ID, keep the newer deletion timestamp
  const mergedDeletedIds: Record<string, number> = { ...local.deletedIds };
  for (const [id, ts] of Object.entries(remote.deletedIds)) {
    if (!mergedDeletedIds[id] || ts > mergedDeletedIds[id]) {
      mergedDeletedIds[id] = ts;
    }
  }

  // 2. Build lookup maps
  const localMap = new Map<string, Character>(local.characters.map((c) => [c.id, c]));
  const remoteMap = new Map<string, Character>(remote.characters.map((c) => [c.id, c]));
  const allIds = new Set([...localMap.keys(), ...remoteMap.keys()]);

  const merged: Character[] = [];
  const conflicted: string[] = [];

  for (const id of allIds) {
    const tombstone = mergedDeletedIds[id];
    const localChar = localMap.get(id);
    const remoteChar = remoteMap.get(id);

    // Pick whichever char exists for tombstone comparison
    const candidate = localChar ?? remoteChar!;

    // Tombstone check — if the deletion is newer than the character's last update, it wins
    if (tombstone && tombstone >= candidate.updatedAt) {
      // Deletion wins; exclude this character from the merged output
      continue;
    }

    // If tombstone exists but character is newer → character was re-created after deletion;
    // keep it and clear the tombstone
    if (tombstone && tombstone < candidate.updatedAt) {
      delete mergedDeletedIds[id];
    }

    // Normal per-character merge rules
    if (!localChar) {
      // Only on remote → keep (added on another device)
      merged.push(remoteChar!);
    } else if (!remoteChar) {
      // Only local → keep
      merged.push(localChar);
    } else if (localChar.updatedAt === remoteChar.updatedAt) {
      // Same timestamp → no conflict
      merged.push(localChar);
    } else if (remoteChar.updatedAt > localChar.updatedAt) {
      // Remote newer → save local as snapshot, use remote
      const ts = new Date(remoteChar.updatedAt).toISOString();
      saveSnapshot(localChar, `Before Drive sync — ${ts}`);
      merged.push(remoteChar);
      conflicted.push(remoteChar.name);
    } else {
      // Local newer → keep local (overwrites remote on next push)
      merged.push(localChar);
    }
  }

  // Stable sort by createdAt
  merged.sort((a, b) => a.createdAt - b.createdAt);

  return { merged, mergedDeletedIds, conflicted };
}

// ── Snapshot helpers for "Restore from Drive" (full overwrite) ────────────────

/**
 * Saves every character in `chars` as a snapshot, for use before a full restore.
 */
export function snapshotAllForRestore(
  chars: Character[],
  saveSnapshot: (char: Character, reason: string) => void,
): void {
  const ts = new Date().toISOString();
  for (const c of chars) {
    saveSnapshot(c, `Before Drive restore — ${ts}`);
  }
}

// ── Token snapshot type (kept in useDriveStore memory) ────────────────────────

export interface TokenState {
  accessToken: string;
  expiresAt: number;
}

export type { Snapshot };
