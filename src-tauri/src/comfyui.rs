//! comfyui.rs — Battle Map Generator Phase 2: an optional, off-by-default
//! cosmetic pass that runs the rendered battle-map tile PNG through the
//! user's own local ComfyUI (Stable Diffusion img2img) for an atmospheric
//! finish. The deterministic tile render (battleMapRender.ts) stays the DM's
//! source of truth for gameplay — this only touches the exported image, and
//! the frontend falls back to the plain tile render whenever this fails.
//!
//! Talks to ComfyUI's own HTTP API (default http://127.0.0.1:8188), same
//! ureq/blocking-command shape as local_llm.rs:
//!   1. POST /upload/image (multipart) — hands ComfyUI the rendered PNG.
//!   2. GET /object_info/CheckpointLoaderSimple — picks whichever checkpoint
//!      the user has installed; this deliberately assumes nothing about a
//!      specific SD model/name, since that's entirely the user's local setup.
//!   3. POST /prompt — queues a low-denoise img2img workflow (keeps the
//!      grid/tile layout legible under the stylization) referencing the
//!      uploaded image.
//!   4. GET /history/<id> — polls until the queued job's outputs appear.
//!   5. GET /view — downloads the finished PNG.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::Rng;
use serde_json::{json, Value};
use std::io::Read;
use std::time::{Duration, Instant};

// The rendered tile PNG this pass stylizes ALREADY has real text baked in —
// the coordinate ruler (column letters / row numbers) drawn around the
// grid's edges by renderBattleMapToCanvas (battleMapRender.ts). A blanket
// "no text" instruction would tell the model to erase exactly the labels
// the DM needs to read cells off the printed map, so this asks it to keep
// them instead of suppressing text outright.
const POSITIVE_PROMPT: &str = "top-down tabletop RPG battle map, detailed dungeon floor texture, \
atmospheric lighting, dramatic shadows, digital painting, high detail. Keep the coordinate ruler \
(the row numbers and column letters along the top and left edges) exactly as shown and fully \
legible — do not remove, blur, or redraw them. Do not add any other text, watermarks, or UI \
elements.";
const NEGATIVE_PROMPT: &str = "blurry, watermark, invented captions, extra decorative text, UI \
chrome, characters, miniatures, people, photo, distorted grid, illegible coordinate labels, \
warped geometry";
const DENOISE: f64 = 0.55;
const POLL_TIMEOUT: Duration = Duration::from_secs(90);
const POLL_INTERVAL: Duration = Duration::from_millis(1000);

fn random_client_id() -> String {
    let mut rng = rand::thread_rng();
    (0..32).map(|_| format!("{:x}", rng.gen_range(0..16))).collect()
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

fn upload_image(base: &str, png: &[u8]) -> Result<String, String> {
    let boundary = "TavernSheetComfyBoundary";
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"image\"; filename=\"battle_map.png\"\r\n",
    );
    body.extend_from_slice(b"Content-Type: image/png\r\n\r\n");
    body.extend_from_slice(png);
    body.extend_from_slice(format!("\r\n--{boundary}\r\n").as_bytes());
    body.extend_from_slice(b"Content-Disposition: form-data; name=\"overwrite\"\r\n\r\ntrue\r\n");
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

    let resp = ureq::post(&format!("{base}/upload/image"))
        .set("Content-Type", &format!("multipart/form-data; boundary={boundary}"))
        .send_bytes(&body)
        .map_err(|e| format!("Couldn't reach ComfyUI at {base} to upload the map image: {e}"))?;
    let parsed: Value = resp
        .into_json()
        .map_err(|e| format!("Couldn't parse ComfyUI's upload response: {e}"))?;
    parsed["name"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "ComfyUI's upload response didn't include an image name.".to_string())
}

/// Where the diffusion model actually lives. ComfyUI Desktop's newer model
/// families (Flux, Flux 2, ...) ship as separate UNet/CLIP/VAE files instead
/// of one merged checkpoint — `models/checkpoints` can be entirely empty on
/// an otherwise fully-installed instance, which used to make `pick_checkpoint`
/// fail outright ("no checkpoint installed") even though a perfectly good
/// model was sitting right there under `models/diffusion_models`.
enum ModelSource {
    Checkpoint(String),
    Split { unet_name: String, clip_names: Vec<String>, clip_type: String, dual_clip: bool, vae_name: String },
}

