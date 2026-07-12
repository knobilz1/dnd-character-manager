//! tts.rs — local, in-app text-to-speech via a bundled Kokoro binary.
//!
//! Kokoro (https://github.com/thewh1teagle/kokoro-onnx, MIT wrapper around
//! the Apache-2.0 hexgrad/Kokoro-82M model weights) ships only as a Python
//! package, so `public/tts/kokoro_cli.exe` is a standalone build of
//! scripts/kokoro_cli.py frozen with PyInstaller — no Python installation
//! needed at runtime (see scripts/kokoro_cli_requirements.txt for exact
//! build steps). It's invoked here as a plain subprocess (same
//! Command+stdin-piping shape as dm.rs's `claude` call), never linked into
//! this app's own binary — the same "mere aggregation" pattern previously
//! used for Piper (which this replaced) and also used for bundling e.g.
//! ffmpeg: one of the frozen exe's own bundled dependencies
//! (phonemizer-fork, used internally for text-to-phoneme) is GPL-3.0, which
//! keeps Tavern Sheet's own code unaffected but does mean this specific
//! redistributed binary carries GPL code. See public/tts/NOTICE.txt +
//! KOKORO_ONNX_LICENSE.txt + KOKORO_MODEL_LICENSE.txt + PHONEMIZER_LICENSE.txt
//! for the license text shipped alongside the binary.
//!
//! Windows-only for now (see tauri.conf.json's `bundle.resources`) — the
//! frontend (dmSpeech.ts) falls back to the browser's own speechSynthesis if
//! this command errors, so other platforms keep working without this piece.
//!
//! **Kokoro runs as a single persistent warm process**, not spawned fresh
//! per call — confirmed live that `kokoro_cli.exe <onnx> <voices> <dir>`
//! stays running and keeps accepting new JSON lines on stdin indefinitely
//! (only exits when stdin is closed), each line producing one new WAV file
//! in the output directory. Unlike Piper, Kokoro's voice and speaking rate
//! are both *per-request* parameters (not fixed at process startup), so —
//! unlike the old PersistentPiper pool, which had to keep several warm
//! processes around because a voice/speed switch meant a full respawn —
//! exactly one warm process ever needs to exist, and it serves every voice
//! and every speed the app ever asks for. Keeping it alive across turns
//! avoids paying process spawn + ONNX Runtime session creation overhead
//! every single time.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// Curated catalog of NPC voices, plus the narrator voice as just another
/// entry (see ensure_kokoro_model_available's doc comment for why the model
/// itself doesn't need special-casing the way Piper's bundled-vs-downloaded
/// split did). Each entry is (id, Kokoro voice name) — see
/// https://github.com/thewh1teagle/kokoro-onnx for the full published voice
/// list this was drawn from. Kokoro's built-in English coverage is only
/// "American" (`af_`/`am_` prefixes) and "British" (`bf_`/`bm_`) — no
/// regional accent variety the way Piper's curated VCTK subset had
/// (Scottish/Irish/Welsh/Australian/South African); that variety is a real,
/// accepted loss from switching engines, not an oversight (confirmed
/// against Kokoro's own voice list — those accents simply don't exist in
/// it). `"narrator"` is reserved to `af_heart` (Kokoro's own flagship/
/// default voice) and deliberately excluded from the numbered female-us-*
/// pool below so an NPC assigned female-us-1..10 never accidentally sounds
/// identical to the narrator. Keep this in sync with BASE_CLAUDE_MD's voice
/// catalog list (campaign.rs), campaign.rs's build_voice_reconciliation_prompt,
/// and dmActions.ts's VOICE_CATALOG_IDS — all four must agree on valid ids.
const VOICE_CATALOG: &[(&str, &str)] = &[
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
];

/// Used whenever a line has no NPC voice assigned (plain narration, or an
/// NPC nobody's assigned a voice to yet).
const DEFAULT_VOICE_ID: &str = "narrator";

/// Every catalog id sharing `voice_id`'s gender+accent bucket — the part
/// before the trailing number, so `male-gb-2` yields all `male-gb-*`, in
/// catalog order.
///
/// Lets campaign.rs resolve a voice collision without keeping its own copy of
/// the catalog. Alternatives stay inside the requested bucket on purpose: the
/// gender prefix is a hard constraint (a wrong-gender voice is the worst
/// mistake this system can make), and the accent carries the register whoever
/// picked the original id deliberately chose.
///
/// Empty for `"narrator"` — reserved, and deliberately excluded from every
/// bucket so an NPC can never be handed the narration's own voice — and for
/// any id not in the catalog.
pub fn sibling_voice_ids(voice_id: &str) -> Vec<&'static str> {
    let Some((bucket, _)) = voice_id.rsplit_once('-') else {
        return Vec::new();
    };
    VOICE_CATALOG
        .iter()
        .map(|(id, _)| *id)
        .filter(|id| *id != DEFAULT_VOICE_ID)
        .filter(|id| id.rsplit_once('-').is_some_and(|(b, _)| b == bucket))
        .collect()
}

/// Accent-specific ids from the old Piper catalog that no longer exist in
/// Kokoro's (US/GB-only) catalog, mapped to a same-gender replacement — a
/// pre-existing campaign's npc_voices.json can still carry these, and
/// without this mapping they'd fall back to the narrator voice, which is
/// FEMALE (`af_heart`): a male NPC saved as "male-scottish-1" suddenly
/// speaking in the female narrator's voice is exactly the wrong-gender bug
/// class the voice system exists to prevent, silently reintroduced by the
/// engine swap. Gender is the non-negotiable axis preserved here; the lost
/// accent just becomes plain American/British. Replacements are spread
/// across different same-gender ids (not all onto one) so a campaign whose
/// cast leaned on several distinct accents doesn't collapse into everyone
/// sharing a single voice.
const LEGACY_VOICE_ALIASES: &[(&str, &str)] = &[
    ("male-scottish-1", "male-gb-2"),
    ("male-scottish-2", "male-gb-3"),
    ("female-scottish-1", "female-gb-2"),
    ("male-irish-1", "male-gb-1"),
    ("male-irish-2", "male-gb-4"),
    ("female-irish-1", "female-gb-3"),
    ("female-welsh-1", "female-gb-4"),
    ("male-northernirish-1", "male-us-6"),
    ("female-northernirish-1", "female-gb-1"),
    ("male-australian-1", "male-us-7"),
    ("male-southafrican-1", "male-us-8"),
    ("female-southafrican-1", "female-us-5"),
];

