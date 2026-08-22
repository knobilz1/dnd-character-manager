/**
 * dmSpeech.ts — mic capture, local Whisper STT, and TTS for the in-app DM Console.
 *
 * STT is Whisper via transformers.js (WASM/WebGPU, model downloads once on first
 * use and is cached by the browser) — runs entirely inside the webview.
 *
 * TTS uses a bundled Kokoro voice (src-tauri/src/tts.rs's `speak_text` command —
 * a standalone PyInstaller-frozen `kokoro_cli.exe` shipped as a Tauri resource,
 * invoked as a subprocess, no install/Python needed at runtime; the shared
 * model files are lazily downloaded and cached on first use — see tts.rs's
 * ensure_kokoro_model_available). Windows-only for now (see tauri.conf.json),
 * so this falls back to the platform's built-in speechSynthesis whenever the
 * command errors — e.g. any future non-Windows build that doesn't have Kokoro
 * bundled yet, or a plain browser preview with no Tauri backend at all.
 */
import { pipeline } from '@huggingface/transformers';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useSettingsStore } from '../store/useSettingsStore';

// ── Audio output device (speaker) selection ─────────────────────────────────
//
// `HTMLMediaElement.setSinkId` (Media Capture and Streams extension) is how
// Chromium — and so WebView2, which is what every Windows Tauri window runs
// on — routes a specific <audio>/<video> element to a chosen output device
// instead of the OS default. It isn't in TS's default DOM lib, so it's typed
// locally rather than pulling in a whole @types package for one method.
// NOTE: the Web Speech API (window.speechSynthesis, dmSpeech's last-resort
// fallback when neither TTS engine is reachable) has NO device-routing hook
// at all — it always plays on the OS default output, full stop. So picking a
// non-default device only affects real DM lines (Kokoro/F5 <audio> playback)
// and the test tone below, never the emergency browser-TTS fallback.
// Not declared via `extends HTMLAudioElement` — this TS lib target already
// declares `setSinkId` on HTMLMediaElement as a REQUIRED method (accurate for
// the type, not for real-world support: Firefox has none, and it's absent
// from TS's DOM lib in plenty of other configurations), so redeclaring it
// optional here would conflict with the parent interface instead of
// narrowing it. A plain intersection sidesteps that inheritance check
// entirely while keeping the call site's `.setSinkId?.(...)` optional-safe.
type SinkableAudioElement = HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> };

/** True when this browser/webview can route audio to a non-default device at
 *  all — gates whether the picker's device list means anything, the same
 *  "cheap capability check before asking for anything" shape as
 *  micApiAvailable() above. */
export function audioOutputSelectionSupported(): boolean {
  return typeof document !== 'undefined' && 'setSinkId' in document.createElement('audio');
}

/** Lists available speaker/output devices. Device *labels* are blank until
 *  some getUserMedia permission has been granted at least once in this
 *  origin (a browser privacy rule, not a bug here) — this app already asks
 *  for the microphone for push-to-talk, so by the time a DM opens the Voice
 *  dialog and looks at this list, labels are normally already populated. */
export async function listAudioOutputDevices(): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audiooutput');
}

/** Applies the persisted output-device choice to an <audio> element right
 *  before playback — read live from the store (rather than threaded through
 *  every call site) so changing the pick in the Voice dialog takes effect on
 *  the very next line spoken with no extra plumbing. Empty deviceId or an
 *  unsupported browser is a silent no-op — the element just plays on the OS
 *  default, exactly as it always has. */
async function applyAudioOutputDevice(audio: SinkableAudioElement): Promise<void> {
  const deviceId = useSettingsStore.getState().dmAudioOutputDeviceId;
  if (!deviceId || !audio.setSinkId) return;
  try {
    await audio.setSinkId(deviceId);
  } catch (e) {
    // A stale device id (unplugged headset, etc.) — fall back to system
    // default rather than throwing and silencing the line entirely.
    console.warn('Could not switch DM audio to the selected output device (using system default instead):', e);
  }
}

/** Builds a short mono 16-bit PCM WAV sine-wave beep, entirely in JS — no
 *  TTS engine involved. Exists so "Test" in the Voice dialog answers ONE
 *  question in isolation: "is audio actually reaching the device I picked,"
 *  without also depending on Kokoro/F5 being installed and working. If the
 *  DM hears the beep but not the DM's voice, the problem is TTS synthesis,
 *  not device routing — if they hear neither, it's the device/OS routing. */
