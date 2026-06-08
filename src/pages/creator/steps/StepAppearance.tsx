import React from 'react';
import { useCreatorStore } from '../../../store/useCreatorStore';
import { cn } from '../../../utils/cn';
import type { CharacterGender } from '../../../types';
import { getHairStyle, hairStylesFor, modelRace } from '../../../data/hair';

const CharacterViewport = React.lazy(() => import('../../sheet/CharacterViewport'));

const GENDERS: { value: CharacterGender; label: string; icon: string }[] = [
  { value: 'male',      label: 'Male',      icon: '♂' },
  { value: 'female',    label: 'Female',    icon: '♀' },
  { value: 'nonbinary', label: 'Non-binary', icon: '⚧' },
];

// Quick hair-color swatches (custom color still available via the picker).
const HAIR_SWATCHES = ['#1c1410', '#3b2a1a', '#6b4423', '#a8742f', '#c9a227', '#d6cfc4', '#8a8a8a', '#b03b2e'];
const DEFAULT_HAIR_COLOR = '#3b2a1a';

// Placeholder option card — for future customisation options
function ComingSoonCard({ label, icon }: { label: string; icon: string }) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-col items-center gap-2 opacity-50 select-none">
      <span className="text-2xl">{icon}</span>
      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{label}</p>
      <p className="text-xs text-slate-600">Coming soon</p>
    </div>
  );
}

export function StepAppearance() {
  const { draft, updateDraft } = useCreatorStore();
  const appearance = draft.appearance ?? { gender: 'male' as CharacterGender };
  const gender = appearance.gender ?? 'male';
  const hairId = appearance.hairId ?? 'none';
  const hairColor = appearance.hairColor ?? DEFAULT_HAIR_COLOR;

  const styles = hairStylesFor(modelRace(draft.raceId), gender);
  const activeStyle = getHairStyle(hairId);
  const tintable = !!activeStyle && activeStyle.id !== 'none' && activeStyle.tintable !== false;

  function patch(p: Partial<typeof appearance>) {
    updateDraft({ appearance: { ...appearance, ...p } });
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-1">Appearance</h2>
      <p className="text-slate-400 mb-6">Customise how your character looks in the 3D viewer. More options coming as new models are added.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 3D viewport — large preview */}
        <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
          <div className="h-[420px]">
            <React.Suspense fallback={
              <div className="w-full h-full flex items-center justify-center text-slate-500 text-sm">
                Loading character…
              </div>
            }>
              <CharacterViewport
                animationState="idle"
                gender={gender}
                raceId={draft.raceId}
                hairId={hairId}
                hairColor={tintable ? hairColor : undefined}
                minimal
                className="w-full h-full"
              />
            </React.Suspense>
          </div>

          {/* Gender toggle pinned to bottom of viewport card */}
          <div className="border-t border-slate-700 p-3">
            <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-2">Gender</p>
            <div className="flex gap-2">
              {GENDERS.map(g => (
                <button
                  key={g.value}
                  onClick={() => patch({ gender: g.value })}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all border',
                    gender === g.value
                      ? 'bg-red-700 border-red-600 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white',
                  )}
                >
                  <span className="text-base leading-none">{g.icon}</span>
                  <span className="text-xs">{g.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Options panel */}
        <div className="space-y-4">
          {/* Current selections summary */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Current Look</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Gender</span>
                <span className="text-white font-medium capitalize">{gender}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Skin Tone</span>
                <span className="text-slate-600 italic">Default</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Hair</span>
                <span className="text-white font-medium flex items-center gap-2">
                  {activeStyle?.label ?? 'Default'}
                  {tintable && <span className="w-3.5 h-3.5 rounded-full border border-slate-500" style={{ background: hairColor }} />}
                </span>
              </div>
            </div>
          </div>

          {/* Hair style picker */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Hair Style</h3>
            <div className="grid grid-cols-2 gap-2">
              {styles.map(s => (
                <button
                  key={s.id}
                  onClick={() => patch({ hairId: s.id })}
                  className={cn(
                    'flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-medium transition-all border',
                    hairId === s.id
                      ? 'bg-red-700 border-red-600 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white',
                  )}
                >
                  <span className="text-base leading-none">{s.id === 'none' ? '🚫' : '💇'}</span>
                  <span className="text-xs">{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Hair colour */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Hair Colour</h3>
            <div className={cn('flex items-center gap-2 flex-wrap', !tintable && 'opacity-40 pointer-events-none')}>
              {HAIR_SWATCHES.map(c => (
                <button
                  key={c}
                  onClick={() => patch({ hairColor: c })}
                  title={c}
                  className={cn(
                    'w-7 h-7 rounded-full border-2 transition-transform hover:scale-110',
                    hairColor.toLowerCase() === c.toLowerCase() ? 'border-white' : 'border-slate-600',
                  )}
                  style={{ background: c }}
                />
              ))}
              <label className="w-7 h-7 rounded-full border-2 border-slate-600 overflow-hidden cursor-pointer relative" title="Custom colour">
                <input
                  type="color"
                  value={hairColor}
                  onChange={(e) => patch({ hairColor: e.target.value })}
                  className="absolute inset-0 w-[150%] h-[150%] -left-1/4 -top-1/4 cursor-pointer"
                />
              </label>
            </div>
            {!tintable && <p className="text-xs text-slate-600 mt-2">Colour applies once a hairstyle is selected.</p>}
          </div>

          {/* Future options — shown as coming-soon placeholders */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">More Customisation</h3>
            <div className="grid grid-cols-2 gap-3">
              <ComingSoonCard label="Skin Tone" icon="🎨" />
              <ComingSoonCard label="Eye Colour" icon="👁️" />
            </div>
          </div>

          <p className="text-xs text-slate-600 text-center">
            You can change your appearance at any time from the character sheet.
          </p>
        </div>
      </div>
    </div>
  );
}
