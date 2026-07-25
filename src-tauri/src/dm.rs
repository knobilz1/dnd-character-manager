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
//!
//! **The DM turn loop (`ask_dm`) streams.** Confirmed live: `claude -p
//! --output-format stream-json --include-partial-messages --verbose` (verbose
//! is required alongside --print + stream-json, or the CLI errors outright)
//! emits real token-by-token text deltas well before the full reply is done —
//! a live test showed time-to-first-token at ~55% of total reply time. Each
//! delta is emitted to the frontend as a `dm-narration-chunk` event as it
//! arrives, so DMConsolePage.tsx can start speaking the first sentence while
//! Claude is still generating the rest (see `next_emittable_chunk` for how a
//! real trailing ```dm-actions block is kept from ever being spoken). The
//! one-shot utility path (`ask_claude_once`, used by campaign.rs for module
//! chapterization/memory compaction/etc.) deliberately keeps the old
//! non-streaming behavior — those calls have no interactive "speak as it
//! generates" UI attached, and don't have an AppHandle threaded through their
//! pure/testable call chain, so streaming would add real cost for no benefit.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::campaign;

/// App-managed state tracking whichever `claude` turn is currently in flight
/// (see `run_claude_streaming`/`cancel_dm_turn`) — lets a real barge-in
/// actually kill the subprocess instead of just discarding its eventual
/// reply locally while it keeps generating (and burning cost) in the
/// background. `pid` is `None` whenever no turn is running; turns are
/// already serialized on the frontend (DMConsolePage's processingRef/
/// drainQueue), so there's never more than one real turn to track at a time.
#[derive(Default)]
pub struct DmTurnControl {
    pid: Mutex<Option<u32>>,
    cancelled: AtomicBool,
}

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
///
/// `effort` controls how much extended-thinking Claude does before replying
/// (`low`/`medium`/`high`/`xhigh`/`max`, per `claude --help`). Live-measured
/// (real turns, same campaign context): at the CLI's default effort, 9-13
/// SECONDS of every reply's latency was spent in an internal "thinking" block
/// before the DM's narration even started — nearly all of the perceived
/// delay. A real side-by-side comparison (combat action, an ambiguous
/// improvised ruling, and a chapter-conclusion judgment call) found `low`
/// effort held up fine on all three — same correct judgment calls, equally
/// vivid narration, no quality regression found — while cutting average
/// reply time by roughly a quarter. `ask_dm` forces `low` for ordinary turns;
/// DMConsolePage.tsx bumps it to `medium` specifically for the periodic
/// "campaign-arc plan check-in" turns (see dmPrompt.ts's planCheckIn) — the
/// one point where the DM is deliberately asked to reconcile more context
/// than usual, and those turns are rare enough (session start, chapter
/// changes, every 8 turns otherwise) that the extra latency there barely
/// affects the average.
///
/// Every call also unconditionally passes `--tools ""`, disabling Claude
/// Code's built-in tool set (Bash, Edit, Read, Write, Grep, ...). None of
/// this app's `claude -p` calls ever need them — the app owns all file I/O
/// itself (campaign.rs reads/writes every memory/module file directly);
/// Claude is only ever asked to transform text (DM narration + a dm-actions
/// JSON block, or a chapterize/compaction/plan rewrite) and never to run a
/// command or touch a file itself. Live-measured: even a trivial, fully
/// cache-hit, 5-token-output prompt was paying for ~15-20K tokens of tool
/// *definitions* in the system prompt on every single call; disabling them
/// cut that to ~2-6K tokens (real cost savings) and shaved a further ~15-20%
/// off wall-clock time on top of the effort-level change above. Confirmed
/// safe: CLAUDE.md's `@import` mechanism is a separate, unrelated system-
/// prompt-injection path (not tool-driven), verified still working correctly
/// with tools disabled — and confirmed the empty-string arg itself survives
/// the real Windows `cmd /C` spawn path this app uses (a naive shell-level
/// test through PowerShell failed with "argument missing" — that turned out
/// to be a PowerShell quoting quirk, not a real problem; Rust's own
/// Command-building quotes it correctly).
fn build_claude_args(session_id: Option<&str>, model: Option<&str>, effort: Option<&str>, streaming: bool) -> Vec<String> {
    let mut args: Vec<String> = vec!["-p".into(), "--output-format".into()];
    if streaming {
        args.push("stream-json".into());
        args.push("--include-partial-messages".into());
        args.push("--verbose".into());
    } else {
        args.push("json".into());
    }
    if let Some(s) = session_id {
        args.push("--resume".into());
        args.push(s.to_string());
    }
    if let Some(m) = model {
        args.push("--model".into());
        args.push(m.to_string());
    }
    if let Some(e) = effort {
        args.push("--effort".into());
        args.push(e.to_string());
    }
    args.push("--tools".into());
    args.push("".into());
    args
}

/// Length of the ```dm-actions fenced-block marker that must never be
/// spoken — see `next_emittable_chunk`.
const ACTIONS_MARKER: &str = "```dm-actions";

fn floor_char_boundary(s: &str, idx: usize) -> usize {
    let mut idx = idx.min(s.len());
    while idx > 0 && !s.is_char_boundary(idx) {
        idx -= 1;
    }
    idx
}

/// Given the full narration accumulated so far and how much of it has
/// already been emitted, returns the newly-safe-to-emit slice (if any) and
/// whether the dm-actions marker has now been confirmed present (meaning:
/// stop emitting further chunks for the rest of this turn — everything past
/// this point is the JSON block, never narration).
///
/// Always holds back the last `ACTIONS_MARKER.len() - 1` characters (unless
/// the marker is already confirmed) since those could be an in-progress
/// prefix of the marker split across two separate deltas — without this, a
/// stray "```" at a chunk boundary could get spoken before we find out it was
/// actually the start of the JSON block. Also floors to a valid UTF-8 char
/// boundary so a multi-byte character can never get split mid-emit.
fn next_emittable_chunk(accumulated: &str, already_emitted_len: usize) -> (Option<String>, bool) {
    if let Some(marker_pos) = accumulated.find(ACTIONS_MARKER) {
        if marker_pos > already_emitted_len {
            return (Some(accumulated[already_emitted_len..marker_pos].to_string()), true);
        }
        return (None, true);
    }
    let hold_back = ACTIONS_MARKER.len().saturating_sub(1);
    let safe_len = floor_char_boundary(accumulated, accumulated.len().saturating_sub(hold_back));
    if safe_len > already_emitted_len {
        (Some(accumulated[already_emitted_len..safe_len].to_string()), false)
    } else {
        (None, false)
    }
}

/// Extracts the incremental text delta from one already-parsed stream-json
/// line, if it's a `content_block_delta` event. Pure — testable with fixture
/// JSON values instead of a live process.
fn extract_text_delta(line: &serde_json::Value) -> Option<String> {
    if line.get("type")?.as_str()? != "stream_event" {
        return None;
    }
    let event = line.get("event")?;
    if event.get("type")?.as_str()? != "content_block_delta" {
        return None;
    }
    let delta = event.get("delta")?;
    if delta.get("type")?.as_str()? != "text_delta" {
        return None;
    }
    delta.get("text")?.as_str().map(|s| s.to_string())
}

/// Extracts `(result, session_id)` from a stream-json line, if it's the
/// terminal `"type":"result"` line — the last line of a successful stream,
/// carrying the same two fields the old single-blob `json` format had.
fn extract_final_result(line: &serde_json::Value) -> Option<(String, Option<String>)> {
    if line.get("type")?.as_str()? != "result" {
        return None;
    }
    let result = line.get("result")?.as_str()?.to_string();
    let session_id = line.get("session_id").and_then(|v| v.as_str()).map(|s| s.to_string());
    Some((result, session_id))
}

/// A packaged, GUI-launched Tauri app's child processes inherit whatever
/// environment block the desktop shell (explorer.exe) had cached at *its own*
/// startup — which can predate a PATH entry added later (e.g. by `npm
/// install -g`), even though a freshly-opened terminal window shows the
/// updated PATH just fine (confirmed live: this is what caused the original
/// "failed writing prompt: pipe has been ended" bug, and separately caused
/// `connect_claude`'s console window to flash and close instantly — `claude`
/// not found, so `cmd /C` finishes immediately). Rather than trust the
/// inherited PATH, explicitly append the default npm-global-install
/// directory (`%APPDATA%\npm`, where `claude`/`claude.cmd` actually live) if
/// it exists and isn't already present, so lookups work regardless of
/// whatever stale PATH the app process itself was handed.
#[cfg(windows)]
fn augmented_path() -> String {
    let mut current = std::env::var("PATH").unwrap_or_default();
    let mut candidates = vec![];
    if let Ok(appdata) = std::env::var("APPDATA") {
        // Where `npm install -g` puts shims like claude.cmd.
        candidates.push(format!("{appdata}\\npm"));
    }
    // Where the Node.js Windows installer puts node.exe/npm.cmd themselves —
    // needed so install_claude_cli can find `npm` in the first place, same
    // stale-PATH problem as finding `claude`.
    candidates.push("C:\\Program Files\\nodejs".to_string());
    for dir in candidates {
        if std::path::Path::new(&dir).is_dir() && !current.to_lowercase().contains(&dir.to_lowercase()) {
            current = format!("{current};{dir}");
        }
    }
    current
}