/// Pure: looks up a voice id in the catalog — checking LEGACY_VOICE_ALIASES
/// first, so an id saved under the old Piper catalog still resolves to a
/// same-gender voice (see that constant's doc comment) — or an error naming
/// it as unknown. Called before any filesystem/network access so a genuinely
/// bad id from a stale/hallucinated dm-actions value fails fast and cheaply.
/// Callers (speak_text/warmup_tts) treat that failure the same harmless way
/// an unknown value always has here — falling back to the narrator voice
/// rather than erroring the whole turn.
fn catalog_kokoro_voice(voice_id: &str) -> Result<&'static str, String> {
    let resolved = LEGACY_VOICE_ALIASES
        .iter()
        .find(|(legacy, _)| *legacy == voice_id)
        .map(|(_, replacement)| *replacement)
        .unwrap_or(voice_id);
    VOICE_CATALOG
        .iter()
        .find(|(id, _)| *id == resolved)
        .map(|(_, kokoro_voice)| *kokoro_voice)
        .ok_or_else(|| format!("Unknown voice id \"{voice_id}\""))
}

/// Where to look for a bundled TTS resource file, in priority order. Pulled
/// out as pure logic (no AppHandle) so it's directly testable — mirrors
/// dm.rs's `build_claude_args`.
///
/// `tauri dev`/`cargo run` never copy `bundle.resources` anywhere (that only
/// happens during actual packaging), so the packaged `resource_dir()` won't
/// have these files during development — the same reason `modelUrl.ts`
/// bypasses `resourceDir()` entirely in dev and serves straight from
/// `public/`. Here we just try the packaged location first, falling back to
/// the source `public/tts/` folder next to the crate.
fn resource_candidates(resource_dir: Option<PathBuf>, filename: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(dir) = resource_dir {
        candidates.push(dir.join("tts").join(filename));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("public")
            .join("tts")
            .join(filename),
    );
    candidates
}

fn find_resource(app: &AppHandle, filename: &str) -> Result<PathBuf, String> {
    resource_candidates(app.path().resource_dir().ok(), filename)
        .into_iter()
        .find(|p| p.exists())
        .ok_or_else(|| format!("Couldn't find bundled TTS resource '{filename}'"))
}

// ── Kokoro model: lazy download + cache ──────────────────────────────────
//
// Unlike Piper (one .onnx file per voice, so only the narrator's was worth
// bundling and every other voice was a separate download), Kokoro's whole
// catalog above lives in exactly two shared files — one model, one voices
// pack — so there's nothing to bundle-vs-download per voice: either both
// files are on disk already, or neither is, and getting either covers every
// catalog id at once. Not bundled in the installer at all (~200MB combined,
// see NOTICE.txt) — downloaded once on first-ever synthesis and cached
// forever after, same "lazy download, cache forever" shape already used for
// the Whisper STT model in dmSpeech.ts.

const KOKORO_RELEASE_BASE_URL: &str = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0";
const KOKORO_MODEL_FILENAME: &str = "kokoro-v1.0.fp16.onnx";
const KOKORO_VOICES_FILENAME: &str = "voices-v1.0.bin";

/// Where the downloaded model files are cached — lives in app-data, survives
/// forever, same directory Piper's downloaded (non-bundled) voices used to
/// live in.
fn kokoro_model_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("tts_voices"))
}

/// Streams `url` straight to `dest` (no full-file buffering in memory — the
/// model file alone is ~175MB) via a `.part` temp file renamed into place on
/// success, so a download that dies partway through never leaves a corrupt
/// file at the real path for a later call to mistake as complete.
fn download_to_file(url: &str, dest: &Path) -> Result<(), String> {
    let resp = ureq::get(url).call().map_err(|e| format!("Model download failed ({url}): {e}"))?;
    let tmp = dest.with_extension("part");
    {
        let mut file = std::fs::File::create(&tmp).map_err(|e| format!("Couldn't create {}: {e}", tmp.display()))?;
        std::io::copy(&mut resp.into_reader(), &mut file).map_err(|e| format!("Model download write failed: {e}"))?;
    }
    std::fs::rename(&tmp, dest).map_err(|e| e.to_string())
}

/// Resolves the shared Kokoro model + voices-pack files, fetching them if
/// needed. Checks the local download cache (app-data/tts_voices/) first,
/// populated by a previous call; downloads both from the kokoro-onnx GitHub
/// release into that cache dir otherwise. The first time ANY voice is ever
/// used in this app (any campaign, this machine) costs one real ~200MB
/// download; every call after that is free, regardless of which catalog
/// voice is actually being spoken.
fn ensure_kokoro_model_available(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let cache_dir = kokoro_model_cache_dir(app)?;
    let onnx_path = cache_dir.join(KOKORO_MODEL_FILENAME);
    let voices_path = cache_dir.join(KOKORO_VOICES_FILENAME);
    if onnx_path.exists() && voices_path.exists() {
        return Ok((onnx_path, voices_path));
    }

    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("Couldn't create voice cache dir: {e}"))?;
    download_to_file(&format!("{KOKORO_RELEASE_BASE_URL}/{KOKORO_MODEL_FILENAME}"), &onnx_path)?;
    download_to_file(&format!("{KOKORO_RELEASE_BASE_URL}/{KOKORO_VOICES_FILENAME}"), &voices_path)?;
    Ok((onnx_path, voices_path))
}

// ── Persistent Kokoro process ─────────────────────────────────────────────
//
// Exactly one warm process, ever — see the module doc comment for why this
// is so much simpler than Piper's LRU pool of several processes: voice and
// speed are per-request JSON fields (see scripts/kokoro_cli.py), not
// process-startup-fixed CLI flags, so there is no "wrong voice loaded"
// concept to evict/respawn around. An idle warm process does no work and
// burns no CPU (it's just sitting on a blocked stdin read); the cost is
// memory, roughly the model's own file size plus ONNX Runtime overhead —
// paid once, not per-voice.

struct PersistentKokoro {
    child: Child,
    stdin: ChildStdin,
    output_dir: PathBuf,
}

fn kokoro_process() -> &'static Mutex<Option<PersistentKokoro>> {
    static PROC: OnceLock<Mutex<Option<PersistentKokoro>>> = OnceLock::new();
    PROC.get_or_init(|| Mutex::new(None))
}

fn kokoro_output_dir() -> PathBuf {
    std::env::temp_dir().join("tavern-kokoro-out")
}

