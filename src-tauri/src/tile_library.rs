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
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

const IMAGE_EXTS: &[&str] = &["webp", "png", "jpg", "jpeg"];
/// How many candidate matches `search_tile_catalog` reads off disk and
/// base64-encodes per query — small on purpose, this runs once per unique
/// Objects: label per map render, not per file in the catalog.
const SEARCH_LIMIT: usize = 3;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TileLibraryEntry {
    /// Which imported folder this came from — lets entries from different
    /// Import calls coexist in one manifest (see `import_tile_library`'s
    /// `merge` flag) without losing track of where to actually read the
    /// file from. `rel_path` is relative to THIS, not to some single global
    /// root.
    pub root: String,
    pub rel_path: String,
    pub biome: String,
    pub category: String,
    pub keywords: Vec<String>,
    pub w: u32,
    pub h: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct TileLibraryManifest {
    /// Every folder that's contributed entries — a plain Import replaces
    /// this with a single-element list; a merge Import appends to it.
    roots: Vec<String>,
    entries: Vec<TileLibraryEntry>,
    /// What `audit_tile_library` measured, keyed by `rel_path`. Absent until the
    /// library has been audited, and absent for entries a later merge-import
    /// added, in which case the shortlist falls back to decoding on demand.
    ///
    /// Kept as a side map rather than fields on `TileLibraryEntry` so it shares
    /// the override keying, and so an un-audited manifest costs nothing.
    #[serde(default)]
    measured: HashMap<String, MeasuredArt>,
}

/// The audit's verdict for one tile, in the smallest form the hot paths need:
/// what it is, and whether it's legible enough to be a floor. Persisting this
/// is what turns a one-time full-catalog decode into a permanent saving — the
/// shortlist stops decoding its candidates entirely.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct MeasuredArt {
    pub kind: ArtKind,
    /// Mean luminance 0-255, rounded — the floor band only needs whole numbers.
    pub lum: u8,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct TileLibrarySummary {
    pub roots: Vec<String>,
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
    /// Held behind an `Arc` so the hot paths (one shortlist PER SLOT, plus
    /// the vocabulary build) share one copy. This used to hand out a full deep
    /// CLONE of all ~183k entries on every call — ~20 clones of a 56 MB
    /// manifest to generate a single map.
    manifest: Mutex<Option<std::sync::Arc<TileLibraryManifest>>>,
    /// Cached keyword → IDF (inverse document frequency) for shortlist rarity
    /// weighting, keyed by entry count so a re-import (which changes the count)
    /// transparently recomputes it. Built lazily on first shortlist. See
    /// `load_idf_cached`.
    idf: Mutex<Option<(usize, std::sync::Arc<HashMap<String, f64>>)>>,
    /// Human corrections to `classify_art`, `rel_path -> kind`. Loaded once and
    /// shared; `None` means "not read from disk yet", an empty map means "read,
    /// and there aren't any".
    overrides: Mutex<Option<std::sync::Arc<HashMap<String, ArtKind>>>>,
}

// ── Classification overrides: the CSV round trip ─────────────────────────────
//
// `classify_art` is ~99.6% right, which still leaves a tail on a 183k catalog —
// and on somebody else's pack the tail is whatever their art happens to look
// like. So the audit exports what it could NOT decide from pixels, a human
// settles it in a spreadsheet, and the corrections come back and win.
//
// Keyed by `rel_path`, not by absolute path: overrides then survive re-importing
// the same pack from a different folder, and can be shared between people using
// the same pack.

/// One row of the audit CSV. `override_kind` is what the human writes back;
/// every other column is there so they can see WHY it was uncertain.
#[derive(Debug, Clone, PartialEq)]
pub struct AuditRow {
    pub rel_path: String,
    pub category: String,
    pub w: u32,
    pub h: u32,
    pub opaque: f64,
    pub edges: u8,
    pub luminance: f64,
    pub classified_as: ArtKind,
    pub decided_by: &'static str,
    pub override_kind: Option<ArtKind>,
}

const AUDIT_CSV_HEADER: &str = "rel_path,category,w,h,opaque,edges,luminance,classified_as,decided_by,override";

fn kind_str(k: ArtKind) -> &'static str {
    match k {
        ArtKind::Ground => "ground",
        ArtKind::Prop => "prop",
        ArtKind::Undecided => "undecided",
    }
}

fn parse_kind(s: &str) -> Option<ArtKind> {
    match s.trim().to_lowercase().as_str() {
        "ground" => Some(ArtKind::Ground),
        "prop" => Some(ArtKind::Prop),
        _ => None,
    }
}

/// Minimal RFC4180 quoting — a rel_path may legitimately contain a comma.
fn csv_escape(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// Split ONE csv line, honouring quotes and doubled-quote escapes.
fn csv_split(line: &str) -> Vec<String> {
    let (mut out, mut cur, mut in_q) = (Vec::new(), String::new(), false);
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if in_q && chars.peek() == Some(&'"') => {
                cur.push('"');
                chars.next();
            }
            '"' => in_q = !in_q,
            ',' if !in_q => out.push(std::mem::take(&mut cur)),
            _ => cur.push(c),
        }
    }
    out.push(cur);
    out
}

pub fn audit_rows_to_csv(rows: &[AuditRow]) -> String {
    let mut s = String::from(AUDIT_CSV_HEADER);
    s.push('\n');
    for r in rows {
        s.push_str(&format!(
            "{},{},{},{},{:.3},{},{:.1},{},{},{}\n",
            csv_escape(&r.rel_path),
            csv_escape(&r.category),
            r.w,
            r.h,
            r.opaque,
            r.edges,
            r.luminance,
            kind_str(r.classified_as),
            r.decided_by,
            r.override_kind.map(kind_str).unwrap_or(""),
        ));
    }
    s
}

/// Pull `rel_path -> kind` out of an edited audit CSV. Rows with an empty or
/// unrecognised `override` column are skipped, so a user can fill in only the
/// handful they care about and leave the rest untouched. Unknown column ORDER is
/// tolerated by reading the header.
pub fn parse_override_csv(csv: &str) -> HashMap<String, ArtKind> {
    let mut lines = csv.lines().filter(|l| !l.trim().is_empty());
    let Some(header) = lines.next() else { return HashMap::new() };
    let cols = csv_split(header);
    let idx = |name: &str| cols.iter().position(|c| c.trim().eq_ignore_ascii_case(name));
    let (Some(path_i), Some(ovr_i)) = (idx("rel_path"), idx("override")) else {
        return HashMap::new();
    };
    let mut out = HashMap::new();
    for line in lines {
        let f = csv_split(line);
        let (Some(p), Some(o)) = (f.get(path_i), f.get(ovr_i)) else { continue };
        if let Some(k) = parse_kind(o) {
            if !p.trim().is_empty() {
                out.insert(p.trim().to_string(), k);
            }
        }
    }
    out
}

fn overrides_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(manifest_path(app)?.with_file_name("tile_overrides.json"))
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
/// is_variant_token) are dropped. Bare single-character tokens (some FA
/// files use a lone letter — no digit — as a style marker, e.g.
/// `..._A_1x1.webp`) are dropped too: confirmed live, replaying this against
/// the real 162k-entry catalog put single letters "a"/"b" into the object
/// vocabulary as if they were real descriptive words.
fn keywords_from_stem(stem_without_size: &str) -> Vec<String> {
    stem_without_size.split('_').filter(|t| t.chars().count() > 1 && !is_variant_token(t)).map(|t| t.to_lowercase()).collect()
}

/// Real Forgotten Adventures object-type folder names, observed across the
/// actual imported library — both directly under a biome
/// (`!Core_Settlements/Furniture/...`) and nested under a named settlement
/// (`Woodlands/Base_Woodlands_Settlement/Furniture/...`). `biome_category_from_rel`
/// walks every directory segment after the biome, at any depth, for the
/// first one of these — settlement names and `!Wilderness` get skipped over
/// rather than matched, since neither says what the thing actually is.
/// Case-insensitive (vendor packs aren't perfectly consistent).
const OBJECT_TYPE_FOLDERS: &[&str] = &[
    "Furniture", "Decor", "Clutter", "Workplace_Equipment", "Lightsources", "Natural_Decor", "Burial_and_Graves", "Flora", "Structures", "Combat",
    "Vehicles", "Textures", "Elevation",
];

/// (biome, category) from a path relative to the imported root.
///
/// Biome: the segment after the LAST path component starting with
/// `FA_Assets`, not the first — some pack folder NAMES also start with that
/// string (e.g. `FA_Assets_Expansion_Webp_v1.12/FA_Assets_Webp/Arctic/...`),
/// and anchoring on the first occurrence there mis-reads `"FA_Assets_Webp"`
/// itself as the biome. Confirmed live: ~3,000 real entries were affected.
///
/// Category: the first directory segment after the biome that matches
/// OBJECT_TYPE_FOLDERS, at whatever depth it sits — NOT just "the next
/// segment". A biome with its own named settlement
/// (`Woodlands/Base_Woodlands_Settlement/Structures/...`) put the settlement
/// name where category used to be read from; walking past it instead of
/// stopping there was also confirmed live (the Import summary's by-category
/// breakdown was already visibly wrong for every named-settlement biome).
/// Falls back to the first directory segment when nothing recognized is
/// found, and to "the first two segments under the root" when there's no
/// `FA_Assets`-prefixed segment at all, for a non-FA vendor pack.
fn biome_category_from_rel(rel: &Path) -> (String, String) {
    let parts: Vec<&str> = rel.components().filter_map(|c| match c { Component::Normal(s) => s.to_str(), _ => None }).collect();
    if let Some(i) = parts.iter().rposition(|p| p.starts_with("FA_Assets")) {
        let biome = parts.get(i + 1).copied().unwrap_or("misc").to_string();
        let end = parts.len().saturating_sub(1); // exclude the filename itself
        let dirs = parts.get(i + 2..end).unwrap_or(&[]);
        let category = dirs
            .iter()
            .find(|p| OBJECT_TYPE_FOLDERS.iter().any(|f| f.eq_ignore_ascii_case(p)))
            .or_else(|| dirs.first())
            .copied()
            .unwrap_or("misc")
            .to_string();
        return (biome, category);
    }
    (parts.first().copied().unwrap_or("misc").to_string(), parts.get(1).copied().unwrap_or("misc").to_string())
}

/// Pure: one entry from a root-relative file path, or `None` if it's not an
/// image file this catalog indexes. `root` is left empty — `scan_dir` (the
/// only real caller) fills it in, since a merge Import needs to know which
/// folder each entry came from (see `TileLibraryEntry::root`) but this
/// function's own unit tests only care about the path-derived fields.
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
    Some(TileLibraryEntry { root: String::new(), rel_path: rel.to_string_lossy().replace('\\', "/"), biome, category, keywords, w, h })
}