/// Same idea as `resolve_claude_exe`, for `npm` itself — needed by
/// `install_claude_cli` to actually run `npm install -g` without depending on
/// PATH search either.
#[cfg(windows)]
fn resolve_npm_exe() -> Option<std::path::PathBuf> {
    for dir in augmented_path().split(';') {
        if dir.is_empty() {
            continue;
        }
        for name in ["npm.cmd", "npm.exe"] {
            let candidate = std::path::Path::new(dir).join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Locates `claude`'s actual executable/shim ourselves rather than trusting
/// `cmd`'s own PATH search to find a bare `"claude"` — patching PATH via
/// `augmented_path` alone was confirmed (live, "claude is not recognized as
/// an internal or external command") to still not be enough, so this removes
/// that search from the equation entirely by resolving and then invoking an
/// ABSOLUTE path. Scans every directory in the augmented PATH for
/// `claude.cmd` then `claude.exe`. Returns `None` only when truly not found
/// anywhere — i.e. Claude Code CLI genuinely isn't installed for this user,
/// as opposed to merely being unreachable from this process's PATH.
#[cfg(windows)]
fn resolve_claude_exe() -> Option<std::path::PathBuf> {
    // Search PATH dirs, but also the native-installer location
    // (`%USERPROFILE%\.local\bin\claude.exe`, where the standalone Claude Code
    // installer — as opposed to `npm install -g` — puts it) explicitly, since
    // a GUI-launched app can inherit a PATH that predates that entry too.
    // Prefer `.exe` over the `.cmd` npm shim: a real executable can be
    // launched directly (see claude_command), sidestepping cmd.exe's quoting
    // rules entirely — those rules were the actual cause of the
    // '"C:\...\claude.exe" is not recognized' failure.
    let mut dirs: Vec<String> = augmented_path().split(';').map(str::to_string).collect();
    if let Ok(profile) = std::env::var("USERPROFILE") {
        dirs.push(format!("{profile}\\.local\\bin"));
    }
    for dir in &dirs {
        if dir.is_empty() {
            continue;
        }
        for name in ["claude.exe", "claude.cmd"] {
            let candidate = std::path::Path::new(dir).join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Builds a `Command` that runs the resolved `claude` with the given args,
/// launching it the ONLY way that's actually reliable on Windows:
/// - a real `claude.exe` → spawned DIRECTLY (`Command::new(exe)`), no `cmd`
///   wrapper. This is the fix for the '"C:\...\claude.exe" is not recognized'
///   bug: wrapping an absolute, space-containing, quoted path plus `||` shell
///   operators in `cmd /C` ran headlong into cmd.exe's byzantine quote-
///   stripping rules (Rust escapes inner quotes as `\"`, which cmd doesn't
///   understand), so cmd tried to execute the literal quoted string as a
///   program name. A direct spawn has no shell and no quoting to get wrong.
/// - a `.cmd`/`.bat` npm shim → still needs `cmd /C` (CreateProcess can't
///   launch a batch file directly), but with the path and args as SEPARATE
///   `.arg()` calls so Rust does the quoting and there are no shell
///   metacharacters in play.
///
/// `PATH` is augmented on the child so the CLI's own internal lookups (e.g.
/// the node runtime a `.cmd` shim invokes) resolve regardless of the stale
/// PATH the GUI app inherited.
#[cfg(windows)]
/// Same PATH scan as `resolve_claude_exe`, for any engine's binary stem.
///
/// Kept separate from that function rather than replacing it: the Claude path
/// carries hard-won Windows behaviour (prefer `.exe` over the `.cmd` npm shim,
/// plus the native-installer's `%USERPROFILE%\.local\bin`) that is worth not
/// disturbing. Codex and Gemini install via npm only, so a `.cmd` shim is the
/// normal case for them and there is no second install location to check.
#[cfg(windows)]
fn resolve_engine_exe(engine: crate::cli_provider::CliEngine) -> Option<std::path::PathBuf> {
    use crate::cli_provider::CliEngine;
    if engine == CliEngine::Claude {
        return resolve_claude_exe();
    }
    let mut dirs: Vec<String> = augmented_path().split(';').map(str::to_string).collect();
    // Antigravity's installer drops agy.exe in %LOCALAPPDATA%\agy\bin and adds
    // it to the USER PATH registry — which a already-running GUI process does
    // not see, and its own installer warns about ("not present in your active
    // Environment PATH"). Same class of problem as Claude's native-installer
    // location, handled the same way: look there explicitly.
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        dirs.push(format!("{local}\\agy\\bin"));
    }
    for dir in dirs.iter().filter(|d| !d.is_empty()) {
        for stem in engine.binary_stems() {
            for ext in ["exe", "cmd", "bat"] {
                let candidate = std::path::Path::new(dir).join(format!("{stem}.{ext}"));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

/// `claude_command` generalised. A `.cmd`/`.bat` shim still needs `cmd /C` with
/// the path and args as separate `.arg()` calls; a real `.exe` is launched
/// directly so there is no shell quoting to get wrong.
#[cfg(windows)]
fn engine_command(engine: crate::cli_provider::CliEngine, args: &[&str]) -> Result<Command, String> {
    let path = resolve_engine_exe(engine).ok_or_else(|| engine_not_installed_error(engine))?;
    let is_batch = path
        .extension()
        .map(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
        .unwrap_or(false);
    let mut cmd = if is_batch {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(&path).args(args);
        c
    } else {
        let mut c = Command::new(&path);
        c.args(args);
        c
    };
    cmd.env("PATH", augmented_path());
    Ok(cmd)
}

#[cfg(not(windows))]
fn engine_command(engine: crate::cli_provider::CliEngine, args: &[&str]) -> Result<Command, String> {
    let mut c = Command::new(engine.binary_stems()[0]);
    c.args(args);
    Ok(c)
}

/// Carries the same marker the frontend already keys on, so an engine that
/// isn't installed lands in the "offer to install it" branch rather than the
/// "you're not logged in" one — those need completely different messaging.
fn engine_not_installed_error(engine: crate::cli_provider::CliEngine) -> String {
    format!(
        "{CLAUDE_NOT_INSTALLED_MARKER}: {} isn't installed yet. Tavern Sheet can install it for you.",
        engine.label()
    )
}

fn claude_command(args: &[&str]) -> Result<Command, String> {
    let path = resolve_claude_exe().ok_or_else(claude_not_installed_error)?;
    let is_batch = path
        .extension()
        .map(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
        .unwrap_or(false);
    let mut cmd = if is_batch {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(&path).args(args);
        c
    } else {
        let mut c = Command::new(&path);
        c.args(args);
        c
    };
    cmd.env("PATH", augmented_path());
    Ok(cmd)
}

/// Shared prefix the frontend checks for (see DMConsolePage.tsx's
/// ensureClaudeConnected/handleConnectClaude) to tell "Claude Code CLI isn't
/// installed at all" apart from "installed but not logged in" — those need
/// very different messaging (an install command + link vs. a login prompt).
const CLAUDE_NOT_INSTALLED_MARKER: &str = "CLAUDE_NOT_INSTALLED";

fn claude_not_installed_error() -> String {
    format!(
        "{CLAUDE_NOT_INSTALLED_MARKER}: Claude Code CLI isn't installed (or couldn't be found) on this computer."
    )
}

/// Same idea as CLAUDE_NOT_INSTALLED_MARKER, for the one prerequisite
/// `install_claude_cli` genuinely can't paper over: no Node.js/npm at all.
/// This is the only remaining case where the user has to leave the app to
/// fix something themselves — everything else about installing the CLI is
/// now done for them.
const NODE_NOT_INSTALLED_MARKER: &str = "NODE_NOT_INSTALLED";

fn node_not_installed_error() -> String {
    format!(
        "{NODE_NOT_INSTALLED_MARKER}: Node.js isn't installed on this computer, which `npm` (and so Claude Code) needs. Install it from nodejs.org, then try again."
    )
}

/// Installs the Claude Code CLI for the user with one click — `npm install -g
/// @anthropic-ai/claude-code`, run for them rather than telling them to open
/// a terminal and type it themselves (that used to be the entire "fix", see
/// claude_not_installed_error's history — Nabil rightly pushed back that a
/// packaged Windows app telling someone to go use a terminal isn't a real
/// fix). Hidden console (CREATE_NO_WINDOW) since this app owns showing
/// progress/errors in its own UI, not a flashing console window — unlike
/// connect_claude's login flow, there's no interactive browser step here to
/// show. Only remaining hard requirement is Node.js/npm itself, which this
/// app can't reasonably vendor (a full Node runtime is a much bigger bundling
/// commitment than one npm package) — that one case still asks the user to
/// install something themselves, everything else does not.
#[tauri::command]
pub async fn install_claude_cli() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let npm_path = resolve_npm_exe().ok_or_else(node_not_installed_error)?;
            let out = Command::new("cmd")
                .arg("/C")
                .arg(&npm_path)
                .arg("install")
                .arg("-g")
                .arg("@anthropic-ai/claude-code")
                .env("PATH", augmented_path())
                .creation_flags(0x08000000)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .map_err(|e| format!("Couldn't run `npm install`: {e}"))?;
            write_claude_debug_log(
                "install_claude_cli",
                &augmented_path(),
                Some(&out),
                "npm install -g @anthropic-ai/claude-code",
            );
            if !out.status.success() {
                return Err(format!(
                    "`npm install -g @anthropic-ai/claude-code` failed: {}",
                    String::from_utf8_lossy(&out.stderr)
                ));
            }
            if resolve_claude_exe().is_none() {
                return Err("Install command succeeded but Claude Code still isn't showing up — try restarting Tavern Sheet.".to_string());
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            Err("Automatic install is only wired up for Windows right now — run `npm install -g @anthropic-ai/claude-code` yourself.".to_string())
        }
    })
    .await
    .map_err(|e| format!("Install task failed: {e}"))?
}

/// Spawns `claude` with the given args + prompt piped via stdin — the
/// process-launching boilerplate shared by both the blocking (`run_claude`)
/// and streaming (`run_claude_streaming`) paths, which otherwise differ
/// entirely in how they consume the output.
fn spawn_claude(args: &[String], prompt: &str, cwd: Option<PathBuf>) -> Result<std::process::Child, String> {
    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let mut c = claude_command(&arg_refs)?;
        // Tauri apps have no console of their own, so a console-subsystem
        // child would otherwise flash/hold open a real console window for
        // every DM turn. CREATE_NO_WINDOW suppresses it.
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("claude");
        c.args(args);
        c
    };

    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        #[cfg(windows)]
        write_claude_debug_log("spawn_claude: spawn() failed", &augmented_path(), None, &e.to_string());
        format!("Couldn't start Claude Code (`claude`): {e}. Is it installed and logged in?")
    })?;

    child
        .stdin
        .take()
        .ok_or("no stdin handle")?
        .write_all(prompt.as_bytes())
        .map_err(|e| {
            // This exact failure (child died before/while we wrote its
            // prompt) is what the very first bug report in this file's
            // history looked like ("The pipe has been ended") — log it for
            // real this time instead of leaving it a one-line mystery.
            #[cfg(windows)]
            write_claude_debug_log("spawn_claude: stdin write failed", &augmented_path(), None, &e.to_string());
            format!("failed writing prompt: {e}")
        })?;

    Ok(child)
}

/// One-shot MULTIMODAL Claude call over the subscription CLI: pipes a prebuilt
/// stream-json USER message (text + base64 image content blocks) via stdin and
/// returns the model's final text `result`. The ordinary text path
/// (`ask_claude_once`) can't carry images, and the CLI only accepts image
/// blocks through `--input-format stream-json` (which forces
/// `--output-format stream-json`, so the answer arrives as the terminal
/// `result` line, same as run_claude_streaming). Stateless, tools disabled.
/// Only caller: the battle-map tile resolver — a gen-time-only, occasional
/// call, never a live DM turn.
pub(crate) fn run_claude_vision(user_message_json: &str, model: Option<&str>) -> Result<String, String> {
    let mut args: Vec<String> = vec![
        "-p".into(),
        "--input-format".into(),
        "stream-json".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
        "--tools".into(),
        "".into(),
    ];
    if let Some(m) = model {
        args.push("--model".into());
        args.push(m.to_string());
    }
    // stream-json input is read line-by-line; the message must be one line.
    let child = spawn_claude(&args, &format!("{user_message_json}\n"), None)?;
    let out = child.wait_with_output().map_err(|e| format!("claude vision wait failed: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    // The terminal result line carries both the answer AND (on an API error like
    // "Prompt is too long") the error text + is_error flag — a non-zero exit
    // leaves stderr empty, so the real reason is here on stdout, not stderr.
    let result_line = stdout
        .lines()
        .rev()
        .find_map(|l| serde_json::from_str::<serde_json::Value>(l).ok().filter(|v| v.get("type").and_then(|t| t.as_str()) == Some("result")));
    if let Some(v) = result_line {
        let text = v.get("result").and_then(|r| r.as_str()).unwrap_or("").to_string();
        if v.get("is_error").and_then(|e| e.as_bool()).unwrap_or(false) {
            return Err(format!("Claude vision API error: {text}"));
        }
        if out.status.success() {
            return Ok(text);
        }
    }
    Err(format!(
        "Claude vision call failed (exit {:?}). stderr: {} | stdout tail: {}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr).trim(),
        stdout.lines().rev().take(2).collect::<Vec<_>>().join(" ⏎ ")
    ))
}

fn run_claude(prompt: String, session_id: Option<String>, cwd: Option<PathBuf>, model: Option<&str>, effort: Option<&str>) -> Result<DmReply, String> {
    let args = build_claude_args(session_id.as_deref(), model, effort, false);
    let child = spawn_claude(&args, &prompt, cwd)?;

    let out = child
        .wait_with_output()
        .map_err(|e| format!("claude wait failed: {e}"))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        #[cfg(windows)]
        write_claude_debug_log("run_claude: non-success exit", &augmented_path(), Some(&out), "");
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

/// Streaming counterpart to `run_claude`, used only by `ask_dm` (the DM's own
/// per-turn loop, which has an interactive UI worth speeding up). Emits a
/// `dm-narration-chunk` event per safe-to-speak text delta as it arrives
/// (see `next_emittable_chunk`), and still returns the exact same `DmReply`
/// shape once the stream completes, parsed from the terminal "result" line
/// instead of a single JSON blob.
fn run_claude_streaming(
    app: &AppHandle,
    prompt: String,
    session_id: Option<String>,
    cwd: Option<PathBuf>,
    model: Option<&str>,
    effort: Option<&str>,
) -> Result<DmReply, String> {
    let args = build_claude_args(session_id.as_deref(), model, effort, true);
    let mut child = spawn_claude(&args, &prompt, cwd)?;

    let stdout = child.stdout.take().ok_or("no stdout handle")?;
    let stderr = child.stderr.take().ok_or("no stderr handle")?;

    // Register this turn's pid so a real barge-in (cancel_dm_turn) can
    // actually kill it — see DmTurnControl's doc comment.
    let turn_control = app.state::<DmTurnControl>();
    turn_control.cancelled.store(false, Ordering::SeqCst);
    *turn_control.pid.lock().unwrap() = Some(child.id());

    // Drain stderr concurrently in its own thread — if we only read stdout,
    // a chatty stderr could fill its OS pipe buffer and block the child,
    // stalling our stdout read loop forever.
    let stderr_handle = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut buf);
        buf
    });

    let mut accumulated = String::new();
    let mut emitted_len = 0usize;
    let mut marker_found = false;
    let mut final_result: Option<(String, Option<String>)> = None;

    for line in BufReader::new(stdout).lines() {
        let line = match line {
            Ok(l) if !l.trim().is_empty() => l,
            Ok(_) => continue,
            Err(_) => break,
        };
        let value: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue, // tolerate a stray non-JSON line rather than aborting the whole turn
        };

        if let Some(result) = extract_final_result(&value) {
            final_result = Some(result);
            break;
        }

        if marker_found {
            continue; // already past the dm-actions marker — nothing further should be spoken
        }

        if let Some(delta) = extract_text_delta(&value) {
            accumulated.push_str(&delta);
            let (chunk, found) = next_emittable_chunk(&accumulated, emitted_len);
            if let Some(chunk) = chunk {
                if !chunk.is_empty() {
                    let _ = app.emit("dm-narration-chunk", &chunk);
                }
                emitted_len += chunk.len();
            }
            marker_found = found;
        }
    }

    // No dm-actions block ever showed up (plain narration reply) — the last
    // held-back tail is now safe to flush as one final chunk.
    if !marker_found {
        let remaining = &accumulated[emitted_len..];
        if !remaining.is_empty() {
            let _ = app.emit("dm-narration-chunk", remaining);
        }
    }

    let wait_result = child.wait();
    *turn_control.pid.lock().unwrap() = None; // always clear, regardless of outcome below
    let status = wait_result.map_err(|e| format!("claude wait failed: {e}"))?;
    let stderr_text = stderr_handle.join().unwrap_or_default();

    if !status.success() {
        if turn_control.cancelled.swap(false, Ordering::SeqCst) {
            // Killed intentionally via cancel_dm_turn (barge-in), not a real
            // failure. Return a harmless empty reply rather than an error —
            // the frontend's existing suppressNarrationRef check (set the
            // instant barge-in fires) already treats whatever comes back as
            // void, so this just needs to resolve cleanly instead of
            // rejecting with a scary "Claude returned an error" message for
            // something the player intentionally caused.
            return Ok(DmReply { text: String::new(), session_id: None });
        }
        #[cfg(windows)]
        write_claude_debug_log(
            "run_claude_streaming: non-success exit",
            &augmented_path(),
            None,
            &format!("exit status: {:?}\nstderr: {}", status.code(), stderr_text),
        );
        return Err(format!("Claude returned an error: {}", stderr_text.trim()));
    }

    let (text, returned_session_id) = final_result.ok_or("Claude's stream ended without a final result line")?;
    Ok(DmReply { text, session_id: returned_session_id })
}

/// Real barge-in cancellation — kills whichever `claude` turn is currently in
/// flight (see DmTurnControl), instead of letting it keep generating (and
/// burning cost/latency) in the background while the frontend just discards
/// the eventual result locally. No-op if nothing is running (idle turn, or
/// it already finished naturally before this reached the backend).
#[tauri::command]
pub fn cancel_dm_turn(app: AppHandle) -> Result<(), String> {
    let state = app.state::<DmTurnControl>();
    let pid = state.pid.lock().unwrap().take();
    if let Some(pid) = pid {
        state.cancelled.store(true, Ordering::SeqCst);
        kill_process_tree(pid)?;
    }
    Ok(())
}

/// On Windows, the tracked pid is `cmd.exe` (see spawn_claude's doc comment
/// on why `claude` is launched via `cmd /C`) — killing just that one process
/// would leave the actual `claude`/node.exe descendant running to completion
/// anyway, defeating the entire point of cancellation. `taskkill /T` kills
/// the whole process tree rooted at that pid, not just cmd.exe itself.
#[cfg(windows)]
fn kill_process_tree(pid: u32) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let mut cmd = Command::new("taskkill");
    cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW -- no reason to flash a console for this
    cmd.output().map_err(|e| format!("Couldn't kill the Claude process tree: {e}"))?;
    Ok(())
}

/// No intermediate shell wrapper on non-Windows (see spawn_claude) — the
/// tracked pid IS the claude process itself, so killing just this one
/// process (no tree) is already correct.
#[cfg(not(windows))]
fn kill_process_tree(pid: u32) -> Result<(), String> {
    Command::new("kill").args(["-9", &pid.to_string()]).output().map_err(|e| format!("Couldn't kill the Claude process: {e}"))?;
    Ok(())
}

/// Send one turn to the DM. `prompt` is the turn's text (party status + the
/// spoken line); `session_id` continues a same-sitting conversation when
/// present; `campaign_id`, when present, points `claude` at that campaign's
/// folder so its CLAUDE.md (persona + memory) loads automatically. `effort`
/// is DMConsolePage.tsx's call — `"low"` for ordinary turns, `"medium"` for
/// the periodic campaign-plan check-in turns (see build_claude_args's doc
/// comment for the live measurements behind this).
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
    effort: Option<String>,
) -> Result<DmReply, String> {
    let cwd = match campaign_id {
        Some(id) => Some(campaign::campaign_dir(&app, &id)?),
        None => None,
    };
    let app_for_emit = app.clone();
    tokio::task::spawn_blocking(move || {
        run_claude_streaming(&app_for_emit, prompt, session_id, cwd, Some("sonnet"), effort.as_deref())
    })
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
///
/// `effort` defaults to the CLI's own default when `None` — every existing
/// caller passes `None` here and is unaffected. See `ask_ingest_once_low_effort`
/// for why some ingestion work (battle-map generation) opts into `Some("low")`
/// instead: the DM turn loop already forces `low` for exactly this reason
/// (see build_claude_args's doc comment) and this is the same tradeoff.
pub fn ask_claude_once(prompt: String, model: Option<&str>, effort: Option<&str>) -> Result<String, String> {
    run_claude(prompt, None, None, model, effort).map(|r| r.text)
}

/// Like `ask_claude_once`, but runs IN a campaign's own directory — so `claude`
/// auto-loads that campaign's CLAUDE.md and every `@import` it pulls in
/// (memory, registries, session_index, the active chapter), exactly the context
/// a real DM turn gets. Session-less, so it doesn't disturb any live `--resume`
/// chain.
///
/// Exists for the retrieval end-to-end test, which can only answer its question
/// — does the DM actually reach for a `recallSession` action on its own? — from
/// a turn that genuinely has session_index.md loaded. A cwd-less
/// `ask_claude_once` would have no idea the index exists.
///
/// `#[cfg(test)]` because that's the honest scope today: nothing in production
/// needs a cwd-aware one-shot (the real turn loop goes through `ask_dm`, which
/// has its own session/effort handling). Drop the attribute if that changes.
#[cfg(test)]
pub fn ask_claude_once_in(prompt: String, cwd: PathBuf, model: Option<&str>) -> Result<String, String> {
    run_claude(prompt, None, Some(cwd), model, None).map(|r| r.text)
}

/// Runs `claude auth status` — fast, no model call, no cwd/session needed —
/// and reports whether the CLI is actually authenticated right now. Exists so
/// campaign creation and campaign selection can check this UP FRONT and offer
/// to fix it, instead of failing deep inside a real `claude -p` call with an
/// opaque "failed writing prompt: The pipe has been ended" OS-level error
/// (spawn_claude's stdin write fails like that whenever the child process
/// dies before/while we write to it — which is exactly what happens if
/// `claude` can't actually run: not on PATH, or not logged in). Hidden
/// console (CREATE_NO_WINDOW) same as every other background call in this
/// file — this is just a status probe, nothing for the user to see or do.
fn claude_logged_in() -> Result<bool, String> {
    #[cfg(windows)]
    let path_used = augmented_path();
    #[cfg(not(windows))]
    let path_used = std::env::var("PATH").unwrap_or_default();

    #[cfg(windows)]
    let mut cmd = {
        use std::os::windows::process::CommandExt;
        let mut c = claude_command(&["auth", "status"])?;
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("claude");
        c.arg("auth").arg("status");
        c
    };

    let out = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| {
            write_claude_debug_log("claude_logged_in: spawn failed", &path_used, None, &e.to_string());
            format!("Couldn't run `claude auth status`: {e}. Is Claude Code installed and on PATH?")
        })?;

    let parsed: serde_json::Value = match serde_json::from_slice(&out.stdout) {
        Ok(v) => v,
        Err(e) => {
            write_claude_debug_log(
                "claude_logged_in: non-JSON output",
                &path_used,
                Some(&out),
                &e.to_string(),
            );
            return Err(format!(
                "Couldn't parse `claude auth status` output: {e}. Raw: {}",
                String::from_utf8_lossy(&out.stdout)
            ));
        }
    };
    Ok(parsed.get("loggedIn").and_then(|v| v.as_bool()).unwrap_or(false))
}

/// Writes exactly what happened on the most recent `claude` auth probe/login
/// attempt to a fixed, always-overwritten log file (not appended — only the
/// latest attempt matters) so a real failure can actually be read afterward,
/// instead of guessing from a console window that closes before anyone can
/// read it. Lives in the OS temp dir so it's reachable without needing to
/// know the app's own data directory.
fn write_claude_debug_log(context: &str, path_used: &str, out: Option<&std::process::Output>, note: &str) {
    use std::io::Write as _;
    let log_path = std::env::temp_dir().join("tavern_sheet_claude_debug.log");
    let mut body = format!("context: {context}\nPATH used: {path_used}\nnote: {note}\n");
    if let Some(out) = out {
        body.push_str(&format!(
            "exit status: {:?}\nstdout: {}\nstderr: {}\n",
            out.status.code(),
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr),
        ));
    }
    if let Ok(mut f) = std::fs::File::create(&log_path) {
        let _ = f.write_all(body.as_bytes());
    }
}

#[tauri::command]
pub fn check_claude_auth() -> Result<bool, String> {
    claude_logged_in()
}

// ── In-app sign-in, for engines that hand back a code ────────────────────────
//
// Some login flows can't be delegated to a console at all. Antigravity prints an
// OAuth URL, and when the browser callback doesn't land it falls back to "paste
// the authorization code here" — on ITS stdin. Every attempt to satisfy that
// with a spawned console failed in a different way: no window at all, then a
// window that hung with nowhere to draw. The console was never the right answer.
//
// So the app does it: spawn with pipes and no window, read the URL out of the
// child's own output, show it in the UI, take the pasted code in a normal text
// field, and write it back down the pipe. The credential goes from Google to the
// user's clipboard to the CLI's stdin — Tavern Sheet passes it through without
// storing it, and nobody has to find a terminal.

use std::sync::OnceLock;
use std::time::Duration;

struct PendingLogin {
    child: Option<std::process::Child>,
    stdin: Option<std::process::ChildStdin>,
    /// Set when the engine is driven through a pseudo-console instead of pipes.
    /// Writing here is typing at a terminal as far as the child can tell, which
    /// is the only way agy's code prompt can be answered - it ignores piped
    /// stdin completely (measured: prompt printed, then silence).
    pty_writer: Option<std::sync::Arc<Mutex<Box<dyn std::io::Write + Send>>>>,
    pty_child: Option<Box<dyn portable_pty::Child + Send + Sync>>,
    /// Everything the CLI has said, kept AFTER the URL is found. Without this a
    /// rejected sign-in could only be reported as a generic "that didn't work",
    /// discarding the one thing that explains why — the tool's own error text.
    log: std::sync::Arc<Mutex<String>>,
}

fn pending_login() -> &'static Mutex<Option<PendingLogin>> {
    static P: OnceLock<Mutex<Option<PendingLogin>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(None))
}

