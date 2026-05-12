import React from 'react';
import { useWizardStore } from '../../../store/useWizardStore';
import { Badge, Dialog } from '../../../components/ui';
import { cn } from '../../../utils/cn';
import { ALL_FIGHTING_STYLES } from '../../../data/fightingStyles';
import { ALL_INVOCATIONS } from '../../../data/invocations';
import { ALL_PACT_BOONS } from '../../../data/pactBoons';
import { ALL_METAMAGIC } from '../../../data/metamagic';
import { ALL_MANEUVERS } from '../../../data/maneuvers';
import { ALL_INFUSIONS } from '../../../data/infusions';
import type { BookId, ClassOptionsState } from '../../../types';

function bookColor(b: BookId): 'red' | 'amber' | 'purple' | 'blue' | 'green' | 'orange' {
  switch (b) {
    case 'PHB': return 'red';
    case 'XGtE': return 'amber';
    case 'TCE': return 'purple';
    case 'MMoM': return 'blue';
    case 'VGM': return 'green';
    case 'FToD': return 'orange';
  }
}

interface OptionItem {
  id: string;
  name: string;
  sourceBook: BookId;
  description: string;
  meta?: string;
}

interface SectionProps {
  title: string;
  helpText: string;
  items: OptionItem[];
  selectedIds: string[];
  max: number;
  onToggle: (id: string) => void;
  radio?: boolean;
}

function OptionSection({ title, helpText, items, selectedIds, max, onToggle, radio }: SectionProps) {
  const [detail, setDetail] = React.useState<OptionItem | null>(null);
  const selected = new Set(selectedIds);

  return (
    <div className="mb-8">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-lg font-bold text-white">{title}</h3>
        <span className="text-sm text-slate-400">
          {selected.size}/{max} selected
        </span>
      </div>
      <p className="text-sm text-slate-400 mb-3">{helpText}</p>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(item => {
          const isSelected = selected.has(item.id);
          const canSelect = isSelected || selected.size < max;
          return (
            <div
              key={item.id}
              className={cn(
                'p-3 rounded-lg border-2 transition-all',
                isSelected ? 'border-red-500 bg-red-950/30' : 'border-slate-700 bg-slate-800',
                canSelect ? 'cursor-pointer hover:border-slate-500' : 'opacity-50 cursor-not-allowed',
              )}
              onClick={() => {
                if (radio && isSelected) return;
                if (canSelect || isSelected) onToggle(item.id);
              }}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <h4
                  className="font-bold text-white text-sm hover:text-red-300 flex-1"
                  onClick={(e) => { e.stopPropagation(); setDetail(item); }}
                >
                  {item.name}
                </h4>
                <Badge color={bookColor(item.sourceBook)}>{item.sourceBook}</Badge>
              </div>
              {item.meta && <p className="text-xs text-yellow-400 mb-1">{item.meta}</p>}
              <p className="text-xs text-slate-400 line-clamp-2">{item.description}</p>
            </div>
          );
        })}
      </div>

      <Dialog open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? ''}>
        {detail && (
          <>
            <div className="flex items-center gap-2 mb-3">
              <Badge color={bookColor(detail.sourceBook)}>{detail.sourceBook}</Badge>
              {detail.meta && <span className="text-xs text-yellow-400">{detail.meta}</span>}
            </div>
            <p className="text-sm text-slate-300 whitespace-pre-line">{detail.description}</p>
          </>
        )}
      </Dialog>
    </div>
  );
}