function buildBeepWav(freqHz = 880, durationMs = 500, sampleRate = 22050): Blob {
  const frameCount = Math.floor((sampleRate * durationMs) / 1000);
  const dataSize = frameCount * 2; // 16-bit mono
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (offset: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  // Short fade in/out (same click-elimination reasoning as tts.rs's
  // fade_wav_edges) so the beep doesn't pop at its own edges.
  const fadeFrames = Math.min(frameCount / 2, Math.round(sampleRate * 0.02));
  for (let i = 0; i < frameCount; i++) {
    const t = i / sampleRate;
    let gain = 0.4;
    if (i < fadeFrames) gain *= i / fadeFrames;
    else if (i > frameCount - fadeFrames) gain *= (frameCount - i) / fadeFrames;
    const sample = Math.round(Math.sin(2 * Math.PI * freqHz * t) * gain * 32767);
    view.setInt16(44 + i * 2, sample, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Plays the test beep through whichever output device is currently
 *  selected (or the OS default). Returns once playback finishes, rejects on
 *  a genuine playback error (e.g. the device really is gone) — the Voice
 *  dialog's Test button surfaces that rejection directly, since "the picked
 *  device doesn't work" is exactly what this button exists to catch. */
export function testAudioOutputDevice(): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(buildBeepWav());
    const audio: SinkableAudioElement = new Audio(url);
    const cleanup = () => URL.revokeObjectURL(url);
    audio.onended = () => { cleanup(); resolve(); };
    audio.onerror = () => { cleanup(); reject(new Error('Playback failed on the selected output device.')); };
    applyAudioOutputDevice(audio)
      .then(() => audio.play())
      .catch((e) => { cleanup(); reject(e); });
  });
}

// ── Microphone capture ───────────────────────────────────────────────────────

let mediaStream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];

/** True when this build can even ask for a microphone. Mirrors tableCamera's
 *  `cameraApiAvailable` — cheap, synchronous, prompts nobody.
 *
 *  Worth checking rather than letting the call throw: when WKWebView withholds
 *  the API the raw failure is "undefined is not an object (evaluating
 *  'navigator.mediaDevices.getUserMedia')", which sends the reader hunting for
 *  a frontend bug instead of a missing macOS permission. */
export function micApiAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

