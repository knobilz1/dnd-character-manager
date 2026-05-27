import { useCreatorStore } from '../../../store/useCreatorStore';
import { ALL_BACKGROUNDS } from '../../../data/backgrounds';
import { cn } from '../../../utils/cn';
import { bookEnabled } from '../../../utils/bookEnabled';

export function StepBackground() {
  const { draft, updateDraft } = useCreatorStore();
  const available = ALL_BACKGROUNDS.filter(b => bookEnabled(b, draft.enabledBooks));

  function select(id: string) {
    updateDraft({ backgroundId: id });
  }

  const selected = available.find(b => b.id === draft.backgroundId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Choose Your Background</h2>
        <p className="text-slate-400 mb-4">Your background reveals where you came from, how you became an adventurer, and your place in the world.</p>

        <div className="grid gap-2 sm:grid-cols-2">
          {available.map(bg => (
            <div
              key={bg.id}
              onClick={() => select(bg.id)}
              className={cn(
                'p-3 rounded-lg border-2 cursor-pointer transition-all',
                draft.backgroundId === bg.id
                  ? 'border-red-500 bg-red-950/30'
                  : 'border-slate-700 hover:border-slate-500 bg-slate-800',
              )}
            >
              <h4 className="font-bold text-white text-sm mb-1">{bg.name}</h4>
              <div className="flex flex-wrap gap-1">
                {bg.skillProficiencies.map(s => (
                  <span key={s} className="text-xs text-slate-400 bg-slate-700 px-1.5 py-0.5 rounded">{s}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="lg:sticky lg:top-0 lg:self-start">
        {selected ? (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
            <h3 className="text-xl font-bold text-white mb-3">{selected.name}</h3>

            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Skill Proficiencies</p>
                <p className="text-white font-medium">{selected.skillProficiencies.join(', ')}</p>
              </div>
              <div className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Languages</p>
                <p className="text-white font-medium">{selected.languages > 0 ? `+${selected.languages} language(s)` : 'None'}</p>
              </div>
              {selected.toolProficiencies.length > 0 && (
                <div className="bg-slate-900 rounded-lg p-3 col-span-2">
                  <p className="text-xs text-slate-400 mb-1">Tool Proficiencies</p>
                  <p className="text-white font-medium">{selected.toolProficiencies.join(', ')}</p>
                </div>
              )}
            </div>

            <div className="bg-slate-900 rounded-lg p-3 mb-4">
              <h5 className="font-bold text-white text-sm mb-1">Feature: {selected.feature.name}</h5>
              <p className="text-xs text-slate-400 leading-relaxed">{selected.feature.description}</p>
            </div>

            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Personality Traits</h4>
              <div className="space-y-1">
                {selected.personalityTraits.slice(0, 2).map((t, i) => (
                  <p key={i} className="text-xs text-slate-400 italic">"{t}"</p>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center text-slate-500">
            Select a background to see details
          </div>
        )}
      </div>
    </div>
  );
}