/// Start a sign-in and return the URL the user must visit, or None if the engine
/// authenticated without needing one.
///
/// Any previous attempt is killed first: a half-finished login holding a pipe
/// open would otherwise make the next one look like it hung, which is exactly
/// the failure this whole path exists to remove.
#[tauri::command]
pub async fn begin_engine_login(engine: String) -> Result<Option<String>, String> {
    let engine = crate::cli_provider::CliEngine::from_setting(&engine);
    tokio::task::spawn_blocking(move || {
        if let Some(old) = pending_login().lock().unwrap().take() {
            end_login(old);
        }
        // Engines whose sign-in prompt reads from a terminal get a real
        // pseudo-console; everything else keeps the simpler pipe path.
        if engine == crate::cli_provider::CliEngine::Gemini {
            return begin_login_via_pty(engine);
        }
        let args: Vec<&str> = match engine {
            crate::cli_provider::CliEngine::Gemini => {
                vec!["--mode", "plan", "--print", "Reply with exactly: READY"]
            }
            crate::cli_provider::CliEngine::Codex => vec!["login"],
            crate::cli_provider::CliEngine::Claude => vec!["auth", "login", "--claudeai"],
        };
        let mut cmd = engine_command(engine, &args)?;
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // no window — the UI is the window now
        }
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Couldn't start {}: {e}", engine.label()))?;

        // Read the child's output until it shows us a URL, watching BOTH streams.
        //
        // Not optional: agy prints "Authentication required. Please visit the
        // URL to log in:" to STDERR and leaves stdout completely empty. Reading
        // only stdout meant the app never saw a URL at all — the sign-in sat on
        // "preparing…" forever with nothing to click, which is exactly what it
        // looked like from the outside. Claude and Codex use stdout, so both are
        // watched and whichever produces a URL first wins.
        let log = std::sync::Arc::new(Mutex::new(String::new()));
        let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
        for stream in [
            child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>),
            child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>),
        ]
        .into_iter()
        .flatten()
        {
            let tx = tx.clone();
            let log = log.clone();
            std::thread::spawn(move || {
                let mut reader = BufReader::new(stream);
                let mut buf = String::new();
                let mut announced = false;
                loop {
                    let mut line = String::new();
                    match reader.read_line(&mut line) {
                        Ok(0) => break,
                        Ok(_) => {
                            buf.push_str(&line);
                            {
                                let mut l = log.lock().unwrap();
                                l.push_str(&line);
                                // Bound it; only the tail ever gets reported.
                                if l.len() > 8000 {
                                    let cut = l.len() - 4000;
                                    *l = l[cut..].to_string();
                                }
                            }
                            // Report the URL once, then KEEP READING — the
                            // interesting output (why a code was refused) all
                            // arrives after this point.
                            if !announced {
                                if let Some(url) = find_login_url(&buf) {
                                    announced = true;
                                    let _ = tx.send(Some(url));
                                }
                            }
                        }
                        Err(_) => break,
                    }
                }
                if !announced {
                    let _ = tx.send(None);
                }
            });
        }
        drop(tx); // so recv ends once every reader is done

        // Either stream may report "nothing" first; keep taking answers until a
        // real URL turns up or the readers are exhausted.
        let deadline = std::time::Instant::now() + Duration::from_secs(45);
        let mut found = None;
        while std::time::Instant::now() < deadline {
            match rx.recv_timeout(Duration::from_secs(5)) {
                Ok(Some(url)) => { found = Some(url); break; }
                Ok(None) => continue,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => break, // all readers gone
            }
        }
        let stdin = child.stdin.take();
        *pending_login().lock().unwrap() =
            Some(PendingLogin { child: Some(child), stdin, pty_writer: None, pty_child: None, log });
        Ok(found)
    })
    .await
    .map_err(|e| format!("Login task failed: {e}"))?
}