fn list_models_in_folder(base: &str, folder: &str) -> Result<Vec<String>, String> {
    let resp = ureq::get(&format!("{base}/models/{folder}"))
        .call()
        .map_err(|e| format!("Couldn't reach ComfyUI at {base}: {e}"))?;
    let parsed: Value = resp
        .into_json()
        .map_err(|e| format!("Couldn't parse ComfyUI's {folder} model list: {e}"))?;
    Ok(parsed
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default())
}

fn no_model_installed_err() -> String {
    "ComfyUI has no image model installed — add a Stable Diffusion checkpoint under \
     models/checkpoints, or a split model (diffusion model + CLIP + VAE) under \
     models/diffusion_models, models/text_encoders, and models/vae, then try again."
        .to_string()
}

fn pick_model_source(base: &str) -> Result<ModelSource, String> {
    let checkpoints = list_models_in_folder(base, "checkpoints")?;
    if let Some(name) = checkpoints.first() {
        return Ok(ModelSource::Checkpoint(name.clone()));
    }
    let unets = list_models_in_folder(base, "diffusion_models")?;
    let clips = list_models_in_folder(base, "text_encoders")?;
    let vaes = list_models_in_folder(base, "vae")?;
    let (Some(unet_name), Some(vae_name)) = (unets.first(), vaes.first()) else {
        return Err(no_model_installed_err());
    };
    if clips.is_empty() {
        return Err(no_model_installed_err());
    }
    // Best-effort family detection from the UNet filename — Flux 2 uses a
    // single text encoder via CLIPLoader(type="flux2"); Flux 1 uses a pair
    // via DualCLIPLoader(type="flux"). Good enough to auto-wire the two
    // families ComfyUI Desktop actually ships without asking the DM to
    // configure anything.
    let lower = unet_name.to_lowercase();
    let is_flux2 = lower.contains("flux2") || lower.contains("flux-2") || lower.contains("flux_2");
    let clip_type = if is_flux2 { "flux2" } else { "flux" };
    let dual_clip = !is_flux2 && clips.len() >= 2;
    Ok(ModelSource::Split {
        unet_name: unet_name.clone(),
        clip_names: clips,
        clip_type: clip_type.to_string(),
        dual_clip,
        vae_name: vae_name.clone(),
    })
}

