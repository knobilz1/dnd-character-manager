import { useEffect, useRef } from 'react';
import { useDriveStore } from '../store/useDriveStore';
import { useLibraryStore } from '../store/useLibraryStore';

const DEBOUNCE_MS = 60_000; // 60 seconds

/**
 * Mount this hook once at the app root.
 * - On mount: runs startup sync (reads keychain, merges with Drive if connected)
 * - Watches library for changes: debounces 60 s then pushes to Drive
 * - On unmount: fires one final push if dirty
 */
export function useDriveSync() {
  const checkOnStartup = useDriveStore((s) => s.checkOnStartup);
  const pushToDrive = useDriveStore((s) => s.pushToDrive);
  const isConnected = useDriveStore((s) => s.isConnected);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const mountedRef = useRef(false);

  // Startup check — runs once on mount
  useEffect(() => {
    checkOnStartup();
    mountedRef.current = true;

    return () => {
      // On unmount flush any pending push
      if (timerRef.current) clearTimeout(timerRef.current);
      if (dirtyRef.current) {
        pushToDrive();
      }
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-push — watches characters and debounces 60 s
  useEffect(() => {
    if (!mountedRef.current) return;

    const unsubscribe = useLibraryStore.subscribe((state, prevState) => {
      if (!isConnected) return;
      if (state.characters === prevState.characters &&
          state.deletedIds === prevState.deletedIds) return;

      dirtyRef.current = true;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        dirtyRef.current = false;
        pushToDrive();
      }, DEBOUNCE_MS);
    });

    return unsubscribe;
  }, [isConnected, pushToDrive]);
}
