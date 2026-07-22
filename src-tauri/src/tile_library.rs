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
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::pack_profile::{PackLayout, PackProfile, ProfileOverrides};

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
    /// The imported pack's profile, with human corrections already folded in.
    /// Read on every shortlist, so cached like the manifest.
    profile: Mutex<Option<std::sync::Arc<PackProfile>>>,
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
        ArtKind::Overlay => "overlay",
    }
}

fn parse_kind(s: &str) -> Option<ArtKind> {
    match s.trim().to_lowercase().as_str() {
        "ground" => Some(ArtKind::Ground),
        "prop" => Some(ArtKind::Prop),
        "overlay" => Some(ArtKind::Overlay),
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

fn profile_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(manifest_path(app)?.with_file_name("pack_profile.json"))
}

fn profile_overrides_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(manifest_path(app)?.with_file_name("pack_profile_overrides.json"))
}

/// The imported pack's profile: what was derived, with human corrections
/// folded over it. Falls back to `PackProfile::default()` — Forgotten
/// Adventures — whenever nothing has been profiled, so an install that predates
/// profiling behaves exactly as before.
pub(crate) fn load_profile_cached(app: &AppHandle) -> std::sync::Arc<PackProfile> {
    let state = app.state::<TileLibraryState>();
    let mut guard = state.profile.lock().unwrap();
    if let Some(cached) = guard.as_ref() {
        return cached.clone();
    }
    let read = |p: Result<PathBuf, String>| p.ok().and_then(|p| fs::read_to_string(p).ok());
    let derived: PackProfile = read(profile_path(app)).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let corrections: ProfileOverrides = read(profile_overrides_path(app)).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
    let arc = std::sync::Arc::new(derived.with_overrides(&corrections));
    *guard = Some(arc.clone());
    arc
}

/// Drops the cached profile so the next read picks up a freshly written one.
fn invalidate_profile_cache(app: &AppHandle) {
    *app.state::<TileLibraryState>().profile.lock().unwrap() = None;
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

/// Pure: one entry from a root-relative file path, or `None` if it's not an
/// image file this catalog indexes. `root` is left empty — `scan_dir` (the
/// only real caller) fills it in, since a merge Import needs to know which
/// folder each entry came from (see `TileLibraryEntry::root`) but this
/// function's own unit tests only care about the path-derived fields.
///
/// `layout` is how this pack files things — see pack_profile.rs. It used to be
/// hardcoded to Forgotten Adventures' scheme, which meant any other vendor's
/// pack had its biome and category read off whatever its first two path
/// segments happened to be.
fn parse_entry(rel: &Path, layout: &PackLayout) -> Option<TileLibraryEntry> {
    let ext = rel.extension()?.to_str()?.to_lowercase();
    if !IMAGE_EXTS.contains(&ext.as_str()) {
        return None;
    }
    let stem = rel.file_stem()?.to_str()?;
    let (stem_no_size, w, h) = split_footprint(stem);
    let (biome, category) = crate::pack_profile::biome_category_from_rel(rel, layout);
    let mut keywords = keywords_from_stem(stem_no_size);
    if !biome.is_empty() {
        keywords.push(biome.to_lowercase());
    }
    keywords.push(category.to_lowercase());
    Some(TileLibraryEntry { root: String::new(), rel_path: rel.to_string_lossy().replace('\\', "/"), biome, category, keywords, w, h })
}

fn scan_dir(root: &Path, dir: &Path, layout: &PackLayout, out: &mut Vec<TileLibraryEntry>) {
    let Ok(read) = fs::read_dir(dir) else { return };
    for entry in read.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_dir(root, &path, layout, out);
        } else if let Ok(rel) = path.strip_prefix(root) {
            if let Some(mut e) = parse_entry(rel, layout) {
                e.root = root.to_string_lossy().replace('\\', "/");
                out.push(e);
            }
        }
    }
}

fn scan_tile_library(root: &Path, layout: &PackLayout) -> Vec<TileLibraryEntry> {
    let mut out = Vec::new();
    scan_dir(root, root, layout, &mut out);
    out
}

