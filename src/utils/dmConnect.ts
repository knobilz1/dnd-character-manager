/**
 * dmConnect.ts — push a character to the DM's Tavern Sheet (DM Console) over
 * the LAN. The DM's app runs a listener built into the Rust backend
 * (src-tauri/src/party_listener.rs, started when the DM opens /dm) on :7777,
 * accepting the same export envelope used by Export/Import.
 *
 * Uses the Tauri HTTP plugin (not the webview fetch) so the request isn't bound
 * by the webview origin/CSP. The LAN endpoint is allow-listed in
 * src-tauri/capabilities/default.json (any LAN host, any port).
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { useSnapshotStore } from '../store/useSnapshotStore';
import type { Character } from '../types';

export const DM_DEFAULT_PORT = 7777;

/** Normalize a user-entered address into a bare base URL (no trailing path).
 *  Accepts "192.168.1.5", "192.168.1.5:7777", or "http://host:7777". */
export function dmBaseUrl(ip: string): string {
  let host = ip.trim();
  if (!host) throw new Error('No DM address set.');
  if (/^https?:\/\//i.test(host)) return host.replace(/\/+$/, '');
  if (!/:\d+$/.test(host)) host = `${host}:${DM_DEFAULT_PORT}`;
  return `http://${host}`;
}

/** Normalize a user-entered address into the full character-POST URL. */
export function dmUrl(ip: string): string {
  return `${dmBaseUrl(ip)}/character`;
}

/** Quick reachability check — true if a DM Console listener answers at this
 *  address. Used to decide whether to show the "Talk to DM" button. */
export async function pingDM(ip: string): Promise<boolean> {
  if (!ip.trim()) return false;
  try {
    const res = await tauriFetch(`${dmBaseUrl(ip)}/`, { method: 'GET', connectTimeout: 2000 });
    return res.ok;
  } catch {
    return false;
  }
}

/** Push one spoken line to the DM, tagged with which character said it — lets
 *  a player talk to the DM from their own character sheet without ever
 *  opening the DM Console themselves. */
export async function sendTalkToDM(text: string, characterName: string, ip: string): Promise<void> {
  const res = await tauriFetch(`${dmBaseUrl(ip)}/talk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: characterName, text }),
    connectTimeout: 5000,
  });
  if (!res.ok) throw new Error(`DM responded ${res.status}`);
}

/** POST one character (with its snapshot history) to the DM bot. Throws on failure. */
export async function sendCharacterToDM(character: Character, ip: string): Promise<void> {
  const snapshots = useSnapshotStore.getState().snapshotsFor(character.id);
  const payload = { tavernSheet: true, version: 1, character, snapshots };
  const res = await tauriFetch(dmUrl(ip), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    connectTimeout: 5000,
  });
  if (!res.ok) throw new Error(`DM responded ${res.status}`);
}

/** Send several characters; returns counts so the UI can report partial success. */
export async function sendAllToDM(
  characters: Character[],
  ip: string,
): Promise<{ ok: number; failed: string[] }> {
  let ok = 0;
  const failed: string[] = [];
  for (const c of characters) {
    try { await sendCharacterToDM(c, ip); ok++; }
    catch { failed.push(c.name || 'Unnamed'); }
  }
  return { ok, failed };
}