fn scan_dir(root: &Path, dir: &Path, out: &mut Vec<TileLibraryEntry>) {
    let Ok(read) = fs::read_dir(dir) else { return };
    for entry in read.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_dir(root, &path, out);
        } else if let Ok(rel) = path.strip_prefix(root) {
            if let Some(mut e) = parse_entry(rel) {
                e.root = root.to_string_lossy().replace('\\', "/");
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
    TileLibrarySummary { roots: manifest.roots.clone(), total: manifest.entries.len(), by_category }
}

/// Categories worth drawing Objects: vocabulary from — genuinely placeable,
/// small-footprint physical set-dressing. Deliberately excludes Structures
/// (multi-tile buildings), Combat (damage/blood decals), Textures (tileable
/// surface material, not a discrete object), Elevation (cliff/bank path
/// pieces, terrain not objects) — none of those are what a 1-4 cell
/// Objects: placement is for, even though they're valid OBJECT_TYPE_FOLDERS
/// for categorization purposes.
const OBJECT_VOCAB_CATEGORIES: &[&str] = &["Furniture", "Decor", "Clutter", "Workplace_Equipment", "Lightsources", "Natural_Decor", "Burial_and_Graves", "Flora", "Vehicles"];

/// Nouns whose 1x1 pool is too thin to shortlist, with the smallest footprint
/// that actually has one — derived from the catalog, not hand-written.
///
/// This retires a whole bug class one prompt rule at a time was chasing: the
/// DM writes "Pine tree at X (1x1)", but every real tree in the pack is canopy
/// art at 2x2+ — so the only 1x1 "tree" is novelty clutter, and the map's
/// defining vegetation renders as a gingerbread cookie (live, 2026-07-20;
/// before that it was a 1x1 chandelier becoming a laundry iron). Instead of
/// teaching the prompt about chandeliers, then tables, then trees, tell it
/// what THIS pack actually stocks — which also makes it true for a pack we
/// have never seen.
///
/// Identity is the filename's LEADING token (`Tree_Pine_...` -> "tree"): FA
/// names lead with the object noun, and the gingerbread counter-example
/// (`Gingerbread_Tree_...` -> "gingerbread") files itself under the modifier,
/// which is exactly what we want. Words with a healthy 1x1 pool need no
/// guidance and stay out; rare nouns (< MIN_IDENTITY files) are noise and
/// stay out.
fn footprint_guide(entries: &[TileLibraryEntry]) -> Vec<(String, u32, u32)> {
    /// A "real" pool = at least a full vision shortlist's worth of art.
    const MIN_POOL: usize = 8;
    const MIN_IDENTITY: usize = 20;
    let mut by: HashMap<&str, Vec<(u32, u32)>> = HashMap::new();
    for e in entries {
        if !OBJECT_VOCAB_CATEGORIES.iter().any(|c| c.eq_ignore_ascii_case(&e.category)) {
            continue;
        }
        let Some(first) = e.keywords.first() else { continue };
        if is_artifact_word(first) {
            continue;
        }
        by.entry(first.as_str()).or_default().push((e.w, e.h));
    }
    let mut out: Vec<(String, u32, u32, usize)> = Vec::new();
    for (word, sizes) in by {
        if sizes.len() < MIN_IDENTITY {
            continue;
        }
        if sizes.iter().filter(|s| **s == (1, 1)).count() >= MIN_POOL {
            continue; // 1x1 genuinely works for this noun — no guidance needed
        }
        let mut hist: HashMap<(u32, u32), usize> = HashMap::new();
        for s in &sizes {
            *hist.entry(*s).or_insert(0) += 1;
        }
        // Smallest footprint that is both a real pool AND part of the noun's
        // BULK (by area, then width). The pool floor alone was not enough:
        // "tree" has twelve 2x2 entries — every one a fallen BRANCH — against
        // 290 standing trees at 3x3+, and deriving "tree 2x2" sent every
        // search into branch-and-novelty territory (vision then preferred a
        // gingerbread cookie to a stick). 10% of identity screens out fringe
        // variants while keeping honest minority sizes like boulder 1x2 (15%).
        let min_share = sizes.len().div_ceil(10);
        let Some(((w, h), _)) = hist.into_iter().filter(|(_, n)| *n >= MIN_POOL.max(min_share)).min_by_key(|((w, h), _)| (w * h, *w)) else {
            continue;
        };
        out.push((word.to_string(), w, h, sizes.len()));
    }
    // Most common nouns first — they're the ones the model will actually write.
    out.sort_by(|a, b| b.3.cmp(&a.3).then_with(|| a.0.cmp(&b.0)));
    out.truncate(FOOTPRINT_GUIDE_CAP);
    out.into_iter().map(|(word, w, h, _)| (word, w, h)).collect()
}

/// Keeps the prompt line bounded on any pack. 40 covers every noun that
/// matters on the 103k-object reference catalog.
const FOOTPRINT_GUIDE_CAP: usize = 40;

/// The guide with its structure intact — for callers that need to ACT on it
/// (the resolver bumping a search footprint) rather than print it.
pub fn structured_footprint_guide_for_app(app: &AppHandle) -> Vec<(String, u32, u32)> {
    match load_manifest_cached(app) {
        Ok(Some(m)) => footprint_guide(&m.entries),
        _ => Vec::new(),
    }
}

/// The footprint guide formatted for the map prompt ("tree 2x2"). Empty when
/// no library is imported.
pub fn object_footprint_guide_for_app(app: &AppHandle) -> Vec<String> {
    structured_footprint_guide_for_app(app).into_iter().map(|(word, w, h)| format!("{word} {w}x{h}")).collect()
}

/// How many words `object_vocabulary` returns at most — keeps the prompt
/// bounded regardless of library size, without starving it of real nouns.
/// Validated live against the real 162,538-file catalog: restricted to
/// OBJECT_VOCAB_CATEGORIES the whole vocabulary is only ~1,978 distinct
/// words, but frequency-ranking skews hard toward color/material modifiers
/// ("wood", "metal", "red", ...) that appear across every category — an
/// earlier cap of 400 cut off plainly-useful nouns like "bookshelf" (real
/// rank 436) and "cauldron" (real rank 564). 1500 comfortably covers the
/// real long tail of actual object nouns while still bounding the ~500
/// rarest/noisiest words out.
///
/// Trimmed 1500 → 900 (2026-07-19) on measurement: at 1500 this block was
/// 11,696 chars (~2,900 tokens) — about 40% of the whole ~30k map prompt, and
/// re-sent on every validation retry too. The tail it was buying is dead
/// weight (rank 975 "lettuce", 24 uses; rank 1462 "bobbin", 6 uses). 900 is
/// set deliberately WIDE of the deepest real noun spot-checked against the
/// live catalog — bookshelf 482, cauldron 610, tankard 729, anvil 788 — since
/// the earlier cap of 400 is on record for cutting exactly those off. Saves
/// ~4,800 chars/call with no word worth having lost.
const VOCAB_CAP: usize = 900;

/// True for a pure filename artifact that is not a describable word — a bare
/// number ("01") or a digit-suffixed variant tag ("multicolor2", "green1").
/// These rank absurdly high on raw frequency ("multicolor2" was 100th, 781
/// uses) while being useless as vocabulary to write an object label with.
fn is_artifact_word(w: &str) -> bool {
    w.bytes().all(|b| b.is_ascii_digit()) || w.bytes().last().is_some_and(|b| b.is_ascii_digit())
}

/// Pure: the real, bounded vocabulary to ground the DM's `Objects:` prompt
/// in — every word returned is guaranteed to appear in at least one real
/// catalog entry's keywords (restricted to genuinely object-like
/// categories, see OBJECT_VOCAB_CATEGORIES), so search_tile_catalog's
/// existing overlap matcher can always find something for any word the
/// model actually uses. Frequency-sorted (ties broken alphabetically for
/// deterministic output) and capped at VOCAB_CAP.
fn object_vocabulary(entries: &[TileLibraryEntry]) -> Vec<String> {
    let mut counts: HashMap<&str, u32> = HashMap::new();
    for e in entries {
        if !OBJECT_VOCAB_CATEGORIES.iter().any(|c| c.eq_ignore_ascii_case(&e.category)) {
            continue;
        }
        let biome_lc = e.biome.to_lowercase();
        let category_lc = e.category.to_lowercase();
        for kw in &e.keywords {
            // Structural (which biome/category this came from), not
            // descriptive of the object itself — excluded so the vocabulary
            // surfaces what the thing actually IS, not where it lives.
            if *kw == biome_lc || *kw == category_lc || is_artifact_word(kw) {
                continue;
            }
            *counts.entry(kw.as_str()).or_insert(0) += 1;
        }
    }
    let mut words: Vec<(&str, u32)> = counts.into_iter().collect();
    words.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    words.into_iter().take(VOCAB_CAP).map(|(w, _)| w.to_string()).collect()
}

/// `object_vocabulary` for the currently-imported library, or empty when
/// nothing's imported. Plain function, not a `#[tauri::command]` — called
/// directly from campaign.rs's prompt builder in the same process, same
/// pattern as `tile_library_configured`.
pub fn object_vocabulary_for_app(app: &AppHandle) -> Vec<String> {
    load_manifest_cached(app).ok().flatten().map(|m| object_vocabulary(&m.entries)).unwrap_or_default()
}

fn save_manifest(app: &AppHandle, manifest: &TileLibraryManifest) -> Result<(), String> {
    let path = manifest_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(manifest).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

fn load_manifest_cached(app: &AppHandle) -> Result<Option<std::sync::Arc<TileLibraryManifest>>, String> {
    let state = app.state::<TileLibraryState>();
    // Arc::clone — a refcount bump, NOT a copy of the 183k entries.
    if let Some(cached) = state.manifest.lock().unwrap().as_ref() {
        return Ok(Some(cached.clone()));
    }
    let path = manifest_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let manifest = std::sync::Arc::new(serde_json::from_str::<TileLibraryManifest>(&json).map_err(|e| e.to_string())?);
    *state.manifest.lock().unwrap() = Some(manifest.clone());
    Ok(Some(manifest))
}

// ── Search (pure scoring, unit-tested directly) ──────────────────────────────

/// Catalog categories that are TERRAIN SURFACE art — seamless ground textures,
/// overlays, and the strips that edge one elevation against another — and so
/// can never be a placeable object. Dropped into an object slot they render as
/// a rectangle of patterned floor or a smear of boundary decoration rather than
/// a thing.
///
/// Two live bugs, both 2026-07-19:
/// - "bone pile" resolved to `Textures/Bones/Bones_Dirt_A_01.jpg`, a tiling
///   bone-dirt GROUND texture, because an exact head match is worth 1000x and
///   outweighed even the 0.15 off-biome penalty for Horror art.
/// - "Stalagmite" resolved to `Elevation/Cliff_Paths/Stalagmites_..._Path_A1`
///   on every cave map — a horizontal strip of jagged edging meant to run along
///   a cliff top, which renders as an illegible black scribble. It won on the
///   plural (`stalagmites` matches the query's `stalagmite`) while 312 correct
///   1x1 `Decor/Rocks/Stalagmites` props scored identically and lost the
///   tiebreak. `Elevation` is ENTIRELY path art — Cliff_Paths, Ridge_and_Slope,
///   Sand_Paths, Bank_Paths — so nothing placeable is lost by dropping it.
///
/// Excluded by CATEGORY, not by the `path` keyword: 4,455 entries carry that
/// word, including 1,737 perfectly good `Structures`.
///
/// `resolve_floor` asks for the `Textures` category by name, so excluding these
/// from object placements costs the floor path nothing.
const TERRAIN_ONLY_CATEGORIES: &[&str] = &["Textures", "Texture_Overlays", "Elevation", "Shadow_Paths", "Misc_Paths"];

fn is_terrain_only(category: &str) -> bool {
    TERRAIN_ONLY_CATEGORIES.iter().any(|c| category.eq_ignore_ascii_case(c))
}

/// What a tile IS, measured from its pixels rather than from where a vendor
/// filed it. The category list above only works on a pack whose folder names we
/// already know; these signals work on any pack.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ArtSignals {
    /// Share of the canvas that is (near-)opaque, 0..1.
    pub opaque: f64,
    /// How many canvas edges the opaque region reaches, 0..4.
    pub edges: u8,
    /// Mean perceived luminance of the opaque pixels, 0..255.
    pub luminance: f64,
}

/// What a tile is, once the pixels have had their say.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtKind {
    /// Seamless surface art. Never a placeable object.
    Ground,
    /// A discrete thing that floats free on its canvas.
    Prop,
    /// Genuinely between the two — perforated or near-transparent surface art
    /// (grates, lattices, grunge passes) measures much like a sparse prop.
    /// Handed to the name pass; see `classify_art`.
    Undecided,
}

impl ArtSignals {
    /// The confident half of the call, from pixels alone. Thresholds are where
    /// the measurements actually separate, not round numbers: across 1,402
    /// sampled entries these two bands were **99.9%** correct, leaving 23% of
    /// the catalog in `Undecided` for the name pass to adjudicate.
    ///
    /// Deliberately does NOT try to detect edging strips. A cliff fringe and a
    /// `Wall_*_Straight` segment are geometrically identical (both span one axis
    /// fully, both float on the other, and bbox-fill overlaps completely at
    /// 0.58-0.87 vs 0.29-1.00), so any rule catching one deleted the other.
    /// That difference is semantic, not geometric — it stays with the category
    /// list, where being wrong on an unrecognised pack costs nothing.
    pub fn kind(&self) -> ArtKind {
        if self.edges == 4 && self.opaque >= GROUND_OPAQUE_MIN {
            ArtKind::Ground
        } else if self.edges <= 1 && self.opaque < PROP_OPAQUE_MAX {
            ArtKind::Prop
        } else {
            ArtKind::Undecided
        }
    }

}

/// Whether a texture is legible enough to be the board. `Gravel_05_F`
/// (luminance 48) rendered a cave where wall, floor and objects were all one
/// dark smear; `Cave_Floor_02_A` (92) read correctly. Too bright blows out the
/// art drawn on top. Takes a bare number so it works off either a fresh
/// measurement or the audit's stored value.
pub fn luminance_is_usable_floor(lum: f64) -> bool {
    (FLOOR_LUM_MIN..=FLOOR_LUM_MAX).contains(&lum)
}

const GROUND_OPAQUE_MIN: f64 = 0.92;
const PROP_OPAQUE_MAX: f64 = 0.55;

/// Words that mean "surface art" in tileset vocabulary generally, not in one
/// vendor's scheme. Consulted ONLY for `ArtKind::Undecided`, which is what makes
/// a loose list safe: measured globally, "overlay" appears on 1,458 perfectly
/// good `Structures`, but those are all decided confidently by pixels and never
/// reach this pass.
///
/// Tuned against the real catalog rather than guessed. Adding "floor"/"ground"
/// measured WORSE (98.1% vs 99.6%) because it swallows `Floor_Break_*`, which
/// are structures. The perforated words carry the gain: grates and lattices are
/// surface art full of holes, so they read as sparse props to the pixel pass.
const GROUND_NAME_HINTS: &[&str] = &["overlay", "texture", "seamless", "tileable", "grate", "lattice", "grid", "grunge", "hatching"];

