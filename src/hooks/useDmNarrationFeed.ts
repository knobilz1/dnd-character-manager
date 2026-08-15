import React from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { fetchNarrationSince, fetchSharedCharacter, type NarrationEntry } from '../utils/dmConnect';
import { useBorrowedStore } from '../store/useBorrowedStore';
import { useDmSheetOfferStore } from '../store/useDmSheetOfferStore';

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
export function useDmNarrationFeed(characterName?: string): NarrationEntry[] {
  const dmIp = useSettingsStore((s) => s.dmIp);
  const [entries, setEntries] = React.useState<NarrationEntry[]>([]);
  const sinceRef = React.useRef(0);

  React.useEffect(() => {
    setEntries([]);
    sinceRef.current = 0;
    if (!dmIp.trim()) return;

    let cancelled = false;
    // One poll at a time. `syncBorrowed` below can await a multi-megabyte sheet fetch, which
    // on bad WiFi outlasts the 3s interval — two polls then ran with the same `since` and
    // appended the same lines twice (duplicate React keys included).
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const { entries: fresh, latest, proxyFor, yourSheetUpdatedAt } = await fetchNarrationSince(sinceRef.current, dmIp, characterName);
        if (cancelled) return;
        // The DM restarted their app: sequence numbers begin again at 1, so the DM's
        // high-water mark is now BEHIND our cursor. Without this the player's device
        // silently waited for seq 38 that would never come and missed the rest of the
        // night. The transcript is cleared with the cursor because the new log reuses
        // those seq numbers (they are React keys) — scrollback from before the crash is
        // the cheap thing to lose; every line after it is not.
        if (latest < sinceRef.current) {
          sinceRef.current = 0;
          setEntries([]);
          return;
        }
        // Whether the DM's copy of THIS character is newer than the one on
        // this device — the returning-from-a-missed-session case. Just a
        // number; the sheet decides whether to offer the pull.
        if (characterName) useDmSheetOfferStore.getState().setRemote(characterName, yourSheetUpdatedAt);
        // Whoever the DM has asked this device to run tonight (an absent
        // player's character — see the roll call in DMConsolePage). Handled
        // here rather than in a hook of its own because this poll is the only
        // channel that reaches a player device at all, and a second loop to
        // carry a usually-empty array would be pure overhead.
        await syncBorrowed(proxyFor, dmIp);
        if (cancelled || fresh.length === 0) return;
        sinceRef.current = fresh[fresh.length - 1].seq;
        setEntries((prev) => [...prev, ...fresh]);
      } catch {
        // Unreachable this tick — next poll just tries again from the same
        // `since`, same tolerant shape as useDmConnection's own polling.
      } finally {
        // In a finally because the body returns early in several places; missing one
        // would wedge the feed permanently.
        inFlight = false;
      }
    };
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [dmIp, characterName]);

  return entries;
}

/** Bring the borrowed store in line with what the DM says we're running:
 *  hand back anyone no longer assigned, and pull down any newly assigned sheet.
 *
 *  Pulling is one-shot per character, not per poll — `reconcile` only reports
 *  the names we don't already hold, so the (portrait-carrying, therefore heavy)
 *  sheet crosses the wire once. A fetch that fails just leaves the name
 *  outstanding and the next poll retries it. */
async function syncBorrowed(proxyFor: string[], dmIp: string): Promise<void> {
  const store = useBorrowedStore.getState();
  // Fast path for the overwhelmingly common case: nothing assigned, nothing
  // held, so there is nothing to reconcile and no state to touch.
  if (proxyFor.length === 0 && store.borrowed.length === 0) return;
  const missing = store.reconcile(proxyFor);
  for (const name of missing) {
    const c = await fetchSharedCharacter(name, dmIp).catch(() => null);
    if (c) useBorrowedStore.getState().upsert(c);
  }
}
