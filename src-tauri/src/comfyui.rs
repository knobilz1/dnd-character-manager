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
//!   3. POST /prompt — queues a low-denoise img2img workflow over the
//!      uploaded image (the content layer only — see the POSITIVE_PROMPT
//!      doc comment below for why the coordinate ruler is never part of it).
//!   4. GET /history/<id> — polls until the queued job's outputs appear.
//!   5. GET /view — downloads the finished PNG.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand::Rng;
use serde_json::{json, Value};
use std::io::Read;
use std::time::{Duration, Instant};

// The PNG this pass stylizes is the CONTENT layer only (battleMapRender.ts's
// renderBattleMapContent) — the coordinate ruler is deliberately never sent
// here. Testing against a live ComfyUI/Flux install showed img2img can't
// reliably preserve small baked-in text or thin straight lines through its
// VAE encode/decode round trip: the ruler came back as scrambled digits and,
// worse, the model hallucinated extra walls where it "reinterpreted" grid
// lines it couldn't faithfully reproduce. The frontend composites the ruler
// back on top afterward, in code, so it's pixel-exact regardless of what
// this pass does — see composeRulerFrame's doc comment in battleMapRender.ts.
// No hardcoded scene type ("dungeon", "ruins", etc.) here — the content
// layer is just abstract colored rectangles with no indication of what the
// map actually represents (a tavern, a ship deck, a forest clearing...), so
// the caller passes a `scene_context` (the map's own name/features, from
// the DM's authored spec) that gets prepended to this at request time. A
// "Barroom Brawl" map stylized with this alone came back as a generic
// ruined stone courtyard — the word "dungeon" was actively steering it
// there regardless of what the map was actually named.
const POSITIVE_PROMPT: &str = "top-down tabletop RPG battle map, detailed floor texture, \
atmospheric lighting, dramatic shadows, digital painting, high detail. Do not add any text, \
watermarks, or UI elements.";
// A battle map is a static scene the DM places tokens onto themselves —
// any people/creatures the model paints in are pure noise. NEGATIVE_PROMPT
// alone wasn't enough to reliably suppress them (confirmed live, worse with
// the ControlNet path's structural conditioning active), so this states it
// directly in the positive prompt too, appended to every stylize call
// regardless of provider/preset.
const EMPTY_ROOM_SUFFIX: &str =
    " The room is completely empty and unoccupied — no people, characters, or creatures present.";
// No "photo" here on purpose — the manual AI Export panel offers a
// "Realistic"/photorealistic style preset (see mapStylePresets.ts), and
// negating "photo" would fight that request. "characters/miniatures/people"
// already covers the real concern (a literal photo of a tabletop with
// plastic minis showing up instead of a stylized render).
const NEGATIVE_PROMPT: &str = "blurry, watermark, text, letters, numbers, title, caption, label, \
signage, UI chrome, characters, miniatures, people, soldiers, guards, adventurers, humanoid \
figures, human, isometric, 3D perspective, tilted camera angle, distorted grid, warped geometry";
// A "background" tile (floor/wall/water/rubble/stairs — see battleMapRender.ts's
// isBackgroundTile) gets stamped into every matching cell across the whole
// map, often dozens of times. Run through the same prompt as everything else,
// the model treats "high detail, dramatic shadows" as license to invent a
// discrete object to cast one (confirmed live: a wood beam painted into the
// floor swatch, repeated at literal 100% of floor cells, read as furniture
// covering the entire room). An object tile is SUPPOSED to depict one thing;
// a background tile must never contain one — it needs to look like a fabric
// swatch, not a scene. These two are appended only when the caller marks a
// tile as background (see comfyui_stylize_map's is_background).
const BACKGROUND_EXTRA_NEGATIVE: &str = ", furniture, beam, plank, wooden beam, pillar, column, door, \
statue, crate, barrel, prop, decorative object, architectural detail, discrete item, single object, \
cast shadow, directional lighting, dramatic lighting, spotlight, highlight, vignette, gradient, \
uneven lighting, light falloff";

