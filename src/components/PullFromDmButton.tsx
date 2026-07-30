import React from 'react';
import { DownloadCloud } from 'lucide-react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useLibraryStore } from '../store/useLibraryStore';
import { useCharacterStore } from '../store/useCharacterStore';
import { fetchSharedCharacter } from '../utils/dmConnect';
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
export function PullFromDmButton({ character }: { character: Character }) {
  const dmIp = useSettingsStore((s) => s.dmIp);
  const updateCharacter = useLibraryStore((s) => s.updateCharacter);
  const load = useCharacterStore((s) => s.load);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);

  async function handleClick() {
    if (!dmIp.trim()) {
      setStatus('No DM address set — use Send to DM first.');
      return;
    }
    setBusy(true);
    setStatus(`Checking with the DM for ${character.name}…`);
    try {
      const fresh = await fetchSharedCharacter(character.name, dmIp);
      if (!fresh) {
        setStatus(`The DM isn't sharing ${character.name} right now — nothing to collect.`);
        return;
      }
      // Keep OUR id. The DM keys characters by name and the copy that came back
      // may carry whatever id it had when it was lent out; writing that id into
      // the library would orphan this sheet's route and its snapshot history.
      const merged = { ...fresh, id: character.id };
      updateCharacter(merged);
      load(merged);
      setStatus(`✅ Updated ${character.name} from the DM's copy.`);
    } catch (e) {
      setStatus(`❌ Couldn't reach the DM at ${dmIp}. ${e instanceof Error ? e.message : ''}`);
    } finally {
      setBusy(false);
    }
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
      {status && (
        <div
          onClick={() => setStatus(null)}
          className="fixed bottom-4 right-4 max-w-sm bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-sm text-slate-200 shadow-lg cursor-pointer z-50"
        >
          {status}
        </div>
      )}
    </>
  );
}
