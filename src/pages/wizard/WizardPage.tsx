import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Check, X } from 'lucide-react';
import { useWizardStore } from '../../store/useWizardStore';
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
import { StepReview } from './steps/StepReview';

const STEP_COMPONENTS: Record<WizardStep, React.ComponentType> = {
  'books': StepBooks,
  'race': StepRace,
  'class': StepClass,
  'subclass': StepSubclass,
  'class-options': StepClassOptions,
  'background': StepBackground,
  'ability-scores': StepAbilityScores,
  'skills': StepSkills,
  'feats': StepFeats,
  'spells': StepSpells,
  'review': StepReview,
};

function canAdvance(step: WizardStep, draft: any): boolean {
  switch (step) {
    case 'books': return draft.enabledBooks.length > 0;
    case 'race': return !!draft.raceId;
    case 'class': return !!draft.classes?.length && draft.classes[0].level >= 1;
    case 'subclass': return true; // subclass might not be available yet
    case 'class-options': return true;
    case 'background': return !!draft.backgroundId;
    case 'ability-scores': return !!draft.baseAbilityScores;
    case 'skills': return true;
    case 'feats': return true;
    case 'spells': return true;
    case 'review': return !!(draft.name?.trim());
    default: return true;
  }
}

export function WizardPage() {
  const navigate = useNavigate();
  const { step, draft, goNext, goPrev, finalize, reset } = useWizardStore();
  const { createCharacter } = useLibraryStore();

  const currentIdx = WIZARD_STEPS.indexOf(step);
  const StepComponent = STEP_COMPONENTS[step];
  const canGo = canAdvance(step, draft);
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
            <Button onClick={goNext} disabled={!canGo}>
              Next <ChevronRight size={16} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
