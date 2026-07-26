//! cli_provider.rs — which vendor CLI runs a turn, and how to invoke it safely.
//!
//! The DM has always run on the Claude Code CLI, spawned as a subprocess, so the
//! user pays a flat subscription instead of per-token API billing. OpenAI and
//! Google ship the same arrangement — `codex` authenticates against a ChatGPT
//! plan, `gemini` against a Google account — so supporting them is a matter of
//! speaking three command lines, NOT of adding API clients. (An OpenAI-compatible
//! API client already exists for self-hosted models; see local_llm.rs. That path
//! is for weights you run yourself, and it carries small-model concessions —
//! truncated imports, clipped history — that would hobble a frontier model.)
//!
//! Everything here is a PURE function from (engine, request) to argv, so the one
//! thing that genuinely must not regress — the tool lockdown below — is unit
//! testable without a network, a subscription, or a signed-in CLI.
//!
//! ## The lockdown (read this before touching any arg builder)
//!
//! The DM runs with its working directory set to the campaign folder, because
//! that is how CLAUDE.md-style recall reaches the model. That folder holds the
//! campaign's memory files — the session log, the entity and location notes, the
//! DM rules. An agentic CLI pointed at it with write access can rewrite the
//! campaign's history, and would have every reason to think that was helpful.
//!
//! Claude has been muzzled from the start with `--tools ""`. The other two are
//! agentic BY DEFAULT and will edit files in their working directory unless told
//! otherwise, so each one gets an explicit read-only mode, and the flag is not
//! optional or caller-supplied — it is welded into every builder in this file:
//!
//! | engine | lockdown           | must never appear                              |
//! |--------|--------------------|------------------------------------------------|
//! | claude | `--tools ""`       | any tool allowlist                             |
//! | codex  | `-s read-only`     | `workspace-write`, `danger-full-access`,       |
//! |        |                    | `--dangerously-bypass-approvals-and-sandbox`   |
//! | gemini | `--approval-mode plan` | `-y` / `--yolo`, `auto_edit`               |
//!
//! Codex additionally gets `--ignore-user-config`: a user's own
//! `~/.codex/config.toml` can set a permissive `sandbox_mode`, and while a CLI
//! flag should win over config, "should" is not a property worth betting a
//! campaign folder on. Reading is still allowed and wanted — the model must see
//! CLAUDE.md — it is writing that is refused.
//!
//! `lockdown_flags` and the tests at the bottom exist to make a future edit that
//! drops one of these fail loudly rather than silently arm an agent inside
//! someone's saved campaign.

/// Which vendor CLI to run. `Local` is deliberately absent — a self-hosted
/// OpenAI-compatible server is not a subprocess and lives in local_llm.rs.
#[derive(Copy, Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CliEngine {
    Claude,
    Codex,
    Gemini,
}

