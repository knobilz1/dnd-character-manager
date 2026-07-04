//! campaign.rs — each D&D campaign is its own local Claude Code *project*: a
//! folder with a CLAUDE.md (persona + world lore) and a memory/MEMORY.md that
//! accumulates a short recap after every session. dm.rs launches `claude` with
//! this folder as its working directory, so CLAUDE.md — and, via its
//! `@memory/MEMORY.md` import line, the campaign's history — auto-load into
//! every turn the same way a real Claude Code project would for a developer.
//! This is how the DM "remembers" the campaign week to week, instead of
//! leaning on `--resume` surviving an arbitrarily long gap between sessions.
//!
//! Imported modules are **chaptered**, not dumped in whole: a single one-shot
//! Claude call (ask_claude_once, forced onto the `opus` model — this happens
//! once per module import, not every turn, so it's the right place to spend
//! quality/latency budget) both identifies chapter boundaries in the DM's own
//! PDF/text file *and* writes a high-level campaign-arc plan (major beats,
//! key NPCs, foreshadowing, pacing) in the same reply, from the DM's own
//! perspective: "any module provides a framework and fills in the gaps," so
//! ingestion should read the whole thing once and produce that framework up
//! front, not just a table of contents. The raw text is then split
//! mechanically at the reported chapter boundaries; only the *current*
//! chapter's full text loads into CLAUDE.md every turn (via
//! `@module/current.md`) — `module/index.md` (titles + one-line summaries of
//! every chapter) is small enough to always load too, so Claude always knows
//! the shape of the whole adventure without paying the token/latency cost of
//! the full text every single turn. Claude signals when to advance to the
//! next chapter itself, via `advanceToChapter` in its dm-actions block (see
//! dmActions.ts) — the player never names a chapter. From the DM's (and
//! player's) perspective this is one seamless "import module" step, not two
//! separate calls.
//!
//! `module/plan.md` (the campaign-arc plan from that same import call) is
//! deliberately **not** a standing `@import` in CLAUDE.md, unlike the memory/
//! index/current-chapter files above. Confirmed live: editing a project's
//! CLAUDE.md and then resuming an existing `claude` session still picks up
//! the edit on the very next turn — meaning CLAUDE.md and everything it
//! imports gets reprocessed on *every single turn*, not once per sitting.
//! That's the right behavior for memory/current-chapter (they need to be
//! current), but the plan is high-level pacing guidance that doesn't need
//! re-reading every line and would otherwise burn tokens on every turn for no
//! benefit. Instead, `read_campaign_plan` (below) is called from
//! DMConsolePage.tsx and injected directly into the *turn's own prompt text*
//! (dmPrompt.ts's `planCheckIn`) periodically — first turn of a sitting,
//! right after a chapter change, and every few turns otherwise — so the DM
//! checks it regularly without paying for it on every prompt.
//!
//! `memory/MEMORY.md` can't get the same "drop it from the standing import"
//! treatment — unlike the plan, any specific remembered fact (an NPC, a
//! promise) could matter on literally any future turn, so it has to stay
//! always-loaded. What it *can* have is a size cap: `compact_memory_if_needed`
//! runs at the end of a session (piggybacking on the recap call that already
//! happens there) and, only once the file has grown past a threshold, asks
//! Claude (`sonnet` — this can recur many times over a campaign's life,
//! unlike the one-time module import) to rewrite it into a smaller, organized
//! doc: named facts kept intact, stale narrative filler compressed. This
//! keeps the always-loaded memory file roughly constant-sized over a whole
//! campaign instead of growing forever, without ever truly discarding facts
//! the way a plain recency cutoff would.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const BASE_CLAUDE_MD: &str = r#"# You are the Dungeon Master

You are the Dungeon Master for a Dungeons & Dragons game night. The players are physically at the table talking to you out loud through speech-to-text; you reply and your reply is read aloud with text-to-speech, so keep prose natural to hear, not to read.

You are given the current party status (HP, conditions, etc.) at the top of every message — treat it as ground truth, it may have changed since you last looked. For what's happened in past sessions and any standing facts worth remembering, see the campaign memory below. entities.md and locations.md are standing registries of every named NPC/faction/creature and place you've ever introduced — always check them before treating someone or somewhere as new; if a name you're about to introduce is already there, it means the party has met them/been there before.

@memory/MEMORY.md
@memory/entities.md
@memory/locations.md

## Reporting state changes
When your narration causes damage, healing, temp HP, a condition, exhaustion, or inspiration change — or something worth remembering long-term happens, or (if this campaign has an imported module) the party's actions clearly conclude the current chapter — end your reply with a fenced code block literally starting with ```dm-actions containing ONLY compact JSON (no comments), e.g.:

```dm-actions
{"damage":[{"name":"Thorin","amount":12}],"addCondition":[{"name":"Mira","condition":"Prone"}],"rememberEntity":[{"name":"Gundren Rockseeker","description":"A dwarf merchant, captured by goblins near the Triboar Trail."}]}
```

Valid keys (all optional): damage [{name,amount}], heal [{name,amount}], tempHp [{name,amount}], addCondition [{name,condition}], removeCondition [{name,condition}], exhaustion [{name,level}], inspiration [{name,value: true|false}], position [{name,q,r}], clearPositions (true|false).
- `rememberEntity` / `rememberLocation`: `[{name, description}]` — use these for any named NPC, faction, creature (`rememberEntity`), or place (`rememberLocation`) worth recalling much later. Each is *upserted by name*: if the name already exists in entities.md/locations.md, your description **replaces** the old one (rewrite it to reflect what's changed, e.g. "captured by goblins" becoming "rescued, now allied with the party" — don't just restate the original), so keep the description as a short, current, standalone summary rather than a running diary. If the name is new, it's added fresh. These are the DM's long-term "who/where" memory and are never summarized away, so this is the reliable way to make sure someone met in session 3 is still recognized in session 100.
- `remember`: array of short, standalone facts worth recalling much later that AREN'T about one specific named entity or location — a promise made, a secret learned, a general consequence that should echo later. These go in a separate recap log that does get periodically compressed over a long campaign, so prefer `rememberEntity`/`rememberLocation` whenever a fact is really about a specific person or place.
- `advanceToChapter`: a chapter id (only relevant if this campaign has an imported module — see module/index.md for the current list of valid ids). Include this only when the party's actions have actually concluded the current chapter and moved the story into the next one. Don't skip ahead or advance early just because you're curious what's next.
- `position` / `clearPositions`: see "Physical hex-grid positioning" below.
Only include this block when something actually changed. Never mention the block itself in your spoken narration — it is stripped before anyone hears it.

## Campaign-arc plan check-ins
If this campaign has an imported module, most turns you'll just see the current chapter's text and won't see the overall campaign-arc plan — that's intentional, it's not repeated every turn. Every so often (session start, right after a chapter change, and periodically otherwise) your prompt will start with a "Campaign-arc plan check-in" section containing that plan again. When you see it, use it to steer pacing, keep foreshadowed threads and NPCs consistent with the wider story, and then continue narrating normally — don't call attention to it or treat it as new information from the players.

