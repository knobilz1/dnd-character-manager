//! party_listener.rs — LAN receiver for the DM console.
//!
//! Tavern Sheet has no shared backend: every player's characters live only in
//! their own device's localStorage. So when the DM opens the DM Console, this
//! module binds a small HTTP listener (hand-rolled, same style as oauth.rs's
//! callback server) that other players' Tavern Sheet apps POST their character
//! JSON to (via the existing "Send to DM" button / src/utils/dmConnect.ts).
//! Each received character is emitted as a `dm-party-character` event for the
//! frontend's DM Console to pick up — it is NOT written into the DM's own
//! useLibraryStore (that would mix other players' characters into the DM's
//! personal library).
//!
//! The listener binds once per app run and is left open for the app's lifetime
//! (idempotent start — calling it again just returns the already-bound port).

use rand::Rng;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static LISTENER_PORT: OnceLock<u16> = OnceLock::new();

/// How many recent narration lines are kept for late-joining/reconnecting
/// player devices to catch up on — not a full session transcript (that
/// already lives in the campaign's own memory files on the DM's machine),
/// just enough recent history that a poll landing right after a burst of
/// narration doesn't miss anything a player would reasonably expect to
/// still be able to scroll back to.
const NARRATION_LOG_CAPACITY: usize = 50;

#[derive(Clone, serde::Serialize)]
struct NarrationEntry {
    seq: u64,
    text: String,
}

struct NarrationLog {
    entries: std::collections::VecDeque<NarrationEntry>,
    next_seq: u64,
}

/// Every line of narration the DM has spoken this run (bounded, oldest
/// dropped first) — see the "Let every connected player see the DM's own
/// narration" section below for why this exists: previously only the one
/// player device that actually sent a `/talk` line ever saw the DM's reply
/// (as that request's own HTTP response body); everyone else at the table
/// had no way to follow along except by being physically able to hear the
/// DM's machine. Player devices poll `GET /narration?since=<seq>` (see
/// dmConnect.ts's fetchNarrationSince) the same way they already poll `GET
/// /` for reachability.
fn narration_log() -> &'static Mutex<NarrationLog> {
    static LOG: OnceLock<Mutex<NarrationLog>> = OnceLock::new();
    LOG.get_or_init(|| Mutex::new(NarrationLog { entries: std::collections::VecDeque::new(), next_seq: 1 }))
}

/// How long a `/talk` request blocks waiting for the DM Console to actually
/// process that line and call `respond_to_player_turn` — generous since a
/// turn can be queued behind others, but still a hard ceiling so a player's
/// device never hangs forever if the DM Console is closed mid-turn.
const TALK_REPLY_TIMEOUT: Duration = Duration::from_secs(120);

/// One entry per in-flight `/talk` request, keyed by a request id handed to
/// the frontend in the `dm-player-turn` event payload. The connection thread
/// blocks on the receiving half (see `handle_conn`) until DMConsolePage.tsx
/// finishes that turn and calls `respond_to_player_turn` with the DM's actual
/// reply text — turning what used to be a fire-and-forget "delivered" ack
/// into the player's device actually seeing what the DM said, over the same
/// one-way connection that already exists (no new reverse channel needed).
fn pending_talk_replies() -> &'static Mutex<HashMap<String, mpsc::Sender<String>>> {
    static PENDING: OnceLock<Mutex<HashMap<String, mpsc::Sender<String>>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Pure: appends a line to the log, evicting the oldest entry once past
/// NARRATION_LOG_CAPACITY, and returns the seq number just assigned.
fn append_narration(log: &mut NarrationLog, text: String) -> u64 {
    let seq = log.next_seq;
    log.next_seq += 1;
    log.entries.push_back(NarrationEntry { seq, text });
    while log.entries.len() > NARRATION_LOG_CAPACITY {
        log.entries.pop_front();
    }
    seq
}

/// Pure: every entry strictly newer than `since` (0 = everything currently
/// buffered), oldest first.
fn entries_since(entries: &std::collections::VecDeque<NarrationEntry>, since: u64) -> Vec<NarrationEntry> {
    entries.iter().filter(|e| e.seq > since).cloned().collect()
}