impl CliEngine {
    /// Parsed from the frontend's persisted provider setting. Anything
    /// unrecognised falls back to Claude rather than erroring: an unknown engine
    /// string is a settings-migration bug, and refusing to run the DM at all is
    /// a worse outcome than running it on the default engine.
    pub fn from_setting(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "codex" => Self::Codex,
            "gemini" => Self::Gemini,
            _ => Self::Claude,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Claude => "Claude Code",
            Self::Codex => "Codex",
            Self::Gemini => "Gemini",
        }
    }

    /// Executable stems to look for on PATH, most-preferred first. On Windows a
    /// real `.exe` is preferred over an npm `.cmd` shim because it can be
    /// spawned directly, sidestepping cmd.exe's quoting rules — the bug that
    /// `claude_command` in dm.rs documents at length.
    pub fn binary_stems(self) -> &'static [&'static str] {
        match self {
            Self::Claude => &["claude"],
            Self::Codex => &["codex"],
            // Gemini's own CLI was cut off from every consumer Google account on
            // 2026-06-18 ("Login with Google" no longer works for free, AI Pro
            // OR Ultra). Antigravity CLI (`agy`) is Google's own replacement and
            // runs the same Gemini models -- it is a client swap, not a model
            // swap, which is why this stays user-visible as "Gemini".
            Self::Gemini => &["agy"],
        }
    }

    /// The npm package that installs this CLI, for the one-click installer.
    pub fn npm_package(self) -> &'static str {
        match self {
            Self::Claude => "@anthropic-ai/claude-code",
            Self::Codex => "@openai/codex",
            // NOT an npm package: Antigravity ships its own installer script.
            // See dm.rs's install_engine_cli, which special-cases this.
            Self::Gemini => "",
        }
    }

    /// What the user has to run themselves to sign in. Deliberately surfaced as
    /// a command rather than automated: it is an OAuth flow against the user's
    /// own account in their own browser, and the app has no business driving it.
    pub fn login_command(self) -> &'static str {
        match self {
            // `claude` has an in-app flow already (see dm::connect_claude).
            Self::Claude => "claude",
            Self::Codex => "codex login",
            // `agy models` says it outright: "Launch the CLI without arguments
            // to sign in." There is no login subcommand.
            Self::Gemini => "agy",
        }
    }

    /// Argv that reports sign-in state, or None if the engine has no such
    /// subcommand and must be probed another way.
    pub fn auth_probe_args(self) -> Option<&'static [&'static str]> {
        match self {
            Self::Claude => None, // dm::claude_logged_in already does this
            Self::Codex => Some(&["login", "status"]),
            // A real, tiny call — the ONLY thing that answers this honestly.
            //
            // Two wrong answers preceded it, in both directions. `agy models`
            // exits 0 with the full catalogue while signed OUT, so it reported
            // everyone signed in. Checking for `~/.gemini/oauth_creds.json`
            // then reported a genuinely signed-in user as signed OUT: that path
            // belonged to the retired gemini-cli, and Antigravity keeps its
            // token somewhere else entirely (not in ~/.gemini, not in
            // %LOCALAPPDATA%\agy, not in Windows Credential Manager).
            //
            // No agy subcommand touches auth — `models`, `agents`, `changelog`
            // and `plugins` were all checked — and `--print ""` fails on the
            // empty prompt BEFORE auth is consulted. So the probe has to be a
            // real prompt. It costs ~5s, which is why the caller caches a
            // signed-in answer for the life of the process.
            Self::Gemini => Some(&["--mode", "plan", "--sandbox", "--output-format", "json", "--print", "ok"]),
        }
    }

    /// Whether an auth probe's output says "signed in".
    ///
    /// Codex's `login status` prints `Not logged in` and STILL EXITS 0, so the
    /// exit code carries no information and only the text does. Getting this
    /// backwards would report every user as signed in.
    pub fn auth_probe_says_signed_in(self, stdout: &str) -> bool {
        match self {
            Self::Claude => !stdout.trim().is_empty(),
            Self::Codex => {
                let t = stdout.to_ascii_lowercase();
                !t.contains("not logged in") && (t.contains("logged in") || t.contains("chatgpt") || t.contains("api key"))
            }
            // The probe is a real prompt, so a completed turn is the proof.
            // Signed out, agy writes an "Authentication required" banner and an
            // OAuth URL to stderr and produces no envelope at all — so requiring
            // the envelope's SUCCESS is both necessary and sufficient, and can't
            // be faked by a catalogue listing the way `agy models` was.
            Self::Gemini => stdout.contains("\"status\":\"SUCCESS\""),
        }
    }
}

/// The read-only enforcement for an engine, as flags. Split out so the tests can
/// assert every builder includes it, and so there is exactly ONE place to look
/// when asking "can this thing write to my campaign folder?".
fn lockdown_flags(engine: CliEngine) -> Vec<String> {
    match engine {
        // Empty string = no tools at all. The arg genuinely must be present and
        // empty; see build_claude_args in dm.rs for why that survives the
        // Windows spawn path.
        CliEngine::Claude => vec!["--tools".into(), String::new()],
        CliEngine::Codex => vec![
            "--sandbox".into(),
            "read-only".into(),
            // A user config could otherwise widen the sandbox behind our back.
            "--ignore-user-config".into(),
        ],
        // `--mode plan` is Antigravity's read-only mode; `accept-edits` is the
        // one that writes. `--sandbox` adds terminal restrictions on top.
        //
        // NOTE the old Gemini CLI silently overrode its equivalent flag with
        // "Approval mode overridden to default because the current folder is not
        // trusted" -- a flag being ACCEPTED is not a flag being OBEYED, and no
        // unit test here can tell those apart. This one is only trusted once it
        // passes the same md5 write test Codex passed.
        CliEngine::Gemini => vec!["--mode".into(), "plan".into(), "--sandbox".into()],
    }
}

/// Flags that must never be generated for an engine, at all, by anything. Used
/// by the tests as a tripwire; listed here so the reason is next to the rule.
pub(crate) fn forbidden_flags(engine: CliEngine) -> &'static [&'static str] {
    match engine {
        CliEngine::Claude => &[],
        CliEngine::Codex => &[
            "workspace-write",
            "danger-full-access",
            "--dangerously-bypass-approvals-and-sandbox",
            "--dangerously-bypass-hook-trust",
            "--add-dir",
        ],
        CliEngine::Gemini => &[
            "--dangerously-skip-permissions",
            "accept-edits",
            // Would widen the workspace beyond the cwd we chose.
            "--add-dir",
            "-y",
            "--yolo",
        ],
    }
}

