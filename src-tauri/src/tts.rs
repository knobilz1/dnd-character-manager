//! tts.rs — local, in-app text-to-speech via a bundled Piper binary.
//!
//! Piper (https://github.com/OHF-Voice/piper1-gpl, GPLv3) ships only as a
//! Python wheel, so `public/tts/piper.exe` is a standalone build frozen with
//! PyInstaller — no Python installation needed at runtime. It's invoked here
//! as a plain subprocess (same Command+stdin-piping shape as dm.rs's `claude`
//! call), never linked into this app's own binary — the standard "mere
//! aggregation" pattern also used for bundling e.g. ffmpeg, which keeps
//! Tavern Sheet's own code unaffected by Piper's GPLv3 license. See
//! public/tts/NOTICE.txt + PIPER_LICENSE.txt for the license text shipped
//! alongside the binary.
//!
//! Windows-only for now (see tauri.conf.json's `bundle.resources`) — the
//! frontend (dmSpeech.ts) falls back to the browser's own speechSynthesis if
//! this command errors, so other platforms keep working without this piece.
//!
//! **Piper runs as a persistent warm process**, not spawned fresh per call —
//! confirmed live that `piper.exe -d <dir> --output-dir-naming timestamp`
//! stays running and keeps accepting new lines on stdin indefinitely (only
//! exits when stdin is closed), each line producing one new file in the
//! output directory. Keeping it alive across turns (and, once per-line NPC
//! voices land, across multiple calls within one turn) avoids paying process
//! spawn overhead every single time.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::collections::HashSet;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// Curated pool of NPC voices, plus the bundled narrator voice as just
/// another catalog entry (see ensure_voice_available's doc comment for why
/// that unifies the lookup instead of special-casing it). Each entry is
/// (id, repo path, speaker index). The repo path is the voice's path within
/// the rhasspy/piper-voices Hugging Face repo, relative to the repo root and
/// without a file extension — both `<path>.onnx` and `<path>.onnx.json`
/// exist there. All medium quality: low-quality Piper voices save only
/// ~30-40MB each while sounding distinctly more synthetic (verified against
/// Piper's own docs/community guidance), not a good trade now that voices are
/// lazily downloaded rather than bundled — installer size is no longer the
/// constraint, so there's no reason to take the quality hit.
///
/// The speaker index is `None` for a single-speaker model (the whole .onnx is
/// one voice) and `Some(n)` for one specific speaker within a multi-speaker
/// pack — several catalog ids can (and do, for `en_GB-vctk-medium` below)
/// share the same repo path with different speaker indices, since the model
/// file itself is identical and only the `-s`/`--speaker` flag picked at
/// Piper process start differs (confirmed against Piper's own `__main__.py`
/// argparse definitions: `-s, --speaker` takes an int, default 0, and is
/// fixed for that process's whole lifetime — there is no per-line/JSON-input
/// way to change it, which is why needs_restart below has to key off
/// (model, speaker) as a pair, not just model).
///
/// Deliberately several distinct voices per gender/accent bucket (not just
/// one or two) — see BASE_CLAUDE_MD's "Giving NPCs distinct voices" for the
/// instruction to actually spread NPCs across them, since a bucket with only
/// one real option means every same-gender NPC in a campaign converges on the
/// same voice regardless of how large the catalog looks.
///
/// The `en_GB-vctk-medium` speaker indices were curated from real published
/// metadata, not guessed and not "listened to for quality" (nobody has) —
/// cross-referenced the University of Edinburgh's own VCTK speaker-info.txt
/// (AGE/GENDER/ACCENT/REGION per speaker) against this specific Piper build's
/// `speaker_id_map` (confirmed via its own onnx.json) so every id below maps
/// to a real speaker with a verified gender and accent region, not a blind
/// numeric guess into 109 unlabeled slots. VCTK itself is a controlled
/// studio-recorded corpus (Centre for Speech Technology Research, Edinburgh),
/// not scraped audiobook narration of wildly varying quality like
/// `libritts_r` — which is why this pack was chosen over that one even
/// though `libritts_r` has far more raw speakers (see the conversation this
/// was decided in: `libritts_r`'s own config exposes nothing but bare numeric
/// corpus IDs, no metadata at all, making honest curation impossible without
/// an actual listening pass).
///
/// All non-VCTK single-speaker paths below were confirmed against
/// rhasspy/piper-voices' own voices.json. Character (gender/register)
/// mapping for the single-speaker (non-VCTK) ones is by voice name + accent
/// only — nobody's actually listened to those yet either to confirm finer
/// shades like "gruff" or "elderly"; swapping an id to a better-sounding
/// voice later is a one-line change, not a re-architecture. Keep this in
/// sync with BASE_CLAUDE_MD's voice catalog list (campaign.rs), campaign.rs's
/// build_voice_reconciliation_prompt, and dmActions.ts's VOICE_CATALOG_IDS —
/// all four must agree on valid ids.
const VOICE_CATALOG: &[(&str, &str, Option<u32>)] = &[
    ("narrator", "en/en_US/lessac/medium/en_US-lessac-medium", None),
    ("male-us-1", "en/en_US/hfc_male/medium/en_US-hfc_male-medium", None),
    ("male-us-2", "en/en_US/joe/medium/en_US-joe-medium", None),
    ("male-us-3", "en/en_US/bryce/medium/en_US-bryce-medium", None),
    ("male-us-4", "en/en_US/john/medium/en_US-john-medium", None),
    ("male-us-5", "en/en_US/kusal/medium/en_US-kusal-medium", None),
    ("male-gb-1", "en/en_GB/alan/medium/en_GB-alan-medium", None),
    ("male-gb-2", "en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium", None),
    ("female-us-1", "en/en_US/hfc_female/medium/en_US-hfc_female-medium", None),
    ("female-us-2", "en/en_US/kristin/medium/en_US-kristin-medium", None),
    ("female-us-3", "en/en_US/amy/medium/en_US-amy-medium", None),
    ("female-gb-1", "en/en_GB/cori/medium/en_GB-cori-medium", None),
    ("female-gb-2", "en/en_GB/alba/medium/en_GB-alba-medium", None),
    ("female-gb-3", "en/en_GB/jenny_dioco/medium/en_GB-jenny_dioco-medium", None),
    // en_GB-vctk-medium speakers — see the doc comment above for how these
    // were curated. VCTK p-code / real region noted per entry so the mapping
    // stays auditable against speaker-info.txt without re-deriving it.
    ("male-gb-3", "en/en_GB/vctk/medium/en_GB-vctk-medium", Some(23)), // p287, York, English
    ("female-gb-4", "en/en_GB/vctk/medium/en_GB-vctk-medium", Some(77)), // p269, Newcastle, English
    ("male-scottish-1", "en/en_GB/vctk/medium/en_GB-vctk-medium", Some(102)), // p237, Fife, Scottish
    ("male-scottish-2", "en/en_GB/vctk/medium/en_GB-vctk-medium", Some(79)), // p252, Edinburgh, Scottish
    ("female-scottish-1", "en/en_GB/vctk/medium/en_GB-vctk-medium", Some(2)), // p264, West Lothian, Scottish
    ("male-irish-1", "en/en_GB/vctk/medium/en_GB-vctk-medium", Some(97)), // p245, Dublin, Irish
    ("male-irish-2", "en/en_GB/vctk/medium/en_GB-vctk-medium", Some(108)), // p364, Donegal, Irish
    ("female-irish-1", "en/en_GB/vctk/medium/en_GB-vctk-medium", Some(58)), // p288, Dublin, Irish
    ("female-welsh-1", "en/en_GB/vctk/medium/en_GB-vctk-medium", Some(88)), // p253, Cardiff, Welsh
    ("male-northernirish-1", "en/en_GB/vctk/medium/en_GB-vctk-medium", Some(28)), // p304, Belfast, NorthernIrish
    ("female-northernirish-1", "en/en_GB/vctk/medium/en_GB-vctk-medium", Some(6)), // p261, Belfast, NorthernIrish
    ("male-australian-1", "en/en_GB/vctk/medium/en_GB-vctk-medium", Some(71)), // p326, Sydney, Australian
    ("male-southafrican-1", "en/en_GB/vctk/medium/en_GB-vctk-medium", Some(32)), // p347, Johannesburg, SouthAfrican
    ("female-southafrican-1", "en/en_GB/vctk/medium/en_GB-vctk-medium", Some(35)), // p314, Cape Town, SouthAfrican
    ("female-us-4", "en/en_GB/vctk/medium/en_GB-vctk-medium", Some(34)), // p308, Alabama, American
];

