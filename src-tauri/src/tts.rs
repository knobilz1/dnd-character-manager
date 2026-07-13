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
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

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

/// F5-exclusive voices: 5 male + 5 female per D&D race/monster archetype,
/// curated from the CSTR VCTK Corpus v0.80 (Veaux, Yamagishi, MacDonald —
/// University of Edinburgh, licensed ODC-By v1.0) — real recorded speakers,
/// not Kokoro-bootstrapped like VOICE_CATALOG, so there's no synthetic-clone
/// quality ceiling. These have NO Kokoro voice of their own (unlike
/// VOICE_CATALOG's ids); the second field is instead the nearest same-gender
/// VOICE_CATALOG id to fall back to under Kokoro, or if F5 becomes
/// unavailable mid-campaign — picked once per archetype+gender bucket (not
/// per individual voice) for gender/register fit, not acoustically verified
/// against these specific renders, since it only matters in that fallback
/// path, never the primary experience. `sibling_voice_ids` treats the
/// trailing `-N` the same way it already does for VOICE_CATALOG, so an NPC
/// collision within a bucket (e.g. two orc NPCs both wanting `orc-m-*`)
/// resolves for free with no changes there beyond scanning this table too.
const ARCHETYPE_VOICES: &[(&str, &str)] = &[
    ("orc-m-1", "male-us-4"),
    ("orc-m-2", "male-us-4"),
    ("orc-m-3", "male-us-4"),
    ("orc-m-4", "male-us-4"),
    ("orc-m-5", "male-us-4"),
    ("orc-f-1", "female-us-6"),
    ("orc-f-2", "female-us-6"),
    ("orc-f-3", "female-us-6"),
    ("orc-f-4", "female-us-6"),
    ("orc-f-5", "female-us-6"),
    ("giant-m-1", "male-us-4"),
    ("giant-m-2", "male-us-4"),
    ("giant-m-3", "male-us-4"),
    ("giant-m-4", "male-us-4"),
    ("giant-m-5", "male-us-4"),
    ("giant-f-1", "female-us-6"),
    ("giant-f-2", "female-us-6"),
    ("giant-f-3", "female-us-6"),
    ("giant-f-4", "female-us-6"),
    ("giant-f-5", "female-us-6"),
    ("dwarf-m-1", "male-gb-3"),
    ("dwarf-m-2", "male-gb-3"),
    ("dwarf-m-3", "male-gb-3"),
    ("dwarf-m-4", "male-gb-3"),
    ("dwarf-m-5", "male-gb-3"),
    ("dwarf-f-1", "female-gb-2"),
    ("dwarf-f-2", "female-gb-2"),
    ("dwarf-f-3", "female-gb-2"),
    ("dwarf-f-4", "female-gb-2"),
    ("dwarf-f-5", "female-gb-2"),
    ("elf-m-1", "male-gb-1"),
    ("elf-m-2", "male-gb-1"),
    ("elf-m-3", "male-gb-1"),
    ("elf-m-4", "male-gb-1"),
    ("elf-m-5", "male-gb-1"),
    ("elf-f-1", "female-gb-1"),
    ("elf-f-2", "female-gb-1"),
    ("elf-f-3", "female-gb-1"),
    ("elf-f-4", "female-gb-1"),
    ("elf-f-5", "female-gb-1"),
    ("gnome-m-1", "male-us-8"),
    ("gnome-m-2", "male-us-8"),
    ("gnome-m-3", "male-us-8"),
    ("gnome-m-4", "male-us-8"),
    ("gnome-m-5", "male-us-8"),
    ("gnome-f-1", "female-us-1"),
    ("gnome-f-2", "female-us-1"),
    ("gnome-f-3", "female-us-1"),
    ("gnome-f-4", "female-us-1"),
    ("gnome-f-5", "female-us-1"),
    ("halfling-m-1", "male-gb-4"),
    ("halfling-m-2", "male-gb-4"),
    ("halfling-m-3", "male-gb-4"),
    ("halfling-m-4", "male-gb-4"),
    ("halfling-m-5", "male-gb-4"),
    ("halfling-f-1", "female-gb-4"),
    ("halfling-f-2", "female-gb-4"),
    ("halfling-f-3", "female-gb-4"),
    ("halfling-f-4", "female-gb-4"),
    ("halfling-f-5", "female-gb-4"),
    ("sinister-m-1", "male-gb-2"),
    ("sinister-m-2", "male-gb-2"),
    ("sinister-m-3", "male-gb-2"),
    ("sinister-m-4", "male-gb-2"),
    ("sinister-m-5", "male-gb-2"),
    ("sinister-f-1", "female-gb-3"),
    ("sinister-f-2", "female-gb-3"),
    ("sinister-f-3", "female-gb-3"),
    ("sinister-f-4", "female-gb-3"),
    ("sinister-f-5", "female-gb-3"),
    ("sage-m-1", "male-us-3"),
    ("sage-m-2", "male-us-3"),
    ("sage-m-3", "male-us-3"),
    ("sage-m-4", "male-us-3"),
    ("sage-m-5", "male-us-3"),
    ("sage-f-1", "female-us-4"),
    ("sage-f-2", "female-us-4"),
    ("sage-f-3", "female-us-4"),
    ("sage-f-4", "female-us-4"),
    ("sage-f-5", "female-us-4"),
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
///
/// Also scans ARCHETYPE_VOICES so a collision within an archetype bucket
/// (e.g. two orc NPCs both wanting `orc-m-*`) resolves the same way a
/// VOICE_CATALOG collision already does — the two tables share the same
/// `<bucket>-<N>` id shape, so no separate logic is needed here.
pub fn sibling_voice_ids(voice_id: &str) -> Vec<&'static str> {
    let Some((bucket, _)) = voice_id.rsplit_once('-') else {
        return Vec::new();
    };
    VOICE_CATALOG
        .iter()
        .chain(ARCHETYPE_VOICES.iter())
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
    // ARCHETYPE_VOICES ids have no Kokoro voice of their own — resolve to
    // their declared fallback first (a real VOICE_CATALOG id), then fall
    // through to the normal lookup for THAT id's actual Kokoro voice.
    let resolved = ARCHETYPE_VOICES
        .iter()
        .find(|(id, _)| *id == voice_id)
        .map(|(_, fallback)| *fallback)
        .unwrap_or(voice_id);
    let resolved = LEGACY_VOICE_ALIASES
        .iter()
        .find(|(legacy, _)| *legacy == resolved)
        .map(|(_, replacement)| *replacement)
        .unwrap_or(resolved);
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

/// Warms the Kokoro process (spawns it, paying the process-spawn + ONNX
/// Runtime session-creation cost) so the first real turn doesn't. Extracted
/// from warmup_tts so it can warm whichever engine is active. Unlike Piper
/// (where only the narrator's specific process got warmed at app mount, and
/// each other NPC voice needed its own separate warm-up once a campaign's
/// assignments were known — see git history for the per-campaign warm-up loop
/// this replaced), there's nothing campaign-specific left to warm: this one
/// call covers every catalog voice at once, since they all share the process.
fn warmup_kokoro(app: &AppHandle) -> Result<(), String> {
    let exe = find_resource(app, "kokoro_cli.exe")?;
    let (onnx, voices) = ensure_kokoro_model_available(app)?;
    let mut proc = kokoro_process().lock().unwrap();
    acquire_kokoro(&mut proc, &exe, &onnx, &voices)?;
    Ok(())
}

/// Warms up the active TTS engine ahead of the first real turn — mirrors
/// dmSpeech.ts's `warmupSTT()` for Whisper. Fire-and-forget from the frontend
/// (called once at app mount, before any campaign is even picked); a failure
/// here just means the first real `speak_text` call pays the one-time
/// spawn/model-load cost instead. Warms whichever engine set_tts_engine last
/// selected — Kokoro by default, or F5 (front-loading its ~16s model-load)
/// when enabled; the frontend restores the persisted engine before calling
/// this, so an F5 campaign pays that load here rather than on its first spoken
/// line. If the order ever slips, the only cost is Kokoro gets warmed and the
/// first F5 line pays the load — never a wrong-engine or silent turn.
#[tauri::command]
pub async fn warmup_tts(app: AppHandle) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let engine = *active_engine().lock().unwrap();
        match engine {
            TtsEngine::F5 => warmup_f5(&app),
            TtsEngine::Kokoro => warmup_kokoro(&app),
        }
    })
    .await
    .map_err(|e| format!("TTS warmup task failed: {e}"))?
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
///
/// `voice_id` is checked FIRST: an archetype id (ARCHETYPE_VOICES) always
/// wins and forces a no-op regardless of `pitch`. Those reference clips are
/// already recorded at the right pitch/accent for their race/size, so
/// layering this WAV-rate hack on top would double up and distort an
/// already-tuned voice. speak_text is the one place every synthesis path
/// (DM auto-assignment, the voice-reconciliation batch pass, and a human's
/// manual override in the History panel) funnels through, so enforcing it
/// here is airtight without having to police every call site that writes a
/// (voice_id, pitch) pair — see campaign.rs's DM_RULES for the prompt-side
/// half of this (steering Claude away from sending the combination at all).
fn pitch_factor(pitch: Option<&str>, voice_id: &str) -> f64 {
    if ARCHETYPE_VOICES.iter().any(|(id, _)| *id == voice_id) {
        return 1.0;
    }
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

/// The Kokoro synthesis path, extracted from `speak_text` so the command can
/// route between engines — and fall back to this one whenever F5 is selected
/// but unavailable (invariant #3). Returns the raw synthesized WAV bytes BEFORE
/// `speak_text`'s engine-agnostic fade/pitch post-processing. `voice_id` picks
/// from VOICE_CATALOG (defaulting to the narrator voice when absent or on an
/// unrecognized id — e.g. a campaign's npc_voices.json still carrying an id
/// from the old Piper catalog); see ensure_kokoro_model_available for the
/// cached/download resolution chain. `native_speed` is already in Kokoro's own
/// (inverted-from-pace-factor) scale — see kokoro_speed_from_pace_factor —
/// computed once by the caller so both engines share the identical conversion.
fn synthesize_kokoro(app: &AppHandle, voice_id: &str, native_speed: f64, text: &str) -> Result<Vec<u8>, String> {
    let exe = find_resource(app, "kokoro_cli.exe")?;
    let kokoro_voice = catalog_kokoro_voice(voice_id).unwrap_or_else(|_| catalog_kokoro_voice(DEFAULT_VOICE_ID).unwrap());
    let (onnx, voices) = ensure_kokoro_model_available(app)?;
    synthesize_via_persistent_kokoro(&exe, &onnx, &voices, kokoro_voice, native_speed, text)
}

/// Synthesizes `text` to speech, returning base64-encoded WAV bytes — keeps
/// this a plain request/response IPC call with no temp-file bookkeeping needed
/// on the JS side. Routes to whichever engine is active (see active_engine /
/// set_tts_engine): Kokoro by default, or F5 when enabled — and if F5 is
/// selected but its runtime/GPU is missing or fails, falls back to Kokoro so
/// the DM never goes silent (invariant #3). `voice_id` picks from VOICE_CATALOG
/// (defaulting to the narrator voice when absent/for plain narration, or on an
/// unrecognized id); the same id resolves to the matching voice under either
/// engine (F5's reference clips are bootstrapped one-per-catalog-voice — see
/// f5_ref_voice_id). `pitch` (`"small"`/`"large"`/absent) is applied as a
/// post-processing step on the synthesized WAV regardless of engine — see
/// pitch_factor, which ignores `pitch` entirely for an archetype voice_id
/// (already race/size-tuned at the source). `speed` (absent = DEFAULT_PACE_FACTOR) is this app's own
/// pace-factor convention (bigger = slower) — see kokoro_speed_from_pace_factor
/// for the conversion to the engines' shared native scale. See dmSpeech.ts for
/// the caller, which falls back to browser speechSynthesis (narrator voice
/// only, no per-NPC voice/pitch/speed) if this errors.
#[tauri::command]
pub async fn speak_text(app: AppHandle, text: String, voice_id: Option<String>, pitch: Option<String>, speed: Option<f64>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let resolved_id = voice_id.as_deref().unwrap_or(DEFAULT_VOICE_ID);
        let native_speed = kokoro_speed_from_pace_factor(speed.unwrap_or(DEFAULT_PACE_FACTOR));

        // Copy the engine out and release the lock before the (multi-second)
        // synthesis, so toggling the engine mid-turn never blocks on a call.
        let engine = *active_engine().lock().unwrap();
        let bytes = match engine {
            TtsEngine::F5 => match synthesize_f5(&app, resolved_id, native_speed, &text) {
                Ok(bytes) => bytes,
                Err(e) => {
                    // F5 selected but unavailable/failed (runtime not installed,
                    // GPU gone, worker error) — never go silent; use Kokoro.
                    log::warn!("F5 synthesis unavailable ({e}); falling back to Kokoro");
                    synthesize_kokoro(&app, resolved_id, native_speed, &text)?
                }
            },
            TtsEngine::Kokoro => synthesize_kokoro(&app, resolved_id, native_speed, &text)?,
        };
        let bytes = fade_wav_edges(&bytes, EDGE_FADE_MS);
        let bytes = reinterpret_wav_sample_rate(&bytes, pitch_factor(pitch.as_deref(), resolved_id));
        Ok(STANDARD.encode(bytes))
    })
    .await
    .map_err(|e| format!("TTS task failed: {e}"))?
}

