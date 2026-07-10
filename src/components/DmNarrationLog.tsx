import React from 'react';
import { ScrollText } from 'lucide-react';
import { useDmConnection } from '../hooks/useDmConnection';
import { useDmNarrationFeed } from '../hooks/useDmNarrationFeed';
import { cn } from '../utils/cn';

/**
 * DmNarrationLog — a small always-present transcript of what the DM has
 * said, fed by useDmNarrationFeed's poll of party_listener.rs's narration
 * log. Companion to TalkToDMButton: that button only ever showed a reply on
 * the one device that sent a line; this shows every DM turn to every
 * connected player, whether or not they were the one talking. Unread lines
 * (arrived since the panel was last opened) badge the icon, same idea as an
 * unread-messages counter.
 */
export function DmNarrationLog() {
  const connected = useDmConnection();
  const entries = useDmNarrationFeed();
  const [open, setOpen] = React.useState(false);
  const [lastSeenSeq, setLastSeenSeq] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  const unread = entries.filter((e) => e.seq > lastSeenSeq).length;

  React.useEffect(() => {
    if (open) setLastSeenSeq(entries.length ? entries[entries.length - 1].seq : 0);
  }, [open, entries]);

  React.useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [open, entries]);

  if (!connected && entries.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title="What the DM has said"
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
            <span>What the DM said</span>
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
        </div>
      )}
    </div>
  );
}
