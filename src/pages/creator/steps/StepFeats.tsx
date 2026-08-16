import React from 'react';
import { useCreatorStore } from '../../../store/useCreatorStore';
import { ALL_FEATS, OPTION_LABELS, featPickGroups, featSpellChoices, formatFeatPrerequisite, getEligibleFeats, spellPickOptions } from '../../../data/feats';
import { ProficiencyPicker } from '../../../components/ProficiencyPicker';
import { Badge, Dialog, HoverCard } from '../../../components/ui';
import { cn } from '../../../utils/cn';
import { asiLevelsFor, PROFICIENCY_BONUS, SKILL_NAMES, totalCharacterLevel } from '../../../data/mechanics';
import { getClass } from '../../../data/classes';
import { getRace } from '../../../data/races';
import { getBackground } from '../../../data/backgrounds';
import { BOOKS } from '../../../data/books';
import { bookEnabled } from '../../../utils/bookEnabled';
import type { Feat, BookId, AbilityKey, Character } from '../../../types';
import { chosenAsi } from '../../../utils/racialAsi';

const BOOK_COLOR = Object.fromEntries(BOOKS.map(b => [b.id, b.color])) as Record<BookId, string>;
const ABILITY_LABELS: Record<AbilityKey, string> = {
  str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
};

export function StepFeats() {
  const { draft, updateDraft } = useCreatorStore();
  const [detailFeat, setDetailFeat] = React.useState<Feat | null>(null);

  const primaryClass = draft.classes?.[0];
  const level = primaryClass?.level ?? 1;
  const classId = primaryClass?.classId ?? '';
  // asiLevelsFor, never ASI_LEVELS[classId]: the map is keyed by base class, so indexing
  // it with a 2024 id gave every PHB 2024 character zero slots and this step told them
  // they had no ASI yet — at level 20, with a straight face.
  const asiLevels = asiLevelsFor(classId);
  const asiCount = asiLevels.filter(l => l <= level).length;

  const selected = new Set(draft.selectedFeats ?? []);
  const featChoices: Record<string, AbilityKey> = (draft.featChoices as Record<string, AbilityKey>) ?? {};

  // Effective scores: base + racial (needed for accurate cap check)
  const baseScores = draft.baseAbilityScores ?? { str:10,dex:10,con:10,int:10,wis:10,cha:10 };
  const raceDef = draft.raceId ? getRace(draft.raceId) : null;
  const racialASI = chosenAsi(raceDef ?? undefined, draft.racialAbilityChoice);
  const effectiveScore = (key: AbilityKey) => (baseScores[key] ?? 10) + (racialASI[key] ?? 0);

  // The same gate the level-up dialog applies. This step used to filter on enabled books alone, so
  // the creator handed out Epic Boons at level 4 and Athlete to a Strength 8 build while the level-up
  // dialog refused both — one rule per entry point is one rule too many.
  //
  // Selected feats are kept regardless: getEligibleFeats drops what the character already holds, and
  // dropping them here would hide a picked feat behind its own selection with no way to un-pick it.
  // A feat whose prerequisite stopped being met (an ability edited on a later visit) stays for the
  // same reason.
  const eligibleIds = new Set(
    getEligibleFeats(
      { ...draft, classes: draft.classes ?? [], baseAbilityScores: baseScores } as Character,
      draft.enabledBooks ?? [],
    ).map(f => f.id),
  );
  const available = ALL_FEATS.filter(f =>
    bookEnabled(f, draft.enabledBooks) && (eligibleIds.has(f.id) || selected.has(f.id)));

  const profBonus = PROFICIENCY_BONUS[Math.min(totalCharacterLevel(draft.classes ?? []), 20)] ?? 2;
  const featExpertiseOwed = (draft.selectedFeats ?? [])
    .reduce((n, id) => n + (ALL_FEATS.find(f => f.id === id)?.grantsExpertise ?? 0), 0);
  // Class picks + background + whatever a feat pick just granted, which is the pool Expertise may
  // be spent on. Feat picks are included because Skill Expert grants a skill AND expertise, and
  // spending the expertise on the skill you just took is the point of the feat.
  const featPicked = new Set(Object.values(draft.selectedFeatPicks ?? {}).flat());
  const proficientSkills = [...new Set([
    ...(draft.selectedSkillProficiencies ?? []),
    ...(getBackground(draft.backgroundId ?? '')?.skillProficiencies ?? []),
    ...SKILL_NAMES.filter(sk => featPicked.has(sk)),
  ])].sort();

  function toggle(featId: string) {
    const next = new Set(selected);
    const nextChoices = { ...featChoices };
    if (next.has(featId)) {
      next.delete(featId);
      delete nextChoices[featId];
    } else if (next.size < asiCount) {
      next.add(featId);
    }
    updateDraft({ selectedFeats: Array.from(next), featChoices: nextChoices });
  }

  function setFeatChoice(featId: string, ability: AbilityKey | undefined) {
    const nextChoices = { ...featChoices };
    if (ability) {
      nextChoices[featId] = ability;
    } else {
      delete nextChoices[featId];
    }
    updateDraft({ featChoices: nextChoices });
  }

  if (asiCount === 0) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Feats</h2>
        <p className="text-slate-400">
          At level {level}, your {getClass(classId)?.name ?? 'class'} doesn't have any Ability Score Improvement (ASI) slots yet.
          ASIs become available at higher levels. You can revisit this when you level up.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-2">Feats</h2>
      <p className="text-slate-400 mb-1">
        You have {asiCount} ASI slot{asiCount !== 1 ? 's' : ''} from your class levels.
        You can spend each slot on a feat instead of a +2 ability score increase.
      </p>
      <p className="text-sm text-slate-500 mb-4">{selected.size}/{asiCount} feat slots used</p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {available.map(feat => {
          const isSelected = selected.has(feat.id);
          const canSelect = isSelected || selected.size < asiCount;
          const prereq = feat.prerequisite;
          return (
            <HoverCard
              key={feat.id}
              content={
                <div>
                  <p className="font-bold text-white text-sm mb-1">{feat.name}</p>
                  {prereq && (
                    <p className="text-xs text-yellow-400 mb-2">
                      Requires: {formatFeatPrerequisite(prereq)}
                    </p>
                  )}
                  <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{feat.description}</p>
                </div>
              }
            >
            <div
              className={cn(
                'p-3 rounded-lg border-2 transition-all',
                isSelected ? 'border-red-500 bg-red-950/30' : 'border-slate-700 bg-slate-800',
                canSelect ? 'cursor-pointer hover:border-slate-500' : 'opacity-50 cursor-not-allowed',
              )}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <h4
                  className="font-bold text-white text-sm cursor-pointer hover:text-red-300 flex-1"
                  onClick={() => setDetailFeat(feat)}
                >
                  {feat.name}
                </h4>
                <Badge color={(BOOK_COLOR[feat.sourceBook] ?? 'slate') as any}>
                  {feat.sourceBook}
                </Badge>
              </div>
              {feat.prerequisite && (
                <p className="text-xs text-yellow-400 mb-1">
                  Requires: {
                    formatFeatPrerequisite(feat.prerequisite)
                  }
                </p>
              )}
              <p className="text-xs text-slate-400 line-clamp-2">{feat.description.split('\n')[0]}</p>
              <div className="flex items-center justify-between mt-2">
                <button
                  className="text-xs text-blue-400 hover:text-blue-300"
                  onClick={() => setDetailFeat(feat)}
                >
                  Read more
                </button>
                <button
                  onClick={() => canSelect && toggle(feat.id)}
                  disabled={!canSelect}
                  className={cn(
                    'text-xs px-2 py-1 rounded font-medium transition-all',
                    isSelected ? 'bg-red-700 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600',
                  )}
                >
                  {isSelected ? 'Remove' : 'Select'}
                </button>
              </div>
            </div>
            </HoverCard>
          );
        })}
      </div>

      {/* Ability choice pickers for selected feats with abilityScoreChoice */}
      {Array.from(selected).map(featId => {
        const feat = ALL_FEATS.find(f => f.id === featId);
        if (!feat?.abilityScoreChoice?.length) return null;
        const chosen = featChoices[featId];
        return (
          <div key={featId} className="mt-3 p-3 bg-slate-900 border border-amber-700/40 rounded-lg">
            <p className="text-xs font-bold text-amber-300 mb-2">
              {feat.name} — choose +1 ability score:
            </p>
            <div className="flex flex-wrap gap-2">
              {feat.abilityScoreChoice.map(key => {
                const score = effectiveScore(key);
                const atCap = score >= 20;
                const isChosen = chosen === key;
                return (
                  <button
                    key={key}
                    disabled={atCap}
                    onClick={() => setFeatChoice(featId, isChosen ? undefined : key)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg border-2 text-sm font-bold transition-all',
                      isChosen
                        ? 'border-amber-500 bg-amber-950/40 text-amber-200'
                        : atCap
                          ? 'border-slate-700 bg-slate-800 text-slate-600 cursor-not-allowed'
                          : 'border-slate-600 bg-slate-800 text-white hover:border-amber-500/60',
                    )}
                  >
                    {ABILITY_LABELS[key]} ({score}{atCap ? ' — max' : isChosen ? ' → ' + (score + 1) : ''})
                  </button>
                );
              })}
            </div>
            {!chosen && (
              <p className="text-xs text-amber-400 mt-2">↑ Choose an ability score to continue.</p>
            )}
          </div>
        );
      })}

      {/* Everything else a feat makes you choose: proficiencies, expertise and spells.
          The same components and the same resolvers the sheet uses — a character who finishes
          the creator should not have to go hunting on the sheet for a choice the feat owed them
          at level 1. Renders nothing when no selected feat owes a choice. */}
      <div className="mt-3 space-y-2">
        <ProficiencyPicker
          choices={featPickGroups(draft as Character).filter(g => !g.auto).map(g => ({
            key: g.featId,
            label: `${g.featName} — ${g.label}`,
            count: g.count,
            options: g.options,
            labels: OPTION_LABELS,
          }))}
          value={draft.selectedFeatPicks}
          onChange={(v) => updateDraft({ selectedFeatPicks: v })}
          compact
        />
        {featExpertiseOwed > 0 && (
          <ProficiencyPicker
            choices={[{
              key: 'feat-expertise',
              label: `Expertise — choose ${featExpertiseOwed}`,
              count: featExpertiseOwed,
              // Expertise doubles a proficiency you have, so the pool is what the character is
              // already proficient in at this point in the creator.
              options: proficientSkills,
            }]}
            value={{ 'feat-expertise': draft.selectedFeatExpertise ?? [] }}
            onChange={(v) => updateDraft({ selectedFeatExpertise: v['feat-expertise'] ?? [] })}
            compact
          />
        )}
        <ProficiencyPicker
          title="Feat spells"
          choices={featSpellChoices(draft as Character, profBonus).map(c => {
            const options = spellPickOptions(c.grant, draft.enabledBooks ?? ['PHB']);
            return {
              key: c.key,
              label: `${c.featName} — ${c.label}`,
              count: c.count,
              options: options.map(sp => sp.id),
              labels: Object.fromEntries(options.map(sp => [sp.id, sp.name])),
            };
          })}
          value={draft.selectedFeatSpells}
          onChange={(v) => updateDraft({ selectedFeatSpells: v })}
          compact
        />
      </div>

      {/* Feat detail dialog */}
      <Dialog open={!!detailFeat} onClose={() => setDetailFeat(null)} title={detailFeat?.name}>
        {detailFeat && (
          <div>
            <div className="flex gap-2 mb-3">
              <Badge color={(BOOK_COLOR[detailFeat.sourceBook] ?? 'slate') as any}>{detailFeat.sourceBook}</Badge>
              {detailFeat.abilityScoreIncrease && <Badge color="green">+1 to ability</Badge>}
            </div>
            {detailFeat.prerequisite && (
              <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-3 mb-4">
                <p className="text-xs font-bold text-yellow-300 mb-1">Prerequisite</p>
                <p className="text-xs text-yellow-200">
                  {formatFeatPrerequisite(detailFeat.prerequisite)}
                </p>
              </div>
            )}
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{detailFeat.description}</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
