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
    let url = format!("{}/v1/models", base_url.trim_end_matches('/'));
    let resp = ureq::get(&url)
        .call()
        .map_err(|e| format!("Couldn't reach the local model server at {url}: {e}"))?;
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
    let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
    let body = build_request(model, system_prompt, history, user_prompt);

    let resp = match ureq::post(&url).send_json(&body) {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => {
            let text = r.into_string().unwrap_or_default();
            return Err(format!("Local model server returned {code}: {text}"));
        }
        Err(e) => return Err(format!("Couldn't reach the local model server at {url}: {e}")),
    };

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
    *ingest_config().lock().unwrap() = IngestConfig { use_local, base_url, model };
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
    let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));
    let body = build_oneshot_request(model, prompt, expect_json);
    let resp = match ureq::post(&url).send_json(&body) {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => {
            let text = r.into_string().unwrap_or_default();
            return Err(format!("Local model server returned {code}: {text}"));
        }
        Err(e) => return Err(format!("Couldn't reach the local model server at {url}: {e}")),
    };
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
pub fn ask_ingest_once(prompt: String, claude_model: Option<&str>, expect_json: bool) -> Result<String, String> {
    let cfg = ingest_config().lock().unwrap().clone();
    if cfg.use_local {
        if cfg.base_url.trim().is_empty() || cfg.model.trim().is_empty() {
            return Err("Local ingestion is selected but its server address/model isn't configured (open DM Model settings).".into());
        }
        ask_local_once(&cfg.base_url, &cfg.model, &prompt, expect_json)
    } else {
        crate::dm::ask_claude_once(prompt, claude_model)
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
    use std::path::PathBuf;

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
