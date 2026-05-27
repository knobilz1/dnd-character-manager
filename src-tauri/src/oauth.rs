use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

// ── Credentials baked in at compile time — never in the JS bundle ─────────────
const GOOGLE_CLIENT_ID: &str = env!("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET: &str = env!("GOOGLE_CLIENT_SECRET");
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const SCOPES: &str = "https://www.googleapis.com/auth/drive.file";

// ── Keychain constants ────────────────────────────────────────────────────────
const SERVICE: &str = "tavernsheet";
const ACCOUNT: &str = "google_refresh_token";

// ── Serialisable result types (returned to / emitted to frontend) ─────────────

#[derive(serde::Serialize, Clone)]
pub struct OAuthResult {
    pub access_token: String,
    pub expires_at: u64, // Unix epoch millis
}

#[derive(serde::Serialize)]
pub struct FreshTokenResult {
    pub access_token: String,
    pub expires_at: u64,
}

// ── Internal JSON shapes from Google ─────────────────────────────────────────

#[derive(serde::Deserialize)]
struct TokenExchangeResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}

#[derive(serde::Deserialize)]
struct RefreshResponse {
    access_token: String,
    expires_in: u64,
}

// ── PKCE helpers ──────────────────────────────────────────────────────────────

/// Generates a (verifier, challenge) PKCE pair using 64 random bytes.
fn generate_pkce() -> (String, String) {
    let mut bytes = [0u8; 64];
    rand::thread_rng().fill_bytes(&mut bytes);
    let verifier = URL_SAFE_NO_PAD.encode(bytes);

    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let digest = hasher.finalize();
    let challenge = URL_SAFE_NO_PAD.encode(digest);

    (verifier, challenge)
}

// ── URL helpers ───────────────────────────────────────────────────────────────

/// Percent-encodes a string for use in a URL query value (RFC 3986 unreserved chars pass through).
fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            b => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn build_auth_url(redirect_uri: &str, challenge: &str) -> String {
    format!(
        "https://accounts.google.com/o/oauth2/v2/auth\
         ?client_id={client_id}\
         &redirect_uri={redirect_uri}\
         &response_type=code\
         &scope={scope}\
         &code_challenge={challenge}\
         &code_challenge_method=S256\
         &access_type=offline\
         &prompt=consent",
        client_id = GOOGLE_CLIENT_ID,
        redirect_uri = percent_encode(redirect_uri),
        scope = percent_encode(SCOPES),
        challenge = challenge,
    )
}

// ── TCP request helpers ───────────────────────────────────────────────────────

/// Parses the authorization code from an HTTP request line like:
///   GET /callback?code=4/0Ab...&scope=... HTTP/1.1
fn extract_code(request_line: &str) -> Option<String> {
    let path = request_line.split_whitespace().nth(1).unwrap_or("");
    let start = path.find("code=")? + 5;
    let after = &path[start..];
    let end = after
        .find(|c| matches!(c, '&' | ' ' | '#'))
        .unwrap_or(after.len());
    let code = &after[..end];
    if code.is_empty() { None } else { Some(code.to_string()) }
}

fn send_html_response(stream: &mut impl Write, success: bool) {
    let body = if success {
        "<html><body style='font-family:sans-serif;text-align:center;padding:60px'>\
         <h2>✓ Authenticated!</h2>\
         <p>You can close this window and return to Tavern Sheet.</p>\
         </body></html>"
    } else {
        "<html><body style='font-family:sans-serif;text-align:center;padding:60px'>\
         <h2>Authentication failed.</h2>\
         <p>You can close this window.</p>\
         </body></html>"
    };
    let _ = stream.write_all(
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .as_bytes(),
    );
    let _ = stream.flush();
}

// ── Keychain helpers ──────────────────────────────────────────────────────────

fn store_to_keychain(token: &str) -> Result<(), String> {
    keyring::Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| e.to_string())?
        .set_password(token)
        .map_err(|e| e.to_string())
}

fn read_keychain_token() -> Result<String, String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(t) => Ok(t),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

// ── HTTP helpers (blocking — called from std::thread or spawn_blocking) ───────

fn unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Exchanges an authorization code + PKCE verifier for access + refresh tokens.
fn do_token_exchange(
    code: &str,
    verifier: &str,
    redirect_uri: &str,
) -> Result<TokenExchangeResponse, String> {
    match ureq::post(TOKEN_URL)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_form(&[
            ("client_id", GOOGLE_CLIENT_ID),
            ("client_secret", GOOGLE_CLIENT_SECRET),
            ("redirect_uri", redirect_uri),
            ("grant_type", "authorization_code"),
            ("code", code),
            ("code_verifier", verifier),
        ]) {
        Ok(resp) => resp
            .into_json::<TokenExchangeResponse>()
            .map_err(|e| format!("JSON error: {e}")),
        Err(ureq::Error::Status(code, resp)) => {
            let body = resp.into_string().unwrap_or_default();
            Err(format!("Token exchange failed: {code} {body}"))
        }
        Err(e) => Err(format!("Token exchange error: {e}")),
    }
}

