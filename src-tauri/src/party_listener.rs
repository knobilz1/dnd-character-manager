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
use std::sync::atomic::{AtomicBool, Ordering};
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

/// Hard ceiling on a request body, checked BEFORE the buffer is allocated.
/// `Content-Length` is attacker-supplied and this listener answers anything
/// that can reach the port, so allocating straight from it let a single
/// `Content-Length: 2000000000` request force a multi-GB zeroed allocation and
/// take the app down. The largest legitimate body is a base64 table photo (a
/// few MB); 16 MiB leaves generous headroom.
const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;

/// Header every player request carries the table PIN in (see `session_pin`).
const PIN_HEADER: &str = "x-tavern-pin";

/// PIN alphabet: uppercase minus the characters that get misheard or mistyped
/// when a PIN is read out loud across a table (O/0, I/1).
const PIN_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

static SESSION_PIN: OnceLock<String> = OnceLock::new();

/// Whether the PIN gate is enforced. ON by default, and it stays that way for
/// anyone who never touches the setting: the gate is what stops any device on the
/// WiFi pushing a turn into the DM's engine queue or reading back narration and
/// lent character sheets.
///
/// It can be turned off because the friction is real and it lands on the players,
/// not the DM — every device 401s until its owner types tonight's PIN, and the PIN
/// rotates each app run. A table on a trusted home network, or one mid-session
/// when someone's phone won't take the code, is entitled to make that trade.
///
/// Deliberately NOT persisted on the Rust side: this resets to ON every app start,
/// and the console re-applies the DM's saved choice on mount. A security gate that
/// silently stays off across restarts because of a setting nobody remembers is a
/// worse failure than one that occasionally has to be switched off again.
static PIN_REQUIRED: AtomicBool = AtomicBool::new(true);

fn pin_required() -> bool {
    PIN_REQUIRED.load(Ordering::Relaxed)
}

/// The join PIN for this run, generated once when the listener binds and shown
/// in the DM Console for the DM to read out.
///
/// 32^6 ≈ 1.1e9 combinations, which is why there is no attempt limiter here:
/// guessing it over LAN HTTP would take far longer than a game night, and a
/// lockout would hand anyone on the WiFi a way to shut the table's own players
/// out. It rotates every app run — a PIN read out last week is already dead.
fn session_pin() -> &'static str {
    SESSION_PIN.get_or_init(|| {
        let mut rng = rand::thread_rng();
        (0..6)
            .map(|_| PIN_ALPHABET[rng.gen_range(0..PIN_ALPHABET.len())] as char)
            .collect()
    })
}

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

/// Pure: pulls a named query parameter out of an HTTP request line, percent-
/// decoded. None when the parameter is absent or there's no query string.
///
/// Character names travel through here, so they arrive `encodeURIComponent`'d
/// — "Ellara Moonwhisper" reaches us as "Ellara%20Moonwhisper", and matching it
/// raw against a roster name would silently never hit.
fn parse_query_param(request_line: &str, key: &str) -> Option<String> {
    let path_and_query = request_line.split_whitespace().nth(1)?;
    let (_, query) = path_and_query.split_once('?')?;
    let prefix = format!("{key}=");
    let raw = query.split('&').find_map(|pair| pair.strip_prefix(prefix.as_str()))?;
    Some(percent_decode(raw))
}

/// Minimal percent-decoder for query values: `%XX` escapes plus `+` for space.
/// Enough for a character name, and not worth pulling in a dependency for.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 3 <= bytes.len() => {
                match std::str::from_utf8(&bytes[i + 1..i + 3])
                    .ok()
                    .and_then(|h| u8::from_str_radix(h, 16).ok())
                {
                    Some(b) => {
                        out.push(b);
                        i += 3;
                    }
                    None => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The one way a character name becomes a key on this side of the wire —
/// mirrors partyKey() in src/utils/dmPrompt.ts and usePartyStore's own upsert.
fn name_key(name: &str) -> String {
    name.trim().to_lowercase()
}

// ── Who's actually at the table (roll call) ──────────────────────────────────
//
// There is no announce, handshake, or heartbeat protocol here, and deliberately
// so. A player's open sheet already polls GET /narration every few seconds
// (useDmNarrationFeed), so adding `who` to a request the app was making anyway
// turns it into presence for free — no second loop, no new endpoint.
//
// This is a HINT for the roll-call dialog and nothing more. The DM is looking
// at actual humans: a laptop being awake isn't a person being in the room, and
// someone playing off a paper sheet is present while never appearing here. The
// manual present/away toggle stays the source of truth.

/// Generous against the ~3s narration poll — a device has to miss many polls in
/// a row before it drops off, so a brief network hiccup can't blink someone out
/// of the room mid-roll-call.
const PRESENCE_TIMEOUT: Duration = Duration::from_secs(60);

fn presence() -> &'static Mutex<HashMap<String, std::time::Instant>> {
    static SEEN: OnceLock<Mutex<HashMap<String, std::time::Instant>>> = OnceLock::new();
    SEEN.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Names seen inside the timeout, dropping stale ones in place — expiry happens
/// lazily on read rather than from a background timer, the same shape
/// `fresh_camera_holder` uses. Sorted so the UI ordering is stable.
fn fresh_presence(seen: &mut HashMap<String, std::time::Instant>) -> Vec<String> {
    seen.retain(|_, at| at.elapsed() < PRESENCE_TIMEOUT);
    let mut names: Vec<String> = seen.keys().cloned().collect();
    names.sort();
    names
}

// ── Proxy play: running an absent player's character ─────────────────────────
//
// Nothing has ever travelled DM → player in this app; every route below either
// accepts a push or serves narration/maps. These two globals are what make the
// other direction possible, and they live in Rust rather than the DM's frontend
// for the same reason TABLE_PHOTOS does: it's the *player's* device that asks
// this listener, so a check that only ran in the console's UI couldn't refuse.

/// borrower name key → the character names their device should be running.
fn proxy_assignments() -> &'static Mutex<HashMap<String, Vec<String>>> {
    static ASSIGNED: OnceLock<Mutex<HashMap<String, Vec<String>>>> = OnceLock::new();
    ASSIGNED.get_or_init(|| Mutex::new(HashMap::new()))
}

