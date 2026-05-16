import { useEffect, useState, useCallback } from 'react';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type UpdateCheckStatus = 'idle' | 'checking' | 'up-to-date' | 'available';

export function useAppUpdater() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [checkStatus, setCheckStatus] = useState<UpdateCheckStatus>('idle');

  const runCheck = useCallback(async (silent = true) => {
    if (!isTauri) {
      if (!silent) setCheckStatus('up-to-date');
      return;
    }
    setCheckStatus('checking');
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update?.available) {
        setUpdateAvailable(true);
        setUpdateVersion(update.version ?? null);
        setCheckStatus('available');
      } else {
        setCheckStatus('up-to-date');
      }
    } catch {
      setCheckStatus(silent ? 'idle' : 'up-to-date');
    }
  }, []);

  // Auto-check 3s after startup
  useEffect(() => {
    const t = setTimeout(() => runCheck(true), 3000);
    return () => clearTimeout(t);
  }, [runCheck]);

  async function installUpdate() {
    if (!isTauri || !updateAvailable) return;
    setInstalling(true);
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      const update = await check();
      if (update?.available) {
        await update.downloadAndInstall();
        await relaunch();
      }
    } catch (e) {
      console.error('Update failed:', e);
      setInstalling(false);
    }
  }

  return {
    updateAvailable,
    updateVersion,
    installing,
    installUpdate,
    checkStatus,
    checkForUpdates: () => runCheck(false),
  };
}
