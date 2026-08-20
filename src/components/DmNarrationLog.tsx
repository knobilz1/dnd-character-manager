import React from 'react';
import { ScrollText, VolumeX } from 'lucide-react';
import { useDmConnection } from '../hooks/useDmConnection';
import { useDmNarrationFeed } from '../hooks/useDmNarrationFeed';
import { useSettingsStore } from '../store/useSettingsStore';
import { sendInterruptToDM, sendTalkToDM } from '../utils/dmConnect';
import { cn } from '../utils/cn';
import { Button } from './ui';

/**
 * DmNarrationLog ("DM Chat") — a small always-present transcript of what the
 * DM has said, fed by useDmNarrationFeed's poll of party_listener.rs's
 * narration log. Companion to TalkToDMButton: that button only ever showed a
 * reply on the one device that sent a line; this shows every DM turn to
 * every connected player, whether or not they were the one talking. Unread
 * lines (arrived since the panel was last opened) badge the icon, same idea
 * as an unread-messages counter.
 *
 * `characterName` rides along on the poll this component already runs, which
 * is how the DM's roll call learns that this player's sheet is open on the
 * network, and how a character the DM has lent this device for the evening
 * gets picked up. Optional: without it the log still works, it just doesn't
 * register presence.
 *
 * Also carries the interrupt button (reported live as missing from every
 * sheet but the DM Console's own — and even there, interrupting always
 * forced the mic open too, which isn't what someone reaching for "be quiet
 * a second" wants). It lives here rather than as its own component because
 * this is literally the panel showing what the DM has been saying — the
 * natural place to reach for "stop" is right next to hearing it happen. Sits
 * next to the toggle so it's reachable without opening the log first.
 *
 * And a typed fallback for talking to the DM — reported live: a player's mic
 * failed mid-session and, with no other way to speak for their character,
 * they had to sit the rest of it out. Deliberately NOT added to
 * TalkToDMButton itself: that button's whole point is that talking to the DM
 * is ALWAYS one click, and a text box bolted onto it would compromise that
 * for everyone to cover a failure mode most people never hit. This panel is
 * the right home instead — it already shows every line the DM says, so the
 * reply to a typed line just appears in the same feed a typed message goes
 * into, no separate "here's what they said back" plumbing needed.
 */
export function DmNarrationLog({ characterName }: { characterName?: string }) {
  const connected = useDmConnection();
  const dmIp = useSettingsStore((s) => s.dmIp);
  const entries = useDmNarrationFeed(characterName);
  const [open, setOpen] = React.useState(false);
  const [lastSeenSeq, setLastSeenSeq] = React.useState(0);
  const [interrupting, setInterrupting] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const listRef = React.useRef<HTMLDivElement>(null);

  /** Fire-and-forget by design (see sendInterruptToDM) — `interrupting` only
   *  guards against a double-click hammering the same request, not a real
   *  loading state worth blocking the UI over. */
  async function handleInterrupt() {
    if (interrupting) return;
    setInterrupting(true);
    try {
      await sendInterruptToDM(characterName ?? 'A player', dmIp);
    } catch {
      // Nothing useful to show for this — see sendInterruptToDM's doc comment.
    } finally {
      setInterrupting(false);
    }
  }

  /** The same blocking sendTalkToDM every spoken line already uses (see
   *  TalkToDMButton) — this is a second way to PRODUCE the text, not a
   *  different path once it exists. Doesn't surface the reply itself; the
   *  narration feed above will show it within a poll or two, the same way
   *  it shows a spoken line's reply to everyone else at the table. */
  async function handleSendMessage(ev: React.FormEvent) {
    ev.preventDefault();
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await sendTalkToDM(text, characterName ?? 'A player', dmIp);
      setMessage('');
    } catch {
      // The line is still sitting in the box, unsent — leaving it there
      // (rather than clearing on failure) is what lets the player just hit
      // Send again instead of retyping it.
    } finally {
      setSending(false);
    }
  }

  const unread = entries.filter((e) => e.seq > lastSeenSeq).length;

  React.useEffect(() => {
    if (open) setLastSeenSeq(entries.length ? entries[entries.length - 1].seq : 0);
  }, [open, entries]);

  React.useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, entries]);

  if (!connected && entries.length === 0) return null;

  return (
    <div className="relative flex items-center">
      <button
        onClick={handleInterrupt}
        disabled={!connected || interrupting}
        title={connected ? "Interrupt the DM — silences them, doesn't send anything" : "Not connected to the DM"}
        className="p-1.5 rounded text-slate-500 hover:text-amber-400 disabled:opacity-40 disabled:hover:text-slate-500 transition-colors"
      >
        <VolumeX size={18} />
      </button>
      <button
        onClick={() => setOpen((o) => !o)}
        title="DM Chat — what the DM has said, and a place to type to them"
        className="relative p-1.5 rounded text-slate-500 hover:text-emerald-400 transition-colors"
      >
        <ScrollText size={18} />
        {unread > 0 && !open && (
          <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-[3px] rounded-full bg-emerald-500 text-[9px] leading-[14px] text-slate-950 font-bold text-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-80 rounded bg-slate-800 border border-slate-700 shadow-lg flex flex-col">
          <div className="px-2 py-1.5 border-b border-slate-700 text-[10px] uppercase tracking-wide text-slate-500 flex items-center justify-between">
            <span>DM Chat</span>
            <button className="text-slate-500 hover:text-white" onClick={() => setOpen(false)}>✕</button>
          </div>
          <div ref={listRef} className="max-h-64 overflow-y-auto p-2 flex flex-col gap-2">
            {entries.length === 0 ? (
              <p className="text-[11px] text-slate-500 italic">Nothing yet — it'll show up here as the DM narrates.</p>
            ) : (
              entries.map((e) => (
                <p key={e.seq} className={cn('text-[11px] text-slate-300 leading-snug')}>
                  {e.text}
                </p>
              ))
            )}
          </div>
          {/* Fallback for when the mic button isn't an option — a dead mic used to mean
              sitting the rest of the night out. Not meant to replace Talk to the DM; that
              stays one click, always. */}
          <form onSubmit={handleSendMessage} className="flex items-center gap-1.5 p-2 border-t border-slate-700">
            <input
              value={message}
              onChange={(ev) => setMessage(ev.target.value)}
              disabled={!connected || sending}
              placeholder={connected ? 'Type to the DM…' : 'Not connected'}
              className="flex-1 min-w-0 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-600 disabled:opacity-50"
            />
            <Button size="sm" type="submit" disabled={!connected || !message.trim() || sending}>
              {sending ? '…' : 'Send'}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