/// character name key → that character's full sheet JSON.
///
/// This is the whole access control for `GET /character`: only what the console
/// has pushed here is fetchable at all, and the map is replaced wholesale each
/// time. Like every other route on this listener, there is no authentication
/// beyond that.
///
/// The console publishes the DM's current copy of the WHOLE party, not just
/// characters lent out for proxy play, because the pull has two users. The
/// borrower needs the sheet at lend time; the absent player needs it back
/// afterwards — and the DM's copy is the only current one after a night
/// somebody else ran their character. Since this map lives in memory and dies
/// with the app, the console re-publishes on every campaign load so that
/// "collect what happened while I was away" still works the following week.
fn shared_characters() -> &'static Mutex<HashMap<String, serde_json::Value>> {
    static SHARED: OnceLock<Mutex<HashMap<String, serde_json::Value>>> = OnceLock::new();
    SHARED.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The battle map the DM is currently sharing with players — Phase 5 of the
/// multi-story map work. Unlike the narration log this is NOT a growing
/// history: it is just the one map on the table right now, replaced wholesale
/// whenever the DM shares a different map or flips a floor's reveal. `version`
/// bumps on every change so a polling player device only re-downloads the
/// image-heavy payload when it actually changed, not every poll. `payload` is
/// None when nothing is shared (or the DM stopped sharing) — a player that
/// sees a *new* version with a null payload clears its view.
struct BroadcastMap {
    version: u64,
    payload: Option<serde_json::Value>,
}

fn broadcast_map() -> &'static Mutex<BroadcastMap> {
    static MAP: OnceLock<Mutex<BroadcastMap>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(BroadcastMap { version: 0, payload: None }))
}

/// Pure: what `GET /map?since=<v>` returns. A player already on the current
/// version (`since >= version`) gets just the version back — the heavy image
/// payload is not re-sent. A player behind gets the current payload, which may
/// itself be null (meaning "the DM stopped sharing — clear your view").
fn map_response(current: &BroadcastMap, since: u64) -> serde_json::Value {
    if since >= current.version {
        serde_json::json!({ "version": current.version })
    } else {
        serde_json::json!({ "version": current.version, "map": current.payload })
    }
}

/// The live turn order, as the PLAYERS are allowed to see it.
///
/// Deliberately a different view from the DM's own `battleLog.initiative`, for the same reason the
/// shared map omits deployment zones: the player copy is the one place that intentionally shows
/// less. Knowing exactly when the goblins act before they have ever acted hands the table free
/// information it would not have at a real table — so enemies are withheld for round 1 and appear
/// from round 2, by which point the party has watched them go.
///
/// The masking happens on the DM side (see maskInitiativeForPlayers) so this slot only ever HOLDS
/// the player-safe list; a bug here can leak nothing that was never put in.
struct BroadcastInitiative {
    version: u64,
    payload: Option<serde_json::Value>,
}

fn broadcast_initiative() -> &'static Mutex<BroadcastInitiative> {
    static INIT: OnceLock<Mutex<BroadcastInitiative>> = OnceLock::new();
    INIT.get_or_init(|| Mutex::new(BroadcastInitiative { version: 0, payload: None }))
}

/// Pure: what `GET /initiative?since=<v>` returns. Same contract as `map_response` — a client on
/// the current version gets only the version back, and a null payload on a NEW version means
/// "combat is over, clear your order and your rolled number".
fn initiative_response(current: &BroadcastInitiative, since: u64) -> serde_json::Value {
    if since >= current.version {
        serde_json::json!({ "version": current.version })
    } else {
        serde_json::json!({ "version": current.version, "initiative": current.payload })
    }
}

// ── The table camera (#39) ───────────────────────────────────────────────────
//
// The DM bot often runs on a different machine from the table, with the players
// in another room — so the camera pointed at the map is on a PLAYER's device,
// and the photo has to travel to the DM. Players already push to this listener
// (`POST /talk`), so a photo is the same shape.
//
// Exactly ONE player holds the "table camera" role at a time. Without that, two
// players snapping at once would race two different boards into the DM's read.
// The role is claimed and released by a toggle on the player's sheet, and the DM
// can revoke it.

/// A stale hold is auto-released: a player who claims the camera and then closes
/// their app would otherwise own it forever. Any claim or photo from the holder
/// refreshes it, so an active camera never expires mid-session.
const CAMERA_HOLD_TIMEOUT: Duration = Duration::from_secs(20 * 60);

struct CameraHolder {
    name: String,
    at: std::time::Instant,
}

fn camera_holder() -> &'static Mutex<Option<CameraHolder>> {
    static HOLDER: OnceLock<Mutex<Option<CameraHolder>>> = OnceLock::new();
    HOLDER.get_or_init(|| Mutex::new(None))
}

/// Whether the DM is currently accepting board photos from players — mirrors the
/// console's `tableCameraSource === 'player'` (see set_table_photos).
///
/// The setting lives in the DM's browser storage, but the refusal has to happen
/// HERE: a player's device asks this listener for the camera, so a check that
/// only ran in the DM's UI would let a player claim the role and be told "Sent"
/// for a photo the console then silently drops. Defaults to false to match the
/// frontend default — an unsynced listener refuses rather than accepts.
static TABLE_PHOTOS: AtomicBool = AtomicBool::new(false);

/// Bumped when the DM asks for a photo ("automatic" delivery). Players PULL from
/// the DM, so there's no way to call out to a player's device — instead the
/// holder polls `GET /camera`, notices the sequence advanced past the last one it
/// acted on, and takes the photo itself. A monotonic counter rather than a bool
/// so there's no clear-it-afterwards race: each request is a distinct number, and
/// a device that has already served request N simply ignores anything <= N.
fn camera_request_seq() -> &'static Mutex<u64> {
    static SEQ: OnceLock<Mutex<u64>> = OnceLock::new();
    SEQ.get_or_init(|| Mutex::new(0))
}

/// The holder, if the hold is still fresh — clearing it in place when it has
/// gone stale, so expiry happens lazily on read without a background timer.
fn fresh_camera_holder(slot: &mut Option<CameraHolder>) -> Option<String> {
    if let Some(h) = slot.as_ref() {
        if h.at.elapsed() < CAMERA_HOLD_TIMEOUT {
            return Some(h.name.clone());
        }
    }
    *slot = None;
    None
}