/// Pure: pulls the `since` query parameter's value out of an HTTP request
/// line like `"GET /narration?since=12 HTTP/1.1"` — 0 (meaning "everything
/// currently buffered") when absent, malformed, or the whole GET is to a
/// different path entirely.
fn parse_since_param(request_line: &str) -> u64 {
    let Some(path_and_query) = request_line.split_whitespace().nth(1) else { return 0 };
    let Some((_, query)) = path_and_query.split_once('?') else { return 0 };
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix("since="))
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

fn write_response(stream: &mut TcpStream, status: u16, body: &str, content_type: &str) {
    let status_text = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        _ => "OK",
    };
    let resp = format!(
        "HTTP/1.1 {status} {status_text}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {len}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type\r\n\
         Connection: close\r\n\r\n{body}",
        len = body.len(),
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

fn handle_conn(mut stream: TcpStream, app: &AppHandle) {
    let mut reader = match stream.try_clone() {
        Ok(s) => BufReader::new(s),
        Err(_) => return,
    };

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).unwrap_or(0) == 0 {
        return;
    }

    let mut content_length: usize = 0;
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim_end();
                if trimmed.is_empty() {
                    break; // end of headers
                }
                if let Some(v) = trimmed.split_once(':') {
                    if v.0.eq_ignore_ascii_case("content-length") {
                        content_length = v.1.trim().parse().unwrap_or(0);
                    }
                }
            }
            Err(_) => break,
        }
    }

    if request_line.starts_with("OPTIONS") {
        return write_response(&mut stream, 204, "", "text/plain");
    }
    if request_line.starts_with("GET /narration") {
        let since = parse_since_param(&request_line);
        let log = narration_log().lock().unwrap();
        let entries = entries_since(&log.entries, since);
        let latest = log.entries.back().map(|e| e.seq).unwrap_or(since);
        drop(log);
        let body = serde_json::json!({ "entries": entries, "latest": latest }).to_string();
        return write_response(&mut stream, 200, &body, "application/json");
    }
    if request_line.starts_with("GET") {
        // Doubles as a reachability check — player devices poll this to decide
        // whether to show their "Talk to DM" button.
        return write_response(&mut stream, 200, "dnd-dm listening.\n", "text/plain");
    }

    let mut body = vec![0u8; content_length];
    if content_length > 0 && reader.read_exact(&mut body).is_err() {
        return write_response(
            &mut stream,
            400,
            "{\"ok\":false,\"error\":\"failed reading body\"}",
            "application/json",
        );
    }
    let body_str = String::from_utf8_lossy(&body);

    if request_line.starts_with("POST /character") {
        let parsed: serde_json::Value = match serde_json::from_str(&body_str) {
            Ok(v) => v,
            Err(e) => {
                return write_response(
                    &mut stream,
                    400,
                    &format!("{{\"ok\":false,\"error\":\"{e}\"}}"),
                    "application/json",
                );
            }
        };

        // Accept either the {tavernSheet, character} export envelope or a raw character.
        let character = if parsed.get("tavernSheet").and_then(|v| v.as_bool()) == Some(true) {
            parsed.get("character").cloned().unwrap_or(parsed.clone())
        } else {
            parsed
        };

        let name = character.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if name.is_empty() || character.get("classes").is_none() {
            return write_response(
                &mut stream,
                400,
                "{\"ok\":false,\"error\":\"not a valid character (missing name/classes)\"}",
                "application/json",
            );
        }

        let _ = app.emit("dm-party-character", character.clone());
        return write_response(
            &mut stream,
            200,
            &format!("{{\"ok\":true,\"name\":\"{name}\"}}"),
            "application/json",
        );
    }

    if request_line.starts_with("POST /talk") {
        let parsed: serde_json::Value = match serde_json::from_str(&body_str) {
            Ok(v) => v,
            Err(e) => {
                return write_response(
                    &mut stream,
                    400,
                    &format!("{{\"ok\":false,\"error\":\"{e}\"}}"),
                    "application/json",
                );
            }
        };

        let name = parsed.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let text = parsed.get("text").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if text.trim().is_empty() {
            return write_response(
                &mut stream,
                400,
                "{\"ok\":false,\"error\":\"empty text\"}",
                "application/json",
            );
        }

        // Picked up by the DM Console's turn queue (DMConsolePage.tsx) so a
        // player's own device can push a spoken line without ever running the
        // DM Console UI itself. Blocks this connection's own thread (each
        // connection already gets its own, see start_party_listener) until
        // that turn actually resolves, so the HTTP response can carry back
        // the DM's real reply instead of just an immediate "received" ack.
        let request_id = format!("talk-{:016x}", rand::thread_rng().gen::<u64>());
        let (tx, rx) = mpsc::channel::<String>();
        pending_talk_replies().lock().unwrap().insert(request_id.clone(), tx);

        let _ = app.emit(
            "dm-player-turn",
            serde_json::json!({ "name": name, "text": text, "requestId": request_id }),
        );

        let reply = match rx.recv_timeout(TALK_REPLY_TIMEOUT) {
            Ok(reply) => Some(reply),
            Err(_) => {
                pending_talk_replies().lock().unwrap().remove(&request_id);
                None
            }
        };
        let body = serde_json::json!({ "ok": true, "reply": reply }).to_string();
        return write_response(&mut stream, 200, &body, "application/json");
    }

    write_response(&mut stream, 404, "not found", "text/plain");
}

