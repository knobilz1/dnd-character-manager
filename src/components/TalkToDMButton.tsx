import React from 'react';
import { Mic, Square } from 'lucide-react';
import { useDmConnection } from '../hooks/useDmConnection';
import { useSettingsStore } from '../store/useSettingsStore';
import { startRecording, stopAndTranscribe, warmupSTT } from '../utils/dmSpeech';
import { sendTalkToDM } from '../utils/dmConnect';
import { cn } from '../utils/cn';

/**
 * TalkToDMButton — lets a player push one spoken line straight to the DM's
 * table from their own character sheet, without ever opening the DM Console
 * themselves. Only renders once useDmConnection() confirms a DM listener is
 * reachable at the saved dmIp (see HomePage's "Send to DM" dialog for where
 * that address is set). The DM's reply is spoken aloud on the DM's machine —
 * this button doesn't play anything back locally.
 */
export function TalkToDMButton({ characterName }: { characterName: string }) {
  const connected = useDmConnection();
  const dmIp = useSettingsStore((s) => s.dmIp);
  const [listening, setListening] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (connected) warmupSTT().catch(() => {});
  }, [connected]);

  if (!connected) return null;

  async function toggle() {
    setStatus(null);
    if (!listening) {
      try {
        await startRecording();
        setListening(true);
      } catch (e) {
        setStatus(e instanceof Error ? e.message : 'Could not access the microphone.');
      }
      return;
    }

    setListening(false);
    setBusy(true);
    try {
      const text = await stopAndTranscribe();
      if (text) {
        // The request can now sit for a while (server-side blocks for the
        // real reply, see below) — show something other than a frozen
        // button while it's in flight, especially if queued behind others.
        setStatus('Waiting for the DM…');
        // Blocks until the DM Console actually processes this line (see
        // party_listener.rs's /talk handler + dmConnect.ts) — so `reply` is
        // the DM's real spoken response, not just a delivery ack. Falls back
        // to a generic confirmation only if the DM Console never got to it
        // in time (still queued behind other turns) or was interrupted.
        const reply = await sendTalkToDM(text, characterName, dmIp);
        setStatus(reply ? `DM: ${reply}` : 'Sent to the DM.');
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Couldn't reach the DM.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={toggle}
        disabled={busy}
        title="Talk to the DM"
        className={cn(
          'p-1.5 rounded transition-colors',
          listening ? 'text-red-400 hover:text-red-300' : 'text-slate-500 hover:text-emerald-400',
        )}
      >
        {listening ? <Square size={18} /> : <Mic size={18} />}
      </button>
      {status && (
        <div className="absolute right-0 top-8 z-50 w-72 max-h-56 overflow-y-auto rounded bg-slate-800 border border-slate-700 p-2 text-[11px] text-slate-300 shadow-lg">
          {status}
          <button className="ml-2 text-slate-500 hover:text-white" onClick={() => setStatus(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
