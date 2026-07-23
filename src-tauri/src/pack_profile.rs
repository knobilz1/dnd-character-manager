//! pack_profile.rs — what an imported tile pack IS, learned at import time
//! instead of hardcoded to one vendor's folder scheme.
//!
//! Everything the resolver needs to use a catalog — which path segment names
//! the biome, which names the category, which categories hold placeable
//! objects vs. tileable terrain, which biome fits any scene, and per biome its
//! ground texture, wall material and liquid — used to be six `const` tables
//! written against Forgotten Adventures' layout. That worked exactly as long
//! as the imported pack was FA. Anything else scanned "successfully" and then
//! silently resolved nothing: no folder named `Textures`, so no floor ever
//! resolved; no `!Core_Settlements`, so `biome_affinity` scored EVERY tile
//! 0.15; no recognised category, so ground art became eligible as objects.
//!
//! So the tables become the DEFAULT profile (still exactly FA, so an existing
//! install cannot regress), and any pack can carry its own — derived once by
//! `profile_pack`, corrected by hand in the Detected Biomes panel, and
//! persisted next to the manifest.
//!
//! Two files, the same split `tile_overrides.json` already uses for art
//! classification: `pack_profile.json` is what profiling derived and is
//! rewritten wholesale by a re-profile, `pack_profile_overrides.json` is what
//! a human corrected and always wins. Corrections therefore survive both a
//! re-profile and a re-import.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Component, Path};

/// Where in a path the biome lives. A pack need not HAVE biomes — plenty are a
/// flat pile of props — and pretending otherwise is worse than admitting it,
/// because a wrong biome makes `biome_affinity` demote art for not belonging to
/// a category the pack never had.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BiomeSource {
    /// No biome dimension: every tile fits every scene. Biome reads as `""`,
    /// which `biome_affinity` treats as universal.
    Flat,
    /// The first directory segment under the imported root.
    FirstSegment,
    /// The segment right after the LAST one starting with any `biome_anchors`
    /// entry — for packs that wrap their content in a vendor folder.
    AfterAnchor,
}

/// How to read `(biome, category)` out of a path. The FA default reproduces
/// `biome_category_from_rel`'s original hardcoded behaviour exactly.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PackLayout {
    pub biome_source: BiomeSource,
    /// Matched by PREFIX, case-insensitively — one real pack spells the same
    /// anchor `FA_Assets_Webp` in some sub-packs and `FA_Assets` in others.
    pub biome_anchors: Vec<String>,
    /// Folder names that name a category wherever they appear under the biome,
    /// at any depth. Walking to the first of these (rather than taking the next
    /// segment) is what steps over a pack's own sub-collection folders — FA
    /// nests `Woodlands/Base_Woodlands_Settlement/Furniture/…`, and reading the
    /// settlement name as the category was a real, visible bug.
    pub category_folders: Vec<String>,
}

/// One PLACE a fight can happen, in the terms the map resolver asks questions
/// in. The unit is the place, not the art folder, because several places
/// legitimately share one folder while differing in everything that matters: a
/// natural cave and a drow city are both FA `Underdark` but stand on limestone
/// and cut stone respectively, and a mind flayer colony and Far Realm
/// wilderness are both `Astral`. Keying this by folder collapses those pairs
/// and silently costs one of each its ground.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct BiomeProfile {
    /// The word `classify_biome` answers with. Unique across the profile.
    pub scene: String,
    /// The catalog folder its art comes from — the join key to
    /// `TileLibraryEntry.biome`. Several scenes may point at the same one.
    pub folder: String,
    /// The `Textures` query that finds this biome's ground. `None` keeps the
    /// built-in stone floor — correct for a dungeon, and the honest answer when
    /// a pack simply ships no ground art for a biome.
    pub floor_query: Option<String>,
    /// `#` cells are living rock, so draw them as this biome's own ground
    /// darkened rather than the built-in masonry sprites.
    pub natural_walls: bool,
    /// The `~` query, when water is the wrong answer here. `None` = water.
    pub liquid_query: Option<String>,
}

/// Everything learned about one imported catalog.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct PackProfile {
    pub layout: PackLayout,
    /// The biome that fits ANY scene (FA's generic human-built set), never
    /// demoted by `biome_affinity`. `None` when the pack has no such set —
    /// then only same-biome art is unpenalised.
    pub universal_biome: Option<String>,
    /// Categories holding placeable set-dressing: what `Objects:` may name and
    /// what the object vocabulary is drawn from.
    pub object_categories: Vec<String>,
    /// Categories that are tileable SURFACE or path art, never a discrete
    /// object. Getting this wrong is the expensive one — an object search that
    /// can return ground art resolves "bone pile" to a bone-dirt floor texture.
    pub terrain_categories: Vec<String>,
    pub biomes: Vec<BiomeProfile>,
}

impl Default for PackProfile {
    /// Forgotten Adventures, which is what every one of these values was
    /// authored and probed against. Used verbatim when nothing has been
    /// profiled, so an install that predates profiling behaves identically.
    fn default() -> Self {
        Self {
            layout: PackLayout {
                biome_source: BiomeSource::AfterAnchor,
                biome_anchors: vec!["FA_Assets".into()],
                category_folders: DEFAULT_CATEGORY_FOLDERS.iter().map(|s| (*s).into()).collect(),
            },
            universal_biome: Some("!Core_Settlements".into()),
            object_categories: DEFAULT_OBJECT_CATEGORIES.iter().map(|s| (*s).into()).collect(),
            terrain_categories: DEFAULT_TERRAIN_CATEGORIES.iter().map(|s| (*s).into()).collect(),
            biomes: DEFAULT_BIOMES
                .iter()
                .map(|(scene, folder, floor, walls, liquid)| BiomeProfile {
                    scene: (*scene).into(),
                    folder: (*folder).into(),
                    floor_query: (!floor.is_empty()).then(|| (*floor).into()),
                    natural_walls: *walls,
                    liquid_query: (!liquid.is_empty()).then(|| (*liquid).into()),
                })
                .collect(),
        }
    }
}

/// Real Forgotten Adventures object-type folder names, observed across the
/// actual imported library — both directly under a biome and nested under a
/// named settlement.
const DEFAULT_CATEGORY_FOLDERS: &[&str] = &[
    "Furniture", "Decor", "Clutter", "Workplace_Equipment", "Lightsources", "Natural_Decor", "Burial_and_Graves", "Flora", "Structures", "Combat",
    "Vehicles", "Textures", "Elevation",
];