// ── F5 engine: CUDA capability gate ──────────────────────────────────────
//
// F5-TTS is the optional high-fidelity voice engine (see the plan). It's a
// diffusion model that is only usable at real-time on a capable NVIDIA GPU —
// on CPU it's ~60s/sentence (measured), unusable for live play. So the UI
// checkbox is HARD-GATED on this probe, not merely warned: no capable GPU,
// no checkbox. The probe uses `nvidia-smi` (present with any NVIDIA driver)
// rather than torch, deliberately — it must answer BEFORE the ~3GB F5 runtime
// (which contains torch) has been downloaded, so it can't depend on it.

#[derive(serde::Serialize)]
pub struct CudaInfo {
    pub name: String,
    pub vram_mb: u64,
}

/// Pure: parses the first non-empty line of
/// `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits`,
/// e.g. `NVIDIA GeForce RTX 3090, 24576`. None on anything unparseable so a
/// weird driver output gates the feature off rather than crashing.
fn parse_nvidia_smi_csv(out: &str) -> Option<CudaInfo> {
    let line = out.lines().find(|l| !l.trim().is_empty())?;
    let (name, vram) = line.split_once(',')?;
    let name = name.trim().to_string();
    let vram_mb = vram.trim().parse::<u64>().ok()?;
    if name.is_empty() {
        return None;
    }
    Some(CudaInfo { name, vram_mb })
}

/// Reports the primary NVIDIA GPU (name + VRAM) or `None` when `nvidia-smi`
/// is absent/fails — i.e. no CUDA-capable card. The frontend gates the F5
/// checkbox on this AND a minimum-VRAM bar (F5 + the WebGL character viewport
/// share the GPU), so a technically-present but tiny card doesn't enable a
/// setting that would then stutter.
///
/// `async` + `spawn_blocking`, like every other subprocess-touching command in
/// this file (speak_text/warmup_tts/install_f5_runtime) — NOT incidental
/// boilerplate. A plain sync `#[tauri::command]` runs its body directly on
/// whatever thread services the IPC call, which on Windows is the UI thread;
/// `Command::output()` blocks that thread for the full `nvidia-smi` spawn+wait,
/// freezing the entire window's message loop for however long that takes,
/// which Windows renders as a blank/white, fully unresponsive "ghost" window —
/// confirmed live: the DM Console froze white the instant this ran on mount.
#[tauri::command]
pub async fn probe_cuda() -> Option<CudaInfo> {
    tokio::task::spawn_blocking(|| {
        let mut cmd = Command::new("nvidia-smi");
        cmd.args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // no console flash
        }
        let out = cmd.output().ok()?;
        if !out.status.success() {
            return None;
        }
        parse_nvidia_smi_csv(&String::from_utf8_lossy(&out.stdout))
    })
    .await
    .unwrap_or(None)
}