/// Used whenever a line has no NPC voice assigned (plain narration, or an NPC
/// nobody's assigned a voice to yet) — the one voice actually bundled in the
/// installer, so this is also the only catalog entry `ensure_voice_available`
/// resolves for free with zero network access.
const DEFAULT_VOICE_ID: &str = "narrator";

const HF_VOICES_BASE_URL: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main";

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

// ── NPC voice pool: lazy download + cache ────────────────────────────────

/// Pure: the last path segment of a catalog repo path is always that voice's
/// file basename (e.g. "en/en_US/lessac/medium/en_US-lessac-medium" →
/// "en_US-lessac-medium") — both the bundled resource filename (for
/// "narrator") and the cached-download filename (for everything else) key
/// off this same string, which is what lets ensure_voice_available check
/// both locations with one code path instead of special-casing the narrator.
fn voice_basename(repo_path: &str) -> &str {
    repo_path.rsplit('/').next().unwrap_or(repo_path)
}

/// Pure: looks up a voice id in the catalog, or an error naming it as
/// unknown — called before any filesystem/network access so a bad id from a
/// stale/hallucinated dm-actions value fails fast and cheaply.
fn catalog_repo_path(voice_id: &str) -> Result<&'static str, String> {
    VOICE_CATALOG
        .iter()
        .find(|(id, _, _)| *id == voice_id)
        .map(|(_, path, _)| *path)
        .ok_or_else(|| format!("Unknown voice id \"{voice_id}\""))
}

