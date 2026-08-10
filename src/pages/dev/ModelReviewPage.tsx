/**
 * ModelReviewPage — review every rigged body against every animation state.
 *
 * Deliberately renders the REAL <CharacterViewport>, the same component the sheet uses, rather
 * than a second three.js viewer. A separate viewer would have its own texture handling, its own
 * height normalisation and its own animation retargeting, so a body could look fine here and wrong
 * on the sheet (or the reverse) — which makes the review worthless. Same component, same code path.
 *
 * Why the animation states matter: idle barely moves the skeleton. The limp and down clips bend
 * knees hard and put the body on the ground, which is where a bad rig actually shows. And the
 * viewport has OrbitControls — rotating is what caught a whole batch of misplaced knees that
 * looked perfect from the front.
 *
 * Dev route: /model-review
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { ALL_RACES } from '../../data/races';
import { modelRace, type ModelRace } from '../../data/hair';
import CharacterViewport, { getAssets, type AnimationState, type CharacterGender } from '../sheet/CharacterViewport';
import { DEFAULT_GARMENT_FIT, loadGarmentFit, saveGarmentFit, clearGarmentFit, type GarmentFit } from '../../data/armor';

const STATES: { id: AnimationState; label: string; note?: string }[] = [
  { id: 'idle', label: 'Idle' },
  { id: 'limp-lv1', label: 'Limp 1', note: '≤75% HP' },
  { id: 'limp-lv2', label: 'Limp 2', note: '≤50% HP' },
  { id: 'limp-lv3', label: 'Limp 3', note: '≤25% HP' },
  { id: 'hurt-light', label: 'Hurt (light)', note: 'transient' },
  { id: 'hurt-heavy', label: 'Hurt (heavy)', note: 'transient' },
  { id: 'down', label: 'Down', note: '0 HP' },
];

/** One entry per body family, with a real raceId that maps to it. */
type Entry = { family: ModelRace; raceId: string; label: string };

function buildEntries(): Entry[] {
  const seen = new Map<ModelRace, Entry>();
  for (const r of ALL_RACES) {
    if (r.isSubrace || r.hidden) continue;
    const family = modelRace(r.id);
    if (seen.has(family)) continue;
    seen.set(family, { family, raceId: r.id, label: r.name });
  }
  return [...seen.values()].sort((a, b) => a.family.localeCompare(b.family));
}

/**
 * Live garment fit — drag, watch, then bake.
 *
 * Every fit decision so far has cost a ~90s rebuild/re-optimise/re-screenshot round trip, and the
 * offline numbers have repeatedly disagreed with what actually looks right (a metric can be driven
 * to a better score while the piece gets worse — that is how the joint-move regression happened).
 * These sliders drive the REAL viewport at real framerate, so the fit is judged by eye against
 * real animation. Nothing here ships: the values are read off and baked into skin-garment.mjs args,
 * which the readout at the bottom writes out ready to paste.
 */
function GarmentFitPanel({ ids }: { ids: string[] }) {
  const id = ids[0];
  const [fit, setFit] = React.useState<GarmentFit>(() => loadGarmentFit(id));
  React.useEffect(() => { setFit(loadGarmentFit(id)); }, [id]);

  // Functional update, not `{...fit}`: two sliders changed in the same tick both read the state
  // captured at render, so the second silently reverts the first.
  const set = (k: keyof GarmentFit) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setFit((prev) => { const next = { ...prev, [k]: v }; saveGarmentFit(id, next); return next; });
  };

  const row = (label: string, k: keyof GarmentFit, min: number, max: number, step: number, unit = '') => (
    <label key={k} className="mb-2 block">
      <span className="flex justify-between text-[11px] text-neutral-300">
        <span>{label}</span>
        <span className="font-mono tabular-nums">{fit[k].toFixed(2)}{unit}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={fit[k]} onChange={set(k)} className="w-full" />
    </label>
  );

  return (
    <div className="mt-3 border-t border-neutral-700 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-wide">Fit · {id}</h2>
        <button
          onClick={() => { clearGarmentFit(id); setFit(DEFAULT_GARMENT_FIT); }}
          className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] hover:bg-neutral-700"
        >reset</button>
      </div>
      {row('Size', 'scale', 0.6, 1.6, 0.01, '×')}
      {row('Girth (width + depth)', 'girth', 0.7, 1.6, 0.01, '×')}
      {row('Up / down', 'dy', -0.5, 0.5, 0.005, ' of height')}
      {row('Forward / back', 'dz', -0.5, 0.5, 0.005, ' of depth')}
      <p className="mt-2 break-all rounded bg-neutral-950 p-2 font-mono text-[10px] leading-snug text-emerald-300">
        --scale {fit.scale.toFixed(2)} --ease {fit.girth.toFixed(2)} --dy {(fit.dy * 35).toFixed(1)} --dz {(fit.dz * 22).toFixed(1)}
      </p>
      <p className="mt-1 text-[10px] leading-snug text-neutral-500">
        Live only — multiplies onto whatever the GLB was baked with. Offsets are fractions of the
        piece's own size; the cm figures above assume a ~35×22cm torso piece. Flip through the
        animation states and check the fit holds before baking.
      </p>
    </div>
  );
}