/// Pixels first, then the filename for whatever they couldn't settle. Measured
/// end to end at **99.6%** against 1,828 catalog entries (pixels alone: 96.9%).
/// Anything still unresolved is treated as a prop — the safer failure, since a
/// stray texture offered as an object is a bad pick the vision step can still
/// reject, while a wrongly excluded prop just silently vanishes.
pub fn classify_art(rel_path: &str, signals: Option<ArtSignals>) -> ArtKind {
    match signals.map(|s| s.kind()) {
        Some(ArtKind::Ground) => ArtKind::Ground,
        Some(ArtKind::Prop) | None => ArtKind::Prop,
        Some(ArtKind::Undecided) => {
            let name = rel_path.rsplit(['/', '\\']).next().unwrap_or(rel_path).to_lowercase();
            if GROUND_NAME_HINTS.iter().any(|w| name.contains(w)) {
                ArtKind::Ground
            } else {
                ArtKind::Prop
            }
        }
    }
}

const FLOOR_LUM_MIN: f64 = 70.0;
const FLOOR_LUM_MAX: f64 = 205.0;

/// Decode `bytes` and measure it. `None` if it isn't a decodable image.
pub fn art_signals(bytes: &[u8]) -> Option<ArtSignals> {
    let img = image::load_from_memory(bytes).ok()?.into_rgba8();
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return None;
    }
    let (mut opaque, mut lum_sum) = (0u64, 0f64);
    let (mut x0, mut x1, mut y0, mut y1) = (u32::MAX, 0u32, u32::MAX, 0u32);
    for (x, y, p) in img.enumerate_pixels() {
        if p[3] <= 200 {
            continue;
        }
        opaque += 1;
        lum_sum += 0.2126 * p[0] as f64 + 0.7152 * p[1] as f64 + 0.0722 * p[2] as f64;
        x0 = x0.min(x);
        x1 = x1.max(x);
        y0 = y0.min(y);
        y1 = y1.max(y);
    }
    if opaque == 0 {
        return None;
    }
    // 2% of the canvas counts as "reaching the edge" — matches the tolerance the
    // signals were validated at.
    let (mx, my) = ((w as f64 * 0.02) as u32, (h as f64 * 0.02) as u32);
    let edges = [x0 <= mx, x1 + mx >= w - 1, y0 <= my, y1 + my >= h - 1].iter().filter(|b| **b).count() as u8;
    Some(ArtSignals { opaque: opaque as f64 / (w as f64 * h as f64), edges, luminance: lum_sum / opaque as f64 })
}

fn tokenize_query(q: &str) -> Vec<String> {
    let mut tokens: Vec<String> = normalize_query(q).split(|c: char| !c.is_alphanumeric()).filter(|t| t.len() >= 3).map(|t| t.to_string()).collect();
    // A trailing COLLECTIVE noun is not the object's identity: "bone pile" is
    // about bones, "mushroom cluster" about mushrooms. Since the HEAD is the
    // last token, move the real noun there and keep the collective as a
    // scoring hint rather than dropping it.
    //
    // `normalize_query` already refuses to promote a quantifier in the "X of Y"
    // phrasing, but a bare compound never reaches that branch. Live
    // (2026-07-19, cave map): "dark mushroom cluster" resolved to
    // Crystal_Black_Cluster and "bone pile" to Stuffing_Pile (pillow stuffing),
    // while 1,844 mushroom tiles sat unmatched.
    if tokens.last().is_some_and(|t| is_quantifier(t)) {
        if let Some(pos) = tokens.iter().rposition(|t| !is_quantifier(t)) {
            let real = tokens.remove(pos);
            tokens.push(real);
        }
    }
    tokens
}

/// Rewrites "<container> of <contents>" so the CONTAINER ends up last, because
/// the ranker treats the last token as the head noun (the object's identity).
/// Live bug: "Shelf of bottles" made "bottles" the head, so every candidate was
/// loose glassware (Ink_Bottle, Milk_Bottle) and not one shelf — the contents
/// should only ever be a modifier that biases WHICH shelf gets picked.
fn normalize_query(q: &str) -> String {
    let lower = q.to_lowercase();
    match lower.split_once(" of ") {
        // Only swap for a real CONTAINER. "Stack of wooden crates" is still
        // about crates — a quantifier is not the object, and swapping made
        // "stack" the head, which matched Coal_Stack and Planks_Stack instead.
        Some((container, contents)) if !container.trim().is_empty() && !is_quantifier(container.trim()) => {
            format!("{} {}", contents.trim(), container.trim())
        }
        _ => lower,
    }
}

/// Words that count a thing rather than being the thing — "a stack of crates"
/// is crates, not a stack. Checked on the phrase left of "of".
fn is_quantifier(w: &str) -> bool {
    const QUANTIFIERS: &[&str] = &[
        "stack", "stacks", "pile", "piles", "heap", "heaps", "row", "rows", "set", "sets", "pair", "pairs", "bunch",
        "group", "cluster", "collection", "handful", "scattering", "assortment", "line", "bundle", "load", "mound",
    ];
    QUANTIFIERS.contains(&w.rsplit(' ').next().unwrap_or(w))
}

/// Keywords that change what an object IS — damaged, or a different specific
/// thing — rather than merely what it's made of. Unless the label actually
/// asks for one, an entry carrying it is the wrong pick: a "Communal table"
/// must not resolve to `Table_Rectangle_Fallen`, nor a "Stool" to
/// `Piano_Stool_Black`. Material and colour words are deliberately NOT here —
/// those are free variation and the whole point of the material scoring.
const CONDITION_WORDS: &[&str] = &[
    "fallen", "broken", "cracked", "burnt", "ruined", "spilled", "overturned", "sooty", "destroyed", "toppled",
    "damaged", "dead", "hot", "empty", "piano", "baby", "toy", "doll", "miniature",
];

/// How hard an entry is demoted per unrequested condition word it carries.
const CONDITION_PENALTY: f64 = 0.25;

fn is_condition_word(w: &str) -> bool {
    CONDITION_WORDS.contains(&w)
}

/// Multiplier for an entry given the query: 1.0 when it carries no condition
/// word the label didn't ask for, otherwise demoted once per offending word.
fn condition_fit(entry: &TileLibraryEntry, tokens: &[String]) -> f64 {
    let unrequested = entry
        .keywords
        .iter()
        .filter(|k| is_condition_word(k) && !tokens.iter().any(|t| token_matches(k, t)))
        .count();
    CONDITION_PENALTY.powi(unrequested as i32)
}

/// Whether the entry matches some query token that actually names an OBJECT —
/// an exact (non-bridge) match on a token that isn't a mere condition word.
/// "Broken crockery" has no catalog word for "crockery", so its only exact
/// match is "broken", which is why it proposed a broken WINDOW. Requiring a
/// real identity match is what lets the shortlist return nothing and fall back
/// to the built-in glyph, instead of confidently drawing the wrong object.
fn has_identity_match(entry: &TileLibraryEntry, tokens: &[String]) -> bool {
    tokens
        .iter()
        .filter(|t| !is_condition_word(t))
        // A bridge counts: "gravestone" legitimately reaches a grave+stone
        // tile. What must NOT count is matching only a condition word.
        .any(|t| entry.keywords.iter().any(|k| token_matches(k, t) || bridges(k, t)))
}

/// Bigger than any realistic number of adjective matches, so an entry that
/// matches the description's HEAD NOUN (its object identity) always outranks
/// one that only shares color/size/material words. See `score`.
const HEAD_WEIGHT: u32 = 100;

/// Whole-word-ish match: exact, or one string is the other plus a 1-2 char
/// suffix (a plural or simple adjective form — "table"/"tables",
/// "wood"/"wooden"). Deliberately NOT the old free substring test, which
/// matched a short keyword ANYWHERE inside a longer query word — "rat" inside
/// "crate", "bar" inside "barrel", "can" inside "candle" — and put a rat trap
/// where a crate belonged (found live, "small wooden crate" → Rat_Trap).
fn token_matches(keyword: &str, token: &str) -> bool {
    if keyword == token {
        return true;
    }
    let (short, long) = if keyword.len() < token.len() { (keyword, token) } else { (token, keyword) };
    // Only a genuine plural/adjective ENDING counts, not any ≤2-char tail — a
    // bare length check let "heart"+"h" match "hearth" (a human heart where a
    // hearth belonged). Keywords/queries are lowercase ASCII, so slicing at
    // short.len() is a safe char boundary.
    long.starts_with(short) && matches!(&long[short.len()..], "s" | "es" | "en")
}

/// Relevance of one catalog entry to a query. The LAST query token is the
/// head noun — the thing actually being placed ("small wooden crate" →
/// crate) — and MUST match, worth HEAD_WEIGHT; every earlier (adjective)
/// token that also matches adds 1. So identity dominates description: a real
/// crate (crate + wood) beats an "Aquarium_Small_Wood" that only shares the
/// adjectives, and an entry matching no object noun at all scores 0 and is
/// dropped rather than rendering an unrelated lookalike. Equal scores are
/// ordered by the caller (plainer object wins).
fn score(entry: &TileLibraryEntry, query_tokens: &[String]) -> u32 {
    let Some((head, rest)) = query_tokens.split_last() else { return 0 };
    let matches = |t: &String| entry.keywords.iter().any(|k| token_matches(k, t));
    if !matches(head) {
        return 0;
    }
    HEAD_WEIGHT + rest.iter().filter(|t| matches(t)).count() as u32
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

/// Pure: folds freshly-`scanned` entries from `root` into `existing` —
/// replaces just `root`'s own prior contribution (matched by exact root
/// path) rather than duplicating it if this same folder was already part of
/// the catalog, leaves every OTHER root's entries untouched, and records
/// `root` in the roots list if it's new.
fn merge_manifest(mut existing: TileLibraryManifest, root: &str, scanned: Vec<TileLibraryEntry>) -> TileLibraryManifest {
    existing.entries.retain(|e| e.root != root);
    existing.entries.extend(scanned);
    if !existing.roots.iter().any(|r| r == root) {
        existing.roots.push(root.to_string());
    }
    existing
}

/// Scans `root` and either replaces the whole catalog with just this folder
/// (`merge: false` — the original behavior, still the default for a first
/// Import) or folds it into whatever's already imported (`merge: true`, see
/// `merge_manifest`), so a second asset pack can be added without losing
/// the first.
#[tauri::command]
pub fn import_tile_library(app: AppHandle, root: String, merge: bool) -> Result<TileLibrarySummary, String> {
    let root_path = PathBuf::from(&root);
    if !root_path.is_dir() {
        return Err(format!("\"{root}\" isn't a folder."));
    }
    let scanned = scan_tile_library(&root_path);
    if scanned.is_empty() {
        return Err(format!("No image files found under \"{root}\"."));
    }
    let manifest = if merge {
        merge_manifest(load_manifest_cached(&app)?.map(|m| (*m).clone()).unwrap_or_default(), &root, scanned)
    } else {
        TileLibraryManifest { roots: vec![root.clone()], entries: scanned, measured: HashMap::new() }
    };
    save_manifest(&app, &manifest)?;
    let summary = summarize(&manifest);
    *app.state::<TileLibraryState>().manifest.lock().unwrap() = Some(std::sync::Arc::new(manifest));
    Ok(summary)
}

#[tauri::command]
pub fn get_tile_library_summary(app: AppHandle) -> Result<Option<TileLibrarySummary>, String> {
    Ok(load_manifest_cached(&app)?.map(|m| summarize(&m)))
}

fn load_overrides_cached(app: &AppHandle) -> std::sync::Arc<HashMap<String, ArtKind>> {
    let state = app.state::<TileLibraryState>();
    let mut guard = state.overrides.lock().unwrap();
    if let Some(cached) = guard.as_ref() {
        return cached.clone();
    }
    let map = overrides_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<HashMap<String, ArtKind>>(&s).ok())
        .unwrap_or_default();
    let arc = std::sync::Arc::new(map);
    *guard = Some(arc.clone());
    arc
}

/// What the audit found, for the UI to report without re-reading the CSV.
#[derive(Serialize, Clone, Debug)]
pub struct TileAuditSummary {
    pub total: usize,
    pub ground: usize,
    pub prop: usize,
    /// Low-confidence ground calls a human should confirm — the CSV's contents.
    pub needs_review: usize,
    /// Files that couldn't be read even after retries (a cold Drive mount, a
    /// permissions issue). Left UNMEASURED, not persisted as prop — re-running
    /// the audit once the cache is warm picks them up. Surfaced so a big number
    /// here reads as "re-run me", not "these are all props".
    pub unread: usize,
    pub csv_path: String,
}

#[derive(Clone, Serialize)]
struct AuditProgress {
    done: usize,
    total: usize,
}

/// Read a file, retrying a few times with a short backoff. A Google-Drive
/// (or any network) mount times out reads under the load of a full-library
/// audit; the same file reads fine moments later. Three tries clears the
/// transient failures that were poisoning ~1% of a Drive-backed catalog.
fn read_with_retry(path: &Path) -> Option<Vec<u8>> {
    for attempt in 0..3 {
        match fs::read(path) {
            Ok(b) => return Some(b),
            Err(_) if attempt < 2 => std::thread::sleep(std::time::Duration::from_millis(50 * (attempt + 1))),
            Err(_) => return None,
        }
    }
    None
}

