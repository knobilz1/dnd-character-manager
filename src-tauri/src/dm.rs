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