/// Sign in inside a Tavern Sheet window, so the user never handles a code.
///
/// The problem this solves: Antigravity's OAuth redirect goes to a HOSTED page
/// (antigravity.google/oauth-callback) rather than to loopback. That page tries
/// to relay the code to the CLI's local listener and, when it can't, falls back
/// to printing the code for the user to copy. Every attempt to make that
/// pleasant failed, because the failure isn't ours to fix from outside.
///
/// But the code IS in the redirect URL at NAVIGATION time — the callback page
/// only strips it afterwards with history.replaceState, which is why the address
/// bar looks code-less by the time anyone reads it. Hosting the flow in our own
/// webview means we see the raw navigation and can lift the code straight out of
/// it, then hand it to the waiting CLI on stdin.
///
/// The window shows Google's real sign-in page — the user still authenticates
/// with Google directly, and this app only ever sees the short-lived
/// authorization code, which it passes through without storing.
#[tauri::command]
pub async fn login_in_app(app: AppHandle, engine: String, url: String) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let parsed = url.parse().map_err(|_| "That sign-in URL didn't parse.".to_string())?;
    let label = "engine-login";
    if let Some(existing) = app.get_webview_window(label) {
        let _ = existing.close();
    }
    *captured_code().lock().unwrap() = None;

    let app_for_nav = app.clone();
    WebviewWindowBuilder::new(&app, label, WebviewUrl::External(parsed))
        .title(format!("Sign in to {}", crate::cli_provider::CliEngine::from_setting(&engine).label()))
        .inner_size(520.0, 700.0)
        .on_navigation(move |u| {
            let url = u.as_str().to_string();

            // (1) The scraper below signals its find by navigating here. Caught
            //     before it loads, so the bogus host is never resolved.
            if let Some(code) = url.strip_prefix(CAPTURE_SENTINEL) {
                *captured_code().lock().unwrap() = Some(percent_decode(code));
                if let Some(w) = app_for_nav.get_webview_window("engine-login") {
                    let _ = w.close();
                }
                return false;
            }

            // (2) Some flows do put the code in the redirect itself.
            if let Some(code) = code_from_callback(&url) {
                *captured_code().lock().unwrap() = Some(code);
                if let Some(w) = app_for_nav.get_webview_window("engine-login") {
                    let _ = w.close();
                }
                return false;
            }

            // (3) Antigravity's callback page does neither: it strips the code
            //     from the URL and PRINTS IT IN THE PAGE for the user to copy.
            //     That is the case that actually happens. Since this is our own
            //     window we can just read it off the page — wait for the render,
            //     then scrape and bounce it back through (1). Retried because
            //     the code appears after the page's own fetch resolves.
            if url.contains("oauth-callback") || url.contains("/callback") {
                let app = app_for_nav.clone();
                std::thread::spawn(move || {
                    for _ in 0..20 {
                        std::thread::sleep(Duration::from_millis(500));
                        let Some(w) = app.get_webview_window("engine-login") else { return };
                        if w.eval(SCRAPE_CODE_JS).is_err() {
                            return;
                        }
                        if captured_code().lock().unwrap().is_some() {
                            return;
                        }
                    }
                });
            }
            true
        })
        .build()
        .map_err(|e| format!("Couldn't open the sign-in window: {e}"))?;
    Ok(())
}

