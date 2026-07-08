/**
 * dmSpeech.ts — mic capture, local Whisper STT, and TTS for the in-app DM Console.
 *
 * STT is Whisper via transformers.js (WASM/WebGPU, model downloads once on first
 * use and is cached by the browser) — runs entirely inside the webview.
 *
 * TTS uses a bundled Piper voice (src-tauri/src/tts.rs's `speak_text` command —
 * a standalone PyInstaller-frozen `piper.exe` + voice model shipped as a Tauri
 * resource, invoked as a subprocess, no install/Python needed at runtime).
 * Windows-only for now (see tauri.conf.json), so this falls back to the
 * platform's built-in speechSynthesis whenever the command errors — e.g. any
 * future non-Windows build that doesn't have Piper bundled yet, or a plain
 * browser preview with no Tauri backend at all.
 */
import { pipeline } from '@huggingface/transformers';
import { invoke, isTauri } from '@tauri-apps/api/core';

// ── Microphone capture ───────────────────────────────────────────────────────

let mediaStream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];

export async function startRecording(): Promise<void> {
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  chunks = [];
  recorder = new MediaRecorder(mediaStream);
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  recorder.start();
}

/** Stops recording and returns the captured audio as a Blob. */
export function stopRecording(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!recorder) return reject(new Error('Not recording.'));
    const mimeType = recorder.mimeType || 'audio/webm';
    recorder.onstop = () => {
      mediaStream?.getTracks().forEach((t) => t.stop());
      mediaStream = null;
      recorder = null;
      resolve(new Blob(chunks, { type: mimeType }));
    };
    recorder.stop();
  });
}

/** Decodes a recorded Blob into mono 16kHz samples (what Whisper expects). */
async function blobToMono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  await decodeCtx.close();

  const targetRate = 16000;
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * targetRate), targetRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination); // mono destination downmixes automatically
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

// ── Speech-to-text (Whisper via transformers.js) ────────────────────────────

type Transcriber = (input: Float32Array) => Promise<{ text: string } | { text: string }[]>;
let transcriberPromise: Promise<Transcriber> | null = null;

function getTranscriber(): Promise<Transcriber> {
  if (!transcriberPromise) {
    const model = import.meta.env.VITE_WHISPER_MODEL || 'Xenova/whisper-base.en';
    // dtype: 'fp32' — the default auto-selected quantized variant is missing a
    // dequantization scale for this model/backend combo (WASM); fp32 always works.
    transcriberPromise = pipeline('automatic-speech-recognition', model, { dtype: 'fp32' }) as unknown as Promise<Transcriber>;
  }
  return transcriberPromise;
}

/** Kicks off the (large, one-time) model download so the first utterance isn't slow. */
export function warmupSTT(): Promise<unknown> {
  return getTranscriber();
}

/** Stops recording and transcribes it. Returns '' for silence/no speech. */
export async function stopAndTranscribe(): Promise<string> {
  const blob = await stopRecording();
  const samples = await blobToMono16k(blob);
  if (samples.length < 1600) return ''; // < 0.1s
  const transcriber = await getTranscriber();
  const result = await transcriber(samples);
  const text = Array.isArray(result) ? result[0]?.text : result.text;
  return (text || '').trim();
}

// ── Text-to-speech ───────────────────────────────────────────────────────────

let currentAudio: HTMLAudioElement | null = null;
// Forces whatever `speak()` promise is currently pending to resolve — needed
// because pausing an <audio> element (stopSpeaking's job) does NOT fire its
// 'ended'/'error' events the way speechSynthesis.cancel() fires 'onend'.
// Without this, interrupting mid-playback would leave that promise pending
// forever, which — now that speak() calls are chained sentence-by-sentence
// in DMConsolePage's playback queue — would permanently stall the queue
// instead of just leaving one turn's audio call hanging.
let currentForceResolve: (() => void) | null = null;

function speakWithBrowserTTS(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || !text.trim()) return resolve();
    window.speechSynthesis.cancel(); // don't queue over a previous line
    const utterance = new SpeechSynthesisUtterance(text);
    currentForceResolve = resolve;
    const settle = () => { if (currentForceResolve === resolve) currentForceResolve = null; resolve(); };
    utterance.onend = settle;
    utterance.onerror = settle;
    window.speechSynthesis.speak(utterance);
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

/** Plays a Blob URL already produced by Piper (see prepareSpeech) — the
 *  playback half of what speakWithPiper used to do in one shot, split out so
 *  synthesis (the slow part) can happen ahead of time while a previous line
 *  is still playing. */
function playPiperUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url);
    currentAudio = audio;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
      if (currentForceResolve === settle) currentForceResolve = null;
    };
    const settle = () => { cleanup(); resolve(); };
    currentForceResolve = settle;
    audio.onended = settle;
    audio.onerror = () => { cleanup(); reject(new Error('Piper audio playback failed')); };
    audio.play().catch((e) => { cleanup(); reject(e); });
  });
}