/// Refreshes an expired access token using the stored refresh token.
fn do_token_refresh(refresh_token: &str) -> Result<FreshTokenResult, String> {
    match ureq::post(TOKEN_URL)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_form(&[
            ("client_id", GOOGLE_CLIENT_ID),
            ("client_secret", GOOGLE_CLIENT_SECRET),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ]) {
        Ok(resp) => {
            let data = resp
                .into_json::<RefreshResponse>()
                .map_err(|e| format!("JSON error: {e}"))?;
            Ok(FreshTokenResult {
                access_token: data.access_token,
                expires_at: unix_ms() + data.expires_in * 1000,
            })
        }
        Err(ureq::Error::Status(code, resp)) => {
            let body = resp.into_string().unwrap_or_default();
            Err(format!("Token refresh failed: {code} {body}"))
        }
        Err(e) => Err(format!("Token refresh error: {e}")),
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Starts the OAuth flow from the Rust side:
///  1. Generates a PKCE pair
///  2. Binds a one-shot TCP listener on a random loopback port
///  3. Builds and **returns** the Google auth URL (frontend opens it in the browser)
///  4. Spawns a thread that waits for the callback, exchanges the code using the
///     embedded CLIENT_ID/SECRET, stores the refresh token in the OS keychain,
///     and emits `oauth-complete` or `oauth-error` to the frontend.
///
/// Credentials (CLIENT_ID, CLIENT_SECRET) never appear in the JavaScript bundle —
/// they are baked into the Rust binary at compile time via env!().
#[tauri::command]
pub async fn start_oauth_server(app: AppHandle) -> Result<String, String> {
    let (verifier, challenge) = generate_pkce();

    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("bind error: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("addr error: {e}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let auth_url = build_auth_url(&redirect_uri, &challenge);

    // Spawn a thread to handle the callback, do the token exchange, and emit the result.
    std::thread::spawn(move || {
        match listener.accept() {
            Err(e) => {
                let _ = app.emit("oauth-error", format!("Listener error: {e}"));
                return;
            }
            Ok((mut stream, _)) => {
                let reader = BufReader::new(&stream);
                let first_line = reader
                    .lines()
                    .next()
                    .and_then(|l| l.ok())
                    .unwrap_or_default();
                let code_opt = extract_code(&first_line);
                send_html_response(&mut stream, code_opt.is_some());

                let code = match code_opt {
                    None => {
                        let _ = app.emit("oauth-error", "No authorization code in callback.");
                        return;
                    }
                    Some(c) => c,
                };

                match do_token_exchange(&code, &verifier, &redirect_uri) {
                    Err(e) => {
                        let _ = app.emit("oauth-error", e);
                    }
                    Ok(tokens) => {
                        let refresh_token = match tokens.refresh_token {
                            Some(rt) => rt,
                            None => {
                                let _ = app.emit(
                                    "oauth-error",
                                    "Google did not return a refresh token — try revoking \
                                     app access in your Google account and reconnecting.",
                                );
                                return;
                            }
                        };
                        if let Err(e) = store_to_keychain(&refresh_token) {
                            let _ = app.emit("oauth-error", format!("Keychain error: {e}"));
                            return;
                        }
                        let _ = app.emit(
                            "oauth-complete",
                            OAuthResult {
                                access_token: tokens.access_token,
                                expires_at: unix_ms() + tokens.expires_in * 1000,
                            },
                        );
                    }
                }
            }
        }
    });

    Ok(auth_url)
}

/// Reads the refresh token from the OS keychain and exchanges it for a fresh access
/// token using the embedded credentials.  Returns `Err("no-token")` if the user has
/// never connected (no keychain entry).  All credential handling stays in Rust.
#[tauri::command]
pub async fn get_fresh_access_token() -> Result<FreshTokenResult, String> {
    let refresh_token = read_keychain_token()?;
    if refresh_token.is_empty() {
        return Err("no-token".to_string());
    }
    // ureq is blocking — run it on tokio's blocking thread pool.
    tokio::task::spawn_blocking(move || do_token_refresh(&refresh_token))
        .await
        .map_err(|e| format!("Task join error: {e}"))?
}

/// Removes the Google refresh token from the OS keychain (i.e. disconnect).
#[tauri::command]
pub fn clear_google_token() -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
