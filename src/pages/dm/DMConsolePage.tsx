import React from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { ArrowLeft, Mic, Square, Radio, Trash2 } from 'lucide-react';
import { Button, Card, Badge } from '../../components/ui';
import { usePartyStore } from '../../store/usePartyStore';
import { buildTurnPrompt } from '../../utils/dmPrompt';
import { parseDmReply, applyDmActions } from '../../utils/dmActions';
import { startRecording, stopAndTranscribe, warmupSTT, speak, stopSpeaking } from '../../utils/dmSpeech';
import type { Character } from '../../types';

const DM_PORT = 7777;

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

/**
 * DMConsolePage — the in-app spoken-word Dungeon Master.
 *
 * Push-to-talk: click Talk, speak, click Stop. The mic audio is transcribed
 * locally (Whisper), sent to the Claude DM (the user's own subscription via
 * the `ask_dm` Rust command — no per-token API), and the reply is read aloud.
 * A trailing ```dm-actions block in the reply (see dmActions.ts) updates the
 * party's HP/conditions/etc. Other players push their characters here over LAN
 * via the existing "Send to DM" button in Tavern Sheet, received by
 * party_listener.rs and merged into usePartyStore.
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

  const [listening, setListening] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [lanIp, setLanIp] = React.useState<string | null>(null);
  const [sttReady, setSttReady] = React.useState(false);

  const sessionIdRef = React.useRef<string | undefined>(undefined);
  const isFirstTurnRef = React.useRef(true);
  const processingRef = React.useRef(false);
  const queueRef = React.useRef<PlayerTurn[]>([]);
  const partyRef = React.useRef(party);
  partyRef.current = party;

  // Start the LAN listener + resolve this machine's LAN IP once, on mount.
  React.useEffect(() => {
    invoke<number>('start_party_listener', { port: DM_PORT }).catch((e) =>
      setError(`Couldn't start the LAN listener: ${e}`)
    );
    invoke<string | null>('local_lan_ip').then(setLanIp).catch(() => setLanIp(null));
    warmupSTT().then(() => setSttReady(true)).catch((e) => setError(`Speech recognition failed to load: ${e.message || e}`));
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
      const prompt = buildTurnPrompt({
        isFirstTurn: isFirstTurnRef.current,
        party: partyRef.current,
        spokenText,
        speaker,
      });
      const reply = await invoke<{ text: string; session_id?: string }>('ask_dm', {
        prompt,
        sessionId: sessionIdRef.current,
      });
      isFirstTurnRef.current = false;
      if (reply.session_id) sessionIdRef.current = reply.session_id;

      const { narration, actions } = parseDmReply(reply.text);
      setTurns((t) => [...t, { who: 'dm', text: narration }]);

      if (actions) {
        const updated = applyDmActions(partyRef.current, actions);
        updated.forEach((c, i) => { if (c !== partyRef.current[i]) upsert(c); });
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

  function handleNewSession() {
    stopSpeaking();
    sessionIdRef.current = undefined;
    isFirstTurnRef.current = true;
    queueRef.current = [];
    setTurns([]);
  }

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => navigate('/')} className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={18} /> Home
          </button>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">🧙 DM Console</h1>
          <Button variant="outline" size="sm" onClick={handleNewSession}>New session</Button>
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
                <p className="text-slate-500 text-sm">Press Talk and say "start the session" to begin.</p>
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
                disabled={busy || !sttReady}
                onClick={handleTalkToggle}
              >
                {listening ? <Square size={20} /> : <Mic size={20} />}
                {listening ? 'Stop' : busy ? 'Thinking…' : sttReady ? 'Talk' : 'Loading speech recognition…'}
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
    </div>
  );
}
