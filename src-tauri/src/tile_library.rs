//! tile_library.rs — an OPTIONAL, user-imported local catalog of battle-map
//! art (e.g. a Forgotten Adventures Patreon asset pack), used to resolve the
//! free-object placements in a map spec's `Objects:` section (see
//! campaign.rs's `build_battle_maps_prompt` and battleMapRender.ts's
//! `preloadMapObjectSprites`).
//!
//! This deliberately never touches git or the Tauri resource bundle. Vendor
//! packs like Forgotten Adventures keep ownership of their art, and even
//! their paid commercial tier excludes software products — bundling these
//! files into a public installer isn't a license this app can rely on. So
//! the source folder stays wherever the user put it on disk, and the only
//! thing persisted here is a small JSON manifest (filenames + derived
//! metadata) at `app_data_dir/tile_library/manifest.json` — never the art
//! itself. `search_tile_catalog` reads the handful of matched files straight
//! off disk per call and returns them as data URLs, so nothing needs the
//! Tauri asset-protocol scope widened for an arbitrary user folder.
//!
//! With nothing imported (the default, and every install before this
//! feature), `tile_library_configured` is false, campaign.rs never asks the
//! model for an `Objects:` section, and every command here degrades to
//! "nothing found" — zero behavior change.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const IMAGE_EXTS: &[&str] = &["webp", "png", "jpg", "jpeg"];
/// How many candidate matches `search_tile_catalog` reads off disk and
/// base64-encodes per query — small on purpose, this runs once per unique
/// Objects: label per map render, not per file in the catalog.
const SEARCH_LIMIT: usize = 3;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TileLibraryEntry {
    pub rel_path: String,
    pub biome: String,
    pub category: String,
    pub keywords: Vec<String>,
    pub w: u32,
    pub h: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct TileLibraryManifest {
    root: String,
    entries: Vec<TileLibraryEntry>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct TileLibrarySummary {
    pub root: String,
    pub total: usize,
    pub by_category: HashMap<String, usize>,
}

#[derive(Serialize, Clone, Debug)]
pub struct TileCatalogMatch {
    pub rel_path: String,
    pub w: u32,
    pub h: u32,
    pub data_url: String,
}

/// Tauri-managed state — the manifest is read from disk at most once per app
/// run (or right after a fresh Import), then served from memory.
#[derive(Default)]
pub struct TileLibraryState {
    manifest: Mutex<Option<TileLibraryManifest>>,
}

fn manifest_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Couldn't resolve app data dir: {e}"))?
        .join("tile_library")
        .join("manifest.json"))
}

/// Cheap existence check, no manifest load — whether ANY tile library has
/// been imported. This is what campaign.rs's map-generation prompt builder
/// calls to decide whether to even mention the `Objects:` section.
pub fn tile_library_configured(app: &AppHandle) -> bool {
    manifest_path(app).map(|p| p.exists()).unwrap_or(false)
}

// ── Filename → catalog entry (pure, unit-tested directly) ───────────────────

/// Splits a stem's trailing `_<N>x<M>` footprint token off, if present, e.g.
/// `"Tree_Yellow_D8_3x3"` → `("Tree_Yellow_D8", 3, 3)`. Forgotten Adventures'
/// own convention: a `1x1` file is one 5ft grid square. Falls back to
/// `(stem, 1, 1)` for plain textures with no size suffix at all.
fn split_footprint(stem: &str) -> (&str, u32, u32) {
    if let Some(idx) = stem.rfind('_') {
        let tail = &stem[idx + 1..];
        if let Some(x_idx) = tail.find(['x', 'X']) {
            let (w_str, h_str) = (&tail[..x_idx], &tail[x_idx + 1..]);
            let both_numeric = !w_str.is_empty() && !h_str.is_empty() && w_str.bytes().all(|b| b.is_ascii_digit()) && h_str.bytes().all(|b| b.is_ascii_digit());
            if both_numeric {
                if let (Ok(w), Ok(h)) = (w_str.parse(), h_str.parse()) {
                    return (&stem[..idx], w, h);
                }
            }
        }
    }
    (stem, 1, 1)
}

/// True for a short "which copy" token like `"A10"`/`"D3"` (a letter run
/// then a digit run, length <= 4) — names WHICH instance of an asset this
/// is, not what it depicts, so it's noise for keyword search.
fn is_variant_token(tok: &str) -> bool {
    if tok.is_empty() || tok.len() > 4 {
        return false;
    }
    let letters = tok.chars().take_while(|c| c.is_ascii_alphabetic()).count();
    letters > 0 && letters < tok.len() && tok[letters..].bytes().all(|b| b.is_ascii_digit())
}

/// Lowercased, filtered filename tokens for keyword search — the footprint
/// suffix is already gone (see split_footprint) and variant-id tokens (see
/// is_variant_token) are dropped.
fn keywords_from_stem(stem_without_size: &str) -> Vec<String> {
    stem_without_size.split('_').filter(|t| !t.is_empty() && !is_variant_token(t)).map(|t| t.to_lowercase()).collect()
}