export default function ModelReviewPage() {
  const entries = React.useMemo(buildEntries, []);
  // ?family=loxodon&gender=female&state=limp-lv3&armor=heavy_torso — lets the headless survey
  // script (scratch-armor/app-shot.mjs) capture any body/state/wardrobe without keyboard driving.
  const qs = React.useMemo(() => new URLSearchParams(window.location.search), []);
  const [idx, setIdx] = React.useState(() => {
    const i = entries.findIndex((e) => e.family === qs.get('family'));
    return i >= 0 ? i : 0;
  });
  const [gender, setGender] = React.useState<CharacterGender>(qs.get('gender') === 'female' ? 'female' : 'male');
  const [state, setState] = React.useState<AnimationState>(() => {
    const s = qs.get('state');
    return STATES.some((x) => x.id === s) ? (s as AnimationState) : 'idle';
  });

  // Comma list of ARMOR_PIECES ids. Empty/absent -> bare body, which is the default review.
  const armorIds = React.useMemo(() => (qs.get('armor') || '').split(',').filter(Boolean), [qs]);

  const entry = entries[idx];

  // Arrow keys to walk the list — reviewing 30-odd bodies by clicking is the reason this
  // otherwise gets abandoned halfway.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') setIdx((i) => (i + 1) % entries.length);
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') setIdx((i) => (i - 1 + entries.length) % entries.length);
      if (e.key.toLowerCase() === 'g') setGender((g) => (g === 'male' ? 'female' : 'male'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entries.length]);

  // The resolved asset tells the truth about fallbacks: a female harengon renders the MALE body,
  // and without showing the filename you would review it as if it were a female body and pass it.
  const assets = entry ? getAssets(entry.raceId, gender) : null;
  const expected = entry ? `${entry.family[0].toUpperCase()}${entry.family.slice(1)}_${gender === 'female' ? 'Female' : 'Male'}_Idle.glb` : '';
  const isFallback = !!assets && assets.idle.toLowerCase() !== expected.toLowerCase();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-900 text-neutral-100">
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-neutral-700 p-3">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-sm font-bold uppercase tracking-wide">Model review</h1>
          <Link to="/" className="text-xs text-neutral-400 underline">exit</Link>
        </div>
        <p className="mb-3 text-[11px] leading-snug text-neutral-400">
          ↑/↓ body · G gender · drag to orbit. Check the <em>limp</em> and <em>down</em> states —
          idle hides bad knees.
        </p>
        {armorIds.length > 0 && <GarmentFitPanel ids={armorIds} />}
        <ol className="mt-3 space-y-0.5 border-t border-neutral-700 pt-3">
          {entries.map((e, i) => (
            <li key={e.family}>
              <button
                onClick={() => setIdx(i)}
                className={`w-full rounded px-2 py-1 text-left text-xs ${i === idx ? 'bg-amber-600 font-semibold text-black' : 'hover:bg-neutral-800'}`}
              >
                {e.family}
                <span className="ml-1 text-[10px] opacity-60">{e.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-neutral-700 p-3">
          <span className="mr-2 text-sm font-bold">
            {entry?.family} <span className="font-normal opacity-60">({idx + 1}/{entries.length})</span>
          </span>
          {(['male', 'female'] as const).map((g) => (
            <button
              key={g}
              onClick={() => setGender(g)}
              className={`rounded px-2 py-1 text-xs ${gender === g ? 'bg-amber-600 text-black' : 'bg-neutral-800'}`}
            >
              {g}
            </button>
          ))}
          <span className="mx-2 h-4 w-px bg-neutral-700" />
          {STATES.map((s) => (
            <button
              key={s.id}
              onClick={() => setState(s.id)}
              title={s.note}
              className={`rounded px-2 py-1 text-xs ${state === s.id ? 'bg-sky-600' : 'bg-neutral-800'}`}
            >
              {s.label}
            </button>
          ))}
        </header>

        <div className="min-h-0 flex-1">
          {entry && (
            <CharacterViewport
              key={`${entry.raceId}:${gender}`}
              raceId={entry.raceId}
              gender={gender}
              animationState={state}
              armorIds={armorIds}
              className="h-full w-full"
            />
          )}
        </div>

        <footer className="border-t border-neutral-700 px-3 py-2 text-[11px] text-neutral-400">
          {assets && (
            <>
              <span className="font-mono">{assets.idle}</span>
              <span className="mx-2">·</span>
              <span className="font-mono">{assets.anims}</span>
              {isFallback && (
                <span className="ml-3 rounded bg-red-900 px-2 py-0.5 font-semibold text-red-100">
                  FALLBACK — not this species/gender's own body
                </span>
              )}
            </>
          )}
        </footer>
      </main>
    </div>
  );
}