/// Starts the party listener on the given port (idempotent — a second call
/// while already running just returns the bound port without rebinding).
#[tauri::command]
pub fn start_party_listener(app: AppHandle, port: u16) -> Result<u16, String> {
    if let Some(&bound) = LISTENER_PORT.get() {
        return Ok(bound);
    }
    let listener = TcpListener::bind(("0.0.0.0", port))
        .map_err(|e| format!("Couldn't bind port {port}: {e}"))?;
    let bound_port = listener.local_addr().map(|a| a.port()).unwrap_or(port);
    let _ = LISTENER_PORT.set(bound_port);

    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let app2 = app.clone();
            std::thread::spawn(move || handle_conn(stream, &app2));
        }
    });

    Ok(bound_port)
}

/// The port the listener is bound to, if it has been started this run.
#[tauri::command]
pub fn party_listener_port() -> Option<u16> {
    LISTENER_PORT.get().copied()
}

/// Completes a still-blocked `/talk` request with the DM's actual reply text
/// — called by DMConsolePage.tsx once a remote-originated turn finishes (see
/// runTurn/drainQueue). A missing `request_id` (already timed out and
/// removed itself, or a stale/duplicate call) is a silent no-op — the
/// connection either already got its best-effort response or is long gone.
#[tauri::command]
pub fn respond_to_player_turn(request_id: String, reply_text: String) {
    if let Some(tx) = pending_talk_replies().lock().unwrap().remove(&request_id) {
        let _ = tx.send(reply_text);
    }
}

/// Records one line of the DM's narration so every connected player device
/// — not just whichever one happened to be the last to speak via `/talk` —
/// can catch up on what was said (see narration_log's doc comment). Called
/// from DMConsolePage.tsx's runTurn once a turn's narration is fully
/// resolved, with the same speaker-tag-stripped text already shown in the
/// DM's own transcript (see stripSpeakerTagsForDisplay) — never the raw
/// `[Name]:`-tagged version, which is a TTS-only signal not meant to be
/// read by anyone.
#[tauri::command]
pub fn push_narration(text: String) {
    if text.trim().is_empty() {
        return;
    }
    append_narration(&mut narration_log().lock().unwrap(), text);
}

