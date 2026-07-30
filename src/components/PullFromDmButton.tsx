import React from 'react';
import { DownloadCloud } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useCharacterStore } from '../store/useCharacterStore';
import { useDmSheetOfferStore } from '../store/useDmSheetOfferStore';
import { fetchSharedCharacter } from '../utils/dmConnect';
import { Button } from './ui';
import type { Character } from '../types';

/**
 * "Pull from DM" — collect what happened to this character while its player
 * wasn't at the table.
 *
 * Every other channel in this app runs player → DM. That's fine while you're
 * there, because your own device is the source of truth and re-sending
 * overwrites the DM's copy (see usePartyStore). It breaks the week you're
 * absent and someone else runs your character: their night of damage, spent
 * slots and loot lives on the DM's machine, and the moment you reconnect your
 * untouched sheet pushes straight over it.
 *
 * Deliberately a button and not an auto-pull on connect. A player who tweaked
 * their sheet on the way to the game would otherwise have it silently replaced
 * by the DM's copy — the reverse of the bug it's fixing, and harder to notice.
 * The human decides which side is right.
 *
 * Also deliberately narrow: it fetches only what the DM is actively sharing, so
 * outside a session where this character was lent out the honest answer is
 * "nothing to collect".
 */
/** The pull itself, shared by the manual button and the offer banner so there
 *  is exactly one place that decides how the DM's copy is merged in. */
function usePull(character: Character) {
  const dmIp = useSettingsStore((s) => s.dmIp);
  const updateCharacter = useLibraryStore((s) => s.updateCharacter);
  const load = useCharacterStore((s) => s.load);
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
      // Keep OUR id. The DM keys characters by name and the copy that came back
      // may carry whatever id it had when it was lent out; writing that id into
      // the library would orphan this sheet's route and its snapshot history.
      const merged = { ...fresh, id: character.id };
      updateCharacter(merged);
      load(merged);
      setStatus(`✅ Updated ${character.name} from the DM's copy.`);
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

/** Shown when the DM's copy of this character was saved more recently than the
 *  one on this device — i.e. someone else ran them while their player was away.
 *
 *  An offer, not an automatic pull: see useDmSheetOfferStore for why. Declining
 *  is remembered against that exact remote timestamp, so it stops asking until
 *  the DM's copy actually moves again. */
export function DmHasNewerSheetBanner({ character }: { character: Character }) {
  const remote = useDmSheetOfferStore((s) => s.remote);
  const declined = useDmSheetOfferStore((s) => s.declined);
  const decline = useDmSheetOfferStore((s) => s.decline);
  const { pull, busy, status, setStatus } = usePull(character);

  const stale =
    remote &&
    remote.name.trim().toLowerCase() === character.name.trim().toLowerCase() &&
    remote.updatedAt > (character.updatedAt ?? 0) &&
    remote.updatedAt !== declined;

  if (!stale) return <StatusToast status={status} onDismiss={() => setStatus(null)} />;

  const when = new Date(remote.updatedAt).toLocaleString();
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap bg-sky-950/50 border border-sky-800/60 rounded-lg px-4 py-2.5">
        <p className="text-sm text-sky-100">
          The DM has a newer copy of <span className="font-bold">{character.name}</span> — last changed {when}.
          {' '}That's usually a session you missed while someone else ran them.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" onClick={() => void pull()} disabled={busy}>Sync it down</Button>
          <Button size="sm" variant="outline" onClick={decline} disabled={busy}>Keep mine</Button>
        </div>
      </div>
      <StatusToast status={status} onDismiss={() => setStatus(null)} />
    </>
  );
}

export function PullFromDmButton({ character }: { character: Character }) {
  const { pull, busy, status, setStatus } = usePull(character);

  async function handleClick() {
    setStatus(null);
    await pull();
  }

  return (
    <>
      <button
        onClick={handleClick}
        disabled={busy}
        title="Pull from DM — collect changes made while you were away"
        className="p-1.5 rounded text-slate-500 hover:text-sky-400 transition-colors disabled:opacity-50"
      >
        <DownloadCloud size={18} />
      </button>
      <StatusToast status={status} onDismiss={() => setStatus(null)} />
    </>
  );
}
