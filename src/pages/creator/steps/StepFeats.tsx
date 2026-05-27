import React from 'react';
import { useCreatorStore } from '../../../store/useCreatorStore';
import { ALL_FEATS } from '../../../data/feats';
import { Badge, Dialog, HoverCard } from '../../../components/ui';
import { cn } from '../../../utils/cn';
import { ASI_LEVELS } from '../../../data/mechanics';
import { getClass } from '../../../data/classes';
import { BOOKS } from '../../../data/books';
import { bookEnabled } from '../../../utils/bookEnabled';
import type { Feat, BookId } from '../../../types';

const BOOK_COLOR = Object.fromEntries(BOOKS.map(b => [b.id, b.color])) as Record<BookId, string>;

export function StepFeats() {
  const { draft, updateDraft } = useCreatorStore();
  const [detailFeat, setDetailFeat] = React.useState<Feat | null>(null);

  const primaryClass = draft.classes?.[0];
  const level = primaryClass?.level ?? 1;
  const classId = primaryClass?.classId ?? '';
  const asiLevels = ASI_LEVELS[classId] ?? [];
  const asiCount = asiLevels.filter(l => l <= level).length;

  const available = ALL_FEATS.filter(f => bookEnabled(f, draft.enabledBooks));
  const selected = new Set(draft.selectedFeats ?? []);

  function toggle(featId: string) {
    const next = new Set(selected);
    if (next.has(featId)) {
      next.delete(featId);
    } else if (next.size < asiCount) {
      next.add(featId);
    }
    updateDraft({ selectedFeats: Array.from(next) });
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
                      Requires: {prereq.other ?? prereq.race ?? (prereq.spellcasting ? 'Spellcasting' : prereq.ability ? Object.entries(prereq.ability).map(([k,v]) => `${k.toUpperCase()} ${v}+`).join(', ') : prereq.proficiency ?? '')}
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
                    feat.prerequisite.other ? `${feat.prerequisite.other}${feat.prerequisite.minLevel ? `, level ${feat.prerequisite.minLevel}` : ''}` :
                    feat.prerequisite.minLevel ? `Level ${feat.prerequisite.minLevel}` :
                    feat.prerequisite.spellcasting ? 'Spellcasting' :
                    feat.prerequisite.ability ? Object.entries(feat.prerequisite.ability).map(([k,v]) => `${k.toUpperCase()} ${v}+`).join(', ') :
                    feat.prerequisite.proficiency ?? ''
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
                  {detailFeat.prerequisite.other ? `${detailFeat.prerequisite.other}${detailFeat.prerequisite.minLevel ? `, level ${detailFeat.prerequisite.minLevel}` : ''}` :
                   detailFeat.prerequisite.minLevel ? `Level ${detailFeat.prerequisite.minLevel}` :
                   detailFeat.prerequisite.spellcasting ? 'Spellcasting ability' :
                   detailFeat.prerequisite.ability ? Object.entries(detailFeat.prerequisite.ability).map(([k,v]) => `${k.toUpperCase()} ${v}+`).join(', ') :
                   detailFeat.prerequisite.proficiency ?? ''}
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
