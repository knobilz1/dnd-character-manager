import React from 'react';
import { useWizardStore } from '../../../store/useWizardStore';
import { Input, Select, Badge } from '../../../components/ui';
import { getRace } from '../../../data/races';
import { getClass } from '../../../data/classes';
import { getBackground } from '../../../data/backgrounds';
import { ALL_SUBCLASSES } from '../../../data/subclasses';
import { ALL_FEATS } from '../../../data/feats';
import { ALL_SPELLS } from '../../../data/spells';
import { abilityMod, PROFICIENCY_BONUS, totalCharacterLevel } from '../../../data/mechanics';

const ALIGNMENTS = [
  'Lawful Good','Neutral Good','Chaotic Good',
  'Lawful Neutral','True Neutral','Chaotic Neutral',
  'Lawful Evil','Neutral Evil','Chaotic Evil',
];

const ABILITY_LABELS: Record<string, string> = { str:'STR',dex:'DEX',con:'CON',int:'INT',wis:'WIS',cha:'CHA' };

export function StepReview() {
  const { draft, updateDraft } = useWizardStore();

  const race = getRace(draft.raceId ?? '');
  const primaryClass = draft.classes?.[0];
  const classDef = primaryClass ? getClass(primaryClass.classId) : null;
  const subclass = primaryClass?.subclassId ? ALL_SUBCLASSES.find(s => s.id === primaryClass.subclassId) : null;
  const background = getBackground(draft.backgroundId ?? '');
  const scores = draft.baseAbilityScores ?? { str:10,dex:10,con:10,int:10,wis:10,cha:10 };
  const totalLevel = totalCharacterLevel(draft.classes ?? []);
  const profBonus = PROFICIENCY_BONUS[Math.min(totalLevel, 20)] ?? 2;

  // Compute final scores with racial bonuses
  const finalScores = { ...scores };
  if (race) {
    for (const [k, v] of Object.entries(race.abilityScoreIncreases)) {
      (finalScores as any)[k] = ((finalScores as any)[k] ?? 10) + (v ?? 0);
    }
  }

  const conMod = abilityMod(finalScores.con);
  const hitDie = classDef?.hitDie ?? 8;
  const level = primaryClass?.level ?? 1;
  // Per RAW, each level grants at least 1 HP even with very negative CON — match finalize().
  const lvl1HP = Math.max(1, hitDie + conMod);
  const perLevelHP = Math.max(1, Math.floor(hitDie / 2) + 1 + conMod);
  const maxHP = lvl1HP + (level - 1) * perLevelHP;

  const selectedFeats = ALL_FEATS.filter(f => draft.selectedFeats?.includes(f.id));
  const selectedSpells = ALL_SPELLS.filter(s => draft.spellbook?.some(sp => sp.spellId === s.id));

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-2">Review & Finish</h2>
      <p className="text-slate-400 mb-6">Give your character a name, then review your choices before creating them.</p>

      {/* Name & identity */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-4">
        <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-4">Identity</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Character Name *"
            value={draft.name ?? ''}
            onChange={e => updateDraft({ name: e.target.value })}
            placeholder="Enter character name..."
          />
          <Input
            label="Player Name"
            value={draft.playerName ?? ''}
            onChange={e => updateDraft({ playerName: e.target.value })}
            placeholder="Your name"
          />
          <Select
            label="Alignment"
            value={draft.alignment ?? 'True Neutral'}
            onChange={e => updateDraft({ alignment: e.target.value })}
            options={ALIGNMENTS.map(a => ({ value: a, label: a }))}
          />
        </div>
      </div>

      {/* Summary grid */}
      <div className="grid gap-4 sm:grid-cols-2 mb-4">
        {/* Build summary */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-3">Character Build</h3>
          <div className="space-y-2 text-sm">
            <SummaryRow label="Race" value={race?.name ?? <span className="text-red-400">Not selected</span>} />
            <SummaryRow label="Class" value={classDef ? `${classDef.name} ${level}` : <span className="text-red-400">Not selected</span>} />
            {subclass && <SummaryRow label={classDef?.subclassLabel ?? 'Subclass'} value={subclass.name} />}
            <SummaryRow label="Background" value={background?.name ?? <span className="text-red-400">Not selected</span>} />
            <SummaryRow label="Alignment" value={draft.alignment ?? 'True Neutral'} />
            <SummaryRow label="Books" value={draft.enabledBooks.join(', ')} />
          </div>
        </div>

        {/* Stats */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-3">Stats</h3>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {Object.entries(finalScores).map(([k, v]) => {
              const mod = abilityMod(v as number);
              return (
                <div key={k} className="bg-slate-900 rounded-lg p-2 text-center">
                  <p className="text-xs text-slate-400">{ABILITY_LABELS[k]}</p>
                  <p className="font-bold text-white text-lg">{v as number}</p>
                  <p className="text-xs text-slate-400">{mod >= 0 ? '+' : ''}{mod}</p>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <SummaryRow label="Max HP" value={maxHP} />
            <SummaryRow label="Prof Bonus" value={`+${profBonus}`} />
            <SummaryRow label="Hit Die" value={`d${hitDie}`} />
            <SummaryRow label="Level" value={level} />
          </div>
        </div>
      </div>

      {/* Skills */}
      {(draft.selectedSkillProficiencies?.length ?? 0) > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-2">Skill Proficiencies</h3>
          <div className="flex flex-wrap gap-2">
            {draft.selectedSkillProficiencies?.map(s => <Badge key={s}>{s}</Badge>)}
            {background?.skillProficiencies.map(s => <Badge key={s} color="blue">{s} (BG)</Badge>)}
          </div>
        </div>
      )}

      {/* Feats */}
      {selectedFeats.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-2">Feats</h3>
          <div className="flex flex-wrap gap-2">
            {selectedFeats.map(f => <Badge key={f.id} color="amber">{f.name}</Badge>)}
          </div>
        </div>
      )}

      {/* Spells */}
      {selectedSpells.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-400 mb-2">
            Spells ({selectedSpells.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {selectedSpells.map(s => (
              <span key={s.id} className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">
                {s.level === 0 ? '⬟' : `L${s.level}`} {s.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {!draft.name?.trim() && (
        <p className="text-red-400 text-sm mt-4 text-center">Please enter a character name to continue.</p>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-400">{label}</span>
      <span className="font-medium text-white text-right">{value}</span>
    </div>
  );
}
