import React from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useCharacterStore } from '../store/useCharacterStore';
import { useSnapshotStore } from '../store/useSnapshotStore';
import { useDmSheetOfferStore } from '../store/useDmSheetOfferStore';
import { fetchSharedCharacter } from '../utils/dmConnect';
import { Button, Dialog } from './ui';
import type { Character } from '../types';

/**
 * "The DM has a newer copy of your character" — collect what happened to it
 * while its player wasn't at the table.
 *
 * Every other channel in this app runs player → DM. That's fine while you're
 * there, because your own device is the source of truth and re-sending
 * overwrites the DM's copy (see usePartyStore). It breaks the week you're
 * absent and someone else runs your character: their night of damage, spent
 * slots and loot lives on the DM's machine, and the moment you reconnect your
 * untouched sheet pushes straight over it.
 *
 * The check rides on the narration poll that already runs the moment this
 * device connects to the DM (useDmNarrationFeed → useDmSheetOfferStore), so
 * nobody has to know to go looking for it — the returning player just gets
 * asked. It costs one integer per poll; nothing heavy moves unless they accept.
 *
 * Deliberately an OFFER and not an automatic pull. A player who levelled up or
 * bought gear between sessions would otherwise have that silently replaced by
 * the DM's copy — the same bug in the other direction, and harder to notice.
 * The human decides which side is right, and either way the sheet as it stood
 * before the sync is kept as a snapshot they can restore from the History
 * panel.
 */
/** The pull itself. Snapshots the local sheet first, exactly as a Drive sync
 *  does (see driveApi's `Before Drive sync` snapshot) — the DM's copy replaces
 *  a whole character, and "I hit sync and lost the gear I bought this morning"
 *  has to be recoverable. */
function usePull(character: Character) {
  const dmIp = useSettingsStore((s) => s.dmIp);
  const updateCharacter = useLibraryStore((s) => s.updateCharacter);
  const load = useCharacterStore((s) => s.load);
  const saveSnapshot = useSnapshotStore((s) => s.saveSnapshot);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  async function pull(): Promise<boolean> {
    if (!dmIp.trim()) {
      setStatus('No DM address set — use Send to DM first.');
      return false;
    }
    setBusy(true);
    setStatus(`Checking with the DM for ${character.name}…`);
    try {
      const fresh = await fetchSharedCharacter(character.name, dmIp);
      if (!fresh) {
        setStatus(`The DM isn't sharing ${character.name} right now — nothing to collect.`);
        return false;
      }
      // Back up what's on this device BEFORE anything is overwritten, and only
      // once the DM's copy is actually in hand — a snapshot taken for a pull
      // that then 404s or times out is just clutter in the History panel.
      saveSnapshot(character, `Before DM sync — ${new Date().toISOString()}`);
      // Keep OUR id. The DM keys characters by name and the copy that came back
      // may carry whatever id it had when it was lent out; writing that id into
      // the library would orphan this sheet's route and its snapshot history.
      const merged = { ...fresh, id: character.id };
      updateCharacter(merged);
      load(merged);
      setStatus(`✅ Updated ${character.name} from the DM's copy. Your old sheet is saved in History.`);
      return true;
    } catch (e) {
      setStatus(`❌ Couldn't reach the DM at ${dmIp}. ${e instanceof Error ? e.message : ''}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { pull, busy, status, setStatus };
}

function StatusToast({ status, onDismiss }: { status: string | null; onDismiss: () => void }) {
  if (!status) return null;
  return (
    <div
      onClick={onDismiss}
      className="fixed bottom-4 right-4 max-w-sm bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-sm text-slate-200 shadow-lg cursor-pointer z-50"
    >
      {status}
    </div>
  );
}

/** Pops the moment this device connects to a DM holding a more recently saved
 *  copy of the open character — i.e. someone else ran them while their player
 *  was away.
 *
 *  Declining is remembered against that exact remote timestamp, so it stops
 *  asking until the DM's copy actually moves again. Dismissing the dialog any
 *  other way (backdrop, ✕) counts as declining for the same reason: a dialog
 *  that came back three seconds later would be unusable. */
export function DmSyncOfferDialog({ character }: { character: Character }) {
  const remote = useDmSheetOfferStore((s) => s.remote);
  const declined = useDmSheetOfferStore((s) => s.declined);
  const decline = useDmSheetOfferStore((s) => s.decline);
  const { pull, busy, status, setStatus } = usePull(character);

  const stale =
    remote &&
    remote.name.trim().toLowerCase() === character.name.trim().toLowerCase() &&
    remote.updatedAt > (character.updatedAt ?? 0) &&
    remote.updatedAt !== declined;

  const when = remote ? new Date(remote.updatedAt).toLocaleString() : '';
  return (
    <>
      <Dialog open={!!stale} onClose={decline} title="Newer version of this character on the DM">
        <p className="text-sm text-slate-300">
          The DM's copy of <span className="font-bold text-white">{character.name}</span> was last
          changed <span className="font-bold text-white">{when}</span> — more recently than the one
          on this device. Did you miss a session? Whoever ran them that night saved their damage,
          spent slots and loot on the DM's machine.
        </p>
        <p className="mt-3 text-xs text-slate-400">
          Syncing replaces this sheet with the DM's. Your current sheet is saved to History first,
          so you can put it back if this was the wrong call.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={decline} disabled={busy}>Keep mine</Button>
          <Button onClick={() => void pull()} disabled={busy}>
            {busy ? 'Syncing…' : 'Sync from the DM'}
          </Button>
        </div>
      </Dialog>
      <StatusToast status={status} onDismiss={() => setStatus(null)} />
    </>
  );
}