/// How a request's prompt reaches the CLI, and where its answer comes back.
#[derive(Debug, PartialEq)]
pub enum Delivery {
    /// Prompt on stdin; final text parsed from stdout.
    Stdout,
    /// Prompt on stdin; final text read from this file after exit. Codex writes
    /// only the agent's last message there, which beats reconstructing it from
    /// an event stream.
    LastMessageFile,
}

/// One planned invocation: what to pass, and how to collect the answer.
#[derive(Debug, PartialEq)]
pub struct Invocation {
    pub args: Vec<String>,
    pub delivery: Delivery,
    /// False when the engine wants the prompt as a command-line VALUE rather
    /// than on stdin — Antigravity's `--print <text>` works that way. The caller
    /// appends it as the final arg instead of writing to the pipe.
    ///
    /// Stdin is preferred wherever possible: a Windows command line caps out
    /// around 32k characters, and campaign ingestion prompts get large.
    pub prompt_on_stdin: bool,
}

/// A stateless one-shot completion — the ingestion/memory workload. No session,
/// no continuity, tools off. `expect_json` is a hint some engines can enforce.
pub fn oneshot_args(engine: CliEngine, model: Option<&str>, effort: Option<&str>, last_message_file: &str) -> Invocation {
    match engine {
        CliEngine::Claude => {
            let mut args: Vec<String> = vec!["-p".into(), "--output-format".into(), "json".into()];
            push_model(&mut args, "--model", model);
            if let Some(e) = effort {
                args.push("--effort".into());
                args.push(e.to_string());
            }
            args.extend(lockdown_flags(engine));
            Invocation { args, delivery: Delivery::Stdout, prompt_on_stdin: true }
        }
        CliEngine::Codex => {
            let mut args: Vec<String> = vec!["exec".into()];
            args.extend(lockdown_flags(engine));
            // Campaign folders are not git repos, and Codex refuses to run
            // outside one unless told it's fine.
            args.push("--skip-git-repo-check".into());
            // A one-shot has nothing to resume, so don't leave a session file
            // behind for every ingestion call.
            args.push("--ephemeral".into());
            push_model(&mut args, "--model", model);
            // Reasoning is OFF by default — a live run's own banner read
            // "reasoning effort: none" while Codex was being asked to review
            // someone else's campaign lore, which is the most analytically
            // demanding call in the whole pipeline. There is no flag for it;
            // it goes through the config override.
            if let Some(e) = effort {
                args.push("-c".into());
                args.push(format!("model_reasoning_effort=\"{e}\""));
            }
            args.push("--output-last-message".into());
            args.push(last_message_file.to_string());
            Invocation { args, delivery: Delivery::LastMessageFile, prompt_on_stdin: true }
        }
        CliEngine::Gemini => {
            let mut args: Vec<String> = vec![];
            args.extend(lockdown_flags(engine));
            push_model(&mut args, "--model", model);
            // Same reasoning gap as Codex above; agy spells it as a flag.
            if let Some(e) = effort {
                args.push("--effort".into());
                args.push(e.to_string());
            }
            // agy prints the answer as plain text with no envelope, and takes
            // the prompt as this flag's value — appended by the caller.
            args.push("--print".into());
            Invocation { args, delivery: Delivery::Stdout, prompt_on_stdin: false }
        }
    }
}

/// A live DM turn. `session_id` continues an existing conversation.
///
/// Continuity is NOT portable across engines: a Claude session id means
/// something only to `claude --resume`, a Codex one only to `codex exec resume`.
/// The console already clears the id when the provider changes; this function
/// assumes an id it is handed belongs to the engine it is building for.
pub fn turn_args(
    engine: CliEngine, session_id: Option<&str>, model: Option<&str>, effort: Option<&str>,
    streaming: bool, last_message_file: &str,
) -> Invocation {
    match engine {
        CliEngine::Claude => {
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
            push_model(&mut args, "--model", model);
            if let Some(e) = effort {
                args.push("--effort".into());
                args.push(e.to_string());
            }
            args.extend(lockdown_flags(engine));
            Invocation { args, delivery: Delivery::Stdout, prompt_on_stdin: true }
        }
        CliEngine::Codex => {
            // `exec resume <id>` is a subcommand, so the verb changes shape
            // rather than gaining a flag — and the LOCKDOWN BELONGS TO `exec`,
            // not to `resume`. `codex exec resume <id> --sandbox read-only`
            // exits 2 with "unexpected argument '--sandbox' found"; `resume`
            // has no --sandbox flag at all. Measured against the real CLI
            // 2026-07-25, where it killed every second turn outright.
            let mut args: Vec<String> = vec!["exec".into()];
            args.extend(lockdown_flags(engine));
            args.push("--skip-git-repo-check".into());
            if let Some(s) = session_id {
                args.push("resume".into());
                args.push(s.to_string());
            }
            push_model(&mut args, "--model", model);
            if let Some(e) = effort {
                args.push("-c".into());
                args.push(format!("model_reasoning_effort=\"{e}\""));
            }
            // --json carries the session id we need for the NEXT turn; the
            // answer itself comes from the file, which is far less brittle.
            args.push("--json".into());
            args.push("--output-last-message".into());
            args.push(last_message_file.to_string());
            Invocation { args, delivery: Delivery::LastMessageFile, prompt_on_stdin: true }
        }
        CliEngine::Gemini => {
            let mut args: Vec<String> = vec![];
            args.extend(lockdown_flags(engine));
            // Undocumented in `agy --help`, but real: without it an answer
            // comes back as bare prose with no envelope and no conversation id.
            args.push("--output-format".into());
            args.push("json".into());
            // Resuming is `--conversation <id>`, and the id is agy's to mint —
            // it comes back as `conversation_id` in the JSON envelope. There is
            // no `--session-id`; passing one exits 2, "flags provided but not
            // defined". Measured 2026-07-25.
            if let Some(s) = session_id {
                args.push("--conversation".into());
                args.push(s.to_string());
            }
            push_model(&mut args, "--model", model);
            // `--prompt` is an ALIAS FOR `--print` — it takes the prompt as its
            // VALUE and never reads stdin. This used to push an empty string and
            // send the real prompt to stdin, so every Gemini turn died with
            // "Error: empty prompt". The caller appends the prompt as the next
            // argument, which is why prompt_on_stdin is false.
            args.push("--print".into());
            Invocation { args, delivery: Delivery::Stdout, prompt_on_stdin: false }
        }
    }
}

