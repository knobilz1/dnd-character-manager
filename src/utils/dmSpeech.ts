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

function speakWithBrowserTTS(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || !text.trim()) return resolve();
    window.speechSynthesis.cancel(); // don't queue over a previous line
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

function speakWithPiper(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    invoke<string>('speak_text', { text }).then((base64Wav) => {
      const url = URL.createObjectURL(base64ToBlob(base64Wav, 'audio/wav'));
      const audio = new Audio(url);
      currentAudio = audio;
      const cleanup = () => {
        URL.revokeObjectURL(url);
        if (currentAudio === audio) currentAudio = null;
      };
      audio.onended = () => { cleanup(); resolve(); };
      audio.onerror = () => { cleanup(); reject(new Error('Piper audio playback failed')); };
      audio.play().catch((e) => { cleanup(); reject(e); });
    }, reject);
  });
}

/** Speaks text aloud — bundled Piper voice when available, falling back to
 *  the platform's built-in speechSynthesis otherwise. Resolves when finished. */
export async function speak(text: string): Promise<void> {
  if (!text.trim()) return;
  if (isTauri()) {
    try {
      return await speakWithPiper(text);
    } catch (e) {
      console.warn('Piper TTS failed, falling back to browser speechSynthesis:', e);
    }
  }
  return speakWithBrowserTTS(text);
}

export function stopSpeaking(): void {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
