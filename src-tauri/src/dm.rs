//! dm.rs — in-app Dungeon Master bridge.
//!
//! Calls the locally-installed Claude Code CLI (`claude -p`) so the DM runs on
//! the user's Pro/Max **subscription**, not the per-token API. The full prompt
//! (DM persona + current party state + the player's spoken words) is piped via
//! **stdin** so multi-line content never has to survive shell quoting. On Windows
//! we go through `cmd /C` because npm installs `claude` as a `.cmd` shim that
//! Rust's CreateProcess can't launch directly.
//!
//! Conversation continuity across turns uses the `session_id` returned by the
//! first reply (passed back as `--resume` on later turns).

use std::io::Write;
use std::process::{Command, Stdio};

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

fn run_claude(prompt: String, session_id: Option<String>) -> Result<DmReply, String> {
    let mut args: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(),
        "json".into(),
    ];
    if let Some(s) = session_id {
        args.push("--resume".into());
        args.push(s);
    }

    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.arg("/C").arg("claude");
        c
    };
    #[cfg(not(windows))]
    let mut cmd = Command::new("claude");

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

/// Send one turn to the DM. `prompt` is the full text (persona + party + speech);
/// `session_id` continues a conversation when present.
#[tauri::command]
pub async fn ask_dm(prompt: String, session_id: Option<String>) -> Result<DmReply, String> {
    tokio::task::spawn_blocking(move || run_claude(prompt, session_id))
        .await
        .map_err(|e| format!("DM task failed: {e}"))?
}
