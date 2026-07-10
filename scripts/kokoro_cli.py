"""
kokoro_cli.py — persistent stdin-driven TTS worker, frozen with PyInstaller
into public/tts/kokoro_cli.exe (see scripts/kokoro_cli_requirements.txt for
the pinned build environment and public/tts/NOTICE.txt for licensing).

Mirrors Piper's own CLI contract exactly (see the module this replaced,
src-tauri/src/tts.rs's old PersistentPiper code) so the Rust side's existing
directory-polling detection (list new files, wait for size to stabilize)
needed no protocol changes: the model loads ONCE at startup, then the
process reads one JSON object per line from stdin for as long as stdin stays
open, writing one WAV file per line into the given output directory. Closing
stdin (or killing the process) is the only way to stop it — there is no
explicit "quit" command, same as Piper.

Usage: kokoro_cli.exe <onnx_path> <voices_bin_path> <output_dir>
Stdin (one JSON object per line): {"text": str, "voice": str, "speed": float}
  - "voice" defaults to "af_heart" if omitted.
  - "speed" defaults to 1.0 (Kokoro's own native scale: >1 faster, <1
    slower — the INVERSE of Piper's length-scale convention, which
    src-tauri/src/tts.rs accounts for at the call site so the app's own
    stored/UI "pace factor" meaning, bigger = slower, stays unchanged for
    the user).
Prints "READY" (and flushes) once the model has finished loading — the Rust
side doesn't currently wait on this, but it's there for anyone debugging a
slow first-request directly against the process.
On a per-line failure (bad JSON, unknown voice, synthesis error), prints
"ERROR: <message>" to stderr and continues the loop rather than exiting —
one bad line must never take down an otherwise-healthy warm process.
"""

import json
import sys
import time
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

DEFAULT_VOICE = "af_heart"


def lang_for_voice(voice: str) -> str:
    """British voices (bf_*/bm_*) need en-gb phonemization rules or they get
    mispronounced with American rules; every other voice in this app's
    catalog is American. Falls back to en-us for anything unrecognized
    rather than erroring — a wrong phonemizer accent is a quality miss, not
    a crash-worthy failure."""
    return "en-gb" if voice.startswith("b") else "en-us"


def main() -> None:
    if len(sys.argv) < 4:
        print("usage: kokoro_cli.exe <onnx_path> <voices_bin_path> <output_dir>", file=sys.stderr)
        sys.exit(1)

    onnx_path, voices_path, output_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    kokoro = Kokoro(onnx_path, voices_path)
    print("READY", flush=True)

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            text = request["text"]
            voice = request.get("voice") or DEFAULT_VOICE
            speed = float(request.get("speed") or 1.0)
            samples, sample_rate = kokoro.create(text, voice=voice, speed=speed, lang=lang_for_voice(voice))
            # Same "unique filename per line, Rust side watches the
            # directory for whatever's new" contract Piper used — no reply
            # is written to stdout, the file's appearance IS the signal.
            out_path = Path(output_dir) / f"{time.time_ns()}.wav"
            sf.write(str(out_path), samples, sample_rate)
        except Exception as e:  # noqa: BLE001 - one bad line must never kill the warm process
            print(f"ERROR: {e}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
