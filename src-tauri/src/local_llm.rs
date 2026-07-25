//! local_llm.rs — DM turns via a locally-hosted LLM speaking the OpenAI-
//! compatible `/v1/chat/completions` HTTP API (Ollama, LM Studio, llama.cpp
//! server, koboldcpp all support this one interface) instead of the `claude`
//! CLI subscription. See dm.rs for the Claude path — this is a parallel,
//! independent path; nothing about dm.rs changes.
//!
//! Two things Claude Code gives us for free that a plain HTTP call doesn't:
//!
//! 1. **CLAUDE.md auto-loading.** `claude` resolves a project's CLAUDE.md and
//!    its `@path` imports just by being run with that folder as its cwd (see
//!    campaign.rs). Here we read CLAUDE.md and resolve its `@path` import
//!    lines ourselves (`resolve_claude_md_imports`) — generic, not hardcoded
//!    to today's specific import set.
//! 2. **Session continuity.** Claude's `--resume` keeps conversation history
//!    CLI-side. Here we keep our own rolling per-session message history
//!    (`SESSIONS`) and resend it in full each turn, same as any stateless
//!    chat-completions API requires.
//!
//! Reply contract is reworked for local models specifically: instead of
//! Claude's "narration prose + optional trailing ```dm-actions fenced block"
//! (mixing free text and JSON in one reply — exactly where weaker models
//! fumble), local turns request the ENTIRE reply as one JSON object,
//! `{"narration": "...", "actions": {...}|null}`, with
//! `response_format: {"type":"json_object"}` (the one structured-output mode
//! essentially every OpenAI-compatible server supports). The reply is then
//! reformatted (`format_as_dm_reply_text`) back into Claude's exact wire
//! shape before returning to the frontend, so dmActions.ts's `parseDmReply`
//! needs zero changes to handle either provider.

use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;

use crate::campaign::{campaign_dir, read_optional};
use crate::dm::DmReply;

#[derive(Serialize, Deserialize, Clone)]
struct ChatMessage {
    role: String,
    content: String,
}

fn sessions() -> &'static Mutex<HashMap<String, Vec<ChatMessage>>> {
    static SESSIONS: OnceLock<Mutex<HashMap<String, Vec<ChatMessage>>>> = OnceLock::new();
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

const LOCAL_OUTPUT_FORMAT_ADDENDUM: &str = "\n\n## Output format (STRICT — local model mode)\nReply with ONLY a single JSON object, no markdown fences, no extra commentary before or after it: {\"narration\": \"<what you say aloud>\", \"actions\": <the dm-actions object described above, using those exact keys, or null>}. Do not wrap it in a code fence. Do not include anything outside this one JSON object.";

/// Local-model-only reinforcement of the highest-stakes rules from
/// dm_rules.md, in short/blunt form and positioned last (closest to
/// generation) rather than relying solely on a weaker model to weight them
/// correctly inside a long imported document. This does not replace
/// dm_rules.md — that's still fully included via resolve_claude_md_imports
/// above — it's a recency-biased reminder of the three rules most likely to
/// get muddled by a smaller model: dice-only HP/death, rejecting invented
/// player overreach outright, and discretion only running one direction.
/// Claude's own path (dm.rs) never sees this text.
const LOCAL_CRITICAL_REMINDERS: &str = "\n\n## Critical reminders (read last, follow exactly)\n- HP, death saves, and attack/damage rolls are decided by dice only — never invent a rescue or override a roll's result. The party can lose characters; that's allowed.\n- If a player declares their own success or invents something not already established (a monster, an item, an event), reject it entirely — don't partially accept it. State plainly what's actually true instead.\n- Only bend the story to make things harder or more interesting — never to bail the party out of trouble they earned.";

/// Cap on how much of any ONE `@import` gets inlined into a local model's
/// system prompt.
///
/// Claude has an enormous context window and prompt caching, so inlining a
/// whole chapter costs it nothing. A local model typically has ~32K tokens
/// TOTAL and no cache — and the active module's current chapter
/// (`@active_module/current.md`) is by far the biggest import, easily tens of
/// thousands of characters on its own. Left unbounded it crowds out the
/// conversation history, or blows the window outright and the turn just errors.
/// Nothing guarded this before: `trim_history` bounds the conversation, but the
/// system prompt was unbounded.
///
/// Deliberately a PER-IMPORT cap rather than a cap on the finished prompt.
/// Truncating the assembled prompt would cut whatever lands at the end — and
/// `@memory/dm_rules.md` and `@memory/session_index.md` are appended to
/// CLAUDE.md *after* the module block (see campaign.rs's sync_dm_rules_at /
/// sync_session_index_at), so a tail-trim would eat the DM's actual rules and
/// leave the chapter intact: exactly backwards. Capping each import instead
/// bounds the only one that can realistically be huge, and leaves every small
/// one (rules, registries, memory) completely untouched.
const LOCAL_MAX_IMPORT_CHARS: usize = 12_000;

/// UTF-8-safe truncation of one inlined import to LOCAL_MAX_IMPORT_CHARS,
/// with a marker so the model knows the section is incomplete rather than
/// silently treating a half-chapter as the whole thing. Keeps the head: a
/// chapter reads front-to-back, and resolved portions are already trimmed out
/// of current.md as the party progresses (see campaign.rs's
/// trim_resolved_chapter_section_at), so the front is where they actually are.
fn truncate_import_for_local(content: &str) -> String {
    if content.chars().count() <= LOCAL_MAX_IMPORT_CHARS {
        return content.to_string();
    }
    let kept: String = content.chars().take(LOCAL_MAX_IMPORT_CHARS).collect();
    format!(
        "{kept}\n\n[... This section was cut short to fit this model's context window — there is more content here that you cannot see. Play what you have and let the scene develop naturally; don't state or imply that nothing further exists. ...]"
    )
}

/// Resolves a CLAUDE.md's `@relative/path` import lines against files in
/// `dir`, inlining each referenced file's content in place. Generic — works
/// for whatever imports actually exist (memory/MEMORY.md, module/index.md,
/// module/current.md today), not hardcoded to that specific set. Each import
/// is capped on the way in — see LOCAL_MAX_IMPORT_CHARS.
fn resolve_claude_md_imports(dir: &Path, claude_md: &str) -> String {
    claude_md
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            if let Some(rel_path) = trimmed.strip_prefix('@') {
                truncate_import_for_local(&read_optional(&dir.join(rel_path)))
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Builds the full system prompt a local LLM needs, since it gets none of
/// Claude Code's automatic CLAUDE.md/@import loading. The critical reminders
/// and output-format contract are appended LAST (closest to generation, where
/// a weaker model weights them most) and are never subject to the per-import
/// cap above — whatever else gets trimmed, the DM's hard rules and its reply
/// contract always survive intact.
fn build_system_prompt_at(dir: &Path) -> String {
    let claude_md = read_optional(&dir.join("CLAUDE.md"));
    let resolved = resolve_claude_md_imports(dir, &claude_md);
    format!("{resolved}{LOCAL_CRITICAL_REMINDERS}{LOCAL_OUTPUT_FORMAT_ADDENDUM}")
}

/// Marks the standing brief handed to a non-Claude CLI. Named boundaries rather
/// than a bare paste so the model can tell its persona from the turn it has to
/// answer — this arrives as ordinary prompt text, not a system prompt.
const CLI_CONTEXT_HEADER: &str = "# Standing instructions — your persona, house rules, and this campaign's world\n\nEverything up to the END marker below is your standing brief for this and every later turn in this conversation. Claude Code reads it automatically from the project's CLAUDE.md; you are being handed it directly because your CLI does not read that file.";
const CLI_CONTEXT_FOOTER: &str = "# END of standing instructions\n\nEverything below is this turn only.";

fn cli_context_sent() -> &'static Mutex<HashMap<std::path::PathBuf, u64>> {
    static SENT: OnceLock<Mutex<HashMap<std::path::PathBuf, u64>>> = OnceLock::new();
    SENT.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The standing project context a non-Claude CLI needs, because it does not read
/// CLAUDE.md.
///
/// Measured 2026-07-25 in a scratch directory holding all three convention files
/// with a different pass-phrase in each: `agy --print` read NONE of CLAUDE.md /
/// AGENTS.md / GEMINI.md, and `codex exec` read AGENTS.md only. Neither reads
/// CLAUDE.md, which is the only one Tavern Sheet writes — so choosing Codex or
/// Gemini as the DM engine used to hand the model nothing but the live party
/// status: no persona, no house rules, no dm-actions contract, no NPC memory, no
/// module chapter. A live Gemini turn confirmed it — competent narration, and no
/// actions block at all, so nothing the app could act on.
///
/// `None` when this exact context already went out on this campaign's current
/// thread. `--conversation` / `exec resume` replay the whole thread, so
/// re-sending unconditionally would stack another ~39K chars per turn. Any
/// change — a chapter advance, a new memory note — moves the hash and re-sends,
/// which is the property Claude gets for free by re-reading CLAUDE.md each turn.
pub(crate) fn cli_project_context(dir: &Path, resuming: bool) -> Option<String> {
    use std::hash::{Hash, Hasher};
    let claude_md = read_optional(&dir.join("CLAUDE.md"));
    if claude_md.trim().is_empty() {
        return None;
    }
    let resolved = resolve_claude_md_imports(dir, &claude_md);
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    resolved.hash(&mut hasher);
    let hash = hasher.finish();
    let mut sent = cli_context_sent().lock().unwrap();
    // A fresh thread has nothing, so it always gets the brief regardless of what
    // some earlier thread on this campaign was told.
    if resuming && sent.get(dir) == Some(&hash) {
        return None;
    }
    sent.insert(dir.to_path_buf(), hash);
    Some(format!("{CLI_CONTEXT_HEADER}\n\n{resolved}\n\n{CLI_CONTEXT_FOOTER}"))
}

/// Bounds a session's stored history to the most recent `limit_turns` user+
/// assistant pairs, dropping the oldest first. Local models resend this
/// history in full every turn (no lightweight --resume token the way Claude
/// has) and typically have far smaller context windows — left unbounded, a
/// long session risks silently overflowing the model's window. Safe to trim:
/// anything that actually needs to survive long-term (NPCs, promises, facts)
/// already lives in the standing memory files resolved into the system
/// prompt every turn, not in this raw conversational replay.
fn trim_history(history: &mut Vec<ChatMessage>, limit_turns: u32) {
    let max_messages = (limit_turns as usize).saturating_mul(2);
    if history.len() > max_messages {
        let excess = history.len() - max_messages;
        history.drain(0..excess);
    }
}

#[derive(Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    kind: String,
}

/// Qwen3-family models default to "thinking mode" — a `<think>...</think>`
/// reasoning block prepended to every reply. Without this, that raw internal
/// monologue lands straight in `narration` (parse_local_reply doesn't strip
/// it, it just splits on the JSON contract) and gets spoken by the DM before
/// the actual in-character line. `enable_thinking: false` is the documented
/// vLLM/Qwen3 chat-template toggle to suppress it at generation time instead
/// of parsing it back out after the fact. Harmless on any other backend —
/// an OpenAI-compatible server that doesn't recognize this field just ignores
/// it, same as any other unknown JSON key.
#[derive(Serialize)]
struct ChatTemplateKwargs {
    enable_thinking: bool,
}

#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    response_format: ResponseFormat,
    chat_template_kwargs: ChatTemplateKwargs,
}

