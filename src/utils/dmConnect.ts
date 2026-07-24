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
 *  opening the DM Console themselves. The request blocks (server-side, see
 *  party_listener.rs's `/talk` handler) until the DM Console actually
 *  processes this line, so the resolved value is the DM's real reply text —
 *  not just a delivery ack — letting the caller show what was said instead
 *  of a bare "sent" confirmation. `null` means the DM Console never got
 *  around to it within the server's own timeout window; the caller should
 *  fall back to a generic "sent" message in that case. */
export async function sendTalkToDM(text: string, characterName: string, ip: string): Promise<string | null> {
  const res = await tauriFetch(`${dmBaseUrl(ip)}/talk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: characterName, text }),
    connectTimeout: 5000,
  });
  if (!res.ok) throw new Error(`DM responded ${res.status}`);
  const data = (await res.json().catch(() => null)) as { reply?: string | null } | null;
  return data?.reply ?? null;
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

/** One line of narration the DM has spoken, as broadcast to every connected
 *  player device — mirrors party_listener.rs's NarrationEntry. */
export interface NarrationEntry {
  seq: number;
  text: string;
}

/** Polls for narration lines newer than `since` (0 = everything currently
 *  buffered on the DM's machine — see party_listener.rs's NARRATION_LOG_CAPACITY
 *  for how far back that reaches). Lets every player device follow what the
 *  DM said, not just whoever's own /talk request happened to carry a reply
 *  back — see useDmNarrationFeed, the caller. Throws the same way pingDM's
 *  underlying fetch would on an unreachable DM; callers should treat that as
 *  "try again next poll," not a fatal error. */
export async function fetchNarrationSince(since: number, ip: string): Promise<{ entries: NarrationEntry[]; latest: number }> {
  const res = await tauriFetch(`${dmBaseUrl(ip)}/narration?since=${since}`, { method: 'GET', connectTimeout: 5000 });
  if (!res.ok) throw new Error(`DM responded ${res.status}`);
  return (await res.json()) as { entries: NarrationEntry[]; latest: number };
}

/** One floor of the map the DM is sharing — a name and its already-rendered
 *  PNG (data URL). Only floors the DM has revealed are ever sent. */
export interface BroadcastFloor {
  name: string;
  png: string;
}

/** The battle map the DM is currently sharing with the table — mirrors
 *  party_listener.rs's set_broadcast_map payload. */
export interface BroadcastMap {
  name: string;
  floors: BroadcastFloor[];
}

/** Polls the DM's currently-shared map (multi-story Phase 5). `since` is the
 *  last version this device saw; the DM only re-sends the (image-heavy)
 *  payload when its version has advanced, so an unchanged map costs one tiny
 *  `{version}` response per poll. When the version advanced, `map` is present:
 *  the shared map, or `null` if the DM stopped sharing (blank the view). When
 *  it hasn't, `map` is absent. Throws on an unreachable DM, same as
 *  fetchNarrationSince — callers treat that as "try again next poll." */
export async function fetchBroadcastMap(since: number, ip: string): Promise<{ version: number; map?: BroadcastMap | null }> {
  const res = await tauriFetch(`${dmBaseUrl(ip)}/map?since=${since}`, { method: 'GET', connectTimeout: 5000 });
  if (!res.ok) throw new Error(`DM responded ${res.status}`);
  return (await res.json()) as { version: number; map?: BroadcastMap | null };
}

/** Who currently holds the "table camera" role, or null if it's free.
 *  See party_listener.rs — exactly one player at a time may send table photos. */
export async function fetchTableCameraHolder(ip: string): Promise<string | null> {
  const res = await tauriFetch(`${dmBaseUrl(ip)}/camera`, { method: 'GET', connectTimeout: 5000 });
  if (!res.ok) throw new Error(`DM responded ${res.status}`);
  return ((await res.json()) as { holder: string | null }).holder ?? null;
}

/** Claim (or with `release`, hand back) the table camera. `granted` is false
 *  when someone else already holds it — the caller shows who rather than
 *  silently stealing it. */
export async function claimTableCamera(
  name: string, ip: string, release = false,
): Promise<{ granted: boolean; holder: string | null }> {
  const res = await tauriFetch(`${dmBaseUrl(ip)}/camera-claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, release }),
    connectTimeout: 5000,
  });
  if (!res.ok) throw new Error(`DM responded ${res.status}`);
  const j = (await res.json()) as { granted?: boolean; holder?: string | null };
  return { granted: !!j.granted, holder: j.holder ?? null };
}

/** Push one photo of the physical table to the DM. Rejected (409) unless this
 *  player currently holds the camera. The DM never applies it blind — it runs
 *  the board read and shows the DM a confirm panel. */
export async function sendTablePhoto(name: string, photo: string, ip: string): Promise<void> {
  const res = await tauriFetch(`${dmBaseUrl(ip)}/table-photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, photo }),
    connectTimeout: 15000, // a photo is a far bigger body than a line of talk
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error((msg as { error?: string }).error ?? `DM responded ${res.status}`);
  }
}

/** Send several characters; returns counts (and which ids actually succeeded,
 *  so callers can mark those characters as DM-synced) for partial success. */
export async function sendAllToDM(
  characters: Character[],
  ip: string,
): Promise<{ ok: number; okIds: string[]; failed: string[] }> {
  let ok = 0;
  const okIds: string[] = [];
  const failed: string[] = [];
  for (const c of characters) {
    try { await sendCharacterToDM(c, ip); ok++; okIds.push(c.id); }
    catch { failed.push(c.name || 'Unnamed'); }
  }
  return { ok, okIds, failed };
}