/// Pure: the speaker index for a multi-speaker catalog entry (e.g. one of
/// the `en_GB-vctk-medium` ids), or `None` for a single-speaker voice —
/// including an unknown id, tolerated the same way an unknown voice_id
/// already is elsewhere (catalog_repo_path is what actually validates
/// existence; this is only ever called after that already succeeded).
fn catalog_speaker_id(voice_id: &str) -> Option<u32> {
    VOICE_CATALOG.iter().find(|(id, _, _)| *id == voice_id).and_then(|(_, _, speaker)| *speaker)
}

/// Where downloaded (non-bundled) voices are cached — separate from
/// piper_output_dir (that's ephemeral synthesis output; this is a permanent,
/// once-ever-per-machine download cache), same "lives in app-data, survives
/// forever" shape as dmSpeech.ts's Whisper model caching in the browser.
fn voice_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("tts_voices"))
}

/// Streams `url` straight to `dest` (no full-file buffering in memory — these
/// are ~60MB files) via a `.part` temp file renamed into place on success, so
/// a download that dies partway through never leaves a corrupt file at the
/// real path for a later call to mistake as complete.
fn download_to_file(url: &str, dest: &Path) -> Result<(), String> {
    let resp = ureq::get(url).call().map_err(|e| format!("Voice download failed ({url}): {e}"))?;
    let tmp = dest.with_extension("part");
    {
        let mut file = std::fs::File::create(&tmp).map_err(|e| format!("Couldn't create {}: {e}", tmp.display()))?;
        std::io::copy(&mut resp.into_reader(), &mut file).map_err(|e| format!("Voice download write failed: {e}"))?;
    }
    std::fs::rename(&tmp, dest).map_err(|e| e.to_string())
}

/// Resolves a voice id to its .onnx model file on disk, fetching it if
/// needed. Checks, in order: (1) bundled app resources — only ever hits for
/// "narrator", the one voice actually shipped in the installer (see
/// VOICE_CATALOG's doc comment); (2) the local download cache
/// (app-data/tts_voices/), populated by a previous call; (3) downloads both
/// the .onnx and its .onnx.json config from the rhasspy/piper-voices
/// Hugging Face repo into that cache dir. Same "lazy download, cache
/// forever" shape already used for the Whisper STT model in dmSpeech.ts —
/// the first time any given campaign actually needs a voice, it costs one
/// real download; every call after that (any campaign, this machine) is free.
fn ensure_voice_available(app: &AppHandle, voice_id: &str) -> Result<PathBuf, String> {
    let repo_path = catalog_repo_path(voice_id)?;
    let basename = voice_basename(repo_path);
    let onnx_filename = format!("{basename}.onnx");
    let json_filename = format!("{basename}.onnx.json");

    if let (Ok(onnx), Ok(_json)) = (find_resource(app, &onnx_filename), find_resource(app, &json_filename)) {
        return Ok(onnx);
    }

    let cache_dir = voice_cache_dir(app)?;
    let onnx_path = cache_dir.join(&onnx_filename);
    let json_path = cache_dir.join(&json_filename);
    if onnx_path.exists() && json_path.exists() {
        return Ok(onnx_path);
    }

    std::fs::create_dir_all(&cache_dir).map_err(|e| format!("Couldn't create voice cache dir: {e}"))?;
    download_to_file(&format!("{HF_VOICES_BASE_URL}/{repo_path}.onnx"), &onnx_path)?;
    download_to_file(&format!("{HF_VOICES_BASE_URL}/{repo_path}.onnx.json"), &json_path)?;
    Ok(onnx_path)
}

// ── Persistent Piper process pool ────────────────────────────────────────
//
// A single warm process meant every speaker switch inside a dialogue-heavy
// scene (narrator -> NPC A -> narrator -> NPC B) paid a full respawn — kill,
// spawn, ONNX Runtime session creation off a ~60-80MB model file — on every
// line, since Piper's `-s/--speaker` flag is fixed for a process's whole
// lifetime (confirmed against Piper's own `__main__.py` argparse: no per-
// line way to change it). Keeping several voices warm at once (an LRU pool,
// not just one slot) means a scene's narrator plus a handful of active NPCs
// can all stay loaded simultaneously, so only a genuinely new voice pays the
// respawn cost. Purely a local RAM/process tradeoff — no token or Claude-API
// cost at all, since this is 100% local TTS, unrelated to dm.rs's `claude`
// subprocess. An idle warm process does no work and burns no CPU (it's just
// sitting on a blocked stdin read); the cost is memory, roughly the model's
// own file size plus ONNX Runtime overhead per resident process.