fn build_request(model: &str, system_prompt: &str, history: &[ChatMessage], user_prompt: &str) -> ChatCompletionRequest {
    let mut messages = Vec::with_capacity(history.len() + 2);
    messages.push(ChatMessage { role: "system".into(), content: system_prompt.to_string() });
    messages.extend_from_slice(history);
    messages.push(ChatMessage { role: "user".into(), content: user_prompt.to_string() });
    ChatCompletionRequest {
        model: model.to_string(),
        messages,
        response_format: ResponseFormat { kind: "json_object".into() },
        chat_template_kwargs: ChatTemplateKwargs { enable_thinking: false },
    }
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatCompletionChoice>,
}
#[derive(Deserialize)]
struct ChatCompletionChoice {
    message: ChatCompletionChoiceMessage,
}
#[derive(Deserialize)]
struct ChatCompletionChoiceMessage {
    content: String,
}

#[derive(Deserialize)]
struct ModelsListResponse {
    data: Vec<ModelEntry>,
}
#[derive(Deserialize)]
struct ModelEntry {
    id: String,
}

/// Base URLs to try, in order, for a configured local server.
///
/// The Windows + WSL2 trap this exists for: WSL2's localhost-forwarding binds
/// **IPv4 only** (`127.0.0.1:PORT`), while on Windows the hostname `localhost`
/// resolves to `::1` (IPv6) FIRST.
///
/// Note this does NOT make the server unreachable — Rust's resolver returns
/// both addresses and falls through to `127.0.0.1` by itself. What it costs is
/// *time*: Windows takes ~2s to refuse the doomed `::1` connect before the
/// fallthrough. Measured against a live WSL-hosted vLLM:
///
///     http://localhost:8000/v1/models  ->  ok in 2031 ms
///     http://127.0.0.1:8000/v1/models  ->  ok in    1.9 ms
///
/// A thousandfold difference, paid on every single call — once per DM turn, but
/// once per CHUNK during map-reduce ingestion, where a 300-page module is a lot
/// of chunks. So for a `localhost` URL, try the IPv4 address FIRST and keep the
/// configured one as the fallback (which still covers a server genuinely bound
/// to IPv6 only). A real hostname or an explicit IP is never rewritten.
fn candidate_base_urls(base_url: &str) -> Vec<String> {
    let base = base_url.trim().trim_end_matches('/').to_string();
    match base.split_once("//localhost") {
        Some((scheme, rest)) => vec![format!("{scheme}//127.0.0.1{rest}"), base],
        None => vec![base],
    }
}

/// The candidate that last actually connected, keyed by the *configured* base
/// URL. Purely a latency cache — correctness never depends on it.
///
/// candidate_base_urls probes IPv4 first because that's right for a WSL-hosted
/// server, but that is still a *guess*. This keeps the guess from being a new
/// hardcoded assumption: a server genuinely bound to IPv6 only answers on
/// `localhost` and refuses `127.0.0.1`, and without this it would re-probe that
/// dead address on every call forever. Whichever address actually connects is
/// the one tried first next time, so either kind of server converges to its own
/// fast path.
fn resolved_base_urls() -> &'static Mutex<HashMap<String, String>> {
    static RESOLVED: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    RESOLVED.get_or_init(|| Mutex::new(HashMap::new()))
}

fn base_url_key(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_string()
}

/// candidate_base_urls, reordered to put whichever address last connected first.
fn ordered_candidates(base_url: &str) -> Vec<String> {
    let mut candidates = candidate_base_urls(base_url);
    let known = resolved_base_urls()
        .lock()
        .unwrap()
        .get(&base_url_key(base_url))
        .cloned();
    if let Some(known) = known {
        if let Some(pos) = candidates.iter().position(|c| *c == known) {
            candidates.swap(0, pos);
        }
    }
    candidates
}

fn remember_working_base_url(base_url: &str, working: &str) {
    resolved_base_urls()
        .lock()
        .unwrap()
        .insert(base_url_key(base_url), working.to_string());
}

/// Called when EVERY candidate failed to connect: whatever we remembered is
/// stale (server moved, or was never really there), so drop it rather than
/// keep starting from a dead address forever.
fn forget_working_base_url(base_url: &str) {
    resolved_base_urls()
        .lock()
        .unwrap()
        .remove(&base_url_key(base_url));
}

/// Runs one request against each candidate base URL (see candidate_base_urls)
/// until one actually CONNECTS, then remembers which one did so the next call
/// starts there. A transport failure falls through to the next candidate; an
/// HTTP-level error (4xx/5xx) is returned immediately, since the server clearly
/// exists and retrying a different address won't help.
fn try_each_base_url<T>(
    base_url: &str,
    mut send: impl FnMut(&str) -> Result<T, ureq::Error>,
) -> Result<T, String> {
    let mut last_transport_err = None;
    for base in ordered_candidates(base_url) {
        match send(&base) {
            Ok(v) => {
                remember_working_base_url(base_url, &base);
                return Ok(v);
            }
            Err(ureq::Error::Status(code, r)) => {
                let text = r.into_string().unwrap_or_default();
                return Err(format!("Local model server returned {code}: {text}"));
            }
            Err(e) => last_transport_err = Some(format!("{e}")),
        }
    }
    forget_working_base_url(base_url);
    // Names the address the user actually CONFIGURED, not whichever rewrite we
    // happened to try last — being told we couldn't reach "127.0.0.1:9999" when
    // you typed "localhost:9999" just reads as a bug in the app.
    match last_transport_err {
        Some(e) => Err(format!(
            "Couldn't reach the local model server at {}: {e}",
            base_url_key(base_url)
        )),
        None => Err("No local model server address configured.".to_string()),
    }
}

/// Parses a `/v1/models` response body into a plain list of model ids. Split
/// out from fetch_local_models so the parsing itself is testable without a
/// live server — same reasoning as parse_local_reply below.
fn parse_models_response(body: &str) -> Result<Vec<String>, String> {
    let parsed: ModelsListResponse =
        serde_json::from_str(body).map_err(|e| format!("Couldn't parse the model list: {e}"))?;
    Ok(parsed.data.into_iter().map(|m| m.id).collect())
}

/// Lists models available on a local OpenAI-compatible server via the
/// standard `/v1/models` endpoint — supported by Ollama, LM Studio, llama.cpp
/// server, and koboldcpp alike, same reasoning as call_local_llm below using
/// `/v1/chat/completions` instead of any one server's own proprietary API.
fn fetch_local_models(base_url: &str) -> Result<Vec<String>, String> {
    let resp = try_each_base_url(base_url, |base| ureq::get(&format!("{base}/v1/models")).call())?;
    let body = resp
        .into_string()
        .map_err(|e| format!("Couldn't read the model list response: {e}"))?;
    parse_models_response(&body)
}

/// Tauri command wrapping fetch_local_models — see its doc comment. A plain
/// blocking HTTP call, so this gets the same spawn_blocking treatment as
/// every other local-LLM command in this file.
#[tauri::command]
pub async fn list_local_llm_models(base_url: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || fetch_local_models(&base_url))
        .await
        .map_err(|e| format!("Model list task failed: {e}"))?
}

#[derive(Deserialize)]
struct LocalDmReply {
    #[serde(default)]
    narration: String,
    #[serde(default)]
    actions: Option<Value>,
}

/// Tolerant parse of a local model's raw completion text. A model that
/// doesn't perfectly follow the JSON-object contract still gets *something*
/// shown — same "never worse than today's Claude-path failure mode" goal as
/// applyDmActions' per-entry skip-don't-discard behavior on the frontend.
fn parse_local_reply(raw: &str) -> (String, Option<Value>) {
    match serde_json::from_str::<LocalDmReply>(raw.trim()) {
        Ok(reply) if !reply.narration.trim().is_empty() => (reply.narration, reply.actions),
        _ => (raw.trim().to_string(), None),
    }
}

/// Reconstructs Claude's exact reply wire shape (narration + optional
/// trailing ```dm-actions fenced block) so dmActions.ts's parseDmReply needs
/// no changes to handle either provider.
fn format_as_dm_reply_text(narration: &str, actions: Option<&Value>) -> String {
    match actions {
        Some(a) => format!("{narration}\n\n```dm-actions\n{a}\n```"),
        None => narration.to_string(),
    }
}

fn call_local_llm(base_url: &str, model: &str, system_prompt: &str, history: &[ChatMessage], user_prompt: &str) -> Result<String, String> {
    let body = build_request(model, system_prompt, history, user_prompt);
    let resp = try_each_base_url(base_url, |base| {
        ureq::post(&format!("{base}/v1/chat/completions")).send_json(&body)
    })?;

    let parsed: ChatCompletionResponse = resp
        .into_json()
        .map_err(|e| format!("Couldn't parse the local model server's response: {e}"))?;

    let content = parsed
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .ok_or("Local model server returned no choices")?;

    let (narration, actions) = parse_local_reply(&content);
    Ok(format_as_dm_reply_text(&narration, actions.as_ref()))
}

