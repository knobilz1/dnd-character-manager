import React from 'react';
import { useWizardStore } from '../../../store/useWizardStore';
import { ALL_CLASSES } from '../../../data/classes';
import { Badge, NumberStepper } from '../../../components/ui';
import { cn } from '../../../utils/cn';
import type { DClass } from '../../../types';

const SCHOOL_COLORS: Record<string, string> = {
  full: 'purple', half: 'blue', third: 'indigo', pact: 'amber', none: 'slate',
};

export function StepClass() {
  const { draft, updateDraft } = useWizardStore();
  const [selected, setSelected] = React.useState<DClass | null>(
    draft.classes?.[0] ? ALL_CLASSES.find(c => c.id === draft.classes![0].classId) ?? null : null
  );
  const currentLevel = draft.classes?.[0]?.level ?? 1;

  function selectClass(cls: DClass) {
    setSelected(cls);
    updateDraft({ classes: [{ classId: cls.id, level: currentLevel, hitPointsRolled: [] }] });
  }

  function setLevel(level: number) {
    if (!selected) return;
    updateDraft({ classes: [{ classId: selected.id, level, hitPointsRolled: [] }] });
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Choose Your Class</h2>
        <p className="text-slate-400 mb-4">Your class is the primary definition of what your character can do.</p>

        {/* Level selector */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-4 flex items-center justify-between">
          <div>
            <p className="font-bold text-white">Character Level</p>
            <p className="text-xs text-slate-400">Starting level (1–20)</p>
          </div>
          <NumberStepper value={currentLevel} min={1} max={20} onChange={setLevel} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {ALL_CLASSES.map(cls => (
            <div
              key={cls.id}
              onClick={() => selectClass(cls)}
              className={cn(
                'p-3 rounded-lg border-2 cursor-pointer transition-all',
                draft.classes?.[0]?.classId === cls.id
                  ? 'border-red-500 bg-red-950/30'
                  : 'border-slate-700 hover:border-slate-500 bg-slate-800',
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <h4 className="font-bold text-white text-sm">{cls.name}</h4>
                <span className="text-xs text-slate-400">d{cls.hitDie}</span>
              </div>
              <div className="flex gap-1 flex-wrap">
                <Badge color="slate">{cls.savingThrows.map(s => s.toUpperCase()).join(', ')}</Badge>
                {cls.spellcastingType !== 'none' && (
                  <Badge color={SCHOOL_COLORS[cls.spellcastingType]}>{cls.spellcastingType} caster</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Class detail */}
      <div className="lg:sticky lg:top-0 lg:self-start">
        {selected ? (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 max-h-[calc(100vh-200px)] overflow-y-auto scrollbar-thin">
            <h3 className="text-xl font-bold text-white mb-1">{selected.name}</h3>
            <div className="flex flex-wrap gap-2 mb-4">
              <Badge>d{selected.hitDie} Hit Die</Badge>
              <Badge color={SCHOOL_COLORS[selected.spellcastingType] ?? 'slate'}>
                {selected.spellcastingType === 'none' ? 'Non-caster' : `${selected.spellcastingType} caster`}
              </Badge>
              <Badge color="slate">{selected.sourceBook}</Badge>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Saving Throws</p>
                <p className="text-white font-medium">{selected.savingThrows.map(s => s.toUpperCase()).join(', ')}</p>
              </div>
              <div className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Primary Ability</p>
                <p className="text-white font-medium">{selected.primaryAbility.map(a => a.toUpperCase()).join(', ')}</p>
              </div>
              <div className="bg-slate-900 rounded-lg p-3 col-span-2">
                <p className="text-xs text-slate-400 mb-1">Skill Choices</p>
                <p className="text-white font-medium">Choose {selected.skillChoices.count} from: {selected.skillChoices.from.slice(0,4).join(', ')}{selected.skillChoices.from.length > 4 ? '...' : ''}</p>
              </div>
            </div>

            {selected.resources.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Class Resources</h4>
                {selected.resources.map(r => (
                  <div key={r.key} className="bg-slate-900 rounded-lg p-3 mb-2">
                    <p className="font-bold text-white text-sm">{r.name}</p>
                    <p className="text-xs text-slate-400">Recharges on {r.rechargeOn} rest</p>
                  </div>
                ))}
              </div>
            )}

            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Class Features (Level {currentLevel})</h4>
              <div className="space-y-2">
                {selected.features
                  .filter(f => f.level <= currentLevel)
                  .sort((a, b) => a.level - b.level)
                  .map((feature, i) => (
                    <div key={i} className="bg-slate-900 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">Lv.{feature.level}</span>
                        <h5 className="font-bold text-white text-sm">{feature.name}</h5>
                        {feature.isASI && <Badge color="amber">ASI</Badge>}
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">{feature.description}</p>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center text-slate-500">
            Select a class to see details
          </div>
        )}
      </div>
    </div>
  );
}