/// Categories worth drawing `Objects:` vocabulary from — genuinely placeable,
/// small-footprint physical set-dressing. Deliberately excludes Structures
/// (multi-tile buildings), Combat (damage/blood decals), Textures (tileable
/// material, not a discrete object) and Elevation (cliff/bank path pieces).
const DEFAULT_OBJECT_CATEGORIES: &[&str] =
    &["Furniture", "Decor", "Clutter", "Workplace_Equipment", "Lightsources", "Natural_Decor", "Burial_and_Graves", "Flora", "Vehicles"];

const DEFAULT_TERRAIN_CATEGORIES: &[&str] = &["Textures", "Texture_Overlays", "Elevation", "Shadow_Paths", "Misc_Paths"];

/// The scene meaning "no override": the renderer's own stone floor and built
/// masonry walls, resolved without a single catalog lookup. It must reach the
/// classifier (see `biome_ids`) but must never appear in a profile — see the
/// guard in `parse_semantics_reply`.
pub const BUILTIN_SCENE: &str = "dungeon";

/// `(scene, folder, floor query, natural walls, liquid query)` — one row per
/// PLACE. Reproduces exactly the hand-authored Forgotten Adventures tables this
/// replaced, so an existing install sees no change.
///
/// Every floor query here was PROBED against the live catalog, never reasoned
/// about from the wording. Two traps are baked into these values: a query whose
/// head noun is the bare word "floor" resolves to generic brick regardless of
/// biome (which is why "brick floor" is deliberate and nothing else ends that
/// way), and `alien` borrows the ceremorph plate because its own Far Realm
/// ground art measures mean luminance 26 against a legibility floor of 70.
///
/// `dungeon` is deliberately absent: it IS the built-in look, so a dungeon map
/// keeps the stone floor with no override and no vision call.
/// The built-in ground query for an art FOLDER, if the default table has one.
/// Keyed by folder rather than scene word because a learned profile invents its
/// own scene words ("feywild" where the table says "fey") but the folder is the
/// pack's own name and matches exactly. Used to rescue a place whose folder
/// ships no usable ground of its own — see `prune_unbacked_grounds`. Pure.
pub fn builtin_floor_for_folder(folder: &str) -> Option<&'static str> {
    DEFAULT_BIOMES
        .iter()
        .find(|(_, f, floor, _, _)| *f == folder && !floor.is_empty())
        .map(|(_, _, floor, _, _)| *floor)
}

const DEFAULT_BIOMES: &[(&str, &str, &str, bool, &str)] = &[
    ("cave", "Underdark", "cave", true, ""),
    ("underdark", "Underdark", "drow stone", true, ""),
    ("forest", "Woodlands", "grass", true, ""),
    ("mountain", "Mountain", "gravel", true, ""),
    ("desert", "Desert", "desert sand", true, ""),
    ("snow", "Arctic", "snow", true, ""),
    ("swamp", "Swamp", "marsh mud", true, ""),
    ("coast", "Aquatic", "beach sand", true, ""),
    ("volcanic", "Volcanic", "volcanic rock", true, ""),
    ("town", "!Core_Settlements", "cobblestone", false, ""),
    ("tavern", "!Core_Settlements", "brick floor", false, ""),
    ("illithid", "Astral", "ceremorph", true, "ceremorph magical liquid"),
    ("alien", "Astral", "ceremorph", true, "ceremorph magical liquid"),
    // Three packs that had no scene word at all, so `classify_biome` could
    // never name them and every one of their tiles scored 0.15 forever. Horror
    // is the third-largest collection in the whole catalog. `scene_biome`
    // already had needles for horror and fey, and `biome_affinity`'s own test
    // says "Horror flesh has no business in a tavern" — the ranking had been
    // taught about them; nothing ever gave the classifier the word to say.
    ("horror", "Horror", "flesh", true, "blood"),
    // No ground of its own that reads as a board: `metal` is 43% owned by other
    // biomes and measures mean luminance 52 against a floor gate of 70. Keeping
    // the built-in floor still unlocks its 3,226 objects, which is the point.
    ("factory", "Industrial", "", false, ""),
    // 1,602 tiles and FOUR textures, none usable — it borrows, like `alien`.
    ("fey", "Feywilds", "grass", true, ""),
    // Places that share a folder with a wilderness sibling but are a different
    // board entirely — the same split as cave/underdark. Each ground word below
    // is owned 100% by its own biome and measured inside the legibility band.
    ("bazaar", "Desert", "ceramic", false, ""),
    ("forge", "Mountain", "dwarven", false, ""),
    ("greenhouse", "Woodlands", "botanical", false, ""),
    ("reef", "Aquatic", "coral", true, ""),
    // Jungle ships 2,281 tiles and they are ALL Flora — zero textures. It has
    // always borrowed woodland grass; saying so is the only change.
    ("jungle", "Jungle", "grass", true, ""),
];

/// `(biome, category)` for a path relative to the imported root, read through
/// `layout`. Pure.
pub fn biome_category_from_rel(rel: &Path, layout: &PackLayout) -> (String, String) {
    let parts: Vec<&str> = rel.components().filter_map(|c| match c { Component::Normal(s) => s.to_str(), _ => None }).collect();
    let end = parts.len().saturating_sub(1); // exclude the filename itself
    // Where the biome sits, and where its category folders start. Anchored
    // layouts fall back to first-segment when a particular path has no anchor,
    // so one odd sub-folder can't blank out a whole pack.
    let anchor_at = || {
        parts[..end]
            .iter()
            .rposition(|p| layout.biome_anchors.iter().any(|a| p.len() >= a.len() && p[..a.len()].eq_ignore_ascii_case(a)))
    };
    let (biome, dirs): (String, &[&str]) = match layout.biome_source {
        BiomeSource::Flat => (String::new(), parts.get(..end).unwrap_or(&[])),
        BiomeSource::FirstSegment => (parts.first().copied().unwrap_or("misc").to_string(), parts.get(1..end).unwrap_or(&[])),
        BiomeSource::AfterAnchor => match anchor_at() {
            Some(i) => (parts.get(i + 1).copied().unwrap_or("misc").to_string(), parts.get(i + 2..end).unwrap_or(&[])),
            None => (parts.first().copied().unwrap_or("misc").to_string(), parts.get(1..end).unwrap_or(&[])),
        },
    };
    let category = dirs
        .iter()
        .find(|p| layout.category_folders.iter().any(|f| f.eq_ignore_ascii_case(p)))
        .or_else(|| dirs.first())
        .copied()
        .unwrap_or("misc")
        .to_string();
    (biome, category)
}

impl PackProfile {
    /// The place a scene word names. Exact match first, then substring, so a
    /// classifier answering "underdark cavern" still lands somewhere sensible.
    pub fn scene(&self, scene: &str) -> Option<&BiomeProfile> {
        let s = scene.to_lowercase();
        self.biomes
            .iter()
            .find(|b| b.scene.eq_ignore_ascii_case(&s))
            .or_else(|| self.biomes.iter().find(|b| s.contains(&b.scene.to_lowercase())))
    }

