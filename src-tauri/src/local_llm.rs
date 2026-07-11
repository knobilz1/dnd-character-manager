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

/// Resolves a CLAUDE.md's `@relative/path` import lines against files in
/// `dir`, inlining each referenced file's content in place. Generic — works
/// for whatever imports actually exist (memory/MEMORY.md, module/index.md,
/// module/current.md today), not hardcoded to that specific set.
fn resolve_claude_md_imports(dir: &Path, claude_md: &str) -> String {
    claude_md
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            if let Some(rel_path) = trimmed.strip_prefix('@') {
                read_optional(&dir.join(rel_path))
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Builds the full system prompt a local LLM needs, since it gets none of
/// Claude Code's automatic CLAUDE.md/@import loading.
fn build_system_prompt_at(dir: &Path) -> String {
    let claude_md = read_optional(&dir.join("CLAUDE.md"));
    let resolved = resolve_claude_md_imports(dir, &claude_md);
    format!("{resolved}{LOCAL_OUTPUT_FORMAT_ADDENDUM}")
}

#[derive(Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    kind: String,
}

#[derive(Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    response_format: ResponseFormat,
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
    fn build_request_includes_system_history_and_new_user_message() {
        let history = vec![ChatMessage { role: "user".into(), content: "hi".into() }];
        let req = build_request("test-model", "sys prompt", &history, "new message");
        assert_eq!(req.messages.len(), 3);
        assert_eq!(req.messages[0].role, "system");
        assert_eq!(req.messages[1].content, "hi");
        assert_eq!(req.messages[2].content, "new message");
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
}
