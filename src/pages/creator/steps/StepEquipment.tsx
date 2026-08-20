import React from 'react';
import { useCreatorStore } from '../../../store/useCreatorStore';
import { getClassStartingEquipment } from '../../../data/startingEquipment';
import { getBackground } from '../../../data/backgrounds';
import { getPackContents } from '../../../data/items';
import { buildStartingLoadout } from '../../../utils/startingLoadout';
import { cn } from '../../../utils/cn';
import type { ItemCategory } from '../../../types';

const CATEGORY_BADGE: Record<ItemCategory, string> = {
  weapon: 'bg-red-900/30 text-red-300 border-red-700/40',
  armor: 'bg-slate-700 text-slate-200 border-slate-500',
  shield: 'bg-amber-900/30 text-amber-300 border-amber-700/40',
  tool: 'bg-blue-900/30 text-blue-300 border-blue-700/40',
  pack: 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40',
  consumable: 'bg-purple-900/30 text-purple-300 border-purple-700/40',
  gear: 'bg-indigo-900/30 text-indigo-300 border-indigo-700/40',
  treasure: 'bg-yellow-900/30 text-yellow-300 border-yellow-700/40',
  magic: 'bg-pink-900/30 text-pink-300 border-pink-700/40',
  other: 'bg-slate-700 text-slate-300 border-slate-500',
};

