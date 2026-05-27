import { useCreatorStore } from '../../../store/useCreatorStore';
import { ALL_SUBCLASSES } from '../../../data/subclasses';
import { Badge, HoverCard } from '../../../components/ui';
import { cn } from '../../../utils/cn';
import { getClass } from '../../../data/classes';
import { bookEnabled } from '../../../utils/bookEnabled';

export function StepSubclass() {
  const { draft, updateDraft } = useCreatorStore();
  const primaryClass = draft.classes?.[0];
  const classDef = primaryClass ? getClass(primaryClass.classId) : null;

  const subclassLevel = classDef?.subclassLevel ?? 3;
  const hasSubclass = (primaryClass?.level ?? 0) >= subclassLevel;

  const available = ALL_SUBCLASSES.filter(
    s => s.classId === primaryClass?.classId && bookEnabled(s, draft.enabledBooks)
  );

  const selectedId = primaryClass?.subclassId;

  function select(id: string) {
    if (!primaryClass) return;
    updateDraft({
      classes: [{ ...primaryClass, subclassId: id }],
    });
  }

  if (!classDef) {
    return (
      <div className="text-center py-20 text-slate-400">
        Please select a class first.
      </div>
    );
  }

  if (!hasSubclass) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">{classDef.subclassLabel}</h2>
        <p className="text-slate-400">
          {classDef.name}s choose their {classDef.subclassLabel} at level {subclassLevel}.
          You're currently level {primaryClass?.level}. You can skip this step for now, or
          increase your level to {subclassLevel}+ to choose a subclass.
        </p>
      </div>
    );
  }

  if (available.length === 0) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">{classDef.subclassLabel}</h2>
        <p className="text-slate-400 mb-2">
          No {classDef.subclassLabel} options are available from the books you have enabled.
        </p>
        <p className="text-sm text-slate-500">
          Go back to the Books step and enable additional sources, or skip this step to continue without a subclass.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">{classDef.subclassLabel}</h2>
        <p className="text-slate-400 mb-4">
          Choose your {classDef.subclassLabel} for your {classDef.name}.
        </p>

        <div className="space-y-3">
          {available.map(sub => (
            <HoverCard
              key={sub.id}
              content={
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-bold text-white text-sm">{sub.name}</span>
                    <Badge color="slate">{sub.sourceBook}</Badge>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed mb-3">{sub.description}</p>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Features</p>
                  <div className="space-y-2">
                    {sub.features.map((f, i) => (
                      <div key={i}>
                        <div className="flex items-center gap-1 mb-0.5">
                          <span className="text-xs bg-slate-700 text-slate-300 px-1 py-0.5 rounded">Lv.{f.level}</span>
                          <span className="text-xs font-bold text-white">{f.name}</span>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">{f.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              }
            >
            <div
              onClick={() => select(sub.id)}
              className={cn(
                'p-4 rounded-xl border-2 cursor-pointer transition-all',
                selectedId === sub.id
                  ? 'border-red-500 bg-red-950/30'
                  : 'border-slate-700 hover:border-slate-500 bg-slate-800',
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <h4 className="font-bold text-white">{sub.name}</h4>
                <Badge color="slate">{sub.sourceBook}</Badge>
              </div>
              <p className="text-sm text-slate-400 line-clamp-2">{sub.description}</p>
            </div>
            </HoverCard>
          ))}
        </div>
      </div>

      {/* Subclass detail */}
      <div className="lg:sticky lg:top-0 lg:self-start">
        {selectedId ? (() => {
          const sub = ALL_SUBCLASSES.find(s => s.id === selectedId);
          if (!sub) return null;
          return (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
              <h3 className="text-xl font-bold text-white mb-1">{sub.name}</h3>
              <Badge color="slate" className="mb-3">{sub.sourceBook}</Badge>
              <p className="text-sm text-slate-400 mb-4 leading-relaxed">{sub.description}</p>
              <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Features</h4>
              <div className="space-y-2">
                {sub.features.map((f, i) => (
                  <HoverCard
                    key={i}
                    content={
                      <div>
                        <div className="flex items-center gap-1 mb-2">
                          <span className="text-xs bg-slate-700 text-slate-300 px-1 py-0.5 rounded">Lv.{f.level}</span>
                          <span className="text-xs font-bold text-white">{f.name}</span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{f.description}</p>
                      </div>
                    }
                  >
                  <div className="bg-slate-900 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">Lv.{f.level}</span>
                      <h5 className="font-bold text-white text-sm">{f.name}</h5>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">{f.description}</p>
                  </div>
                  </HoverCard>
                ))}
              </div>
            </div>
          );
        })() : (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center text-slate-500">
            Select a subclass to see details
          </div>
        )}
      </div>
    </div>
  );
}