/// Pure claim policy, split from the clock so it can be tested: given who holds
/// the camera now, what does this request do? Returns (new holder, granted).
///
/// Claiming is idempotent for the current holder (a re-claim just refreshes the
/// hold), a claim by anyone else while it's held is REFUSED rather than stealing
/// it, and releasing only works for the holder — so a player closing their sheet
/// can't knock someone else off the camera.
/// `enabled` is the DM's board-photo setting: when it's off, nobody may TAKE the
/// camera, but a release still works — a player holding it when the DM switched
/// off can always hand it back, and can't be stuck owning a role that does
/// nothing. Kept in this pure function rather than at the HTTP handler so the
/// policy has one home and a new caller can't forget the check.
fn resolve_camera_claim(
    current: Option<&str>, requester: &str, release: bool, enabled: bool,
) -> (Option<String>, bool) {
    let is_holder = current.is_some_and(|c| c.eq_ignore_ascii_case(requester));
    match (release, current) {
        (true, _) if is_holder => (None, true),
        (true, _) => (current.map(str::to_string), false),
        (false, _) if !enabled => (current.map(str::to_string), false),
        (false, None) => (Some(requester.to_string()), true),
        // A re-claim keeps the name ALREADY on record rather than adopting the
        // requester's casing, so "ana" refreshing her hold doesn't rename the
        // holder everyone else sees from "Ana" to "ana".
        (false, _) if is_holder => (current.map(str::to_string), true),
        (false, _) => (current.map(str::to_string), false),
    }
}

// ── The table controller ─────────────────────────────────────────────────────
//
// Same shape as the table camera above, for a different job: exactly ONE player
// may be designated the "table controller", and their device can trigger a small
// set of the DM Console's own controls. The DM machine often sits by the TV out
// of arm's reach; this is the remote for it.
//
// The claim policy is deliberately the SAME code the camera uses
// (`fresh_camera_holder` / `resolve_camera_claim`): those functions are generic
// over which role they arbitrate, and one tested policy serving two roles beats
// two copies that can drift. Only the slots differ.

/// What a controller may trigger. An allowlist HERE, not just in the console:
/// the console dispatches whatever event arrives, so the listener is the place
/// where "remote control" stays a remote with four buttons rather than an RPC
/// surface that grows by accident.
const CONTROL_ACTIONS: &[&str] = &[
    "stop", "recap", "end_battle", "replay",
    // Roll call from the controller's seat: mark one member here/away, mark the
    // whole table present, confirm and start the session. The nuanced half of
    // roll call (absence modes, autopilot anchors, proxies) deliberately stays
    // on the console — it needs sheet knowledge the controller doesn't have.
    "roll_call_mark", "roll_call_all_here", "roll_call_done",
];

/// Whether the DM allows a table controller at all. Defaults OFF and mirrors a
/// console setting (see `set_remote_control`) — same "an unsynced listener
/// refuses rather than accepts" stance as TABLE_PHOTOS.
static REMOTE_CONTROL: AtomicBool = AtomicBool::new(false);

/// The player currently holding the controller role. Shares the camera's holder
/// record and lazy expiry — the roles behave identically, they just do
/// different things.
fn controller_holder() -> &'static Mutex<Option<CameraHolder>> {
    static HOLDER: OnceLock<Mutex<Option<CameraHolder>>> = OnceLock::new();
    HOLDER.get_or_init(|| Mutex::new(None))
}

/// The console's roll-call state, mirrored here so the controller's device can
/// SHOW it — roster names, who's marked away, whether roll call is done. The
/// console owns the truth (the roster and absence map are React state); this is
/// a display copy pushed on every change, kept as an opaque JSON value so the
/// listener never grows a schema for it. Null when the feature is off.
fn roll_call_state() -> &'static Mutex<serde_json::Value> {
    static STATE: OnceLock<Mutex<serde_json::Value>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(serde_json::Value::Null))
}

fn write_response(stream: &mut TcpStream, status: u16, body: &str, content_type: &str) {
    let status_text = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        409 => "Conflict",
        413 => "Payload Too Large",
        _ => "OK",
    };
    // No Access-Control-Allow-* headers on purpose. Every real client reaches
    // this listener through the Tauri HTTP plugin (see dmConnect.ts), which is
    // Rust-side and never subject to browser CORS — so the wildcard ACAO that
    // used to be here bought legitimate players nothing and instead let any web
    // page open in any browser on the network read narration and lent character
    // sheets, and post turns, cross-origin.
    let resp = format!(
        "HTTP/1.1 {status} {status_text}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {len}\r\n\
         Connection: close\r\n\r\n{body}",
        len = body.len(),
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}

