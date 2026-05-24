import React from 'react';
import { useCreatorStore } from '../../../store/useCreatorStore';
import { BOOKS } from '../../../data/books';
import { MODULES } from '../../../data/modules';
import { Badge } from '../../../components/ui';
import { cn } from '../../../utils/cn';
import type { BookId } from '../../../types';

export function StepBooks() {
  const { draft, updateDraft } = useCreatorStore();
  const enabled = new Set(draft.enabledBooks);
  const [showModules, setShowModules] = React.useState(false);

  function toggle(id: BookId) {
    if (id === 'PHB') return;
    const next = new Set(enabled);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateDraft({ enabledBooks: Array.from(next) });
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-white mb-2">Select Source Books</h2>
        <p className="text-slate-400">Choose which D&D books to draw content from. Options like races, subclasses, spells, and feats will be filtered based on your selection.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {BOOKS.map(book => {
          const selected = enabled.has(book.id);
          const required = book.id === 'PHB';
          return (
            <div
              key={book.id}
              onClick={() => toggle(book.id)}
              className={cn(
                'p-4 rounded-xl border-2 cursor-pointer transition-all',
                selected ? 'border-red-500 bg-slate-800' : 'border-slate-700 bg-slate-800 hover:border-slate-500',
                required && 'cursor-default',
              )}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Badge color={book.color}>{book.shortName}</Badge>
                  {required && <Badge color="slate">Required</Badge>}
                </div>
                <div className={cn(
                  'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all shrink-0',
                  selected ? 'border-red-500 bg-red-500' : 'border-slate-500',
                )}>
                  {selected && <div className="w-2 h-2 bg-white rounded-full" />}
                </div>
              </div>
              <h3 className="font-bold text-white mb-1">{book.name}</h3>
              <p className="text-sm text-slate-400">{book.description}</p>
              <p className="text-xs text-slate-500 mt-2">{book.year}</p>
            </div>
          );
        })}
      </div>

      {/* Modules toggle */}
      <div className="mt-6 pt-5 border-t border-slate-700">
        <label className="flex items-center gap-3 cursor-pointer select-none w-fit">
          <div
            onClick={() => setShowModules(v => !v)}
            className={cn(
              'w-10 h-6 rounded-full border-2 transition-all relative',
              showModules ? 'bg-red-600 border-red-500' : 'bg-slate-700 border-slate-600',
            )}
          >
            <div className={cn(
              'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all',
              showModules ? 'left-4' : 'left-0.5',
            )} />
          </div>
          <span className="text-sm font-medium text-slate-300">Show Modules</span>
        </label>
        <p className="text-xs text-slate-500 mt-1 ml-14">Community and third-party modules appear as additional source options.</p>
      </div>

      {showModules && (
        <div className="mt-4">
          {MODULES.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-600 p-6 text-center">
              <p className="text-slate-400 text-sm font-medium">No modules installed</p>
              <p className="text-slate-500 text-xs mt-1">Modules will appear here once added.</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {MODULES.map(book => {
                const selected = enabled.has(book.id);
                return (
                  <div
                    key={book.id}
                    onClick={() => toggle(book.id)}
                    className={cn(
                      'p-4 rounded-xl border-2 cursor-pointer transition-all',
                      selected ? 'border-red-500 bg-slate-800' : 'border-slate-700 bg-slate-800 hover:border-slate-500',
                    )}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge color={book.color}>{book.shortName}</Badge>
                        <Badge color="slate">Module</Badge>
                      </div>
                      <div className={cn(
                        'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all shrink-0',
                        selected ? 'border-red-500 bg-red-500' : 'border-slate-500',
                      )}>
                        {selected && <div className="w-2 h-2 bg-white rounded-full" />}
                      </div>
                    </div>
                    <h3 className="font-bold text-white mb-1">{book.name}</h3>
                    <p className="text-sm text-slate-400">{book.description}</p>
                    <p className="text-xs text-slate-500 mt-2">{book.year}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