fn build_workflow(source: &ModelSource, image_name: &str, prompt: &str, denoise: f64) -> Value {
    let seed: u64 = rand::thread_rng().gen();
    match source {
        ModelSource::Checkpoint(ckpt_name) => json!({
            "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": ckpt_name } },
            "10": { "class_type": "LoadImage", "inputs": { "image": image_name } },
            "12": { "class_type": "VAEEncode", "inputs": { "pixels": ["10", 0], "vae": ["4", 2] } },
            "6": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["4", 1], "text": prompt } },
            "7": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["4", 1], "text": NEGATIVE_PROMPT } },
            "3": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": 20,
                    "cfg": 7,
                    "sampler_name": "euler",
                    "scheduler": "normal",
                    "denoise": denoise,
                    "model": ["4", 0],
                    "positive": ["6", 0],
                    "negative": ["7", 0],
                    "latent_image": ["12", 0]
                }
            },
            "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["4", 2] } },
            "9": {
                "class_type": "SaveImage",
                "inputs": { "filename_prefix": "tavern_sheet_battle_map", "images": ["8", 0] }
            }
        }),
        ModelSource::Split { unet_name, clip_names, clip_type, dual_clip, vae_name } => {
            let clip_node = if *dual_clip {
                json!({
                    "class_type": "DualCLIPLoader",
                    "inputs": { "clip_name1": clip_names[0], "clip_name2": clip_names[1], "type": clip_type }
                })
            } else {
                json!({
                    "class_type": "CLIPLoader",
                    "inputs": { "clip_name": clip_names[0], "type": clip_type }
                })
            };
            // Flux models are guidance-distilled rather than CFG-driven: cfg
            // stays at 1.0 and strength comes from FluxGuidance instead, with
            // a zeroed-out negative (KSampler still requires one).
            json!({
                "4": { "class_type": "UNETLoader", "inputs": { "unet_name": unet_name, "weight_dtype": "default" } },
                "5": clip_node,
                "14": { "class_type": "VAELoader", "inputs": { "vae_name": vae_name } },
                "10": { "class_type": "LoadImage", "inputs": { "image": image_name } },
                "12": { "class_type": "VAEEncode", "inputs": { "pixels": ["10", 0], "vae": ["14", 0] } },
                "6": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["5", 0], "text": prompt } },
                "15": { "class_type": "FluxGuidance", "inputs": { "conditioning": ["6", 0], "guidance": 3.5 } },
                "16": { "class_type": "ConditioningZeroOut", "inputs": { "conditioning": ["6", 0] } },
                "3": {
                    "class_type": "KSampler",
                    "inputs": {
                        "seed": seed,
                        "steps": 20,
                        "cfg": 1.0,
                        "sampler_name": "euler",
                        "scheduler": "simple",
                        "denoise": denoise,
                        "model": ["4", 0],
                        "positive": ["15", 0],
                        "negative": ["16", 0],
                        "latent_image": ["12", 0]
                    }
                },
                "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["14", 0] } },
                "9": {
                    "class_type": "SaveImage",
                    "inputs": { "filename_prefix": "tavern_sheet_battle_map", "images": ["8", 0] }
                }
            })
        }
    }
}

fn queue_prompt(base: &str, workflow: Value, client_id: &str) -> Result<String, String> {
    let body = json!({ "prompt": workflow, "client_id": client_id });
    let resp = ureq::post(&format!("{base}/prompt"))
        .send_json(&body)
        .map_err(|e| match e {
            ureq::Error::Status(code, r) => {
                let text = r.into_string().unwrap_or_default();
                format!("ComfyUI rejected the workflow ({code}): {text}")
            }
            e => format!("Couldn't reach ComfyUI at {base}: {e}"),
        })?;
    let parsed: Value = resp
        .into_json()
        .map_err(|e| format!("Couldn't parse ComfyUI's queue response: {e}"))?;
    parsed["prompt_id"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "ComfyUI didn't return a prompt id.".to_string())
}

