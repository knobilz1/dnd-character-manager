//! dm.rs — in-app Dungeon Master bridge.
//!
//! Calls the locally-installed Claude Code CLI (`claude -p`) so the DM runs on
//! the user's Pro/Max **subscription**, not the per-token API. The turn's text
//! (current party state + the player's spoken words) is piped via **stdin** so
//! multi-line content never has to survive shell quoting. On Windows we go
//! through `cmd /C` because npm installs `claude` as a `.cmd` shim that Rust's
//! CreateProcess can't launch directly.
//!
//! Conversation continuity *within one sitting* uses the `session_id` returned
//! by the first reply (passed back as `--resume` on later turns). Continuity
//! *across sessions* — the actual campaign memory — instead comes from running
//! `claude` with its working directory set to the campaign's own folder
//! (see campaign.rs): CLAUDE.md there auto-loads as the DM's persona + world
//! lore, same as it would for any Claude Code project.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::AppHandle;

use crate::campaign;

#[derive(serde::Serialize)]
pub struct DmReply {
    pub text: String,
    pub session_id: Option<String>,
}

#[derive(serde::Deserialize)]
struct ClaudeJson {
    result: Option<String>,
    session_id: Option<String>,
}

/// Builds the CLI args shared by every `claude -p` invocation. Pulled out as
/// pure logic (no subprocess) so the session-continuation / model-override
/// wiring can be tested directly instead of only through a live process.
fn build_claude_args(session_id: Option<&str>, model: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = vec!["-p".into(), "--output-format".into(), "json".into()];
    if let Some(s) = session_id {
        args.push("--resume".into());
        args.push(s.to_string());
    }
    if let Some(m) = model {
        args.push("--model".into());
        args.push(m.to_string());
    }
    args
}

fn run_claude(prompt: String, session_id: Option<String>, cwd: Option<PathBuf>, model: Option<&str>) -> Result<DmReply, String> {
    let args = build_claude_args(session_id.as_deref(), model);

    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.arg("/C").arg("claude");
        c
    };
    #[cfg(not(windows))]
    let mut cmd = Command::new("claude");

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Couldn't start Claude Code (`claude`): {e}. Is it installed and logged in?"))?;

    child
        .stdin
        .take()
        .ok_or("no stdin handle")?
        .write_all(prompt.as_bytes())
        .map_err(|e| format!("failed writing prompt: {e}"))?;

    let out = child
        .wait_with_output()
        .map_err(|e| format!("claude wait failed: {e}"))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!("Claude returned an error: {}", err.trim()));
    }

    let parsed: ClaudeJson = serde_json::from_slice(&out.stdout).map_err(|e| {
        format!(
            "Couldn't parse Claude's reply: {e}. Raw: {}",
            String::from_utf8_lossy(&out.stdout)
        )
    })?;

    Ok(DmReply {
        text: parsed.result.unwrap_or_default(),
        session_id: parsed.session_id,
    })
}

/// Send one turn to the DM. `prompt` is the turn's text (party status + the
/// spoken line); `session_id` continues a same-sitting conversation when
/// present; `campaign_id`, when present, points `claude` at that campaign's
/// folder so its CLAUDE.md (persona + memory) loads automatically.
///
/// Forced onto `sonnet` (the latest Sonnet) — this fires on every spoken line,
/// so it should stay on a fast, cost-effective model rather than whatever the
/// CLI's own default happens to be. Module ingestion (campaign.rs) is the one
/// call forced onto `opus` instead, since that only runs once per import.
#[tauri::command]
pub async fn ask_dm(
    app: AppHandle,
    prompt: String,
    session_id: Option<String>,
    campaign_id: Option<String>,
) -> Result<DmReply, String> {
    let cwd = match campaign_id {
        Some(id) => Some(campaign::campaign_dir(&app, &id)?),
        None => None,
    };
    tokio::task::spawn_blocking(move || run_claude(prompt, session_id, cwd, Some("sonnet")))
        .await
        .map_err(|e| format!("DM task failed: {e}"))?
}

/// One-shot, session-less, cwd-less call to `claude` — for utility tasks like
/// module chapterization (see campaign.rs), not the DM's own turn loop. No
/// `--resume`, no project context; just "here's a prompt, give me text back."
///
/// `model` overrides the CLI's default (e.g. `Some("opus")`) for calls where
/// quality matters more than per-turn latency — a one-time module import, not
/// the live turn loop, which stays on the default/faster model.
pub fn ask_claude_once(prompt: String, model: Option<&str>) -> Result<String, String> {
    run_claude(prompt, None, None, model).map(|r| r.text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_claude_args_base_case_has_no_resume_or_model() {
        let args = build_claude_args(None, None);
        assert_eq!(args, vec!["-p", "--output-format", "json"]);
    }

    #[test]
    fn build_claude_args_includes_resume_when_session_present() {
        let args = build_claude_args(Some("abc-123"), None);
        assert_eq!(args, vec!["-p", "--output-format", "json", "--resume", "abc-123"]);
    }

    #[test]
    fn build_claude_args_includes_model_override() {
        let args = build_claude_args(None, Some("opus"));
        assert_eq!(args, vec!["-p", "--output-format", "json", "--model", "opus"]);
    }
}
