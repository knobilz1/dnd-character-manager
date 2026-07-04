import React from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { ArrowLeft, Mic, Square, Radio, Trash2, BookOpen, ScrollText, FileUp, Plus, Upload } from 'lucide-react';
import { Button, Card, Badge, Dialog } from '../../components/ui';
import { usePartyStore } from '../../store/usePartyStore';
import { useCampaignStore } from '../../store/useCampaignStore';
import { buildTurnPrompt, buildRecapPrompt } from '../../utils/dmPrompt';
import { parseDmReply, applyDmActions } from '../../utils/dmActions';
import { startRecording, stopAndTranscribe, warmupSTT, speak, stopSpeaking } from '../../utils/dmSpeech';
import type { Character } from '../../types';

const DM_PORT = 7777;

/** How often (in turns) the campaign-arc plan gets re-included in the turn
 *  prompt when nothing else has already triggered a check-in. See dmPrompt.ts
 *  and campaign.rs for why this isn't just always-on via CLAUDE.md. */
const PLAN_CHECK_INTERVAL = 8;

interface Turn {
  /** 'dm' for narration, 'you' for the DM Console's own mic, or a player's
   *  character name when the line arrived remotely via dm-player-turn. */
  who: string;
  text: string;
}

interface PlayerTurn {
  name: string;
  text: string;
}

interface CampaignMeta {
  id: string;
  name: string;
}

interface CampaignIntake {
  name: string;
  edition: string;
  players: string;
  module: string;
  notes: string;
}

const BLANK_INTAKE: CampaignIntake = { name: '', edition: '2014', players: '', module: '', notes: '' };

interface ChapterSummary {
  id: string;
  title: string;
  summary: string;
}

/** Opens the OS file picker filtered to module documents and returns the
 *  extracted text (Rust does PDF text-extraction or plain UTF-8 read — see
 *  campaign.rs's extract_module_text) plus the picked filename, or null if
 *  the user cancelled. */
async function pickAndExtractModuleFile(): Promise<{ name: string; text: string } | null> {
  const path = await open({
    multiple: false,
    filters: [{ name: 'Module document', extensions: ['pdf', 'md', 'txt'] }],
  });
  if (!path || typeof path !== 'string') return null;
  const text = await invoke<string>('extract_module_text', { path });
  const name = path.split(/[\\/]/).pop() ?? path;
  return { name, text };
}

/**
 * DMConsolePage — the in-app spoken-word Dungeon Master.
 *
 * Each campaign is its own local Claude Code project (see campaign.rs): a
 * folder with a CLAUDE.md (persona + house rules + world lore) and a
 * memory/MEMORY.md that accumulates a session recap plus any standalone facts
 * the DM flags as worth remembering (dm-actions `remember`). ask_dm runs
 * `claude` with that folder as its working directory, so CLAUDE.md auto-loads
 * every turn — that's how the DM "remembers" the campaign week to week
 * instead of relying on --resume surviving the gap between sessions.
 *
 * An imported module is chaptered, not dumped whole: only the current
 * chapter's full text loads per turn (module/current.md) alongside a small
 * always-loaded index of every chapter's title + summary (module/index.md).
 * Claude signals when to advance via dm-actions `advanceToChapter` — handled
 * below in runTurn — so the player never has to name a chapter themselves.
 *
 * Push-to-talk: click Talk, speak, click Stop. The mic audio is transcribed
 * locally (Whisper), sent to Claude (the user's own subscription via ask_dm —
 * no per-token API), and the reply is read aloud. A trailing ```dm-actions
 * block in the reply (see dmActions.ts) updates the party's HP/conditions/etc.
 * Other players push their characters here over LAN via "Send to DM" in
 * Tavern Sheet, received by party_listener.rs and merged into usePartyStore.
 *
 * Players can also talk without ever opening this page: TalkToDMButton on
 * their own character sheet POSTs a transcribed line to /talk, which
 * party_listener.rs re-emits here as `dm-player-turn`. Since only one Claude
 * turn can run at a time, remote turns land in a queue (queueRef) and drain
 * one at a time — see drainQueue/runTurn below.
 */
