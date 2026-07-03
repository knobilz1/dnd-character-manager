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

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream, UdpSocket};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

static LISTENER_PORT: OnceLock<u16> = OnceLock::new();

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
        // DM Console UI itself.
        let _ = app.emit("dm-player-turn", serde_json::json!({ "name": name, "text": text }));
        return write_response(&mut stream, 200, "{\"ok\":true}", "application/json");
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
