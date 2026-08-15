import React from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { fetchBroadcastMap, type BroadcastMap } from '../utils/dmConnect';

const POLL_MS = 3000;

/**
 * Polls the DM Console's currently-shared battle map (multi-story Phase 5) so
 * a player device can see the map — and only the floors the DM has revealed —
 * without the DM having to hold it up to a webcam. Mirrors useDmNarrationFeed:
 * same DM address, same tolerant polling. See party_listener.rs's
 * set_broadcast_map / GET /map.
 *
 * Holds the last map it saw until the DM's version advances (the DM only
 * re-sends the image-heavy payload on a real change, so most polls are a tiny
 * `{version}` no-op). A new version carrying `map: null` means the DM stopped
 * sharing, so the view clears.
 */
export function useDmMapFeed(): BroadcastMap | null {
  const dmIp = useSettingsStore((s) => s.dmIp);
  const [map, setMap] = React.useState<BroadcastMap | null>(null);
  const versionRef = React.useRef(0);

  React.useEffect(() => {
    setMap(null);
    versionRef.current = 0;
    if (!dmIp.trim()) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const { version, map: fresh } = await fetchBroadcastMap(versionRef.current, dmIp);
        if (cancelled) return;
        // A LOWER version than ours means the DM's app restarted (their counter is back
        // near 0). Our cursor only moves forward, so the DM would answer every future
        // poll with a bare `{version}` and this device would show the pre-restart map for
        // the rest of the session. Rewinding to 0 makes the next poll ask for everything.
        if (version < versionRef.current) { versionRef.current = 0; return; }
        // Unchanged since our last version → the DM omits the payload; nothing to do.
        if (version === versionRef.current || fresh === undefined) return;
        versionRef.current = version;
        setMap(fresh); // an object (new shared map) or null (DM stopped sharing)
      } catch {
        // Unreachable this tick — next poll retries from the same version.
      }
    };
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [dmIp]);

  return map;
}