// ── Ingestion provider (one-shot backend LLM work) ───────────────────────────
//
// campaign.rs's ingestion/memory work (module chapterize, campaign lore,
// session digest, compaction, voice/hooks reconciliation, session-plan) is a
// series of one-shot LLM calls that historically ALWAYS went to Claude via
// dm::ask_claude_once. This lets that whole class of work optionally run on the
// local server instead — useful for small throwaway one-shot campaigns where
// spending Claude subscription budget on ingestion isn't worth it. It's a
// SEPARATE choice from the live-turn provider (dmProvider): you can run quality
// Claude turns with cheap local ingestion, fully local, or any mix.

/// Device-global ingestion-provider config, mirrored down from the frontend's
/// persisted setting via set_ingestion_provider (on mount and on every change,
/// see DMConsolePage's ingestion-sync effect). Held in a global rather than
/// threaded through ~a dozen async command chains because it's a single,
/// rarely-changed device setting with one source of truth — same
/// OnceLock<Mutex<>> precedent as SESSIONS above. Defaults to Claude
/// (use_local=false), so behavior is unchanged until the user opts in.
#[derive(Clone, Default)]
struct IngestConfig {
    use_local: bool,
    base_url: String,
    model: String,
    /// Which subscription CLI answers when `use_local` is false. Defaults to
    /// Claude, so nothing changes until the user picks another engine.
    engine: Option<crate::cli_provider::CliEngine>,
    /// Every OTHER signed-in engine to consult when cross-checking is on. Used
    /// for the critique leg of draft→critique ingestion flows: a model reviewing
    /// its OWN draft shares that draft's blind spots, so independent reviewers
    /// are strictly better.
    ///
    /// A LIST, not one: the settings panel has always let you tick more than one
    /// reviewer, but this held a single engine and the frontend quietly sent
    /// only the first — so asking for Codex AND Gemini silently got you one of
    /// them. Different models also catch different things, which is the entire
    /// argument for asking more than one.
    cross_check: Vec<crate::cli_provider::CliEngine>,
}

fn ingest_config() -> &'static Mutex<IngestConfig> {
    static CFG: OnceLock<Mutex<IngestConfig>> = OnceLock::new();
    CFG.get_or_init(|| Mutex::new(IngestConfig::default()))
}

/// Frontend pushes the persisted ingestion-provider setting down here. The
/// base_url/model are the same local server the live-turn local path uses
/// (there's no reason to run two different local servers); both are ignored
/// when use_local is false.
#[tauri::command]
pub fn set_ingestion_provider(use_local: bool, base_url: String, model: String) {
    let mut cfg = ingest_config().lock().unwrap();
    cfg.use_local = use_local;
    cfg.base_url = base_url;
    cfg.model = model;
}

/// Which subscription CLI handles ingestion, and which one reviews it.
///
/// `engine` is the primary. `cross_check` is the second opinion for critique
/// legs — None when the user hasn't enabled it, or when no second engine is
/// signed in and working. Kept separate from `set_ingestion_provider` so the
/// local-server settings and the CLI-engine settings don't have to be pushed
/// down together.
#[tauri::command]
pub fn set_ingestion_engine(engine: String, cross_check: Option<Vec<String>>) {
    let mut cfg = ingest_config().lock().unwrap();
    cfg.engine = Some(crate::cli_provider::CliEngine::from_setting(&engine));
    let mut seen: Vec<crate::cli_provider::CliEngine> = Vec::new();
    for name in cross_check.unwrap_or_default() {
        let e = crate::cli_provider::CliEngine::from_setting(&name);
        // from_setting falls back to Claude on anything unrecognised, so a typo
        // would otherwise silently add Claude as a reviewer.
        if !seen.contains(&e) {
            seen.push(e);
        }
    }
    cfg.cross_check = seen;
}

/// Every engine that should REVIEW a draft this ingestion flow just produced.
///
/// Empty means "review with the same engine", which is what always happened
/// before cross-checking existed. The primary is filtered out here rather than
/// at the call sites: a model reviewing its own draft shares that draft's blind
/// spots, which is the entire reason for a second opinion.
pub fn ingestion_reviewers() -> Vec<crate::cli_provider::CliEngine> {
    let cfg = ingest_config().lock().unwrap();
    if cfg.use_local {
        return Vec::new();
    }
    let primary = cfg.engine.unwrap_or(crate::cli_provider::CliEngine::Claude);
    cfg.cross_check.iter().copied().filter(|c| *c != primary).collect()
}

/// The single reviewer for the paths that can only use one — rate-limit
/// failover, and the battle-map tile-pick check that fires per texture and
/// cannot afford a fan-out.
pub fn ingestion_reviewer() -> Option<crate::cli_provider::CliEngine> {
    ingestion_reviewers().into_iter().next()
}

/// Run one ingestion prompt on a SPECIFIC engine, bypassing the configured
/// primary — how a critique leg reaches the reviewer. Falls back to the normal
/// path if that engine fails, because a second opinion is an improvement, not a
/// dependency: losing the reviewer should degrade quality, never lose the work.
pub fn ask_ingest_once_on(
    engine: crate::cli_provider::CliEngine, prompt: String, claude_model: Option<&str>, expect_json: bool,
    effort: Option<&str>,
) -> Result<String, String> {
    match crate::dm::run_engine_oneshot(engine, &prompt, claude_model, effort) {
        Ok(text) => {
            // Logged on SUCCESS, not just on failure. Because this degrades
            // silently, a quiet log was indistinguishable from the reviewer
            // never having been consulted at all — so there was no way to tell
            // whether the second opinion anyone paid for actually happened.
            crate::maplog::log(
                "CROSS-CHECK reviewed",
                &format!("{} returned {} chars", engine.label(), text.len()),
            );
            Ok(text)
        }
        Err(e) => {
            crate::maplog::log("CROSS-CHECK fell back to the primary engine", &e);
            ask_ingest_once(prompt, claude_model, expect_json)
        }
    }
}

/// Whether `ask_ingest_once` is currently routing to a local model rather
/// than Claude — for callers whose PROMPT (not just their tolerance for a
/// weaker reply) needs to change depending on which one is about to answer
/// it. See campaign.rs's battle_map_format_instructions: a small local model
/// reliably lost track of a long, two-example prompt in a way Claude never
/// did (confirmed live), so that prompt has a streamlined variant for local.
pub fn is_local_ingestion() -> bool {
    ingest_config().lock().unwrap().use_local
}

#[derive(Serialize)]
struct OneShotRequest {
    model: String,
    messages: Vec<ChatMessage>,
    /// Only sent when the ingestion prompt actually wants a JSON object
    /// (chapterize/digest/etc.) — forcing json_object on the markdown/plain-
    /// text prompts (plans, inventories, compaction) would break them, so this
    /// stays absent for those. Omitted entirely (not null) when None.
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<ResponseFormat>,
    chat_template_kwargs: ChatTemplateKwargs,
}

fn build_oneshot_request(model: &str, prompt: &str, expect_json: bool) -> OneShotRequest {
    OneShotRequest {
        model: model.to_string(),
        messages: vec![ChatMessage { role: "user".into(), content: prompt.to_string() }],
        response_format: expect_json.then(|| ResponseFormat { kind: "json_object".into() }),
        chat_template_kwargs: ChatTemplateKwargs { enable_thinking: false },
    }
}

/// One-shot completion against a local OpenAI-compatible server — the local
/// counterpart to dm::ask_claude_once. Unlike call_local_llm (the live DM turn
/// path) there's no system-prompt/history split and no narration/actions
/// parsing: the whole ingestion prompt is one user message and the raw reply
/// text is returned as-is for campaign.rs's own tolerant parsers to handle.
fn ask_local_once(base_url: &str, model: &str, prompt: &str, expect_json: bool) -> Result<String, String> {
    let body = build_oneshot_request(model, prompt, expect_json);
    let resp = try_each_base_url(base_url, |base| {
        ureq::post(&format!("{base}/v1/chat/completions")).send_json(&body)
    })?;
    let parsed: ChatCompletionResponse = resp
        .into_json()
        .map_err(|e| format!("Couldn't parse the local model server's response: {e}"))?;
    parsed
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .ok_or_else(|| "Local model server returned no choices".to_string())
}

/// Dispatches one-shot ingestion/memory work to whichever provider the
/// ingestion setting selects. Claude (the default) uses the subscription CLI at
/// the given tier (`claude_model`, e.g. "opus"/"sonnet"); local uses the
/// configured server, ignoring that tier hint (a local server runs whatever
/// model it was started with). campaign.rs calls this everywhere it used to
/// call dm::ask_claude_once directly. `expect_json` only affects the local
/// path (Claude follows the prompt's own format instruction either way).
/// Does this error mean the engine's sign-in has lapsed, rather than the call
/// having genuinely failed?
///
/// A subscription CLI's OAuth token expires on its own schedule, so this can
/// happen in the middle of a session that was working ten minutes earlier — and
/// it is exactly as recoverable as running out of quota. Treated separately from
/// `looks_rate_limited` because it additionally means the cached "signed in"
/// answer is now a lie and has to be thrown away.
pub fn looks_signed_out(err: &str) -> bool {
    let e = err.to_ascii_lowercase();
    [
        "authentication required",
        "authentication interrupted",
        "authentication failed",
        "not logged in",
        "not authenticated",
        "please sign in",
        "please log in",
        "reauthenticate",
        "invalid_grant",
        "token expired",
        "credentials",
        "unauthorized",
        "401",
    ]
    .iter()
    .any(|needle| e.contains(needle))
}

/// The engine's CLI takes its prompt on the command line and this one didn't
/// fit. Not a fault and not transient — a different engine is the only fix, so
/// it belongs alongside rate-limited and signed-out as a failover trigger.
pub fn looks_too_long(err: &str) -> bool {
    err.contains(crate::dm::PROMPT_TOO_LONG_MARKER)
}