/// Re-derives every entry's biome, category and keywords from its stored
/// `rel_path` under a new `layout` — what a re-profile applies, so learning a
/// pack's real scheme costs one pass over the manifest instead of another walk
/// of tens of thousands of files on a possibly-cold network drive.
fn reparse_entries(entries: &[TileLibraryEntry], layout: &PackLayout) -> Vec<TileLibraryEntry> {
    entries
        .iter()
        .filter_map(|e| {
            let mut fresh = parse_entry(Path::new(&e.rel_path), layout)?;
            fresh.root = e.root.clone();
            Some(fresh)
        })
        .collect()
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
/// Which categories those are is now a property of the imported PACK, not a
/// constant — see `PackProfile::object_categories` (its default is exactly the
/// FA list this used to hardcode).

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
fn footprint_guide(entries: &[TileLibraryEntry], profile: &PackProfile) -> Vec<(String, u32, u32)> {
    /// A "real" pool = at least a full vision shortlist's worth of art.
    const MIN_POOL: usize = 8;
    const MIN_IDENTITY: usize = 20;
    let mut by: HashMap<&str, Vec<(u32, u32)>> = HashMap::new();
    for e in entries {
        if !profile.is_object_category(&e.category) {
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
        Ok(Some(m)) => footprint_guide(&m.entries, &load_profile_cached(app)),
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
fn object_vocabulary(entries: &[TileLibraryEntry], profile: &PackProfile) -> Vec<String> {
    let mut counts: HashMap<&str, u32> = HashMap::new();
    for e in entries {
        if !profile.is_object_category(&e.category) {
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
    load_manifest_cached(app).ok().flatten().map(|m| object_vocabulary(&m.entries, &load_profile_cached(app))).unwrap_or_default()
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
/// Which categories those are is a property of the imported PACK — see
/// `PackProfile::terrain_categories` (its default is exactly the FA list this
/// used to hardcode). On a pack whose folders are named anything else, an empty
/// terrain list is what let ground art win object slots.

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
    /// Mean R,G,B of the opaque pixels, 0..255 each. Kept alongside luminance
    /// because luminance ALONE cannot tell whether two terrains will read apart:
    /// measured 2026-07-22, a volcano's basalt floor and its lava differ by only
    /// 12 in luminance and are unmistakable on screen, while a bog's marsh and
    /// its water differ by 21 and are indistinguishable. Hue is what separates
    /// them. See `LIQUID_FLOOR_CONTRAST_MIN`.
    pub rgb: [f64; 3],
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
    /// Compositing art: a layer with NO near-opaque pixel anywhere, meant to be
    /// drawn over something else — a drop shadow, a glow, a dirt or blood pass.
    /// Never a placeable object: drawn on its own it is a smudge. Measured, not
    /// named, so it holds for any pack's naming scheme. On this catalog it is
    /// 2,082 of 183,190 tiles — 1,000 humanoid body overlays, 464 saliva
    /// layers, ~155 tree and cactus shadows, cobwebs.
    Overlay,
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
        if self.opaque == 0.0 {
            return ArtKind::Overlay;
        }
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
        Some(ArtKind::Overlay) => ArtKind::Overlay,
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
    let mut rgb_sum = [0f64; 3];
    let (mut x0, mut x1, mut y0, mut y1) = (u32::MAX, 0u32, u32::MAX, 0u32);
    for (x, y, p) in img.enumerate_pixels() {
        if p[3] <= 200 {
            continue;
        }
        opaque += 1;
        lum_sum += 0.2126 * p[0] as f64 + 0.7152 * p[1] as f64 + 0.0722 * p[2] as f64;
        for (i, s) in rgb_sum.iter_mut().enumerate() {
            *s += p[i] as f64;
        }
        x0 = x0.min(x);
        x1 = x1.max(x);
        y0 = y0.min(y);
        y1 = y1.max(y);
    }
    // Decodable but never opaque is a RESULT, not a failure — it is exactly
    // what a compositing layer measures like, and returning `None` made it
    // indistinguishable from art we could not read at all. See ArtKind::Overlay.
    if opaque == 0 {
        return Some(ArtSignals { opaque: 0.0, edges: 0, luminance: 0.0, rgb: [0.0; 3] });
    }
    // 2% of the canvas counts as "reaching the edge" — matches the tolerance the
    // signals were validated at.
    let (mx, my) = ((w as f64 * 0.02) as u32, (h as f64 * 0.02) as u32);
    let edges = [x0 <= mx, x1 + mx >= w - 1, y0 <= my, y1 + my >= h - 1].iter().filter(|b| **b).count() as u8;
    Some(ArtSignals {
        opaque: opaque as f64 / (w as f64 * h as f64),
        edges,
        luminance: lum_sum / opaque as f64,
        rgb: rgb_sum.map(|s| s / opaque as f64),
    })
}

/// Function words that can never name an object, but are long enough to
/// survive the ≥3-char filter and DO appear as keywords in the catalog —
/// FA filenames keep the conjunction in `Staff_of_Thunder_And_Lightning`,
/// `Bow_And_Quiver`, `Dust_of_Sneezing_And_Choking`. Live: "rubble and broken
/// masonry" resolved to the Staff of Thunder and Lightning, because "and" was
/// a scoring token and only 31 tiles in 183k carry it, making it rare enough
/// for rarity weighting to treat as highly specific.
const STOP_WORDS: &[&str] = &["and", "the", "with", "from"];

fn tokenize_query(q: &str) -> Vec<String> {
    let mut tokens: Vec<String> = normalize_query(q)
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| t.len() >= 3 && !STOP_WORDS.contains(t))
        .map(|t| t.to_string())
        .collect();
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
    // A parenthetical is an aside the DM wrote for a human — which bank, which
    // passage, who stands where — never the object's name. It has to go before
    // anything else looks at the HEAD noun, because it lands exactly there:
    // "Jungle canopy (left bank)" made "bank" the head, so 45 canopy cells
    // searched for a river bank and drew palm-tree trunks.
    let lower = strip_parentheticals(&q.to_lowercase());
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

/// Drops `(...)` spans, keeping the text either side. An unclosed `(` swallows
/// the rest, which is the right call for a truncated caption.
pub(crate) fn strip_parentheticals(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth = 0u32;
    for c in s.chars() {
        match c {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.trim().to_string()
}

/// Words that count a thing rather than being the thing — "a stack of crates"
/// is crates, not a stack. Checked on the phrase left of "of".
///
/// This is a list of ENGLISH words, which is why it is allowed to be a list at
/// all: a collective noun is a property of the caption the DM writes, not of
/// the imported pack, so it stays correct on any catalog. Measuring instead —
/// "which family does this word live in?" — was tried and is strictly worse
/// here, because it answers from what the pack happens to stock: FA files
/// jewellery under `Ring_*`, so "ring" measured as a real object on THIS pack
/// and would measure as nothing on the next one.
///
/// Only add words that are never themselves a map object. `patch` is
/// deliberately absent (FA stocks `Plant_Patch_*`, and "thick bramble patch"
/// correctly resolves to one), as are `stand`, `bed`, `carpet`, `screen` and
/// `crown` — each is a real prop a DM might caption.
fn is_quantifier(w: &str) -> bool {
    const QUANTIFIERS: &[&str] = &[
        "stack", "stacks", "pile", "piles", "heap", "heaps", "row", "rows", "set", "sets", "pair", "pairs", "bunch",
        "group", "groups", "cluster", "clusters", "collection", "handful", "scattering", "assortment", "line",
        "lines", "bundle", "bundles", "load", "mound", "mounds",
        // Formation words for natural cover. Live (2026-07-21, `w1-feywild`):
        // "Giant mushroom ring" kept "ring" as the head, so the x8 head weight
        // went to the appended canonical "tree" and the ring drew as 45 autumn
        // deciduous trees while 2,164 mushroom tiles sat unmatched.
        "ring", "rings", "grove", "groves", "thicket", "thickets", "copse", "copses", "clump", "clumps", "tangle",
        "tangles",
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
    // Seasonal novelty art. It sits in the pack's universal set, so unlike a
    // Horror or Arctic tile it takes NO biome penalty on any scene, and a
    // catalog with 1,417 tiles keyworded "tree" will happily hand a forest a
    // decorated Christmas one — reported live, twice.
    // `gift` is the same art without the giveaway word in the filename:
    // `Gift_Sack_Cloth_Red_A1_2x1` is a Santa sack, and being 2x1 it beats
    // every honest 1x1 sack on footprint. Live, a mine's "Sack of stone ore"
    // drew it.
    "christmas", "gingerbread", "candy", "gift",
];

/// PART-WORDS DO NOT BELONG IN `CONDITION_WORDS` — tried and reverted
/// 2026-07-22, recorded so it isn't retried.
///
/// The problem is real: measured across three biomes in one round, a desert's
/// palms drew `Palm_Tree_Frond` slivers, a jungle's 27 canopy cells drew
/// `Palm_Tree_Trunk` (fallen logs, read from above as brown coils) and an
/// arctic treeline drew `Arctic_Fir_Tree_Stump_Snow`. A canopy of stumps is
/// not a canopy.
///
/// But adding "stump"/"trunk"/"frond"/"branch"/"leaf" here regressed
/// "fallen branch pile" to NOTHING, because `has_identity_match` strips
/// condition words unconditionally — not just when the query didn't ask for
/// them. So a word placed here stops being usable as an identity noun even in
/// a label that names it outright: `[fallen, branch, pile]` reduces to
/// `[pile]`, `Branch_Wood_Dark` carries no `pile` keyword, and the shortlist
/// empties. Every word already in the list above is a pure qualifier
/// ("fallen", "broken", "christmas"); these are plausible HEAD NOUNS, which is
/// the difference.
///
/// Two further findings for whoever picks this up, both measured:
///   * The stock decides what is even fixable. Desert carries 66 whole tree
///     tiles at 1x1 against 120 parts, so there the whole tree exists and is
///     merely outranked. Jungle's whole palms start at 4x5, so its trunks are
///     a catalog limit no ranking change can touch.
///   * Demotion could not have fixed the desert anyway: its whole 1x1 trees
///     are cacti and yuccas matching only "tree" (coverage 1) against
///     `Palm_Tree_Trunk` matching "palm"+"tree" (coverage 2), and coverage
///     sorts above the score the demotion scales. A real fix has to address
///     coverage-dominance, or pick the search size by glyph density so a
///     sparse treeline asks for whole-tree footprints in the first place.
const _PART_WORDS_ARE_NOT_CONDITION_WORDS: () = ();

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
fn same_word(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    let (short, long) = if a.len() < b.len() { (a, b) } else { (b, a) };
    // Only a genuine plural/adjective ENDING counts, not any ≤2-char tail — a
    // bare length check let "heart"+"h" match "hearth" (a human heart where a
    // hearth belonged). Keywords/queries are lowercase ASCII, so slicing at
    // short.len() is a safe char boundary.
    //
    // "-es" is refused on a word that ALREADY ends in "s": English forms those
    // plurals that way ("glass"/"glasses"), but so does every false friend, and
    // the false friends are what a tile catalog is full of — "broken glass"
    // resolved to `Glasses_Metal_Rusty_A_Broken`, a pair of rusty SPECTACLES,
    // while all 116 `Glass_Pile_*` tiles sat unreachable.
    let ending = &long[short.len()..];
    long.starts_with(short) && matches!(ending, "s" | "es" | "en") && !(ending == "es" && short.ends_with('s'))
}

/// Words this catalog uses interchangeably for the same object. A vendor's
/// filenames are naming, not a thesaurus: Forgotten Adventures files its 40
/// mind-flayer columns under `.../Structures/Building/Pillars/` but NAMES them
/// `Ceremorph_Support_Column_*`, so not one of the 4,850 tiles keyworded
/// `pillar` is Ceremorph and an illithid map's `o` cells fell through to core
/// stone pillars. `bridges` can't help — "pillar" and "column" share no prefix
/// or suffix — and no ranking tweak reaches a tile the identity gate already
/// dropped.
///
/// Deliberately kept to the pairs a measurement forced. `biome_affinity`
/// already contains the blast radius (an Astral tile is demoted 0.15x on any
/// non-Astral scene), so `pillar` changes ONLY on illithid/astral maps —
/// verified unchanged across the other 13 scene biomes. It also fixes the
/// reverse, which was broken everywhere: "marble column" on a tavern map
/// returned a glowing alien column, because the pack's only `column` tiles are
/// Ceremorph.
///
/// `hearth`/`fireplace` is the same mismatch with the blame reversed — here the
/// PROMPT is what speaks off-catalog. Measured 2026-07-21: `hearth` matches 0
/// of 183k tiles, `fireplace` matches 349, and the map-generation prompt's own
/// worked example names the feature "Hearth at B7". So every hall and tavern
/// asked for a word the catalog cannot answer, and `bridges` then diverted it
/// by SUFFIX — "earth" inside "hearth" — to `Stone_of_Controlling_Earth_-
/// Elementals`, a spell component, as the tavern's fireplace. Fixing it here
/// rather than in the prompt is deliberate: which noun a given art pack happens
/// to file its fireplaces under is not something the map author should have to
/// know, and a differently-named pack would just reopen the hole.
///
/// `iron`/`metal` is the materials case, and the pack's own `iron` keyword is
/// the trap. Measured 2026-07-21: exactly 50 tiles carry `iron`, and they are
/// `Iron_Wood` (36), `Iron_Maiden` (8), `Iron_Stand` (4), `Iron_Flask` —
/// ironwood, laundry irons and a torture device. NOTHING in this pack is
/// keyworded `iron` for being made of iron; that is spelled `metal`. So the
/// commonest material adjective in D&D prose bought a label nothing but
/// novelties, and it cost an industrial map its supports: "Iron support
/// pillar" drew 6 `Ceremorph_Support_Column` (illithid), because those 40
/// Astral tiles answer BOTH "support" and (via pillar/column) "pillar" for
/// coverage 2, while the right `Pillar_Metal_Gray_1x1` answered only "pillar"
/// for coverage 1 — and coverage sorts above the affinity-scaled score, so the
/// 0.15x off-biome penalty never got a vote. Making `iron` reach `metal` puts
/// the correct pillar on level coverage, where affinity can decide.
///
/// `stall`/`awning` is `hearth` again, on the market square. Measured
/// 2026-07-21: `stall`, `market`, `vendor` and `merchant` match **0** tiles
/// each, while `awning` matches 572 (all `Structures`, stocked 2x1/2x2/2x3) —
/// because from directly overhead a market stall IS its awning, and that is
/// what the pack draws. With nothing to answer the label, a town market's four
/// stalls resolved to `Fountain_Spill_Metal_Gold/Bronze_Tall`, so the square
/// filled with metal fountains and 572 awnings went unreached.
/// The third field is `merges`: whether BOTH words are live vocabulary in the
/// pack. Measured 2026-07-22 — this is not a judgement call, it's a count:
///   hearth 0 tiles / fireplace 349    translation
///   stall  0 tiles / awning    572    translation
///   iron  50 tiles, every one a false friend (ironwood, laundry irons, an
///         iron maiden) / metal        translation
///   pillar 4,850 tiles / column 40    MERGE — the pack stocks both, for
///                                     different art
/// A translation renames a word the pack cannot answer, so counting it as the
/// tile's own word costs nothing: no rival tile was going to answer `hearth`
/// literally. A MERGE joins two populated vocabularies, and there counting it
/// hands the joined tile a coverage point its rival earned literally — see
/// `shortlist_rank`, where only `pillar`/`column` is held back.
const SYNONYMS: &[(&str, &str, bool)] =
    &[("pillar", "column", true), ("hearth", "fireplace", false), ("iron", "metal", false), ("stall", "awning", false)];

/// The pair connecting `keyword` and `token`, if any.
fn synonym_pair(keyword: &str, token: &str) -> Option<&'static (&'static str, &'static str, bool)> {
    SYNONYMS
        .iter()
        .find(|(a, b, _)| (same_word(a, token) && same_word(b, keyword)) || (same_word(b, token) && same_word(a, keyword)))
}

fn token_matches(keyword: &str, token: &str) -> bool {
    same_word(keyword, token) || synonym_pair(keyword, token).is_some()
}

/// Whether this match is the keyword's OWN word — either literally, or through
/// a synonym that merely renames something the pack doesn't stock. Only a
/// coverage decision; scoring treats every synonym alike.
fn answers_in_its_own_words(keyword: &str, token: &str) -> bool {
    same_word(keyword, token) || synonym_pair(keyword, token).is_some_and(|(_, _, merges)| !merges)
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
    let scanned = scan_tile_library(&root_path, &load_profile_cached(&app).layout);
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
///
/// Also returns COVERAGE: how many of the label's naming words (condition
/// words excluded, same as `has_identity_match`) this entry matches at all.
/// Coverage sorts above the score because the score is multiplied by
/// `biome_affinity`, and a 0.15 cross-biome penalty is big enough to bury a
/// tile that answers the whole label under one that answers a single word of
/// it. Live: "bone pile" resolved to `Dice_D4_Bone` — a bone die — because the
/// catalog files its 105 `Beast_Bone_*_Pile` tiles under Horror, and the die,
/// matching only "bone" but sitting in the universal set, scored ~1030 against
/// the pile's ~165. Affinity keeps its real job (separating a tavern pillar
/// from `Flesh_Pale_Pillar`, where both cover exactly one word) as the
/// tiebreak WITHIN a coverage level.
fn shortlist_rank(entry: &TileLibraryEntry, tokens: &[String], idf: &HashMap<String, f64>) -> Option<(u32, f64)> {
    let mut total = 0.0;
    let mut any = false;
    let mut coverage = 0;
    let mut head_hit = false;
    for (i, t) in tokens.iter().enumerate() {
        // Best (rarest) keyword matching this token, whether that match was
        // exact, and whether it was the keyword's OWN word rather than a
        // declared synonym.
        let mut best: Option<(f64, bool, bool)> = None;
        for k in &entry.keywords {
            let strict = token_matches(k, t);
            if !strict && !bridges(k, t) {
                continue;
            }
            let w = idf.get(k.as_str()).copied().unwrap_or(1.0);
            if best.map_or(true, |(bw, _, _)| w > bw) {
                best = Some((w, strict, answers_in_its_own_words(k, t)));
            }
        }
        if let Some((w, strict, literal)) = best {
            any = true;
            // Only a LITERAL match counts toward coverage. A bridge is a
            // suffix/prefix coincidence as often as a real synonym, and
            // letting it buy coverage handed "driftwood pile" to
            // `Debris_Pile_Wood` (whose "wood" bridges "driftwood") over the
            // actual `Driftwood_Log`, and "dark mushroom" to an Underdark one.
            //
            // A MERGING synonym doesn't buy coverage either, though it still
            // scores at full weight (see SYNONYMS for which pairs merge and
            // why that is a measurement, not a judgement). Measured
            // 2026-07-22: "Support pillar" drew `Ceremorph_Support_Column`
            // (illithid) in EVERY scene — mine, foundry, tavern, cavern,
            // horror — because `support` matched literally and `pillar`
            // matched `column` through SYNONYMS, giving coverage 2 against
            // `Pillar_Wood_Red`'s 1 for the literal `pillar`. Coverage sorts
            // above biome affinity, so the 0.15x Astral penalty never got a
            // vote. Live in both maps rendered that day: 5 columns down a
            // dwarven mine, 6 across a foundry casting floor.
            //
            // Note what does NOT need this: "Iron support pillar" and "Stone
            // pillar" were already correct, because their material word gives
            // the right tile a literal match of its own and levels coverage.
            // Only a pillar with no material word loses, which is exactly the
            // case where affinity is the only signal left.
            //
            // Read off `best` (the rarest matching keyword) rather than "any
            // keyword matched this literally", deliberately. The looser form
            // was tried and reverted the same day: it also re-scored tiles
            // carrying BOTH a bridge and a literal match for one token, which
            // put `Underdark_Mushroom_Stalk_Dark` (literal `dark`, bridged
            // `underdark`) at the head of "dark mushroom cluster" in taverns
            // and forests — the exact live bug the bridge rule below was
            // written to stop.
            if literal && !is_condition_word(t) {
                coverage += 1;
            }
            let is_head = i == tokens.len() - 1;
            head_hit |= is_head;
            let head = if is_head { HEAD_MULT } else { 1.0 };
            total += w * head * if strict { 1.0 } else { BRIDGE_DISCOUNT };
            // An exact match on the head noun is the object's true identity —
            // lift it into a tier no bridge match can reach.
            if is_head && strict {
                total += EXACT_HEAD_TIER;
            }
        }
    }
    // A tile can reach here having answered the head noun through a SYNONYM
    // alone, which buys no coverage above — but "covered none of the query" is
    // then false, and a 0 sorts it below every literal match before affinity
    // gets a vote. That is the containment this synonym was built with: on an
    // illithid map a bare "Pillars" must still find the pack's own
    // `Ceremorph_Support_Column`, and everywhere else the 0.15x Astral penalty
    // must be what pushes it away. Floor coverage at 1 so the two are level and
    // the biome decides.
    any.then_some((coverage.max(u32::from(head_hit)), total))
}

fn shortlist_entries<'a>(entries: &'a [TileLibraryEntry], tokens: &[String], idf: &HashMap<String, f64>, scene: &str, fw: u32, fh: u32, k: usize, allow_terrain: bool, profile: &PackProfile) -> Vec<&'a TileLibraryEntry> {
    let want = scene_biome(scene, profile);
    // Keep only tiles that match a word actually NAMING the object. If nothing
    // does, the shortlist is deliberately EMPTY so the caller falls back to the
    // built-in glyph — better to draw the plain sprite than to confidently
    // draw the wrong object (live: "Broken crockery" → a broken window).
    //
    // `fits` accepts the TRANSPOSED footprint too: a top-down battle-map tile
    // rotates perfectly well, and refusing the rotation is how a 2x1 "Weapon
    // rack" ended up a WINE rack — all 247 weapon racks in the catalog are
    // 1x2, so every one was excluded and a 2x1 wine rack was the only "rack"
    // left standing. The renderer draws the swap (see ResolvedTile::rotated).
    let fits = |e: &TileLibraryEntry| (e.w <= fw && e.h <= fh) || (e.h <= fw && e.w <= fh);
    let identified: Vec<&TileLibraryEntry> = entries
        .iter()
        .filter(|e| fits(e) && (allow_terrain || !profile.is_terrain_category(&e.category)) && has_identity_match(e, tokens))
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
    let mut scored: Vec<((u32, f64), &TileLibraryEntry)> = identified
        .into_iter()
        .filter_map(|e| {
            shortlist_rank(e, tokens, idf).map(|(cov, s)| ((cov, s * biome_affinity(want, &e.biome, profile, allow_terrain) * condition_fit(e, tokens)), e))
        })
        .collect();
    // Upright before rotated at equal score, so a tile that already fits the
    // placement is never passed over for one that needs turning. This sits
    // BELOW the footprint tiebreak on purpose: rotation is free for top-down
    // art (that is the whole premise of admitting a transposed fit), so the
    // preference is cosmetic, while filling more of the run is functional.
    // Ordered the other way round it cost a live tavern its bar — an 11-cell
    // vertical "Bar counter" tied `Bar_Wood_Red_A1_5x1` with
    // `Lock_Bar_Wood_Red_A_1x3` (a door-barring plank) on every scoring term,
    // because the query head "counter" matches nothing in the catalog and both
    // cover exactly the word "bar" — and the upright 1x3 won, drawing four
    // spaced planks down the wall where the bar should be.
    let upright = |e: &TileLibraryEntry| e.w <= fw && e.h <= fh;
    // Among EQUALLY-scoring candidates, prefer one whose keywords name the
    // scene. `biome_affinity` cannot separate these: all 445 `Rubble_Stone_*`
    // tiles live in `!Core_Settlements`, the universal biome, so every one of
    // them scores affinity 1.0 for every scene — the material is only in the
    // filename (`volcanic`, `sandstone`, `earthy`, `slate`). "Collapsed
    // masonry" matches none of those words, so all 445 tied and the variety
    // picker fanned out across them, strewing tan sandstone over a black
    // basalt volcano. A tiebreak only ever reorders candidates the ranking
    // already called equal, so it cannot pull a worse-matching tile forward.
    let scene_word = scene.to_ascii_lowercase();
    let names_the_scene = |e: &TileLibraryEntry| !scene_word.is_empty() && e.keywords.iter().any(|k| same_word(k, &scene_word));
    scored.sort_by(|a, b| {
        // Naming the object beats describing it. Coverage counts matched words
        // without caring WHICH, so a tile that misses the head noun entirely
        // could out-cover one that nails it: "Dwarven iron forge" picked
        // `Dwarven_Worktop_Metal_Gray` (dwarven + metal = 2) over
        // `Forge_Stone_Slate` (forge = 1), losing the actual forge. This does
        // not weaken the coverage-first rule that fixed "bone pile" — there the
        // higher-coverage tile ALSO head-matched (`Beast_Bone_Pile` answers
        // "pile"), and the die it beat did not — so both cases now resolve on
        // the same principle instead of one paying for the other.
        head_matches(&b.1).cmp(&head_matches(&a.1))
            .then_with(|| b.0 .0.cmp(&a.0 .0)) // then more of the label's naming words answered
            .then_with(|| b.0 .1.total_cmp(&a.0 .1)) // then higher rarity-weighted rank
            .then_with(|| names_the_scene(b.1).cmp(&names_the_scene(a.1)))
            .then_with(|| (b.1.w * b.1.h).cmp(&(a.1.w * a.1.h)))
            .then_with(|| upright(b.1).cmp(&upright(a.1)))
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
/// `classify_biome` (tavern, cave, illithid, …) and the answer is one of the
/// imported pack's own biome folders, via its profile. Falls back to the pack's
/// universal set — the generic human-built collection that fits almost any
/// civilised scene — and to `""` for a pack that has neither, which
/// `biome_affinity` then treats as "no biome dimension, penalise nothing".
pub(crate) fn scene_biome<'a>(scene: &str, profile: &'a PackProfile) -> &'a str {
    profile.folder_for_scene(scene).or(profile.universal_biome.as_deref()).unwrap_or("")
}

/// How much an entry's own biome disqualifies it for this scene. A tile from
/// the scene's biome, or from the pack's universal set, is unpenalised;
/// anything from an unrelated biome is knocked far down so it can't crowd the
/// shortlist. This is what keeps Horror flesh pillars and Arctic "Frosty"
/// floorboards out of a tavern — the ranking itself is otherwise entirely
/// biome-blind.
///
/// The universal set is read from the PROFILE rather than compared against the
/// literal string `!Core_Settlements`. On any pack without a folder by that
/// exact name, the old hardcoded test made this return 0.15 for every tile in
/// the catalog, uniformly — which doesn't reorder anything, so nothing looked
/// broken, but it silently flattened biome affinity into a no-op.
///
/// `ground` reverses the universal set's free pass, and ONLY for it. A barrel
/// from the universal shelf belongs in any scene — that is what makes it
/// universal. The ground does not: it is the one layer that IS the biome, so a
/// tile from the scene's own folder must outrank the generic one whenever both
/// answer the query.
///
/// Measured 2026-07-22 over the 72 saved maps — every one of these classified
/// CORRECTLY and then drew a floor from `!Core_Settlements` anyway, because it
/// owns 1,007 of the catalog's 3,453 textures and was scoring 1.0 against the
/// right folder's 0.15:
///   * `mine` → `Stone_Tiles_A_03`, dressed flagstone down a collapsed seam,
///     while Mountain's own 123 stone textures sat at 0.15.
///   * `factory` → `Grate_Metal_A_06`, a drain grate tiled across a foundry
///     casting floor, over Industrial's own 125.
///   * `volcanic` → `Rocks_Overlay_A.webp`, a transparent decal, ahead of
///     `Lava_Rocks_A_01`.
/// It changes nothing for a scene whose own folder IS the universal one (a
/// tavern, a castle), and nothing for a scene with no textures of its own
/// (Jungle has zero, Feywilds four) — there the whole field is foreign and
/// scaling it uniformly reorders nothing, so borrowed grass still wins.
fn biome_affinity(scene_biome: &str, entry_biome: &str, profile: &PackProfile, ground: bool) -> f64 {
    let universal = profile.universal_biome.as_deref();
    let own = entry_biome.eq_ignore_ascii_case(scene_biome);
    if own || (!ground && universal.is_some_and(|u| entry_biome.eq_ignore_ascii_case(u))) {
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
    /// The pack biome folder this tile came from. Carried through so a caller
    /// spreading picks across a shortlist can keep them from ONE biome — see
    /// the field variety pool in campaign.rs. Read from the profile-derived
    /// entry rather than re-parsed out of `rel_path`, because deriving layout
    /// from paths is `pack_profile`'s job and doing it twice is how the two
    /// answers drift apart.
    pub biome: String,
    /// What this tile IS, with overrides and the audit already applied — so
    /// callers never need to know whether it came from the manifest or from
    /// decoding the bytes just now.
    pub kind: ArtKind,
    /// Mean luminance 0-255, when known. `None` only if the art was neither
    /// audited nor decodable.
    pub luminance: Option<f64>,
    /// Mean R,G,B when the art was decodable. Used to keep a liquid from
    /// vanishing into the floor it is drawn on — see `mean_rgb`.
    pub rgb: Option<[f64; 3]>,
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

/// Whether a shortlist request is for an OBJECT slot, which is what decides
/// if art that MEASURES as ground or as a compositing layer gets dropped.
///
/// A request with no category is always an object slot. A categorised request
/// is one only when the category isn't terrain: the floor resolver asking for
/// `Textures` wants that shelf as-is, while a field cell asking for `Flora` or
/// `Structures` is placing an object and still needs the measurement filter.
fn is_object_slot(category: Option<&str>, profile: &PackProfile) -> bool {
    category.is_none_or(|c| !profile.is_terrain_category(c))
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
    // Whether this is an OBJECT slot — the thing that decides if we over-fetch
    // and drop art that MEASURES as ground or as a compositing layer. The
    // category list catches those on packs we recognise; the measurement
    // catches them on the ones we don't, which is the whole point.
    //
    // Asked of the PROFILE, not of `category.is_some()`. That shortcut was
    // right only while the sole categorised caller was the floor resolver
    // asking for Textures. Field cells now ask for Flora and Structures — real
    // object shelves — and the shortcut silently switched their measurement
    // filter off, putting 14 semi-transparent `Palm_Tree_Trunk_Shadow` layers
    // back into a jungle canopy the moment the keyword backstop was removed.
    let profile = load_profile_cached(app);
    let object_slot = is_object_slot(category, &profile);
    let want = if object_slot { k + GROUND_FILTER_MARGIN } else { k };
    let overrides = load_overrides_cached(app);
    shortlist_entries(entries, &tokens, &idf, scene, fw, fh, want, !object_slot, &profile)
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
            // Ground art can't be an object, and neither can a compositing
            // layer — a drop shadow or a dirt pass drawn on its own is a
            // smudge. `Palm_Tree_Trunk_Shadow` was the top pick for a jungle
            // canopy and got stamped across 45 cells.
            if object_slot && matches!(kind, ArtKind::Ground | ArtKind::Overlay) {
                return None;
            }
            let luminance = audited.map(|m| m.lum as f64).or(signals.map(|s| s.luminance));
            Some(TileCandidate {
                root: e.root.clone(),
                rel_path: e.rel_path.clone(),
                w: e.w,
                h: e.h,
                data_url,
                biome: e.biome.clone(),
                kind,
                luminance,
                rgb: signals.map(|s| s.rgb),
            })
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

// ── Profiling an imported pack ───────────────────────────────────────────────

/// How many ground candidates per biome the profiler is shown, and how many
/// files it samples to measure each one's brightness. Sampling rather than
/// measuring all of them keeps a re-profile to seconds — a full-catalog decode
/// was timed at 17.6 minutes.
const GROUND_CANDIDATES_PER_BIOME: usize = 6;
const GROUND_SAMPLES_PER_CANDIDATE: usize = 5;
/// Filenames shown per ground candidate. More than one specifically so a word
/// that bridges two art families (`rock` reaching both `Rock_*` and
/// `Lava_Rocks_*`) shows it instead of looking like a clean single material.
const GROUND_EXAMPLES: usize = 3;
const SAMPLE_OBJECT_NAMES: usize = 8;

/// Mean luminance for one tile: the audit's stored measurement when there is
/// one, otherwise decoded now. `None` when the file can't be read.
/// A compositing layer has no meaningful luminance as GROUND evidence, so it
/// reports none — the profiler is being asked "is this material bright enough
/// to place minis on", and a drop shadow or a grunge pass is not the material.
///
/// This matters because `art_signals` now REPORTS a fully-transparent tile
/// (luminance 0.0) where it used to return `None` and be skipped here. 1,110
/// unmeasured entries sit inside terrain categories — 42 in `Textures` and 15
/// of the 28 `Texture_Overlays` — so without this a sampled overlay would drag
/// a ground word's mean luminance toward zero and the profiler would reject a
/// perfectly good floor as too dark to read minis on.
fn tile_luminance(e: &TileLibraryEntry, measured: &HashMap<String, MeasuredArt>) -> Option<f64> {
    if let Some(m) = measured.get(&e.rel_path) {
        return (m.kind != ArtKind::Overlay).then_some(m.lum as f64);
    }
    load_tile_art(&e.root, &e.rel_path)
        .and_then(|(_, s)| s)
        .filter(|s| s.kind() != ArtKind::Overlay)
        .map(|s| s.luminance)
}

/// How far apart, summed across R+G+B, a liquid and the floor it is drawn on
/// must sit before they read as different terrain.
///
/// Calibrated 2026-07-22 against four rendered maps that had already been
/// judged by eye, so the threshold is fitted to looking-right rather than to a
/// number picked in advance: volcanic basalt vs lava 256 (great), horror flesh
/// vs blood 222 (great, and red-on-red — the case a naive rule would reject),
/// sewer stone vs murky water 176 (fine), swamp marsh vs swamp water 64 (the
/// failure: 77 cells of channel a player simply cannot pick out from the bank).
/// 120 sits in the empty gap between 64 and 176 with room on both sides.
pub const LIQUID_FLOOR_CONTRAST_MIN: f64 = 120.0;

/// Summed absolute R+G+B difference between two mean colours.
pub fn colour_distance(a: [f64; 3], b: [f64; 3]) -> f64 {
    a.iter().zip(b.iter()).map(|(x, y)| (x - y).abs()).sum()
}

/// Mean R,G,B for one already-chosen tile, decoded now. `None` when the file
/// can't be read — callers then skip the contrast test rather than guess.
pub fn mean_rgb(root: &str, rel_path: &str) -> Option<[f64; 3]> {
    load_tile_art(root, rel_path).and_then(|(_, s)| s).map(|s| s.rgb)
}

/// What the profiler is shown about one biome. The ground candidates carry
/// MEASURED luminance because that is the only way to know a pack's own ground
/// art is too dark to place minis on — a fact no filename reveals.
fn build_biome_evidence(entries: &[TileLibraryEntry], profile: &PackProfile, measured: &HashMap<String, MeasuredArt>) -> Vec<crate::pack_profile::BiomeEvidence> {
    let mut by_biome: HashMap<&str, Vec<&TileLibraryEntry>> = HashMap::new();
    for e in entries {
        by_biome.entry(e.biome.as_str()).or_default().push(e);
    }
    let mut out: Vec<crate::pack_profile::BiomeEvidence> = by_biome
        .into_iter()
        .map(|(folder, tiles)| {
            let mut cats: HashMap<&str, usize> = HashMap::new();
            for e in &tiles {
                *cats.entry(e.category.as_str()).or_insert(0) += 1;
            }
            let mut categories: Vec<(String, usize)> = cats.into_iter().map(|(c, n)| (c.to_string(), n)).collect();
            categories.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

            // Ground candidates: identity word (the filename's leading token,
            // same notion footprint_guide uses) over this biome's terrain art.
            // Falls back to every category when the profile doesn't yet know
            // which are terrain — a first profile of an unknown pack.
            // A `Textures/Liquids/*` tile is a POOL, not ground — resolve_floor
            // excludes them, so the evidence must too or the numbers describe a
            // set the resolver will never return.
            let ground_pool: Vec<&TileLibraryEntry> = tiles
                .iter()
                .copied()
                .filter(|e| (profile.terrain_categories.is_empty() || profile.is_terrain_category(&e.category)) && !e.rel_path.contains("/Liquids/"))
                .collect();
            // Candidate WORDS come from the filename's leading token — the pack's
            // own identity word for a material, same notion footprint_guide uses.
            let mut words: HashMap<&str, usize> = HashMap::new();
            for e in &ground_pool {
                if let Some(w) = e.keywords.first().filter(|w| !is_artifact_word(w)) {
                    *words.entry(w.as_str()).or_insert(0) += 1;
                }
            }
            let mut ranked: Vec<(&str, usize)> = words.into_iter().collect();
            ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
            // ...but the STATS must describe the set that word will actually
            // select, which is a different set: the resolver matches any
            // keyword, plurals included, not just the leading one. Live, and the
            // reason this exists — Volcanic offered "rock" as 14 files at
            // luminance 60 (Rock_A_*), so the profiler picked it as the
            // non-hazard ground; `resolve_floor` then searched "rock", matched
            // "rocks" too, and pulled in 70 Lava_Rocks_* — BRIGHTER, so the
            // legibility filter preferred them and every volcano map rendered as
            // a sheet of molten lava. Reuses the resolver's own matcher so the
            // two cannot drift again.
            let ground = ranked
                .into_iter()
                .take(GROUND_CANDIDATES_PER_BIOME)
                .filter_map(|(word, _)| {
                    let tokens = tokenize_query(word);
                    let selected: Vec<&&TileLibraryEntry> = ground_pool.iter().filter(|e| has_identity_match(e, &tokens)).collect();
                    if selected.is_empty() {
                        return None;
                    }
                    // Sample ACROSS the selection, never off the front: the
                    // families a word pulls together sit in folder order, so the
                    // first five files are all one family and would report that
                    // family's luminance as the whole word's.
                    let spread = |n: usize| {
                        let step = (selected.len() / n).max(1);
                        selected.iter().step_by(step).take(n).collect::<Vec<_>>()
                    };
                    let lums: Vec<f64> = spread(GROUND_SAMPLES_PER_CANDIDATE).into_iter().filter_map(|e| tile_luminance(e, measured)).collect();
                    if lums.is_empty() {
                        return None; // unreadable (cold network drive) — say nothing rather than guess
                    }
                    let mean = lums.iter().sum::<f64>() / lums.len() as f64;
                    Some(crate::pack_profile::GroundCandidate {
                        word: word.to_string(),
                        files: selected.len(),
                        lum_min: lums.iter().cloned().fold(f64::MAX, f64::min) as u8,
                        lum_max: lums.iter().cloned().fold(0.0, f64::max) as u8,
                        lum_mean: mean as u8,
                        // Several, spread the same way: one filename cannot show
                        // that a word bridges two families, and that bridging is
                        // exactly what has to be visible to be avoided.
                        example: spread(GROUND_EXAMPLES).into_iter().map(|e| e.rel_path.rsplit('/').next().unwrap_or("").to_string()).collect::<Vec<_>>().join(", "),
                    })
                })
                .collect();

            // Real object filenames, so the pack's own vocabulary is visible —
            // this is what makes a mismatch like "pillar" vs "Support_Column"
            // something the profiler can actually see.
            let sample_objects = tiles
                .iter()
                .filter(|e| !profile.is_terrain_category(&e.category))
                .map(|e| e.rel_path.rsplit('/').next().unwrap_or("").to_string())
                .step_by((tiles.len() / SAMPLE_OBJECT_NAMES).max(1))
                .take(SAMPLE_OBJECT_NAMES)
                .collect();

            crate::pack_profile::BiomeEvidence { folder: folder.to_string(), tiles: tiles.len(), categories, ground, sample_objects }
        })
        .collect();
    out.sort_by(|a, b| b.tiles.cmp(&a.tiles).then_with(|| a.folder.cmp(&b.folder)));
    out
}

/// Checks each learned place's ground against the art it claims to come from,
/// and drops what the catalog can't back — the same "answer the model, then
/// verify it against the real files" step `prune_grouping_folders` does for the
/// layout pass. Two distinct failures, because they are evidence of different
/// things:
///
/// A query that matches NOTHING in its own folder means the row is internally
/// inconsistent — the model named a material that isn't in the folder it paired
/// the scene with, so nothing about that pairing is trustworthy and the whole
/// place goes. An unknown scene word degrades to the universal folder plus the
/// built-in floor, which is a defined, safe state; a half-wrong place quietly
/// mis-serves every map classified into it. Live: `crypt → Horror/"dwarven"`,
/// zero hits — a crypt sent to the horror pack, hunting a dwarven material that
/// only exists under Mountain, and scoring the settlement art it actually needs
/// (coffins, altars, candles) at 0.15.
///
/// A query that DOES match, but only art outside the legible band, is just a
/// bad material under a sound pairing — so only the query goes and the place
/// keeps its folder. Live: `sewer → "grate"`, 50 real hits all measuring ~211
/// against a ceiling of 205, which would have washed out everything placed on
/// top. A sewer on the built-in stone is right; a sewer on a lightbox is not.
///
/// Only ever removes, so a profile that passes is unchanged.
/// The ground entries a folder owns that a query actually selects. Pure.
fn own_folder_ground_hits<'a>(entries: &'a [TileLibraryEntry], folder: &str, tokens: &[String]) -> Vec<&'a TileLibraryEntry> {
    entries
        .iter()
        .filter(|e| e.biome == folder && e.category == "Textures" && !e.rel_path.contains("/Liquids/") && has_identity_match(e, tokens))
        .collect()
}

/// Does this folder ship ground a mini can be placed on AT ALL? Jungle carries
/// 2,281 tiles and ZERO textures; Feywilds has four, every one measuring 41-52
/// against a floor gate of 70. Both have always BORROWED woodland grass (see
/// pack_profile's DEFAULT_BIOMES), and a place that cannot possibly answer from
/// its own shelf must be allowed to. Pure.
fn folder_has_own_ground(entries: &[TileLibraryEntry], measured: &HashMap<String, MeasuredArt>, folder: &str) -> bool {
    entries
        .iter()
        .filter(|e| e.biome == folder && e.category == "Textures" && !e.rel_path.contains("/Liquids/"))
        .any(|e| tile_luminance(e, measured).is_none_or(luminance_is_usable_floor))
}

/// Anything in the catalog this query would select — what `resolve_floor`
/// really searches, since it filters by CATEGORY and treats the biome as a
/// scoring weight. Pure.
fn catalog_wide_ground_hit(entries: &[TileLibraryEntry], tokens: &[String]) -> bool {
    entries
        .iter()
        .any(|e| e.category == "Textures" && !e.rel_path.contains("/Liquids/") && has_identity_match(e, tokens))
}

/// Would this floor query still find art? The single question both
/// `prune_unbacked_grounds` (which deletes answers that stopped holding) and
/// `carry_forward_settled_answers` (which re-uses answers that still hold)
/// must agree on. They compose the same three primitives ON PURPOSE: the last
/// bug here was a check testing a different set than the resolver searched,
/// and a second independent implementation would rebuild that seam. Pure.
fn floor_query_still_holds(entries: &[TileLibraryEntry], measured: &HashMap<String, MeasuredArt>, folder: &str, query: &str) -> bool {
    let tokens = tokenize_query(query);
    let hits = own_folder_ground_hits(entries, folder, &tokens);
    if hits.is_empty() {
        return !folder_has_own_ground(entries, measured, folder) && catalog_wide_ground_hit(entries, &tokens);
    }
    let lums: Vec<f64> = hits.iter().filter_map(|e| tile_luminance(e, measured)).collect();
    lums.is_empty() || lums.iter().copied().any(luminance_is_usable_floor)
}

/// The `~` counterpart — no luminance gate, and `/Liquids/` is where a pool
/// SHOULD come from, so it is not excluded. Pure.
fn liquid_query_still_holds(entries: &[TileLibraryEntry], folder: &str, query: &str) -> bool {
    let tokens = tokenize_query(query);
    entries.iter().any(|e| e.biome == folder && e.category == "Textures" && has_identity_match(e, &tokens))
}

fn prune_unbacked_grounds(entries: &[TileLibraryEntry], measured: &HashMap<String, MeasuredArt>, mut profile: PackProfile) -> PackProfile {
    let mut dropped: Vec<String> = Vec::new();
    let folder_has_own_ground = |folder: &str| folder_has_own_ground(entries, measured, folder);
    profile.biomes.retain_mut(|b| {
        let Some(query) = b.floor_query.clone() else { return true };
        let tokens = tokenize_query(&query);
        // NOTE: `resolve_floor` searches every `Textures` entry in the catalog
        // and treats the biome as a SCORING WEIGHT (`biome_affinity`), not a
        // filter — so folder-scoping this check tested a different set than the
        // resolver uses. That is the same seam that made a ground candidate
        // report 14 files when its word really selected 42. Keep the folder
        // rule only where the folder can actually answer.
        let hits: Vec<&TileLibraryEntry> = entries
            .iter()
            .filter(|e| e.biome == b.folder && e.category == "Textures" && !e.rel_path.contains("/Liquids/") && has_identity_match(e, &tokens))
            .collect();
        if hits.is_empty() {
            if !folder_has_own_ground(&b.folder) {
                let borrowed = entries
                    .iter()
                    .any(|e| e.category == "Textures" && !e.rel_path.contains("/Liquids/") && has_identity_match(e, &tokens));
                if borrowed {
                    dropped.push(format!("{} → {}/{:?}: folder ships no usable ground of its own; BORROWING from the wider catalog, as resolve_floor will", b.scene, b.folder, query));
                    return true;
                }
            }
            dropped.push(format!("{} → {}/{:?}: query selects nothing in its own folder; place dropped", b.scene, b.folder, query));
            return false;
        }
        let lums: Vec<f64> = hits.iter().filter_map(|e| tile_luminance(e, measured)).collect();
        if !lums.is_empty() && !lums.iter().copied().any(luminance_is_usable_floor) {
            let mean = lums.iter().sum::<f64>() / lums.len() as f64;
            dropped.push(format!("{} → {}/{:?}: all {} candidates unusable (mean luminance {:.0}); keeping the built-in floor", b.scene, b.folder, query, lums.len(), mean));
            b.floor_query = None;
        }
        true
    });
    // A place that answered NOTHING because its own shelf is empty falls back
    // to the built-in table's query for that folder. The profiler is told to
    // answer null only when a biome "has no ground candidates at all", and the
    // evidence it sees lists that biome's OWN candidates — so for Jungle
    // (zero textures) null is the only honest answer available to it, even
    // though the same prompt invites borrowing from a related biome. The
    // result was a learned profile strictly WORSE than the hardcoded defaults
    // it replaced: jungle maps rendered on built-in dungeon flagstone.
    for b in &mut profile.biomes {
        if b.floor_query.is_some() || folder_has_own_ground(&b.folder) {
            continue;
        }
        let Some(fallback) = crate::pack_profile::builtin_floor_for_folder(&b.folder) else { continue };
        if entries
            .iter()
            .any(|e| e.category == "Textures" && !e.rel_path.contains("/Liquids/") && has_identity_match(e, &tokenize_query(fallback)))
        {
            dropped.push(format!("{} → {}: no ground of its own and no answer given; adopting the built-in borrow {fallback:?}", b.scene, b.folder));
            b.floor_query = Some(fallback.to_string());
        }
    }

    // The same check for `~`, minus the luminance gate: a pool is meant to read
    // as liquid, not as a board you place minis on, and Horror's blood measures
    // about 42. Note resolve_liquid does NOT exclude `/Liquids/` the way
    // resolve_floor does — that folder is exactly where a pool SHOULD come
    // from — so this must not exclude it either, or it would condemn the art it
    // is checking.
    for b in &mut profile.biomes {
        let Some(query) = b.liquid_query.clone() else { continue };
        let tokens = tokenize_query(&query);
        let any = entries.iter().any(|e| e.biome == b.folder && e.category == "Textures" && has_identity_match(e, &tokens));
        if !any {
            dropped.push(format!("{} → {}/{:?}: liquid query selects nothing in its own folder; falling back to water", b.scene, b.folder, query));
            b.liquid_query = None;
        }
    }
    crate::maplog::log(
        "PACK PROFILE — grounds checked against the catalog",
        &if dropped.is_empty() { "every place's ground is backed by real art".to_string() } else { dropped.join("\n") },
    );
    profile
}

/// Restores per-place answers the newest profiling run LOST — a `floor_query`
/// or `liquid_query` that was `Some` last time and came back `None` for a place
/// that is otherwise unchanged (same scene word, same folder).
///
/// Re-profiling re-derives every field from scratch, and the model does not
/// answer identically twice. Live: `horror` carried `liquid_query: "blood"` for
/// three runs and then simply did not mention it, so a charnel house's blood
/// channels filled with `Water_Calm_A_02` — clean blue water, in a room whose
/// own Features call them blood channels. Nothing surfaced the loss; the only
/// reason it was caught is that somebody looked at the picture.
///
/// Deliberately field-level and one-directional. It never resurrects a whole
/// place (`prune_unbacked_grounds` drops those on purpose, and running AFTER
/// this means anything restored here is still checked against the current
/// catalog before it survives), and it never overwrites a fresh answer — only
/// fills a hole where an answer used to be.
fn carry_forward_settled_answers(
    prev: &PackProfile,
    mut derived: PackProfile,
    entries: &[TileLibraryEntry],
    measured: &HashMap<String, MeasuredArt>,
) -> PackProfile {
    let mut notes: Vec<String> = Vec::new();
    let (mut kept, mut fresh, mut new_places) = (0usize, 0usize, 0usize);
    for b in &mut derived.biomes {
        let Some(old) = prev.biomes.iter().find(|p| p.scene.eq_ignore_ascii_case(&b.scene) && p.folder == b.folder) else {
            new_places += 1;
            continue;
        };

        // `natural_walls` describes the PLACE — whether a cave is cut from rock
        // or a hall is built of masonry — not the art, so re-importing cannot
        // teach us anything new about it and there is nothing to validate it
        // against. It is also a bare bool, so the "restore what was lost" rule
        // never applied to it and it flipped freely: one live run turned
        // mountain to masonry walls and gave an oasis the bazaar's tiled floor.
        if b.natural_walls != old.natural_walls {
            notes.push(format!("{}: natural_walls {} → {} REVERTED (a place does not change what it is made of)", b.scene, old.natural_walls, b.natural_walls));
        }
        b.natural_walls = old.natural_walls;

        match &old.floor_query {
            Some(q) if floor_query_still_holds(entries, measured, &b.folder, q) => {
                if b.floor_query.as_deref() != Some(q.as_str()) {
                    notes.push(format!("{} floor_query: keeping settled {q:?} over this run's {:?}", b.scene, b.floor_query));
                }
                b.floor_query = Some(q.clone());
                kept += 1;
            }
            Some(q) => {
                notes.push(format!("{} floor_query: settled {q:?} no longer finds art; taking this run's {:?}", b.scene, b.floor_query));
                fresh += 1;
            }
            None => fresh += 1,
        }

        match &old.liquid_query {
            Some(q) if liquid_query_still_holds(entries, &b.folder, q) => {
                if b.liquid_query.as_deref() != Some(q.as_str()) {
                    notes.push(format!("{} liquid_query: keeping settled {q:?} over this run's {:?}", b.scene, b.liquid_query));
                }
                b.liquid_query = Some(q.clone());
            }
            Some(q) => notes.push(format!("{} liquid_query: settled {q:?} no longer finds art; taking this run's {:?}", b.scene, b.liquid_query)),
            None => {}
        }
    }

    // A category that was settled as TERRAIN stays terrain, as long as the
    // catalog still has tiles filed under it. This is the one profile field
    // where a re-profile losing an answer is a safety problem rather than a
    // cosmetic one: in the live pack, `!Wilderness` is a grouping folder and
    // 9,950 of its 13,190 tiles are Gore — 252 humanoid corpses, plus wound
    // overlays, blood pools and intestines. Being terrain-classified is the
    // only thing keeping every one of them out of object slots. Nothing
    // guarantees that classification: it comes back from the model each run,
    // and if it ever came back without `!Wilderness` the map would start
    // drawing bodies with no error anywhere.
    //
    // THE COST IS KNOWN AND ACCEPTED — measured 2026-07-21, written down here
    // so it isn't rediscovered and "fixed". Horror's 11,324 `!Wilderness`
    // tiles include 1,588 legitimate `Flesh_*` props, among them all 180
    // `Flesh_Black_Pillar_*` / `Flesh_Black_Brain_Pillar_*` at exactly 1x1.
    // They are unreachable from an object slot, which is why a flesh-temple
    // map asking for a "Bone growth pillar" resolves a cross-biome
    // `Pillar_Metal_Rusty` instead (`w1-horror`). Do NOT unblock the category
    // to recover them: the same move admits 5,879 `Body_*` and 2,600
    // `Dwarven_*` corpse tiles, and the Objects layer must never place a
    // figure — Nabil uses physical minis. A wrong-material pillar is
    // cosmetic; a corpse rendered into the grid is not. Any future attempt
    // needs a per-tile creature test, not a category-level flip.
    //
    // One-way on purpose. A category the model NEWLY calls terrain is still
    // accepted (that's a fresh answer, not a lost one); only dropping a
    // settled one is refused, and only while the category still exists.
    let live: HashSet<&str> = entries.iter().map(|e| e.category.as_str()).collect();
    for c in &prev.terrain_categories {
        if live.contains(c.as_str()) && !derived.terrain_categories.iter().any(|d| d.eq_ignore_ascii_case(c)) {
            notes.push(format!("terrain_categories: restoring settled {c:?}, which this run dropped while the catalog still has tiles under it"));
            derived.terrain_categories.push(c.clone());
        }
    }

    notes.push(format!("— {kept} settled answer(s) kept, {fresh} re-derived, {new_places} new place(s)"));
    crate::maplog::log("PACK PROFILE — answers carried forward", &notes.join("\n"));
    derived
}

/// The object category this word MOSTLY lives in — `tree` and `mushroom` are
/// both overwhelmingly `Flora`, `stand` is `Furniture`, `boulder` is `Decor`.
/// The mode, not "any category it appears in": 20 of the 1,417 `tree` tiles
/// are filed under `Decor`, which would otherwise make every `Decor` word look
/// tree-like. Terrain categories are excluded because object slots can't reach
/// them anyway. `None` for a word the catalog doesn't stock.
///
/// Size deliberately does NOT enter into it. An earlier version counted only
/// tiles that fit the slot, to stop the two 5x5 `Pine_Shadow` tiles making
/// "lone pine" look self-sufficient — but the category filter already blocks
/// what that was really protecting against (`Pineapple` is `Clutter`, not
/// `Flora`), and the size gate then became the one thing keeping "jungle
/// canopy" broken: every Flora canopy tile is 4x5 or 5x5, and the only small
/// ones are canopy BEDS under Furniture. A head that is stocked but never at a
/// usable size simply yields an empty shortlist, which the caller falls back
/// from.
fn modal_category<'a>(entries: &'a [TileLibraryEntry], profile: &PackProfile, word: &str) -> Option<&'a str> {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for e in entries.iter().filter(|e| !profile.is_terrain_category(&e.category) && e.keywords.iter().any(|k| token_matches(k, word))) {
        *counts.entry(e.category.as_str()).or_insert(0) += 1;
    }
    // Name breaks a count tie, so the answer is stable across manifest order.
    counts.into_iter().max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(a.0))).map(|(c, _)| c)
}

/// Whether a field glyph's DM-written label already names its own object, so
/// the glyph's canonical noun must NOT be appended.
///
/// `T` cells search "<label> tree" and `^` cells "<label> rubble", because the
/// appended noun is what guarantees an EXACT head match: without it "Pine
/// treeline" bridges to both "tree" AND "line" and returns clotheslines,
/// "loose scree" returns a DM screen, and "rockfall" a fountain waterfall.
/// The append is doing real work and mostly must stay.
///
/// It backfires only when the label already names something stocked: a cave's
/// "Glowing mushroom" became "Glowing mushroom tree", and since the appended
/// word is the HEAD it took the x8 weight and the exact-head tier, burying all
/// 2,164 mushrooms under a decorated Christmas tree.
///
/// The test is deliberately two-part. An exact head match alone is not enough
/// — it would hand "pine stand" a winch stand and "overturned chairs" a
/// torture chair. The head must ALSO live in the same modal category as the
/// canonical noun, which is what separates `mushroom` and `log` (both `Flora`,
/// like `tree`) from `stand` and `chair` (`Furniture`). A bridge match never
/// counts, which is what keeps "lone pine" off `Pineapple`.
/// The catalog category a field glyph's art lives in — `tree` resolves to
/// `Flora`, `rubble` to `Structures`. Derived from the pack rather than
/// hardcoded, so it holds for any imported catalog. `None` when the pack
/// doesn't stock the noun at all, which means "don't restrict".
///
/// Restricting the search to it is what makes the glyph's MEANING enforceable
/// instead of merely suggested. Every wrong pick the canonical-noun append was
/// invented to prevent was a category error, not a word error: "Pine treeline"
/// → a clothesLINE, "loose scree" → a DM SCREEN, "rockfall" → a fountain
/// WATERFALL, "pine stand" → a music STAND, "overturned chairs" → a torture
/// CHAIR. None of those are Flora or Structures, so none can survive the
/// filter — and with them gone the label is free to name its own object.
pub fn category_for_noun(app: &AppHandle, noun: &str) -> Option<String> {
    let Ok(Some(manifest)) = load_manifest_cached(app) else { return None };
    let profile = load_profile_cached(app);
    modal_category(&manifest.entries, &profile, noun).map(str::to_string)
}

/// The label token that says WHAT the object is, or `None` when the label
/// names nothing the catalog stocks in the glyph noun's family (case 3 —
/// append the canonical noun).
///
/// Scans from the END backwards instead of testing only the last token.
/// English puts the identity word BEFORE a collective head — "giant mushroom
/// ring", "fern cluster", "birch grove", "reed bed" — so reading `tokens
/// .last()` saw "ring", found it wasn't `Flora`, and fell through to the
/// "<label> tree" append. That handed the x8 head weight to `tree` and drew a
/// feywild giant mushroom ring as 45 autumn deciduous trees (2026-07-21,
/// `w1-feywild`). Backwards is still right-to-left-specific: the LAST word
/// that is genuinely stocked in the family wins, so "Ancient standing
/// mushroom" still answers "mushroom" on the first step and nothing that
/// already worked moves.
///
/// The head is `tokenize_query`'s last token, NOT the label's last word —
/// the tokenizer has already moved a trailing collective noun out of head
/// position (see `is_quantifier`), so "giant mushroom ring" arrives here as
/// `[giant, ring, mushroom]` and this reads "mushroom". Fixing a missed
/// collective belongs in that list, not here.
pub fn label_names_its_own_object(app: &AppHandle, label: &str, noun: &str) -> bool {
    let Ok(Some(manifest)) = load_manifest_cached(app) else { return false };
    let profile = load_profile_cached(app);
    let tokens = tokenize_query(label);
    let Some(head) = tokens.last() else { return false };
    match (modal_category(&manifest.entries, &profile, head), modal_category(&manifest.entries, &profile, noun)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

/// Names any category the profiler put in NEITHER list, with its tile count.
///
/// Nothing is reclassified on its behalf, on measurement: `is_object_category`
/// gates only the footprint guide and the object vocabulary — both prompt-side,
/// so an unclassified category is still fully reachable by an object slot — and
/// forcing this pack's `Structures` (57,496 tiles, 31% of the catalog) into the
/// object list is a NET LOSS, evicting `bookshelf`, `oven`, `longsword` and
/// `ballista` from the 40-slot guide for `awning`, `corrugated`, `pergola` and
/// `support`. What was wrong was that it happened SILENTLY: on another pack the
/// forgotten category could be Furniture, and nothing would say so.
fn log_unclassified_categories(entries: &[TileLibraryEntry], profile: &PackProfile) {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for e in entries.iter().filter(|e| !profile.is_object_category(&e.category) && !profile.is_terrain_category(&e.category)) {
        *counts.entry(e.category.as_str()).or_insert(0) += 1;
    }
    if counts.is_empty() {
        return;
    }
    let mut rows: Vec<(&str, usize)> = counts.into_iter().collect();
    rows.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    let total: usize = rows.iter().map(|(_, n)| n).sum();
    crate::maplog::log(
        "PACK PROFILE — categories in neither list",
        &format!(
            "{} categor(ies), {total} tile(s) — reachable by object slots, but absent from the map prompt's \
             footprint guide and object vocabulary, so the model is never told these nouns exist:\n{}",
            rows.len(),
            rows.iter().map(|(c, n)| format!("  {n:>7}  {c}")).collect::<Vec<_>>().join("\n")
        ),
    );
}

/// Every distinct category name in the catalog, most common first.
fn all_categories(entries: &[TileLibraryEntry]) -> Vec<String> {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for e in entries {
        *counts.entry(e.category.as_str()).or_insert(0) += 1;
    }
    let mut v: Vec<(&str, usize)> = counts.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(b.0)));
    v.into_iter().map(|(c, _)| c.to_string()).collect()
}

fn ask(prompt: String) -> Result<String, String> {
    crate::local_llm::ask_ingest_once_low_effort(prompt, Some("sonnet"))
}

/// Learn how this pack is laid out and what its biomes ARE, in two passes:
/// first how to read its paths (from the raw directory tree, since reading the
/// paths correctly is what that pass decides), then what the biomes mean (from
/// MEASURED evidence — counts, luminance ranges and real filenames).
///
/// Re-parses the manifest under the learned layout, which costs one pass over
/// the entries instead of another walk of tens of thousands of files on a
/// possibly-cold network drive.
///
/// Never destructive: any failure leaves the previous profile in place, and a
/// pack that has never been profiled falls back to the Forgotten Adventures
/// default — which is exactly the behaviour that predates this.
#[tauri::command]
pub fn profile_tile_library(app: AppHandle) -> Result<PackProfile, String> {
    let Some(manifest) = load_manifest_cached(&app)? else {
        return Err("No tile library imported yet.".into());
    };
    let paths: Vec<String> = manifest.entries.iter().map(|e| e.rel_path.clone()).collect();
    let current = load_profile_cached(&app);

    let digest = crate::pack_profile::directory_digest(&paths);
    crate::maplog::log("PACK PROFILE — layout evidence", &digest);
    let layout = match ask(crate::pack_profile::build_layout_prompt(&digest)) {
        Ok(reply) => {
            crate::maplog::log("PACK PROFILE — layout reply", &reply);
            // Checked against the real paths before it's trusted — see
            // `prune_grouping_folders`, which live output made necessary.
            crate::pack_profile::parse_layout_reply(&extract_json_object(&reply))
                .map(|l| crate::pack_profile::prune_grouping_folders(&paths, l))
                .unwrap_or_else(|| current.layout.clone())
        }
        Err(e) => {
            crate::maplog::log("PACK PROFILE — layout pass failed", &format!("{e}\n(keeping the previous layout)"));
            current.layout.clone()
        }
    };

    // Re-read every path under the learned layout BEFORE gathering evidence:
    // the biome and category of every entry is what the evidence is grouped by.
    let entries = reparse_entries(&manifest.entries, &layout);
    let staged = PackProfile { layout: layout.clone(), ..(*current).clone() };
    let evidence = build_biome_evidence(&entries, &staged, &manifest.measured);
    crate::maplog::log(
        "PACK PROFILE — biome evidence",
        &evidence.iter().map(|e| format!("{} ({} tiles, {} ground candidates)", e.folder, e.tiles, e.ground.len())).collect::<Vec<_>>().join("\n"),
    );

    // Carry the previous run's scene words in, so an unchanged place keeps its
    // name and the corrections filed under it survive — see build_semantics_prompt.
    let previous: Vec<String> = current.biomes.iter().map(|b| b.scene.clone()).collect();
    let reply = ask(crate::pack_profile::build_semantics_prompt(&evidence, &all_categories(&entries), &previous))?;
    crate::maplog::log("PACK PROFILE — semantics reply", &reply);
    let derived = crate::pack_profile::parse_semantics_reply(&extract_json_object(&reply), layout)
        .ok_or_else(|| "Couldn't read the profiler's answer — the previous profile is unchanged.".to_string())?;
    // Fill back anything this run lost that the last one knew — read from the
    // SAVED profile, never `load_profile_cached`, which returns the profile with
    // corrections already applied (see with_overrides). Folding an override in
    // here would bake it into the learned layer, so clearing it in the panel
    // would no longer reveal what the profiler itself answered.
    let saved: PackProfile = profile_path(&app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let derived = carry_forward_settled_answers(&saved, derived, &entries, &manifest.measured);
    log_unclassified_categories(&entries, &derived);
    // Same discipline as the layout pass: check the answer against the files
    // before trusting it. Runs LAST so a carried-forward query still has to
    // exist in the catalog this run scanned. See prune_unbacked_grounds.
    let derived = prune_unbacked_grounds(&entries, &manifest.measured, derived);

    // Persist the derived profile and the re-read manifest together: the
    // entries' biome/category now depend on the layout that produced them, so
    // storing one without the other leaves the catalog disagreeing with itself.
    let path = profile_path(&app)?;
    fs::write(&path, serde_json::to_string_pretty(&derived).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let remanifested = TileLibraryManifest { roots: manifest.roots.clone(), entries, measured: manifest.measured.clone() };
    save_manifest(&app, &remanifested)?;
    *app.state::<TileLibraryState>().manifest.lock().unwrap() = Some(std::sync::Arc::new(remanifested));
    *app.state::<TileLibraryState>().idf.lock().unwrap() = None;
    invalidate_profile_cache(&app);
    Ok((*load_profile_cached(&app)).clone())
}

/// One biome as the Detected Biomes panel shows it: what the profile says,
/// plus the evidence a human needs to judge whether it's RIGHT — how much art
/// is actually in there, and a thumbnail of the ground that query resolves to.
/// A wrong ground query is invisible in text and obvious in a picture.
#[derive(Serialize, Clone, Debug)]
pub struct BiomeProfileView {
    pub scene: String,
    pub folder: String,
    pub floor_query: Option<String>,
    pub natural_walls: bool,
    pub liquid_query: Option<String>,
    pub tiles: usize,
    /// Data URL of the tile this biome's ground query currently lands on.
    /// `None` when there's no query, or when it resolves to nothing — which is
    /// itself the finding, and the reason this is worth rendering.
    pub ground_thumb: Option<String>,
    /// Other identity words present in this biome's terrain art, offered as
    /// alternatives so a correction is a pick rather than a guess.
    pub ground_options: Vec<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct PackProfileView {
    pub layout: crate::pack_profile::PackLayout,
    pub universal_biome: Option<String>,
    pub object_categories: Vec<String>,
    pub terrain_categories: Vec<String>,
    pub all_categories: Vec<String>,
    pub biomes: Vec<BiomeProfileView>,
    /// True once profiling has actually run — otherwise this is the built-in
    /// Forgotten Adventures default, which is a guess about someone else's pack.
    pub profiled: bool,
}

/// Longest edge of a panel thumbnail, in pixels.
const THUMB_PX: u32 = 96;

/// A small PNG data URL for one catalog tile. The panel renders these at 48
/// CSS pixels, and handing it the untouched file is wildly out of proportion:
/// measured live, the Underdark ground tile alone is an 8.5 MB base64 string,
/// with fourteen biomes in one response. Decoding and downscaling here turns
/// tens of megabytes of IPC into a few kilobytes.
fn thumbnail_data_url(root: &str, rel_path: &str) -> Option<String> {
    let bytes = fs::read(Path::new(root).join(rel_path)).ok()?;
    let img = image::load_from_memory(&bytes).ok()?.thumbnail(THUMB_PX, THUMB_PX);
    let mut png: Vec<u8> = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).ok()?;
    Some(format!("data:image/png;base64,{}", STANDARD.encode(&png)))
}

#[tauri::command]
pub fn get_pack_profile(app: AppHandle) -> Result<Option<PackProfileView>, String> {
    let Some(manifest) = load_manifest_cached(&app)? else {
        return Ok(None);
    };
    let profile = load_profile_cached(&app);
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for e in &manifest.entries {
        *counts.entry(e.biome.as_str()).or_insert(0) += 1;
    }
    let evidence = build_biome_evidence(&manifest.entries, &profile, &manifest.measured);
    let biomes = profile
        .biomes
        .iter()
        .map(|b| BiomeProfileView {
            folder: b.folder.clone(),
            scene: b.scene.clone(),
            floor_query: b.floor_query.clone(),
            natural_walls: b.natural_walls,
            liquid_query: b.liquid_query.clone(),
            tiles: counts.get(b.folder.as_str()).copied().unwrap_or(0),
            ground_thumb: b
                .floor_query
                .as_deref()
                .and_then(|q| shortlist_in_category(&app, q, "Textures", &b.scene, 1, 1, 1).into_iter().next())
                .and_then(|c| thumbnail_data_url(&c.root, &c.rel_path)),
            ground_options: evidence.iter().find(|e| e.folder == b.folder).map(|e| e.ground.iter().map(|g| g.word.clone()).collect()).unwrap_or_default(),
        })
        .collect();
    Ok(Some(PackProfileView {
        layout: profile.layout.clone(),
        universal_biome: profile.universal_biome.clone(),
        object_categories: profile.object_categories.clone(),
        terrain_categories: profile.terrain_categories.clone(),
        all_categories: all_categories(&manifest.entries),
        biomes,
        profiled: profile_path(&app).map(|p| p.exists()).unwrap_or(false),
    }))
}

/// Writes the human's corrections. Kept in their own file so they survive both
/// a re-profile and a re-import — the same split `tile_overrides.json` uses.
#[tauri::command]
pub fn save_pack_profile_overrides(app: AppHandle, overrides: ProfileOverrides) -> Result<(), String> {
    let path = profile_overrides_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, serde_json::to_string_pretty(&overrides).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    invalidate_profile_cache(&app);
    Ok(())
}

/// The corrections as stored, so the panel can show what's been overridden
/// rather than silently presenting a corrected value as a derived one.
#[tauri::command]
pub fn get_pack_profile_overrides(app: AppHandle) -> Result<ProfileOverrides, String> {
    Ok(profile_overrides_path(&app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default())
}

/// The JSON object substring of a possibly-chatty reply, so a `{...}` answer
/// survives surrounding prose.
fn extract_json_object(s: &str) -> String {
    match (s.find('{'), s.rfind('}')) {
        (Some(a), Some(b)) if b > a => s[a..=b].to_string(),
        _ => s.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The FA defaults — what every one of these cases was written against.
    fn prof() -> PackProfile {
        PackProfile::default()
    }

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
    fn parse_entry_builds_a_full_entry_from_a_real_fa_path() {
        let rel = Path::new("FA_Assets_Webp/!Core_Settlements/Furniture/Tables/Table_Round_Wood_A1_2x2.webp");
        let entry = parse_entry(rel, &prof().layout).unwrap();
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
        assert!(parse_entry(Path::new("FA_Assets_Webp/Woodlands/readme.txt"), &prof().layout).is_none());
        assert!(parse_entry(Path::new("Copyright.url"), &prof().layout).is_none());
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
        let got: Vec<&str> = shortlist_entries(&entries, &tokens, &idf, "", 2, 2, 10, false, &prof()).iter().map(|e| e.rel_path.as_str()).collect();
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
        let sig = |opaque: f64, edges: u8, luminance: f64| ArtSignals { opaque, edges, luminance, rgb: [luminance; 3] };

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

        // A compositing layer has NO near-opaque pixel at all — that is what a
        // drop shadow, glow or dirt pass measures like, and it is decided on
        // pixels so it holds whatever a pack calls its files. `art_signals`
        // reports it rather than returning None, which used to make it
        // indistinguishable from art we couldn't read.
        assert_eq!(sig(0.0, 0, 0.0).kind(), ArtKind::Overlay);
        assert_eq!(classify_art("Palm_Tree_Trunk_Shadow_A3_3x4.webp", Some(sig(0.0, 0, 0.0))), ArtKind::Overlay);
        // …and a name alone never makes one: this is a real, solid tile.
        assert_eq!(classify_art("Shadow_Blade_A1_1x1.webp", Some(sig(0.20, 0, 90.0))), ArtKind::Prop);

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

        let guide = footprint_guide(&entries, &prof());
        assert_eq!(guide, vec![("tree".to_string(), 2, 2)], "{guide:?}");

        // A fringe size must not become the guide minimum. Live: twelve 2x2
        // "Tree_Branch" entries against 278 standing trees derived "tree 2x2",
        // and every search landed in branch-and-novelty territory.
        let mut fringe = Vec::new();
        for _ in 0..12 { fringe.push(mk("tree", 2, 2)); }   // branches: 4%
        for _ in 0..150 { fringe.push(mk("tree", 3, 3)); }  // the real bulk
        for _ in 0..128 { fringe.push(mk("tree", 5, 5)); }
        let g2 = footprint_guide(&fringe, &prof());
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
        let sig = |opaque: f64, edges: u8| Some(ArtSignals { opaque, edges, luminance: 90.0, rgb: [90.0; 3] });

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

        let as_object = shortlist_entries(&entries, &q, &idf, "underdark", 1, 1, 8, false, &prof());
        assert_eq!(as_object.len(), 1, "ground art must not be an object candidate: {as_object:?}");
        assert_eq!(as_object[0].rel_path, "bone_pile_prop");

        // The floor path asks for Textures by name and must still see it.
        let as_floor = shortlist_entries(&entries, &q, &idf, "underdark", 1, 1, 8, true, &prof());
        assert_eq!(as_floor.len(), 2, "the floor resolver still needs ground textures: {as_floor:?}");

        assert!(prof().is_terrain_category("Textures") && prof().is_terrain_category("texture_overlays"));
        // Elevation is entirely cliff/ridge/bank EDGING strips — the art that
        // gave every cave map its illegible stalagmite scribbles.
        assert!(prof().is_terrain_category("Elevation") && prof().is_terrain_category("Shadow_Paths"));
        assert!(!prof().is_terrain_category("Clutter") && !prof().is_terrain_category("Structures") && !prof().is_terrain_category("Flora") && !prof().is_terrain_category("Decor"));
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
        let got = shortlist_entries(&entries, &tokenize_query("Stalagmite"), &idf, "cave", 1, 1, 8, false, &prof());
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
        let got = shortlist_entries(std::slice::from_ref(&window), &tokenize_query("Broken crockery"), &idf, "", 2, 1, 8, false, &prof());
        assert!(got.is_empty(), "a condition-word-only match is not an identity match: {got:?}");
        // The same tile IS a valid answer when the label really means a window.
        let got2 = shortlist_entries(std::slice::from_ref(&window), &tokenize_query("Broken window"), &idf, "", 2, 1, 8, false, &prof());
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
        let got = shortlist_entries(&entries, &q, &idf, "tavern", 1, 1, 8, false, &prof());
        assert!(got.is_empty(), "a 1x1 slot must get NOTHING, not a laundry iron: {got:?}");
        // Give it the room the chandelier actually needs and it resolves fine.
        let got2 = shortlist_entries(&entries, &q, &idf, "tavern", 2, 2, 8, false, &prof());
        assert_eq!(got2.first().map(|e| e.rel_path.as_str()), Some("chandelier_2x2"), "{got2:?}");
    }

    /// Live bug: "Pillar" in a TAVERN returned eight `Flesh_Pale_Pillar_*` from
    /// the Horror pack, because ranking never looked at biome at all.
    #[test]
    fn biome_affinity_demotes_a_tile_from_an_unrelated_biome() {
        assert_eq!(biome_affinity("!Core_Settlements", "!Core_Settlements", &prof(), false), 1.0);
        assert_eq!(biome_affinity("Underdark", "Underdark", &prof(), false), 1.0);
        // The universal settlement set is welcome in any scene.
        assert_eq!(biome_affinity("Underdark", "!Core_Settlements", &prof(), false), 1.0);
        // Horror flesh has no business in a tavern.
        assert!(biome_affinity("!Core_Settlements", "Horror", &prof(), false) < 0.5);
        assert!(biome_affinity("!Core_Settlements", "Arctic", &prof(), false) < 0.5);
    }

    /// The universal set's free pass is for OBJECTS. Asking it for GROUND is
    /// how a mine floor came out as settlement flagstone and a foundry's as a
    /// drain grate — both correctly classified, both outvoted by the folder
    /// that happens to own 29% of the catalog's textures.
    #[test]
    fn the_universal_set_is_not_a_peer_when_the_slot_is_the_ground() {
        // Objects: unchanged, a universal barrel still belongs in a cavern.
        assert_eq!(biome_affinity("Underdark", "!Core_Settlements", &prof(), false), 1.0);
        // Ground: the scene's own folder wins.
        assert!(biome_affinity("Underdark", "!Core_Settlements", &prof(), true) < 0.5);
        assert_eq!(biome_affinity("Underdark", "Underdark", &prof(), true), 1.0);
        // A settlement scene's own folder IS the universal one, so it keeps its
        // ground — the rule must not lock a tavern out of its own floorboards.
        assert_eq!(biome_affinity("!Core_Settlements", "!Core_Settlements", &prof(), true), 1.0);
    }

    /// The whole reason profiling exists. A pack that doesn't use Forgotten
    /// Adventures' folder scheme used to fail in three ways at once, all
    /// silently: nothing matched `TERRAIN_ONLY_CATEGORIES` so ground textures
    /// were eligible for object slots, nothing was named `!Core_Settlements` so
    /// `biome_affinity` scored EVERY tile 0.15 uniformly (which reorders
    /// nothing, so it looked fine while doing nothing), and no scene word
    /// resolved to any folder it owned. Given its own profile, all three work.
    #[test]
    fn a_non_fa_pack_ranks_correctly_once_it_carries_its_own_profile() {
        use crate::pack_profile::{BiomeProfile, BiomeSource, PackLayout};
        let mk = |biome: &str, category: &str, kw: &[&str], path: &str| TileLibraryEntry {
            root: "r".into(),
            rel_path: path.into(),
            biome: biome.into(),
            category: category.into(),
            keywords: kw.iter().map(|s| s.to_string()).collect(),
            w: 1,
            h: 1,
        };
        let entries = vec![
            mk("Caverns", "ground", &["bone", "dirt"], "Caverns/ground/bone_dirt.png"), // a tiling FLOOR
            mk("Caverns", "props", &["bone", "pile"], "Caverns/props/bone_pile.png"),   // the real object
            mk("Township", "props", &["bone", "charm"], "Township/props/bone_charm.png"),
        ];
        let profile = PackProfile {
            layout: PackLayout { biome_source: BiomeSource::FirstSegment, biome_anchors: vec![], category_folders: vec!["props".into(), "ground".into()] },
            universal_biome: Some("Township".into()),
            object_categories: vec!["props".into()],
            terrain_categories: vec!["ground".into()],
            biomes: vec![BiomeProfile { scene: "cave".into(), folder: "Caverns".into(), floor_query: Some("bone dirt".into()), natural_walls: true, liquid_query: None }],
        };
        let idf = compute_idf(&entries);

        // The scene reaches its OWN folder, not the universal fallback.
        assert_eq!(scene_biome("cave", &profile), "Caverns");
        // …and affinity is no longer a uniform 0.15: own-biome and universal
        // are unpenalised, an unrelated biome is not.
        assert_eq!(biome_affinity("Caverns", "Caverns", &profile, false), 1.0);
        assert_eq!(biome_affinity("Caverns", "Township", &profile, false), 1.0);
        assert!(biome_affinity("Township", "Caverns", &profile, false) < 0.5);

        // An OBJECT slot must not be offered the tiling floor.
        let got: Vec<&str> = shortlist_entries(&entries, &tokenize_query("bone pile"), &idf, "cave", 1, 1, 8, false, &profile).iter().map(|e| e.rel_path.as_str()).collect();
        assert!(got.contains(&"Caverns/props/bone_pile.png"), "{got:?}");
        assert!(!got.contains(&"Caverns/ground/bone_dirt.png"), "ground art reached an object slot: {got:?}");
        // The FLOOR resolver asks for that shelf by name and must still get it.
        let ground: Vec<&str> = shortlist_entries(&entries, &tokenize_query("bone dirt"), &idf, "cave", 1, 1, 8, true, &profile).iter().map(|e| e.rel_path.as_str()).collect();
        assert!(ground.contains(&"Caverns/ground/bone_dirt.png"), "{ground:?}");
        // And the pack's own vocabulary comes only from its object categories.
        let vocab = object_vocabulary(&entries, &profile);
        assert!(vocab.contains(&"pile".to_string()) && !vocab.contains(&"dirt".to_string()), "{vocab:?}");
    }

    #[test]
    fn scene_biome_maps_scene_words_and_defaults_to_the_settlement_set() {
        assert_eq!(scene_biome("tavern", &prof()), "!Core_Settlements");
        assert_eq!(scene_biome("cave", &prof()), "Underdark");
        assert_eq!(scene_biome("forest", &prof()), "Woodlands");
        assert_eq!(scene_biome("anything unknown", &prof()), "!Core_Settlements");
    }

    /// The pack names its mind-flayer columns `Ceremorph_Support_Column_*` and
    /// files them under `Pillars/`, so a `pillar` query used to miss all 40 —
    /// `bridges` can't connect them (no shared prefix/suffix) and the identity
    /// gate dropped them before ranking. Both directions, and plurals, since
    /// an `o` cell's label is usually "Pillars".
    #[test]
    fn a_synonym_connects_pillar_and_column_in_both_directions() {
        assert!(token_matches("column", "pillar"));
        assert!(token_matches("column", "pillars"));
        assert!(token_matches("pillar", "columns"));
        // Unrelated words are still unrelated — this is one pair, not a thesaurus.
        assert!(!token_matches("column", "table"));
        assert!(!token_matches("pillar", "brain"));
        // The plural/adjective rule it wraps is untouched.
        assert!(token_matches("table", "tables"));
        assert!(token_matches("wood", "wooden"));
        assert!(!token_matches("heart", "hearth"));
    }

    /// A MERGING synonym must not buy coverage, or the merged-in tile collects
    /// a point its rival earned in the pack's own vocabulary — and coverage
    /// sorts above biome affinity, so that one point silences the whole biome
    /// dimension. Live 2026-07-22: "Support pillar" drew illithid columns in a
    /// dwarven mine, a foundry, a tavern and a cavern alike.
    #[test]
    fn a_merging_synonym_earns_no_coverage_but_a_translating_one_does() {
        let e = |kw: &[&str]| TileLibraryEntry {
            root: "r".into(), rel_path: "p".into(), biome: "b".into(), category: "Structures".into(),
            keywords: kw.iter().map(|s| s.to_string()).collect(), w: 1, h: 1,
        };
        let idf = idf_map(&[("support", 5.0), ("column", 7.0), ("pillar", 2.0), ("metal", 2.0), ("bellow", 6.0), ("fireplace", 4.0), ("stone", 1.0)]);
        let cov = |entry: &TileLibraryEntry, q: &str| shortlist_rank(entry, &tokenize_query(q), &idf).unwrap().0;

        // pillar/column MERGES (the pack stocks 4,850 and 40): the column tile
        // answers only "support" in its own words, levelling with the pillar.
        assert_eq!(cov(&e(&["ceremorph", "support", "column"]), "support pillar"), 1);
        assert_eq!(cov(&e(&["pillar", "wood", "red"]), "support pillar"), 1);
        // iron/metal TRANSLATES (nothing in the pack is keyworded iron for
        // being iron): the metal tile keeps both points, so a label naming the
        // material still outranks one that doesn't.
        assert_eq!(cov(&e(&["bellow", "metal", "gray"]), "iron bellow"), 2);
        assert_eq!(cov(&e(&["bellows", "wood", "dark"]), "iron bellow"), 1);
        // hearth/fireplace likewise — `hearth` matches 0 tiles, so there is no
        // rival for the point to be unfair to.
        assert_eq!(cov(&e(&["fireplace", "stone"]), "stone hearth"), 2);
        // And a merging synonym still MATCHES; it just doesn't score coverage.
        assert!(token_matches("column", "pillar"));
        assert!(!answers_in_its_own_words("column", "pillar"));
        assert!(answers_in_its_own_words("metal", "iron"));
    }

    /// The synonym must reach the Ceremorph columns on an illithid map WITHOUT
    /// disturbing any other scene — the containment comes from biome_affinity
    /// (an Astral tile is demoted 0.15x elsewhere), not from the synonym.
    #[test]
    fn synonym_swaps_pillars_for_ceremorph_columns_only_on_an_astral_scene() {
        let v = |kw: &[&str], biome: &str, path: &str| TileLibraryEntry {
            root: "r".into(), rel_path: path.into(), biome: biome.into(),
            category: "Structures".into(), keywords: kw.iter().map(|s| s.to_string()).collect(), w: 1, h: 1,
        };
        // Several core pillars to ONE ceremorph column, because that ratio is
        // the mechanism: `column` is rare (40 tiles) where `pillar` is generic
        // (4,850), so IDF lifts the specific word above the generic one. With
        // one of each they'd be equally rare and tie.
        let mut entries: Vec<TileLibraryEntry> = ["stone", "marble", "wood", "brick", "slate", "sandstone"]
            .iter()
            .map(|m| v(&["pillar", "square", m], "!Core_Settlements", "core_stone"))
            .collect();
        entries.push(v(&["ceremorph", "support", "column", "blue"], "Astral", "ceremorph"));
        let idf = compute_idf(&entries);
        let top = |scene: &str| {
            shortlist_entries(&entries, &tokenize_query("Pillars"), &idf, scene, 1, 1, 1, false, &prof())
                .first().map(|e| e.rel_path.clone()).unwrap_or_default()
        };
        assert_eq!(top("illithid colony"), "ceremorph");
        // Every other scene still gets the plain core pillar.
        for scene in ["tavern", "cave", "forest", "horror", ""] {
            assert_eq!(top(scene), "core_stone", "scene {scene:?} must be untouched");
        }
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
        let got: Vec<&str> = shortlist_entries(&entries, &tokenize_query("pillar"), &idf, "", 1, 1, 3, false, &prof())
            .iter().map(|e| e.rel_path.as_str()).collect();
        assert_eq!(got.len(), 3);
        // Three DIFFERENT families, not three flesh variants.
        assert!(got.contains(&"stone_a") && got.contains(&"wood_a"), "shortlist must diversify families: {got:?}");
        assert_eq!(got.iter().filter(|p| p.starts_with("flesh")).count(), 1, "only one variant per family up front: {got:?}");
    }

    /// The live failure: a 2x1 "Weapon rack" resolved to
    /// `Wine_Rack_Wood_Light_A_2x1`. All 247 weapon racks are 1x2, so the size
    /// filter dropped every one and a 2x1 wine rack was the only surviving
    /// "rack". Admitting the transposed fit is the whole fix: the right tile
    /// comes back AND outranks the wrong one, because it matches "weapon" as
    /// well as the head noun.
    ///
    /// Note what is deliberately NOT done here — the wine rack is not filtered
    /// out. An earlier attempt refused any candidate whose filename qualified
    /// the head noun with an unasked-for word ("wine" rack), and the existing
    /// suite immediately caught it eating `Ceremorph_Support_Column` for
    /// "Pillars" and `Flesh_Pale_Pillar` for "pillar" — both genuinely the
    /// right tile. Nothing structural separates a qualifier that changes what
    /// an object IS from one that merely describes it, so ranking plus the
    /// vision picker does that job, exactly as it does everywhere else.
    #[test]
    fn a_tile_that_only_fits_transposed_is_offered_and_outranks_the_wrong_one() {
        let sized = |kw: &[&str], w: u32, h: u32, path: &str| TileLibraryEntry {
            root: "r".into(),
            rel_path: path.into(),
            biome: "b".into(),
            category: "Combat".into(),
            keywords: kw.iter().map(|s| s.to_string()).collect(),
            w,
            h,
        };
        let entries = vec![
            sized(&["weapon", "rack", "metal"], 1, 2, "weapon_rack_1x2"),
            sized(&["wine", "rack", "wood"], 2, 1, "wine_rack_2x1"),
        ];
        let idf = compute_idf(&entries);
        let got: Vec<&str> =
            shortlist_entries(&entries, &tokenize_query("Weapon rack"), &idf, "", 2, 1, 8, false, &prof()).iter().map(|e| e.rel_path.as_str()).collect();
        assert_eq!(got.first(), Some(&"weapon_rack_1x2"), "the rotated weapon rack must come back, and FIRST: {got:?}");
        // Before this, the 1x2 rack could not be offered at all and the wine
        // rack was the entire shortlist.
        assert!(got.len() > 1, "the wine rack stays as recall for the vision picker to reject");
    }

    /// At equal score an upright tile must beat one that needs turning.
    #[test]
    fn an_upright_tile_outranks_an_equally_good_rotated_one() {
        let sized = |w: u32, h: u32, path: &str| TileLibraryEntry {
            root: "r".into(),
            rel_path: path.into(),
            biome: "b".into(),
            category: "Furniture".into(),
            keywords: vec!["bench".into()],
            w,
            h,
        };
        let entries = vec![sized(1, 3, "bench_1x3_rotated"), sized(3, 1, "bench_3x1_upright")];
        let idf = compute_idf(&entries);
        let got: Vec<&str> = shortlist_entries(&entries, &tokenize_query("bench"), &idf, "", 3, 1, 8, false, &prof()).iter().map(|e| e.rel_path.as_str()).collect();
        assert_eq!(got.first(), Some(&"bench_3x1_upright"), "got {got:?}");
    }

    /// …but only when they really are equally good. Live: an 11-cell vertical
    /// "Bar counter" drew four spaced door-barring planks. The query head
    /// ("counter") is not catalog vocabulary, so the real `Bar_*_5x1` and
    /// `Lock_Bar_*_1x3` tie on every scoring term — both cover exactly the one
    /// word "bar" — and the upright 1x3 won the tiebreak purely for not needing
    /// turning. Filling 5 of the 11 cells beats saving a free rotation.
    #[test]
    fn a_bigger_transposed_tile_beats_a_smaller_upright_one() {
        let sized = |kw: &[&str], w: u32, h: u32, path: &str| TileLibraryEntry {
            root: "r".into(),
            rel_path: path.into(),
            biome: "b".into(),
            category: "Furniture".into(),
            keywords: kw.iter().map(|s| s.to_string()).collect(),
            w,
            h,
        };
        let entries = vec![sized(&["lock", "bar", "wood"], 1, 3, "lock_bar_1x3"), sized(&["bar", "wood"], 5, 1, "bar_5x1")];
        let idf = compute_idf(&entries);
        let got: Vec<&str> =
            shortlist_entries(&entries, &tokenize_query("Bar counter"), &idf, "", 1, 11, 8, false, &prof()).iter().map(|e| e.rel_path.as_str()).collect();
        assert_eq!(got.first(), Some(&"bar_5x1"), "the tile that fills more of the run must win: {got:?}");
    }

    /// The prompt says "Hearth", the pack says `Fireplace_*`, and without the
    /// synonym the SUFFIX bridge "earth" inside "hearth" answered instead.
    #[test]
    fn hearth_reaches_a_fireplace_without_dragging_in_earth() {
        let e = |kw: &[&str], path: &str| TileLibraryEntry {
            root: "r".into(),
            rel_path: path.into(),
            biome: "b".into(),
            category: "Structures".into(),
            keywords: kw.iter().map(|s| s.to_string()).collect(),
            w: 1,
            h: 1,
        };
        let entries = vec![e(&["stone", "earth", "elementals"], "earth_stone"), e(&["fireplace", "stone"], "fireplace")];
        let idf = compute_idf(&entries);
        let look = |q: &str| {
            shortlist_entries(&entries, &tokenize_query(q), &idf, "", 1, 1, 8, false, &prof()).first().map(|e| e.rel_path.clone()).unwrap_or_default()
        };
        assert_eq!(look("Hearth"), "fireplace");
        // …and the synonym must not drag a fireplace into a genuine earth label.
        assert_eq!(look("Earth stone"), "earth_stone");
    }

    /// The four real floor/liquid pairs the threshold was fitted to, each
    /// already judged by eye before any number was chosen. Volcanic is the one
    /// that matters most: its lava is only 12 apart from the basalt in
    /// LUMINANCE and looks spectacular, so any brightness-based rule would kill
    /// it. Horror is the second trap — red blood on red flesh, which a naive
    /// "same hue family" rule would reject.
    #[test]
    fn liquid_floor_contrast_separates_the_maps_that_read_from_the_one_that_didnt() {
        let judged = [
            ("volcanic basalt vs lava", [60.0, 61.0, 64.0], [207.0, 16.0, 0.0], true),
            ("horror flesh vs blood", [137.0, 73.0, 59.0], [45.0, 1.0, 1.0], true),
            ("sewer stone vs murky water", [104.0, 103.0, 100.0], [54.0, 53.0, 24.0], true),
            ("swamp marsh vs swamp water", [80.0, 77.0, 38.0], [54.0, 53.0, 24.0], false),
        ];
        for (what, floor, liquid, should_read) in judged {
            let d = colour_distance(floor, liquid);
            assert_eq!(d >= LIQUID_FLOOR_CONTRAST_MIN, should_read, "{what}: distance {d} vs threshold {LIQUID_FLOOR_CONTRAST_MIN}");
        }
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

    /// The whole decision table for the field-glyph noun, taken from the 42
    /// labels that actually landed on a `T` or `^` cell across the saved maps.
    /// Both halves matter: drop the exact-match half and "lone pine" bridges to
    /// `Pineapple`; drop the category half and "pine stand" gets a winch stand.
    #[test]
    fn a_field_label_keeps_the_glyph_noun_unless_it_names_its_own_object() {
        let e = |cat: &str, kw: &[&str]| TileLibraryEntry {
            root: "r".into(),
            rel_path: kw.join("_"),
            biome: "b".into(),
            category: cat.into(),
            keywords: kw.iter().map(|s| s.to_string()).collect(),
            w: 1,
            h: 1,
        };
        // A catalog shaped like the real one: trees and mushrooms are Flora,
        // stands and chairs are Furniture, rubble is Structures, and `tree`
        // has a couple of stray Decor entries that must not widen the test.
        let mut entries = vec![
            e("Decor", &["tree", "feather", "token"]),
            e("Furniture", &["winch", "stand", "wood"]),
            e("Furniture", &["torture", "chair", "wood"]),
            e("Decor", &["desert", "boulder", "chalk"]),
            e("Flora", &["pineapple", "green"]),
        ];
        entries.extend((0..30).map(|i| e("Flora", &["tree", if i % 2 == 0 { "red" } else { "green" }])));
        entries.extend((0..30).map(|i| e("Flora", &["mushroom", if i % 2 == 0 { "red" } else { "blue" }])));
        entries.extend((0..10).map(|_| e("Flora", &["firewood", "log", "wood"])));
        entries.extend((0..20).map(|_| e("Structures", &["rubble", "pile", "stone"])));

        let profile = PackProfile { terrain_categories: vec!["Textures".into()], ..PackProfile::default() };
        let modal = |w: &str| modal_category(&entries, &profile, w);
        // The mode, not "any category it appears in" — `tree` has a Decor entry.
        assert_eq!(modal("tree"), Some("Flora"));
        assert_eq!(modal("mushroom"), Some("Flora"));
        assert_eq!(modal("log"), Some("Flora"));
        assert_eq!(modal("stand"), Some("Furniture"));
        assert_eq!(modal("chair"), Some("Furniture"));
        assert_eq!(modal("rubble"), Some("Structures"));
        assert_eq!(modal("boulder"), Some("Decor"));
        assert_eq!(modal("treeline"), None, "a bridge is not a match — nothing is keyworded 'treeline'");
        assert_eq!(modal("scree"), None);

        // Stocked has to mean stocked AT A USABLE SIZE. The real catalog's only
        // two `pine` tiles are `Pine_Shadow_*_5x5`, which no field slot can
        // take — counting them made "lone pine" look self-sufficient and handed
        // it a Pineapple.
        // A head stocked ONLY at an unusable size still counts here — the
        // empty shortlist it produces is what the caller falls back from, and
        // gating on size instead is what kept "jungle canopy" drawing trunks.
        let mut oversized = entries.clone();
        oversized.push(TileLibraryEntry { w: 5, h: 5, ..e("Flora", &["pine", "shadow"]) });
        assert_eq!(modal_category(&oversized, &profile, "pine"), Some("Flora"));
    }

    /// A category the profiler forgets is invisible to the map prompt but still
    /// reachable by object slots — a half-state that said nothing. On this pack
    /// it is `Structures`, 31% of the catalog.
    #[test]
    fn an_unclassified_category_is_named_not_silently_reclassified() {
        let e = |cat: &str| TileLibraryEntry {
            root: "r".into(),
            rel_path: format!("x/{cat}.webp"),
            biome: "b".into(),
            category: cat.into(),
            keywords: vec!["x".into()],
            w: 1,
            h: 1,
        };
        let entries = vec![e("Furniture"), e("Textures"), e("Structures"), e("Structures")];
        let p = PackProfile {
            object_categories: vec!["Furniture".into()],
            terrain_categories: vec!["Textures".into()],
            ..PackProfile::default()
        };
        // The point is that it stays reachable — this must NOT reclassify it.
        assert!(!p.is_object_category("Structures"));
        assert!(!p.is_terrain_category("Structures"), "still placeable by an object slot");
        assert!(is_object_slot(Some("Structures"), &p), "and still measured like one");
        log_unclassified_categories(&entries, &p); // writes the maplog line; must not panic
    }

    /// A compositing layer must not count as ground evidence. `art_signals`
    /// now REPORTS a fully-transparent tile at luminance 0 where it used to
    /// return None and be skipped — and 1,110 unmeasured entries sit inside
    /// terrain categories, including 15 of the 28 `Texture_Overlays`, so one
    /// sampled overlay could drag a ground word's mean toward zero and get a
    /// good floor rejected as too dark.
    #[test]
    fn an_overlay_contributes_no_ground_luminance() {
        let e = |p: &str| TileLibraryEntry {
            root: "r".into(),
            rel_path: p.into(),
            biome: "Woodlands".into(),
            category: "Textures".into(),
            keywords: vec!["grass".into()],
            w: 1,
            h: 1,
        };
        let m = |kind: ArtKind, lum: u8| MeasuredArt { kind, lum };
        let measured: HashMap<String, MeasuredArt> =
            [("real".to_string(), m(ArtKind::Ground, 120)), ("layer".to_string(), m(ArtKind::Overlay, 0))].into_iter().collect();
        assert_eq!(tile_luminance(&e("real"), &measured), Some(120.0));
        assert_eq!(tile_luminance(&e("layer"), &measured), None, "an overlay is not the material being judged");
        // Unreadable/absent art still says nothing rather than guessing.
        assert_eq!(tile_luminance(&e("missing-from-disk"), &measured), None);
    }

    /// The measurement filter must stay ON for a categorised OBJECT slot. It
    /// was keyed on `category.is_none()`, which was right only while the floor
    /// resolver was the sole categorised caller — field cells then began asking
    /// for Flora and Structures, silently switching their filter off and
    /// putting 14 semi-transparent shadow layers back into a jungle canopy.
    #[test]
    fn a_categorised_object_slot_still_measures_its_art() {
        let p = PackProfile { terrain_categories: vec!["Textures".into(), "Shadow_Paths".into()], ..PackProfile::default() };
        assert!(is_object_slot(None, &p), "an uncategorised request is always an object slot");
        assert!(is_object_slot(Some("Flora"), &p), "a field cell placing foliage is an object slot");
        assert!(is_object_slot(Some("Structures"), &p), "so is one placing rubble");
        assert!(!is_object_slot(Some("Textures"), &p), "the floor resolver wants that shelf as-is");
        assert!(!is_object_slot(Some("Shadow_Paths"), &p));
    }

    /// An uncaptioned field cell asks the SCENE what its foliage is, by putting
    /// the pack's own biome folder at the head — where the x8 weight and the
    /// exact-head tier land — and demoting the English noun to a modifier.
    /// Live: an Underdark fungal cavern drew 80 cells of autumn deciduous
    /// forest because 80 uncaptioned `T` cells searched the literal word "tree".
    #[test]
    fn an_uncaptioned_field_cell_asks_its_biome_not_the_dictionary() {
        let e = |biome: &str, kw: &[&str]| TileLibraryEntry {
            root: "r".into(),
            rel_path: kw.join("_"),
            biome: biome.into(),
            category: "Flora".into(),
            keywords: kw.iter().map(|s| s.to_string()).collect(),
            w: 3,
            h: 3,
        };
        let entries = vec![e("Underdark", &["underdark", "mushroom", "red"]), e("Woodlands", &["tree", "woodlands", "green"])];
        let idf = compute_idf(&entries);
        let top = |q: &str, scene: &str| {
            shortlist_entries(&entries, &tokenize_query(q), &idf, scene, 3, 3, 8, false, &prof())
                .first()
                .map(|e| e.rel_path.clone())
        };
        assert_eq!(top("tree Underdark", "cavern").as_deref(), Some("underdark_mushroom_red"));
        assert_eq!(top("tree Woodlands", "forest").as_deref(), Some("tree_woodlands_green"));
        // The bug: the bare noun drags a Woodlands tree into the Underdark.
        assert_eq!(top("tree", "cavern").as_deref(), Some("tree_woodlands_green"), "this is what the folder head exists to override");
    }

    /// A parenthetical is an aside for a human and lands exactly where it does
    /// the most damage — on the HEAD noun. Live: "Jungle canopy (left bank)"
    /// made "bank" the object's identity across 45 canopy cells.
    #[test]
    fn a_parenthetical_aside_never_becomes_the_head_noun() {
        assert_eq!(tokenize_query("Jungle canopy (left bank)"), vec!["jungle", "canopy"]);
        assert_eq!(tokenize_query("tunnel entrance (west passage)"), vec!["tunnel", "entrance"]);
        // Text after the aside survives, and an unclosed paren swallows the rest.
        assert_eq!(tokenize_query("bar counter (barkeep works row 2) polished"), vec!["bar", "counter", "polished"]);
        assert_eq!(tokenize_query("crates (spilled"), vec!["crates"]);
        assert_eq!(strip_parentheticals("no parens here"), "no parens here");
    }


    /// A tile that answers MORE of the label wins, even from a foreign biome.
    /// Live: "bone pile" resolved to `Dice_D4_Bone` — a bone die — because the
    /// catalog files its `Beast_Bone_*_Pile` art under Horror and the 0.15
    /// cross-biome multiplier crushed a score that was otherwise 4% higher.
    #[test]
    fn coverage_outranks_biome_affinity() {
        let sized = |biome: &str, kw: &[&str]| TileLibraryEntry {
            root: "r".into(),
            rel_path: kw.join("_"),
            biome: biome.into(),
            category: "Decor".into(),
            keywords: kw.iter().map(|s| s.to_string()).collect(),
            w: 1,
            h: 1,
        };
        let profile = PackProfile { universal_biome: Some("!Core_Settlements".into()), ..PackProfile::default() };
        let entries = vec![
            sized("Horror", &["beast", "bone", "white", "pile"]), // answers "bone" AND "pile"
            sized("!Core_Settlements", &["dice", "bone"]),        // answers "bone" only, but is local
        ];
        let idf = compute_idf(&entries);
        let got = shortlist_entries(&entries, &tokenize_query("bone pile"), &idf, "tavern", 1, 1, 8, false, &profile);
        assert_eq!(got.first().map(|e| e.rel_path.as_str()), Some("beast_bone_white_pile"), "got: {got:?}");

        // …but affinity keeps its real job: where both tiles answer the SAME
        // amount of the label, the local one still wins. This is the
        // `Flesh_Pale_Pillar`-in-a-tavern case, which must not regress.
        let pillars = vec![sized("Horror", &["flesh", "pale", "pillar"]), sized("!Core_Settlements", &["stone", "pillar"])];
        let idf = compute_idf(&pillars);
        let got = shortlist_entries(&pillars, &tokenize_query("pillar"), &idf, "tavern", 1, 1, 8, false, &profile);
        assert_eq!(got.first().map(|e| e.rel_path.as_str()), Some("stone_pillar"), "got: {got:?}");
    }

    /// Conjunctions are not object names, but they ARE catalog keywords —
    /// `Staff_of_Thunder_And_Lightning`, `Bow_And_Quiver`. Only 31 tiles in
    /// 183k carry "and", which made rarity weighting treat it as highly
    /// specific: "rubble and broken masonry" resolved to the Staff of Thunder
    /// and Lightning.
    /// A formation word is not what the cover is made OF. Live (2026-07-21,
    /// `w1-feywild`): "Giant mushroom ring" kept "ring" as the head, so
    /// `label_names_its_own_object` read "ring" (`Clutter` — FA files
    /// jewellery there), answered false, and the cell searched "Giant mushroom
    /// ring tree". The appended canonical noun took the x8 head weight and the
    /// ring drew as 45 autumn deciduous trees.
    #[test]
    fn tokenize_query_moves_a_trailing_formation_word_out_of_the_head() {
        assert_eq!(tokenize_query("giant mushroom ring"), vec!["giant", "ring", "mushroom"]);
        assert_eq!(tokenize_query("birch grove"), vec!["grove", "birch"]);
        assert_eq!(tokenize_query("dense fern thicket"), vec!["dense", "thicket", "fern"]);
        assert_eq!(tokenize_query("clump of ferns"), vec!["clump", "ferns"]);
        // Real props that merely LOOK collective keep their head, because the
        // catalog stocks them: FA has `Plant_Patch_*` and `Weapon_Stand_*`.
        assert_eq!(tokenize_query("thick bramble patch"), vec!["thick", "bramble", "patch"]);
        assert_eq!(tokenize_query("pine stand"), vec!["pine", "stand"]);
    }

    #[test]
    fn tokenize_query_drops_conjunctions_and_prepositions() {
        assert_eq!(tokenize_query("rubble and broken masonry"), vec!["rubble", "broken", "masonry"]);
        assert_eq!(tokenize_query("ruins with rubble"), vec!["ruins", "rubble"]);
        // Words that merely CONTAIN a stop word are untouched.
        assert_eq!(tokenize_query("sandbar and thewall"), vec!["sandbar", "thewall"]);
    }

    /// "-es" after a word already ending in "s" is a false-friend factory:
    /// "broken glass" reached `Glasses_Metal_Rusty_A_Broken` (spectacles)
    /// while all 116 `Glass_Pile_*` tiles sat unreachable.
    #[test]
    fn same_word_refuses_an_es_plural_on_a_word_already_ending_in_s() {
        assert!(!same_word("glass", "glasses"));
        assert!(!same_word("brass", "brasses"));
        // Every other plural/adjective form still matches.
        assert!(same_word("table", "tables"));
        assert!(same_word("box", "boxes"));
        assert!(same_word("torch", "torches"));
        assert!(same_word("wood", "wooden"));
    }

    /// Prints the field-glyph decision for every label in a corpus against the
    /// REAL catalog. `#[ignore]`d for the same reason as `rank_snapshot`.
    ///   TILE_CORPUS=…/field-labels.txt cargo test --lib field_decision -- --ignored --nocapture
    /// Corpus rows are `<glyph>\t<label>`.
    ///
    /// READ THE OUTPUT WITH THIS CAVEAT: it calls `shortlist_entries`, so it
    /// skips `shortlist_impl`'s measured `ArtKind::Overlay` drop. Drop-shadow
    /// layers therefore still appear here and are NOT a live regression —
    /// "jungle canopy" ranks `Palm_Tree_Trunk_Shadow` first in this harness and
    /// never reaches a real map. Confirm any shadow/overlay finding against an
    /// actual render before acting on it.
    #[test]
    #[ignore]
    fn field_decision_over_the_real_catalog() {
        let dir = std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("com.nabil.dndsheet/tile_library");
        let man: TileLibraryManifest = serde_json::from_str(&std::fs::read_to_string(dir.join("manifest.json")).unwrap()).unwrap();
        let profile: PackProfile = serde_json::from_str(&std::fs::read_to_string(dir.join("pack_profile.json")).unwrap()).unwrap();
        let idf = compute_idf(&man.entries);
        let scene = std::env::var("TILE_SCENES").unwrap_or_else(|_| "forest".into());
        for line in std::fs::read_to_string(std::env::var("TILE_CORPUS").unwrap()).unwrap().lines().filter(|l| !l.trim().is_empty()) {
            let (glyph, label) = line.split_once('\t').unwrap();
            let noun = if glyph == "^" { "rubble" } else { "tree" };
            let (fw, fh) = if glyph == "^" { (2, 2) } else { (3, 3) };
            let cat = modal_category(&man.entries, &profile, noun);
            // Mirrors `label_identity_token`: the LAST token actually stocked
            // in the noun's family, not blindly `tokens.last()` — a collective
            // head ("ring", "cluster") is stocked nowhere near it.
            // `tokenize_query` has already moved a trailing collective out of
            // head position, so this reads the identity word, not "ring".
            let head_cat = tokenize_query(label).last().and_then(|h| modal_category(&man.entries, &profile, h));
            let as_label = (head_cat.is_some() && head_cat == cat).then(|| label.to_string());
            // Exactly what campaign.rs does: category-restricted, the label
            // first when it names its own object, canonical noun as fallback.
            let pool: Vec<TileLibraryEntry> = match cat {
                Some(c) => man.entries.iter().filter(|e| e.category == c).cloned().collect(),
                None => man.entries.clone(),
            };
            let look = |q: &str| {
                shortlist_entries(&pool, &tokenize_query(q), &idf, &scene, fw, fh, 3, false, &profile)
                    .iter()
                    .map(|e| e.rel_path.rsplit('/').next().unwrap_or("").to_string())
                    .collect::<Vec<_>>()
            };
            let with_noun = format!("{label} {noun}");
            let (src, got) = match &as_label {
                Some(q) => match look(q) {
                    v if !v.is_empty() => (format!("q:{q}"), v),
                    _ => ("noun<-empty".to_string(), look(&with_noun)),
                },
                None => ("noun".to_string(), look(&with_noun)),
            };
            println!(
                "{:<28} head={:<11} [{:<26}] -> {}",
                label,
                head_cat.unwrap_or("(none)"),
                src,
                if got.is_empty() { "*** NOTHING ***".to_string() } else { got.join(" | ") }
            );
        }
    }

    /// Snapshot the whole ranking against the REAL imported catalog, so a
    /// scoring change can be diffed instead of argued about.
    ///
    /// `#[ignore]`d: it needs this machine's `manifest.json` (183k tiles) and
    /// a corpus file, neither of which exists in CI. Run it before and after
    /// a change to `shortlist_rank` / `shortlist_entries` and diff the two
    /// outputs — every one of the ranking bugs fixed so far (the wine rack,
    /// the laundry iron, the flesh pillar, the sandstone volcano) was a case
    /// where the fix for one label silently moved a hundred others.
    ///
    ///   TILE_CORPUS=…/label-corpus.txt TILE_SNAPSHOT=…/before.txt \
    ///     cargo test --lib rank_snapshot -- --ignored --nocapture
    #[test]
    #[ignore]
    fn rank_snapshot_over_the_real_catalog() {
        let dir = std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("com.nabil.dndsheet/tile_library");
        let man: TileLibraryManifest = serde_json::from_str(&std::fs::read_to_string(dir.join("manifest.json")).unwrap()).unwrap();
        let profile: PackProfile = serde_json::from_str(&std::fs::read_to_string(dir.join("pack_profile.json")).unwrap()).unwrap();
        let idf = compute_idf(&man.entries);
        let corpus = std::fs::read_to_string(std::env::var("TILE_CORPUS").unwrap()).unwrap();
        // Optional single-category restriction, mirroring `shortlist_in_category`.
        let only = std::env::var("TILE_CATEGORY").ok();
        let man = TileLibraryManifest {
            entries: match &only {
                Some(c) => man.entries.iter().filter(|e| e.category.eq_ignore_ascii_case(c)).cloned().collect(),
                None => man.entries,
            },
            ..Default::default()
        };

        let mut out = String::new();
        for line in corpus.lines().filter(|l| !l.trim().is_empty()) {
            let (size, label) = line.split_once('\t').unwrap();
            let (w, h) = size.split_once('x').unwrap();
            let (w, h) = (w.parse().unwrap(), h.parse().unwrap());
            let tokens = tokenize_query(label);
            // Scenes: one on the universal folder and two on real biome
            // folders, because `biome_affinity` only has teeth on those.
            for scene in std::env::var("TILE_SCENES").unwrap_or_else(|_| "tavern,cavern".into()).split(',') {
                // Terrain admission has to match what production would do for
                // this category, or a `TILE_CATEGORY=Textures` run reports
                // "(none)" for every floor query — every texture IS terrain.
                let top = shortlist_entries(&man.entries, &tokens, &idf, scene, w, h, 3, !is_object_slot(only.as_deref(), &profile), &profile);
                let names: Vec<&str> = top.iter().map(|e| e.rel_path.rsplit('/').next().unwrap_or("")).collect();
                out.push_str(&format!("{label} [{w}x{h}] @{scene} -> {}\n", if names.is_empty() { "(none)".into() } else { names.join(" | ") }));
            }
        }
        std::fs::write(std::env::var("TILE_SNAPSHOT").unwrap(), &out).unwrap();
        println!("{} lines written", out.lines().count());
    }

    #[test]
    fn shortlist_bridges_a_compound_label_the_model_wrote_to_the_catalog_base() {
        // "gravestone" isn't a plural of "grave", so strict scoring missed it;
        // the compound bridge surfaces the grave tile, and vision confirms.
        let idf = idf_map(&[("grave", 8.0), ("stone", 2.0), ("crate", 6.0), ("wood", 1.5)]);
        let grave = entry("Burial_and_Graves", &["grave", "stone"]);
        let got = shortlist_entries(std::slice::from_ref(&grave), &tokenize_query("gravestone"), &idf, "", 2, 2, 8, false, &prof());
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
        assert!(g > r, "grave ({g:?}) must outrank generic stone ({r:?}) for 'gravestone'");
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
        let got = shortlist_entries(std::slice::from_ref(&bar), &tokenize_query("Bar counter"), &idf, "", 6, 1, 8, false, &prof());
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

    /// The evidence must describe the set the RESOLVER selects, not the set the
    /// leading filename token groups. Volcanic is the live case: 14 `Rock_*` at
    /// luminance 60 and 70 `Lava_Rocks_*` at 117. Grouping by leading token
    /// reported "rock" as 14 dark files, so the profiler chose it as the
    /// non-hazard ground — and resolve_floor, matching any keyword, searched
    /// "rock", found the lava rocks too, and preferred them for being brighter.
    #[test]
    fn a_ground_candidate_reports_what_its_word_will_actually_select() {
        let tex = |name: &str, keywords: &[&str]| TileLibraryEntry {
            root: "r".into(),
            rel_path: format!("Volcanic/Textures/{name}"),
            biome: "Volcanic".into(),
            category: "Textures".into(),
            keywords: keywords.iter().map(|s| s.to_string()).collect(),
            w: 1,
            h: 1,
        };
        let mut entries = Vec::new();
        let mut measured = HashMap::new();
        for i in 0..4 {
            entries.push(tex(&format!("Rock_A_{i}.jpg"), &["rock", "volcanic"]));
            measured.insert(format!("Volcanic/Textures/Rock_A_{i}.jpg"), MeasuredArt { kind: ArtKind::Ground, lum: 60 });
        }
        for i in 0..8 {
            entries.push(tex(&format!("Lava_Rocks_B_{i}.jpg"), &["lava", "rocks", "volcanic"]));
            measured.insert(format!("Volcanic/Textures/Lava_Rocks_B_{i}.jpg"), MeasuredArt { kind: ArtKind::Ground, lum: 117 });
        }
        let ev = build_biome_evidence(&entries, &prof(), &measured);
        let rock = ev[0].ground.iter().find(|g| g.word == "rock").expect("rock is offered as a candidate");

        assert_eq!(rock.files, 12, "\"rock\" selects the lava rocks too — reporting 4 is the bug");
        assert!(rock.lum_max > 100, "the bright family it drags in must show in the range, not be sampled away: {rock:?}");
        assert!(rock.example.contains("Lava_Rocks"), "the examples must reveal the second family: {}", rock.example);
    }

    /// A re-profile must not be a re-roll.
    ///
    /// This test used to assert the opposite for one case — "a fresh answer
    /// must never be overwritten by the old one" — back when the only known
    /// failure was `horror` silently LOSING `liquid_query: "blood"` and a
    /// charnel house filling with clean blue water. Live evidence on
    /// 2026-07-21 reversed the call: a single re-profile moved six answers
    /// nobody asked it to touch, and two were regressions — `mountain` flipped
    /// to masonry walls, and `oasis` picked up `ceramic`, the BAZAAR's tiled
    /// market floor, for an open desert spring. Nothing catches that but a
    /// human reading a diff.
    ///
    /// So a settled answer wins by default, and the fresh one is taken only
    /// where the settled one no longer finds art — which is exactly the case
    /// where re-profiling has something real to say.
    #[test]
    fn a_settled_answer_survives_a_re_profile_unless_it_stopped_working() {
        let tex = |biome: &str, name: &str, keywords: &[&str]| TileLibraryEntry {
            root: "r".into(),
            rel_path: format!("{biome}/Textures/{name}"),
            biome: biome.into(),
            category: "Textures".into(),
            keywords: keywords.iter().map(|s| s.to_string()).collect(),
            w: 1,
            h: 1,
        };
        // The catalog still backs flesh/blood/marsh/terrain — but NOT "stone".
        let entries = vec![
            tex("Horror", "Flesh_A.jpg", &["flesh", "horror"]),
            tex("Horror", "Liquids/Blood_A.jpg", &["blood", "horror"]),
            tex("Swamp", "Marsh_A.jpg", &["marsh", "swamp"]),
            tex("Swamp", "Wet_A.jpg", &["wet", "swamp"]),
            tex("Volcanic", "Terrain_A.jpg", &["terrain", "volcanic"]),
            tex("Volcanic", "Rock_A.jpg", &["rock", "volcanic"]),
            tex("Crypt", "Bone_A.jpg", &["bone", "crypt"]),
        ];
        let measured: HashMap<String, MeasuredArt> = entries
            .iter()
            .map(|e| (e.rel_path.clone(), MeasuredArt { kind: ArtKind::Ground, lum: 100 }))
            .collect();
        let place = |scene: &str, folder: &str, floor: Option<&str>, walls: bool, liquid: Option<&str>| crate::pack_profile::BiomeProfile {
            scene: scene.into(),
            folder: folder.into(),
            floor_query: floor.map(str::to_string),
            natural_walls: walls,
            liquid_query: liquid.map(str::to_string),
        };
        let prev = PackProfile {
            biomes: vec![
                place("horror", "Horror", Some("flesh"), false, Some("blood")),
                place("swamp", "Swamp", Some("marsh"), true, None),
                place("volcano", "Volcanic", Some("terrain"), true, None),
                place("crypt", "Crypt", Some("stone"), true, None), // no `stone` art exists
            ],
            ..PackProfile::default()
        };
        let derived = PackProfile {
            biomes: vec![
                place("horror", "Horror", Some("flesh"), false, None), // lost its liquid
                place("swamp", "Swamp", Some("wet"), false, None),     // CHANGED, and flipped its walls
                place("volcano", "Volcanic", Some("rock"), true, None), // CHANGED
                place("crypt", "Crypt", Some("bone"), true, None),     // changed, and the old answer is dead
                place("reef", "Aquatic", Some("coral"), true, None),   // a place that did not exist before
            ],
            ..PackProfile::default()
        };
        let out = carry_forward_settled_answers(&prev, derived, &entries, &measured);
        let b = |scene: &str| out.scene(scene).unwrap().clone();

        assert_eq!(b("horror").liquid_query.as_deref(), Some("blood"), "a dropped liquid still comes back");
        assert_eq!(b("swamp").floor_query.as_deref(), Some("marsh"), "a settled floor must not be re-rolled to another working one");
        assert!(b("swamp").natural_walls, "natural_walls describes the PLACE and must not flip on a re-profile");
        assert_eq!(b("volcano").floor_query.as_deref(), Some("terrain"), "same — the settled answer wins");
        // The one case where re-deriving genuinely has something to say.
        assert_eq!(b("crypt").floor_query.as_deref(), Some("bone"), "a settled answer that no longer finds art gives way to the fresh one");
        assert_eq!(b("reef").floor_query.as_deref(), Some("coral"), "a place with no history profiles normally");
    }

    /// The one profile field where losing an answer is a SAFETY problem, not a
    /// cosmetic one. In the live pack `!Wilderness` is a grouping folder whose
    /// 13,190 tiles are 75% Gore — 252 humanoid corpses, plus wound overlays,
    /// blood pools and intestines — and its terrain classification is the only
    /// thing keeping every one of them out of object slots. That
    /// classification comes back from the model on each re-profile.
    #[test]
    fn a_category_settled_as_terrain_is_not_dropped_by_a_re_profile() {
        let e = |category: &str| TileLibraryEntry {
            root: "r".into(),
            rel_path: format!("Woodlands/{category}/x.webp"),
            biome: "Woodlands".into(),
            category: category.into(),
            keywords: vec!["x".into()],
            w: 1,
            h: 1,
        };
        let entries = vec![e("!Wilderness"), e("Textures"), e("Decor")];
        let prev = PackProfile {
            terrain_categories: vec!["!Wilderness".into(), "Textures".into(), "Retired_Overlays".into()],
            ..PackProfile::default()
        };
        let derived = PackProfile { terrain_categories: vec!["Textures".into(), "Shadow_Paths".into()], ..PackProfile::default() };
        let out = carry_forward_settled_answers(&prev, derived, &entries, &HashMap::new());

        assert!(out.is_terrain_category("!Wilderness"), "a settled terrain category the catalog still stocks must come back: {:?}", out.terrain_categories);
        // One-way: a NEW terrain answer is still accepted, and a settled one
        // whose tiles are all gone is not resurrected.
        assert!(out.is_terrain_category("Shadow_Paths"), "this run's own answer must survive");
        assert!(!out.is_terrain_category("Retired_Overlays"), "a category with no tiles left must not zombie back");
    }

    /// Both live failures from the re-profile that motivated this, and the
    /// control that must survive it. The two get DIFFERENT treatment on
    /// purpose — see prune_unbacked_grounds.
    #[test]
    fn a_ground_the_catalog_cant_back_is_dropped_and_a_good_one_is_not() {
        let tex = |biome: &str, name: &str, keywords: &[&str]| TileLibraryEntry {
            root: "r".into(),
            rel_path: format!("{biome}/Textures/{name}"),
            biome: biome.into(),
            category: "Textures".into(),
            keywords: keywords.iter().map(|s| s.to_string()).collect(),
            w: 1,
            h: 1,
        };
        let entries = vec![
            tex("Horror", "Flesh_A.jpg", &["flesh", "horror"]),
            tex("Settlements", "Grate_A.jpg", &["grate", "settlements"]),
            tex("Settlements", "Stone_A.jpg", &["stone", "settlements"]),
            // Blood lives under Liquids and measures ~42. Both facts matter:
            // resolve_liquid does NOT exclude that folder, and a pool is not
            // meant to be a legible board, so no luminance gate applies to it.
            tex("Horror", "Liquids/Blood_A_01.jpg", &["blood", "horror"]),
        ];
        // Only the grate is measured, and it is blown out well past the ceiling.
        let measured = HashMap::from([
            ("Settlements/Textures/Grate_A.jpg".to_string(), MeasuredArt { kind: ArtKind::Ground, lum: 211 }),
            ("Settlements/Textures/Stone_A.jpg".to_string(), MeasuredArt { kind: ArtKind::Ground, lum: 95 }),
            ("Horror/Textures/Flesh_A.jpg".to_string(), MeasuredArt { kind: ArtKind::Ground, lum: 88 }),
        ]);
        let place = |scene: &str, folder: &str, q: &str| crate::pack_profile::BiomeProfile {
            scene: scene.into(),
            folder: folder.into(),
            floor_query: Some(q.into()),
            natural_walls: false,
            liquid_query: None,
        };
        let profile = PackProfile {
            biomes: vec![
                place("crypt", "Horror", "dwarven"), // no dwarven art under Horror at all
                place("sewer", "Settlements", "grate"), // real art, unusable art
                place("abattoir", "Horror", "flesh"), // the control
            ],
            ..PackProfile::default()
        };
        let out = prune_unbacked_grounds(&entries, &measured, profile);

        assert!(out.scene("crypt").is_none(), "a query matching nothing in its own folder makes the whole pairing untrustworthy");
        // The pairing was sound, so the PLACE stays and only the material goes —
        // a sewer keeps its settlement art and falls back to the built-in floor.
        assert_eq!(out.scene("sewer").map(|b| b.folder.as_str()), Some("Settlements"));
        assert!(out.scene("sewer").unwrap().floor_query.is_none(), "art that washes out everything on top of it is not a floor");
        assert_eq!(out.scene("abattoir").unwrap().floor_query.as_deref(), Some("flesh"), "a backed, legible ground must survive untouched");
    }

    /// Live (2026-07-21): every jungle map rendered on built-in dungeon
    /// flagstone. Jungle ships 2,281 tiles and ZERO textures; Feywilds ships
    /// four, all measuring 41-52 against a floor gate of 70. Both have always
    /// borrowed woodland grass — but the folder-scoped check deleted any
    /// borrowed answer, and the profiler, shown only its own biome's (empty)
    /// candidate list, could answer nothing but null. The learned profile came
    /// out strictly WORSE than the hardcoded defaults it replaced.
    #[test]
    fn a_biome_with_no_ground_of_its_own_borrows_instead_of_losing_its_floor() {
        let tex = |biome: &str, name: &str, keywords: &[&str]| TileLibraryEntry {
            root: "r".into(),
            rel_path: format!("{biome}/Textures/{name}"),
            biome: biome.into(),
            category: "Textures".into(),
            keywords: keywords.iter().map(|s| s.to_string()).collect(),
            w: 1,
            h: 1,
        };
        let flora = |biome: &str, name: &str| TileLibraryEntry {
            root: "r".into(),
            rel_path: format!("{biome}/Flora/{name}"),
            biome: biome.into(),
            category: "Flora".into(),
            keywords: vec!["palm".into()],
            w: 1,
            h: 1,
        };
        let entries = vec![
            tex("Woodlands", "Grass_A.jpg", &["grass", "woodlands"]),
            tex("Swamp", "Wet_A.jpg", &["wet", "swamp"]),
            // Jungle: tiles, but not one of them is ground.
            flora("Jungle", "Palm_A.webp"),
            // Feywilds: ground of its own, every bit of it too dark to stand on.
            tex("Feywilds", "Terrain_A_05.jpg", &["terrain", "feywilds"]),
        ];
        let measured = HashMap::from([
            ("Woodlands/Textures/Grass_A.jpg".to_string(), MeasuredArt { kind: ArtKind::Ground, lum: 120 }),
            ("Swamp/Textures/Wet_A.jpg".to_string(), MeasuredArt { kind: ArtKind::Ground, lum: 95 }),
            ("Feywilds/Textures/Terrain_A_05.jpg".to_string(), MeasuredArt { kind: ArtKind::Ground, lum: 41 }),
        ]);
        let place = |scene: &str, folder: &str, q: Option<&str>| crate::pack_profile::BiomeProfile {
            scene: scene.into(),
            folder: folder.into(),
            floor_query: q.map(str::to_string),
            natural_walls: true,
            liquid_query: None,
        };
        let profile = PackProfile {
            biomes: vec![
                place("jungle", "Jungle", None),          // answered nothing; nothing to answer WITH
                place("feywild", "Feywilds", Some("grass")), // a borrow, explicitly stated
                place("swamp", "Swamp", Some("wet")),     // stands on its own — control
                place("crypt", "Swamp", Some("dwarven")), // a folder that CAN answer, given a word it can't
            ],
            ..PackProfile::default()
        };
        let out = prune_unbacked_grounds(&entries, &measured, profile);

        assert_eq!(
            out.scene("jungle").and_then(|b| b.floor_query.clone()).as_deref(),
            Some("grass"),
            "a folder with no ground at all must adopt the built-in borrow, not render on flagstone"
        );
        assert_eq!(
            out.scene("feywild").and_then(|b| b.floor_query.clone()).as_deref(),
            Some("grass"),
            "four unusable textures is still no ground of its own — the borrow must survive"
        );
        assert_eq!(out.scene("swamp").and_then(|b| b.floor_query.clone()).as_deref(), Some("wet"));
        // Unchanged: a folder that ships perfectly good ground and is handed a
        // word matching none of it is a bad PAIRING, not a borrow.
        assert!(out.scene("crypt").is_none(), "a mispaired query must still drop its place");
    }

    /// Live (2026-07-21, volcano): "Collapsed masonry" strewed TAN SANDSTONE
    /// across a black basalt caldera. All 445 `Rubble_Stone_*` tiles sit in
    /// `!Core_Settlements`, the universal biome, so `biome_affinity` scores
    /// every one of them 1.0 for every scene; the material lives only in the
    /// filename, and the query matched none of those words. Everything tied,
    /// and the tiebreak alone decided it.
    #[test]
    fn among_equally_scoring_tiles_the_one_that_names_the_scene_wins() {
        let rubble = |material: &str| TileLibraryEntry {
            root: "r".into(),
            rel_path: format!("Settlements/Structures/Rubble_Stone_{material}_A1_1x1.webp"),
            biome: "!Core_Settlements".into(),
            category: "Structures".into(),
            keywords: vec!["rubble".into(), "stone".into(), material.to_ascii_lowercase(), "structures".into()],
            w: 1,
            h: 1,
        };
        let entries = vec![rubble("Sandstone"), rubble("Slate"), rubble("Volcanic"), rubble("Earthy")];
        let idf = compute_idf(&entries);
        let profile = PackProfile {
            biomes: vec![crate::pack_profile::BiomeProfile {
                scene: "volcanic".into(),
                folder: "Volcanic".into(),
                floor_query: None,
                natural_walls: true,
                liquid_query: None,
            }],
            universal_biome: Some("!Core_Settlements".into()),
            object_categories: vec!["Structures".into()],
            ..PackProfile::default()
        };
        let got = shortlist_entries(&entries, &tokenize_query("rubble"), &idf, "volcanic", 1, 1, 8, false, &profile);
        assert!(
            got.first().is_some_and(|e| e.rel_path.contains("Volcanic")),
            "a volcano must get volcanic rubble when every candidate scores the same: {:?}",
            got.iter().map(|e| e.rel_path.split('/').next_back().unwrap()).collect::<Vec<_>>()
        );
    }

    #[test]
    fn object_vocabulary_only_draws_from_object_like_categories() {
        let entries = vec![
            entry("Furniture", &["table", "round", "woodlands", "furniture"]),
            entry("Structures", &["wall", "stone", "woodlands", "structures"]),
        ];
        let vocab = object_vocabulary(&entries, &prof());
        assert!(vocab.contains(&"table".to_string()));
        assert!(vocab.contains(&"round".to_string()));
        assert!(!vocab.contains(&"wall".to_string()), "Structures isn't placeable set-dressing: {vocab:?}");
        assert!(!vocab.contains(&"stone".to_string()), "{vocab:?}");
    }

    #[test]
    fn object_vocabulary_excludes_the_entrys_own_biome_and_category_words() {
        let entries = vec![entry("Furniture", &["table", "woodlands", "furniture"])];
        let vocab = object_vocabulary(&entries, &prof());
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
        assert_eq!(object_vocabulary(&entries, &prof()), vec!["candle".to_string(), "table".to_string(), "barrel".to_string()]);
    }

    /// "multicolor2" ranked 100th on raw frequency (781 uses) — a filename
    /// variant tag, not a word anyone would write an object label with.
    #[test]
    fn object_vocabulary_drops_filename_artifacts() {
        assert!(is_artifact_word("01") && is_artifact_word("multicolor2") && is_artifact_word("green1"));
        assert!(!is_artifact_word("table") && !is_artifact_word("bookshelf"));
        let entries = vec![entry("Furniture", &["table", "multicolor2", "01"])];
        assert_eq!(object_vocabulary(&entries, &prof()), vec!["table".to_string()]);
    }

    #[test]
    fn object_vocabulary_is_capped() {
        let entries: Vec<TileLibraryEntry> = (0..VOCAB_CAP + 50)
            // Trailing "w" keeps these off `is_artifact_word`'s digit-suffix
            // rule — this is testing the CAP, not the artifact filter.
            .map(|i| TileLibraryEntry { root: "r".into(), rel_path: "x".into(), biome: "Woodlands".into(), category: "Furniture".into(), keywords: vec![format!("word{i}w")], w: 1, h: 1 })
            .collect();
        assert_eq!(object_vocabulary(&entries, &prof()).len(), VOCAB_CAP);
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
