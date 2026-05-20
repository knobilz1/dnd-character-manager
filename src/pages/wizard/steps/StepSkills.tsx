import React from 'react';
import { useWizardStore } from '../../../store/useWizardStore';
import { SKILL_ABILITY, abilityMod, PROFICIENCY_BONUS, totalCharacterLevel } from '../../../data/mechanics';
import { getClass } from '../../../data/classes';
import { getBackground } from '../../../data/backgrounds';
import { cn } from '../../../utils/cn';
import type { SkillName } from '../../../types';

const ALL_SKILLS: SkillName[] = [
  'Acrobatics','Animal Handling','Arcana','Athletics','Deception','History',
  'Insight','Intimidation','Investigation','Medicine','Nature','Perception',
  'Performance','Persuasion','Religion','Sleight of Hand','Stealth','Survival',
];

export function StepSkills() {
  const { draft, updateDraft } = useWizardStore();
  const classDef = draft.classes?.[0] ? getClass(draft.classes[0].classId) : null;
  const bg = draft.backgroundId ? getBackground(draft.backgroundId) : null;
  const scores = draft.baseAbilityScores ?? { str:10,dex:10,con:10,int:10,wis:10,cha:10 };

  const backgroundSkills = new Set<SkillName>(bg?.skillProficiencies ?? []);
  const selectedSkills = new Set<SkillName>(draft.selectedSkillProficiencies ?? []);
  const allowedSkills = new Set<SkillName>(classDef?.skillChoices.from ?? ALL_SKILLS);
  const maxChoices = classDef?.skillChoices.count ?? 2;

  // Auto-clean stale selections whenever the class or background changes.
  // A previously chosen skill becomes invalid if:
  //  • it's no longer in the class's allowed list (class changed), or
  //  • it's now granted by the background (background changed).
  const classId = draft.classes?.[0]?.classId;
  const backgroundId = draft.backgroundId;
  React.useEffect(() => {
    const cleaned = (draft.selectedSkillProficiencies ?? []).filter(
      s => allowedSkills.has(s) && !backgroundSkills.has(s)
    );
    if (cleaned.length !== (draft.selectedSkillProficiencies ?? []).length) {
      updateDraft({ selectedSkillProficiencies: cleaned });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, backgroundId]);

  function toggle(skill: SkillName) {
    if (backgroundSkills.has(skill)) return;   // locked in by background
    if (!allowedSkills.has(skill)) return;      // not in this class's skill list
    const next = new Set(selectedSkills);
    if (next.has(skill)) {
      next.delete(skill);
    } else if (next.size < maxChoices) {
      next.add(skill);
    }
    updateDraft({ selectedSkillProficiencies: Array.from(next) });
  }

  const totalLevel = totalCharacterLevel(draft.classes ?? []);
  const profBonus = PROFICIENCY_BONUS[Math.min(totalLevel, 20)] ?? 2;
  const chosenCount = selectedSkills.size;

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-2">Skill Proficiencies</h2>
      <p className="text-slate-400 mb-2">
        Choose {maxChoices} skills from your class list. Background skills are automatically included.
      </p>
      <p className="text-sm text-slate-500 mb-4">
        {chosenCount}/{maxChoices} class skills selected
      </p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {ALL_SKILLS.map(skill => {
          const abilityKey = SKILL_ABILITY[skill] as any;
          const mod = abilityMod((scores as unknown as Record<string, number>)[abilityKey] ?? 10);
          const fromBg = backgroundSkills.has(skill);
          const chosen = selectedSkills.has(skill);
          const inClassList = allowedSkills.has(skill);
          const proficient = fromBg || chosen;
          const bonus = proficient ? profBonus : 0;
          const modStr = (mod + bonus) >= 0 ? `+${mod + bonus}` : `${mod + bonus}`;

          return (
            <div
              key={skill}
              onClick={() => toggle(skill)}
              className={cn(
                'p-3 rounded-lg border transition-all flex items-center gap-3',
                // Background-granted: blue, locked
                fromBg && 'border-blue-600 bg-blue-950/30 cursor-default',
                // Class skill chosen by player: green (positive confirmation)
                chosen && !fromBg && 'border-green-500 bg-green-950/30 cursor-pointer',
                // Class skill available but not yet chosen: visible border, green hover hint
                !fromBg && !chosen && inClassList && 'border-slate-500 bg-slate-800 cursor-pointer hover:border-green-400/60',
                // Not in this class's skill list: dimmed / locked
                !fromBg && !chosen && !inClassList && 'border-slate-800 bg-slate-900 cursor-not-allowed opacity-40',
              )}
            >
              <div className={cn(
                'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0',
                proficient ? 'border-green-500 bg-green-500/20' : 'border-slate-500',
              )}>
                {proficient && <div className="w-2 h-2 bg-green-400 rounded-full" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{skill}</p>
                <p className="text-xs text-slate-500">{abilityKey?.toUpperCase()}</p>
              </div>
              <span className={cn('text-sm font-bold shrink-0', proficient ? 'text-green-400' : 'text-slate-400')}>
                {modStr}
              </span>
              {fromBg && <span className="text-xs text-blue-400 shrink-0">BG</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
