import { useEffect, useState } from 'react';

// Only import Tauri APIs when running as a desktop app
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function useAppUpdater() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    const check = async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (update?.available) {
          setUpdateAvailable(true);
          setUpdateVersion(update.version ?? null);
        }
      } catch {
        // Silently ignore — network offline, no release yet, etc.
      }
    };
    // Check after a short delay so it doesn't block startup
    const t = setTimeout(check, 3000);
    return () => clearTimeout(t);
  }, []);

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

  return { updateAvailable, updateVersion, installing, installUpdate };
}