    /// The catalog folder a scene word's art comes from. `None` when nothing
    /// claims it, which the caller reads as "fall back to the universal set".
    pub fn folder_for_scene(&self, scene: &str) -> Option<&str> {
        self.scene(scene).map(|b| b.folder.as_str())
    }

    /// Every scene word the classifier may answer with.
    pub fn scene_words(&self) -> Vec<&str> {
        self.biomes.iter().map(|b| b.scene.as_str()).collect()
    }

    pub fn is_object_category(&self, category: &str) -> bool {
        self.object_categories.iter().any(|c| c.eq_ignore_ascii_case(category))
    }

    pub fn is_terrain_category(&self, category: &str) -> bool {
        self.terrain_categories.iter().any(|c| c.eq_ignore_ascii_case(category))
    }

    /// Human corrections folded over a derived profile. Only the fields a
    /// correction actually names are replaced, so the panel can fix one biome's
    /// ground query without freezing everything else against re-profiling.
    pub fn with_overrides(mut self, ov: &ProfileOverrides) -> Self {
        if let Some(l) = &ov.layout {
            self.layout = l.clone();
        }
        if let Some(u) = &ov.universal_biome {
            self.universal_biome = u.clone();
        }
        if let Some(c) = &ov.object_categories {
            self.object_categories = c.clone();
        }
        if let Some(c) = &ov.terrain_categories {
            self.terrain_categories = c.clone();
        }
        for (scene, edit) in &ov.biomes {
            let Some(b) = self.biomes.iter_mut().find(|b| b.scene.eq_ignore_ascii_case(scene)) else {
                // A place the human added by hand because profiling missed it.
                self.biomes.push(BiomeProfile {
                    scene: scene.clone(),
                    folder: edit.folder.clone().unwrap_or_default(),
                    floor_query: edit.floor_query.clone().flatten(),
                    natural_walls: edit.natural_walls.unwrap_or(false),
                    liquid_query: edit.liquid_query.clone().flatten(),
                });
                continue;
            };
            if let Some(f) = &edit.folder {
                b.folder = f.clone();
            }
            if let Some(f) = &edit.floor_query {
                b.floor_query = f.clone();
            }
            if let Some(n) = edit.natural_walls {
                b.natural_walls = n;
            }
            if let Some(l) = &edit.liquid_query {
                b.liquid_query = l.clone();
            }
        }
        self
    }

    /// A coastal scene word, added when the profile has none. A beach or cove is
    /// a SAND-and-SEA board that no single art folder owns — FA keeps its sand
    /// under Desert/Volcanic and its open water under Aquatic — so the
    /// per-folder profiler structurally can't derive it: it gave Aquatic the one
    /// word `underwater` (all coral and kelp). Left unsaid, a "smuggler's cove"
    /// classified as `nautiloid`/`forest`/`underwater` and rendered as an
    /// illithid ship, a grass clearing, or a coral seabed — measured 2026-07-22.
    /// Seeded in code, like the built-in `dungeon`, so it survives a re-profile
    /// without needing to be saved; folded in BEFORE `with_overrides` so the
    /// panel can still correct it.
    ///
    /// folder Desert: object affinity for what is actually ON a beach —
    /// driftwood, boulders, barrels, crates — which Desert stocks and Aquatic
    /// (underwater) does not. floor_query "beach sand" resolves cross-folder to
    /// the palest sand the vision picker finds; liquid_query "water" reaches
    /// Aquatic's open blue Water_* for the `~` surf. natural_walls so a cove's
    /// `#` cliffs read as living sea-rock rather than masonry.
    ///
    /// ponytail: fires on "no coastal word" alone. A pack with neither sand nor
    /// open water would seed a coast that resolves to the built-in floor
    /// (graceful, like any artless scene); add a manifest gate only if a real
    /// pack regresses.
    pub fn ensure_coast_scene(mut self) -> Self {
        const COASTAL: &[&str] = &["coast", "beach", "shore", "cove", "seaside", "tidal"];
        let has_coastal = self.biomes.iter().any(|b| {
            let s = b.scene.to_ascii_lowercase();
            COASTAL.iter().any(|w| s.contains(w))
        });
        if !has_coastal {
            self.biomes.push(BiomeProfile {
                scene: "coast".into(),
                folder: "Desert".into(),
                floor_query: Some("beach sand".into()),
                natural_walls: true,
                liquid_query: Some("water".into()),
            });
        }
        self
    }
}

/// What the panel writes. Every field optional: absent means "leave whatever
/// profiling decided", present means "this, even after a re-profile". The
/// doubled `Option` on the query fields is load-bearing — outer `None` is "not
/// corrected", inner `None` is "corrected TO nothing", i.e. a human saying this
/// biome genuinely has no ground art and should keep the built-in floor.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct ProfileOverrides {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<PackLayout>,
    #[serde(default, deserialize_with = "present_even_if_null", skip_serializing_if = "Option::is_none")]
    pub universal_biome: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub object_categories: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terrain_categories: Option<Vec<String>>,
    #[serde(default)]
    pub biomes: HashMap<String, BiomeEdit>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct BiomeEdit {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    #[serde(default, deserialize_with = "present_even_if_null", skip_serializing_if = "Option::is_none")]
    pub floor_query: Option<Option<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub natural_walls: Option<bool>,
    #[serde(default, deserialize_with = "present_even_if_null", skip_serializing_if = "Option::is_none")]
    pub liquid_query: Option<Option<String>>,
}

/// Distinguishes "field absent" from "field present and null" for the
/// `Option<Option<T>>` corrections. Serde collapses both to `None` by default,
/// which silently turned "this biome has NO ground art, keep the built-in
/// floor" back into "not corrected" the moment the file round-tripped. Absent
/// is handled by `default`; anything actually present arrives here and is
/// wrapped, so a literal `null` becomes `Some(None)`. Pairs with
/// `skip_serializing_if` — without it, `None` would write itself as `null` and
/// read back as `Some(None)`, inventing a correction nobody made.
fn present_even_if_null<'de, D, T>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Deserialize::deserialize(de).map(Some)
}

// ── Profiling: evidence in, profile out ─────────────────────────────────────
//
// The single rule that matters here: the profiler is shown MEASUREMENTS, never
// just folder names. Every bug found while wiring the Astral pack up by hand
// came from probing and would have been repeated by anything reasoning from
// names alone — the ground query that also matched the brine pools (caught by
// counting which files own the keyword), the Far Realm ground that is too dark
// to be a board (caught by measuring luminance), the columns filed under
// "Support_Column" so nothing asking for a "pillar" finds them (caught by
// grepping the keyword). So the prompts below carry counts, luminance ranges
// and real filenames, and the model's job is to interpret evidence rather than
// to guess from a taxonomy.