/** Cleans a line of narration for TTS ONLY — never for anything a human
 *  reads. Piper's espeak-ng phonemizer announces certain Unicode punctuation
 *  by its character NAME instead of treating it as a pause: an em dash (—)
 *  comes out spoken as "circumflex", en dashes/ellipses/quotes similarly get
 *  mangled. Claude's prose legitimately uses these (they render fine on
 *  screen), so we strip/normalize them right before synthesis rather than
 *  forbidding them in the prose itself. Dashes → a comma (natural spoken
 *  pause); fancy quotes → plain; ellipsis → three dots; assorted invisible/
 *  decorative marks dropped. Collapses any doubled spaces the swaps leave. */
function sanitizeForTTS(text: string): string {
  return text
    .replace(/[—–]/g, ', ')   // em/en dash → comma pause
    .replace(/…/g, '...')           // ellipsis char → three dots
    .replace(/[‘’‛]/g, "'") // curly single quotes → '
    .replace(/[“”]/g, '"')     // curly double quotes → "
    .replace(/[•·⁃∙]/g, ' ') // bullets/middots → space
    .replace(/[*_`#>]/g, '')             // stray markdown emphasis/heading marks
    .replace(/[ \t]{2,}/g, ' ')          // collapse doubled spaces
    .trim();
}

/** Result of `prepareSpeech` — everything needed to play a line, with the
 *  slow part (actual Piper synthesis) already done. `'piper'` carries a
 *  ready-to-play Blob URL; `'browser'` just carries the sanitized text,
 *  since the Web Speech API has no separate synthesize-now/play-later step
 *  (calling it speaks immediately) — there's nothing to pre-do for that
 *  path, so "prepared" is a no-op wrapper for it; `'empty'` is a silent
 *  line (nothing left after sanitizing) that plays as a no-op. */
export type PreparedSpeech = { kind: 'piper'; url: string } | { kind: 'browser'; text: string } | { kind: 'empty' };

/** Synthesizes (but does not play) a line — the "prepare" half of a
 *  prepare-then-play split. Exists so a playback queue (see DMConsolePage's
 *  sentence queue) can start preparing the NEXT line while the CURRENT one
 *  is still playing: previously, synthesis of line N+1 never started until
 *  line N finished playing aloud, leaving an audible gap between every pair
 *  of sentences even though nothing about the synthesis itself needed to
 *  wait that long. Piper's part of the work (the actual TTS call) happens
 *  right here; playPrepared's Piper branch is just decoding+playing an
 *  already-finished Blob. Same Piper-with-browser-fallback behavior as
 *  before (see tts.rs's ensure_voice_available for how `voiceId` resolves,
 *  pitch_factor for `pitch`) — both are ignored on the browser fallback,
 *  which has no equivalent per-NPC voice/pitch switching. */
export async function prepareSpeech(text: string, voiceId?: string, pitch?: string): Promise<PreparedSpeech> {
  const clean = sanitizeForTTS(text);
  if (!clean.trim()) return { kind: 'empty' };
  if (isTauri()) {
    try {
      const base64Wav = await invoke<string>('speak_text', { text: clean, voiceId, pitch });
      return { kind: 'piper', url: URL.createObjectURL(base64ToBlob(base64Wav, 'audio/wav')) };
    } catch (e) {
      console.warn('Piper TTS failed, falling back to browser speechSynthesis:', e);
    }
  }
  return { kind: 'browser', text: clean };
}

/** Plays out a PreparedSpeech value, resolving once playback finishes (or
 *  immediately for a silent line). Splitting this from prepareSpeech is
 *  what lets the queue overlap the next line's synthesis with the current
 *  line's playback — see prepareSpeech's doc comment. */
export function playPrepared(prepared: PreparedSpeech): Promise<void> {
  if (prepared.kind === 'empty') return Promise.resolve();
  if (prepared.kind === 'browser') return speakWithBrowserTTS(prepared.text);
  return playPiperUrl(prepared.url);
}

/** Releases a prepared-but-never-played Piper Blob URL — needed when a
 *  lookahead line got prepared ahead of time (see DMConsolePage's playback
 *  queue) but the turn was interrupted before it ever got played; without
 *  this, that object URL would leak for the rest of the page's life. No-op
 *  for the other two kinds, which hold nothing that needs releasing. */
export function discardPrepared(prepared: PreparedSpeech): void {
  if (prepared.kind === 'piper') URL.revokeObjectURL(prepared.url);
}

/** Speaks one line start-to-finish — equivalent to prepareSpeech followed
 *  immediately by playPrepared, with no lookahead. Fine for a one-off call
 *  with nothing to pipeline against (e.g. the voice-preview button in the
 *  History dialog); DMConsolePage's own playback queue uses
 *  prepareSpeech/playPrepared directly instead so it can overlap lines. */
export async function speak(text: string, voiceId?: string, pitch?: string): Promise<void> {
  return playPrepared(await prepareSpeech(text, voiceId, pitch));
}

export function stopSpeaking(): void {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (currentForceResolve) { const resolve = currentForceResolve; currentForceResolve = null; resolve(); }
}
