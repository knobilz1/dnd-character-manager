import React from 'react';
import { useCreatorStore } from '../../../store/useCreatorStore';
import { cn } from '../../../utils/cn';
import type { CharacterGender } from '../../../types';

const CharacterViewport = React.lazy(() => import('../../sheet/CharacterViewport'));

const GENDERS: { value: CharacterGender; label: string; icon: string }[] = [
  { value: 'male',      label: 'Male',      icon: '♂' },
  { value: 'female',    label: 'Female',    icon: '♀' },
  { value: 'nonbinary', label: 'Non-binary', icon: '⚧' },
];

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
  const gender = draft.appearance?.gender ?? 'male';

  function setGender(g: CharacterGender) {
    updateDraft({ appearance: { ...(draft.appearance ?? { gender: 'male' }), gender: g } });
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
              <CharacterViewport animationState="idle" className="w-full h-full" />
            </React.Suspense>
          </div>

          {/* Gender toggle pinned to bottom of viewport card */}
          <div className="border-t border-slate-700 p-3">
            <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-2">Gender</p>
            <div className="flex gap-2">
              {GENDERS.map(g => (
                <button
                  key={g.value}
                  onClick={() => setGender(g.value)}
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
                <span className="text-slate-600 italic">Default</span>
              </div>
            </div>
          </div>

          {/* Future options — shown as coming-soon placeholders */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Customisation</h3>
            <div className="grid grid-cols-2 gap-3">
              <ComingSoonCard label="Skin Tone" icon="🎨" />
              <ComingSoonCard label="Hair Style" icon="💇" />
              <ComingSoonCard label="Hair Colour" icon="🎭" />
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