/// Decode and classify the WHOLE library, then write the rows the pixel pass
/// couldn't decide on its own to `csv_path` for a human to settle.
///
/// This is the one place the full catalog gets decoded — measured at ~17.6 min
/// single-threaded for 183k files, hence the worker pool and the progress
/// events. Everything else in this module only ever measures the handful of
/// candidates a shortlist already read.
#[tauri::command]
pub fn audit_tile_library(app: AppHandle, csv_path: String) -> Result<TileAuditSummary, String> {
    let Some(manifest) = load_manifest_cached(&app)? else {
        return Err("No tile library imported yet.".into());
    };
    let overrides = load_overrides_cached(&app);
    let entries = &manifest.entries;
    let total = entries.len();
    let done = std::sync::atomic::AtomicUsize::new(0);
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(16);
    let chunk = total.div_ceil(threads.max(1));

    let collected: Vec<Vec<(AuditRow, Option<MeasuredArt>)>> = std::thread::scope(|s| {
        let handles: Vec<_> = entries
            .chunks(chunk.max(1))
            .map(|slice| {
                let (done, app, overrides) = (&done, &app, &overrides);
                s.spawn(move || {
                    let mut rows: Vec<(AuditRow, Option<MeasuredArt>)> = Vec::new();
                    for (i, e) in slice.iter().enumerate() {
                        let path = Path::new(&e.root).join(&e.rel_path);
                        // A READ failure on a Drive-backed pack is usually a
                        // transient I/O timeout, not a bad file — retry before
                        // giving up. A DECODE failure (bytes read, image crate
                        // said no) is genuine and needs no retry.
                        let bytes = read_with_retry(&path);
                        let read_ok = bytes.is_some();
                        let signals = bytes.and_then(|b| art_signals(&b));
                        let pixel_kind = signals.map(|s| s.kind());
                        let classified = classify_art(&e.rel_path, signals);
                        // Only persist a verdict we actually measured. A file we
                        // couldn't even READ stays UNMEASURED so the shortlist
                        // decodes it on demand later (when the Drive cache is
                        // warm) instead of baking in a wrong "prop, lum 0".
                        let measured = signals.map(|sg| MeasuredArt { kind: classified, lum: sg.luminance.round().clamp(0.0, 255.0) as u8 });
                        rows.push((AuditRow {
                            rel_path: e.rel_path.clone(),
                            category: e.category.clone(),
                            w: e.w,
                            h: e.h,
                            opaque: signals.map(|s| s.opaque).unwrap_or(0.0),
                            edges: signals.map(|s| s.edges).unwrap_or(0),
                            luminance: signals.map(|s| s.luminance).unwrap_or(0.0),
                            classified_as: classified,
                            decided_by: match (read_ok, pixel_kind) {
                                (_, Some(ArtKind::Undecided)) => "name",
                                (_, Some(_)) => "pixels",
                                (false, None) => "unread",   // couldn't read the bytes — retry-later
                                (true, None) => "undecodable", // read fine, not a valid image
                            },
                            override_kind: overrides.get(&e.rel_path).copied(),
                        }, measured));
                        if i % 512 == 0 {
                            let n = done.fetch_add(512, std::sync::atomic::Ordering::Relaxed);
                            let _ = app.emit("tile-audit-progress", AuditProgress { done: n.min(total), total });
                        }
                    }
                    rows
                })
            })
            .collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    });

    let all: Vec<(AuditRow, Option<MeasuredArt>)> = collected.into_iter().flatten().collect();
    // Persist the verdicts. This is the point of paying for a full decode once:
    // every later shortlist reads `measured` instead of decoding its candidates.
    let measured: HashMap<String, MeasuredArt> = all.iter().filter_map(|(r, m)| m.map(|m| (r.rel_path.clone(), m))).collect();
    let mut updated = (*manifest).clone();
    updated.measured = measured;
    save_manifest(&app, &updated)?;
    *app.state::<TileLibraryState>().manifest.lock().unwrap() = Some(std::sync::Arc::new(updated));
    let all: Vec<AuditRow> = all.into_iter().map(|(r, _)| r).collect();
    let ground = all.iter().filter(|r| r.classified_as == ArtKind::Ground).count();
    // The review list is NOT the whole undecided band — that's 18% of the
    // catalog, almost all correctly defaulted to prop, and nobody reviews 30k
    // rows. Surface only the calls that are BOTH uncertain AND high-impact:
    //
    //   name->ground : pixels were unsure and only the FILENAME said ground. If
    //                  wrong, a real object silently vanishes from the map. This
    //                  is the direction worth a human's eyes.
    //   unread       : a read that never succeeded even with retries — flagged
    //                  so the user knows it wasn't measured, not that it's prop.
    //
    // A confident pixel-ground (99.9% right on sampling) and an undecided that
    // fell to prop (the safe default, and a wrong one is only a bad pick vision
    // rejects) both stay OUT. Sorted by path so name families sit together and
    // fill down in one drag.
    let needs_review = |r: &&AuditRow| matches!(r.decided_by, "name") && r.classified_as == ArtKind::Ground || r.decided_by == "unread";
    let mut review: Vec<AuditRow> = all.iter().filter(needs_review).cloned().collect();
    review.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    let path = PathBuf::from(&csv_path);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&path, audit_rows_to_csv(&review)).map_err(|e| format!("Couldn't write {csv_path}: {e}"))?;
    let _ = app.emit("tile-audit-progress", AuditProgress { done: total, total });
    let unread = all.iter().filter(|r| r.decided_by == "unread").count();
    Ok(TileAuditSummary { total, ground, prop: all.len() - ground - unread, needs_review: review.len(), unread, csv_path })
}

/// Read an edited audit CSV back in. Replaces the stored override set with
/// whatever the file specifies, so deleting a row's override un-sets it.
#[tauri::command]
pub fn import_tile_overrides(app: AppHandle, csv_path: String) -> Result<usize, String> {
    let csv = fs::read_to_string(&csv_path).map_err(|e| format!("Couldn't read {csv_path}: {e}"))?;
    let map = parse_override_csv(&csv);
    let path = overrides_path(&app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&path, serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let n = map.len();
    *app.state::<TileLibraryState>().overrides.lock().unwrap() = Some(std::sync::Arc::new(map));
    Ok(n)
}

/// Keyword search over the imported catalog — resolves an `Objects:` label
/// like "round wooden dining table" to real files, reading and base64-
/// encoding just the top matches (see SEARCH_LIMIT). Returns an empty list
/// (not an error) when no library is imported, so the renderer's fallback
/// (draw nothing extra) is the same code path either way.
#[tauri::command]
pub fn search_tile_catalog(app: AppHandle, query: String) -> Result<Vec<TileCatalogMatch>, String> {
    let Some(manifest) = load_manifest_cached(&app)? else {
        crate::maplog::log("TILE SEARCH", &format!("query {query:?} → no library imported, returning nothing"));
        return Ok(Vec::new());
    };
    let tokens = tokenize_query(&query);
    if tokens.is_empty() {
        crate::maplog::log("TILE SEARCH", &format!("query {query:?} → no usable search tokens (all <3 chars), returning nothing"));
        return Ok(Vec::new());
    }
    let mut scored: Vec<(u32, &TileLibraryEntry)> = manifest.entries.iter().map(|e| (score(e, &tokens), e)).filter(|(s, _)| *s > 0).collect();
    // Score first, then prefer the PLAINER entry among ties: fewer keywords
    // (a bare "Barrel" over a "Barrel_Torture", a plain "Chair" over an
    // "Electric_Torture_Chair"), then the shorter path. Without this the tie
    // resolves by manifest order, which surfaced the oddest themed variant of
    // whatever object was asked for.
    scored.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.keywords.len().cmp(&b.1.keywords.len()))
            .then_with(|| a.1.rel_path.len().cmp(&b.1.rel_path.len()))
    });
    // TEMP debug trace: what the model asked for vs. what the catalog actually
    // had for it — the top of the ranking (more than we'll return) so a bad
    // match is visible as "these were the best available", plus which ones we
    // then read and handed back. See maplog.rs.
    let preview: String = scored
        .iter()
        .take(SEARCH_LIMIT + 10)
        .map(|(s, e)| format!("  score {s}  [{}/{}]  {}", e.biome, e.category, e.rel_path))
        .collect::<Vec<_>>()
        .join("\n");
    crate::maplog::log(
        "TILE SEARCH",
        &format!(
            "query {query:?}\ntokens searched: {tokens:?}\n{} entr(y/ies) matched at all; returning top {}:\n{}",
            scored.len(),
            SEARCH_LIMIT.min(scored.len()),
            if preview.is_empty() { "  (nothing matched — this Objects: word rendered nothing)".to_string() } else { preview },
        ),
    );
    let out: Vec<TileCatalogMatch> = scored
        .into_iter()
        .take(SEARCH_LIMIT)
        .filter_map(|(_, e)| {
            let bytes = fs::read(Path::new(&e.root).join(&e.rel_path)).ok()?;
            let ext = Path::new(&e.rel_path).extension()?.to_str()?;
            Some(TileCatalogMatch { rel_path: e.rel_path.clone(), w: e.w, h: e.h, data_url: to_data_url(&bytes, ext) })
        })
        .collect();
    Ok(out)
}

// ── Vision shortlist (footprint-aware candidate set for the tile resolver) ────

/// Pure: the top `k` real catalog entries for `query` that FIT inside a
/// `fw`x`fh` footprint (so a chosen tile can be scaled/tiled into the slot
/// without overflowing into neighbouring cells). Same head-noun ranking and
/// plainer-object tiebreak as `search_tile_catalog`, plus a larger-tile-first
/// preference so a slot is filled with as few repeats as possible. Returned to
/// the vision picker, which looks at these and chooses the exact one.
/// Ranking for the vision SHORTLIST (not the final pick) — deliberately looser
/// than `score`: an entry qualifies if it matches ANY query token, so a
/// compound label whose last word isn't a catalog noun still surfaces the
/// right tile ("bar counter" → the `bar` tile, where strict head-noun scoring
/// returned nothing and the bar fell back to `=` tables). Matching the last
/// (head) token still gets HEAD_WEIGHT so the true object ranks first and makes
/// the top-`k` cut; the vision picker then looks at the images and rejects any
/// that don't actually fit (choice 0). `None` = matches nothing.
/// A looser "compound bridge" between a catalog keyword and a query token, for
/// the SHORTLIST only (the vision picker still filters): a substantive word
/// (both ≥4 chars) that is a component of the other — "grave" in "gravestone",
/// "lamp" in "lamppost", "shell" in "seashell". The ≥4 floor keeps the short
/// false positives we already killed (rat/bar/can, all ≤3) out; anything wrong
/// that still slips through is shown to vision, which rejects it (choice 0).
fn bridges(keyword: &str, token: &str) -> bool {
    if keyword.len() < 4 || token.len() < 4 {
        return false;
    }
    // Must be a PREFIX or SUFFIX (a real word boundary), not any internal
    // substring — "grave"/"stone" are the start/end of "gravestone", but "vest"
    // buried in gra-VEST-one, or "table" inside "s-table-s", are coincidences.
    // (Rarity weighting made this matter: a spurious rare substring would
    // otherwise get promoted, e.g. gravestone → a Vest tile.)
    let (short, long) = if keyword.len() < token.len() { (keyword, token) } else { (token, keyword) };
    long.starts_with(short) || long.ends_with(short)
}

/// The head noun (last token) is the object's identity — weight it far above
/// modifier tokens so a match on it dominates.
const HEAD_MULT: f64 = 8.0;
/// A compound-bridge match ("grave" in "gravestone") counts less than an exact
/// or plural match, so a real exact match of equal rarity still wins.
const BRIDGE_DISCOUNT: f64 = 0.5;
/// A flat tier added when the HEAD noun matches EXACTLY (not via a bridge),
/// large enough that no bridge match — however rare its word — can ever
/// outrank a real exact one. Fixes a rare false-friend beating the real thing:
/// "tableau" (idf 8.9) was bridge-matching "table" (idf 4.1) and burying every
/// actual table. Rarity still orders entries WITHIN a tier (so gravestone,
/// which has no exact match, still prefers `grave` over generic `stone`).
const EXACT_HEAD_TIER: f64 = 1000.0;

/// keyword → IDF (`ln(N / df)`), so a rare, specific word ("grave", idf ~8)
/// counts far more than a ubiquitous modifier ("wood", idf ~1.6). Each keyword
/// counted once per entry. Pure.
fn compute_idf(entries: &[TileLibraryEntry]) -> HashMap<String, f64> {
    let n = entries.len().max(1) as f64;
    let mut df: HashMap<&str, u32> = HashMap::new();
    for e in entries {
        let mut seen = std::collections::HashSet::new();
        for k in &e.keywords {
            if seen.insert(k.as_str()) {
                *df.entry(k.as_str()).or_insert(0) += 1;
            }
        }
    }
    df.into_iter().map(|(k, d)| (k.to_string(), (n / d as f64).ln())).collect()
}