/// A one-shot multimodal call — the battle-map tile picker and the board read.
///
/// The engines disagree fundamentally on how an image arrives: Claude takes
/// base64 content blocks on stdin, Codex takes file paths, Gemini takes neither
/// (images are referenced from the prompt). So callers hand over PATHS and let
/// each engine decide, which means the data URL has to be spilled to a temp file
/// for the two that want one.
pub fn vision_args(engine: CliEngine, model: Option<&str>, effort: Option<&str>, image_paths: &[String], last_message_file: &str) -> Invocation {
    match engine {
        CliEngine::Claude => {
            let mut args: Vec<String> = vec![
                "-p".into(),
                "--input-format".into(),
                "stream-json".into(),
                "--output-format".into(),
                "stream-json".into(),
                "--verbose".into(),
            ];
            args.extend(lockdown_flags(engine));
            push_model(&mut args, "--model", model);
            if let Some(e) = effort { args.extend(["--effort".into(), e.into()]); }
            Invocation { args, delivery: Delivery::Stdout, prompt_on_stdin: true }
        }
        CliEngine::Codex => {
            let mut args: Vec<String> = vec!["exec".into()];
            args.extend(lockdown_flags(engine));
            args.push("--skip-git-repo-check".into());
            args.push("--ephemeral".into());
            push_model(&mut args, "--model", model);
            if let Some(e) = effort { args.extend(["-c".into(), format!("model_reasoning_effort=\"{e}\"")]); }
            for p in image_paths {
                args.push("--image".into());
                args.push(p.clone());
            }
            args.push("--output-last-message".into());
            args.push(last_message_file.to_string());
            Invocation { args, delivery: Delivery::LastMessageFile, prompt_on_stdin: true }
        }
        CliEngine::Gemini => {
            let mut args: Vec<String> = vec![];
            args.extend(lockdown_flags(engine));
            args.push("--output-format".into());
            args.push("json".into());
            push_model(&mut args, "--model", model);
            if let Some(e) = effort { args.extend(["--effort".into(), e.into()]); }
            // Same alias trap as turn_args: --prompt IS --print, and it wants
            // the prompt as its value. (run_engine_vision refuses Gemini today,
            // so this shape is unexercised — but a wrong builder left in place
            // is the next person's afternoon.)
            args.push("--print".into());
            Invocation { args, delivery: Delivery::Stdout, prompt_on_stdin: false }
        }
    }
}

fn push_model(args: &mut Vec<String>, flag: &str, model: Option<&str>) {
    if let Some(m) = model.filter(|m| !m.trim().is_empty()) {
        args.push(flag.into());
        args.push(m.to_string());
    }
}

