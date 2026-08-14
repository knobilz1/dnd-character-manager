import React from 'react';

/**
 * One always-current snapshot of the state that long-lived callbacks need.
 *
 * The DM console registers listeners once at mount — `dm-player-turn`, the
 * close-requested handler, the TTS drain loop — and they run for the whole
 * evening. A callback like that closes over the state as it was at mount, so
 * reading `activeCampaignId` directly inside one gives you the campaign that was
 * open when the console loaded, not the one open now. Four shipped bugs came from
 * exactly this: a mid-session engine switch that LAN player turns ignored, a map
 * card loaded against the wrong campaign, and two more.
 *
 * The old fix was a hand-written ref per value — declare it, assign it every
 * render, remember to use it. Sixteen of those had accumulated, and the failure
 * mode was silent: add a new piece of state, read it from a listener, and it goes
 * stale with nothing to notice. Nothing announced that the twin was required.
 *
 * So there is now one object instead of sixteen refs. Its literal is the list of
 * everything the listeners can see, sitting in one place where a reviewer can ask
 * "is the new state in here?" — and `live.current.` greps as the marker for every
 * read that had to be fresh.
 *
 * Assigning during render is deliberate and is what the sixteen refs already did:
 * the value must be current for a callback that fires before any effect would
 * have run. `react-hooks/refs` flags this, which is one reason lint is not in CI
 * (see AGENTS.md §3).
 *
 * This does not FORCE a new value to be registered — nothing can, short of moving
 * the handlers out of the component so they cannot close over state at all. That
 * is the larger refactor this is the first half of.
 */
export function useLive<T extends object>(values: T): React.RefObject<T> {
  const ref = React.useRef(values);
  ref.current = values;
  return ref;
}
