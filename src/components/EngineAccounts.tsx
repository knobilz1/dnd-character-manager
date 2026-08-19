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
 * Claude and Codex sign in with NO terminal: the CLI runs windowless with
 * piped stdio, the app reads the OAuth URL out of its output and opens the
 * browser, and a pasted code goes straight down the CLI's stdin — passed
 * through, never stored. Gemini is the deliberate exception: agy gets a real
 * console window running its own patient interactive flow, and the app
 * watches the OS credential store for the sign-in to land. Every in-app
 * Gemini route died the same death — agy's --print sign-in is a countdown
 * from ITS spawn that reached real users as ~7 usable seconds. Auth is then
 * re-checked rather than trusting an exit code — a cancelled flow exits
 * cleanly too.
 */

type EngineId = 'claude' | 'codex' | 'gemini';
/** `error` is set when the CHECK itself failed — which is not the same as the
 *  engine being missing, and must never be rendered as "not installed". */
type State = { installed: boolean; signedIn: boolean; error?: string };

const ENGINES: Array<{ id: EngineId; name: string; plan: string; blurb: string; consoleLogin?: boolean }> = [
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
    blurb: "Uses your Google account. Sign-in opens Google's page in your browser.",
    // consoleLogin is LOAD-BEARING and its removal is banned. The paste-code
    // route (v0.31.5–0.31.7) rode agy's --print sign-in, whose auth window
    // counts down from agy's SPAWN — it reached real users as ~5–7 usable
    // seconds, which no human beats, and agy self-updates so no measured
    // window number stays true. The console window runs agy's own interactive
    // flow, which waits patiently — the flow that worked all July. The row
    // turns green by watching the OS credential store (gemini_cred_present),
    // never by probing agy on a timer: a signed-out agy spawn opens Google's
    // sign-in page in the browser all by itself.
    consoleLogin: true,
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
  const [consoleFor, setConsoleFor] = React.useState<EngineId | null>(null);

  /** Each row lands as its own answer arrives — never gathered behind a
   *  Promise.all. The all-at-once version held EVERY row's buttons hostage to
   *  the slowest check, which on one real machine was agy blocking toward its
   *  60-second auth window: the panel sat with no Sign in buttons at all,
   *  which read as the whole feature having vanished.
   *
   *  `deep` reaches the backend as-is: mounts pass false, so checking status
   *  can never itself spawn a model call (that spawn is also what popped
   *  Google's sign-in page unasked). The ↻ button passes true — an explicit
   *  click may spend a real probe to turn a signed-in Gemini's row green. */
  const refresh = React.useCallback(async (deep = false) => {
    setLoading(true);
    await Promise.all(
      ENGINES.map(async (e) => {
        try {
          const [installed, signedIn] = await invoke<[boolean, boolean]>('engine_auth_state', { engine: e.id, deep });
          setState((prev) => ({ ...prev, [e.id]: { installed, signedIn } }));
        } catch (err) {
          // NOT the same thing as "not installed", and saying so cost a user an
          // evening: Claude was installed, on PATH, and working in a terminal
          // while this panel insisted it was missing. `engine_auth_state`
          // hardcodes installed=true for Claude, so reaching here at all means
          // the CHECK failed — the app has no idea whether it's installed, and
          // the honest answer is to say the check failed and show why.
          setState((prev) => ({ ...prev, [e.id]: { installed: false, signedIn: false, error: String(err) } }));
        }
      }),
    );
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
      // Freshly installed: go straight on to sign-in, by whichever route that
      // engine uses. Sending Gemini to the paste dialog would strand a brand
      // new user — its code prompt can only be answered in the console window,
      // so the dialog would sit there with nothing able to complete it.
      await refresh();
      const engine = ENGINES.find((x) => x.id === id);
      if (engine?.consoleLogin) await consoleSignIn(id);
      else await openPasteDialog(id, false);
      return;

    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Only Codex can still land here: it installs exclusively through npm.
      // Claude uses its own standalone installer (no Node), and Gemini ships
      // its own script — sending anyone else to nodejs.org was the app
      // exporting its plumbing as the user's problem.
      setError(
        msg.includes('NODE_NOT_INSTALLED')
          ? 'Codex installs through npm, which needs Node.js — install it from nodejs.org, then try again. (Claude and Gemini don’t need Node.)'
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
      if (ok) {
        // This function owns the dialog's fate. The caller used to close it
        // with `if (!error) setPasteOpen(null)` — a STALE closure where error
        // is null from render time — so the dialog closed on failure too,
        // clobbering the fresh sign-in the expiry handler had just opened.
        setPasteOpen(null);
      } else {
        setError("That code wasn't accepted. Start the sign-in again for a fresh one — they expire quickly.");
      }
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
  /** Launch the vendor's own sign-in window and watch for it to succeed.
   *
   *  Used where no in-app route exists (see launch_engine_login_console for the
   *  four that were tried and why each is closed). The console is the only part
   *  the user touches; the app opens it, says exactly what to do in it, and
   *  notices completion on its own so nobody has to come back and press ↻. */
  async function consoleSignIn(id: EngineId) {
    setBusy(id);
    setError(null);
    setConsoleFor(id);
    try {
      await invoke('launch_engine_login_console', { engine: id });
      setStep('Sign-in window opened — follow the steps, this updates itself.');
      for (let i = 0; i < 150; i++) {   // ~5 minutes, unhurried on purpose
        await new Promise((r) => { setTimeout(r, 2000); });
        // Watch the OS credential store, not agy. Probing a signed-out agy on
        // a timer spawns processes that each open Google's sign-in page in
        // the browser BY THEMSELVES — that was the "opening settings launches
        // Google" bug. The credential appearing is the sign the user finished;
        // only then is one real probe spent turning the row green, and by then
        // it's quiet because agy IS signed in. If the cheap check can't run on
        // this platform, fall back to one real probe every ~30s, not never.
        const present = await invoke<boolean>('gemini_cred_present').catch(() => i % 15 === 14);
        if (!present) continue;
        const [, signedIn] = await invoke<[boolean, boolean]>('engine_auth_state', { engine: id, deep: true });
        if (signedIn) {
          await refresh();
          setConsoleFor(null);
          return;
        }
      }
      setError("Still not signed in. Close that window and press Sign in to try again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setStep('');
    }
  }

  async function openPasteDialog(id: EngineId, allowInstall = true) {
    setPasteOpen(id);
    setError(null);
    setCode('');
    setLoginUrl('');
    // ALWAYS start a fresh sign-in. Never reuse a URL from an earlier attempt.
    //
    // The authorization code is PKCE-bound to the exact CLI run that produced
    // its URL. Reusing a stale URL — or letting the Sign in button's own attempt
    // race this one, since starting a login kills the previous — means the user
    // approves against one challenge and the code is handed to a process holding
    // a different one. It is then correctly rejected, which looks from outside
    // like a sign-in that just sits there and eventually fails for no reason.
    try {
      const url = await invoke<string | null>('begin_engine_login', { engine: id });
      if (url) {
        setLoginUrl(url);
        // Straight to the browser — authorization codes expire, so don't
        // spend their lifetime waiting for a second click.
        try { await openUrl(url); } catch { /* the button below still works */ }
      } else {
        setError("Couldn't start the sign-in — no URL came back. Try again.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // The CLI isn't there, and the dialog was already open promising a code
      // that can never come — the stuck "preparing…" screen. Do what the error
      // text promises: install it, then reopen this dialog. `allowInstall`
      // stops a second failure from looping back into another install; that
      // one shows the detailed searched-these-directories message instead.
      if (allowInstall && msg.includes('CLAUDE_NOT_INSTALLED')) {
        setPasteOpen(null);
        await connect(id, true);
        return;
      }
      setError(msg);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-xs text-slate-400">Accounts</label>
        <button
          onClick={() => void refresh(true)}
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
                  {s?.error
                    ? <span className="text-[11px] text-rose-400">couldn&rsquo;t check</span>
                    : s && !s.installed && <span className="text-[11px] text-slate-500">not installed</span>}
                  {s?.installed && !s.signedIn && <span className="text-[11px] text-amber-400">not signed in</span>}
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5">{e.plan} — {e.blurb}</p>
                {thisBusy && step && <p className="text-[11px] text-slate-400 mt-1">{step}</p>}
                {consoleFor === e.id && (
                  <ol className="mt-2 text-[11px] text-slate-400 space-y-1 list-decimal list-inside bg-slate-950/60 rounded p-2">
                    <li>A black window opened — it shows a long link.</li>
                    <li><span className="text-slate-300">Ctrl+click</span> the link (or copy it into your browser) and approve with Google.</li>
                    <li>Google shows a code — press <span className="text-slate-300">Copy to Clipboard</span>.</li>
                    <li>Click the black window, <span className="text-slate-300">right-click</span> to paste, press Enter.</li>
                    <li>Done — this row turns green on its own. You can close the window.</li>
                  </ol>
                )}
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
              {s && !s.signedIn && (
                <Button
                  size="sm"
                  variant={s.installed ? 'primary' : 'outline'}
                  disabled={!!busy}
                  onClick={() => void (!s.installed
                    ? connect(e.id, true)
                    : e.consoleLogin
                      ? consoleSignIn(e.id)
                      : openPasteDialog(e.id))}
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
              Your browser should have opened — approve it there.{' '}
              {loginUrl ? (
                <button onClick={() => void openUrl(loginUrl)} className="text-emerald-400 underline">
                  Open sign-in page
                </button>
              ) : (
                <span className="text-slate-500">preparing…</span>
              )}
            </li>
            <li>The sign-in page shows you a code — copy it.</li>
            <li>Come back here and paste it below.</li>
          </ol>

          <textarea
            autoFocus
            value={code}
            onChange={(ev) => setCode(ev.target.value)}
            onPaste={(ev) => {
              // Replace, never append. The auto-filled box plus a manual
              // Ctrl+V produced the same code twice back to back — 146
              // characters that no engine would ever accept.
              ev.preventDefault();
              setCode(ev.clipboardData.getData('text').replace(/\s+/g, ''));
            }}
            rows={3}
            placeholder="Paste the code here"
            className="w-full px-2 py-2 rounded bg-slate-950 border border-slate-700 text-xs text-slate-200 font-mono break-all"
          />

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() => void openPasteDialog(pasteOpen!)}
            >
              Start over
            </Button>
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
              }}
            >
              {busy ? 'Checking…' : 'Sign in'}
            </Button>
            <span className="text-[11px] text-slate-500">
              {busy
                ? 'Finishing sign-in…'
                : code.trim()
                  ? `${code.replace(/\s+/g, '').length} characters — press Sign in`
                  : 'Approve in the browser, then paste the code it gives you.'}
            </span>
          </div>
          {error && (
            <pre className="text-[11px] text-red-400 whitespace-pre-wrap break-words bg-slate-950/60 rounded p-2 max-h-40 overflow-auto">
              {error}
            </pre>
          )}
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