/// Drains a child's stdout/stderr in a background thread so the pipe buffer
/// never fills and stalls the (long-lived) process — kokoro_cli.py prints
/// "READY" once at startup and "ERROR: ..." on a per-line synthesis failure
/// (see its own module doc comment), both harmless to just discard here;
/// synthesis success/failure is detected by watching the output directory
/// (see wait_for_file_to_stabilize below), not by parsing stdout/stderr.
fn drain_in_background<R: std::io::Read + Send + 'static>(reader: R) {
    std::thread::spawn(move || {
        let mut buf_reader = BufReader::new(reader);
        let mut line = String::new();
        while buf_reader.read_line(&mut line).unwrap_or(0) > 0 {
            line.clear();
        }
    });
}

fn spawn_kokoro(exe: &Path, onnx: &Path, voices: &Path, output_dir: &Path) -> Result<PersistentKokoro, String> {
    std::fs::create_dir_all(output_dir).map_err(|e| format!("couldn't create Kokoro output dir: {e}"))?;

    let mut cmd = Command::new(exe);
    cmd.arg(onnx).arg(voices).arg(output_dir);
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // Same console-flash issue as dm.rs's `claude` spawn — kokoro_cli.exe is
    // a console-subsystem binary and this app has no console of its own.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Couldn't start Kokoro ({}): {e}", exe.display()))?;

    let stdin = child.stdin.take().ok_or("no stdin handle")?;
    if let Some(stdout) = child.stdout.take() {
        drain_in_background(stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        drain_in_background(stderr);
    }

    Ok(PersistentKokoro { child, stdin, output_dir: output_dir.to_path_buf() })
}

/// Returns the live warm process, spawning one first if there isn't one yet
/// or the previous one has exited (checked via try_wait, so a dead process
/// never gets mistaken for a usable one).
fn acquire_kokoro<'a>(proc: &'a mut Option<PersistentKokoro>, exe: &Path, onnx: &Path, voices: &Path) -> Result<&'a mut PersistentKokoro, String> {
    let needs_spawn = match proc {
        Some(p) => matches!(p.child.try_wait(), Ok(Some(_)) | Err(_)),
        None => true,
    };
    if needs_spawn {
        *proc = Some(spawn_kokoro(exe, onnx, voices, &kokoro_output_dir())?);
    }
    Ok(proc.as_mut().unwrap())
}

/// Pure: picks whichever file in `after` wasn't present in `before` — how a
/// completed synthesis is detected without parsing Kokoro's stdout (which
/// only ever carries "READY" once and "ERROR: ..." on failure, neither of
/// which is a per-request machine-readable signal — see kokoro_cli.py).
fn pick_new_file<'a>(before: &'a HashSet<PathBuf>, after: &'a HashSet<PathBuf>) -> Option<&'a PathBuf> {
    after.difference(before).next()
}

fn list_wav_files(dir: &Path) -> HashSet<PathBuf> {
    std::fs::read_dir(dir)
        .map(|entries| entries.filter_map(|e| e.ok()).map(|e| e.path()).collect())
        .unwrap_or_default()
}

/// Waits until `path`'s size stops changing across two checks a few ms apart
/// (or 0-byte, which briefly happens right after Kokoro creates the file but
/// before it's written anything) — a plain "does it exist" check can catch
/// the file mid-write and read a truncated/empty result.
fn wait_for_file_to_stabilize(path: &Path, deadline: Instant) {
    let mut last_size: Option<u64> = None;
    loop {
        let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        if size > 0 && Some(size) == last_size {
            return;
        }
        last_size = Some(size);
        if Instant::now() >= deadline {
            return;
        }
        std::thread::sleep(Duration::from_millis(30));
    }
}

/// The stored/UI "pace factor" convention (bigger = slower — same meaning
/// this field has always had, back when it was passed straight through as
/// Piper's `--length-scale`) applied to every voice with no per-voice
/// override (see npc_voices.json's optional `speed` field, threaded through
/// from `speak_text`'s own `speed` param). 1.15 reads as a noticeably more
/// deliberate, measured cadence than Kokoro's own neutral pace without
/// dragging into "slow reading aloud" territory — see
/// kokoro_speed_from_pace_factor for how this gets converted to Kokoro's
/// own (inverted) speed scale at the actual synthesis call.
const DEFAULT_PACE_FACTOR: f64 = 1.15;

/// Converts this app's stored "pace factor" (bigger = slower, the
/// convention every UI label, saved npc_voices.json value, and
/// DEFAULT_PACE_FACTOR already use) into Kokoro's own native `speed`
/// parameter, which is the OPPOSITE convention (bigger = faster — confirmed
/// empirically: speed=0.8 produced a longer clip than speed=1.3 for the
/// same text). Keeping the stored/UI value in the app's existing convention
/// means no data migration for anyone's already-saved npc_voices.json speed
/// overrides and no relabeling of the History dialog's Speed dropdown —
/// only this one call site needs to know Kokoro's scale is inverted.
fn kokoro_speed_from_pace_factor(pace_factor: f64) -> f64 {
    1.0 / pace_factor
}

