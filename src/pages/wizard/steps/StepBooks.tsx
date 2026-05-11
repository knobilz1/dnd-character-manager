import { useWizardStore } from '../../../store/useWizardStore';
import { BOOKS } from '../../../data/books';
import { Badge } from '../../../components/ui';
import { cn } from '../../../utils/cn';
import type { BookId } from '../../../types';

export function StepBooks() {
  const { draft, updateDraft } = useWizardStore();
  const enabled = new Set(draft.enabledBooks);

  function toggle(id: BookId) {
    if (id === 'PHB') return; // PHB always required
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
    </div>
  );
}
