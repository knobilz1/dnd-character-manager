import React from 'react';
import {
  Cloud,
  CloudOff,
  CloudUpload,
  CloudDownload,
  LogOut,
  Loader2,
  AlertCircle,
  X,
  RefreshCw,
} from 'lucide-react';
import { useDriveStore } from '../store/useDriveStore';
import { Button, Dialog } from './ui';

// ── Helper ────────────────────────────────────────────────────────────────────

function formatRelative(ts: number | null): string {
  if (!ts) return 'Never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

// ── Main component ────────────────────────────────────────────────────────────

interface DriveSyncProps {
  open: boolean;
  onClose: () => void;
}

export function DriveSync({ open, onClose }: DriveSyncProps) {
  const {
    isConnected,
    isSyncing,
    lastSyncedAt,
    userEmail,
    error,
    lastConflicts,
    connect,
    cancelConnect,
    disconnect,
    pushToDrive,
    restoreFromDrive,
    clearError,
  } = useDriveStore();

  const [conflictsDismissed, setConflictsDismissed] = React.useState(false);
  const [confirmRestore, setConfirmRestore] = React.useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);

  // Reset dismissed flag when new conflicts arrive
  React.useEffect(() => {
    if (lastConflicts.length > 0) setConflictsDismissed(false);
  }, [lastConflicts]);

  async function handleRestore() {
    setConfirmRestore(false);
    await restoreFromDrive();
  }

  async function handleDisconnect() {
    setConfirmDisconnect(false);
    disconnect();
    onClose();
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} title="Google Drive Sync">
        <div className="min-w-[340px] space-y-4">

          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-2 bg-red-900/40 border border-red-700 rounded-lg px-3 py-2.5">
              <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-300 flex-1">{error}</p>
              <button onClick={clearError} className="text-red-400 hover:text-red-200 shrink-0">
                <X size={14} />
              </button>
            </div>
          )}

          {/* Conflict notification */}
          {!conflictsDismissed && lastConflicts.length > 0 && (
            <div className="flex items-start gap-2 bg-yellow-900/30 border border-yellow-700/60 rounded-lg px-3 py-2.5">
              <RefreshCw size={16} className="text-yellow-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-yellow-300 font-medium">Updated from another device</p>
                <p className="text-xs text-yellow-400/80 mt-0.5">
                  {lastConflicts.join(', ')} — your local versions were saved as snapshots.
                </p>
              </div>
              <button onClick={() => setConflictsDismissed(true)} className="text-yellow-500 hover:text-yellow-300 shrink-0">
                <X size={14} />
              </button>
            </div>
          )}

          {/* ── Not connected ────────────────────────────────────────────── */}
          {!isConnected && (
            <div className="text-center py-4 space-y-4">
              <div className="flex justify-center">
                {isSyncing ? (
                  <Loader2 size={48} className="text-slate-500 animate-spin" />
                ) : (
                  <CloudOff size={48} className="text-slate-600" />
                )}
              </div>
              <div>
                {isSyncing ? (
                  <>
                    <p className="text-slate-300 font-medium">Waiting for Google…</p>
                    <p className="text-slate-500 text-sm mt-1">
                      Complete sign-in in the browser window that just opened.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-slate-300 font-medium">Back up your characters to Google Drive</p>
                    <p className="text-slate-500 text-sm mt-1">
                      Auto-syncs on startup and after changes. Access your characters on any device.
                    </p>
                  </>
                )}
              </div>
              {isSyncing ? (
                <Button
                  onClick={cancelConnect}
                  variant="secondary"
                  className="w-full justify-center"
                >
                  Cancel
                </Button>
              ) : (
                <Button
                  onClick={connect}
                  className="w-full justify-center"
                >
                  <Cloud size={16} /> Connect Google Drive
                </Button>
              )}
            </div>
          )}

          {/* ── Connected ────────────────────────────────────────────────── */}
          {isConnected && (
            <div className="space-y-4">
              {/* Account + status */}
              <div className="flex items-center gap-3 bg-slate-700/50 rounded-lg px-3 py-2.5">
                <Cloud size={20} className="text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{userEmail || 'Google Drive'}</p>
                  <p className="text-xs text-slate-400">
                    Last synced: {formatRelative(lastSyncedAt)}
                  </p>
                </div>
                {isSyncing && <Loader2 size={16} className="animate-spin text-emerald-400 shrink-0" />}
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2">
                <Button
                  onClick={pushToDrive}
                  disabled={isSyncing}
                  className="w-full justify-center"
                  variant="outline"
                >
                  {isSyncing ? (
                    <><Loader2 size={15} className="animate-spin" /> Syncing…</>
                  ) : (
                    <><CloudUpload size={15} /> Backup Now</>
                  )}
                </Button>

                <Button
                  onClick={() => setConfirmRestore(true)}
                  disabled={isSyncing}
                  className="w-full justify-center"
                  variant="outline"
                >
                  <CloudDownload size={15} /> Restore from Drive
                </Button>
              </div>

              {/* Disconnect */}
              <div className="pt-1 border-t border-slate-700">
                <button
                  onClick={() => setConfirmDisconnect(true)}
                  className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-400 transition-colors"
                >
                  <LogOut size={13} /> Disconnect
                </button>
              </div>
            </div>
          )}

        </div>
      </Dialog>

      {/* ── Restore confirm dialog ──────────────────────────────────────────── */}
      <Dialog
        open={confirmRestore}
        onClose={() => setConfirmRestore(false)}
        title="Restore from Drive?"
      >
        <p className="text-slate-300 mb-2">
          Your entire local character library will be replaced with the Drive backup.
        </p>
        <p className="text-slate-400 text-sm mb-6">
          All current local characters will be saved as snapshots first, so nothing is permanently lost.
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setConfirmRestore(false)}>Cancel</Button>
          <Button variant="danger" onClick={handleRestore}>
            <CloudDownload size={15} /> Restore
          </Button>
        </div>
      </Dialog>

      {/* ── Disconnect confirm dialog ───────────────────────────────────────── */}
      <Dialog
        open={confirmDisconnect}
        onClose={() => setConfirmDisconnect(false)}
        title="Disconnect Google Drive?"
      >
        <p className="text-slate-300 mb-6">
          Your characters will no longer sync to Google Drive. Local data is not affected.
        </p>
        <div className="flex gap-3 justify-end">
          <Button variant="secondary" onClick={() => setConfirmDisconnect(false)}>Cancel</Button>
          <Button variant="danger" onClick={handleDisconnect}>
            <LogOut size={15} /> Disconnect
          </Button>
        </div>
      </Dialog>
    </>
  );
}