export function StepEquipment() {
  const { draft, updateDraft } = useCreatorStore();

  const primaryClass = draft.classes?.[0];
  const classEq = primaryClass ? getClassStartingEquipment(primaryClass.classId) : undefined;
  const bg = draft.backgroundId ? getBackground(draft.backgroundId) : undefined;

  const choices = draft.equipmentChoices ?? {};
  const takeGold = !!draft.equipmentTakeGold;
  const [expandedPack, setExpandedPack] = React.useState<string | null>(null);

  // Rebuild inventory whenever choices, takeGold, class, or background change. The builder
  // itself is shared with the random-character roll (utils/startingLoadout.ts) — it lived
  // inline here once, which is why generated characters used to arrive with 0 gp.
  React.useEffect(() => {
    const loadout = buildStartingLoadout(primaryClass?.classId, draft.backgroundId, choices, takeGold);

    // Avoid loop: only write if items genuinely differ from the current draft inventory.
    const current = draft.inventory ?? [];
    const sameLen = current.length === loadout.inventory.length;
    const sameItems = sameLen && current.every((c, i) =>
      c.name === loadout.inventory[i].name &&
      c.quantity === loadout.inventory[i].quantity &&
      c.source === loadout.inventory[i].source
    );
    if (!sameItems) {
      updateDraft({ inventory: loadout.inventory });
    }

    // Route background gold into currencies rather than leaving it as an inventory item.
    const currentGP = draft.currencies?.gp ?? 0;
    if (currentGP !== loadout.gp) {
      updateDraft({ currencies: { cp: 0, sp: 0, ep: 0, gp: loadout.gp, pp: 0 } });
    }
  }, [primaryClass?.classId, draft.backgroundId, JSON.stringify(choices), takeGold]);

  function selectOption(choiceIdx: number, optIdx: number) {
    updateDraft({ equipmentChoices: { ...choices, [choiceIdx]: optIdx } });
  }

  function setTakeGold(v: boolean) {
    updateDraft({ equipmentTakeGold: v });
  }

  if (!primaryClass) {
    return <div className="text-center py-12 text-slate-400">Please select a class first.</div>;
  }
  if (!classEq) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Starting Equipment</h2>
        <p className="text-slate-400">No starting equipment data available for this class.</p>
      </div>
    );
  }

  const previewItems = draft.inventory ?? [];

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-2">Starting Equipment</h2>
      <p className="text-slate-400 mb-4">
        Choose your starting gear. You can change items later on the character sheet.
        {classEq.startingGold && (
          <> Alternatively, take starting gold ({classEq.startingGold}) and buy your own gear.</>
        )}
      </p>

      {/* Gold-instead toggle */}
      {classEq.startingGold && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-3 mb-6 flex items-center gap-3">
          <input
            type="checkbox"
            id="takeGold"
            checked={takeGold}
            onChange={e => setTakeGold(e.target.checked)}
            className="w-4 h-4 accent-red-600"
          />
          <label htmlFor="takeGold" className="text-sm text-slate-300">
            Skip starting equipment and roll for <span className="text-yellow-300 font-bold">{classEq.startingGold}</span> instead
          </label>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Choices */}
        <div className={cn(takeGold && 'opacity-40 pointer-events-none')}>
          {/* Fixed */}
          {classEq.fixed.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Granted Automatically</h3>
              <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 space-y-1">
                {classEq.fixed.map((f, i) => (
                  <div key={i} className="text-sm text-slate-200 flex items-center justify-between">
                    <span>{f.name}{f.quantity && f.quantity > 1 ? ` ×${f.quantity}` : ''}</span>
                    {f.category && (
                      <span className={cn('text-[10px] uppercase border rounded px-1.5 py-0.5', CATEGORY_BADGE[f.category])}>
                        {f.category}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Choices */}
          {classEq.choices.map((choice, idx) => {
            const selectedIdx = choices[idx];
            return (
              <div key={idx} className="mb-5">
                <h3 className="text-sm font-bold text-white mb-2">{choice.label}</h3>
                <div className="space-y-2">
                  {choice.options.map((opt, oIdx) => {
                    const selected = selectedIdx === oIdx;
                    const packItem = opt.items.find(it => it.category === 'pack');
                    const packKey = packItem ? `${idx}-${oIdx}` : null;
                    const packContents = packItem ? getPackContents(packItem.name) : null;
                    const isExpanded = expandedPack === packKey;
                    return (
                      <div
                        key={oIdx}
                        onClick={() => selectOption(idx, oIdx)}
                        className={cn(
                          'p-3 rounded-lg border-2 cursor-pointer transition-all',
                          selected ? 'border-red-500 bg-red-950/30' : 'border-slate-700 hover:border-slate-500 bg-slate-800'
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="text-sm font-medium text-white">{opt.label}</p>
                          {packContents && (
                            <button
                              onClick={e => { e.stopPropagation(); setExpandedPack(isExpanded ? null : packKey); }}
                              className="text-[10px] text-slate-400 hover:text-emerald-300 border border-slate-600 hover:border-emerald-700 rounded px-1.5 py-0.5 shrink-0 transition-colors"
                            >
                              {isExpanded ? 'Hide' : 'Contents'}
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {opt.items.map((it, i) => (
                            <span key={i} className={cn(
                              'text-[10px] uppercase border rounded px-1.5 py-0.5',
                              CATEGORY_BADGE[it.category ?? 'other']
                            )}>
                              {it.name}{it.quantity && it.quantity > 1 ? ` ×${it.quantity}` : ''}
                            </span>
                          ))}
                        </div>
                        {isExpanded && packContents && (
                          <div className="mt-2 pt-2 border-t border-slate-600">
                            <p className="text-[10px] uppercase tracking-widest text-slate-400 mb-1.5">Includes</p>
                            <ul className="space-y-0.5">
                              {packContents.map((entry, i) => (
                                <li key={i} className="flex items-center justify-between text-xs text-slate-300">
                                  <span>{entry.name}</span>
                                  {entry.quantity > 1 && <span className="text-slate-500">×{entry.quantity}</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Preview / background */}
        <div>
          <div className="lg:sticky lg:top-0">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
              Inventory Preview ({previewItems.length} items)
            </h3>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 max-h-[60vh] overflow-y-auto scrollbar-thin">
              {previewItems.length === 0 ? (
                <p className="text-sm text-slate-500 italic">No items yet — pick options on the left.</p>
              ) : (
                <ul className="space-y-1">
                  {previewItems.map(item => (
                    <li key={item.id} className="text-sm text-slate-200 flex items-start justify-between gap-2">
                      <span>
                        {item.name}
                        {item.quantity > 1 && <span className="text-slate-400"> ×{item.quantity}</span>}
                        <span className="ml-2 text-[10px] uppercase text-slate-500">{item.source}</span>
                      </span>
                      <span className={cn(
                        'text-[10px] uppercase border rounded px-1.5 py-0.5 shrink-0',
                        CATEGORY_BADGE[item.category]
                      )}>
                        {item.category}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {bg && (
              <p className="text-xs text-slate-500 mt-2">
                Equipment from your <span className="text-slate-300 font-medium">{bg.name}</span> background is automatically included.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
