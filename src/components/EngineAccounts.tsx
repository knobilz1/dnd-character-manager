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
    // NO consoleLogin: Gemini uses the same paste-a-code dialog as everyone
    // else. It didn't always — agy reads the code from a real TERMINAL and
    // ignores piped stdin (measured 2026-07-24), so this row used to launch a
    // black console window instead. The answer to that measurement was built in
    // dm.rs (`begin_login_via_pty`: a pseudo-console, agy's ESC[6n query
    // answered, the code typed as `code\r`), and `begin_engine_login` has
    // routed Gemini through it ever since — but this flag kept sending users
    // to the console window anyway, where the flow kept breaking. The paste
    // dialog is also the UI that fits agy's hard 60-second window: browser
    // opened the moment the URL exists, clipboard watched, code auto-submitted
    // (Google's codes are exactly the `4/…` shape the watcher matches).
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
  /** Seconds left in the CLI's own auth window. agy waits 60s and then EXITS,
   *  taking its terminal with it — a code pasted after that fails with "the
   *  pipe is being closed", which is a dead process, not a broken pipe. */
  const [secondsLeft, setSecondsLeft] = React.useState(0);
  const pasteOpenRef = React.useRef<EngineId | null>(null);
  pasteOpenRef.current = pasteOpen;
  /** Amber, not red: "the window expired and a fresh one is already open" is
   *  the flow working, and painting it as an error taught the user to give up. */
  const [notice, setNotice] = React.useState<string | null>(null);
  /** agy's auth window is 60 seconds from ITS spawn — which is when this dialog
   *  opens, not when the user reaches the browser. A first-time Google consent
   *  (account picker, permissions page) routinely outlives it, and a code from
   *  an expired run is PKCE-dead: nothing pasted after that point can ever
   *  work. So expiry triggers an automatic fresh start — new run, new URL,
   *  browser reopened — and Google's second pass is warm, so the code page
   *  appears in seconds. Budgeted, so a walked-away-from dialog doesn't spawn
   *  agy forever. */
  const autoRestarts = React.useRef(0);

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

  React.useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = setTimeout(() => setSecondsLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft]);

  // The moment the window lapses, the old run's code can never be redeemed —
  // restart while the user is still mid-consent so the page they land on next
  // is one whose code still works.
  React.useEffect(() => {
    if (secondsLeft !== 0 || !pasteOpen || busy) return;
    // secondsLeft BEGINS at 0 — only a run whose URL arrived (which sets the
    // 60s clock) can expire. Without this, the dialog restarted itself the
    // moment it opened, before the first sign-in had even produced a URL.
    if (!loginUrl) return;
    if (code.trim()) return; // a code is in flight or typed; submit decides
    if (autoRestarts.current >= 4) {
      setNotice('That sign-in window expired. Press Start over when you\u2019re ready \u2014 the browser will reopen.');
      return;
    }
    autoRestarts.current += 1;
    setNotice('That window expired \u2014 opened a fresh sign-in page. Use the NEWEST page\u2019s code; older ones can\u2019t work.');
    void openPasteDialog(pasteOpen, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, pasteOpen, busy, code, loginUrl]);

  /** Watch the clipboard while a sign-in is waiting, and fill the box the moment
   *  the user hits "Copy to Clipboard" on Google's page.
   *
   *  Worth the oddity because the window is only 60 SECONDS and every removed
   *  step is a real chunk of it: without this the user copies, switches back,
   *  clicks the field, pastes, then clicks Sign in. Matches only the Google
   *  authorization-code shape, so nothing else on the clipboard is ever read
   *  into the app, and it only runs while this dialog is open. */
  React.useEffect(() => {
    if (!pasteOpen || secondsLeft <= 0 || code.trim()) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (/^4\/[A-Za-z0-9_\-.]{20,}$/.test(text.replace(/\s+/g, ''))) {
          const clean = text.replace(/\s+/g, '');
          setCode(clean);
          // Submit immediately rather than waiting for a click. The CLI's
          // window is 60s from when it started, and by the time a code is on
          // the clipboard most of that is gone — a click is not free.
          void submitCode(pasteOpen, clean);
          return;
        }
      } catch { /* no clipboard permission — the paste box still works */ }
      if (!stop) setTimeout(() => void tick(), 700);
    };
    void tick();
    return () => { stop = true; };
  }, [pasteOpen, secondsLeft, code]);

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
        setNotice(null);
      } else {
        setError("That code wasn't accepted. Start the sign-in again for a fresh one — they expire quickly.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // "The pipe is being closed" is agy having timed out UNDER the user's
      // code — their consent simply took longer than the window. Not their
      // fault, and not a dead end: start fresh, reopen the browser, and their
      // warm Google session hands over the next code in seconds.
      if (/already ended|pipe is being closed/i.test(msg) && autoRestarts.current < 4 && pasteOpenRef.current) {
        autoRestarts.current += 1;
        setNotice('That code\u2019s window had already expired \u2014 opened a fresh page. Copy the NEW code it shows.');
        setBusy(null);
        setStep('');
        void openPasteDialog(pasteOpenRef.current, false);
        return;
      }
      setError(msg);
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
    if (allowInstall) {
      // A person pressing Sign in / Start over resets the restart budget; the
      // automatic path passes allowInstall=false and keeps spending its own.
      autoRestarts.current = 0;
      setNotice(null);
    }
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
        setSecondsLeft(60);
        // Straight to the browser. The CLI's 60s window starts when IT starts,
        // not when the user finishes reading, so waiting for a second click
        // spent most of the budget before the flow even began.
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
            <li>That's it — come back here and it signs itself in.</li>
          </ol>

          {notice && <p className="text-xs text-amber-400">{notice}</p>}
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
                let cleaned = code.replace(/\s+/g, '');
                // Collapse an accidentally doubled code to its first copy.
                const second = cleaned.indexOf('4/', 2);
                if (cleaned.startsWith('4/') && second > 0) cleaned = cleaned.slice(0, second);
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
                  : 'Approve in the browser, then press Copy on Google\'s page — be quick, the sign-in expires after about a minute.'}
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
