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

use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Manager};

const VOICE_MODEL: &str = "en_US-lessac-medium.onnx";

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

/// Builds the piper.exe CLI args for one synthesis call. Pure/tested — Piper
/// auto-discovers "<model>.onnx.json" next to the model file, so it doesn't
/// need to be passed explicitly as long as both live in the same directory
/// (true of our resource layout).
fn build_piper_args(model_path: &Path, output_wav_path: &Path) -> Vec<String> {
    vec![
        "-m".into(),
        model_path.to_string_lossy().into_owned(),
        "-f".into(),
        output_wav_path.to_string_lossy().into_owned(),
    ]
}

fn synthesize_speech_at(exe: &Path, model: &Path, text: &str) -> Result<Vec<u8>, String> {
    let out_path = std::env::temp_dir().join(format!(
        "tavern-tts-{}-{}.wav",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));

    let mut cmd = Command::new(exe);
    cmd.args(build_piper_args(model, &out_path))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Couldn't start Piper ({}): {e}", exe.display()))?;

    child
        .stdin
        .take()
        .ok_or("no stdin handle")?
        .write_all(text.as_bytes())
        .map_err(|e| format!("failed writing text to Piper: {e}"))?;

    let out = child
        .wait_with_output()
        .map_err(|e| format!("Piper wait failed: {e}"))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("Piper returned an error: {}", err.trim()));
    }

    let bytes = std::fs::read(&out_path).map_err(|e| format!("couldn't read Piper's output: {e}"))?;
    let _ = std::fs::remove_file(&out_path);
    Ok(bytes)
}

/// Synthesizes `text` to speech via the bundled Piper binary, returning
/// base64-encoded WAV bytes — keeps this a plain request/response IPC call
/// with no temp-file bookkeeping needed on the JS side. See dmSpeech.ts for
/// the caller, which falls back to browser speechSynthesis if this errors.
#[tauri::command]
pub async fn speak_text(app: AppHandle, text: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let exe = find_resource(&app, "piper.exe")?;
        let model = find_resource(&app, VOICE_MODEL)?;
        find_resource(&app, &format!("{VOICE_MODEL}.json"))?;
        let bytes = synthesize_speech_at(&exe, &model, &text)?;
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
    fn build_piper_args_includes_model_and_output_path() {
        let args = build_piper_args(Path::new("/models/voice.onnx"), Path::new("/tmp/out.wav"));
        assert_eq!(args, vec!["-m", "/models/voice.onnx", "-f", "/tmp/out.wav"]);
    }

}
