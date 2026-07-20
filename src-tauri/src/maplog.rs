//! TEMPORARY debug trace of the entire battle-map generation pipeline —
//! every prompt sent, every model reply/candidate/retry/judge decision, and
//! every tile-catalog lookup with the words it searched, what it scored, and
//! what it actually used. Appends to ONE flat file so a single generation can
//! be read top-to-bottom after the fact. This exists purely so Nabil can eyeball
//! whether each step "makes sense" — delete the module and grep `maplog::` to
//! rip it back out once the Objects: layer is trusted.
//!
//! Deliberately Tauri-free and infallible (a logging failure must never break a
//! generation): fixed temp-dir path, best-effort append, errors swallowed.

use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Fixed, findable location — printed once at generation start so Nabil knows
/// where to look. Same dir on every run, so `banner()` truncates it per-run.
pub fn log_path() -> PathBuf {
    std::env::temp_dir().join("tavern_map_debug.log")
}

/// UTC HH:MM:SS.mmm from the epoch — no chrono dependency, just enough to see
/// ordering and per-step wall time.
fn stamp() -> String {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let ms = now.as_millis() % 1000;
    let secs = now.as_secs();
    let (h, m, s) = ((secs / 3600) % 24, (secs / 60) % 60, secs % 60);
    format!("{h:02}:{m:02}:{s:02}.{ms:03}")
}

/// Append one titled section. `body` can be arbitrarily long (raw prompts,
/// full model replies) — it's written verbatim so nothing is lost.
pub fn log(section: &str, body: &str) {
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log_path()) {
        let _ = writeln!(f, "\n===== [{}] {section} =====\n{body}", stamp());
    }
}

/// Start-of-run marker that also TRUNCATES the file, so each generation reads
/// as its own clean trace instead of piling onto the last one.
pub fn banner(what: &str) {
    let path = log_path();
    let _ = std::fs::write(&path, format!("MAP GENERATION TRACE — {}\n(file: {})\n", stamp(), path.display()));
    log("GENERATION START", what);
}