/// Builds the prompt for a BACKGROUND material — a large expanse of floor/wall
/// the frontend slices per cell (see battleMapRender.ts's BG_TEXTURE_PX).
/// `label` names the material, so the model knows a floor from a wall instead
/// of inferring it from pixels alone. The style has its lighting words stripped
/// (see strip_lighting_wording) and flat-even lighting demanded, because this
/// one image covers many cells and any baked-in shadow repeats across them.
fn build_background_prompt(style: &str, label: &str, scene: Option<&str>) -> String {
    let style = strip_lighting_wording(style);
    let hint = scene
        .map(|s| format!(" Setting/material hint for style only, do NOT draw this as a scene: {s}."))
        .unwrap_or_default();
    format!(
        "A large, seamless, flat top-down texture of {label}. {style} It is one continuous material \
         surface edge to edge — no furniture, pillars, doors, crates or any other discrete object \
         anywhere in the frame, and nobody in it. Lit perfectly flat and evenly, with uniform \
         brightness corner to corner: no directional light, no cast shadows, no highlights, no \
         vignette, no gradient, nothing brighter or darker on one side.{hint}"
    )
}
// OBJECT tiles (door, pillar, furniture, tree, hazard) are stylized as an
// isolated PRODUCT SHOT, not as a battle-map cell. The frontend sends the
// object on a plain neutral backdrop (not floor — see battleMapRender.ts's
// renderObjectSwatch) and keys that backdrop out afterward, so the model's job
// here is purely "make one nice isolated object." build_object_prompt frames
// it that way and deliberately drops the scene/battle-map wording that made the
// model paint a whole room around the object (confirmed live: a grid of
// identical miniature rooms). The scene context is passed only as a brief
// material/style hint, explicitly flagged as "not a scene to draw."
const OBJECT_EXTRA_NEGATIVE: &str = ", room, interior, walls, wall, window, doorway, corridor, floor \
tiles, background scenery, environment, diorama, multiple objects, furniture set, perspective view, \
vanishing point, 3D room, tilted view, cropped";

/// Builds the isolated-object product-shot prompt for an object tile. `style`
/// is the DM's chosen look (preset/manual prompt, or POSITIVE_PROMPT); `label`
/// names the object ("a wooden door"); `scene`, if present, is folded in only
/// as a material/setting hint (a bar table vs a dungeon table), flagged so the
/// model doesn't render it as a scene.
/// Case-insensitive removal of every occurrence of `needle` from `haystack`.
/// Operates on bytes (the prompts are ASCII); other bytes are copied verbatim
/// so any incidental UTF-8 stays intact.
fn remove_phrase_ci(haystack: &str, needle: &str) -> String {
    let hay = haystack.as_bytes();
    let ndl = needle.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(hay.len());
    let mut i = 0;
    while i < hay.len() {
        if i + ndl.len() <= hay.len() && hay[i..i + ndl.len()].eq_ignore_ascii_case(ndl) {
            i += ndl.len();
        } else {
            out.push(hay[i]);
            i += 1;
        }
    }
    String::from_utf8(out).unwrap_or_else(|_| haystack.to_string())
}

/// Tidies dangling punctuation/whitespace left after phrase removal
/// (", ,", double spaces, a leading comma).
fn tidy_prompt(s: &str) -> String {
    let mut out = s.to_string();
    while out.contains("  ") {
        out = out.replace("  ", " ");
    }
    out = out.replace(" ,", ",");
    while out.contains(",,") {
        out = out.replace(",,", ",");
    }
    out.trim().trim_start_matches([',', ' ']).trim().to_string()
}

/// Strips map-level scene wording ("battle map", "floor texture", ...) from a
/// style prompt so it can be reused for an OBJECT. The preset/DM style is
/// written to describe a whole battle map ("...photorealistic floor texture,
/// cinematic detail..."); feeding "floor texture" into a table's prompt is a
/// mild contradiction, so the object path keeps only the look words. Background
/// tiles keep the full style unchanged (they ARE floor/wall texture).
pub(crate) fn strip_map_wording(style: &str) -> String {
    let mut s = style.to_string();
    // Longest first, so removing the full phrase doesn't leave a fragment.
    for pat in ["top-down tabletop RPG battle map", "tabletop RPG battle map", "battle map", "floor texture"] {
        s = remove_phrase_ci(&s, pat);
    }
    tidy_prompt(&s)
}

