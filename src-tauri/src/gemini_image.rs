//! gemini_image.rs — Battle Map Generator manual "AI Export…" path: an
//! alternative to the local ComfyUI pass (comfyui.rs) for a DM without a
//! GPU/ComfyUI install, using Google's Gemini image-editing API instead.
//! Entirely separate from and never invoked by the automatic "AI atmosphere
//! pass on export" checkbox, which stays ComfyUI-only.
//!
//! Uses the STABLE `generateContent` REST endpoint (not the beta Interactions
//! API — Google's own docs recommend generateContent for production):
//!   `POST https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent`
//!   (v1beta, not v1 — confirmed live: v1's GenerationConfig doesn't accept
//!   responseModalities at all ("Cannot find field", tried both camelCase
//!   and snake_case); v1beta accepts the request shape and only fails on
//!   the API key, which is the correct behavior)
//!   header `x-goog-api-key: <key>`
//!   body: `contents[0].parts` = [{text: prompt}, {inline_data: {mime_type, data}}],
//!         `generationConfig.responseModalities: ["TEXT","IMAGE"]`
//!   response: `candidates[0].content.parts[]`, the image part has
//!         `inlineData: {mimeType, data}` (base64).
//!
//! Unlike ComfyUI's low-denoise img2img, there's no numeric "how much to
//! preserve" dial here — grid/layout preservation is prompt-instruction-only
//! (see GRID_PRESERVATION_PREAMBLE), which is inherently less reliable. That
//! trade-off is acceptable for a DM-triggered, one-off manual export; it's
//! why this never became the automatic default.
//!
//! The API key lives in the OS keychain (`keyring`, same crate/pattern as
//! oauth.rs's Google Drive refresh token) — never in localStorage, and never
//! sent back to the frontend once saved (only a boolean "configured" flag).

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};

const SERVICE: &str = "tavernsheet";
const ACCOUNT: &str = "gemini_api_key";
const MODEL: &str = "gemini-2.5-flash-image";
// This preamble receives the CONTENT layer only (battleMapRender.ts's
// renderBattleMapContent) — the coordinate ruler is deliberately never sent
// here; the frontend composites it back on top afterward, in code, once it
// gets the stylized image back. Testing showed asking the model to preserve
// baked-in text/grid labels through its own edit pass doesn't work reliably
// (scrambled digits, hallucinated walls) — that's not an instruction-
// following gap this preamble can fix, so it no longer tries.
const GRID_PRESERVATION_PREAMBLE: &str = "This is a Dungeons & Dragons battle map floor plan. Keep \
the exact grid layout, cell boundaries, and every element's position completely unchanged — do not \
redraw, shift, resize, or reinterpret the layout. Do not add any text, titles, labels, captions, \
or UI elements of any kind. Only apply the following stylistic/atmospheric treatment on top of it: ";

fn store_key(key: &str) -> Result<(), String> {
    keyring::Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| e.to_string())?
        .set_password(key)
        .map_err(|e| e.to_string())
}

fn read_key() -> Result<String, String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(k) => Ok(k),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

fn delete_key() -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

fn data_url_to_png_bytes(data_url: &str) -> Result<Vec<u8>, String> {
    let b64 = data_url.split_once(',').map(|(_, b)| b).unwrap_or(data_url);
    STANDARD
        .decode(b64)
        .map_err(|e| format!("Couldn't decode the map image: {e}"))
}

fn png_bytes_to_data_url(bytes: &[u8]) -> String {
    format!("data:image/png;base64,{}", STANDARD.encode(bytes))
}

/// Pulls the first inline image part out of a generateContent response.
/// Pure — testable against a hand-built fixture without a live API call.
fn extract_inline_image(resp: &Value) -> Result<(String, Vec<u8>), String> {
    let parts = resp["candidates"][0]["content"]["parts"]
        .as_array()
        .ok_or_else(|| "Gemini's response didn't include any content parts.".to_string())?;
    for part in parts {
        if let Some(inline) = part.get("inlineData").or_else(|| part.get("inline_data")) {
            let mime = inline["mimeType"]
                .as_str()
                .or_else(|| inline["mime_type"].as_str())
                .unwrap_or("image/png")
                .to_string();
            let b64 = inline["data"]
                .as_str()
                .ok_or_else(|| "Gemini's response image part had no data.".to_string())?;
            let bytes = STANDARD
                .decode(b64)
                .map_err(|e| format!("Couldn't decode Gemini's returned image: {e}"))?;
            return Ok((mime, bytes));
        }
    }
    Err("Gemini's response didn't include an edited image — it may have declined the request.".to_string())
}