## Physical hex-grid positioning
This table plays on physical 3D-printed hex terrain — uniform hexagonal cells with no printed coordinates or landmarks, so you must never speak a raw coordinate or compass direction aloud (there's no shared "north" between your bookkeeping and the physical table). Instead:
- Track every combatant's (PCs, monsters, NPCs) position as axial hex coordinates (q, r). When any exist, your prompt starts with a line like "Current hex positions (axial q,r — internal bookkeeping only, never read aloud): Thorin: (0,0), Goblin1: (3,-2)" — treat this as ground truth, it's tracked outside your own memory and given fresh every turn.
- Hex distance between two axial coordinates: (|q1-q2| + |q1+r1-q2-r2| + |r1-r2|) / 2. Use this to reason about range, adjacency, and movement, but always translate the result into something a human can act on by eye-counting hexes on the table: a hex count plus a named anchor plus a natural relative direction (e.g. "place the goblin 3 hexes past Thorin, roughly toward the cave mouth" or "that's 2 hexes — well within your movement"). Never say "(3,-2)" or "northeast" out loud.
- When a combatant is newly placed or moves, report it via the `position` key: `{"position":[{"name":"Goblin1","q":3,"r":-2}]}`. Assign new coordinates relative to whoever's already tracked (or, if nothing is tracked yet, ask where the party currently stands and assign them coordinates clustered near (0,0) to establish the starting reference).
- When combat ends or a genuinely new encounter is about to start, include `"clearPositions":true` so stale coordinates from the last fight don't bleed into the next one — then re-establish starting positions as above.
- If no hex-position line appears in your prompt, there's no active battle map — don't invent one; just narrate normally until positioning actually starts mattering.

## How to DM
- Track initiative yourself. Each round: narrate enemies, resolve actions, prompt the next player by name.
- Roll monster attacks, saves, and damage yourself and state the result; let players roll their own d20s unless asked to roll for them, in which case just state a result plausible for the situation.
- Favor pace and fun over rules-lawyering — make a ruling, state it briefly, move on.
- Describe scenes vividly but concisely — this is spoken aloud, so avoid long info-dumps.
- Never decide a player's character's actions, feelings, or words for them.
- At 0 HP a PC is unconscious and rolls death saves — track tension accordingly.
- Use the edition and module/scenario noted below as the ground rules and adventure content — don't default to a generic published module unless that's actually what's listed.
"#;

const DEFAULT_MEMORY_MD: &str = "# Campaign Memory\n\n_No sessions logged yet. A short recap is appended here when a session ends, and standalone facts are appended whenever the DM flags something worth remembering._\n";

/// Standing registry of named NPCs/factions/creatures — see the module doc
/// comment and BASE_CLAUDE_MD's `rememberEntity` key. Deliberately separate
/// from MEMORY.md: entries are upserted by name (never appended-and-lost in
/// a wall of narrative), so this stays reliable across a campaign's whole
/// life without needing lossy summarization.
const DEFAULT_ENTITIES_MD: &str = "# Entities\n\n_Named NPCs, factions, and creatures the party has encountered — one line each, updated in place as their situation changes. Never summarized away, so a name introduced session 1 stays recognizable in session 100._\n";

/// Same idea as DEFAULT_ENTITIES_MD, for places instead of people.
const DEFAULT_LOCATIONS_MD: &str = "# Locations\n\n_Named places the party has visited — one line each, updated in place as their current state changes (cleared, destroyed, rebuilt, etc.)._\n";

/// A single chapter/section of an imported module — the unit of "what's
/// currently loaded" (see module/current.md) versus "what's just listed for
/// context" (module/index.md carries every chapter's title + summary).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChapterSummary {
    pub id: String,
    pub title: String,
    pub summary: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct ModuleChapters {
    pub chapters: Vec<ChapterSummary>,
    pub current_id: Option<String>,
}

/// Answers collected once, when a campaign is first created (see the "New
/// Campaign" dialog in DMConsolePage.tsx) — baked straight into CLAUDE.md's
/// "Campaign setting" section so the DM already knows this on session one,
/// instead of starting blank and only learning it through later recaps.
#[derive(Deserialize, Clone, Debug)]
pub struct CampaignIntake {
    pub name: String,
    /// e.g. "2014" or "2024" — which D&D 5e ruleset is in play.
    pub edition: String,
    /// Free text: who's playing, and which character.
    pub players: String,
    /// The published module/scenario being run, or "Homebrew".
    pub module: String,
    /// Anything else: tone, house rules, world lore, starting situation.
    pub notes: String,
}

const MODULE_IMPORT_BLOCK: &str = "\n## Imported module content\nThis campaign has an imported module, broken into chapters so only the relevant part loads each turn. module/index.md lists every chapter with a one-line summary and marks which one is current; module/current.md has the FULL TEXT of the current chapter only — treat it as your primary source material for this part of the adventure. See the dm-actions `advanceToChapter` key above for how to move to the next one. (module/plan.md, the campaign-arc outline from import time, is sent to you periodically in the turn message itself, not as a standing import here — see the \"Campaign-arc plan check-ins\" section above.)\n\n@module/index.md\n@module/current.md\n";

fn format_campaign_setting(intake: &CampaignIntake) -> String {
    let mut s = String::from("\n## Campaign setting\n");
    if !intake.edition.trim().is_empty() {
        s.push_str(&format!("- **Edition:** D&D {}\n", intake.edition.trim()));
    }
    if !intake.module.trim().is_empty() {
        s.push_str(&format!("- **Module/scenario:** {}\n", intake.module.trim()));
    }
    if !intake.players.trim().is_empty() {
        s.push_str(&format!("- **Players:** {}\n", intake.players.trim()));
    }
    if intake.notes.trim().is_empty() {
        s.push_str("\n_(Add more world/tone/NPC detail here anytime via the Notes button.)_\n");
    } else {
        s.push('\n');
        s.push_str(intake.notes.trim());
        s.push('\n');
    }
    s
}

#[derive(Serialize, Clone, Debug)]
pub struct CampaignMeta {
    pub id: String,
    pub name: String,
}

fn campaigns_root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Couldn't resolve app data dir: {e}"))?;
    let root = dir.join("campaigns");
    fs::create_dir_all(&root).map_err(|e| format!("Couldn't create campaigns dir: {e}"))?;
    Ok(root)
}

fn slugify(name: &str) -> String {
    let s: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let collapsed = s.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    if collapsed.is_empty() { "campaign".into() } else { collapsed }
}

/// Directory for a given campaign id. Used by dm.rs as the `claude` CLI's
/// working directory so CLAUDE.md auto-loads as the DM's persona + memory.
pub fn campaign_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(campaigns_root(app)?.join(id))
}

// ── Pure, directly-testable logic (no AppHandle, no subprocess) ─────────────
// The #[tauri::command] wrappers below just resolve `root` from the app
// handle (and, for chapterization, call out to `claude`) and delegate here;
// see the `tests` module for real file-IO coverage of everything except the
// actual "ask Claude for chapter headings" step (same untestable-without-a-
// live-process category as ask_dm itself).