/// Whether this request line is the one route that answers without a PIN — the
/// bare `GET /` reachability probe. Split out of `handle_conn` because it is
/// the PIN gate's only exemption: too loose and every route is open again, too
/// tight and players can't discover a DM at all.
fn is_reachability_probe(request_line: &str) -> bool {
    request_line.starts_with("GET / ") || request_line.starts_with("GET /?")
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
    let mut supplied_pin = String::new();
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
                    } else if v.0.eq_ignore_ascii_case(PIN_HEADER) {
                        supplied_pin = v.1.trim().to_string();
                    }
                }
            }
            Err(_) => break,
        }
    }

    if request_line.starts_with("OPTIONS") {
        return write_response(&mut stream, 204, "", "text/plain");
    }

    // The bare reachability probe stays open: it is how a player's app decides
    // whether to show its "Talk to DM" button at all, and all it discloses is
    // that a console is listening here. Every route that carries or accepts
    // real table data needs the PIN the DM reads out — without this the
    // listener answered anything that could reach the port, so any device on
    // the WiFi could push a turn straight into the DM's engine queue or read
    // back narration and lent character sheets.
    if pin_required()
        && !is_reachability_probe(&request_line)
        && !supplied_pin.eq_ignore_ascii_case(session_pin())
    {
        return write_response(
            &mut stream,
            401,
            "{\"ok\":false,\"error\":\"Wrong or missing table PIN — ask the DM for tonight's PIN.\"}",
            "application/json",
        );
    }
    if request_line.starts_with("GET /narration") {
        let since = parse_since_param(&request_line);
        // `who` is optional and additive: an older player build that doesn't
        // send it still gets its narration, it just doesn't register presence.
        let who = parse_query_param(&request_line, "who");
        let mut proxy_for: Vec<String> = Vec::new();
        // When the DM's copy of the asking player's own character was saved
        // more recently than theirs, their device offers to pull it down. One
        // integer, on a poll that already runs — comparing any other way would
        // mean shipping the whole portrait-carrying sheet every few seconds
        // just to find out it hadn't changed.
        let mut your_sheet_updated_at: Option<i64> = None;
        if let Some(name) = who.as_deref().filter(|n| !n.trim().is_empty()) {
            let key = name_key(name);
            presence().lock().unwrap().insert(key.clone(), std::time::Instant::now());
            proxy_for = proxy_assignments().lock().unwrap().get(&key).cloned().unwrap_or_default();
            your_sheet_updated_at = shared_characters()
                .lock()
                .unwrap()
                .get(&key)
                .and_then(|c| c.get("updatedAt"))
                .and_then(serde_json::Value::as_i64);
        }
        let log = narration_log().lock().unwrap();
        let entries = entries_since(&log.entries, since);
        let latest = log.entries.back().map(|e| e.seq).unwrap_or(since);
        drop(log);
        // proxyFor rides along on a poll that already exists rather than
        // getting its own loop — it's a handful of bytes. The heavy part (the
        // sheet itself, which carries a data-URL portrait) is a separate
        // one-shot GET /character the device only makes when this list changes.
        let body = serde_json::json!({
            "entries": entries,
            "latest": latest,
            "proxyFor": proxy_for,
            "yourSheetUpdatedAt": your_sheet_updated_at,
        })
        .to_string();
        return write_response(&mut stream, 200, &body, "application/json");
    }
    if request_line.starts_with("GET /character") {
        // The DM lending an absent player's sheet to whoever is running them
        // tonight. Serves only what the console explicitly pushed via
        // set_shared_characters, so an unlent character is a 404 even though
        // this listener has no auth at all.
        let name = parse_query_param(&request_line, "name").unwrap_or_default();
        let found = shared_characters().lock().unwrap().get(&name_key(&name)).cloned();
        return match found {
            Some(c) => {
                let body = serde_json::json!({ "ok": true, "character": c }).to_string();
                write_response(&mut stream, 200, &body, "application/json")
            }
            None => write_response(
                &mut stream,
                404,
                "{\"ok\":false,\"error\":\"no such character is being shared\"}",
                "application/json",
            ),
        };
    }
    if request_line.starts_with("GET /map") {
        // Player devices poll this for the DM's currently-shared map (revealed
        // floors only). `since` is their last-seen version, so an unchanged map
        // isn't re-sent — see map_response / useDmMapFeed.
        let since = parse_since_param(&request_line);
        let current = broadcast_map().lock().unwrap();
        let body = map_response(&current, since).to_string();
        drop(current);
        return write_response(&mut stream, 200, &body, "application/json");
    }
    if request_line.starts_with("GET /initiative") {
        // Player devices poll this for the live turn order, already masked for
        // them (round 1 hides the enemy side). A null payload on a new version
        // means combat ended — clear the order and the local rolled number.
        let since = parse_since_param(&request_line);
        let current = broadcast_initiative().lock().unwrap();
        let body = initiative_response(&current, since).to_string();
        drop(current);
        return write_response(&mut stream, 200, &body, "application/json");
    }
    if request_line.starts_with("GET /control") {
        // Who the controller is + whether the DM allows one. `enabled` rides the
        // poll for the same reason the camera's does: players PULL, so this is
        // how the DM's setting reaches their device, and the player-side panel
        // hides itself when it's false.
        let mut slot = controller_holder().lock().unwrap();
        let holder = fresh_camera_holder(&mut slot);
        drop(slot);
        // `online` is the roll-call dialog's presence dot, computed here because
        // presence already lives listener-side — the controller gets the same
        // hint the DM sees, at no extra round trip.
        let online = { let mut seen = presence().lock().unwrap(); fresh_presence(&mut seen) };
        let body = serde_json::json!({
            "holder": holder,
            "enabled": REMOTE_CONTROL.load(Ordering::Relaxed),
            "rollCall": roll_call_state().lock().unwrap().clone(),
            "online": online,
        })
        .to_string();
        return write_response(&mut stream, 200, &body, "application/json");
    }
    if request_line.starts_with("GET /camera") {
        // Who currently holds the table camera, so a player's toggle can show
        // "Ana is the table camera" instead of letting them think it's free.
        let mut slot = camera_holder().lock().unwrap();
        let holder = fresh_camera_holder(&mut slot);
        drop(slot);
        let requested = *camera_request_seq().lock().unwrap();
        // `enabled` rides along on a poll the player is already making, which is
        // how the DM's setting reaches their device at all — players PULL, so
        // there is no push channel. Their camera control hides itself when it's
        // false, so turning board photos off removes the button everywhere
        // within one poll instead of only on the DM's own screen.
        let body = serde_json::json!({
            "holder": holder,
            "requestSeq": requested,
            "enabled": TABLE_PHOTOS.load(Ordering::Relaxed),
        })
        .to_string();
        return write_response(&mut stream, 200, &body, "application/json");
    }
    if request_line.starts_with("GET") {
        // Doubles as a reachability check — player devices poll this to decide
        // whether to show their "Talk to DM" button.
        return write_response(&mut stream, 200, "dnd-dm listening.\n", "text/plain");
    }

    if content_length > MAX_BODY_BYTES {
        return write_response(
            &mut stream,
            413,
            "{\"ok\":false,\"error\":\"body too large\"}",
            "application/json",
        );
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

    if request_line.starts_with("POST /camera-claim") {
        // Toggle the "table camera" role. `release: true` hands it back.
        let parsed: serde_json::Value = serde_json::from_str(&body_str).unwrap_or(serde_json::Value::Null);
        let name = parsed.get("name").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        let release = parsed.get("release").and_then(|v| v.as_bool()).unwrap_or(false);
        if name.is_empty() {
            return write_response(&mut stream, 400, "{\"ok\":false,\"error\":\"who are you?\"}", "application/json");
        }
        let mut slot = camera_holder().lock().unwrap();
        let current = fresh_camera_holder(&mut slot);
        let enabled = TABLE_PHOTOS.load(Ordering::Relaxed);
        let (holder, granted) = resolve_camera_claim(current.as_deref(), &name, release, enabled);
        *slot = holder.clone().map(|n| CameraHolder { name: n, at: std::time::Instant::now() });
        drop(slot);
        let _ = app.emit("dm-table-camera", serde_json::json!({ "holder": holder }));
        let body = serde_json::json!({
            "ok": true, "granted": granted, "holder": holder,
            // Only a refused CLAIM is explained by the setting. A release that
            // returns false is the unrelated no-op of handing back a camera you
            // no longer hold, and saying "not taking photos" there is a lie.
            "error": (!granted && !enabled && !release).then_some("The DM isn't taking board photos."),
        })
        .to_string();
        return write_response(&mut stream, 200, &body, "application/json");
    }

    if request_line.starts_with("POST /control-claim") {
        // Toggle the "table controller" role — the same dance as /camera-claim.
        let parsed: serde_json::Value = serde_json::from_str(&body_str).unwrap_or(serde_json::Value::Null);
        let name = parsed.get("name").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        let release = parsed.get("release").and_then(|v| v.as_bool()).unwrap_or(false);
        if name.is_empty() {
            return write_response(&mut stream, 400, "{\"ok\":false,\"error\":\"who are you?\"}", "application/json");
        }
        let mut slot = controller_holder().lock().unwrap();
        let current = fresh_camera_holder(&mut slot);
        let enabled = REMOTE_CONTROL.load(Ordering::Relaxed);
        let (holder, granted) = resolve_camera_claim(current.as_deref(), &name, release, enabled);
        *slot = holder.clone().map(|n| CameraHolder { name: n, at: std::time::Instant::now() });
        drop(slot);
        let _ = app.emit("dm-table-controller", serde_json::json!({ "holder": holder }));
        let body = serde_json::json!({
            "ok": true, "granted": granted, "holder": holder,
            "error": (!granted && !enabled && !release).then_some("The DM hasn't enabled a table controller."),
        })
        .to_string();
        return write_response(&mut stream, 200, &body, "application/json");
    }

    // Trailing space: "POST /control" is a prefix of "POST /control-claim", and
    // the request line is always "POST /control HTTP/1.1".
    if request_line.starts_with("POST /control ") {
        // One remote button press from the controller. Only the current, fresh
        // holder is obeyed, and only for the allowlisted actions — see
        // CONTROL_ACTIONS for why the list lives here.
        let parsed: serde_json::Value = serde_json::from_str(&body_str).unwrap_or(serde_json::Value::Null);
        let name = parsed.get("name").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        let action = parsed.get("action").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        if !CONTROL_ACTIONS.contains(&action.as_str()) {
            return write_response(&mut stream, 400, "{\"ok\":false,\"error\":\"unknown action\"}", "application/json");
        }
        // roll_call_mark carries who and which way. Validated for presence here;
        // whether the member actually exists is the console's call — it owns the
        // roster, and an unknown name is ignored there rather than trusted.
        let member = parsed.get("member").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        let here = parsed.get("here").and_then(|v| v.as_bool()).unwrap_or(true);
        if action == "roll_call_mark" && member.is_empty() {
            return write_response(&mut stream, 400, "{\"ok\":false,\"error\":\"who is being marked?\"}", "application/json");
        }
        // Checked before the holder check, same order and same reason as
        // /table-photo: a holder from before the DM switched off deserves the
        // true reason, not a misleading "claim it first".
        if !REMOTE_CONTROL.load(Ordering::Relaxed) {
            let body = "{\"ok\":false,\"error\":\"The DM hasn't enabled a table controller.\"}";
            return write_response(&mut stream, 409, body, "application/json");
        }
        let mut slot = controller_holder().lock().unwrap();
        let current = fresh_camera_holder(&mut slot);
        if !current.as_deref().is_some_and(|c| c.eq_ignore_ascii_case(&name)) {
            drop(slot);
            let body = serde_json::json!({
                "ok": false,
                "error": match current { Some(h) => format!("{h} is the table controller right now."), None => "Turn on 'table controller' first.".into() },
            }).to_string();
            return write_response(&mut stream, 409, &body, "application/json");
        }
        // A button press is activity — an in-use controller never expires.
        *slot = Some(CameraHolder { name: name.clone(), at: std::time::Instant::now() });
        drop(slot);
        let _ = app.emit("dm-remote-control", serde_json::json!({ "name": name, "action": action, "member": member, "here": here }));
        return write_response(&mut stream, 200, "{\"ok\":true}", "application/json");
    }

    if request_line.starts_with("POST /table-photo") {
        // A photo of the physical table from the player holding the camera. Only
        // the holder may send, so the DM can't be fed two different boards at
        // once. The DM Console picks this up, runs the board read, and shows the
        // usual confirm panel — a photo from a player is never applied blind.
        let parsed: serde_json::Value = match serde_json::from_str(&body_str) {
            Ok(v) => v,
            Err(e) => {
                return write_response(&mut stream, 400, &format!("{{\"ok\":false,\"error\":\"{e}\"}}"), "application/json");
            }
        };
        let name = parsed.get("name").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
        let photo = parsed.get("photo").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if photo.trim().is_empty() {
            return write_response(&mut stream, 400, "{\"ok\":false,\"error\":\"no photo\"}", "application/json");
        }
        // Checked before the holder check so a player who held the camera when
        // the DM switched off is told the truth ("not taking photos") rather
        // than the holder check's misleading "turn on table camera first".
        if !TABLE_PHOTOS.load(Ordering::Relaxed) {
            let body = "{\"ok\":false,\"error\":\"The DM isn't taking board photos.\"}";
            return write_response(&mut stream, 409, body, "application/json");
        }
        let mut slot = camera_holder().lock().unwrap();
        let current = fresh_camera_holder(&mut slot);
        if !current.as_deref().is_some_and(|c| c.eq_ignore_ascii_case(&name)) {
            drop(slot);
            let body = serde_json::json!({
                "ok": false,
                "error": match current { Some(h) => format!("{h} is the table camera right now."), None => "Turn on 'table camera' first.".into() },
            }).to_string();
            return write_response(&mut stream, 409, &body, "application/json");
        }
        // Sending a photo counts as activity, so an in-use camera never expires.
        *slot = Some(CameraHolder { name: name.clone(), at: std::time::Instant::now() });
        drop(slot);
        let _ = app.emit("dm-table-photo", serde_json::json!({ "name": name, "photo": photo }));
        return write_response(&mut stream, 200, "{\"ok\":true}", "application/json");
    }

    write_response(&mut stream, 404, "not found", "text/plain");
}

