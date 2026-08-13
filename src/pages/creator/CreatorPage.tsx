import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Check, X } from 'lucide-react';
import { useCreatorStore } from '../../store/useCreatorStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { WIZARD_STEPS, STEP_LABELS, type WizardStep } from '../../types';
import { Button } from '../../components/ui';
import { cn } from '../../utils/cn';

import { StepBooks } from './steps/StepBooks';
import { StepRace } from './steps/StepRace';
import { StepClass } from './steps/StepClass';
import { StepSubclass } from './steps/StepSubclass';
import { StepClassOptions } from './steps/StepClassOptions';
import { StepBackground } from './steps/StepBackground';
import { StepAbilityScores } from './steps/StepAbilityScores';
import { StepSkills } from './steps/StepSkills';
import { StepFeats } from './steps/StepFeats';
import { StepSpells } from './steps/StepSpells';
import { StepEquipment } from './steps/StepEquipment';
import { StepReview } from './steps/StepReview';
import { StepAppearance } from './steps/StepAppearance';

const STEP_COMPONENTS: Record<WizardStep, React.ComponentType> = {
  'books': StepBooks,
  'race': StepRace,
  'class': StepClass,
  'subclass': StepSubclass,
  'class-options': StepClassOptions,
  'appearance': StepAppearance,
  'background': StepBackground,
  'ability-scores': StepAbilityScores,
  'skills': StepSkills,
  'feats': StepFeats,
  'spells': StepSpells,
  'equipment': StepEquipment,
  'review': StepReview,
};

/** Why `canAdvance` said no, for the hint under the Next button. Null when it said yes. */
function blockedReason(step: WizardStep, draft: any): string | null {
  if (step === 'ability-scores' && !canAdvance(step, draft)) {
    return 'Assign a value to every ability score before continuing.';
  }
  return null;
}

/** Exported for tests — this predicate was silently `true` for a whole step once. */
export function canAdvance(step: WizardStep, draft: any): boolean {
  switch (step) {
    case 'books': return draft.enabledBooks.length > 0;
    case 'race': return !!draft.raceId;
    case 'class': return !!draft.classes?.length && draft.classes[0].level >= 1;
    case 'subclass': return true; // subclass might not be available yet
    case 'class-options': return true;
    case 'background': return !!draft.backgroundId;
    // `baseAbilityScores` is always present — INITIAL_DRAFT seeds it, and rolling
    // deliberately ZEROES all six so the player can assign the rolled values. So
    // the old `!!draft.baseAbilityScores` was permanently true, and a player who
    // rolled and then forgot to assign could walk to the end and create a
    // character with 0 in every stat. 0 is not a legal score in 5e (rolled 4d6
    // drop-lowest bottoms out at 3), so this rejects only genuinely unassigned
    // scores and can never block a legitimate build.
    case 'ability-scores': {
      const scores: number[] = Object.values(draft.baseAbilityScores ?? {});
      return scores.length === 6 && scores.every(v => (v ?? 0) >= 1);
    }
    case 'skills': return true;
    case 'feats': return true;
    case 'spells': return true;
    case 'equipment': return true;
    case 'review': return !!(draft.name?.trim());
    default: return true;
  }
}

export function CreatorPage() {
  const navigate = useNavigate();
  const { step, draft, goNext, goPrev, finalize, reset } = useCreatorStore();
  const { createCharacter } = useLibraryStore();

  const currentIdx = WIZARD_STEPS.indexOf(step);
  const StepComponent = STEP_COMPONENTS[step];
  const canGo = canAdvance(step, draft);
  const blocked = blockedReason(step, draft);
  const isLast = step === 'review';

  function handleFinish() {
    const character = finalize();
    if (character) {
      createCharacter(character);
      reset();
      navigate(`/character/${character.id}`);
    }
  }

  function handleCancel() {
    reset();
    navigate('/');
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      {/* Top bar */}
      <div className="bg-slate-800 border-b border-slate-700 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-white">Create Character</h1>
          <button onClick={handleCancel} className="text-slate-400 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Step indicator */}
      <div className="bg-slate-800 border-b border-slate-700 px-6 py-3 overflow-x-auto">
        <div className="max-w-4xl mx-auto flex items-center gap-1 min-w-max">
          {WIZARD_STEPS.map((s, idx) => {
            const done = idx < currentIdx;
            const active = idx === currentIdx;
            return (
              <React.Fragment key={s}>
                <div className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  active && 'bg-red-700 text-white',
                  done && 'text-green-400',
                  !active && !done && 'text-slate-500',
                )}>
                  {done ? <Check size={12} /> : <span className="w-4 text-center">{idx + 1}</span>}
                  {STEP_LABELS[s]}
                </div>
                {idx < WIZARD_STEPS.length - 1 && (
                  <ChevronRight size={14} className="text-slate-600 shrink-0" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6">
          <StepComponent />
        </div>
      </div>

      {/* Footer nav */}
      <div className="bg-slate-800 border-t border-slate-700 px-6 py-4">
        <div className="max-w-4xl mx-auto flex justify-between">
          <Button variant="secondary" onClick={goPrev} disabled={currentIdx === 0}>
            <ChevronLeft size={16} /> Back
          </Button>
          {isLast ? (
            <Button onClick={handleFinish} disabled={!draft.name?.trim()}>
              <Check size={16} /> Create Character
            </Button>
          ) : (
            <div className="flex items-center gap-3">
              {/* A dead Next button with no reason reads as a bug. */}
              {blocked && <p className="text-xs text-amber-400">{blocked}</p>}
              <Button onClick={goNext} disabled={!canGo}>
                Next <ChevronRight size={16} />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
