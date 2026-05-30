import React from 'react';
import { useCreatorStore } from '../../../store/useCreatorStore';
import { SKILL_ABILITY, abilityMod, PROFICIENCY_BONUS, totalCharacterLevel } from '../../../data/mechanics';
import { getClass } from '../../../data/classes';
import { getBackground } from '../../../data/backgrounds';
import { cn } from '../../../utils/cn';
import type { SkillName } from '../../../types';

function expertiseSlotsForClass(classId: string, classLevel: number): number {
  if (classId === 'rogue') {
    if (classLevel >= 6) return 4;
    if (classLevel >= 1) return 2;
  }
  if (classId === 'bard') {
    if (classLevel >= 10) return 4;
    if (classLevel >= 3) return 2;
  }
  return 0;
}

const ALL_SKILLS: SkillName[] = [
  'Acrobatics','Animal Handling','Arcana','Athletics','Deception','History',
  'Insight','Intimidation','Investigation','Medicine','Nature','Perception',
  'Performance','Persuasion','Religion','Sleight of Hand','Stealth','Survival',
];

const KD_SKILLS = ['Arcana', 'History', 'Nature', 'Religion'] as const;

export function StepSkills() {
  const { draft, updateDraft } = useCreatorStore();
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
  const subclassId = draft.classes?.[0]?.subclassId;
  const backgroundId = draft.backgroundId;

  // Expertise
  const classLevel = draft.classes?.[0]?.level ?? 1;
  const expertiseSlots = expertiseSlotsForClass(classId ?? '', classLevel);
  const expertiseSkills: string[] = (draft.expertiseSkills as string[] | undefined) ?? [];
  const allProfSkills = new Set<string>([...Array.from(selectedSkills), ...Array.from(backgroundSkills)]);

  // Knowledge Domain: 2 skills from Arcana/History/Nature/Religion gain proficiency + expertise
  const hasKnowledgeDomain = subclassId === 'knowledge-domain';
  const kdSkills: string[] = (draft.knowledgeDomainSkills as string[] | undefined) ?? [];
  function toggleKdSkill(skill: string) {
    const next = new Set(kdSkills);
    if (next.has(skill)) { next.delete(skill); } else if (next.size < 2) { next.add(skill); }
    updateDraft({ knowledgeDomainSkills: Array.from(next) } as any);
  }

  function toggleExpertise(skill: string) {
    const next = new Set(expertiseSkills);
    if (next.has(skill)) {
      next.delete(skill);
    } else if (next.size < expertiseSlots) {
      next.add(skill);
    }
    updateDraft({ expertiseSkills: Array.from(next) });
  }
  React.useEffect(() => {
    const cleaned = (draft.selectedSkillProficiencies ?? []).filter(
      s => allowedSkills.has(s) && !backgroundSkills.has(s)
    );
    const patch: Record<string, unknown> = {};
    if (cleaned.length !== (draft.selectedSkillProficiencies ?? []).length) {
      patch.selectedSkillProficiencies = cleaned;
    }
    // Clear expertise picks if the new class/level no longer grants any
    if (expertiseSlots === 0 && (draft.expertiseSkills as string[] | undefined)?.length) {
      patch.expertiseSkills = [];
    }
    // Clear Knowledge Domain picks if subclass changes away from knowledge-domain
    if (!hasKnowledgeDomain && (draft.knowledgeDomainSkills as string[] | undefined)?.length) {
      patch.knowledgeDomainSkills = [];
    }
    if (Object.keys(patch).length) updateDraft(patch as any);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, subclassId, backgroundId, expertiseSlots, hasKnowledgeDomain]);

  function toggle(skill: SkillName) {
    if (backgroundSkills.has(skill)) return;   // locked in by background
    if (!allowedSkills.has(skill)) return;      // not in this class's skill list
    const next = new Set(selectedSkills);
    if (next.has(skill)) {
      next.delete(skill);
      // Also drop expertise for this skill — it's no longer a proficient skill
      const newExpertise = expertiseSkills.filter(s => s !== skill);
      updateDraft({ selectedSkillProficiencies: Array.from(next), expertiseSkills: newExpertise });
      return;
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

      {/* Expertise picker (Bard lv.3+, Rogue lv.1+) */}
      {expertiseSlots > 0 && (
        <div className="mt-6">
          <h3 className="text-lg font-bold text-white mb-1">Expertise</h3>
          <p className="text-slate-400 mb-1">
            Choose {expertiseSlots} skill{expertiseSlots !== 1 ? 's' : ''} to gain Expertise in — your proficiency bonus is doubled for those skills. You must be proficient in the chosen skill.
          </p>
          <p className="text-sm text-slate-500 mb-4">
            {expertiseSkills.length}/{expertiseSlots} expertise skills chosen
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {ALL_SKILLS.map(skill => {
              const proficient = allProfSkills.has(skill);
              const hasExpertise = expertiseSkills.includes(skill);
              const canAdd = hasExpertise || (expertiseSkills.length < expertiseSlots && proficient);
              return (
                <div
                  key={skill}
                  onClick={() => { if (proficient) toggleExpertise(skill); }}
                  className={cn(
                    'p-3 rounded-lg border transition-all flex items-center gap-3',
                    hasExpertise && 'border-emerald-500 bg-emerald-950/30 cursor-pointer',
                    !hasExpertise && proficient && canAdd && 'border-slate-500 bg-slate-800 cursor-pointer hover:border-emerald-400/60',
                    !hasExpertise && proficient && !canAdd && 'border-slate-700 bg-slate-800 opacity-50 cursor-not-allowed',
                    !proficient && 'border-slate-800 bg-slate-900 cursor-not-allowed opacity-30',
                  )}
                >
                  <div className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0',
                    hasExpertise ? 'border-emerald-500 bg-emerald-500/20' : 'border-slate-500',
                  )}>
                    {hasExpertise && <div className="w-2 h-2 bg-emerald-400 rounded-full" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{skill}</p>
                    {hasExpertise && <p className="text-xs text-emerald-400">Expertise (×2 prof)</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Knowledge Domain: Blessings of Knowledge — 2 skills from Arcana/History/Nature/Religion */}
      {hasKnowledgeDomain && (
        <div className="mt-6">
          <h3 className="text-lg font-bold text-white mb-1">Blessings of Knowledge</h3>
          <p className="text-slate-400 mb-1">
            Choose 2 skills — you gain proficiency and expertise (doubled proficiency) in each.
          </p>
          <p className="text-sm text-slate-500 mb-4">
            {kdSkills.length}/2 chosen
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {KD_SKILLS.map(skill => {
              const chosen = kdSkills.includes(skill);
              const canAdd = chosen || kdSkills.length < 2;
              return (
                <div
                  key={skill}
                  onClick={() => toggleKdSkill(skill)}
                  className={cn(
                    'p-3 rounded-lg border transition-all flex items-center gap-3 cursor-pointer',
                    chosen && 'border-amber-500 bg-amber-950/30',
                    !chosen && canAdd && 'border-slate-500 bg-slate-800 hover:border-amber-400/60',
                    !chosen && !canAdd && 'border-slate-700 bg-slate-800 opacity-50 cursor-not-allowed',
                  )}
                >
                  <div className={cn(
                    'w-5 h-5 rounded border-2 flex items-center justify-center shrink-0',
                    chosen ? 'border-amber-500 bg-amber-500/20' : 'border-slate-500',
                  )}>
                    {chosen && <div className="w-2 h-2 bg-amber-400 rounded-full" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{skill}</p>
                    {chosen && <p className="text-xs text-amber-400">Prof + Expertise</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
