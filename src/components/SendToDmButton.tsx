import React from 'react';
import { Radio } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';
import { sendCharacterToDM } from '../utils/dmConnect';
import { Dialog, Button } from './ui';
import type { Character } from '../types';

/**
 * One-click "send this character to the DM" button, usable anywhere a
 * character is open (currently the character sheet header) without needing
 * to navigate back to HomePage first. If a DM address is already configured
 * (see useSettingsStore's dmIp, set from HomePage's Settings dialog), this
 * sends immediately and shows a transient status toast — same zero-friction
 * shape as TalkToDMButton. If no address is set yet, prompts for one inline
 * (and saves it to Settings) rather than forcing a trip elsewhere first —
 * game night shouldn't require leaving the sheet you're looking at.
 */
export function SendToDmButton({ character }: { character: Character }) {
  const dmIp = useSettingsStore((s) => s.dmIp);
  const setDmIp = useSettingsStore((s) => s.setDmIp);
  const addDmSyncedCharacter = useSettingsStore((s) => s.addDmSyncedCharacter);
  const [promptOpen, setPromptOpen] = React.useState(false);
  const [ipDraft, setIpDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  async function send(ip: string) {
    setSending(true);
    setStatus(`Sending ${character.name || 'character'}…`);
    try {
      await sendCharacterToDM(character, ip);
      addDmSyncedCharacter(character.id);
      setStatus(`✅ Sent ${character.name || 'character'} to the DM.`);
    } catch (e) {
      setStatus(`❌ Couldn't reach the DM at ${ip}. ${e instanceof Error ? e.message : ''}`);
    } finally {
      setSending(false);
    }
  }

  function handleClick() {
    setStatus(null);
    if (dmIp.trim()) { send(dmIp); return; }
    setIpDraft('');
    setPromptOpen(true);
  }

  function handleConfirmAddress() {
    const ip = ipDraft.trim();
    if (!ip) return;
    setDmIp(ip);
    setPromptOpen(false);
    send(ip);
  }

  return (
    <>
      <button
        onClick={handleClick}
        disabled={sending}
        title="Send to DM"
        className="p-1.5 rounded text-slate-500 hover:text-emerald-400 transition-colors disabled:opacity-50"
      >
        <Radio size={18} />
      </button>
      {status && (
        <div
          onClick={() => setStatus(null)}
          className="fixed bottom-4 right-4 max-w-sm bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-sm text-slate-200 shadow-lg cursor-pointer z-50"
        >
          {status}
        </div>
      )}
      <Dialog open={promptOpen} onClose={() => setPromptOpen(false)} title="Send to DM">
        <p className="text-slate-400 text-sm mb-4">
          On game night, whoever's running the DM Console tells you an address like
          <span className="text-slate-200"> 192.168.1.50</span> (shown at the top of their
          DM Console screen). Enter it once — it's remembered for next time.
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
          <Button variant="outline" onClick={() => setPromptOpen(false)}>Cancel</Button>
          <Button onClick={handleConfirmAddress} disabled={!ipDraft.trim()}>Send</Button>
        </div>
      </Dialog>
    </>
  );
}