/// How deep and wide the directory digest goes. Enough to show a pack's shape
/// without pasting a 183k-file listing into a prompt.
const DIGEST_DEPTH: usize = 4;
const DIGEST_CHILDREN: usize = 14;

/// A compact picture of a pack's folder structure, built from raw relative
/// paths BEFORE anything has been parsed — which is the point, since reading
/// the paths correctly is exactly what the layout pass is deciding.
pub fn directory_digest(paths: &[String]) -> String {
    // (segments so far) -> file count, for every prefix up to DIGEST_DEPTH.
    let mut counts: HashMap<Vec<&str>, usize> = HashMap::new();
    for p in paths {
        let segs: Vec<&str> = p.split('/').collect();
        // The filename itself is not a folder.
        for d in 1..segs.len().min(DIGEST_DEPTH + 1) {
            *counts.entry(segs[..d].to_vec()).or_insert(0) += 1;
        }
    }
    let mut out = format!("{} files\n", paths.len());
    fn walk(prefix: &[&str], counts: &HashMap<Vec<&str>, usize>, out: &mut String) {
        let mut kids: Vec<(&Vec<&str>, &usize)> = counts.iter().filter(|(k, _)| k.len() == prefix.len() + 1 && k.starts_with(prefix)).collect();
        if kids.is_empty() {
            return;
        }
        kids.sort_by(|a, b| b.1.cmp(a.1).then_with(|| a.0.cmp(b.0)));
        let shown = kids.len().min(DIGEST_CHILDREN);
        for (k, n) in kids.iter().take(shown) {
            out.push_str(&format!("{}{}/  ({n})\n", "  ".repeat(prefix.len()), k.last().unwrap()));
            walk(k, counts, out);
        }
        if kids.len() > shown {
            out.push_str(&format!("{}… and {} more\n", "  ".repeat(prefix.len()), kids.len() - shown));
        }
    }
    walk(&[], &counts, &mut out);
    out
}

/// One candidate ground material for a biome: an identity word several texture
/// files share, and how bright those files actually measure. The luminance
/// range is the load-bearing part — a pack's own ground art can be too dark to
/// place minis on, and no amount of reading its name reveals that.
#[derive(Clone, Debug, PartialEq)]
pub struct GroundCandidate {
    pub word: String,
    pub files: usize,
    pub lum_min: u8,
    pub lum_max: u8,
    pub lum_mean: u8,
    /// One real filename, so the model can see the vendor's naming.
    pub example: String,
}

/// Everything known about one biome, for the semantics pass.
#[derive(Clone, Debug, PartialEq)]
pub struct BiomeEvidence {
    pub folder: String,
    pub tiles: usize,
    pub categories: Vec<(String, usize)>,
    pub ground: Vec<GroundCandidate>,
    /// Real object filenames — how this pack NAMES things, which is how the
    /// "pillar" vs "Support_Column" mismatch becomes visible.
    pub sample_objects: Vec<String>,
}

/// The evidence block for one biome, as the profiler sees it.
fn render_biome_evidence(e: &BiomeEvidence) -> String {
    let cats = e.categories.iter().map(|(c, n)| format!("{c} {n}")).collect::<Vec<_>>().join(", ");
    let mut s = format!("### {}  — {} tiles\ncategories: {}\n", e.folder, e.tiles, cats);
    if e.ground.is_empty() {
        s.push_str("candidate ground materials: NONE — this biome ships no surface textures\n");
    } else {
        s.push_str("candidate ground materials (word, files the word SELECTS, measured luminance 0-255, example filenames from that selection):\n");
        for g in &e.ground {
            s.push_str(&format!("  \"{}\"  {} files  lum {}-{} (mean {})  e.g. {}\n", g.word, g.files, g.lum_min, g.lum_max, g.lum_mean, g.example));
        }
    }
    if !e.sample_objects.is_empty() {
        s.push_str(&format!("object filenames: {}\n", e.sample_objects.join(", ")));
    }
    s
}

pub fn build_layout_prompt(digest: &str) -> String {
    format!(
        "You are reading the folder structure of a battle-map art pack someone just imported, to work out how it files its tiles.\n\n\
         Two things are needed from every path:\n\
         - BIOME: the setting a tile belongs to (a cave, a desert, a town). Many packs have no biome dimension at all — a flat pile of props is normal and you must say so rather than invent one.\n\
         - CATEGORY: what kind of thing a tile is (furniture, clutter, ground textures, walls).\n\n\
         Directory tree, deepest counts in parentheses:\n{digest}\n\n\
         Reply with ONLY this JSON:\n\
         {{\"biome_source\": \"flat\" | \"first_segment\" | \"after_anchor\",\n\
           \"biome_anchors\": [\"...\"],\n\
           \"category_folders\": [\"...\"]}}\n\n\
         - \"after_anchor\" means the biome is the segment right AFTER a fixed wrapper folder; put that wrapper's name in biome_anchors (matched by prefix, so give the shortest common stem if the pack spells it more than one way). Otherwise biome_anchors is [].\n\
         - \"first_segment\" means the top-level folders ARE the biomes.\n\
         - \"flat\" means there is no biome level; every tile suits any scene.\n\
         - category_folders lists every folder name that names a KIND OF THING wherever it appears — furniture, clutter, ground textures, lighting, vehicles, effects. Include ground/texture folders.\n\
         - Do NOT list a folder that names a PLACE or a COLLECTION rather than a kind of thing. A pack often groups a biome's contents into a settlement and a wilderness half (\"Base_Desert_Settlement\", \"Drow_Settlement\", \"!Wilderness\", \"Ruins\") and then puts the real categories INSIDE those. Those grouping folders sit exactly where a category would, which is why the category has to be searched for by name instead of taken positionally — listing one collapses every tile beneath it into a single meaningless category and loses the real one. The test: could this folder's name appear under several different biomes AND describe what an individual tile IS? Only then is it a category."
    )
}

