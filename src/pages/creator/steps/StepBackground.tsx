import { useCreatorStore } from '../../../store/useCreatorStore';
import { ALL_BACKGROUNDS } from '../../../data/backgrounds';
import { getRace } from '../../../data/races';
import { getClass } from '../../../data/classes';
import { cn } from '../../../utils/cn';
import { bookEnabled } from '../../../utils/bookEnabled';
import { FlexibleAsiPicker } from './FlexibleAsiPicker';
import { BackgroundGenerator } from './BackgroundGenerator';
import type { BackgroundCustom } from '../../../types';

export function StepBackground() {
  const { draft, updateDraft } = useCreatorStore();
  const available = ALL_BACKGROUNDS.filter(b => bookEnabled(b, draft.enabledBooks));
  const custom = draft.backgroundCustom ?? {};

  function select(id: string) {
    updateDraft({ backgroundId: id });
  }

  function setCustom(patch: Partial<BackgroundCustom>) {
    updateDraft({ backgroundCustom: { ...custom, ...patch } });
  }

  const selected = available.find(b => b.id === draft.backgroundId);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Choose Your Background</h2>
        <p className="text-slate-400 mb-4">Your background reveals where you came from, how you became an adventurer, and your place in the world. Pick the one that fits closest — you can rename it and write your own history on the right.</p>

        <div className="grid gap-2 sm:grid-cols-2">
          {available.map(bg => (
            <div
              key={bg.id}
              onClick={() => select(bg.id)}
              className={cn(
                'p-3 rounded-lg border-2 cursor-pointer transition-all',
                draft.backgroundId === bg.id
                  ? 'border-red-500 bg-red-950/30'
                  : 'border-slate-700 hover:border-slate-500 bg-slate-800',
              )}
            >
              <h4 className="font-bold text-white text-sm mb-1">{bg.name}</h4>
              <div className="flex flex-wrap gap-1">
                {bg.skillProficiencies.map(s => (
                  <span key={s} className="text-xs text-slate-400 bg-slate-700 px-1.5 py-0.5 rounded">{s}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="lg:sticky lg:top-0 lg:self-start space-y-4">
        {selected ? (
          <>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
            <h3 className="text-xl font-bold text-white mb-3">{custom.name?.trim() || selected.name}</h3>

            {/* C7 — PHB 2024 grants the ability score increase through the background rather than
                the species, so it has to be chosen here. 2014 and GGR backgrounds carry no
                flexibleAsi and render nothing, which is correct: their race grants it instead. */}
            {selected.flexibleAsi && (
              <div className="bg-slate-900 border border-amber-700/40 rounded-lg p-3 mb-4">
                <FlexibleAsiPicker
                  source={selected}
                  value={draft.backgroundAbilityChoice}
                  onChange={v => updateDraft({ backgroundAbilityChoice: v })}
                  label="Ability Score Increase (2024)"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
              <div className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Skill Proficiencies</p>
                <p className="text-white font-medium">{selected.skillProficiencies.join(', ')}</p>
              </div>
              <div className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs text-slate-400 mb-1">Languages</p>
                <p className="text-white font-medium">{selected.languages > 0 ? `+${selected.languages} language(s)` : 'None'}</p>
              </div>
              {selected.toolProficiencies.length > 0 && (
                <div className="bg-slate-900 rounded-lg p-3 col-span-2">
                  <p className="text-xs text-slate-400 mb-1">Tool Proficiencies</p>
                  <p className="text-white font-medium">{selected.toolProficiencies.join(', ')}</p>
                </div>
              )}
            </div>

            <div className="bg-slate-900 rounded-lg p-3">
              <h5 className="font-bold text-white text-sm mb-1">Feature: {selected.feature.name}</h5>
              <p className="text-xs text-slate-400 leading-relaxed">{selected.feature.description}</p>
            </div>
          </div>

          {/* Make it yours — everything below is free text. The book's tables are
              only suggestions: click one to drop it in, then edit it however you
              like. Blank means "use the book's default". */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-white">Make It Yours</h3>
                <p className="text-xs text-slate-400">Write your own, or click a suggestion to start from the book. Anything you leave blank uses {selected.name}'s default. Your proficiencies and feature don't change.</p>
              </div>
              {/* Sits HERE, next to the fields it fills, rather than up beside the background list:
                  what it writes is the five boxes below, and a button that far from its effect
                  reads like it picks a background for you. */}
              <BackgroundGenerator
                race={getRace(draft.raceId ?? '')?.name ?? ''}
                characterClass={getClass(draft.classes?.[0]?.classId ?? '')?.name ?? ''}
                background={custom.name?.trim() || selected.name}
                onApply={({ name, alignment, ...traits }) => {
                  // `name` here is the CHARACTER's, which lives on the draft — not
                  // `backgroundCustom.name`, which renames the background itself. Spreading the
                  // whole result into setCustom would have quietly retitled "Entertainer" to
                  // whatever the character is called.
                  setCustom(traits);
                  updateDraft({
                    ...(name.trim() ? { name: name.trim() } : {}),
                    ...(alignment.trim() ? { alignment: alignment.trim() } : {}),
                  });
                }}
              />
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Background Name</label>
              <input
                type="text"
                value={custom.name ?? ''}
                onChange={e => setCustom({ name: e.target.value })}
                placeholder={selected.name}
                className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-red-500 transition-colors"
              />
            </div>

            <TraitField
              label="Personality Traits"
              value={custom.personalityTraits ?? ''}
              onChange={v => setCustom({ personalityTraits: v })}
              suggestions={selected.personalityTraits}
            />
            <TraitField
              label="Ideal"
              value={custom.ideals ?? ''}
              onChange={v => setCustom({ ideals: v })}
              suggestions={selected.ideals}
            />
            <TraitField
              label="Bond"
              value={custom.bonds ?? ''}
              onChange={v => setCustom({ bonds: v })}
              suggestions={selected.bonds}
            />
            <TraitField
              label="Flaw"
              value={custom.flaws ?? ''}
              onChange={v => setCustom({ flaws: v })}
              suggestions={selected.flaws}
            />

            <div>
              <label className="text-xs font-bold uppercase tracking-widest text-slate-400">Backstory</label>
              <textarea
                value={custom.backstory ?? ''}
                onChange={e => setCustom({ backstory: e.target.value })}
                placeholder="Who were you before the first session? Family, home, the thing that set you on the road…"
                rows={6}
                className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-red-500 transition-colors resize-y"
              />
            </div>
          </div>
          </>
        ) : (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center text-slate-500">
            Select a background to see details
          </div>
        )}
      </div>
    </div>
  );
}

/** A free-text trait box with the book's d8 table as one-click starting points. */
function TraitField({
  label,
  value,
  onChange,
  suggestions,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
}) {
  return (
    <div>
      <label className="text-xs font-bold uppercase tracking-widest text-slate-400">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={suggestions[0] ?? ''}
        rows={2}
        className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-red-500 transition-colors resize-y"
      />
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              title={s}
              onClick={() => onChange(s)}
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded border transition-colors max-w-full truncate',
                value === s
                  ? 'border-red-600 bg-red-950/40 text-red-200'
                  : 'border-slate-600 text-slate-400 hover:border-slate-400 hover:text-slate-200',
              )}
            >
              {i + 1}. {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
