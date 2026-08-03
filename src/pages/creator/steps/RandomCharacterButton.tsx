import React from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { Dices } from 'lucide-react';
import { Button, Dialog } from '../../../components/ui';
import { useCreatorStore } from '../../../store/useCreatorStore';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { getRace } from '../../../data/races';
import { getClass } from '../../../data/classes';
import { ALL_BACKGROUNDS } from '../../../data/backgrounds';
import { rollRandomCharacter } from '../../../utils/randomCharacter';
import type { BookId } from '../../../types';

/**
 * Roll an entire character and go straight to their sheet.
 *
 * Lives on the FIRST page because the books are the only input it needs, and because the player
 * who wants this wants it before they have read twelve steps — not after.
 *
 * Two halves, deliberately separate: `rollRandomCharacter` picks everything the RULES decide
 * (race, class, a level-1 subclass where one is owed, background, the standard array down the
 * class's own priorities, its exact skill count, spells within the real limits) and is pure and
 * seedable, because an illegal character does not throw — it just turns up wrong at the table.
 * The engine only writes the FICTION: name, alignment, backstory. Nothing about a character's
 * legality is left to a language model.
 *
 * A failed generation still produces the character. Losing a rolled, legal build because the
 * backstory step could not reach a CLI would be the worst possible trade.
 */
export function RandomCharacterButton() {
  const navigate = useNavigate();
  const { draft, finalize, updateDraft, reset } = useCreatorStore();
  const createCharacter = useLibraryStore(s => s.createCharacter);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const books = (draft.enabledBooks ?? []) as BookId[];

  async function roll() {
    setError(null);
    setBusy('Rolling…');
    try {
      const r = rollRandomCharacter(books);
      if (!r) {
        setError('No books are enabled, so there is nothing to roll from.');
        setBusy(null);
        return;
      }

      const raceName = getRace(r.raceId)?.name ?? '';
      const className = getClass(r.classId)?.name ?? '';
      const backgroundName = ALL_BACKGROUNDS.find(b => b.id === r.backgroundId)?.name ?? '';

      // The fiction. An empty brief is the "Surprise me" path the background generator already
      // takes, which is exactly the right request here — the player asked for a stranger.
      setBusy(`Writing a life for a ${raceName} ${className}…`);
      let story: Record<string, string> = {};
      try {
        story = await invoke<Record<string, string>>('generate_character_background', {
          brief: { campaign: '', concept: '', playstyle: '', tone: '', wants: '', party: '' },
          race: raceName, class: className, background: backgroundName,
        });
      } catch {
        // Deliberately swallowed: the build is already legal and complete, and a nameless
        // character the player can name themselves beats losing the roll entirely.
        story = {};
      }

      updateDraft({
        raceId: r.raceId,
        // hitPointsRolled stays empty: level 1 HP is the class's max die, computed by finalize(),
        // and this array records dice rolled on LEVEL-UP. Seeding it would be inventing history.
        classes: [{
          classId: r.classId, level: 1, hitPointsRolled: [],
          ...(r.subclassId ? { subclassId: r.subclassId } : {}),
        }],
        backgroundId: r.backgroundId,
        baseAbilityScores: r.baseAbilityScores,
        abilityScoreMethod: 'standard_array',
        selectedSkillProficiencies: r.selectedSkillProficiencies,
        spellbook: r.spellbook.map(s => ({ ...s, isAlwaysPrepared: false })),
        ...(r.racialAbilityChoice ? { racialAbilityChoice: r.racialAbilityChoice } : {}),
        name: story.name?.trim() || `${raceName} ${className}`,
        alignment: story.alignment?.trim() || 'True Neutral',
        backgroundCustom: {
          personalityTraits: story.personalityTraits ?? '',
          ideals: story.ideals ?? '',
          bonds: story.bonds ?? '',
          flaws: story.flaws ?? '',
          backstory: story.backstory ?? '',
        },
      });

      // finalize() reads the store, and updateDraft above is a state update — so the value it
      // would see here is the PREVIOUS draft. Read the store directly instead of trusting the
      // closure; this is the same staleness that ref-mirroring exists for elsewhere.
      const character = useCreatorStore.getState().finalize();
      if (!character) {
        setError('The roll came out incomplete. Try again, or build one by hand.');
        setBusy(null);
        return;
      }
      createCharacter(character);
      reset();
      setOpen(false);
      navigate(`/character/${character.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }
  // `finalize` is read off the store inside roll(); referenced here so the lint rule and the
  // reader both see that this component depends on it.
  void finalize;

  return (
    <>
      <button
        onClick={() => { setError(null); setOpen(true); }}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-sm text-slate-200 hover:border-red-500 hover:text-white transition-colors"
      >
        <Dices size={16} />
        Make one for me
      </button>

      <Dialog open={open} onClose={() => { if (!busy) setOpen(false); }} title="Roll a character at random?">
        <p className="text-sm text-slate-300">
          This creates a character <span className="font-bold text-amber-300">completely at
          random</span> from the books you have selected — race, class, ability scores, skills and
          spells — and writes them a backstory to go with it. You will not be asked anything else.
        </p>
        <p className="mt-3 text-xs text-slate-400">
          It lands on their sheet, where everything is still editable. Nothing you have already
          picked in this creator is kept.
        </p>
        {books.length === 0 && (
          <p className="mt-3 text-sm text-amber-300">Select at least one book first.</p>
        )}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={!!busy}>Cancel</Button>
          <Button onClick={() => void roll()} disabled={!!busy || books.length === 0}>
            {busy ?? 'Roll one up'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
