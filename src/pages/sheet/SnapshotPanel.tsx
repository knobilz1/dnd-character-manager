import React from 'react';
import { History, RotateCcw, Trash2, Save, X } from 'lucide-react';
import { useSnapshotStore, type Snapshot } from '../../store/useSnapshotStore';
import { useCharacterStore } from '../../store/useCharacterStore';
import type { Character } from '../../types';

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(diff / 86_400_000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7)  return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

interface Props {
  open: boolean;
  onClose: () => void;
  character: Character;
}

export function SnapshotPanel({ open, onClose, character }: Props) {
  const { saveSnapshot, deleteSnapshot, snapshotsFor } = useSnapshotStore();
  const { load, save } = useCharacterStore();
  const [label, setLabel] = React.useState('');
  const [confirmRestore, setConfirmRestore] = React.useState<Snapshot | null>(null);
  const [justSaved, setJustSaved] = React.useState(false);

  const snapshots = snapshotsFor(character.id);

  function handleSave() {
    const trimmed = label.trim() || 'Manual save';
    saveSnapshot(character, trimmed);
    setLabel('');
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1800);
  }

  function handleRestore(snap: Snapshot) {
    load(snap.data);
    save();
    setConfirmRestore(null);
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-2">
            <History size={16} className="text-slate-400" />
            <span className="font-bold text-white text-sm">Character History</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Save new snapshot */}
        <div className="px-4 py-3 border-b border-slate-800 shrink-0">
          <p className="text-[10px] text-slate-500 uppercase tracking-wide mb-2">Save snapshot</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={label}
              onChange={e => setLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="Label (optional)"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
            />
            <button
              onClick={handleSave}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                justSaved ? 'bg-green-700 text-white' : 'bg-blue-700 hover:bg-blue-600 text-white'
              }`}
            >
              <Save size={13} />
              {justSaved ? 'Saved!' : 'Save'}
            </button>
          </div>
        </div>

        {/* Snapshot list */}
        <div className="overflow-y-auto flex-1 px-4 py-3">
          {snapshots.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-6">No snapshots yet — save one above.</p>
          ) : (
            <div className="space-y-2">
              {snapshots.map(snap => (
                <div
                  key={snap.id}
                  className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 flex items-center gap-3"
                >
                  {/* Save number badge */}
                  <div className="shrink-0 w-9 h-9 rounded-lg bg-slate-700 flex items-center justify-center">
                    <span className="text-xs font-bold text-slate-300">#{snap.saveNumber ?? '–'}</span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">{snap.label}</p>
                    <p className="text-xs text-slate-500">{timeAgo(snap.timestamp)}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setConfirmRestore(snap)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-slate-700 transition-colors"
                      title="Restore this snapshot"
                    >
                      <RotateCcw size={13} />
                    </button>
                    <button
                      onClick={() => deleteSnapshot(snap.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors"
                      title="Delete snapshot"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Restore confirmation */}
      {confirmRestore && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmRestore(null)} />
          <div className="relative bg-slate-800 border border-slate-600 rounded-2xl p-5 w-full max-w-sm shadow-2xl">
            <h3 className="font-bold text-white mb-1">Restore to save #{confirmRestore.saveNumber ?? '–'}?</h3>
            <p className="text-sm text-slate-400 mb-1">
              <span className="text-white font-semibold">"{confirmRestore.label}"</span>
              {' '}— {timeAgo(confirmRestore.timestamp)}
            </p>
            <p className="text-xs text-yellow-400 mb-4">
              This will overwrite your current character state. Save a snapshot first if you want to keep it.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmRestore(null)}
                className="flex-1 py-2 rounded-lg bg-slate-700 text-white text-sm font-semibold hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRestore(confirmRestore)}
                className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 transition-colors"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
