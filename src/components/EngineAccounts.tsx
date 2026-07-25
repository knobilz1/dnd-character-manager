import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, Download, LogIn, RefreshCw } from 'lucide-react';
import { Button } from './ui';

/**
 * EngineAccounts — sign in to each DM engine from inside the app.
 *
 * Every engine here runs on a SUBSCRIPTION you already pay for, via that
 * vendor's own CLI: Claude Code against Claude Pro/Max, Codex against ChatGPT
 * Plus/Pro, Gemini against a Google account. There is deliberately no API-key
 * field anywhere in this panel — a key box would make people think they're about
 * to be billed per token, which is the exact opposite of why this exists.
 *
 * Each row shows ONE state and ONE next action, because that's the whole job:
 *   not installed     -> Install   (runs npm for you, then goes straight to sign-in)
 *   installed, no auth-> Sign in   (opens the vendor's own browser flow)
 *   signed in         -> a quiet tick, nothing to do
 *
 * Sign-in opens a real console window running the vendor's login command and
 * blocks until it closes; the app never sees or handles a credential. See
 * dm.rs's connect_engine, which re-checks auth afterwards rather than trusting
 * the exit code — closing the window is also a "successful" exit.
 */

type EngineId = 'claude' | 'codex' | 'gemini';
type State = { installed: boolean; signedIn: boolean };

const ENGINES: Array<{ id: EngineId; name: string; plan: string; blurb: string }> = [
  {
    id: 'claude',
    name: 'Claude Code',
    plan: 'Claude Pro or Max',
    blurb: 'The default. Best quality on long campaign context.',
  },
  {
    id: 'codex',
    name: 'Codex',
    plan: 'ChatGPT Plus, Pro or Team',
    blurb: "Uses your ChatGPT plan. Sign-in opens OpenAI's page in your browser.",
  },
  {
    id: 'gemini',
    name: 'Gemini',
    plan: 'Google account (free tier, or AI Pro/Ultra)',
    blurb: 'Has a free tier, so it costs nothing to try — tightest rate limits.',
  },
];

export function EngineAccounts() {
  const [state, setState] = React.useState<Partial<Record<EngineId, State>>>({});
  const [busy, setBusy] = React.useState<EngineId | null>(null);
  const [step, setStep] = React.useState<string>('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    const next: Partial<Record<EngineId, State>> = {};
    await Promise.all(
      ENGINES.map(async (e) => {
        try {
          const [installed, signedIn] = await invoke<[boolean, boolean]>('engine_auth_state', { engine: e.id });
          next[e.id] = { installed, signedIn };
        } catch {
          // A probe that can't even run means "not installed" for display
          // purposes; the row's Install action is still the right next step.
          next[e.id] = { installed: false, signedIn: false };
        }
      }),
    );
    setState(next);
    setLoading(false);
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  /** Install (if needed) then sign in, as one motion — the same "don't make
   *  them come back and click a second button" flow the Claude path uses. */
  async function connect(id: EngineId, needsInstall: boolean) {
    setBusy(id);
    setError(null);
    try {
      if (needsInstall) {
        setStep('Installing…');
        await invoke('install_engine_cli', { engine: id });
      }
      setStep('Waiting for sign-in — finish in the window that opened…');
      const ok = await invoke<boolean>('connect_engine', { engine: id });
      await refresh();
      if (!ok) setError("That didn't complete — the sign-in window closed before finishing. Try again.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // The one thing the app genuinely can't fix for the user.
      setError(
        msg.includes('NODE_NOT_INSTALLED')
          ? "Node.js isn't installed, which these CLIs need. Install it from nodejs.org, then try again."
          : msg,
      );
    } finally {
      setBusy(null);
      setStep('');
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs text-slate-400">Accounts</label>
        <button
          onClick={() => { setLoading(true); void refresh(); }}
          className="text-slate-500 hover:text-slate-300"
          title="Re-check which engines are installed and signed in"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <p className="text-xs text-slate-500 mb-2">
        Each engine uses a subscription you already have — there's no API key and nothing is billed per message.
      </p>

      <div className="space-y-1.5">
        {ENGINES.map((e) => {
          const s = state[e.id];
          const thisBusy = busy === e.id;
          return (
            <div key={e.id} className="flex items-start gap-3 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-200">{e.name}</span>
                  {s?.signedIn && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                      <Check size={11} /> signed in
                    </span>
                  )}
                  {s && !s.installed && <span className="text-[11px] text-slate-500">not installed</span>}
                  {s?.installed && !s.signedIn && <span className="text-[11px] text-amber-400">not signed in</span>}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">{e.plan} — {e.blurb}</p>
                {thisBusy && step && <p className="text-[11px] text-slate-400 mt-1">{step}</p>}
              </div>
              {s && !s.signedIn && (
                <Button
                  size="sm"
                  variant={s.installed ? 'primary' : 'outline'}
                  disabled={!!busy}
                  onClick={() => void connect(e.id, !s.installed)}
                  title={s.installed ? `Sign in with your ${e.plan.split(',')[0]}` : `Install the ${e.name} CLI, then sign in`}
                >
                  {thisBusy ? '…' : s.installed ? (<><LogIn size={12} /> Sign in</>) : (<><Download size={12} /> Install</>)}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      <p className="text-[11px] text-slate-600 mt-2">
        Signing in opens a terminal window with that vendor's own login page. Tavern Sheet never sees your password or
        any token — it just waits for the window to close, then re-checks.
      </p>
    </div>
  );
}