/// Pulls a session id out of an engine's output, so the NEXT turn can resume it.
///
/// Every key here was read off a real run on 2026-07-25, because guessing them
/// fails silently: a missed id is not an error, it is a brand-new conversation,
/// and at the table that reads as the DM having forgotten the scene rather than
/// as anything being broken. Codex in particular calls it `thread_id` on its
/// `thread.started` event — this function used to look only for `session_id`,
/// so no Codex turn had ever carried continuity.
pub fn extract_session_id(engine: CliEngine, stdout: &str) -> Option<String> {
    let keys: &[&str] = match engine {
        CliEngine::Claude => &["session_id", "sessionId"],
        CliEngine::Codex => &["thread_id", "threadId", "session_id", "sessionId"],
        // agy hands back `conversation_id`, which `--conversation` takes again.
        CliEngine::Gemini => &["conversation_id", "conversationId"],
    };
    let pick = |v: &serde_json::Value| -> Option<String> {
        for k in keys {
            if let Some(s) = v.get(k).and_then(|x| x.as_str()).filter(|s| !s.is_empty()) {
                return Some(s.to_string());
            }
            // Codex nests some fields one level down under `msg`.
            if let Some(s) = v.get("msg").and_then(|m| m.get(k)).and_then(|x| x.as_str()).filter(|s| !s.is_empty()) {
                return Some(s.to_string());
            }
        }
        None
    };
    // Claude and Codex stream JSONL, so the id is on one of many lines; agy
    // emits a single object that may be pretty-printed across all of them.
    stdout
        .lines()
        .rev()
        .find_map(|l| pick(&serde_json::from_str::<serde_json::Value>(l).ok()?))
        .or_else(|| pick(&serde_json::from_str::<serde_json::Value>(stdout.trim()).ok()?))
}