/// A URL the scraper navigates to in order to hand the code back. Never loaded —
/// on_navigation cancels it — so the host doesn't need to exist. This sidesteps
/// needing Tauri IPC inside a third-party page, which would mean granting a
/// remote origin access to the app's command surface. A cancelled navigation is
/// a much smaller thing to hand out.
const CAPTURE_SENTINEL: &str = "https://tavern-sheet.invalid/captured?code=";

/// Finds the authorization code printed in a callback page and bounces it back
/// via CAPTURE_SENTINEL.
///
/// Google's codes start `4/` followed by a long opaque blob, which is specific
/// enough to pick out of page text without knowing anything about the page's
/// markup — and that markup is Google's to change, so not depending on it is the
/// point. Checks input/textarea values too, since a code shown in a copy-box
/// isn't in innerText.
const SCRAPE_CODE_JS: &str = r#"(function () {
  try {
    var whole = /^4\/[A-Za-z0-9_\-\.]{20,}$/;
    var found = null;

    // Find the ELEMENT that holds only the code, and read it whitespace-free.
    //
    // This is the part that matters. The page renders the code in a narrow box
    // where it WRAPS across two lines, and innerText reproduces rendered line
    // breaks — so scanning page text for a run of code characters stops at the
    // wrap and yields a truncated code, which fails authentication while
    // looking exactly like a scrape that found nothing. Matching a whole
    // element's textContent (which ignores CSS wrapping) and stripping
    // whitespace inside it reassembles the real thing.
    //
    // Deepest-first, because outer containers also contain the surrounding
    // prose and would not match on their own.
    var els = document.querySelectorAll('div, span, code, pre, p, td');
    for (var i = els.length - 1; i >= 0; i--) {
      var t = (els[i].textContent || '').replace(/\s+/g, '');
      if (whole.test(t)) { found = t; break; }
    }

    // A copy-box keeps its value off textContent entirely.
    if (!found) {
      var fields = document.querySelectorAll('input, textarea');
      for (var j = 0; j < fields.length; j++) {
        var v = (fields[j].value || '').replace(/\s+/g, '');
        if (whole.test(v)) { found = v; break; }
      }
    }

    // Last resort: a loose scan, deliberately NOT whitespace-stripped across the
    // whole page — gluing the document together would weld the trailing button
    // label onto the end of the code.
    if (!found) {
      var loose = (document.body ? document.body.innerText : '').match(/4\/[A-Za-z0-9_\-\.]{30,}/);
      if (loose) { found = loose[0]; }
    }

    if (found) {
      location.href = 'https://tavern-sheet.invalid/captured?code=' + encodeURIComponent(found);
    }
  } catch (e) { /* nothing to do; the manual paste box is still there */ }
})();"#;

/// Stop a sign-in attempt, whichever way it was started.
fn end_login(mut p: PendingLogin) {
    if let Some(c) = p.child.as_mut() {
        let _ = c.kill();
    }
    if let Some(c) = p.pty_child.as_mut() {
        let _ = c.kill();
    }
}

fn captured_code() -> &'static Mutex<Option<String>> {
    static C: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(None))
}

/// The `code` query parameter from an OAuth callback URL, if this is one.
/// Pure, so the parsing that the whole flow hinges on is testable.
fn code_from_callback(url: &str) -> Option<String> {
    if !url.contains("oauth-callback") && !url.contains("/callback") {
        return None;
    }
    let query = url.split_once('?').map(|(_, q)| q)?;
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == "code" && !v.is_empty()).then(|| percent_decode(v))
    })
}