pub fn ask_ingest_once(prompt: String, claude_model: Option<&str>, expect_json: bool) -> Result<String, String> {
    match ask_ingest_inner(prompt.clone(), claude_model, expect_json) {
        Ok(text) => Ok(text),
        Err(e) if looks_rate_limited(&e) || looks_signed_out(&e) || looks_too_long(&e) => {
            // Out of quota, or signed out mid-session — not broken. Any OTHER
            // signed-in engine will do: finishing the import on a different
            // model beats stopping, and ingestion has no conversational
            // continuity to lose.
            //
            // Signed-out belongs here because of where ingestion actually runs.
            // The end-of-session digest walks the transcript chunk by chunk and
            // SKIPS any chunk whose call fails, so a lapsed token used to mean
            // entities.md, locations.md and flagged_facts.md silently received
            // nothing for the whole night — the raw transcript survived (it is
            // written before any model call), but next session the DM would
            // greet everyone met tonight as a stranger, with no error shown.
            if looks_signed_out(&e) {
                // The Accounts panel caches a positive answer for the process,
                // so it would keep claiming this engine is fine. Drop that.
                crate::dm::forget_cached_sign_in();
            }
            // The target has to be able to HOLD this prompt. An argv-only engine
            // refuses an 80K extraction chunk no matter whose turn it is, so
            // retrying there turns one clear failure into two.
            let Some(other) = ingestion_reviewers()
                .into_iter()
                .find(|c| crate::dm::engine_can_carry(*c, prompt.chars().count()))
            else {
                return Err(e);
            };
            crate::maplog::log(
                "INGESTION FAILED OVER",
                &format!(
                    "primary {}, retrying on {}: {e}",
                    if looks_signed_out(&e) {
                        "signed out"
                    } else if looks_too_long(&e) {
                        "cannot carry a prompt this long"
                    } else {
                        "rate-limited"
                    },
                    other.label()
                ),
            );
            crate::dm::run_engine_oneshot(other, &prompt, None, None).map_err(|second| {
                format!("{e}\n\nAlso tried {}: {second}", other.label())
            })
        }
        Err(e) => Err(e),
    }
}

fn ask_ingest_inner(prompt: String, claude_model: Option<&str>, expect_json: bool) -> Result<String, String> {
    let cfg = ingest_config().lock().unwrap().clone();
    if cfg.use_local {
        if cfg.base_url.trim().is_empty() || cfg.model.trim().is_empty() {
            return Err("Local ingestion is selected but its server address/model isn't configured (open DM Model settings).".into());
        }
        ask_local_once(&cfg.base_url, &cfg.model, &prompt, expect_json)
    } else {
        match cfg.engine.unwrap_or(crate::cli_provider::CliEngine::Claude) {
            // Claude keeps its own long-standing path: `claude_model` is a tier
            // hint (opus/sonnet) that only means something to that CLI, and
            // ask_claude_once already handles it.
            crate::cli_provider::CliEngine::Claude => crate::dm::ask_claude_once(prompt, claude_model, None),
            // Other engines run whatever model their subscription gives them,
            // so the tier hint is dropped rather than passed through as a name
            // they'd reject.
            other => crate::dm::run_engine_oneshot(other, &prompt, None, None),
        }
    }
}

/// Does this error read like a rate limit rather than a real failure?
///
/// The whole point of running on subscriptions is that quota, not money, is the
/// constraint — so hitting a wall mid-session is the EXPECTED failure, and the
/// one worth surviving. Deliberately broad: the engines word this differently
/// and a false positive costs one wasted retry on another engine, while a false
/// negative stops the game.
pub fn looks_rate_limited(err: &str) -> bool {
    let e = err.to_ascii_lowercase();
    [
        "rate limit", "rate-limit", "ratelimit", "quota", "429",
        "usage limit", "too many requests", "try again later", "temporarily unavailable",
        "resource_exhausted", "overloaded",
    ]
    .iter()
    .any(|needle| e.contains(needle))
}

/// A CRITIQUE pass: the same prompt, but answered by a DIFFERENT engine than
/// the one that wrote the draft, when the user has enabled cross-checking.
///
/// campaign lore, lore updates and plan synthesis all already run draft ->
/// critique as two calls. Until now the same model reviewed its own draft,
/// which is the weakest possible review: it shares every blind spot the draft
/// has. Pointing just this leg at another engine costs nothing extra — the call
/// was already being made — and makes the review actually independent.
///
/// Falls back to the normal path when cross-checking is off, when no reviewer
/// is configured, or when the reviewer fails. A second opinion is an
/// improvement, never a dependency.
/// Turns any of the "check X, Y, Z — then rewrite the doc" critique prompts into
/// a FINDINGS-ONLY pass.
///
/// The checks those prompts enumerate are good; the instruction to rewrite is
/// the problem when a second engine is holding the pen. This suffix keeps the
/// checks and drops the rewrite.
const FINDINGS_ONLY_OVERRIDE: &str = "\n\n---\n\nIMPORTANT — this overrides the output instruction above. Do NOT rewrite or reproduce the document. You are reviewing someone else's draft, and they will make the edits themselves.\n\nReply with ONLY a short numbered list of concrete, specific problems you found — each one naming the exact passage at fault and what is wrong with it. Do not suggest wholesale restructuring, do not restate what the draft already does well, and do not comment on length.\n\nOne thing that is NOT a defect: inventing concrete colour, texture and incident that the source material did not spell out. This is a Dungeons & Dragons prep document and that invention is the entire job — a DM types two sentences and expects a usable world back. Only call invented material a problem when it CONTRADICTS the source, contradicts itself, or paints the DM into a corner. \"The source doesn't say this\" is not by itself a finding, and a review consisting of those is a wasted pass.\n\nIf the draft has no real problems, reply with exactly: NO-FINDINGS";

/// Distinct review angles, handed out one per reviewer.
///
/// Reviewers used to get an identical prompt, and the result looked exactly like
/// that: on a live three-way run, Codex returned four findings and Gemini one,
/// and nearly all of them were the same kind of objection ("the source doesn't
/// establish this"). Two models asked the same question give correlated answers;
/// the second opinion only earns its call if it is looking somewhere else.
///
/// Ordered by what a bad document most often gets wrong, since a two-reviewer
/// setup only ever sees the first two.
const REVIEW_LENSES: &[(&str, &str)] = &[
    (
        "coverage",
        "Your angle is COVERAGE. Go through the source material and the DM's stated setup line by line and find what the draft failed to carry over — named people, places, factions, relationships, the players' own characters, anything the DM explicitly asked for. Something the DM typed themselves and the draft dropped is the single most valuable thing you can report.",
    ),
    (
        "usability at the table",
        "Your angle is USABILITY AT THE TABLE. Assume a DM is reading this mid-session with players waiting. Find anything too vague to act on — a hook that foreshadows nothing specific, an NPC with no way to play them, a thread with no first move, guidance that restates a genre instead of describing this world. Quote the passage and say what the DM still would not know how to do.",
    ),
    (
        "internal consistency",
        "Your angle is INTERNAL CONSISTENCY. Find places where the document argues with itself or with the source: a fact stated two ways, a timeline that cannot hold, a motivation that contradicts an earlier one, a detail that quietly makes an established fact impossible.",
    ),
];

/// One surgical edit to the document: replace an exact existing passage with a
/// new one. An insertion is expressed by echoing an anchor and appending to it,
/// so there is only ever one operation to reason about.
#[derive(Deserialize)]
struct DocEdit {
    find: String,
    replace: String,
}

/// Applies edits to `doc`, returning the result, how many landed, and why any
/// were refused.
///
/// `find` must match EXACTLY ONCE. Zero matches means the model quoted the
/// document wrongly; several means the edit is ambiguous about which passage it
/// meant. Either way the honest move is to refuse that one edit and say so —
/// applying a guess is how a patch silently corrupts a document.
///
/// The point of patching at all: everything not named here comes out
/// byte-identical. A full-document rewrite has no such guarantee, and the
/// measured failure this whole workflow started from was exactly that — a
/// "revision" that quietly summarized 3546 chars down to 2141.
fn apply_doc_edits(doc: &str, edits: &[DocEdit]) -> (String, usize, Vec<String>) {
    let mut out = doc.to_string();
    let mut applied = 0;
    let mut refused = Vec::new();
    for (i, e) in edits.iter().enumerate() {
        if e.find.is_empty() {
            refused.push(format!("edit {}: empty `find`", i + 1));
            continue;
        }
        match out.matches(e.find.as_str()).count() {
            1 => {
                out = out.replacen(e.find.as_str(), &e.replace, 1);
                applied += 1;
            }
            0 => refused.push(format!(
                "edit {}: `find` text is not in the document — {:?}",
                i + 1,
                e.find.chars().take(60).collect::<String>()
            )),
            n => refused.push(format!(
                "edit {}: `find` matches {n} places, too ambiguous to apply — {:?}",
                i + 1,
                e.find.chars().take(60).collect::<String>()
            )),
        }
    }
    (out, applied, refused)
}

/// Hands the reviewers' findings back to the engine that wrote the draft, asking
/// for EDITS rather than a rewrite.
fn build_patch_prompt(draft: &str, findings: &str) -> String {
    format!(
        "Below is a document you wrote, followed by review notes on it from other readers.\n\n\
        Apply the notes that are CORRECT and worth acting on — fixing real omissions, vagueness and \
        contradictions — and ignore any that are wrong, are matters of taste, or would make the \
        document worse. This is your document; each reader saw it once and has less context than you.\n\n\
        Where more than one reader is quoted, treat a point RAISED INDEPENDENTLY BY BOTH as the \
        strongest signal available and address it. Where they disagree, use your own judgement.\n\n\
        Reply with ONLY a JSON object listing the edits to make — do NOT reproduce the document:\n\n\
        {{\"edits\":[{{\"find\":\"<exact text copied from the document>\",\"replace\":\"<what it becomes>\"}}]}}\n\n\
        Rules for `find`, which are strict because each edit is applied mechanically:\n\
        - Copy it VERBATIM from the document, character for character. It is matched literally, not fuzzily.\n\
        - It must appear EXACTLY ONCE in the document. If a phrase repeats, include enough surrounding \
        text to make it unique.\n\
        - Keep it as short as possible while still unique — quote the sentence or bullet you are changing, \
        not the whole section.\n\
        To ADD new material, set `find` to the line you want it to follow and `replace` to that same line \
        plus the new content after it. To DELETE, set `replace` to an empty string.\n\n\
        Make each edit ADD substance where a note found it lacking: name the thing, give the number, \
        state the fact. Do not use these edits to shorten, condense or genericize the document — \
        concrete, playable detail is the entire point of it. Emit no edit at all for a note you are \
        choosing to ignore, and return {{\"edits\":[]}} if none of them are worth acting on.\n\n\
        Your document:\n{draft}\n\n\
        Review notes:\n{findings}"
    )
}