/// Final answer text from an engine whose answer comes back on stdout.
///
/// Tolerant by design: Gemini's exact JSON envelope is unverified, so this tries
/// the documented-ish shapes and falls back to the raw text rather than failing a
/// turn over a key name. Claude's shape IS verified — its terminal `result` line
/// also carries error text on failure, which is why it is checked first.
pub fn extract_final_text(engine: CliEngine, stdout: &str) -> Option<String> {
    match engine {
        CliEngine::Claude | CliEngine::Codex => stdout.lines().rev().find_map(|l| {
            let v: serde_json::Value = serde_json::from_str(l).ok()?;
            if v.get("type").and_then(|t| t.as_str()) != Some("result") {
                return None;
            }
            v.get("result").and_then(|r| r.as_str()).map(str::to_string)
        }),
        CliEngine::Gemini => {
            let trimmed = stdout.trim();
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
                // agy reports failures IN BAND: an ERROR envelope has an empty
                // `response` and the reason in `error`. Without this the raw
                // fallback below hands the whole JSON blob back as the DM's
                // line, and it gets read aloud at the table as narration.
                if v.get("status").and_then(|s| s.as_str()) == Some("ERROR") {
                    return None;
                }
                for k in ["response", "text", "output", "content", "result"] {
                    if let Some(s) = v.get(k).and_then(|x| x.as_str()).filter(|s| !s.trim().is_empty()) {
                        return Some(s.to_string());
                    }
                }
            }
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every builder, for every engine, must carry that engine's read-only
    /// enforcement. This is the test that matters: the failure it prevents is an
    /// agentic CLI with write access to a folder full of someone's campaign
    /// history, and the flag is one careless edit away at all times.
    /// The expected flags are written out LITERALLY here, not read from
    /// `lockdown_flags`. An earlier version of this test compared the builders
    /// against `lockdown_flags(engine)` and so was tautological — sabotaging
    /// `lockdown_flags` to drop Codex's `--sandbox read-only` left all eight
    /// tests green, because the builders and the expectation moved together.
    /// Pinning the literals is what makes this a tripwire instead of decoration.
    fn expected_lockdown(engine: CliEngine) -> Vec<String> {
        match engine {
            CliEngine::Claude => vec!["--tools".into(), String::new()],
            CliEngine::Codex => vec!["--sandbox".into(), "read-only".into()],
            // `--mode plan` is Antigravity's read-only mode; `accept-edits` is the
        // one that writes. `--sandbox` adds terminal restrictions on top.
        //
        // NOTE the old Gemini CLI silently overrode its equivalent flag with
        // "Approval mode overridden to default because the current folder is not
        // trusted" -- a flag being ACCEPTED is not a flag being OBEYED, and no
        // unit test here can tell those apart. This one is only trusted once it
        // passes the same md5 write test Codex passed.
        CliEngine::Gemini => vec!["--mode".into(), "plan".into(), "--sandbox".into()],
        }
    }

    #[test]
    fn every_invocation_is_locked_down_for_every_engine() {
        for engine in [CliEngine::Claude, CliEngine::Codex, CliEngine::Gemini] {
            let needed = expected_lockdown(engine);
            let builds = [
                ("oneshot", oneshot_args(engine, Some("opus"), Some("low"), "out.txt")),
                ("turn/new", turn_args(engine, None, Some("sonnet"), None, true, "out.txt")),
                ("turn/resume", turn_args(engine, Some("sess-1"), None, None, false, "out.txt")),
                ("vision", vision_args(engine, Some("opus"), None, &["a.png".into()], "out.txt")),
            ];
            for (what, inv) in builds {
                // The flags must appear, adjacently and in order — a stray
                // "read-only" floating somewhere else would pass a naive
                // `contains` check while meaning nothing.
                let found = inv.args.windows(needed.len().max(1)).any(|w| w == needed.as_slice());
                assert!(
                    found,
                    "{:?}/{what} is missing its lockdown {:?}\n  built: {:?}",
                    engine, needed, inv.args
                );
                for bad in forbidden_flags(engine) {
                    assert!(
                        !inv.args.iter().any(|a| a == bad),
                        "{:?}/{what} generated forbidden flag {bad}: {:?}",
                        engine, inv.args
                    );
                }
                // Codex's second guard: a permissive user config must not be
                // able to widen the sandbox behind the flag's back.
                if engine == CliEngine::Codex {
                    assert!(
                        inv.args.iter().any(|a| a == "--ignore-user-config"),
                        "{:?}/{what} would honour ~/.codex/config.toml: {:?}",
                        engine, inv.args
                    );
                }
            }
        }
    }

    /// Codex refuses to run outside a git repo, and campaign folders are not
    /// repos — so every Codex invocation needs this or it fails on real data
    /// while passing any test that only checks flag strings.
    #[test]
    fn codex_can_run_outside_a_git_repo() {
        for inv in [
            oneshot_args(CliEngine::Codex, None, None, "o.txt"),
            turn_args(CliEngine::Codex, None, None, None, false, "o.txt"),
            turn_args(CliEngine::Codex, Some("s"), None, None, true, "o.txt"),
            vision_args(CliEngine::Codex, None, None, &[], "o.txt"),
        ] {
            assert!(inv.args.iter().any(|a| a == "--skip-git-repo-check"), "{:?}", inv.args);
        }
    }

    /// Resuming is shaped differently per engine: Codex changes VERB
    /// (`exec resume <id>`), Gemini takes `--conversation`, Claude `--resume`.
    /// Getting any of them wrong silently starts a fresh conversation, which
    /// reads as the DM forgetting the scene.
    ///
    /// Every assertion here is transcribed from a real invocation, because the
    /// version of this test that preceded it asserted the shapes the code
    /// already produced — so it stayed green while `codex exec resume <id>
    /// --sandbox read-only` exited 2 and `--session-id` was not a flag agy has.
    /// A test written from the same guess as the code proves only that the
    /// guess is self-consistent.
    #[test]
    fn each_engine_resumes_in_its_own_shape() {
        let c = turn_args(CliEngine::Claude, Some("abc"), None, None, false, "o.txt").args;
        let i = c.iter().position(|a| a == "--resume").expect("claude --resume");
        assert_eq!(c[i + 1], "abc");

        // `resume` is a subcommand of `exec`, so exec's own flags -- the
        // lockdown among them -- must come BEFORE it.
        let x = turn_args(CliEngine::Codex, Some("abc"), None, None, false, "o.txt").args;
        assert_eq!(x[0], "exec");
        let r = x.iter().position(|a| a == "resume").expect("codex resume");
        assert_eq!(x[r + 1], "abc");
        let s = x.iter().position(|a| a == "--sandbox").expect("codex --sandbox");
        assert!(s < r, "the lockdown must precede `resume` or codex exits 2: {x:?}");
        // ...and with no id it must NOT say resume, or every first turn errors.
        let fresh = turn_args(CliEngine::Codex, None, None, None, false, "o.txt").args;
        assert!(!fresh.iter().any(|a| a == "resume"), "{fresh:?}");

        let g = turn_args(CliEngine::Gemini, Some("abc"), None, None, false, "o.txt").args;
        let i = g.iter().position(|a| a == "--conversation").expect("gemini --conversation");
        assert_eq!(g[i + 1], "abc");
        assert!(!g.iter().any(|a| a == "--session-id"), "agy has no such flag: {g:?}");
    }

    /// agy's `--prompt` is an alias for `--print`: it takes the prompt as its
    /// VALUE. Pushing an empty one and writing the real prompt to stdin made
    /// every single Gemini turn fail with "Error: empty prompt" -- so the
    /// builder must leave the prompt to the caller, and say so.
    #[test]
    fn gemini_takes_its_prompt_as_an_argument_not_on_stdin() {
        for inv in [
            turn_args(CliEngine::Gemini, None, None, None, false, "o.txt"),
            oneshot_args(CliEngine::Gemini, None, None, "o.txt"),
            vision_args(CliEngine::Gemini, None, None, &[], "o.txt"),
        ] {
            assert!(!inv.prompt_on_stdin, "agy never reads stdin: {:?}", inv.args);
            assert_eq!(
                inv.args.last().map(String::as_str),
                Some("--print"),
                "the prompt is appended after --print, so nothing may follow it: {:?}",
                inv.args
            );
        }
    }

    /// Codex's answer comes from a file, not stdout — the whole reason
    /// `Delivery` exists. Reading the wrong one yields an event dump instead of
    /// the DM's line.
    #[test]
    fn codex_answers_via_the_last_message_file() {
        let inv = turn_args(CliEngine::Codex, None, None, None, false, "reply.txt");
        assert_eq!(inv.delivery, Delivery::LastMessageFile);
        let i = inv.args.iter().position(|a| a == "--output-last-message").expect("flag");
        assert_eq!(inv.args[i + 1], "reply.txt");
        assert_eq!(turn_args(CliEngine::Claude, None, None, None, false, "x").delivery, Delivery::Stdout);
        assert_eq!(turn_args(CliEngine::Gemini, None, None, None, false, "x").delivery, Delivery::Stdout);
    }

    /// `codex login status` exits 0 whether or not anyone is signed in, so the
    /// text is the only signal. Reading it loosely would call everyone signed in.
    #[test]
    fn codex_sign_in_is_read_from_text_because_the_exit_code_lies() {
        let e = CliEngine::Codex;
        assert!(!e.auth_probe_says_signed_in("Not logged in\n"), "verbatim real output");
        assert!(!e.auth_probe_says_signed_in(""), "no output is not a sign-in");
        assert!(e.auth_probe_says_signed_in("Logged in using ChatGPT\n"));
        assert!(e.auth_probe_says_signed_in("Logged in using an API key\n"));
    }

    /// Reasoning effort has to reach EVERY engine, not just Claude.
    ///
    /// It was wired only into the Claude arm, so the other two ran the critique
    /// pass — the most analytically demanding call in the pipeline — at their own
    /// defaults. A live Codex run's banner read "reasoning effort: none" while it
    /// was reviewing campaign lore. Each engine spells it differently, which is
    /// exactly how it went unnoticed.
    #[test]
    fn reasoning_effort_reaches_every_engine_in_its_own_spelling() {
        let claude = oneshot_args(CliEngine::Claude, None, Some("high"), "o.txt").args;
        let i = claude.iter().position(|a| a == "--effort").expect("claude --effort");
        assert_eq!(claude[i + 1], "high");

        // Codex has no flag for it; only the config override works.
        let codex = oneshot_args(CliEngine::Codex, None, Some("high"), "o.txt").args;
        let i = codex.iter().position(|a| a == "-c").expect("codex -c override");
        assert_eq!(codex[i + 1], "model_reasoning_effort=\"high\"");

        let codex_turn = turn_args(CliEngine::Codex, Some("abc"), None, Some("medium"), false, "o.txt").args;
        let i = codex_turn.iter().position(|a| a == "-c").expect("codex turn -c override");
        assert_eq!(codex_turn[i + 1], "model_reasoning_effort=\"medium\"");

        let codex_vision = vision_args(CliEngine::Codex, None, Some("xhigh"), &["a.png".into()], "o.txt").args;
        let i = codex_vision.iter().position(|a| a == "-c").expect("codex vision -c override");
        assert_eq!(codex_vision[i + 1], "model_reasoning_effort=\"xhigh\"");

        let gemini = oneshot_args(CliEngine::Gemini, None, Some("high"), "o.txt").args;
        let i = gemini.iter().position(|a| a == "--effort").expect("agy --effort");
        assert_eq!(gemini[i + 1], "high");

        // And none of them may invent one when the caller passed nothing.
        for engine in [CliEngine::Claude, CliEngine::Codex, CliEngine::Gemini] {
            let args = oneshot_args(engine, None, None, "o.txt").args;
            assert!(
                !args.iter().any(|a| a == "--effort" || a.starts_with("model_reasoning_effort")),
                "{engine:?} invented an effort: {args:?}"
            );
        }
    }

    /// Gemini's sign-in state can only be read from a REAL completed call.
    ///
    /// Two cheaper answers were tried and both were wrong, in opposite
    /// directions — which is why this test pins verbatim output from each case:
    ///
    /// - `agy models` exits 0 and prints the whole catalogue while signed OUT,
    ///   so it reported everyone as signed in.
    /// - `~/.gemini/oauth_creds.json` reported a genuinely signed-in user as
    ///   signed OUT. That path belonged to the retired gemini-cli; Antigravity
    ///   stores its token somewhere else entirely.
    ///
    /// Same lesson as Codex's `login status`: a probe is only a probe once it has
    /// been run in BOTH states.
    #[test]
    fn gemini_sign_in_can_only_be_read_from_a_real_completed_call() {
        let probe = CliEngine::Gemini.auth_probe_args().expect("gemini needs a probe");
        assert!(probe.contains(&"--print"), "the probe must be a real prompt: {probe:?}");
        assert!(probe.contains(&"--output-format"), "and must ask for the envelope: {probe:?}");
        // The lockdown applies even to the probe — it is a live model call.
        assert!(probe.contains(&"--mode") && probe.contains(&"plan"), "{probe:?}");

        let e = CliEngine::Gemini;
        // A real success envelope, verbatim.
        assert!(e.auth_probe_says_signed_in(
            r#"{"conversation_id":"57c3ce5a","status":"SUCCESS","response":"ok\n","num_turns":1}"#
        ));
        // The catalogue that fooled the previous probe. Signed out, this is
        // EXACTLY what `agy models` prints — it must never read as a sign-in.
        assert!(!e.auth_probe_says_signed_in("gemini-3.6-flash-high\ngemini-3.1-pro-low\nclaude-sonnet-4-6"));
        // What signed-out actually looks like: a banner on stderr, no envelope.
        assert!(!e.auth_probe_says_signed_in(
            "Authentication required. Please visit the URL to log in:\n  https://accounts.google.com/o/oauth2/auth?..."
        ));
        assert!(!e.auth_probe_says_signed_in(r#"{"status":"ERROR","error":"Error: empty prompt"}"#));
        assert!(!e.auth_probe_says_signed_in(""));
    }

    #[test]
    fn an_unknown_engine_setting_falls_back_to_claude_rather_than_failing() {
        assert_eq!(CliEngine::from_setting("codex"), CliEngine::Codex);
        assert_eq!(CliEngine::from_setting("GEMINI"), CliEngine::Gemini);
        assert_eq!(CliEngine::from_setting(" Claude "), CliEngine::Claude);
        // A setting written by a newer build, or corrupted — still runs.
        assert_eq!(CliEngine::from_setting("grok"), CliEngine::Claude);
        assert_eq!(CliEngine::from_setting(""), CliEngine::Claude);
    }

    /// The inputs below are VERBATIM first lines from real runs on 2026-07-25.
    /// This matters more than it looks: the previous version of this test fed
    /// Codex a hand-written `{"session_id":...}` that Codex has never emitted,
    /// passed, and left the scrape returning None on every real turn.
    #[test]
    fn session_ids_are_scraped_from_what_the_engines_actually_print() {
        // Codex, first line of `codex exec --json`:
        assert_eq!(
            extract_session_id(
                CliEngine::Codex,
                "{\"type\":\"thread.started\",\"thread_id\":\"019f9832-1e0f-7e40-9c67-63d7439fb1cc\"}\n{\"type\":\"turn.started\"}",
            ),
            Some("019f9832-1e0f-7e40-9c67-63d7439fb1cc".into())
        );
        // agy, its whole `--output-format json` envelope:
        assert_eq!(
            extract_session_id(CliEngine::Gemini, r#"{"conversation_id":"conv-7","status":"OK","response":"hi"}"#),
            Some("conv-7".into())
        );
        // ...but an empty one is not an id, it is agy failing before it started.
        assert_eq!(extract_session_id(CliEngine::Gemini, r#"{"conversation_id":"","status":"ERROR"}"#), None);
        assert_eq!(
            extract_session_id(CliEngine::Claude, "noise\n{\"type\":\"result\",\"session_id\":\"s-9\"}"),
            Some("s-9".into())
        );
        // Codex nests some fields under `msg`.
        assert_eq!(
            extract_session_id(CliEngine::Codex, r#"{"msg":{"session_id":"c-1"}}"#),
            Some("c-1".into())
        );
        assert_eq!(extract_session_id(CliEngine::Codex, "not json at all"), None);
    }

    #[test]
    fn final_text_survives_an_unverified_gemini_envelope() {
        assert_eq!(
            extract_final_text(CliEngine::Claude, "{\"type\":\"result\",\"result\":\"hi\"}"),
            Some("hi".into())
        );
        // Whichever key Gemini actually uses, one of these hits...
        assert_eq!(extract_final_text(CliEngine::Gemini, r#"{"response":"hi"}"#), Some("hi".into()));
        assert_eq!(extract_final_text(CliEngine::Gemini, r#"{"text":"hi"}"#), Some("hi".into()));
        // ...and if none do, plain text beats losing the turn.
        assert_eq!(extract_final_text(CliEngine::Gemini, "just words"), Some("just words".into()));
        assert_eq!(extract_final_text(CliEngine::Gemini, "   "), None);
        // A real failure envelope, verbatim. It must NOT come back as the DM's
        // line -- returning None makes the caller raise it as the error it is.
        assert_eq!(
            extract_final_text(
                CliEngine::Gemini,
                r#"{"conversation_id":"","status":"ERROR","response":"","error":"Error: empty prompt. Usage: agy --print \"your prompt here\""}"#,
            ),
            None
        );
    }
}