// ── TTS engine selection ──────────────────────────────────────────────────
//
// Kokoro is the default and the only engine on machines without a capable GPU.
// F5 is an opt-in high-fidelity upgrade (see the plan + the CUDA gate above).
// The active engine is a process-global, defaulting to Kokoro; the frontend
// sets it via set_tts_engine on mount (restoring the persisted setting) and
// whenever the user toggles it. speak_text reads it per call and routes
// accordingly, always falling back to Kokoro if F5 can't run — so flipping this
// can never silence the DM (invariant #3).

#[derive(Clone, Copy)]
enum TtsEngine {
    Kokoro,
    F5,
}

fn active_engine() -> &'static Mutex<TtsEngine> {
    static ENGINE: OnceLock<Mutex<TtsEngine>> = OnceLock::new();
    ENGINE.get_or_init(|| Mutex::new(TtsEngine::Kokoro))
}

/// Sets the active synthesis engine. `"f5"` selects F5; anything else
/// (including the empty string) selects Kokoro — an unrecognized value can only
/// ever fall back to the safe default, never error. Idempotent and cheap (just
/// flips a global), so the frontend can call it freely on every mount and
/// toggle. Does NOT itself gate on CUDA or the runtime being installed — those
/// are the frontend's responsibility before it ever selects F5 — and even a
/// wrongly-selected F5 degrades gracefully to Kokoro at synthesis time.
#[tauri::command]
pub fn set_tts_engine(engine: String) {
    let selected = match engine.as_str() {
        "f5" => TtsEngine::F5,
        _ => TtsEngine::Kokoro,
    };
    *active_engine().lock().unwrap() = selected;
}

// ── F5 engine: runtime resolution ─────────────────────────────────────────
//
// F5 runs out of a self-contained runtime directory downloaded on demand (see
// the plan; the install manager that populates it is task #86) — NOT bundled in
// the installer. Layout, produced by scripts/build-f5-runtime (task #88):
//
//   <runtime>/
//     python.exe                embeddable CPython launcher (+ stdlib/DLLs)
//     f5_cli.py                 the persistent worker (scripts/f5_cli.py, copied in)
//     refs/<voice_id>.wav       one Kokoro-bootstrapped reference clip per catalog
//     refs/<voice_id>.txt         voice, plus its transcript (see plan §D)
//     model/model.safetensors   the F5 checkpoint  (→ F5_CKPT)
//     model/vocab.txt             its vocab         (→ F5_VOCAB)
//
// Two env overrides make the whole thing runnable under `tauri dev` before the
// archive exists (integration/verify, task #90): F5_RUNTIME_DIR points at a
// hand-assembled dir, and F5_PYTHON at an arbitrary interpreter (e.g. the
// scratchpad f5gpu-venv's python) so the embeddable-Python layout isn't
// required just to exercise the plumbing.

/// Everything spawn_f5 needs, resolved from the runtime directory. `ckpt`/
/// `vocab`/`vocoder` are optional: present in a real packaged runtime (passed
/// to the worker as F5_CKPT/F5_VOCAB/F5_VOCODER), absent only in a stripped
/// dev runtime, where f5_cli.py falls back to F5TTS()'s own defaults --
/// for `vocoder` that default is a live download from the HF Hub, so a real
/// packaged runtime always bundles it (build-f5-runtime.ps1) to keep the
/// "no network needed at runtime" promise on a user's first synthesis.
struct F5Runtime {
    python: PathBuf,
    script: PathBuf,
    refs_dir: PathBuf,
    ckpt: Option<PathBuf>,
    vocab: Option<PathBuf>,
    vocoder: Option<PathBuf>,
}

/// Resolves the F5 runtime directory: the F5_RUNTIME_DIR dev override if set,
/// else app-data/f5-runtime (mirrors kokoro_model_cache_dir's app-data
/// placement, so it survives forever like the downloaded Kokoro model).
fn f5_runtime_dir(app: &AppHandle) -> Option<PathBuf> {
    match std::env::var("F5_RUNTIME_DIR") {
        Ok(dir) if !dir.is_empty() => Some(PathBuf::from(dir)),
        _ => app.path().app_data_dir().ok().map(|d| d.join("f5-runtime")),
    }
}

/// Resolves the full runtime, or `None` if it isn't installed (the core
/// pieces — interpreter, worker script, reference clips — aren't all present).
/// `None` is the ordinary "F5 not downloaded yet" state, which callers treat as
/// a graceful Kokoro fallback, never an error.
fn resolve_f5_runtime(app: &AppHandle) -> Option<F5Runtime> {
    let dir = f5_runtime_dir(app)?;
    let python = match std::env::var("F5_PYTHON") {
        Ok(p) if !p.is_empty() => PathBuf::from(p),
        _ => dir.join("python.exe"),
    };
    let script = dir.join("f5_cli.py");
    let refs_dir = dir.join("refs");
    if !python.exists() || !script.exists() || !refs_dir.is_dir() {
        return None;
    }
    let model_dir = dir.join("model");
    let ckpt = Some(model_dir.join("model.safetensors")).filter(|p| p.exists());
    let vocab = Some(model_dir.join("vocab.txt")).filter(|p| p.exists());
    let vocoder = Some(dir.join("vocoder")).filter(|p| p.is_dir());
    Some(F5Runtime { python, script, refs_dir, ckpt, vocab, vocoder })
}

/// Pure: maps a stored NPC voice id to the catalog id whose reference clip F5
/// should clone. Mirrors catalog_kokoro_voice's resolution chain — legacy Piper
/// ids (LEGACY_VOICE_ALIASES) map to their same-gender replacement, a real
/// catalog id maps to itself, anything unknown to the narrator — but returns
/// the CATALOG id (the refs/<id>.wav filename stem, since clips are bootstrapped
/// one-per-catalog-voice; see plan §D) rather than the Kokoro voice name. So an
/// NPC keeps the exact same voice identity across the engine toggle, including
/// the gender-preserving legacy remap.
fn f5_ref_voice_id(voice_id: &str) -> &'static str {
    // ARCHETYPE_VOICES ids resolve to themselves — their ref clip is
    // literally at refs/<id>.wav, no catalog/legacy aliasing involved.
    if let Some((id, _)) = ARCHETYPE_VOICES.iter().find(|(id, _)| *id == voice_id) {
        return id;
    }
    let resolved = LEGACY_VOICE_ALIASES
        .iter()
        .find(|(legacy, _)| *legacy == voice_id)
        .map(|(_, replacement)| *replacement)
        .unwrap_or(voice_id);
    VOICE_CATALOG
        .iter()
        .map(|(id, _)| *id)
        .find(|id| *id == resolved)
        .unwrap_or(DEFAULT_VOICE_ID)
}

// ── F5 engine: persistent process ─────────────────────────────────────────
//
// Same one-warm-process design as Kokoro (see that section) — the F5 model load
// is ~16s, so paying it once and keeping the process warm matters even more here
// than for Kokoro. The synthesis protocol is byte-for-byte the same: write one
// JSON line to stdin, watch the output dir for the new WAV (list_wav_files /
// pick_new_file / wait_for_file_to_stabilize, all reused as-is). The one
// addition over spawn_kokoro is that spawn_f5 blocks until the worker prints
// "READY" (model warm), so acquire_f5 only ever hands back a process that can
// synthesize immediately, and warmup_tts genuinely front-loads the model-load.