/// Force-release the table camera (the DM's revoke). Also used when the DM
/// switches the photo source back to a directly-connected camera.
#[tauri::command]
pub fn release_table_camera() {
    *camera_holder().lock().unwrap() = None;
}

/// Mirror the DM console's board-photo setting into the listener, so players are
/// refused at the door instead of having their photo accepted and then dropped.
/// Called on console mount and whenever the setting changes.
///
/// Turning it off also frees the camera: the role only exists to send photos, so
/// leaving someone holding one that no longer works is just a stale light on
/// their screen.
#[tauri::command]
pub fn set_table_photos(enabled: bool) {
    TABLE_PHOTOS.store(enabled, Ordering::Relaxed);
    if !enabled {
        *camera_holder().lock().unwrap() = None;
    }
}

/// Mirror the console's table-controller setting, exactly as set_table_photos
/// mirrors board photos. Turning it off frees the role for the same reason:
/// a controller that no longer controls anything is a stale light on someone's
/// sheet.
#[tauri::command]
pub fn set_remote_control(enabled: bool) {
    REMOTE_CONTROL.store(enabled, Ordering::Relaxed);
    if !enabled {
        *controller_holder().lock().unwrap() = None;
    }
}

/// The console pushes its roll-call snapshot here on every change (and Null
/// when the controller feature is off) so GET /control can serve it. See
/// roll_call_state.
#[tauri::command]
pub fn set_roll_call_state(state: serde_json::Value) {
    *roll_call_state().lock().unwrap() = state;
}