/// How many distinct (model, speaker) voices stay warm at once. 5 was picked
/// as comfortably covering a typical scene's active speaker set (narrator +
/// a handful of NPCs) without needing to guess in advance which one to
/// evict mid-conversation — see the module comment above for the memory
/// cost this trades against.
const MAX_WARM_PIPER_PROCESSES: usize = 5;

struct PersistentPiper {
    child: Child,
    stdin: ChildStdin,
    model: PathBuf,
    speaker: Option<u32>,
    output_dir: PathBuf,
    last_used: Instant,
}

fn piper_pool() -> &'static Mutex<Vec<PersistentPiper>> {
    static POOL: OnceLock<Mutex<Vec<PersistentPiper>>> = OnceLock::new();
    POOL.get_or_init(|| Mutex::new(Vec::new()))
}

fn piper_output_dir() -> PathBuf {
    std::env::temp_dir().join("tavern-piper-out")
}

/// Pure: each warm process gets its own output subdirectory, keyed by model
/// basename + speaker index, rather than every process sharing one — a
/// stale leftover file from one voice's directory should never be mistaken
/// for a different voice's completed synthesis. (Today's one-request-at-a-
/// time locking in synthesize_via_persistent_piper already prevents a true
/// concurrent mix-up across processes, but this keeps each process's own
/// directory listing meaningful in isolation too — e.g. for debugging.)
fn piper_output_dir_for(model: &Path, speaker: Option<u32>) -> PathBuf {
    let basename = model.file_stem().and_then(|s| s.to_str()).unwrap_or("voice");
    match speaker {
        Some(s) => piper_output_dir().join(format!("{basename}_{s}")),
        None => piper_output_dir().join(basename),
    }
}

/// Pure: index of the pool entry already running this exact (model,
/// speaker), if any. Speaker must match alongside model (not model alone)
/// because Piper's `-s` flag is fixed at process startup — two catalog ids
/// sharing one multi-speaker model file (e.g. two different VCTK voices)
/// are NOT interchangeable warm entries.
fn pool_match_index(entries: &[(PathBuf, Option<u32>)], model: &Path, speaker: Option<u32>) -> Option<usize> {
    entries.iter().position(|(m, s)| m == model && *s == speaker)
}

/// Pure: index of the least-recently-used entry, for eviction once the pool
/// is at MAX_WARM_PIPER_PROCESSES capacity. `None` only when given no
/// entries at all.
fn lru_index(last_used: &[Instant]) -> Option<usize> {
    last_used.iter().enumerate().min_by_key(|(_, t)| **t).map(|(i, _)| i)
}

/// Drains a child's stdout/stderr in a background thread so the pipe buffer
/// never fills and stalls the (long-lived) process — Piper writes one INFO
/// log line per synthesis, harmless to just discard.
fn drain_in_background<R: std::io::Read + Send + 'static>(reader: R) {
    std::thread::spawn(move || {
        let mut buf_reader = BufReader::new(reader);
        let mut line = String::new();
        while buf_reader.read_line(&mut line).unwrap_or(0) > 0 {
            line.clear();
        }
    });
}

/// Pure: picks whichever file in `after` wasn't present in `before` — how a
/// completed synthesis is detected without parsing Piper's stdout (which
/// only carries a human-readable log line, not a machine-readable signal).
fn pick_new_file<'a>(before: &'a HashSet<PathBuf>, after: &'a HashSet<PathBuf>) -> Option<&'a PathBuf> {
    after.difference(before).next()
}

fn list_wav_files(dir: &Path) -> HashSet<PathBuf> {
    std::fs::read_dir(dir)
        .map(|entries| entries.filter_map(|e| e.ok()).map(|e| e.path()).collect())
        .unwrap_or_default()
}

/// Waits until `path`'s size stops changing across two checks a few ms apart
/// (or 0-byte, which briefly happens right after Piper creates the file but
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