/// How long spawn_f5 waits for the worker's "READY" (model loaded) before
/// giving up and killing it. The load is ~16s measured; the ceiling is generous
/// to cover a cold CUDA/torch init on the first spawn after boot, and only ever
/// bites on a genuinely broken runtime (→ Kokoro fallback).
const F5_SPAWN_READY_SECS: u64 = 60;

/// Per-request synthesis timeout. The process is already warm by the time we get
/// here (spawn_f5 waited for READY), and warm F5 inference is ~1.2s/sentence, so
/// 30s is pure headroom for an unusually long line.
const F5_SYNTH_TIMEOUT_SECS: u64 = 30;

struct PersistentF5 {
    child: Child,
    stdin: ChildStdin,
    output_dir: PathBuf,
}

fn f5_process() -> &'static Mutex<Option<PersistentF5>> {
    static PROC: OnceLock<Mutex<Option<PersistentF5>>> = OnceLock::new();
    PROC.get_or_init(|| Mutex::new(None))
}

fn f5_output_dir() -> PathBuf {
    std::env::temp_dir().join("tavern-f5-out")
}

/// Spawns the F5 worker and blocks until it signals "READY" on stdout (model
/// loaded on CUDA) — or errors/times out, in which case the child is killed and
/// an Err returned so the caller falls back to Kokoro. A dedicated thread does
/// the reading (and then continues as the stdout drain), with an mpsc
/// recv_timeout bounding the wait so a wedged interpreter that never prints and
/// never exits can't hang the spawn forever.
fn spawn_f5(runtime: &F5Runtime, output_dir: &Path) -> Result<PersistentF5, String> {
    std::fs::create_dir_all(output_dir).map_err(|e| format!("couldn't create F5 output dir: {e}"))?;

    let mut cmd = Command::new(&runtime.python);
    cmd.arg(&runtime.script).arg(&runtime.refs_dir).arg(output_dir);
    if let Some(ckpt) = &runtime.ckpt {
        cmd.env("F5_CKPT", ckpt);
    }
    if let Some(vocab) = &runtime.vocab {
        cmd.env("F5_VOCAB", vocab);
    }
    if let Some(vocoder) = &runtime.vocoder {
        cmd.env("F5_VOCODER", vocoder);
    }
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // Same console-flash issue as the Kokoro spawn — this app has no console.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Couldn't start F5 ({}): {e}", runtime.python.display()))?;

    let stdin = child.stdin.take().ok_or("no stdin handle")?;
    let stdout = child.stdout.take().ok_or("no stdout handle")?;

    // Read stdout on its own thread: signal the first "READY" over the channel,
    // then keep looping to drain the rest so the pipe never stalls the process.
    // EOF or a read error before READY means startup failed (e.g. f5_cli.py
    // printed "ERROR: CUDA not available" to stderr and exited).
    let (ready_tx, ready_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let mut signaled = false;
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => {
                    if !signaled {
                        let _ = ready_tx.send(false);
                    }
                    break;
                }
                Ok(_) => {
                    if !signaled && line.trim() == "READY" {
                        let _ = ready_tx.send(true);
                        signaled = true;
                    }
                }
                Err(_) => {
                    if !signaled {
                        let _ = ready_tx.send(false);
                    }
                    break;
                }
            }
        }
    });

    match ready_rx.recv_timeout(Duration::from_secs(F5_SPAWN_READY_SECS)) {
        Ok(true) => {}
        _ => {
            // false (startup failed) or a timeout — don't leak the child.
            let _ = child.kill();
            return Err("F5 worker failed to become ready".into());
        }
    }

    if let Some(stderr) = child.stderr.take() {
        drain_in_background(stderr);
    }

    Ok(PersistentF5 { child, stdin, output_dir: output_dir.to_path_buf() })
}

/// Returns the live warm F5 process, spawning one first if there isn't one yet
/// or the previous one has exited — mirrors acquire_kokoro (a dead process,
/// detected via try_wait, is never mistaken for a usable one).
fn acquire_f5<'a>(proc: &'a mut Option<PersistentF5>, runtime: &F5Runtime) -> Result<&'a mut PersistentF5, String> {
    let needs_spawn = match proc {
        Some(p) => matches!(p.child.try_wait(), Ok(Some(_)) | Err(_)),
        None => true,
    };
    if needs_spawn {
        *proc = Some(spawn_f5(runtime, &f5_output_dir())?);
    }
    Ok(proc.as_mut().unwrap())
}