export async function startRecording(): Promise<void> {
  // macOS strips navigator.mediaDevices entirely when the app bundle declares no
  // NSMicrophoneUsageDescription (see src-tauri/Info.plist) or the user has
  // denied the app at the system level — the API's ABSENCE is the signal, so
  // there is nothing to catch further down. Both callers surface this message.
  if (!micApiAvailable()) {
    throw new Error(
      'This app can’t reach the microphone. On macOS, open System Settings → '
      + 'Privacy & Security → Microphone, allow Tavern Sheet, then restart it. '
      + '(If Tavern Sheet isn’t listed, you’re on a build from before microphone '
      + 'support was declared — update and try again.)',
    );
  }
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

// ── Speech-to-text (Whisper via transformers.js, in a dedicated worker) ─────
//
// Transcription runs inside src/utils/sttWorker.ts so the long synchronous
// WASM computation never blocks the main thread (which owns the DM Console's
// 3D viewport render loop — a main-thread transcription visibly freezes the
// character model every time a player finishes talking). See the worker's
// header comment for why onnxruntime-web's own proxy mode couldn't be used.
// If the worker itself fails to load (never seen, but conceivable in an
// exotic embedder), transcription falls back to running on the main thread —
// functional, just with the viewport freeze back.

type Transcriber = (input: Float32Array) => Promise<{ text: string } | { text: string }[]>;
let mainThreadTranscriberPromise: Promise<Transcriber> | null = null;

function getMainThreadTranscriber(): Promise<Transcriber> {
  if (!mainThreadTranscriberPromise) {
    const model = import.meta.env.VITE_WHISPER_MODEL || 'Xenova/whisper-base.en';
    // dtype: 'fp32' — the default auto-selected quantized variant is missing a
    // dequantization scale for this model/backend combo (WASM); fp32 always works.
    mainThreadTranscriberPromise = pipeline('automatic-speech-recognition', model, { dtype: 'fp32' }) as unknown as Promise<Transcriber>;
  }
  return mainThreadTranscriberPromise;
}

// Sentinel distinguishing "the worker script itself died" (→ fall back to the
// main thread) from a real per-request error like a failed model download
// (→ surface to the caller; retrying on the main thread would just fail the
// same way after a second wasted download attempt).
const STT_WORKER_DEAD = '__stt_worker_dead__';

let sttWorker: Worker | null = null;
let sttWorkerDead = false;
let nextSttRpcId = 0;
const pendingSttRpcs = new Map<number, { resolve: (text: string) => void; reject: (err: Error) => void }>();

function getSttWorker(): Worker | null {
  if (sttWorkerDead) return null;
  if (!sttWorker) {
    try {
      sttWorker = new Worker(new URL('./sttWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      sttWorkerDead = true;
      return null;
    }
    sttWorker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; text?: string; error?: string }>) => {
      const rpc = pendingSttRpcs.get(e.data.id);
      if (!rpc) return;
      pendingSttRpcs.delete(e.data.id);
      if (e.data.ok) rpc.resolve(e.data.text || '');
      else rpc.reject(new Error(e.data.error || 'Transcription failed'));
    };
    // Fires only when the worker script itself fails to load or throws at the
    // top level — per-request errors come back as { ok: false } messages.
    sttWorker.onerror = () => {
      sttWorkerDead = true;
      sttWorker?.terminate();
      sttWorker = null;
      for (const rpc of pendingSttRpcs.values()) rpc.reject(new Error(STT_WORKER_DEAD));
      pendingSttRpcs.clear();
    };
  }
  return sttWorker;
}

// `samples` is structured-cloned rather than transferred: if the worker dies
// after the message is queued but before it runs, the fallback path below
// still needs an intact buffer (a transfer would have detached it). At 16kHz
// mono the clone is ~2MB/30s of speech — negligible next to the inference.
async function sttRequest(type: 'warmup' | 'transcribe', samples?: Float32Array): Promise<string> {
  const worker = getSttWorker();
  if (worker) {
    try {
      return await new Promise<string>((resolve, reject) => {
        const id = nextSttRpcId++;
        pendingSttRpcs.set(id, { resolve, reject });
        worker.postMessage({ id, type, samples });
      });
    } catch (e) {
      if (!(e instanceof Error) || e.message !== STT_WORKER_DEAD) throw e;
      // fall through to the main-thread path
    }
  }
  const transcriber = await getMainThreadTranscriber();
  if (type === 'warmup' || !samples) return '';
  const result = await transcriber(samples);
  return (Array.isArray(result) ? result[0]?.text : result.text) || '';
}

/** Kicks off the (large, one-time) model download so the first utterance isn't slow. */
export function warmupSTT(): Promise<unknown> {
  return sttRequest('warmup');
}

/** How many consecutive repeats of the exact same word/phrase are treated
 *  as ordinary speech ("no, no, no!") rather than a runaway loop. Reported
 *  live: saying "locket" about ten times came back as "lock it" fifty times
 *  — Whisper (and STT decoders generally) getting stuck re-emitting the same
 *  tokens is a well-documented failure mode, not something specific to this
 *  app's audio capture, so this collapses it after the fact rather than
 *  trying to prevent it at the model level. */
const MAX_CONSECUTIVE_PHRASE_REPEATS = 3;

/** Longest phrase (in words) checked for a repeating loop — covers a
 *  looping single word up through a short looping phrase like "lock it lock
 *  it lock it...". A real transcript essentially never has an identical
 *  4+-word run repeat this many times back to back, so there's no realistic
 *  false-positive risk at this length. */
const MAX_LOOP_PHRASE_WORDS = 4;

/** Collapses a Whisper hallucination loop — the same word or short phrase
 *  repeated far more times than anyone would actually say it — down to
 *  MAX_CONSECUTIVE_PHRASE_REPEATS-worth of repeats (currently `2`, the same
 *  number used below), rather than removing the repetition entirely: a
 *  player emphatically repeating something 2-3 times is normal speech and
 *  must survive untouched, only the runaway case should get cut. Checks
 *  phrase lengths shortest-first (1 word, then 2, up to
 *  MAX_LOOP_PHRASE_WORDS) so a two-word loop collapses at its true 2-word
 *  period instead of only ever being caught (less cleanly) at a longer,
 *  coincidentally-also-repeating window — a shorter genuine period always
 *  fails to match at a length that doesn't evenly divide it, so trying
 *  short lengths first never mis-fragments a real longer phrase. */
export function collapseHallucinatedRepeats(text: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    let collapsed = false;
    for (let len = 1; len <= Math.min(MAX_LOOP_PHRASE_WORDS, words.length - i); len++) {
      const phrase = words.slice(i, i + len).join(' ').toLowerCase();
      let repeats = 1;
      while (
        i + (repeats + 1) * len <= words.length &&
        words.slice(i + repeats * len, i + (repeats + 1) * len).join(' ').toLowerCase() === phrase
      ) {
        repeats++;
      }
      if (repeats > MAX_CONSECUTIVE_PHRASE_REPEATS) {
        const keep = Math.min(repeats, 2);
        for (let k = 0; k < keep; k++) out.push(...words.slice(i, i + len));
        i += repeats * len;
        collapsed = true;
        break;
      }
    }
    if (!collapsed) { out.push(words[i]); i++; }
  }
  return out.join(' ');
}

