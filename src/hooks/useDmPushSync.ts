import { useEffect, useRef } from 'react';
import { useLibraryStore } from '../store/useLibraryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useDmConnection } from './useDmConnection';
import { sendCharacterToDM } from '../utils/dmConnect';
import type { Character } from '../types';

const DEBOUNCE_MS = 2_000; // 2 seconds

/**
 * Mount this hook once at the app root (alongside useDriveSync, which it
 * mirrors — same subscribe-and-debounce shape, just per-character and much
 * shorter, since this is a live-session LAN push rather than a cloud batch
 * sync).
 *
 * Watches the library for changes and auto-pushes any *already-synced*
 * character (one that's been sent to the DM at least once via "Send to DM"/
 * "Send All" — see HomePage.tsx's addDmSyncedCharacter) after 2s of no
 * further edits to it. By the time useLibraryStore changes at all,
 * SheetPage's own auto-save has already debounced 1s past the last
 * keystroke — this debounce mainly coalesces multiple near-simultaneous
 * field saves (e.g. an HP tick right after a notes edit) into one push.
 *
 * A failed push (DM briefly unreachable) isn't retried on a timer — it just
 * naturally fires again next time that character changes, same as
 * useDriveSync's failure handling.
 */
export function useDmPushSync() {
  const dmIp = useSettingsStore((s) => s.dmIp);
  const dmSyncedCharacterIds = useSettingsStore((s) => s.dmSyncedCharacterIds);
  const connected = useDmConnection();

  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingRef = useRef(new Map<string, Character>());
  const connectedRef = useRef(connected);
  const dmIpRef = useRef(dmIp);
  const syncedIdsRef = useRef(dmSyncedCharacterIds);

  connectedRef.current = connected;
  dmIpRef.current = dmIp;
  syncedIdsRef.current = dmSyncedCharacterIds;

  useEffect(() => {
    const timers = timersRef.current;

    function push(character: Character) {
      if (!connectedRef.current) return;
      sendCharacterToDM(character, dmIpRef.current).catch((e) =>
        console.warn(`Auto-push to DM failed for ${character.name || character.id}:`, e)
      );
    }

    const unsubscribe = useLibraryStore.subscribe((state, prevState) => {
      if (state.characters === prevState.characters) return;

      const prevById = new Map(prevState.characters.map((c) => [c.id, c]));
      for (const character of state.characters) {
        if (!syncedIdsRef.current.includes(character.id)) continue;
        if (prevById.get(character.id) === character) continue; // unchanged reference

        pendingRef.current.set(character.id, character);
        const existing = timers.get(character.id);
        if (existing) clearTimeout(existing);
        timers.set(
          character.id,
          setTimeout(() => {
            timers.delete(character.id);
            const pending = pendingRef.current.get(character.id);
            pendingRef.current.delete(character.id);
            if (pending) push(pending);
          }, DEBOUNCE_MS)
        );
      }
    });

    return () => {
      unsubscribe();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      for (const character of pendingRef.current.values()) push(character);
      pendingRef.current.clear();
    };
  }, []);
}