/// Minimal percent-decoding — an authorization code arrives URL-encoded and a
/// stray %2F would otherwise be handed to the CLI verbatim and rejected.
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(if b[i] == b'+' { b' ' } else { b[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// Whether the in-app sign-in window has captured a code yet — polled by the UI
/// so it can finish the moment Google redirects, with nothing for the user to do.
#[tauri::command]
pub fn take_captured_login_code() -> Option<String> {
    captured_code().lock().unwrap().take()
}

/// Start a sign-in on a pseudo-console, returning the URL to visit.
///
/// The child gets a genuine terminal: it prints its prompt, blocks on a terminal
/// read, and `submit_login_code` answers by WRITING TO THAT TERMINAL. From the
/// CLI's side that is indistinguishable from a person typing, which is the whole
/// point - piped stdin was accepted and then silently ignored.
fn begin_login_via_pty(engine: crate::cli_provider::CliEngine) -> Result<Option<String>, String> {
    use portable_pty::{CommandBuilder, PtySize};

    let exe = resolve_engine_exe(engine).ok_or_else(|| engine_not_installed_error(engine))?;
    let pty = portable_pty::native_pty_system()
        .openpty(PtySize { rows: 50, cols: 200, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("Couldn't open a terminal for sign-in: {e}"))?;

    let mut cmd = CommandBuilder::new(exe);
    for a in ["--mode", "plan", "--print", "Reply with exactly: READY"] {
        cmd.arg(a);
    }
    cmd.env("PATH", augmented_path());
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("FORCE_COLOR", "1");
    let child = pty
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Couldn't start {} for sign-in: {e}", engine.label()))?;
    drop(pty.slave); // so the reader sees EOF once the child exits

    let mut reader = pty
        .master
        .try_clone_reader()
        .map_err(|e| format!("Couldn't read the sign-in terminal: {e}"))?;
    // ONE writer, shared between the reader thread (which must ANSWER terminal
    // queries) and submit_login_code (which types the user's code). take_writer
    // only succeeds once, so a second handle for the responder silently came
    // back None and ESC[6n went unanswered — agy probed the terminal, cleared
    // the screen, and blocked forever waiting for a cursor-position report.
    let writer = std::sync::Arc::new(Mutex::new(
        pty.master
            .take_writer()
            .map_err(|e| format!("Couldn't write to the sign-in terminal: {e}"))?,
    ));
    let responder = writer.clone();

    let log = std::sync::Arc::new(Mutex::new(String::new()));
    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    {
        let log = log.clone();
        std::thread::spawn(move || {
            // Byte-wise, not line-wise: a terminal prompt ends WITHOUT a newline
            // ("...press Enter: "), so waiting for one would hide it forever.
            let mut buf: Vec<u8> = Vec::new();
            let mut chunk = [0u8; 2048];
            let mut announced = false;
            let mut answered_dsr = false;
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        buf.extend_from_slice(&chunk[..n]);
                        let raw = String::from_utf8_lossy(&buf).to_string();

                        // Handed a real terminal, agy talks terminal protocol:
                        // it emits ESC[6n (report cursor position) and BLOCKS
                        // until something answers. Nothing did, so it printed
                        // nothing at all and the URL never arrived. Answer it.
                        // Answer the cursor-position query once, as a real
                        // terminal would: ESC[<row>;<col>R.
                        if !answered_dsr && raw.contains("\u{1b}[6n") {
                            answered_dsr = true;
                            if let Ok(mut w) = responder.lock() {
                                let _ = w.write_all(b"\x1b[1;1R");
                                let _ = w.flush();
                            }
                        }

                        // Strip ANSI so a URL split by colour codes or redrawn
                        // in place is still recognisable as one string.
                        let text = strip_ansi(&raw);
                        {
                            let mut l = log.lock().unwrap();
                            *l = text.clone();
                            if l.len() > 8000 {
                                let cut = l.len() - 4000;
                                *l = l[cut..].to_string();
                            }
                        }
                        if !announced {
                            // A terminal hard-wraps long lines, so undo the
                            // wrapping before looking for the URL.
                            let unwrapped: String =
                                text.chars().filter(|c| *c != '\n' && *c != '\r').collect();
                            if let Some(url) = find_login_url(&unwrapped) {
                                announced = true;
                                let _ = tx.send(Some(url));
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
            if !announced {
                let _ = tx.send(None);
            }
        });
    }

    let found = rx.recv_timeout(Duration::from_secs(45)).unwrap_or(None);
    *pending_login().lock().unwrap() = Some(PendingLogin {
        child: None,
        stdin: None,
        pty_writer: Some(writer),
        pty_child: Some(child),
        log,
    });
    Ok(found)
}

/// Remove ANSI escape sequences from terminal output.
///
/// Needed because a CLI given a real terminal decorates and repositions its
/// output; a URL can arrive wrapped in colour codes, which defeats a plain
/// substring search for "https://".
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match chars.peek() {
            // CSI: ESC [ ... final byte in @-~
            Some('[') => {
                chars.next();
                for c2 in chars.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&c2) {
                        break;
                    }
                }
            }
            // OSC: ESC ] ... BEL or ESC \
            Some(']') => {
                chars.next();
                while let Some(c2) = chars.next() {
                    if c2 == '\u{7}' {
                        break;
                    }
                    if c2 == '\u{1b}' {
                        chars.next();
                        break;
                    }
                }
            }
            _ => {
                chars.next();
            }
        }
    }
    out
}

/// Pull the first http(s) URL out of a CLI's login output.
fn find_login_url(text: &str) -> Option<String> {
    let start = text.find("https://")?;
    let rest = &text[start..];
    let end = rest
        .find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
        .unwrap_or(rest.len());
    let url = rest[..end].trim_end_matches(['.', ',', ')']).to_string();
    (url.len() > "https://".len()).then_some(url)
}

/// Hand the pasted authorization code to the waiting CLI, then report whether
/// the engine is actually signed in — never trusting the exit code, since a
/// cancelled flow also exits cleanly.
#[tauri::command]
pub async fn submit_login_code(engine: String, code: String) -> Result<bool, String> {
    let setting = engine.clone();
    tokio::task::spawn_blocking(move || {
        let mut slot = pending_login().lock().unwrap();
        let Some(p) = slot.as_mut() else {
            return Err("That sign-in is no longer waiting — start it again.".to_string());
        };
        if let Some(shared) = p.pty_writer.as_ref() {
            // Typing at the terminal. A console sends a bare CR on Enter — NOT
            // CRLF. Sending both submits the code and then immediately submits
            // an empty second line, which agy treats as a cancel and reports as
            // "authentication interrupted" (observed exactly that).
            let mut w = shared.lock().map_err(|_| "sign-in terminal is busy")?;
            w.write_all(format!("{}\r", code.trim()).as_bytes())
                .map_err(|e| format!("Couldn't type the code in: {e}"))?;
            w.flush().map_err(|e| format!("Couldn't type the code in: {e}"))?;
            return Ok(());
        }
        let mut stdin = p.stdin.take().ok_or("Nothing is waiting for a code.")?;
        stdin
            .write_all(format!("{}\n", code.trim()).as_bytes())
            .map_err(|e| format!("Couldn't hand the code over: {e}"))?;
        drop(stdin); // EOF, so the CLI stops waiting for more
        Ok(())
    })
    .await
    .map_err(|e| format!("Sign-in task failed: {e}"))??;

    // Deliberately NOT waiting for the process to exit.
    //
    // Once the code is accepted the CLI carries on to run the throwaway prompt
    // the login was dressed up as, and agy's --print-timeout defaults to FIVE
    // MINUTES. Waiting on that left the button stuck on "Signing in…" long after
    // the sign-in itself had succeeded — which is indistinguishable from a hang.
    // Authentication is done the moment credentials are written, so poll for
    // exactly that and stop caring about the rest of the process's life.
    for _ in 0..24 {
        tokio::time::sleep(Duration::from_millis(1500)).await;
        if engine_auth_state(setting.clone()).await?.1 {
            if let Some(done) = pending_login().lock().unwrap().take() {
                end_login(done); // its remaining work is of no interest
            }
            return Ok(true);
        }
    }
    // Failed. Hand back the CLI's OWN words rather than a guess — this is where
    // an ineligible-account or expired-code message finally becomes visible.
    let mut detail = String::new();
    if let Some(stale) = pending_login().lock().unwrap().take() {
        detail = stale.log.lock().unwrap().clone();
        end_login(stale);
    }
    let detail = detail
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.contains("https://accounts.google.com"))
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("
");
    if detail.trim().is_empty() {
        Ok(false)
    } else {
        Err(format!("Sign-in didn't complete. {} said:
{detail}", 
            crate::cli_provider::CliEngine::from_setting(&setting).label()))
    }
}

/// Run one stateless completion on any engine and return its text.
///
/// The execution primitive the whole multi-engine feature stands on: arg
/// building lives in cli_provider.rs (pure, tested), and this is the part that
/// actually spawns. Prompt goes in on stdin — every engine accepts that, and it
/// keeps arbitrarily long campaign prompts off a command line with a length
/// limit.
///
/// `Delivery` decides where the answer comes from. Codex writes only its final
/// message to a file, which beats reconstructing it from an event stream; the
/// others print a parseable envelope to stdout.
pub(crate) fn run_engine_oneshot(
    engine: crate::cli_provider::CliEngine, prompt: &str, model: Option<&str>, effort: Option<&str>,
) -> Result<String, String> {
    use crate::cli_provider::{oneshot_args, Delivery};

    // Unique per call so two concurrent ingestion calls can't read each other's
    // answer — map generation fans several of these out at once.
    let out_path = std::env::temp_dir().join(format!(
        "tavern-sheet-{}-{}.txt",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let inv = oneshot_args(engine, model, effort, &out_path.to_string_lossy());

    // Engines that want the prompt as a command-line VALUE (agy's `--print
    // <text>`) get it appended here; the rest receive it on stdin below.
    let mut args = inv.args.clone();
    if !inv.prompt_on_stdin {
        args.push(prompt.to_string());
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut cmd = engine_command(engine, &arg_refs)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // no flashing console per call
    }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't start {}: {e}", engine.label()))?;
    if inv.prompt_on_stdin {
        child
            .stdin
            .take()
            .ok_or("no stdin pipe")?
            .write_all(prompt.as_bytes())
            .map_err(|e| format!("failed writing prompt to {}: {e}", engine.label()))?;
    } else {
        drop(child.stdin.take()); // closed, so nothing waits on it
    }
    let out = child
        .wait_with_output()
        .map_err(|e| format!("{} wait failed: {e}", engine.label()))?;

    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let answer = match inv.delivery {
        Delivery::LastMessageFile => std::fs::read_to_string(&out_path).ok(),
        Delivery::Stdout => crate::cli_provider::extract_final_text(engine, &stdout),
    };
    let _ = std::fs::remove_file(&out_path);

    match answer.map(|a| a.trim().to_string()).filter(|a| !a.is_empty()) {
        Some(a) => Ok(a),
        None => Err(format!(
            "{} returned nothing usable.\n{}",
            engine.label(),
            // Both streams: a tier refusal or an auth error can land on either,
            // and that text is the only thing that explains the failure.
            format!("{stdout}{}", String::from_utf8_lossy(&out.stderr)).trim().chars().take(600).collect::<String>()
        )),
    }
}

/// Is this engine's CLI signed in? `(installed, signed_in)` so the frontend can
/// tell "install it" from "sign in" without parsing an error string.
///
/// Deliberately never errors on "not installed" — a settings panel showing the
/// state of three engines wants three answers, not one exception.
#[tauri::command]
pub async fn engine_auth_state(engine: String) -> Result<(bool, bool), String> {
    let engine = crate::cli_provider::CliEngine::from_setting(&engine);
    tokio::task::spawn_blocking(move || {
        use crate::cli_provider::CliEngine;
        if engine == CliEngine::Claude {
            // Reuse the existing, proven check rather than a second opinion.
            return (true, claude_logged_in().unwrap_or(false));
        }
        let Some(probe) = engine.auth_probe_args() else {
            // Gemini has no status subcommand. Presence of its credential file
            // is the only offline signal; a wrong guess here is cheap because
            // the first real call reports the truth anyway.
            let installed = engine_command(engine, &["--version"]).is_ok();
            // Verified against the installed CLI's own bundle: these are the two
            // files it writes on a successful Google sign-in. Checked rather
            // than guessed because the first cut of this looked for the right
            // file but the sign-in had never actually produced one.
            let signed_in = dirs_next_home()
                .map(|h| {
                    let g = h.join(".gemini");
                    g.join("oauth_creds.json").is_file() || g.join("google_accounts.json").is_file()
                })
                .unwrap_or(false);
            return (installed, signed_in);
        };
        let mut cmd = match engine_command(engine, probe) {
            Ok(c) => c,
            Err(_) => return (false, false),
        };
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        match cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).output() {
            // `codex login status` EXITS 0 whether or not anyone is signed in,
            // so only the text is load-bearing here.
            Ok(out) => {
                let text = format!(
                    "{}{}",
                    String::from_utf8_lossy(&out.stdout),
                    String::from_utf8_lossy(&out.stderr)
                );
                (true, engine.auth_probe_says_signed_in(&text))
            }
            Err(_) => (false, false),
        }
    })
    .await
    .map_err(|e| format!("Auth check task failed: {e}"))
}

/// Home directory, for the one engine whose sign-in state can only be inferred
/// from a credential file on disk.
fn dirs_next_home() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// Gemini's "Login with Google" auth type — the subscription/free-tier option.
/// Its siblings are `gemini-api-key` and `vertex-ai`, both of which are the
/// pay-per-token routes this feature exists to avoid.

/// Pre-selects "Login with Google" in the user's Gemini settings so the sign-in
/// can actually run unattended.
///
/// Without this, `gemini` opens an interactive menu asking which auth method to
/// use, and a console spawned by a GUI app cannot drive that menu — the observed
/// symptom was a login window that appeared, created `~/.gemini/`, and exited
/// having written no credentials at all. Setting `security.auth.selectedType`
/// skips the menu and takes the browser OAuth flow directly.
///
/// NON-DESTRUCTIVE: only fills the value in when it is ABSENT. A user who has
/// deliberately configured `gemini-api-key` or `vertex-ai` for their own use
/// keeps it — this app has no business rewriting another tool's config — and the
/// sign-in error explains what to do instead. Every other key is preserved by
/// merging into the parsed object rather than writing a fresh file.


/// Whichever auth type the user's Gemini settings currently name, if any.

/// Installs any engine's CLI with one click — the same `npm install -g` the
/// Claude installer does, with the same hidden console and the same Node.js
/// prerequisite (the only thing the app still can't do for the user).
#[tauri::command]
pub async fn install_engine_cli(engine: String) -> Result<(), String> {
    let engine = crate::cli_provider::CliEngine::from_setting(&engine);
    if engine == crate::cli_provider::CliEngine::Claude {
        return install_claude_cli().await;
    }
    if engine == crate::cli_provider::CliEngine::Gemini {
        // Antigravity is not on npm — it ships an installer script that places
        // agy.exe in %LOCALAPPDATA%gyin and registers it on the user PATH.
        return tokio::task::spawn_blocking(|| {
            let dir = std::env::temp_dir().join("tavern-sheet-agy-install");
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let script = dir.join("install.cmd");
            let mut c = Command::new("curl");
            c.args(["-fsSL", "https://antigravity.google/cli/install.cmd", "-o"]).arg(&script);
            #[cfg(windows)]
            { use std::os::windows::process::CommandExt; c.creation_flags(0x08000000); }
            let out = c.output().map_err(|e| format!("Couldn't download the installer: {e}"))?;
            if !out.status.success() || !script.is_file() {
                return Err("Couldn't download the Antigravity installer from antigravity.google.".to_string());
            }
            let mut r = Command::new("cmd");
            r.arg("/C").arg(&script).current_dir(&dir);
            #[cfg(windows)]
            { use std::os::windows::process::CommandExt; r.creation_flags(0x08000000); }
            let out = r.output().map_err(|e| format!("Installer failed to run: {e}"))?;
            if out.status.success() {
                Ok(())
            } else {
                Err(format!("Installing Antigravity failed: {}", String::from_utf8_lossy(&out.stderr).trim()))
            }
        })
        .await
        .map_err(|e| format!("Install task failed: {e}"))?;
    }
    let package = engine.npm_package();
    tokio::task::spawn_blocking(move || {
        let npm = resolve_npm_exe().ok_or_else(node_not_installed_error)?;
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg(&npm).arg("install").arg("-g").arg(package);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let out = cmd
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("Couldn't run npm: {e}"))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(format!(
                "Installing {package} failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ))
        }
    })
    .await
    .map_err(|e| format!("Install task failed: {e}"))?
}

/// Walks the user through signing in to any engine, using the same trick
/// `connect_claude` uses: spawn the vendor's own login flow in a REAL, VISIBLE
/// console window and block until it closes, then re-check auth rather than
/// trusting the exit code (closing the window is also a "successful" exit).
///
/// This is what makes the feature usable without an API key: every one of these
/// is a browser OAuth flow against the user's own subscription. The app never
/// sees or handles a credential — it just opens the vendor's door and waits.
///
/// `codex login` prints a URL and waits. `gemini` authenticates on first
/// interactive launch, so it opens the TUI; the user signs in and quits.
#[tauri::command]
pub async fn connect_engine(engine: String) -> Result<bool, String> {
    let setting = engine.clone();
    let engine = crate::cli_provider::CliEngine::from_setting(&engine);
    if engine == crate::cli_provider::CliEngine::Claude {
        return connect_claude().await;
    }
    tokio::task::spawn_blocking(move || {
        use crate::cli_provider::CliEngine;
        // No CREATE_NO_WINDOW here, deliberately: a GUI-subsystem parent with no
        // console of its own gets a brand-new visible console allocated for a
        // console-subsystem child, which is exactly what a login flow needs.
        let login_args: Vec<&str> = match engine {
            CliEngine::Codex => vec!["login"],
            // Antigravity says it plainly when signed out: "Launch the CLI
            // without arguments to sign in." There is no login subcommand, and
            // no flags — bare launch IS the flow.
            //
            // Stdin is deliberately NOT piped here (unlike Codex/Gemini-CLI):
            // agy prints an OAuth URL, waits ~60s for the browser callback, and
            // offers "paste the authorization code here" as the fallback when
            // the callback doesn't land. Piping stdin would close that escape
            // hatch. agy is a real .exe, so a direct spawn gets a genuinely
            // interactive console the user can type into — the same reason
            // Claude's login works and the old .cmd-shim path did not.
            CliEngine::Gemini => vec!["--mode", "plan", "--print", "Reply with exactly: READY"],
            CliEngine::Claude => vec![],
        };
        let mut cmd = engine_command(engine, &login_args)?;
        // CREATE_NEW_CONSOLE (0x10) — the reason a login spawn differs from
        // every other one in this file.
        //
        // This app is a GUI-subsystem process with no console of its own, and
        // the assumption that Windows therefore hands a console-subsystem child
        // a fresh console AUTOMATICALLY turned out to be wrong: agy launched,
        // had nowhere to draw, and hung indefinitely with nothing on screen —
        // the observed "clicking Sign in does nothing, no window appears".
        // Asking for the console explicitly is what actually puts a window in
        // front of the user, which a login needs by definition: they have to
        // read an OAuth URL and, when the browser callback misses, paste a code
        // back into it.
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x00000010);
        }
        cmd.status()
            .map_err(|e| format!("Couldn't start `{}`: {e}", engine.login_command()))
            .map(|_| ())
    })
    .await
    .map_err(|e| format!("Login task failed: {e}"))??;
    // Closing the window is also a "successful" exit, so the exit code proves
    // nothing — re-check through the same path the settings panel uses, so
    // "connected" means one thing everywhere.
    Ok(engine_auth_state(setting).await?.1)
}

/// Runs `claude auth login --claudeai` in a REAL, VISIBLE console window —
/// deliberately the opposite of every other spawn in this file (which hide
/// their console via CREATE_NO_WINDOW, since they're background calls with no
/// UI of their own). A login flow needs the user to actually see and
/// interact with it (it walks through a browser-based OAuth flow), so this
/// spawn leaves stdio/console handling at Rust's default: this app's own
/// process has no console of its own (it's a Windows GUI-subsystem process),
/// so a console-subsystem child with no inherited console and no suppression
/// flag gets a brand-new visible console window allocated for it
/// automatically — standard Win32 CreateProcess behavior. Blocks until that
/// window's process exits, then re-checks auth status once to confirm before
/// reporting back, rather than trusting the exit code alone (closing the
/// window is also a "successful" exit).
///
/// NOTE: uses `claude_command`, which launches a real `claude.exe` DIRECTLY
/// rather than via `cmd /C "\"path\" ..."`. The old cmd-wrapped form is what
/// produced the '"C:\...\claude.exe" is not recognized' failure — cmd.exe
/// choking on the quoted absolute path + `||` shell operators. Direct launch
/// has no shell and no quoting to get wrong.
#[tauri::command]
pub async fn connect_claude() -> Result<bool, String> {
    tokio::task::spawn_blocking(|| {
        #[cfg(windows)]
        let path_used = augmented_path();
        #[cfg(not(windows))]
        let path_used = std::env::var("PATH").unwrap_or_default();

        #[cfg(windows)]
        let mut cmd = claude_command(&["auth", "login", "--claudeai"])?;
        #[cfg(not(windows))]
        let mut cmd = {
            let mut c = Command::new("claude");
            c.arg("auth").arg("login").arg("--claudeai");
            c
        };
        let status = cmd.status().map_err(|e| {
            write_claude_debug_log("connect_claude: spawn failed", &path_used, None, &e.to_string());
            format!("Couldn't start `claude auth login`: {e}")
        })?;
        write_claude_debug_log(
            "connect_claude: login window closed",
            &path_used,
            None,
            &format!("exit status: {:?}", status.code()),
        );
        claude_logged_in()
    })
    .await
    .map_err(|e| format!("Login task failed: {e}"))?
}

/// Fires a throwaway, session-less call in a campaign's own directory the
/// moment it's selected — not when the player actually starts talking — so
/// the real first spoken turn of a sitting doesn't have to pay for it.
///
/// Live-measured: turn 1 of a fresh sitting took ~11s to the first spoken
/// word vs. ~3-4s steady-state, because that's the first time this
/// campaign's CLAUDE.md + memory/module content gets sent at all, and
/// Anthropic's prompt cache has nothing to reuse yet. Also confirmed live
/// (during the effort-comparison work) that this cache is content-addressed,
/// not session-scoped — a completely unrelated call showed the same ~15K-
/// token *global* Claude Code system prompt as a cache hit. So a silent
/// warmup call, using the same cwd/model/`--tools ""` shape a real first
/// turn would use (see build_claude_args), creates that cache entry ahead of
/// time; by the time the player actually speaks, it's already warm. The
/// reply itself is discarded entirely — never spoken, never shown, never
/// touches a session id — its only purpose is the side effect of warming
/// the cache. `low` effort matches an ordinary turn (not the rarer plan-
/// check-in `medium`); effort doesn't affect what's cached (it's a decoding
/// parameter, not part of the system prompt), but matching it exactly
/// avoids any doubt about the cached prefix lining up.
#[tauri::command]
pub async fn warmup_dm_session(app: AppHandle, campaign_id: String) -> Result<(), String> {
    let cwd = campaign::campaign_dir(&app, &campaign_id)?;
    tokio::task::spawn_blocking(move || {
        run_claude("(warming up — reply with a single word)".to_string(), None, Some(cwd), Some("sonnet"), Some("low"))
    })
    .await
    .map_err(|e| format!("Warmup task failed: {e}"))??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The sentinel round-trip is how a code found in PAGE TEXT gets back to
    /// Rust without granting a third-party origin access to the app's commands.
    /// If this parsing breaks, the scraper silently finds codes and loses them.
    #[test]
    fn a_code_scraped_from_the_page_survives_the_sentinel_round_trip() {
        // What the injected JS produces, encodeURIComponent and all.
        let round_tripped = format!("{CAPTURE_SENTINEL}4%2F0AXEQxIBiueOfKpwJ8C5MAV9Z3lPLV_HVUaXHgZjmpSXvBj9g");
        let code = round_tripped.strip_prefix(CAPTURE_SENTINEL).map(percent_decode);
        assert_eq!(code.as_deref(), Some("4/0AXEQxIBiueOfKpwJ8C5MAV9Z3lPLV_HVUaXHgZjmpSXvBj9g"));

        // The regex the page is scraped with must match a real Google code...
        let re = regex_lite_match("Your code is 4/0AXEQxIBiueOfKpwJ8C5MAV9Z3lPLV_HVUaXHgZjmpSXvBj9g — copy it");
        assert_eq!(re.as_deref(), Some("4/0AXEQxIBiueOfKpwJ8C5MAV9Z3lPLV_HVUaXHgZjmpSXvBj9g"));
        // ...and not fire on ordinary page furniture containing a slash.
        assert_eq!(regex_lite_match("Signed in as a/b. Visit 4/5 pages."), None);

        // The real page WRAPS the code across two lines inside a narrow box, so
        // the element's text arrives with whitespace in the middle. Stripping it
        // must reassemble the original, not a truncated prefix — a short code is
        // rejected by the CLI and is indistinguishable from a failed scrape.
        let wrapped = "4/0AXEQxIA50_aTbtsIjX6bQGr5pdrhldUNUrAXUeBZJ
        Gvpuaw5x9FDuIgDiCgSsRa76Bnuuw";
        let joined: String = wrapped.chars().filter(|c| !c.is_whitespace()).collect();
        assert_eq!(joined, "4/0AXEQxIA50_aTbtsIjX6bQGr5pdrhldUNUrAXUeBZJGvpuaw5x9FDuIgDiCgSsRa76Bnuuw");
        assert_eq!(regex_lite_match(&joined).as_deref(), Some(joined.as_str()));
        // The naive scan the wrap defeats: it stops dead at the line break.
        let truncated = regex_lite_match(wrapped).unwrap();
        assert!(truncated.len() < joined.len(), "this is the bug the element-scan avoids");
    }

    /// Mirror of SCRAPE_CODE_JS's regex, so the pattern is checked in CI rather
    /// than only inside a webview nobody can assert against.
    fn regex_lite_match(hay: &str) -> Option<String> {
        let bytes = hay.as_bytes();
        let start = hay.find("4/")?;
        let tail = &hay[start + 2..];
        let n = tail
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.'))
            .unwrap_or(tail.len());
        let _ = bytes;
        (n >= 20).then(|| format!("4/{}", &tail[..n]))
    }

    /// The in-app sign-in stands entirely on lifting `code` out of the redirect
    /// at navigation time. The callback page strips it immediately afterwards
    /// with history.replaceState, which is why a URL copied from the address bar
    /// has no code in it — and why that stripped form must NOT read as success,
    /// or the flow would silently "finish" with nothing.
    #[test]
    fn the_authorization_code_is_lifted_from_the_redirect_but_only_when_present() {
        assert_eq!(
            code_from_callback("https://antigravity.google/oauth-callback?state=abc&code=4%2F0AXYZ-tok&scope=email"),
            Some("4/0AXYZ-tok".to_string()),
            "must percent-decode: a raw %2F would be rejected by the CLI"
        );
        // Verbatim from a real failed run — post-strip, no code. Must be a miss.
        assert_eq!(
            code_from_callback("https://antigravity.google/oauth-callback?state=1wghyBAgO-bSPU8ljvP-0g&iss=https%3A%2F%2Faccounts.google.com&scope=email+profile&authuser=0&prompt=consent"),
            None
        );
        // Google's own pages must pass through untouched, or sign-in can't start.
        assert_eq!(code_from_callback("https://accounts.google.com/o/oauth2/auth?client_id=x&code_challenge=y"), None);
        assert_eq!(code_from_callback("https://antigravity.google/oauth-callback"), None);
        assert_eq!(code_from_callback("https://antigravity.google/oauth-callback?code="), None);
        // A loopback-style callback works the same way, for other engines.
        assert_eq!(
            code_from_callback("http://localhost:52553/callback?code=xyz123&state=q"),
            Some("xyz123".to_string())
        );
    }


    #[test]
    fn build_claude_args_base_case_has_no_resume_model_or_effort() {
        let args = build_claude_args(None, None, None, false);
        assert_eq!(args, vec!["-p", "--output-format", "json", "--tools", ""]);
    }

    #[test]
    fn build_claude_args_always_disables_built_in_tools() {
        // Every call variant should end up with --tools "" — none of this
        // app's claude -p calls ever need Bash/Edit/Read/etc (see this
        // function's doc comment).
        let args = build_claude_args(Some("abc-123"), Some("opus"), Some("high"), true);
        assert_eq!(&args[args.len() - 2..], &["--tools", ""]);
    }

    #[test]
    fn build_claude_args_includes_resume_when_session_present() {
        let args = build_claude_args(Some("abc-123"), None, None, false);
        assert_eq!(args, vec!["-p", "--output-format", "json", "--resume", "abc-123", "--tools", ""]);
    }

    #[test]
    fn build_claude_args_includes_model_override() {
        let args = build_claude_args(None, Some("opus"), None, false);
        assert_eq!(args, vec!["-p", "--output-format", "json", "--model", "opus", "--tools", ""]);
    }

    #[test]
    fn build_claude_args_includes_effort_override() {
        let args = build_claude_args(None, None, Some("low"), false);
        assert_eq!(args, vec!["-p", "--output-format", "json", "--effort", "low", "--tools", ""]);
    }

    #[test]
    fn build_claude_args_streaming_requires_verbose_and_partial_messages() {
        let args = build_claude_args(None, None, None, true);
        assert_eq!(
            args,
            vec!["-p", "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--tools", ""]
        );
    }

    #[test]
    fn build_claude_args_streaming_still_includes_resume_model_and_effort() {
        let args = build_claude_args(Some("abc-123"), Some("sonnet"), Some("medium"), true);
        assert_eq!(
            args,
            vec![
                "-p",
                "--output-format",
                "stream-json",
                "--include-partial-messages",
                "--verbose",
                "--resume",
                "abc-123",
                "--model",
                "sonnet",
                "--effort",
                "medium",
                "--tools",
                ""
            ]
        );
    }

    #[test]
    fn extract_text_delta_reads_a_real_content_block_delta_line() {
        let value: serde_json::Value = serde_json::from_str(
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Rain"}}}"#,
        )
        .unwrap();
        assert_eq!(extract_text_delta(&value), Some("Rain".to_string()));
    }

    #[test]
    fn extract_text_delta_ignores_unrelated_lines() {
        let value: serde_json::Value = serde_json::from_str(r#"{"type":"system","subtype":"init"}"#).unwrap();
        assert_eq!(extract_text_delta(&value), None);
    }

    #[test]
    fn extract_final_result_reads_the_terminal_line() {
        let value: serde_json::Value = serde_json::from_str(
            r#"{"type":"result","subtype":"success","result":"Rain drips through the forest.","session_id":"abc-123"}"#,
        )
        .unwrap();
        assert_eq!(
            extract_final_result(&value),
            Some(("Rain drips through the forest.".to_string(), Some("abc-123".to_string())))
        );
    }

    #[test]
    fn extract_final_result_ignores_non_result_lines() {
        let value: serde_json::Value = serde_json::from_str(r#"{"type":"stream_event"}"#).unwrap();
        assert_eq!(extract_final_result(&value), None);
    }

    #[test]
    fn next_emittable_chunk_emits_plain_narration_minus_a_safety_holdback() {
        let (chunk, found) = next_emittable_chunk("The goblin leaps out from behind the rocks", 0);
        assert!(!found);
        let chunk = chunk.unwrap();
        assert!(chunk.starts_with("The goblin leaps out"));
        assert!(!chunk.ends_with("rocks"), "should hold back a safety tail in case a marker is starting");
    }

    #[test]
    fn next_emittable_chunk_detects_a_marker_that_arrives_whole() {
        let (chunk, found) = next_emittable_chunk("You take damage.\n\n```dm-actions\n{\"damage\":[]}\n```", 0);
        assert!(found);
        assert_eq!(chunk.unwrap(), "You take damage.\n\n");
    }

    #[test]
    fn next_emittable_chunk_never_emits_a_marker_split_across_two_deltas() {
        // Simulates the marker arriving in two separate stream deltas, the
        // way real Claude output actually chunks text.
        let mut emitted_len = 0usize;
        let mut all_emitted = String::new();

        let (chunk, found) = next_emittable_chunk("Roll for initiative.\n\n``", emitted_len);
        assert!(!found);
        if let Some(c) = chunk { all_emitted.push_str(&c); emitted_len += c.len(); }
        assert!(!all_emitted.contains('`'), "a bare backtick prefix must never be emitted");

        let (chunk, found) = next_emittable_chunk("Roll for initiative.\n\n```dm-actions\n{\"da", emitted_len);
        assert!(found, "the full marker substring is already present, so it should be confirmed immediately");
        if let Some(c) = chunk { all_emitted.push_str(&c); emitted_len += c.len(); }
        assert!(!all_emitted.contains("dm-actions"), "must never emit any part of the marker itself");
        assert_eq!(all_emitted, "Roll for initiative.\n\n");

        // Further deltas (the rest of the JSON block) must never add anything
        // further once the marker's been confirmed — enforced by the caller
        // (run_claude_streaming) skipping extraction entirely once `found`,
        // not by this pure function, so nothing further to assert here.
        let _ = emitted_len;
    }

    #[test]
    fn next_emittable_chunk_never_splits_a_multibyte_character() {
        // "café" — é is multi-byte in UTF-8; the holdback must floor to a
        // valid char boundary rather than panic or corrupt the string.
        let (chunk, _found) = next_emittable_chunk("café", 0);
        if let Some(c) = chunk {
            assert!(String::from_utf8(c.into_bytes()).is_ok());
        }
    }
}