/// Force-release the table controller (the DM's revoke).
#[tauri::command]
pub fn release_table_controller() {
    *controller_holder().lock().unwrap() = None;
}

/// Who holds the controller right now, for the DM Console's own display.
#[tauri::command]
pub fn table_controller_holder() -> Option<String> {
    let mut slot = controller_holder().lock().unwrap();
    fresh_camera_holder(&mut slot)
}

/// Who holds the table camera right now, for the DM Console's own display.
#[tauri::command]
pub fn table_camera_holder() -> Option<String> {
    let mut slot = camera_holder().lock().unwrap();
    fresh_camera_holder(&mut slot)
}

/// Ask the holding player's device to take a photo now ("automatic" delivery —
/// the DM presses one button instead of asking a player out loud). Returns the
/// new request number, or None when nobody holds the camera to ask.
#[tauri::command]
pub fn request_table_photo() -> Option<u64> {
    let mut slot = camera_holder().lock().unwrap();
    fresh_camera_holder(&mut slot)?;
    drop(slot);
    let mut seq = camera_request_seq().lock().unwrap();
    *seq += 1;
    Some(*seq)
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
    // Mint the PIN here rather than on the first request, so the DM Console can
    // show it the moment the listener is up.
    let _ = session_pin();

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

/// Tonight's table PIN, for the DM Console to display so the DM can read it out
/// to the table. `None` until the listener has actually bound — there is
/// nothing for a player to join before that.
#[tauri::command]
pub fn party_listener_pin() -> Option<String> {
    LISTENER_PORT.get().map(|_| session_pin().to_string())
}

/// Turns the PIN gate on or off for this run. Called by the DM Console on mount
/// with the DM's saved preference, and again whenever they flip the switch — the
/// flag lives only in memory, so that mount call is what carries the choice across
/// an app restart. See `PIN_REQUIRED`.
#[tauri::command]
pub fn set_party_pin_required(required: bool) {
    PIN_REQUIRED.store(required, Ordering::Relaxed);
}

/// Whether the gate is currently enforced, so the console can show the truth
/// rather than its own idea of it.
#[tauri::command]
pub fn party_pin_required() -> bool {
    pin_required()
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

/// Shares one battle map with every connected player device (Phase 5). The DM
/// Console calls this with `{ name, floors: [{ name, png }] }` carrying only
/// the floors the DM has revealed (see toggleFloorReveal). Replaces whatever
/// was shared before and bumps the version so players pick it up on their next
/// `GET /map` poll.
#[tauri::command]
pub fn set_broadcast_map(map: serde_json::Value) {
    let mut current = broadcast_map().lock().unwrap();
    current.version += 1;
    current.payload = Some(map);
}

/// Stops sharing the current map — players polling `GET /map` see a new version
/// with a null payload and clear their view. A no-op (no version bump) when
/// nothing is shared, so idle calls don't churn the version.
#[tauri::command]
pub fn clear_broadcast_map() {
    let mut current = broadcast_map().lock().unwrap();
    if current.payload.is_some() {
        current.version += 1;
        current.payload = None;
    }
}

/// Publishes the turn order to every connected player device. The DM Console passes an ALREADY
/// MASKED list (see maskInitiativeForPlayers) plus the round and whose turn it is.
#[tauri::command]
pub fn set_broadcast_initiative(initiative: serde_json::Value) {
    let mut current = broadcast_initiative().lock().unwrap();
    current.version += 1;
    current.payload = Some(initiative);
}

/// Combat is over: every connected player clears the order AND the initiative they rolled for it.
/// A no-op when nothing is published, so ending a fight twice doesn't churn the version.
#[tauri::command]
pub fn clear_broadcast_initiative() {
    let mut current = broadcast_initiative().lock().unwrap();
    if current.payload.is_some() {
        current.version += 1;
        current.payload = None;
    }
}

/// Character names whose devices have polled recently — the roll-call dialog's
/// "their sheet is open on the network" dot. A hint beside the manual toggle,
/// never a substitute for it (see the PRESENCE_TIMEOUT comment).
#[tauri::command]
pub fn present_players() -> Vec<String> {
    let mut seen = presence().lock().unwrap();
    fresh_presence(&mut seen)
}

/// Hands out tonight's proxy assignments: borrower name → the characters their
/// device should run. Replaces the whole map, so un-assigning is just sending a
/// map without them; the console clears it at End Session.
#[tauri::command]
pub fn set_proxy_assignments(assignments: HashMap<String, Vec<String>>) {
    let mut current = proxy_assignments().lock().unwrap();
    *current = assignments.into_iter().map(|(k, v)| (name_key(&k), v)).collect();
}

/// The sheets the DM is lending out tonight, keyed by character name. This is
/// the access control for `GET /character` — only what's pushed here can be
/// fetched — so push exactly the loaned characters and nothing else. Replaces
/// the whole map; an empty one closes the door again.
#[tauri::command]
pub fn set_shared_characters(characters: Vec<serde_json::Value>) {
    let mut current = shared_characters().lock().unwrap();
    *current = characters
        .into_iter()
        .filter_map(|c| {
            let name = c.get("name")?.as_str()?.to_string();
            if name.trim().is_empty() { return None; }
            Some((name_key(&name), c))
        })
        .collect();
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

    /// The remote-control gate defaults OFF: a DM who never opens the setting
    /// must not be controllable, the mirror image of the PIN defaulting on.
    #[test]
    fn remote_control_is_off_by_default() {
        assert!(!REMOTE_CONTROL.load(Ordering::Relaxed));
    }

    /// The action allowlist is the remote's whole surface — a rename or an
    /// accidental addition here should be a deliberate, test-visible change.
    /// v2 added roll call (mark / all-here / done).
    #[test]
    fn the_remote_has_exactly_the_buttons_it_shipped_with() {
        assert_eq!(CONTROL_ACTIONS, &[
            "stop", "recap", "end_battle", "replay",
            "roll_call_mark", "roll_call_all_here", "roll_call_done",
        ]);
    }

    /// The gate is ON unless someone turns it off. A default that shipped as
    /// `false` would leave every existing table open with nothing on screen to
    /// say so, which is the whole reason the PIN was added.
    #[test]
    fn the_pin_gate_is_on_by_default() {
        assert!(pin_required(), "PIN enforcement must default to on");
    }

    /// The DM can switch it off and back on, and the flag is what the gate reads
    /// — not a copy the console keeps. Restores the default so test order can't
    /// leak a disabled gate into another case.
    #[test]
    fn the_dm_can_turn_the_gate_off_and_on_again() {
        let original = pin_required();
        set_party_pin_required(false);
        assert!(!pin_required(), "turning it off must actually disable the gate");
        assert!(!party_pin_required(), "the console must be told the truth");
        set_party_pin_required(true);
        assert!(pin_required(), "turning it back on must re-arm the gate");
        set_party_pin_required(original);
    }

    /// Only `GET /` is exempt from the PIN. Every route that carries table data
    /// must fall through to the gate — a stray match here silently reopens the
    /// unauthenticated listener this check exists to close.
    #[test]
    fn only_the_bare_probe_skips_the_pin_gate() {
        assert!(is_reachability_probe("GET / HTTP/1.1"));
        assert!(is_reachability_probe("GET /?x=1 HTTP/1.1"));

        for line in [
            "GET /narration?since=0 HTTP/1.1",
            "GET /character?name=Mira HTTP/1.1",
            "GET /map?since=0 HTTP/1.1",
            "GET /initiative?since=0 HTTP/1.1",
            "GET /camera HTTP/1.1",
            "POST /talk HTTP/1.1",
            "POST /character HTTP/1.1",
            "POST /table-photo HTTP/1.1",
            "POST /camera-claim HTTP/1.1",
            "GET /control HTTP/1.1",
            "POST /control-claim HTTP/1.1",
            "POST /control HTTP/1.1",
        ] {
            assert!(!is_reachability_probe(line), "{line} must require the PIN");
        }
    }

    #[test]
    fn session_pin_is_stable_within_a_run_and_readable_aloud() {
        let first = session_pin();
        assert_eq!(first, session_pin(), "PIN must not change mid-session");
        assert_eq!(first.len(), 6);
        // The ambiguous glyphs are excluded on purpose — this gets spoken.
        assert!(
            first.chars().all(|c| PIN_ALPHABET.contains(&(c as u8))),
            "unexpected character in {first}"
        );
        for bad in ['O', '0', 'I', '1'] {
            assert!(!first.contains(bad), "{first} contains ambiguous {bad}");
        }
    }

    /// The comparison the gate makes, against the values it will really see.
    #[test]
    fn pin_comparison_accepts_case_but_not_near_misses() {
        let pin = session_pin().to_string();
        assert!(pin.to_lowercase().eq_ignore_ascii_case(&pin));
        assert!(!"".eq_ignore_ascii_case(&pin), "empty header must not pass");
        assert!(!format!("{pin}X").eq_ignore_ascii_case(&pin));
        assert!(!pin[..pin.len() - 1].eq_ignore_ascii_case(&pin));
    }

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

    /// Same contract as the map slot: a client on the current version gets no payload back, and a
    /// NULL payload on a new version is the "combat is over, clear everything" signal — which is
    /// the only way a player device learns to drop the initiative it rolled.
    #[test]
    fn initiative_response_follows_the_same_version_contract_as_maps() {
        let published = BroadcastInitiative {
            version: 4,
            payload: Some(serde_json::json!({ "order": ["Mira"], "round": 1, "hiddenCount": 2 })),
        };
        let current = initiative_response(&published, 4);
        assert!(current.get("initiative").is_none(), "already current: {current}");
        let behind = initiative_response(&published, 2);
        assert_eq!(behind["initiative"]["order"][0], "Mira", "{behind}");
        assert_eq!(behind["initiative"]["hiddenCount"], 2, "{behind}");

        // Combat ended: a new version whose payload is explicitly null.
        let ended = BroadcastInitiative { version: 5, payload: None };
        let r = initiative_response(&ended, 4);
        assert!(r["initiative"].is_null(), "end of combat must send an explicit null: {r}");
    }

    #[test]
    fn map_response_omits_the_payload_when_the_client_is_already_current() {
        let bm = BroadcastMap { version: 3, payload: Some(serde_json::json!({ "name": "Tower" })) };
        // Client already on v3 (or somehow ahead) → just the version, no re-send.
        let r = map_response(&bm, 3);
        assert_eq!(r["version"], 3);
        assert!(r.get("map").is_none(), "a current client must not get the heavy payload again");
    }

    #[test]
    fn map_response_sends_the_payload_when_the_client_is_behind() {
        let bm = BroadcastMap { version: 3, payload: Some(serde_json::json!({ "name": "Tower" })) };
        let r = map_response(&bm, 1);
        assert_eq!(r["version"], 3);
        assert_eq!(r["map"]["name"], "Tower");
    }

    #[test]
    fn map_response_sends_null_map_when_sharing_stopped() {
        // Version advanced but payload cleared → a behind client blanks its view.
        let bm = BroadcastMap { version: 4, payload: None };
        let r = map_response(&bm, 3);
        assert_eq!(r["version"], 4);
        assert!(r["map"].is_null(), "a new version with no payload clears the player's map");
    }

    #[test]
    fn parse_since_param_reads_the_map_poll_query() {
        assert_eq!(parse_since_param("GET /map?since=9 HTTP/1.1"), 9);
        assert_eq!(parse_since_param("GET /map HTTP/1.1"), 0, "bare /map = everything (version 0)");
    }

    /// Names reach this listener `encodeURIComponent`'d, so anything with a
    /// space — which is most character names — arrives percent-escaped. Match
    /// it raw and presence silently never registers for exactly the players
    /// whose names look like real names.
    #[test]
    fn parse_query_param_decodes_a_percent_escaped_character_name() {
        assert_eq!(
            parse_query_param("GET /narration?since=3&who=Ellara%20Moonwhisper HTTP/1.1", "who").as_deref(),
            Some("Ellara Moonwhisper")
        );
        assert_eq!(
            parse_query_param("GET /character?name=Thorin+Oakshield HTTP/1.1", "name").as_deref(),
            Some("Thorin Oakshield"),
            "+ is a space in a query string too"
        );
        assert_eq!(
            parse_query_param("GET /narration?since=3 HTTP/1.1", "who"),
            None,
            "absent param — an older player build that doesn't send `who` must still get narration"
        );
        assert_eq!(parse_query_param("GET /narration HTTP/1.1", "who"), None, "no query string at all");
        // A stray % must not panic or eat the rest of the name.
        assert_eq!(parse_query_param("GET /x?who=100%25%20Bob HTTP/1.1", "who").as_deref(), Some("100% Bob"));
        assert_eq!(parse_query_param("GET /x?who=bad%ZZ HTTP/1.1", "who").as_deref(), Some("bad%ZZ"));
    }

    /// Presence expires lazily on read, with no background timer — same shape
    /// as fresh_camera_holder. Tested through a local map rather than the
    /// global so it can't be perturbed by another test polling the listener.
    #[test]
    fn presence_drops_a_device_that_stopped_polling_and_keeps_a_live_one() {
        let mut seen: HashMap<String, std::time::Instant> = HashMap::new();
        seen.insert("ellara".into(), std::time::Instant::now());
        seen.insert(
            "thorin".into(),
            std::time::Instant::now() - (PRESENCE_TIMEOUT + Duration::from_secs(1)),
        );

        assert_eq!(fresh_presence(&mut seen), vec!["ellara".to_string()]);
        assert!(!seen.contains_key("thorin"), "a stale entry is dropped in place, not just filtered out of the answer");
    }

    /// `GET /character` has no authentication — nothing on this listener does.
    /// Its access control is entirely that the console pushes only the sheets
    /// it is deliberately lending, so an unlent name must miss even when that
    /// character is very much at the table.
    #[test]
    fn only_deliberately_shared_characters_can_be_fetched() {
        set_shared_characters(vec![
            serde_json::json!({ "name": "Ellara Moonwhisper", "maxHP": 27 }),
            serde_json::json!({ "name": "   " }),          // blank name: skipped
            serde_json::json!({ "noNameField": true }),     // malformed: skipped
        ]);

        let shared = shared_characters().lock().unwrap();
        assert!(shared.contains_key("ellara moonwhisper"), "keyed by the lowercased name");
        assert_eq!(shared.len(), 1, "blank and malformed entries must not become fetchable keys");
        assert!(!shared.contains_key("thorin oakshield"), "a character nobody lent out is not fetchable");
        drop(shared);

        // Sending a set replaces it wholesale, which is how the next roll call
        // supersedes tonight's and how the door closes again. Note End Session
        // deliberately does NOT clear this: the absent player's own device
        // still has to pull a night's worth of changes back off the DM.
        set_shared_characters(vec![]);
        assert!(shared_characters().lock().unwrap().is_empty());
    }

    /// Assignments are keyed the same way names are keyed everywhere else, so
    /// the console can send whatever casing the roster happens to hold.
    #[test]
    fn proxy_assignments_are_keyed_case_insensitively() {
        set_proxy_assignments(HashMap::from([(
            "Ana Whitlock".to_string(),
            vec!["Ellara Moonwhisper".to_string()],
        )]));

        let assigned = proxy_assignments().lock().unwrap();
        assert_eq!(assigned.get("ana whitlock").map(Vec::len), Some(1));
        drop(assigned);

        set_proxy_assignments(HashMap::new());
        assert!(proxy_assignments().lock().unwrap().is_empty(), "End Session hands back every borrowed sheet");
    }

    #[test]
    fn table_camera_is_first_come_and_cannot_be_stolen() {
        // Free → the first asker gets it.
        assert_eq!(resolve_camera_claim(None, "Ana", false, true), (Some("Ana".into()), true));
        // Held → someone else is REFUSED, and the holder is unchanged. This is
        // the whole point: two players snapping at once would race two different
        // boards into one read.
        assert_eq!(resolve_camera_claim(Some("Ana"), "Bo", false, true), (Some("Ana".into()), false));
        // The holder re-claiming is fine (that's the heartbeat that keeps a hold
        // from going stale mid-session) and is case-insensitive — but it keeps
        // the name already on record, so refreshing as "ana" doesn't rename the
        // holder everyone else sees from "Ana".
        assert_eq!(resolve_camera_claim(Some("Ana"), "ana", false, true), (Some("Ana".into()), true));
    }

    #[test]
    fn board_photos_off_refuses_the_camera_but_still_lets_a_holder_hand_it_back() {
        // Off → a free camera still can't be taken. Without this the player's app
        // shows a green "you're the camera" light and tells them a photo was
        // sent, for a photo the DM's console drops on arrival.
        assert_eq!(resolve_camera_claim(None, "Ana", false, false), (None, false));
        // ...and the current holder can't refresh either, so a hold left over
        // from before the DM switched off expires instead of living forever.
        assert_eq!(resolve_camera_claim(Some("Ana"), "Ana", false, false), (Some("Ana".into()), false));
        // But releasing always works: the role does nothing now, so refusing to
        // let go would strand them owning it.
        assert_eq!(resolve_camera_claim(Some("Ana"), "Ana", true, false), (None, true));
    }

    #[test]
    fn only_the_table_camera_holder_can_release_it() {
        // The holder hands it back → free for anyone.
        assert_eq!(resolve_camera_claim(Some("Ana"), "Ana", true, true), (None, true));
        // A non-holder releasing must NOT knock the holder off — otherwise any
        // player closing their sheet would steal the camera from whoever has it.
        assert_eq!(resolve_camera_claim(Some("Ana"), "Bo", true, true), (Some("Ana".into()), false));
        // Releasing when nobody holds it is a harmless no-op.
        assert_eq!(resolve_camera_claim(None, "Bo", true, true), (None, false));
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
