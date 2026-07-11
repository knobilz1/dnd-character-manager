import React from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { fetchNarrationSince, type NarrationEntry } from '../utils/dmConnect';

const POLL_MS = 3000;

/**
 * Polls the DM Console's narration log so a player device can follow what
 * the DM has said even when it never sent a `/talk` line itself — see
 * party_listener.rs's `push_narration`/`GET /narration`. Previously the
 * DM's reply only ever reached the one device whose `/talk` request carried
 * it back as that request's HTTP response; every other player at the table
 * had no way to see it short of being close enough to hear the DM's own
 * machine.
 *
 * Accumulates into a running transcript (newest last) rather than replacing
 * it each poll, so a brief network hiccup on one poll doesn't drop lines —
 * the next successful poll just picks up with `since` wherever it left off
 * and appends only what's actually new.
 */
export function useDmNarrationFeed(): NarrationEntry[] {
  const dmIp = useSettingsStore((s) => s.dmIp);
  const [entries, setEntries] = React.useState<NarrationEntry[]>([]);
  const sinceRef = React.useRef(0);

  React.useEffect(() => {
    setEntries([]);
    sinceRef.current = 0;
    if (!dmIp.trim()) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const { entries: fresh } = await fetchNarrationSince(sinceRef.current, dmIp);
        if (cancelled || fresh.length === 0) return;
        sinceRef.current = fresh[fresh.length - 1].seq;
        setEntries((prev) => [...prev, ...fresh]);
      } catch {
        // Unreachable this tick — next poll just tries again from the same
        // `since`, same tolerant shape as useDmConnection's own polling.
      }
    };
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [dmIp]);

  return entries;
}