/** Stops recording and transcribes it. Returns '' for silence/no speech. */
export async function stopAndTranscribe(): Promise<string> {
  const blob = await stopRecording();
  const samples = await blobToMono16k(blob);
  if (samples.length < 1600) return ''; // < 0.1s
  return collapseHallucinatedRepeats((await sttRequest('transcribe', samples)).trim());
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
    const audio: SinkableAudioElement = new Audio(url);
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
    applyAudioOutputDevice(audio)
      .then(() => audio.play())
      .catch((e) => { cleanup(); reject(e); });
  });
}

/** Cleans a line of narration for TTS ONLY — never for anything a human
 *  reads. Kokoro's espeak-ng-based phonemizer (same underlying phonemizer
 *  Piper used, before this app switched engines) announces certain Unicode
 *  punctuation by its character NAME instead of treating it as a pause: an
 *  em dash (—)
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
 *  pitch_factor for `pitch`, DEFAULT_LENGTH_SCALE for `speed`) — none of the
 *  three are honored on the browser fallback, which has no equivalent
 *  per-NPC voice/pitch/speed switching. `speed` is Piper's own
 *  `--length-scale` (smaller = faster) — independent of `pitch`, which only
 *  shifts tone via a WAV-resample trick; the two can be set separately. */
export async function prepareSpeech(text: string, voiceId?: string, pitch?: string, speed?: number): Promise<PreparedSpeech> {
  const clean = sanitizeForTTS(text);
  if (!clean.trim()) return { kind: 'empty' };
  if (isTauri()) {
    try {
      const base64Wav = await invoke<string>('speak_text', { text: clean, voiceId, pitch, speed });
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
export async function speak(text: string, voiceId?: string, pitch?: string, speed?: number): Promise<void> {
  return playPrepared(await prepareSpeech(text, voiceId, pitch, speed));
}

// Cache of already-synthesized voice-preview clips, keyed by voice+pitch+speed
// (the preview line itself is fixed, so it's deliberately NOT part of the key).
// Auditioning voices means re-playing the same handful of candidates over and
// over; without this, every replay pays Kokoro's full synthesis cost again —
// which is the slow part on a CPU-only machine. Each clip is a ~1-2s WAV as
// base64 (tens of KB), so a whole session's worth of auditions is a few MB at
// most; no eviction needed for the lifetime of the page.
const previewCache = new Map<string, string>();

/** Like speak(), but for the History dialog's voice-audition button: caches
 *  the synthesized clip per voice/pitch/speed so re-previewing a voice you've
 *  already heard is instant instead of re-running Kokoro on every click. Only
 *  the first play of each distinct voice/pitch/speed pays synthesis cost. */
export async function previewVoice(text: string, voiceId?: string, pitch?: string, speed?: number): Promise<void> {
  const key = `${voiceId ?? ''}|${pitch ?? ''}|${speed ?? ''}`;
  let b64 = previewCache.get(key);
  if (b64 === undefined && isTauri()) {
    try {
      b64 = await invoke<string>('speak_text', { text: sanitizeForTTS(text), voiceId, pitch, speed });
      previewCache.set(key, b64);
    } catch (e) {
      console.warn('Kokoro preview failed, falling back to browser speechSynthesis:', e);
    }
  }
  if (b64) {
    // Fresh object URL each play — playPiperUrl revokes it once playback ends,
    // so the cache keeps the base64, not a one-shot URL.
    return playPiperUrl(URL.createObjectURL(base64ToBlob(b64, 'audio/wav')));
  }
  return speakWithBrowserTTS(sanitizeForTTS(text));
}

export function stopSpeaking(): void {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (currentForceResolve) { const resolve = currentForceResolve; currentForceResolve = null; resolve(); }
}