/// (biome, category) from a path relative to the imported root. Forgotten
/// Adventures' own layout is `.../FA_Assets(_Webp)/<Biome>/<Category>/...` —
/// verified against the real pack this session — so the segment right after
/// one starting with `FA_Assets` is the biome, the next one the category.
/// Falls back to "the first two segments under the root" for any other
/// vendor's pack, so this isn't hard-coded to one source.
fn biome_category_from_rel(rel: &Path) -> (String, String) {
    let parts: Vec<&str> = rel.components().filter_map(|c| match c { Component::Normal(s) => s.to_str(), _ => None }).collect();
    if let Some(i) = parts.iter().position(|p| p.starts_with("FA_Assets")) {
        return (parts.get(i + 1).copied().unwrap_or("misc").to_string(), parts.get(i + 2).copied().unwrap_or("misc").to_string());
    }
    (parts.first().copied().unwrap_or("misc").to_string(), parts.get(1).copied().unwrap_or("misc").to_string())
}

/// Pure: one entry from a root-relative file path, or `None` if it's not an
/// image file this catalog indexes.
fn parse_entry(rel: &Path) -> Option<TileLibraryEntry> {
    let ext = rel.extension()?.to_str()?.to_lowercase();
    if !IMAGE_EXTS.contains(&ext.as_str()) {
        return None;
    }
    let stem = rel.file_stem()?.to_str()?;
    let (stem_no_size, w, h) = split_footprint(stem);
    let (biome, category) = biome_category_from_rel(rel);
    let mut keywords = keywords_from_stem(stem_no_size);
    keywords.push(biome.to_lowercase());
    keywords.push(category.to_lowercase());
    Some(TileLibraryEntry { rel_path: rel.to_string_lossy().replace('\\', "/"), biome, category, keywords, w, h })
}

fn scan_dir(root: &Path, dir: &Path, out: &mut Vec<TileLibraryEntry>) {
    let Ok(read) = fs::read_dir(dir) else { return };
    for entry in read.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_dir(root, &path, out);
        } else if let Ok(rel) = path.strip_prefix(root) {
            if let Some(e) = parse_entry(rel) {
                out.push(e);
            }
        }
    }
}

fn scan_tile_library(root: &Path) -> Vec<TileLibraryEntry> {
    let mut out = Vec::new();
    scan_dir(root, root, &mut out);
    out
}

fn summarize(manifest: &TileLibraryManifest) -> TileLibrarySummary {
    let mut by_category: HashMap<String, usize> = HashMap::new();
    for e in &manifest.entries {
        *by_category.entry(e.category.clone()).or_insert(0) += 1;
    }
    TileLibrarySummary { root: manifest.root.clone(), total: manifest.entries.len(), by_category }
}

fn save_manifest(app: &AppHandle, manifest: &TileLibraryManifest) -> Result<(), String> {
    let path = manifest_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(manifest).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

fn load_manifest_cached(app: &AppHandle) -> Result<Option<TileLibraryManifest>, String> {
    let state = app.state::<TileLibraryState>();
    if let Some(cached) = state.manifest.lock().unwrap().clone() {
        return Ok(Some(cached));
    }
    let path = manifest_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let manifest: TileLibraryManifest = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    *state.manifest.lock().unwrap() = Some(manifest.clone());
    Ok(Some(manifest))
}

// ── Search (pure scoring, unit-tested directly) ──────────────────────────────

fn tokenize_query(q: &str) -> Vec<String> {
    q.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|t| t.len() >= 3).map(|t| t.to_string()).collect()
}

/// Overlap count between a query's tokens and an entry's keywords —
/// substring match both directions so "table" matches a keyword of "tables"
/// and vice versa. Simple on purpose: there's no need for real ranking when
/// the catalog's own filenames are this descriptive.
fn score(entry: &TileLibraryEntry, query_tokens: &[String]) -> u32 {
    query_tokens.iter().filter(|qt| entry.keywords.iter().any(|k| k.contains(qt.as_str()) || qt.contains(k.as_str()))).count() as u32
}

fn to_data_url(bytes: &[u8], ext: &str) -> String {
    let mime = match ext.to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        _ => "image/webp",
    };
    format!("data:{mime};base64,{}", STANDARD.encode(bytes))
}

// ── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn import_tile_library(app: AppHandle, root: String) -> Result<TileLibrarySummary, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("\"{root}\" isn't a folder."));
    }
    let entries = scan_tile_library(&root_path);
    if entries.is_empty() {
        return Err(format!("No image files found under \"{root}\"."));
    }
    let manifest = TileLibraryManifest { root: root.clone(), entries };
    save_manifest(&app, &manifest)?;
    let summary = summarize(&manifest);
    *app.state::<TileLibraryState>().manifest.lock().unwrap() = Some(manifest);
    Ok(summary)
}

#[tauri::command]
pub fn get_tile_library_summary(app: AppHandle) -> Result<Option<TileLibrarySummary>, String> {
    Ok(load_manifest_cached(&app)?.as_ref().map(summarize))
}