fn stylize_blocking(api_key: &str, prompt: &str, png_data_url: &str) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("No Gemini API key configured — add one in the AI Export panel.".to_string());
    }
    let png = data_url_to_png_bytes(png_data_url)?;
    let full_prompt = format!("{GRID_PRESERVATION_PREAMBLE}{prompt}");
    let body = json!({
        "contents": [{
            "parts": [
                { "text": full_prompt },
                { "inline_data": { "mime_type": "image/png", "data": STANDARD.encode(&png) } }
            ]
        }],
        "generationConfig": { "responseModalities": ["TEXT", "IMAGE"] }
    });

    let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent");
    let resp = ureq::post(&url)
        .set("x-goog-api-key", api_key)
        .set("Content-Type", "application/json")
        .send_json(&body)
        .map_err(|e| match e {
            ureq::Error::Status(code, r) => {
                let text = r.into_string().unwrap_or_default();
                format!("Gemini rejected the request ({code}): {text}")
            }
            e => format!("Couldn't reach Gemini: {e}"),
        })?;
    let parsed: Value = resp
        .into_json()
        .map_err(|e| format!("Couldn't parse Gemini's response: {e}"))?;
    let (_mime, bytes) = extract_inline_image(&parsed)?;
    Ok(png_bytes_to_data_url(&bytes))
}

/// Tauri command: saves the user's Gemini API key to the OS keychain. Never
/// echoed back to the frontend afterward — see has_gemini_api_key.
#[tauri::command]
pub fn save_gemini_api_key(key: String) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("Enter a Gemini API key first.".to_string());
    }
    store_key(key.trim())
}

/// Tauri command: whether a key is currently saved — the frontend uses this
/// to show a masked "Key saved" state instead of ever reading the key itself.
#[tauri::command]
pub fn has_gemini_api_key() -> Result<bool, String> {
    Ok(!read_key()?.trim().is_empty())
}

#[tauri::command]
pub fn clear_gemini_api_key() -> Result<(), String> {
    delete_key()
}

/// Runs a Gemini image-edit pass over an already-rendered battle-map PNG (as
/// a data URL) with a DM-provided style prompt, returning the edited PNG as
/// a data URL — same output contract as comfyui.rs's comfyui_stylize_map, so
/// the frontend treats both providers identically.
///
/// `scene_context` is the map's own name/authored features, pulled from its
/// spec on the frontend (see DMConsolePage.tsx's sceneContextFor) and
/// prepended to `prompt` — without it the model has no idea what the map
/// actually depicts (a tavern, a ship deck, ...), only a generic style
/// description, and drifts toward whatever's most common in its training
/// data for "battle map."
#[tauri::command]
pub async fn gemini_stylize_map(
    prompt: String,
    png_data_url: String,
    scene_context: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let prompt = match scene_context.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            // "(reference only, do not render this as visible text)" is
            // load-bearing — see comfyui.rs's identical comment for what
            // happens without it.
            Some(ctx) => format!("Scene: {ctx} (reference only, do not render this as visible text). {prompt}"),
            None => prompt,
        };
        let key = read_key()?;
        stylize_blocking(&key, &prompt, &png_data_url)
    })
    .await
    .map_err(|e| format!("Stylize task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_inline_image_reads_camel_case_field_names() {
        let resp = json!({
            "candidates": [{
                "content": {
                    "parts": [
                        { "text": "here you go" },
                        { "inlineData": { "mimeType": "image/png", "data": STANDARD.encode(b"pngbytes") } }
                    ]
                }
            }]
        });
        let (mime, bytes) = extract_inline_image(&resp).unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(bytes, b"pngbytes");
    }

    #[test]
    fn extract_inline_image_also_accepts_snake_case_field_names() {
        let resp = json!({
            "candidates": [{
                "content": {
                    "parts": [
                        { "inline_data": { "mime_type": "image/png", "data": STANDARD.encode(b"abc") } }
                    ]
                }
            }]
        });
        let (_, bytes) = extract_inline_image(&resp).unwrap();
        assert_eq!(bytes, b"abc");
    }

    #[test]
    fn extract_inline_image_errors_when_no_image_part_present() {
        let resp = json!({
            "candidates": [{ "content": { "parts": [{ "text": "sorry, I can't do that" }] } }]
        });
        assert!(extract_inline_image(&resp).is_err());
    }

    #[test]
    fn extract_inline_image_errors_on_a_totally_malformed_response() {
        assert!(extract_inline_image(&json!({})).is_err());
    }

    #[test]
    fn stylize_blocking_rejects_an_empty_api_key() {
        let err = stylize_blocking("  ", "a prompt", "data:image/png;base64,AAAA").unwrap_err();
        assert!(err.contains("No Gemini API key configured"));
    }

    #[test]
    fn data_url_round_trips_through_png_bytes() {
        let original = png_bytes_to_data_url(b"round trip me");
        assert!(original.starts_with("data:image/png;base64,"));
        assert_eq!(data_url_to_png_bytes(&original).unwrap(), b"round trip me");
    }
}