/// How many review-and-patch rounds a critique pass may run.
///
/// Two, not a loop until it goes quiet. Round two earns its cost because it
/// reviews the PATCHED document — the first round's answers can raise real
/// follow-on problems, and it also lets a third lens see the doc. Beyond that
/// the reviewers start trading taste, and an open loop on a document with no
/// objective finish line thrashes.
const MAX_REVIEW_ROUNDS: usize = 2;

/// Fraction of the draft's length a revision must retain to be trusted.
///
/// The measured failure sat at 60% (3546 chars -> 2141), so 0.65 catches it with
/// a little room. A genuine gap-fill should come back the same size or larger;
/// a revision that lost a third of the document did not fix it, it summarized it.
const MIN_REVISION_LENGTH_RATIO: f64 = 0.65;

/// Names the draft called out in bold — the "who and where" a revision must not
/// silently drop. Deliberately narrow: skips `**Label:**` field headers and
/// anything long enough to be a sentence rather than a name.
fn bold_names(doc: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = doc;
    while let Some(start) = rest.find("**") {
        rest = &rest[start + 2..];
        let Some(end) = rest.find("**") else { break };
        let inner = rest[..end].trim();
        rest = &rest[end + 2..];
        let is_name = !inner.is_empty()
            && !inner.ends_with(':')
            && inner.split_whitespace().count() <= 5
            && inner.starts_with(|c: char| c.is_uppercase());
        if is_name && !out.iter().any(|n: &String| n == inner) {
            out.push(inner.to_string());
        }
    }
    out
}

/// Whether a revision may replace the draft it came from.
///
/// A critique pass is supposed to ADD — fill a gap, fix a contradiction. Measured
/// against a live run, a second engine handed the pen instead returned a shorter,
/// more generic summary that dropped a fact stated in the campaign intake, and
/// that output replaced a good draft wholesale with nothing to stop it. This is
/// the stop: a revision has to keep the document's substance to earn its place.
pub fn revision_is_safe(draft: &str, revised: &str) -> (bool, String) {
    let (d, r) = (draft.trim(), revised.trim());
    if r.is_empty() {
        return (false, "the revision came back empty".into());
    }
    if (r.chars().count() as f64) < d.chars().count() as f64 * MIN_REVISION_LENGTH_RATIO {
        return (
            false,
            format!(
                "the revision is {} chars against the draft's {} — that is a summary, not a fix",
                r.chars().count(),
                d.chars().count()
            ),
        );
    }
    let lower = r.to_lowercase();
    if let Some(lost) = bold_names(d).into_iter().find(|n| !lower.contains(&n.to_lowercase())) {
        return (false, format!("the revision dropped \"{lost}\", which the draft named"));
    }
    (true, String::new())
}

/// A critique pass over `draft`.
///
/// Two different shapes, because who holds the pen matters:
///
/// - **Same engine** (no cross-check): it revises its own draft, exactly as
///   before. This path was never the problem.
/// - **A DIFFERENT engine** (cross-check on): the reviewer only FINDS problems;
///   the drafting engine FIXES them. Letting the reviewer rewrite meant the
///   final document was simply whatever the reviewer wrote — so with Claude
///   "primary" and Codex "reviewing", the lore was in fact written by Codex.
///   Measured on identical input, that turned a 3546-char draft full of playable
///   specifics into a 2141-char generic summary that dropped a fact stated in
///   the intake — while the critique prompt's whole job was to catch omissions.
///
/// Either way the result must survive `revision_is_safe`, or the draft stands.
pub fn ask_ingest_critique(
    prompt: String, draft: &str, claude_model: Option<&str>, expect_json: bool,
) -> Result<String, String> {
    let reviewers = ingestion_reviewers();
    if reviewers.is_empty() {
        // Same engine revising its own draft, exactly as before cross-checking
        // existed. Still a full rewrite, still guarded.
        let revised = ask_ingest_once(prompt, claude_model, expect_json)?;
        return Ok(match revision_is_safe(draft, &revised) {
            (true, _) => revised,
            (false, why) => {
                crate::maplog::log("CRITIQUE REJECTED", &format!("kept the draft: {why}"));
                draft.to_string()
            }
        });
    }

    let mut current = draft.to_string();
    for round in 0..MAX_REVIEW_ROUNDS {
        // Each reviewer reads the CURRENT document independently and reports
        // separately. They are NOT shown each other's notes: the value of a
        // second opinion is that it was formed without the first one, and
        // pooling them would just let the loudest reading anchor the rest.
        let mut collected = String::new();
        for (i, reviewer) in reviewers.iter().enumerate() {
            // Lenses advance with the round, so a second pass looks somewhere
            // new rather than re-litigating the first — with two reviewers and
            // three lenses, two rounds cover all three.
            let (lens_name, lens) = REVIEW_LENSES[(round * reviewers.len() + i) % REVIEW_LENSES.len()];
            // Reasoning turned UP: this is the most analytically demanding call
            // in the pipeline and it used to run at each engine's default,
            // which for Codex meant none at all.
            let found = match ask_ingest_once_on(
                *reviewer,
                format!("{}{FINDINGS_ONLY_OVERRIDE}\n\n{lens}", with_document(&prompt, &current, round)),
                claude_model,
                false,
                // "high" is common to all three engines' scales. Claude also has
                // xhigh/max, but a review is a bounded read of one document, not
                // open-ended exploration.
                Some("high"),
            ) {
                Ok(f) => f.trim().to_string(),
                // One reviewer failing is not the pass failing — the others
                // still have something to say.
                Err(e) => {
                    crate::maplog::log("CROSS-CHECK reviewer failed", &format!("{}: {e}", reviewer.label()));
                    continue;
                }
            };
            if found.is_empty() || found.contains("NO-FINDINGS") {
                crate::maplog::log(
                    "CROSS-CHECK found nothing",
                    &format!("round {} — {} ({lens_name}) had no findings", round + 1, reviewer.label()),
                );
                continue;
            }
            crate::maplog::log(
                "CROSS-CHECK findings",
                &format!("round {} — {} on {lens_name} reported:\n{found}", round + 1, reviewer.label()),
            );
            // Attributed, because whose note it is carries information: two
            // reviewers independently flagging the same passage is a much
            // stronger signal than either one alone, and the author can only
            // see that if the notes stay separated.
            collected.push_str(&format!(
                "\n\n### Notes from {} (reviewing for {lens_name})\n{found}",
                reviewer.label()
            ));
        }
        if collected.trim().is_empty() {
            crate::maplog::log("CRITIQUE DONE", &format!("round {} found nothing; stopping", round + 1));
            break;
        }

        // Ask for EDITS, not a rewrite: everything the author does not name
        // survives byte-identical.
        let reply = ask_ingest_once(build_patch_prompt(&current, collected.trim()), claude_model, true)?;
        let edits: Vec<DocEdit> = serde_json::from_str::<serde_json::Value>(&extract_json_object(&reply))
            .ok()
            .and_then(|v| v.get("edits").cloned())
            .and_then(|e| serde_json::from_value(e).ok())
            .unwrap_or_default();
        if edits.is_empty() {
            crate::maplog::log(
                "CRITIQUE DONE",
                &format!("round {} — author judged no note worth acting on", round + 1),
            );
            break;
        }

        let (patched, applied, refused) = apply_doc_edits(&current, &edits);
        for r in &refused {
            // Never silent: a refused edit means a finding went unaddressed, and
            // that is invisible in the finished document.
            crate::maplog::log("CRITIQUE EDIT REFUSED", r);
        }
        crate::maplog::log(
            "CRITIQUE PATCHED",
            &format!(
                "round {}: {applied} of {} edit(s) applied, {} chars -> {} chars",
                round + 1,
                edits.len(),
                current.chars().count(),
                patched.chars().count()
            ),
        );
        if applied == 0 {
            break;
        }
        // The guard still runs, per round, against that round's input. With
        // patching it should never fire — which is the point of patching.
        match revision_is_safe(&current, &patched) {
            (true, _) => current = patched,
            (false, why) => {
                crate::maplog::log("CRITIQUE REJECTED", &format!("round {}: {why}", round + 1));
                break;
            }
        }
    }
    Ok(current)
}

/// Re-points a critique prompt at the document as it stands now.
///
/// The prompt was built around the original draft, so round two would otherwise
/// review a document that has already been fixed and re-report everything that
/// was just addressed. Appending the current text and saying which one counts is
/// enough, and avoids threading a builder through all three call sites.
fn with_document(prompt: &str, current: &str, round: usize) -> String {
    if round == 0 {
        return prompt.to_string();
    }
    format!(
        "{prompt}\n\n---\n\nIMPORTANT: the draft quoted above has since been revised in response to an \
        earlier review. Review THIS version instead — it is the current document, and the one your notes \
        must refer to. Points already addressed here are settled; do not raise them again.\n\n\
        Current document:\n{current}"
    )
}

/// The JSON object substring of a possibly-chatty reply (first `{` to last `}`),
/// so an answer still parses when the model wraps it in prose. Pure.
fn extract_json_object(s: &str) -> String {
    match (s.find('{'), s.rfind('}')) {
        (Some(a), Some(b)) if b > a => s[a..=b].to_string(),
        _ => s.to_string(),
    }
}