pub fn build_semantics_prompt(evidence: &[BiomeEvidence], categories: &[String], previous_scenes: &[String]) -> String {
    let blocks = evidence.iter().map(render_biome_evidence).collect::<Vec<_>>().join("\n");
    // Scene words are the ONLY identity a place has. A human's corrections are
    // filed under them (see ProfileOverrides.biomes) and the map classifier is
    // handed them verbatim, so a word that changes between runs silently drops
    // whatever was pinned to it. Measured across three re-profiles of one
    // unchanged catalog: volcano/volcanic, charnel/abattoir, cavern/cave,
    // foundry/workshop/factory — and a ground correction filed under "volcanic"
    // was dead on arrival when the next run called the same place "volcano".
    let carry = if previous_scenes.is_empty() {
        String::new()
    } else {
        format!(
            "\nThis pack has been profiled before, under these scene words: {}.\n\
             Where a place below is the SAME place one of those named, reuse that exact word. A scene word is a place's only identity: the map classifier is handed these words, and any correction a human has made is filed under them, so renaming a place that hasn't changed throws that work away silently. Only introduce a new word for a place that genuinely has no word above.\n",
            previous_scenes.join(", ")
        )
    };
    format!(
        "You are profiling an imported battle-map art pack so a D&D map generator can use it. Everything below was MEASURED from the actual files — trust the numbers over what a name suggests.\n\n\
         Every category in the pack: {}\n{carry}\n{}\n\
         Reply with ONLY this JSON:\n\
         {{\"universal_biome\": \"<folder>\" | null,\n\
           \"object_categories\": [\"...\"],\n\
           \"terrain_categories\": [\"...\"],\n\
           \"biomes\": [{{\"scene\": \"...\", \"folder\": \"...\", \"floor_query\": \"...\" | null, \"natural_walls\": true|false, \"liquid_query\": \"...\" | null}}]}}\n\n\
         - universal_biome: the one biome whose art suits ANY scene — a generic human-built set. null if the pack has no such collection. It is never demoted for being off-biome, so naming the wrong one quietly poisons every search.\n\
         - object_categories: categories holding discrete, placeable set-dressing a map can put in a single square or two.\n\
         - terrain_categories: categories that are tileable SURFACE or edging art — ground textures, overlays, cliff and path strips. Anything listed here is barred from object slots. Get this wrong and a search for \"bone pile\" returns a tiling bone-dirt FLOOR.\n\
         - One entry per PLACE a fight could happen, not one per folder. \"scene\" is the single word a DM would use for it (\"cave\", \"tavern\", \"desert\"); \"folder\" is which folder above its art comes from. Give SEVERAL entries sharing one folder when that folder holds genuinely different places — a natural cavern and a carved drow city are one folder but different ground, and a place with no word of its own falls back to plain stone and loses the pack entirely. Every \"scene\" must be unique; a repeat is dropped.\n\
         - floor_query: words that select this biome's default ground from its candidate list above. It is matched against filenames, so use a word the files actually contain. Prefer a material with a mean luminance in 70-205: below that the board is dark to read minis on, above it washes out the art placed on top. If NOTHING is in that band, still answer: the darkest of this biome's own materials, or one borrowed from a related biome, beats the built-in dungeon flagstone — which is bright grey masonry, the wrong material for every outdoor and organic place there is. Answer null ONLY when the biome has no ground candidates at all. This is the surface the WHOLE map stands on, so pick walkable ground, never a hazard or a liquid: lava, acid and water belong to the specific cells a map calls out, and a map's text is written before this is chosen, so a hazard here contradicts prose that never mentioned one. Read the EXAMPLE FILENAMES to see what a word really pulls in — the count and luminance beside each candidate already describe everything that word selects, and a word can bridge two different materials (a \"rock\" that reaches both plain rock and lava rock). If the examples name a hazard, that word selects the hazard whatever you would call it: pick a different word. Never end the query with the bare word \"floor\" — it collides with generic brick.\n\
         - natural_walls: true when this biome's walls are living rock or organic mass (caves, canyons), false when they are built masonry (towns, taverns).\n\
         - liquid_query: only when this biome's pools are NOT water and its own files would not be found by searching \"water\". Otherwise null.\n\
         - Include every biome listed above that is a PLACE. Omit any that is a shared library rather than somewhere a fight happens — a folder of spell effects, blast marks, smoke and weather overlays is used ON other maps, and making it a scene would let the classifier send a whole encounter there. Judge that by its categories and filenames, not its name.",
        categories.join(", "),
        blocks
    )
}

/// The layout pass's reply. Tolerant on purpose: a profile that half-parses is
/// worse than one that cleanly falls back to the default.
pub fn parse_layout_reply(json: &str) -> Option<PackLayout> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let strs = |k: &str| {
        v.get(k)
            .and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|s| s.as_str()).map(str::to_string).filter(|s| !s.is_empty()).collect::<Vec<_>>())
            .unwrap_or_default()
    };
    let biome_source = match v.get("biome_source").and_then(|x| x.as_str())? {
        "flat" => BiomeSource::Flat,
        "first_segment" => BiomeSource::FirstSegment,
        "after_anchor" => BiomeSource::AfterAnchor,
        _ => return None,
    };
    let biome_anchors = strs("biome_anchors");
    // An anchored layout with no anchor to find would read every path's first
    // segment instead — silently, and for the whole pack. Refuse it.
    if biome_source == BiomeSource::AfterAnchor && biome_anchors.is_empty() {
        return None;
    }
    let category_folders = strs("category_folders");
    if category_folders.is_empty() {
        return None;
    }
    Some(PackLayout { biome_source, biome_anchors, category_folders })
}

/// Drops "category" folders that are really GROUPING folders, by checking the
/// answer against the paths instead of trusting it.
///
/// A grouping folder — `!Wilderness`, `Drow_Settlement`, `Base_Desert_Settlement`
/// — sits exactly where a category sits and passes every naming heuristic, but
/// the real category is INSIDE it. Since `biome_category_from_rel` takes the
/// first category folder it meets walking down, listing one collapses every
/// tile beneath it into one meaningless category and loses the real one: live,
/// the profiler returned `!Wilderness`, which would have filed all 6,203
/// Woodlands wilderness tiles as "!Wilderness" instead of Flora, Decor and
/// Elevation.
///
/// The signal is structural, not lexical, so it needs no vendor knowledge: a
/// grouping folder nearly always has another category folder beneath it in the
/// same path, and a real category rarely does. Judged on the actual scan, so a
/// pack that genuinely nests two real categories is measured, not assumed.
pub fn prune_grouping_folders(paths: &[String], layout: PackLayout) -> PackLayout {
    let is_cat = |s: &str| layout.category_folders.iter().any(|c| c.eq_ignore_ascii_case(s));
    let (mut seen, mut nested): (HashMap<&str, usize>, HashMap<&str, usize>) = (HashMap::new(), HashMap::new());
    for p in paths {
        let segs: Vec<&str> = p.split('/').collect();
        let end = segs.len().saturating_sub(1); // the filename is not a folder
        for (i, s) in segs[..end].iter().enumerate() {
            if !is_cat(s) {
                continue;
            }
            *seen.entry(s).or_insert(0) += 1;
            if segs[i + 1..end].iter().any(|d| is_cat(d)) {
                *nested.entry(s).or_insert(0) += 1;
            }
        }
    }
    let kept = layout
        .category_folders
        .iter()
        .filter(|c| {
            let n = seen.get(c.as_str()).copied().unwrap_or(0);
            // Unseen folders are harmless and may matter to a pack we only
            // partly scanned — only drop ones the evidence condemns.
            n == 0 || nested.get(c.as_str()).copied().unwrap_or(0) * 2 <= n
        })
        .cloned()
        .collect();
    PackLayout { category_folders: kept, ..layout }
}

