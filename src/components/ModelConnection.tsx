import React from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../store/useSettingsStore';
import { EngineAccounts } from './EngineAccounts';

/**
 * Everything needed to point the app at an AI: which engine runs live DM turns,
 * which one handles ingestion, whether a second one cross-checks it, and the
 * address/model of a locally hosted server.
 *
 * Lives here rather than inside DMConsolePage because it is reachable from two
 * places and must be the SAME control in both — the DM Console's "DM Model"
 * dialog and the home page's "Connect a Model". A second copy would drift the
 * moment either grew an option, which is exactly how the sidebar ended up with
 * its own resource counter.
 *
 * Every field is persisted app-wide in `useSettingsStore`, so this component
 * takes no props and no callbacks: wherever it is rendered, it is editing the
 * one shared setting. The Rust side is told about changes by DMConsolePage's
 * existing effect (`set_ingestion_engine`/`set_ingestion_provider`), which
 * watches the same store — so a change made from the home page is already in
 * the store by the time the console mounts.
 */
export function ModelConnectionSettings() {
  const {
    dmProvider, setDmProvider,
    localLlmBaseUrl, setLocalLlmBaseUrl,
    localLlmModel, setLocalLlmModel,
    localLlmHistoryTurns, setLocalLlmHistoryTurns,
    ingestionProvider, setIngestionProvider,
    crossCheckEnabled, setCrossCheckEnabled,
    crossCheckEngines, setCrossCheckEngines,
  } = useSettingsStore();

  const [localModels, setLocalModels] = React.useState<string[]>([]);
  const [localModelsLoading, setLocalModelsLoading] = React.useState(false);
  const [localModelsError, setLocalModelsError] = React.useState<string | null>(null);

  /** Queries local_llm.rs's /v1/models proxy for the model dropdown. Called on
   *  mount (this component only mounts when the dialog opens) and on Refresh,
   *  rather than on page load, so an idle app never pings a local server that
   *  may not even be running. */
  const refreshLocalModels = React.useCallback(async () => {
    setLocalModelsLoading(true);
    setLocalModelsError(null);
    try {
      setLocalModels(await invoke<string[]>('list_local_llm_models', { baseUrl: localLlmBaseUrl }));
    } catch (e) {
      setLocalModels([]);
      setLocalModelsError(String(e));
    } finally {
      setLocalModelsLoading(false);
    }
  }, [localLlmBaseUrl]);

  React.useEffect(() => {
    refreshLocalModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const usesLocal = dmProvider === 'local' || ingestionProvider === 'local';

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-slate-400 mb-1">Engine</label>
        <select
          value={dmProvider}
          onChange={(e) => setDmProvider(e.target.value as 'claude' | 'local' | 'codex' | 'gemini')}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-600"
        >
          <option value="claude">Claude (your Claude subscription)</option>
          <option value="codex">Codex (your ChatGPT subscription)</option>
          <option value="gemini">Gemini (your Google account)</option>
          <option value="local">Local LLM (Ollama / LM Studio / llama.cpp server…)</option>
        </select>
      </div>
      {/* Only the Claude path streams (dm.rs's run_claude_streaming); the others
          return the finished turn in one piece. That is a real downgrade at a
          live table — the pause before anyone hears anything is the whole turn
          instead of a first sentence — and it is invisible until you are
          mid-session wondering whether it has hung. */}
      {(dmProvider === 'codex' || dmProvider === 'gemini') && (
        <p className="text-xs text-amber-400/90">
          Heads up: {dmProvider === 'codex' ? 'Codex' : 'Gemini'} replies arrive all at once rather than
          streaming in as they&rsquo;re written, so there&rsquo;s a longer silence before the DM starts
          speaking. Claude is the only engine that streams.
        </p>
      )}
      {/* Sign-in lives right under the picker, because choosing an engine you
          haven't signed into is the moment you need it. */}
      <EngineAccounts />
      <div>
        <label className="block text-xs text-slate-400 mb-1">Ingestion &amp; memory</label>
        <select
          value={ingestionProvider}
          onChange={(e) => setIngestionProvider(e.target.value as 'claude' | 'local' | 'codex' | 'gemini')}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-600"
        >
          <option value="claude">Claude (best quality)</option>
          <option value="codex">Codex (your ChatGPT subscription)</option>
          <option value="gemini">Gemini (free tier available)</option>
          <option value="local">Local LLM (free, lower quality)</option>
        </select>
        <p className="text-xs text-slate-500 mt-1">
          Which engine handles module import, campaign lore, and the end-of-session memory digest — separate from the live-turn engine above. Local keeps these off your Claude budget, but a smaller model is less reliable on big imports; best for small one-shot content.
        </p>
      </div>
      {/* Cross-checking. Opt-in because it spends a second engine's quota on
          every checked operation — on a subscription, rate limits rather than
          money are the real constraint. */}
      <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={crossCheckEnabled}
            onChange={(e) => setCrossCheckEnabled(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <span className="text-sm text-slate-200">Check the DM&rsquo;s work with other engines</span>
            <span className="block text-[11px] text-slate-500 mt-0.5">
              A second model reviews what the first produced. It never overrules it &mdash; it flags where they
              disagree, which is what turns a quietly wrong answer into a visible one.
            </span>
          </span>
        </label>

        {crossCheckEnabled && (
          <div className="mt-3 pl-6 space-y-2">
            <p className="text-[11px] text-slate-400">
              Reviewers &mdash; the primary above ({dmProvider}) is excluded, since a model checking its own work
              shares its own blind spots.
            </p>
            <div className="flex flex-wrap gap-3">
              {(['claude', 'codex', 'gemini'] as const)
                .filter((id) => id !== dmProvider)
                .map((id) => (
                  <label key={id} className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={crossCheckEngines.includes(id)}
                      onChange={(e) =>
                        setCrossCheckEngines(
                          e.target.checked
                            ? [...crossCheckEngines.filter((x) => x !== id), id]
                            : crossCheckEngines.filter((x) => x !== id),
                        )
                      }
                    />
                    {id}
                  </label>
                ))}
            </div>
            {crossCheckEngines.filter((e) => e !== dmProvider).length === 0 && (
              <p className="text-[11px] text-amber-400">
                Pick at least one reviewer, or nothing gets checked.
              </p>
            )}
            <p className="text-[11px] text-slate-500">
              Applies to board reads (disagreeing squares get flagged) and to campaign lore and session plans,
              which already run a draft-then-critique pass &mdash; the critique just goes to a different model.
              Live DM narration is never cross-checked: it would double every turn&rsquo;s wait, and there is no
              right answer to vote on.
            </p>
          </div>
        )}
      </div>

      {usesLocal && (
        <>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Server address</label>
            <input
              value={localLlmBaseUrl}
              onChange={(e) => setLocalLlmBaseUrl(e.target.value)}
              placeholder="http://localhost:11434"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-red-600"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs text-slate-400">Model</label>
              <button
                type="button"
                onClick={refreshLocalModels}
                disabled={localModelsLoading}
                className="text-xs text-slate-400 hover:text-white disabled:opacity-50"
              >
                {localModelsLoading ? 'Checking…' : 'Refresh'}
              </button>
            </div>
            {localModels.length > 0 ? (
              <select
                value={localLlmModel}
                onChange={(e) => setLocalLlmModel(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-red-600"
              >
                {!localModels.includes(localLlmModel) && localLlmModel && (
                  <option value={localLlmModel}>{localLlmModel} (current)</option>
                )}
                {!localLlmModel && <option value="">Choose a model…</option>}
                {localModels.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                value={localLlmModel}
                onChange={(e) => setLocalLlmModel(e.target.value)}
                placeholder="e.g. llama3.2, qwen2.5"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-red-600"
              />
            )}
            {localModelsError && (
              <p className="text-xs text-amber-500 mt-1">
                Couldn't detect models from that server ({localModelsError}) — enter the model name manually.
              </p>
            )}
          </div>
        </>
      )}
      {dmProvider === 'local' && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">Conversation memory (turns)</label>
          <input
            type="number"
            min={0}
            value={localLlmHistoryTurns}
            onChange={(e) => setLocalLlmHistoryTurns(Math.max(0, Number(e.target.value) || 0))}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-red-600"
          />
          <p className="text-xs text-slate-500 mt-1">
            How many past turns get resent to the local model each time. Unlike Claude, a local model has no lightweight session token — it replays the whole conversation every turn, and most local models have a much smaller context window. Lower this if replies get slow, confused, or error out on a long session.
          </p>
        </div>
      )}
    </div>
  );
}
