import React from 'react';
import { Dialog, Button, Badge } from '../../components/ui';
import { cn } from '../../utils/cn';
import { getClass } from '../../data/classes';
import { getSubclass, ALL_SUBCLASSES } from '../../data/subclasses';
import { abilityMod } from '../../data/mechanics';
import type { Character } from '../../types';

interface LevelUpDialogProps {
  open: boolean;
  onClose: () => void;
  character: Character;
  onConfirm: (classId: string, hpGained: number, hpRoll: number, subclassPick?: string) => void;
}

type HpMethod = 'average' | 'roll';

export function LevelUpDialog({ open, onClose, character, onConfirm }: LevelUpDialogProps) {
  // For now, support single-class only — level up the primary class.
  // Multiclass dip is a future feature and would surface a class picker here.
  const primary = character.classes[0];
  const classDef = primary ? getClass(primary.classId) : null;
  const currentLevel = primary?.level ?? 1;
  const newLevel = currentLevel + 1;

  const conMod = abilityMod(character.baseAbilityScores.con);
  const hitDie = classDef?.hitDie ?? 8;
  const averagePerLevel = Math.max(1, Math.floor(hitDie / 2) + 1 + conMod);

  const [method, setMethod] = React.useState<HpMethod>('average');
  const [rollResult, setRollResult] = React.useState<number | null>(null);
  const [pendingSubclass, setPendingSubclass] = React.useState<string | undefined>(undefined);

  // Reset state whenever the dialog reopens.
  React.useEffect(() => {
    if (open) {
      setMethod('average');
      setRollResult(null);
      setPendingSubclass(undefined);
    }
  }, [open]);

  if (!classDef) return null;

  function rollHitDie() {
    const roll = Math.floor(Math.random() * hitDie) + 1;
    setRollResult(roll);
  }

  // New features unlocked at the new level (from class + selected subclass).
  const sub = primary?.subclassId ? getSubclass(primary.subclassId) : null;
  const newFeatures = [
    ...classDef.features.filter(f => f.level === newLevel).map(f => ({ source: 'Class', ...f })),
    ...(sub?.features ?? []).filter(f => f.level === newLevel).map(f => ({ source: sub!.name, ...f })),
  ];

  // Is this the level the player needs to pick a subclass?
  const needsSubclass = newLevel === classDef.subclassLevel && !primary?.subclassId;
  const availableSubclasses = needsSubclass
    ? ALL_SUBCLASSES.filter(s => s.classId === classDef.id && character.enabledBooks.includes(s.sourceBook))
    : [];

  // ASI level?
  const isASI = newFeatures.some(f => (f as any).isASI);

  const hpRoll = method === 'roll' ? (rollResult ?? 0) : averagePerLevel - conMod;
  const hpGained = method === 'roll'
    ? Math.max(1, (rollResult ?? 0) + conMod)
    : averagePerLevel;

  const canConfirm = method === 'average' || rollResult != null;

  function confirm() {
    if (!primary) return;
    if (needsSubclass && !pendingSubclass) return;
    onConfirm(primary.classId, hpGained, hpRoll, pendingSubclass);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Level Up: ${classDef.name} ${currentLevel} → ${newLevel}`} wide>
      <div className="space-y-5">
        {/* HP gain */}
        <section>
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
            Hit Points Gained
          </h3>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              onClick={() => setMethod('average')}
              className={cn(
                'p-3 rounded-lg border-2 text-left transition-all',
                method === 'average' ? 'border-red-500 bg-red-950/30' : 'border-slate-700 bg-slate-800 hover:border-slate-500'
              )}
            >
              <p className="text-sm font-bold text-white">Take Average</p>
              <p className="text-xs text-slate-400">
                +{averagePerLevel} HP <span className="text-slate-500">({Math.floor(hitDie / 2) + 1} {conMod !== 0 ? `${conMod >= 0 ? '+' : ''}${conMod} Con` : ''})</span>
              </p>
            </button>
            <button
              onClick={() => setMethod('roll')}
              className={cn(
                'p-3 rounded-lg border-2 text-left transition-all',
                method === 'roll' ? 'border-red-500 bg-red-950/30' : 'border-slate-700 bg-slate-800 hover:border-slate-500'
              )}
            >
              <p className="text-sm font-bold text-white">Roll d{hitDie}</p>
              <p className="text-xs text-slate-400">
                {rollResult != null
                  ? <>+{Math.max(1, rollResult + conMod)} HP <span className="text-slate-500">({rollResult} {conMod !== 0 ? `${conMod >= 0 ? '+' : ''}${conMod}` : ''})</span></>
                  : 'Click Roll to roll your hit die'}
              </p>
            </button>
          </div>
          {method === 'roll' && (
            <Button size="sm" variant="outline" onClick={rollHitDie} className="w-full">
              {rollResult == null ? `Roll d${hitDie}` : 'Reroll'}
            </Button>
          )}
          <p className="text-xs text-slate-500 mt-2">
            Per RAW, each level's HP gain is at least 1 even with negative Constitution.
            Current Max HP: {character.maxHP} → <span className="text-white font-bold">{character.maxHP + hpGained}</span>
          </p>
        </section>

        {/* Subclass pick if needed */}
        {needsSubclass && (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
              Choose Your {classDef.subclassLabel}
            </h3>
            <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-thin">
              {availableSubclasses.map(s => (
                <button
                  key={s.id}
                  onClick={() => setPendingSubclass(s.id === pendingSubclass ? undefined : s.id)}
                  className={cn(
                    'w-full p-3 rounded-lg border-2 text-left transition-all',
                    pendingSubclass === s.id ? 'border-red-500 bg-red-950/30' : 'border-slate-700 bg-slate-800 hover:border-slate-500'
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-bold text-white">{s.name}</p>
                    <Badge color="slate">{s.sourceBook}</Badge>
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-2">{s.description}</p>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* New features */}
        <section>
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
            Features Gained at Level {newLevel}
          </h3>
          {newFeatures.length === 0 ? (
            <p className="text-sm text-slate-500 italic">
              No new named features at this level — but your class table may grant new spell slots, more class-resource uses, or higher cantrip damage.
            </p>
          ) : (
            <div className="space-y-2">
              {newFeatures.map((f, i) => (
                <div key={i} className="bg-slate-900 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge color="slate">{(f as any).source}</Badge>
                    <p className="text-sm font-bold text-white">{f.name}</p>
                    {(f as any).isASI && <Badge color="amber">ASI / Feat</Badge>}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{f.description}</p>
                </div>
              ))}
            </div>
          )}
          {isASI && (
            <p className="text-xs text-yellow-300 mt-2">
              ⚠ Increase your ability scores (+2 to one or +1 to two) or pick a feat. The character sheet doesn't yet edit base scores
              after creation — use the Feats step in the wizard, or edit ability scores manually in storage. (Tracking ASIs post-creation is a separate feature.)
            </p>
          )}
        </section>

        {/* Reminders for spells / class options */}
        {(classDef.spellcastingType !== 'none' || ['warlock','sorcerer','fighter','artificer'].includes(classDef.id)) && (
          <section className="text-xs text-slate-400 bg-slate-900/50 border border-slate-700 rounded-lg px-3 py-2 leading-relaxed">
            <p className="text-slate-300 font-medium mb-1">Remember to update:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {classDef.spellcastingType !== 'none' && (
                <>
                  <li>New spells known/prepared on the Spells tab (your max level may have increased)</li>
                  <li>Cantrips known if your class table grants more</li>
                </>
              )}
              {classDef.id === 'warlock' && newLevel >= 2 && <li>You may know an additional Eldritch Invocation</li>}
              {classDef.id === 'sorcerer' && (newLevel === 10 || newLevel === 17) && <li>You learn a new Metamagic option</li>}
              {classDef.id === 'fighter' && primary?.subclassId === 'battle-master' && newLevel >= 7 && <li>Battle Master maneuvers known may have increased</li>}
              {classDef.id === 'artificer' && (newLevel === 6 || newLevel === 10 || newLevel === 14 || newLevel === 18) && <li>Your Infusions Known increased</li>}
            </ul>
          </section>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm} disabled={!canConfirm || (needsSubclass && !pendingSubclass)}>
            Confirm Level {newLevel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