/// Strips scene-LIGHTING wording from a style prompt before it's used on a
/// BACKGROUND tile. A background swatch is stamped into every cell of its
/// material, so any directional light or shadow baked into the one swatch
/// repeats identically ~150 times and reads as wallpaper — confirmed live: at
/// high denoise "atmospheric lighting, dramatic shadows" put the same diagonal
/// shadow streak in the same corner of every single floor cell. The scene's
/// lighting and mood belong to the finished map, applied ONCE globally over the
/// composite (battleMapRender.ts's renderStylizedContentFromTiles grade pass),
/// never per tile. Object tiles keep the lighting words — each is placed once.
fn strip_lighting_wording(style: &str) -> String {
    let mut s = style.to_string();
    for pat in [
        "atmospheric lighting",
        "natural realistic lighting",
        "dramatic shadows",
        "dramatic lighting",
        "cinematic lighting",
        "cinematic detail",
        "realistic lighting",
        "natural lighting",
        "moody lighting",
        "soft lighting",
        "rim lighting",
        "volumetric light",
    ] {
        s = remove_phrase_ci(&s, pat);
    }
    tidy_prompt(&s)
}

fn build_object_prompt(style: &str, label: &str, scene: Option<&str>) -> String {
    let style = strip_map_wording(style);
    let hint = scene
        .map(|s| format!(" Setting/material hint for style only, do NOT draw this as a scene: {s}."))
        .unwrap_or_default();
    // Lead with the camera angle + the named object: diffusion models weight
    // the start of the prompt most, and "seen from straight overhead" is the
    // single most important constraint for a battle-map asset (it stops the
    // model rendering the object at its default 3/4 photography angle). Style
    // words follow; the isolation constraints and material hint come last.
    format!(
        "A direct top-down view, seen from straight overhead, of a single {label}. {style} The object \
         is centered and fills the frame on a plain flat neutral studio background — one isolated \
         object only, no room, no walls, no floor, no other objects, no scenery, no environment, no \
         3D perspective, no side view.{hint}"
    )
}

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


/// `filename` must be distinct across the two images uploaded per request
/// (content + edge map, when ControlNet is in play) — ComfyUI's upload
/// endpoint writes by name with overwrite=true, so reusing one filename for
/// both would let the second upload silently clobber the first on disk
/// before the workflow ever reads it.
fn upload_image(base: &str, png: &[u8], filename: &str) -> Result<String, String> {
    let boundary = "TavernSheetComfyBoundary";
    let mut body = Vec::new();
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!("Content-Disposition: form-data; name=\"image\"; filename=\"{filename}\"\r\n").as_bytes(),
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

/// A Flux2Fun ControlNet, if the user has installed one under
/// models/controlnet — see comfyui-flux2fun-controlnet, the third-party
/// node package this pairs with (not a stock ComfyUI node). Structural
/// guidance is opt-in: no model installed just means the plain img2img
/// workflow runs, same as before this existed.
struct ControlNetConfig<'a> {
    model_name: &'a str,
    /// A synthetic depth map (see battleMapRender.ts's renderBattleMapDepthMap)
    /// — replaced a Canny edge map here after live testing showed edges alone
    /// don't stop the model from reinterpreting a flat top-down floor plan as
    /// an oblique 3D room.
    depth_image_name: &'a str,
}

