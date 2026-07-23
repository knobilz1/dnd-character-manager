import React from 'react';
import { Map as MapIcon } from 'lucide-react';
import { useDmConnection } from '../hooks/useDmConnection';
import { useDmMapFeed } from '../hooks/useDmMapFeed';

/**
 * DmMapView — shows the battle map the DM is currently sharing with the table
 * (multi-story Phase 5), fed by useDmMapFeed's poll of party_listener.rs's
 * GET /map. Only the floors the DM has revealed ever arrive here, so a player
 * can study the map on their own device without being able to peek at floors
 * the party hasn't reached. Companion to DmNarrationLog: same connected-gate,
 * same unseen badge. Opens a lightbox since a battle map wants the room a
 * dropdown can't give it.
 */
export function DmMapView() {
  const connected = useDmConnection();
  const map = useDmMapFeed();
  const [open, setOpen] = React.useState(false);
  const [seen, setSeen] = React.useState(true);

  // Any newly-shared (or updated) map is unseen until the player opens it.
  React.useEffect(() => { if (map) setSeen(false); }, [map]);
  React.useEffect(() => { if (open) setSeen(true); }, [open, map]);

  // Nothing to offer if we're not connected and the DM has never shared a map.
  if (!connected && !map) return null;

  const unseen = !!map && !seen && !open;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="The map the DM is sharing"
        className="relative p-1.5 rounded text-slate-500 hover:text-emerald-400 transition-colors"
      >
        <MapIcon size={18} />
        {unseen && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border border-slate-900" />
        )}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 flex flex-col items-center overflow-y-auto p-4"
          onClick={() => setOpen(false)}
        >
          <div className="w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 sticky top-0">
              <div className="text-sm font-medium text-slate-100">
                {map?.name ? `DM's map — ${map.name}` : "DM's map"}
              </div>
              <button
                className="px-2 py-1 rounded bg-slate-800 text-slate-300 hover:text-white text-sm"
                onClick={() => setOpen(false)}
              >
                ✕ Close
              </button>
            </div>
            {!map ? (
              <p className="text-sm text-slate-400 italic">The DM hasn't shared a map yet.</p>
            ) : map.floors.length === 0 ? (
              <p className="text-sm text-slate-400 italic">
                The DM is sharing {map.name} — no areas revealed yet.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {map.floors.map((f) => (
                  <div key={f.name} className="space-y-1">
                    {map.floors.length > 1 && (
                      <div className="text-xs font-medium text-slate-300">{f.name}</div>
                    )}
                    <img
                      src={f.png}
                      alt={`${map.name} — ${f.name}`}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