/// A fixed, deliberate slow-down applied to every voice's speaking rate.
/// Piper's own per-voice default (baked into each voice's onnx.json,
/// effectively ~1.0 when unset) reads as brisk/conversational — noticeable on
/// every line, but most jarring against slower, weightier narration (the kind
/// dramatic world-building calls for), where a rushed delivery clashes with
/// the tone. `--length-scale` is Piper's own name for this (confirmed via
/// this build's own `--help`: "Phoneme length" — bigger stretches every
/// phoneme longer, i.e. slower speech). Like `-s/--speaker`, it's fixed for a
/// process's whole lifetime — this build's `--help` shows no per-line/JSON-
/// input override — so this is one constant applied to every warm process
/// rather than something the DM could dial per-line without a full respawn
/// per distinct rate. 1.15 was picked as a noticeably more deliberate,
/// measured cadence without dragging into "slow reading aloud" territory;
/// nobody's actually listened yet to confirm this is the right number — a
/// one-line change to retune once someone has.
const SPEECH_LENGTH_SCALE: f64 = 1.15;

/// Pure: the full argument list `spawn_piper` passes to the Piper process,
/// pulled out so the flag set (and their order/presence) is directly
/// testable without actually spawning a binary. `speaker` conditionally adds
/// `-s`; `--length-scale` is always present (see SPEECH_LENGTH_SCALE).
fn piper_spawn_args(model_str: &str, speaker: Option<u32>, output_dir_str: &str) -> Vec<String> {
    let mut args = vec![
        "-m".to_string(),
        model_str.to_string(),
        "-d".to_string(),
        output_dir_str.to_string(),
        "--output-dir-naming".to_string(),
        "timestamp".to_string(),
        "--length-scale".to_string(),
        SPEECH_LENGTH_SCALE.to_string(),
    ];
    if let Some(s) = speaker {
        args.push("-s".to_string());
        args.push(s.to_string());
    }
    args
}

fn spawn_piper(exe: &Path, model: &Path, speaker: Option<u32>, output_dir: &Path) -> Result<PersistentPiper, String> {
    std::fs::create_dir_all(output_dir).map_err(|e| format!("couldn't create Piper output dir: {e}"))?;

    let model_str = model.to_string_lossy().into_owned();
    let output_dir_str = output_dir.to_string_lossy().into_owned();

    let mut cmd = Command::new(exe);
    cmd.args(piper_spawn_args(&model_str, speaker, &output_dir_str));
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // Same console-flash issue as dm.rs's `claude` spawn — piper.exe is a
    // console-subsystem binary and this app has no console of its own.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Couldn't start Piper ({}): {e}", exe.display()))?;

    let stdin = child.stdin.take().ok_or("no stdin handle")?;
    if let Some(stdout) = child.stdout.take() {
        drain_in_background(stdout);
    }
    if let Some(stderr) = child.stderr.take() {
        drain_in_background(stderr);
    }

    Ok(PersistentPiper {
        child,
        stdin,
        model: model.to_path_buf(),
        speaker,
        output_dir: output_dir.to_path_buf(),
        last_used: Instant::now(),
    })
}

/// Finds a live, already-warm pool entry for (model, speaker), or makes room
/// — evicting the least-recently-used entry if the pool is already at
/// MAX_WARM_PIPER_PROCESSES capacity — and spawns a fresh one. Prunes any
/// entry that exited on its own first (via try_wait, so this is the one part
/// of pool management not covered by the pure pool_match_index/lru_index
/// helpers above — a real Child handle is required), so a dead process
/// never counts against the pool's size limit or gets mistaken for a live
/// match. Returns the index into `pool` of the ready-to-use entry.
fn acquire_piper(pool: &mut Vec<PersistentPiper>, exe: &Path, model: &Path, speaker: Option<u32>) -> Result<usize, String> {
    pool.retain_mut(|p| !matches!(p.child.try_wait(), Ok(Some(_)) | Err(_)));

    let entries: Vec<(PathBuf, Option<u32>)> = pool.iter().map(|p| (p.model.clone(), p.speaker)).collect();
    if let Some(idx) = pool_match_index(&entries, model, speaker) {
        return Ok(idx);
    }

    if pool.len() >= MAX_WARM_PIPER_PROCESSES {
        let last_used: Vec<Instant> = pool.iter().map(|p| p.last_used).collect();
        if let Some(evict_idx) = lru_index(&last_used) {
            // Dropping this entry closes its stdin pipe, which is what
            // actually makes the old Piper process exit on its own (see the
            // module doc comment on why nothing here calls Child::kill).
            pool.remove(evict_idx);
        }
    }

    let output_dir = piper_output_dir_for(model, speaker);
    pool.push(spawn_piper(exe, model, speaker, &output_dir)?);
    Ok(pool.len() - 1)
}