/// Same dispatch as `ask_ingest_once`, but forces `low` extended-thinking
/// effort on the Claude path — see build_claude_args's doc comment (dm.rs):
/// the live DM turn loop already forces `low` for ordinary turns, measured
/// to cut real wall-clock latency by roughly a quarter with no quality
/// regression even on nuanced judgment calls. Battle-map generation (its
/// only caller today) is a structural/spatial layout task, not a nuanced
/// judgment call, so it's at least as good a fit — and its prompts are much
/// bigger than an ordinary turn's, where default effort has more room to
/// spend minutes "thinking" before any output starts (live-measured: a
/// single map-spec call took 362s for 11552 chars in / 2161 chars out, a
/// ratio default effort's raw generation speed doesn't explain on its own).
/// Local path is identical to `ask_ingest_once` — effort is a Claude CLI
/// concept, meaningless to a local server.
pub fn ask_ingest_once_low_effort(prompt: String, claude_model: Option<&str>) -> Result<String, String> {
    ask_ingest_once_at_effort(prompt, claude_model, "low")
}

/// Same routing, caller-chosen reasoning depth.
///
/// Exists because not every cheap-looking classification deserves the cheapest
/// possible call. Biome classification reads like a one-word question and is
/// nothing of the sort: its answer picks the floor query, the liquid query and
/// the vegetation for an entire map, so it is worth a better model thinking
/// harder — see classify_biome, where one sonnet call at low effort returned
/// three different answers for the same spec across six runs.
///
/// A local-ingestion setup still goes to the local model. Someone who has
/// deliberately pointed everything at their own server should not have one
/// classification quietly reaching for a subscription instead.
pub fn ask_ingest_once_at_effort(
    prompt: String, claude_model: Option<&str>, effort: &str,
) -> Result<String, String> {
    let cfg = ingest_config().lock().unwrap().clone();
    if cfg.use_local {
        ask_ingest_once(prompt, claude_model, false)
    } else {
        crate::dm::ask_claude_once(prompt, claude_model, Some(effort))
    }
}

fn generate_session_id() -> String {
    format!("local-{:016x}", rand::thread_rng().gen::<u64>())
}

/// Local-LLM equivalent of dm.rs's ask_dm. Same DmReply shape, different
/// transport — see the module doc comment for the two things Claude Code
/// normally gives us for free that this has to do manually.
#[tauri::command]
pub async fn ask_dm_local(
    app: AppHandle,
    prompt: String,
    session_id: Option<String>,
    campaign_id: Option<String>,
    base_url: String,
    model: String,
    history_limit_turns: u32,
) -> Result<DmReply, String> {
    tokio::task::spawn_blocking(move || {
        let system_prompt = match &campaign_id {
            Some(id) => build_system_prompt_at(&campaign_dir(&app, id)?),
            None => LOCAL_OUTPUT_FORMAT_ADDENDUM.trim_start().to_string(),
        };

        let sid = session_id.unwrap_or_else(generate_session_id);
        let history = sessions().lock().unwrap().get(&sid).cloned().unwrap_or_default();

        let reply_text = call_local_llm(&base_url, &model, &system_prompt, &history, &prompt)?;

        let mut locked = sessions().lock().unwrap();
        let entry = locked.entry(sid.clone()).or_default();
        entry.push(ChatMessage { role: "user".into(), content: prompt });
        entry.push(ChatMessage { role: "assistant".into(), content: reply_text.clone() });
        trim_history(entry, history_limit_turns);
        drop(locked);

        Ok(DmReply { text: reply_text, session_id: Some(sid) })
    })
    .await
    .map_err(|e| format!("Local DM task failed: {e}"))?
}

