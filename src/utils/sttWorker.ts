/**
 * sttWorker.ts — runs Whisper (transformers.js) in a dedicated Web Worker.
 *
 * Transcription is one long *synchronous* WASM computation; on the JS main
 * thread it would stall requestAnimationFrame and visibly freeze the DM
 * Console's 3D viewport for the whole transcription. onnxruntime-web's own
 * worker-proxy mode (`env.backends.onnx.wasm.proxy = true`) is supposed to
 * solve this, but its internally-constructed worker fails to load in the
 * packaged Tauri/WebView2 app ("no available backend found. ERR: [wasm]"),
 * so instead the entire pipeline lives in this Vite-compiled module worker —
 * Vite emits it as a real chunk that WebView2 loads like any other asset.
 *
 * Protocol: { id, type: 'warmup' | 'transcribe', samples? } in,
 *           { id, ok: true, text } | { id, ok: false, error } out.
 */
import { pipeline } from '@huggingface/transformers';

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

interface SttRequest {
  id: number;
  type: 'warmup' | 'transcribe';
  samples?: Float32Array;
}

self.onmessage = async (e: MessageEvent<SttRequest>) => {
  const { id, type, samples } = e.data;
  try {
    const transcriber = await getTranscriber();
    let text = '';
    if (type === 'transcribe' && samples) {
      const result = await transcriber(samples);
      text = (Array.isArray(result) ? result[0]?.text : result.text) || '';
    }
    self.postMessage({ id, ok: true, text });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
