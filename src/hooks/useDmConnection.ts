import React from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { pingDM } from '../utils/dmConnect';

const POLL_MS = 5000;

/** Polls the saved DM address in the background; true once a DM Console
 *  listener answers. Drives whether "Talk to DM" controls should show up. */
export function useDmConnection(): boolean {
  const dmIp = useSettingsStore((s) => s.dmIp);
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    if (!dmIp.trim()) {
      setConnected(false);
      return;
    }
    let cancelled = false;
    const check = () => pingDM(dmIp).then((ok) => { if (!cancelled) setConnected(ok); });
    check();
    const interval = setInterval(check, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [dmIp]);

  return connected;
}