fn poll_history(base: &str, prompt_id: &str) -> Result<Value, String> {
    let deadline = Instant::now() + POLL_TIMEOUT;
    loop {
        let resp = ureq::get(&format!("{base}/history/{prompt_id}"))
            .call()
            .map_err(|e| format!("Couldn't reach ComfyUI at {base} while waiting for the render: {e}"))?;
        let parsed: Value = resp
            .into_json()
            .map_err(|e| format!("Couldn't parse ComfyUI's history response: {e}"))?;
        if let Some(entry) = parsed.get(prompt_id) {
            if entry.get("outputs").is_some() {
                return Ok(entry.clone());
            }
        }
        if Instant::now() >= deadline {
            return Err("ComfyUI didn't finish rendering within 90 seconds.".to_string());
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

fn extract_image_ref(history_entry: &Value) -> Result<(String, String, String), String> {
    let images = history_entry["outputs"]["9"]["images"]
        .as_array()
        .ok_or_else(|| "ComfyUI's result didn't include a rendered image.".to_string())?;
    let img = images
        .first()
        .ok_or_else(|| "ComfyUI's result didn't include a rendered image.".to_string())?;
    let filename = img["filename"].as_str().unwrap_or_default().to_string();
    let subfolder = img["subfolder"].as_str().unwrap_or_default().to_string();
    let img_type = img["type"].as_str().unwrap_or("output").to_string();
    if filename.is_empty() {
        return Err("ComfyUI's result didn't include a rendered image.".to_string());
    }
    Ok((filename, subfolder, img_type))
}

// Minimal query-param escaping — filenames ComfyUI hands back are plain
// alnum+underscore+dot, but escape defensively rather than assume.
fn urlencoding_light(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn fetch_view(base: &str, filename: &str, subfolder: &str, img_type: &str) -> Result<Vec<u8>, String> {
    let url = format!(
        "{base}/view?filename={}&subfolder={}&type={}",
        urlencoding_light(filename),
        urlencoding_light(subfolder),
        urlencoding_light(img_type)
    );
    let resp = ureq::get(&url)
        .call()
        .map_err(|e| format!("Couldn't download the rendered map from ComfyUI: {e}"))?;
    let mut bytes = Vec::new();
    resp.into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Couldn't read the rendered map from ComfyUI: {e}"))?;
    Ok(bytes)
}

fn stylize_blocking(base_url: &str, png_data_url: &str, prompt: &str, denoise: f64) -> Result<String, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("No ComfyUI address configured.".to_string());
    }
    let png = data_url_to_png_bytes(png_data_url)?;
    let image_name = upload_image(base, &png)?;
    let source = pick_model_source(base)?;
    let client_id = random_client_id();
    let workflow = build_workflow(&source, &image_name, prompt, denoise);
    let prompt_id = queue_prompt(base, workflow, &client_id)?;
    let history_entry = poll_history(base, &prompt_id)?;
    let (filename, subfolder, img_type) = extract_image_ref(&history_entry)?;
    let bytes = fetch_view(base, &filename, &subfolder, &img_type)?;
    Ok(png_bytes_to_data_url(&bytes))
}

/// Tauri command: runs the ComfyUI img2img atmosphere pass over an
/// already-rendered battle-map PNG (as a data URL) and returns the stylized
/// PNG, also as a data URL, so the frontend can drop it straight into the
/// same `<img>`/export path as the plain tile render (see
/// battleMapRender.ts). Errors are returned, never panics, so the caller can
/// fall back to the vector render cleanly when ComfyUI is unreachable or
/// misconfigured.
///
/// `prompt`/`denoise` are optional overrides for the manual "AI Export…"
/// path (a DM-written prompt and a chosen strength); the automatic
/// "AI atmosphere pass on export" checkbox calls this with neither, so it
/// keeps using the fixed POSITIVE_PROMPT/DENOISE defaults unchanged.
#[tauri::command]
pub async fn comfyui_stylize_map(
    base_url: String,
    png_data_url: String,
    prompt: Option<String>,
    denoise: Option<f64>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let prompt = prompt.unwrap_or_else(|| POSITIVE_PROMPT.to_string());
        let denoise = denoise.unwrap_or(DENOISE);
        stylize_blocking(&base_url, &png_data_url, &prompt, denoise)
    })
    .await
    .map_err(|e| format!("Stylize task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_url_round_trips_through_png_bytes() {
        let original = png_bytes_to_data_url(b"not really a png but fine for a round trip");
        assert!(original.starts_with("data:image/png;base64,"));
        let bytes = data_url_to_png_bytes(&original).unwrap();
        assert_eq!(bytes, b"not really a png but fine for a round trip");
    }

    #[test]
    fn data_url_to_png_bytes_rejects_garbage() {
        assert!(data_url_to_png_bytes("data:image/png;base64,not-base64!!!").is_err());
    }

    #[test]
    fn urlencoding_light_escapes_special_characters_but_leaves_safe_ones() {
        assert_eq!(urlencoding_light("battle_map.png"), "battle_map.png");
        assert_eq!(urlencoding_light("a b/c"), "a%20b%2Fc");
    }

    #[test]
    fn extract_image_ref_reads_node_9_output() {
        let entry = json!({
            "outputs": {
                "9": {
                    "images": [{ "filename": "out.png", "subfolder": "", "type": "output" }]
                }
            }
        });
        let (filename, subfolder, img_type) = extract_image_ref(&entry).unwrap();
        assert_eq!(filename, "out.png");
        assert_eq!(subfolder, "");
        assert_eq!(img_type, "output");
    }

    #[test]
    fn extract_image_ref_errors_when_no_image_present() {
        let entry = json!({ "outputs": { "9": { "images": [] } } });
        assert!(extract_image_ref(&entry).is_err());
    }

    #[test]
    fn build_workflow_wires_uploaded_image_and_checkpoint_through_the_graph() {
        let source = ModelSource::Checkpoint("my-checkpoint.safetensors".to_string());
        let wf = build_workflow(&source, "uploaded123.png", POSITIVE_PROMPT, DENOISE);
        assert_eq!(wf["4"]["inputs"]["ckpt_name"], "my-checkpoint.safetensors");
        assert_eq!(wf["10"]["inputs"]["image"], "uploaded123.png");
        assert_eq!(wf["3"]["inputs"]["denoise"], DENOISE);
        assert_eq!(wf["9"]["inputs"]["images"][0], "8");
    }

    #[test]
    fn build_workflow_uses_the_given_prompt_and_denoise_overrides() {
        let source = ModelSource::Checkpoint("ckpt.safetensors".to_string());
        let wf = build_workflow(&source, "img.png", "a custom style prompt", 0.8);
        assert_eq!(wf["6"]["inputs"]["text"], "a custom style prompt");
        assert_eq!(wf["3"]["inputs"]["denoise"], 0.8);
    }

    #[test]
    fn build_workflow_wires_a_split_flux2_model_through_clip_loader() {
        let source = ModelSource::Split {
            unet_name: "flux-2-klein-4b-fp8.safetensors".to_string(),
            clip_names: vec!["qwen_3_4b.safetensors".to_string()],
            clip_type: "flux2".to_string(),
            dual_clip: false,
            vae_name: "flux2-vae.safetensors".to_string(),
        };
        let wf = build_workflow(&source, "uploaded123.png", "a custom style prompt", 0.8);
        assert_eq!(wf["4"]["class_type"], "UNETLoader");
        assert_eq!(wf["4"]["inputs"]["unet_name"], "flux-2-klein-4b-fp8.safetensors");
        assert_eq!(wf["5"]["class_type"], "CLIPLoader");
        assert_eq!(wf["5"]["inputs"]["clip_name"], "qwen_3_4b.safetensors");
        assert_eq!(wf["5"]["inputs"]["type"], "flux2");
        assert_eq!(wf["14"]["inputs"]["vae_name"], "flux2-vae.safetensors");
        assert_eq!(wf["6"]["inputs"]["text"], "a custom style prompt");
        assert_eq!(wf["15"]["class_type"], "FluxGuidance");
        assert_eq!(wf["3"]["inputs"]["cfg"], 1.0);
        assert_eq!(wf["3"]["inputs"]["denoise"], 0.8);
        assert_eq!(wf["3"]["inputs"]["positive"][0], "15");
        assert_eq!(wf["3"]["inputs"]["negative"][0], "16");
        assert_eq!(wf["8"]["inputs"]["vae"][0], "14");
    }

    #[test]
    fn build_workflow_wires_a_split_flux1_model_through_dual_clip_loader() {
        let source = ModelSource::Split {
            unet_name: "flux1-dev.safetensors".to_string(),
            clip_names: vec!["clip_l.safetensors".to_string(), "t5xxl.safetensors".to_string()],
            clip_type: "flux".to_string(),
            dual_clip: true,
            vae_name: "ae.safetensors".to_string(),
        };
        let wf = build_workflow(&source, "uploaded123.png", POSITIVE_PROMPT, DENOISE);
        assert_eq!(wf["5"]["class_type"], "DualCLIPLoader");
        assert_eq!(wf["5"]["inputs"]["clip_name1"], "clip_l.safetensors");
        assert_eq!(wf["5"]["inputs"]["clip_name2"], "t5xxl.safetensors");
        assert_eq!(wf["5"]["inputs"]["type"], "flux");
    }

    #[test]
    fn stylize_blocking_rejects_an_empty_base_url() {
        let err = stylize_blocking("   ", "data:image/png;base64,AAAA", POSITIVE_PROMPT, DENOISE).unwrap_err();
        assert!(err.contains("No ComfyUI address configured"));
    }
}
