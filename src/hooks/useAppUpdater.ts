import { useEffect, useState, useCallback, useRef } from 'react';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type UpdateCheckStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'error';

export function useAppUpdater() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [checkStatus, setCheckStatus] = useState<UpdateCheckStatus>('idle');
  // Cache the update object so installUpdate doesn't need a second check() call
  const cachedUpdate = useRef<Awaited<ReturnType<typeof import('@tauri-apps/plugin-updater').check>> | null>(null);

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
        cachedUpdate.current = update;
        setUpdateAvailable(true);
        setUpdateVersion(update.version ?? null);
        setCheckStatus('available');
      } else {
        cachedUpdate.current = null;
        setCheckStatus('up-to-date');
      }
    } catch (e) {
      console.error('Update check failed:', e);
      // Only show error on manual checks; silent startup checks fall back to idle
      setCheckStatus(silent ? 'idle' : 'error');
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
      const { relaunch } = await import('@tauri-apps/plugin-process');
      // Use the cached update object from the check — avoids a redundant second fetch
      const update = cachedUpdate.current;
      if (update?.available) {
        await update.downloadAndInstall();
        await relaunch();
      } else {
        // Cached update gone (e.g. app was open a long time); re-check once
        const { check } = await import('@tauri-apps/plugin-updater');
        const fresh = await check();
        if (fresh?.available) {
          await fresh.downloadAndInstall();
          await relaunch();
        }
      }
    } catch (e) {
      console.error('Update install failed:', e);
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
