use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use tauri::{AppHandle, Emitter};

/// Starts a one-shot TCP listener on a random loopback port.
/// Returns the port number. The listener runs in a background thread;
/// when the Google OAuth callback arrives it emits an "oauth-code" event
/// carrying the authorization code to the frontend, then shuts down.
#[tauri::command]
pub async fn start_oauth_server(app: AppHandle) -> Result<u32, String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("bind error: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("addr error: {e}"))?
        .port() as u32;

    std::thread::spawn(move || {
        // Accept exactly one connection – the OAuth redirect.
        if let Ok((mut stream, _)) = listener.accept() {
            let reader = BufReader::new(&stream);
            // Read only the first line: "GET /callback?code=XXX HTTP/1.1"
            let first_line = reader
                .lines()
                .next()
                .and_then(|l| l.ok())
                .unwrap_or_default();

            let code = extract_code(&first_line);

            // Respond so the browser shows a friendly page instead of a connection error.
            let body = if code.is_empty() {
                "<html><body style='font-family:sans-serif;text-align:center;padding:60px'>\
                 <h2>Authentication failed.</h2><p>You can close this window.</p></body></html>"
            } else {
                "<html><body style='font-family:sans-serif;text-align:center;padding:60px'>\
                 <h2>✓ Authenticated!</h2><p>You can close this window and return to Tavern Sheet.</p>\
                 </body></html>"
            };
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();

            if !code.is_empty() {
                let _ = app.emit("oauth-code", code);
            }
        }
    });

    Ok(port)
}

/// Parses the authorization code out of a line like:
///   GET /callback?code=4/0Ab...&scope=... HTTP/1.1
fn extract_code(request_line: &str) -> String {
    // Extract the path component (second token)
    let path = request_line.split_whitespace().nth(1).unwrap_or("");
    // Locate "code=" parameter
    if let Some(idx) = path.find("code=") {
        let after = &path[idx + 5..];
        let end = after.find(|c| c == '&' || c == ' ' || c == '#').unwrap_or(after.len());
        return after[..end].to_string();
    }
    String::new()
}

// ── Keychain helpers ─────────────────────────────────────────────────────────

const SERVICE: &str = "tavernsheet";
const ACCOUNT: &str = "google_refresh_token";

/// Stores the Google OAuth refresh token in the OS keychain.
#[tauri::command]
pub fn store_google_token(token: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    entry.set_password(&token).map_err(|e| e.to_string())
}

/// Retrieves the stored refresh token. Returns an empty string if none exists.
#[tauri::command]
pub fn get_google_token() -> Result<String, String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(token) => Ok(token),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// Removes the stored refresh token from the OS keychain.
#[tauri::command]
pub fn clear_google_token() -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