/// Best-effort LAN-facing IP address, so the DM can read it out to players.
/// Uses the "connect a UDP socket to a public IP, read local_addr()" trick —
/// no packets actually need to leave the machine for this to resolve via the
/// routing table.
#[tauri::command]
pub fn local_lan_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|a| a.ip().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Exercises the real registry + channel `respond_to_player_turn` uses —
    /// the same mechanism a live `/talk` connection thread blocks on inside
    /// `handle_conn`, just without needing an actual TCP connection or
    /// AppHandle (which `handle_conn` itself does need, so that part is
    /// covered by live probing instead — see the PowerShell-based
    /// verification convention already used for this file's other routes).
    #[test]
    fn respond_to_player_turn_unblocks_the_matching_waiting_receiver() {
        let (tx, rx) = mpsc::channel::<String>();
        pending_talk_replies().lock().unwrap().insert("talk-test-1".to_string(), tx);

        respond_to_player_turn("talk-test-1".to_string(), "The goblin misses.".to_string());

        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), "The goblin misses.");
    }

    #[test]
    fn respond_to_player_turn_is_a_silent_noop_for_an_unknown_request_id() {
        // Should never panic even if the connection already timed out and
        // removed itself, or the id is simply wrong.
        respond_to_player_turn("talk-does-not-exist".to_string(), "late reply".to_string());
    }

    #[test]
    fn respond_to_player_turn_removes_the_entry_so_it_cannot_be_completed_twice() {
        let (tx, rx) = mpsc::channel::<String>();
        pending_talk_replies().lock().unwrap().insert("talk-test-2".to_string(), tx);

        respond_to_player_turn("talk-test-2".to_string(), "first reply".to_string());
        // A second call for the same id is a no-op — the entry was removed —
        // so the first (and only) message received must be the first reply.
        respond_to_player_turn("talk-test-2".to_string(), "second reply".to_string());

        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), "first reply");
        assert!(rx.recv_timeout(Duration::from_millis(100)).is_err(), "no second message should ever arrive");
    }

    #[test]
    fn append_narration_assigns_increasing_seq_numbers() {
        let mut log = NarrationLog { entries: std::collections::VecDeque::new(), next_seq: 1 };
        assert_eq!(append_narration(&mut log, "first line".to_string()), 1);
        assert_eq!(append_narration(&mut log, "second line".to_string()), 2);
        assert_eq!(log.entries.len(), 2);
    }

    #[test]
    fn append_narration_evicts_the_oldest_entry_once_over_capacity() {
        let mut log = NarrationLog { entries: std::collections::VecDeque::new(), next_seq: 1 };
        for i in 0..NARRATION_LOG_CAPACITY + 5 {
            append_narration(&mut log, format!("line {i}"));
        }
        assert_eq!(log.entries.len(), NARRATION_LOG_CAPACITY);
        // The oldest 5 lines should have been dropped — the earliest surviving
        // entry is "line 5".
        assert_eq!(log.entries.front().unwrap().text, "line 5");
    }

    #[test]
    fn entries_since_returns_only_strictly_newer_entries() {
        let mut log = NarrationLog { entries: std::collections::VecDeque::new(), next_seq: 1 };
        append_narration(&mut log, "a".to_string());
        append_narration(&mut log, "b".to_string());
        append_narration(&mut log, "c".to_string());

        let all = entries_since(&log.entries, 0);
        assert_eq!(all.iter().map(|e| e.text.as_str()).collect::<Vec<_>>(), vec!["a", "b", "c"]);

        let since_1 = entries_since(&log.entries, 1);
        assert_eq!(since_1.iter().map(|e| e.text.as_str()).collect::<Vec<_>>(), vec!["b", "c"]);

        let since_latest = entries_since(&log.entries, 3);
        assert!(since_latest.is_empty());
    }

    #[test]
    fn parse_since_param_reads_the_query_value_or_defaults_to_zero() {
        assert_eq!(parse_since_param("GET /narration?since=12 HTTP/1.1"), 12);
        assert_eq!(parse_since_param("GET /narration HTTP/1.1"), 0, "no query string at all");
        assert_eq!(parse_since_param("GET /narration?since=nope HTTP/1.1"), 0, "unparseable value");
        assert_eq!(parse_since_param("GET / HTTP/1.1"), 0, "unrelated path with no query");
        assert_eq!(parse_since_param("GET /narration?foo=bar&since=7 HTTP/1.1"), 7, "since not the first param");
    }

    #[test]
    fn push_narration_is_a_silent_noop_for_blank_text() {
        // Reset to a known-empty state isn't possible on the shared global
        // log from a unit test running alongside others, so this only
        // asserts the call itself never panics on whitespace-only input —
        // append_narration's own behavior is covered directly above.
        push_narration("   ".to_string());
        push_narration("".to_string());
    }
}
