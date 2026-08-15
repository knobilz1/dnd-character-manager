import React from 'react';
import { Camera } from 'lucide-react';
import { useDmConnection } from '../hooks/useDmConnection';
import { useSettingsStore } from '../store/useSettingsStore';
import { listTableCameras, captureTableFrame, type TableCamera } from '../utils/tableCamera';
import { fetchTableCameraState, claimTableCamera, sendTablePhoto } from '../utils/dmConnect';
import { Dialog, Button } from './ui';

/**
 * TableCameraButton — lets ONE player be the "table camera" and push photos of
 * the physical battle map to the DM (#39).
 *
 * The DM bot often runs on a different machine from the table, with the players
 * in another room, so the camera pointed at the map is on a player's device and
 * the photo has to travel over the LAN. This is the player end of that: a toggle
 * to take the role, then a button to send a snapshot.
 *
 * Exactly one player holds the role at a time (enforced by the DM's listener —
 * see resolve_camera_claim), otherwise two people snapping at once would race
 * two different boards into a single read. If someone else has it, we say who
 * rather than silently stealing it.
 *
 * Renders nothing unless this device actually has a camera AND the DM is
 * reachable — a player with no camera never sees it, which is the whole
 * "completely optional" requirement.
 */
export function TableCameraButton({ characterName }: { characterName: string }) {
  const connected = useDmConnection();
  const dmIp = useSettingsStore((s) => s.dmIp);
  const [cameras, setCameras] = React.useState<TableCamera[]>([]);
  const [cameraId, setCameraId] = React.useState('');
  const [holder, setHolder] = React.useState<string | null>(null);
  /** Whether the DM is taking board photos at all. Starts false so a DM who has
   *  the feature off never flashes the control at players on the first poll. */
  const [enabled, setEnabled] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    void listTableCameras().then((cams) => {
      setCameras(cams);
      setCameraId((prev) => prev || cams[0]?.deviceId || '');
    });
  }, []);

  // Poll whenever this device could BE the camera — not just while the panel is
  // open — because that poll is also how the DM's "take a photo now" request
  // reaches us: players pull from the DM, so there's no way for the DM to call
  // out to this device. When the request counter passes the last one we served,
  // and we're the holder, take the photo without the player touching anything.
  const servedRef = React.useRef<number | null>(null);
  const busyRef = React.useRef(false);
  React.useEffect(() => {
    if (!connected || !dmIp.trim() || cameras.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const { holder: h, requestSeq, enabled: on } = await fetchTableCameraState(dmIp);
        if (cancelled) return;
        setHolder(h);
        setEnabled(on);
        if (!on) return;
        // First sighting just records where the counter is, so a request made
        // before we were even listening doesn't fire a surprise photo.
        if (servedRef.current === null) { servedRef.current = requestSeq; return; }
        // The DM's request counter restarts at 0 with their app. Ours only moves forward,
        // so after a restart `requestSeq > servedRef` was never true again and this device
        // ignored every photo request for the rest of the night while the DM waited.
        // Re-baseline instead: the same "don't fire on a request we didn't witness" rule
        // the first-sighting branch above applies.
        if (requestSeq < servedRef.current) { servedRef.current = requestSeq; return; }
        const isMine = !!h && h.toLowerCase() === characterName.trim().toLowerCase();
        if (isMine && requestSeq > servedRef.current && !busyRef.current) {
          servedRef.current = requestSeq;
          void autoSend();
        }
      } catch { /* unreachable this tick — try again next one */ }
    };
    void tick();
    const id = setInterval(() => void tick(), 4000);
    return () => { cancelled = true; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, dmIp, cameras.length, characterName]);

  /** Serve the DM's request: photograph and send with no player interaction. */
  async function autoSend() {
    busyRef.current = true;
    setBusy('The DM asked for a photo…');
    try {
      const photo = await captureTableFrame(cameraId || undefined);
      await sendTablePhoto(characterName, photo, dmIp);
      setStatus('Sent a photo the DM asked for.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  // `enabled` is the DM's switch, polled above. Off → this renders nothing at
  // all, exactly like a device with no camera: a control the DM will ignore is
  // worse than no control, because sending appears to succeed.
  if (!connected || cameras.length === 0 || !enabled) return null;

  const mine = !!holder && holder.toLowerCase() === characterName.trim().toLowerCase();
  const takenByOther = !!holder && !mine;

  async function toggleRole() {
    setBusy(mine ? 'Handing back…' : 'Claiming…');
    setStatus(null);
    try {
      const { granted, holder: now, error } = await claimTableCamera(characterName, dmIp, mine);
      setHolder(now);
      // `error` covers the one gap the poll can't: the DM switched board photos
      // off in the last few seconds, so this control is still on screen but the
      // claim is refused. Without it the button would just do nothing.
      if (!granted) setStatus(error ?? (now ? `${now} is the table camera right now.` : null));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function snap() {
    setBusy('Taking the photo…');
    setStatus(null);
    try {
      const photo = await captureTableFrame(cameraId || undefined);
      setBusy('Sending to the DM…');
      await sendTablePhoto(characterName, photo, dmIp);
      setStatus('Sent — the DM will confirm the positions.');
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
        title="Be the table camera — send the DM a photo of the battle map"
        className={`relative p-1.5 rounded transition-colors ${mine ? 'text-emerald-400' : 'text-slate-500 hover:text-emerald-400'}`}
      >
        <Camera size={18} />
        {mine && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border border-slate-900" />}
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Table camera">
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Point your camera straight down at the battle map and send the DM a photo — they'll get which square each
            miniature is on. Only one person can be the table camera at a time.
          </p>

          {cameras.length > 1 && (
            <select
              value={cameraId}
              onChange={(e) => setCameraId(e.target.value)}
              className="w-full px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-sm text-slate-200"
            >
              {cameras.map((c) => <option key={c.deviceId} value={c.deviceId}>{c.label}</option>)}
            </select>
          )}

          {takenByOther && (
            <p className="text-xs text-amber-400">{holder} is the table camera right now.</p>
          )}

          <div className="flex gap-2">
            <Button size="sm" variant={mine ? 'outline' : 'primary'} onClick={toggleRole} disabled={!!busy || takenByOther}>
              {mine ? 'Stop being the camera' : 'Be the table camera'}
            </Button>
            <Button size="sm" onClick={snap} disabled={!!busy || !mine} title={mine ? 'Photograph the map and send it' : 'Take the camera role first'}>
              {busy ?? 'Send a snapshot'}
            </Button>
          </div>

          {status && <p className="text-xs text-slate-400">{status}</p>}
        </div>
      </Dialog>
    </>
  );
}
