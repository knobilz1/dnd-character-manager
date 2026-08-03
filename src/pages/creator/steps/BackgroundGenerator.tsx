import React from 'react';
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

/** The four one-liners plus the backstory, exactly as the creator stores them. */
type Generated = Pick<BackgroundCustom, 'personalityTraits' | 'ideals' | 'bonds' | 'flaws' | 'backstory'>;

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

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const g = await invoke<Generated>('generate_character_background', {
        brief, race, class: characterClass, background,
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
              <Button variant="outline" onClick={() => void generate()} disabled={busy}>
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
              Using it fills the five fields on this page — everything stays editable afterwards.
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

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-700">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void generate()} disabled={busy || !answered}>
                {busy ? 'Writing…' : 'Generate'}
              </Button>
            </div>
            {!answered && (
              <p className="text-[11px] text-slate-500">Answer at least one question to generate.</p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
