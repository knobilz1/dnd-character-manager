import React from 'react';
import { Gamepad2 } from 'lucide-react';
import { useDmConnection } from '../hooks/useDmConnection';
import { useSettingsStore } from '../store/useSettingsStore';
import { fetchTableControllerState, claimTableController, sendTableControl, type RollCallView, type TableControlAction } from '../utils/dmConnect';
import { Dialog, Button } from './ui';

/**
 * TableControllerButton — lets ONE player be the "table controller": a remote
 * for the DM Console, which usually sits by the TV out of arm's reach.
 *
 * The player end of the same arrangement as TableCameraButton, sharing its
 * listener-side claim policy (one holder, no stealing, stale holds expire). The
 * four buttons are the console's own controls — the listener only relays an
 * allowlisted action from the current holder, and the console dispatches it into
 * the same handlers its local buttons use, so a remote "End battle" cannot mean
 * something different from a local one.
 *
 * Renders nothing unless the DM has turned the feature on — `enabled` rides the
 * poll, so switching it off removes this control from every sheet within one
 * poll. A control the DM's console will refuse is worse than no control.
 */
export function TableControllerButton({ characterName }: { characterName: string }) {
  const connected = useDmConnection();
  const dmIp = useSettingsStore((s) => s.dmIp);
  const [holder, setHolder] = React.useState<string | null>(null);
  /** Starts false so a DM who has the feature off never flashes the control. */
  const [enabled, setEnabled] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  /** The DM's roll call, mirrored through the listener so the controller can
   *  run it from their seat. Null until the DM has a campaign open. */
  const [rollCall, setRollCall] = React.useState<RollCallView | null>(null);
  const [online, setOnline] = React.useState<string[]>([]);

  // Poll whether the feature is on and who holds it. Always, not just while the
  // panel is open — the poll is what makes the button appear at all.
  React.useEffect(() => {
    if (!connected || !dmIp.trim()) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const { holder: h, enabled: on, rollCall: rc, online: onl } = await fetchTableControllerState(dmIp);
        if (cancelled) return;
        setHolder(h);
        setEnabled(on);
        setRollCall(rc);
        setOnline(onl);
      } catch { /* unreachable this tick — try again next one */ }
    };
    void tick();
    const id = setInterval(() => void tick(), 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [connected, dmIp]);

  if (!connected || !enabled) return null;

  const mine = !!holder && holder.toLowerCase() === characterName.trim().toLowerCase();
  const takenByOther = !!holder && !mine;

  async function toggleRole() {
    setBusy(mine ? 'Handing back…' : 'Claiming…');
    setStatus(null);
    try {
      const { granted, holder: now, error } = await claimTableController(characterName, dmIp, mine);
      setHolder(now);
      // Covers the gap the poll can't: the DM switched the feature off in the
      // last few seconds, so the control is still on screen but the claim is
      // refused. Without this the button would just do nothing.
      if (!granted) setStatus(error ?? (now ? `${now} is the table controller right now.` : null));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function press(action: TableControlAction, label: string, extra?: { member?: string; here?: boolean }) {
    setBusy(label);
    setStatus(null);
    try {
      await sendTableControl(characterName, action, dmIp, extra);
      if (action.startsWith('roll_call')) {
        // Re-poll immediately so the mark shows now, not in 4 seconds — the
        // console applied it, this device just hasn't seen the mirror yet.
        const { rollCall: rc, online: onl } = await fetchTableControllerState(dmIp);
        setRollCall(rc);
        setOnline(onl);
      } else {
        setStatus('Done.');
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Be the table controller — drive the DM console from your seat"
        className={`relative p-1.5 rounded transition-colors ${mine ? 'text-emerald-400' : 'text-slate-500 hover:text-emerald-400'}`}
      >
        <Gamepad2 size={18} />
        {mine && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border border-slate-900" />}
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Table controller">
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            The DM's machine is usually across the room — the controller gets a few of its buttons here.
            Only one person can hold it at a time, and the DM can take it back.
          </p>

          {takenByOther && (
            <p className="text-xs text-amber-400">{holder} is the table controller right now.</p>
          )}

          <Button size="sm" variant={mine ? 'outline' : 'primary'} onClick={toggleRole} disabled={!!busy || takenByOther}>
            {mine ? 'Stop being the controller' : 'Be the table controller'}
          </Button>

          {mine && (
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => press('stop', 'Stopping…')}
                title="Silence the DM and cancel whatever it's generating">
                🔇 Stop the DM
              </Button>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => press('replay', 'Replaying…')}
                title="Re-speak the DM's last narration">
                🔁 Replay last line
              </Button>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => press('recap', 'Starting…')}
                title="Read the last session's recap aloud">
                📜 Read the recap
              </Button>
              <Button size="sm" variant="outline" disabled={!!busy} onClick={() => press('end_battle', 'Ending…')}
                title="End the battle — clears the log, the spell areas and everyone's initiative">
                🏳️ End battle
              </Button>
            </div>
          )}

          {/* Roll call, from the controller's seat. Here/Away only — the nuanced
              half (autopilot anchors, proxies) needs sheet knowledge and stays on
              the DM's console. */}
          {mine && rollCall && rollCall.members.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-700">
              <p className="text-xs font-bold text-slate-300">
                Roll call {rollCall.taken && <span className="font-normal text-emerald-400">— taken</span>}
              </p>
              {rollCall.members.map((m) => {
                const isOnline = online.some((n) => n.trim().toLowerCase() === m.name.trim().toLowerCase());
                return (
                  <div key={m.name} className="flex items-center justify-between gap-2 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5">
                    <p className="text-xs text-white truncate flex items-center gap-1.5 min-w-0">
                      <span
                        title={isOnline ? 'Their sheet is open on the network' : 'No sheet open on the network'}
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOnline ? 'bg-emerald-400' : 'bg-slate-600'}`}
                      />
                      <span className="truncate">{m.name}</span>
                      {!m.here && m.mode && <span className="text-[10px] text-slate-500 shrink-0">({m.mode})</span>}
                    </p>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        disabled={!!busy}
                        onClick={() => void press('roll_call_mark', 'Marking\u2026', { member: m.name, here: true })}
                        className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${m.here ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300' : 'border-slate-700 text-slate-400 hover:text-white'}`}
                      >
                        Here
                      </button>
                      <button
                        disabled={!!busy}
                        onClick={() => void press('roll_call_mark', 'Marking\u2026', { member: m.name, here: false })}
                        className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${!m.here ? 'bg-amber-900/40 border-amber-700 text-amber-300' : 'border-slate-700 text-slate-400 hover:text-white'}`}
                      >
                        Away
                      </button>
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void press('roll_call_all_here', 'Marking\u2026')}>
                  Everyone's here
                </Button>
                {!rollCall.taken && (
                  <Button size="sm" disabled={!!busy} onClick={() => void press('roll_call_done', 'Confirming\u2026')}>
                    Start the session
                  </Button>
                )}
              </div>
            </div>
          )}

          {status && <p className="text-xs text-slate-400">{status}</p>}
        </div>
      </Dialog>
    </>
  );
}
