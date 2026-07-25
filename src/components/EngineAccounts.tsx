import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Check, Download, LogIn, RefreshCw } from 'lucide-react';
import { Button, Dialog } from './ui';

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
 * Sign-in involves NO terminal. The CLI runs windowless with piped stdio, the
 * app reads the OAuth URL out of its output and opens the browser, and when the
 * vendor falls back to "paste the authorization code" that code goes into a text
 * field here and straight down the CLI's stdin. It is passed through, never
 * stored. Auth is then re-checked rather than trusting an exit code — a
 * cancelled flow exits cleanly too.
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
    plan: 'Google account',
    // Deliberately says "Gemini", not "Antigravity". Gemini is the MODEL doing
    // the work; Antigravity is just the CLI client Google replaced it with in
    // June 2026. Naming the client would only confuse someone choosing an LLM.
    blurb: 'Signs in through Google Antigravity, which runs Gemini models. Closes itself when done.',
  },
];

export function EngineAccounts() {
  const [state, setState] = React.useState<Partial<Record<EngineId, State>>>({});
  const [busy, setBusy] = React.useState<EngineId | null>(null);
  const [step, setStep] = React.useState<string>('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  /** Set while an engine is waiting for the authorization code its browser
   *  handed the user. This is the whole reason no terminal is involved. */
  const [codeFor, setCodeFor] = React.useState<EngineId | null>(null);
  const [loginUrl, setLoginUrl] = React.useState('');
  const [code, setCode] = React.useState('');
  const [pasteOpen, setPasteOpen] = React.useState<EngineId | null>(null);

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
   *  them come back and click a second button" flow the Claude path uses.
   *
   *  No console anywhere. The CLI runs windowless with piped stdio, the app
   *  reads the OAuth URL out of its output and shows it here, and the code the
   *  browser hands back is pasted into a normal text field. Every console-based
   *  attempt at this failed differently — no window at all, then a window that
   *  hung with nowhere to draw — and none of them ever gave the user somewhere
   *  to actually put the code. */
  async function connect(id: EngineId, needsInstall: boolean) {
    setBusy(id);
    setError(null);
    setCodeFor(null);
    setCode('');
    try {
      if (needsInstall) {
        setStep('Installing…');
        await invoke('install_engine_cli', { engine: id });
      }
      setStep('Opening your browser…');
      const url = await invoke<string | null>('begin_engine_login', { engine: id });
      if (url) {
        setLoginUrl(url);
        // Sign in INSIDE the app. The vendor's callback page strips the
        // authorization code out of the address bar the instant it loads, so a
        // system browser can only ever show it to the user to copy. Our own
        // window sees the raw redirect first and lifts the code out itself.
        await invoke('login_in_app', { engine: id, url });
        // Show the paste box IMMEDIATELY, not after a timeout. Antigravity's
        // callback page shows the user a code in practice, every time — the
        // loopback relay evidently doesn't survive a real browser hop here. So
        // the manual route is the RELIABLE one and must be visible from the
        // start; the automatic capture below simply beats them to it when it
        // works, and clears the box on its own.
        setCodeFor(id);
        setStep('Waiting for you to approve it…');
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => { setTimeout(r, 2000); });
          // Either the window caught the code for us...
          const caught = await invoke<string | null>('take_captured_login_code');
          if (caught) {
            setStep('Finishing sign-in…');
            const ok = await invoke<boolean>('submit_login_code', { engine: id, code: caught });
            await refresh();
            if (!ok) setError('Google accepted the sign-in but the CLI rejected the code. Try once more.');
            return;
          }
          // ...or the CLI's own loopback listener got there first.
          const [, signedIn] = await invoke<[boolean, boolean]>('engine_auth_state', { engine: id });
          if (signedIn) {
            await refresh();
            return;
          }
        }
        // Only now, 90s in, do we fall back to asking for the code by hand —
        // for the case where the relay is blocked and the browser just shows it.
        setCodeFor(id);
        setStep('');
        return;
      }
      // Some engines finish on the browser callback alone and never ask.
      await refresh();
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

  async function submitCode(id: EngineId, codeOverride?: string) {
    setBusy(id);
    setError(null);
    setStep('Finishing sign-in…');
    try {
      const ok = await invoke<boolean>('submit_login_code', { engine: id, code: codeOverride ?? code });
      await refresh();
      setCodeFor(null);
      setCode('');
      if (!ok) setError("That code wasn't accepted. Start the sign-in again for a fresh one — they expire quickly.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setStep('');
    }
  }

  /** Open the paste dialog and make sure a sign-in is actually waiting for the
   *  code. The code is bound by PKCE to the CLI run that produced the URL, so a
   *  code pasted with nothing waiting cannot work — starting one here is what
   *  makes this dialog usable on its own, from a cold start. */
  async function openPasteDialog(id: EngineId) {
    setPasteOpen(id);
    setError(null);
    setCode('');
    if (!loginUrl) {
      try {
        const url = await invoke<string | null>('begin_engine_login', { engine: id });
        if (url) setLoginUrl(url);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
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
                {codeFor === e.id && (
                  <div className="mt-2 space-y-1.5">
                    <p className="text-[11px] text-slate-400">
                      Approve it in the sign-in window. If you end up on a page showing a code, paste that code
                      here — otherwise this finishes on its own.{' '}
                      <button onClick={() => void openUrl(loginUrl)} className="text-emerald-400 underline">
                        Reopen the sign-in page
                      </button>
                    </p>
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        value={code}
                        onChange={(ev) => setCode(ev.target.value)}
                        onKeyDown={(ev) => { if (ev.key === 'Enter' && code.trim()) void submitCode(e.id); }}
                        placeholder="Paste the authorization code"
                        className="flex-1 min-w-0 px-2 py-1 rounded bg-slate-950 border border-slate-700 text-xs text-slate-200"
                      />
                      <Button size="sm" disabled={!code.trim() || !!busy} onClick={() => void submitCode(e.id)}>
                        Done
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              {s?.installed && !s.signedIn && (
                <button
                  onClick={() => void openPasteDialog(e.id)}
                  className="text-[11px] text-slate-400 hover:text-emerald-400 underline whitespace-nowrap self-center"
                  title="Sign in by pasting the code the browser gives you"
                >
                  Paste a code
                </button>
              )}
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

      {/* The manual route, always one click away from any signed-out row.
          Automatic capture is nicer when it works, but a sign-in that can only
          be completed by a mechanism the user can't see or retry is worse than
          one honest text box. */}
      <Dialog open={!!pasteOpen} onClose={() => setPasteOpen(null)} title="Sign in with a code">
        <div className="space-y-3">
          <ol className="text-xs text-slate-400 space-y-1.5 list-decimal list-inside">
            <li>
              Open the sign-in page and approve it.{' '}
              {loginUrl ? (
                <button onClick={() => void openUrl(loginUrl)} className="text-emerald-400 underline">
                  Open sign-in page
                </button>
              ) : (
                <span className="text-slate-500">preparing…</span>
              )}
            </li>
            <li>Google shows you a code. Hit <span className="text-slate-300">Copy to Clipboard</span> on that page.</li>
            <li>Paste it below and press Sign in.</li>
          </ol>

          <textarea
            autoFocus
            value={code}
            onChange={(ev) => setCode(ev.target.value)}
            rows={3}
            placeholder="Paste the code here (starts with 4/)"
            className="w-full px-2 py-2 rounded bg-slate-950 border border-slate-700 text-xs text-slate-200 font-mono break-all"
          />

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!code.trim() || !!busy}
              onClick={async () => {
                const id = pasteOpen!;
                // Whitespace is expected, not exceptional: the page wraps the
                // code across two lines, so copying it often brings a newline.
                const cleaned = code.replace(/\s+/g, '');
                setCode(cleaned);
                await submitCode(id, cleaned);
                if (!error) setPasteOpen(null);
              }}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
            <span className="text-[11px] text-slate-500">
              {code.trim() ? `${code.replace(/\s+/g, '').length} characters` : 'Codes expire fast — grab a fresh one if this fails.'}
            </span>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
      </Dialog>

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      <p className="text-[11px] text-slate-600 mt-2">
        Signing in opens a terminal window with that vendor's own login page. Tavern Sheet never sees your password or
        any token — it just waits for the window to close, then re-checks.
      </p>
    </div>
  );
}