/// One synthesis against the warm process, acquiring (finding or spawning)
/// it first. Not retried here — the caller (`synthesize_via_persistent_kokoro`)
/// handles the "process died mid-request" retry.
fn synthesize_once(proc: &mut Option<PersistentKokoro>, exe: &Path, onnx: &Path, voices: &Path, voice: &str, speed: f64, text: &str) -> Result<Vec<u8>, String> {
    let kokoro = acquire_kokoro(proc, exe, onnx, voices)?;

    let before = list_wav_files(&kokoro.output_dir);
    let request = serde_json::json!({ "text": text, "voice": voice, "speed": speed }).to_string();
    writeln!(kokoro.stdin, "{request}").map_err(|e| format!("failed writing request to Kokoro: {e}"))?;
    kokoro.stdin.flush().map_err(|e| format!("failed flushing Kokoro stdin: {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let after = list_wav_files(&kokoro.output_dir);
        if let Some(new_file) = pick_new_file(&before, &after) {
            // Kokoro creates the file, then writes to it — reading the
            // instant it exists can race the write and return a truncated
            // (sometimes 0-byte) file. Wait for its size to stop changing
            // across two checks before treating it as complete.
            wait_for_file_to_stabilize(new_file, deadline);
            let bytes = std::fs::read(new_file).map_err(|e| format!("couldn't read Kokoro's output: {e}"))?;
            let _ = std::fs::remove_file(new_file);
            return Ok(bytes);
        }
        if Instant::now() >= deadline {
            return Err("Kokoro synthesis timed out".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Synthesizes via the warm process, holding the lock for the whole
/// request — matches the app's existing one-turn-at-a-time design, so this
/// never needs to disambiguate which output file belongs to which
/// concurrent caller. On failure, drops the (possibly wedged) process and
/// retries exactly once against a freshly spawned one.
fn synthesize_via_persistent_kokoro(exe: &Path, onnx: &Path, voices: &Path, voice: &str, speed: f64, text: &str) -> Result<Vec<u8>, String> {
    let mut proc = kokoro_process().lock().unwrap();
    match synthesize_once(&mut proc, exe, onnx, voices, voice, speed, text) {
        Ok(bytes) => Ok(bytes),
        Err(_) => {
            *proc = None;
            synthesize_once(&mut proc, exe, onnx, voices, voice, speed, text)
        }
    }
}

/// Warms up the shared Kokoro process ahead of the first real turn — mirrors
/// dmSpeech.ts's `warmupSTT()` for Whisper. Fire-and-forget from the
/// frontend (called once at app mount, before any campaign is even picked);
/// a failure here just means the first real `speak_text` call pays the
/// one-time spawn+download cost instead. Unlike Piper (where only the
/// narrator's specific process got warmed at app mount, and each other NPC
/// voice needed its own separate warm-up once a campaign's assignments were
/// known — see git history for the per-campaign warm-up loop this replaced),
/// there's nothing campaign-specific left to warm: this one call covers
/// every catalog voice at once, since they all share the same process.
#[tauri::command]
pub async fn warmup_tts(app: AppHandle) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let exe = find_resource(&app, "kokoro_cli.exe")?;
        let (onnx, voices) = ensure_kokoro_model_available(&app)?;
        let mut proc = kokoro_process().lock().unwrap();
        acquire_kokoro(&mut proc, &exe, &onnx, &voices)?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Kokoro warmup task failed: {e}"))?
}

/// Race/size-based pitch tag → playback-rate multiplier. Kokoro's own API
/// has no native pitch control (just `speed`, which is pace-only — confirmed
/// against kokoro-onnx's own `create()` signature), so this fakes it the
/// classic, dependency-free way: reinterpret_wav_sample_rate makes playback
/// read the WAV at a different rate than it was actually synthesized at,
/// which shifts pitch and tempo together (the "chipmunk"/"slowed-down"
/// effect) — a well-established stand-in for true pitch-only shifting when
/// the alternative is pulling in a full DSP/resampling library. Pure WAV
/// post-processing, identical regardless of which engine produced the
/// audio — unchanged from when this ran against Piper's output. Three
/// tiers, not two: `"small"` (gnomes, halflings, kobolds — an actually
/// Small creature) speeds up + raises pitch; `"large"` (ogres, trolls, hill
/// giants and up, most adult dragons — an actually Large-or-bigger
/// creature) slows down + lowers it a lot; `"gruff"` (half-orcs, goliaths,
/// firbolgs, bugbears — Medium size, same as a human, but naturally read as
/// rougher/deeper-voiced) applies the same slow-down-and-lower direction as
/// `"large"` but much more mildly, since tagging them `"large"` would be
/// mechanically wrong (they aren't Large) AND overshoot the actual effect
/// wanted (a human-sized creature doesn't talk as slowly as an ogre just
/// because it sounds gruffer). Anything else (including plain narration) is
/// a no-op. See BASE_CLAUDE_MD's "Giving NPCs distinct voices" for how the
/// DM picks between these.
fn pitch_factor(pitch: Option<&str>) -> f64 {
    match pitch {
        Some("small") => 1.25,
        Some("gruff") => 0.92,
        Some("large") => 0.82,
        _ => 1.0,
    }
}

/// Rewrites a WAV file's declared sample rate (and matching byte rate) by
/// `factor`, without touching any actual audio sample data — see
/// pitch_factor's doc comment for why this is the chosen pitch-shift
/// mechanism. Scans for the "fmt " sub-chunk rather than assuming a fixed
/// header layout, since Kokoro's exact WAV writer isn't something this app
/// controls. Deliberately conservative: any input that doesn't look like a
/// well-formed RIFF/WAVE file with a findable "fmt " chunk (or `factor ==
/// 1.0`, the common case) is returned completely unchanged — better to play
/// back at the original pitch than to corrupt or drop audio over a
/// malformed-header edge case.
fn reinterpret_wav_sample_rate(wav: &[u8], factor: f64) -> Vec<u8> {
    if factor == 1.0 || wav.len() < 12 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return wav.to_vec();
    }
    let mut out = wav.to_vec();
    let mut pos = 12usize;
    while pos + 8 <= out.len() {
        let chunk_id = &out[pos..pos + 4];
        let Ok(chunk_size_bytes) = <[u8; 4]>::try_from(&out[pos + 4..pos + 8]) else { break };
        let chunk_size = u32::from_le_bytes(chunk_size_bytes) as usize;
        if chunk_id == b"fmt " && chunk_size >= 16 && pos + 8 + 16 <= out.len() {
            let fmt = pos + 8;
            let channels = u16::from_le_bytes(out[fmt + 2..fmt + 4].try_into().unwrap());
            let sample_rate = u32::from_le_bytes(out[fmt + 4..fmt + 8].try_into().unwrap());
            let bits_per_sample = u16::from_le_bytes(out[fmt + 14..fmt + 16].try_into().unwrap());
            let new_rate = (sample_rate as f64 * factor).round() as u32;
            let new_byte_rate = new_rate * channels as u32 * (bits_per_sample as u32 / 8);
            out[fmt + 4..fmt + 8].copy_from_slice(&new_rate.to_le_bytes());
            out[fmt + 8..fmt + 12].copy_from_slice(&new_byte_rate.to_le_bytes());
            return out;
        }
        pos += 8 + chunk_size + (chunk_size % 2); // sub-chunks are word-aligned/padded
    }
    wav.to_vec() // no "fmt " chunk found — leave untouched rather than guess
}

/// Duration of the click-eliminating fade applied at each clip's start/end —
/// see fade_wav_edges. Short enough to be inaudible as a "fade" on its own,
/// long enough to smooth over the discontinuity that causes the click.
const EDGE_FADE_MS: f64 = 8.0;

/// Applies a short linear fade-in and fade-out directly to a WAV's raw PCM
/// samples — eliminates the audible click/pop that shows up at the seam
/// between two independently-synthesized Kokoro clips played back to back
/// as separate `<audio>` elements (see DMConsolePage's per-sentence
/// playback queue). Kokoro synthesizes each sentence in total isolation
/// with no knowledge of its neighbors, so consecutive clips routinely
/// start/end mid-waveform (a non-zero-amplitude sample right at the
/// boundary) rather than at a zero crossing — audible as a sharp tick on
/// very nearly every sentence boundary across a long turn. Only handles
/// 16-bit PCM (Kokoro's own output format via soundfile — see
/// scripts/kokoro_cli.py) — any other bit depth, or a malformed/too-short
/// file, is returned unchanged rather than guessed at, same conservative
/// philosophy as reinterpret_wav_sample_rate. Deliberately operates on the
/// TRUE (pre-pitch-reinterpretation) sample rate declared in the file —
/// call this before reinterpret_wav_sample_rate so the fade's frame math
/// lines up with the actual PCM data, not a rate that was only ever
/// rewritten in the header.
fn fade_wav_edges(wav: &[u8], fade_ms: f64) -> Vec<u8> {
    if wav.len() < 12 || &wav[0..4] != b"RIFF" || &wav[8..12] != b"WAVE" {
        return wav.to_vec();
    }
    let mut out = wav.to_vec();
    let mut pos = 12usize;
    let (mut channels, mut sample_rate, mut bits_per_sample) = (0u16, 0u32, 0u16);
    let mut data_range: Option<(usize, usize)> = None;
    while pos + 8 <= out.len() {
        let chunk_id = &out[pos..pos + 4];
        let Ok(chunk_size_bytes) = <[u8; 4]>::try_from(&out[pos + 4..pos + 8]) else { break };
        let chunk_size = u32::from_le_bytes(chunk_size_bytes) as usize;
        let body = pos + 8;
        if chunk_id == b"fmt " && chunk_size >= 16 && body + 16 <= out.len() {
            channels = u16::from_le_bytes(out[body + 2..body + 4].try_into().unwrap());
            sample_rate = u32::from_le_bytes(out[body + 4..body + 8].try_into().unwrap());
            bits_per_sample = u16::from_le_bytes(out[body + 14..body + 16].try_into().unwrap());
        } else if chunk_id == b"data" {
            let len = chunk_size.min(out.len().saturating_sub(body));
            data_range = Some((body, len));
        }
        pos = body + chunk_size + (chunk_size % 2); // sub-chunks are word-aligned/padded
    }

    let Some((data_start, data_len)) = data_range else { return wav.to_vec() };
    if bits_per_sample != 16 || channels == 0 || sample_rate == 0 {
        return wav.to_vec();
    }

    let bytes_per_frame = 2usize * channels as usize;
    let total_frames = data_len / bytes_per_frame;
    let fade_frames = ((sample_rate as f64 * fade_ms / 1000.0).round() as usize).min(total_frames / 2);
    if fade_frames == 0 {
        return out;
    }

    for i in 0..fade_frames {
        let gain = i as f64 / fade_frames as f64;
        for edge_frame in [i, total_frames - 1 - i] {
            let frame_start = data_start + edge_frame * bytes_per_frame;
            for c in 0..channels as usize {
                let s = frame_start + c * 2;
                let sample = i16::from_le_bytes(out[s..s + 2].try_into().unwrap());
                let scaled = (sample as f64 * gain).round() as i16;
                out[s..s + 2].copy_from_slice(&scaled.to_le_bytes());
            }
        }
    }
    out
}

/// Synthesizes `text` to speech via Kokoro, returning base64-encoded WAV
/// bytes — keeps this a plain request/response IPC call with no temp-file
/// bookkeeping needed on the JS side. `voice_id` picks from VOICE_CATALOG
/// (defaulting to the narrator voice when absent/for plain narration, or on
/// an unrecognized id — e.g. a campaign's npc_voices.json still carrying an
/// id from the old Piper catalog) — see ensure_kokoro_model_available for
/// the cached/download resolution chain. `pitch` (`"small"`/`"large"`/
/// absent) is applied as a post-processing step on the synthesized WAV —
/// see pitch_factor. `speed` (absent = DEFAULT_PACE_FACTOR) is this app's
/// own pace-factor convention (bigger = slower) — see
/// kokoro_speed_from_pace_factor for the conversion to Kokoro's own
/// (inverted) native scale. See dmSpeech.ts for the caller, which falls
/// back to browser speechSynthesis (narrator voice only, no per-NPC voice/
/// pitch/speed) if this errors.
#[tauri::command]
pub async fn speak_text(app: AppHandle, text: String, voice_id: Option<String>, pitch: Option<String>, speed: Option<f64>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let exe = find_resource(&app, "kokoro_cli.exe")?;
        let resolved_id = voice_id.as_deref().unwrap_or(DEFAULT_VOICE_ID);
        let kokoro_voice = catalog_kokoro_voice(resolved_id).unwrap_or_else(|_| catalog_kokoro_voice(DEFAULT_VOICE_ID).unwrap());
        let (onnx, voices) = ensure_kokoro_model_available(&app)?;
        let pace_factor = speed.unwrap_or(DEFAULT_PACE_FACTOR);
        let kokoro_speed = kokoro_speed_from_pace_factor(pace_factor);
        let bytes = synthesize_via_persistent_kokoro(&exe, &onnx, &voices, kokoro_voice, kokoro_speed, &text)?;
        let bytes = fade_wav_edges(&bytes, EDGE_FADE_MS);
        let bytes = reinterpret_wav_sample_rate(&bytes, pitch_factor(pitch.as_deref()));
        Ok(STANDARD.encode(bytes))
    })
    .await
    .map_err(|e| format!("TTS task failed: {e}"))?
}

// ── Campaign export/import: zip helpers ───────────────────────────────────
//
// Generic zip directory <-> archive helpers, used by campaign.rs's
// export_campaign_at/import_campaign_at (the "Export campaign" backup
// feature). Not TTS-specific — they just live in this file alongside the
// `zip` crate dependency they need.

/// Pure: turns a (forward-slash-normalized) zip entry name into a safe relative
/// path under the extraction root, or None if it's unsafe. Guards against
/// zip-slip: rejects `..` traversal and drive/ADS (`:`) components, and drops
/// `.`/empty segments (so a leading `/` becomes relative, staying under the
/// root). Callers normalize `\`→`/` first, so a backslash-separated archive
/// (which .NET's zipper unfortunately produces) is handled identically.
fn sanitize_zip_path(normalized: &str) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for comp in normalized.split('/') {
        if comp.is_empty() || comp == "." {
            continue;
        }
        if comp == ".." || comp.contains(':') {
            return None;
        }
        out.push(comp);
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Extracts `zip_path` into `dest`, creating `dest/<entry>` for each file. Entry
/// names are normalized `\`→`/` (defensive) and run through sanitize_zip_path so
/// a malicious archive can't write outside `dest`. Takes no AppHandle so it's
/// directly testable; campaign.rs's import_campaign_at extracts into a scratch
/// dir first, so a bad archive never touches a real campaign folder.
pub(crate) fn extract_zip_to(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = std::fs::File::open(zip_path).map_err(|e| format!("couldn't open archive: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("not a valid zip archive: {e}"))?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| format!("archive entry {i} unreadable: {e}"))?;
        let normalized = entry.name().replace('\\', "/");
        let is_dir = entry.is_dir() || normalized.ends_with('/');
        let Some(rel) = sanitize_zip_path(&normalized) else {
            return Err(format!("archive contains an unsafe path: {normalized}"));
        };
        let out_path = dest.join(&rel);
        if is_dir {
            std::fs::create_dir_all(&out_path).map_err(|e| format!("couldn't create {}: {e}", out_path.display()))?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("couldn't create {}: {e}", parent.display()))?;
            }
            let mut out = std::fs::File::create(&out_path).map_err(|e| format!("couldn't write {}: {e}", out_path.display()))?;
            std::io::copy(&mut entry, &mut out).map_err(|e| format!("couldn't extract {}: {e}", out_path.display()))?;
        }
    }
    Ok(())
}

/// Recursively zips every file under `src_dir` into a new archive at
/// `dest_zip` (created fresh — errors if something's already there), with
/// entry names relative to `src_dir` and forward-slash separated so
/// extract_zip_to reads them back identically on any platform. Write-side
/// sibling of extract_zip_to above; used by campaign.rs's export_campaign_at.
pub(crate) fn zip_dir_to(src_dir: &Path, dest_zip: &Path) -> Result<(), String> {
    let file = std::fs::File::create(dest_zip).map_err(|e| format!("couldn't create {}: {e}", dest_zip.display()))?;
    let mut zw = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut stack = vec![src_dir.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).map_err(|e| format!("couldn't read {}: {e}", dir.display()))? {
            let path = entry.map_err(|e| e.to_string())?.path();
            let rel = path.strip_prefix(src_dir).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
            if path.is_dir() {
                stack.push(path);
            } else {
                zw.start_file(&rel, opts).map_err(|e| format!("couldn't add {rel} to archive: {e}"))?;
                let mut f = std::fs::File::open(&path).map_err(|e| format!("couldn't read {}: {e}", path.display()))?;
                std::io::copy(&mut f, &mut zw).map_err(|e| format!("couldn't write {rel} to archive: {e}"))?;
            }
        }
    }
    zw.finish().map_err(|e| format!("couldn't finalize archive: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_candidates_prefers_packaged_dir_then_dev_fallback() {
        let candidates = resource_candidates(Some(PathBuf::from("/packaged")), "kokoro_cli.exe");
        assert_eq!(candidates[0], PathBuf::from("/packaged/tts/kokoro_cli.exe"));
        assert!(candidates[1].ends_with("public/tts/kokoro_cli.exe"));
    }

    #[test]
    fn resource_candidates_falls_back_when_no_resource_dir() {
        let candidates = resource_candidates(None, "kokoro_cli.exe");
        assert_eq!(candidates.len(), 1);
        assert!(candidates[0].ends_with("public/tts/kokoro_cli.exe"));
    }

    #[test]
    fn catalog_kokoro_voice_resolves_known_ids_and_rejects_unknown_ones() {
        assert_eq!(catalog_kokoro_voice("narrator").unwrap(), "af_heart");
        assert_eq!(catalog_kokoro_voice("male-gb-3").unwrap(), "bm_george");
        assert!(catalog_kokoro_voice("dragon-lord-9000").is_err());
    }

    #[test]
    fn every_legacy_piper_id_resolves_to_a_same_gender_kokoro_voice() {
        // The stakes: an unmapped legacy id falls back to the narrator,
        // which is a FEMALE voice — so a male NPC saved under the old Piper
        // catalog would flip gender mid-campaign. Every legacy alias must
        // (a) resolve at all, and (b) preserve the gender encoded in its
        // own id prefix.
        for (legacy, _) in LEGACY_VOICE_ALIASES {
            let kokoro_voice = catalog_kokoro_voice(legacy)
                .unwrap_or_else(|_| panic!("legacy id \"{legacy}\" must resolve, not fall back to the narrator"));
            let legacy_is_male = legacy.starts_with("male-");
            let kokoro_is_male = kokoro_voice.starts_with("am_") || kokoro_voice.starts_with("bm_");
            assert_eq!(
                legacy_is_male, kokoro_is_male,
                "legacy id \"{legacy}\" resolved to \"{kokoro_voice}\", flipping gender"
            );
        }
    }

    #[test]
    fn legacy_aliases_spread_across_distinct_replacements_within_each_gender() {
        // A campaign that used several distinct accents shouldn't collapse
        // into everyone sharing one replacement voice. Not required to be
        // perfectly unique across genders (male/female pools are disjoint
        // anyway) — just no duplicate replacement within a gender.
        for prefix in ["male-", "female-"] {
            let mut replacements: Vec<&str> = LEGACY_VOICE_ALIASES
                .iter()
                .filter(|(legacy, _)| legacy.starts_with(prefix))
                .map(|(_, replacement)| *replacement)
                .collect();
            let before = replacements.len();
            replacements.sort();
            replacements.dedup();
            assert_eq!(replacements.len(), before, "two {prefix}* legacy ids share one replacement voice");
        }
    }

    #[test]
    fn voice_catalog_ids_and_kokoro_voices_are_both_unique() {
        let mut ids: Vec<&str> = VOICE_CATALOG.iter().map(|(id, _)| *id).collect();
        let before = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), before, "duplicate catalog id in VOICE_CATALOG");

        let mut kokoro_voices: Vec<&str> = VOICE_CATALOG.iter().map(|(_, v)| *v).collect();
        let before = kokoro_voices.len();
        kokoro_voices.sort();
        kokoro_voices.dedup();
        assert_eq!(kokoro_voices.len(), before, "two catalog ids resolved to the same underlying Kokoro voice");
    }

    #[test]
    fn voice_catalog_only_uses_american_and_british_kokoro_voice_prefixes() {
        // Kokoro has no Scottish/Irish/Welsh/Australian/South African
        // voices — see VOICE_CATALOG's doc comment. Every entry must be one
        // of the two English prefixes Kokoro actually ships.
        for (id, kokoro_voice) in VOICE_CATALOG {
            assert!(
                kokoro_voice.starts_with("af_") || kokoro_voice.starts_with("am_") || kokoro_voice.starts_with("bf_") || kokoro_voice.starts_with("bm_"),
                "catalog id \"{id}\" maps to \"{kokoro_voice}\", which isn't a recognized American/British Kokoro voice prefix"
            );
        }
    }

    #[test]
    fn narrator_is_reserved_and_not_reused_as_a_numbered_voice() {
        let narrator_voice = catalog_kokoro_voice(DEFAULT_VOICE_ID).unwrap();
        let reused = VOICE_CATALOG.iter().any(|(id, v)| *id != DEFAULT_VOICE_ID && *v == narrator_voice);
        assert!(!reused, "the narrator's Kokoro voice must not also be assigned to a numbered NPC id");
    }

    #[test]
    fn kokoro_speed_from_pace_factor_inverts_the_stored_convention() {
        // Stored convention: bigger pace_factor = slower. Kokoro's native
        // convention: bigger speed = faster. So a pace_factor above 1.0
        // (meant to read as "slower") must produce a Kokoro speed BELOW 1.0.
        assert!(kokoro_speed_from_pace_factor(1.30) < 1.0, "a 'slower' pace factor must map to a Kokoro speed below 1.0");
        assert!(kokoro_speed_from_pace_factor(0.85) > 1.0, "a 'faster' pace factor must map to a Kokoro speed above 1.0");
        assert_eq!(kokoro_speed_from_pace_factor(1.0), 1.0, "a neutral pace factor must map to Kokoro's own neutral speed");
    }

    #[test]
    fn pick_new_file_finds_the_one_file_added_since_the_snapshot() {
        let before: HashSet<PathBuf> = [PathBuf::from("/out/1.wav")].into_iter().collect();
        let after: HashSet<PathBuf> = [PathBuf::from("/out/1.wav"), PathBuf::from("/out/2.wav")].into_iter().collect();
        assert_eq!(pick_new_file(&before, &after), Some(&PathBuf::from("/out/2.wav")));
    }

    #[test]
    fn pick_new_file_returns_none_when_nothing_new() {
        let before: HashSet<PathBuf> = [PathBuf::from("/out/1.wav")].into_iter().collect();
        assert_eq!(pick_new_file(&before, &before.clone()), None);
    }

    #[test]
    fn pitch_factor_maps_known_tags_and_defaults_to_unchanged() {
        assert_eq!(pitch_factor(Some("small")), 1.25);
        assert_eq!(pitch_factor(Some("gruff")), 0.92);
        assert_eq!(pitch_factor(Some("large")), 0.82);
        assert_eq!(pitch_factor(None), 1.0);
        assert_eq!(pitch_factor(Some("ogre-9000")), 1.0, "unknown tags should fall back to no pitch change, not error");
    }

    #[test]
    fn pitch_factor_gruff_is_milder_than_large_but_still_a_deepening_direction() {
        // gruff (half-orcs, goliaths — Medium size) should sit between
        // "no shift" and "large" (actually Large+ creatures), never at or
        // past large's shift — see pitch_factor's doc comment for why these
        // need to be mechanically distinct, not just two names for one tag.
        let gruff = pitch_factor(Some("gruff"));
        let large = pitch_factor(Some("large"));
        assert!(large < gruff && gruff < 1.0, "expected 0 < large < gruff < 1.0, got large={large}, gruff={gruff}");
    }

    /// A minimal, canonical 44-byte-header PCM WAV — mirrors the shape
    /// Kokoro's own output (via soundfile) takes closely enough to exercise
    /// reinterpret_wav_sample_rate/fade_wav_edges' chunk-scanning honestly.
    fn minimal_wav(sample_rate: u32, channels: u16, bits_per_sample: u16, data: &[u8]) -> Vec<u8> {
        let byte_rate = sample_rate * channels as u32 * (bits_per_sample as u32 / 8);
        let block_align = channels * (bits_per_sample / 8);
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
        wav.extend_from_slice(&channels.to_le_bytes());
        wav.extend_from_slice(&sample_rate.to_le_bytes());
        wav.extend_from_slice(&byte_rate.to_le_bytes());
        wav.extend_from_slice(&block_align.to_le_bytes());
        wav.extend_from_slice(&bits_per_sample.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
        wav.extend_from_slice(data);
        wav
    }

    #[test]
    fn reinterpret_wav_sample_rate_rewrites_rate_and_matching_byte_rate() {
        let wav = minimal_wav(24000, 1, 16, &[0u8; 8]);
        let shifted = reinterpret_wav_sample_rate(&wav, 1.25);
        let new_rate = u32::from_le_bytes(shifted[24..28].try_into().unwrap());
        let new_byte_rate = u32::from_le_bytes(shifted[28..32].try_into().unwrap());
        assert_eq!(new_rate, 30000); // 24000 * 1.25
        assert_eq!(new_byte_rate, new_rate * 1 * 2); // mono, 16-bit = 2 bytes/sample
        // Sample data itself must be untouched — only header fields change.
        assert_eq!(&shifted[44..], &[0u8; 8]);
    }

    #[test]
    fn reinterpret_wav_sample_rate_is_a_no_op_at_factor_one_or_on_malformed_input() {
        let wav = minimal_wav(24000, 1, 16, &[1, 2, 3, 4]);
        assert_eq!(reinterpret_wav_sample_rate(&wav, 1.0), wav);

        let garbage = b"not a wav file at all".to_vec();
        assert_eq!(reinterpret_wav_sample_rate(&garbage, 1.25), garbage);
    }

    #[test]
    fn fade_wav_edges_ramps_first_and_last_frames_toward_zero() {
        // A clip long enough that an 8ms fade region (≈192 frames @
        // 24000Hz) doesn't reach the middle — leaves a genuinely untouched
        // interior to assert against, unlike a clip short enough to force
        // fade_frames to be capped at total_frames/2.
        let sample_rate = 24000u32;
        let frame_count = 1000usize;
        let mut data = Vec::with_capacity(frame_count * 2);
        for _ in 0..frame_count {
            data.extend_from_slice(&30000i16.to_le_bytes());
        }
        let wav = minimal_wav(sample_rate, 1, 16, &data);
        let faded = fade_wav_edges(&wav, 8.0);

        let frame = |bytes: &[u8], i: usize| i16::from_le_bytes(bytes[44 + i * 2..44 + i * 2 + 2].try_into().unwrap());

        assert_eq!(frame(&faded, 0), 0, "very first sample must be silenced to zero");
        assert_eq!(frame(&faded, frame_count - 1), 0, "very last sample must be silenced to zero");
        // A frame just inside the fade-in region should be scaled down but
        // not silenced.
        let mid = frame(&faded, 10);
        assert!(mid > 0 && mid < 30000, "expected a partial ramp value, got {mid}");
        // The clip's interior, outside both fade regions, must be untouched.
        assert_eq!(frame(&faded, frame_count / 2), 30000);
    }

    #[test]
    fn fade_wav_edges_is_a_no_op_on_malformed_or_non_16bit_input() {
        let wav_24bit = minimal_wav(24000, 1, 24, &[0u8; 12]);
        assert_eq!(fade_wav_edges(&wav_24bit, 8.0), wav_24bit);

        let garbage = b"not a wav file at all".to_vec();
        assert_eq!(fade_wav_edges(&garbage, 8.0), garbage);
    }

    /// Real integration check against the actual frozen kokoro_cli.exe and
    /// downloaded model files — not run as part of the normal `cargo test`
    /// suite (needs a live subprocess + real files on disk, unsuitable for
    /// CI), but exercised manually once after any change to the spawn/JSON
    /// stdin/file-watch plumbing above. Run with:
    ///   TTS_TEST_EXE=<path> TTS_TEST_ONNX=<path> TTS_TEST_VOICES=<path> \
    ///     cargo test --quiet -- --ignored kokoro_end_to_end
    #[test]
    #[ignore]
    fn kokoro_end_to_end_produces_playable_wav_bytes() {
        let exe = PathBuf::from(std::env::var("TTS_TEST_EXE").expect("set TTS_TEST_EXE"));
        let onnx = PathBuf::from(std::env::var("TTS_TEST_ONNX").expect("set TTS_TEST_ONNX"));
        let voices = PathBuf::from(std::env::var("TTS_TEST_VOICES").expect("set TTS_TEST_VOICES"));

        let bytes = synthesize_via_persistent_kokoro(&exe, &onnx, &voices, "af_heart", 1.0, "Testing the real Kokoro pipeline end to end.")
            .expect("synthesis against the real exe should succeed");
        assert!(bytes.len() > 1000, "expected a real WAV file, got {} bytes", bytes.len());
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");

        // A second call with a different voice/speed must reuse the SAME
        // warm process (no respawn) — proves the "one process serves every
        // voice" design actually works, not just compiles.
        let bytes2 = synthesize_via_persistent_kokoro(&exe, &onnx, &voices, "bm_george", 1.3, "A second line, a different British voice.")
            .expect("second synthesis against the same warm process should succeed");
        assert!(bytes2.len() > 1000);

        let faded = fade_wav_edges(&bytes, EDGE_FADE_MS);
        let pitched = reinterpret_wav_sample_rate(&faded, pitch_factor(Some("small")));
        assert_eq!(&pitched[0..4], b"RIFF", "post-processing pipeline must still produce a well-formed WAV");
    }

    #[test]
    fn sanitize_zip_path_keeps_normal_nested_paths() {
        assert_eq!(
            sanitize_zip_path("campaign/CLAUDE.md"),
            Some(PathBuf::from("campaign").join("CLAUDE.md"))
        );
        assert_eq!(
            sanitize_zip_path("campaign/memory/MEMORY.md"),
            Some(PathBuf::from("campaign").join("memory").join("MEMORY.md"))
        );
        // A leading "/", a leading "./", and doubled slashes all collapse away,
        // and the result stays relative (so it can only ever land under root).
        assert_eq!(
            sanitize_zip_path("/campaign//memory/MEMORY.md"),
            Some(PathBuf::from("campaign").join("memory").join("MEMORY.md"))
        );
    }

    #[test]
    fn sanitize_zip_path_rejects_zip_slip_and_drive_paths() {
        assert_eq!(sanitize_zip_path("../evil.exe"), None);
        assert_eq!(sanitize_zip_path("campaign/../../evil"), None);
        assert_eq!(sanitize_zip_path("C:/Windows/system32/evil.dll"), None); // drive letter
        assert_eq!(sanitize_zip_path(""), None);
        assert_eq!(sanitize_zip_path("/"), None);
        assert_eq!(sanitize_zip_path("./"), None);
    }

    #[test]
    fn extract_zip_to_builds_tree_and_normalizes_backslash_entries() {
        use std::io::Write;
        let tmp = std::env::temp_dir().join(format!("zip-extract-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let zip_path = tmp.join("test.zip");
        {
            let f = std::fs::File::create(&zip_path).unwrap();
            let mut zw = zip::ZipWriter::new(f);
            let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            zw.start_file("campaign/CLAUDE.md", opts).unwrap();
            zw.write_all(b"persona text").unwrap();
            zw.start_file("campaign/memory/MEMORY.md", opts).unwrap();
            zw.write_all(b"a b c").unwrap();
            // A backslash-separated entry, as .NET's zipper produces, must still
            // nest correctly rather than become a file literally named with
            // backslashes.
            zw.start_file("campaign\\memory\\flagged_facts.md", opts).unwrap();
            zw.write_all(b"flagged").unwrap();
            zw.finish().unwrap();
        }

        let dest = tmp.join("out");
        extract_zip_to(&zip_path, &dest).unwrap();
        assert!(dest.join("campaign").join("CLAUDE.md").exists());
        assert_eq!(
            std::fs::read(dest.join("campaign").join("memory").join("MEMORY.md")).unwrap(),
            b"a b c"
        );
        assert!(
            dest.join("campaign").join("memory").join("flagged_facts.md").exists(),
            "backslash entry must extract as a nested path"
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn extract_zip_to_rejects_a_zip_slip_entry() {
        use std::io::Write;
        let tmp = std::env::temp_dir().join(format!("zip-slip-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let zip_path = tmp.join("evil.zip");
        {
            let f = std::fs::File::create(&zip_path).unwrap();
            let mut zw = zip::ZipWriter::new(f);
            let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            zw.start_file("../escape.txt", opts).unwrap();
            zw.write_all(b"pwned").unwrap();
            zw.finish().unwrap();
        }
        let dest = tmp.join("out");
        assert!(extract_zip_to(&zip_path, &dest).is_err(), "a ../ entry must be rejected");
        assert!(!tmp.join("escape.txt").exists(), "nothing may be written outside dest");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn zip_dir_to_round_trips_through_extract_zip_to() {
        let tmp = std::env::temp_dir().join(format!("zip-roundtrip-test-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let _ = std::fs::remove_dir_all(&tmp);
        let src = tmp.join("src");
        std::fs::create_dir_all(src.join("memory")).unwrap();
        std::fs::write(src.join("CLAUDE.md"), "persona text").unwrap();
        std::fs::write(src.join("memory").join("MEMORY.md"), "session recap").unwrap();

        let zip_path = tmp.join("out.zip");
        zip_dir_to(&src, &zip_path).expect("zipping a real directory should succeed");

        let dest = tmp.join("restored");
        extract_zip_to(&zip_path, &dest).expect("the zip it just wrote should extract cleanly");

        assert_eq!(std::fs::read_to_string(dest.join("CLAUDE.md")).unwrap(), "persona text");
        assert_eq!(std::fs::read_to_string(dest.join("memory").join("MEMORY.md")).unwrap(), "session recap");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
