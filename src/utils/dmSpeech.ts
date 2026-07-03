/**
 * dmSpeech.ts — mic capture, local Whisper STT, and TTS for the in-app DM Console.
 *
 * Everything here runs inside the webview — no external processes, no installs.
 * STT is Whisper via transformers.js (WASM/WebGPU, model downloads once on first
 * use and is cached by the browser). TTS is the platform's built-in
 * speechSynthesis (instant, zero setup); swap synthesizeAndSpeak's body for a
 * nicer voice later if desired.
 */
import { pipeline } from '@huggingface/transformers';

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

/** Speaks text with the platform's built-in voice. Resolves when finished. */
export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window) || !text.trim()) return resolve();
    window.speechSynthesis.cancel(); // don't queue over a previous line
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