export function DMConsolePage() {
  const navigate = useNavigate();
  const { party, upsert, remove, clear } = usePartyStore();
  const { activeCampaignId, setActiveCampaignId } = useCampaignStore();

  const [listening, setListening] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [lanIp, setLanIp] = React.useState<string | null>(null);
  const [sttReady, setSttReady] = React.useState(false);

  const [campaigns, setCampaigns] = React.useState<CampaignMeta[]>([]);
  const [newCampaignOpen, setNewCampaignOpen] = React.useState(false);
  const [newCampaign, setNewCampaign] = React.useState<CampaignIntake>(BLANK_INTAKE);
  const [pendingModuleFile, setPendingModuleFile] = React.useState<{ name: string; text: string } | null>(null);
  const [moduleBusy, setModuleBusy] = React.useState<string | null>(null);
  const [creatingCampaign, setCreatingCampaign] = React.useState(false);
  const [notesOpen, setNotesOpen] = React.useState(false);
  const [notesText, setNotesText] = React.useState('');
  const [notesSaving, setNotesSaving] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyText, setHistoryText] = React.useState('');
  const [moduleOpen, setModuleOpen] = React.useState(false);
  const [chapters, setChapters] = React.useState<ChapterSummary[]>([]);
  const [currentChapterId, setCurrentChapterId] = React.useState<string | null>(null);
  const [modulePlan, setModulePlan] = React.useState('');

  const sessionIdRef = React.useRef<string | undefined>(undefined);
  const processingRef = React.useRef(false);
  const queueRef = React.useRef<PlayerTurn[]>([]);
  const partyRef = React.useRef(party);
  partyRef.current = party;
  // dm-player-turn's listener is registered once (mount) and would otherwise
  // close over a stale activeCampaignId — mirror it into a ref like partyRef.
  const campaignIdRef = React.useRef(activeCampaignId);
  campaignIdRef.current = activeCampaignId;
  // The active campaign's module/plan.md, fetched once per campaign switch —
  // NOT re-read every turn (see dmPrompt.ts's planCheckIn doc comment for why).
  // Starts each sitting/campaign "due" (Infinity) so the very first turn
  // includes it; reset to due again on a chapter change or a new sitting.
  const campaignPlanRef = React.useRef('');
  const turnsSincePlanCheckRef = React.useRef(Infinity);

  React.useEffect(() => {
    turnsSincePlanCheckRef.current = Infinity;
    if (!activeCampaignId) {
      campaignPlanRef.current = '';
      return;
    }
    invoke<string>('read_campaign_plan', { id: activeCampaignId })
      .then((plan) => { campaignPlanRef.current = plan; })
      .catch(() => { campaignPlanRef.current = ''; });
  }, [activeCampaignId]);

  // Start the LAN listener + resolve this machine's LAN IP once, on mount.
  React.useEffect(() => {
    invoke<number>('start_party_listener', { port: DM_PORT }).catch((e) =>
      setError(`Couldn't start the LAN listener: ${e}`)
    );
    invoke<string | null>('local_lan_ip').then(setLanIp).catch(() => setLanIp(null));
    warmupSTT().then(() => setSttReady(true)).catch((e) => setError(`Speech recognition failed to load: ${e.message || e}`));
    invoke<CampaignMeta[]>('list_campaigns').then(setCampaigns).catch((e) => setError(`Couldn't load campaigns: ${e}`));
  }, []);

  // Receive characters players push over LAN.
  React.useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<Character>('dm-party-character', (event) => {
      upsert(event.payload);
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, [upsert]);

  // Receive spoken lines pushed from a player's own device (TalkToDMButton).
  React.useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<PlayerTurn>('dm-player-turn', (event) => {
      queueRef.current.push(event.payload);
      drainQueue();
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Runs one full turn through Claude and speaks the reply. `speaker` is the
   *  character name for a remote turn, undefined for the DM Console's own mic. */
  async function runTurn(spokenText: string, speaker: string | undefined, who: string) {
    setTurns((t) => [...t, { who, text: spokenText }]);
    try {
      const dueForPlanCheck = !!campaignPlanRef.current && turnsSincePlanCheckRef.current >= PLAN_CHECK_INTERVAL;
      const prompt = buildTurnPrompt({
        party: partyRef.current,
        spokenText,
        speaker,
        planCheckIn: dueForPlanCheck ? campaignPlanRef.current : undefined,
      });
      turnsSincePlanCheckRef.current = dueForPlanCheck ? 0 : turnsSincePlanCheckRef.current + 1;

      const reply = await invoke<{ text: string; session_id?: string }>('ask_dm', {
        prompt,
        sessionId: sessionIdRef.current,
        campaignId: campaignIdRef.current ?? undefined,
      });
      if (reply.session_id) sessionIdRef.current = reply.session_id;

      const { narration, actions } = parseDmReply(reply.text);
      setTurns((t) => [...t, { who: 'dm', text: narration }]);

      if (actions) {
        const updated = applyDmActions(partyRef.current, actions);
        updated.forEach((c, i) => { if (c !== partyRef.current[i]) upsert(c); });

        const campaignId = campaignIdRef.current;
        if (campaignId && actions.remember?.length) {
          const date = new Date().toISOString().slice(0, 10);
          for (const note of actions.remember) {
            await invoke('append_memory_note', { id: campaignId, date, note }).catch((e) =>
              console.warn('Failed to save a remembered fact:', e)
            );
          }
        }
        if (campaignId && actions.advanceToChapter) {
          await invoke('set_current_chapter', { id: campaignId, chapterId: actions.advanceToChapter }).catch((e) =>
            console.warn('Failed to advance chapter:', e)
          );
          // A chapter just turned over — make sure the *next* turn re-checks
          // the plan instead of waiting out the rest of the interval.
          turnsSincePlanCheckRef.current = Infinity;
        }
      }

      await speak(narration);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Processes queued remote turns one at a time. No-ops if a turn (local or
   *  remote) is already running — the caller that finishes will drain again. */
  async function drainQueue() {
    if (processingRef.current) return;
    processingRef.current = true;
    setBusy(true);
    while (queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      await runTurn(next.text, next.name, next.name || 'player');
    }
    processingRef.current = false;
    setBusy(false);
  }

  async function handleTalkToggle() {
    setError(null);
    if (!listening) {
      try {
        await startRecording();
        setListening(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not access the microphone.');
      }
      return;
    }

    setListening(false);
    if (processingRef.current) return; // a remote turn is mid-flight; Talk is disabled anyway
    processingRef.current = true;
    setBusy(true);
    try {
      const spokenText = await stopAndTranscribe();
      if (spokenText) await runTurn(spokenText, undefined, 'you');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      processingRef.current = false;
      setBusy(false);
      drainQueue(); // pick up anything a player sent while this turn ran
    }
  }

  /** Wraps up the night: if anything actually happened, asks Claude for a short
   *  recap and appends it to the campaign's memory/MEMORY.md, then resets the
   *  in-memory conversation so next time starts a fresh --resume chain. */
  async function handleEndSession() {
    stopSpeaking();
    const campaignId = campaignIdRef.current;
    if (campaignId && turns.length > 0) {
      setBusy(true);
      try {
        const prompt = buildRecapPrompt(partyRef.current);
        const reply = await invoke<{ text: string; session_id?: string }>('ask_dm', {
          prompt,
          sessionId: sessionIdRef.current,
          campaignId,
        });
        const { narration } = parseDmReply(reply.text);
        const date = new Date().toISOString().slice(0, 10);
        await invoke('append_session_recap', { id: campaignId, date, recap: narration });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    }
    sessionIdRef.current = undefined;
    turnsSincePlanCheckRef.current = Infinity; // a new sitting starts with a fresh plan check-in
    queueRef.current = [];
    setTurns([]);
  }

  async function handleCreateCampaign() {
    if (!newCampaign.name.trim()) return;
    setCreatingCampaign(true);
    try {
      const meta = await invoke<CampaignMeta>('create_campaign', { intake: newCampaign });
      setCampaigns((c) => [...c, meta].sort((a, b) => a.name.localeCompare(b.name)));
      setActiveCampaignId(meta.id);
      setNewCampaignOpen(false);

      // A module was picked before the campaign existed to write it into —
      // chapterize it now that we have a real campaign id.
      if (pendingModuleFile) {
        setModuleBusy('Reading your module and building a chapter breakdown + campaign plan… this can take a few minutes for long documents.');
        try {
          await invoke<ChapterSummary[]>('chapterize_and_import_module', { id: meta.id, text: pendingModuleFile.text });
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setModuleBusy(null);
        }
      }
      setNewCampaign(BLANK_INTAKE);
      setPendingModuleFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingCampaign(false);
    }
  }

  /** "Import module file…" inside the New Campaign dialog — just extracts and
   *  stashes the text; chapterizing needs a real campaign id, so that happens
   *  in handleCreateCampaign right after the campaign is actually created. */
  async function handleImportModuleForNewCampaign() {
    setModuleBusy('Reading file…');
    try {
      const picked = await pickAndExtractModuleFile();
      if (!picked) return;
      setPendingModuleFile(picked);
      setNewCampaign((n) => ({ ...n, module: n.module || picked.name.replace(/\.[^.]+$/, '') }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setModuleBusy(null);
    }
  }

  /** Import/replace the module for an already-created campaign — extracts the
   *  file, then chapterize_and_import_module does the LLM chapter-boundary
   *  call + file writes (replacing any previously-imported module), and we
   *  refresh the chapter list shown in the Module dialog. */
  async function handleImportModuleForExisting() {
    if (!activeCampaignId) return;
    setModuleBusy('Reading file…');
    try {
      const picked = await pickAndExtractModuleFile();
      if (!picked) return;
      setModuleBusy('Reading your module and building a chapter breakdown + campaign plan… this can take a few minutes for long documents.');
      const newChapters = await invoke<ChapterSummary[]>('chapterize_and_import_module', { id: activeCampaignId, text: picked.text });
      setChapters(newChapters);
      setCurrentChapterId(newChapters[0]?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setModuleBusy(null);
    }
  }

  async function handleSetCurrentChapter(chapterId: string) {
    if (!activeCampaignId) return;
    try {
      await invoke('set_current_chapter', { id: activeCampaignId, chapterId });
      setCurrentChapterId(chapterId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function openModule() {
    if (!activeCampaignId) return;
    try {
      const result = await invoke<{ chapters: ChapterSummary[]; current_id: string | null }>('get_module_chapters', { id: activeCampaignId });
      setChapters(result.chapters);
      setCurrentChapterId(result.current_id);
      setModulePlan(await invoke<string>('read_campaign_plan', { id: activeCampaignId }).catch(() => ''));
      setModuleOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function openNotes() {
    if (!activeCampaignId) return;
    try {
      const content = await invoke<string>('read_campaign_notes', { id: activeCampaignId });
      setNotesText(content);
      setNotesOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveNotes() {
    if (!activeCampaignId) return;
    setNotesSaving(true);
    try {
      await invoke('save_campaign_notes', { id: activeCampaignId, content: notesText });
      setNotesOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setNotesSaving(false);
    }
  }

  async function openHistory() {
    if (!activeCampaignId) return;
    try {
      const content = await invoke<string>('read_campaign_memory', { id: activeCampaignId });
      setHistoryText(content);
      setHistoryOpen(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const activeCampaignName = campaigns.find((c) => c.id === activeCampaignId)?.name;

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => navigate('/')} className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={18} /> Home
          </button>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">🧙 DM Console</h1>
          <Button variant="outline" size="sm" onClick={handleEndSession} disabled={busy}>End session</Button>
        </div>

        {/* Campaign picker */}
        <div className="flex items-center justify-center gap-2 mb-2 flex-wrap">
          <select
            value={activeCampaignId ?? ''}
            onChange={(e) => setActiveCampaignId(e.target.value || null)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-red-600"
          >
            <option value="">Select a campaign…</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <Button size="sm" variant="outline" onClick={() => { setNewCampaign(BLANK_INTAKE); setPendingModuleFile(null); setNewCampaignOpen(true); }}>
            <Plus size={14} /> New campaign
          </Button>

          {activeCampaignId && (
            <>
              <Button size="sm" variant="ghost" onClick={openNotes} title="Edit persona, house rules, and world lore (CLAUDE.md)">
                <BookOpen size={14} /> Notes
              </Button>
              <Button size="sm" variant="ghost" onClick={openHistory} title="Past session recaps (memory/MEMORY.md)">
                <ScrollText size={14} /> History
              </Button>
              <Button size="sm" variant="ghost" onClick={openModule} title="Imported module chapters, and which one is current">
                <FileUp size={14} /> Module
              </Button>
            </>
          )}
        </div>

        {lanIp && (
          <p className="text-xs text-slate-500 mb-4 text-center">
            Players: enter <span className="text-slate-300 font-mono">{lanIp}</span> in their app's "Send to DM" dialog to join the table.
          </p>
        )}

        <div className="grid gap-6 md:grid-cols-[1fr_260px]">
          {/* Conversation */}
          <Card className="p-5 flex flex-col h-[60vh]">
            <div className="flex-1 overflow-y-auto space-y-3 mb-4 scrollbar-thin">
              {turns.length === 0 && (
                <p className="text-slate-500 text-sm">
                  {activeCampaignId
                    ? `Press Talk and say "start the session" to begin ${activeCampaignName ? `— ${activeCampaignName}` : ''}.`
                    : 'Pick or create a campaign above to begin.'}
                </p>
              )}
              {turns.map((t, i) => (
                <div key={i} className={t.who === 'dm' ? 'text-slate-100' : 'text-slate-400 italic'}>
                  <span className="text-xs uppercase tracking-wide mr-2 opacity-60">
                    {t.who === 'dm' ? 'DM' : t.who === 'you' ? 'You' : t.who}
                  </span>
                  {t.text}
                </div>
              ))}
            </div>

            {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

            <div className="flex items-center justify-center gap-3">
              <Button
                size="lg"
                variant={listening ? 'danger' : 'primary'}
                disabled={busy || !sttReady || !activeCampaignId}
                onClick={handleTalkToggle}
              >
                {listening ? <Square size={20} /> : <Mic size={20} />}
                {listening
                  ? 'Stop'
                  : busy
                    ? 'Thinking…'
                    : !activeCampaignId
                      ? 'Pick a campaign first'
                      : sttReady
                        ? 'Talk'
                        : 'Loading speech recognition…'}
              </Button>
            </div>
          </Card>

          {/* Party sidebar */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-300 flex items-center gap-1.5"><Radio size={14} /> Party ({party.length})</h2>
              {party.length > 0 && (
                <button onClick={clear} title="Clear party" className="text-slate-500 hover:text-red-400 transition-colors">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            {party.length === 0 && (
              <p className="text-xs text-slate-500">No one has joined yet.</p>
            )}
            <div className="space-y-2">
              {party.map((c) => {
                const hpPct = c.maxHP > 0 ? Math.round((c.currentHP / c.maxHP) * 100) : 0;
                return (
                  <div key={c.id} className="bg-slate-900 border border-slate-700 rounded-lg p-2 group relative">
                    <button
                      onClick={() => remove(c.id)}
                      className="absolute top-1.5 right-1.5 text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Remove from table"
                    >
                      <Trash2 size={12} />
                    </button>
                    <p className="text-sm font-bold text-white pr-4">{c.name}</p>
                    <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden my-1">
                      <div
                        className={`h-full rounded-full ${hpPct > 50 ? 'bg-green-500' : hpPct > 25 ? 'bg-yellow-500' : 'bg-red-500'}`}
                        style={{ width: `${hpPct}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-400">{c.currentHP}/{c.maxHP} HP</p>
                    {c.conditions.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {c.conditions.map((cond) => <Badge key={cond} color="red">{cond}</Badge>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={newCampaignOpen} onClose={() => setNewCampaignOpen(false)} title="New Campaign" wide>
        <p className="text-xs text-slate-400 mb-3">
          This bakes straight into the campaign's CLAUDE.md, so the DM already knows it on session one instead of starting blank. You can always add more later via Notes.
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Campaign name</label>
            <input
              autoFocus
              value={newCampaign.name}
              onChange={(e) => setNewCampaign((n) => ({ ...n, name: e.target.value }))}
              placeholder="e.g. Curse of Strahd, or The Sunken City"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">D&D edition</label>
              <select
                value={newCampaign.edition}
                onChange={(e) => setNewCampaign((n) => ({ ...n, edition: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-600"
              >
                <option value="2014">2014 (original 5e)</option>
                <option value="2024">2024 (revised 5e)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Module / scenario</label>
              <input
                value={newCampaign.module}
                onChange={(e) => setNewCampaign((n) => ({ ...n, module: e.target.value }))}
                placeholder="e.g. Lost Mine of Phandelver, or Homebrew"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-600"
              />
            </div>
          </div>

          <div>
            <Button size="sm" variant="outline" onClick={handleImportModuleForNewCampaign} disabled={!!moduleBusy}>
              <Upload size={14} /> {moduleBusy ?? 'Import module file (PDF or text)…'}
            </Button>
            {pendingModuleFile && (
              <p className="text-xs text-emerald-400 mt-1">
                ✓ {pendingModuleFile.name} ({pendingModuleFile.text.length.toLocaleString()} characters) — will be chapterized automatically once the campaign is created.
                <button type="button" onClick={() => setPendingModuleFile(null)} className="ml-2 text-slate-500 hover:text-red-400">
                  ✕ remove
                </button>
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Players &amp; characters</label>
            <textarea
              value={newCampaign.players}
              onChange={(e) => setNewCampaign((n) => ({ ...n, players: e.target.value }))}
              rows={3}
              placeholder={'Alex — Thorin (Fighter)\nSam — Mira (Wizard)'}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-red-600"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Anything else? (tone, house rules, starting situation…)</label>
            <textarea
              value={newCampaign.notes}
              onChange={(e) => setNewCampaign((n) => ({ ...n, notes: e.target.value }))}
              rows={4}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-red-600"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setNewCampaignOpen(false)}>Cancel</Button>
          <Button onClick={handleCreateCampaign} disabled={creatingCampaign || !newCampaign.name.trim()}>
            {moduleBusy ?? (creatingCampaign ? 'Creating…' : 'Create campaign')}
          </Button>
        </div>
      </Dialog>

      <Dialog open={notesOpen} onClose={() => setNotesOpen(false)} title={`${activeCampaignName ?? 'Campaign'} — Notes (CLAUDE.md)`} wide>
        <p className="text-xs text-slate-400 mb-2">
          Persona, house rules, and world lore. Loads fresh into every turn — edit freely.
        </p>
        <textarea
          value={notesText}
          onChange={(e) => setNotesText(e.target.value)}
          rows={20}
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 font-mono focus:outline-none focus:border-red-600"
        />
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="outline" onClick={() => setNotesOpen(false)}>Cancel</Button>
          <Button onClick={saveNotes} disabled={notesSaving}>{notesSaving ? 'Saving…' : 'Save'}</Button>
        </div>
      </Dialog>

      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} title={`${activeCampaignName ?? 'Campaign'} — History (memory/MEMORY.md)`} wide>
        <p className="text-xs text-slate-400 mb-2">Recaps appended automatically each time you click "End session."</p>
        <pre className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 whitespace-pre-wrap max-h-[60vh] overflow-y-auto">{historyText}</pre>
        <div className="flex justify-end mt-3">
          <Button variant="outline" onClick={() => setHistoryOpen(false)}>Close</Button>
        </div>
      </Dialog>

      <Dialog open={moduleOpen} onClose={() => setModuleOpen(false)} title={`${activeCampaignName ?? 'Campaign'} — Module`} wide>
        <p className="text-xs text-slate-400 mb-2">
          Your own scenario document, PDF-extracted and auto-chapterized. Only the current chapter's full text loads every turn — Claude advances chapters itself as the story progresses, but you can override it here anytime. Importing a new file replaces all chapters.
        </p>
        <div className="mb-3">
          <Button size="sm" variant="outline" onClick={handleImportModuleForExisting} disabled={!!moduleBusy}>
            <Upload size={14} /> {moduleBusy ?? (chapters.length ? 'Replace with a different file…' : 'Import module file (PDF or text)…')}
          </Button>
        </div>
        {modulePlan && (
          <div className="mb-3 border border-slate-700 rounded-lg p-2.5 bg-slate-900/60">
            <p className="text-xs font-bold text-slate-300 mb-1">Campaign-arc plan</p>
            <p className="text-xs text-slate-400 whitespace-pre-wrap">{modulePlan}</p>
          </div>
        )}
        {chapters.length ? (
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {chapters.map((c, i) => {
              const isCurrent = c.id === currentChapterId;
              return (
                <div
                  key={c.id}
                  className={`border rounded-lg p-2.5 ${isCurrent ? 'bg-emerald-900/30 border-emerald-700' : 'bg-slate-900 border-slate-700'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-white">{i + 1}. {c.title} {isCurrent && <span className="text-emerald-400 text-xs font-normal">← current</span>}</p>
                    {!isCurrent && (
                      <button
                        onClick={() => handleSetCurrentChapter(c.id)}
                        className="shrink-0 text-xs text-slate-400 hover:text-emerald-400 border border-slate-600 hover:border-emerald-600 rounded px-2 py-0.5 transition-colors"
                      >
                        Set as current
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{c.summary}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No module imported yet for this campaign.</p>
        )}
        <div className="flex justify-end mt-3">
          <Button variant="outline" onClick={() => setModuleOpen(false)}>Close</Button>
        </div>
      </Dialog>
    </div>
  );
}