/// The semantics pass's reply, folded onto `layout` (which the layout pass
/// already decided). Returns `None` only when the JSON is unusable.
pub fn parse_semantics_reply(json: &str, layout: PackLayout) -> Option<PackProfile> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let strs = |val: Option<&serde_json::Value>| {
        val.and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|s| s.as_str()).map(str::to_string).filter(|s| !s.is_empty()).collect::<Vec<_>>())
            .unwrap_or_default()
    };
    let opt_str = |b: &serde_json::Value, k: &str| b.get(k).and_then(|x| x.as_str()).map(str::to_string).filter(|s| !s.is_empty());
    let mut seen_words: Vec<String> = Vec::new();
    let biomes = v
        .get("biomes")?
        .as_array()?
        .iter()
        .filter_map(|b| {
            let folder = b.get("folder")?.as_str()?.to_string();
            // A scene word claimed twice makes `scene` depend on iteration
            // order — the second claim is simply unreachable, so the resolver
            // would send that scene's art hunt to the wrong folder in silence.
            let scene = b.get("scene")?.as_str()?.to_lowercase();
            if scene.is_empty() || seen_words.contains(&scene) {
                return None;
            }
            // "dungeon" is the built-in look, and it reaches the classifier from
            // `biome_ids` on its own. A profile that also CLAIMS it turns the
            // one scene that needs no art into one that resolves art like any
            // other — a vision call per map to re-derive the floor it already
            // had. Live: the profiler answered `dungeon → !Core_Settlements`
            // with floor "stone", and every dungeon map has paid for it since.
            // `PackProfile::default()` has always omitted it and a test asserts
            // that; nothing enforced the same on a LEARNED profile until here.
            if scene == BUILTIN_SCENE {
                return None;
            }
            seen_words.push(scene.clone());
            Some(BiomeProfile {
                scene,
                folder,
                floor_query: opt_str(b, "floor_query"),
                natural_walls: b.get("natural_walls").and_then(|x| x.as_bool()).unwrap_or(false),
                liquid_query: opt_str(b, "liquid_query"),
            })
        })
        .collect::<Vec<_>>();
    if biomes.is_empty() && layout.biome_source != BiomeSource::Flat {
        return None;
    }
    Some(PackProfile {
        layout,
        universal_biome: v.get("universal_biome").and_then(|x| x.as_str()).map(str::to_string).filter(|s| !s.is_empty()),
        object_categories: strs(v.get("object_categories")),
        terrain_categories: strs(v.get("terrain_categories")),
        biomes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fa() -> PackLayout {
        PackProfile::default().layout
    }

    #[test]
    fn the_default_layout_reads_fa_paths_exactly_as_the_old_hardcoded_rule_did() {
        let l = fa();
        // Biome is the segment after the LAST anchor, not the first — some pack
        // folder names also start with it, and anchoring on the first read
        // "FA_Assets_Webp" itself as the biome for ~3,000 real entries.
        let (b, c) = biome_category_from_rel(Path::new("FA_Assets_Expansion_Webp_v1.12/FA_Assets_Webp/Arctic/Decor/Rocks/Rock_A1_1x1.webp"), &l);
        assert_eq!((b.as_str(), c.as_str()), ("Arctic", "Decor"));
        // Category is walked to at ANY depth, stepping over a named settlement.
        let (b, c) = biome_category_from_rel(Path::new("Core/FA_Assets_Webp/Woodlands/Base_Woodlands_Settlement/Furniture/Tables/T_2x2.webp"), &l);
        assert_eq!((b.as_str(), c.as_str()), ("Woodlands", "Furniture"));
        // Anchors match by prefix, so `FA_Assets` and `FA_Assets_Webp` both work.
        let (b, _) = biome_category_from_rel(Path::new("Mountain_Expansion_Pack_v1.04/FA_Assets/Horror/Decor/X_1x1.webp"), &l);
        assert_eq!(b, "Horror");
    }

    /// The whole point of the rewrite. A pack that doesn't use FA's scheme used
    /// to land its biome and category on whatever the first two segments
    /// happened to be — which is how a stranger's import resolved nothing.
    #[test]
    fn a_non_fa_pack_reads_correctly_once_its_own_layout_is_profiled() {
        let l = PackLayout {
            biome_source: BiomeSource::FirstSegment,
            biome_anchors: vec![],
            category_folders: vec!["props".into(), "ground".into()],
        };
        let (b, c) = biome_category_from_rel(Path::new("Caverns/set_a/props/barrel.png"), &l);
        assert_eq!((b.as_str(), c.as_str()), ("Caverns", "props"));
        // Unrecognised subtree still yields SOMETHING rather than "misc".
        let (b, c) = biome_category_from_rel(Path::new("Caverns/oddments/thing.png"), &l);
        assert_eq!((b.as_str(), c.as_str()), ("Caverns", "oddments"));
    }

    /// A flat pack has no biome dimension, and inventing one would make
    /// `biome_affinity` demote every tile for not belonging to a biome the pack
    /// never had.
    #[test]
    fn a_flat_pack_reports_no_biome_and_still_finds_its_categories() {
        let l = PackLayout { biome_source: BiomeSource::Flat, biome_anchors: vec![], category_folders: vec!["Textures".into()] };
        let (b, c) = biome_category_from_rel(Path::new("Textures/Stone/floor_01.jpg"), &l);
        assert_eq!((b.as_str(), c.as_str()), ("", "Textures"));
    }

    /// An anchored layout must not blank out a path that happens to lack the
    /// anchor — one odd sub-folder shouldn't cost the pack its biome.
    #[test]
    fn an_anchored_layout_falls_back_to_the_first_segment_when_a_path_has_no_anchor() {
        let (b, c) = biome_category_from_rel(Path::new("Desert/Decor/Rocks/R_1x1.webp"), &fa());
        assert_eq!((b.as_str(), c.as_str()), ("Desert", "Decor"));
    }

    #[test]
    fn the_default_profile_answers_the_questions_the_resolver_asks() {
        let p = PackProfile::default();
        assert_eq!(p.folder_for_scene("illithid"), Some("Astral"));
        assert_eq!(p.folder_for_scene("cave"), Some("Underdark"));
        assert_eq!(p.folder_for_scene("tavern"), Some("!Core_Settlements"));
        assert_eq!(p.folder_for_scene("nothing recognisable"), None);
        assert!(p.is_object_category("furniture") && !p.is_object_category("Textures"));
        assert!(p.is_terrain_category("Textures") && !p.is_terrain_category("Decor"));
        assert_eq!(p.scene("illithid").unwrap().liquid_query.as_deref(), Some("ceremorph magical liquid"));
        // Two PLACES sharing one art folder, each with its own ground — the
        // distinction a folder-keyed profile would have collapsed.
        assert_eq!(p.scene("cave").unwrap().floor_query.as_deref(), Some("cave"));
        assert_eq!(p.scene("underdark").unwrap().floor_query.as_deref(), Some("drow stone"));
        assert_eq!(p.scene("cave").unwrap().folder, p.scene("underdark").unwrap().folder);
        // No scene word may be claimed twice, or the second is unreachable.
        let mut words = p.scene_words();
        let n = words.len();
        words.sort_unstable();
        words.dedup();
        assert_eq!(words.len(), n, "duplicate scene word in the default profile");
    }

    #[test]
    fn a_human_correction_survives_reprofiling_and_only_touches_what_it_names() {
        let mut ov = ProfileOverrides::default();
        ov.biomes.insert("illithid".into(), BiomeEdit { floor_query: Some(Some("alien".into())), ..Default::default() });
        // A place profiling never found at all can be added by hand.
        ov.biomes.insert("fey".into(), BiomeEdit { folder: Some("Feywilds".into()), natural_walls: Some(true), ..Default::default() });
        let p = PackProfile::default().with_overrides(&ov);
        let illithid = p.scene("illithid").unwrap();
        assert_eq!(illithid.floor_query.as_deref(), Some("alien"));
        // Untouched fields of an edited place survive.
        assert_eq!(illithid.folder, "Astral");
        assert_eq!(illithid.liquid_query.as_deref(), Some("ceremorph magical liquid"));
        // Correcting one place must not touch its FOLDER-mate.
        assert_eq!(p.scene("alien").unwrap().floor_query.as_deref(), Some("ceremorph"));
        assert_eq!(p.folder_for_scene("fey"), Some("Feywilds"));
        // And an untouched place is entirely unchanged.
        assert_eq!(p.scene("underdark"), PackProfile::default().scene("underdark"));
    }

    #[test]
    fn the_directory_digest_shows_a_packs_shape_without_pasting_the_whole_listing() {
        let paths: Vec<String> = ["Core/FA_Assets_Webp/Astral/Ceremorph_Settlement/Structures/wall.webp", "Core/FA_Assets_Webp/Astral/Ceremorph_Settlement/Decor/eye.webp", "Core/FA_Assets_Webp/Desert/Decor/rock.webp"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let d = directory_digest(&paths);
        assert!(d.starts_with("3 files\n"), "{d}");
        assert!(d.contains("Core/  (3)") && d.contains("Astral/  (2)") && d.contains("Desert/  (1)"), "{d}");
        // Depth-capped, so a deep pack can't blow the prompt out.
        assert!(!d.contains("Structures"), "depth cap not applied:\n{d}");
    }

    #[test]
    fn a_layout_reply_parses_and_refuses_the_shapes_that_would_silently_misread_a_pack() {
        let ok = parse_layout_reply(r#"{"biome_source":"after_anchor","biome_anchors":["FA_Assets"],"category_folders":["Furniture","Textures"]}"#).unwrap();
        assert_eq!(ok.biome_source, BiomeSource::AfterAnchor);
        assert_eq!(ok.category_folders, vec!["Furniture", "Textures"]);
        // Anchored but with nothing to anchor ON would quietly read every
        // path's first segment as the biome, for the entire pack.
        assert!(parse_layout_reply(r#"{"biome_source":"after_anchor","biome_anchors":[],"category_folders":["Furniture"]}"#).is_none());
        // No categories at all means nothing is ever terrain, so ground art
        // becomes eligible for object slots — refuse and keep the default.
        assert!(parse_layout_reply(r#"{"biome_source":"flat","biome_anchors":[],"category_folders":[]}"#).is_none());
        assert!(parse_layout_reply("not json").is_none());
        // A flat pack is a legitimate answer, not a failure.
        assert_eq!(parse_layout_reply(r#"{"biome_source":"flat","biome_anchors":[],"category_folders":["props"]}"#).unwrap().biome_source, BiomeSource::Flat);
    }

    /// Live: the profiler answered `!Wilderness` among the category folders.
    /// It sits where a category sits and reads like one, but the real category
    /// is inside it — taking it would have filed every Woodlands wilderness
    /// tile as "!Wilderness" instead of Flora/Decor/Elevation. The evidence for
    /// dropping it is structural, so no vendor knowledge is needed.
    #[test]
    fn a_grouping_folder_is_pruned_but_a_real_category_survives() {
        let paths: Vec<String> = [
            "P/FA/Woodlands/!Wilderness/Flora/Trees/a.webp",
            "P/FA/Woodlands/!Wilderness/Decor/Rocks/b.webp",
            "P/FA/Desert/!Wilderness/Flora/c.webp",
            "P/FA/Desert/Base_Desert_Settlement/Furniture/Tables/d.webp",
            "P/FA/Desert/Base_Desert_Settlement/Decor/e.webp",
            "P/FA/Mountain/Decor/Rocks/f.webp",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        let layout = PackLayout {
            biome_source: BiomeSource::AfterAnchor,
            biome_anchors: vec!["FA".into()],
            category_folders: vec!["Flora".into(), "Decor".into(), "Furniture".into(), "!Wilderness".into(), "Base_Desert_Settlement".into()],
        };
        let pruned = prune_grouping_folders(&paths, layout).category_folders;
        assert!(!pruned.iter().any(|c| c == "!Wilderness"), "a grouping folder always wrapping a real category must go: {pruned:?}");
        assert!(!pruned.iter().any(|c| c == "Base_Desert_Settlement"), "{pruned:?}");
        // The real categories are untouched, including Decor which appears both
        // inside a grouping folder and directly under a biome.
        for real in ["Flora", "Decor", "Furniture"] {
            assert!(pruned.iter().any(|c| c == real), "{real} must survive: {pruned:?}");
        }
    }

    #[test]
    fn a_semantics_reply_parses_into_a_usable_profile() {
        let json = r#"{"universal_biome":"Common","object_categories":["Props"],"terrain_categories":["Ground"],
          "biomes":[{"scene":"cave","folder":"Caves","floor_query":"limestone","natural_walls":true,"liquid_query":null},
                    {"scene":"underdark","folder":"Caves","floor_query":"cut stone","natural_walls":true,"liquid_query":null},
                    {"scene":"town","folder":"Common","floor_query":null,"natural_walls":false,"liquid_query":null}]}"#;
        let p = parse_semantics_reply(json, fa()).unwrap();
        assert_eq!(p.universal_biome.as_deref(), Some("Common"));
        assert_eq!(p.folder_for_scene("underdark"), Some("Caves"));
        assert!(p.scene("cave").unwrap().natural_walls);
        assert!(p.scene("town").unwrap().floor_query.is_none());
        // Two places, one folder, different ground — the case that motivated
        // keying this by place instead of by art folder.
        assert_eq!(p.scene("cave").unwrap().floor_query.as_deref(), Some("limestone"));
        assert_eq!(p.scene("underdark").unwrap().floor_query.as_deref(), Some("cut stone"));
        assert!(p.is_terrain_category("ground") && p.is_object_category("props"));
    }

    /// A scene word claimed twice makes `scene` depend on iteration order — the
    /// second claim is simply unreachable, so the resolver would send that
    /// scene's art hunt to the wrong folder in silence.
    #[test]
    fn a_scene_word_claimed_twice_is_kept_only_by_the_first_place() {
        let json = r#"{"universal_biome":null,"object_categories":[],"terrain_categories":[],
          "biomes":[{"scene":"cave","folder":"A","natural_walls":true},
                    {"scene":"CAVE","folder":"B","natural_walls":true},
                    {"scene":"tunnel","folder":"B","natural_walls":true}]}"#;
        let p = parse_semantics_reply(json, fa()).unwrap();
        assert_eq!(p.folder_for_scene("cave"), Some("A"));
        assert_eq!(p.scene_words(), vec!["cave", "tunnel"], "the duplicate must be dropped, not left shadowed");
    }

    /// "dungeon" means "no override, no vision call". A profile that claims it
    /// turns the one scene needing no art into one that resolves art like any
    /// other. `PackProfile::default()` has always omitted it and a test in
    /// campaign.rs asserts that — but nothing enforced it on a LEARNED profile,
    /// and the live one duly came back with `dungeon → !Core_Settlements`
    /// (floor "stone"), costing a vision call per dungeon map.
    #[test]
    fn a_learned_profile_may_not_claim_the_builtin_scene() {
        let json = r#"{"universal_biome":"Common","object_categories":[],"terrain_categories":[],
          "biomes":[{"scene":"dungeon","folder":"Common","floor_query":"stone","natural_walls":false},
                    {"scene":"Dungeon","folder":"Other","floor_query":"flagstone","natural_walls":false},
                    {"scene":"crypt","folder":"Common","floor_query":"stone","natural_walls":false}]}"#;
        let p = parse_semantics_reply(json, fa()).unwrap();
        assert!(p.scene(BUILTIN_SCENE).is_none(), "the built-in look must never resolve catalog art");
        assert_eq!(p.scene_words(), vec!["crypt"], "only the real place survives");
    }

    /// A learned profile with no coastal place gains `coast` (sand ground + sea
    /// water); any existing coastal word blocks the seed so it can't duplicate.
    #[test]
    fn ensure_coast_scene_adds_a_coastal_word_only_when_none_exists() {
        let bp = |scene: &str, folder: &str| BiomeProfile {
            scene: scene.into(),
            folder: folder.into(),
            floor_query: None,
            natural_walls: false,
            liquid_query: None,
        };
        let none = PackProfile { biomes: vec![bp("underwater", "Aquatic"), bp("desert", "Desert")], ..Default::default() };
        let seeded = none.ensure_coast_scene();
        let coast = seeded.scene("coast").expect("a profile with no coastal word must gain `coast`");
        assert_eq!(coast.folder, "Desert");
        assert_eq!(coast.floor_query.as_deref(), Some("beach sand"));
        assert_eq!(coast.liquid_query.as_deref(), Some("water"));
        assert!(coast.natural_walls, "a cove's `#` cliffs must read as living sea-rock");

        let has = PackProfile { biomes: vec![bp("seaside", "Aquatic")], ..Default::default() };
        let n = has.biomes.len();
        let after = has.ensure_coast_scene();
        assert_eq!(after.biomes.len(), n, "an existing coastal word must block the seed");
        assert!(after.scene("coast").is_none(), "no bare `coast` added when `seaside` already covers it");
    }

    /// The evidence block is the whole reason profiling works — if it stops
    /// carrying measurements, the profiler is guessing from names again.
    #[test]
    fn the_evidence_block_carries_measurements_not_just_names() {
        let e = BiomeEvidence {
            folder: "Astral".into(),
            tiles: 3235,
            categories: vec![("Structures".into(), 1544)],
            ground: vec![
                GroundCandidate { word: "ceremorph".into(), files: 98, lum_min: 49, lum_max: 78, lum_mean: 62, example: "Ceremorph_Blue_A1.jpg".into() },
                GroundCandidate { word: "alien".into(), files: 27, lum_min: 11, lum_max: 72, lum_mean: 26, example: "Alien_A_01.jpg".into() },
            ],
            sample_objects: vec!["Ceremorph_Support_Column_Blue_A1".into()],
        };
        let s = render_biome_evidence(&e);
        assert!(s.contains("lum 49-78 (mean 62)") && s.contains("lum 11-72 (mean 26)"), "{s}");
        // The naming evidence that made "pillar" vs "column" findable.
        assert!(s.contains("Ceremorph_Support_Column_Blue_A1"), "{s}");
        // And the prompt must actually state the legibility band it's judging against.
        let p = build_semantics_prompt(&[e], &["Structures".into()], &[]);
        assert!(p.contains("70-205") && p.contains("bare word \"floor\""), "the prompt lost its measured guardrails");
    }

    /// Outer None = "not corrected", inner None = "corrected to nothing". A
    /// human must be able to say a biome has no usable ground art and should
    /// keep the built-in floor.
    #[test]
    fn an_override_can_clear_a_ground_query_rather_than_only_replace_it() {
        let mut ov = ProfileOverrides::default();
        ov.biomes.insert("underdark".into(), BiomeEdit { floor_query: Some(None), ..Default::default() });
        let p = PackProfile::default().with_overrides(&ov);
        assert!(p.scene("underdark").unwrap().floor_query.is_none());
        // Round-trips through JSON with that distinction intact.
        let json = serde_json::to_string(&ov).unwrap();
        assert_eq!(serde_json::from_str::<ProfileOverrides>(&json).unwrap(), ov);
    }
}