// ── Header button (rendered in HomePage) ─────────────────────────────────────

/** Just the icon button — deliberately NOT holding its own open/close state
 *  or rendering <DriveSync> itself. It used to, but it's rendered inside
 *  HomePage's Settings dialog, which unmounts its whole subtree on close
 *  (see ui/Dialog: `if (!open) return null`). The click here also bubbles up
 *  to a wrapper that closes Settings (so the two dialogs don't stack) — with
 *  the drive dialog's state living IN this same subtree, that close-Settings
 *  bubble was unmounting this component (and the open=true it had just set)
 *  in the same tick, before the drive dialog ever got a chance to render.
 *  Net effect: Settings closes, nothing else visibly happens. Fix: the parent
 *  now owns the open state and renders <DriveSync> itself, outside Settings'
 *  Dialog — see HomePage.tsx. */
export function DriveSyncButton({ onClick }: { onClick: () => void }) {
  const { isConnected, isSyncing } = useDriveStore();

  return (
    <button
      onClick={onClick}
      title={isConnected ? 'Google Drive sync active' : 'Connect Google Drive'}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors ${
        isConnected
          ? 'text-emerald-400 border-emerald-800 hover:border-emerald-600 bg-emerald-900/20'
          : 'text-slate-400 border-slate-700 hover:border-slate-500 hover:text-slate-200'
      }`}
    >
      {isSyncing ? (
        <Loader2 size={16} className="animate-spin" />
      ) : isConnected ? (
        <Cloud size={16} />
      ) : (
        <CloudOff size={16} />
      )}
    </button>
  );
}
