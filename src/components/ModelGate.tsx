import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { Button, Dialog } from './ui';
import { ModelConnectionSettings } from './ModelConnection';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * "You have no AI helper — add one?"
 *
 * Everything interesting in this app runs through a model: the DM's turns,
 * module import, campaign lore, session plans, battle maps, a generated
 * backstory. Without one connected, each of those used to fail in its own way
 * and its own wording, somewhere deep in a flow the user had already committed
 * to — a spinner, then an error naming a CLI they've never heard of.
 *
 * So the check happens BEFORE the work, once, in one place: `requireAi()`
 * returns false and raises this prompt, and "Connect one" drops the user
 * straight into the same settings panel the DM Console and the home page use.
 *
 * The dialog lives at app level (see `<ModelGate />` in App.tsx) rather than in
 * whichever page asked, because the asking page is often mid-flow and its own
 * dialog may be closing underneath.
 */

/**
 * Engines already confirmed ready, for the life of the process.
 *
 * `runTurn` calls the gate on EVERY turn, and the probe is not free: Codex
 * spawns `codex login status`, and Gemini's is a real model call costing about
 * five seconds — see `auth_probe_args`. Paying that per turn would put a
 * measurable pause into every exchange at a live table to re-answer a question
 * that had already been answered.
 *
 * Cached: every outcome that means PROCEED — confirmed-ready, and check-failed
 * (see the catch below). A definitive "not ready" is NOT cached, because that
 * one raises the prompt and the user is about to go fix it; re-checking after
 * they do is the whole point. Cleared whenever the connection panel closes, so
 * a fresh sign-in is noticed without waiting for a restart.
 */
const confirmed = new Set<string>();

type GateState = {
  /** Set while the "no AI helper" question is up. */
  asking: boolean;
  /** Set while the full connection panel is up — also how the home page's
   *  "Connect a Model" button opens it, so there is one dialog, not two. */
  connecting: boolean;
  /** What the user was trying to do, so the question can name it. */
  intent: string | null;
  ask: (intent: string) => void;
  openConnect: () => void;
  close: () => void;
};

export const useModelGate = create<GateState>((set) => ({
  asking: false,
  connecting: false,
  intent: null,
  ask: (intent) => set({ asking: true, intent }),
  openConnect: () => set({ asking: false, connecting: true }),
  close: () => {
    // Anyone who just had the panel open may have signed in, installed
    // something, or switched engines — none of which the cached answer knows
    // about. Forgetting it costs one probe and makes the cache self-healing;
    // keeping it would mean a fresh sign-in went unnoticed until restart.
    confirmed.clear();
    set({ asking: false, connecting: false, intent: null });
  },
}));

/**
 * Is there a usable AI helper right now?
 *
 * A local server counts as configured when it has both an address and a model —
 * we deliberately do NOT ping it here, because a local server that is merely
 * asleep is a different problem from never having connected anything, and this
 * gate is about the latter.
 */

export async function aiHelperReady(): Promise<boolean> {
  const { dmProvider, localLlmBaseUrl, localLlmModel } = useSettingsStore.getState();
  if (dmProvider === 'local') {
    return localLlmBaseUrl.trim().length > 0 && localLlmModel.trim().length > 0;
  }
  if (confirmed.has(dmProvider)) return true;
  try {
    const [installed, signedIn] = await invoke<[boolean, boolean]>('engine_auth_state', { engine: dmProvider });
    if (installed && signedIn) confirmed.add(dmProvider);
    return installed && signedIn;
  } catch {
    // The check itself failed, which is NOT proof there's no helper — see
    // EngineAccounts. Let the action proceed and fail with its own real error
    // rather than accusing the user of not having set something up.
    //
    // Cached like a success, because the decision is the same — proceed — and
    // an uncached one would re-probe on EVERY turn on exactly the machine whose
    // probe is already broken: the worst possible place to spend five seconds
    // and a Gemini generation over and over to reach the same answer.
    confirmed.add(dmProvider);
    return true;
  }
}

/**
 * Call this before anything that needs a model. `true` means go ahead; `false`
 * means the user has been asked and this action should quietly stop.
 *
 *   if (!(await requireAi('import a module'))) return;
 */
export async function requireAi(intent: string): Promise<boolean> {
  if (await aiHelperReady()) return true;
  useModelGate.getState().ask(intent);
  return false;
}

/** Rendered once, at app level. */
export function ModelGate() {
  const { asking, connecting, intent, openConnect, close } = useModelGate();
  const dmProvider = useSettingsStore((s) => s.dmProvider);

  return (
    <>
      <Dialog open={asking} onClose={close} title="No AI helper connected">
        <p className="text-sm text-slate-300">
          {intent ? <>Tavern Sheet needs an AI helper to {intent}.</> : <>Tavern Sheet needs an AI helper for this.</>}
        </p>
        <p className="text-xs text-slate-500 mt-2">
          It runs on a subscription you already have — Claude, ChatGPT or a Google account — or on a model you host
          yourself, which is free. Nothing is billed per message and there&rsquo;s no API key to paste.
        </p>
        {dmProvider !== 'local' && (
          <p className="text-xs text-slate-500 mt-2">
            Your selected engine is <span className="text-slate-300">{dmProvider}</span>, so it may just need signing in.
          </p>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={close}>Not now</Button>
          <Button onClick={openConnect}>Connect one</Button>
        </div>
      </Dialog>

      <Dialog open={connecting} onClose={close} title="Connect a Model">
        <p className="text-xs text-slate-400 mb-3">
          Global for this device — switchable any time, including mid-campaign. A local model needs its own reliability
          tradeoffs in mind: HP/condition changes are still applied automatically, but skipped or clamped entries show up
          as a warning under the transcript instead of silently vanishing.
        </p>
        <ModelConnectionSettings />
        <div className="flex justify-end mt-4">
          <Button onClick={close}>Done</Button>
        </div>
      </Dialog>
    </>
  );
}