fn pick_controlnet(base: &str) -> Option<String> {
    list_models_in_folder(base, "controlnet").ok()?.into_iter().next()
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

const CONTROLNET_STRENGTH: f64 = 0.75;

fn build_workflow(
    source: &ModelSource, image_name: &str, prompt: &str, denoise: f64, controlnet: Option<&ControlNetConfig>,
    negative: &str,
) -> Value {
    let seed: u64 = rand::thread_rng().gen();
    match source {
        ModelSource::Checkpoint(ckpt_name) => json!({
            "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": ckpt_name } },
            "10": { "class_type": "LoadImage", "inputs": { "image": image_name } },
            "12": { "class_type": "VAEEncode", "inputs": { "pixels": ["10", 0], "vae": ["4", 2] } },
            "6": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["4", 1], "text": prompt } },
            "7": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["4", 1], "text": negative } },
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
            // Flux models are guidance-distilled: FluxGuidance drives how
            // strongly the positive prompt is followed, separate from cfg.
            // The common "cfg stays at 1, zero out the negative" Flux recipe
            // is deliberately NOT used here — at cfg 1 the negative branch
            // is mathematically ignored regardless of what's in it, so
            // NEGATIVE_PROMPT ("no characters/people") would silently do
            // nothing (confirmed live: hallucinated humanoid figures kept
            // appearing despite it). Using a real negative CLIPTextEncode
            // with cfg raised makes the negative prompt actually suppress
            // unwanted content — 2.0 still let people through at higher
            // denoise strengths (confirmed live), so this is 3.0, a
            // stronger "true CFG" value that trades a little quality for
            // the negative prompt actually being obeyed.
            let mut graph = json!({
                "4": { "class_type": "UNETLoader", "inputs": { "unet_name": unet_name, "weight_dtype": "default" } },
                "5": clip_node,
                "14": { "class_type": "VAELoader", "inputs": { "vae_name": vae_name } },
                "10": { "class_type": "LoadImage", "inputs": { "image": image_name } },
                "12": { "class_type": "VAEEncode", "inputs": { "pixels": ["10", 0], "vae": ["14", 0] } },
                "6": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["5", 0], "text": prompt } },
                "15": { "class_type": "FluxGuidance", "inputs": { "conditioning": ["6", 0], "guidance": 3.5 } },
                "16": { "class_type": "CLIPTextEncode", "inputs": { "clip": ["5", 0], "text": negative } },
                "3": {
                    "class_type": "KSampler",
                    "inputs": {
                        "seed": seed,
                        "steps": 20,
                        "cfg": 3.0,
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
            });

            // comfyui-flux2fun-controlnet is built specifically for the
            // Flux.2 family (single CLIPLoader) — skip it for Flux 1's
            // DualCLIPLoader path, which this node package was never
            // trained/tested against. Structural guidance keeps walls,
            // furniture, and doors locked to the source layout regardless
            // of denoise, instead of the model freely reinterpreting them
            // (confirmed live: without this, higher denoise both
            // relocated furniture and occasionally invented new walls).
            if let (false, Some(cn)) = (*dual_clip, controlnet) {
                graph["17"] = json!({ "class_type": "LoadImage", "inputs": { "image": cn.depth_image_name } });
                graph["18"] = json!({
                    "class_type": "Flux2FunControlNetLoader",
                    "inputs": { "controlnet_name": cn.model_name }
                });
                graph["19"] = json!({
                    "class_type": "Flux2FunControlNetApply",
                    "inputs": {
                        "conditioning": ["15", 0],
                        "controlnet": ["18", 0],
                        "vae": ["14", 0],
                        "strength": CONTROLNET_STRENGTH,
                        "control_image": ["17", 0]
                    }
                });
                // Flux2FunControlNetApply's CONDITIONING output isn't
                // compatible with the classic KSampler node — confirmed
                // live: "'ControlNetWrapper' object has no attribute
                // 'multigpu_clones'". The node package's own example only
                // ever runs it through ComfyUI's newer split guider/sampler
                // pipeline, so the ControlNet path swaps KSampler out for
                // that (CFGGuider still carries the same negative-prompt
                // mechanism this file relies on elsewhere). cfg is higher
                // here than the plain KSampler path's 3.0 — confirmed live
                // that ControlNet's structural conditioning fights negative-
                // prompt suppression harder than the base model alone (more
                // hallucinated people came through at cfg 3.0 with
                // ControlNet active than without it), so this path needs
                // more negative-conditioning weight to land at a similar
                // suppression rate.
                graph["20"] = json!({
                    "class_type": "CFGGuider",
                    "inputs": { "model": ["4", 0], "positive": ["19", 0], "negative": ["16", 0], "cfg": 5.0 }
                });
                graph["21"] = json!({ "class_type": "KSamplerSelect", "inputs": { "sampler_name": "euler" } });
                graph["22"] = json!({
                    "class_type": "BasicScheduler",
                    "inputs": { "model": ["4", 0], "scheduler": "simple", "steps": 20, "denoise": denoise }
                });
                graph["23"] = json!({ "class_type": "RandomNoise", "inputs": { "noise_seed": seed } });
                graph["24"] = json!({
                    "class_type": "SamplerCustomAdvanced",
                    "inputs": {
                        "noise": ["23", 0], "guider": ["20", 0], "sampler": ["21", 0],
                        "sigmas": ["22", 0], "latent_image": ["12", 0]
                    }
                });
                graph.as_object_mut().unwrap().remove("3");
                graph["8"]["inputs"]["samples"] = json!(["24", 0]);
            }
            graph
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