export function StepClassOptions() {
  const { draft, updateDraft } = useWizardStore();
  const enabledBooks = new Set(draft.enabledBooks ?? []);
  const primaryClass = draft.classes?.[0];
  const classId = primaryClass?.classId ?? '';
  const level = primaryClass?.level ?? 1;
  const subclassId = primaryClass?.subclassId;

  const opts: ClassOptionsState = draft.classOptions ?? {
    fightingStyles: [], invocations: [], metamagic: [], maneuvers: [], infusions: [],
  };

  function patch(partial: Partial<ClassOptionsState>) {
    updateDraft({ classOptions: { ...opts, ...partial } });
  }

  function toggleList(key: keyof Omit<ClassOptionsState, 'pactBoon'>, id: string, max: number) {
    const current = opts[key] as string[];
    const next = current.includes(id)
      ? current.filter(x => x !== id)
      : current.length < max ? [...current, id] : current;
    patch({ [key]: next });
  }

  // ── Fighting Styles ──────────────────────────────────────────────────
  const hasFightingStyle = ['fighter', 'paladin', 'ranger'].includes(classId);
  let fightingStyleCount = 0;
  if (classId === 'fighter') fightingStyleCount = level >= 10 ? 2 : 1;
  else if (classId === 'paladin' && level >= 2) fightingStyleCount = 1;
  else if (classId === 'ranger' && level >= 2) fightingStyleCount = 1;

  const fightingStylesAvail = ALL_FIGHTING_STYLES
    .filter(fs => enabledBooks.has(fs.sourceBook))
    .filter(fs => fs.classes.includes(classId));

  // ── Eldritch Invocations & Pact Boon ────────────────────────────────
  const isWarlock = classId === 'warlock';
  let invocationCount = 0;
  if (isWarlock) {
    if (level >= 2) invocationCount = 2;
    if (level >= 5) invocationCount = 3;
    if (level >= 7) invocationCount = 4;
    if (level >= 9) invocationCount = 5;
    if (level >= 12) invocationCount = 6;
    if (level >= 15) invocationCount = 7;
    if (level >= 18) invocationCount = 8;
  }
  const hasPactBoon = isWarlock && level >= 3;

  const invocationsAvail = ALL_INVOCATIONS
    .filter(i => enabledBooks.has(i.sourceBook))
    .filter(i => i.minLevel <= level)
    .filter(i => !i.prerequisitePact || i.prerequisitePact === (opts.pactBoon?.replace('pact-of-the-', '') as any));

  const pactBoonsAvail = ALL_PACT_BOONS.filter(p => enabledBooks.has(p.sourceBook));

  // ── Metamagic ────────────────────────────────────────────────────────
  const isSorcerer = classId === 'sorcerer';
  let metamagicCount = 0;
  if (isSorcerer) {
    if (level >= 3) metamagicCount = 2;
    if (level >= 10) metamagicCount = 3;
    if (level >= 17) metamagicCount = 4;
  }
  const metamagicAvail = ALL_METAMAGIC.filter(m => enabledBooks.has(m.sourceBook));

  // ── Maneuvers (Battle Master) ────────────────────────────────────────
  const isBattleMaster = classId === 'fighter' && subclassId === 'battle-master';
  let maneuverCount = 0;
  if (isBattleMaster) {
    maneuverCount = 3;
    if (level >= 7) maneuverCount = 5;
    if (level >= 10) maneuverCount = 7;
    if (level >= 15) maneuverCount = 9;
  }
  const maneuversAvail = ALL_MANEUVERS.filter(m => enabledBooks.has(m.sourceBook));

  // ── Infusions (Artificer) ────────────────────────────────────────────
  const isArtificer = classId === 'artificer';
  let infusionsKnownCount = 0;
  if (isArtificer && level >= 2) infusionsKnownCount = 4;
  if (isArtificer && level >= 6) infusionsKnownCount = 6;
  if (isArtificer && level >= 10) infusionsKnownCount = 8;
  if (isArtificer && level >= 14) infusionsKnownCount = 10;
  if (isArtificer && level >= 18) infusionsKnownCount = 12;
  const infusionsAvail = ALL_INFUSIONS
    .filter(i => enabledBooks.has(i.sourceBook))
    .filter(i => i.minLevel <= level);

  const nothingToChoose =
    !hasFightingStyle && !isWarlock && !isSorcerer && !isBattleMaster && !isArtificer;

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-2">Class Options</h2>
      <p className="text-slate-400 mb-6">
        Pick the class-specific options available to your character at level {level}.
      </p>

      {nothingToChoose && (
        <p className="text-slate-500 italic">
          Your {classId || 'class'} doesn&apos;t have any selectable class options at this level.
        </p>
      )}

      {hasFightingStyle && fightingStyleCount > 0 && (
        <OptionSection
          title="Fighting Style"
          helpText={`Choose ${fightingStyleCount} fighting style${fightingStyleCount > 1 ? 's' : ''} to specialize your combat technique.`}
          items={fightingStylesAvail.map(fs => ({
            id: fs.id, name: fs.name, sourceBook: fs.sourceBook, description: fs.description,
          }))}
          selectedIds={opts.fightingStyles}
          max={fightingStyleCount}
          onToggle={(id) => toggleList('fightingStyles', id, fightingStyleCount)}
        />
      )}

      {hasPactBoon && (
        <OptionSection
          title="Pact Boon"
          helpText="At 3rd level, your patron grants you a special gift. Choose one."
          items={pactBoonsAvail.map(p => ({
            id: p.id, name: p.name, sourceBook: p.sourceBook, description: p.description,
          }))}
          selectedIds={opts.pactBoon ? [opts.pactBoon] : []}
          max={1}
          radio
          onToggle={(id) => patch({ pactBoon: opts.pactBoon === id ? undefined : id })}
        />
      )}

      {isWarlock && invocationCount > 0 && (
        <OptionSection
          title="Eldritch Invocations"
          helpText={`Choose ${invocationCount} invocations. Some require a specific pact boon or spell — those are filtered out if not eligible.`}
          items={invocationsAvail.map(i => ({
            id: i.id, name: i.name, sourceBook: i.sourceBook, description: i.description,
            meta: [
              i.minLevel > 1 ? `Lvl ${i.minLevel}` : null,
              i.prerequisitePact ? `Pact of the ${i.prerequisitePact[0].toUpperCase() + i.prerequisitePact.slice(1)}` : null,
              i.prerequisiteSpell ? `Requires ${i.prerequisiteSpell.replace(/-/g, ' ')}` : null,
            ].filter(Boolean).join(' • ') || undefined,
          }))}
          selectedIds={opts.invocations}
          max={invocationCount}
          onToggle={(id) => toggleList('invocations', id, invocationCount)}
        />
      )}

      {isSorcerer && metamagicCount > 0 && (
        <OptionSection
          title="Metamagic"
          helpText={`Choose ${metamagicCount} metamagic option${metamagicCount > 1 ? 's' : ''} to alter your spells.`}
          items={metamagicAvail.map(m => ({
            id: m.id, name: m.name, sourceBook: m.sourceBook, description: m.description,
            meta: m.cost,
          }))}
          selectedIds={opts.metamagic}
          max={metamagicCount}
          onToggle={(id) => toggleList('metamagic', id, metamagicCount)}
        />
      )}

      {isBattleMaster && maneuverCount > 0 && (
        <OptionSection
          title="Battle Master Maneuvers"
          helpText={`Choose ${maneuverCount} maneuvers fueled by superiority dice.`}
          items={maneuversAvail.map(m => ({
            id: m.id, name: m.name, sourceBook: m.sourceBook, description: m.description,
          }))}
          selectedIds={opts.maneuvers}
          max={maneuverCount}
          onToggle={(id) => toggleList('maneuvers', id, maneuverCount)}
        />
      )}

      {isArtificer && infusionsKnownCount > 0 && (
        <OptionSection
          title="Artificer Infusions"
          helpText={`Choose ${infusionsKnownCount} infusion${infusionsKnownCount > 1 ? 's' : ''} you know. You can have a limited number active at any time.`}
          items={infusionsAvail.map(i => ({
            id: i.id, name: i.name, sourceBook: i.sourceBook, description: i.description,
            meta: i.minLevel > 2 ? `Lvl ${i.minLevel}` : (i.prerequisite ?? undefined),
          }))}
          selectedIds={opts.infusions}
          max={infusionsKnownCount}
          onToggle={(id) => toggleList('infusions', id, infusionsKnownCount)}
        />
      )}
    </div>
  );
}
