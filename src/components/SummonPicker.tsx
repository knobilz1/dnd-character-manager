import { Dialog, Badge } from './ui';
import type { Character, Companion } from '../types';
import { resolveCreatureForm, type SummonSpec } from '../data/summonOptions';
import { useCharacterStore } from '../store/useCharacterStore';

/**
 * The dialog shown after casting a summoning spell or using an item that produces a creature.
 *
 * Shared rather than duplicated: the spell panel and the inventory panel open the identical thing,
 * and the interesting part — turning a choice into a Companion so it gets a pop-out sheet and shows
 * in the active-summon banner — is exactly what must not drift between them.
 */
export function SummonPicker({ spec, character, title, onClose }: {
  spec: SummonSpec | undefined;
  character: Character;
  /** Falls back to the spec's own title; a spell passes its name for a clearer header. */
  title?: string;
  onClose: () => void;
}) {
  const addCompanion = useCharacterStore(st => st.addCompanion);

  return (
    <Dialog open={!!spec} onClose={onClose} title={spec ? (title ?? spec.title) : ''} wide>
      {spec && (
        <div>
          <p className="text-sm text-slate-400 mb-3">{spec.help}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {spec.options
              .filter(opt => !opt.requiresPactBoon || character.classOptions?.pactBoon === opt.requiresPactBoon)
              .map(opt => {
              const beast = resolveCreatureForm(opt.beastId);
              return (
                <button
                  key={opt.beastId}
                  onClick={() => {
                    if (!beast) return;
                    const draft: Companion = {
                      id: crypto.randomUUID(),
                      kind: spec.kind,
                      // Nothing here scales with the owner, so the class is recorded for
                      // provenance rather than arithmetic — the first class is the honest answer
                      // for whose spell or item it was.
                      classId: character.classes[0]?.classId ?? '',
                      beastId: opt.beastId,
                      name: opt.label,
                      currentHP: beast.hp,
                      active: true,
                    };
                    addCompanion(draft);
                    onClose();
                  }}
                  className="text-left p-3 rounded-lg border-2 border-slate-600 bg-slate-800 hover:border-indigo-500 hover:bg-indigo-950/20 transition-all"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-white text-sm">{opt.label}</span>
                    {beast && <Badge color="slate">{beast.size}</Badge>}
                  </div>
                  {beast
                    ? <p className="text-xs text-slate-500">
                        AC {beast.ac} · {beast.hp} HP · {Object.entries(beast.speed).map(([k, v]) => `${k} ${v}`).join(', ')}
                      </p>
                    // Never silently offer a creature with no stat block: the companion sheet
                    // would render empty and the DM prompt would say "stat block unavailable".
                    : <p className="text-xs text-amber-400">Stat block missing — cannot summon.</p>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Dialog>
  );
}