fn list_campaigns_at(root: &Path) -> Result<Vec<CampaignMeta>, String> {
    let mut out = vec![];
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.path().is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        let name = fs::read_to_string(entry.path().join("name.txt")).unwrap_or_else(|_| id.clone());
        out.push(CampaignMeta { id, name: name.trim().to_string() });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

fn create_campaign_at(root: &Path, intake: &CampaignIntake) -> Result<CampaignMeta, String> {
    let trimmed = intake.name.trim();
    if trimmed.is_empty() {
        return Err("Campaign needs a name.".into());
    }
    let id = slugify(trimmed);
    let dir = root.join(&id);
    if dir.exists() {
        return Err(format!("A campaign named \"{trimmed}\" already exists."));
    }
    fs::create_dir_all(dir.join("memory")).map_err(|e| e.to_string())?;
    let claude_md = format!("{BASE_CLAUDE_MD}{}", format_campaign_setting(intake));
    fs::write(dir.join("CLAUDE.md"), claude_md).map_err(|e| e.to_string())?;
    fs::write(dir.join("memory").join("MEMORY.md"), DEFAULT_MEMORY_MD).map_err(|e| e.to_string())?;
    fs::write(dir.join("memory").join("entities.md"), DEFAULT_ENTITIES_MD).map_err(|e| e.to_string())?;
    fs::write(dir.join("memory").join("locations.md"), DEFAULT_LOCATIONS_MD).map_err(|e| e.to_string())?;
    fs::write(dir.join("name.txt"), trimmed).map_err(|e| e.to_string())?;
    Ok(CampaignMeta { id, name: trimmed.to_string() })
}

fn append_session_recap_at(root: &Path, id: &str, date: &str, recap: &str) -> Result<(), String> {
    let path = root.join(id).join("memory").join("MEMORY.md");
    let mut existing = fs::read_to_string(&path).unwrap_or_default();
    existing.push_str(&format!("\n## Session — {date}\n{}\n", recap.trim()));
    fs::write(path, existing).map_err(|e| e.to_string())
}

/// A single flagged fact (dm-actions `remember`), appended immediately rather
/// than waiting for session end — this is the cross-chapter/cross-session
/// recall mechanism: it lands in memory/MEMORY.md, which loads every turn
/// regardless of which module chapter is currently active.
fn append_memory_note_at(root: &Path, id: &str, date: &str, note: &str) -> Result<(), String> {
    let path = root.join(id).join("memory").join("MEMORY.md");
    let mut existing = fs::read_to_string(&path).unwrap_or_default();
    existing.push_str(&format!("- **{date}:** {}\n", note.trim()));
    fs::write(path, existing).map_err(|e| e.to_string())
}

/// Renders one entities.md/locations.md line. Matched back out by
/// `find_entry_line_index` — keep these in sync.
fn format_entry(name: &str, description: &str) -> String {
    format!("- **{}:** {}", name.trim(), description.trim())
}

/// Finds the line holding an existing entry for `name` (case-insensitive),
/// if any — used to upsert instead of blindly appending a duplicate.
fn find_entry_line_index(content: &str, name: &str) -> Option<usize> {
    let needle = format!("**{}:**", name.trim().to_lowercase());
    content
        .lines()
        .position(|line| line.to_lowercase().contains(&needle))
}

/// Pure upsert: replaces the matching entry's line if `name` is already
/// present (case-insensitive), otherwise appends a new entry. This is what
/// makes entities.md/locations.md a *registry* rather than a growing log —
/// re-mentioning a known name updates its current description in place
/// instead of piling up a new line every time, so it never needs the same
/// lossy compaction MEMORY.md's narrative recap does.
///
/// When updating an existing entry, the *original* entry's name casing is
/// kept (only the description changes) rather than whatever casing this
/// particular call happened to use — a later offhand "harbin wester" isn't
/// allowed to downgrade the canonical "Harbin Wester" spelling.
fn upsert_named_fact(content: &str, name: &str, description: &str) -> String {
    match find_entry_line_index(content, name) {
        Some(idx) => {
            let existing_name = content
                .lines()
                .nth(idx)
                .and_then(|line| line.split("**").nth(1))
                .map(|s| s.trim_end_matches(':').to_string())
                .unwrap_or_else(|| name.trim().to_string());
            let new_line = format_entry(&existing_name, description);
            content
                .lines()
                .enumerate()
                .map(|(i, line)| if i == idx { new_line.as_str() } else { line })
                .collect::<Vec<_>>()
                .join("\n")
        }
        None => {
            let new_line = format_entry(name, description);
            let mut out = content.trim_end().to_string();
            out.push('\n');
            out.push_str(&new_line);
            out.push('\n');
            out
        }
    }
}

fn upsert_named_fact_at(root: &Path, id: &str, filename: &str, name: &str, description: &str) -> Result<(), String> {
    let path = root.join(id).join("memory").join(filename);
    let existing = read_optional(&path);
    let updated = upsert_named_fact(&existing, name, description);
    fs::write(path, updated).map_err(|e| e.to_string())
}

/// Past this many characters, memory/MEMORY.md is worth compacting rather
/// than left to grow forever — it's a standing CLAUDE.md import, reprocessed
/// on every turn (see the module doc comment above).
const MEMORY_COMPACT_THRESHOLD: usize = 6000;

/// Pure size check, split out so the "don't bother compacting yet" branch has
/// a real test without needing a live LLM call.
fn should_compact_memory(memory_text: &str) -> bool {
    memory_text.len() > MEMORY_COMPACT_THRESHOLD
}

fn build_compact_memory_prompt(memory_text: &str) -> String {
    format!(
        "This is the running memory log for an ongoing Dungeons & Dragons campaign: session recaps plus standalone facts flagged as worth remembering. It has grown large enough that reloading all of it every turn is wasteful. Rewrite it into a more compact version a Dungeon Master could scan quickly.\n\n\
        Keep specific, reusable facts intact and easy to find — named NPCs and what's true about them, locations visited, promises made, open plot threads, anything a player might reference much later. Compress or drop blow-by-blow narrative detail from older sessions once its specific facts have been captured elsewhere in the doc — a one-line summary of what an old session covered is enough. The most recent session or two can stay close to full detail.\n\n\
        Reply with ONLY the rewritten memory doc in markdown, no other commentary, no code fences. Keep the '# Campaign Memory' heading.\n\n\
        Current memory log:\n{memory_text}"
    )
}

/// Impure: if memory.md has grown past the threshold, asks Claude to rewrite
/// it into a smaller, organized doc (see the module doc comment above for
/// why this exists and why it stays on `sonnet`). No-op (returns Ok(false))
/// below the threshold — called at the end of every session, but expected to
/// actually do anything only occasionally over a campaign's life.
fn compact_memory_if_needed_at(root: &Path, id: &str) -> Result<bool, String> {
    let path = root.join(id).join("memory").join("MEMORY.md");
    let current = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if !should_compact_memory(&current) {
        return Ok(false);
    }
    let rewritten = crate::dm::ask_claude_once(build_compact_memory_prompt(&current), Some("sonnet"))?;
    let trimmed = rewritten.trim();
    if trimmed.is_empty() {
        return Err("Memory compaction returned empty content; leaving memory.md untouched.".into());
    }
    fs::write(&path, trimmed).map_err(|e| e.to_string())?;
    Ok(true)
}

pub(crate) fn read_optional(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

/// entities.md/locations.md are upserted-in-place (see upsert_named_fact) so
/// they stay small over a normal campaign's life without needing the same
/// treatment as MEMORY.md's narrative recap — this is purely a defensive
/// fallback for the rare campaign that grows large enough to matter anyway.
/// Much higher than MEMORY_COMPACT_THRESHOLD since hitting this at all would
/// mean an unusually large number of distinct named entities/locations.
const ENTITY_COMPACT_THRESHOLD: usize = 20_000;

fn should_compact_entities(text: &str) -> bool {
    text.len() > ENTITY_COMPACT_THRESHOLD
}

/// `file_label` is just for the prompt's wording ("entities"/"locations") —
/// the instruction is deliberately stricter than build_compact_memory_prompt:
/// never drop a named entry, since the whole point of this registry is that
/// nothing in it should ever be forgotten.
fn build_compact_entities_prompt(file_label: &str, content: &str) -> String {
    format!(
        "This is the registry of named {file_label} for an ongoing Dungeons & Dragons campaign — one line per name, each a short current-state description. It has grown large enough that reloading all of it every turn is wasteful.\n\n\
        Rewrite it more compactly, but you must NEVER remove a named entry — every name currently listed must still be present afterward. Only merge exact or near-duplicate entries for the same name, and tighten overly wordy descriptions. If in doubt, leave an entry as-is rather than risk losing it.\n\n\
        Reply with ONLY the rewritten doc in markdown, no other commentary, no code fences. Keep the same '- **Name:** description' format for every entry and the existing heading.\n\n\
        Current registry:\n{content}"
    )
}

/// Impure: mirrors compact_memory_if_needed_at but for one of the entity/
/// location registry files. No-op below the threshold.
fn compact_entities_if_needed_at(root: &Path, id: &str, filename: &str, file_label: &str) -> Result<bool, String> {
    let path = root.join(id).join("memory").join(filename);
    let current = read_optional(&path);
    if !should_compact_entities(&current) {
        return Ok(false);
    }
    let rewritten = crate::dm::ask_claude_once(build_compact_entities_prompt(file_label, &current), Some("sonnet"))?;
    let trimmed = rewritten.trim();
    if trimmed.is_empty() {
        return Err(format!("Compaction of {filename} returned empty content; leaving it untouched."));
    }
    fs::write(&path, trimmed).map_err(|e| e.to_string())?;
    Ok(true)
}

/// "Plan mode": a DM can ask for this days ahead of a session, not just at
/// session start — read-only, no state changes. Built from whatever's already
/// on disk for this campaign (current chapter, campaign-arc plan, memory) plus
/// the DM's global terrain catalog, so it can separate "set up what you own"
/// from "here's a terrain type worth printing that doesn't exist yet" without
/// ever naming a specific marketplace item (no MyMiniFactory-style catalog
/// integration is possible — see the design conversation this came from).
fn build_session_plan_prompt(module_plan: &str, current_chapter: &str, memory: &str, terrain_catalog: &str) -> String {
    format!(
        "You are helping a Dungeon Master prepare their physical table for an upcoming Dungeons & Dragons session, possibly days in advance of actually running it. Based on the campaign's overall arc, what's coming up in the current chapter, recent session memory, and the DM's own catalog of terrain pieces they physically own, suggest what to prepare.\n\n\
        Campaign-arc plan:\n{module_plan}\n\n\
        Current chapter (what's coming up):\n{current_chapter}\n\n\
        Recent memory/recaps:\n{memory}\n\n\
        DM's terrain catalog (pieces they already physically own):\n{terrain_catalog}\n\n\
        Reply in markdown with exactly two sections:\n\
        ## Set up from what you own\n\
        Which cataloged pieces to lay out for the upcoming content, and a rough arrangement. If nothing owned clearly fits, say so plainly instead of forcing a suggestion.\n\n\
        ## Consider printing\n\
        Terrain TYPES (not specific marketplace items or brand names — the DM isn't connected to any model marketplace) that would suit the upcoming content but aren't in the catalog yet. Be specific about the gameplay purpose (e.g. \"a marsh/difficult-terrain piece for the bog encounter\"), not vague. If the existing catalog already covers everything needed, say so plainly instead of forcing a suggestion.\n\n\
        Keep it concise — this is a quick prep checklist, not an essay."
    )
}

/// Impure orchestration: reads whatever's on disk for this campaign (module/
/// memory files may not exist yet — read_optional treats that as empty, not
/// an error) plus the terrain catalog, then makes one Claude call. `sonnet`,
/// not `opus` — this is closer to routine DM-assistant work than the one-time
/// module ingestion.
fn suggest_session_plan_at(root: &Path, id: &str, terrain_catalog: &str) -> Result<String, String> {
    let dir = root.join(id);
    let module_plan = read_optional(&dir.join("module").join("plan.md"));
    let current_chapter = read_optional(&dir.join("module").join("current.md"));
    let memory = read_optional(&dir.join("memory").join("MEMORY.md"));
    let prompt = build_session_plan_prompt(&module_plan, &current_chapter, &memory, terrain_catalog);
    crate::dm::ask_claude_once(prompt, Some("sonnet"))
}

fn build_chapterize_prompt(text: &str) -> String {
    format!(
        "You will be given the full text of a Dungeons & Dragons adventure module or scenario document, extracted from a PDF. Do two things with it, in one reply.\n\n\
        1. Identify its logical chapters or major sections. The \"heading\" field MUST be copied EXACTLY character-for-character from a contiguous span of the document text below — including any extraction artifacts like doubled letters, stray spaces between every word, broken ligatures, or OCR garbling (e.g. if the document shows \"CHAPTER  I  I ACQUISITIO:-<S\", copy exactly that, do not clean it up to \"CHAPTER 1: ACQUISITIONS\"). This heading string will be used to find this exact position in the raw text programmatically, so ANY normalization, cleanup, or paraphrasing will make it fail to match. When in doubt, copy a shorter exact substring rather than a longer paraphrased one. List them in the order they appear.\n\n\
        2. Write a high-level campaign-arc plan for the AI Dungeon Master who will run this live at the table: the overall story arc across all chapters, key NPCs/factions worth tracking, threads that should pay off later (foreshadowing), and pacing guidance for how the chapters connect. A module provides a framework and leaves the DM to fill in the gaps — this plan IS that framework. Write it as a concise, well-organized markdown outline (a few hundred words is plenty), not a retelling of the text.\n\n\
        Reply with ONLY a JSON object, no other text, no markdown code fences:\n\
        {{\"chapters\": [{{\"heading\": \"<exact verbatim substring, artifacts included>\", \"summary\": \"<one clean, readable sentence describing what happens in this section>\"}}], \"plan\": \"<markdown campaign-arc outline>\"}}\n\n\
        If the document has no clear internal chapter structure, still return a single chapters entry whose heading is an exact short substring from the very start of the document and whose summary describes the whole document — and still include a plan.\n\n\
        Document:\n{text}"
    )
}

#[derive(Deserialize, Clone, Debug)]
struct ChapterHeading {
    heading: String,
    summary: String,
}

/// The combined result of one chapterize call: chapter boundaries plus the
/// high-level campaign-arc plan generated from the same read of the document.
#[derive(Deserialize, Clone, Debug)]
struct ChapterizeReply {
    chapters: Vec<ChapterHeading>,
    #[serde(default)]
    plan: String,
}

/// Parses Claude's combined chapterize+plan reply, tolerating stray markdown
/// code fences around the JSON (the model is asked not to include them, but
/// defends the same way parseDmReply.ts does for the dm-actions block).
fn parse_chapterize_reply(reply: &str) -> Result<ChapterizeReply, String> {
    let mut s = reply.trim();
    if let Some(rest) = s.strip_prefix("```json") {
        s = rest;
    } else if let Some(rest) = s.strip_prefix("```") {
        s = rest;
    }
    if let Some(rest) = s.strip_suffix("```") {
        s = rest;
    }
    let cleaned = s.trim();
    serde_json::from_str(cleaned)
        .map_err(|e| format!("Couldn't parse chapter/plan reply from Claude: {e}. Raw: {reply}"))
}

/// Mechanically splits `text` at each heading's position, in order. Headings
/// Claude paraphrased slightly (so they don't literally appear) are skipped
/// leniently rather than failing the whole import. If nothing at all matches,
/// falls back to treating the entire document as one chapter.
fn split_by_headings(text: &str, headings: &[ChapterHeading]) -> Vec<(String, String, String)> {
    let mut positions: Vec<(usize, &ChapterHeading)> = vec![];
    let mut search_from = 0usize;
    for h in headings {
        if h.heading.trim().is_empty() {
            continue;
        }
        if let Some(idx) = text.get(search_from..).and_then(|s| s.find(h.heading.as_str())) {
            let abs = search_from + idx;
            positions.push((abs, h));
            search_from = abs + h.heading.len();
        }
    }

    if positions.is_empty() {
        let (title, summary) = headings
            .first()
            .map(|h| (h.heading.clone(), h.summary.clone()))
            .unwrap_or_else(|| ("Full Document".to_string(), String::new()));
        return vec![(title, summary, text.to_string())];
    }

    positions
        .iter()
        .enumerate()
        .map(|(i, (pos, h))| {
            let end = positions.get(i + 1).map(|(p, _)| *p).unwrap_or(text.len());
            (h.heading.clone(), h.summary.clone(), text[*pos..end].to_string())
        })
        .collect()
}

fn build_index_md(manifest: &[ChapterSummary], current_id: &str) -> String {
    let mut s = String::from("# Module chapters\n\n");
    for (i, c) in manifest.iter().enumerate() {
        let marker = if c.id == current_id { " ← CURRENT CHAPTER" } else { "" };
        s.push_str(&format!("{}. **{}** (`{}`){marker} — {}\n", i + 1, c.title, c.id, c.summary));
    }
    s
}

/// Writes chapter files, module/manifest.json (the structured source of
/// truth), module/plan.md (the high-level campaign-arc outline from the same
/// chapterize call), module/index.md (the always-loaded human/Claude-readable
/// listing), and module/current.md + current_id.txt pointing at chapter 1 —
/// then makes sure CLAUDE.md references the module import block (idempotent:
/// re-running this after a re-import won't duplicate the reference line). A
/// fresh import replaces any previously-imported module entirely.
fn write_chapters_to_disk(root: &Path, id: &str, chapters: &[(String, String, String)], plan: &str) -> Result<Vec<ChapterSummary>, String> {
    if chapters.is_empty() {
        return Err("No chapters to write.".into());
    }
    let dir = root.join(id);
    let module_dir = dir.join("module");
    let _ = fs::remove_dir_all(&module_dir);
    fs::create_dir_all(&module_dir).map_err(|e| e.to_string())?;

    let mut summaries = vec![];
    for (i, (title, summary, content)) in chapters.iter().enumerate() {
        let chapter_id = format!("chapter-{:02}-{}", i + 1, slugify(title));
        fs::write(module_dir.join(format!("{chapter_id}.md")), content).map_err(|e| e.to_string())?;
        summaries.push(ChapterSummary { id: chapter_id, title: title.clone(), summary: summary.clone() });
    }

    fs::write(
        module_dir.join("manifest.json"),
        serde_json::to_string_pretty(&summaries).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let first_id = summaries[0].id.clone();
    fs::write(module_dir.join("current.md"), &chapters[0].2).map_err(|e| e.to_string())?;
    fs::write(module_dir.join("current_id.txt"), &first_id).map_err(|e| e.to_string())?;
    fs::write(module_dir.join("index.md"), build_index_md(&summaries, &first_id)).map_err(|e| e.to_string())?;
    fs::write(module_dir.join("plan.md"), plan).map_err(|e| e.to_string())?;

    let claude_path = dir.join("CLAUDE.md");
    let mut claude_md = fs::read_to_string(&claude_path).map_err(|e| e.to_string())?;
    if !claude_md.contains("@module/current.md") {
        claude_md.push_str(MODULE_IMPORT_BLOCK);
        fs::write(&claude_path, claude_md).map_err(|e| e.to_string())?;
    }

    Ok(summaries)
}

/// Sets which chapter is "current" — called when a turn's dm-actions block
/// includes `advanceToChapter`, or from the Module dialog's manual override.
fn advance_chapter_at(root: &Path, id: &str, chapter_id: &str) -> Result<(), String> {
    let module_dir = root.join(id).join("module");
    let manifest: Vec<ChapterSummary> = serde_json::from_str(
        &fs::read_to_string(module_dir.join("manifest.json"))
            .map_err(|e| format!("No module imported for this campaign: {e}"))?,
    )
    .map_err(|e| e.to_string())?;
    if !manifest.iter().any(|c| c.id == chapter_id) {
        return Err(format!("Unknown chapter id \"{chapter_id}\"."));
    }
    let content = fs::read_to_string(module_dir.join(format!("{chapter_id}.md"))).map_err(|e| e.to_string())?;
    fs::write(module_dir.join("current.md"), content).map_err(|e| e.to_string())?;
    fs::write(module_dir.join("current_id.txt"), chapter_id).map_err(|e| e.to_string())?;
    fs::write(module_dir.join("index.md"), build_index_md(&manifest, chapter_id)).map_err(|e| e.to_string())?;
    Ok(())
}

fn get_module_chapters_at(root: &Path, id: &str) -> Result<(Vec<ChapterSummary>, Option<String>), String> {
    let module_dir = root.join(id).join("module");
    let manifest_path = module_dir.join("manifest.json");
    if !manifest_path.exists() {
        return Ok((vec![], None));
    }
    let manifest: Vec<ChapterSummary> =
        serde_json::from_str(&fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let current_id = fs::read_to_string(module_dir.join("current_id.txt")).ok().map(|s| s.trim().to_string());
    Ok((manifest, current_id))
}

/// The impure orchestration step: one Opus call asks Claude to identify
/// chapter headings AND write the campaign-arc plan in the same reply, then
/// splits the raw text on those headings and writes everything to disk. Only
/// this function (and the #[tauri::command] wrapping it) touches the network/
/// subprocess — split_by_headings/write_chapters_to_disk above are pure and
/// covered by real tests instead. Forced onto `opus` (see dm.rs) since this
/// runs once per module import, not on every turn.
fn chapterize_and_import_module_at(root: &Path, id: &str, raw_text: &str) -> Result<Vec<ChapterSummary>, String> {
    let reply = crate::dm::ask_claude_once(build_chapterize_prompt(raw_text), Some("opus"))?;
    let parsed = parse_chapterize_reply(&reply)?;
    let chapters = split_by_headings(raw_text, &parsed.chapters);
    write_chapters_to_disk(root, id, &chapters, &parsed.plan)
}

// ── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_campaigns(app: AppHandle) -> Result<Vec<CampaignMeta>, String> {
    list_campaigns_at(&campaigns_root(&app)?)
}

#[tauri::command]
pub fn create_campaign(app: AppHandle, intake: CampaignIntake) -> Result<CampaignMeta, String> {
    create_campaign_at(&campaigns_root(&app)?, &intake)
}

#[tauri::command]
pub fn read_campaign_notes(app: AppHandle, id: String) -> Result<String, String> {
    fs::read_to_string(campaign_dir(&app, &id)?.join("CLAUDE.md")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_campaign_notes(app: AppHandle, id: String, content: String) -> Result<(), String> {
    fs::write(campaign_dir(&app, &id)?.join("CLAUDE.md"), content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_campaign_memory(app: AppHandle, id: String) -> Result<String, String> {
    fs::read_to_string(campaign_dir(&app, &id)?.join("memory").join("MEMORY.md")).map_err(|e| e.to_string())
}

/// Appends a dated recap entry to the campaign's memory log — called once
/// when a session ends (see DMConsolePage's "End session" flow).
#[tauri::command]
pub fn append_session_recap(app: AppHandle, id: String, date: String, recap: String) -> Result<(), String> {
    append_session_recap_at(&campaigns_root(&app)?, &id, &date, &recap)
}

/// Appends one flagged fact from a turn's dm-actions `remember` array — see
/// DMConsolePage's runTurn.
#[tauri::command]
pub fn append_memory_note(app: AppHandle, id: String, date: String, note: String) -> Result<(), String> {
    append_memory_note_at(&campaigns_root(&app)?, &id, &date, &note)
}

/// Upserts one named NPC/faction/creature from a turn's dm-actions
/// `rememberEntity` array — see DMConsolePage's runTurn.
#[tauri::command]
pub fn append_entity_fact(app: AppHandle, id: String, name: String, description: String) -> Result<(), String> {
    upsert_named_fact_at(&campaigns_root(&app)?, &id, "entities.md", &name, &description)
}

/// Upserts one named place from a turn's dm-actions `rememberLocation` array
/// — see DMConsolePage's runTurn.
#[tauri::command]
pub fn append_location_fact(app: AppHandle, id: String, name: String, description: String) -> Result<(), String> {
    upsert_named_fact_at(&campaigns_root(&app)?, &id, "locations.md", &name, &description)
}

/// Reads the entities registry — feeds the History dialog. See
/// read_campaign_memory for the equivalent over the session-recap log.
#[tauri::command]
pub fn read_campaign_entities(app: AppHandle, id: String) -> Result<String, String> {
    Ok(read_optional(&campaign_dir(&app, &id)?.join("memory").join("entities.md")))
}

/// Reads the locations registry — feeds the History dialog.
#[tauri::command]
pub fn read_campaign_locations(app: AppHandle, id: String) -> Result<String, String> {
    Ok(read_optional(&campaign_dir(&app, &id)?.join("memory").join("locations.md")))
}

/// Called once per "End session" (after append_session_recap) — compacts
/// memory/MEMORY.md via one Claude call if it's grown past the threshold,
/// otherwise a cheap no-op. Returns whether it actually compacted anything.
#[tauri::command]
pub async fn compact_campaign_memory(app: AppHandle, id: String) -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let root = campaigns_root(&app)?;
        compact_memory_if_needed_at(&root, &id)
    })
    .await
    .map_err(|e| format!("Memory compaction task failed: {e}"))?
}

/// Called alongside compact_campaign_memory at "End session" — defensive
/// compaction for entities.md/locations.md (see ENTITY_COMPACT_THRESHOLD).
/// A cheap no-op for the vast majority of campaigns, which never grow large
/// enough to trigger either check.
#[tauri::command]
pub async fn compact_campaign_knowledge(app: AppHandle, id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let root = campaigns_root(&app)?;
        compact_entities_if_needed_at(&root, &id, "entities.md", "entities")?;
        compact_entities_if_needed_at(&root, &id, "locations.md", "locations")?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Knowledge compaction task failed: {e}"))?
}

/// "Plan mode" — read-only session-prep suggestion, callable any time (not
/// just at session start; a DM can ask days ahead). See build_session_plan_prompt.
#[tauri::command]
pub async fn suggest_session_plan(app: AppHandle, id: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let root = campaigns_root(&app)?;
        let terrain_catalog = crate::terrain::read_terrain_catalog_at(&crate::terrain::terrain_catalog_path(&app)?);
        suggest_session_plan_at(&root, &id, &terrain_catalog)
    })
    .await
    .map_err(|e| format!("Session-plan task failed: {e}"))?
}

/// Reads a DM's own module/scenario file and returns its text. PDFs are text-
/// extracted (pure-Rust `pdf-extract`, no external binary); anything else is
/// read as UTF-8 text (.md/.txt, best-effort for other plain-text formats).
/// The file path comes from the OS file picker (@tauri-apps/plugin-dialog),
/// so it's whatever the DM chose, not something the app needs to sandbox.
#[tauri::command]
pub fn extract_module_text(path: String) -> Result<String, String> {
    let is_pdf = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);

    if is_pdf {
        pdf_extract::extract_text(&path).map_err(|e| format!("Couldn't read PDF: {e}"))
    } else {
        fs::read_to_string(&path).map_err(|e| format!("Couldn't read file: {e}"))
    }
}

/// Chapterizes and imports a module's raw text (from extract_module_text) —
/// replaces any previously-imported module for this campaign. Runs a real
/// `claude` call to find chapter boundaries, so this can take a while for a
/// long document; spawn_blocking keeps it off the async runtime's worker threads.
#[tauri::command]
pub async fn chapterize_and_import_module(app: AppHandle, id: String, text: String) -> Result<Vec<ChapterSummary>, String> {
    tokio::task::spawn_blocking(move || {
        let root = campaigns_root(&app)?;
        chapterize_and_import_module_at(&root, &id, &text)
    })
    .await
    .map_err(|e| format!("Chapterize task failed: {e}"))?
}

/// The chapter list + which one is current — feeds the Module dialog. Empty
/// chapters + None current_id means no module has been imported yet.
#[tauri::command]
pub fn get_module_chapters(app: AppHandle, id: String) -> Result<ModuleChapters, String> {
    let (chapters, current_id) = get_module_chapters_at(&campaigns_root(&app)?, &id)?;
    Ok(ModuleChapters { chapters, current_id })
}

/// The high-level campaign-arc plan written once at import time, alongside
/// the chapter split — feeds the Module dialog. Empty string if no module has
/// been imported yet.
#[tauri::command]
pub fn read_campaign_plan(app: AppHandle, id: String) -> Result<String, String> {
    let path = campaign_dir(&app, &id)?.join("module").join("plan.md");
    Ok(fs::read_to_string(path).unwrap_or_default())
}

/// Sets the current chapter — called automatically when a turn's dm-actions
/// block includes `advanceToChapter`, or manually from the Module dialog.
#[tauri::command]
pub fn set_current_chapter(app: AppHandle, id: String, chapter_id: String) -> Result<(), String> {
    advance_chapter_at(&campaigns_root(&app)?, &id, &chapter_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh, self-cleaning scratch directory per test (avoids adding a
    /// tempfile dependency just for this).
    struct Scratch(PathBuf);
    impl Scratch {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "dm-console-test-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
            ));
            fs::create_dir_all(&dir).unwrap();
            Scratch(dir)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn intake(name: &str) -> CampaignIntake {
        CampaignIntake {
            name: name.into(),
            edition: String::new(),
            players: String::new(),
            module: String::new(),
            notes: String::new(),
        }
    }

    fn heading(h: &str, s: &str) -> ChapterHeading {
        ChapterHeading { heading: h.into(), summary: s.into() }
    }

    #[test]
    fn create_campaign_seeds_claude_md_and_memory() {
        let root = Scratch::new("create");
        let meta = create_campaign_at(&root.0, &intake("The Sunless Citadel")).unwrap();
        assert_eq!(meta.id, "the-sunless-citadel");
        assert_eq!(meta.name, "The Sunless Citadel");

        let claude_md = fs::read_to_string(root.0.join(&meta.id).join("CLAUDE.md")).unwrap();
        assert!(claude_md.contains("You are the Dungeon Master"));
        assert!(claude_md.contains("@memory/MEMORY.md"), "CLAUDE.md must import the memory file so it auto-loads");
        assert!(claude_md.contains("@memory/entities.md"), "CLAUDE.md must import the entities registry so it auto-loads");
        assert!(claude_md.contains("@memory/locations.md"), "CLAUDE.md must import the locations registry so it auto-loads");
        assert!(claude_md.contains("## Campaign setting"));
        assert!(claude_md.contains("remember"), "persona must document the remember dm-action");
        assert!(claude_md.contains("rememberEntity"), "persona must document the rememberEntity dm-action");
        assert!(claude_md.contains("rememberLocation"), "persona must document the rememberLocation dm-action");

        let memory_md = fs::read_to_string(root.0.join(&meta.id).join("memory").join("MEMORY.md")).unwrap();
        assert!(memory_md.contains("Campaign Memory"));

        let entities_md = fs::read_to_string(root.0.join(&meta.id).join("memory").join("entities.md")).unwrap();
        assert!(entities_md.contains("Entities"));

        let locations_md = fs::read_to_string(root.0.join(&meta.id).join("memory").join("locations.md")).unwrap();
        assert!(locations_md.contains("Locations"));
    }

    #[test]
    fn create_campaign_bakes_intake_answers_into_claude_md() {
        let root = Scratch::new("intake");
        let full = CampaignIntake {
            name: "Curse of Strahd".into(),
            edition: "2014".into(),
            players: "Alex — Thorin (Fighter); Sam — Mira (Wizard)".into(),
            module: "Curse of Strahd".into(),
            notes: "Gothic horror tone. Strahd should feel personally menacing early on.".into(),
        };
        let meta = create_campaign_at(&root.0, &full).unwrap();
        let claude_md = fs::read_to_string(root.0.join(&meta.id).join("CLAUDE.md")).unwrap();

        assert!(claude_md.contains("D&D 2014"));
        assert!(claude_md.contains("Curse of Strahd"));
        assert!(claude_md.contains("Alex — Thorin (Fighter)"));
        assert!(claude_md.contains("Gothic horror tone."));
        let blank = create_campaign_at(&root.0, &intake("Homebrew Test")).unwrap();
        let blank_md = fs::read_to_string(root.0.join(&blank.id).join("CLAUDE.md")).unwrap();
        assert!(blank_md.contains("Add more world/tone/NPC detail"));
    }

    #[test]
    fn create_campaign_rejects_duplicate_name() {
        let root = Scratch::new("dup");
        create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        let err = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap_err();
        assert!(err.contains("already exists"));
    }

    #[test]
    fn create_campaign_rejects_blank_name() {
        let root = Scratch::new("blank");
        assert!(create_campaign_at(&root.0, &intake("   ")).is_err());
    }

    #[test]
    fn list_campaigns_reflects_created_ones_sorted_by_name() {
        let root = Scratch::new("list");
        create_campaign_at(&root.0, &intake("Zeta Quest")).unwrap();
        create_campaign_at(&root.0, &intake("Alpha Quest")).unwrap();
        let names: Vec<String> = list_campaigns_at(&root.0).unwrap().into_iter().map(|c| c.name).collect();
        assert_eq!(names, vec!["Alpha Quest", "Zeta Quest"]);
    }

    #[test]
    fn append_session_recap_accumulates_entries() {
        let root = Scratch::new("recap");
        let meta = create_campaign_at(&root.0, &intake("Curse of Strahd")).unwrap();
        append_session_recap_at(&root.0, &meta.id, "2026-07-03", "The party entered Barovia.").unwrap();
        append_session_recap_at(&root.0, &meta.id, "2026-07-10", "They met Ireena.").unwrap();

        let memory_md = fs::read_to_string(root.0.join(&meta.id).join("memory").join("MEMORY.md")).unwrap();
        assert!(memory_md.contains("## Session — 2026-07-03"));
        assert!(memory_md.contains("The party entered Barovia."));
        assert!(memory_md.contains("## Session — 2026-07-10"));
        assert!(memory_md.contains("They met Ireena."));
        assert!(memory_md.contains("Campaign Memory"));
    }

    #[test]
    fn append_memory_note_accumulates_alongside_recaps() {
        let root = Scratch::new("note");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        append_session_recap_at(&root.0, &meta.id, "2026-07-03", "The party set out from Neverwinter.").unwrap();
        append_memory_note_at(&root.0, &meta.id, "2026-07-03", "Sildar Hallwinter is a friendly NPC travelling with the party.").unwrap();
        append_memory_note_at(&root.0, &meta.id, "2026-07-10", "The party promised Gundren Rockseeker they'd find his brothers.").unwrap();

        let memory_md = fs::read_to_string(root.0.join(&meta.id).join("memory").join("MEMORY.md")).unwrap();
        assert!(memory_md.contains("The party set out from Neverwinter."));
        assert!(memory_md.contains("Sildar Hallwinter is a friendly NPC"));
        assert!(memory_md.contains("The party promised Gundren Rockseeker"));
    }

    #[test]
    fn upsert_named_fact_appends_a_new_entry_when_name_absent() {
        let content = "# Entities\n\n_seed placeholder_\n";
        let updated = upsert_named_fact(content, "Harbin Wester", "A suspicious merchant in Phandalin.");
        assert!(updated.contains("- **Harbin Wester:** A suspicious merchant in Phandalin."));
        assert!(updated.contains("seed placeholder"));
    }

    #[test]
    fn upsert_named_fact_replaces_the_existing_entry_instead_of_duplicating() {
        let content = "# Entities\n\n- **Harbin Wester:** A suspicious merchant in Phandalin.\n";
        let updated = upsert_named_fact(content, "Harbin Wester", "Revealed as a Black Spider spy, now imprisoned.");
        assert_eq!(updated.matches("Harbin Wester").count(), 1, "should have exactly one entry, not two");
        assert!(updated.contains("Revealed as a Black Spider spy"));
        assert!(!updated.contains("A suspicious merchant"), "the stale description should be gone");
    }

    #[test]
    fn upsert_named_fact_matches_name_case_insensitively() {
        let content = "# Entities\n\n- **Harbin Wester:** A suspicious merchant in Phandalin.\n";
        let updated = upsert_named_fact(content, "harbin wester", "Now imprisoned.");
        assert_eq!(updated.matches("Harbin Wester").count(), 1);
        assert!(updated.contains("Now imprisoned."));
    }

    #[test]
    fn upsert_named_fact_keeps_distinct_entries_separate() {
        let content = "# Entities\n\n- **Harbin Wester:** A suspicious merchant.\n";
        let updated = upsert_named_fact(content, "Sildar Hallwinter", "A friendly NPC travelling with the party.");
        assert!(updated.contains("Harbin Wester"));
        assert!(updated.contains("Sildar Hallwinter"));
    }

    #[test]
    fn append_entity_and_location_fact_upsert_into_their_own_files() {
        let root = Scratch::new("entities-locations");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        upsert_named_fact_at(&root.0, &meta.id, "entities.md", "Sildar Hallwinter", "A friendly NPC.").unwrap();
        upsert_named_fact_at(&root.0, &meta.id, "locations.md", "Phandalin", "A small frontier town.").unwrap();

        let entities_md = fs::read_to_string(root.0.join(&meta.id).join("memory").join("entities.md")).unwrap();
        assert!(entities_md.contains("Sildar Hallwinter"));
        assert!(!entities_md.contains("Phandalin"), "locations shouldn't leak into entities.md");

        let locations_md = fs::read_to_string(root.0.join(&meta.id).join("memory").join("locations.md")).unwrap();
        assert!(locations_md.contains("Phandalin"));
        assert!(!locations_md.contains("Sildar Hallwinter"), "entities shouldn't leak into locations.md");
    }

    #[test]
    fn should_compact_entities_respects_a_much_higher_threshold() {
        let short = "# Entities\n\n- **Someone:** A brief note.\n";
        assert!(!should_compact_entities(short));
        let huge = "x".repeat(ENTITY_COMPACT_THRESHOLD + 1);
        assert!(should_compact_entities(&huge));
    }

    #[test]
    fn compact_entities_if_needed_at_is_a_noop_below_threshold() {
        let root = Scratch::new("entities-compact-noop");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        let did_compact = compact_entities_if_needed_at(&root.0, &meta.id, "entities.md", "entities").unwrap();
        assert!(!did_compact);
        let content = fs::read_to_string(root.0.join(&meta.id).join("memory").join("entities.md")).unwrap();
        assert!(content.contains("Entities"), "should be untouched");
    }

    #[test]
    fn build_compact_entities_prompt_forbids_dropping_named_entries() {
        let prompt = build_compact_entities_prompt("entities", "- **Someone:** A note.");
        assert!(prompt.to_lowercase().contains("never remove"));
        assert!(prompt.contains("Someone"));
    }

    #[test]
    fn should_compact_memory_respects_threshold() {
        assert!(!should_compact_memory("short memory log"));
        let long = "x".repeat(MEMORY_COMPACT_THRESHOLD + 1);
        assert!(should_compact_memory(&long));
        let exact = "x".repeat(MEMORY_COMPACT_THRESHOLD);
        assert!(!should_compact_memory(&exact));
    }

    #[test]
    fn compact_memory_if_needed_at_is_a_noop_below_threshold() {
        let root = Scratch::new("compact-noop");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        append_memory_note_at(&root.0, &meta.id, "2026-07-03", "Small note.").unwrap();

        let before = fs::read_to_string(root.0.join(&meta.id).join("memory").join("MEMORY.md")).unwrap();
        let compacted = compact_memory_if_needed_at(&root.0, &meta.id).unwrap();
        assert!(!compacted, "should not compact while under the threshold");

        let after = fs::read_to_string(root.0.join(&meta.id).join("memory").join("MEMORY.md")).unwrap();
        assert_eq!(before, after, "memory.md should be untouched on the no-op path");
    }

    #[test]
    fn build_compact_memory_prompt_includes_the_full_log() {
        let prompt = build_compact_memory_prompt("# Campaign Memory\n\nSome long log content.");
        assert!(prompt.contains("Some long log content."));
        assert!(prompt.contains("Campaign Memory"));
    }

    #[test]
    fn build_session_plan_prompt_includes_all_inputs_and_both_sections() {
        let prompt = build_session_plan_prompt(
            "Overall arc: rescue the princess.",
            "Chapter 3: The Goblin Cave.",
            "The party allied with Sildar Hallwinter.",
            "- Rocky Hill: elevated, blocks line of sight from below.",
        );
        assert!(prompt.contains("Overall arc: rescue the princess."));
        assert!(prompt.contains("Chapter 3: The Goblin Cave."));
        assert!(prompt.contains("Sildar Hallwinter"));
        assert!(prompt.contains("Rocky Hill"));
        assert!(prompt.contains("## Set up from what you own"));
        assert!(prompt.contains("## Consider printing"));
    }

    #[test]
    fn suggest_session_plan_at_reads_optional_files_without_erroring_on_missing_ones() {
        // No module/memory files exist for a brand-new campaign — read_optional
        // should treat that as empty rather than failing before the (untestable
        // without a live call) ask_claude_once step is even reached.
        let root = Scratch::new("plan-missing-files");
        let meta = create_campaign_at(&root.0, &intake("Fresh Campaign")).unwrap();
        assert_eq!(read_optional(&root.0.join(&meta.id).join("module").join("plan.md")), "");
        assert_eq!(read_optional(&root.0.join(&meta.id).join("module").join("current.md")), "");
    }

    #[test]
    fn slugify_handles_punctuation_and_case() {
        assert_eq!(slugify("The Sunless Citadel!"), "the-sunless-citadel");
        assert_eq!(slugify("  Multiple   Spaces  "), "multiple-spaces");
        assert_eq!(slugify("Rise of Tiamat: Part 2"), "rise-of-tiamat-part-2");
        assert_eq!(slugify(""), "campaign");
    }

    #[test]
    fn parse_chapterize_reply_handles_plain_and_fenced_json() {
        let plain = "{\"chapters\":[{\"heading\":\"Chapter 1: Goblin Arrows\",\"summary\":\"An ambush on the road.\"}],\"plan\":\"# Arc\\nGoblins, then the mine.\"}";
        let parsed = parse_chapterize_reply(plain).unwrap();
        assert_eq!(parsed.chapters[0].heading, "Chapter 1: Goblin Arrows");
        assert!(parsed.plan.contains("Goblins, then the mine."));

        let fenced = "```json\n{\"chapters\":[{\"heading\":\"Chapter 1\",\"summary\":\"Intro.\"}],\"plan\":\"Outline.\"}\n```";
        let parsed2 = parse_chapterize_reply(fenced).unwrap();
        assert_eq!(parsed2.chapters[0].heading, "Chapter 1");
        assert_eq!(parsed2.plan, "Outline.");

        assert!(parse_chapterize_reply("not json at all").is_err());
    }

    #[test]
    fn parse_chapterize_reply_defaults_plan_when_absent() {
        let no_plan = r#"{"chapters":[{"heading":"Chapter 1","summary":"Intro."}]}"#;
        let parsed = parse_chapterize_reply(no_plan).unwrap();
        assert_eq!(parsed.plan, "");
    }

    #[test]
    fn split_by_headings_splits_in_order_on_verbatim_matches() {
        let text = "Intro fluff.\nChapter 1: Goblin Arrows\nGoblins attack the wagon.\nChapter 2: Cragmaw Hideout\nA cave full of goblins.\n";
        let headings = vec![heading("Chapter 1: Goblin Arrows", "Ambush."), heading("Chapter 2: Cragmaw Hideout", "Cave.")];
        let chapters = split_by_headings(text, &headings);

        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].0, "Chapter 1: Goblin Arrows");
        assert!(chapters[0].2.contains("Goblins attack the wagon."));
        assert!(!chapters[0].2.contains("Cragmaw"), "chapter 1 shouldn't bleed into chapter 2's text");
        assert_eq!(chapters[1].0, "Chapter 2: Cragmaw Hideout");
        assert!(chapters[1].2.contains("A cave full of goblins."));
    }

    #[test]
    fn split_by_headings_skips_unmatched_headings_leniently() {
        let text = "Chapter 1: Goblin Arrows\nSome content.\nChapter 3: The Cave\nMore content.\n";
        // "Chapter 2" doesn't literally appear (e.g. Claude slightly misquoted it) —
        // should just be skipped, not fail the whole split.
        let headings = vec![
            heading("Chapter 1: Goblin Arrows", "First."),
            heading("Chapter 2: Missing", "Never actually appears."),
            heading("Chapter 3: The Cave", "Third."),
        ];
        let chapters = split_by_headings(text, &headings);
        assert_eq!(chapters.len(), 2);
        assert_eq!(chapters[0].0, "Chapter 1: Goblin Arrows");
        assert_eq!(chapters[1].0, "Chapter 3: The Cave");
    }

    #[test]
    fn split_by_headings_falls_back_to_whole_document_if_nothing_matches() {
        let text = "Completely unstructured adventure text with no headings at all.";
        let headings = vec![heading("Chapter 1: Nonexistent", "Doesn't appear anywhere.")];
        let chapters = split_by_headings(text, &headings);
        assert_eq!(chapters.len(), 1);
        assert_eq!(chapters[0].2, text);
    }

    fn sample_chapters() -> Vec<(String, String, String)> {
        vec![
            ("Chapter 1: Goblin Arrows".into(), "Ambush on the road.".into(), "Full text of chapter 1...".into()),
            ("Chapter 2: Cragmaw Hideout".into(), "A goblin cave.".into(), "Full text of chapter 2...".into()),
        ]
    }

    #[test]
    fn write_chapters_to_disk_writes_files_manifest_and_claude_md_reference() {
        let root = Scratch::new("write-chapters");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        let plan = "# Campaign Arc\nThe goblins lead to Cragmaw Castle.";
        let summaries = write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), plan).unwrap();

        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[0].id, "chapter-01-chapter-1-goblin-arrows");

        let module_dir = root.0.join(&meta.id).join("module");
        assert!(fs::read_to_string(module_dir.join(format!("{}.md", summaries[0].id))).unwrap().contains("Full text of chapter 1"));
        assert!(fs::read_to_string(module_dir.join("current.md")).unwrap().contains("Full text of chapter 1"));
        assert_eq!(fs::read_to_string(module_dir.join("current_id.txt")).unwrap(), summaries[0].id);
        assert!(fs::read_to_string(module_dir.join("plan.md")).unwrap().contains("Cragmaw Castle"));

        let index_md = fs::read_to_string(module_dir.join("index.md")).unwrap();
        assert!(index_md.contains("CURRENT CHAPTER"));
        assert!(index_md.contains("Cragmaw Hideout"));

        let claude_md = fs::read_to_string(root.0.join(&meta.id).join("CLAUDE.md")).unwrap();
        assert!(!claude_md.contains("@module/plan.md"), "plan.md is delivered periodically via the turn prompt, not as a standing import");
        assert!(claude_md.contains("@module/index.md"));
        assert!(claude_md.contains("@module/current.md"));

        // Re-importing shouldn't duplicate the CLAUDE.md reference block.
        write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), plan).unwrap();
        let reimported = fs::read_to_string(root.0.join(&meta.id).join("CLAUDE.md")).unwrap();
        assert_eq!(reimported.matches("@module/current.md").count(), 1);
    }

    #[test]
    fn advance_chapter_updates_current_pointer_and_index_marker() {
        let root = Scratch::new("advance");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        let summaries = write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), "Test plan.").unwrap();
        let second_id = summaries[1].id.clone();

        advance_chapter_at(&root.0, &meta.id, &second_id).unwrap();

        let module_dir = root.0.join(&meta.id).join("module");
        assert_eq!(fs::read_to_string(module_dir.join("current_id.txt")).unwrap(), second_id);
        assert!(fs::read_to_string(module_dir.join("current.md")).unwrap().contains("Full text of chapter 2"));
        let index_md = fs::read_to_string(module_dir.join("index.md")).unwrap();
        // The marker should have moved off chapter 1 and onto chapter 2.
        let ch1_line = index_md.lines().find(|l| l.contains("Goblin Arrows")).unwrap();
        let ch2_line = index_md.lines().find(|l| l.contains("Cragmaw Hideout")).unwrap();
        assert!(!ch1_line.contains("CURRENT CHAPTER"));
        assert!(ch2_line.contains("CURRENT CHAPTER"));
    }

    #[test]
    fn advance_chapter_rejects_unknown_id() {
        let root = Scratch::new("advance-bad");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), "Test plan.").unwrap();
        let err = advance_chapter_at(&root.0, &meta.id, "chapter-99-nonexistent").unwrap_err();
        assert!(err.contains("Unknown chapter id"));
    }

    #[test]
    fn get_module_chapters_reflects_none_then_imported_state() {
        let root = Scratch::new("get-chapters");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();

        let (chapters, current) = get_module_chapters_at(&root.0, &meta.id).unwrap();
        assert!(chapters.is_empty());
        assert!(current.is_none());

        let summaries = write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), "Test plan.").unwrap();
        let (chapters2, current2) = get_module_chapters_at(&root.0, &meta.id).unwrap();
        assert_eq!(chapters2.len(), 2);
        assert_eq!(current2, Some(summaries[0].id.clone()));
    }
}