/// One synthesis against whatever's warm in `pool`, acquiring (finding or
/// spawning) the right entry first. Not retried here — the caller
/// (`synthesize_via_persistent_piper`) handles the "process died mid-
/// request" retry.
fn synthesize_once(pool: &mut Vec<PersistentPiper>, exe: &Path, model: &Path, speaker: Option<u32>, text: &str) -> Result<Vec<u8>, String> {
    let idx = acquire_piper(pool, exe, model, speaker)?;
    pool[idx].last_used = Instant::now();

    let before = list_wav_files(&pool[idx].output_dir);
    writeln!(pool[idx].stdin, "{text}").map_err(|e| format!("failed writing text to Piper: {e}"))?;
    pool[idx].stdin.flush().map_err(|e| format!("failed flushing Piper stdin: {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let after = list_wav_files(&pool[idx].output_dir);
        if let Some(new_file) = pick_new_file(&before, &after) {
            // Piper creates the file, then writes to it — reading the
            // instant it exists can race the write and return a truncated
            // (sometimes 0-byte) file. Wait for its size to stop changing
            // across two checks before treating it as complete.
            wait_for_file_to_stabilize(new_file, deadline);
            let bytes = std::fs::read(new_file).map_err(|e| format!("couldn't read Piper's output: {e}"))?;
            let _ = std::fs::remove_file(new_file);
            return Ok(bytes);
        }
        if Instant::now() >= deadline {
            return Err("Piper synthesis timed out".into());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// Synthesizes via the warm process pool, holding the lock for the whole
/// request — matches the app's existing one-turn-at-a-time design, so this
/// never needs to disambiguate which output file belongs to which
/// concurrent caller. On failure, evicts just the one entry that failed
/// (not the whole pool — a single dead voice shouldn't cost every other
/// still-warm voice) and retries exactly once, covering "this particular
/// process died since we last used it."
fn synthesize_via_persistent_piper(exe: &Path, model: &Path, speaker: Option<u32>, text: &str) -> Result<Vec<u8>, String> {
    let mut pool = piper_pool().lock().unwrap();
    match synthesize_once(&mut pool, exe, model, speaker, text) {
        Ok(bytes) => Ok(bytes),
        Err(_) => {
            pool.retain(|p| !(p.model == model && p.speaker == speaker));
            synthesize_once(&mut pool, exe, model, speaker, text)
        }
    }
}

/// Warms up the narrator voice's Piper process ahead of the first real turn
/// — mirrors dmSpeech.ts's `warmupSTT()` for Whisper. Fire-and-forget from
/// the frontend (called once at app mount, before any campaign is even
/// picked); a failure here just means the first real `speak_text` call pays
/// the one-time spawn cost instead. See warmup_voice for the more general
/// form used once a campaign's own NPC voice assignments are known.
#[tauri::command]
pub async fn warmup_piper(app: AppHandle) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let exe = find_resource(&app, "piper.exe")?;
        let model = ensure_voice_available(&app, DEFAULT_VOICE_ID)?;
        let mut pool = piper_pool().lock().unwrap();
        acquire_piper(&mut pool, &exe, &model, catalog_speaker_id(DEFAULT_VOICE_ID))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Piper warmup task failed: {e}"))?
}

/// Warms up one arbitrary catalog voice ahead of time — generalizes
/// warmup_piper (which only ever warms the narrator, the one voice known
/// before any campaign is even picked) so the frontend can also pre-warm a
/// campaign's already-assigned NPC voices right after switching to it (see
/// DMConsolePage's campaign-switch effect), instead of the FIRST time any
/// given NPC ever speaks in a sitting paying the full spawn+model-load cost
/// mid-turn. Fire-and-forget, same tolerance as warmup_piper. An unknown
/// voice_id fails fast via ensure_voice_available's own catalog lookup
/// rather than doing any real work — harmless for the frontend to call this
/// speculatively over every assigned NPC without pre-filtering.
#[tauri::command]
pub async fn warmup_voice(app: AppHandle, voice_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let exe = find_resource(&app, "piper.exe")?;
        let model = ensure_voice_available(&app, &voice_id)?;
        let mut pool = piper_pool().lock().unwrap();
        acquire_piper(&mut pool, &exe, &model, catalog_speaker_id(&voice_id))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Voice warmup task failed: {e}"))?
}

/// Race/size-based pitch tag → playback-rate multiplier. Piper's CLI has no
/// native pitch control (only length_scale/noise_scale/noise_w, none of
/// which shift pitch — confirmed against Piper's own issue tracker/docs), so
/// this fakes it the classic, dependency-free way: reinterpret_wav_sample_rate
/// makes playback read the WAV at a different rate than it was actually
/// synthesized at, which shifts pitch and tempo together (the "chipmunk"/
/// "slowed-down" effect) — a well-established stand-in for true pitch-only
/// shifting when the alternative is pulling in a full DSP/resampling
/// library. Three tiers, not two: `"small"` (gnomes, halflings, kobolds — an
/// actually Small creature) speeds up + raises pitch; `"large"` (ogres,
/// trolls, hill giants and up, most adult dragons — an actually Large-or-
/// bigger creature) slows down + lowers it a lot; `"gruff"` (half-orcs,
/// goliaths, firbolgs, bugbears — Medium size, same as a human, but
/// naturally read as rougher/deeper-voiced) applies the same slow-down-and-
/// lower direction as `"large"` but much more mildly, since tagging them
/// `"large"` would be mechanically wrong (they aren't Large) AND overshoot
/// the actual effect wanted (a human-sized creature doesn't talk as slowly
/// as an ogre just because it sounds gruffer). Anything else (including
/// plain narration) is a no-op. See BASE_CLAUDE_MD's "Giving NPCs distinct
/// voices" for how the DM picks between these.
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
/// header layout, since Piper's exact WAV writer isn't something this app
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

/// Synthesizes `text` to speech via Piper, returning base64-encoded WAV bytes
/// — keeps this a plain request/response IPC call with no temp-file
/// bookkeeping needed on the JS side. `voice_id` picks from VOICE_CATALOG
/// (defaulting to the bundled narrator voice when absent/for plain
/// narration) — see ensure_voice_available for the bundled/cached/download
/// resolution chain. `pitch` (`"small"`/`"large"`/absent) is applied as a
/// post-processing step on the synthesized WAV — see pitch_factor. See
/// dmSpeech.ts for the caller, which falls back to browser speechSynthesis
/// (narrator voice only, no per-NPC voice or pitch) if this errors.
#[tauri::command]
pub async fn speak_text(app: AppHandle, text: String, voice_id: Option<String>, pitch: Option<String>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let exe = find_resource(&app, "piper.exe")?;
        let resolved_id = voice_id.as_deref().unwrap_or(DEFAULT_VOICE_ID);
        let model = ensure_voice_available(&app, resolved_id)?;
        let speaker = catalog_speaker_id(resolved_id);
        let bytes = synthesize_via_persistent_piper(&exe, &model, speaker, &text)?;
        let bytes = reinterpret_wav_sample_rate(&bytes, pitch_factor(pitch.as_deref()));
        Ok(STANDARD.encode(bytes))
    })
    .await
    .map_err(|e| format!("TTS task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resource_candidates_prefers_packaged_dir_then_dev_fallback() {
        let candidates = resource_candidates(Some(PathBuf::from("/packaged")), "piper.exe");
        assert_eq!(candidates[0], PathBuf::from("/packaged/tts/piper.exe"));
        assert!(candidates[1].ends_with("public/tts/piper.exe"));
    }

    #[test]
    fn resource_candidates_falls_back_when_no_resource_dir() {
        let candidates = resource_candidates(None, "piper.exe");
        assert_eq!(candidates.len(), 1);
        assert!(candidates[0].ends_with("public/tts/piper.exe"));
    }

    #[test]
    fn voice_basename_takes_the_last_path_segment() {
        assert_eq!(voice_basename("en/en_US/lessac/medium/en_US-lessac-medium"), "en_US-lessac-medium");
        assert_eq!(voice_basename("no-slashes-here"), "no-slashes-here");
    }

    #[test]
    fn catalog_repo_path_resolves_known_ids_and_rejects_unknown_ones() {
        assert_eq!(catalog_repo_path("narrator").unwrap(), "en/en_US/lessac/medium/en_US-lessac-medium");
        assert!(catalog_repo_path("dragon-lord-9000").is_err());
    }

    #[test]
    fn voice_catalog_ids_are_unique_and_narrators_basename_matches_the_bundled_file() {
        let mut ids: Vec<&str> = VOICE_CATALOG.iter().map(|(id, _, _)| *id).collect();
        let before = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), before, "duplicate voice id in VOICE_CATALOG");

        let narrator_path = catalog_repo_path(DEFAULT_VOICE_ID).unwrap();
        assert_eq!(format!("{}.onnx", voice_basename(narrator_path)), "en_US-lessac-medium.onnx");
    }

    #[test]
    fn catalog_speaker_id_is_none_for_single_speaker_voices_and_unknown_ids() {
        assert_eq!(catalog_speaker_id("narrator"), None);
        assert_eq!(catalog_speaker_id("male-us-1"), None);
        assert_eq!(catalog_speaker_id("dragon-lord-9000"), None);
    }

    #[test]
    fn catalog_speaker_id_resolves_vctk_entries_to_their_curated_index() {
        assert_eq!(catalog_speaker_id("male-scottish-1"), Some(102));
        assert_eq!(catalog_speaker_id("female-welsh-1"), Some(88));
    }

    #[test]
    fn vctk_catalog_entries_share_the_same_model_path_but_have_distinct_speaker_indices() {
        let vctk_entries: Vec<&(&str, &str, Option<u32>)> =
            VOICE_CATALOG.iter().filter(|(_, path, _)| path.contains("vctk")).collect();
        assert!(vctk_entries.len() >= 10, "expected a meaningful curated VCTK subset, found {}", vctk_entries.len());
        assert!(vctk_entries.iter().all(|(_, _, speaker)| speaker.is_some()), "every VCTK catalog entry must carry a speaker index");

        let mut speakers: Vec<u32> = vctk_entries.iter().filter_map(|(_, _, s)| *s).collect();
        let before = speakers.len();
        speakers.sort();
        speakers.dedup();
        assert_eq!(speakers.len(), before, "two VCTK catalog ids resolved to the same speaker index");
    }

    #[test]
    fn piper_spawn_args_always_includes_length_scale_and_conditionally_speaker() {
        let no_speaker = piper_spawn_args("/voices/a.onnx", None, "/out");
        assert!(no_speaker.contains(&"--length-scale".to_string()));
        assert!(no_speaker.contains(&SPEECH_LENGTH_SCALE.to_string()));
        assert!(!no_speaker.contains(&"-s".to_string()));

        let with_speaker = piper_spawn_args("/voices/vctk.onnx", Some(102), "/out");
        let s_pos = with_speaker.iter().position(|a| a == "-s").expect("-s flag missing");
        assert_eq!(with_speaker[s_pos + 1], "102");
    }

    #[test]
    fn pool_match_index_finds_an_exact_model_and_speaker_match_only() {
        let entries = vec![
            (PathBuf::from("/voices/a.onnx"), None),
            (PathBuf::from("/voices/vctk.onnx"), Some(102)),
        ];
        assert_eq!(pool_match_index(&entries, Path::new("/voices/a.onnx"), None), Some(0));
        assert_eq!(pool_match_index(&entries, Path::new("/voices/vctk.onnx"), Some(102)), Some(1));
        // The exact bug this (model, speaker) pairing exists to prevent: two
        // different VCTK voices sharing one .onnx file are NOT the same warm
        // entry just because the model path matches — Piper's -s flag is
        // fixed for a process's whole lifetime, so a different speaker index
        // on the same file still needs its own process.
        assert_eq!(pool_match_index(&entries, Path::new("/voices/vctk.onnx"), Some(88)), None);
        assert_eq!(pool_match_index(&entries, Path::new("/voices/unknown.onnx"), None), None);
    }

    #[test]
    fn pool_match_index_is_none_for_an_empty_pool() {
        assert_eq!(pool_match_index(&[], Path::new("/voices/a.onnx"), None), None);
    }

    #[test]
    fn lru_index_picks_the_oldest_timestamp() {
        let now = Instant::now();
        let last_used = vec![now, now - Duration::from_secs(10), now - Duration::from_secs(1)];
        assert_eq!(lru_index(&last_used), Some(1));
    }

    #[test]
    fn lru_index_is_none_for_an_empty_pool() {
        assert_eq!(lru_index(&[]), None);
    }

    #[test]
    fn piper_output_dir_for_is_distinct_per_model_and_per_speaker() {
        let model_a = Path::new("/voices/en_US-hfc_male-medium.onnx");
        let vctk = Path::new("/voices/en_GB-vctk-medium.onnx");

        let single_speaker = piper_output_dir_for(model_a, None);
        let vctk_speaker_102 = piper_output_dir_for(vctk, Some(102));
        let vctk_speaker_88 = piper_output_dir_for(vctk, Some(88));

        assert_ne!(single_speaker, vctk_speaker_102, "different models must get different output dirs");
        assert_ne!(vctk_speaker_102, vctk_speaker_88, "same model, different speaker, must still get different output dirs");
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
    /// Piper's own output takes closely enough to exercise
    /// reinterpret_wav_sample_rate's chunk-scanning honestly.
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
        let wav = minimal_wav(22050, 1, 16, &[0u8; 8]);
        let shifted = reinterpret_wav_sample_rate(&wav, 1.25);
        let new_rate = u32::from_le_bytes(shifted[24..28].try_into().unwrap());
        let new_byte_rate = u32::from_le_bytes(shifted[28..32].try_into().unwrap());
        assert_eq!(new_rate, 27563); // 22050 * 1.25, rounded
        assert_eq!(new_byte_rate, new_rate * 1 * 2); // mono, 16-bit = 2 bytes/sample
        // Sample data itself must be untouched — only header fields change.
        assert_eq!(&shifted[44..], &[0u8; 8]);
    }

    #[test]
    fn reinterpret_wav_sample_rate_is_a_no_op_at_factor_one_or_on_malformed_input() {
        let wav = minimal_wav(22050, 1, 16, &[1, 2, 3, 4]);
        assert_eq!(reinterpret_wav_sample_rate(&wav, 1.0), wav);

        let garbage = b"not a wav file at all".to_vec();
        assert_eq!(reinterpret_wav_sample_rate(&garbage, 1.25), garbage);
    }
}