/// Keyword search over the imported catalog — resolves an `Objects:` label
/// like "round wooden dining table" to real files, reading and base64-
/// encoding just the top matches (see SEARCH_LIMIT). Returns an empty list
/// (not an error) when no library is imported, so the renderer's fallback
/// (draw nothing extra) is the same code path either way.
#[tauri::command]
pub fn search_tile_catalog(app: AppHandle, query: String) -> Result<Vec<TileCatalogMatch>, String> {
    let Some(manifest) = load_manifest_cached(&app)? else { return Ok(Vec::new()) };
    let tokens = tokenize_query(&query);
    if tokens.is_empty() {
        return Ok(Vec::new());
    }
    let mut scored: Vec<(u32, &TileLibraryEntry)> = manifest.entries.iter().map(|e| (score(e, &tokens), e)).filter(|(s, _)| *s > 0).collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    let root = Path::new(&manifest.root);
    let out: Vec<TileCatalogMatch> = scored
        .into_iter()
        .take(SEARCH_LIMIT)
        .filter_map(|(_, e)| {
            let bytes = fs::read(root.join(&e.rel_path)).ok()?;
            let ext = Path::new(&e.rel_path).extension()?.to_str()?;
            Some(TileCatalogMatch { rel_path: e.rel_path.clone(), w: e.w, h: e.h, data_url: to_data_url(&bytes, ext) })
        })
        .collect();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_footprint_reads_a_real_footprint_suffix() {
        assert_eq!(split_footprint("Tree_Yellow_D8_3x3"), ("Tree_Yellow_D8", 3, 3));
        assert_eq!(split_footprint("Adornments_Furniture_Corner_Metal_Black_A10_1x1"), ("Adornments_Furniture_Corner_Metal_Black_A10", 1, 1));
        assert_eq!(split_footprint("Arranged_Furniture_Wood_Walnut_A1_2x3"), ("Arranged_Furniture_Wood_Walnut_A1", 2, 3));
    }

    #[test]
    fn split_footprint_defaults_to_1x1_for_a_plain_texture_name() {
        assert_eq!(split_footprint("Brick_Floor_A_01"), ("Brick_Floor_A_01", 1, 1));
        assert_eq!(split_footprint("Brick_Dirt_A"), ("Brick_Dirt_A", 1, 1));
    }

    #[test]
    fn is_variant_token_matches_a_letter_plus_digits_but_not_a_real_word() {
        assert!(is_variant_token("A10"));
        assert!(is_variant_token("D8"));
        assert!(!is_variant_token("Metal"));
        assert!(!is_variant_token("Black"));
        assert!(!is_variant_token(""));
    }

    #[test]
    fn keywords_from_stem_drops_variant_tokens_and_lowercases() {
        let kws = keywords_from_stem("Adornments_Furniture_Corner_Metal_Black_A10");
        assert_eq!(kws, vec!["adornments", "furniture", "corner", "metal", "black"]);
    }

    #[test]
    fn biome_category_from_rel_reads_the_fa_assets_layout() {
        let rel = Path::new("FA_Assets_Webp/Woodlands/!Wilderness/Flora/Trees/Tree_Yellow_D8_3x3.webp");
        assert_eq!(biome_category_from_rel(rel), ("Woodlands".to_string(), "!Wilderness".to_string()));
    }

    #[test]
    fn biome_category_from_rel_falls_back_for_a_non_fa_layout() {
        let rel = Path::new("Dungeon/Furniture/table_01.png");
        assert_eq!(biome_category_from_rel(rel), ("Dungeon".to_string(), "Furniture".to_string()));
    }

    #[test]
    fn parse_entry_builds_a_full_entry_from_a_real_fa_path() {
        let rel = Path::new("FA_Assets_Webp/!Core_Settlements/Furniture/Tables/Table_Round_Wood_A1_2x2.webp");
        let entry = parse_entry(rel).unwrap();
        assert_eq!(entry.w, 2);
        assert_eq!(entry.h, 2);
        assert_eq!(entry.biome, "!Core_Settlements");
        assert_eq!(entry.category, "Furniture");
        assert!(entry.keywords.contains(&"table".to_string()));
        assert!(entry.keywords.contains(&"round".to_string()));
        assert!(entry.keywords.contains(&"wood".to_string()));
    }

    #[test]
    fn parse_entry_skips_a_non_image_file() {
        assert!(parse_entry(Path::new("FA_Assets_Webp/Woodlands/readme.txt")).is_none());
        assert!(parse_entry(Path::new("Copyright.url")).is_none());
    }

    #[test]
    fn score_counts_overlapping_tokens_case_and_pluralization_insensitively() {
        let entry = TileLibraryEntry {
            rel_path: "x".into(),
            biome: "Woodlands".into(),
            category: "Furniture".into(),
            keywords: vec!["round".into(), "wooden".into(), "table".into()],
            w: 2,
            h: 2,
        };
        assert_eq!(score(&entry, &tokenize_query("round wooden dining table")), 3);
        assert_eq!(score(&entry, &tokenize_query("tables")), 1);
        assert_eq!(score(&entry, &tokenize_query("campfire")), 0);
    }

    #[test]
    fn tokenize_query_drops_short_words() {
        assert_eq!(tokenize_query("a Round Table"), vec!["round".to_string(), "table".to_string()]);
    }
}
