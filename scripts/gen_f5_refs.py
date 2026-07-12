"""gen_f5_refs.py — generate the F5 reference-clip pack from Kokoro.

Part of the F5 runtime build (see scripts/build-f5-runtime.ps1 + the plan §D).
Has Kokoro speak one fixed reference sentence in every catalog voice and writes
each as refs/<voice_id>.wav plus a matching refs/<voice_id>.txt transcript — the
(ref_audio, ref_text) pair F5 clones from at synthesis time.

Bootstrapping the refs from Kokoro (rather than shipping human recordings) is
what keeps a voice's identity IDENTICAL across the Kokoro↔F5 toggle: F5 clones
the very clip Kokoro itself would have produced for that voice id, so an NPC
stays itself when the engine flips (de-risk task #83 confirmed identity survives
this). It also means the F5 catalog needs zero curation — it's mechanically the
same 28 voices, same ids, same gender/accent buckets.

The catalog below MUST stay in sync with VOICE_CATALOG in src-tauri/src/tts.rs
(and the other three copies its doc comment lists: campaign.rs's
BASE_CLAUDE_MD / build_voice_reconciliation_prompt, and dmActions.ts's
VOICE_CATALOG_IDS) — same id→Kokoro-voice mapping, so refs/<id>.wav is the exact
F5 twin of the Kokoro voice that id selects. tts.rs's f5_ref_voice_id resolves a
stored NPC voice id (including legacy Piper aliases) to one of these ids, so
every clip this writes has a consumer and vice-versa.

Usage: python gen_f5_refs.py <kokoro_exe> <onnx> <voices> <out_refs_dir>
"""

import json
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# (catalog id, underlying Kokoro voice) — a verbatim copy of VOICE_CATALOG in
# src-tauri/src/tts.rs. Keep in lockstep with that file (and the three other
# copies) — a drift here means an NPC's F5 clip is cloned from a different Kokoro
# voice than its Kokoro clip, breaking identity across the toggle.
CATALOG = [
    ("narrator", "af_heart"),
    ("female-us-1", "af_alloy"),
    ("female-us-2", "af_aoede"),
    ("female-us-3", "af_bella"),
    ("female-us-4", "af_jessica"),
    ("female-us-5", "af_kore"),
    ("female-us-6", "af_nicole"),
    ("female-us-7", "af_nova"),
    ("female-us-8", "af_river"),
    ("female-us-9", "af_sarah"),
    ("female-us-10", "af_sky"),
    ("male-us-1", "am_adam"),
    ("male-us-2", "am_echo"),
    ("male-us-3", "am_eric"),
    ("male-us-4", "am_fenrir"),
    ("male-us-5", "am_liam"),
    ("male-us-6", "am_michael"),
    ("male-us-7", "am_onyx"),
    ("male-us-8", "am_puck"),
    ("male-us-9", "am_santa"),
    ("female-gb-1", "bf_alice"),
    ("female-gb-2", "bf_emma"),
    ("female-gb-3", "bf_isabella"),
    ("female-gb-4", "bf_lily"),
    ("male-gb-1", "bm_daniel"),
    ("male-gb-2", "bm_fable"),
    ("male-gb-3", "bm_george"),
    ("male-gb-4", "bm_lewis"),
]

# A fixed, phonetically varied, tone-neutral reference line (~8s spoken). F5
# clones prosody as well as timbre from the ref, so this stays deliberately
# even — no shouting or whispering — to give each voice a clean, neutral base;
# per-NPC expressive delivery (e.g. the Carrow whisper) is a separate custom
# reference clip, not the catalog default. This exact string is also written as
# each clip's transcript, so it MUST match what Kokoro speaks.
REF_TEXT = (
    "The old road winds north through the hills, past the standing stones and "
    "the quiet water, where the wind never quite settles."
)


def _wait_for_new_stable_wav(out_dir: Path, before: set, timeout_s: float = 30.0) -> Path:
    """Polls out_dir for a file that wasn't in `before`, then waits for its size
    to stop changing — the same create-then-write race guard tts.rs uses
    (wait_for_file_to_stabilize). Returns the new file's path or raises."""
    deadline = time.monotonic() + timeout_s
    new_path = None
    while time.monotonic() < deadline:
        added = set(out_dir.iterdir()) - before
        if added:
            new_path = added.pop()
            break
        time.sleep(0.05)
    if new_path is None:
        raise TimeoutError("Kokoro produced no output within the timeout")

    last_size = -1
    while time.monotonic() < deadline:
        size = new_path.stat().st_size
        if size > 0 and size == last_size:
            return new_path
        last_size = size
        time.sleep(0.03)
    return new_path


def main() -> None:
    if len(sys.argv) < 5:
        print("usage: gen_f5_refs.py <kokoro_exe> <onnx> <voices> <out_refs_dir>", file=sys.stderr)
        sys.exit(1)

    kokoro_exe, onnx, voices, out_refs_dir = (Path(sys.argv[i]) for i in range(1, 5))
    for p in (kokoro_exe, onnx, voices):
        if not p.exists():
            print(f"ERROR: missing input: {p}", file=sys.stderr)
            sys.exit(1)
    out_refs_dir.mkdir(parents=True, exist_ok=True)

    tmp_out = Path(tempfile.mkdtemp(prefix="f5-refs-kokoro-"))
    # One persistent Kokoro process for all 28 voices — voice is a per-request
    # field, so no respawns (exactly the property tts.rs relies on).
    proc = subprocess.Popen(
        [str(kokoro_exe), str(onnx), str(voices), str(tmp_out)],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    assert proc.stdin is not None

    try:
        for voice_id, kokoro_voice in CATALOG:
            before = set(tmp_out.iterdir())
            proc.stdin.write(json.dumps({"text": REF_TEXT, "voice": kokoro_voice, "speed": 1.0}) + "\n")
            proc.stdin.flush()
            wav = _wait_for_new_stable_wav(tmp_out, before)
            size = wav.stat().st_size
            if size < 1000:
                raise RuntimeError(f"{voice_id} ({kokoro_voice}) produced a {size}-byte clip — likely a bad voice")
            shutil.copyfile(wav, out_refs_dir / f"{voice_id}.wav")
            (out_refs_dir / f"{voice_id}.txt").write_text(REF_TEXT, encoding="utf-8")
            wav.unlink(missing_ok=True)
            print(f"  {voice_id:<14} <- {kokoro_voice:<12} ({size:,} bytes)")
    finally:
        proc.stdin.close()
        proc.wait(timeout=15)
        shutil.rmtree(tmp_out, ignore_errors=True)

    written = sorted(p.stem for p in out_refs_dir.glob("*.wav"))
    expected = sorted(vid for vid, _ in CATALOG)
    if written != expected:
        print(f"ERROR: wrote {len(written)} clips, expected {len(expected)}", file=sys.stderr)
        sys.exit(1)
    print(f"OK: wrote {len(written)} reference clips + transcripts to {out_refs_dir}")


if __name__ == "__main__":
    main()