/// Rarity-weighted shortlist rank: each query token contributes the IDF of the
/// RAREST keyword it matches (so a match on a specific word beats a match on a
/// generic one — "gravestone" prefers the `grave` tile over a plain `stone`
/// one), scaled up for the head noun and down for a compound bridge. `None` if
/// nothing matches. An unknown keyword defaults to IDF 1.0.
fn shortlist_rank(entry: &TileLibraryEntry, tokens: &[String], idf: &HashMap<String, f64>) -> Option<f64> {
    let mut total = 0.0;
    let mut any = false;
    for (i, t) in tokens.iter().enumerate() {
        // Best (rarest) keyword matching this token, and whether it was exact.
        let mut best: Option<(f64, bool)> = None;
        for k in &entry.keywords {
            let strict = token_matches(k, t);
            if !strict && !bridges(k, t) {
                continue;
            }
            let w = idf.get(k.as_str()).copied().unwrap_or(1.0);
            if best.map_or(true, |(bw, _)| w > bw) {
                best = Some((w, strict));
            }
        }
        if let Some((w, strict)) = best {
            any = true;
            let is_head = i == tokens.len() - 1;
            let head = if is_head { HEAD_MULT } else { 1.0 };
            total += w * head * if strict { 1.0 } else { BRIDGE_DISCOUNT };
            // An exact match on the head noun is the object's true identity —
            // lift it into a tier no bridge match can reach.
            if is_head && strict {
                total += EXACT_HEAD_TIER;
            }
        }
    }
    any.then_some(total)
}

fn shortlist_entries<'a>(entries: &'a [TileLibraryEntry], tokens: &[String], idf: &HashMap<String, f64>, scene: &str, fw: u32, fh: u32, k: usize, allow_terrain: bool) -> Vec<&'a TileLibraryEntry> {
    let want = scene_biome(scene);
    // Keep only tiles that match a word actually NAMING the object. If nothing
    // does, the shortlist is deliberately EMPTY so the caller falls back to the
    // built-in glyph — better to draw the plain sprite than to confidently
    // draw the wrong object (live: "Broken crockery" → a broken window).
    let identified: Vec<&TileLibraryEntry> = entries
        .iter()
        .filter(|e| e.w <= fw && e.h <= fh && (allow_terrain || !is_terrain_only(&e.category)) && has_identity_match(e, tokens))
        .collect();
    if identified.is_empty() {
        return Vec::new();
    }
    // The catalog KNOWS this object, just not at a size that fits the
    // placement — so everything left matches an adjective only, and picking one
    // draws a different object confidently. Live: "hanging iron chandelier"
    // (1x1) — all 8 catalog chandeliers are 2x2, so the sole survivor matched
    // "iron" and rendered a LAUNDRY IRON as the map's set piece. Refuse, the
    // same as for an object the catalog has never heard of.
    //
    // Gated on the head being findable SOMEWHERE so this never fires for a
    // label whose last word simply isn't catalog vocabulary ("Bar counter" —
    // no "counter" tile exists, and the bar tile it does find is correct).
    let head_matches = |e: &&TileLibraryEntry| tokens.last().map_or(false, |h| e.keywords.iter().any(|k| token_matches(k, h) || bridges(k, h)));
    if entries.iter().any(|e| head_matches(&e)) && !identified.iter().any(head_matches) {
        return Vec::new();
    }
    let mut scored: Vec<(f64, &TileLibraryEntry)> = identified
        .into_iter()
        .filter_map(|e| shortlist_rank(e, tokens, idf).map(|s| (s * biome_affinity(want, &e.biome) * condition_fit(e, tokens), e)))
        .collect();
    scored.sort_by(|a, b| {
        b.0.total_cmp(&a.0) // higher rarity-weighted rank first
            .then_with(|| (b.1.w * b.1.h).cmp(&(a.1.w * a.1.h)))
            .then_with(|| a.1.keywords.len().cmp(&b.1.keywords.len()))
            .then_with(|| a.1.rel_path.len().cmp(&b.1.rel_path.len()))
    });
    // Diversify: every exact-head match scores IDENTICALLY (same head keyword →
    // same idf), so the tiebreak alone decided the whole top-K and returned K
    // variants of ONE tile family — live, "Pillar" returned eight
    // Flesh_Pale_Pillar_* and the vision picker had no tavern pillar to choose.
    // Show one per family first, then backfill with the leftover variants.
    // Family = keywords (which already exclude variant tokens) PLUS footprint:
    // two sizes of the same object are a real choice for a slot, not redundant
    // copies, so a 2x2 and a 1x1 table must both survive — only the A1/B1/C1
    // style variants of one identically-sized tile collapse.
    let mut seen: HashSet<(String, u32, u32)> = HashSet::new();
    let (mut firsts, mut rest): (Vec<&TileLibraryEntry>, Vec<&TileLibraryEntry>) = (Vec::new(), Vec::new());
    for (_, e) in scored {
        if seen.insert((e.keywords.join("_"), e.w, e.h)) {
            firsts.push(e);
        } else {
            rest.push(e);
        }
    }
    firsts.into_iter().chain(rest).take(k).collect()
}

/// Which catalog biome a scene wants. The scene word comes from
/// `classify_biome` (tavern, cave, forest, …); catalog biomes are the
/// top-level pack folders. `!Core_Settlements` is the generic human-built set
/// and fits almost any civilised scene, so it's always allowed.
fn scene_biome(scene: &str) -> &'static str {
    let s = scene.to_lowercase();
    for (needle, biome) in [
        ("cave", "Underdark"), ("underdark", "Underdark"), ("forest", "Woodlands"), ("jungle", "Jungle"),
        ("desert", "Desert"), ("snow", "Arctic"), ("arctic", "Arctic"), ("swamp", "Swamp"), ("marsh", "Swamp"),
        ("volcan", "Volcanic"), ("mountain", "Mountain"), ("water", "Aquatic"), ("coast", "Aquatic"),
        ("sea", "Aquatic"), ("horror", "Horror"), ("astral", "Astral"), ("fey", "Feywilds"),
    ] {
        if s.contains(needle) {
            return biome;
        }
    }
    "!Core_Settlements"
}

/// How much an entry's own biome disqualifies it for this scene. A tile from
/// the scene's biome, or from the universal `!Core_Settlements` set, is
/// unpenalised; anything from an unrelated biome is knocked far down so it
/// can't crowd the shortlist. This is what keeps Horror flesh pillars and
/// Arctic "Frosty" floorboards out of a tavern — the ranking itself is
/// otherwise entirely biome-blind.
fn biome_affinity(scene_biome: &str, entry_biome: &str) -> f64 {
    if entry_biome == scene_biome || entry_biome == "!Core_Settlements" {
        1.0
    } else {
        0.15
    }
}

/// A shortlist entry the vision picker is shown: the loaded image plus enough
/// identity (`root` + `rel_path`) to persist the pick and reload it later.
#[derive(Serialize, Clone, Debug)]
pub struct TileCandidate {
    pub root: String,
    pub rel_path: String,
    pub w: u32,
    pub h: u32,
    pub data_url: String,
    /// What this tile IS, with overrides and the audit already applied — so
    /// callers never need to know whether it came from the manifest or from
    /// decoding the bytes just now.
    pub kind: ArtKind,
    /// Mean luminance 0-255, when known. `None` only if the art was neither
    /// audited nor decodable.
    pub luminance: Option<f64>,
}

/// The shortlist as loadable candidates (image bytes read + base64'd) for a
/// footprint slot — what the vision picker looks at. Empty when nothing's
/// imported, the query has no usable tokens, or nothing fits.
/// `scene` is the classified biome word for the map being built (tavern, cave,
/// …) — it keeps tiles from unrelated biomes (Horror flesh, Arctic frost) from
/// crowding out the ones that belong. Pass "" for no scene preference.
pub fn shortlist(app: &AppHandle, query: &str, scene: &str, fw: u32, fh: u32, k: usize) -> Vec<TileCandidate> {
    shortlist_impl(app, query, None, scene, fw, fh, k)
}

/// Like `shortlist`, but restricted to a single catalog category (e.g.
/// "Textures") — used to resolve BIOME GROUND, where only tileable ground
/// textures qualify, never a sand-coloured crate that happens to keyword-match.
pub fn shortlist_in_category(app: &AppHandle, query: &str, category: &str, scene: &str, fw: u32, fh: u32, k: usize) -> Vec<TileCandidate> {
    shortlist_impl(app, query, Some(category), scene, fw, fh, k)
}

/// keyword → IDF for the currently-imported library, cached in state and keyed
/// by entry count so a re-import recomputes it. Built once on first shortlist.
fn load_idf_cached(app: &AppHandle, manifest: &TileLibraryManifest) -> std::sync::Arc<HashMap<String, f64>> {
    let state = app.state::<TileLibraryState>();
    let mut guard = state.idf.lock().unwrap();
    if let Some((n, idf)) = guard.as_ref() {
        if *n == manifest.entries.len() {
            return idf.clone();
        }
    }
    let idf = std::sync::Arc::new(compute_idf(&manifest.entries));
    *guard = Some((manifest.entries.len(), idf.clone()));
    idf
}

fn shortlist_impl(app: &AppHandle, query: &str, category: Option<&str>, scene: &str, fw: u32, fh: u32, k: usize) -> Vec<TileCandidate> {
    let Some(manifest) = load_manifest_cached(app).ok().flatten() else { return Vec::new() };
    let tokens = tokenize_query(query);
    if tokens.is_empty() {
        return Vec::new();
    }
    // IDF is computed over the WHOLE catalog (a keyword's rarity doesn't depend
    // on which category we're currently searching), then applied to the pool.
    let idf = load_idf_cached(app, &manifest);
    let pool: Vec<&TileLibraryEntry> = match category {
        Some(cat) => manifest.entries.iter().filter(|e| e.category.eq_ignore_ascii_case(cat)).collect(),
        None => manifest.entries.iter().collect(),
    };
    // shortlist_entries wants a slice; build one of references' clones only when
    // filtered (cheap — Textures is ~3.5k of 183k).
    let filtered: Vec<TileLibraryEntry>;
    let entries: &[TileLibraryEntry] = if category.is_some() {
        filtered = pool.into_iter().cloned().collect();
        &filtered
    } else {
        &manifest.entries
    };
    // An explicit category means the caller wants that shelf as-is (the floor
    // resolver asking for Textures); otherwise this is an OBJECT slot, so
    // over-fetch and drop anything that measures as ground art. The category
    // list catches this on packs we recognise — the measurement catches it on
    // the ones we don't, which is the whole point.
    let object_slot = category.is_none();
    let want = if object_slot { k + GROUND_FILTER_MARGIN } else { k };
    let overrides = load_overrides_cached(app);
    shortlist_entries(entries, &tokens, &idf, scene, fw, fh, want, !object_slot)
        .into_iter()
        .filter_map(|e| {
            // Prefer the audit's stored verdict; only decode when this entry has
            // never been measured (un-audited library, or a pack merged in since
            // the last audit).
            let audited = manifest.measured.get(&e.rel_path).copied();
            let decoded = if audited.is_none() { load_tile_art(&e.root, &e.rel_path)? } else { (load_tile_data_url(&e.root, &e.rel_path)?, None) };
            let (data_url, signals) = decoded;
            // A human's correction always wins over anything we worked out.
            let kind = overrides
                .get(&e.rel_path)
                .copied()
                .or(audited.map(|m| m.kind))
                .unwrap_or_else(|| classify_art(&e.rel_path, signals));
            if object_slot && kind == ArtKind::Ground {
                return None;
            }
            let luminance = audited.map(|m| m.lum as f64).or(signals.map(|s| s.luminance));
            Some(TileCandidate { root: e.root.clone(), rel_path: e.rel_path.clone(), w: e.w, h: e.h, data_url, kind, luminance })
        })
        .take(k)
        .collect()
}

/// How many extra candidates to rank so the measured ground filter has slack to
/// drop some without shrinking the vision picker's choice below `k`.
const GROUND_FILTER_MARGIN: usize = 4;

/// A warm flame effect sprite (`!Effects/Fire/Fire_Red|Orange|Yellow_*`) to
/// stack in a hearth's firebox, sized to fit within `fw`x`fh`. The catalog
/// ships every fireplace UNLIT — the flame lives as a separate effect sprite
/// meant to be overlaid — so a "lit hearth" is hearth base + this. Returns
/// `(root, rel_path, w, h)`; deterministic (largest flame that fits, then
/// alphabetically-first path) so a regenerate is stable. `None` if nothing
/// imported or no flame fits.
pub fn pick_flame_overlay(app: &AppHandle, fw: u32, fh: u32) -> Option<(String, String, u32, u32)> {
    let manifest = load_manifest_cached(app).ok().flatten()?;
    manifest
        .entries
        .iter()
        .filter(|e| {
            let name = e.rel_path.rsplit(['/', '\\']).next().unwrap_or("");
            (name.starts_with("Fire_Red_") || name.starts_with("Fire_Orange_") || name.starts_with("Fire_Yellow_"))
                && !name.contains("Embers")
                && !name.contains("Area")
                && !name.contains("Path")
        })
        .filter(|e| e.w <= fw && e.h <= fh && e.w > 0 && e.h > 0)
        .max_by_key(|e| (e.w * e.h, std::cmp::Reverse(e.rel_path.clone())))
        .map(|e| (e.root.clone(), e.rel_path.clone(), e.w, e.h))
}

/// Reads one catalog tile and base64-encodes it as a data URL — `None` if the
/// file is gone. Used both to build the shortlist and, later, to reload a
/// resolved pick for rendering (`get_map_tiles`).
pub fn load_tile_data_url(root: &str, rel_path: &str) -> Option<String> {
    load_tile_art(root, rel_path).map(|(url, _)| url)
}

