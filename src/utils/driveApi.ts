import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Character } from '../types';
import type { Snapshot } from '../store/useSnapshotStore';

// ── Public client ID — safe to embed (no secret, PKCE only) ─────────────────
// Injected at build time from .env — never committed to git.
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string;
// Required by Google for Desktop app token exchange — not truly secret for installed apps.
export const GOOGLE_CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET as string;

const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

// ── PKCE helpers ─────────────────────────────────────────────────────────────

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  const verifier = base64url(array.buffer);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64url(digest);
  return { verifier, challenge };
}

// ── OAuth flow ────────────────────────────────────────────────────────────────

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Date.now() + expires_in * 1000
}

/**
 * Full authorization code + PKCE exchange. Returns tokens on success.
 * Opens the system browser and waits for the loopback callback.
 */
export async function connectGoogleDrive(): Promise<OAuthTokens> {
  const { verifier, challenge } = await generatePkce();

  // Start the loopback listener and get the port
  const port: number = await invoke('start_oauth_server');

  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent', // always request refresh_token
    }).toString();

  // Open the browser
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(authUrl);

  // Wait for the Rust listener to emit the code.
  // listen() is async internally — chain .catch so any rejection is handled.
  const code = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('OAuth timed out — please try connecting again')), 2 * 60 * 1000);
    listen<string>('oauth-code', (event) => {
      clearTimeout(timeout);
      resolve(event.payload);
    }).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  return exchangeCodeForTokens(code, verifier, redirectUri);
}

async function exchangeCodeForTokens(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<OAuthTokens> {
  const res = await tauriFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/** Refreshes an expired access token using the stored refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt: number;
}> {
  const res = await tauriFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
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
  refreshToken: string;
  expiresAt: number;
}

export type { Snapshot };