fn stylize_blocking(
    base_url: &str, png_data_url: &str, prompt: &str, denoise: f64, depth_map_data_url: Option<&str>,
    negative: &str,
) -> Result<String, String> {
    let base = base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("No ComfyUI address configured.".to_string());
    }
    let png = data_url_to_png_bytes(png_data_url)?;
    let image_name = upload_image(base, &png, "battle_map.png")?;
    let source = pick_model_source(base)?;
    let controlnet_model = pick_controlnet(base);
    let controlnet_upload = controlnet_model
        .zip(depth_map_data_url)
        .map(|(model_name, depth_map_url)| -> Result<(String, String), String> {
            let depth_png = data_url_to_png_bytes(depth_map_url)?;
            let depth_image_name = upload_image(base, &depth_png, "battle_map_depth.png")?;
            Ok((model_name, depth_image_name))
        })
        .transpose()?;
    let controlnet = controlnet_upload
        .as_ref()
        .map(|(model_name, depth_image_name)| ControlNetConfig { model_name, depth_image_name });
    let client_id = random_client_id();
    let workflow = build_workflow(&source, &image_name, prompt, denoise, controlnet.as_ref(), negative);
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
///
/// `scene_context` is the map's own name/authored features (e.g. `"Barroom
/// Brawl" — Bar at A2; Fire pit at E7`), pulled from its spec on the
/// frontend — see DMConsolePage.tsx's sceneContextFor. Prepended to
/// whichever prompt is used, since neither POSITIVE_PROMPT nor a DM's style
/// preset says anything about what the map actually depicts.
///
/// `depth_map_data_url` (see battleMapRender.ts's renderBattleMapDepthMap)
/// is used as ControlNet structural guidance when a controlnet model is
/// installed; ignored otherwise.
///
/// `is_background` splits the two paths. `Some(false)` = a discrete-object tile
/// (door, pillar, furniture, tree, hazard): the frontend sent the object on a
/// plain neutral backdrop and will key it out, so this builds an isolated
/// product-shot prompt (see build_object_prompt) with NO scene/battle-map
/// framing and no denoise cap — that framing is what made the model paint a
/// whole room around the object. `Some(true)` = a background/material tile
/// (floor, wall, water, rubble, stairs) that repeats into many cells: kept a
/// seamless texture with scene context, extra reinforcement, and a denoise cap.
/// `None` = legacy/unclassified: the old scene-context flow.
///
/// `tile_label` names the object for the product-shot prompt ("a wooden door");
/// `scene_context` is the map's authored features, used as scene framing for
/// backgrounds and only as a brief material hint for objects. `depth_map_data_url`
/// drives ControlNet for backgrounds; objects send none.
#[tauri::command]
pub async fn comfyui_stylize_map(
    base_url: String,
    png_data_url: String,
    prompt: Option<String>,
    denoise: Option<f64>,
    scene_context: Option<String>,
    depth_map_data_url: Option<String>,
    is_background: Option<bool>,
    tile_label: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let style = prompt.unwrap_or_else(|| POSITIVE_PROMPT.to_string());
        let scene = scene_context.as_deref().map(str::trim).filter(|s| !s.is_empty());
        let denoise = denoise.unwrap_or(DENOISE);

        if is_background == Some(false) {
            // OBJECT: isolated product shot, no scene/battle-map framing, no cap.
            let label = tile_label.as_deref().unwrap_or("object");
            let prompt = build_object_prompt(&style, label, scene);
            let negative = format!("{NEGATIVE_PROMPT}{OBJECT_EXTRA_NEGATIVE}");
            return stylize_blocking(
                &base_url, &png_data_url, &prompt, denoise, depth_map_data_url.as_deref(), &negative,
            );
        }

        if is_background == Some(true) {
            // BACKGROUND: a large flat expanse of one named material.
            let label = tile_label.as_deref().unwrap_or("a stone floor");
            let prompt = build_background_prompt(&style, label, scene);
            let negative = format!("{NEGATIVE_PROMPT}{BACKGROUND_EXTRA_NEGATIVE}");
            return stylize_blocking(
                &base_url, &png_data_url, &prompt, denoise, depth_map_data_url.as_deref(), &negative,
            );
        }

        // Unclassified/legacy caller: scene-context + empty-room framing.
        let mut prompt = style;
        if let Some(ctx) = scene {
            // "(reference only, do not render this as visible text)" is load-
            // bearing — without it, a scene description containing coordinate-
            // shaped tokens got painted onto the map as a garbled title and
            // floating labels (confirmed live), the model apparently reading
            // them as annotations to reproduce rather than context to infer from.
            prompt = format!("Scene: {ctx} (reference only, do not render this as visible text). {prompt}");
        }
        prompt.push_str(EMPTY_ROOM_SUFFIX);
        stylize_blocking(&base_url, &png_data_url, &prompt, denoise, depth_map_data_url.as_deref(), NEGATIVE_PROMPT)
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
        let wf = build_workflow(&source, "uploaded123.png", POSITIVE_PROMPT, DENOISE, None, NEGATIVE_PROMPT);
        assert_eq!(wf["4"]["inputs"]["ckpt_name"], "my-checkpoint.safetensors");
        assert_eq!(wf["10"]["inputs"]["image"], "uploaded123.png");
        assert_eq!(wf["3"]["inputs"]["denoise"], DENOISE);
        assert_eq!(wf["9"]["inputs"]["images"][0], "8");
    }

    #[test]
    fn build_workflow_uses_the_given_prompt_and_denoise_overrides() {
        let source = ModelSource::Checkpoint("ckpt.safetensors".to_string());
        let wf = build_workflow(&source, "img.png", "a custom style prompt", 0.8, None, NEGATIVE_PROMPT);
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
        let wf = build_workflow(&source, "uploaded123.png", "a custom style prompt", 0.8, None, NEGATIVE_PROMPT);
        assert_eq!(wf["4"]["class_type"], "UNETLoader");
        assert_eq!(wf["4"]["inputs"]["unet_name"], "flux-2-klein-4b-fp8.safetensors");
        assert_eq!(wf["5"]["class_type"], "CLIPLoader");
        assert_eq!(wf["5"]["inputs"]["clip_name"], "qwen_3_4b.safetensors");
        assert_eq!(wf["5"]["inputs"]["type"], "flux2");
        assert_eq!(wf["14"]["inputs"]["vae_name"], "flux2-vae.safetensors");
        assert_eq!(wf["6"]["inputs"]["text"], "a custom style prompt");
        assert_eq!(wf["15"]["class_type"], "FluxGuidance");
        assert_eq!(wf["16"]["class_type"], "CLIPTextEncode");
        assert_eq!(wf["16"]["inputs"]["text"], NEGATIVE_PROMPT);
        assert_eq!(wf["3"]["inputs"]["cfg"], 3.0);
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
        let wf = build_workflow(&source, "uploaded123.png", POSITIVE_PROMPT, DENOISE, None, NEGATIVE_PROMPT);
        assert_eq!(wf["5"]["class_type"], "DualCLIPLoader");
        assert_eq!(wf["5"]["inputs"]["clip_name1"], "clip_l.safetensors");
        assert_eq!(wf["5"]["inputs"]["clip_name2"], "t5xxl.safetensors");
        assert_eq!(wf["5"]["inputs"]["type"], "flux");
    }

    #[test]
    fn build_workflow_wires_a_controlnet_through_the_modern_sampler_pipeline_for_flux2_only() {
        let flux2 = ModelSource::Split {
            unet_name: "flux-2-klein-4b-fp8.safetensors".to_string(),
            clip_names: vec!["qwen_3_4b.safetensors".to_string()],
            clip_type: "flux2".to_string(),
            dual_clip: false,
            vae_name: "flux2-vae.safetensors".to_string(),
        };
        let cn = ControlNetConfig {
            model_name: "FLUX.2-dev-Fun-Controlnet-Union.safetensors",
            depth_image_name: "depth123.png",
        };
        let wf = build_workflow(&flux2, "uploaded123.png", POSITIVE_PROMPT, 0.8, Some(&cn), NEGATIVE_PROMPT);
        assert_eq!(wf["18"]["class_type"], "Flux2FunControlNetLoader");
        assert_eq!(wf["18"]["inputs"]["controlnet_name"], "FLUX.2-dev-Fun-Controlnet-Union.safetensors");
        assert_eq!(wf["17"]["inputs"]["image"], "depth123.png");
        assert_eq!(wf["19"]["class_type"], "Flux2FunControlNetApply");
        assert_eq!(wf["19"]["inputs"]["conditioning"][0], "15");
        assert_eq!(wf["19"]["inputs"]["control_image"][0], "17");
        // Classic KSampler (node "3") is dropped entirely for this path —
        // Flux2FunControlNetApply's output isn't compatible with it — in
        // favor of CFGGuider + SamplerCustomAdvanced, which still carries
        // the real negative prompt through at the same cfg.
        assert!(wf.get("3").is_none());
        assert_eq!(wf["20"]["class_type"], "CFGGuider");
        assert_eq!(wf["20"]["inputs"]["positive"][0], "19");
        assert_eq!(wf["20"]["inputs"]["negative"][0], "16");
        assert_eq!(wf["20"]["inputs"]["cfg"], 5.0);
        assert_eq!(wf["22"]["class_type"], "BasicScheduler");
        assert_eq!(wf["22"]["inputs"]["denoise"], 0.8);
        assert_eq!(wf["24"]["class_type"], "SamplerCustomAdvanced");
        assert_eq!(wf["24"]["inputs"]["guider"][0], "20");
        assert_eq!(wf["24"]["inputs"]["latent_image"][0], "12");
        assert_eq!(wf["8"]["inputs"]["samples"][0], "24");

        // Flux 1 (dual CLIP) skips the ControlNet entirely — the node
        // package is Flux.2-specific and untested against Flux 1 — and
        // keeps the classic KSampler path unchanged.
        let flux1 = ModelSource::Split {
            unet_name: "flux1-dev.safetensors".to_string(),
            clip_names: vec!["clip_l.safetensors".to_string(), "t5xxl.safetensors".to_string()],
            clip_type: "flux".to_string(),
            dual_clip: true,
            vae_name: "ae.safetensors".to_string(),
        };
        let wf1 = build_workflow(&flux1, "uploaded123.png", POSITIVE_PROMPT, DENOISE, Some(&cn), NEGATIVE_PROMPT);
        assert!(wf1.get("18").is_none());
        assert_eq!(wf1["3"]["class_type"], "KSampler");
        assert_eq!(wf1["3"]["inputs"]["positive"][0], "15");
        assert_eq!(wf1["8"]["inputs"]["samples"][0], "3");
    }

    #[test]
    fn build_object_prompt_frames_an_isolated_product_shot_without_scene_words() {
        let p = build_object_prompt("photorealistic, dramatic lighting.", "wooden table", Some("Bar; Fire pit"));
        // Leads with the camera angle + the named object, applies the style,
        // forbids a room/scene, and folds scene in only as a flagged material
        // hint — never as something to render.
        assert!(p.starts_with("A direct top-down view"));
        assert!(p.contains("a single wooden table"));
        assert!(p.contains("photorealistic, dramatic lighting."));
        assert!(p.contains("no room"));
        assert!(p.contains("isolated object"));
        assert!(p.contains("do NOT draw this as a scene"));
        assert!(p.contains("Bar; Fire pit"));
    }

    #[test]
    fn build_object_prompt_omits_the_hint_when_there_is_no_scene() {
        let p = build_object_prompt("anime style.", "barrel", None);
        assert!(p.contains("a single barrel"));
        assert!(!p.contains("hint"));
    }

    #[test]
    fn strip_map_wording_drops_scene_nouns_but_keeps_the_look_words() {
        let realistic = "top-down tabletop RPG battle map, photorealistic floor texture, natural \
                         realistic lighting, physically accurate materials and wear, cinematic detail.";
        let s = strip_map_wording(realistic);
        // The map-level nouns are gone...
        assert!(!s.to_lowercase().contains("battle map"));
        assert!(!s.to_lowercase().contains("floor texture"));
        // ...but the style adjectives that describe the LOOK survive.
        assert!(s.contains("photorealistic"));
        assert!(s.contains("natural realistic lighting"));
        assert!(s.contains("cinematic detail"));
        // No dangling leading comma from the removal.
        assert!(!s.starts_with(','));
        assert!(!s.starts_with(' '));
    }

    #[test]
    fn build_object_prompt_scrubs_floor_texture_from_the_object_style() {
        let p = build_object_prompt(
            "top-down tabletop RPG battle map, photorealistic floor texture, cinematic detail.",
            "wooden table",
            None,
        );
        assert!(!p.to_lowercase().contains("floor texture"));
        assert!(!p.to_lowercase().contains("battle map"));
        assert!(p.contains("photorealistic"));
        assert!(p.contains("a single wooden table"));
    }

    #[test]
    fn strip_lighting_wording_keeps_the_material_but_drops_per_tile_lighting() {
        let realistic = "top-down tabletop RPG battle map, photorealistic floor texture, natural \
                         realistic lighting, physically accurate materials and wear, cinematic detail.";
        let s = strip_lighting_wording(realistic);
        // Lighting words are gone — baked into a repeating tile they'd stamp the
        // same shadow into all ~150 cells of that material.
        assert!(!s.to_lowercase().contains("lighting"));
        assert!(!s.to_lowercase().contains("cinematic detail"));
        // ...but what the surface is MADE of survives, which is the whole point
        // of stylizing it at all.
        assert!(s.contains("photorealistic"));
        assert!(s.contains("physically accurate materials and wear"));
        assert!(!s.starts_with(','));
    }

    #[test]
    fn build_background_prompt_names_the_material_and_demands_flat_even_lighting() {
        let p = build_background_prompt(
            "photorealistic, dramatic shadows, cinematic detail.",
            "plain floor",
            Some("Bar; Fire pit"),
        );
        // Names the material, so the model knows a floor from a wall.
        assert!(p.contains("texture of plain floor"));
        assert!(p.contains("photorealistic"));
        // This one image covers many cells, so any baked-in lighting would
        // repeat across them — the style's lighting words are stripped and
        // flat even lighting demanded instead.
        assert!(!p.to_lowercase().contains("dramatic shadows"));
        assert!(p.contains("no cast shadows"));
        assert!(p.contains("seamless"));
        // Scene stays a style hint only, never something to draw.
        assert!(p.contains("do NOT draw this as a scene"));
    }

    #[test]
    fn stylize_blocking_rejects_an_empty_base_url() {
        let err = stylize_blocking("   ", "data:image/png;base64,AAAA", POSITIVE_PROMPT, DENOISE, None, NEGATIVE_PROMPT).unwrap_err();
        assert!(err.contains("No ComfyUI address configured"));
    }
}
