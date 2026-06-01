import React from 'react';
import { useCreatorStore } from '../../../store/useCreatorStore';
import { Badge, Dialog, HoverCard } from '../../../components/ui';
import { cn } from '../../../utils/cn';
import { ALL_FIGHTING_STYLES } from '../../../data/fightingStyles';
import { ALL_INVOCATIONS } from '../../../data/invocations';
import { ALL_PACT_BOONS } from '../../../data/pactBoons';
import { ALL_METAMAGIC } from '../../../data/metamagic';
import { ALL_MANEUVERS } from '../../../data/maneuvers';
import { ALL_INFUSIONS } from '../../../data/infusions';
import { ALL_OPTIONAL_CLASS_FEATURES } from '../../../data/optionalClassFeatures';
import { bookEnabled } from '../../../utils/bookEnabled';
import type { BookId, ClassOptionsState } from '../../../types';

function bookColor(b: BookId): 'red' | 'amber' | 'purple' | 'blue' | 'green' | 'orange' | 'teal' | 'indigo' | 'violet' | 'rose' | 'yellow' | 'cyan' | 'gray' {
  switch (b) {
    case 'PHB':    return 'red';
    case 'PHB2024': return 'red';
    case 'XGtE': return 'amber';
    case 'TCE':  return 'purple';
    case 'MMoM': return 'blue';
    case 'VGM':  return 'green';
    case 'FToD': return 'orange';
    case 'EGtW': return 'teal';
    case 'GGR':  return 'indigo';
    case 'SJA':  return 'violet';
    case 'SCoC': return 'rose';
    case 'ERLW': return 'yellow';
    case 'SCAG': return 'cyan';
    case 'DMG':  return 'gray';
    default: return 'gray' as any;
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
            <HoverCard
              key={item.id}
              content={
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-bold text-white text-sm">{item.name}</span>
                    <Badge color={bookColor(item.sourceBook)}>{item.sourceBook}</Badge>
                  </div>
                  {item.meta && <p className="text-xs text-yellow-400 mb-2">{item.meta}</p>}
                  <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{item.description}</p>
                </div>
              }
            >
            <div
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
            </HoverCard>
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
  const { draft, updateDraft } = useCreatorStore();
  const enabledBooks = new Set(draft.enabledBooks ?? []);
  const primaryClass = draft.classes?.[0];
  const classId = primaryClass?.classId ?? '';
  const level = primaryClass?.level ?? 1;
  const subclassId = primaryClass?.subclassId;

  const opts: ClassOptionsState = draft.classOptions ?? {
    fightingStyles: [], invocations: [], metamagic: [], maneuvers: [], infusions: [], optionalFeatures: [],
  };

  function patch(partial: Partial<ClassOptionsState>) {
    updateDraft({ classOptions: { ...opts, ...partial } });
  }

  function toggleList(key: keyof Omit<ClassOptionsState, 'pactBoon' | 'totemSpirit' | 'aspectTotem' | 'totemicAttunement'>, id: string, max: number) {
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
    .filter(fs => bookEnabled(fs, enabledBooks))
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
    .filter(i => bookEnabled(i, enabledBooks))
    .filter(i => i.minLevel <= level)
    .filter(i => !i.prerequisitePact || i.prerequisitePact === (opts.pactBoon?.replace('pact-of-the-', '') as any));

  const pactBoonsAvail = ALL_PACT_BOONS.filter(p => bookEnabled(p, enabledBooks));

  // ── Metamagic ────────────────────────────────────────────────────────
  const isSorcerer = classId === 'sorcerer';
  let metamagicCount = 0;
  if (isSorcerer) {
    if (level >= 3) metamagicCount = 2;
    if (level >= 10) metamagicCount = 3;
    if (level >= 17) metamagicCount = 4;
  }
  const metamagicAvail = ALL_METAMAGIC.filter(m => bookEnabled(m, enabledBooks));

  // ── Maneuvers (Battle Master) ────────────────────────────────────────
  const isBattleMaster = classId === 'fighter' && subclassId === 'battle-master';
  let maneuverCount = 0;
  if (isBattleMaster) {
    maneuverCount = 3;
    if (level >= 7) maneuverCount = 5;
    if (level >= 10) maneuverCount = 7;
    if (level >= 15) maneuverCount = 9;
  }
  const maneuversAvail = ALL_MANEUVERS.filter(m => bookEnabled(m, enabledBooks));

  // ── Infusions (Artificer) ────────────────────────────────────────────
  const isArtificer = classId === 'artificer';
  let infusionsKnownCount = 0;
  if (isArtificer && level >= 2) infusionsKnownCount = 4;
  if (isArtificer && level >= 6) infusionsKnownCount = 6;
  if (isArtificer && level >= 10) infusionsKnownCount = 8;
  if (isArtificer && level >= 14) infusionsKnownCount = 10;
  if (isArtificer && level >= 18) infusionsKnownCount = 12;
  const infusionsAvail = ALL_INFUSIONS
    .filter(i => bookEnabled(i, enabledBooks))
    .filter(i => i.minLevel <= level);

  // ── Optional Class Features (TCE) ────────────────────────────────────
  const optionalFeaturesAvail = ALL_OPTIONAL_CLASS_FEATURES
    .filter(f => bookEnabled(f, enabledBooks))
    .filter(f => f.classId === classId)
    .filter(f => f.minLevel <= level);

  // ── Totem Warrior ─────────────────────────────────────────────────────
  const isTotemWarrior = classId === 'barbarian' && (
    subclassId === 'totem-warrior' || subclassId === 'scag-totem-warrior-elk-tiger'
  );
  const hasScagTotems = isTotemWarrior && enabledBooks.has('SCAG');

  type TotemAnimal = { id: string; emoji: string; name: string; sourceBook: BookId; description: string };
  const TOTEM_SPIRIT_OPTIONS: TotemAnimal[] = [
    { id: 'bear',  emoji: '🐻', name: 'Bear',  sourceBook: 'PHB',  description: "While raging, you have resistance to all damage except psychic damage. This makes you exceptionally hard to kill in battle." },
    { id: 'eagle', emoji: '🦅', name: 'Eagle', sourceBook: 'PHB',  description: "While raging, other creatures have disadvantage on opportunity attack rolls against you, and you can use the Dash action as a bonus action on your turn. The spirit of the eagle makes you into a predator who can weave through the fray with ease." },
    { id: 'wolf',  emoji: '🐺', name: 'Wolf',  sourceBook: 'PHB',  description: "While raging, your friends have advantage on melee attack rolls against any creature within 5 feet of you that is hostile to you. The spirit of the wolf makes you a leader of hunters." },
    ...(hasScagTotems ? [
      { id: 'elk',   emoji: '🦌', name: 'Elk',   sourceBook: 'SCAG' as BookId, description: "While raging and not wearing heavy armor, your walking speed increases by 15 feet. The spirit of the elk makes you extraordinarily swift." },
      { id: 'tiger', emoji: '🐯', name: 'Tiger', sourceBook: 'SCAG' as BookId, description: "While raging, you can add 10 feet to your long jump distance and 3 feet to your high jump distance. The spirit of the tiger empowers your leaps." },
    ] : []),
  ];

  const ASPECT_TOTEM_OPTIONS: TotemAnimal[] = [
    { id: 'bear',  emoji: '🐻', name: 'Bear',  sourceBook: 'PHB',  description: "Your carrying capacity (including maximum load and maximum lift) is doubled, and you have advantage on Strength checks made to push, pull, lift, or break objects." },
    { id: 'eagle', emoji: '🦅', name: 'Eagle', sourceBook: 'PHB',  description: "You can see up to 1 mile away with no difficulty, able to discern even fine details as though looking at something no more than 100 feet away from you. Additionally, dim light doesn't impose disadvantage on your Wisdom (Perception) checks." },
    { id: 'wolf',  emoji: '🐺', name: 'Wolf',  sourceBook: 'PHB',  description: "You can track other creatures while traveling at a fast pace, and you can move stealthily while traveling at a normal pace." },
    ...(hasScagTotems ? [
      { id: 'elk',   emoji: '🦌', name: 'Elk',   sourceBook: 'SCAG' as BookId, description: "Whether mounted or on foot, your travel pace is doubled, as is the travel pace of up to ten companions while they're within 60 feet of you and you're not incapacitated." },
      { id: 'tiger', emoji: '🐯', name: 'Tiger', sourceBook: 'SCAG' as BookId, description: "You gain proficiency in two skills from the following list: Athletics, Acrobatics, Stealth, and Survival." },
    ] : []),
  ];

  const TOTEMIC_ATTUNEMENT_OPTIONS: TotemAnimal[] = [
    { id: 'bear',  emoji: '🐻', name: 'Bear',  sourceBook: 'PHB',  description: "While you're raging, any creature within 5 feet of you that's hostile to you has disadvantage on attack rolls against targets other than you or another character with this feature. An enemy is immune to this effect if it can't see or hear you or if it can't be frightened." },
    { id: 'eagle', emoji: '🦅', name: 'Eagle', sourceBook: 'PHB',  description: "While raging, you have a flying speed equal to your current walking speed. This benefit works only in short bursts; you fall if you end your turn in the air and nothing else is holding you aloft." },
    { id: 'wolf',  emoji: '🐺', name: 'Wolf',  sourceBook: 'PHB',  description: "While you're raging, you can use a bonus action on your turn to knock a Large or smaller creature prone when you hit it with a melee weapon attack." },
    ...(hasScagTotems ? [
      { id: 'elk',   emoji: '🦌', name: 'Elk',   sourceBook: 'SCAG' as BookId, description: "While raging, you can use a bonus action during your move to pass through the space of a Large or smaller creature. That creature must succeed on a Strength saving throw (DC 8 + your Str bonus + prof bonus) or be knocked prone and take 1d12 + Str modifier bludgeoning damage." },
      { id: 'tiger', emoji: '🐯', name: 'Tiger', sourceBook: 'SCAG' as BookId, description: "While raging, if you move at least 20 feet in a straight line toward a Large or smaller target right before a melee weapon attack against it, you can use a bonus action to make an additional melee weapon attack against it." },
    ] : []),
  ];

  const nothingToChoose =
    !hasFightingStyle && !isWarlock && !isSorcerer && !isBattleMaster && !isArtificer &&
    !isTotemWarrior && optionalFeaturesAvail.length === 0;

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

      {optionalFeaturesAvail.length > 0 && (
        <OptionSection
          title="Optional Class Features"
          helpText="These TCE optional features replace or supplement existing class features. Toggle on any you want to use."
          items={optionalFeaturesAvail.map(f => ({
            id: f.id, name: f.name, sourceBook: f.sourceBook, description: f.description,
            meta: `Lvl ${f.minLevel}`,
          }))}
          selectedIds={opts.optionalFeatures}
          max={Infinity}
          onToggle={(id) => toggleList('optionalFeatures', id, Infinity)}
        />
      )}

      {/* ── Totem Warrior: Totem Spirit (lv.3+) ── */}
      {isTotemWarrior && level >= 3 && (
        <OptionSection
          title="Totem Spirit"
          helpText="Choose a totem animal whose spirit guides your rage. You must craft or acquire a totem object incorporating the animal's physical elements."
          items={TOTEM_SPIRIT_OPTIONS.map(t => ({
            id: t.id, name: `${t.emoji} ${t.name}`, sourceBook: t.sourceBook, description: t.description,
          }))}
          selectedIds={opts.totemSpirit ? [opts.totemSpirit] : []}
          max={1}
          radio
          onToggle={(id) => patch({ totemSpirit: opts.totemSpirit === id ? undefined : id })}
        />
      )}

      {/* ── Totem Warrior: Aspect of the Beast (lv.6+) ── */}
      {isTotemWarrior && level >= 6 && (
        <OptionSection
          title="Aspect of the Beast"
          helpText="At 6th level, you gain a magical benefit based on a totem animal of your choice (can differ from your Totem Spirit)."
          items={ASPECT_TOTEM_OPTIONS.map(t => ({
            id: t.id, name: `${t.emoji} ${t.name}`, sourceBook: t.sourceBook, description: t.description,
          }))}
          selectedIds={opts.aspectTotem ? [opts.aspectTotem] : []}
          max={1}
          radio
          onToggle={(id) => patch({ aspectTotem: opts.aspectTotem === id ? undefined : id })}
        />
      )}

      {/* ── Totem Warrior: Totemic Attunement (lv.14+) ── */}
      {isTotemWarrior && level >= 14 && (
        <OptionSection
          title="Totemic Attunement"
          helpText="At 14th level, you gain a magical benefit based on a totem animal of your choice (can differ from your earlier choices)."
          items={TOTEMIC_ATTUNEMENT_OPTIONS.map(t => ({
            id: t.id, name: `${t.emoji} ${t.name}`, sourceBook: t.sourceBook, description: t.description,
          }))}
          selectedIds={opts.totemicAttunement ? [opts.totemicAttunement] : []}
          max={1}
          radio
          onToggle={(id) => patch({ totemicAttunement: opts.totemicAttunement === id ? undefined : id })}
        />
      )}
    </div>
  );
}
