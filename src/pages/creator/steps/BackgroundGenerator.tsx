import React from 'react';
import { requireAi } from '../../../components/ModelGate';
import { invoke } from '@tauri-apps/api/core';
import { Sparkles } from 'lucide-react';
import { Button, Dialog } from '../../../components/ui';
import type { BackgroundCustom } from '../../../types';

/**
 * Write a character's background from a handful of easy questions.
 *
 * The questions here are deliberately the SHALLOW ones — what campaign, what character, how you
 * like to play. The eight questions that actually make a backstory usable at a table ("name
 * someone who wants you ruined", "why did you leave THEN, not a year earlier") live in the
 * prompt, in background_gen.rs, and the model answers them itself from these answers. Asking a
 * player those cold is how you get "uh, I'm an orphan"; asking them what kind of character they
 * want is something anyone can answer in a sentence.
 *
 * Three states, because a first draft is rarely the one you keep: the form, the result, and back
 * to the form with every answer still in it. Nothing is written into the character until the
 * player presses Use this.
 */
export interface Brief {
  campaign: string;
  concept: string;
  playstyle: string;
  tone: string;
  wants: string;
  party: string;
}

const EMPTY: Brief = { campaign: '', concept: '', playstyle: '', tone: '', wants: '', party: '' };

const QUESTIONS: { key: keyof Brief; label: string; placeholder: string; rows?: number }[] = [
  { key: 'campaign', label: 'What campaign or setting are you playing?',
    placeholder: 'Curse of Strahd · a homebrew pirate game · no idea yet' },
  { key: 'concept', label: 'What kind of character do you want to be?',
    placeholder: 'A washed-up duellist who talks too much and owes money in three cities', rows: 2 },
  { key: 'playstyle', label: 'How do you like to play?',
    placeholder: 'Talking my way out of trouble, the odd stab in the dark' },
  { key: 'tone', label: 'What tone do you want their past to have?',
    placeholder: 'Bittersweet · grim · heroic · funny · mysterious' },
  { key: 'wants', label: 'Anything you definitely want — or definitely don’t?',
    placeholder: 'No dead-family origin, please. I’d like a rival I keep running into.', rows: 2 },
  { key: 'party', label: 'Know any of the other players’ characters? (optional)',
    placeholder: 'Mira, the cleric — we grew up together' },
];

/** The four one-liners and the backstory, plus the two things the creator's LAST page asks for.
 *  Name and alignment come back here because a player who let the machine write their whole
 *  history should not then be asked, three pages later, to invent a name for the person in it. */
type Generated = Pick<BackgroundCustom, 'personalityTraits' | 'ideals' | 'bonds' | 'flaws' | 'backstory'>
  & { name: string; alignment: string };

export function BackgroundGenerator({
  race, characterClass, background, onApply,
}: {
  race: string;
  characterClass: string;
  background: string;
  onApply: (g: Generated) => void;
}) {
  const [open, setOpen] = React.useState(false);
  // Kept OUTSIDE the dialog's open state so closing and reopening doesn't wipe six answers.
  const [brief, setBrief] = React.useState<Brief>(EMPTY);
  const [result, setResult] = React.useState<Generated | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Which mode produced what's on screen, so Regenerate repeats THAT rather than quietly
  // switching modes — pressing it after "Surprise me" should surprise you again, not start
  // feeding it answers you never gave.
  const [surprised, setSurprised] = React.useState(false);

  /** `override` is how "Surprise me" sends an empty brief WITHOUT clearing what the player may
   *  have already typed — they can hit it, dislike the result, and press Edit answers to find
   *  their own words still there. */
  async function generate(override?: Brief) {
    // Ask BEFORE the spinner. Without this the first thing a new user saw was a
    // wait, then an error naming a CLI they have never heard of.
    if (!(await requireAi('write a backstory'))) return;
    setBusy(true);
    setError(null);
    try {
      const g = await invoke<Generated>('generate_character_background', {
        brief: override ?? brief, race, class: characterClass, background,
      });
      setResult(g);
    } catch (e) {
      // The overwhelmingly likely cause is the CLI not being signed in, and the raw error says so
      // in its own words — so it is shown rather than replaced with something friendlier and less
      // actionable.
      setError(typeof e === 'string' ? e : (e as Error)?.message ?? 'Generation failed.');
    } finally {
      setBusy(false);
    }
  }

  const answered = Object.values(brief).some(v => v.trim());

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Sparkles size={14} className="mr-1.5" />
        Generate a background
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title="Generate a background" wide>
        {result ? (
          <div className="space-y-4">
            <div className="space-y-3">
              {/* Name and alignment lead, because they are the two the player has not seen the
                  creator ask for yet and the two most likely to be worth a Regenerate on their
                  own — a background you like under a name you don't is still a no. */}
              <div className="flex items-baseline justify-between gap-3 flex-wrap pb-2 border-b border-slate-700/60">
                <p className="text-lg font-bold text-white">{result.name || <span className="text-slate-500">(unnamed)</span>}</p>
                <p className="text-xs uppercase tracking-widest text-slate-400">{result.alignment}</p>
              </div>
              {([
                ['Personality Traits', result.personalityTraits],
                ['Ideal', result.ideals],
                ['Bond', result.bonds],
                ['Flaw', result.flaws],
              ] as const).map(([label, text]) => (
                <div key={label}>
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-400">{label}</p>
                  <p className="text-sm text-slate-200">{text || <span className="text-slate-500">—</span>}</p>
                </div>
              ))}
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Backstory</p>
                <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{result.backstory}</p>
              </div>
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-700">
              <Button variant="ghost" onClick={() => { setResult(null); setError(null); }} disabled={busy}>
                Edit answers
              </Button>
              <Button variant="outline" onClick={() => void generate(surprised ? EMPTY : undefined)} disabled={busy}>
                {busy ? 'Writing…' : 'Regenerate'}
              </Button>
              <Button
                onClick={() => { onApply(result); setOpen(false); }}
                disabled={busy}
              >
                Use this
              </Button>
            </div>
            <p className="text-[11px] text-slate-500">
              Using it fills the five fields on this page, plus the name and alignment the last page
              asks for — everything stays editable afterwards.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              Answer what you can and leave the rest blank. These are the easy questions; the hard
              ones — who wants you ruined, what you’d never tell the party, why you left when you
              did — get answered for you, out of these.
            </p>

            {QUESTIONS.map(q => (
              <div key={q.key}>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-400">{q.label}</label>
                <textarea
                  value={brief[q.key]}
                  onChange={e => setBrief({ ...brief, [q.key]: e.target.value })}
                  placeholder={q.placeholder}
                  rows={q.rows ?? 1}
                  className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-red-500 transition-colors resize-y"
                />
              </div>
            ))}

            {error && <p className="text-sm text-red-400">{error}</p>}

            <div className="flex justify-between gap-2 pt-2 border-t border-slate-700 flex-wrap">
              {/* Deliberately never disabled — it is the answer to "I don't know, just make me
                  someone", which is exactly the state an empty form means. */}
              <Button
                variant="ghost"
                onClick={() => { setSurprised(true); void generate(EMPTY); }}
                disabled={busy}
              >
                Surprise me
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
                <Button onClick={() => { setSurprised(false); void generate(); }} disabled={busy || !answered}>
                  {busy ? 'Writing…' : 'Generate'}
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              {answered
                ? 'Generate uses your answers. Surprise me ignores them and invents the whole character.'
                : 'Answer at least one question — or press Surprise me and let it invent everything.'}
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