/// Frees a session's in-memory history — called when a sitting ends, so
/// SESSIONS doesn't grow forever across many nights in one running app
/// instance. Harmless no-op if `session_id` isn't a local session (e.g. it
/// was actually a Claude session id).
#[tauri::command]
pub fn end_local_dm_session(session_id: String) {
    sessions().lock().unwrap().remove(&session_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The guard that stops a "critique" from replacing a good draft with a
    /// worse one. Every case here is drawn from the live A/B that motivated it:
    /// Claude drafted 3546 chars of specific, playable detail, Codex was handed
    /// the pen, and what came back was a 2141-char generic summary that had
    /// dropped a fact stated in the campaign intake — while the critique
    /// prompt's entire job was catching omissions.
    #[test]
    fn a_revision_that_summarizes_instead_of_fixing_is_rejected() {
        let draft = "# Frame\n- **Aldric Venn** keeps the ledgers and the secrets.\n\
                     - The party **owes a debt** to the guild, worked off job by job.\n\
                     - The mine flooded last winter and something came up with the water.\n\
                     - A drowned body in guild issue that nobody reported missing.";

        // Same substance, expanded — exactly what a gap-fill should look like.
        let good = format!("{draft}\n- Venn keeps a second ledger, and the debt is tracked as a number.");
        assert!(revision_is_safe(draft, &good).0);

        // The measured failure: two thirds the length, nothing added.
        let summary = "# Frame\n- The guild factor keeps records.\n- The mine flooded.";
        let (ok, why) = revision_is_safe(draft, summary);
        assert!(!ok, "a two-thirds-length rewrite must not replace the draft");
        assert!(why.contains("summary"), "{why}");

        // Long enough, but a named entity vanished.
        let padded = "# Frame\n- The guild factor keeps the ledgers and the secrets of this place.\n\
                      - The party owes money to the guild, worked off job by job over time.\n\
                      - The mine flooded last winter and something came up with the water here.\n\
                      - A drowned body in guild issue that nobody ever reported missing at all.";
        let (ok, why) = revision_is_safe(draft, padded);
        assert!(!ok, "dropping a named entity must not replace the draft");
        assert!(why.contains("Aldric Venn"), "{why}");

        assert!(!revision_is_safe(draft, "   ").0, "empty is never a revision");
    }

    /// Patching exists to give one guarantee a rewrite cannot: text nobody named
    /// comes out byte-identical. These cases are the ways that guarantee could
    /// be lost.
    #[test]
    fn a_patch_changes_only_what_it_names_and_refuses_anything_ambiguous() {
        let doc = "# Frame\n- **Aldric Venn** keeps the ledgers.\n- Track the debt as a number.\n- The moor is cold.\n- The moor is cold.";

        // A clean, unique edit lands and leaves everything else untouched.
        let (out, applied, refused) = apply_doc_edits(
            doc,
            &[DocEdit {
                find: "- Track the debt as a number.".into(),
                replace: "- Track the debt as a number: they owe 800 gp, wages run 1 gp/day.".into(),
            }],
        );
        assert_eq!((applied, refused.len()), (1, 0));
        assert!(out.contains("800 gp"));
        assert!(out.contains("**Aldric Venn** keeps the ledgers."), "untouched text must survive verbatim");

        // A phrase appearing twice is ambiguous — guessing which one was meant is
        // how a patch silently corrupts a document.
        let (out, applied, refused) = apply_doc_edits(
            doc,
            &[DocEdit { find: "- The moor is cold.".into(), replace: "- The moor is wrong.".into() }],
        );
        assert_eq!(applied, 0);
        assert!(refused[0].contains("matches 2 places"), "{:?}", refused);
        assert_eq!(out, doc, "a refused edit must change nothing");

        // Text the model hallucinated is refused, not fuzzily matched.
        let (_, applied, refused) = apply_doc_edits(
            doc,
            &[DocEdit { find: "- Venn keeps the ledgers.".into(), replace: "x".into() }],
        );
        assert_eq!(applied, 0);
        assert!(refused[0].contains("not in the document"), "{:?}", refused);

        // Insertion is the same operation: echo an anchor, append after it.
        let (out, applied, _) = apply_doc_edits(
            doc,
            &[DocEdit {
                find: "# Frame".into(),
                replace: "# Frame\n- **The party:** Thorin and Mira.".into(),
            }],
        );
        assert_eq!(applied, 1);
        assert!(out.contains("**The party:** Thorin and Mira."));

        // Deletion, and a partial batch: good edits land, bad ones are reported.
        let (out, applied, refused) = apply_doc_edits(
            doc,
            &[
                DocEdit { find: "- **Aldric Venn** keeps the ledgers.\n".into(), replace: String::new() },
                DocEdit { find: "nonexistent".into(), replace: "y".into() },
                DocEdit { find: String::new(), replace: "z".into() },
            ],
        );
        assert_eq!(applied, 1);
        assert_eq!(refused.len(), 2);
        assert!(!out.contains("Aldric Venn"));
        assert!(refused[1].contains("empty `find`"), "{:?}", refused);
    }

    /// Two rounds, and only two. An open loop on a document with no objective
    /// finish line thrashes; one round misses the follow-on problems that the
    /// first round's own answers create.
    #[test]
    fn review_rounds_are_capped_and_rotate_the_lens() {
        assert_eq!(MAX_REVIEW_ROUNDS, 2);
        // With two reviewers, two rounds must cover all three lenses rather than
        // asking the same two questions twice.
        let used: Vec<&str> = (0..MAX_REVIEW_ROUNDS)
            .flat_map(|round| (0..2).map(move |i| REVIEW_LENSES[(round * 2 + i) % REVIEW_LENSES.len()].0))
            .collect();
        assert_eq!(used, vec!["coverage", "usability at the table", "internal consistency", "coverage"]);

        // Round 2 must re-point the reviewer at the PATCHED document, or it
        // re-reports everything the first round just fixed.
        let r0 = with_document("orig prompt", "patched doc", 0);
        assert_eq!(r0, "orig prompt", "round 1 reviews the draft the prompt already quotes");
        let r1 = with_document("orig prompt", "patched doc", 1);
        assert!(r1.contains("patched doc") && r1.contains("Review THIS version"), "{r1}");
    }

    /// A lapsed sign-in has to be recognised from an engine's error text, so
    /// ingestion can finish the work somewhere else instead of silently dropping
    /// it. Inputs are verbatim: agy's banner, and Codex's `login status` line.
    #[test]
    fn a_lapsed_sign_in_is_recognised_and_kept_apart_from_a_real_failure() {
        assert!(looks_signed_out(
            "Authentication required. Please visit the URL to log in:\n  https://accounts.google.com/o/oauth2/auth?..."
        ));
        assert!(looks_signed_out("Error: authentication interrupted"));
        assert!(looks_signed_out("Not logged in"));
        assert!(looks_signed_out("HTTP 401 Unauthorized"));
        assert!(looks_signed_out("invalid_grant: Token has been expired or revoked."));

        // Real failures must NOT be read as a sign-in problem — failing over on
        // these would just repeat a genuine error on a second engine and burn
        // quota doing it.
        assert!(!looks_signed_out("Codex returned nothing usable."));
        assert!(!looks_signed_out("error: unexpected argument '--sandbox' found"));
        assert!(!looks_signed_out("Error: empty prompt. Usage: agy --print \"your prompt here\""));
        assert!(!looks_signed_out(""));

        // Quota and sign-in are different conditions; only one of them means the
        // cached "signed in" answer has to be thrown away.
        assert!(looks_rate_limited("429 rate limit exceeded") && !looks_signed_out("429 rate limit exceeded"));
    }

    /// The settings panel has always offered several reviewers; the backend
    /// held one and the frontend sent `.find(...)`, so ticking Codex AND Gemini
    /// consulted exactly one of them. Whatever is ticked must arrive intact,
    /// minus the primary — a model reviewing its own draft is not a check.
    #[test]
    fn every_ticked_reviewer_is_kept_except_the_one_that_wrote_the_draft() {
        use crate::cli_provider::CliEngine;

        set_ingestion_engine("claude".into(), Some(vec!["codex".into(), "gemini".into()]));
        assert_eq!(ingestion_reviewers(), vec![CliEngine::Codex, CliEngine::Gemini]);
        // The single-reviewer paths (failover, tile picks) take the first.
        assert_eq!(ingestion_reviewer(), Some(CliEngine::Codex));

        // The primary is dropped even when ticked, and duplicates collapse.
        set_ingestion_engine("codex".into(), Some(vec!["codex".into(), "claude".into(), "claude".into()]));
        assert_eq!(ingestion_reviewers(), vec![CliEngine::Claude]);

        // Nothing ticked means the drafting engine revises its own work, which
        // is what happened before cross-checking existed.
        set_ingestion_engine("claude".into(), None);
        assert!(ingestion_reviewers().is_empty());
        assert_eq!(ingestion_reviewer(), None);
    }

    /// Only actual NAMES count as must-keep — a rewrite is free to drop a
    /// `**Setting:**` style field label or re-word a bolded sentence.
    #[test]
    fn bold_names_picks_out_names_and_ignores_field_labels() {
        let names = bold_names(
            "**Setting:** Harrowfen\n**Aldric Venn** is the factor.\n**the guild** runs it.\n\
             **This is a whole bolded sentence that goes on well past being a name.**",
        );
        assert_eq!(names, vec!["Aldric Venn".to_string()]);
    }

    /// This predicate decides whether a stalled session RECOVERS on another
    /// engine or just stops. Being broad is deliberate: a false positive costs
    /// one wasted retry, a false negative ends the game night.
    #[test]
    fn rate_limit_detection_covers_how_each_vendor_words_it() {
        for hit in [
            "Error: rate limit exceeded, try again later",
            "429 Too Many Requests",
            "You have exceeded your quota for this model",
            "RESOURCE_EXHAUSTED: usage limit reached",
            "The service is temporarily unavailable",
            "Model overloaded, please retry",
            "Rate-Limit reached",
        ] {
            assert!(looks_rate_limited(hit), "should have matched: {hit}");
        }
        // Real failures must NOT look like quota, or a genuine bug gets
        // silently retried on a second engine and reported as that one's fault.
        for miss in [
            "Couldn't start Codex: program not found",
            "That map has no grid to read positions against.",
            "authentication failed or timed out",
            "invalid JSON in reply",
            "",
        ] {
            assert!(!looks_rate_limited(miss), "should NOT have matched: {miss}");
        }
    }
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    struct Scratch(PathBuf);
    impl Scratch {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "local-llm-test-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// The brief is ~39K resolved and `exec resume`/`--conversation` replay the
    /// whole thread, so re-sending it every turn would stack a copy per turn. But
    /// skipping it when the campaign HAS changed loses the one property Claude
    /// gets free by re-reading CLAUDE.md: a chapter advance reaching the DM on the
    /// very next turn. Both halves are sabotage-checked below.
    #[test]
    fn the_cli_brief_is_sent_once_per_thread_and_again_whenever_the_campaign_changes() {
        let root = Scratch::new("cli-ctx");
        std::fs::write(root.0.join("memory.md"), "Chapter 1: the marsh.").unwrap();
        std::fs::write(root.0.join("CLAUDE.md"), "You are the DM.\n@memory.md").unwrap();

        // A fresh thread always gets it, and it really does carry the import.
        let first = cli_project_context(&root.0, false).expect("a fresh thread gets the brief");
        assert!(first.contains("You are the DM."));
        assert!(first.contains("Chapter 1: the marsh."), "the @import must be inlined");
        assert!(first.contains("END of standing instructions"), "needs a boundary the model can see");

        // Same thread, nothing changed → not resent.
        assert_eq!(cli_project_context(&root.0, true), None);

        // A chapter advance rewrites an import; the next turn must see it.
        std::fs::write(root.0.join("memory.md"), "Chapter 2: the barrow.").unwrap();
        let after = cli_project_context(&root.0, true).expect("a changed campaign resends");
        assert!(after.contains("Chapter 2: the barrow."));
        assert_eq!(cli_project_context(&root.0, true), None, "and then settles again");

        // A NEW thread on the same campaign gets it even though nothing changed —
        // the new conversation has no history to have seen it in.
        assert!(cli_project_context(&root.0, false).is_some());

        // No CLAUDE.md at all (a campaign folder that predates it) → nothing to
        // send, and no empty header block pretending to be a brief.
        let bare = Scratch::new("cli-ctx-bare");
        assert_eq!(cli_project_context(&bare.0, false), None);
    }

    #[test]
    fn resolve_claude_md_imports_inlines_present_files() {
        let root = Scratch::new("present");
        std::fs::write(root.0.join("memory.md"), "Gundren was captured.").unwrap();
        let claude_md = "Persona text.\n@memory.md\nMore text.";
        let resolved = resolve_claude_md_imports(&root.0, claude_md);
        assert!(resolved.contains("Persona text."));
        assert!(resolved.contains("Gundren was captured."));
        assert!(resolved.contains("More text."));
        assert!(!resolved.contains("@memory.md"));
    }

    #[test]
    fn resolve_claude_md_imports_tolerates_missing_files() {
        let root = Scratch::new("missing");
        let claude_md = "Persona text.\n@module/current.md";
        let resolved = resolve_claude_md_imports(&root.0, claude_md);
        assert!(resolved.contains("Persona text."));
        // missing file resolves to empty content, not an error/panic
    }

    #[test]
    fn truncate_import_for_local_leaves_normal_sized_imports_untouched() {
        let small = "- **Gundren:** A dwarf merchant.";
        assert_eq!(truncate_import_for_local(small), small);
    }

    #[test]
    fn truncate_import_for_local_caps_an_oversized_chapter_and_says_so() {
        let huge = "x".repeat(LOCAL_MAX_IMPORT_CHARS + 5_000);
        let capped = truncate_import_for_local(&huge);
        assert!(capped.chars().count() < huge.chars().count(), "must actually shrink");
        assert!(capped.starts_with("xxxx"), "keeps the head of the chapter");
        assert!(capped.contains("cut short"), "the model must be told the section is incomplete");
        assert!(
            capped.to_lowercase().contains("don't state or imply that nothing further exists"),
            "and told not to narrate the truncation as if the content simply ended"
        );
    }

    #[test]
    fn truncate_import_for_local_never_splits_a_multibyte_char() {
        // A naive byte-slice cap would panic here; chars().take() must not.
        let huge = "é".repeat(LOCAL_MAX_IMPORT_CHARS + 100);
        let capped = truncate_import_for_local(&huge);
        assert!(capped.starts_with('é'));
    }

    #[test]
    fn a_giant_chapter_is_capped_while_the_rules_and_registries_survive_intact() {
        // The whole point of a PER-IMPORT cap: bound the one import that can be
        // huge (the chapter) without touching the small ones — and never touch
        // the critical reminders / output contract appended after them.
        let root = Scratch::new("big-chapter");
        std::fs::create_dir_all(root.0.join("memory")).unwrap();
        std::fs::create_dir_all(root.0.join("active_module")).unwrap();
        std::fs::write(root.0.join("memory").join("entities.md"), "- **Gundren:** A dwarf merchant.").unwrap();
        std::fs::write(root.0.join("memory").join("dm_rules.md"), "NEVER invent a rescue.").unwrap();
        std::fs::write(
            root.0.join("active_module").join("current.md"),
            "CHAPTER START. ".to_string() + &"filler. ".repeat(LOCAL_MAX_IMPORT_CHARS),
        )
        .unwrap();
        // dm_rules is imported AFTER the chapter, exactly as the real CLAUDE.md
        // orders them — a naive tail-trim of the finished prompt would eat it.
        std::fs::write(
            root.0.join("CLAUDE.md"),
            "You are the DM.\n@memory/entities.md\n@active_module/current.md\n@memory/dm_rules.md\n",
        )
        .unwrap();

        let prompt = build_system_prompt_at(&root.0);
        assert!(prompt.contains("CHAPTER START."), "the chapter's head is kept");
        assert!(prompt.contains("cut short"), "the oversized chapter is capped");
        assert!(prompt.contains("- **Gundren:** A dwarf merchant."), "a small registry import survives whole");
        assert!(prompt.contains("NEVER invent a rescue."), "the rules import AFTER the chapter must survive");
        assert!(prompt.contains("Critical reminders"), "LOCAL_CRITICAL_REMINDERS always survives");
        assert!(prompt.contains("Output format"), "the reply contract always survives");
    }

    #[test]
    fn build_request_disables_qwen3_thinking_mode() {
        let req = build_request("test-model", "sys prompt", &[], "hi");
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["chat_template_kwargs"]["enable_thinking"], false);
    }

    #[test]
    fn build_request_includes_system_history_and_new_user_message() {
        let history = vec![ChatMessage { role: "user".into(), content: "hi".into() }];
        let req = build_request("test-model", "sys prompt", &history, "new message");
        assert_eq!(req.messages.len(), 3);
        assert_eq!(req.messages[0].role, "system");
        assert_eq!(req.messages[1].content, "hi");
        assert_eq!(req.messages[2].content, "new message");
    }

    /// Proves the IPv4 fallback against a REAL server, which is the only way to
    /// show it works: on this machine `http://localhost:8000` is genuinely
    /// unreachable (WSL2 forwards IPv4 only; Windows resolves `localhost` to
    /// ::1 first and the connection is refused), while `http://127.0.0.1:8000`
    /// answers instantly. So this test passing means the fallback fired — before
    /// it existed, this exact call is what made the DM turn hang forever.
    /// Needs a local server on :8000. Run with:
    ///   cargo test --lib -- --ignored --nocapture localhost_ipv4_fallback_reaches_a_real_server
    #[test]
    #[ignore]
    fn localhost_reaches_a_real_wsl_hosted_server() {
        let models = fetch_local_models("http://localhost:8000")
            .expect("a WSL-hosted server should be reachable over localhost");
        println!("models: {models:?}");
        assert!(!models.is_empty(), "server answered but listed no models");
    }

    #[test]
    fn candidate_base_urls_probes_ipv4_before_localhost() {
        // The WSL2 trap: WSL forwards ports on IPv4 only (127.0.0.1), but Windows
        // resolves `localhost` to ::1 (IPv6) first. Rust DOES fall through to
        // IPv4 on its own, so this is a ~2s-vs-2ms latency problem, not a
        // reachability one (see candidate_base_urls). Hence IPv4 first, with the
        // configured address kept as the fallback.
        assert_eq!(
            candidate_base_urls("http://localhost:8000"),
            vec!["http://127.0.0.1:8000".to_string(), "http://localhost:8000".to_string()]
        );
    }

    #[test]
    fn candidate_base_urls_leaves_explicit_ips_and_real_hosts_alone() {
        // Nothing to reorder — don't invent a second attempt.
        assert_eq!(candidate_base_urls("http://127.0.0.1:8000"), vec!["http://127.0.0.1:8000".to_string()]);
        assert_eq!(candidate_base_urls("http://192.168.1.50:11434"), vec!["http://192.168.1.50:11434".to_string()]);
        assert_eq!(candidate_base_urls("http://my-server.lan:8000"), vec!["http://my-server.lan:8000".to_string()]);
    }

    #[test]
    fn candidate_base_urls_normalizes_whitespace_and_a_trailing_slash() {
        assert_eq!(
            candidate_base_urls("  http://localhost:11434/  "),
            vec!["http://127.0.0.1:11434".to_string(), "http://localhost:11434".to_string()]
        );
    }

    // The memo below is process-global, so each test uses its own port to stay
    // independent of whatever else is running in parallel.

    #[test]
    fn ordered_candidates_probes_ipv4_first_until_told_otherwise() {
        assert_eq!(
            ordered_candidates("http://localhost:18001"),
            vec!["http://127.0.0.1:18001".to_string(), "http://localhost:18001".to_string()]
        );
    }

    #[test]
    fn ordered_candidates_puts_the_address_that_last_connected_first() {
        // IPv4-first is right for a WSL-hosted server, but it's still a guess. A
        // server bound to IPv6 ONLY answers on `localhost` and refuses
        // 127.0.0.1 — without this it would re-probe the dead address forever.
        remember_working_base_url("http://localhost:18002", "http://localhost:18002");
        assert_eq!(
            ordered_candidates("http://localhost:18002"),
            vec!["http://localhost:18002".to_string(), "http://127.0.0.1:18002".to_string()],
            "whichever address actually connected should be tried first next time"
        );
    }

    #[test]
    fn forgetting_a_stale_address_restores_the_default_probe_order() {
        // A server that moves (or was never really there) must not leave us
        // permanently starting from a dead address.
        remember_working_base_url("http://localhost:18003", "http://localhost:18003");
        forget_working_base_url("http://localhost:18003");
        assert_eq!(
            ordered_candidates("http://localhost:18003"),
            vec!["http://127.0.0.1:18003".to_string(), "http://localhost:18003".to_string()]
        );
    }

    #[test]
    fn the_memo_is_keyed_the_same_way_regardless_of_whitespace_or_trailing_slash() {
        remember_working_base_url("http://localhost:18004/", "http://localhost:18004");
        assert_eq!(
            ordered_candidates("  http://localhost:18004  "),
            vec!["http://localhost:18004".to_string(), "http://127.0.0.1:18004".to_string()]
        );
    }

    /// The regression guard for the actual bug, measured against a REAL server
    /// rather than asserted. `http://localhost:8000` always *worked* — Rust falls
    /// through to IPv4 by itself — but it cost ~2031 ms doing it, versus 1.9 ms
    /// for `http://127.0.0.1:8000`, because Windows takes ~2s to refuse the `::1`
    /// connect first. Paid once per DM turn and once per CHUNK during ingestion.
    /// If someone ever re-orders candidate_base_urls back to configured-first,
    /// this is what catches it.
    /// Needs a local server on :8000. Run with:
    ///   cargo test --lib -- --ignored --nocapture reaching_a_wsl_server_over_localhost_is_fast
    #[test]
    #[ignore]
    fn reaching_a_wsl_server_over_localhost_is_fast() {
        forget_working_base_url("http://localhost:8000");

        let t = Instant::now();
        fetch_local_models("http://localhost:8000").expect("server should be reachable");
        let elapsed = t.elapsed();

        println!("localhost:8000 via candidate ordering: {elapsed:?}");
        assert!(
            elapsed < Duration::from_millis(500),
            "reaching the server over `localhost` took {elapsed:?} — the doomed ~2s ::1 probe is back"
        );
    }

    #[test]
    fn build_oneshot_request_sends_one_user_message_and_disables_thinking() {
        let req = build_oneshot_request("m", "do the thing", false);
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["messages"].as_array().unwrap().len(), 1);
        assert_eq!(json["messages"][0]["role"], "user");
        assert_eq!(json["messages"][0]["content"], "do the thing");
        assert_eq!(json["chat_template_kwargs"]["enable_thinking"], false);
    }

    #[test]
    fn build_oneshot_request_omits_response_format_unless_json_expected() {
        // Text prompts (plans, inventories) must NOT carry json_object mode —
        // it would force the markdown reply into JSON and break it.
        let text = serde_json::to_value(build_oneshot_request("m", "write markdown", false)).unwrap();
        assert!(text.get("response_format").is_none(), "text prompts must omit response_format entirely");

        let json = serde_json::to_value(build_oneshot_request("m", "return json", true)).unwrap();
        assert_eq!(json["response_format"]["type"], "json_object");
    }

    #[test]
    fn ask_ingest_once_errors_clearly_when_local_selected_but_unconfigured() {
        // The one test that mutates the process-global ingest config; sets it
        // explicitly (never relies on the default) and restores it after.
        set_ingestion_provider(true, "  ".into(), "".into());
        let err = ask_ingest_once("prompt".into(), Some("opus"), false).unwrap_err();
        assert!(err.to_lowercase().contains("isn't configured"), "got: {err}");
        set_ingestion_provider(false, String::new(), String::new()); // restore default
    }

    #[test]
    fn parse_local_reply_handles_valid_json() {
        let (narration, actions) = parse_local_reply(r#"{"narration":"You see a goblin.","actions":{"damage":[{"name":"Thorin","amount":5}]}}"#);
        assert_eq!(narration, "You see a goblin.");
        assert!(actions.is_some());
    }

    #[test]
    fn parse_local_reply_handles_null_actions() {
        let (narration, actions) = parse_local_reply(r#"{"narration":"Nothing happens.","actions":null}"#);
        assert_eq!(narration, "Nothing happens.");
        assert!(actions.is_none());
    }

    #[test]
    fn parse_local_reply_falls_back_to_raw_text_on_malformed_json() {
        let (narration, actions) = parse_local_reply("The goblin attacks! not valid json at all");
        assert_eq!(narration, "The goblin attacks! not valid json at all");
        assert!(actions.is_none());
    }

    #[test]
    fn parse_local_reply_falls_back_when_narration_missing() {
        let (narration, actions) = parse_local_reply(r#"{"actions":{"damage":[]}}"#);
        assert!(narration.contains("actions"));
        assert!(actions.is_none());
    }

    #[test]
    fn format_as_dm_reply_text_includes_fenced_block_when_actions_present() {
        let actions = serde_json::json!({"damage":[{"name":"Thorin","amount":5}]});
        let text = format_as_dm_reply_text("You take damage.", Some(&actions));
        assert!(text.starts_with("You take damage."));
        assert!(text.contains("```dm-actions"));
        assert!(text.contains("\"amount\":5"));
    }

    #[test]
    fn format_as_dm_reply_text_omits_block_when_actions_absent() {
        let text = format_as_dm_reply_text("Nothing happens.", None);
        assert_eq!(text, "Nothing happens.");
    }

    #[test]
    fn parse_models_response_extracts_ids_in_order() {
        let body = r#"{"data":[{"id":"llama3:latest","object":"model"},{"id":"gemma4:latest","object":"model"}]}"#;
        let models = parse_models_response(body).unwrap();
        assert_eq!(models, vec!["llama3:latest", "gemma4:latest"]);
    }

    #[test]
    fn parse_models_response_tolerates_an_empty_list() {
        let models = parse_models_response(r#"{"data":[]}"#).unwrap();
        assert!(models.is_empty());
    }

    #[test]
    fn parse_models_response_rejects_malformed_json() {
        assert!(parse_models_response("not json at all").is_err());
    }

    fn msg(content: &str) -> ChatMessage {
        ChatMessage { role: "user".into(), content: content.into() }
    }

    #[test]
    fn trim_history_drops_oldest_pairs_beyond_the_limit() {
        let mut history = vec![msg("1"), msg("1r"), msg("2"), msg("2r"), msg("3"), msg("3r")];
        trim_history(&mut history, 2);
        assert_eq!(history.len(), 4);
        assert_eq!(history[0].content, "2");
    }

    #[test]
    fn trim_history_is_a_noop_when_already_under_the_limit() {
        let mut history = vec![msg("1"), msg("1r")];
        trim_history(&mut history, 5);
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].content, "1");
    }

    #[test]
    fn trim_history_with_zero_limit_clears_everything() {
        let mut history = vec![msg("1"), msg("1r")];
        trim_history(&mut history, 0);
        assert!(history.is_empty());
    }
}
