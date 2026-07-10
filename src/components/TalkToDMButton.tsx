import React from 'react';
import { Mic, Square } from 'lucide-react';
import { useDmConnection } from '../hooks/useDmConnection';
import { useSettingsStore } from '../store/useSettingsStore';
import { startRecording, stopAndTranscribe, warmupSTT } from '../utils/dmSpeech';
import { sendTalkToDM } from '../utils/dmConnect';
import { cn } from '../utils/cn';
import { Dialog, Button } from './ui';

/**
 * TalkToDMButton — lets a player push one spoken line straight to the DM's
 * table from their own character sheet, without ever opening the DM Console
 * themselves. Always rendered (not hidden) so it's a stable, findable part of
 * the sheet header — previously this returned null whenever unreachable,
 * which meant the button just silently disappeared with zero explanation of
 * why, easy to mistake for "this feature doesn't exist." When unreachable it
 * stays clickable rather than truly disabled: clicking it opens a small
 * inline "DM address" prompt (pre-filled with whatever's already set) so a
 * missing or wrong address can be fixed right there, without navigating to
 * Settings — same "configure inline, no trip elsewhere" shape as
 * SendToDmButton's own address prompt. The DM's reply is spoken aloud on the
 * DM's machine — this button doesn't play anything back locally.
 */
export function TalkToDMButton({ characterName }: { characterName: string }) {
  const connected = useDmConnection();
  const dmIp = useSettingsStore((s) => s.dmIp);
  const setDmIp = useSettingsStore((s) => s.setDmIp);
  const [listening, setListening] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [addressPromptOpen, setAddressPromptOpen] = React.useState(false);
  const [ipDraft, setIpDraft] = React.useState('');

  React.useEffect(() => {
    if (connected) warmupSTT().catch(() => {});
  }, [connected]);

  if (!connected) {
    const reason = dmIp.trim()
      ? `Can't reach the DM at ${dmIp} — is the DM Console open? Click to change the address.`
      : 'Set a DM address to talk to the DM. Click to set one.';
    return (
      <>
        <button
          onClick={() => { setIpDraft(dmIp); setAddressPromptOpen(true); }}
          title={reason}
          className="p-1.5 rounded text-slate-600 hover:text-slate-300 transition-colors"
        >
          <Mic size={18} />
        </button>
        <Dialog open={addressPromptOpen} onClose={() => setAddressPromptOpen(false)} title="DM address">
          <p className="text-slate-400 text-sm mb-4">
            On game night, whoever's running the DM Console tells you an address like
            <span className="text-slate-200"> 192.168.1.50</span> (shown at the top of their
            DM Console screen).
          </p>
          <label className="block text-xs text-slate-400 mb-1">DM address (IP or IP:port)</label>
          <input
            type="text"
            value={ipDraft}
            onChange={(e) => setIpDraft(e.target.value)}
            placeholder="192.168.1.50"
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm mb-3 focus:outline-none focus:border-emerald-600"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAddressPromptOpen(false)}>Cancel</Button>
            <Button
              onClick={() => { setDmIp(ipDraft.trim()); setAddressPromptOpen(false); }}
              disabled={!ipDraft.trim()}
            >
              Save
            </Button>
          </div>
        </Dialog>
      </>
    );
  }

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
