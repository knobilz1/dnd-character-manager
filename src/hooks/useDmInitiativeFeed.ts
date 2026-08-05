import React from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCharacterStore } from '../store/useCharacterStore';
import { fetchBroadcastInitiative, type BroadcastInitiative } from '../utils/dmConnect';

const POLL_MS = 3000;

/**
 * Polls the DM Console's published turn order so every connected sheet shows the same order without
 * the DM reading it out each round. Mirrors useDmMapFeed: same address, same tolerant polling, same
 * version gate. See party_listener.rs's set_broadcast_initiative / GET /initiative.
 *
 * What arrives is ALREADY masked for players — the enemy side is missing in round 1 on purpose, so
 * the party can't count down to an ambush. The masking is done on the DM's side; this hook renders
 * whatever it is given and never sees the full order.
 *
 * A new version carrying `initiative: null` means combat ended, and that does two things: the order
 * disappears AND this device clears the initiative it rolled for that fight, so a stale number
 * can't show up as next session's turn order. That is why the hook touches the character store
 * rather than being a pure feed.
 */
export function useDmInitiativeFeed(): BroadcastInitiative | null {
  const dmIp = useSettingsStore((s) => s.dmIp);
  const setInitiativeRoll = useCharacterStore((s) => s.setInitiativeRoll);
  const [order, setOrder] = React.useState<BroadcastInitiative | null>(null);
  const versionRef = React.useRef(0);

  React.useEffect(() => {
    setOrder(null);
    versionRef.current = 0;
    if (!dmIp.trim()) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const { version, initiative } = await fetchBroadcastInitiative(versionRef.current, dmIp);
        if (cancelled || version === versionRef.current || initiative === undefined) return;
        versionRef.current = version;
        setOrder(initiative);
        // Combat ended — drop this device's rolled number along with the order.
        if (initiative === null) setInitiativeRoll(undefined);
      } catch {
        // Unreachable this tick — next poll retries from the same version.
      }
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [dmIp, setInitiativeRoll]);

  return order;
}
