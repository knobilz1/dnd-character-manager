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

export default function ModelReviewPage() {
  const entries = React.useMemo(buildEntries, []);
  // ?family=loxodon&gender=female&state=limp-lv3 — lets the headless survey script
  // (scratch-armor/tools/anim-survey.mjs) capture any body/state without keyboard driving.
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
        <ol className="space-y-0.5">
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
