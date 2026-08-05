import React from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { Dices } from 'lucide-react';
import { Button, Dialog } from '../../../components/ui';
import { useCreatorStore } from '../../../store/useCreatorStore';
import { useLibraryStore } from '../../../store/useLibraryStore';
import { getRace } from '../../../data/races';
import { getClass, ALL_CLASSES } from '../../../data/classes';
import { ALL_BACKGROUNDS } from '../../../data/backgrounds';
import { rollRandomCharacter, selectableRaces } from '../../../utils/randomCharacter';
import { parseCharacterWish } from '../../../utils/parseCharacterWish';
import { bookEnabled } from '../../../utils/bookEnabled';
import { BOOKS } from '../../../data/books';
import type { BookId } from '../../../types';

/**
 * Roll an entire character and go straight to their sheet.
 *
 * Lives on the FIRST page because the books are the only input it needs, and because the player
 * who wants this wants it before they have read twelve steps — not after.
 *
 * Two halves, deliberately separate: `rollRandomCharacter` picks everything the RULES decide
 * (race, class, a subclass once the class is owed one at that level, background, the standard
 * array down the class's own priorities, its exact skill count, the ability score improvements
 * the level has earned, and spells within the real limits for the level) and is pure and
 * seedable, because an illegal character does not throw — it just turns up wrong at the table.
 * The engine only writes the FICTION: name, alignment, backstory. Nothing about a character's
 * legality is left to a language model.
 *
 * Level defaults to 1 and comes from the player's own words ("a level 6 cleric", "any level").
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
  const [wishText, setWishText] = React.useState('');
  /** Set when the character saved but its story didn't, so the dialog can offer to open them. */
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const books = (draft.enabledBooks ?? []) as BookId[];

  // Parsed as you type so the dialog can show what it understood BEFORE the roll. A player who
  // typed "warrior" should see "Fighter" come back, and one who typed something unrecognisable
  // should find that out here rather than by getting a character that ignores half their request.
  const wish = React.useMemo(() => parseCharacterWish(wishText, books), [wishText, books]);
  const wishRace = wish.raceLabel;
  const wishClass = wish.classId ? getClass(wish.classId)?.name : undefined;
  const wishBackground = wish.backgroundId
    ? ALL_BACKGROUNDS.find(b => b.id === wish.backgroundId)?.name : undefined;
  const understood = [
    wishClass && `class: ${wishClass}`,
    wishRace && `race: ${wishRace}`,
    wishBackground && `background: ${wishBackground}`,
  ].filter(Boolean) as string[];

  // What the roll will actually draw from. Shown because "it's ignoring my books" is impossible
  // to check from the outside — the pool is invisible until a character pops out — and because
  // the PHB2024 widening below genuinely surprises people.
  const pool = React.useMemo(() => {
    const set = new Set(books);
    const names = BOOKS.filter(b => set.has(b.id)).map(b => b.shortName);
    return {
      names,
      races: selectableRaces(books).length,
      classes: ALL_CLASSES.filter(c => bookEnabled(c, books)).length,
      backgrounds: ALL_BACKGROUNDS.filter(b => bookEnabled(b, books)).length,
      // Choosing the 2024 PHB REPLACES 'PHB' in the selection, but bookEnabled widens it back so
      // shared options (metamagic, invocations, fighting styles) — all tagged with their 2014
      // book — don't vanish. The side effect is that 2014 races and classes come along too, which
      // looks exactly like the book filter being ignored unless it's said out loud.
      widened2014: set.has('PHB2024') && !set.has('PHB'),
    };
  }, [books]);

  async function roll() {
    setError(null);
    setBusy('Rolling…');
    try {
      // A random level is rolled HERE, not in the parser, so the parser stays a pure reading of
      // the text and the same wish can be re-rolled for a different level.
      const level = wish.level
        ?? (wish.randomLevel ? 1 + Math.floor(Math.random() * 20) : 1);
      const r = rollRandomCharacter(books, Math.random, {
        classId: wish.classId, raceIds: wish.raceIds, backgroundId: wish.backgroundId, level,
      });
      if (!r) {
        setError('No books are enabled, so there is nothing to roll from.');
        setBusy(null);
        return;
      }

      const raceName = getRace(r.raceId)?.name ?? '';
      const className = getClass(r.classId)?.name ?? '';
      const backgroundName = ALL_BACKGROUNDS.find(b => b.id === r.backgroundId)?.name ?? '';

      // The fiction. An empty brief is the "Surprise me" path the background generator already
      // takes, which is the right request when the player asked for a stranger. When they DID
      // type something, the whole line goes in as the concept — including the parts the rules
      // couldn't use ("make it cool", "washed-up sailor"), which is exactly the material the
      // fiction step wants and the roller has no use for.
      setBusy(`Writing a life for a ${raceName} ${className}…`);
      let story: Record<string, string> = {};
      let storyFailed = false;
      try {
        // LEVEL goes in the concept because the Rust command only takes race/class/background,
        // and a level-14 veteran should not read like someone who left home last week. When the
        // player typed the level themselves it is already in `wish.text`; when it was rolled at
        // random, nothing else would tell the model about it.
        const experience = r.level > 1
          ? `This character is level ${r.level} — an experienced adventurer with ${r.level} levels of history behind them, not a novice.`
          : '';
        const concept = [wish.text, experience].filter(Boolean).join(' ');
        story = await invoke<Record<string, string>>('generate_character_background', {
          brief: { campaign: '', concept, playstyle: '', tone: '', wants: '', party: '' },
          race: raceName, class: className, background: backgroundName,
        });
      } catch {
        // Deliberately swallowed: the build is already legal and complete, and a nameless
        // character the player can name themselves beats losing the roll entirely. But it is
        // RECORDED — falling back silently is indistinguishable from a story that generated
        // fine, and the player is left thinking the generator wrote them stock PHB traits.
        storyFailed = true;
        story = {};
      }

      updateDraft({
        raceId: r.raceId,
        // hitPointsRolled stays empty at every level: finalize() computes maxHP from the class
        // hit die and level using 5e's FIXED averages, and this array records dice actually
        // rolled on level-up. Seeding it would be inventing history the player never had.
        classes: [{
          classId: r.classId, level: r.level, hitPointsRolled: [],
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
      // Say so when the story step failed. The character is legal and complete either way, but
      // without this the player sees their background's stock PHB bond and flaw and reasonably
      // concludes the generator is lazy rather than unreachable.
      if (storyFailed) {
        setBusy(null);
        setError(
          `${character.name} was rolled and saved, but the backstory couldn’t be written — `
          + 'the AI helper wasn’t reachable. Everything else is on their sheet.',
        );
        setPendingId(character.id);
        return;
      }
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
        onClick={() => { setError(null); setPendingId(null); setOpen(true); }}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-600 bg-slate-800 text-sm text-slate-200 hover:border-red-500 hover:text-white transition-colors"
      >
        <Dices size={16} />
        Make one for me
      </button>

      <Dialog open={open} onClose={() => { if (!busy) setOpen(false); }} title="Roll a character">
        <p className="text-sm text-slate-300">
          Rolls a complete, legal character from the books you have selected — race, class,
          ability scores, skills and spells — and writes them a backstory to go with it.
        </p>

        <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Rolling from
          </p>
          {pool.names.length ? (
            <>
              <p className="mt-1 text-sm text-slate-200">{pool.names.join(', ')}</p>
              <p className="mt-1 text-xs text-slate-400">
                <span className="tabular-nums text-slate-300">{pool.races}</span> races ·{' '}
                <span className="tabular-nums text-slate-300">{pool.classes}</span> classes ·{' '}
                <span className="tabular-nums text-slate-300">{pool.backgrounds}</span> backgrounds
              </p>
              {pool.widened2014 && (
                <p className="mt-1 text-xs text-amber-300">
                  2014 Player’s Handbook content is included too — the 2024 rules share its
                  options (fighting styles, metamagic, invocations), so it can’t be excluded
                  without those disappearing.
                </p>
              )}
            </>
          ) : (
            <p className="mt-1 text-sm text-amber-300">
              No books selected — pick at least one below and there’ll be something to roll.
            </p>
          )}
        </div>

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-400">
          Anything in particular? <span className="font-normal normal-case">(optional)</span>
        </label>
        <textarea
          value={wishText}
          onChange={e => setWishText(e.target.value)}
          disabled={!!busy}
          rows={2}
          placeholder="e.g. a level 6 grumpy dwarf cleric who owes someone money — or leave blank for a level 1 stranger"
          className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm
                     text-slate-200 placeholder:text-slate-500 focus:border-red-500 focus:outline-none"
        />

        {wishText.trim() && (
          <p className="mt-2 text-xs text-slate-400">
            Understood — {understood.length
              ? <span className="text-emerald-300">{understood.join(', ')}</span>
              : <span className="text-slate-400">no race or class named, so those stay random</span>}
            . The rest guides the backstory.
          </p>
        )}

        {wish.level && (
          <p className="mt-2 text-xs text-emerald-300">
            Building at level {wish.level} — hit points, subclass, spells known and ability score
            improvements all scale to it.
          </p>
        )}
        {wish.randomLevel && (
          <p className="mt-2 text-xs text-emerald-300">Rolling a random level, 1–20.</p>
        )}

        <p className="mt-3 text-xs text-slate-400">
          It lands on their sheet, where everything is still editable. Nothing you have already
          picked in this creator is kept.
        </p>
        {/* The "no books" case is already stated in the Rolling-from panel above, where it
            belongs — repeating it here just said the same thing twice. */}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={!!busy}>Cancel</Button>
          {pendingId ? (
            <Button onClick={() => { setOpen(false); navigate(`/character/${pendingId}`); }}>
              Open their sheet
            </Button>
          ) : (
            <Button onClick={() => void roll()} disabled={!!busy || books.length === 0}>
              {busy ?? 'Roll one up'}
            </Button>
          )}
        </div>
      </Dialog>
    </>
  );
}
