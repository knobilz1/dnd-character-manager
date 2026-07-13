"""
f5_cli.py — persistent stdin-driven F5-TTS worker, the GPU high-fidelity
counterpart to scripts/kokoro_cli.py. Ships inside the downloaded F5 runtime
archive (embeddable Python + CUDA PyTorch + f5-tts + the model + the catalog
reference clips), NOT in the installer — see src-tauri/src/tts.rs's
ensure_f5_runtime_available and the plan for why F5 is an opt-in, GPU-gated,
download-on-demand engine rather than a bundled one.

Contract is byte-for-byte the same as kokoro_cli.py so the Rust side's existing
output-directory polling (list new files, wait for size to stabilize) needs no
protocol changes: the model loads ONCE at startup on CUDA, then one JSON object
per line from stdin produces one WAV file in the output directory. Closing stdin
(or killing the process) is the only stop — there is no explicit quit command.

Usage: python f5_cli.py <refs_dir> <output_dir>
  <refs_dir> holds one <voice_id>.wav + <voice_id>.txt (its transcript) per
  catalog voice, generated from Kokoro so identity matches the Kokoro engine
  (see plan §D). Model checkpoint/vocab paths come from the F5_CKPT / F5_VOCAB
  env vars if set (the runtime archive sets them), else F5TTS()'s default.
  F5_VOCODER, if set, points at a local dir with config.yaml + pytorch_model.bin
  for the Vocos vocoder (the runtime archive bundles this so first synthesis
  never silently reaches out to the HF Hub); unset falls back to F5TTS()'s
  live-download default.

Stdin (one JSON object per line):
  {"text": str, "voice": str, "speed": float,
   "ref_file": str?, "ref_text": str?, "nfe": int?}
  - Catalog voice: give "voice" (a catalog id); the clip+transcript are read
    from <refs_dir>/<voice>.wav / .txt.
  - Custom voice (the whisper path, plan §G): give "ref_file" + "ref_text"
    directly; "voice" is then ignored. Rust resolves a `custom-*` voice id to
    these before writing the request (see set_custom_voice / speak_text).
  - "speed" defaults to 1.0 (F5's native scale: >1 faster — same direction as
    Kokoro, so tts.rs's existing pace-factor→native conversion is reused
    unchanged). "nfe" defaults to 32 (quality; 16 is the faster/lower knob).

Prints "READY" (flushed) once the model is warm. On a per-line failure prints
"ERROR: <message>" to stderr and continues — one bad line must never take down
an otherwise-healthy warm process.
"""

import json
import os
import sys
import time
from pathlib import Path

import soundfile as sf

# torchaudio's default I/O can route through torchcodec, which needs FFmpeg
# shared DLLs the runtime doesn't ship. Force the soundfile backend so
# load/save can never blow up mid-request (same fix used in the GPU spike).
import torch  # noqa: E402
import torchaudio  # noqa: E402


def _sf_load(path, *a, **k):
    data, sr = sf.read(path, dtype="float32", always_2d=True)
    return torch.from_numpy(data.T), sr


def _sf_save(path, tensor, sr, *a, **k):
    arr = tensor.detach().cpu().numpy() if hasattr(tensor, "detach") else tensor
    if arr.ndim == 2:
        arr = arr.T
    sf.write(path, arr, sr)


torchaudio.load = _sf_load
torchaudio.save = _sf_save

from f5_tts.api import F5TTS  # noqa: E402

DEFAULT_NFE = 32


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: f5_cli.py <refs_dir> <output_dir>", file=sys.stderr)
        sys.exit(1)

    refs_dir, output_dir = Path(sys.argv[1]), Path(sys.argv[2])
    output_dir.mkdir(parents=True, exist_ok=True)

    if not torch.cuda.is_available():
        # The engine is CUDA-gated in the UI (see probe_cuda); reaching here
        # without CUDA means a broken install. Fail loudly at startup so the
        # Rust side's spawn fails and speak_text falls back to Kokoro, rather
        # than silently synthesizing dog-slow on CPU.
        print("ERROR: CUDA not available", file=sys.stderr, flush=True)
        sys.exit(1)

    kwargs = {"device": "cuda"}
    if os.environ.get("F5_CKPT"):
        kwargs["ckpt_file"] = os.environ["F5_CKPT"]
    if os.environ.get("F5_VOCAB"):
        kwargs["vocab_file"] = os.environ["F5_VOCAB"]
    if os.environ.get("F5_VOCODER"):
        kwargs["vocoder_local_path"] = os.environ["F5_VOCODER"]
    f5 = F5TTS(**kwargs)

    print("READY", flush=True)

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            text = request["text"]
            speed = float(request.get("speed") or 1.0)
            nfe = int(request.get("nfe") or DEFAULT_NFE)

            ref_file = request.get("ref_file")
            ref_text = request.get("ref_text")
            if not ref_file:
                # Catalog voice: resolve the bundled Kokoro-bootstrapped clip.
                voice = request.get("voice") or ""
                ref_file = str(refs_dir / f"{voice}.wav")
                txt_path = refs_dir / f"{voice}.txt"
                ref_text = txt_path.read_text(encoding="utf-8").strip() if txt_path.exists() else ""

            wav, sample_rate, _ = f5.infer(
                ref_file=ref_file,
                ref_text=ref_text or "",
                gen_text=text,
                nfe_step=nfe,
                speed=speed,
                remove_silence=True,
                show_info=lambda *a, **k: None,
            )
            # Same "unique filename per line, Rust watches the directory for
            # whatever's new" contract kokoro_cli.py uses — the file appearing
            # IS the signal; nothing is written to stdout.
            out_path = output_dir / f"{time.time_ns()}.wav"
            sf.write(str(out_path), wav, sample_rate)
        except Exception as e:  # noqa: BLE001 - one bad line must never kill the warm process
            print(f"ERROR: {e}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
