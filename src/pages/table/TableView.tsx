import React from 'react';
import { EffectsLayer, type EffectGrid } from './EffectsLayer';
import type { PlacedEffect } from '../../utils/dmActions';

/**
 * TableView — the chrome-less battle-map surface shown on a TV / second display
 * (spike Feature 1, step 1.1). main.tsx renders this standalone when the
 * window's path is /table, WITHOUT the App shell: no sidebar, no sync hooks, no
 * update banner, no 3D preload — just the map, full-bleed on black, so physical
 * minis sit directly on top of it.
 *
 * Data comes from the DM Console in the SAME app via the localStorage key
 * `tavern-sheet-table-map` (same-origin webviews share localStorage). We poll it
 * rather than lean on cross-window `storage` events, which don't fire reliably
 * across WebView2 windows. Only the DM's REVEALED, zone-free floors are ever
 * written there (DMConsolePage.writeTableMap → revealedPayload), so the TV is a
 * safe player-facing surface — it can't leak an unexplored floor or the
 * enemy/party start-zones.
 *
 * Fit-to-screen (object-contain): one grid square is NOT a true physical inch —
 * that's the ruler calibration (step 1.2), deliberately skipped for this MVP, so
 * squares may render larger or smaller than a mini base and that's fine.
 */

const TABLE_MAP_KEY = 'tavern-sheet-table-map';
const POLL_MS = 500;

interface TableFloor { name: string; png: string; }
interface TableMap {
  name: string;
  floors: TableFloor[];
  activeFloor: number;
  /** Persistent spell areas, written only during a GRID-mode fight. Absent on every
   *  other payload, so an older/off-grid map simply draws no overlay. */
  effects?: PlacedEffect[];
  grid?: EffectGrid;
}

function readTableMap(): TableMap | null {
  try {
    const raw = localStorage.getItem(TABLE_MAP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TableMap | null;
    return parsed && Array.isArray(parsed.floors) ? parsed : null;
  } catch {
    return null;
  }
}

export function TableView() {
  const [map, setMap] = React.useState<TableMap | null>(() => readTableMap());
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  const lastRaw = React.useRef<string | null>(null);

  // Poll the shared slot. Skip the parse + re-render when the raw string is
  // unchanged, so a static map costs one string compare every tick.
  React.useEffect(() => {
    const tick = () => {
      const raw = localStorage.getItem(TABLE_MAP_KEY);
      if (raw === lastRaw.current) return;
      lastRaw.current = raw;
      setMap(readTableMap());
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, []);

  // Esc closes the kiosk window — it's decoration-less, so there's no titlebar X.
  React.useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow().close(),
      );
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const floors = map?.floors ?? [];
  const active = floors[Math.min(Math.max(map?.activeFloor ?? 0, 0), floors.length - 1)];

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center overflow-hidden select-none cursor-none">
      {!map ? (
        <p className="text-slate-600 text-2xl">Waiting for the DM to present a map…</p>
      ) : floors.length === 0 || !active ? (
        <p className="text-slate-600 text-2xl">No areas revealed yet.</p>
      ) : (
        <>
          <img
            ref={setImg}
            src={active.png}
            alt={`${map.name} — ${active.name}`}
            className="w-full h-full object-contain"
            draggable={false}
          />
          {map.grid && !!map.effects?.length && (
            <EffectsLayer effects={map.effects} grid={map.grid} img={img} />
          )}
          {floors.length > 1 && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-black/60 text-slate-300 text-lg tracking-wide">
              {active.name}
            </div>
          )}
        </>
      )}
    </div>
  );
}