/// One synthesis against the warm F5 process — the same output-dir-watch
/// protocol as synthesize_once, just a different request shape. The request is
/// pre-built by the caller (`{text, voice, speed}` for a catalog voice, plus
/// `ref_file`/`ref_text` for a custom-reference voice — task #91), so the same
/// plumbing serves both without a signature change.
fn synthesize_once_f5(proc: &mut Option<PersistentF5>, runtime: &F5Runtime, request: &serde_json::Value) -> Result<Vec<u8>, String> {
    let f5 = acquire_f5(proc, runtime)?;

    let before = list_wav_files(&f5.output_dir);
    writeln!(f5.stdin, "{request}").map_err(|e| format!("failed writing request to F5: {e}"))?;
    f5.stdin.flush().map_err(|e| format!("failed flushing F5 stdin: {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(F5_SYNTH_TIMEOUT_SECS);
    loop {
        let after = list_wav_files(&f5.output_dir);
        if let Some(new_file) = pick_new_file(&before, &after) {
            wait_for_file_to_stabilize(new_file, deadline);
            let bytes = std::fs::read(new_file).map_err(|e| format!("couldn't read F5's output: {e}"))?;
            let _ = std::fs::remove_file(new_file);
            return Ok(bytes);
        }
        if Instant::now() >= deadline {
            return Err("F5 synthesis timed out".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Synthesizes via the warm F5 process, mirroring
/// synthesize_via_persistent_kokoro: holds the lock for the whole request, and
/// on failure drops the (possibly wedged) process and retries once against a
/// freshly spawned one.
fn synthesize_via_persistent_f5(runtime: &F5Runtime, request: serde_json::Value) -> Result<Vec<u8>, String> {
    let mut proc = f5_process().lock().unwrap();
    match synthesize_once_f5(&mut proc, runtime, &request) {
        Ok(bytes) => Ok(bytes),
        Err(_) => {
            *proc = None;
            synthesize_once_f5(&mut proc, runtime, &request)
        }
    }
}

/// The F5 synthesis path, symmetric with synthesize_kokoro: resolves the
/// runtime (Err if not installed → caller falls back to Kokoro), maps the voice
/// id to its bootstrapped reference clip, and returns raw WAV bytes before the
/// engine-agnostic fade/pitch post-processing. `native_speed` is the same value
/// handed to Kokoro (F5's speed scale runs the same direction — see f5_cli.py),
/// so no per-engine speed conversion is needed.
fn synthesize_f5(app: &AppHandle, voice_id: &str, native_speed: f64, text: &str) -> Result<Vec<u8>, String> {
    let runtime = resolve_f5_runtime(app).ok_or("F5 runtime not installed")?;
    let ref_id = f5_ref_voice_id(voice_id);
    let request = serde_json::json!({ "text": text, "voice": ref_id, "speed": native_speed });
    synthesize_via_persistent_f5(&runtime, request)
}

/// Warms the F5 process (pays the ~16s model-load) if the runtime is installed;
/// a no-op success otherwise, since a not-yet-downloaded F5 just means the first
/// turn falls back to Kokoro — not an error worth surfacing.
fn warmup_f5(app: &AppHandle) -> Result<(), String> {
    let Some(runtime) = resolve_f5_runtime(app) else {
        return Ok(());
    };
    let mut proc = f5_process().lock().unwrap();
    acquire_f5(&mut proc, &runtime)?;
    Ok(())
}

// ── F5 engine: runtime install manager ────────────────────────────────────
//
// The runtime archive (scripts/build-f5-runtime.ps1, task #88) is hosted on a
// GitHub release and fetched on demand the first time the user enables F5 —
// same "lazy download, cache forever" shape as the Kokoro model, just a much
// bigger payload (~4 GB, dominated by torch's bundled CUDA libraries). Nothing
// is in the installer. The frontend gates this behind the CUDA probe and a
// confirm-download modal (task #89), then calls install_f5_runtime and shows a
// progress bar driven by the "f5-install-progress" events emitted here.

/// Where the prebuilt F5 runtime lives: a small JSON manifest plus several
/// zip PARTS, not one file — GitHub Releases hard-caps a single asset at 2GB
/// (confirmed against the built archive, which is ~4GB, dominated by torch's
/// bundled CUDA libraries; splitting is the only option that keeps hosting on
/// GitHub Releases, same as Kokoro's model download). scripts/build-f5-runtime.ps1
/// produces the split parts + this manifest together — upload all of them
/// (not the whole unsplit zip it also leaves behind for local reference) to
/// this release tag, or update this base URL, before shipping F5.
///
/// Overridable via F5_RUNTIME_URL (dev/CI: point at a local server or staging
/// location that serves the SAME manifest+parts layout).
const F5_RUNTIME_RELEASE_BASE_URL: &str =
    "https://github.com/knobilz1/dnd-character-manager/releases/download/f5-runtime-v1";

const F5_RUNTIME_MANIFEST_FILENAME: &str = "f5-runtime-win-x64.manifest.json";

fn f5_runtime_base_url() -> String {
    match std::env::var("F5_RUNTIME_URL") {
        Ok(u) if !u.is_empty() => u,
        _ => F5_RUNTIME_RELEASE_BASE_URL.to_string(),
    }
}

/// Lists the zip parts (relative filenames, in the order they concatenate back
/// into the whole archive) plus the reassembled file's total size and sha256 —
/// written by scripts/build-f5-runtime.ps1 alongside the parts themselves, so
/// the two can never silently drift apart (a manually-edited part count would
/// be caught by the sha256 check in install_f5_runtime, not trusted blindly).
#[derive(serde::Deserialize)]
struct F5RuntimeManifest {
    #[serde(rename = "totalBytes")]
    total_bytes: u64,
    sha256: String,
    parts: Vec<String>,
}

/// Pure: parses a manifest JSON body, tolerating (and stripping) a leading
/// UTF-8 BOM. Windows PowerShell 5.1's `Set-Content -Encoding utf8` ALWAYS
/// prepends a BOM (unlike PowerShell 7+ or an explicit BOM-less encoding) --
/// confirmed live against the real published release: build-f5-runtime.ps1
/// wrote the manifest that way, and serde_json (which does not skip a BOM)
/// failed with "expected value at line 1 column 1" fetching it. The build
/// script is fixed to never write one, but stripping it here too means a
/// manifest built by some other future toolchain/edit can't reintroduce this
/// exact failure mode.
fn parse_manifest_json(body: &str) -> Result<F5RuntimeManifest, String> {
    let body = body.strip_prefix('\u{feff}').unwrap_or(body);
    serde_json::from_str(body).map_err(|e| format!("wasn't valid JSON: {e}"))
}

/// Fetches and parses the manifest from `<base_url>/f5-runtime-win-x64.manifest.json`.
fn fetch_manifest(base_url: &str) -> Result<F5RuntimeManifest, String> {
    let url = format!("{base_url}/{F5_RUNTIME_MANIFEST_FILENAME}");
    let resp = ureq::get(&url).call().map_err(|e| format!("F5 runtime manifest fetch failed ({url}): {e}"))?;
    let body = resp.into_string().map_err(|e| format!("F5 runtime manifest at {url} couldn't be read: {e}"))?;
    parse_manifest_json(&body).map_err(|e| format!("F5 runtime manifest at {url} {e}"))
}

/// Pure: lowercase-hex-encodes bytes — used for the sha256 digest check below.
/// Dependency-free rather than pulling in a hex crate for one call site.
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Hashes a file's full contents (streamed, not loaded into memory — the
/// reassembled archive is gigabytes) and returns its sha256 as lowercase hex,
/// matching the manifest's own format (`Get-FileHash -Algorithm SHA256` on the
/// PowerShell build side, lowercased).
fn sha256_hex(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut file = std::fs::File::open(path).map_err(|e| format!("couldn't open {} to verify it: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| format!("couldn't hash {}: {e}", path.display()))?;
    Ok(hex_encode(&hasher.finalize()))
}

/// Progress payload for the "f5-install-progress" event the settings UI listens
/// to. `phase` is "download" (bytes flowing — `downloaded`/`total` in bytes,
/// `total` 0 if the server sends no Content-Length), "extract" (unzipping — one
/// event, no byte count), or "done".
#[derive(Clone, serde::Serialize)]
struct F5InstallProgress {
    phase: String,
    downloaded: u64,
    total: u64,
}

/// Reports whether a complete F5 runtime is already installed — the frontend
/// uses this on mount to show F5 as ready (vs. offering the download), and to
/// decide the checkbox's locked-on state.
#[tauri::command]
pub fn f5_runtime_installed(app: AppHandle) -> bool {
    resolve_f5_runtime(&app).is_some()
}

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
/// directly testable; install_f5_runtime wires it to the app + progress events.
/// Generic — also reused by campaign.rs's import_campaign_at, not F5-specific
/// despite living in this file (see zip_dir_to below, its write-side sibling).
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

/// Streams `reader` into `writer` in 1MiB chunks, advancing the CALLER-OWNED
/// `downloaded` counter and reporting `on_progress(*downloaded, total)` after
/// each chunk. `downloaded` is owned by the caller (not reset to 0 here) so a
/// multi-part download can carry one running total across several calls (one
/// per part) — see download_multipart_with_progress — producing one smooth
/// aggregate progress bar instead of resetting to 0% at every part boundary.
fn copy_with_progress(mut reader: impl Read, writer: &mut impl Write, downloaded: &mut u64, total: u64, on_progress: &mut impl FnMut(u64, u64)) -> Result<(), String> {
    let mut buf = vec![0u8; 1 << 20]; // 1 MiB
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("download read failed: {e}"))?;
        if n == 0 {
            break;
        }
        writer.write_all(&buf[..n]).map_err(|e| format!("download write failed: {e}"))?;
        *downloaded += n as u64;
        on_progress(*downloaded, total);
    }
    Ok(())
}

/// Downloads every part listed in `manifest`, in order, concatenating them
/// straight into one file at `dest` — the reassembled bytes are the original
/// whole zip scripts/build-f5-runtime.ps1 split (plain concatenation, no
/// per-part framing/headers), so no separate "join" step is needed after this
/// returns. `on_progress` sees one running total across all parts against
/// `manifest.total_bytes`, not each part's own size, so the UI's progress bar
/// climbs smoothly through the whole download rather than restarting per part.
fn download_multipart_with_progress(base_url: &str, manifest: &F5RuntimeManifest, dest: &Path, mut on_progress: impl FnMut(u64, u64)) -> Result<(), String> {
    let mut file = std::fs::File::create(dest).map_err(|e| format!("couldn't create {}: {e}", dest.display()))?;
    let mut downloaded = 0u64;
    for part in &manifest.parts {
        let url = format!("{base_url}/{part}");
        let resp = ureq::get(&url).call().map_err(|e| format!("F5 runtime part download failed ({url}): {e}"))?;
        copy_with_progress(resp.into_reader(), &mut file, &mut downloaded, manifest.total_bytes, &mut on_progress)?;
    }
    Ok(())
}

/// Downloads + extracts the F5 runtime into app-data (idempotent — a complete
/// runtime already present is an immediate success). Emits "f5-install-progress"
/// throughout so the settings UI can show a progress bar. On any failure the
/// partial download is cleaned up and an Err is returned for the UI to surface;
/// F5 stays unselected and the DM keeps using Kokoro.
#[tauri::command]
pub async fn install_f5_runtime(app: AppHandle) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        if resolve_f5_runtime(&app).is_some() {
            let _ = app.emit("f5-install-progress", F5InstallProgress { phase: "done".into(), downloaded: 0, total: 0 });
            return Ok(());
        }

        // Always install to the real app-data location (not the F5_RUNTIME_DIR
        // dev override, which points at a hand-built runtime). The archive root
        // is `f5-runtime/`, so extracting into app-data yields
        // app-data/f5-runtime/, exactly where resolve_f5_runtime looks.
        let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&app_data).map_err(|e| format!("couldn't create app-data dir: {e}"))?;
        let zip_path = app_data.join("f5-runtime.zip.part");

        let base_url = f5_runtime_base_url();
        let manifest = fetch_manifest(&base_url)?;

        // Throttle download events to ~5/sec so a multi-GB, multi-part download
        // doesn't flood the event bus (thousands of 1 MiB chunks otherwise).
        let mut last_emit = Instant::now();
        let app_dl = app.clone();
        let dl = download_multipart_with_progress(&base_url, &manifest, &zip_path, |downloaded, total| {
            if last_emit.elapsed() >= Duration::from_millis(200) {
                let _ = app_dl.emit("f5-install-progress", F5InstallProgress { phase: "download".into(), downloaded, total });
                last_emit = Instant::now();
            }
        });
        if let Err(e) = dl {
            let _ = std::fs::remove_file(&zip_path);
            return Err(e);
        }

        // Verify the reassembled archive before ever handing it to the zip
        // extractor — a dropped/corrupted part must surface as a clear
        // "download is corrupt" error, not a confusing mid-extraction failure
        // (or worse, a silently-incomplete runtime).
        let actual_sha256 = sha256_hex(&zip_path)?;
        if actual_sha256 != manifest.sha256.to_lowercase() {
            let _ = std::fs::remove_file(&zip_path);
            return Err(format!(
                "Downloaded F5 runtime archive is corrupt or incomplete (checksum mismatch: expected {}, got {actual_sha256})",
                manifest.sha256
            ));
        }

        let _ = app.emit("f5-install-progress", F5InstallProgress { phase: "extract".into(), downloaded: 0, total: 0 });
        if let Err(e) = extract_zip_to(&zip_path, &app_data) {
            let _ = std::fs::remove_file(&zip_path);
            return Err(e);
        }
        let _ = std::fs::remove_file(&zip_path);

        // Confirm the extracted archive is actually a usable runtime before
        // declaring success — a truncated/wrong archive must not leave F5
        // "installed" but broken.
        if resolve_f5_runtime(&app).is_none() {
            return Err("F5 runtime archive extracted but the runtime is incomplete".into());
        }
        let _ = app.emit("f5-install-progress", F5InstallProgress { phase: "done".into(), downloaded: 0, total: 0 });
        Ok(())
    })
    .await
    .map_err(|e| format!("F5 install task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_nvidia_smi_csv_reads_name_and_vram() {
        let info = parse_nvidia_smi_csv("NVIDIA GeForce RTX 3090, 24576\n").unwrap();
        assert_eq!(info.name, "NVIDIA GeForce RTX 3090");
        assert_eq!(info.vram_mb, 24576);
    }

    #[test]
    fn parse_nvidia_smi_csv_rejects_junk() {
        assert!(parse_nvidia_smi_csv("").is_none());
        assert!(parse_nvidia_smi_csv("\n\n").is_none());
        assert!(parse_nvidia_smi_csv("no comma here").is_none());
        assert!(parse_nvidia_smi_csv(", 8192").is_none()); // empty name
        assert!(parse_nvidia_smi_csv("Card, notanumber").is_none());
    }

    #[test]
    fn f5_ref_voice_id_maps_catalog_legacy_and_unknown_ids() {
        // A real catalog id refers to its own bootstrapped clip.
        assert_eq!(f5_ref_voice_id("male-gb-3"), "male-gb-3");
        assert_eq!(f5_ref_voice_id("narrator"), "narrator");
        // A legacy Piper id maps to the SAME same-gender replacement Kokoro
        // uses, so identity (and gender) survive the engine toggle.
        assert_eq!(f5_ref_voice_id("male-scottish-1"), "male-gb-2");
        assert_eq!(f5_ref_voice_id("female-irish-1"), "female-gb-3");
        // Unknown ids fall back to the narrator clip, never error.
        assert_eq!(f5_ref_voice_id("dragon-lord-9000"), "narrator");
    }

    #[test]
    fn f5_ref_voice_id_resolves_archetype_ids_to_themselves() {
        // Archetype ids have their own real ref clip -- no catalog/legacy
        // aliasing, unlike VOICE_CATALOG ids' Kokoro-bootstrap indirection.
        assert_eq!(f5_ref_voice_id("orc-m-1"), "orc-m-1");
        assert_eq!(f5_ref_voice_id("dwarf-f-3"), "dwarf-f-3");
        assert_eq!(f5_ref_voice_id("sage-m-5"), "sage-m-5");
    }

    #[test]
    fn catalog_kokoro_voice_resolves_archetype_ids_via_their_fallback() {
        // orc-m-1's declared fallback is male-us-4 -- under Kokoro (or F5
        // unavailable), it must resolve through to male-us-4's OWN Kokoro
        // voice, not error or silently return the fallback id itself.
        let expected = catalog_kokoro_voice("male-us-4").unwrap();
        assert_eq!(catalog_kokoro_voice("orc-m-1").unwrap(), expected);
        let expected_f = catalog_kokoro_voice("female-gb-2").unwrap();
        assert_eq!(catalog_kokoro_voice("dwarf-f-1").unwrap(), expected_f);
    }

    #[test]
    fn every_archetype_voice_fallback_is_a_real_catalog_id() {
        // The one place a typo in ARCHETYPE_VOICES' fallback column could
        // smuggle in a non-catalog id, silently breaking the Kokoro/F5-
        // unavailable safety net this whole table exists for.
        for (id, fallback) in ARCHETYPE_VOICES {
            assert!(
                VOICE_CATALOG.iter().any(|(cid, _)| cid == fallback),
                "archetype id \"{id}\"'s fallback \"{fallback}\" is not a real VOICE_CATALOG id"
            );
        }
    }

    #[test]
    fn archetype_voice_ids_are_unique_and_dont_collide_with_voice_catalog() {
        let mut ids: Vec<&str> = ARCHETYPE_VOICES.iter().map(|(id, _)| *id).collect();
        let before = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), before, "duplicate id within ARCHETYPE_VOICES");
        for (id, _) in ARCHETYPE_VOICES {
            assert!(
                !VOICE_CATALOG.iter().any(|(cid, _)| cid == id),
                "archetype id \"{id}\" collides with an existing VOICE_CATALOG id"
            );
        }
    }

    #[test]
    fn sibling_voice_ids_covers_archetype_buckets_too() {
        let siblings = sibling_voice_ids("orc-m-1");
        assert_eq!(siblings.len(), 5, "expected all 5 orc-m-* siblings, got {siblings:?}");
        assert!(siblings.contains(&"orc-m-2") && siblings.contains(&"orc-m-5"));
        // Must stay within its own bucket -- never bleed into orc-f-* or a
        // same-numbered VOICE_CATALOG id.
        assert!(!siblings.iter().any(|s| s.starts_with("orc-f-")));
    }

    #[test]
    fn f5_ref_voice_id_always_returns_a_real_catalog_id() {
        // Every possible output must be a catalog id that actually has a
        // refs/<id>.wav clip — otherwise F5 would point the worker at a missing
        // file. Checks the legacy replacements specifically, the one place a
        // typo could smuggle in a non-catalog id (an unknown input already maps
        // to the narrator, which is a catalog id by construction).
        for (legacy, _) in LEGACY_VOICE_ALIASES {
            let ref_id = f5_ref_voice_id(legacy);
            assert!(
                VOICE_CATALOG.iter().any(|(id, _)| *id == ref_id),
                "legacy id \"{legacy}\" mapped to \"{ref_id}\", which has no catalog refs clip"
            );
        }
    }

    #[test]
    fn sanitize_zip_path_keeps_normal_nested_paths() {
        assert_eq!(
            sanitize_zip_path("f5-runtime/python.exe"),
            Some(PathBuf::from("f5-runtime").join("python.exe"))
        );
        assert_eq!(
            sanitize_zip_path("f5-runtime/model/vocab.txt"),
            Some(PathBuf::from("f5-runtime").join("model").join("vocab.txt"))
        );
        // A leading "/", a leading "./", and doubled slashes all collapse away,
        // and the result stays relative (so it can only ever land under root).
        assert_eq!(
            sanitize_zip_path("/f5-runtime//refs/narrator.wav"),
            Some(PathBuf::from("f5-runtime").join("refs").join("narrator.wav"))
        );
    }

    #[test]
    fn sanitize_zip_path_rejects_zip_slip_and_drive_paths() {
        assert_eq!(sanitize_zip_path("../evil.exe"), None);
        assert_eq!(sanitize_zip_path("f5-runtime/../../evil"), None);
        assert_eq!(sanitize_zip_path("C:/Windows/system32/evil.dll"), None); // drive letter
        assert_eq!(sanitize_zip_path(""), None);
        assert_eq!(sanitize_zip_path("/"), None);
        assert_eq!(sanitize_zip_path("./"), None);
    }

    #[test]
    fn extract_zip_to_builds_tree_and_normalizes_backslash_entries() {
        use std::io::Write;
        let tmp = std::env::temp_dir().join(format!("f5-extract-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let zip_path = tmp.join("test.zip");
        {
            let f = std::fs::File::create(&zip_path).unwrap();
            let mut zw = zip::ZipWriter::new(f);
            let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
            zw.start_file("f5-runtime/python.exe", opts).unwrap();
            zw.write_all(b"MZ").unwrap();
            zw.start_file("f5-runtime/model/vocab.txt", opts).unwrap();
            zw.write_all(b"a b c").unwrap();
            // A backslash-separated entry, as .NET's zipper produces, must still
            // nest correctly rather than become a file literally named with
            // backslashes.
            zw.start_file("f5-runtime\\refs\\narrator.wav", opts).unwrap();
            zw.write_all(b"RIFF").unwrap();
            zw.finish().unwrap();
        }

        let dest = tmp.join("out");
        extract_zip_to(&zip_path, &dest).unwrap();
        assert!(dest.join("f5-runtime").join("python.exe").exists());
        assert_eq!(
            std::fs::read(dest.join("f5-runtime").join("model").join("vocab.txt")).unwrap(),
            b"a b c"
        );
        assert!(
            dest.join("f5-runtime").join("refs").join("narrator.wav").exists(),
            "backslash entry must extract as a nested path"
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn extract_zip_to_rejects_a_zip_slip_entry() {
        use std::io::Write;
        let tmp = std::env::temp_dir().join(format!("f5-slip-test-{}", std::process::id()));
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

    /// Real integration check: extract the actual multi-GB archive
    /// (scripts/build-f5-runtime.ps1's output, F5_TEST_ZIP) and assert the tree
    /// resolve_f5_runtime needs lands — exercises 50k+ real entries and .NET's
    /// backslash separators. Not in the normal suite (writes ~4 GB). Run with:
    ///   F5_TEST_ZIP=<path to f5-runtime-win-x64.zip> \
    ///     cargo test --lib -- --ignored --nocapture extract_real_f5_archive
    #[test]
    #[ignore]
    fn extract_real_f5_archive_lands_a_resolvable_runtime() {
        let zip_path = PathBuf::from(std::env::var("F5_TEST_ZIP").expect("set F5_TEST_ZIP"));
        let dest = std::env::temp_dir().join("f5-real-extract-test");
        let _ = std::fs::remove_dir_all(&dest);
        extract_zip_to(&zip_path, &dest).expect("real archive should extract");
        let rt = dest.join("f5-runtime");
        assert!(rt.join("python.exe").exists(), "python.exe missing");
        assert!(rt.join("f5_cli.py").exists(), "f5_cli.py missing");
        assert!(rt.join("model").join("model.safetensors").exists(), "checkpoint missing");
        assert!(rt.join("model").join("vocab.txt").exists(), "vocab missing");
        assert!(rt.join("vocoder").join("config.yaml").exists(), "bundled vocoder config missing");
        assert!(rt.join("vocoder").join("pytorch_model.bin").exists(), "bundled vocoder weights missing");
        let ref_wavs = std::fs::read_dir(rt.join("refs"))
            .expect("refs dir must exist")
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().is_some_and(|x| x == "wav"))
            .count();
        assert_eq!(ref_wavs, 108, "expected 28 base + 80 archetype reference clips, got {ref_wavs}");
        let _ = std::fs::remove_dir_all(&dest);
    }

    /// Real integration check against the actual published GitHub release --
    /// regression test for a live bug: the manifest was originally uploaded
    /// with a leading UTF-8 BOM (Windows PowerShell 5.1's `Set-Content
    /// -Encoding utf8` default), which serde_json refused to parse. Confirmed
    /// fixed by re-uploading a BOM-less manifest AND by fetch_manifest now
    /// stripping one defensively (parse_manifest_json's own test covers that
    /// part in isolation) -- this test is the one place that actually hits
    /// the real, hosted URL end-to-end rather than a reproduction string.
    /// Needs network access to github.com. Run with:
    ///   cargo test --lib -- --ignored --nocapture fetch_manifest_against_the_real_release
    #[test]
    #[ignore]
    fn fetch_manifest_against_the_real_release_parses_and_matches_the_uploaded_parts() {
        let manifest = fetch_manifest(F5_RUNTIME_RELEASE_BASE_URL).expect("the real published manifest must fetch and parse cleanly");
        assert_eq!(manifest.parts.len(), 3, "expected the 3 uploaded zip parts");
        assert!(manifest.total_bytes > 4_000_000_000, "expected the ~4GB total, got {}", manifest.total_bytes);
        assert_eq!(manifest.sha256.len(), 64, "sha256 hex digest must be 64 chars");
    }

    #[test]
    fn hex_encode_matches_known_vectors() {
        assert_eq!(hex_encode(&[]), "");
        assert_eq!(hex_encode(&[0x00, 0xff, 0x0a]), "00ff0a");
        assert_eq!(hex_encode(&[0xde, 0xad, 0xbe, 0xef]), "deadbeef");
    }

    #[test]
    fn f5_runtime_manifest_deserializes_from_the_shape_the_build_script_writes() {
        let json = r#"{"totalBytes": 4453332992, "sha256": "abc123", "parts": ["f5-runtime-win-x64.zip.001", "f5-runtime-win-x64.zip.002"]}"#;
        let manifest = parse_manifest_json(json).unwrap();
        assert_eq!(manifest.total_bytes, 4453332992);
        assert_eq!(manifest.sha256, "abc123");
        assert_eq!(manifest.parts, vec!["f5-runtime-win-x64.zip.001", "f5-runtime-win-x64.zip.002"]);
    }

    #[test]
    fn parse_manifest_json_tolerates_a_leading_utf8_bom() {
        // Reproduces the exact failure seen against the real published release:
        // Windows PowerShell 5.1's `Set-Content -Encoding utf8` prepends a BOM
        // (U+FEFF), which serde_json does NOT skip on its own -- confirmed via
        // curl + xxd against the live manifest URL (bytes: ef bb bf 7b ...).
        let json_with_bom = "\u{feff}{\"totalBytes\": 100, \"sha256\": \"deadbeef\", \"parts\": [\"a.zip.001\"]}";
        let manifest = parse_manifest_json(json_with_bom).expect("a leading BOM must not fail parsing");
        assert_eq!(manifest.total_bytes, 100);
        assert_eq!(manifest.sha256, "deadbeef");
        assert_eq!(manifest.parts, vec!["a.zip.001"]);
    }

    #[test]
    fn parse_manifest_json_rejects_genuine_garbage() {
        // The BOM tolerance must not become "accept anything" -- real
        // corruption (an HTML error page, truncated JSON) should still fail
        // clearly, not be silently swallowed.
        assert!(parse_manifest_json("<html>404</html>").is_err());
        assert!(parse_manifest_json("").is_err());
    }

    #[test]
    fn sha256_hex_matches_a_known_vector() {
        // sha256("") — the canonical empty-input test vector, so this catches a
        // wrong hasher/encoding without needing an external reference value.
        let tmp = std::env::temp_dir().join(format!("f5-sha256-empty-{}", std::process::id()));
        std::fs::write(&tmp, b"").unwrap();
        let digest = sha256_hex(&tmp).unwrap();
        assert_eq!(digest, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        let _ = std::fs::remove_file(&tmp);
    }

    /// Real integration check for the multi-part download path: serve a file
    /// split into N parts plus a manifest from a local HTTP server, download
    /// and reassemble via download_multipart_with_progress, and confirm the
    /// bytes land byte-for-byte correct with one smooth aggregate progress
    /// counter spanning all parts (not resetting at each part boundary) — the
    /// two things splitting genuinely put at risk versus a single-file
    /// download. Not in the normal suite (needs a server). Set up a dir with
    /// part files + a manifest.json (see build-f5-runtime.ps1 for the exact
    /// shape), serve it with `python -m http.server`, then:
    ///   F5_TEST_URL=http://localhost:8000 \
    ///     cargo test --lib -- --ignored --nocapture multipart_download_reassembles
    #[test]
    #[ignore]
    fn multipart_download_reassembles_parts_with_smooth_aggregate_progress() {
        let base_url = std::env::var("F5_TEST_URL").expect("set F5_TEST_URL");
        let manifest = fetch_manifest(&base_url).expect("manifest fetch should succeed");
        assert!(manifest.parts.len() >= 2, "test setup should serve at least 2 parts to exercise a part boundary");

        let out = std::env::temp_dir().join("f5-multipart-download-test.bin");
        let _ = std::fs::remove_file(&out);
        let mut samples: Vec<(u64, u64)> = Vec::new();
        download_multipart_with_progress(&base_url, &manifest, &out, |downloaded, total| samples.push((downloaded, total)))
            .expect("multipart download should succeed");

        let size = std::fs::metadata(&out).unwrap().len();
        assert_eq!(size, manifest.total_bytes, "reassembled size must equal the manifest's totalBytes");
        assert_eq!(sha256_hex(&out).unwrap(), manifest.sha256.to_lowercase(), "reassembled bytes must match the manifest checksum");

        // Progress must climb smoothly THROUGH the part boundary, never
        // resetting to a smaller value partway (which would mean each part
        // was reported against its own size instead of the running total).
        let mut prev = 0u64;
        for (d, t) in &samples {
            assert!(*d >= prev, "progress went backwards across a part boundary: {d} < {prev}");
            assert_eq!(*t, manifest.total_bytes, "every progress callback must report the SAME grand total, not a per-part one");
            prev = *d;
        }
        assert_eq!(samples.last().unwrap().0, size, "final progress must equal the reassembled file size");
        let _ = std::fs::remove_file(&out);
    }

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
        assert_eq!(pitch_factor(Some("small"), "female-us-1"), 1.25);
        assert_eq!(pitch_factor(Some("gruff"), "female-us-1"), 0.92);
        assert_eq!(pitch_factor(Some("large"), "female-us-1"), 0.82);
        assert_eq!(pitch_factor(None, "female-us-1"), 1.0);
        assert_eq!(pitch_factor(Some("ogre-9000"), "female-us-1"), 1.0, "unknown tags should fall back to no pitch change, not error");
    }

    #[test]
    fn pitch_factor_ignores_pitch_entirely_for_an_archetype_voice() {
        // orc-m-1's reference clip was already tuned deeper at the source
        // (real VCTK recordings, hand-picked) -- layering "large" on top via
        // the WAV-rate hack would double up and distort it, so this must stay
        // a no-op (1.0) no matter what pitch tag is passed alongside it.
        assert_eq!(pitch_factor(Some("large"), "orc-m-1"), 1.0);
        assert_eq!(pitch_factor(Some("small"), "gnome-f-3"), 1.0);
        assert_eq!(pitch_factor(Some("gruff"), "dwarf-m-5"), 1.0);
        assert_eq!(pitch_factor(None, "orc-m-1"), 1.0);
    }

    #[test]
    fn pitch_factor_gruff_is_milder_than_large_but_still_a_deepening_direction() {
        // gruff (half-orcs, goliaths — Medium size) should sit between
        // "no shift" and "large" (actually Large+ creatures), never at or
        // past large's shift — see pitch_factor's doc comment for why these
        // need to be mechanically distinct, not just two names for one tag.
        let gruff = pitch_factor(Some("gruff"), "female-us-1");
        let large = pitch_factor(Some("large"), "female-us-1");
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
        let pitched = reinterpret_wav_sample_rate(&faded, pitch_factor(Some("small"), "female-us-1"));
        assert_eq!(&pitched[0..4], b"RIFF", "post-processing pipeline must still produce a well-formed WAV");
    }

    /// Real integration check against the actual F5 runtime (an interpreter with
    /// f5-tts installed + `scripts/f5_cli.py` + a refs dir with at least the
    /// requested voice's <id>.wav/.txt) — like kokoro_end_to_end above, NOT part
    /// of the normal suite (needs a GPU, a multi-GB model, and a live
    /// subprocess). Exercises exactly the new plumbing: spawn_f5's READY-wait
    /// thread, the output-dir file-watch, and warm-process reuse across calls.
    /// Run (ckpt/vocab/vocoder left to F5TTS's cached default unless set) with:
    ///   F5_TEST_PYTHON=<venv python> F5_TEST_SCRIPT=<scripts/f5_cli.py> \
    ///     F5_TEST_REFS=<refs dir> \
    ///     cargo test --lib -- --ignored --nocapture f5_end_to_end
    #[test]
    #[ignore]
    fn f5_end_to_end_produces_playable_wav_bytes() {
        let runtime = F5Runtime {
            python: PathBuf::from(std::env::var("F5_TEST_PYTHON").expect("set F5_TEST_PYTHON")),
            script: PathBuf::from(std::env::var("F5_TEST_SCRIPT").expect("set F5_TEST_SCRIPT")),
            refs_dir: PathBuf::from(std::env::var("F5_TEST_REFS").expect("set F5_TEST_REFS")),
            ckpt: std::env::var("F5_TEST_CKPT").ok().map(PathBuf::from),
            vocab: std::env::var("F5_TEST_VOCAB").ok().map(PathBuf::from),
            vocoder: std::env::var("F5_TEST_VOCODER").ok().map(PathBuf::from),
        };

        let request = serde_json::json!({ "text": "Testing the real F five pipeline end to end.", "voice": "male-gb-1", "speed": 1.0 });
        let bytes = synthesize_via_persistent_f5(&runtime, request).expect("synthesis against the real F5 runtime should succeed");
        assert!(bytes.len() > 1000, "expected a real WAV file, got {} bytes", bytes.len());
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");

        // A second call must reuse the SAME warm process — spawn_f5 paid the
        // ~16s model-load + READY wait exactly once — proving the
        // one-warm-process design works against the real worker, not just the
        // Kokoro one.
        let request2 = serde_json::json!({ "text": "A second line through the same warm process.", "voice": "male-gb-1", "speed": 1.0 });
        let bytes2 = synthesize_via_persistent_f5(&runtime, request2).expect("second synthesis against the same warm process should succeed");
        assert!(bytes2.len() > 1000);

        // The engine-agnostic post-processing must accept F5's WAV too.
        let faded = fade_wav_edges(&bytes, EDGE_FADE_MS);
        let pitched = reinterpret_wav_sample_rate(&faded, pitch_factor(Some("gruff"), "male-gb-1"));
        assert_eq!(&pitched[0..4], b"RIFF", "post-processing pipeline must still produce a well-formed WAV from F5 output");
    }
}