/// The data URL AND what the art measures as, from a single read. Decoding is
/// only ever done on shortlisted candidates (~12 per placement); measuring the
/// whole library was timed at 17.6 minutes for 183k files.
pub fn load_tile_art(root: &str, rel_path: &str) -> Option<(String, Option<ArtSignals>)> {
    let bytes = fs::read(Path::new(root).join(rel_path)).ok()?;
    let ext = Path::new(rel_path).extension()?.to_str()?;
    Some((to_data_url(&bytes, ext), art_signals(&bytes)))
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

    /// Real bug, found live: some FA files use a bare single letter (no
    /// digit) as a style marker — `is_variant_token` only catches
    /// letter+digit combos, so "A" alone slipped through. Replaying the real
    /// 162k-entry catalog through the (then-)current logic put "a"/"b" into
    /// the object vocabulary as if they were real descriptive words.
    #[test]
    fn keywords_from_stem_drops_bare_single_letter_tokens() {
        let kws = keywords_from_stem("Table_Round_Wood_A");
        assert_eq!(kws, vec!["table", "round", "wood"]);
    }

    #[test]
    fn biome_category_from_rel_reads_the_fa_assets_layout() {
        // "!Wilderness" is skipped over, not matched — Flora (found one level
        // deeper) is the real, useful category, same fix as the settlement-name
        // case below.
        let rel = Path::new("FA_Assets_Webp/Woodlands/!Wilderness/Flora/Trees/Tree_Yellow_D8_3x3.webp");
        assert_eq!(biome_category_from_rel(rel), ("Woodlands".to_string(), "Flora".to_string()));
    }

    #[test]
    fn biome_category_from_rel_falls_back_for_a_non_fa_layout() {
        let rel = Path::new("Dungeon/Furniture/table_01.png");
        assert_eq!(biome_category_from_rel(rel), ("Dungeon".to_string(), "Furniture".to_string()));
    }

    /// Real bug, found live: a pack folder NAME (not a nested "FA_Assets"
    /// content root) can itself start with "FA_Assets" —
    /// `FA_Assets_Expansion_Webp_v1.12` — so anchoring on the FIRST match
    /// mis-reads the literal string "FA_Assets_Webp" as the biome and
    /// swallows the real biome (Arctic) into category. ~3,000 real entries
    /// were affected before this was fixed to anchor on the LAST match.
    #[test]
    fn biome_category_from_rel_anchors_on_the_last_fa_assets_segment_not_the_first() {
        let rel = Path::new("FA_Assets_Expansion_Webp_v1.12/FA_Assets_Webp/Arctic/!Wilderness/Decor/Cairns/Cairn_Stone_Slate_Snowy_A1_1x1.webp");
        assert_eq!(biome_category_from_rel(rel), ("Arctic".to_string(), "Decor".to_string()));
    }

    /// Real bug, found live: a biome with its own named settlement puts the
    /// SETTLEMENT NAME where category used to be read from, one level too
    /// shallow — `Base_Woodlands_Settlement` is not a category, `Structures`
    /// (found one level deeper) is. This also means the Import UI's
    /// by-category summary was silently wrong for every named-settlement
    /// biome before this fix.
    #[test]
    fn biome_category_from_rel_skips_a_settlement_name_to_find_the_real_category() {
        let rel = Path::new("Core_Mapmaking_Pack_Webp_v1.01/FA_Assets_Webp/Woodlands/Base_Woodlands_Settlement/Structures/Building/Doors/Shack_Door_Wood_Ashen_A1_1x1.webp");
        assert_eq!(biome_category_from_rel(rel), ("Woodlands".to_string(), "Structures".to_string()));
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
            root: "r".into(),
            rel_path: "x".into(),
            biome: "Woodlands".into(),
            category: "Furniture".into(),
            keywords: vec!["round".into(), "wooden".into(), "table".into()],
            w: 2,
            h: 2,
        };
        // Head noun "table" matches (HEAD_WEIGHT) + two adjectives (round,
        // wooden→wood... here "wooden" IS the keyword); "dining" matches
        // nothing.
        assert_eq!(score(&entry, &tokenize_query("round wooden dining table")), HEAD_WEIGHT + 2);
        // Plural of the head noun still matches, no adjectives.
        assert_eq!(score(&entry, &tokenize_query("tables")), HEAD_WEIGHT);
        // Head noun doesn't match anything → dropped entirely.
        assert_eq!(score(&entry, &tokenize_query("campfire")), 0);
    }

    /// The exact live failure (2026-07-19): "small wooden crate" placed a
    /// Rat_Trap at B9, because the old both-ways substring match let the
    /// keyword "rat" match INSIDE the query word "crate". token_matches must
    /// reject that while still accepting real plural/suffix forms.
    #[test]
    fn token_matches_accepts_plurals_and_suffixes_but_not_buried_substrings() {
        assert!(token_matches("table", "tables")); // plural
        assert!(token_matches("wood", "wooden")); // adjective form (2-char suffix)
        assert!(token_matches("crate", "crate")); // exact
        assert!(!token_matches("rat", "crate")); // "rat" is buried in "crate"
        assert!(!token_matches("bar", "barrel")); // "bar" is a prefix but 3 chars short
        assert!(!token_matches("can", "candle")); // ditto
        assert!(!token_matches("heart", "hearth")); // "h" is not a plural/adjective ending
        assert!(token_matches("bench", "benches")); // real "es" plural still matches
    }

    /// The head noun (last token) is the object's identity and is REQUIRED —
    /// an entry that only shares adjectives ("small", "wood") with the query
    /// but not the noun scores 0, so it never renders a lookalike.
    #[test]
    fn shortlist_only_keeps_tiles_that_fit_and_prefers_the_largest() {
        let sized = |kw: &[&str], w: u32, h: u32, path: &str| TileLibraryEntry {
            root: "r".into(),
            rel_path: path.into(),
            biome: "b".into(),
            category: "Furniture".into(),
            keywords: kw.iter().map(|s| s.to_string()).collect(),
            w,
            h,
        };
        let entries = vec![
            sized(&["table", "wood"], 2, 2, "table_2x2"),
            sized(&["table", "wood"], 1, 1, "table_1x1"),
            sized(&["table", "wood"], 3, 3, "table_3x3"), // too big for a 2x2 slot
            sized(&["chair", "wood"], 2, 2, "chair_2x2"), // wrong head noun
        ];
        let tokens = tokenize_query("wooden table");
        let idf = compute_idf(&entries);
        let got: Vec<&str> = shortlist_entries(&entries, &tokens, &idf, "", 2, 2, 10, false).iter().map(|e| e.rel_path.as_str()).collect();
        // 3x3 excluded (doesn't fit the footprint). The two real tables rank
        // first by head noun (2x2 before 1x1 — fewer repeats); the chair still
        // appears LAST because it shares the "wood" adjective — that's the
        // intended recall, since the vision picker looks and rejects it.
        assert_eq!(got, vec!["table_2x2", "table_1x1", "chair_2x2"]);
    }

    /// Live bug (2026-07-19): "Shelf of bottles" made "bottles" the head noun,
    /// so all 8 candidates were loose glassware (Ink_Bottle, Milk_Bottle) and
    /// not one shelf. The CONTAINER is the identity; the contents are a hint.
    #[test]
    fn normalize_query_makes_the_container_the_head_not_its_contents() {
        assert_eq!(normalize_query("Shelf of bottles"), "bottles shelf");
        assert_eq!(tokenize_query("Shelf of bottles").last().unwrap(), "shelf");
        assert_eq!(tokenize_query("Shelf of filled bottles").last().unwrap(), "shelf");
        // No "of" — untouched, last word stays the head.
        assert_eq!(tokenize_query("wooden crate").last().unwrap(), "crate");
    }

    /// Regression in the "X of Y" fix itself: swapping made "stack" the head
    /// of "Stack of wooden crates", which matched Coal_Stack/Planks_Stack
    /// instead of crates. A quantifier is not the object.
    #[test]
    fn normalize_query_does_not_swap_a_quantifier_for_the_real_noun() {
        assert_eq!(tokenize_query("Stack of wooden crates").last().unwrap(), "crates");
        assert_eq!(tokenize_query("Pile of rubble").last().unwrap(), "rubble");
        // A real container still swaps — that's the case the rule exists for.
        assert_eq!(tokenize_query("Shelf of bottles").last().unwrap(), "shelf");
    }

    /// The pack-agnostic half of the terrain guard: judged from the pixels, so
    /// a vendor whose folders we've never seen still can't put ground art in an
    /// object slot. Numbers are the measured medians from 960 sampled catalog
    /// entries, not invented thresholds.
    #[test]
    fn art_signals_separate_ground_from_props_and_flag_unusable_floors() {
        let sig = |opaque: f64, edges: u8, luminance: f64| ArtSignals { opaque, edges, luminance };

        // Ground: opaque corner to corner. (Textures measured ~1.00 / 4 edges.)
        assert_eq!(sig(1.00, 4, 92.0).kind(), ArtKind::Ground);
        assert_eq!(sig(0.94, 4, 120.0).kind(), ArtKind::Ground);
        // Props float free. (Decor/Furniture/Flora measured 0.13-0.29 / 0 edges.)
        assert_eq!(sig(0.16, 0, 90.0).kind(), ArtKind::Prop);
        assert_eq!(sig(0.29, 0, 90.0).kind(), ArtKind::Prop);
        // A cliff-edging strip spans one axis only — NOT ground, because the
        // same shape is a Wall_*_Straight segment and excluding it deleted real
        // walls. That one stays with the category list.
        assert_ne!(sig(0.35, 2, 90.0).kind(), ArtKind::Ground);

        // Floor usability, calibrated on two real textures: Cave_Floor_02_A
        // rendered correctly, Gravel_05_F rendered as mud.
        assert!(luminance_is_usable_floor(91.9), "Cave_Floor_02_A must stay");
        assert!(!luminance_is_usable_floor(48.2), "Gravel_05_F is too dark to play on");
        assert!(luminance_is_usable_floor(162.8), "bright sand is fine");
        assert!(!luminance_is_usable_floor(250.0), "blown-out white swamps the art on top");
    }

    fn audit_row(rel_path: &str, kind: ArtKind, by: &'static str) -> AuditRow {
        AuditRow {
            rel_path: rel_path.into(), category: "Textures".into(), w: 1, h: 1,
            opaque: 0.75, edges: 4, luminance: 92.0, classified_as: kind, decided_by: by, override_kind: None,
        }
    }

    /// Live bug (2026-07-20, forest map): "Pine tree (1x1)" — every real tree
    /// in the pack is canopy art at 2x2+, so the only 1x1 match was a
    /// GINGERBREAD TREE, eight of which became the map's vegetation. The guide
    /// tells the prompt what sizes this pack actually stocks, per noun, so the
    /// model never writes a footprint that only novelty clutter can fill.
    #[test]
    fn footprint_guide_flags_nouns_with_no_real_1x1_pool_and_only_those() {
        let mk = |first: &str, w: u32, h: u32| TileLibraryEntry {
            root: "r".into(), rel_path: format!("{first}_{w}x{h}"), biome: "Woodlands".into(),
            category: "Flora".into(), keywords: vec![first.into(), "green".into()], w, h,
        };
        let mut entries = Vec::new();
        // trees: plenty of identity files, none at 1x1, real pool at 2x2
        for _ in 0..30 { entries.push(mk("tree", 2, 2)); }
        for _ in 0..10 { entries.push(mk("tree", 3, 3)); }
        // the trap: a novelty 1x1 whose LEADING token is the modifier — it
        // files under "gingerbread", so it can't launder "tree" into 1x1
        for _ in 0..25 { entries.push(mk("gingerbread", 1, 1)); }
        // statues: healthy 1x1 pool — needs no guidance
        for _ in 0..30 { entries.push(mk("statue", 1, 1)); }
        // a rare noun below MIN_IDENTITY — noise, stays out
        for _ in 0..5 { entries.push(mk("obelisk", 4, 4)); }

        let guide = footprint_guide(&entries);
        assert_eq!(guide, vec![("tree".to_string(), 2, 2)], "{guide:?}");

        // A fringe size must not become the guide minimum. Live: twelve 2x2
        // "Tree_Branch" entries against 278 standing trees derived "tree 2x2",
        // and every search landed in branch-and-novelty territory.
        let mut fringe = Vec::new();
        for _ in 0..12 { fringe.push(mk("tree", 2, 2)); }   // branches: 4%
        for _ in 0..150 { fringe.push(mk("tree", 3, 3)); }  // the real bulk
        for _ in 0..128 { fringe.push(mk("tree", 5, 5)); }
        let g2 = footprint_guide(&fringe);
        assert_eq!(g2, vec![("tree".to_string(), 3, 3)], "fringe 2x2 must be skipped: {g2:?}");
        // gingerbread itself has a fine 1x1 pool (25 >= 8) so it needs no line;
        // statue's 1x1 pool disqualifies it; obelisk is too rare.
    }

    /// The review list is the small, high-impact subset — not the whole
    /// undecided band. Getting this scope wrong is what turned a "verify ~1,100"
    /// into a 33,643-row CSV nobody would open.
    #[test]
    fn review_list_is_only_low_confidence_ground_and_unread_files() {
        // Mirror of the `needs_review` closure in audit_tile_library.
        let needs_review = |kind: ArtKind, by: &str| matches!(by, "name") && kind == ArtKind::Ground || by == "unread";

        // IN: name said ground (if wrong, an object silently vanishes) …
        assert!(needs_review(ArtKind::Ground, "name"));
        // … and a file that never read (flag it, don't call it prop).
        assert!(needs_review(ArtKind::Prop, "unread"));

        // OUT: confident pixel calls — 99.9% right, not worth a human.
        assert!(!needs_review(ArtKind::Ground, "pixels"));
        assert!(!needs_review(ArtKind::Prop, "pixels"));
        // OUT: the 30k that defaulted to prop — safe default, wrong one is only
        // a bad pick vision rejects, and there are far too many to review.
        assert!(!needs_review(ArtKind::Prop, "name"));
        // OUT: read fine but not a valid image — genuinely a prop fallback.
        assert!(!needs_review(ArtKind::Prop, "undecodable"));
    }

    /// The round trip has to survive a spreadsheet: a human opens the CSV,
    /// fills in a handful of `override` cells, saves, and re-imports.
    #[test]
    fn an_edited_audit_csv_round_trips_back_into_overrides() {
        let csv = audit_rows_to_csv(&[audit_row("a/Grate_Metal_D_01.webp", ArtKind::Ground, "name"), audit_row("b/Altar_Stone_E_2x1.webp", ArtKind::Prop, "name")]);
        assert!(csv.starts_with(AUDIT_CSV_HEADER), "{csv}");
        // Nothing overridden yet, so importing it back changes nothing.
        assert!(parse_override_csv(&csv).is_empty());

        // Now the human fills in two cells and blanks are left alone.
        let edited = csv.replace("ground,name,\n", "ground,name,prop\n").replace("prop,name,\n", "prop,name,ground\n");
        let got = parse_override_csv(&edited);
        assert_eq!(got.get("a/Grate_Metal_D_01.webp"), Some(&ArtKind::Prop));
        assert_eq!(got.get("b/Altar_Stone_E_2x1.webp"), Some(&ArtKind::Ground));
        assert_eq!(got.len(), 2);
    }

    #[test]
    fn audit_csv_survives_paths_with_commas_and_quotes() {
        let row = audit_row(r#"packs/Odd, "Vendor"/tile.webp"#, ArtKind::Undecided, "name");
        let csv = audit_rows_to_csv(&[row]).replace(",name,\n", ",name,ground\n");
        let got = parse_override_csv(&csv);
        assert_eq!(got.get(r#"packs/Odd, "Vendor"/tile.webp"#), Some(&ArtKind::Ground), "{csv}");
    }

    /// Someone will reorder or delete columns in Excel. Read by header name, and
    /// ignore anything unparseable rather than throwing the whole file away.
    #[test]
    fn override_import_tolerates_reordered_columns_and_junk_rows() {
        let csv = "override,junk,rel_path\nground,x,a/one.webp\n,x,a/two.webp\nnonsense,x,a/three.webp\n,,\nprop,x,a/four.webp\n";
        let got = parse_override_csv(csv);
        assert_eq!(got.get("a/one.webp"), Some(&ArtKind::Ground));
        assert_eq!(got.get("a/four.webp"), Some(&ArtKind::Prop));
        assert_eq!(got.len(), 2, "blank and unrecognised overrides are skipped, not errors: {got:?}");
        // A file with no usable header yields nothing rather than panicking.
        assert!(parse_override_csv("").is_empty());
        assert!(parse_override_csv("a,b,c\n1,2,3\n").is_empty());
    }

    /// Stage 2 of the cascade: the filename only ever adjudicates art the pixels
    /// could not settle. Perforated surface art (a floor grate, a lattice) is
    /// full of holes, so it measures like a sparse prop — the name is what
    /// recovers it. Tuned on the real catalog: this list took the end-to-end
    /// rate from 96.9% (pixels alone) to 99.6%.
    #[test]
    fn the_name_pass_only_adjudicates_what_the_pixels_could_not() {
        let sig = |opaque: f64, edges: u8| Some(ArtSignals { opaque, edges, luminance: 90.0 });

        // Confident pixels win outright — the name is never consulted, which is
        // what keeps a loose word list safe. Measured globally, "overlay" sits
        // on 1,458 legitimate Structures; every one is decided here.
        assert_eq!(classify_art("Arranged_Tarps_Overlay_A40_3x2.webp", sig(0.30, 0)), ArtKind::Prop);
        assert_eq!(classify_art("Cobblestone_A_01.jpg", sig(1.00, 4)), ArtKind::Ground);

        // Undecided + a surface word -> ground. These are the real misses the
        // pixel pass made: grates and grunge passes read as sparse props.
        assert_eq!(classify_art("Grate_Metal_D_01.webp", sig(0.75, 4)), ArtKind::Ground);
        assert_eq!(classify_art("Grunge_A.webp", sig(0.09, 4)), ArtKind::Ground);
        assert_eq!(classify_art("Pergola_Lattice_Wood_Light_C1.png", sig(0.53, 4)), ArtKind::Ground);

        // Undecided with no surface word -> prop, the safer failure: a stray
        // texture is a bad pick vision can still reject, a dropped prop just
        // silently disappears.
        assert_eq!(classify_art("Wall_Wood_Walnut_E_Straight_B_2x1.webp", sig(0.60, 2)), ArtKind::Prop);
        assert_eq!(classify_art("Altar_Stone_Sandstone_E_2x1.webp", sig(0.70, 2)), ArtKind::Prop);
        // "floor" is deliberately NOT a hint — it measured worse by swallowing
        // Floor_Break_*, which are structures.
        assert_eq!(classify_art("Floor_Break_Path_Wood_Ashen_I.webp", sig(0.10, 2)), ArtKind::Prop);

        // Undecodable art is a prop, never silently dropped.
        assert_eq!(classify_art("Grate_Metal_D_01.webp", None), ArtKind::Prop);
    }

    /// Live bug (2026-07-19, underdark map): "bone pile" resolved to
    /// `Textures/Bones/Bones_Dirt_A_01.jpg` — a seamless GROUND texture — which
    /// would render as a 2x1 rectangle of bone-patterned floor. Ground art is
    /// never a placeable object, but the floor resolver still needs it.
    #[test]
    fn ground_textures_are_never_offered_as_an_object_but_still_reachable_as_a_floor() {
        let mk = |cat: &str, path: &str| TileLibraryEntry {
            root: "r".into(), rel_path: path.into(), biome: "!Core_Settlements".into(),
            category: cat.into(), keywords: vec!["bone".into(), "dirt".into()], w: 1, h: 1,
        };
        let entries = vec![mk("Textures", "bones_dirt_texture"), mk("Clutter", "bone_pile_prop")];
        let idf = compute_idf(&entries);
        let q = tokenize_query("bone pile");

        let as_object = shortlist_entries(&entries, &q, &idf, "underdark", 1, 1, 8, false);
        assert_eq!(as_object.len(), 1, "ground art must not be an object candidate: {as_object:?}");
        assert_eq!(as_object[0].rel_path, "bone_pile_prop");

        // The floor path asks for Textures by name and must still see it.
        let as_floor = shortlist_entries(&entries, &q, &idf, "underdark", 1, 1, 8, true);
        assert_eq!(as_floor.len(), 2, "the floor resolver still needs ground textures: {as_floor:?}");

        assert!(is_terrain_only("Textures") && is_terrain_only("texture_overlays"));
        // Elevation is entirely cliff/ridge/bank EDGING strips — the art that
        // gave every cave map its illegible stalagmite scribbles.
        assert!(is_terrain_only("Elevation") && is_terrain_only("Shadow_Paths"));
        assert!(!is_terrain_only("Clutter") && !is_terrain_only("Structures") && !is_terrain_only("Flora") && !is_terrain_only("Decor"));
    }

    /// Live bug (2026-07-19, every cave map): "Stalagmite" resolved to a
    /// `Cliff_Paths` EDGING STRIP — art meant to run along a cliff top — which
    /// draws as an illegible scribble. It matched on the plural while the 312
    /// real props scored identically and lost an arbitrary tiebreak.
    #[test]
    fn a_cliff_edging_strip_is_not_a_stalagmite() {
        let mk = |cat: &str, kw: &[&str], path: &str| TileLibraryEntry {
            root: "r".into(), rel_path: path.into(), biome: "Mountain".into(),
            category: cat.into(), keywords: kw.iter().map(|s| s.to_string()).collect(), w: 1, h: 1,
        };
        let entries = vec![
            mk("Elevation", &["stalagmites", "cave", "stone", "slate", "path"], "cliff_path_strip"),
            mk("Decor", &["stalagmite", "rock", "slate"], "real_stalagmite"),
        ];
        let idf = compute_idf(&entries);
        let got = shortlist_entries(&entries, &tokenize_query("Stalagmite"), &idf, "cave", 1, 1, 8, false);
        assert_eq!(got.len(), 1, "the edging strip must not be a candidate at all: {got:?}");
        assert_eq!(got[0].rel_path, "real_stalagmite");
    }

    /// Live bug (2026-07-19, cave map): a trailing collective noun took the
    /// head slot, so "dark mushroom cluster" resolved to Crystal_Black_Cluster
    /// and "bone pile" to Stuffing_Pile — pillow stuffing. The quantifier list
    /// already existed; it just wasn't reachable from a bare compound.
    #[test]
    fn a_trailing_collective_noun_is_not_the_head() {
        assert_eq!(tokenize_query("dark mushroom cluster").last().unwrap(), "mushroom");
        assert_eq!(tokenize_query("bone pile").last().unwrap(), "bone");
        assert_eq!(tokenize_query("Rubble pile").last().unwrap(), "rubble");
        assert_eq!(tokenize_query("stack of crates").last().unwrap(), "crates");
        // The collective is kept as a hint, not discarded — a tile that really
        // is a pile should still score for it.
        assert!(tokenize_query("bone pile").contains(&"pile".to_string()));
        // Nothing to promote: a bare collective stays exactly as it is.
        assert_eq!(tokenize_query("pile"), vec!["pile".to_string()]);
        // And an ordinary compound is untouched.
        assert_eq!(tokenize_query("wooden crate").last().unwrap(), "crate");
    }

    /// A "Communal table" must not resolve to a FALLEN table, nor a "Stool" to
    /// a PIANO stool, just because the head noun matches.
    #[test]
    fn condition_words_demote_a_tile_the_label_never_asked_for() {
        let plain = entry("Furniture", &["table", "wood"]);
        let fallen = entry("Furniture", &["table", "fallen"]);
        let q = tokenize_query("communal table");
        assert_eq!(condition_fit(&plain, &q), 1.0);
        assert!(condition_fit(&fallen, &q) < 1.0);
        // ...but if the label DOES ask for it, no penalty.
        assert_eq!(condition_fit(&fallen, &tokenize_query("fallen table")), 1.0);
    }

    /// Live bug: "Broken crockery" has no catalog word for "crockery", so its
    /// only exact match was "broken" — and it proposed a broken WINDOW. With
    /// no real identity match the shortlist must return NOTHING so the caller
    /// falls back to the built-in glyph.
    #[test]
    fn shortlist_returns_nothing_rather_than_the_wrong_object() {
        let window = TileLibraryEntry {
            root: "r".into(), rel_path: "window_broken".into(), biome: "!Core_Settlements".into(),
            category: "Structures".into(), keywords: vec!["window".into(), "wood".into(), "broken".into()], w: 2, h: 1,
        };
        let idf = compute_idf(std::slice::from_ref(&window));
        let got = shortlist_entries(std::slice::from_ref(&window), &tokenize_query("Broken crockery"), &idf, "", 2, 1, 8, false);
        assert!(got.is_empty(), "a condition-word-only match is not an identity match: {got:?}");
        // The same tile IS a valid answer when the label really means a window.
        let got2 = shortlist_entries(std::slice::from_ref(&window), &tokenize_query("Broken window"), &idf, "", 2, 1, 8, false);
        assert_eq!(got2.len(), 1);
    }

    /// Live bug (2026-07-19): "hanging iron chandelier" at 1x1 rendered a
    /// LAUNDRY IRON (Workplace_Equipment/Cleaning/Laundry/Ironing) — every
    /// catalog chandelier is 2x2, so the size filter dropped them all and the
    /// only survivor matched the material word "iron". A known object that
    /// doesn't fit must refuse, not substitute something sharing an adjective.
    #[test]
    fn shortlist_refuses_when_the_object_exists_but_never_at_a_fitting_size() {
        let mk = |kw: &[&str], w: u32, h: u32, path: &str| TileLibraryEntry {
            root: "r".into(), rel_path: path.into(), biome: "!Core_Settlements".into(),
            category: "Decor".into(), keywords: kw.iter().map(|s| s.to_string()).collect(), w, h,
        };
        let entries = vec![
            mk(&["chandelier", "metal", "gray"], 2, 2, "chandelier_2x2"), // real thing, too big
            mk(&["iron", "wood", "red", "metal"], 1, 1, "laundry_iron_1x1"), // shares "iron" only
        ];
        let idf = compute_idf(&entries);
        let q = tokenize_query("hanging iron chandelier");
        let got = shortlist_entries(&entries, &q, &idf, "tavern", 1, 1, 8, false);
        assert!(got.is_empty(), "a 1x1 slot must get NOTHING, not a laundry iron: {got:?}");
        // Give it the room the chandelier actually needs and it resolves fine.
        let got2 = shortlist_entries(&entries, &q, &idf, "tavern", 2, 2, 8, false);
        assert_eq!(got2.first().map(|e| e.rel_path.as_str()), Some("chandelier_2x2"), "{got2:?}");
    }

    /// Live bug: "Pillar" in a TAVERN returned eight `Flesh_Pale_Pillar_*` from
    /// the Horror pack, because ranking never looked at biome at all.
    #[test]
    fn biome_affinity_demotes_a_tile_from_an_unrelated_biome() {
        assert_eq!(biome_affinity("!Core_Settlements", "!Core_Settlements"), 1.0);
        assert_eq!(biome_affinity("Underdark", "Underdark"), 1.0);
        // The universal settlement set is welcome in any scene.
        assert_eq!(biome_affinity("Underdark", "!Core_Settlements"), 1.0);
        // Horror flesh has no business in a tavern.
        assert!(biome_affinity("!Core_Settlements", "Horror") < 0.5);
        assert!(biome_affinity("!Core_Settlements", "Arctic") < 0.5);
    }

    #[test]
    fn scene_biome_maps_scene_words_and_defaults_to_the_settlement_set() {
        assert_eq!(scene_biome("tavern"), "!Core_Settlements");
        assert_eq!(scene_biome("cave"), "Underdark");
        assert_eq!(scene_biome("forest"), "Woodlands");
        assert_eq!(scene_biome("anything unknown"), "!Core_Settlements");
    }

    /// Every exact-head match scores identically, so without diversification
    /// the tiebreak alone filled the whole top-K with variants of ONE family —
    /// which is exactly how the vision picker ended up with no real choice.
    #[test]
    fn shortlist_shows_one_per_family_before_repeating_a_variant() {
        let v = |kw: &[&str], path: &str| TileLibraryEntry {
            root: "r".into(), rel_path: path.into(), biome: "!Core_Settlements".into(),
            category: "Furniture".into(), keywords: kw.iter().map(|s| s.to_string()).collect(), w: 1, h: 1,
        };
        let entries = vec![
            v(&["flesh", "pale", "pillar"], "flesh_a"),
            v(&["flesh", "pale", "pillar"], "flesh_b"),
            v(&["flesh", "pale", "pillar"], "flesh_c"),
            v(&["pillar", "stone"], "stone_a"),
            v(&["pillar", "wood"], "wood_a"),
        ];
        let idf = compute_idf(&entries);
        let got: Vec<&str> = shortlist_entries(&entries, &tokenize_query("pillar"), &idf, "", 1, 1, 3, false)
            .iter().map(|e| e.rel_path.as_str()).collect();
        assert_eq!(got.len(), 3);
        // Three DIFFERENT families, not three flesh variants.
        assert!(got.contains(&"stone_a") && got.contains(&"wood_a"), "shortlist must diversify families: {got:?}");
        assert_eq!(got.iter().filter(|p| p.starts_with("flesh")).count(), 1, "only one variant per family up front: {got:?}");
    }

    #[test]
    fn bridges_compound_words_to_a_base_keyword_but_never_short_words() {
        assert!(bridges("grave", "gravestone")); // prefix
        assert!(bridges("lamp", "lamppost")); // prefix
        assert!(bridges("shell", "seashell")); // suffix
        assert!(!bridges("rat", "crate")); // ≤3 chars — the false positive we already killed
        assert!(!bridges("bar", "barrel"));
        assert!(!bridges("vest", "gravestone")); // buried substring, not a boundary
        assert!(!bridges("table", "stables")); // ditto — "table" is mid-word in "stables"
    }

    fn idf_map(pairs: &[(&str, f64)]) -> HashMap<String, f64> {
        pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
    }

    #[test]
    fn shortlist_bridges_a_compound_label_the_model_wrote_to_the_catalog_base() {
        // "gravestone" isn't a plural of "grave", so strict scoring missed it;
        // the compound bridge surfaces the grave tile, and vision confirms.
        let idf = idf_map(&[("grave", 8.0), ("stone", 2.0), ("crate", 6.0), ("wood", 1.5)]);
        let grave = entry("Burial_and_Graves", &["grave", "stone"]);
        let got = shortlist_entries(std::slice::from_ref(&grave), &tokenize_query("gravestone"), &idf, "", 2, 2, 8, false);
        assert_eq!(got.len(), 1, "a compound label must reach its base-word tile");
        // An exact head match still outranks a bridge one.
        let exact_crate = entry("Decor", &["crate", "wood"]);
        assert!(shortlist_rank(&exact_crate, &tokenize_query("wooden crate"), &idf).unwrap() > shortlist_rank(&grave, &tokenize_query("gravestone"), &idf).unwrap());
    }

    /// Rarity weighting: for "gravestone" (which bridges both "grave" and the
    /// ubiquitous "stone"), the tile carrying the RARE, specific word must
    /// outrank a plain generic-stone tile — the compound-dilution fix.
    #[test]
    fn shortlist_rarity_prefers_the_specific_word_over_the_generic_one() {
        let idf = idf_map(&[("grave", 8.0), ("stone", 2.0), ("gray", 3.0)]);
        let grave = entry("Burial_and_Graves", &["grave", "stone"]);
        let rock = entry("Textures", &["stone", "gray"]);
        let q = tokenize_query("gravestone");
        let g = shortlist_rank(&grave, &q, &idf).unwrap();
        let r = shortlist_rank(&rock, &q, &idf).unwrap();
        assert!(g > r, "grave ({g}) must outrank generic stone ({r}) for 'gravestone'");
    }

    /// Live bug: "tableau" (a rare metal plaque, idf ~8.9) prefix-bridges
    /// "table" (common, idf ~4.1) and — with rarity weighting — buried every
    /// real table. An EXACT head match must always beat a bridge one.
    #[test]
    fn shortlist_exact_head_beats_a_rare_bridge_false_friend() {
        let idf = idf_map(&[("table", 4.1), ("tableau", 8.9), ("wood", 1.6), ("metal", 3.0)]);
        let table = entry("Furniture", &["table", "wood"]);
        let tableau = entry("Decor", &["tableau", "metal"]);
        let q = tokenize_query("table");
        assert!(shortlist_rank(&table, &q, &idf).unwrap() > shortlist_rank(&tableau, &q, &idf).unwrap());
    }

    /// The real "bar counter" failure: the model names the bar "Bar counter",
    /// but only "bar" is a catalog keyword. Strict scoring returned nothing (so
    /// the bar rendered as `=` tables); the shortlist must now surface the bar.
    #[test]
    fn shortlist_finds_a_compound_label_whose_last_word_isnt_a_catalog_noun() {
        let bar = TileLibraryEntry { root: "r".into(), rel_path: "bar_5x1".into(), biome: "b".into(), category: "Furniture".into(), keywords: vec!["bar".into(), "wood".into()], w: 5, h: 1 };
        let idf = idf_map(&[("bar", 7.5), ("wood", 1.6)]);
        let got = shortlist_entries(std::slice::from_ref(&bar), &tokenize_query("Bar counter"), &idf, "", 6, 1, 8, false);
        assert_eq!(got.len(), 1, "the real bar tile must be shortlisted for 'Bar counter'");
        assert_eq!(got[0].rel_path, "bar_5x1");
    }

    #[test]
    fn score_requires_the_head_noun_not_just_shared_adjectives() {
        let crate_entry = entry("Decor", &["crate", "wood", "red"]);
        let aquarium = entry("Decor", &["aquarium", "small", "wood"]);
        let q = tokenize_query("small wooden crate");
        assert!(score(&crate_entry, &q) >= HEAD_WEIGHT, "the real crate must match its head noun");
        assert_eq!(score(&aquarium, &q), 0, "adjective-only overlap must not match");
    }

    #[test]
    fn tokenize_query_drops_short_words() {
        assert_eq!(tokenize_query("a Round Table"), vec!["round".to_string(), "table".to_string()]);
    }

    fn entry(category: &str, keywords: &[&str]) -> TileLibraryEntry {
        TileLibraryEntry {
            root: "r".into(),
            rel_path: "x".into(),
            biome: "Woodlands".into(),
            category: category.into(),
            keywords: keywords.iter().map(|s| s.to_string()).collect(),
            w: 1,
            h: 1,
        }
    }

    #[test]
    fn object_vocabulary_only_draws_from_object_like_categories() {
        let entries = vec![
            entry("Furniture", &["table", "round", "woodlands", "furniture"]),
            entry("Structures", &["wall", "stone", "woodlands", "structures"]),
        ];
        let vocab = object_vocabulary(&entries);
        assert!(vocab.contains(&"table".to_string()));
        assert!(vocab.contains(&"round".to_string()));
        assert!(!vocab.contains(&"wall".to_string()), "Structures isn't placeable set-dressing: {vocab:?}");
        assert!(!vocab.contains(&"stone".to_string()), "{vocab:?}");
    }

    #[test]
    fn object_vocabulary_excludes_the_entrys_own_biome_and_category_words() {
        let entries = vec![entry("Furniture", &["table", "woodlands", "furniture"])];
        let vocab = object_vocabulary(&entries);
        assert_eq!(vocab, vec!["table".to_string()], "biome/category words are structural, not descriptive: {vocab:?}");
    }

    #[test]
    fn object_vocabulary_sorts_by_frequency_then_alphabetically() {
        let entries = vec![
            entry("Furniture", &["table"]),
            entry("Furniture", &["table"]),
            entry("Decor", &["candle"]),
            entry("Decor", &["candle"]),
            entry("Clutter", &["barrel"]),
        ];
        assert_eq!(object_vocabulary(&entries), vec!["candle".to_string(), "table".to_string(), "barrel".to_string()]);
    }

    /// "multicolor2" ranked 100th on raw frequency (781 uses) — a filename
    /// variant tag, not a word anyone would write an object label with.
    #[test]
    fn object_vocabulary_drops_filename_artifacts() {
        assert!(is_artifact_word("01") && is_artifact_word("multicolor2") && is_artifact_word("green1"));
        assert!(!is_artifact_word("table") && !is_artifact_word("bookshelf"));
        let entries = vec![entry("Furniture", &["table", "multicolor2", "01"])];
        assert_eq!(object_vocabulary(&entries), vec!["table".to_string()]);
    }

    #[test]
    fn object_vocabulary_is_capped() {
        let entries: Vec<TileLibraryEntry> = (0..VOCAB_CAP + 50)
            // Trailing "w" keeps these off `is_artifact_word`'s digit-suffix
            // rule — this is testing the CAP, not the artifact filter.
            .map(|i| TileLibraryEntry { root: "r".into(), rel_path: "x".into(), biome: "Woodlands".into(), category: "Furniture".into(), keywords: vec![format!("word{i}w")], w: 1, h: 1 })
            .collect();
        assert_eq!(object_vocabulary(&entries).len(), VOCAB_CAP);
    }

    fn entry_at(root: &str, rel_path: &str) -> TileLibraryEntry {
        TileLibraryEntry { root: root.into(), rel_path: rel_path.into(), biome: "Woodlands".into(), category: "Furniture".into(), keywords: vec!["table".into()], w: 1, h: 1 }
    }

    #[test]
    fn merge_manifest_adds_a_new_root_without_touching_existing_ones() {
        let existing = TileLibraryManifest { roots: vec!["C:/packA".into()], entries: vec![entry_at("C:/packA", "table.webp")], measured: HashMap::new() };
        let scanned = vec![entry_at("C:/packB", "barrel.webp")];
        let merged = merge_manifest(existing, "C:/packB", scanned);
        assert_eq!(merged.roots, vec!["C:/packA".to_string(), "C:/packB".to_string()]);
        assert_eq!(merged.entries.len(), 2);
        assert!(merged.entries.iter().any(|e| e.root == "C:/packA" && e.rel_path == "table.webp"));
        assert!(merged.entries.iter().any(|e| e.root == "C:/packB" && e.rel_path == "barrel.webp"));
    }

    /// Re-Importing (with merge) a root that's already part of the catalog
    /// must replace just that root's own entries, not duplicate them — and
    /// must not add a second copy of the root to the roots list.
    #[test]
    fn merge_manifest_replaces_its_own_root_instead_of_duplicating() {
        let existing = TileLibraryManifest {
            roots: vec!["C:/packA".into()],
            entries: vec![entry_at("C:/packA", "old_table.webp"), entry_at("C:/packA", "old_barrel.webp")],
            measured: HashMap::new(),
        };
        let rescanned = vec![entry_at("C:/packA", "new_table.webp")];
        let merged = merge_manifest(existing, "C:/packA", rescanned);
        assert_eq!(merged.roots, vec!["C:/packA".to_string()], "root must not be duplicated in the roots list");
        assert_eq!(merged.entries.len(), 1, "the old scan of this exact root must be fully replaced, not accumulated: {:?}", merged.entries);
        assert_eq!(merged.entries[0].rel_path, "new_table.webp");
    }
}
