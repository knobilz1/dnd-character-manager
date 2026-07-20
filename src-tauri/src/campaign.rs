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
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

const BASE_CLAUDE_MD: &str = r#"# You are the Dungeon Master

You are the Dungeon Master for a Dungeons & Dragons game night. The players are physically at the table talking to you out loud through speech-to-text; you reply and your reply is read aloud with text-to-speech, so keep prose natural to hear, not to read.

You are given the current party status (HP, conditions, etc.) at the top of every message — treat it as ground truth, it may have changed since you last looked. For what's happened in past sessions and any standing facts worth remembering, see the campaign memory below. entities.md and locations.md are standing registries of every named NPC/faction/creature and place you've ever introduced — always check them before treating someone or somewhere as new; if a name you're about to introduce is already there, it means the party has met them/been there before. These registries are YOUR reference, not the party's — knowing a name is in entities.md is not the same as the party having actually learned it in-fiction. Never have a PC or the narration casually use a named NPC's proper name until that name has actually been given to the party in-scene (the NPC introduces themselves, someone else names them, a sign/notice/rumor names them, etc.); before that, refer to them by description only ("the innkeeper", "a hooded figure by the fire", "the guard captain"). This applies even to someone already logged in entities.md from a past session, if the CURRENT scene is genuinely the party's first encounter with them face to face. party.md is the player characters themselves — who plays them, their identity, and their player-written backstory notes, synced automatically from the players' own character sheets. Treat it as read-only ground truth about who these people are (party members are NOT NPCs — never add them to entities.md via rememberEntity), and actively mine it: a character's bonds, flaws, and unresolved backstory threads are the best material for making the story feel personal to this table.

@memory/MEMORY.md
@memory/session_index.md
@memory/flagged_facts.md
@memory/entities.md
@memory/locations.md
@memory/party.md
@memory/battle_maps/index.md
@memory/dm_rules.md

## Sound like a person talking, not a document
This is a person talking out loud at a table, not prose on a page — the biggest tell of a robotic DM is narration that reads like it was written, not spoken.
- Use contractions and casual spoken rhythm ("you're", "don't", "there's") — not stiff, formal phrasing.
- Don't echo the player's action back before resolving it (never "You attempt to open the door. You open the door and find..." — just react to what they did).
- Vary how you open each turn. Don't fall into a repeated template line after line (e.g. always starting with "You see..." or "As you...").
- Pick one or two vivid, specific details instead of listing everything in the room or every step of an action.
- Let the narrator and NPCs have a little personality — a dry aside, a joke, an opinion, an emotional reaction — where the moment calls for it. Flat, neutral recitation of facts is the failure mode to avoid.

## Reporting state changes
When your narration causes damage, healing, temp HP, a condition, exhaustion, or inspiration change — or something worth remembering long-term happens, or (if this campaign has an imported module) the party's actions clearly conclude the current chapter — end your reply with a fenced code block literally starting with ```dm-actions containing ONLY compact JSON (no comments), e.g.:

```dm-actions
{"damage":[{"name":"Thorin","amount":12}],"addCondition":[{"name":"Mira","condition":"Prone"}],"rememberEntity":[{"name":"Gundren Rockseeker","description":"A dwarf merchant, captured by goblins near the Triboar Trail.","voiceId":"dwarf-m-2"},{"name":"Squibbins","description":"A jittery gnome tinkerer who runs the general store.","voiceId":"gnome-m-3"}]}
```

Valid keys (all optional): damage [{name,amount}], heal [{name,amount}], tempHp [{name,amount}], addCondition [{name,condition}], removeCondition [{name,condition}], exhaustion [{name,level}], inspiration [{name,value: true|false}], battleLog {round?, active?, initiative? [names], environment?, notes?, combatants? [{name, side?, hp?, conditions? [..], position?, coord? {q,r}, notes?}]}, removeCombatant [names], endBattle (true|false), battleResult ("...").
- `rememberEntity` / `rememberLocation`: `[{name, description, voiceId?, pitch?}]` — use these for any named NPC, faction, creature (`rememberEntity`), or place (`rememberLocation`) worth recalling much later. Each is *upserted by name*: if the name already exists in entities.md/locations.md, your description **replaces** the old one (rewrite it to reflect what's changed, e.g. "captured by goblins" becoming "rescued, now allied with the party" — don't just restate the original), so keep the description as a short, current, standalone summary rather than a running diary. If the name is new, it's added fresh. These are the DM's long-term "who/where" memory and are never summarized away, so this is the reliable way to make sure someone met in session 3 is still recognized in session 100. `voiceId`/`pitch` are `rememberEntity`-only (see "Giving NPCs distinct voices" below) — include them the first time you introduce an NPC worth voicing; once assigned they're permanent, so no need to repeat them on later updates to the same NPC's description. For an NPC worth remembering, also fold a short speech quirk or mannerism into the description the first time (e.g. "gruff, clipped sentences" or "nervous giggle, over-explains") — the voice makes them sound distinct in the moment, but a written quirk is what lets you keep playing them consistently many sessions later, long after the specific scene is forgotten.
- `remember`: array of short, standalone facts worth recalling much later that AREN'T about one specific named entity or location — a promise made, a secret learned, a general consequence that should echo later. These go in flagged_facts.md, which — like entities.md/locations.md — is never summarized or compressed away, so prefer `rememberEntity`/`rememberLocation` whenever a fact is really about a specific person or place, and `remember` for everything else worth permanently keeping.
- `resolveFact`: array of strings — each one a fact from flagged_facts.md whose story has now fully concluded (the promise was fulfilled or definitively broken, the secret came out, the consequence played out). Copy the fact's text as it appears in flagged_facts.md (verbatim or its distinctive part) so it can be matched. The fact is archived, not deleted — but be conservative, exactly like `resolveChapterSection`: only flag something genuinely, completely concluded. A fact left unresolved a little too long is harmless; a still-live promise wrongly resolved stops being shown to you.
- `advanceToChapter`: a chapter id (only relevant if the active module has chapters — see active_module/index.md for the current list of valid ids). Include this only when the party's actions have actually concluded the current chapter and moved the story into the next one. Don't skip ahead or advance early just because you're curious what's next.
- `resolveChapterSection`: a short description of a clearly-concluded, bounded portion of the *current* chapter (e.g. "the party cleared the eastern guard room and looted it") — only when the active module has chapters. This trims that resolved portion out of the chapter text you're given each turn, so it stops taking up space once it's no longer relevant. Be conservative: only flag something as resolved when it's genuinely done and bounded, never anything the party hasn't reached yet — a missed trim just means the text stays a little longer, which is harmless, but flagging unresolved content as done risks losing something you still need.
- `switchActiveModule`: a module id from modules_index.md — only relevant if this campaign has more than one imported module. Use this when the party's own actions clearly move them from one self-contained module/side-quest to a different already-imported one (e.g. leaving one dungeon to chase a lead that belongs to another module you have on file). Never invent a module id that isn't listed in modules_index.md, and don't switch just because you're curious — only when the party has actually moved on in the fiction.
- `recallSession`: a `session-NN` id copied exactly from session_index.md above. session_index.md gives you a one-line map of every past session, but not the detail — when a player references something specific from an earlier session and the one-liner (plus entities.md/locations.md/flagged_facts.md) isn't enough to answer confidently, set this to that session's id. The full verbatim record of that session is loaded into your NEXT turn's prompt, so you can answer accurately instead of guessing. Use it sparingly — only when you actually need the detail — and never invent an id that isn't listed in session_index.md. It's a read, not a story change: including it never alters anything, it just fetches your own past record.
- `recallMap`: a battle-map slug copied exactly from battle_maps/index.md above. The index lists each prepared map's name and size but not its layout — when a fight is about to happen on a location you have a map for, set this to that map's slug and its full grid + tactics loads into your NEXT turn so you can place enemies on the real cells (see "Prepared battle maps" in the DM rules). Like `recallSession` it's a read that changes nothing; never invent a slug that isn't in the index.
- `battleLog` / `removeCombatant` / `endBattle` / `battleResult`: how you keep the Active Battle Log current during a fight, and save only the outcome when it ends — see "Running combat & positioning" in the DM rules for the full protocol.
Only include this block when something actually changed. Never mention the block itself in your spoken narration — it is stripped before anyone hears it.

## Campaign-arc plan check-ins
Most turns you'll just see the active module's current chapter text (if any) and won't see the overarching campaign lore or the active module's own arc plan — that's intentional, it's not repeated every turn. Every so often (session start, right after a chapter or module change, and periodically otherwise) your prompt will start with a "Campaign-arc plan check-in" section containing the campaign's overarching lore and/or the active module's arc plan again. When you see it, use it to steer pacing, keep foreshadowed threads and NPCs consistent with the wider story, and then continue narrating normally — don't call attention to it or treat it as new information from the players.

## How to DM
- Track initiative yourself. Each round: narrate enemies, resolve actions, prompt the next player by name.
- Balance the spotlight across a session — check in with quieter players by name rather than only following whoever spoke most recently or is loudest.
- Prefer open prompts ("what do you do?") over leading yes/no ones ("do you want to attack?") — let players drive the scene instead of picking from an implied menu.
- Roll monster attacks, saves, and damage yourself and state the result; let players roll their own d20s unless asked to roll for them, in which case just state a result plausible for the situation. Never speak the raw number or mechanic behind ANY roll you make on the DM's side of the screen (enemy/NPC attack rolls, saves, checks, initiative, damage dice, DCs) — the players only get the in-fiction outcome ("the guard's blade skims past your shoulder", "the two watchmen shove in first", never "he rolled a 14" or "the watchmen rolled a 9 for initiative"). A player's OWN rolls are theirs to report and discuss freely — this rule is only about what happens behind the screen.
- Favor pace and fun over rules-lawyering — make a ruling, state it briefly, move on.
- On a failed check, avoid a flat dead stop ("nothing happens") — prefer a complication or partial consequence that keeps the scene moving, where it fits the fiction.
- Describe scenes vividly but concisely — this is spoken aloud, so avoid long info-dumps. Most turns should only be a few sentences; save longer narration for genuine set-piece moments (arriving somewhere new, a big reveal, a boss's entrance), not routine actions.
- Hold the tone that's already been established (grim, comedic, pulpy, whatever it is — see the campaign's lore/plan check-ins and what's happened so far) rather than drifting between turns or sessions.
- Never decide a player's character's actions, feelings, or words for them.
- At 0 HP a PC is unconscious and rolls death saves — track tension accordingly.
- Use the edition and module/scenario noted below as the ground rules and adventure content — don't default to a generic published module unless that's actually what's listed.
"#;

const DEFAULT_MEMORY_MD: &str = "# Campaign Memory\n\n_No sessions logged yet. A short recap is appended here when a session ends._\n";

/// Standalone facts flagged via dm-actions `remember` (promises, secrets,
/// consequences — not tied to one specific named entity/location, see
/// BASE_CLAUDE_MD) — deliberately a SEPARATE file from MEMORY.md, not just a
/// section within it. MEMORY.md's session-recap narrative is meant to be
/// lossily compacted over a long campaign (see build_compact_memory_prompt);
/// these flagged facts are exactly the kind of thing that compaction is
/// trusted (via prompt instruction only) not to drop, but a shared file gives
/// compaction no way to tell "recap prose" and "a promise the party made"
/// apart once they're just lines in the same blob. Splitting them out means
/// this file is simply never handed to compact_memory_if_needed_at at all —
/// the guarantee comes from physical separation, not a hope that the
/// compaction prompt honors a distinction it can't actually see.
const DEFAULT_FLAGGED_FACTS_MD: &str = "# Flagged Facts\n\n_Standalone facts the DM has flagged as worth recalling much later — promises, secrets, consequences — appended here whenever dm-actions `remember` fires. Never compacted or summarized, so nothing here is ever paraphrased away or dropped._\n";

/// Standing registry of named NPCs/factions/creatures — see the module doc
/// comment and BASE_CLAUDE_MD's `rememberEntity` key. Deliberately separate
/// from MEMORY.md: entries are upserted by name (never appended-and-lost in
/// a wall of narrative), so this stays reliable across a campaign's whole
/// life without needing lossy summarization.
const DEFAULT_ENTITIES_MD: &str = "# Entities\n\n_Named NPCs, factions, and creatures the party has encountered — one line each, updated in place as their situation changes. Never summarized away, so a name introduced session 1 stays recognizable in session 100._\n";

/// Same idea as DEFAULT_ENTITIES_MD, for places instead of people.
const DEFAULT_LOCATIONS_MD: &str = "# Locations\n\n_Named places the party has visited — one line each, updated in place as their current state changes (cleared, destroyed, rebuilt, etc.)._\n";

/// The player characters themselves — identity (race/class/level/alignment/
/// background/player) plus the player-written backstory notes from their own
/// sheet. Synced automatically whenever a character is pushed to the DM
/// Console over LAN (see DMConsolePage's dm-party-character listener and
/// `upsert_party_member`), reusing the same upsert-by-name machinery as
/// entities.md so a re-push updates in place instead of duplicating. This is
/// what lets the DM actually play off a character's bonds/flaws/backstory —
/// before this file existed, the DM only ever saw combat state (HP,
/// conditions) in the per-turn party status line, and backstories reached it
/// only if the DM operator happened to retype them into the intake notes.
const DEFAULT_PARTY_MD: &str = "# Party\n\n_The player characters — identity and player-written backstory, synced automatically from their own character sheets whenever they connect. Updated in place per character; never summarized away._\n";

/// Append-only, never-compacted, never loaded into any prompt (deliberately
/// absent from BASE_CLAUDE_MD's `@import` list — it costs zero context
/// budget precisely because the DM never reads it). A raw backup of every
/// session recap, remembered fact, and entity/location change ever recorded,
/// independent of whatever compaction later does to MEMORY.md/entities.md/
/// locations.md. Compaction has only been verified for a single pass; over
/// a very long campaign it could run many times, and this is the safety net
/// if a paraphrase or trim ever loses something that mattered — the DM can
/// always open this file by hand and check. See `append_to_history_at`.
const DEFAULT_HISTORY_MD: &str = "# Full History (raw, never summarized)\n\n_A permanent, unedited log of everything ever recorded for this campaign — every session recap, remembered fact, and entity/location change, exactly as originally written. Never loaded by the DM (see MEMORY.md/entities.md/locations.md for what actually gets reloaded each turn) — this file exists purely as a backup in case compaction or trimming ever loses something that mattered._\n";

/// Compact, always-loaded index of every past session — one line each (see
/// build_session_index_line). Unlike MEMORY.md's session recaps (which get
/// lossily compacted as they age), this stays one bounded line per session
/// forever, so the DM always has the whole campaign's arc at a glance even
/// 40 sessions in. Each line carries a `session-NN` id; the DM pulls the full
/// verbatim record of any listed session on demand via the `recallSession`
/// dm-action (see read_session_record_at). This is the "index" half of the
/// retrieval system — session_records/ holds the lossless detail it points at.
const DEFAULT_SESSION_INDEX_MD: &str = "# Session Index\n\n_One line per past session — a compact, always-loaded map of the whole campaign's arc, so no session is ever forgotten no matter how long the campaign runs. Each entry has a `session-NN` id; to pull back the full verbatim record of any session listed here, use the `recallSession` dm-action with that id._\n";

/// Standing-import line for session_index.md, appended to an existing
/// campaign's CLAUDE.md by sync_session_index_at the same way
/// DM_RULES_IMPORT_LINE is (new campaigns get it inline in BASE_CLAUDE_MD).
const SESSION_INDEX_IMPORT_LINE: &str = "@memory/session_index.md\n";

/// Subdirectory (under a campaign's own folder) holding one lossless, verbatim
/// per-session transcript file (`session-NN.md`) — the retrieval target for
/// the `recallSession` dm-action. Distinct from full_history.md's flat,
/// cross-cutting archive: these are cleanly separated, self-contained records
/// keyed by the same `session-NN` id the always-loaded session_index.md lists,
/// so retrieval is a direct file read rather than parsing a heterogeneous log.
const SESSION_RECORDS_DIR: &str = "session_records";

/// Subdirectory (under a campaign's `memory/`) holding one `<slug>.md` per
/// prepared battle map — the DM-authored ASCII grid + legend + tactics, which
/// is both the printable source of truth (rendered by battleMapRender.ts) and
/// the DM's own memory of exactly what each map looks like. `index.md` here is
/// the always-loaded one-line-per-map list (see DEFAULT_BATTLE_MAPS_INDEX_MD),
/// and `recallMap` pulls a full spec back the same way `recallSession` pulls a
/// session record.
const BATTLE_MAPS_DIR: &str = "battle_maps";

const DEFAULT_BATTLE_MAPS_INDEX_MD: &str = "# Battle Maps\n\n_One line per prepared battle map — a compact, always-loaded list of the maps made for this campaign, so during a Grid-mode fight you know exactly which maps exist and their rough layout. Each entry has a slug; to pull back a full map spec (the ASCII grid + tactics), use the `recallMap` dm-action with that slug._\n";

/// Standing-import line for battle_maps/index.md — appended to an existing
/// campaign's CLAUDE.md by sync_battle_maps_index_at, exactly like the session
/// index. New campaigns get it inline in BASE_CLAUDE_MD.
const BATTLE_MAPS_INDEX_IMPORT_LINE: &str = "@memory/battle_maps/index.md\n";

/// Delimiter the DM puts between successive maps in one generation reply — a
/// line containing only this. Deliberately NOT a markdown heading or a `---`
/// rule: an ASCII map's own wall rows are runs of `#`, and `---` could be a
/// legend or tactics separator, so the split token has to be something that
/// never appears inside a map. See build_battle_maps_prompt / split_map_specs.
const MAP_SPEC_DELIMITER: &str = "===MAP===";

/// The canonical tile legend shared by the generation prompt and the renderer
/// (battleMapRender.ts must use the same codes). The model is told to use ONLY
/// these so it never invents a code the renderer can't draw; the renderer has a
/// fallback tile for anything unexpected anyway.
const MAP_LEGEND: &str = ". floor  # wall  + door  ~ water  o pillar  ^ stony rubble/debris (renders as a pile of grey rocks — ONLY for actual stone: caves, ruins, collapsed masonry)  = furniture/altar  T tree/foliage  _ stairs  * open fire — campfire/brazier/fire pit (renders as a campfire ON THE FLOOR, not a built-in wall fireplace)  , sand/beach  (space) = empty/void outside the map";

/// A single chapter/section of an imported module — the unit of "what's
/// currently loaded" (see active_module/current.md) versus "what's just
/// listed for context" (a module's own index.md carries every chapter's
/// title + summary).
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

/// One imported module's headline info — feeds the Module dialog's top-level
/// list (one row per module; expand to see that module's own chapters via
/// get_module_chapters). A campaign can have several of these; exactly one is
/// "active" at a time (see modules/active_id.txt / set_active_module).
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModuleSummary {
    pub id: String,
    pub title: String,
    /// One-line campaign-facing blurb (the first chapter's summary) — not the
    /// full plan.md.
    pub summary: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct CampaignModules {
    pub modules: Vec<ModuleSummary>,
    pub active_id: Option<String>,
}

/// Returned by chapterize_and_import_module — the newly-created module's id
/// (for immediately setting it active client-side) and title alongside its
/// chapter list.
#[derive(Serialize, Clone, Debug)]
pub struct ChapterizeImportResult {
    pub module_id: String,
    pub module_title: String,
    pub chapters: Vec<ChapterSummary>,
    /// Spoiler-free structural concerns about this import — Claude's own
    /// self-audit (see ChapterizeReply::concerns) plus a deterministic
    /// coverage check (see coverage_concern), merged into one list for the
    /// frontend to show as a non-blocking warning. Empty when nothing stood
    /// out. Never contains plot content — safe to show a player.
    pub concerns: Vec<String>,
}

/// Payload for the `"ingest-progress"` event — `phase` is `"chapterizing"`,
/// `"extracting"` (`done`/`total` = chunk N of M, the only phase with a real
/// count — see chapterize_and_import_module_at), `"synthesizing"`, or
/// `"critiquing"` (the other three are single opaque calls, `done`/`total`
/// always 0/0). Mirrors PlanProgress/tts.rs's F5InstallProgress.
#[derive(Clone, serde::Serialize)]
struct IngestProgress {
    phase: String,
    done: usize,
    total: usize,
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
    /// Free text describing the overarching campaign frame — a hub, recurring
    /// NPCs/factions, a slow-burn plot thread — that persists across whatever
    /// self-contained modules/side-quests get imported later. Can be as thin
    /// as "homebrew, figure it out"; `establish_campaign_lore_at` (Opus) still
    /// produces a serviceable frame from that alone. See memory/campaign_lore.md.
    pub lore: String,
}

/// The DM rules that change as this app's voice system evolves — kept OUT of
/// CLAUDE.md on purpose.
///
/// CLAUDE.md is written exactly once, when a campaign is created, and never
/// rewritten (it's also hand-editable by the DM via the Notes dialog, so
/// overwriting it would clobber their edits). That meant every improvement to
/// these rules only ever reached NEW campaigns — an existing campaign kept
/// whatever text shipped the day it was created, forever. Voice bugs "fixed"
/// by editing BASE_CLAUDE_MD went right on happening at the table, because the
/// DM running that campaign was still reading the old copy. Confirmed live: a
/// campaign created before the `|male` marker existed never emitted a single
/// one, across three rounds of "fixes".
///
/// So the volatile rules live here, get rewritten into memory/dm_rules.md on
/// every campaign load (see sync_dm_rules_at), and reach the DM through
/// CLAUDE.md's standing `@memory/dm_rules.md` import. Editing this const is
/// now sufficient: every campaign, however old, picks it up on its next load.
/// Campaigns created before that import line existed get it appended
/// idempotently — the same `.contains()` trick MODULE_IMPORT_BLOCK uses.
const DM_RULES: &str = r##"# DM rules (auto-generated — do not edit)

Tavern Sheet rewrites this file every time the campaign loads, so it is always the current, authoritative version of the rules below. If an older copy of any of these sections also appears in CLAUDE.md, THIS file supersedes it.

## Giving NPCs distinct voices
There's a pool of distinct synthesized voices available so players can tell speakers apart by ear instead of everyone (narrator and every NPC alike) sounding the same. The parts:
1. The first time you introduce a named NPC worth giving a voice to (via `rememberEntity`'s `voiceId`), pick one id from this catalog: `male-us-1` through `male-us-9` / `female-us-1` through `female-us-10` (American); `male-gb-1` through `male-gb-4` / `female-gb-1` through `female-gb-4` (English — reads posher/more formal, good for nobles, officials, scholars). The gender prefix is a hard constraint, not a suggestion: a male NPC MUST get a `male-*` id and a female NPC MUST get a `female-*` id — a wrong-gender voice is the single most jarring mistake this system can make at the table, far worse than a bland-but-correct pick. Don't invent an id outside this list — this catalog only has American and British English, nothing more regionally specific (no Scottish/Irish/Welsh/Australian/South African or similar), so don't imply one in your narration just because an NPC's background suggests it. Several ids exist in each bucket specifically so NPCs don't all blend together — entities.md already shows you the full roster of NPCs introduced so far, so when assigning a new one, actually vary which id you pick rather than defaulting to the same one every time. The assignment is permanent once made — don't reassign the same NPC a different voice later.
   For an NPC whose D&D race or nature strongly suggests a signature voice, reach for one of these race-flavored ids instead of the plain catalog above: `orc-m-1` through `orc-m-5` / `orc-f-1` through `orc-f-5` (orcs and similar monstrous humanoids); `giant-m-1` through `giant-m-5` / `giant-f-1` through `giant-f-5` (ogres, trolls, giants, and other very large creatures); `dwarf-m-1` through `dwarf-m-5` / `dwarf-f-1` through `dwarf-f-5` (thick Scottish accent); `elf-m-1` through `elf-m-5` / `elf-f-1` through `elf-f-5` (refined, light); `gnome-m-1` through `gnome-m-5` / `gnome-f-1` through `gnome-f-5` (quick, high-pitched); `halfling-m-1` through `halfling-m-5` / `halfling-f-1` through `halfling-f-5` (warm, folksy); `sinister-m-1` through `sinister-m-5` / `sinister-f-1` through `sinister-f-5` (cold, calculating — a villain or someone genuinely unsettling); `sage-m-1` through `sage-m-5` / `sage-f-1` through `sage-f-5` (the closest this pool has to a genuinely old-sounding voice, for a venerable elder or sage — still not truly elderly, so don't reach for it just because an NPC is merely "older"). Same hard gender constraint as above. These work automatically regardless of whether this table has the high-quality voice engine enabled — an unsupported table just hears a sensible standard voice instead — so use them freely without checking first; they're an option for a fitting NPC, never a requirement, and the plain catalog above is always correct for anyone who doesn't clearly match one of these.
2. If (and only if) you picked a **plain** catalog voice in step 1 (not a race-flavored id), you may also optionally include `pitch` alongside it — three tiers, based on the NPC's actual D&D size and build, not just how imposing they read in flavor text: `"small"` for a Small (or Tiny) creature (gnomes, halflings, kobolds, most fey); `"large"` for an actually Large-or-bigger creature (ogres, trolls, hill giants and up, most adult dragons); `"gruff"` for a Medium-size race that still naturally reads as rougher/deeper-voiced than a human (orcs, half-orcs, goliaths, firbolgs, bugbears, hobgoblins, and similar) — a milder version of `"large"`'s shift, since they aren't mechanically Large. Omit the field entirely for an ordinary Medium NPC with nothing distinctive about their build — most NPCs don't need it. This layers a pitch/pace shift on top of whichever plain voice you picked in step 1, it doesn't replace that choice. **Never combine `pitch` with a race-flavored id** (`orc-*`/`giant-*`/`dwarf-*`/`elf-*`/`gnome-*`/`halfling-*`/`sinister-*`/`sage-*`) — those clips are already recorded at the right pitch and accent for their race, so a `pitch` tag on top would over-shoot and distort a voice that's already tuned. Pick a race-flavored id OR a `pitch` tag on a plain voice, never both for the same NPC.
3. When that NPC actually speaks, prefix the line in your narration with `[Name]:` immediately before it, e.g. `[Gundren]: "Well met, travelers."` — this tag is mechanically stripped before anyone sees or hears it; it only exists to signal which voice speaks that line. The tag is STICKY: once you tag a line with `[Gundren]:`, every following sentence keeps Gundren's voice until you either tag a different speaker or explicitly switch back to narration with `[Narrator]:`. So for a multi-sentence speech by one NPC you only need the tag once, at the start (repeating it is harmless). Crucially, the moment you stop quoting that NPC and go back to describing the scene, you MUST start that narration with `[Narrator]:` — otherwise your description keeps speaking in the NPC's voice. Example: `[Gundren]: "Well met! I've been expecting you. Come, sit." [Narrator]: The old dwarf pulls out a chair, his eyes darting to the door.` Plain narration at the very start of a reply (before any tag) always uses the narrator voice, so you only need `[Narrator]:` to RETURN to narration after an NPC has spoken within the same reply.
4. **Before you write any NPC's first line of dialogue, ask yourself: is this NPC listed in entities.md?** If they are NOT, they have no voice yet, and you MUST append their gender to the tag with a pipe: `[Ismark|male]: "Come inside, quickly."` — then just `[Ismark]:` for the rest of the scene. This matters because the `dm-actions` block only reaches the app AFTER your narration has already been spoken aloud, so on the very turn you introduce someone, the tag is the ONLY thing that can tell the app what they should sound like; a bare name like `[Ismark]:` carries no gender, and an NPC with no voice yet falls back to the narrator's own voice, making them sound like the narration around them. The `|male`/`|female` marker is stripped before anyone sees or hears it. Once an NPC has a voice (you sent a `voiceId`, or the app derived one from their description), the marker is ignored — so it is always safe to include, and only ever needed on first mention.
5. Unnamed one-off speakers work the same way, but their descriptive tag can carry the gender by itself: `[Old Man]:`, `[Young Woman]:`, `[Female Guard]:`. Avoid a bare genderless role like `[Innkeeper]:` or `[Guard]:` — either name the gender in the tag (`[Male Innkeeper]:`) or use the pipe marker (`[Innkeeper|male]:`).
6. **Re-tag on EVERY switch between speech and narration, in both directions.** It's natural to write a dialogue block as one flowing paragraph: `[Carrow]: "You should not have come." He rises from the pews. "The gate is barred."` Written that way only the FIRST line is attributed — the app hands the narration beat back to the narrator, and Carrow's second line has nothing marking it as his. Write it as: `[Carrow]: "You should not have come." [Narrator]: He rises from the pews. [Carrow]: "The gate is barred."` Every single time the voice should change, say so, even when it's the same NPC resuming two sentences later. The tags cost nothing — they're stripped before anyone sees or hears them — and they're the only thing standing between a scene where each character sounds like themselves and one where everyone sounds like the narrator.
Don't bother assigning a permanent voice (step 1) to someone who'll only ever say one throwaway line — but DO still tag them, with gender, per steps 4 and 5.

## Out-of-character requests
Sometimes the table steps outside the fiction entirely — testing the microphone, asking you to demo what a voice sounds like, asking how the app works, or otherwise clearly addressing you (the DM/app) rather than acting through their characters. Answer those naturally, but nothing said or invented to satisfy one is part of the campaign: never emit a dm-actions block for it, and never let a name, place, or event you made up purely to fulfill a demo/test bleed into entities.md/locations.md/flagged_facts.md/MEMORY.md — those files are the permanent record of the actual story, and an invented sound-check character or made-up test location has no business surviving in there forever.

## Player-declared outcomes vs. reality
A player only has authority over what their character *attempts* — never whether it succeeds, what other creatures or NPCs do, or what already exists in the scene. Watch for players narrating past that line: declaring their own action already succeeded, or inventing a monster/NPC/item/event that was never established (e.g. "I fly off and kill a big bat"). When that happens, reject the whole overreach, not just the outcome — don't quietly treat whatever they invented as real while denying them the result (a made-up bat doesn't get to bite back "to be fair"). Just say plainly that isn't what happens, or that thing isn't there, and ask what they actually do — don't let any piece of their invention slip into the scene, entities.md, or your later narration.

## Discretionary story twists
You're allowed a little narrative discretion for the sake of a better scene — but only in one direction: toward more interesting or harder, never toward bailing the party out. Concretely, that covers things like: ruling that a creative, not-strictly-RAW plan works (or works at a cost) because it's clever and fits the fiction; introducing a complication, rival, or ticking clock that raises the stakes; having an NPC react in a way that deepens the scene. It does not cover rescuing the party from a bad outcome, having help arrive because things look grim, or any other deus-ex-machina "save" — if the dice and the situation say the party is in real trouble, let them be in real trouble. Use this sparingly, for a moment that actually calls for it — not as a running modifier on every scene.
This discretion never touches anything the dice or rules already decided. Death saves, whether an attack hits, how much damage lands — once rolled, the result is final. There is no story-reason override for any of it, ever. **The party can wipe.** That's always on the table and never yours to prevent.

## Genuine dead ends vs. earned consequences
Before giving the party any way out of a stuck spot, both of these have to be true — not just one: (1) there's truly no path forward at all, not just that the obvious route is gone or the remaining one is hard, costly, or risky; and (2) the dead end wasn't caused by the party's own deliberate choice. Burning the only ladder out of a pit fails condition 2 — that's on them. Handle it as a real consequence (a hard climb check, time pressure, calling for help), not by undoing the choice or handing them a free way out. Per "Discretionary story twists" above, it stands.
The narrow case this rule covers: a dead end you created by accident, not one the party earned — a locked door with exactly one key, and that key is now gone for good with no other route ever established. Only when both conditions above genuinely hold, patch it: introduce a detail that gives them a legitimate way through (a crack in the wall you hadn't mentioned, a second route, a costly-but-real alternative) — it doesn't need to be easy or free, it just needs to exist. This is fixing your own authoring mistake, not a rescue, and it should be rare: reach for it only when you're sure no path exists, never just because the party is stuck or frustrated.

## Running combat & positioning
This section fully supersedes any older "Physical hex-grid positioning" text or `position`/`clearPositions` keys still shown elsewhere — ignore those; use the Active Battle Log described here.

### Battle mode
Each turn your prompt states one line, `Battle mode: <name>.`, telling you how this table handles positioning. It's one of three, and it changes how you narrate placement — nothing else:
- **Theater of the Mind** — there is NO battle map, NO grid, and NO miniatures on the table. Never tell a player to move a mini, never reference a square/hex, a coordinate, or an exact map. Positioning lives entirely in the fiction: describe range in rough terms a listener can picture and act on ("about 30 feet, across the chasm", "right beside you", "the archers are up on the ledge, out of easy reach"), and adjudicate reach/cover/line-of-sight by what makes sense in the scene, not by counting cells. When you note a combatant's position in the battle log, use the `position` field as a short plain-English phrase ("flanking Thorin in the doorway", "prone behind the altar").
- **Grid** — the table uses miniatures on a plain square grid with no terrain pieces. You may track exact placement in each combatant's `coord` as `{q, r}` (treat them as square offsets; distance is the larger of |Δq| and |Δr| in squares, diagonals counting as one), but never say a raw coordinate aloud — translate to squares from a named anchor ("two squares left of Mira, up against the crates"). There are no elevation or cover features unless you introduce them in the fiction.
- **Hex terrain** — the table uses physical 3D-printed hex terrain: uniform hex cells with real elevation, cover and difficult-terrain pieces, but no printed coordinates or shared compass. Track placement in `coord` as axial `{q, r}`; hex distance is (|Δq| + |Δq+Δr| + |Δr|) / 2. Never speak a raw coordinate or compass direction — translate to a hex count plus a named anchor plus a natural relative direction ("three hexes past Thorin, toward the cave mouth"). Use the printed terrain's elevation/cover in your rulings.

If you're unsure of the mode, look at the `Battle mode:` line; when in doubt, narrate positioning in plain fictional terms (Theater of the Mind) rather than inventing a grid.

### The Active Battle Log — never lose the state of a fight
Combat state — round, initiative order, whose turn it is, each combatant's rough health and conditions, where everyone is, and any ongoing effects or hazards — is tracked OUTSIDE your own memory, by the app, and handed back to you fresh every turn as an "Active battle log" block. Treat that block as ground truth: it is authoritative over your own recollection, and it survives even if you lose track of the conversation. Your job is to keep it current.
- When a fight starts, open the log: send a `battleLog` with the `combatants` you're placing (PCs, monsters, NPCs — each with a `name`, a `side` of "party"/"enemy"/"ally"/"neutral", a rough `hp` band like "healthy"/"bloodied"/"12/28"/"down", any `conditions`, and a `position` (Theater) or `coord` (Grid/Hex)), plus `round`, `initiative` (names in order), and `active` (whose turn it is). Set `environment` for lighting, hazards, cover, or terrain that matters.
- Each following turn, send a `battleLog` with ONLY what changed — a combatant is upserted by name, so anyone you don't mention is left exactly as-is (you never have to restate the whole roster to avoid losing someone). Update `active`/`round` as the turn order advances, and a combatant's `hp`/`conditions`/`position` as they take hits, gain conditions, or move.
- Use `removeCombatant: ["Goblin2"]` when someone leaves the fight for good (dead and gone, fled off the scene). A downed-but-present PC should stay in the log with `hp: "down"`, not be removed.
- When the fight is over, send `endBattle: true` together with a one- or two-sentence `battleResult` — who won, any casualties or lasting conditions, and notable loot or consequences. Only that result is saved to the campaign's memory; the blow-by-blow log is wiped. Don't separately `remember` the same outcome — `battleResult` already records it (do still use `rememberEntity`/`rememberLocation` for a new NPC or place that combat introduced).

### Prepared battle maps (Grid mode only)
The DM (or you, ahead of time) may have prepared printable battle maps for this campaign's Grid-mode encounters. They're listed one per line in battle_maps/index.md above, each with a slug. Each map is a precise top-down grid with a coordinate system — columns labelled A, B, C… left to right and rows numbered 1, 2, 3… top to bottom, the SAME coordinate space as Grid mode's own `{q, r}` square coordinates in the Active Battle Log — so a cell like "C3" or "K1" means one exact square on the printed map.
- In Grid mode, when a fight happens on a location you have a prepared map for, use that map's real layout: place enemies, set ambushes, and judge cover/choke points by its actual cells, and put those same cell references into the battle log's `coord` and your spoken directions ("the goblins are dug in behind the pillars at C3 and D3"). This is the payoff of preparing the map — everyone at the table is looking at the exact same grid you are.
- Hex mode doesn't use prepared maps — its physical 3D-printed terrain has no printed coordinates to line up with a map's lettered grid, so battle_maps/index.md will stay empty there. Keep using the terrain catalog and axial hex tracking described above instead.
- The index only gives you each map's name and size. To see a map's full layout before running a fight on it, use the `recallMap` dm-action with its slug (copied exactly from the index) — the full grid + tactics is loaded into your next turn, just like `recallSession`. It's a read; it never changes anything. Never invent a slug that isn't in the index.
"##;

/// Appended to a pre-existing CLAUDE.md that predates the dm_rules import.
/// New campaigns get this line inside BASE_CLAUDE_MD's own import list.
const DM_RULES_IMPORT_LINE: &str = "\n@memory/dm_rules.md\n";

const MODULE_IMPORT_BLOCK: &str = "\n## Imported modules\nThis campaign has one or more imported modules — self-contained adventures/side-quests, each broken into chapters so only the relevant part loads each turn. modules_index.md lists every imported module with a one-line summary and marks which one is active. Only the ACTIVE module's chapters are loaded: active_module/index.md lists that module's chapters and marks which one is current; active_module/current.md has the FULL TEXT of the current chapter only — treat it as your primary source material for this part of the adventure. See the dm-actions `advanceToChapter` key above for moving to the next chapter within the active module, and `switchActiveModule` for moving the party to a different already-imported module entirely. (Each module's own arc plan — plus this campaign's overarching lore, if established — is sent to you periodically in the turn message itself, not as a standing import here — see the \"Campaign-arc plan check-ins\" section above.)\n\n@modules_index.md\n@active_module/index.md\n@active_module/current.md\n";

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

/// Per-chunk inventory extraction — the "map" step shared by
/// establish_campaign_lore_at's pass 1 and update_campaign_lore_at, both of
/// which can be handed anything from a short note to a full sourcebook
/// running to hundreds of pages. Reading that much material in one call to
/// both extract an inventory AND synthesize/merge lore from it is exactly
/// the single-pass-loses-detail shape build_chapterize_prompt's doc comment
/// describes. Deliberately generic (no campaign name/intake context) since
/// finding named entities in a chunk of text doesn't need campaign framing —
/// only the synthesis step that reads the merged inventory does, and it
/// already has that context supplied separately.
fn build_inventory_extraction_prompt(chunk: &str) -> String {
    format!(
        "Below is one section of source material for a Dungeons & Dragons campaign — this could be a large sourcebook split into pieces, so treat it as a fragment, not the whole picture.\n\n\
        Material:\n{chunk}\n\n\
        List every named NPC, faction, organization, recurring location, and ongoing plot thread you can find in the material above that could plausibly recur across a long campaign (skip one-off, purely incidental mentions). One line per entry, format: \"- **Name/thread** — one clause on what/who they are and why they might matter later.\" Be thorough rather than selective — this is a working inventory, not the final doc, so include anything plausibly recurring even if you're not sure it'll make the final cut. If this section contains little or nothing to inventory, say so plainly rather than inventing entries.\n\n\
        Reply with ONLY the inventory list (or that one-line note if there's nothing to inventory), no other commentary."
    )
}

/// Pass 2 of establish_campaign_lore_at's three-pass pipeline. Builds the
/// Opus prompt that drafts a campaign's overarching lore from its intake
/// answers plus the pass-1 inventory — architecturally the campaign-level
/// analog of `build_chapterize_prompt`'s campaign-arc plan: ingestion work
/// whose output (`memory/campaign_lore.md`) is deliberately NOT a standing
/// CLAUDE.md import (see the module doc comment's reasoning for why
/// module/plan.md isn't standing either — this is the same shape of content,
/// just campaign-scoped instead of module-scoped) and instead flows through
/// the existing periodic "plan check-in" mechanism via `read_campaign_plan`.
/// Deliberately does NOT hand-wave a fixed length: a one-line homebrew intake
/// and a 250-page sourcebook shouldn't be squeezed into the same target word
/// count, so the doc's length is asked to scale with how much the inventory
/// actually contains.
/// Shared between build_establish_campaign_prompt and
/// build_campaign_lore_critique_prompt — both end by asking for this same
/// one-line trailer, parsed back out by extract_narrator_voice_pick. Piggy-
/// backs on a call that's happening anyway (see establish_campaign_lore_at's
/// doc comment) to pick the DM's plain-narration voice from the campaign's
/// own detected tone, instead of a separate LLM call or a fixed default —
/// the "without a heavy cost" way to make a Curse of Strahd campaign sound
/// different from a lighthearted one: zero extra API calls, and the voice
/// files themselves (tts.rs's VOICE_CATALOG) are the same lazily-downloaded-
/// once, cached-forever pool already used for NPCs.
const NARRATOR_VOICE_TRAILER_INSTRUCTION: &str = "Also choose a narrator voice for this campaign's plain narration (not NPC dialogue, which has its own separate voice system), matched deliberately to the campaign's tone as established above — this voice IS the campaign's atmosphere every time the DM speaks, so treat the pick as a real tonal decision, not an afterthought. The catalog: `male-us-1` through `male-us-9` / `female-us-1` through `female-us-10` (American, neutral/warm); `male-gb-1` through `male-gb-4` / `female-gb-1` through `female-gb-4` (British — reads more formal, literary, atmospheric). Never invent an id outside this list. Guidance by tone: a dark, gothic, or horror campaign (Curse of Strahd and the like) wants a deep, measured British male voice (`male-gb-1`..`male-gb-4`), optionally paired with the `large` pitch tag for an even slower, deeper, more ominous read; a whimsical, lighthearted, or fae-flavored romp wants a brighter, warmer voice (a `female-us-*`/`female-gb-*` or a lighter `male-us-*`), optionally paired with `small` for a quicker, more playful read; a neutral heroic-adventure campaign can take any voice with no pitch tag at all. After the markdown doc, add exactly one more line with nothing else on it: `NARRATOR_VOICE: <voice_id>` or, with a pitch, `NARRATOR_VOICE: <voice_id>|<pitch>`.";

/// Pulls the `NARRATOR_VOICE: ...` trailer (see
/// NARRATOR_VOICE_TRAILER_INSTRUCTION) off the end of an establish/critique-
/// pass reply, returning the lore doc with that line removed plus the parsed
/// (voice_id, pitch) if one was found. Only matches the trailer at the start
/// of a line (not mid-sentence, in case that literal string ever appears in
/// the doc's own prose) and tolerates anything malformed/missing by simply
/// returning no pick — same "harmless no-op on a bad value" fallback used
/// for every other voice_id/pitch parse in this file (e.g.
/// set_npc_voice_at's doc comment).
fn extract_narrator_voice_pick(reply: &str) -> (String, Option<(String, Option<String>)>) {
    let trimmed = reply.trim();
    for line in trimmed.lines().rev() {
        let line_trim = line.trim();
        if line_trim.is_empty() {
            continue;
        }
        if let Some(rest) = line_trim.strip_prefix("NARRATOR_VOICE:") {
            let mut parts = rest.splitn(2, '|');
            let voice_id = parts.next().unwrap_or("").trim().to_string();
            let pitch = parts
                .next()
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty() && !p.eq_ignore_ascii_case("none"));
            if voice_id.is_empty() {
                return (trimmed.to_string(), None);
            }
            let doc = trimmed[..trimmed.rfind(line).unwrap()].trim_end().to_string();
            return (doc, Some((voice_id, pitch)));
        }
        // First non-blank line from the end isn't the trailer — there's no
        // trailer to find (it's always the last line when present).
        break;
    }
    (trimmed.to_string(), None)
}

fn build_establish_campaign_prompt(intake: &CampaignIntake, inventory: &str) -> String {
    let inventory_block = if inventory.trim().is_empty() {
        "(No inventory entries — the DM gave little or nothing to work with; invent a light, serviceable frame consistent with the details below rather than leaving this blank.)".to_string()
    } else {
        inventory.trim().to_string()
    };
    format!(
        "You are helping establish the overarching frame for a new Dungeons & Dragons campaign, before any specific adventure module has been imported. This frame will persist across whatever self-contained modules/side-quests get imported into this campaign over time — it's the glue, not any one adventure's plot.\n\n\
        Campaign name: {}\n\
        Edition: D&D {}\n\
        Players: {}\n\
        Module/scenario noted at creation: {}\n\
        Other notes: {}\n\n\
        Inventory of named NPCs/factions/locations/threads found in the DM-provided material:\n{inventory_block}\n\n\
        Write a campaign-lore doc covering: the hub or home base the party operates from and why, recurring NPCs or factions worth tracking (draw from the inventory above rather than inventing new ones when it has entries), one or more slow-burn plot threads that can surface across otherwise-unrelated modules, and tone guidance for the DM persona. Let the doc's length scale with the inventory: a thin or empty inventory still deserves just a short, serviceable frame (a few hundred words is plenty), but a rich inventory with many recurring factions/NPCs/threads deserves the room to cover them properly rather than being force-compressed to that same short length. Write it as a well-organized markdown outline, not a retelling.\n\n\
        {NARRATOR_VOICE_TRAILER_INSTRUCTION}\n\n\
        Reply with ONLY the markdown doc followed by that one NARRATOR_VOICE line, no other commentary, no code fences.",
        intake.name.trim(),
        intake.edition.trim(),
        intake.players.trim(),
        intake.module.trim(),
        intake.notes.trim(),
    )
}

/// Pass 3 of establish_campaign_lore_at's three-pass pipeline. Unlike a
/// generic "improve this" critique — which models tend to answer with mild
/// sycophancy toward their own draft — this is a grounded coverage check:
/// given the same inventory pass 2 drafted from, it asks specifically which
/// inventory entries the draft dropped and whether that was a defensible
/// prioritization (minor/one-off) or an oversight (something recurring that
/// should be there), plus the usual genericness/contradiction/vague-hook
/// checks, then asks for a full revised doc.
fn build_campaign_lore_critique_prompt(draft: &str, inventory: &str) -> String {
    format!(
        "You drafted the campaign-lore doc below from the inventory that follows it, for a Dungeons & Dragons campaign.\n\n\
        Draft:\n{draft}\n\n\
        Inventory it was drafted from:\n{}\n\n\
        Check specifically: which named entries from the inventory are missing from the draft, and for each, is that omission a defensible prioritization (minor, one-off, not worth permanent tracking) or an oversight (something recurring/important that should be there)? Also check for generic fantasy-trope phrasing, anything that contradicts the inventory, and hooks vague enough that they don't actually foreshadow anything specific. Then rewrite the doc to fix any real oversights and sharpen anything generic — keep whatever was already working. Keep the same concise, well-organized markdown-outline style, with length still scaled to how much the inventory actually contains (don't pad a thin inventory just to seem thorough).\n\n\
        {NARRATOR_VOICE_TRAILER_INSTRUCTION} If the draft already ended with a NARRATOR_VOICE line, reconsider it against the revised doc's tone rather than assuming it still fits.\n\n\
        Reply with ONLY the full, revised markdown doc followed by that one NARRATOR_VOICE line, no other commentary, no code fences.",
        if inventory.trim().is_empty() { "(none)" } else { inventory.trim() },
    )
}

/// Impure: pass 1 is now itself potentially several Opus calls, not one (see
/// build_claude_args's doc comment in dm.rs for why one-time ingestion work
/// gets the quality/latency budget a live turn can't afford) — chunked
/// inventory extraction (build_inventory_extraction_prompt, one call per
/// EXTRACTION_CHUNK_MAX_CHARS-sized piece of intake.lore), then draft, then a
/// coverage-checking critique — that together write memory/campaign_lore.md.
/// Returns the final text so the frontend can display/confirm it.
/// Deliberately a fully separate step from create_campaign_at (which stays
/// LLM-free and fast) — called by its own tauri command right after
/// create_campaign succeeds, the same sequential-chaining shape
/// DMConsolePage.tsx already uses for chapterize_and_import_module when a
/// module file was picked during creation.
///
/// Each later pass tolerates the previous *refinement* step failing or
/// coming back empty by falling back to what it already has (an inventory
/// chunk failing just means that chunk's entries are missing — same
/// tolerance as a blank intake.lore, just applied per-chunk now instead of
/// to the pass as a whole; a critique call failing just means the draft
/// ships as-is) — only the pass-2 draft itself is required to succeed and be
/// non-empty, since that's the one piece with no reasonable fallback.
fn establish_campaign_lore_at(root: &Path, id: &str, intake: &CampaignIntake) -> Result<String, String> {
    let inventory = split_into_chunks(&intake.lore, EXTRACTION_CHUNK_MAX_CHARS)
        .iter()
        .filter_map(|chunk| crate::local_llm::ask_ingest_once(build_inventory_extraction_prompt(chunk), Some("opus"), false).ok())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    if !inventory.is_empty() {
        // Best-effort permanent, never-loaded backup of the merged inventory —
        // cheap insurance against pass 2/3 losing something, same reasoning as
        // DEFAULT_HISTORY_MD. A write failure here shouldn't block
        // establishing the campaign's actual lore doc.
        let _ = write_atomic(&root.join(id).join("memory").join("campaign_source_inventory.md"), &inventory);
    }

    let draft = crate::local_llm::ask_ingest_once(build_establish_campaign_prompt(intake, &inventory), Some("opus"), false)?;
    let draft = draft.trim().to_string();
    if draft.is_empty() {
        return Err("Campaign-lore establishment returned empty content.".into());
    }

    let final_lore = crate::local_llm::ask_ingest_once(build_campaign_lore_critique_prompt(&draft, &inventory), Some("opus"), false)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(draft);

    // Strip the NARRATOR_VOICE trailer before saving — it's a machine signal,
    // not part of the lore doc a DM would want to read back later. A missing/
    // malformed trailer (parse_pick is None) just means the narrator keeps
    // using tts.rs's default voice, same tolerance as an unvoiced NPC.
    let (final_lore, voice_pick) = extract_narrator_voice_pick(&final_lore);
    if let Some((voice_id, pitch)) = voice_pick {
        // Best-effort — a campaign with a broken narrator-voice pick should
        // still get its lore doc saved; the narrator just falls back to the
        // default voice at speak time (see tts.rs's ensure_voice_available).
        let _ = set_npc_voice_at(root, id, NARRATOR_VOICE_KEY, &voice_id, pitch.as_deref(), None, false);
    }

    write_atomic(&root.join(id).join("memory").join("campaign_lore.md"), &final_lore)?;
    Ok(final_lore)
}

/// Builds the prompt for folding new material into an ALREADY-established
/// campaign_lore.md — e.g. a sourcebook picked up after the campaign started,
/// or lore that only came up in conversation later. Deliberately a rewrite-
/// and-merge instruction rather than a naive append: campaign_lore.md is a
/// concise, curated doc (see build_establish_campaign_prompt), and blind
/// concatenation would let it grow unbounded and lose the "concise outline"
/// property over many additions. Takes an already-extracted inventory
/// (build_inventory_extraction_prompt) rather than the raw addition text —
/// see update_campaign_lore_at's doc comment for why.
fn build_update_lore_prompt(existing_lore: &str, new_inventory: &str) -> String {
    format!(
        "You previously wrote the overarching campaign-lore doc below for a Dungeons & Dragons campaign. New material has come up that should be folded into it — a sourcebook, a later plot decision, anything the DM wants the persistent frame to account for going forward. Below is an inventory of the named NPCs/factions/locations/threads found in that new material.\n\n\
        Existing campaign-lore doc:\n{existing_lore}\n\n\
        Inventory of new material to fold in:\n{new_inventory}\n\n\
        Rewrite the campaign-lore doc so it incorporates the new material naturally alongside what's still relevant from before — don't just append it as a separate section, weave it in where it fits (a new faction goes with the other factions, a new thread goes with the other plot threads, etc.). Keep the same concise markdown-outline style and length guidance as before (a few hundred words is plenty).\n\n\
        Reply with ONLY the full, updated markdown doc, no other commentary, no code fences.",
    )
}

/// Coverage-checking critique for update_campaign_lore_at's merge — unlike
/// build_campaign_lore_critique_prompt (which only has an inventory to check
/// against, since establish_campaign_lore_at is drafting from a blank slate),
/// a lore UPDATE has two separate things that must survive the merge: every
/// still-relevant entry from the EXISTING doc, and every entry from the new
/// inventory. Checks both explicitly rather than assuming a "weave it in"
/// instruction naturally preserves the old content just because it was told
/// to.
fn build_update_lore_critique_prompt(draft: &str, existing_lore: &str, new_inventory: &str) -> String {
    format!(
        "You merged new material into the campaign-lore doc below for a Dungeons & Dragons campaign, producing the draft that follows.\n\n\
        Original doc before the merge:\n{existing_lore}\n\n\
        Inventory of named entries from the new material that should now be reflected:\n{}\n\n\
        Merged draft:\n{draft}\n\n\
        Check specifically: does the draft still cover everything still-relevant from the original doc, and does it now cover every entry from the new inventory above? For each gap, is the omission a defensible prioritization (superseded, resolved, genuinely minor) or an oversight? Also check for generic fantasy-trope phrasing and hooks vague enough that they don't foreshadow anything specific. Then rewrite the doc to fix any real oversights — keep whatever's already working. Keep the same concise markdown-outline style and length guidance (a few hundred words is plenty).\n\n\
        Reply with ONLY the full, revised markdown doc, no other commentary, no code fences.",
        if new_inventory.trim().is_empty() { "(none)" } else { new_inventory.trim() },
    )
}

/// Impure: folds `addition` into an existing campaign's lore doc via a
/// three-stage pipeline instead of the single Opus call this used to be:
/// extract an inventory from `addition` (map — chunked via split_into_chunks
/// so a large attached sourcebook is never read in one pass, same reasoning
/// as build_chapterize_prompt's doc comment), merge that inventory into the
/// existing doc (reduce, build_update_lore_prompt), then a coverage-checking
/// critique (build_update_lore_critique_prompt) verifying neither the
/// existing doc's own content nor the new inventory got dropped in the
/// merge. This was arguably the least-protected of the app's three one-shot-
/// ingestion calls before this — unlike establish_campaign_lore_at, it had
/// no inventory pass AND no critique pass at all. Extraction is load-bearing
/// (a chunk failing fails the whole update, leaving campaign_lore.md
/// untouched) rather than gracefully degrading like
/// establish_campaign_lore_at's: silently proceeding with a partial/empty
/// inventory here would make an update the DM explicitly asked for look like
/// it succeeded while actually changing nothing, which is worse than a clear
/// error. Backs up the previous doc before overwriting, same as before.
fn update_campaign_lore_at(root: &Path, id: &str, addition: &str) -> Result<String, String> {
    let path = root.join(id).join("memory").join("campaign_lore.md");
    let existing = read_optional(&path);

    let mut chunk_inventories = Vec::new();
    for chunk in split_into_chunks(addition, EXTRACTION_CHUNK_MAX_CHARS) {
        chunk_inventories.push(crate::local_llm::ask_ingest_once(build_inventory_extraction_prompt(&chunk), Some("opus"), false)?);
    }
    let inventory = chunk_inventories.join("\n");

    let draft = crate::local_llm::ask_ingest_once(build_update_lore_prompt(&existing, &inventory), Some("opus"), false)?;
    let draft = draft.trim().to_string();
    if draft.is_empty() {
        return Err("Campaign-lore update returned empty content; leaving campaign_lore.md untouched.".into());
    }

    let lore = crate::local_llm::ask_ingest_once(build_update_lore_critique_prompt(&draft, &existing, &inventory), Some("opus"), false)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(draft);

    backup_before_overwrite(&path);
    write_atomic(&path, &lore)?;
    Ok(lore)
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

/// Writes `content` to `path` by writing a sibling `.tmp` file first and then
/// renaming it over the target. Plain `fs::write` truncates the target before
/// writing the new bytes, so a write interrupted partway through (crash,
/// power loss) leaves a truncated, corrupt memory/module file with no way
/// back; a rename is atomic on both Windows and POSIX, so the target is
/// always either the complete old file or the complete new one, never
/// something in between. Used for every production write in this module
/// (test scaffolding still uses plain `fs::write`, which is fine — it isn't
/// protecting real campaign data).
fn write_atomic(path: &Path, content: &str) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("Invalid file path: {}", path.display()))?;
    let tmp_path = path.with_file_name(format!("{file_name}.tmp"));
    fs::write(&tmp_path, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, path).map_err(|e| e.to_string())
}

/// Copies whatever's currently on disk at `path` to a sibling `.bak` file
/// right before it's about to be overwritten by an LLM rewrite (memory/
/// entity/location compaction, chapter trimming) — a fast, one-step revert
/// on top of full_history.md's append-only content log, which records *what*
/// changed but isn't itself something you can just copy back over a bad
/// rewrite. Best-effort and silent: a missing source file (nothing written
/// yet) isn't an error, and a failed backup shouldn't block the write it's
/// protecting — worst case you lose the one-step revert, not the underlying
/// campaign data (full_history.md still has it).
fn backup_before_overwrite(path: &Path) {
    if let Ok(existing) = fs::read_to_string(path) {
        if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
            let _ = fs::write(path.with_file_name(format!("{file_name}.bak")), existing);
        }
    }
}

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
    write_atomic(&dir.join("CLAUDE.md"), &claude_md)?;
    write_atomic(&dir.join("memory").join("MEMORY.md"), DEFAULT_MEMORY_MD)?;
    write_atomic(&dir.join("memory").join("flagged_facts.md"), DEFAULT_FLAGGED_FACTS_MD)?;
    write_atomic(&dir.join("memory").join("entities.md"), DEFAULT_ENTITIES_MD)?;
    write_atomic(&dir.join("memory").join("locations.md"), DEFAULT_LOCATIONS_MD)?;
    write_atomic(&dir.join("memory").join("party.md"), DEFAULT_PARTY_MD)?;
    write_atomic(&dir.join("memory").join("full_history.md"), DEFAULT_HISTORY_MD)?;
    write_atomic(&dir.join("memory").join("session_index.md"), DEFAULT_SESSION_INDEX_MD)?;
    fs::create_dir_all(dir.join("memory").join(BATTLE_MAPS_DIR)).map_err(|e| e.to_string())?;
    write_atomic(&dir.join("memory").join(BATTLE_MAPS_DIR).join("index.md"), DEFAULT_BATTLE_MAPS_INDEX_MD)?;
    // Seeded here too so a brand-new campaign's very first turn already has the
    // rules — sync_dm_rules_at only runs on load, which is after creation.
    write_atomic(&dir.join("memory").join("dm_rules.md"), DM_RULES)?;
    write_atomic(&dir.join("name.txt"), trimmed)?;
    Ok(CampaignMeta { id, name: trimmed.to_string() })
}

/// Zips a campaign's entire on-disk folder (CLAUDE.md, memory/, any imported
/// modules — everything, byte for byte) to `dest_zip_path`. This is also this
/// app's only backup mechanism: nothing about a campaign lives anywhere else,
/// so a crashed disk with no export taken means that campaign is gone for
/// good — see zip_dir_to's doc comment for the archive format itself.
fn export_campaign_at(root: &Path, id: &str, dest_zip_path: &Path) -> Result<(), String> {
    let dir = root.join(id);
    if !dir.exists() {
        return Err(format!("No campaign found with id \"{id}\"."));
    }
    crate::tts::zip_dir_to(&dir, dest_zip_path)
}

/// Finds a name (and its slug) that doesn't collide with an existing
/// campaign folder under `root`, appending " (2)", " (3)", etc. to `base`
/// until one's free — the same duplicate-naming convention most file
/// managers and browsers already use, so restoring a backup never requires
/// renaming or removing an existing campaign first. Never touches anything
/// itself — just searches — so the campaign `base` might collide with is
/// never at risk from this.
fn dedupe_campaign_name(root: &Path, base: &str) -> (String, String) {
    let id = slugify(base);
    if !root.join(&id).exists() {
        return (base.to_string(), id);
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base} ({n})");
        let candidate_id = slugify(&candidate);
        if !root.join(&candidate_id).exists() {
            return (candidate, candidate_id);
        }
        n += 1;
    }
}

/// Imports a previously-exported campaign zip as a brand-new campaign.
/// Extracts to a scratch directory OUTSIDE campaigns_root first — never
/// directly into it — so a bad zip can be caught and cleaned up without ever
/// leaving a half-written folder next to real campaigns. If the zip's own
/// name collides with an existing campaign, it's auto-renamed with a
/// dedupe_campaign_name suffix rather than rejected: the existing campaign
/// is never touched either way, so there's no data-safety reason to make
/// restoring a backup depend on the user renaming or removing something
/// first. Returns the final name alongside the ORIGINAL name from the zip
/// when a rename actually happened, so the caller can tell the user.
fn import_campaign_at(root: &Path, zip_path: &Path) -> Result<(CampaignMeta, Option<String>), String> {
    let scratch = std::env::temp_dir().join(format!(
        "tavern-sheet-import-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()
    ));
    let _ = fs::remove_dir_all(&scratch);
    let result = (|| {
        crate::tts::extract_zip_to(zip_path, &scratch)?;
        let name = fs::read_to_string(scratch.join("name.txt"))
            .map_err(|_| "That zip doesn't look like a campaign backup (missing name.txt).".to_string())?;
        let original = name.trim().to_string();
        if original.is_empty() {
            return Err("That zip's name.txt is empty.".to_string());
        }
        let (final_name, id) = dedupe_campaign_name(root, &original);
        if final_name != original {
            write_atomic(&scratch.join("name.txt"), &final_name)?;
        }
        let final_dir = root.join(&id);
        fs::rename(&scratch, &final_dir).map_err(|e| format!("Couldn't move the imported campaign into place: {e}"))?;
        let renamed_from = if final_name != original { Some(original) } else { None };
        Ok((CampaignMeta { id, name: final_name }, renamed_from))
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&scratch);
    }
    result
}

/// Appends one dated entry to the never-compacted, never-loaded backup log
/// (see DEFAULT_HISTORY_MD) — called alongside every write to MEMORY.md/
/// entities.md/locations.md so nothing is ever truly lost even if a later
/// compaction/trim pass paraphrases or drops something that mattered.
/// Best-effort: a failure here should never block the actual memory write
/// it's backing up, so callers log a warning rather than propagate the error.
fn append_to_history_at(root: &Path, id: &str, entry: &str) -> Result<(), String> {
    let path = root.join(id).join("memory").join("full_history.md");
    let mut existing = read_optional(&path);
    existing.push_str(entry.trim());
    existing.push('\n');
    write_atomic(&path, &existing)
}

fn append_session_recap_at(root: &Path, id: &str, date: &str, recap: &str) -> Result<(), String> {
    let path = root.join(id).join("memory").join("MEMORY.md");
    let mut existing = fs::read_to_string(&path).unwrap_or_default();
    existing.push_str(&format!("\n## Session — {date}\n{}\n", recap.trim()));
    write_atomic(&path, &existing)?;
    let _ = append_to_history_at(root, id, &format!("[{date}] Session recap: {}", recap.trim()));
    Ok(())
}

// ── Session digest + retrieval (see the module doc comment) ──────────────────
//
// The end-of-session capture path used to be a single sonnet-low call that
// wrote a 3-4 sentence MEMORY.md recap AND tried to catch any NPC/place a live
// turn missed — the same "one cheap call doing summarization + extraction
// together" shape build_chapterize_prompt's doc comment describes as the
// single-pass-loses-detail failure mode. This replaces it with an Opus
// map-reduce over the session's VERBATIM transcript: extract durable facts
// into the always-loaded registries, save the raw transcript losslessly for
// on-demand retrieval, and emit one compact line into the always-loaded
// session_index.md so no session is ever fully forgotten.

/// Extraction ("map") pass over ONE chunk of a verbatim session transcript.
/// Deliberately structured JSON (not prose) — the whole point is reliable
/// fact capture, not a readable summary, so it returns the same
/// entity/location/fact shapes the live dm-actions already upsert, plus one
/// short summary fragment for the session_index line. The transcript labels
/// player-character lines with their names, so the prompt can tell PCs (which
/// must NEVER be logged as entities — see BASE_CLAUDE_MD) from NPCs.
fn build_session_digest_prompt(transcript_chunk: &str) -> String {
    format!(
        "Below is the verbatim transcript of one section of a Dungeons & Dragons session — what the DM narrated and what the players said, in order. Player-character lines are labelled with the character's name. Extract the durable facts a DM must not forget, so they can be saved into the campaign's permanent memory. Extract — do not write a narrative retelling.\n\n\
        Reply with ONLY a single JSON object, no markdown fences, no commentary, in exactly this shape:\n\
        {{\"entities\": [{{\"name\": \"<NPC/faction/creature name>\", \"description\": \"<short standalone current-state summary: role, what they want, any secret, a speech quirk>\"}}], \"locations\": [{{\"name\": \"<place name>\", \"description\": \"<short standalone summary of the place and its current state>\"}}], \"facts\": [\"<a standalone promise/secret/consequence not tied to one named person or place>\"], \"summary\": \"<ONE sentence: what happened in this section and where the party ended up>\"}}\n\n\
        Rules:\n\
        - NEVER include a player character (the people whose lines are labelled with their name in the transcript) as an entity — only NPCs, factions, and creatures.\n\
        - Include an NPC even if they never gave a proper name but spoke to the party or clearly matters; give them a name specific enough to be unique (anchor it to a place or trait, e.g. \"Blind Elder of Fogreach\", not a bare role like \"Old Man\"), since these are upserted by name and a generic label would overwrite a different NPC.\n\
        - Err toward including a borderline fact rather than dropping it — a redundant entry is harmless (upserted by name), a missed one is gone.\n\
        - Use empty arrays for anything with nothing to report. Never invent anything not actually in the transcript.\n\n\
        Transcript:\n{transcript_chunk}"
    )
}

#[derive(Deserialize, Default)]
struct SessionDigestNamed {
    name: String,
    #[serde(default)]
    description: String,
}

#[derive(Deserialize, Default)]
struct SessionDigest {
    #[serde(default)]
    entities: Vec<SessionDigestNamed>,
    #[serde(default)]
    locations: Vec<SessionDigestNamed>,
    #[serde(default)]
    facts: Vec<String>,
    #[serde(default)]
    summary: String,
}

/// Tolerant parse of one digest chunk's reply — strips stray markdown fences
/// (same defense as parse_chapterize_reply) and, on anything unparseable,
/// returns an empty digest rather than erroring: a chunk that produced no
/// usable JSON simply contributes nothing, exactly the per-chunk
/// graceful-degradation establish_campaign_lore_at's inventory pass uses.
fn parse_session_digest(reply: &str) -> SessionDigest {
    let mut s = reply.trim();
    if let Some(rest) = s.strip_prefix("```json") {
        s = rest;
    } else if let Some(rest) = s.strip_prefix("```") {
        s = rest;
    }
    if let Some(rest) = s.strip_suffix("```") {
        s = rest;
    }
    serde_json::from_str(s.trim()).unwrap_or_default()
}

/// Whether `id` is a well-formed `session-NN` id — the ONLY shape
/// digest_session_at ever mints and the ONLY shape read_session_record_at
/// will resolve to a file. Since a `recallSession` id comes from the DM's
/// (untrusted) output, this is also the path-traversal guard: no slashes,
/// dots, or `..` can pass, so the id can never escape the session_records
/// directory when joined to a path.
fn is_valid_session_id(id: &str) -> bool {
    id.strip_prefix("session-")
        .is_some_and(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
}

/// Next `session-NN` id for this campaign — one past the highest-numbered
/// existing record file, so ids are stable and monotonic even if a record is
/// ever manually removed. Zero-padded to two digits for readable ordering
/// (session-01, session-02, ...), widening naturally past 99.
fn next_session_id_at(root: &Path, id: &str) -> String {
    let dir = root.join(id).join(SESSION_RECORDS_DIR);
    let highest = fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            e.file_name()
                .to_str()
                .and_then(|n| n.strip_suffix(".md"))
                .and_then(|n| n.strip_prefix("session-"))
                .and_then(|n| n.parse::<u32>().ok())
        })
        .max()
        .unwrap_or(0);
    format!("session-{:02}", highest + 1)
}

/// Appends one compact line to the always-loaded session_index.md — the
/// retrieval index's human/DM-facing half. `session-NN` id first so the DM
/// can copy it verbatim into a `recallSession` action.
fn append_session_index_line_at(root: &Path, id: &str, session_id: &str, date: &str, summary: &str) -> Result<(), String> {
    let path = root.join(id).join("memory").join("session_index.md");
    let mut existing = read_optional(&path);
    if existing.is_empty() {
        existing = DEFAULT_SESSION_INDEX_MD.to_string();
    }
    existing.push_str(&format!("- **{session_id}** ({date}): {}\n", summary.trim()));
    write_atomic(&path, &existing)
}

/// The digest pipeline (see the block comment above). Saves the verbatim
/// transcript losslessly to session_records/<session-NN>.md (the retrieval
/// target), runs a chunked Opus extraction over it, upserts every found
/// entity/location/fact into the always-loaded registries (reusing the exact
/// same helpers the live dm-actions do, so full_history logging comes for
/// free), and appends one line to session_index.md. Returns the joined
/// summary so the caller can also use it for the short MEMORY.md recap.
///
/// Per-chunk extraction degrades gracefully (a failed/garbled chunk just
/// contributes nothing, same as establish_campaign_lore_at) rather than
/// failing the whole digest — losing a session's capture entirely because one
/// chunk erred would be worse than a partial capture, and the verbatim
/// transcript is saved regardless, so nothing is ever truly lost even then.
fn digest_session_at(root: &Path, id: &str, date: &str, transcript: &str) -> Result<String, String> {
    if transcript.trim().is_empty() {
        return Err("Nothing to digest — the session transcript is empty.".into());
    }
    let records_dir = root.join(id).join(SESSION_RECORDS_DIR);
    fs::create_dir_all(&records_dir).map_err(|e| e.to_string())?;
    let session_id = next_session_id_at(root, id);
    // Save the raw transcript first, before any LLM work — this is the
    // lossless record, so it must exist even if every extraction chunk fails.
    write_atomic(&records_dir.join(format!("{session_id}.md")), &format!("# {session_id} ({date})\n\n{}\n", transcript.trim()))?;

    let mut summaries = Vec::new();
    for chunk in split_into_chunks(transcript, EXTRACTION_CHUNK_MAX_CHARS) {
        let Ok(reply) = crate::local_llm::ask_ingest_once(build_session_digest_prompt(&chunk), Some("opus"), true) else {
            continue;
        };
        let digest = parse_session_digest(&reply);
        for e in &digest.entities {
            if !e.name.trim().is_empty() {
                let _ = upsert_named_fact_at(root, id, "entities.md", &e.name, &e.description);
            }
        }
        for l in &digest.locations {
            if !l.name.trim().is_empty() {
                let _ = upsert_named_fact_at(root, id, "locations.md", &l.name, &l.description);
            }
        }
        for f in &digest.facts {
            if !f.trim().is_empty() {
                let _ = append_memory_note_at(root, id, date, f);
            }
        }
        if !digest.summary.trim().is_empty() {
            summaries.push(digest.summary.trim().to_string());
        }
    }

    let summary = if summaries.is_empty() { "(session recorded — no summary produced)".to_string() } else { summaries.join(" ") };
    append_session_index_line_at(root, id, &session_id, date, &summary)?;
    // Keep the active module's arc plan honest about what actually happened —
    // see reconcile_module_plan_at. Best-effort: this must never fail the
    // digest, since the session's facts are already safely captured above.
    let _ = reconcile_module_plan_at(root, id, &summary);
    Ok(summary)
}

/// Revises a module's arc plan against what ACTUALLY happened this session.
///
/// The problem this fixes: plan.md is written once at ingestion and, before
/// this, was never revised again — while DMConsolePage's periodic "campaign-arc
/// plan check-in" (PLAN_CHECK_INTERVAL) keeps re-injecting it into the DM's
/// prompt every few turns for the campaign's whole life. That's a one-way
/// ratchet: MEMORY.md gets compacted as it ages (see build_compact_memory_prompt),
/// so the record of the party ABANDONING a plotline fades over time, while the
/// plan's instruction to pursue it stays pristine forever — the stale plan gets
/// relatively louder as the memory of the divergence gets quieter.
///
/// Note what this is NOT for: hard contradictions are already handled without
/// it. entities.md is upserted with each NPC's *current* state, so a plan
/// saying "Vera betrays them in chapter 3" against an entities.md saying "Vera:
/// killed at Redstone Bridge" is a conflict any decent model resolves in favor
/// of the registry. The gap is that the plan is the ONLY thing in the DM's
/// entire context that speaks to *direction* — pacing, what to foreshadow,
/// which NPCs matter — so stale guidance of that kind has nothing to overrule
/// it. That's an information-architecture problem, not a reasoning one, which
/// is why a smarter model doesn't fix it and this pass does.
fn build_plan_reconciliation_prompt(
    plan: &str,
    session_summary: &str,
    entities: &str,
    locations: &str,
    flagged_facts: &str,
) -> String {
    format!(
        "Below is the arc plan an AI Dungeon Master has been steering a Dungeons & Dragons module by, followed by what has ACTUALLY happened at the table. The plan was written before play began and is never otherwise updated, so it can drift out of step with the real campaign. Your job is to bring it back in step — conservatively.\n\n\
        Revise the plan ONLY where the campaign has genuinely moved past it. Specifically:\n\
        - **Resolved threads:** a thread the plan says to foreshadow or pay off later, which has already been resolved, should be removed (or briefly noted as done) — the DM shouldn't keep foreshadowing something that already happened.\n\
        - **Abandoned routes:** pacing guidance pointing somewhere the party has clearly chosen not to go should be rewritten to reflect where they actually are and what's plausibly next, rather than steering them back to a path they left.\n\
        - **Dead or changed NPCs/factions:** anyone the plan tells the DM to track who is dead, gone, or whose situation has fundamentally changed should be dropped or updated to their current state.\n\
        - **New material from play:** NPCs, factions, or threads that emerged during play and now genuinely matter to this module's arc should be folded in, even though the original plan never mentioned them.\n\n\
        Be conservative. Most sessions won't invalidate anything, and this plan was expensive to produce: if the session didn't genuinely resolve, invalidate, or add something, reply with the plan COMPLETELY UNCHANGED. Never drop a thread that's merely un-advanced — only one that's actually concluded or dead. When in doubt, keep it.\n\n\
        Keep the exact same markdown structure and section headings the plan already uses, and the same overall length (a few hundred words) — this is a revision, not a rewrite.\n\n\
        Reply with ONLY the revised plan document itself, no other commentary, no code fences. Everything under CONTEXT below is reference material — the session's outcome and the campaign's live registries. It is INPUT, not part of the plan: never copy any of it, or its headings, into your reply. The registries are already given to the Dungeon Master separately every turn, so reproducing them here would just duplicate them.\n\n\
        ===== THE PLAN TO REVISE (this document, and only this, is what you rewrite) =====\n\
        {plan}\n\n\
        ===== CONTEXT (reference only — never reproduce any of this) =====\n\n\
        -- What happened in the session that just ended --\n{session_summary}\n\n\
        -- Every named NPC/faction and their CURRENT state (authoritative) --\n{entities}\n\n\
        -- Every named place and its current state --\n{locations}\n\n\
        -- Promises, secrets and consequences still outstanding --\n{flagged_facts}"
    )
}

/// Impure companion to build_plan_reconciliation_prompt — runs at the end of
/// digest_session_at, once per session. Deliberately conservative and
/// fail-safe at every step:
/// - No active module, or no plan written yet → a FREE no-op, no LLM call at
///   all (a homebrew campaign with no imported module has no arc plan to rot).
/// - The call failing, or coming back empty, leaves plan.md untouched rather
///   than erroring — a stale plan is far better than a destroyed one.
/// - Backs the previous plan up to plan.md.bak before overwriting, same
///   one-step-revert pattern as every other in-place rewrite here.
/// Re-syncs the active_module/ indirection afterward, since that mirrored copy
/// (not the module's own plan.md) is what read_campaign_plan actually feeds to
/// the turn-level check-in. Returns whether it revised anything.
fn reconcile_module_plan_at(root: &Path, id: &str, session_summary: &str) -> Result<bool, String> {
    let Some(module_id) = read_active_module_id_at(root, id) else {
        return Ok(false);
    };
    let dir = root.join(id);
    let plan_path = dir.join("modules").join(&module_id).join("plan.md");
    let plan = read_optional(&plan_path);
    if plan.trim().is_empty() {
        return Ok(false);
    }

    let memory_dir = dir.join("memory");
    let prompt = build_plan_reconciliation_prompt(
        &plan,
        session_summary,
        &read_optional(&memory_dir.join("entities.md")),
        &read_optional(&memory_dir.join("locations.md")),
        &read_optional(&memory_dir.join("flagged_facts.md")),
    );
    let revised = crate::local_llm::ask_ingest_once(prompt, Some("opus"), false)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let Some(revised) = revised else {
        return Ok(false);
    };

    backup_before_overwrite(&plan_path);
    write_atomic(&plan_path, &revised)?;
    sync_active_module_indirection_at(root, id, &module_id)?;
    Ok(true)
}

/// Reads back one session's lossless verbatim record for the `recallSession`
/// dm-action. Validates `session_id` is a well-formed `session-NN` (the
/// path-traversal guard — see is_valid_session_id) before touching the
/// filesystem, and returns a clear, DM-readable message for an unknown id
/// rather than erroring, so a hallucinated/typo'd id just tells the DM the
/// record wasn't found instead of failing the turn.
fn read_session_record_at(root: &Path, id: &str, session_id: &str) -> Result<String, String> {
    if !is_valid_session_id(session_id) {
        return Ok(format!("No session record found for \"{session_id}\" (not a valid session id)."));
    }
    let path = root.join(id).join(SESSION_RECORDS_DIR).join(format!("{session_id}.md"));
    match fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        Err(_) => Ok(format!("No session record found for \"{session_id}\".")),
    }
}

/// A single flagged fact (dm-actions `remember`), appended immediately rather
/// than waiting for session end — this is the cross-chapter/cross-session
/// recall mechanism: it lands in memory/flagged_facts.md (see
/// DEFAULT_FLAGGED_FACTS_MD for why that's a separate file from MEMORY.md),
/// which loads every turn regardless of which module chapter is currently
/// active, and is never handed to compact_memory_if_needed_at.
fn append_memory_note_at(root: &Path, id: &str, date: &str, note: &str) -> Result<(), String> {
    let path = root.join(id).join("memory").join("flagged_facts.md");
    let mut existing = read_optional(&path);
    existing.push_str(&format!("- **{date}:** {}\n", note.trim()));
    write_atomic(&path, &existing)?;
    let _ = append_to_history_at(root, id, &format!("[{date}] Remembered: {}", note.trim()));
    Ok(())
}

/// Brings any campaign — including one created many app versions ago — up to
/// the current DM rules. Two steps, both idempotent, so this is safe to run on
/// every single campaign load:
///
/// 1. Overwrite memory/dm_rules.md with DM_RULES. It's generated, not authored,
///    so there's nothing of the DM's to preserve and no backup is taken.
/// 2. Append the `@memory/dm_rules.md` import to CLAUDE.md if it isn't already
///    there. Campaigns created before this existed have no import line; ones
///    created after get it from BASE_CLAUDE_MD and skip the append. This only
///    ever ADDS a line, never rewrites CLAUDE.md's body, so the DM's own
///    hand-edits (Notes dialog) survive untouched.
///
/// A missing CLAUDE.md is an error rather than a silent skip — that would mean
/// a corrupt campaign folder, and swallowing it would leave the DM reading no
/// rules at all with nothing to show for it.
fn sync_dm_rules_at(root: &Path, id: &str) -> Result<(), String> {
    let dir = root.join(id);
    write_atomic(&dir.join("memory").join("dm_rules.md"), DM_RULES)?;
    let claude_path = dir.join("CLAUDE.md");
    let mut claude_md = fs::read_to_string(&claude_path).map_err(|e| e.to_string())?;
    if !claude_md.contains("@memory/dm_rules.md") {
        claude_md.push_str(DM_RULES_IMPORT_LINE);
        write_atomic(&claude_path, &claude_md)?;
    }
    Ok(())
}

/// Brings a campaign created before the session-index/retrieval system existed
/// up to date, idempotently (safe on every load, same as sync_dm_rules_at).
/// Two steps: (1) CREATE memory/session_index.md if it's missing — critically,
/// create-only, NEVER overwrite, since unlike dm_rules.md this file
/// accumulates real per-session data that must survive; (2) add the
/// `@memory/session_index.md` standing import to CLAUDE.md if absent. A
/// missing CLAUDE.md is an error, same reasoning as sync_dm_rules_at.
fn sync_session_index_at(root: &Path, id: &str) -> Result<(), String> {
    let dir = root.join(id);
    let index_path = dir.join("memory").join("session_index.md");
    if !index_path.exists() {
        write_atomic(&index_path, DEFAULT_SESSION_INDEX_MD)?;
    }
    let claude_path = dir.join("CLAUDE.md");
    let mut claude_md = fs::read_to_string(&claude_path).map_err(|e| e.to_string())?;
    if !claude_md.contains("@memory/session_index.md") {
        claude_md.push_str(SESSION_INDEX_IMPORT_LINE);
        write_atomic(&claude_path, &claude_md)?;
    }
    Ok(())
}

/// Pure: finds the flagged-fact bullet line matching `fact` (case-insensitive
/// substring — the DM is instructed to copy the fact's text verbatim, but
/// this tolerates it quoting just the distinctive part) and removes it,
/// returning the remaining content plus the removed line. Deliberately
/// conservative, mirroring resolveChapterSection's design: requires exactly
/// ONE bullet line to match — zero matches or an ambiguous several return
/// None and the file stays untouched, since wrongly resolving a still-live
/// promise is real loss while a missed resolution just means the fact hangs
/// around a little longer, which is harmless.
fn remove_flagged_fact(content: &str, fact: &str) -> Option<(String, String)> {
    let needle = fact.trim().to_lowercase();
    if needle.is_empty() {
        return None;
    }
    let matches: Vec<&str> = content
        .lines()
        .filter(|line| line.trim_start().starts_with("- ") && line.to_lowercase().contains(&needle))
        .collect();
    let [only_match] = matches[..] else { return None };
    let removed = only_match.to_string();
    let remaining: String = content
        .lines()
        .filter(|line| *line != only_match)
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    Some((remaining, removed))
}

/// Impure: moves one concluded flagged fact out of the always-loaded
/// flagged_facts.md into memory/resolved_facts.md (never imported by
/// CLAUDE.md — same zero-context-cost reasoning as full_history.md). This is
/// the lifecycle piece flagged_facts.md needs to stay useful over 100+
/// sessions: promises get fulfilled and secrets get revealed, and without
/// this every stale, long-concluded fact keeps loading on every turn forever.
/// Resolution is DM-driven (the `resolveFact` dm-action), never a compaction
/// pass — so the "never lossily compacted" guarantee still holds; facts only
/// leave when the DM explicitly says the story concluded them, and even then
/// they land in resolved_facts.md + full_history.md rather than vanishing.
/// Returns whether anything was actually moved (false = no/ambiguous match,
/// deliberately tolerated — see remove_flagged_fact). `date` comes from the
/// frontend, same as append_memory_note_at — there's no date dependency in
/// this crate and no reason to add one for a YYYY-MM-DD string.
fn resolve_flagged_fact_at(root: &Path, id: &str, date: &str, fact: &str) -> Result<bool, String> {
    let path = root.join(id).join("memory").join("flagged_facts.md");
    let current = read_optional(&path);
    let Some((remaining, removed)) = remove_flagged_fact(&current, fact) else {
        return Ok(false);
    };
    let resolved_path = root.join(id).join("memory").join("resolved_facts.md");
    let mut resolved = read_optional(&resolved_path);
    if resolved.trim().is_empty() {
        resolved = "# Resolved Facts\n\n_Flagged facts the DM has marked as concluded (promise fulfilled, secret revealed, consequence played out) — moved here from flagged_facts.md so they stop loading every turn. Never loaded by the DM; kept purely as a record._\n".to_string();
    }
    resolved.push_str(&format!("- **[resolved {date}]** {}\n", removed.trim_start_matches("- ").trim()));
    write_atomic(&resolved_path, &resolved)?;
    write_atomic(&path, &remaining)?;
    let _ = append_to_history_at(root, id, &format!("[{date}] Resolved fact: {}", removed.trim_start_matches("- ").trim()));
    Ok(true)
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

/// Extracts just the description portion of an existing entry for `name`,
/// if present — used only to log a before/after pair in full_history.md
/// when an entry gets overwritten (see `upsert_named_fact_at`).
fn find_entry_description(content: &str, name: &str) -> Option<String> {
    let idx = find_entry_line_index(content, name)?;
    let line = content.lines().nth(idx)?;
    line.split("**").nth(2).map(|s| s.trim().to_string())
}

/// Pure: parses entities.md's `- **Name:** description` lines back into
/// (name, description) pairs — the inverse of `format_entry`. Feeds
/// `reconcile_npc_voices_at`'s "which named NPCs exist at all" step. Lines
/// that don't match the expected shape (headers, blank lines, the file's own
/// intro blurb) are skipped rather than erroring.
fn parse_entities_md(content: &str) -> Vec<(String, String)> {
    content
        .lines()
        .filter_map(|line| {
            let rest = line.trim().strip_prefix("- **")?;
            let (name, desc) = rest.split_once(":**")?;
            Some((name.trim().to_string(), desc.trim().to_string()))
        })
        .collect()
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
    let previous_description = find_entry_description(&existing, name);
    let updated = upsert_named_fact(&existing, name, description);
    write_atomic(&path, &updated)?;

    let history_entry = match previous_description {
        Some(old) => format!("[{filename}] {name}: \"{old}\" → \"{}\"", description.trim()),
        None => format!("[{filename}] {name}: (new) \"{}\"", description.trim()),
    };
    let _ = append_to_history_at(root, id, &history_entry);
    Ok(())
}

/// Pure: lowercases+trims a name for case-insensitive comparison — the same
/// matching entities.md's own upsert already relies on (find_entry_line_index),
/// so e.g. a later "gundren" from ordinary narration still resolves to
/// whatever voice was assigned to "Gundren Rockseeker". Used as a key for
/// npc_voices.json, dropped_entity_names' before/after diff, and
/// reconcile_campaign_hooks_at's "already has a hook" ledger — general
/// enough by now that it's named for what it does, not any one caller.
fn normalize_name_key(name: &str) -> String {
    name.trim().to_lowercase()
}

/// Reserved npc_voices.json key for the campaign's own narrator (plain-
/// narration) voice pick — see extract_narrator_voice_pick /
/// establish_campaign_lore_at. Double-underscore-wrapped and lowercase
/// already, so it can never collide with a real NPC name normalized through
/// normalize_name_key (no player is going to name an NPC "__narrator__").
/// Reusing npc_voices.json rather than a new file means the frontend needs
/// no new fetch/store — DMConsolePage's existing npcVoicesRef map already
/// gets read once per campaign switch and consulted per spoken line; it just
/// also checks this one reserved key when a line has no NPC speaker tag.
const NARRATOR_VOICE_KEY: &str = "__narrator__";

/// One NPC's voice assignment — a Kokoro voice id plus an optional race/size
/// pitch tag (`"small"`/`"large"`, see tts.rs's pitch_factor) and an optional
/// speaking-rate override (`speed`, this app's own pace-factor convention —
/// see tts.rs's DEFAULT_PACE_FACTOR — independent of pitch, pure pace).
/// Neither is validated
/// against a specific set/range here; an unrecognized pitch tag or absent
/// speed just falls back to no shift / the default rate at speak time, same
/// tolerance as an unrecognized voice_id falling back to the narrator voice.
/// `#[serde(default)]` on `speed` keeps this backward-compatible with an
/// npc_voices.json written before this field existed. This struct itself
/// doesn't enforce it (the manual override panel can still set both if a
/// human wants to), but the DM's own auto-assignment (BASE_CLAUDE_MD /
/// build_voice_reconciliation_prompt) is told to never pair `pitch` with a
/// race-flavored `voice_id` (tts.rs's ARCHETYPE_VOICES) — those clips are
/// already recorded at the right pitch/accent for their race, so a `pitch`
/// tag on top would double up and distort an already-tuned voice.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct NpcVoiceAssignment {
    pub voice_id: String,
    #[serde(default)]
    pub pitch: Option<String>,
    #[serde(default)]
    pub speed: Option<f64>,
}

/// name→assignment map for NPCs the DM has assigned a distinct voice to (see
/// BASE_CLAUDE_MD's "Giving NPCs distinct voices" section) — a separate,
/// small, structured JSON file rather than folding this into entities.md's
/// free-text description, since the frontend needs a fast, exact lookup by
/// name during live sentence-by-sentence playback, not a prose parse. Empty
/// map (not an error) when nothing's been assigned yet.
fn read_npc_voices_at(root: &Path, id: &str) -> HashMap<String, NpcVoiceAssignment> {
    let path = root.join(id).join("memory").join("npc_voices.json");
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Upserts one NPC's voice assignment — called from `rememberEntity`'s
/// handling in DMConsolePage.tsx whenever a turn's dm-actions entry includes
/// a `voiceId`, and from the History dialog's manual voice-override panel
/// (which is also the only caller that ever passes a `speed`, since Claude's
/// own dm-actions schema has no speed concept — see BASE_CLAUDE_MD). Silently
/// overwrites any previous assignment for that name, `speed` included
/// (BASE_CLAUDE_MD asks the DM to treat voice assignments as permanent and
/// not re-send one once made, but nothing here enforces that — a later call
/// just wins, same "last write wins" shape as upsert_named_fact and the same
/// pre-existing risk pitch already carried: a resent voiceId with no speed
/// would clear a manually-set speed override, exactly as it already could
/// clear a manually-set pitch).
/// `enforce_unique` resolves a collision instead of accepting one — see
/// pick_non_colliding_voice. True for machine-chosen ids (the DM's inline
/// `voiceId`, the Opus reconciliation pass); false for the manual override
/// panel, where a human deliberately picking a duplicate is their business.
fn set_npc_voice_at(
    root: &Path,
    id: &str,
    name: &str,
    voice_id: &str,
    pitch: Option<&str>,
    speed: Option<f64>,
    enforce_unique: bool,
) -> Result<String, String> {
    let path = root.join(id).join("memory").join("npc_voices.json");
    let mut map = read_npc_voices_at(root, id);
    let pitch = pitch.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    let key = normalize_name_key(name);
    let voice_id = if enforce_unique {
        pick_non_colliding_voice(&map, &key, voice_id.trim())
    } else {
        voice_id.trim().to_string()
    };
    map.insert(key, NpcVoiceAssignment { voice_id: voice_id.clone(), pitch, speed });
    write_atomic(&path, &serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?)?;
    // The id actually written, which dedupe may have moved off the request —
    // the frontend caches this map locally for the hot playback path, so it
    // must learn the real value rather than the one it asked for.
    Ok(voice_id)
}

/// Pure: `requested` unless another NPC already holds it, in which case the
/// first free id in the same gender/accent bucket (see tts::sibling_voice_ids).
///
/// Nothing used to enforce this. The reconciliation prompt merely *asks* Opus
/// to vary its picks, and a `voiceId` the DM sends inline was written through
/// as-is — so a real campaign ended up with `father carrow` and `tomas` both on
/// `male-gb-2`, and `mera` and `yara` both on `female-us-2`. Two NPCs sharing a
/// voice is silent until they share a scene, and then it's indistinguishable
/// from the voice system being broken.
///
/// The narrator occupies a key in this same map, so its voice is in `taken`
/// too: an NPC can never be handed the narration's own voice. When the whole
/// bucket is spoken for, `requested` wins — a duplicate beats a wrong-gender
/// voice, and beats failing a turn over cosmetics.
fn pick_non_colliding_voice(
    existing: &HashMap<String, NpcVoiceAssignment>,
    name_key: &str,
    requested: &str,
) -> String {
    let taken: HashSet<&str> = existing
        .iter()
        .filter(|(k, _)| k.as_str() != name_key)
        .map(|(_, v)| v.voice_id.as_str())
        .collect();
    if !taken.contains(requested) {
        return requested.to_string();
    }
    crate::tts::sibling_voice_ids(requested)
        .into_iter()
        .find(|candidate| !taken.contains(candidate))
        .unwrap_or(requested)
        .to_string()
}

/// Builds the one-time Opus prompt for the periodic voice-reconciliation
/// pass (see reconcile_npc_voices_at) — given a batch of named NPCs that
/// don't have a voice assigned yet (name + their entities.md description),
/// asks Claude to pick a voice_id (gender/social-register based) and
/// optional pitch (race/size based) for each. Same catalog and criteria as
/// BASE_CLAUDE_MD's "Giving NPCs distinct voices" section, but with actual
/// room to reason about each one — unlike a live turn, where this is
/// squeezed in alongside damage/conditions/memory/chapter tracking.
/// Pure: counts how many NPCs currently use each voice_id, formatted for
/// build_voice_reconciliation_prompt (e.g. "male-us-1 (x3), female-gb-1
/// (x1)") — lets that prompt actually see the current distribution across
/// the whole roster (not just the unvoiced batch) so it can favor under-used
/// ids in a gender/register bucket instead of always reaching for the first-
/// listed one. Empty string (not an error) when nothing's assigned yet.
fn summarize_voice_usage(existing: &HashMap<String, NpcVoiceAssignment>) -> String {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for assignment in existing.values() {
        *counts.entry(assignment.voice_id.as_str()).or_insert(0) += 1;
    }
    let mut parts: Vec<String> = counts.into_iter().map(|(id, n)| format!("{id} (x{n})")).collect();
    parts.sort();
    parts.join(", ")
}

/// `usage_summary` (see summarize_voice_usage) is empty for a campaign's
/// first-ever reconciliation batch, in which case the prompt just omits that
/// paragraph rather than presenting an awkward "currently in use: (nothing)".
fn build_voice_reconciliation_prompt(unvoiced: &[(String, String)], usage_summary: &str) -> String {
    let listing = unvoiced.iter().map(|(name, desc)| format!("- {name}: {desc}")).collect::<Vec<_>>().join("\n");
    let usage_block = if usage_summary.trim().is_empty() {
        String::new()
    } else {
        format!("\nVoices already in use across this campaign's roster: {usage_summary}. Favor a less-used id within the right gender/accent bucket over a heavily-reused one, so NPCs don't start blending together — but never let variety override picking the bucket that actually fits the NPC.\n")
    };
    format!(
        "You are assigning text-to-speech voices to Dungeons & Dragons NPCs so players at the table can tell speakers apart by ear. For each NPC below, read their description and pick:\n\n\
        1. `voice_id` — from this catalog: `male-us-1` through `male-us-9` / `female-us-1` through `female-us-10` (American); `male-gb-1` through `male-gb-4` / `female-gb-1` through `female-gb-4` (English, posher/more formal). The gender prefix is a hard constraint: a male NPC MUST get a `male-*` id and a female NPC MUST get a `female-*` id — a wrong-gender voice is the most jarring mistake possible here, far worse than a bland-but-correct pick; if a description leaves gender genuinely ambiguous, pick whichever reading the name/pronouns/context best support rather than ignoring gender. Never invent an id outside this list — only American and British English exist in this catalog, nothing more regionally specific. Several ids exist per bucket specifically so same-gender NPCs don't all sound identical — when assigning several NPCs in this same batch, spread them across the different ids rather than defaulting everyone to the same one or two.\n\
        For an NPC whose D&D race or nature strongly suggests a signature voice, use a race-flavored id instead: `orc-m-1`-`orc-m-5`/`orc-f-1`-`orc-f-5` (orcs, monstrous humanoids); `giant-m-1`-`giant-m-5`/`giant-f-1`-`giant-f-5` (ogres, trolls, giants); `dwarf-m-1`-`dwarf-m-5`/`dwarf-f-1`-`dwarf-f-5` (thick Scottish accent); `elf-m-1`-`elf-m-5`/`elf-f-1`-`elf-f-5` (refined, light); `gnome-m-1`-`gnome-m-5`/`gnome-f-1`-`gnome-f-5` (quick, high-pitched); `halfling-m-1`-`halfling-m-5`/`halfling-f-1`-`halfling-f-5` (warm, folksy); `sinister-m-1`-`sinister-m-5`/`sinister-f-1`-`sinister-f-5` (a cold or villainous character); `sage-m-1`-`sage-m-5`/`sage-f-1`-`sage-f-5` (a venerable elder — the closest this pool has to genuinely old, so don't use it for merely \"older\"). Same hard gender constraint applies. These fall back sensibly if the high-quality engine isn't enabled, so use them freely for a clearly-matching NPC rather than defaulting everyone to the plain catalog.\n\
        2. `pitch` (optional, **plain voices only**) — if and only if you picked a plain catalog id above (not a race-flavored one), you may add a pitch tier based on their actual D&D size and build, NOT gender: `\"small\"` for a Small (or Tiny) creature (gnomes, halflings, kobolds, most fey); `\"large\"` for an actually Large-or-bigger creature (ogres, trolls, hill giants and up, most adult dragons); `\"gruff\"` for a Medium-size race that still naturally reads as rougher/deeper-voiced (orcs, half-orcs, goliaths, firbolgs, bugbears, hobgoblins, and similar) — a milder version of `\"large\"`'s shift, since they aren't mechanically Large. Omit entirely (or use null) for an ordinary Medium NPC with nothing distinctive about their build. **Never set `pitch` alongside a race-flavored voice_id** (`orc-*`/`giant-*`/`dwarf-*`/etc.) — those clips are already recorded at the right pitch and accent for their race, and layering a pitch tag on top over-shoots and distorts an already-tuned voice.\n\
        {usage_block}\n\
        If a description doesn't give you quite enough to judge, make the most reasonable guess rather than skipping the NPC — every name below needs an assignment.\n\n\
        NPCs:\n{listing}\n\n\
        Reply with ONLY a JSON object, no other text, no markdown code fences:\n\
        {{\"assignments\": [{{\"name\": \"<exact name as given above>\", \"voice_id\": \"<id from the list>\", \"pitch\": \"small\"|\"gruff\"|\"large\"|null}}]}}"
    )
}

#[derive(Deserialize, Clone, Debug)]
struct VoiceAssignmentEntry {
    name: String,
    #[serde(default)]
    voice_id: String,
    #[serde(default)]
    pitch: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
struct VoiceReconciliationReply {
    #[serde(default)]
    assignments: Vec<VoiceAssignmentEntry>,
}

/// Parses the voice-reconciliation reply, tolerating stray markdown code
/// fences around the JSON — same defensive shape as parse_chapterize_reply.
fn parse_voice_reconciliation_reply(reply: &str) -> Result<VoiceReconciliationReply, String> {
    let mut s = reply.trim();
    if let Some(rest) = s.strip_prefix("```json") {
        s = rest;
    } else if let Some(rest) = s.strip_prefix("```") {
        s = rest;
    }
    if let Some(rest) = s.strip_suffix("```") {
        s = rest;
    }
    serde_json::from_str(s.trim()).map_err(|e| format!("Couldn't parse voice-reconciliation reply from Claude: {e}. Raw: {reply}"))
}

/// Finds every named NPC in entities.md that doesn't have a voice assignment
/// yet and asks Claude (forced onto opus — see build_claude_args's doc
/// comment on why one-time reasoning work gets that budget, not the fast
/// model a live turn is stuck with) to assign one. A cheap no-op — no
/// network call at all — when every named NPC already has an assignment,
/// which is the common case any time this runs after the first sitting.
/// Ignores any assignment in the reply for a name outside the batch that was
/// actually asked about (a hallucinated or malformed name), rather than
/// trusting Claude's reply blindly. Returns how many NPCs were newly
/// assigned, for the frontend to report back.
fn reconcile_npc_voices_at(root: &Path, id: &str) -> Result<usize, String> {
    let dir = root.join(id);
    let entities = parse_entities_md(&read_optional(&dir.join("memory").join("entities.md")));
    let existing = read_npc_voices_at(root, id);
    let unvoiced: Vec<(String, String)> =
        entities.into_iter().filter(|(name, _)| !existing.contains_key(&normalize_name_key(name))).collect();
    if unvoiced.is_empty() {
        return Ok(0);
    }

    let usage_summary = summarize_voice_usage(&existing);
    let reply = crate::local_llm::ask_ingest_once(build_voice_reconciliation_prompt(&unvoiced, &usage_summary), Some("opus"), true)?;
    let parsed = parse_voice_reconciliation_reply(&reply)?;

    let unvoiced_names: HashSet<String> = unvoiced.iter().map(|(n, _)| normalize_name_key(n)).collect();
    let mut applied = 0;
    for entry in parsed.assignments {
        if entry.voice_id.trim().is_empty() || !unvoiced_names.contains(&normalize_name_key(&entry.name)) {
            continue;
        }
        set_npc_voice_at(root, id, &entry.name, &entry.voice_id, entry.pitch.as_deref(), None, true)?;
        applied += 1;
    }
    Ok(applied)
}

// ── Campaign-hooks reconciliation: tying PC backstories to the campaign ────
//
// Every turn, the DM already sees both memory/campaign_lore.md (the hub,
// recurring NPCs/factions, plot threads) and memory/party.md (each PC's own
// backstory) at once — in principle enough for it to improvise a connection
// between the two live, the same way a human DM does at the table. But nothing
// steers toward that actually happening: it's pure chance whether the model
// ever thinks to tie a specific PC's backstory into the wider plot, or does so
// at a good moment. This pass complements that live improv (never replaces
// it) by guaranteeing at least one deliberate, concrete hook per PC exists in
// campaign_lore.md itself — the DM can still invent further connections on
// its own, but now always has at least one intentional one to build on.

/// name→() ledger of party members who already have a personal campaign-lore
/// hook (see reconcile_campaign_hooks_at) — a separate small file rather than
/// folding this into party.md itself, since party.md's own upsert-by-name
/// format has no room for a second, unrelated boolean per entry. Empty set
/// (not an error) when nothing's been reconciled yet.
fn read_reconciled_hook_names_at(root: &Path, id: &str) -> HashSet<String> {
    let path = root.join(id).join("memory").join("party_hooks.json");
    let text = read_optional(&path);
    if text.trim().is_empty() {
        return HashSet::new();
    }
    serde_json::from_str::<Vec<String>>(&text).unwrap_or_default().into_iter().collect()
}

fn write_reconciled_hook_names_at(root: &Path, id: &str, names: &HashSet<String>) -> Result<(), String> {
    let path = root.join(id).join("memory").join("party_hooks.json");
    let mut sorted: Vec<&String> = names.iter().collect();
    sorted.sort();
    write_atomic(&path, &serde_json::to_string_pretty(&sorted).map_err(|e| e.to_string())?)
}

/// Section heading marking where reconcile_campaign_hooks_at's per-PC ties
/// live within campaign_lore.md — inserted once, above the first hook entry
/// ever written for a campaign, so a handful of "- **Name:** hook" lines read
/// as a deliberate section instead of stray entries tacked onto the end of
/// the prose doc establish_campaign_lore_at wrote. Idempotent: a no-op once
/// the heading's already present (checked by its trimmed text, not the exact
/// literal including surrounding blank lines, so it still matches after
/// upsert_named_fact's own line-based edits touch nearby whitespace).
const PERSONAL_HOOKS_HEADING: &str = "## Personal hooks\n\n_How each player character's own backstory ties into this campaign's hub, factions, or threads — written once per character by the hook-reconciliation pass, never touched by hand._";

fn ensure_personal_hooks_heading(content: &str) -> String {
    if content.contains(PERSONAL_HOOKS_HEADING.lines().next().unwrap_or_default()) {
        content.to_string()
    } else {
        let mut out = content.trim_end().to_string();
        out.push_str("\n\n");
        out.push_str(PERSONAL_HOOKS_HEADING);
        out.push('\n');
        out
    }
}

/// Builds the one-time Opus prompt for the campaign-hooks reconciliation pass
/// (see reconcile_campaign_hooks_at) — given the campaign's established lore
/// and a batch of PCs who don't have a personal hook yet (name + their
/// party.md description), asks Claude to invent one concrete tie per PC to
/// something ALREADY named in campaign_lore.md, never a brand-new NPC/
/// faction/thread invented just for this (that would silently duplicate or
/// contradict the DM's own established doc instead of building on it).
fn build_campaign_hooks_prompt(campaign_lore: &str, pending: &[(String, String)]) -> String {
    let listing = pending.iter().map(|(name, desc)| format!("- {name}: {desc}")).collect::<Vec<_>>().join("\n");
    let lore_block = if campaign_lore.trim().is_empty() {
        "(Nothing established yet — invent a plausible tie to a generic hub/faction concept rather than skipping a PC.)".to_string()
    } else {
        campaign_lore.trim().to_string()
    };
    format!(
        "You are weaving player characters into an ongoing Dungeons & Dragons campaign's existing lore, so their personal backstories feel tied to the wider story instead of just sitting beside it.\n\n\
        Campaign lore (the hub, recurring NPCs/factions, and plot threads already established):\n{lore_block}\n\n\
        For each player character below, invent ONE concrete, specific connection between their backstory and something already named above — a specific NPC, faction, location, or thread, never a brand new element invented just for this. A plausible, minor tie (a shared enemy, a family name, a place they both know) is better than a forced dramatic one, and a loose fit is still better than skipping a PC. Write it as a single sentence the DM can use as a hook whenever it naturally comes up in play, not an instruction to force it in THIS session.\n\n\
        Player characters:\n{listing}\n\n\
        Reply with ONLY a JSON object, no other text, no markdown code fences:\n\
        {{\"hooks\": [{{\"name\": \"<exact name as given above>\", \"hook\": \"<one sentence>\"}}]}}"
    )
}

#[derive(Deserialize, Clone, Debug)]
struct CampaignHookEntry {
    name: String,
    #[serde(default)]
    hook: String,
}

#[derive(Deserialize, Clone, Debug)]
struct CampaignHooksReply {
    #[serde(default)]
    hooks: Vec<CampaignHookEntry>,
}

/// Parses the campaign-hooks reply, tolerating stray markdown code fences
/// around the JSON — same defensive shape as parse_voice_reconciliation_reply.
fn parse_campaign_hooks_reply(reply: &str) -> Result<CampaignHooksReply, String> {
    let mut s = reply.trim();
    if let Some(rest) = s.strip_prefix("```json") {
        s = rest;
    } else if let Some(rest) = s.strip_prefix("```") {
        s = rest;
    }
    if let Some(rest) = s.strip_suffix("```") {
        s = rest;
    }
    serde_json::from_str(s.trim()).map_err(|e| format!("Couldn't parse campaign-hooks reply from Claude: {e}. Raw: {reply}"))
}

/// Finds every named party member in party.md that doesn't have a personal
/// campaign-lore hook yet and asks Claude (forced onto opus — see
/// build_claude_args's doc comment on why one-time reasoning work gets that
/// budget) to invent one. A cheap no-op — no network call — when every known
/// party member already has a hook, the common case any time this runs after
/// the first sitting a given PC connected in. Ignores any hook in the reply
/// for a name outside the batch actually asked about (a hallucinated or
/// malformed name). Returns how many PCs newly got a hook.
fn reconcile_campaign_hooks_at(root: &Path, id: &str) -> Result<usize, String> {
    let dir = root.join(id);
    let party = parse_entities_md(&read_optional(&dir.join("memory").join("party.md")));
    let already = read_reconciled_hook_names_at(root, id);
    let pending: Vec<(String, String)> =
        party.into_iter().filter(|(name, _)| !already.contains(&normalize_name_key(name))).collect();
    if pending.is_empty() {
        return Ok(0);
    }

    let campaign_lore = read_optional(&dir.join("memory").join("campaign_lore.md"));
    let reply = crate::local_llm::ask_ingest_once(build_campaign_hooks_prompt(&campaign_lore, &pending), Some("opus"), true)?;
    let parsed = parse_campaign_hooks_reply(&reply)?;

    let pending_names: HashSet<String> = pending.iter().map(|(n, _)| normalize_name_key(n)).collect();
    let mut reconciled = already;
    let mut applied = 0;
    for entry in parsed.hooks {
        if entry.hook.trim().is_empty() || !pending_names.contains(&normalize_name_key(&entry.name)) {
            continue;
        }
        let lore_path = dir.join("memory").join("campaign_lore.md");
        let with_heading = ensure_personal_hooks_heading(&read_optional(&lore_path));
        write_atomic(&lore_path, &with_heading)?;
        upsert_named_fact_at(root, id, "campaign_lore.md", &entry.name, entry.hook.trim())?;
        reconciled.insert(normalize_name_key(&entry.name));
        applied += 1;
    }
    write_reconciled_hook_names_at(root, id, &reconciled)?;
    Ok(applied)
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
    let rewritten = crate::local_llm::ask_ingest_once(build_compact_memory_prompt(&current), Some("sonnet"), false)?;
    let trimmed = rewritten.trim();
    if trimmed.is_empty() {
        return Err("Memory compaction returned empty content; leaving memory.md untouched.".into());
    }
    backup_before_overwrite(&path);
    write_atomic(&path, trimmed)?;
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
///
/// The dropped_entity_names enforcement below only guards that the NAMES
/// survive — it can't tell whether a description got hollowed out. So the
/// prompt itself has to protect the descriptions' substance: the risk isn't
/// a name vanishing (that's caught), it's "tighten overly wordy descriptions"
/// being read as license to strip an NPC's secret/motive/what-they-know down
/// to a bland role label, keeping the name but losing the person. The
/// instruction is therefore explicit that only redundant *phrasing* may be
/// compressed, never a concrete distinguishing fact.
///
/// `current_chapter_context` (the active chapter's full text, empty string if
/// no module or none active) gives the compaction call something to judge
/// relevance against — entries tied to what's actually happening right now
/// stay detailed, entries about long-resolved threads can compress further.
/// Same recency idea `build_compact_memory_prompt` already uses for session
/// recaps ("recent sessions stay close to full detail"), just extended here.
fn build_compact_entities_prompt(file_label: &str, content: &str, current_chapter_context: &str) -> String {
    let context_block = if current_chapter_context.trim().is_empty() {
        String::new()
    } else {
        format!(
            "\n\nFor reference, here's what's currently happening in the story (the active chapter) — entries clearly tied to this should stay detailed; entries about people/places from earlier, now-resolved threads can compress further:\n{current_chapter_context}"
        )
    };
    format!(
        "This is the registry of named {file_label} for an ongoing Dungeons & Dragons campaign — one line per name, each a short current-state description. It has grown large enough that reloading all of it every turn is wasteful.\n\n\
        Rewrite it more compactly, but under two hard rules:\n\
        1. NEVER remove a named entry — every name currently listed must still be present afterward.\n\
        2. NEVER drop a concrete distinguishing fact from a description — a secret, a motive, what someone knows or wants, a relationship, a unique trait, a specific number or location. These are the whole point of the registry. You may only compress redundant or wordy *phrasing* (\"who is a person that happens to be\" → nothing), merge exact or near-duplicate entries for the same name, and shorten entries about long-resolved threads. Compressing a rich entry down to a bland role label (\"the village priest\", \"a merchant\") is exactly the failure to avoid — if you can't shorten an entry without losing a real fact, leave it as-is.\n\n\
        Reply with ONLY the rewritten doc in markdown, no other commentary, no code fences. Keep the same '- **Name:** description' format for every entry and the existing heading.\n\n\
        Current registry:\n{content}{context_block}"
    )
}

/// Pure: names present in `before` (via parse_entities_md — the same parser
/// reconcile_npc_voices_at depends on, so this also catches an entry getting
/// reformatted out of that parser's exact "- **Name:** description" pattern,
/// not just a name vanishing from the text entirely) but missing from
/// `after`, compared case/whitespace-insensitively via normalize_name_key.
/// Empty means the compaction is safe to accept.
fn dropped_entity_names(before: &str, after: &str) -> Vec<String> {
    let before_names: HashMap<String, String> = parse_entities_md(before)
        .into_iter()
        .map(|(name, _)| (normalize_name_key(&name), name))
        .collect();
    let after_keys: HashSet<String> = parse_entities_md(after).into_iter().map(|(name, _)| normalize_name_key(&name)).collect();
    let mut missing: Vec<String> = before_names
        .into_iter()
        .filter(|(key, _)| !after_keys.contains(key))
        .map(|(_, original_name)| original_name)
        .collect();
    missing.sort();
    missing
}

/// Impure: mirrors compact_memory_if_needed_at but for one of the entity/
/// location registry files. No-op below the threshold.
///
/// build_compact_entities_prompt only *asks* the model never to drop a named
/// entry — it doesn't enforce it. This is the actual enforcement: after
/// compacting, dropped_entity_names checks every name that was present
/// before is still present afterward, in the same parseable format. If
/// anything would be lost or silently reformatted away, the compaction is
/// rejected and the file is left untouched (an Err the caller already
/// tolerates, same as any other compaction failure) rather than accepting a
/// violated "never forgotten" guarantee — the one thing this registry exists
/// to provide over 100+ sessions of repeated compaction cycles.
fn compact_entities_if_needed_at(
    root: &Path,
    id: &str,
    filename: &str,
    file_label: &str,
    current_chapter_context: &str,
) -> Result<bool, String> {
    let path = root.join(id).join("memory").join(filename);
    let current = read_optional(&path);
    if !should_compact_entities(&current) {
        return Ok(false);
    }
    let rewritten = crate::local_llm::ask_ingest_once(
        build_compact_entities_prompt(file_label, &current, current_chapter_context),
        Some("sonnet"),
        false,
    )?;
    let trimmed = rewritten.trim();
    if trimmed.is_empty() {
        return Err(format!("Compaction of {filename} returned empty content; leaving it untouched."));
    }
    let dropped = dropped_entity_names(&current, trimmed);
    if !dropped.is_empty() {
        return Err(format!(
            "Compaction of {filename} would have dropped or reformatted {} named entr{}: {}; leaving it untouched.",
            dropped.len(),
            if dropped.len() == 1 { "y" } else { "ies" },
            dropped.join(", "),
        ));
    }
    backup_before_overwrite(&path);
    write_atomic(&path, trimmed)?;
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
        Reply in markdown with exactly three sections:\n\
        ## Encounters\n\
        A numbered list of what the party will likely reach in the upcoming content. Format EACH line exactly like ONE of these two patterns (pick whichever tag actually applies to that encounter — never write both tags on one line):\n\
        \"N. [combat] Short Name — one-sentence description.\" for an encounter you expect to involve a fight.\n\
        \"N. [non-combat] Short Name — one-sentence description.\" for anything else (social, exploration, puzzle).\n\
        Only list encounters that actually appear in the content above — don't invent filler. If genuinely nothing is coming up, write exactly \"No encounters expected yet.\" and nothing else in this section.\n\n\
        ## Set up from what you own\n\
        Which cataloged pieces to lay out for the upcoming content, and a rough arrangement. If nothing owned clearly fits, say so plainly instead of forcing a suggestion.\n\n\
        ## Consider printing\n\
        Terrain TYPES (not specific marketplace items or brand names — the DM isn't connected to any model marketplace) that would suit the upcoming content but aren't in the catalog yet. Be specific about the gameplay purpose (e.g. \"a marsh/difficult-terrain piece for the bog encounter\"), not vague. If the existing catalog already covers everything needed, say so plainly instead of forcing a suggestion.\n\n\
        Keep it concise — this is a quick prep checklist, not an essay."
    )
}

#[derive(Debug, Clone, PartialEq)]
struct PlanEncounter {
    name: String,
    description: String,
    combat: bool,
}

/// Parses the `## Encounters` section's numbered lines (see
/// build_session_plan_prompt's required format) into a structured list, so
/// battle-map generation can walk it deterministically instead of
/// independently re-guessing "what's coming up" (see generate_battle_maps_for_plan_at).
/// Pure — no LLM call, so it's fully unit-testable against sample plan text.
/// A line missing the `[combat|non-combat]` tag defaults to combat: true — a
/// missed fight-map is worse than one unused extra map.
fn parse_plan_encounters(plan_text: &str) -> Vec<PlanEncounter> {
    let mut in_section = false;
    let mut out = Vec::new();
    for line in plan_text.lines() {
        let trimmed = line.trim();
        if trimmed == "## Encounters" {
            in_section = true;
            continue;
        }
        if !in_section {
            continue;
        }
        if trimmed.starts_with("## ") {
            break;
        }
        // "N. [combat] Short Name — description" — strip the leading "N. ".
        let after_number = match trimmed.split_once('.') {
            Some((n, rest)) if n.chars().all(|c| c.is_ascii_digit()) && !n.is_empty() => rest.trim(),
            _ => continue,
        };
        // Strip ANY leading `[...]` tag rather than matching only the exact
        // "[combat]"/"[non-combat]" strings — a model that deviates from the
        // requested format (e.g. writing "[combat|non-combat]" verbatim
        // instead of picking one, observed in live testing) still gets its
        // bracket junk stripped out of the encounter's name instead of that
        // leaking into the title/slug. Only an exact "non-combat" tag (any
        // case) turns off combat; anything else defaults to combat: true —
        // a missed fight-map is worse than one unused extra map.
        let (combat, after_tag) = match after_number.strip_prefix('[').and_then(|rest| rest.split_once(']')) {
            Some((tag, rest)) => (!tag.trim().eq_ignore_ascii_case("non-combat"), rest.trim()),
            None => (true, after_number),
        };
        if after_tag.is_empty() {
            continue;
        }
        let (name, description) = match after_tag.split_once('—').or_else(|| after_tag.split_once('-')) {
            Some((n, d)) => (n.trim().to_string(), d.trim().to_string()),
            None => (after_tag.to_string(), String::new()),
        };
        if name.is_empty() {
            continue;
        }
        out.push(PlanEncounter { name, description, combat });
    }
    out
}

/// Impure orchestration: reads whatever's on disk for this campaign (module/
/// memory files may not exist yet — read_optional treats that as empty, not
/// an error) plus the terrain catalog, then makes one Claude call. `sonnet`,
/// not `opus` — this is closer to routine DM-assistant work than the one-time
/// module ingestion. Reads via the active_module/* indirection (not a
/// specific module's own subfolder directly) so this always reflects whatever
/// module is currently active, plus the campaign's overarching lore.
fn suggest_session_plan_at(root: &Path, id: &str, terrain_catalog: &str) -> Result<String, String> {
    let dir = root.join(id);
    let module_plan = read_optional(&dir.join("active_module").join("plan.md"));
    let current_chapter = read_optional(&dir.join("active_module").join("current.md"));
    let campaign_lore = read_optional(&dir.join("memory").join("campaign_lore.md"));
    let combined_plan = [campaign_lore.trim(), module_plan.trim()].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n\n");
    let memory = read_optional(&dir.join("memory").join("MEMORY.md"));
    let flagged_facts = read_optional(&dir.join("memory").join("flagged_facts.md"));
    let combined_memory = [memory.trim(), flagged_facts.trim()].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n\n");
    let prompt = build_session_plan_prompt(&combined_plan, &current_chapter, &combined_memory, terrain_catalog);
    crate::local_llm::ask_ingest_once(prompt, Some("sonnet"), false)
}

fn session_plan_path(root: &Path, id: &str) -> PathBuf {
    root.join(id).join("active_module").join("session_plan.md")
}

/// The cached "Plan Next Session" text, if one has been generated for
/// whatever module/chapter is currently active. `None` when there's no cache
/// yet (or it's been invalidated — see advance_chapter_at) so the caller
/// knows to actually ask Claude; this is what stops every dialog-open/
/// button-click from independently re-asking and getting a different answer.
fn read_session_plan_at(root: &Path, id: &str) -> Option<String> {
    let content = read_optional(&session_plan_path(root, id));
    if content.trim().is_empty() { None } else { Some(content) }
}

fn write_session_plan_at(root: &Path, id: &str, text: &str) -> Result<(), String> {
    let path = session_plan_path(root, id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    write_atomic(&path, text)
}

/// advance_chapter_at already invalidates the cached session plan when a
/// module-based campaign's chapter changes — but a freeform campaign with no
/// imported module never fires that. This is the equivalent trigger for
/// that case: "End session" is the natural signal that tonight's content is
/// now behind the party, so the next "Plan Next Session" open should
/// regenerate against whatever's next rather than keep showing what was
/// just played. Harmless no-op if there's nothing cached yet (never
/// generated) or the campaign IS module-based (already invalidated on its
/// own chapter advance).
fn invalidate_session_plan_at(root: &Path, id: &str) {
    let _ = fs::remove_file(session_plan_path(root, id));
}

// ── Battle map generation & storage ─────────────────────────────────────────
// The DM authors each map as a text spec (an ASCII grid + legend + tactics);
// the frontend (battleMapRender.ts) renders it deterministically to a printable
// PDF/PNG. The spec is BOTH the printable source of truth AND the DM's memory
// of exactly what the map looks like, which is what lets it plan enemy
// placement and ambushes against a precise, known layout.

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct BattleMapMeta {
    pub slug: String,
    pub name: String,
    /// One-line summary for the index / picker (the grid's dimensions).
    pub summary: String,
}

/// Path-traversal guard for a slug that reaches the filesystem — slugify only
/// ever produces `[a-z0-9-]`, so a generated slug always passes; anything else
/// (`../`, an absolute path) is rejected. Mirrors is_valid_session_id.
fn is_valid_map_slug(slug: &str) -> bool {
    !slug.is_empty()
        && slug.len() <= 80
        && slug.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

fn battle_maps_dir(root: &Path, id: &str) -> PathBuf {
    root.join(id).join("memory").join(BATTLE_MAPS_DIR)
}

/// Single-map prompt — used both by the on-demand "describe one encounter"
/// path AND, looped once per combat encounter, by the session-prep batch
/// path (generate_battle_maps_for_plan_at), which is driven by the
/// already-decided, already-persisted plan instead of asking the model to
/// independently re-guess "what's coming up" a second time.
fn build_battle_maps_prompt(module_plan: &str, current_chapter: &str, memory: &str, hint: &str, objects_enabled: bool, vocabulary: &[String], footprint_guide: &[String]) -> String {
    format!(
        "You are designing printable top-down battle maps for an upcoming Dungeons & Dragons session. Each map is a grid a Dungeon Master will print and place miniatures on, so it must be laid out precisely — you are authoring the exact layout, not describing a mood.\n\n\
        Design ONE battle map for this specific encounter the DM described: {hint}\n\n\
        Campaign-arc plan:\n{module_plan}\n\n\
        Current chapter (what's coming up):\n{current_chapter}\n\n\
        Recent memory/recaps:\n{memory}\n\n\
        {}",
        battle_map_format_instructions(crate::local_llm::is_local_ingestion(), objects_enabled, vocabulary, footprint_guide)
    )
}

/// The grid of the worked example embedded in the prompt. A const rather than
/// inline prompt text because `copies_the_example` has to compare against
/// exactly what the model was shown — if the two drifted apart, the guard would
/// quietly stop guarding.
const EXAMPLE_MAP_GRID: &[&str] = &[
    "################",
    "#..............#",
    "#.======.......#",
    "#..............#",
    "#.........=....#",
    "#...==.........+",
    "#...==.....=...#",
    "#.....^^.......#",
    "#.=.....==.....#",
    "#.......==...*.#",
    "#..............#",
    "#####+##########",
];

/// Second worked example, deliberately NOT a furnished room — a cave has no
/// `=` anywhere. Without this, the tavern above was the model's only full
/// pattern in context, and it started reaching for bar-shaped furniture even
/// in caves and wizard towers that were never asked for one.
const EXAMPLE_CAVE_GRID: &[&str] = &[
    "##########",
    "#..o.....#",
    "#...~~...#",
    "#..~~~...#",
    "#....^^..#",
    "+.^^.....#",
    "#......o.#",
    "#...*....#",
    "#......._#",
    "##########",
];

/// True when the model handed one of the prompt's examples straight back
/// instead of drawing its own room. Confirmed live: asked for a dockside
/// tavern brawl, it returned The Bent Nail's grid verbatim under a new name.
/// A worked example is what finally taught it to lay a room out properly,
/// but a close-enough request also invites plain copying, and telling it
/// "copy the habits, not the contents" in the prompt does not prevent that.
/// So, like every other rule here the model ignored: check it mechanically
/// and feed it back.
fn copies_the_example(spec: &str) -> bool {
    split_spec_grid(spec).is_some_and(|(_, rows, _)| {
        let rows: Vec<&str> = rows.iter().map(|r| r.trim_end()).collect();
        rows.as_slice() == EXAMPLE_MAP_GRID || rows.as_slice() == EXAMPLE_CAVE_GRID
    })
}

/// Picks the prompt variant by which provider is actually about to answer it
/// `use_local` is passed in rather than read here (see
/// local_llm::is_local_ingestion) — the caller looks it up once, keeping this
/// function itself a pure dispatch on an explicit argument instead of an
/// implicit read of shared global state, so its output stays deterministic
/// for tests regardless of what some OTHER test's process-global ingestion
/// config happens to be set to at the moment this runs.
///
/// Confirmed live (test-campaign "Bar Fight", 2026-07-17): the full prompt's
/// two worked examples and dozen rules are well within Claude's reach but
/// reliably broke a local model — three independent generations all lost
/// track of their own declared grid width, and wrote `Features:` describing a
/// different, larger room than the one actually drawn, with two retries
/// barely moving the issue count. A shorter, single-example prompt gives a
/// small model a shot at self-consistency instead of setting it up to fail
/// the same way every time.
fn battle_map_format_instructions(use_local: bool, objects_enabled: bool, vocabulary: &[String], footprint_guide: &[String]) -> String {
    if use_local {
        battle_map_format_instructions_streamlined(objects_enabled, vocabulary, footprint_guide)
    } else {
        battle_map_format_instructions_full(objects_enabled, vocabulary, footprint_guide)
    }
}

/// Text for the optional `Objects:` section — a free-object placement layer
/// independent of the legend grid, resolved against a user-imported local
/// tile catalog (see tile_library.rs) instead of the fixed legend codes.
/// Only ever interpolated in when `tile_library_configured` is true (see
/// this function's callers) — with nothing imported, the model never sees
/// this text and never writes the section, so behavior is unchanged.
///
/// NEVER a creature, NPC, or monster — confirmed live (test-campaign
/// "Tavern Brawl (Watchmen)", 2026-07-19) that without an explicit
/// exclusion the model reached for this section to mark an NPC's position
/// ("Hilda Brightmantle (downed, unconscious) at D2"), not just physical
/// set-dressing. That's a real DM error, not just an unhelpful one: Nabil
/// runs combat with physical miniatures — the app has no business deciding
/// where a person is standing, only Features/Tactics prose does that, same
/// as before this layer existed.
fn objects_format_line() -> &'static str {
    "Objects:\n- <free description of a real physical OBJECT — furniture, decor, terrain dressing, e.g. \"round wooden dining table\" — never a creature, NPC, or monster> at <cell> (<W>x<H>)\n"
}

/// `vocabulary` — real, bounded words drawn from the actual imported catalog
/// (see tile_library.rs's `object_vocabulary`) — grounds what the model
/// writes in what can actually be found. Without this, the model was
/// choosing words blind and `search_tile_catalog`'s keyword-overlap match
/// only worked by luck; every word offered here is guaranteed to appear in
/// at least one real catalog entry, so a description built from it is
/// guaranteed matchable. Empty when nothing's imported (shouldn't happen —
/// this whole section is only interpolated in when it's configured — but
/// tolerated rather than assumed).
fn objects_rule_line(vocabulary: &[String], footprint_guide: &[String]) -> String {
    let vocab_line = if vocabulary.is_empty() {
        String::new()
    } else {
        format!(
            "    - Real object vocabulary available in the imported tile library — STRONGLY prefer these words in your description; only a word that's actually in this list can be found and rendered, anything else just won't appear: {}.\n",
            vocabulary.join(", ")
        )
    };
    let guide_line = if footprint_guide.is_empty() {
        String::new()
    } else {
        format!(
            "    - SIZE GUIDE (derived from the imported library) — these objects only exist as LARGER art; write at least the size shown or nothing real will be found and the object silently won't appear: {}.
",
            footprint_guide.join(", ")
        )
    };
    format!(
        "- An `Objects:` line places something with NO legend code of its own, anywhere on real floor you drew: `<description> at <cell> (<W>x<H>)`, where `W`/`H` are whole numbers 1-4 (the object's footprint in cells). This is extra set-dressing variety (a unique chair, a tree, a barrel) on top of the legend codes — it does not replace drawing the room's defining feature with `=`/`*` and a matching Features: line, which still works exactly as before.\n\
        - `Objects:` is PHYSICAL SET-DRESSING ONLY — furniture, decor, terrain, clutter. NEVER a creature, NPC, or monster, downed/unconscious or otherwise. A character's position belongs ONLY in Features/Tactics prose, exactly as it already did before this section existed — the DM plays with physical miniatures and places people themselves.\n\
        - A built-in HEARTH or FIREPLACE (the kind set into a tavern or hall wall) is NOT the `*` code — `*` only ever draws an open campfire on the floor. For a real fireplace, put an `Objects:` entry \"stone fireplace at <cell> (2x2)\" against a wall — size it AT LEAST 2x2 so it reads as a proper hearth (a 1x1 fireplace only matches tiny grates). Reserve `*` for an actual campfire, brazier, or fire pit out on the floor.\n\
        - A TABLE longer than 2 cells must be 2 cells DEEP — write `3x2` or `4x2`, never `3x1` or `4x1`. A long table only one cell deep matches almost nothing real in the catalog: it lands on a table RUNNER (a decorative cloth) and renders as a strip of fabric lying on the floor. Small tables at `1x1` and `2x1` are fine as they are.\n\
        - A hanging CHANDELIER is a 2x2 object — every chandelier in the catalog is a 2x2 piece, so a 1x1 one finds nothing and simply won't appear. Write \"iron chandelier at <cell> (2x2)\" over OPEN FLOOR (it hangs above the room, not against a wall). A single wall sconce, candelabra, or lantern is the 1x1 option instead.\n\
        - DRESS THE WALLS. A lived-in room stores things along its edges, and a bare-walled room reads as empty. Add 1-3 `Objects:` entries of WALL STORAGE stocked to fit the scene, each sitting in the floor cells directly against a wall (typically 2x1 or 3x1): behind a bar, shelves of bottles and a keg or two; a study, bookshelves; an armoury, weapon racks; a pantry or warehouse, crates and a cupboard. Name the contents (\"shelf of bottles\", \"bookshelf\", \"stacked crates\") so the right stocked piece is found, not a bare plank.\n\
        {vocab_line}{guide_line}"
    )
}

/// The streamlined prompt for a local model: one worked example instead of
/// two, and only the mechanically-load-bearing rules (the ones
/// validate_map_spec actually checks) — the qualitative layout advice
/// ("vary object sizes", "put something in the middle", the anti-mirroring
/// rules) is cut, not because it's wrong, but because a model that can't
/// reliably hold its own row width steady has no spare capacity for nuance,
/// and the extra length was actively working against it.
fn battle_map_format_instructions_streamlined(objects_enabled: bool, vocabulary: &[String], footprint_guide: &[String]) -> String {
    let objects_format = if objects_enabled { objects_format_line() } else { "" };
    let objects_rule = if objects_enabled { objects_rule_line(vocabulary, footprint_guide) } else { String::new() };
    format!(
        "Format the map EXACTLY like this, with a line containing only {MAP_SPEC_DELIMITER} before it:\n\n\
        {MAP_SPEC_DELIMITER}\n\
        # <Short map name>\n\
        Grid: <cols>x<rows>, 5 ft squares. Columns A onward left-to-right, rows 1 onward top-to-bottom.\n\
        Legend: {MAP_LEGEND}\n\
        Map:\n\
        <exactly <rows> lines, each exactly <cols> characters wide, using ONLY the legend codes above>\n\
        Features:\n\
        - <what's in a cell, e.g. \"Altar at J8\">\n\
        {objects_format}\
        Tactics:\n\
        - <cover, choke points, suggested enemy cells>\n\n\
        Rules — count carefully, a mistake gets the map rejected:\n\
        - Size between {MAP_MIN_COLS}x{MAP_MIN_ROWS} and {MAP_MAX_COLS}x{MAP_MAX_ROWS}. The `Grid:` line MUST match the block you actually draw — count every row before you answer.\n\
        - EVERY row must be the exact same number of characters as every other row.\n\
        - Enclose the room with `#` walls; a space is outside the map.\n\
        - A `+` door needs `#` directly on both sides (left+right, or above+below) — never on open floor.\n\
        - Every `Features:` line must point at a cell that really has that code right now. \"Bar at A2\" means A2 must actually be `=`.\n\
        - A stool, chair, or bench is `=` (furniture) — never `^`. `^` renders as a pile of grey STONE rocks, so use it ONLY for actual stone rubble (caves, ruins, collapsed masonry). Overturned or broken furniture, spilled crates, and other clutter that slows movement is still `=` — draw it as the thing it is and note \"difficult terrain here\" in Tactics; do NOT scatter `^` in a wooden interior, it looks like a rockslide indoors.\n\
        {objects_rule}\
        - Draw the encounter's main feature for real, not just in words: a bar needs an actual run of `=`, a shrine needs an actual altar cell.\n\
        - Don't overcrowd — this is a combat map, so keep at least half the floor open for movement and leave clear lanes; a few pieces of furniture beat a room packed wall-to-wall.\n\n\
        One example:\n\n\
        {MAP_SPEC_DELIMITER}\n\
        # The Bent Nail\n\
        Grid: 16x12, 5 ft squares. Columns A onward left-to-right, rows 1 onward top-to-bottom.\n\
        Legend: {MAP_LEGEND}\n\
        Map:\n\
        {example_grid}\n\
        Features:\n\
        - Bar counter at C3-H3\n\
        - Table at E6-F7\n\
        - Stool at K5\n\
        Tactics:\n\
        - The bar at C3-H3 gives half cover.\n\
        {MAP_SPEC_DELIMITER}\n\n\
        Draw a DIFFERENT room for THIS encounter — do not just copy that grid. Only draw a bar or tables if the encounter actually has them; a cave or tower would have none of that.\n\n\
        Output nothing outside the sections shown.",
        example_grid = EXAMPLE_MAP_GRID.join("\n")
    )
}

fn battle_map_format_instructions_full(objects_enabled: bool, vocabulary: &[String], footprint_guide: &[String]) -> String {
    let objects_format = if objects_enabled { objects_format_line() } else { "" };
    let objects_rule = if objects_enabled { objects_rule_line(vocabulary, footprint_guide) } else { String::new() };
    format!(
        "Format EACH map EXACTLY like this, and separate successive maps with a line containing only {MAP_SPEC_DELIMITER} (also put one {MAP_SPEC_DELIMITER} line before the very first map):\n\n\
        {MAP_SPEC_DELIMITER}\n\
        # <Short map name>\n\
        Grid: <cols>x<rows>, 5 ft squares. Columns A onward left-to-right, rows 1 onward top-to-bottom.\n\
        Legend: {MAP_LEGEND}\n\
        Map:\n\
        <exactly <rows> lines, each exactly <cols> characters wide, using ONLY the single-character legend codes above>\n\
        Features:\n\
        - <notable things and the cell they're in, e.g. \"Altar at J8\">\n\
        {objects_format}\
        Tactics:\n\
        - <choke points, cover, and sightlines, plus concrete suggested enemy start cells and ambush spots, referencing cells like C3 or K1>\n\n\
        Rules for the Map block — these are checked mechanically and a violation gets the map rejected:\n\
        - Size it between {MAP_MIN_COLS}x{MAP_MIN_ROWS} and {MAP_MAX_COLS}x{MAP_MAX_ROWS}, and the `Grid:` line's <cols>x<rows> MUST equal the block you actually draw.\n\
        - EVERY row must be exactly <cols> characters wide — count them. Ragged rows are the single most common failure.\n\
        - Enclose the playable area with `#` walls; use a space for anything outside it.\n\
        - A `+` door must be SET INTO a wall run — a `#` on both sides of it, horizontally or vertically. Never leave a door standing on open floor.\n\
        - Every `Features:` line must point at a cell you actually drew the matching code in. If you write \"Bar at A2\", then A2 must really be a `=`. Never list something you didn't draw.\n\
        - A `Features:` line may name a single cell (\"Hearth at B7\"), a list (\"Pillars at C4, G4\"), or a range (\"Bar counter at B2-K2\", \"Table at D4-E5\"). A range means EVERY cell in the rectangle its two corners span, so each one of them must hold that code — a run with a gap in it is wrong.\n\
        {objects_rule}\
        - Name each feature by what it actually is (\"Bar counter\", \"Hearth\", \"Main entrance\"), not by its legend code — those names are what the map's art is generated from, so \"Furniture at D4\" produces a generic table where \"Bar counter at B2-K2\" produces a bar.\n\
        - The encounter's defining feature must physically exist on the grid, not just in the Features text: a barroom needs an actual bar (a contiguous run of `=`), a forge needs the forge, a shrine needs the altar. Draw it, then name it in Features.\n\
        - Lay the room out like a real place, not a spreadsheet. Concretely: do NOT mirror one half of the room onto the other; do NOT line objects up in matching columns down both walls; do NOT repeat one identical furniture block more than twice. Vary the SIZE of things (a 1-cell stool, a 2-cell bench, a 2x2 table). Leave irregular gaps.\n\
        - Break the OUTER WALL out of a plain rectangle. A bare box is the dullest possible battlefield: give it an alcove, a jog in one wall, a recessed nook, a corner cut off by a stair or chimney breast, a side passage. Those irregularities are what players hide behind and fight over — one or two are enough, and they should make sense for the building.\n\
        - A stool, chair, or bench is FURNITURE — draw it with `=`, one cell each, the same as a table just smaller. NEVER draw a seat with `^`.\n\
        - `^` renders as a pile of grey STONE rocks. Use it ONLY where actual stone rubble fits the fiction — caves, ruins, a collapsed wall. Do NOT use `^` for difficult terrain made of anything else: overturned or smashed furniture in a brawl, spilled crates, scattered debris, mud, or bushes are drawn as the thing they are (`=` furniture or `T` foliage) and their movement penalty is stated in Tactics. Scattering `^` across a tavern or wooden floor looks like an indoor rockslide and is wrong.\n\
        - Put something in the MIDDLE. A room whose objects all hug the walls, leaving a large empty void through the centre, is wrong — that is the most common layout failure.\n\
        - A counter or bar needs open floor along at least one of its long sides — somebody has to stand behind it to work it. A bar drawn flat against a wall with no gap is wrong.\n\
        - Make it tactically interesting but faithful to the encounter's fiction. Terrain is defined by what it DOES, not by how it looks, and a good map mixes FUNCTIONS rather than repeating one. Include at least one of each: something that blocks BOTH movement and line of sight (a wall jog, a solid pillar, a stacked crate wall); something that blocks MOVEMENT but not sight (a counter, a railing, water, a pit); and something that gives HALF cover to fight from behind (a table, a barrel, a low bench). Anything that only slows movement (rubble, mud, spilled cargo) is difficult terrain — say so in Tactics.\n\
        - Give the room at LEAST TWO ways in, placed so the lanes from them are genuinely different — not two doors that feed the same approach. At most ONE deliberate choke point; if every route is a bottleneck the fight stops being a choice. Remember distance is measured in MOVES (about 5-6 squares each), so a piece of blocking terrain in the middle of a lane buys more distance than making the room bigger.\n\
        - Give the map ONE set piece — a single thing that is unexpected and worth interacting with (a collapsing floor, a chandelier, a well, a fire that spreads, a lever). Exactly one: two or more competing gimmicks overload the scene. It must be visible and fair — never a hidden instant-kill, never a feature that removes a character from the fight with no counterplay.\n\
        - Do NOT overcrowd. This is a COMBAT map — most of the floor must stay OPEN so miniatures can move and there are real lines of sight. Furniture and clutter ARE the cover and obstacles, so a handful of well-placed pieces beats a room packed wall-to-wall. Keep at least half the interior cells as empty floor, and leave clear lanes to move and flank through.\n\
        - But match the FILL to the setting — that half-empty rule is a ceiling, not a target. A wooded or overgrown scene (forest, jungle, grove, copse, swamp, thicket, an overgrown ruin) must read as DENSE: cluster trees and undergrowth (`T`) across much of the map — a treeline hugging the edges, stands and thickets reaching in — around the clear lanes and the central clearing where the fight happens. A dozen-plus `T` on a normal map, not a scattered handful; a forest that's mostly bare floor is as wrong as a tavern packed wall-to-wall. An OPEN setting (cavern, arena, plain, dungeon hall, a courtyard) is the opposite — keep the floor open with a few well-placed features and do not manufacture clutter to fill it.\n\n\
        Here is a COMPLETE, correct example. Copy its habits — the irregular spacing, the mix of object sizes, the bar with room behind it, the occupied centre — not its specific contents:\n\n\
        {MAP_SPEC_DELIMITER}\n\
        # The Bent Nail\n\
        Grid: 16x12, 5 ft squares. Columns A onward left-to-right, rows 1 onward top-to-bottom.\n\
        Legend: {MAP_LEGEND}\n\
        Map:\n\
        {example_grid}\n\
        Features:\n\
        - Bar counter at C3-H3 (the barkeep works the open floor at row 2 behind it)\n\
        - Hearth at N10\n\
        - Table at E6-F7\n\
        - Table at I9-J10\n\
        - Stool at K5\n\
        - Stool at L7\n\
        - Stool at C9\n\
        - Spilled crockery at G8-H8\n\
        - Main entrance at F12\n\
        - Side door at P6\n\
        Tactics:\n\
        - The bar at C3-H3 gives half cover; the gap at row 2 behind it is a dead end once someone blocks B2.\n\
        - The crockery at G8-H8 is difficult terrain and splits the room's centre.\n\
        - Anyone coming in the main entrance at F12 is in the open until they reach the table at E6-F7.\n\
        {MAP_SPEC_DELIMITER}\n\n\
        Note what that example does NOT do: it does not put matching furniture at both walls, it does not repeat one block eight times, and it does not leave the centre empty. It illustrates HABITS, not a room to reuse: drawing that same grid again, or a lightly-edited version of it, is a rejected answer — the encounter you were asked for is a different place.\n\n\
        A second example, so you don't walk away thinking every map needs a bar. This is a cave — it has NO `=` furniture anywhere, because a cave has none. Draw what the fiction actually contains, not what the previous example happened to have:\n\n\
        {MAP_SPEC_DELIMITER}\n\
        # Flooded Grotto\n\
        Grid: 10x10, 5 ft squares. Columns A onward left-to-right, rows 1 onward top-to-bottom.\n\
        Legend: {MAP_LEGEND}\n\
        Map:\n\
        {example_cave_grid}\n\
        Features:\n\
        - Stalagmite at D2\n\
        - Water pool at E3-F3\n\
        - Water pool at D4-F4\n\
        - Rockfall at F5-G5\n\
        - Cave mouth at A6\n\
        - Rockfall at C6-D6\n\
        - Stalagmite at H7\n\
        - Glowing fungus at E8\n\
        - Stairs down at I9\n\
        Tactics:\n\
        - The pool at D4-F4/E3-F3 blocks a straight line through the middle; the rockfall at F5-G5 and C6-D6 forces anyone going around it into difficult terrain.\n\
        - Anyone entering at the cave mouth (A6) is in rockfall before they reach open floor.\n\
        - The stalagmite at H7 gives three-quarter cover to whoever holds the stairs down at I9.\n\
        {MAP_SPEC_DELIMITER}\n\n\
        A wizard's tower, an octopus-ship hold, a goblin warren — none of them are a tavern. Only draw `=` furniture, a bar, tables, stools, when the encounter actually has them. Fit the room to what was asked for, not to whichever example above looks closest.\n\n\
        Output nothing outside the sections shown.",
        // Plain "\n": the source indentation around this is stripped by Rust's
        // line-continuation escapes, but indentation inside an interpolated
        // value is not — padding here would put leading spaces on every grid
        // row and the model would learn a grid that doesn't parse.
        example_grid = EXAMPLE_MAP_GRID.join("\n"),
        example_cave_grid = EXAMPLE_CAVE_GRID.join("\n")
    )
}

// ── Map spec validation / normalization ──────────────────────────────────────
// The model's spec used to be trusted verbatim and written straight to disk,
// which shipped genuinely broken maps: a `Grid:` header claiming 16x12 over a
// grid that was really 13 rows of ragged 14/16 width (the renderer pads short
// rows with void, so the print got a black stripe down one side), doors sitting
// on open floor instead of in a wall, and a `Features:` list naming a bar,
// pillars, a fire pit and stairs that appear NOWHERE in the ASCII it drew. The
// prompt already asked for equal row widths; the model ignored it. So the fix
// can't be prompt-only: `validate_map_spec` reports concrete errors (fed back
// for one retry) and `normalize_map_spec` guarantees whatever we finally store
// is at least self-consistent — which matters beyond looks, since the DM plans
// enemy placement against these cell coordinates.

/// Every legal grid character (plus `' '` = void, handled separately).
const MAP_CODES: &[char] = &['.', '#', '+', '~', 'o', '^', '=', 'T', '_', '*', ','];
/// Codes that are an actual object/terrain feature — what a `Features:` line
/// must point at. Plain floor, void and wall are not "things".
const MAP_OBJECT_CODES: &[char] = &['+', '~', 'o', '^', '=', 'T', '_', '*', ','];

/// The DISCRETE-object codes the vision tile-resolver will try to replace with
/// a real catalog sprite (see `parse_placements`): furniture, pillar, fire,
/// foliage, rubble. Deliberately NOT the tiling terrain/architecture codes
/// (`#` wall, `.` floor, `+` door, `~` water, `_` stairs, `,` sand) — those
/// need seamless edge-to-edge tiles, which discrete catalog art isn't.
const RESOLVABLE_GLYPHS: &[char] = &['=', 'o', '*', 'T', '^'];

/// Words that mean "this is furniture" in a Features label. `=` is the ONLY
/// legend code for furniture (see MAP_LEGEND) — if a line named this way
/// points at any other object code, the model drew the wrong character for
/// what it meant, not just a wrong cell. Confirmed live: a "Stools at ..."
/// line landed on `^` cells and rendered as a pile of rocks instead of
/// stools, because `^` means rubble/difficult terrain, not furniture.
const FURNITURE_WORDS: &[&str] = &[
    "bar", "table", "counter", "stool", "chest", "bench", "altar", "crate", "shelf", "cabinet", "throne", "cauldron",
    "bed", "cot", "shrine",
];

/// The label of a `Features:` bullet — everything before the first " at ",
/// the same split `parseFeatureLabels` in battleMapRender.ts uses to name a
/// cell. Case-insensitive so "Stools AT" still splits correctly.
fn feature_line_name(line: &str) -> &str {
    let idx = line.to_lowercase().find(" at ");
    match idx {
        Some(i) => line[..i].trim(),
        None => line.trim(),
    }
}

fn feature_line_names_furniture(line: &str) -> bool {
    let name = feature_line_name(line).to_lowercase();
    FURNITURE_WORDS.iter().any(|w| name.contains(w))
}

// Battlefield sizing. DM map-design guides put the useful range at roughly 6x6
// (smallest) / 8x8 (average) / 10x10 (large) / 12x12 (huge) squares — the
// question that matters is how many MOVES it takes to cross, not how much space
// there is. The old 24x18 cap (432 squares) was ~3x "huge", and combined with
// the half-the-floor-stays-open rule it produced cavernous, empty-reading maps.
// This range stays deliberately on the generous side of the guidance (the min
// is already "large") while cutting the barn-sized upper end roughly in half.
const MAP_MIN_COLS: usize = 10;
const MAP_MIN_ROWS: usize = 10;
const MAP_MAX_COLS: usize = 16;
const MAP_MAX_ROWS: usize = 14;
/// How many extra attempts `generate_one_map_spec` gets after the first, each
/// fed the concrete errors from the one before. Bounded rather than "until
/// clean" — this is a real network call each time, and the caller needs a
/// bounded worst case, not a spec that's merely closer to sound.
///
/// Local and Claude get DIFFERENT budgets because they fail differently:
/// local (confirmed live, test-campaign 2026-07-17) routinely needed 2-3
/// tries just to get basic mechanical correctness — a floating door, an
/// unlabeled bar counter, still present after a single retry. Claude at high
/// effort reliably nails that in 1-2 tries, so spending the same budget on
/// it mostly buys nothing beyond real cost — see generate_map_spec for where
/// this is picked.
const MAP_SPEC_MAX_RETRIES_LOCAL: usize = 2;
const MAP_SPEC_MAX_RETRIES_CLAUDE: usize = 1;
/// Sanity cap while slurping rows, mirroring battleMapRender.ts's MAX_DIM.
const MAP_SLURP_CAP: usize = 40;

fn is_map_section_header(t: &str) -> bool {
    t.starts_with("Features:") || t.starts_with("Objects:") || t.starts_with("Tactics:") || t.starts_with("Legend:")
        || t.starts_with("Grid:") || t.starts_with("# ")
}

/// Splits a spec into (everything up to and including `Map:`, the grid rows,
/// everything after). Mirrors battleMapRender.ts's parseBattleMap so what we
/// validate is exactly what the renderer will draw. Pure.
fn split_spec_grid(spec: &str) -> Option<(Vec<String>, Vec<String>, Vec<String>)> {
    let lines: Vec<&str> = spec.lines().collect();
    let map_idx = lines.iter().position(|l| l.trim() == "Map:")?;
    let mut i = map_idx + 1;
    while i < lines.len() && lines[i].trim().is_empty() {
        i += 1;
    }
    let start = i;
    let mut rows: Vec<String> = Vec::new();
    while i < lines.len() {
        let t = lines[i].trim();
        if t.is_empty() || is_map_section_header(t) || rows.len() >= MAP_SLURP_CAP {
            break;
        }
        rows.push(lines[i].trim_end().to_string());
        i += 1;
    }
    if rows.is_empty() {
        return None;
    }
    let prefix = lines[..start].iter().map(|s| s.to_string()).collect();
    let suffix = lines[i..].iter().map(|s| s.to_string()).collect();
    Some((prefix, rows, suffix))
}

/// Spreadsheet-style column label: 0→A, 25→Z, 26→AA. Mirrors
/// battleMapRender.ts's columnLabel so cell refs mean the same thing in the
/// spec, the print, and the DM's own planning.
fn column_label(index: usize) -> String {
    let mut n = index;
    let mut s = String::new();
    loop {
        s.insert(0, (b'A' + (n % 26) as u8) as char);
        if n < 26 {
            break;
        }
        n = n / 26 - 1;
    }
    s
}

/// Inverse of `column_label` + a 1-based row: `"C3"` → `(2, 2)`. Pure.
fn parse_cell_ref(tok: &str) -> Option<(usize, usize)> {
    if !tok.is_ascii() {
        return None;
    }
    let letters = tok.chars().take_while(|c| c.is_ascii_alphabetic()).count();
    if letters == 0 || letters > 2 {
        return None;
    }
    let digits = &tok[letters..];
    if digits.is_empty() || digits.len() > 2 || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let mut col = 0usize;
    for c in tok[..letters].chars() {
        col = col * 26 + (c.to_ascii_uppercase() as u8 - b'A') as usize + 1;
    }
    let row: usize = digits.parse().ok()?;
    if row == 0 {
        return None;
    }
    Some((col - 1, row - 1))
}

/// True for the separator between the two ends of a cell RANGE. The model
/// reaches for an en dash by default ("Bar counter at B2–K2"), not the ASCII
/// hyphen, so all three dashes are accepted.
fn is_range_dash(sep: &str) -> bool {
    let t = sep.trim();
    !t.is_empty() && t.chars().all(|c| matches!(c, '-' | '\u{2013}' | '\u{2014}'))
}

/// Every cell a line refers to, as (token, col, row).
///
/// Crucially this EXPANDS ranges: `B2–K2` means the whole ten-cell run of the
/// bar, and `D4–E5` the 2x2 block of a table, not just the two endpoints. The
/// naive "split on anything non-alphanumeric" this replaced silently read both
/// as a pair of isolated cells, so a Features line validated against its two
/// ends while everything between it went unchecked — and, worse, the stylizer
/// (battleMapRender.ts's parseFeatureLabels, which mirrors this) labelled only
/// those two cells "a bar counter" and left the eight between them as generic
/// furniture.
fn cell_refs_in(line: &str) -> Vec<(String, usize, usize)> {
    // Alphanumeric runs, each carrying whatever separated it from the previous.
    let mut toks: Vec<(String, String)> = Vec::new();
    let (mut cur, mut sep) = (String::new(), String::new());
    for ch in line.chars() {
        if ch.is_ascii_alphanumeric() {
            cur.push(ch);
        } else {
            if !cur.is_empty() {
                toks.push((std::mem::take(&mut cur), std::mem::take(&mut sep)));
            }
            sep.push(ch);
        }
    }
    if !cur.is_empty() {
        toks.push((cur, sep));
    }

    let mut out = Vec::new();
    let mut i = 0;
    while i < toks.len() {
        let this = parse_cell_ref(&toks[i].0);
        if let (Some((c1, r1)), Some(next)) = (this, toks.get(i + 1)) {
            if is_range_dash(&next.1) {
                if let Some((c2, r2)) = parse_cell_ref(&next.0) {
                    let (cols, rows) = (c1.abs_diff(c2) + 1, r1.abs_diff(r2) + 1);
                    // A range bigger than any map we'd ever draw isn't a range —
                    // it's prose the tokenizer misread. Fall through and treat
                    // the two tokens as ordinary separate references.
                    if cols * rows <= MAP_MAX_COLS * MAP_MAX_ROWS {
                        for c in c1.min(c2)..=c1.max(c2) {
                            for r in r1.min(r2)..=r1.max(r2) {
                                out.push((format!("{}{}", column_label(c), r + 1), c, r));
                            }
                        }
                        i += 2;
                        continue;
                    }
                }
            }
        }
        if let Some((c, r)) = this {
            out.push((toks[i].0.clone(), c, r));
        }
        i += 1;
    }
    out
}

/// The `- ...` bullets under whichever section `header` names (e.g.
/// `"Features:"`, `"Objects:"`) — shared by `feature_lines`/`object_lines` so
/// "how a section's bullets are collected" can't drift between the two.
fn bullets_under(suffix: &[String], header: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut in_section = false;
    for l in suffix {
        let t = l.trim();
        if t.starts_with(header) {
            in_section = true;
            continue;
        }
        if is_map_section_header(t) {
            in_section = false;
            continue;
        }
        if in_section {
            if let Some(body) = t.strip_prefix('-') {
                let body = body.trim();
                if !body.is_empty() {
                    out.push(body.to_string());
                }
            }
        }
    }
    out
}

/// The `- ...` bullets under `Features:`.
fn feature_lines(suffix: &[String]) -> Vec<String> {
    bullets_under(suffix, "Features:")
}

/// The `- ...` bullets under `Objects:` — see `parse_object_line`.
fn object_lines(suffix: &[String]) -> Vec<String> {
    bullets_under(suffix, "Objects:")
}

fn cell_at(rows: &[String], col: usize, row: usize) -> Option<char> {
    rows.get(row).and_then(|r| r.chars().nth(col))
}

/// The row width the most rows agree on (ties → the wider one). See
/// `normalize_map_spec` for why the mode, not the max, is the repair target.
fn modal_row_width(rows: &[String]) -> usize {
    let mut widths: Vec<usize> = rows.iter().map(|r| r.chars().count()).collect();
    widths.sort_unstable();
    let mut best = (0usize, 0usize); // (count, width)
    let mut i = 0;
    while i < widths.len() {
        let w = widths[i];
        let run = widths[i..].iter().take_while(|x| **x == w).count();
        // `>=` with the ascending sort means a tie keeps the wider width.
        if run >= best.0 {
            best = (run, w);
        }
        i += run;
    }
    best.1
}

/// A `+` is only a door if it's set into a wall run — `#` on both sides either
/// horizontally or vertically. A `+` floating on open floor is the "four doors
/// in the middle of the room" bug.
fn door_in_wall(rows: &[String], col: usize, row: usize) -> bool {
    let at = |c: isize, r: isize| -> char {
        if c < 0 || r < 0 {
            return ' ';
        }
        cell_at(rows, c as usize, r as usize).unwrap_or(' ')
    };
    let (c, r) = (col as isize, row as isize);
    (at(c - 1, r) == '#' && at(c + 1, r) == '#') || (at(c, r - 1) == '#' && at(c, r + 1) == '#')
}

/// The `<cols>x<rows>` the `Grid:` line CLAIMS (which may be a lie).
fn declared_dims(spec: &str) -> Option<(usize, usize)> {
    let line = spec.lines().find(|l| l.trim_start().starts_with("Grid:"))?;
    line.split(|c: char| !(c.is_ascii_digit() || c == 'x' || c == 'X'))
        .filter_map(|tok| tok.split_once(['x', 'X']))
        .find_map(|(a, b)| match (a.parse::<usize>(), b.parse::<usize>()) {
            (Ok(a), Ok(b)) => Some((a, b)),
            _ => None,
        })
}

/// Concrete, model-readable problems with a spec — empty means it's sound.
/// Fed back verbatim for one retry (see `generate_one_map_spec`). Pure.
fn validate_map_spec(spec: &str) -> Vec<String> {
    let mut issues = Vec::new();
    let Some((_, rows, suffix)) = split_spec_grid(spec) else {
        issues.push("The spec has no `Map:` block with grid rows under it.".to_string());
        return issues;
    };

    let mut widths: Vec<usize> = rows.iter().map(|r| r.chars().count()).collect();
    widths.sort_unstable();
    widths.dedup();
    if widths.len() > 1 {
        issues.push(format!(
            "The grid rows are not all the same width (found widths {widths:?}). EVERY row must be exactly the same number of characters — count them."
        ));
    }
    let cols = widths.last().copied().unwrap_or(0);
    let rows_n = rows.len();

    if let Some((dc, dr)) = declared_dims(spec) {
        if dc != cols || dr != rows_n {
            issues.push(format!(
                "The `Grid:` line says {dc}x{dr} but the map block you drew is actually {cols}x{rows_n}. They must match exactly."
            ));
        }
    }
    if cols < MAP_MIN_COLS || rows_n < MAP_MIN_ROWS || cols > MAP_MAX_COLS || rows_n > MAP_MAX_ROWS {
        issues.push(format!(
            "The map is {cols}x{rows_n}; it must be between {MAP_MIN_COLS}x{MAP_MIN_ROWS} and {MAP_MAX_COLS}x{MAP_MAX_ROWS}."
        ));
    }

    let mut unknown: Vec<char> = rows
        .iter()
        .flat_map(|r| r.chars())
        .filter(|c| *c != ' ' && !MAP_CODES.contains(c))
        .collect();
    unknown.sort_unstable();
    unknown.dedup();
    if !unknown.is_empty() {
        issues.push(format!(
            "The grid uses characters that aren't in the legend: {unknown:?}. Use ONLY the legend codes."
        ));
    }

    for (r, row) in rows.iter().enumerate() {
        for (c, ch) in row.chars().enumerate() {
            if ch == '+' && !door_in_wall(&rows, c, r) {
                issues.push(format!(
                    "The door at {}{} is standing on open floor. A `+` must be set into a wall run — a `#` on both sides of it, horizontally or vertically.",
                    column_label(c),
                    r + 1
                ));
            }
        }
    }

    for line in feature_lines(&suffix) {
        let names_furniture = feature_line_names_furniture(&line);
        for (tok, c, r) in cell_refs_in(&line) {
            match cell_at(&rows, c, r) {
                None => issues.push(format!(
                    "Features says \"{line}\" but cell {tok} is outside the {cols}x{rows_n} grid."
                )),
                Some(ch) if !MAP_OBJECT_CODES.contains(&ch) => {
                    let what = match ch {
                        '.' => "plain floor",
                        '#' => "a wall",
                        ' ' => "empty void outside the map",
                        _ => "not an object",
                    };
                    issues.push(format!(
                        "Features says \"{line}\" but cell {tok} contains `{ch}` ({what}) — there is nothing there. Every Features line must point at a cell you actually drew the matching code in."
                    ));
                }
                Some(ch) if names_furniture && ch != '=' => {
                    issues.push(format!(
                        "Features says \"{line}\" but cell {tok} contains `{ch}`, not `=`. \"{}\" is furniture — draw it with the `=` legend code, not `{ch}` (that means something else entirely).",
                        feature_line_name(&line)
                    ));
                }
                _ => {}
            }
        }
    }

    for line in object_lines(&suffix) {
        let Some((label, c, r, w, h)) = parse_object_line(&line) else {
            issues.push(format!(
                "Objects says \"{line}\" but that doesn't parse as \"<description> at <cell> (<W>x<H>)\"."
            ));
            continue;
        };
        match cell_at(&rows, c, r) {
            None => issues.push(format!("Objects says \"{label}\" at a cell outside the {cols}x{rows_n} grid.")),
            Some('#') => issues.push(format!(
                "Objects says \"{label}\" at {}{}, but that cell is a `#` wall — objects need real floor.",
                column_label(c),
                r + 1
            )),
            Some(' ') => issues.push(format!(
                "Objects says \"{label}\" at {}{}, but that cell is void, outside the map.",
                column_label(c),
                r + 1
            )),
            _ => {}
        }
        if !(1..=4).contains(&w) || !(1..=4).contains(&h) {
            issues.push(format!(
                "Objects says \"{label}\" is {w}x{h} — width and height must both be whole numbers from 1 to 4."
            ));
        }
    }

    issues
}

/// Parses one `Objects:` bullet body (already stripped of its leading `- `
/// by `object_lines`): `<label> at <cell> (<W>x<H>)` → (label, col, row, w,
/// h). `None` if it doesn't match that shape, which `validate_map_spec`
/// reports as an issue rather than silently dropping — same treatment as a
/// malformed Features line.
/// Make the library's footprint guide ("tree 2x2") BINDING on Objects lines
/// instead of advisory. Returns the spec with every under-sized object grown in
/// place when the extra cells are open floor, plus an issue for each one it
/// couldn't safely grow (cheap-retry material — same family as the other
/// `Objects says` issues).
///
/// Exists because advice measurably wasn't enough: with "tree 2x2" in the
/// prompt's SIZE GUIDE, the model still wrote eleven `Pine trees (1x1)`, and a
/// 1x1 tree in this pack can only resolve to novelty clutter (fifteen
/// gingerbread trees, live 2026-07-20). Deterministic repair costs nothing;
/// a retry costs a model call; the prompt line alone cost a whole map.
fn enforce_object_sizes(spec: &str, guide: &[(String, u32, u32)]) -> (String, Vec<String>) {
    if guide.is_empty() {
        return (spec.to_string(), Vec::new());
    }
    let Some((_, rows, _)) = split_spec_grid(spec) else {
        return (spec.to_string(), Vec::new());
    };
    // Singular/plural tolerant word match, both directions ("trees" ~ "tree").
    let word_hits = |word: &str, noun: &str| word == noun || word.strip_suffix('s') == Some(noun) || noun.strip_suffix('s') == Some(word);
    let mut issues = Vec::new();
    let mut out_lines: Vec<String> = Vec::new();
    // Only rewrite inside the `Objects:` section — a Tactics sentence like
    // "shove the boulder at E5 (2x2)" parses identically and must not be
    // touched.
    let mut in_objects = false;
    for line in spec.lines() {
        let t = line.trim();
        if t == "Objects:" {
            in_objects = true;
            out_lines.push(line.to_string());
            continue;
        }
        if in_objects && (t.ends_with(':') && !t.starts_with('-') || t.starts_with("# ")) {
            in_objects = false;
        }
        if !in_objects {
            out_lines.push(line.to_string());
            continue;
        }
        let Some((label, c, r, w, h)) = parse_object_line(t.trim_start_matches('-').trim()) else {
            out_lines.push(line.to_string());
            continue;
        };
        let lower = label.to_lowercase();
        let hit = guide.iter().find(|(noun, _, _)| lower.split(|ch: char| !ch.is_alphanumeric()).any(|word| word_hits(word, noun)));
        let Some((noun, gw, gh)) = hit else {
            out_lines.push(line.to_string());
            continue;
        };
        // Either orientation of the minimum size satisfies the guide.
        if (w >= *gw && h >= *gh) || (w >= *gh && h >= *gw) {
            out_lines.push(line.to_string());
            continue;
        }
        // Grow in place if every cell of the enlarged footprint is open floor —
        // anchor stays put, footprint extends right/down, wider-first when the
        // original was wider than tall.
        let all_floor = |fw: u32, fh: u32| (0..fw as usize).all(|dc| (0..fh as usize).all(|dr| matches!(cell_at(&rows, c + dc, r + dr), Some('.'))));
        let orientations = if w >= h { [(*gw, *gh), (*gh, *gw)] } else { [(*gh, *gw), (*gw, *gh)] };
        if let Some((nw, nh)) = orientations.iter().find(|(fw, fh)| all_floor(*fw, *fh)) {
            out_lines.push(line.replacen(&format!("({w}x{h})"), &format!("({nw}x{nh})"), 1));
        } else {
            issues.push(format!(
                "Objects says \"{label}\" at {}{} ({w}x{h}), but in this tile library \"{noun}\" art only exists at {gw}x{gh} or larger — move it somewhere with {gw}x{gh} of open floor, or replace it with something small.",
                column_label(c), r + 1
            ));
            out_lines.push(line.to_string());
        }
    }
    let mut out = out_lines.join("\n");
    if spec.ends_with('\n') {
        out.push('\n');
    }
    (out, issues)
}

fn parse_object_line(line: &str) -> Option<(String, usize, usize, u32, u32)> {
    let lower = line.to_lowercase();
    let at_idx = lower.find(" at ")?;
    let label = line[..at_idx].trim().to_string();
    let rest = line[at_idx + 4..].trim();

    let open = rest.rfind('(')?;
    let close = rest.rfind(')')?;
    if close <= open {
        return None;
    }
    let cell_part = rest[..open].trim();
    let (w_str, h_str) = rest[open + 1..close].split_once(['x', 'X'])?;
    let w: u32 = w_str.trim().parse().ok()?;
    let h: u32 = h_str.trim().parse().ok()?;

    // The cell ref is the leading alphanumeric run — tolerates trailing
    // punctuation/prose the model sometimes leaves before the `(WxH)`.
    let cell_tok: String = cell_part.chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
    let (col, row) = parse_cell_ref(&cell_tok)?;
    Some((label, col, row, w, h))
}

/// One thing on the map worth resolving to a real catalog tile — a named
/// Features feature (its cells and the box they span) or an Objects entry.
/// `cells` are (col,row) 0-indexed; `w`/`h` are the footprint in cells that a
/// chosen tile is scaled/tiled to fill.
#[derive(Debug, Clone, PartialEq)]
struct Placement {
    label: String,
    cells: Vec<(usize, usize)>,
    w: u32,
    h: u32,
}

/// 4-connected components of a cell set — so "Bar counter at C3-J3" (one
/// contiguous run) is ONE placement, while "Pillars at C4, G4" (two separate
/// cells) splits into two, each resolved and sized on its own. Pure.
fn connected_components(cells: &[(usize, usize)]) -> Vec<Vec<(usize, usize)>> {
    use std::collections::HashSet;
    let set: HashSet<(usize, usize)> = cells.iter().copied().collect();
    let mut seen: HashSet<(usize, usize)> = HashSet::new();
    let mut comps = Vec::new();
    for &start in cells {
        if !seen.insert(start) {
            continue;
        }
        let mut stack = vec![start];
        let mut comp = Vec::new();
        while let Some((c, r)) = stack.pop() {
            comp.push((c, r));
            for (dc, dr) in [(1i32, 0), (-1, 0), (0, 1), (0, -1)] {
                let (nc, nr) = (c as i32 + dc, r as i32 + dr);
                if nc >= 0 && nr >= 0 {
                    let n = (nc as usize, nr as usize);
                    if set.contains(&n) && seen.insert(n) {
                        stack.push(n);
                    }
                }
            }
        }
        comp.sort_unstable();
        comps.push(comp);
    }
    comps
}

/// Footprint (width, height) in cells of a component's bounding box. Pure.
fn bbox_wh(cells: &[(usize, usize)]) -> (u32, u32) {
    let (mut min_c, mut max_c, mut min_r, mut max_r) = (usize::MAX, 0usize, usize::MAX, 0usize);
    for &(c, r) in cells {
        min_c = min_c.min(c);
        max_c = max_c.max(c);
        min_r = min_r.min(r);
        max_r = max_r.max(r);
    }
    ((max_c - min_c + 1) as u32, (max_r - min_r + 1) as u32)
}

/// Every discrete object on a finished spec that the vision resolver should
/// try to swap for a real catalog tile: each Features feature (split into
/// connected objects, restricted to RESOLVABLE_GLYPHS cells) and each Objects
/// entry (its whole WxH footprint). Structural terrain is skipped entirely.
/// Pure — the orchestration around it (search, vision pick, persist) lives
/// elsewhere so this stays directly unit-testable on a spec string.
fn parse_placements(spec: &str) -> Vec<Placement> {
    let Some((_, rows, suffix)) = split_spec_grid(spec) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for line in feature_lines(&suffix) {
        let label = feature_line_name(&line).to_string();
        let cells: Vec<(usize, usize)> = cell_refs_in(&line)
            .into_iter()
            .filter_map(|(_, c, r)| match cell_at(&rows, c, r) {
                Some(ch) if RESOLVABLE_GLYPHS.contains(&ch) => Some((c, r)),
                _ => None,
            })
            .collect();
        for comp in connected_components(&cells) {
            let (w, h) = bbox_wh(&comp);
            out.push(Placement { label: label.clone(), cells: comp, w, h });
        }
    }
    for line in object_lines(&suffix) {
        if let Some((label, c, r, w, h)) = parse_object_line(&line) {
            let cells = (0..w as usize)
                .flat_map(|dc| (0..h as usize).map(move |dr| (dc, dr)))
                .map(|(dc, dr)| (c + dc, r + dr))
                .collect();
            out.push(Placement { label, cells, w, h });
        }
    }
    out
}

// ── Vision tile resolution (gen-time only; see the plan) ─────────────────────

/// How many real candidate tiles the vision picker is shown per slot.
const VISION_SHORTLIST_K: usize = 8;

/// What the UI shows while a map is being made. `elapsed_s` is the whole
/// operation's age, re-emitted on a timer — a number that keeps climbing is
/// the only honest "it hasn't hung" signal available, because the expensive
/// phase is one opaque model call that reports nothing until it returns.
#[derive(Serialize, Clone)]
struct MapProgress {
    phase: &'static str,
    elapsed_s: u64,
}

/// Runs `f` while emitting `map-progress` every couple of seconds, so a long
/// silent phase still visibly ticks. The ticker is a plain detached thread
/// stopped by a flag; it never blocks or fails the work it's reporting on.
fn with_map_ticker<T>(app: &AppHandle, phase: &'static str, started: std::time::Instant, f: impl FnOnce() -> T) -> T {
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    {
        let (app, stop) = (app.clone(), stop.clone());
        std::thread::spawn(move || {
            while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                let _ = app.emit("map-progress", MapProgress { phase, elapsed_s: started.elapsed().as_secs() });
                std::thread::sleep(std::time::Duration::from_secs(2));
            }
        });
    }
    let out = f();
    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    out
}

/// One line per map generation naming where the wall-clock actually went, to
/// both stderr and the map log. Added because the visible cost of "regenerate"
/// was being attributed by guesswork — the phases are a model call, a catalog
/// scan, and a vision pass, and they differ by orders of magnitude.
fn log_map_phase_timing(entry: &str, vocab: std::time::Duration, spec: std::time::Duration, tiles: std::time::Duration) {
    let total = vocab + spec + tiles;
    let line = format!(
        "{entry}: total {:.1}s = vocabulary {:.1}s + spec {:.1}s + tiles {:.1}s",
        total.as_secs_f64(),
        vocab.as_secs_f64(),
        spec.as_secs_f64(),
        tiles.as_secs_f64()
    );
    eprintln!("[map-timing] {line}");
    crate::maplog::log("PHASE TIMING", &line);
}

/// Where a flame overlay sits within a fire vessel's footprint, as
/// `[x, y, w, h]` in fractional cells (absolute grid coords).
///
/// The firebox is a property of the SPRITE, not of the map. All 372
/// fireplace/brazier sprites in the catalog are drawn with their art centred
/// on the tile (art-bbox centre x 0.53-0.57, y 0.497-0.499), so there is no
/// per-map orientation to infer. An earlier version read which walls the
/// vessel backed onto and shoved the flame diagonally toward the open side —
/// off the firebox the artist had already centred.
///
/// Measured off the sprites instead: across all four hearth families
/// (Rectangle/Rounded/Corner 2x2, Chimneyless 1x2) the ash bed sits at
/// x 0.49-0.57, y 0.49-0.50 of the tile, and a warm flame sprite fills only
/// ~0.82 x 0.90 of its own canvas — so the drawn rect is that ash bed divided
/// by the fill, which is why it is wider than the bed itself. A brazier is a
/// bowl seen top-down: centred, with the flame filling it. Pure.
fn firebox_rect(cells: &[(usize, usize)], hearth: bool) -> [f32; 4] {
    let (minc, maxc) = (cells.iter().map(|&(c, _)| c).min().unwrap_or(0), cells.iter().map(|&(c, _)| c).max().unwrap_or(0));
    let (minr, maxr) = (cells.iter().map(|&(_, r)| r).min().unwrap_or(0), cells.iter().map(|&(_, r)| r).max().unwrap_or(0));
    let (fw, fh) = ((maxc - minc + 1) as f32, (maxr - minr + 1) as f32);
    // Centre + size as fractions of the footprint.
    let (cx, cy, w, h) = if hearth { (0.545, 0.50, 0.34, 0.49) } else { (0.50, 0.50, 0.62, 0.62) };
    [minc as f32 + (cx - w / 2.0) * fw, minr as f32 + (cy - h / 2.0) * fh, w * fw, h * fh]
}

/// True when `tiles` exists and is at least as new as `spec` — i.e. the
/// resolved sidecar already reflects the current map and needn't be redone.
/// A missing/unreadable sidecar is "not up to date" → resolve.
fn tiles_up_to_date(tiles: &Path, spec: &Path) -> bool {
    let mtime = |p: &Path| fs::metadata(p).and_then(|m| m.modified()).ok();
    match (mtime(tiles), mtime(spec)) {
        (Some(t), Some(s)) => t >= s,
        _ => false,
    }
}

/// The model tier for the tile-pick vision call — Sonnet is multimodal and
/// much cheaper than Opus for what is a visual matching task, not a reasoning
/// one. (Verified live that the subscription CLI accepts image blocks and
/// Sonnet identifies tiles correctly.)
const VISION_PICK_MODEL: &str = "sonnet";

/// One resolved placement persisted to `<slug>.tiles.json` and reloaded (with
/// fresh art) by `get_map_tiles` at render time. `w`/`h` are the placement's
/// footprint in cells; `tw`/`th` are the CHOSEN tile's native size, so the
/// renderer can tile a small piece across a bigger run (a 1x1 bar segment
/// across a 6x1 counter) instead of stretching it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct ResolvedTile {
    cells: Vec<(usize, usize)>,
    w: u32,
    h: u32,
    tw: u32,
    th: u32,
    root: String,
    rel_path: String,
    /// Optional sub-cell placement `[x, y, w, h]` in fractional cells (absolute
    /// grid coords). When set, the renderer draws this tile ONCE inside that
    /// rect instead of tiling it across the footprint — used for a hearth's
    /// flame overlay, sized smaller than the hearth and pushed into the firebox.
    #[serde(default)]
    sub: Option<[f32; 4]>,
}

/// A catalog tile's identity (which folder + relative path) — enough to reload
/// its art. Used for the biome ground texture, which has no cells of its own.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct TileRef {
    root: String,
    rel_path: String,
}

/// The whole resolved sidecar for one map (`<slug>.tiles.json`): the picked
/// object tiles plus the biome ground texture (None = keep the built-in floor).
#[derive(Serialize, Deserialize, Default)]
struct ResolvedMap {
    #[serde(default)]
    objects: Vec<ResolvedTile>,
    #[serde(default)]
    floor: Option<TileRef>,
    /// The `~` cells' texture. `None` when the grid has no `~` at all (so no
    /// vision call is spent) or when nothing suitable resolved.
    #[serde(default)]
    liquid: Option<TileRef>,
    /// True when `#` should be drawn as this biome's own ground, darkened,
    /// instead of the built-in masonry sprites — see `NATURAL_WALL_BIOMES`.
    #[serde(default)]
    natural_walls: bool,
}

/// Splits a `data:<media>;base64,<b64>` URL into (media_type, base64). Falls
/// back to webp if it's not shaped as expected. Pure.
fn split_data_url(u: &str) -> (&str, &str) {
    let rest = u.strip_prefix("data:").unwrap_or(u);
    let (media, tail) = rest.split_once(';').unwrap_or(("image/webp", rest));
    let b64 = tail.split_once(',').map(|(_, b)| b).unwrap_or(tail);
    (media, b64)
}

/// The JSON object substring of a possibly-chatty model reply (first `{` to
/// last `}`), so a `{"picks":[...]}` answer survives surrounding prose. Pure.
fn extract_json_object(s: &str) -> String {
    match (s.find('{'), s.rfind('}')) {
        (Some(a), Some(b)) if b > a => s[a..=b].to_string(),
        _ => s.to_string(),
    }
}

/// Parses the vision reply into one pick per slot: `Some(candidate_index)`
/// (0-based) or `None` (the model chose 0/"none", or didn't answer for that
/// slot). Tolerant of surrounding prose and missing/extra entries. Pure.
fn parse_vision_picks(reply: &str, n_slots: usize) -> Vec<Option<usize>> {
    let mut picks = vec![None; n_slots];
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&extract_json_object(reply)) else {
        return picks;
    };
    let Some(arr) = v.get("picks").and_then(|p| p.as_array()) else {
        return picks;
    };
    for item in arr {
        // Accept a FRACTIONAL choice. Live (2026-07-19) one chunk came back
        // `{"choice":1.8},{"choice":2.5},{"choice":3.1}` — `as_u64` is None for
        // a float, so all three picks were silently dropped and that map lost
        // its shelf, keg AND fireplace. The intent is obvious; round it rather
        // than throw the slot away. Same for a stringly-typed number.
        let as_index = |v: Option<&serde_json::Value>| -> Option<u64> {
            let v = v?;
            v.as_u64()
                .or_else(|| v.as_f64().filter(|f| f.is_finite() && *f >= 0.0).map(|f| f.round() as u64))
                .or_else(|| v.as_str().and_then(|s| s.trim().parse::<f64>().ok()).filter(|f| f.is_finite() && *f >= 0.0).map(|f| f.round() as u64))
        };
        let (Some(slot), Some(choice)) = (as_index(item.get("slot")), as_index(item.get("choice"))) else {
            continue;
        };
        let si = (slot as usize).wrapping_sub(1);
        if si < n_slots && choice >= 1 {
            picks[si] = Some((choice - 1) as usize);
        }
    }
    picks
}

/// Builds the multimodal user-message JSON string: every slot's label +
/// footprint, its candidate tiles (each as an indexed image), and the final
/// instruction to answer with a `picks` array. Pure. Instruction is verbose on
/// purpose — the model must key its choice to footprint and identity, and know
/// 0 means "none of these fit".
fn build_vision_message(slots: &[(&Placement, Vec<crate::tile_library::TileCandidate>)], biome: &str) -> String {
    use serde_json::json;
    let mut content = vec![json!({"type":"text","text": format!(
        "This is a {biome} scene. When a slot's options differ mainly in MATERIAL or COLOUR, prefer the one that best suits a {biome} setting — e.g. a wooden tavern wants wooden furniture, a cave or dungeon wants stone, an outdoor camp wants rough/rustic pieces. Match the mood, not just the shape."
    )})];
    for (i, (p, cands)) in slots.iter().enumerate() {
        let n = i + 1;
        content.push(json!({"type":"text","text": format!("[slot {n}] \"{}\" — must fit a {}x{}-cell footprint. Options:", p.label, p.w, p.h)}));
        for (j, c) in cands.iter().enumerate() {
            content.push(json!({"type":"text","text": format!("[{n}.{}] this tile is {}x{} cells:", j + 1, c.w, c.h)}));
            let (media, b64) = split_data_url(&c.data_url);
            content.push(json!({"type":"image","source":{"type":"base64","media_type":media,"data":b64}}));
        }
    }
    content.push(json!({"type":"text","text":
        "For EACH slot, pick the option number whose picture best matches that slot's description AND fits its footprint. \
         If none of a slot's options actually look like the thing described, choose 0 for that slot (better nothing than a wrong object). \
         When several slots are the SAME kind of object (e.g. three separate tables), prefer DIFFERENT options across them so the scene has natural variety — unless they should obviously match, like a row of identical benches at one long table. \
         Reply with ONLY this JSON, one entry per slot, nothing else: {\"picks\":[{\"slot\":1,\"choice\":2},{\"slot\":2,\"choice\":0}]}"
    }));
    json!({"type":"user","message":{"role":"user","content":content}}).to_string()
}

/// Max candidate images in a single vision request. One call for a whole map
/// (12 slots x 8 = 96 images) is rejected as "Prompt is too long" — each image
/// costs ~1.5k tokens and the CLI also loads the project's CLAUDE.md/plugin
/// context. Live-checked: 40 images is comfortably fine, so 24 leaves generous
/// headroom for larger multi-cell tiles that cost more per image.
const MAX_IMAGES_PER_VISION_CALL: usize = 24;

/// Contiguous chunk boundaries over `slots` so each chunk's total candidate
/// count stays within `MAX_IMAGES_PER_VISION_CALL` (always at least one slot
/// per chunk, even if that one slot alone exceeds the cap). Pure. Returns
/// (start, len) pairs.
fn vision_chunks(slot_candidate_counts: &[usize], cap: usize) -> Vec<(usize, usize)> {
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < slot_candidate_counts.len() {
        let (mut end, mut imgs) = (start, 0usize);
        while end < slot_candidate_counts.len() {
            let n = slot_candidate_counts[end];
            if end > start && imgs + n > cap {
                break;
            }
            imgs += n;
            end += 1;
        }
        chunks.push((start, end - start));
        start = end;
    }
    chunks
}

/// Shows Claude the candidate tiles and returns its pick per slot. Splits the
/// slots into image-budget-sized chunks run IN PARALLEL (mirrors
/// generate_map_spec's parallel candidate calls) — one giant request is
/// "Prompt is too long", and a chunk failing only loses its own slots (they
/// fall back to built-in sprites), not the whole map. Never fatal.
fn pick_tiles_via_vision(slots: &[(&Placement, Vec<crate::tile_library::TileCandidate>)], biome: &str) -> Vec<Option<usize>> {
    let counts: Vec<usize> = slots.iter().map(|(_, c)| c.len()).collect();
    let chunks = vision_chunks(&counts, MAX_IMAGES_PER_VISION_CALL);
    let results: Vec<(usize, Vec<Option<usize>>)> = std::thread::scope(|s| {
        chunks
            .iter()
            .map(|&(start, len)| {
                let chunk = &slots[start..start + len];
                s.spawn(move || (start, pick_one_chunk(chunk, biome)))
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect()
    });
    let mut picks = vec![None; slots.len()];
    for (start, chunk_picks) in results {
        for (i, p) in chunk_picks.into_iter().enumerate() {
            picks[start + i] = p;
        }
    }
    picks
}

/// One vision call for one chunk of slots — picks aligned to the chunk's own
/// 1-based numbering. Failure → all-`None` for this chunk (built-in fallback).
fn pick_one_chunk(chunk: &[(&Placement, Vec<crate::tile_library::TileCandidate>)], biome: &str) -> Vec<Option<usize>> {
    match crate::dm::run_claude_vision(&build_vision_message(chunk, biome), Some(VISION_PICK_MODEL)) {
        Ok(reply) => {
            crate::maplog::log("VISION TILE PICK (raw reply)", &reply);
            parse_vision_picks(&reply, chunk.len())
        }
        Err(e) => {
            crate::maplog::log("VISION TILE PICK FAILED", &format!("{e}\n(this chunk falls back to built-in sprites)"));
            vec![None; chunk.len()]
        }
    }
}

/// Biome ids the ground resolver understands, each mapped to the catalog
/// Textures search that finds its floor. Small fixed set — `classify_biome`
/// picks one. "dungeon" is deliberately absent: it IS the built-in look, so a
/// dungeon map keeps the current stone floor (no override, no vision call).
/// CAREFUL: never end one of these queries with the bare word "floor". The
/// head noun (last token) takes a 1000x exact-match tier, `Brick_Floor_*` is
/// `!Core_Settlements` (which biome affinity always scores 1.0), and every
/// biome-specific texture is scored 0.15 for being off-biome — so ANY "… floor"
/// query resolves to brick. That silently cost tavern ("wooden floor"), cave
/// ("cave rock floor") and underdark ("drow floor") their ground for months.
/// Name the material instead and probe the result before trusting it.
const BIOME_FLOORS: &[(&str, &str)] = &[
    ("cave", "cave"),
    ("forest", "grass"),
    ("desert", "desert sand"),
    ("snow", "snow"),
    ("swamp", "marsh mud"),
    ("coast", "beach sand"),
    ("volcanic", "volcanic rock"),
    ("town", "cobblestone"),
    ("tavern", "brick floor"),
    ("underdark", "drow stone"),
    ("jungle", "jungle grass"),
];

/// Scenes that honestly read with more than one ground material, so the floor
/// is ROLLED each time a map resolves instead of always landing on the same
/// board. `(biome, alternate query, d20 the alternate wins on)`.
///
/// Only the MATERIAL is rolled. Which particular brick or plank gets used still
/// comes from the normal ranking + vision pick, so both branches get a good
/// tile rather than a random one.
///
/// Note the tavern alternate is "wooden FLOORING", not "wooden floor": the
/// catalog names these `Wooden_Flooring_A_Light.jpg` (keyword `flooring`), and
/// `floor` is not a plural of `flooring` — see the warning on `BIOME_FLOORS`.
///
/// Every pair here is COSMETIC ONLY: both materials play identically, because
/// the roll changes the texture without touching the grid or the Tactics prose.
/// That's why snow and volcanic are deliberately absent — their tempting
/// alternates are ice (slippery) and lava (lethal), and rendering either one
/// under Tactics that never mention it would make the map lie about itself.
///
/// Every query below was probed against the live catalog; the ones that only
/// LOOK reasonable ("dirt road" → dirt-STAINED brick, "moss" → mossy roof
/// tiles) were dropped rather than shipped on the strength of the wording.
const BIOME_FLOOR_ALTS: &[(&str, &str, u32)] = &[
    ("forest", "forest floor", 11),  // leaf litter is as common as open grass
    ("swamp", "marsh grass", 12),
    ("underdark", "dwarven", 13),    // drow-cut stone vs dwarven hall
    ("tavern", "wooden flooring", 14),
    ("cave", "gravel", 15),
    ("desert", "sand rock", 15),
    ("jungle", "wet mud", 15),
    ("coast", "gravel", 16),         // a shingle beach instead of soft sand
    ("town", "gravel", 16),
];

/// Biomes whose `#` cells are LIVING ROCK rather than built masonry, so the
/// renderer should draw them as the biome's own ground darkened instead of the
/// built-in brick sprites. A tavern or town wall really is mortared stone and
/// reads correctly today; a limestone cave ringed in brick reads as a dungeon
/// room, which is exactly what every cave map looked like.
///
/// Deliberately NOT resolved as its own texture: the catalog's `Textures` are
/// all GROUND art, and the best "rock" candidate (`Rock_Tiles_A_01`) is tan
/// crazy-paving — a patio, not a rock face. Reusing the floor darkened needs no
/// extra query, no extra vision call, and can't disagree with the floor.
const NATURAL_WALL_BIOMES: &[&str] = &["cave", "underdark", "volcanic", "snow", "swamp", "forest", "jungle", "desert", "coast"];

fn has_natural_walls(biome: &str) -> bool {
    NATURAL_WALL_BIOMES.contains(&biome)
}

/// The catalog search for `~` cells. One query for every biome — water is
/// water — and only ever run when the grid actually contains a `~`, so a map
/// without any spends no vision call on it.
const LIQUID_QUERY: &str = "water";

/// The ground query for `biome` given a d20 `roll` — the alternate material if
/// the roll reaches its threshold, else the biome's default. Pure, so the odds
/// are testable without the RNG.
fn roll_floor_query(biome: &str, roll: u32) -> Option<&'static str> {
    let primary = biome_floor_query(biome)?;
    match BIOME_FLOOR_ALTS.iter().find(|(b, _, _)| *b == biome) {
        Some((_, alt, at)) if roll >= *at => Some(alt),
        _ => Some(primary),
    }
}

/// Every biome the classifier may return — the ground-swap set plus "dungeon"
/// (the default / built-in floor).
fn biome_ids() -> Vec<&'static str> {
    std::iter::once("dungeon").chain(BIOME_FLOORS.iter().map(|(b, _)| *b)).collect()
}

/// Cheap TEXT classification of a finished map's biome from its title +
/// Features + Tactics (never the grid or images), constrained to `biome_ids`.
/// Keeps biome detection OUT of the fragile map-generation prompt — it runs at
/// resolution time on the already-written spec. Defaults to "dungeon" on any
/// miss, which is a no-op (built-in floor).
fn classify_biome(spec: &str) -> String {
    let ids = biome_ids();
    let context: String = spec
        .lines()
        .filter(|l| {
            let t = l.trim();
            t.starts_with('#') || t.starts_with('-') || t.starts_with("Features") || t.starts_with("Tactics")
        })
        .collect::<Vec<_>>()
        .join("\n");
    let prompt = format!(
        "A tabletop battle map is described below. Which single setting best fits where it takes place? Reply with EXACTLY one word from this list and nothing else: {}.\n\n{}",
        ids.join(", "),
        context
    );
    let reply = crate::local_llm::ask_ingest_once_low_effort(prompt, Some("sonnet")).unwrap_or_default();
    let lc = reply.to_lowercase();
    ids.iter().find(|id| lc.contains(**id)).map(|s| s.to_string()).unwrap_or_else(|| "dungeon".to_string())
}

/// Vision-pick the best-looking ground texture for `biome` from its candidate
/// tiles. `None` on any transport/parse failure (keep the built-in floor).
fn pick_texture(biome: &str, kind: &str, cands: &[crate::tile_library::TileCandidate]) -> Option<usize> {
    use serde_json::json;
    let mut content = vec![json!({"type":"text","text": format!("These are candidate texture tiles for a {biome} battle map. Pick the one that best reads as {kind}. Prefer a SOLID, fully-opaque tile that fills the whole square — avoid any that look like a sparse, mostly-transparent decal or overlay.")})];
    for (j, c) in cands.iter().enumerate() {
        content.push(json!({"type":"text","text": format!("[{}]", j + 1)}));
        let (m, b) = split_data_url(&c.data_url);
        content.push(json!({"type":"image","source":{"type":"base64","media_type":m,"data":b}}));
    }
    content.push(json!({"type":"text","text":"Reply with ONLY this JSON: {\"choice\":N} where N is the best option's number."}));
    let msg = json!({"type":"user","message":{"role":"user","content":content}}).to_string();
    let reply = crate::dm::run_claude_vision(&msg, Some(VISION_PICK_MODEL)).ok()?;
    crate::maplog::log("VISION TEXTURE PICK (raw reply)", &format!("{kind}: {reply}"));
    let v: serde_json::Value = serde_json::from_str(&extract_json_object(&reply)).ok()?;
    let choice = v.get("choice")?.as_u64()?;
    (1..=cands.len() as u64).contains(&choice).then(|| (choice - 1) as usize)
}

/// Resolve the biome ground texture for a finished spec: classify the biome,
/// then vision-pick a ground tile from the catalog's Textures. `None` for a
/// dungeon (keep the built-in stone floor), an unknown biome, or no candidates.
fn resolve_floor(app: &AppHandle, biome: &str) -> Option<TileRef> {
    use rand::Rng;
    let roll = rand::thread_rng().gen_range(1..=20);
    let query = roll_floor_query(biome, roll)?; // "dungeon" isn't in BIOME_FLOORS → None → keep built-in
    let all = crate::tile_library::shortlist_in_category(app, query, "Textures", biome, 1, 1, VISION_SHORTLIST_K);
    // Drop textures too dark (or too blown out) to be a board you place minis
    // on. Live: a d20 landed "gravel" on Gravel_05_F (luminance 48) and the
    // whole cave — floor, walls, objects — rendered as one dark smear, while
    // Cave_Floor_02_A (92) read correctly. Keep everything if the filter would
    // empty the list; a dark floor still beats no floor.
    let usable: Vec<_> = all.iter().filter(|c| c.luminance.is_none_or(crate::tile_library::luminance_is_usable_floor)).cloned().collect();
    let dropped = all.len() - usable.len();
    let cands = if usable.is_empty() { all } else { usable };
    crate::maplog::log(
        "FLOOR RESOLUTION",
        &format!("biome={biome}, d20={roll} → query={query:?}, {} texture candidate(s){}", cands.len(), if dropped > 0 { format!(" ({dropped} dropped as unusably dark/bright)") } else { String::new() }),
    );
    let idx = pick_texture(biome, &format!("natural {biome} ground underfoot"), &cands)?;
    let c = cands.get(idx)?;
    Some(TileRef { root: c.root.clone(), rel_path: c.rel_path.clone() })
}

/// The `~` cells' texture. Skipped entirely — no shortlist, no vision call —
/// when the grid contains no `~`, which is most maps. Replaces a flat blue
/// square drawn in code (`COLORS.water`) that read as a swimming pool next to
/// the catalog art around it.
fn resolve_liquid(app: &AppHandle, biome: &str, rows: &[String]) -> Option<TileRef> {
    if !rows.iter().any(|r| r.contains('~')) {
        return None;
    }
    let cands = crate::tile_library::shortlist_in_category(app, LIQUID_QUERY, "Textures", biome, 1, 1, VISION_SHORTLIST_K);
    crate::maplog::log("LIQUID RESOLUTION", &format!("biome={biome}, query={LIQUID_QUERY:?}, {} texture candidate(s)", cands.len()));
    let idx = pick_texture(biome, "still, natural water seen from directly above", &cands)?;
    let c = cands.get(idx)?;
    Some(TileRef { root: c.root.clone(), rel_path: c.rel_path.clone() })
}

fn biome_floor_query(biome: &str) -> Option<&'static str> {
    BIOME_FLOORS.iter().find(|(b, _)| b.eq_ignore_ascii_case(biome)).map(|(_, q)| *q)
}

/// Resolve one just-generated map's discrete objects to exact catalog tiles
/// and persist them to `<slug>.tiles.json`. No-op (and no file written) when no
/// tile library is imported or the map has no resolvable placements — the
/// renderer then just uses its built-in sprites, exactly as before this
/// existed. Command-layer helper (needs `AppHandle` for the manifest + the
/// vision call), called right after a spec is written.
fn resolve_map_tiles(app: &AppHandle, root: &Path, id: &str, slug: &str) -> Result<(), String> {
    if !crate::tile_library::tile_library_configured(app) {
        return Ok(());
    }
    // Skip when the sidecar is already at least as new as the spec — so this is
    // safe to call from every path: a fresh/regenerated map (newer .md) gets
    // resolved, a plan cache-hit (unchanged .md, existing .tiles.json) self-
    // skips and spends no vision call.
    let dir = battle_maps_dir(root, id);
    let (spec_path, tiles_path) = (dir.join(format!("{slug}.md")), dir.join(format!("{slug}.tiles.json")));
    if tiles_up_to_date(&tiles_path, &spec_path) {
        return Ok(());
    }
    let spec = read_battle_map_at(root, id, slug)?;
    // Classify the scene ONCE — it drives both the object picks (material fit)
    // and the ground texture.
    let biome = classify_biome(&spec);
    let placements = parse_placements(&spec);
    let t_short = std::time::Instant::now();
    // Search at the library's real size for guide nouns even when the placement
    // is smaller. A `T` cell is 1x1 BY DEFINITION, so no prompt rule can ever
    // make "Pine tree" bigger — and this pack's only 1x1 "tree" is a
    // gingerbread cookie (live, twice). The renderer already scales oversized
    // art down into the footprint (`Math.min(stepX, t.w - dx)`), and a 2x2
    // pine shrunk into one cell is simply a small pine.
    let size_guide = crate::tile_library::structured_footprint_guide_for_app(app);
    let search_size = |label: &str, w: u32, h: u32| -> (u32, u32) {
        // HEAD word only — "bar stool" must not hit the "bar" guide entry and
        // get offered actual bars. The last word is the object's identity,
        // same rule the shortlist itself scores by.
        let lower = label.to_lowercase();
        let Some(head) = lower.split(|ch: char| !ch.is_alphanumeric()).filter(|t| !t.is_empty()).last() else {
            return (w, h);
        };
        let word_hits = |word: &str, noun: &str| word == noun || word.strip_suffix('s') == Some(noun) || noun.strip_suffix('s') == Some(word);
        match size_guide.iter().find(|(noun, _, _)| word_hits(head, noun)) {
            Some((_, gw, gh)) => (w.max(*gw), h.max(*gh)),
            None => (w, h),
        }
    };
    let slots: Vec<(&Placement, Vec<crate::tile_library::TileCandidate>)> = placements
        .iter()
        .map(|p| {
            let (sw, sh) = search_size(&p.label, p.w, p.h);
            (p, crate::tile_library::shortlist(app, &p.label, &biome, sw, sh, VISION_SHORTLIST_K))
        })
        .filter(|(_, cands)| !cands.is_empty())
        .collect();
    eprintln!("[map-timing] shortlist: {:.1}s for {} placement(s)", t_short.elapsed().as_secs_f64(), placements.len());
    let mut objects: Vec<ResolvedTile> = if slots.is_empty() {
        Vec::new()
    } else {
        crate::maplog::log(
            "TILE RESOLUTION START",
            &format!("{slug}: biome={biome}, {} placement(s) with candidates:\n{}", slots.len(),
                slots.iter().enumerate().map(|(i, (p, c))| format!("  [slot {}] \"{}\" {}x{} — {} candidates", i + 1, p.label, p.w, p.h, c.len())).collect::<Vec<_>>().join("\n")),
        );
        let picks = pick_tiles_via_vision(&slots, &biome);
        // Track the ones that come back empty. A placement can drop out here
        // because vision declined every candidate (it answers `choice: 0`) or
        // returned an out-of-range number — both land as `None` and the object
        // silently doesn't render. Counting resolved-vs-placed by hand is how
        // that used to get noticed, so say it outright in the trace.
        let mut dropped: Vec<&str> = Vec::new();
        let resolved: Vec<ResolvedTile> = slots
            .iter()
            .zip(picks)
            .filter_map(|((p, cands), pick)| match pick.and_then(|i| cands.get(i)) {
                Some(c) => Some(ResolvedTile { cells: p.cells.clone(), w: p.w, h: p.h, tw: c.w, th: c.h, root: c.root.clone(), rel_path: c.rel_path.clone(), sub: None }),
                None => {
                    dropped.push(p.label.as_str());
                    None
                }
            })
            .collect();
        if !dropped.is_empty() {
            crate::maplog::log(
                "PLACEMENTS LEFT UNRESOLVED",
                &format!("{} of {} got no tile — vision declined every candidate. They fall back to the built-in glyph:\n  {}", dropped.len(), slots.len(), dropped.join("\n  ")),
            );
        }
        resolved
    };
    // Light every resolved fire vessel that came through unlit. The catalog
    // ships fireplaces (and empty braziers) with no flame — the fire is a
    // separate !Effects/Fire sprite meant to be stacked on top. So a lit hearth
    // = hearth base + a warm flame in its firebox. Appended AFTER the base so
    // it draws on top; the `sub` rect sizes and places it (see `firebox_rect`).
    let flames: Vec<ResolvedTile> = objects
        .iter()
        .filter_map(|o| {
            let name = o.rel_path.rsplit(['/', '\\']).next().unwrap_or("");
            // A toppled vessel stays dark. Every `Fallen` brazier is drawn on
            // its side (bowl and stem laid out across the tile), so a centred
            // flame lands on the stem — and a knocked-over brazier still
            // merrily alight reads as a bug, not as atmosphere.
            if name.contains("Fallen") {
                return None;
            }
            let is_hearth = name.contains("Fireplace") && name.contains("Stone");
            let is_unlit_brazier = name.contains("Brazier") && !name.contains("Lit") && !name.contains("Embers");
            // A `*` cell is BY DEFINITION an open fire that's burning — the
            // legend calls it "open fire — campfire/brazier/fire pit". But the
            // picker is free to choose an Ash, Embers or bare Stone ring, and
            // it did: the cave map's set piece, a campfire the Tactics lean on
            // for a 30-ft light radius, came out as cold `Campfire_Embers_A1`.
            // Light anything that isn't already a `_Lit_` variant (unlike the
            // brazier rule, Embers counts here — glowing coals are the BASE a
            // campfire's flame sits on, not a deliberately dying fire).
            let is_unlit_campfire = name.contains("Campfire") && !name.contains("Lit");
            if !(is_hearth || is_unlit_brazier || is_unlit_campfire) {
                return None;
            }
            let (root, rel_path, tw, th) = crate::tile_library::pick_flame_overlay(app, o.w, o.h)?;
            Some(ResolvedTile { cells: o.cells.clone(), w: o.w, h: o.h, tw, th, root, rel_path, sub: Some(firebox_rect(&o.cells, is_hearth)) })
        })
        .collect();
    objects.extend(flames);
    let floor = resolve_floor(app, &biome);
    let grid_rows = split_spec_grid(&spec).map(|(_, r, _)| r).unwrap_or_default();
    let liquid = resolve_liquid(app, &biome, &grid_rows);
    let resolved = ResolvedMap { objects, floor, liquid, natural_walls: has_natural_walls(&biome) };
    // Always write (even if nothing resolved) so the mtime gate marks this spec
    // done and we don't re-run the vision/classify calls on every dialog open.
    let path = battle_maps_dir(root, id).join(format!("{slug}.tiles.json"));
    write_atomic(&path, &serde_json::to_string_pretty(&resolved).map_err(|e| e.to_string())?)?;
    let basename = |p: &str| p.rsplit('/').next().unwrap_or("").to_string();
    crate::maplog::log(
        "TILE RESOLUTION DONE",
        &format!(
            "{slug}: {} object tile(s) resolved; biome floor = {}\nchosen object tiles:\n{}",
            resolved.objects.len(),
            resolved.floor.as_ref().map(|f| basename(&f.rel_path)).unwrap_or_else(|| "kept built-in".into()),
            resolved.objects.iter().map(|o| format!("  {}", basename(&o.rel_path))).collect::<Vec<_>>().join("\n"),
        ),
    );
    Ok(())
}

/// One resolved tile with fresh art, for the renderer. `cells` are (col,row);
/// `w`/`h` the footprint; `tw`/`th` the tile's native cell size (for tiling).
#[derive(Serialize, Clone, Debug)]
pub struct MapTileArt {
    cells: Vec<(usize, usize)>,
    w: u32,
    h: u32,
    tw: u32,
    th: u32,
    data_url: String,
    /// See `ResolvedTile::sub` — sub-cell placement for a flame overlay.
    sub: Option<[f32; 4]>,
}

/// The resolved art for a map: the picked object tiles plus the biome ground
/// texture (a data URL, or null to keep the built-in floor). Empty/null when
/// nothing resolved or no sidecar exists.
#[derive(Serialize, Clone, Debug)]
pub struct MapTiles {
    tiles: Vec<MapTileArt>,
    floor: Option<String>,
    liquid: Option<String>,
    natural_walls: bool,
}

#[tauri::command]
pub fn get_map_tiles(app: AppHandle, id: String, slug: String) -> Result<MapTiles, String> {
    let root = campaigns_root(&app)?;
    let path = battle_maps_dir(&root, &id).join(format!("{slug}.tiles.json"));
    let Ok(json) = fs::read_to_string(&path) else {
        return Ok(MapTiles { tiles: Vec::new(), floor: None, liquid: None, natural_walls: false });
    };
    let resolved: ResolvedMap = serde_json::from_str(&json).unwrap_or_default();
    let tiles = resolved
        .objects
        .into_iter()
        .filter_map(|t| {
            Some(MapTileArt { cells: t.cells, w: t.w, h: t.h, tw: t.tw, th: t.th, data_url: crate::tile_library::load_tile_data_url(&t.root, &t.rel_path)?, sub: t.sub })
        })
        .collect();
    let load = |r: Option<TileRef>| r.and_then(|t| crate::tile_library::load_tile_data_url(&t.root, &t.rel_path));
    Ok(MapTiles { tiles, floor: load(resolved.floor), liquid: load(resolved.liquid), natural_walls: resolved.natural_walls })
}

/// True when every cell `line` refers to would pass `validate_map_spec`'s
/// Features checks — same three rules (in grid, an object code, and the
/// right KIND of object code if the label names furniture), just as a bool
/// instead of issue strings. Shared by `validate_map_spec` and
/// `prune_invalid_features` so "what makes a Features line valid" can't drift
/// between the two.
fn feature_line_is_valid(rows: &[String], line: &str) -> bool {
    let names_furniture = feature_line_names_furniture(line);
    let refs = cell_refs_in(line);
    !refs.is_empty()
        && refs.iter().all(|(_, c, r)| match cell_at(rows, *c, *r) {
            Some(ch) if MAP_OBJECT_CODES.contains(&ch) => !names_furniture || ch == '=',
            _ => false,
        })
}

/// Drops any `Features:` bullet that fails validation instead of shipping it.
/// `generate_one_map_spec` gets exactly one retry — if the model still hasn't
/// fixed every issue by then, the spec we're about to store may still have a
/// `Features` line pointing at the wrong cell or the wrong kind of object
/// (confirmed live: a "Bar counter" line pointed at a floor row, so the real
/// bar rendered with a generic "table" prompt instead — silently wrong is
/// worse than silently generic). Pruning the bad line doesn't fix the label,
/// but it stops a wrong one from reaching the stylizer; the cell just falls
/// back to its plain per-code prompt. Never touches Tactics text — that's
/// prose, never mechanically checked. Pure.
fn prune_invalid_features(spec: &str) -> String {
    let Some((_, rows, _)) = split_spec_grid(spec) else {
        return spec.to_string();
    };
    let mut in_features = false;
    let mut out: Vec<String> = Vec::new();
    for line in spec.split('\n') {
        let t = line.trim();
        if t.starts_with("Features:") {
            in_features = true;
            out.push(line.to_string());
            continue;
        }
        if is_map_section_header(t) {
            in_features = false;
            out.push(line.to_string());
            continue;
        }
        if in_features {
            if let Some(body) = t.strip_prefix('-') {
                let body = body.trim();
                if !body.is_empty() && !feature_line_is_valid(&rows, body) {
                    continue; // drop this bullet
                }
            }
        }
        out.push(line.to_string());
    }
    out.join("\n")
}

/// Forces a spec to be internally consistent no matter what the model did:
/// snaps ragged rows to the width most of them already agree on, scrubs any
/// character that isn't a legend code, and rewrites the `Grid:` header from the
/// grid that's ACTUALLY there. Last-resort safety net after the retry in
/// `generate_one_map_spec` — the result may still be an ugly map, but the DM's
/// cell coordinates will at least resolve against something real.
///
/// The MODAL width (not the max) is the repair target because a ragged grid is
/// nearly always "the model miscounted a couple of rows": the shipped barroom
/// map had eleven 14-wide rows and two stray 16-wide wall rows, so snapping to
/// 14 restores a clean 14-wide room, where padding out to 16 would instead bake
/// in a 2-cell void stripe down the side of the print. Ties go to the wider
/// width, which truncates less. Pure.
fn normalize_map_spec(spec: &str) -> String {
    let Some((prefix, rows, suffix)) = split_spec_grid(spec) else {
        return spec.to_string();
    };
    let cols = modal_row_width(&rows);
    let mut fixed: Vec<String> = rows
        .iter()
        .map(|r| {
            let mut s: String = r
                .chars()
                .map(|c| if c == ' ' || MAP_CODES.contains(&c) { c } else { '.' })
                .take(cols)
                .collect();
            let len = s.chars().count();
            if len < cols {
                s.push_str(&" ".repeat(cols - len));
            }
            s
        })
        .collect();

    // Demote a door that isn't actually set into a wall back to plain floor.
    // A `+` floating in the open prints wrong AND drives real decisions — the
    // DM reads it as an entrance and places encounters around it. Confirmed
    // live: a door two cells deep in open floor, no `#` adjacent on any side.
    // `validate_map_spec` already flags this and asks for a fix, but one
    // retry doesn't always land it, so this is the same safety net as the
    // width/character scrub above — never ship a structural lie.
    for r in 0..fixed.len() {
        for c in 0..cols {
            if cell_at(&fixed, c, r) == Some('+') && !door_in_wall(&fixed, c, r) {
                let mut chars: Vec<char> = fixed[r].chars().collect();
                chars[c] = '.';
                fixed[r] = chars.into_iter().collect();
            }
        }
    }

    let rows_n = fixed.len();

    let prefix: Vec<String> = prefix
        .iter()
        .map(|l| {
            if l.trim_start().starts_with("Grid:") {
                format!("Grid: {cols}x{rows_n}, 5 ft squares. Columns A onward left-to-right, rows 1 onward top-to-bottom.")
            } else {
                l.clone()
            }
        })
        .collect();

    let mut out: Vec<String> = prefix;
    out.extend(fixed);
    out.extend(suffix);
    out.join("\n")
}

/// Asks for a map spec, and — if the reply is structurally broken — re-asks
/// with the concrete errors fed back, up to `max_retries` times, keeping the
/// best attempt seen (fewest issues; a verbatim copy of the worked example
/// never counts as an improvement no matter how few consistency issues the
/// copy itself has). Whatever we end up with is pruned and normalized before
/// it's returned, so a stored spec is always self-consistent — and if not
/// every issue got fixed within the retry budget, at least nothing wrong
/// reaches the renderer silently.
///
/// `max_retries` is the caller's job to pick — see generate_map_spec, which
/// uses a different budget for local vs Claude because they fail
/// differently.
///
/// Returns the provider's own error verbatim rather than a generic one: when
/// this fails it's almost always the ingestion provider being unreachable or
/// misconfigured, and "the model didn't return a usable map" hides exactly the
/// detail the DM needs to fix it. That only applies to the FIRST call — once
/// we have at least one spec in hand, a retry failing (network error, or a
/// reply with no `Map:` block) just ends the loop early and keeps the best
/// attempt so far, same as running out of retries.
fn generate_one_map_spec(prompt: &str, max_retries: usize, footprint_guide: &[String]) -> Result<String, String> {
    // "tree 2x2" -> ("tree", 2, 2); the prompt-formatted strings are the one
    // form threaded everywhere, so parse here rather than thread a second type.
    let size_guide: Vec<(String, u32, u32)> = footprint_guide
        .iter()
        .filter_map(|s| {
            let (noun, wh) = s.rsplit_once(' ')?;
            let (w, h) = wh.split_once('x')?;
            Some((noun.to_string(), w.parse().ok()?, h.parse().ok()?))
        })
        .collect();
    // Tried Opus + high effort here (2026-07-17): ~10 minutes and a real
    // usage-budget hit per map, for output that wasn't measurably better —
    // reverted to Sonnet. That comparison never actually tried LOW effort
    // though — "reverted" left it on the CLI's default, same as every other
    // ask_ingest_once caller, which is NOT low (see build_claude_args's doc
    // comment: the DM turn loop forces low specifically because default
    // effort burns real wall-clock time thinking before replying). Live-
    // measured here (2026-07-19): 362s for one call, 11552 chars in / 2161
    // chars out — a ratio default effort's raw generation speed doesn't
    // explain; almost certainly mostly thinking time, same shape as the
    // turn-loop finding. This is a structural/spatial layout task, not a
    // nuanced narrative judgment call, so it's at least as good a fit for
    // low effort as an ordinary DM turn was — see ask_ingest_once_low_effort.
    let ask = |p: String| -> Result<Option<String>, String> {
        let t = std::time::Instant::now();
        let prompt_len = p.len();
        let reply = crate::local_llm::ask_ingest_once_low_effort(p, Some("sonnet"))?;
        eprintln!("[plan-timing] one claude call (low effort): {:.1}s, {prompt_len} chars in / {} chars out", t.elapsed().as_secs_f64(), reply.len());
        // Normalize BEFORE validating. `normalize_map_spec` already ran
        // unconditionally on the way out (see the end of this fn), so
        // validating the raw reply meant judging a spec that is not the one
        // that ships — and paying a full retry call to fix ragged rows and a
        // wrong `Grid:` header that the repair fixes deterministically for
        // free. Measured live (2026-07-19): ragged rows showed up in 3 of 8
        // first attempts, and because a width issue is not "features-only" it
        // forced every one of those retries down the EXPENSIVE full-redraw
        // branch (~27k chars) instead of the cheap caption branch (~3k).
        Ok(split_map_specs(&reply).into_iter().next().map(|raw| {
            let fixed = normalize_map_spec(&raw);
            // Say so when the repair actually did something. Without this the
            // trace can't distinguish "the model drew a clean grid" from "the
            // model drew a ragged one and this silently saved a retry" — they
            // both log zero issues, which makes the fix unfalsifiable.
            if fixed != raw {
                let widths = |s: &str| {
                    let mut w: Vec<usize> = split_spec_grid(s).map(|(_, r, _)| r.iter().map(|l| l.chars().count()).collect()).unwrap_or_default();
                    w.sort_unstable();
                    w.dedup();
                    w
                };
                crate::maplog::log(
                    "NORMALIZE REPAIRED THE GRID (saved a retry)",
                    &format!("row widths {:?} -> {:?}", widths(&raw), widths(&fixed)),
                );
            }
            // Deterministic size repair: grow under-sized guide objects in
            // place when the floor allows it. Free, and unlike the prompt's
            // SIZE GUIDE it can't be ignored (live: eleven 1x1 pine trees
            // written straight past the guide line).
            let (resized, _) = enforce_object_sizes(&fixed, &size_guide);
            if resized != fixed {
                crate::maplog::log("OBJECT SIZES REPAIRED (saved a retry)", "under-sized guide objects grown in place on open floor");
            }
            resized
        }))
    };
    let issues_for = |spec: &str| -> Vec<String> {
        let mut issues = validate_map_spec(spec);
        issues.extend(enforce_object_sizes(spec, &size_guide).1);
        if copies_the_example(spec) {
            issues.push(
                "You returned the example map (The Bent Nail) verbatim instead of drawing the encounter you were asked for. The example only demonstrates habits — irregular spacing, mixed object sizes, an occupied centre, a bar with floor behind it. Draw a DIFFERENT room that has those habits."
                    .to_string(),
            );
        }
        issues
    };

    let first = ask(prompt.to_string())?
        .ok_or_else(|| "The model's reply didn't contain a `Map:` block.".to_string())?;
    let first_fallback = first.clone(); // last resort if every attempt below copies
    let mut issues = issues_for(&first);
    let first_is_copy = copies_the_example(&first);
    eprintln!(
        "[battle-map] attempt 1: {} issue(s), copied_example={first_is_copy}: {:?}\n--- raw ---\n{first}\n--- end ---",
        issues.len(), issues
    );
    crate::maplog::log(
        "MODEL ATTEMPT 1 (raw reply)",
        &format!("{} validation issue(s), copied_example={first_is_copy}\nissues: {issues:?}\n--- reply ---\n{first}", issues.len()),
    );
    // What the retry prompt shows back as "here's what you drew" — every
    // ask_ingest_once call is a stateless one-shot completion (no
    // conversation history), so without this the model has NO visibility
    // into its own previous attempt when asked to "fix cell F8": it can only
    // blind-guess a whole new room from the original brief plus an abstract
    // list of error strings. Confirmed live: attempts varied wildly instead
    // of converging (issue counts went UP between retries as often as down),
    // which is exactly what "fix something you can't see" produces.
    let mut previous_spec = first.clone();
    let mut best_real = fold_best_real_map_attempt(None, first, issues.len(), first_is_copy);

    for attempt in 0..max_retries {
        // `issues_for` always adds the copy message when it applies, so an
        // empty `issues` here already implies the attempt that produced it
        // wasn't a copy.
        if issues.is_empty() {
            break;
        }
        // When the grid itself is already sound and the ONLY remaining
        // problems are Features mismatches, ask for the much narrower task
        // of describing the already-good grid, instead of redrawing the
        // whole room again — a captioning task, not a design task. Confirmed
        // live: the grid converges faster than Features does (a room with
        // real furniture but only one surviving Features line after
        // pruning), so once the grid stops being the bottleneck, keep it out
        // of what's being asked to change.
        let issues_before_retry = issues.len();
        let all_features_only = all_features_only_issues(&issues);
        let retry_prompt = if all_features_only {
            // Deliberately does NOT re-send `prompt`. This branch is pure
            // captioning — the grid is already correct and must be copied
            // verbatim — so the design brief it would re-send (layout rules,
            // worked examples, the ~900-word object vocabulary, campaign
            // context: ~30k chars) is entirely dead weight for the task. All
            // this needs is the legend, the map, and the mismatches. The
            // full-redraw branch below still gets the whole brief, because
            // that one really is being asked to design a room again.
            format!(
                "You are fixing the text of a battle map that has ALREADY been drawn correctly.\n\n\
                 Legend: {MAP_LEGEND}\n\n\
                 Here is EXACTLY what you drew last time — its Map: grid is fine, keep every \
                 character of it EXACTLY unchanged:\n\n{MAP_SPEC_DELIMITER}\n{previous_spec}\n{MAP_SPEC_DELIMITER}\n\n\
                 Only your Features: text is wrong — it names cells that don't actually hold what it claims. Fix \
                 EXACTLY these mismatches by rewriting Features (and Tactics, if it needs updating too) to \
                 describe what's ACTUALLY in the grid above; do NOT touch the Map: block at all:\n{}\n\n\
                 Rules that still apply: a Features line must point at a cell that really holds the matching code; \
                 a range like \"Bar counter at B2-K2\" means EVERY cell in that rectangle holds it; name each \
                 feature by what it IS (\"Bar counter\", \"Hearth\"), never by its legend code.\n\n\
                 Output the WHOLE map in exactly the same format, between {MAP_SPEC_DELIMITER} lines, with the \
                 Map: block and every other section copied over character-for-character.",
                issues.iter().map(|i| format!("- {i}")).collect::<Vec<_>>().join("\n")
            )
        } else {
            format!(
                "{prompt}\n\nHere is EXACTLY what you drew last time:\n\n{MAP_SPEC_DELIMITER}\n{previous_spec}\n{MAP_SPEC_DELIMITER}\n\n\
                 It was REJECTED for these concrete problems. Fix EXACTLY these, cell by cell, in the map above — do \
                 NOT start over with a different room — and output the corrected map in exactly the same format:\n{}",
                issues.iter().map(|i| format!("- {i}")).collect::<Vec<_>>().join("\n")
            )
        };
        let Ok(Some(retry_spec)) = ask(retry_prompt) else {
            eprintln!("[battle-map] retry {} failed outright (provider error or no Map: block); stopping with best so far", attempt + 2);
            break;
        };
        issues = issues_for(&retry_spec);
        let is_copy = copies_the_example(&retry_spec);
        eprintln!(
            "[battle-map] retry {}: {} issue(s), copied_example={is_copy}: {:?}\n--- raw ---\n{retry_spec}\n--- end ---",
            attempt + 2, issues.len(), issues
        );
        crate::maplog::log(
            &format!("MODEL RETRY {} (raw reply)", attempt + 2),
            &format!(
                "asked to fix {} issue(s) from prior attempt (features-only retry={})\nremaining issues now: {issues:?}\n--- reply ---\n{retry_spec}",
                issues_before_retry, all_features_only,
            ),
        );
        previous_spec = retry_spec.clone();
        best_real = fold_best_real_map_attempt(best_real, retry_spec, issues.len(), is_copy);
    }

    let (best, best_issue_count, is_fallback_copy) = match best_real {
        Some((spec, count)) => (spec, count, false),
        None => {
            let count = issues_for(&first_fallback).len();
            (first_fallback, count, true)
        }
    };
    eprintln!(
        "[battle-map] kept the attempt with {best_issue_count} issue(s) as the candidate{}",
        if is_fallback_copy { " (WARNING: every attempt copied the example; shipping the copy as a last resort)" } else { "" }
    );
    crate::maplog::log(
        "CANDIDATE CHOSEN (best of this candidate's attempts)",
        &format!(
            "kept the attempt with {best_issue_count} unresolved issue(s){}\n--- spec ---\n{best}",
            if is_fallback_copy { " (WARNING: every attempt copied the example; shipping the copy)" } else { "" },
        ),
    );
    let pruned = prune_invalid_features(&best);
    if pruned != best {
        eprintln!("[battle-map] prune_invalid_features dropped one or more Features lines\n--- before ---\n{best}\n--- after ---\n{pruned}\n--- end ---");
        crate::maplog::log(
            "PRUNED UNMATCHED FEATURES LINES",
            &format!("--- before ---\n{best}\n--- after ---\n{pruned}"),
        );
    }
    Ok(normalize_map_spec(&pruned))
}

/// Folds one attempt into the best REAL (non-copy) candidate seen so far. A
/// copy is never eligible to become `best`, however cleanly it validates —
/// it usually validates almost perfectly, since it IS the reference spec,
/// which is exactly what let one slip through live: the very first attempt
/// copied the worked example verbatim, scored just the one "you copied"
/// issue, and no genuine retry — which necessarily starts from a blank room
/// and racks up real issues along the way — could ever beat that on issue
/// count alone. The fix is that a copy simply isn't a candidate: `None` means
/// "no real attempt yet", so ANY non-copy beats it regardless of its own
/// issue count, and only two non-copies are ever compared by issue count
/// against each other. Pure.
fn fold_best_real_map_attempt(
    best: Option<(String, usize)>, candidate: String, issue_count: usize, is_copy: bool,
) -> Option<(String, usize)> {
    if is_copy {
        return best;
    }
    match &best {
        Some((_, best_count)) if issue_count >= *best_count => best,
        _ => Some((candidate, issue_count)),
    }
}

/// True for a `validate_map_spec` issue about a `Features:` line pointing at
/// the wrong cell or wrong kind of object — as opposed to a structural
/// problem with the Map: grid itself (ragged rows, an unenclosed room, a
/// floating door). Every Features-related message `validate_map_spec` emits
/// starts with this exact literal prefix; kept in sync with that function by
/// the shipped-spec regression tests below. Pure.
fn issue_is_features_only(issue: &str) -> bool {
    // `Objects says` issues are the same shape — one caption line to rewrite,
    // no redraw — so they ride the same cheap retry.
    issue.starts_with("Features says \"") || issue.starts_with("Objects says \"")
}

/// True when EVERY remaining issue is a Features mismatch and the grid
/// itself is already sound — the signal `generate_one_map_spec`'s retry loop
/// uses to switch from "redraw the room" to the much narrower "describe the
/// room you already drew correctly", once the grid has stopped being the
/// bottleneck. Empty issues are never "features-only" — that means nothing
/// is wrong at all, which is generate_one_map_spec's separate stopping
/// condition, not this one. Pure.
fn all_features_only_issues(issues: &[String]) -> bool {
    !issues.is_empty() && issues.iter().all(|i| issue_is_features_only(i))
}

/// How many independent candidates `generate_map_spec` produces before asking
/// the model to judge between them. Local keeps the full 3 since any single
/// attempt might still be too mechanically broken to be worth judging at all.
///
/// Claude is 1, not 2 — measured live (2026-07-18) at 200-420 SECONDS for a
/// single candidate call on the real map prompt (~11.5K chars in), even
/// though a trivial one-word `claude -p` call on the same machine came back
/// in 1.6s of actual API time. That rules out CLI/account throttling — the
/// cost is Sonnet genuinely burning heavy internal reasoning on this
/// specific many-constraint grid task. "2 candidates at a fraction of the
/// cost" (the previous reasoning here) was true for wall time under the
/// since-added parallelization, but false for USAGE: 2 candidates + a judge
/// call is 2-3x the actual Claude-quota cost of 1, for a quality gain the
/// DM reported wasn't worth it ("uses up 50% of my usage... unacceptable").
/// A single candidate that's already mechanically validated (see
/// generate_one_map_spec's retry loop) ships directly with candidates.len()
/// == 1 skipping judging entirely — see MAP_SPEC_MAX_RETRIES_CLAUDE's
/// comment for the matching retry-budget reasoning.
const MAP_SPEC_CANDIDATE_COUNT_LOCAL: usize = 3;
const MAP_SPEC_CANDIDATE_COUNT_CLAUDE: usize = 1;

/// How many spec calls to race against each other on the Claude path, taking
/// whichever lands FIRST (a "hedged request"). Not about quality — the Claude
/// path never judged anyway, it ships its single candidate directly — this is
/// purely to escape tail latency. Measured across one session, the SAME prompt
/// (23,447 chars in, ~2,700 out) took 87s, 203s and 484s: a 5.5x spread with
/// no input-size explanation, so a single call leaves you hostage to the worst
/// draw. Racing two turns a p95 wait back into roughly a p50 one.
///
/// The cost is real and deliberate: up to 2x the spec tokens per map. The
/// loser keeps generating in the background until its own subprocess exits —
/// its result is simply dropped — so this trades quota for wall-clock, which
/// is the trade worth making for an interactive "regenerate" button.
const MAP_SPEC_HEDGE_CLAUDE: usize = 2;

/// Fires `n` independent spec calls and returns the FIRST usable one, without
/// waiting for the rest. Deliberately uses detached threads and a channel
/// rather than `thread::scope`: a scope joins every thread before it returns,
/// which would put the slowest call right back on the critical path and defeat
/// the entire point. The losers finish into a dropped receiver — their `send`
/// fails and is ignored.
///
/// An error only surfaces if EVERY call failed; one provider hiccup shouldn't
/// sink a map when its twin succeeded.
fn race_map_spec(prompt: &str, n: usize, max_retries: usize, footprint_guide: &[String]) -> Result<String, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    for _ in 0..n {
        let (tx, prompt, guide) = (tx.clone(), prompt.to_string(), footprint_guide.to_vec());
        std::thread::spawn(move || {
            let _ = tx.send(generate_one_map_spec(&prompt, max_retries, &guide));
        });
    }
    drop(tx); // so the loop below ends once every racer has reported
    let started = std::time::Instant::now();
    let mut first_err = None;
    for result in rx {
        match result {
            Ok(spec) => {
                eprintln!("[battle-map] hedge of {n}: first usable spec in {:.1}s, abandoning the rest", started.elapsed().as_secs_f64());
                return Ok(spec);
            }
            Err(e) => {
                eprintln!("[battle-map] hedge of {n}: one racer failed: {e}");
                first_err.get_or_insert(e);
            }
        }
    }
    Err(first_err.unwrap_or_else(|| "No map-spec attempt returned a usable map.".to_string()))
}

/// Generates several independent map specs for the SAME prompt and asks the
/// model to pick the best one, instead of shipping whichever the first
/// attempt happened to be. Each candidate is a full, independently generated
/// `generate_one_map_spec` run — not a retry sharing context with the others
/// — so they genuinely differ in layout, not just wording, and each already
/// went through its own validate/retry/prune pipeline before judging ever
/// sees it. That means judging is purely about layout QUALITY (is the room
/// interesting, does it use its own fiction, is the encounter's defining
/// feature actually drawn) — mechanical soundness is already guaranteed
/// going in, on every candidate.
///
/// The first candidate's failure propagates outward, same contract as
/// `generate_one_map_spec` itself (a provider outage should be reported, not
/// hidden). A later candidate failing just means judging runs on however many
/// did succeed; with only one candidate there's nothing to judge, so it ships
/// directly and costs nothing extra.
fn generate_map_spec(prompt: &str, footprint_guide: &[String]) -> Result<String, String> {
    let use_local = crate::local_llm::is_local_ingestion();
    let candidate_count = if use_local { MAP_SPEC_CANDIDATE_COUNT_LOCAL } else { MAP_SPEC_CANDIDATE_COUNT_CLAUDE };
    let max_retries = if use_local { MAP_SPEC_MAX_RETRIES_LOCAL } else { MAP_SPEC_MAX_RETRIES_CLAUDE };
    // Claude path: race N and take the first that lands (see
    // MAP_SPEC_HEDGE_CLAUDE). Kept off the local path, which runs its
    // candidates to completion ON PURPOSE so it can judge between them —
    // there, more candidates is a quality mechanism, not a latency one.
    if !use_local && MAP_SPEC_HEDGE_CLAUDE > 1 {
        return race_map_spec(prompt, MAP_SPEC_HEDGE_CLAUDE, max_retries, footprint_guide);
    }

    // Each candidate is an independent LLM call (no shared state) — running
    // them on their own threads instead of one after another is what cut
    // "Plan Next Session" from minutes to seconds per encounter.
    let results: Vec<Result<String, String>> = std::thread::scope(|s| {
        (0..candidate_count)
            .map(|_| s.spawn(move || generate_one_map_spec(prompt, max_retries, footprint_guide)))
            .collect::<Vec<_>>()
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect()
    });

    let mut results = results.into_iter();
    let mut candidates = vec![results.next().unwrap()?];
    for (n, r) in results.enumerate() {
        match r {
            Ok(spec) => candidates.push(spec),
            Err(e) => eprintln!("[battle-map] candidate {} failed to generate at all: {e}", n + 2),
        }
    }
    eprintln!("[battle-map] {} of {candidate_count} candidate(s) generated", candidates.len());
    Ok(match candidates.len() {
        1 => {
            eprintln!("[battle-map] only one candidate — shipping it directly, no judging");
            candidates.pop().unwrap()
        }
        _ => judge_best_map_spec(&candidates),
    })
}

/// The prompt asking the model to compare several already-valid candidates
/// for the same encounter and pick one. Restates the same layout-quality
/// rubric `battle_map_format_instructions` already asks for at generation
/// time — judging and generating should agree on what "good" means — rather
/// than introducing a second, different standard. Pure.
fn build_map_judge_prompt(candidates: &[String]) -> String {
    let mut out = String::from(
        "You drew the same battle-map encounter several different ways below. Pick the ONE that is the best fit to \
         actually run at the table. Judge by: does it lay out like a real place rather than a spreadsheet (varied \
         object sizes, no mirrored halves, something in the middle, not everything hugging the walls); does its own \
         defining feature (the bar, the altar, the forge — whatever this encounter is actually about) genuinely \
         stand out; and is it tactically interesting (real cover, choke points, a reason to move rather than just \
         stand and trade blows). Every candidate below is already mechanically sound — judge on layout quality \
         alone, not on which one has fewer mistakes.\n\n",
    );
    for (i, c) in candidates.iter().enumerate() {
        out.push_str(&format!("=== Candidate {} ===\n{}\n\n", i + 1, c.trim()));
    }
    out.push_str(&format!(
        "Write one short paragraph comparing them, then on its own final line write EXACTLY one of: {}.\n",
        (1..=candidates.len()).map(|n| format!("\"Best: {n}\"")).collect::<Vec<_>>().join(", ")
    ));
    out
}

/// The candidate number the model's judging reply picked, zero-indexed — or
/// `None` if no `Best: N` line is found or `N` is out of range. Looks for the
/// LAST "best:" occurrence (case-insensitive) so restating the rubric earlier
/// in the reply can't be mistaken for the actual verdict. Pure.
fn parse_judge_choice(reply: &str, candidate_count: usize) -> Option<usize> {
    let lower = reply.to_lowercase();
    let idx = lower.rfind("best:")?;
    let digit = lower[idx + "best:".len()..].trim_start().chars().next()?;
    let choice = digit.to_digit(10)? as usize;
    (1..=candidate_count).contains(&choice).then_some(choice - 1)
}

/// Asks the model to pick the best of several candidate map specs for the
/// same encounter. Never fails outward — a provider error, an empty reply, or
/// an answer that doesn't parse all fall back to the first candidate, so a
/// judging hiccup never loses an otherwise perfectly good map.
fn judge_best_map_spec(candidates: &[String]) -> String {
    let Ok(reply) = crate::local_llm::ask_ingest_once(build_map_judge_prompt(candidates), Some("sonnet"), false)
    else {
        eprintln!("[battle-map] judge call failed outright; falling back to candidate 1");
        return candidates[0].clone();
    };
    eprintln!("[battle-map] judge reply:\n--- raw ---\n{reply}\n--- end ---");
    let picked = parse_judge_choice(&reply, candidates.len());
    crate::maplog::log(
        "JUDGE DECISION (comparing candidates)",
        &format!(
            "{} candidate(s) judged; picked {}\n--- judge reply ---\n{reply}",
            candidates.len(),
            match picked { Some(i) => format!("candidate {}", i + 1), None => "nothing parseable → falling back to candidate 1".to_string() },
        ),
    );
    match picked {
        Some(i) => {
            eprintln!("[battle-map] judge picked candidate {}", i + 1);
            candidates[i].clone()
        }
        None => {
            eprintln!("[battle-map] judge reply had no parseable \"Best: N\" line; falling back to candidate 1");
            candidates[0].clone()
        }
    }
}

/// Rewrites a spec's `# ` title line to exactly `name` (or prepends one if
/// missing) — used to force the batch path's stored title/slug to the
/// encounter's own stable name regardless of exactly how the model phrased
/// its title line, which is what keeps a regenerate overwriting the SAME
/// file instead of drifting to a new slug. Pure.
fn force_map_title(spec: &str, name: &str) -> String {
    let mut found = false;
    let mut out: Vec<String> = spec
        .lines()
        .map(|l| {
            if !found && l.starts_with("# ") {
                found = true;
                format!("# {name}")
            } else {
                l.to_string()
            }
        })
        .collect();
    if !found {
        out.insert(0, format!("# {name}"));
    }
    out.join("\n")
}

/// Splits a generation reply into individual raw specs on MAP_SPEC_DELIMITER
/// lines, keeping only chunks that actually contain a `Map:` block. Pure.
fn split_map_specs(reply: &str) -> Vec<String> {
    reply
        .split(MAP_SPEC_DELIMITER)
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && s.contains("Map:"))
        .map(|s| s.to_string())
        .collect()
}

/// The `# Title` line, or a stable fallback so a title-less spec still slugs.
fn map_title(spec: &str) -> String {
    spec.lines()
        .find_map(|l| l.strip_prefix("# "))
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "Battle Map".to_string())
}

/// The `Grid:` line's dimensions, for the one-line index/picker summary.
fn map_summary(spec: &str) -> String {
    spec.lines()
        .find_map(|l| l.trim().strip_prefix("Grid:"))
        .map(|g| g.trim().trim_end_matches('.').to_string())
        .unwrap_or_default()
}

/// Rebuilds index.md fresh from whatever `<slug>.md` files exist (sorted by
/// name), so regenerating or deleting a map never leaves a stale index line —
/// the reason this doesn't append-in-place like the session index does.
fn rebuild_battle_maps_index_at(root: &Path, id: &str) -> Result<Vec<BattleMapMeta>, String> {
    let dir = battle_maps_dir(root, id);
    let mut metas: Vec<BattleMapMeta> = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") { continue; }
            let slug = match path.file_stem().and_then(|s| s.to_str()) {
                Some(s) if s != "index" && is_valid_map_slug(s) => s.to_string(),
                _ => continue,
            };
            let spec = read_optional(&path);
            metas.push(BattleMapMeta { slug, name: map_title(&spec), summary: map_summary(&spec) });
        }
    }
    metas.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    let mut index = DEFAULT_BATTLE_MAPS_INDEX_MD.to_string();
    for m in &metas {
        let summary = if m.summary.is_empty() { String::new() } else { format!(" — {}", m.summary) };
        index.push_str(&format!("- **{}**: {}{}\n", m.slug, m.name, summary));
    }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_atomic(&dir.join("index.md"), &index)?;
    Ok(metas)
}

fn write_map_spec_at(root: &Path, id: &str, spec: &str) -> Result<(), String> {
    let slug = slugify(&map_title(spec));
    let dir = battle_maps_dir(root, id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(format!("{slug}.md")), &format!("{}\n", spec.trim()))
}

/// Same as write_map_spec_at but with a CALLER-PROVIDED slug rather than one
/// derived from the spec's own title — the batch/session-prep path uses this
/// so storage is keyed to the plan's stable encounter name, never to
/// whatever title text the model happened to write this time around.
fn write_map_spec_with_slug_at(root: &Path, id: &str, slug: &str, spec: &str) -> Result<(), String> {
    let dir = battle_maps_dir(root, id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(format!("{slug}.md")), &format!("{}\n", spec.trim()))
}

/// On-demand single-map generation ("describe one encounter" in the merged
/// dialog) — reads live plan/chapter/memory context itself since it's a
/// standalone ad-hoc request, not tied to the cached session plan.
/// The campaign-arc/chapter/memory context every battle-map generation call
/// needs: the campaign lore + active module's arc plan, the current
/// chapter's text, and recent memory + flagged facts, combined the same way
/// every caller wants them. Was duplicated across the on-demand path and the
/// plan-driven batch path before this; a third near-identical copy for a
/// single map's scoped regenerate was the last straw. Returns (combined_plan,
/// current_chapter, combined_memory).
fn battle_map_context_at(root: &Path, id: &str) -> (String, String, String) {
    let dir = root.join(id);
    let module_plan = read_optional(&dir.join("active_module").join("plan.md"));
    let current_chapter = read_optional(&dir.join("active_module").join("current.md"));
    let campaign_lore = read_optional(&dir.join("memory").join("campaign_lore.md"));
    let combined_plan = [campaign_lore.trim(), module_plan.trim()].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n\n");
    let memory = read_optional(&dir.join("memory").join("MEMORY.md"));
    let flagged_facts = read_optional(&dir.join("memory").join("flagged_facts.md"));
    let combined_memory = [memory.trim(), flagged_facts.trim()].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n\n");
    (combined_plan, current_chapter, combined_memory)
}

fn generate_battle_maps_at(root: &Path, id: &str, hint: &str, objects_enabled: bool, vocabulary: &[String], footprint_guide: &[String]) -> Result<(Vec<BattleMapMeta>, String), String> {
    let (combined_plan, current_chapter, combined_memory) = battle_map_context_at(root, id);
    let prompt = build_battle_maps_prompt(&combined_plan, &current_chapter, &combined_memory, hint, objects_enabled, vocabulary, footprint_guide);
    crate::maplog::banner(&format!(
        "on-demand map, hint={hint:?}, objects_enabled={objects_enabled}, vocabulary={} words",
        vocabulary.len()
    ));
    crate::maplog::log(
        "VOCABULARY OFFERED TO MODEL",
        &if vocabulary.is_empty() { "(none — tile library not imported or objects disabled)".to_string() } else { vocabulary.join(", ") },
    );
    crate::maplog::log("FULL PROMPT SENT TO MODEL", &prompt);
    // The prompt asks for exactly ONE map. generate_map_spec generates 3
    // independent, individually-validated candidates and has the model judge
    // between them rather than trusting whichever the first attempt was.
    let spec = generate_map_spec(&prompt, footprint_guide)?;
    crate::maplog::log("FINAL SPEC WRITTEN TO DISK", &spec);
    let slug = slugify(&map_title(&spec));
    write_map_spec_at(root, id, &spec)?;
    // Rebuild over ALL maps (new + pre-existing) so the UI reflects the whole
    // current set, not just this batch. Return the new map's slug so the
    // command layer can resolve its catalog tiles (vision pick).
    Ok((rebuild_battle_maps_index_at(root, id)?, slug))
}

fn plan_manifest_path(root: &Path, id: &str) -> PathBuf {
    battle_maps_dir(root, id).join("plan_manifest.json")
}

/// One map the CURRENT session plan owns, plus the encounter that produced
/// it — kept alongside the slug specifically so a single map can be
/// regenerated later using the SAME encounter context the plan originally
/// gave it, rather than either re-guessing from the map's own title or
/// (the bug this was added to fix) having no scoped regenerate at all and
/// silently regenerating the whole plan instead.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct PlanMapEntry {
    slug: String,
    name: String,
    description: String,
}

/// The maps the CURRENT session plan owns, written by
/// generate_battle_maps_for_plan_at, consulted so a regenerate replaces
/// exactly this set (never touching hand-crafted or on-demand/hint maps,
/// which are never listed here) and so a cache hit can list "the plan's
/// maps" without re-deriving anything.
fn read_plan_manifest_at(root: &Path, id: &str) -> Vec<PlanMapEntry> {
    let content = read_optional(&plan_manifest_path(root, id));
    if content.trim().is_empty() {
        return Vec::new();
    }
    serde_json::from_str(&content).unwrap_or_default()
}

fn write_plan_manifest_at(root: &Path, id: &str, entries: &[PlanMapEntry]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    write_atomic(&plan_manifest_path(root, id), &json)
}

/// The maps the current plan owns, read straight off disk via the manifest —
/// used on a cache hit (plan_next_session_at) so re-opening the dialog costs
/// zero LLM calls. Silently skips a manifest entry whose file is gone (e.g.
/// hand-deleted) rather than erroring.
fn current_plan_owned_maps_at(root: &Path, id: &str) -> Vec<BattleMapMeta> {
    let dir = battle_maps_dir(root, id);
    read_plan_manifest_at(root, id)
        .into_iter()
        .filter_map(|entry| {
            let spec = fs::read_to_string(dir.join(format!("{}.md", entry.slug))).ok()?;
            Some(BattleMapMeta { name: map_title(&spec), summary: map_summary(&spec), slug: entry.slug })
        })
        .collect()
}

/// Reports one step of a long-running, multi-call operation — `phase` names
/// which stage (e.g. "maps", "extracting"), `done`/`total` count within it.
/// A closure rather than an `AppHandle` threaded into these `_at` functions:
/// every `_at` function in this file is deliberately Tauri-free (the command
/// layer resolves anything AppHandle-derived and passes plain data down),
/// which is exactly why they're all directly unit-testable with a `Scratch`
/// tempdir and no Tauri runtime. Passing `&no_progress` preserves that in
/// tests; the real command layer passes a closure that calls `app.emit`
/// (mirrors tts.rs's install_f5_runtime, which does the same with its own
/// "f5-install-progress" event). Must be `Sync` — generate_battle_maps_for_plan_at
/// calls it from multiple `std::thread::scope` threads at once.
type ProgressFn<'a> = &'a (dyn Fn(&str, usize, usize) + Sync);

/// The default "nobody's listening" progress callback — every direct unit
/// test of an `_at` function that takes a `ProgressFn` passes `&no_progress`.
/// Test-only: the real command layer always builds a real emit closure.
#[cfg(test)]
fn no_progress(_phase: &str, _done: usize, _total: usize) {}

/// The deterministic batch path: exactly one map per combat encounter,
/// stably keyed to that encounter's name (see force_map_title), replacing
/// whatever the PREVIOUS plan owned. This is what removes the randomness
/// reported in the bug this shipped to fix — the same (cached) encounter
/// list in, the same slugs out, every time, so a regenerate overwrites
/// instead of accumulating or drifting.
///
/// A handful of Claude/local-LLM calls PER encounter — reusing
/// build_battle_maps_prompt, the same single-map prompt the on-demand
/// "describe one encounter" path already uses reliably, fed through
/// generate_map_spec's generate-3-and-judge — NOT one combined call asking
/// for every map at once. An early version asked for all of them in a single reply and
/// silently truncated to however many the model actually completed (long
/// multi-map ASCII-grid replies reliably drop or malform later maps, or
/// forget the delimiter between them), which is exactly what made "only 1
/// map shows, regenerate to see a different one" happen — the DM had no way
/// to know the batch was partial. Per-encounter calls make each individual
/// generation as reliable as the on-demand path, and a genuine per-encounter
/// failure is now reported back (`failed`) instead of silently vanishing.
fn generate_battle_maps_for_plan_at(
    root: &Path,
    id: &str,
    module_plan: &str,
    current_chapter: &str,
    memory: &str,
    encounters: &[PlanEncounter],
    objects_enabled: bool,
    vocabulary: &[String],
    footprint_guide: &[String],
    on_progress: ProgressFn,
) -> Result<(Vec<BattleMapMeta>, Vec<String>), String> {
    let dir = battle_maps_dir(root, id);
    for old_entry in read_plan_manifest_at(root, id) {
        let _ = fs::remove_file(dir.join(format!("{}.md", old_entry.slug)));
    }

    if encounters.is_empty() {
        write_plan_manifest_at(root, id, &[])?;
        rebuild_battle_maps_index_at(root, id)?;
        return Ok((Vec::new(), Vec::new()));
    }

    // Every encounter's map is an independent LLM job — generate them all at
    // once instead of one after another (this, plus the same fix inside
    // generate_map_spec's own candidates, is what took "Plan Next Session"
    // from ~N minutes to ~1 candidate-round's worth of wall time). The actual
    // file writes below stay sequential since they're cheap and touch shared
    // manifest state.
    //
    // `done_count` is shared across the spawned threads so on_progress fires
    // in REAL completion order — whichever encounter's map actually finishes
    // first reports first — not the order the handles are collected in below
    // (`.map(|h| h.join().unwrap())` blocks on handle 0 before handle 1 even
    // if handle 1 finished first, so that order alone would misreport pacing).
    let total = encounters.len();
    crate::maplog::banner(&format!(
        "Plan Next Session — {total} encounter map(s) generated concurrently (logs below will interleave; each entry names its encounter). objects_enabled={objects_enabled}, vocabulary={} words",
        vocabulary.len()
    ));
    crate::maplog::log(
        "VOCABULARY OFFERED TO MODEL",
        &if vocabulary.is_empty() { "(none — tile library not imported or objects disabled)".to_string() } else { vocabulary.join(", ") },
    );
    let done_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let specs: Vec<Result<String, String>> = std::thread::scope(|s| {
        encounters
            .iter()
            .map(|encounter| {
                let hint = format!("{} — {}", encounter.name, encounter.description);
                let prompt = build_battle_maps_prompt(module_plan, current_chapter, memory, &hint, objects_enabled, vocabulary, footprint_guide);
                crate::maplog::log(&format!("FULL PROMPT — encounter {:?}", encounter.name), &prompt);
                let done_count = done_count.clone();
                s.spawn(move || {
                    let result = generate_map_spec(&prompt, footprint_guide);
                    let done = done_count.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                    on_progress("maps", done, total);
                    result
                })
            })
            .collect::<Vec<_>>()
            .into_iter()
            .map(|h| h.join().unwrap())
            .collect()
    });

    let mut new_entries = Vec::new();
    let mut metas = Vec::new();
    let mut failed = Vec::new();
    for (encounter, spec_result) in encounters.iter().zip(specs.into_iter()) {
        let Ok(spec) = spec_result else {
            failed.push(encounter.name.clone());
            continue;
        };
        let slug = slugify(&encounter.name);
        let titled = force_map_title(&spec, &encounter.name);
        write_map_spec_with_slug_at(root, id, &slug, &titled)?;
        metas.push(BattleMapMeta { slug: slug.clone(), name: encounter.name.clone(), summary: map_summary(&titled) });
        new_entries.push(PlanMapEntry { slug, name: encounter.name.clone(), description: encounter.description.clone() });
    }
    write_plan_manifest_at(root, id, &new_entries)?;
    rebuild_battle_maps_index_at(root, id)?;
    Ok((metas, failed))
}

#[derive(Serialize, Clone, Debug)]
pub struct SessionPlanResult {
    pub plan_text: String,
    pub maps: Vec<BattleMapMeta>,
    /// Names of combat encounters whose map generation call failed (or
    /// produced no usable spec) — surfaced so the DM knows the set is
    /// partial rather than silently seeing fewer cards than encounters.
    /// Always empty on a cache hit.
    pub failed_maps: Vec<String>,
}

/// Payload for the `"plan-progress"` event — `phase` is `"plan"` (the single
/// session-plan-text call, `done`/`total` always 0/1 since there's nothing to
/// increment mid-call) or `"maps"` (`done` of `total` combat-encounter maps
/// generated so far, ticking up in real completion order — see
/// generate_battle_maps_for_plan_at). Mirrors tts.rs's F5InstallProgress.
#[derive(Clone, serde::Serialize)]
struct PlanProgress {
    phase: String,
    done: usize,
    total: usize,
}

/// Orchestrates "Plan Next Session" end to end — the single entry point both
/// the cache-aware `suggest_session_plan` command and the always-fresh
/// `regenerate_session_plan` command call. `force = false` and a cache hit
/// costs ZERO Claude calls (see read_session_plan_at); otherwise this asks
/// Claude for the plan text once, persists it, and — because battle maps are
/// derived from THIS SAME plan rather than independently re-guessed — asks
/// Claude once per combat encounter (see generate_battle_maps_for_plan_at)
/// for exactly the maps that plan calls for.
fn plan_next_session_at(root: &Path, id: &str, terrain_catalog: &str, force: bool, objects_enabled: bool, vocabulary: &[String], footprint_guide: &[String], on_progress: ProgressFn) -> Result<SessionPlanResult, String> {
    if !force {
        if let Some(cached) = read_session_plan_at(root, id) {
            return Ok(SessionPlanResult { plan_text: cached, maps: current_plan_owned_maps_at(root, id), failed_maps: Vec::new() });
        }
    }

    on_progress("plan", 0, 1);
    let t0 = std::time::Instant::now();
    let plan_text = suggest_session_plan_at(root, id, terrain_catalog)?;
    eprintln!("[plan-timing] plan text: {:.1}s, {} chars", t0.elapsed().as_secs_f64(), plan_text.len());
    write_session_plan_at(root, id, &plan_text)?;

    // Battle maps only make sense in Grid mode. Theater has no grid/minis at
    // all; Hex mode's physical 3D-printed terrain has no printed coordinates
    // to line up with a map's lettered grid — its own axial {q,r} tracking
    // is a genuinely different coordinate system, not just a different
    // presentation of the same one (see DM_RULES' "Prepared battle maps
    // (Grid mode only)"). Treat anything but Grid the same as "no combat
    // encounters" so generate_battle_maps_for_plan_at's existing empty-list
    // path clears any previously-owned maps and returns without a single
    // Claude call — no wasted compute for DMs who don't use Grid mode.
    let encounters: Vec<PlanEncounter> = if read_battle_mode_at(root, id) != "grid" {
        Vec::new()
    } else {
        parse_plan_encounters(&plan_text).into_iter().filter(|e| e.combat).collect()
    };

    let (combined_plan, current_chapter, combined_memory) = battle_map_context_at(root, id);
    eprintln!("[plan-timing] {} combat encounter(s) need maps", encounters.len());
    if !encounters.is_empty() {
        on_progress("maps", 0, encounters.len());
    }
    let t1 = std::time::Instant::now();
    let (maps, failed_maps) = generate_battle_maps_for_plan_at(root, id, &combined_plan, &current_chapter, &combined_memory, &encounters, objects_enabled, vocabulary, footprint_guide, on_progress)?;
    eprintln!("[plan-timing] all maps: {:.1}s total", t1.elapsed().as_secs_f64());
    Ok(SessionPlanResult { plan_text, maps, failed_maps })
}

/// Regenerates exactly ONE map the session plan owns, using the same
/// encounter name/description the plan originally gave it (see
/// PlanMapEntry) — never the whole plan. This is what the per-card
/// "Regenerate" button in the UI calls; it exists because the ONLY
/// regenerate action used to be the plan-level one (regenerate_session_plan),
/// which silently redid every encounter's map, not just the one the DM was
/// looking at (confirmed live: a DM clicking what looked like "redo this
/// map" was actually burning a full plan regeneration's worth of calls every
/// time). Errors if `slug` isn't one of the plan's own maps — an ad-hoc or
/// hand-crafted map has no encounter context to regenerate from.
fn regenerate_one_plan_map_at(root: &Path, id: &str, slug: &str, objects_enabled: bool, vocabulary: &[String], footprint_guide: &[String]) -> Result<BattleMapMeta, String> {
    let entry = read_plan_manifest_at(root, id)
        .into_iter()
        .find(|e| e.slug == slug)
        .ok_or_else(|| format!("\"{slug}\" isn't one of the current plan's maps, so it can't be regenerated this way."))?;

    let (combined_plan, current_chapter, combined_memory) = battle_map_context_at(root, id);
    let hint = format!("{} — {}", entry.name, entry.description);
    let prompt = build_battle_maps_prompt(&combined_plan, &current_chapter, &combined_memory, &hint, objects_enabled, vocabulary, footprint_guide);
    let spec = generate_map_spec(&prompt, footprint_guide)?;
    let titled = force_map_title(&spec, &entry.name);
    write_map_spec_with_slug_at(root, id, &entry.slug, &titled)?;
    rebuild_battle_maps_index_at(root, id)?;
    Ok(BattleMapMeta { slug: entry.slug, name: entry.name, summary: map_summary(&titled) })
}

fn read_battle_map_at(root: &Path, id: &str, slug: &str) -> Result<String, String> {
    if !is_valid_map_slug(slug) {
        return Ok(format!("No battle map found for \"{slug}\" (not a valid map id)."));
    }
    let path = battle_maps_dir(root, id).join(format!("{slug}.md"));
    Ok(fs::read_to_string(&path).unwrap_or_else(|_| format!("No battle map found for \"{slug}\".")))
}

/// Create-only sibling of sync_dm_rules/sync_session_index — gives an existing
/// campaign the battle_maps/ dir, a seeded index.md, and the standing CLAUDE.md
/// import, never clobbering maps already saved.
fn sync_battle_maps_index_at(root: &Path, id: &str) -> Result<(), String> {
    let dir = root.join(id);
    let maps_dir = dir.join("memory").join(BATTLE_MAPS_DIR);
    fs::create_dir_all(&maps_dir).map_err(|e| e.to_string())?;
    let index_path = maps_dir.join("index.md");
    if !index_path.exists() {
        write_atomic(&index_path, DEFAULT_BATTLE_MAPS_INDEX_MD)?;
    }
    let claude_path = dir.join("CLAUDE.md");
    let mut claude_md = fs::read_to_string(&claude_path).map_err(|e| e.to_string())?;
    if !claude_md.contains("@memory/battle_maps/index.md") {
        claude_md.push_str(BATTLE_MAPS_INDEX_IMPORT_LINE);
        write_atomic(&claude_path, &claude_md)?;
    }
    Ok(())
}

/// Generate one battle map for a specific encounter the DM/operator describes —
/// the on-demand entry point, kept alongside the plan-driven batch path (see
/// plan_next_session_at) for the "I need one more map right now" case.
#[tauri::command]
pub async fn generate_battle_map(app: AppHandle, id: String, hint: String) -> Result<Vec<BattleMapMeta>, String> {
    tokio::task::spawn_blocking(move || {
        let t0 = std::time::Instant::now();
        let objects_enabled = crate::tile_library::tile_library_configured(&app);
        let vocabulary = crate::tile_library::object_vocabulary_for_app(&app);
        let footprint_guide = crate::tile_library::object_footprint_guide_for_app(&app);
        let t_vocab = t0.elapsed();
        let root = campaigns_root(&app)?;
        let t1 = std::time::Instant::now();
        let (metas, slug) = with_map_ticker(&app, "drawing the map", t0, || generate_battle_maps_at(&root, &id, &hint, objects_enabled, &vocabulary, &footprint_guide))?;
        let t_spec = t1.elapsed();
        let t2 = std::time::Instant::now();
        with_map_ticker(&app, "matching tile art", t0, || {
            if let Err(e) = resolve_map_tiles(&app, &root, &id, &slug) {
                crate::maplog::log("TILE RESOLUTION ERROR", &e); // never block the map on tile art
            }
        });
        let _ = app.emit("map-progress", MapProgress { phase: "done", elapsed_s: t0.elapsed().as_secs() });
        log_map_phase_timing("generate_battle_map", t_vocab, t_spec, t2.elapsed());
        Ok(metas)
    })
    .await
    .map_err(|e| format!("Battle map generation task failed: {e}"))?
}

/// Regenerates exactly one of the CURRENT plan's maps — see
/// regenerate_one_plan_map_at's doc comment for why this exists as its own
/// command instead of DMs having only the whole-plan regenerate to reach for.
#[tauri::command]
pub async fn regenerate_one_plan_map(app: AppHandle, id: String, slug: String) -> Result<BattleMapMeta, String> {
    tokio::task::spawn_blocking(move || {
        let t0 = std::time::Instant::now();
        let objects_enabled = crate::tile_library::tile_library_configured(&app);
        let vocabulary = crate::tile_library::object_vocabulary_for_app(&app);
        let footprint_guide = crate::tile_library::object_footprint_guide_for_app(&app);
        let t_vocab = t0.elapsed();
        let root = campaigns_root(&app)?;
        let t1 = std::time::Instant::now();
        let meta = with_map_ticker(&app, "drawing the map", t0, || regenerate_one_plan_map_at(&root, &id, &slug, objects_enabled, &vocabulary, &footprint_guide))?;
        let t_spec = t1.elapsed();
        let t2 = std::time::Instant::now();
        with_map_ticker(&app, "matching tile art", t0, || {
            if let Err(e) = resolve_map_tiles(&app, &root, &id, &meta.slug) {
                crate::maplog::log("TILE RESOLUTION ERROR", &e);
            }
        });
        let _ = app.emit("map-progress", MapProgress { phase: "done", elapsed_s: t0.elapsed().as_secs() });
        log_map_phase_timing("regenerate_one_plan_map", t_vocab, t_spec, t2.elapsed());
        Ok(meta)
    })
    .await
    .map_err(|e| format!("Battle map regeneration task failed: {e}"))?
}

/// List a campaign's saved maps (also refreshes index.md as a side effect —
/// one code path with rebuild_battle_maps_index_at).
#[tauri::command]
pub fn list_battle_maps(app: AppHandle, id: String) -> Result<Vec<BattleMapMeta>, String> {
    Ok(rebuild_battle_maps_index_at(&campaigns_root(&app)?, &id).unwrap_or_default())
}

/// Read one map's full spec — the render source, and the `recallMap` retrieval
/// target (a friendly "not found" string, never an error, for a bad slug).
#[tauri::command]
pub fn read_battle_map(app: AppHandle, id: String, slug: String) -> Result<String, String> {
    read_battle_map_at(&campaigns_root(&app)?, &id, &slug)
}

/// Overwrite one map's spec (hand edits from the dialog) and refresh the index.
#[tauri::command]
pub fn save_battle_map(app: AppHandle, id: String, slug: String, content: String) -> Result<Vec<BattleMapMeta>, String> {
    if !is_valid_map_slug(&slug) {
        return Err(format!("Invalid map id \"{slug}\"."));
    }
    let root = campaigns_root(&app)?;
    let dir = battle_maps_dir(&root, &id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(format!("{slug}.md")), &format!("{}\n", content.trim()))?;
    rebuild_battle_maps_index_at(&root, &id)
}

/// `campaign_lore` (memory/campaign_lore.md) and `other_modules_summary`
/// (modules_index.md's listing of already-imported modules) are both `""` for
/// a campaign's first-ever import — the prompt degrades to a plain "no wider
/// context yet" framing rather than an awkward "given the campaign's lore:
/// (nothing)" block in that case.
/// Boundary-detection-only pass over the FULL raw document: title, chapter
/// headings, and a structural self-audit. This call used to ALSO write the
/// campaign-tie-in plan by reading the whole document in the same breath —
/// for a genuinely long module (a few hundred pages) that made the one call
/// doing the highest-judgment synthesis work also the one reading the most
/// text in a single pass, exactly the shape most likely to lose a detail
/// mentioned once deep in the document. Plan-writing now happens in
/// build_plan_synthesis_prompt, reading per-chapter extracts
/// (build_chapter_extraction_prompt) instead of the raw text a second time —
/// see chapterize_and_import_module_at. This call keeps only the work that
/// genuinely needs a single whole-document read (chapter boundaries can't be
/// found any other way); campaign lore/other-modules context is irrelevant
/// to finding them, so those params are gone too.
fn build_chapterize_prompt(text: &str) -> String {
    format!(
        "You will be given the full text of a Dungeons & Dragons adventure module or scenario document, extracted from a PDF. Do two things with it, in one reply.\n\n\
        1. Give the whole module a short, human-readable title (a few words, e.g. \"The Sunless Citadel\" or \"Goblin Ambush at the Old Mill\") — from the document's own title if it has one, otherwise one you invent that fits.\n\n\
        2. Identify its logical NARRATIVE chapters or major sections — the story beats the party actually plays through in order. Leave out pure-reference material that isn't a story beat (monster/NPC stat-block appendices, item/treasure tables, handout-only pages, maps with no accompanying scene) — those aren't \"chapters\" the party progresses through, so including them just makes chapter sizes wildly uneven and risks one becoming the \"current\" chapter by mistake. For each chapter, give TWO different strings:\n\
        - \"title\": a short, clean, human-readable name (e.g. \"Chapter 3: The Ambush at Old Mill\") — this is shown directly to players, so it must read as a complete phrase. Never truncate it mid-word or mid-sentence for any reason.\n\
        - \"heading\": copied EXACTLY character-for-character from a contiguous span of the document text below — including any extraction artifacts like doubled letters, stray spaces between every word, broken ligatures, or OCR garbling (e.g. if the document shows \"CHAPTER  I  I ACQUISITIO:-<S\", copy exactly that, do not clean it up to \"CHAPTER 1: ACQUISITIONS\"). Nobody ever sees this string — it exists purely to find this exact position in the raw text programmatically, so ANY normalization, cleanup, or paraphrasing will make it fail to match. Prefer it to be UNIQUE within the whole document: a short/generic heading word (\"About\", \"Background\", \"Introduction\") likely repeats elsewhere (as a subsection heading, a running header, etc.) and matching the wrong occurrence silently corrupts the split — if the bare heading text looks generic, extend the copied substring with the next few words until it's distinctive, still verbatim.\n\
        List chapters in the order they appear.\n\n\
        3. Self-audit your own breakdown above and list any STRUCTURAL concerns as short strings — e.g. a heading you weren't fully confident matched a unique exact point in the source text, or narrative chapters that still came out very uneven in size. The person reading this may be a PLAYER in the game, not the DM, so these strings must never reveal plot content, twists, names of secrets, or anything that would spoil the adventure — describe only the structural problem itself. If you have no concerns, return an empty array.\n\n\
        Reply with ONLY a JSON object, no other text, no markdown code fences:\n\
        {{\"module_title\": \"<short title>\", \"chapters\": [{{\"title\": \"<clean readable chapter title>\", \"heading\": \"<exact verbatim substring, artifacts included, chosen to be unique>\", \"summary\": \"<one clean, readable sentence describing what happens in this section>\"}}], \"concerns\": [\"<short structural concern, no spoilers>\"]}}\n\n\
        If the document has no clear internal chapter structure, still return a single chapters entry whose heading is an exact short substring from the very start of the document, whose title is a short readable name for the whole document, and whose summary describes the whole document.\n\n\
        Document:\n{text}"
    )
}

/// Extraction ("map") pass — see build_plan_synthesis_prompt for the
/// corresponding "reduce" step, and chapterize_and_import_module_at for how
/// the two fit together. Reads ONE chapter (or, for an oversized chapter,
/// one sub-chunk of it — see split_into_chunks) and pulls out the concrete
/// facts a DM must not forget, instead of writing prose about it. Splitting
/// "find every fact" (small, focused reads, one per chapter) from
/// "synthesize the plan" (reads only the extracted facts, never the raw text
/// again) is the actual fix for a genuinely long module: no single call ever
/// has to hold the whole document's worth of detail in mind while ALSO doing
/// the highest-judgment writing task.
fn build_chapter_extraction_prompt(module_title: &str, chapter_title: &str, chapter_text: &str) -> String {
    format!(
        "You are reading one chapter/section of the Dungeons & Dragons module \"{module_title}\", titled \"{chapter_title}\", so an AI Dungeon Master can be told the facts it must not forget when running this later. Extract — do not summarize the narrative or write prose.\n\n\
        List every one of the following that appears in the text below, as short markdown bullets grouped under these headings (omit a heading entirely if nothing in this chapter fits it):\n\
        ## NPCs\n\
        Every named NPC: name, role, and anything a DM must play consistently (motivation, secret, personality quirk, what they know or want).\n\
        ## Factions & organizations\n\
        Name, goal, and their stance toward the party if stated.\n\
        ## Items & treasure\n\
        Any named or magical item, its specific properties/mechanics, and where it's found.\n\
        ## Threads & hooks\n\
        Anything planted here that pays off later, any promise made to the party, any foreshadowing — even one sentence's worth.\n\
        ## Other critical specifics\n\
        Numbers, conditions, traps, secrets, or rules the text calls out explicitly that a DM improvising later would need to get right (DCs, damage, gold amounts, timers, unique locations).\n\n\
        Err on the side of including too much rather than too little — a detail left out here is gone for good; one that turns out unimportant later costs nothing. Do not editorialize or add anything not actually in the text.\n\n\
        Reply with ONLY the markdown bullets described above, no other commentary, no code fences.\n\n\
        Chapter text:\n{chapter_text}"
    )
}

/// Synthesis ("reduce") pass — writes the exact same two-section DM plan
/// build_chapterize_prompt used to write directly from the raw document, but
/// reads every chapter's already-extracted facts (build_chapter_extraction_prompt)
/// instead. Far less text than the raw document, and — the actual point —
/// it's text that already survived one dedicated, single-topic read instead
/// of competing for attention against an entire book.
/// build_plan_critique_prompt still runs unchanged on top of this call's
/// output.
fn build_plan_synthesis_prompt(chapter_extracts: &[(String, String)], campaign_lore: &str, other_modules_summary: &str) -> String {
    let context_block = if campaign_lore.trim().is_empty() && other_modules_summary.trim().is_empty() {
        "This is the first module being imported into this campaign — there's no established campaign lore or other modules to tie into yet, so treat this module's own content as the foundation.".to_string()
    } else {
        format!(
            "This campaign already has some established context — weave this module into it rather than treating it as a standalone story:\n\
            Campaign lore/framing:\n{}\n\n\
            Other modules already part of this campaign:\n{}",
            if campaign_lore.trim().is_empty() { "(none established yet)" } else { campaign_lore.trim() },
            if other_modules_summary.trim().is_empty() { "(none yet)" } else { other_modules_summary.trim() },
        )
    };
    let extracts_block = chapter_extracts
        .iter()
        .map(|(title, extract)| format!("### {title}\n{extract}"))
        .collect::<Vec<_>>()
        .join("\n\n");
    format!(
        "Below are the extracted facts (NPCs, factions, items, threads, critical specifics) from every chapter of a Dungeons & Dragons module, chapter by chapter. Write a plan for the AI Dungeon Master who will run this live at the table, as a markdown doc with exactly two sections:\n\
        ## How this fits the campaign\n\
        Given the campaign context below, which existing NPCs/factions/threads (if any) this module's content should tie into, and a natural in-fiction hook for why the party ends up here. If there's no established campaign context yet, say this module can serve as the campaign's foundation instead.\n\
        ## This module's own arc\n\
        The overall story arc across this module's own chapters, key NPCs/factions worth tracking, threads that should pay off later (foreshadowing), and pacing guidance for how the chapters connect. A module provides a framework and leaves the DM to fill in the gaps — this section IS that framework. Keep the whole plan concise (a few hundred words total is plenty), not a retelling of the extracted facts.\n\n\
        {context_block}\n\n\
        Reply with ONLY the markdown plan described above, no other commentary, no code fences.\n\n\
        Extracted facts, by chapter:\n{extracts_block}"
    )
}

/// Draft-then-critique pass 2 for a module's plan.md (see
/// chapterize_and_import_module_at) — runs over the initial chapterize
/// reply's `plan` field alone, never the chapters/headings (which must stay
/// byte-for-byte whatever pass 1 returned, since split_by_headings depends on
/// them matching the raw source text exactly). Same "give it something
/// concrete to find wrong" reasoning as build_campaign_lore_critique_prompt:
/// asks about specific failure modes (genericness, contradicting the
/// campaign context, vague hooks) rather than an open-ended "improve this."
fn build_plan_critique_prompt(draft_plan: &str, campaign_lore: &str, other_modules_summary: &str) -> String {
    let context_block = if campaign_lore.trim().is_empty() && other_modules_summary.trim().is_empty() {
        "(This is the first module in this campaign — there's no established campaign lore or other modules to check consistency against.)".to_string()
    } else {
        format!(
            "Campaign lore/framing:\n{}\n\nOther modules already part of this campaign:\n{}",
            if campaign_lore.trim().is_empty() { "(none established yet)" } else { campaign_lore.trim() },
            if other_modules_summary.trim().is_empty() { "(none yet)" } else { other_modules_summary.trim() },
        )
    };
    format!(
        "You wrote the draft plan below for the AI Dungeon Master running a Dungeons & Dragons module, with two sections: \"## How this fits the campaign\" and \"## This module's own arc\".\n\n\
        Draft plan:\n{draft_plan}\n\n\
        Campaign context it should be consistent with:\n{context_block}\n\n\
        Check specifically: is the campaign tie-in hook (if any) specific to this module and this campaign's actual established NPCs/factions/threads, or could it be pasted into any generic fantasy module unchanged? Does anything in the draft contradict the campaign context above? Are any of the foreshadowed threads or pacing notes vague enough that they wouldn't actually help a DM improvising at the table? Then rewrite the plan fixing anything that's a real problem, keeping whatever's already working. Keep the exact same two-section markdown structure and the same overall length guidance (a few hundred words total is plenty).\n\n\
        Reply with ONLY the full, revised markdown plan, no other commentary, no code fences."
    )
}

/// `title` and `heading` are deliberately separate fields serving two
/// different, conflicting needs: `title` is a clean, human-readable name
/// shown to players (in the Module dialog, index.md), which must read as a
/// complete phrase. `heading` is a raw, verbatim, exact-match search anchor
/// for `split_by_headings` — it may legitimately be garbled (OCR artifacts)
/// or clipped short for match-safety, neither of which should ever leak into
/// what a human reads. Before this split, `heading` did double duty as both,
/// so a heading Claude shortened to stay an unambiguous exact match (e.g. cut
/// off mid-phrase) showed up as a broken-looking chapter title. `#[serde(default)]`
/// on `title` (falling back to `heading` for display, see split_by_headings'
/// display_title) tolerates an older/incomplete reply that omits it.
#[derive(Deserialize, Clone, Debug)]
struct ChapterHeading {
    #[serde(default)]
    title: String,
    heading: String,
    summary: String,
}

/// The human-facing name for a chapter — `title` if Claude provided one,
/// falling back to the raw `heading` search-anchor for replies from before
/// that field existed (or ones that omitted it despite the prompt asking).
fn display_title(h: &ChapterHeading) -> String {
    let t = h.title.trim();
    if t.is_empty() { h.heading.clone() } else { t.to_string() }
}

/// The combined result of one chapterize call: a module title, chapter
/// boundaries, and the plan generated from the same read of the document.
#[derive(Deserialize, Clone, Debug)]
struct ChapterizeReply {
    #[serde(default)]
    module_title: String,
    chapters: Vec<ChapterHeading>,
    /// Claude's own spoiler-free structural self-audit of this breakdown —
    /// see build_chapterize_prompt's point 3. Never plot content, only things
    /// like "a heading may not have matched exactly" or "chapters came out
    /// uneven" — safe to show a player without spoiling the adventure.
    #[serde(default)]
    concerns: Vec<String>,
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
            .map(|h| (display_title(h), h.summary.clone()))
            .unwrap_or_else(|| ("Full Document".to_string(), String::new()));
        return vec![(title, summary, text.to_string())];
    }

    positions
        .iter()
        .enumerate()
        .map(|(i, (pos, h))| {
            let end = positions.get(i + 1).map(|(p, _)| *p).unwrap_or(text.len());
            (display_title(h), h.summary.clone(), text[*pos..end].to_string())
        })
        .collect()
}

/// Per-call ceiling (chars, not tokens — consistent with coverage_concern's
/// char-based accounting below) for one map-step extraction call — shared by
/// build_chapter_extraction_prompt (chapterize_and_import_module_at) and
/// build_inventory_extraction_prompt (establish_campaign_lore_at,
/// update_campaign_lore_at): all three read one chunk of a potentially very
/// long source document and pull structured facts out of it, so they share
/// the same sizing reasoning. ~80K chars is roughly 20K tokens: comfortably
/// inside a single high-fidelity read for any model, chosen deliberately
/// small since the whole point of the extraction pass is not losing detail,
/// not saving calls. Most chunks — even a meaty 25-30 page chapter — fit in
/// a single call; only unusually long source material gets split further.
const EXTRACTION_CHUNK_MAX_CHARS: usize = 80_000;

/// Splits `text` into pieces no longer than `max_chars`, breaking at the
/// nearest paragraph boundary (`\n\n`) at or before each cut point instead of
/// mid-sentence, so a sub-chunk's own extraction pass never opens on a
/// fragment. Falls back to a hard cut only when no paragraph break exists in
/// the remaining span — still UTF-8-safe, since the cut point always comes
/// from `char_indices` rather than a raw byte offset. A no-op (returns `text`
/// unchanged as a single-element vec) when it already fits.
fn split_into_chunks(text: &str, max_chars: usize) -> Vec<String> {
    if max_chars == 0 || text.chars().count() <= max_chars {
        return vec![text.to_string()];
    }
    let mut chunks = Vec::new();
    let mut remaining = text;
    while remaining.chars().count() > max_chars {
        let boundary = remaining.char_indices().nth(max_chars).map(|(i, _)| i).unwrap_or(remaining.len());
        let cut = remaining[..boundary].rfind("\n\n").map(|p| p + 2).unwrap_or(boundary);
        let (piece, rest) = remaining.split_at(cut);
        chunks.push(piece.to_string());
        remaining = rest;
    }
    if !remaining.is_empty() {
        chunks.push(remaining.to_string());
    }
    chunks
}

/// Pure, deterministic, zero-spoiler-risk companion to the LLM's own
/// `concerns` self-audit: split_by_headings only drops content that appears
/// BEFORE the first matched heading (everything between matched headings is
/// preserved verbatim, just possibly merged into a neighboring chapter if a
/// heading failed to match) — so comparing total chapter-body length against
/// the source's length catches a real, mechanical failure mode (front matter
/// silently excluded, or a mismatched first heading swallowing a large chunk)
/// without any human or LLM needing to read the content itself. Returns None
/// when coverage looks fine; a threshold of 90% tolerates a normal-sized
/// title page/table of contents without false-alarming on every import.
fn coverage_concern(source_len_chars: usize, covered_chars: usize) -> Option<String> {
    if source_len_chars == 0 {
        return None;
    }
    let ratio = covered_chars as f64 / source_len_chars as f64;
    if ratio >= 0.9 {
        return None;
    }
    Some(format!(
        "Only about {:.0}% of the source document ended up inside a chapter. This is often expected now — reference/appendix material (stat blocks, item tables) is intentionally left out of the chapter list — but it can also mean front matter before the first detected heading, or a heading that didn't match exactly, was left out unintentionally. Content between matched headings is never lost, so if the missing part was meant to be a chapter, check the very start of the source or the chapter list above.",
        ratio * 100.0
    ))
}

fn build_index_md(manifest: &[ChapterSummary], current_id: &str) -> String {
    let mut s = String::from("# Module chapters\n\n");
    for (i, c) in manifest.iter().enumerate() {
        let marker = if c.id == current_id { " ← CURRENT CHAPTER" } else { "" };
        s.push_str(&format!("{}. **{}** (`{}`){marker} — {}\n", i + 1, c.title, c.id, c.summary));
    }
    s
}

/// Campaign-level analog of build_index_md: one line per imported MODULE
/// (not per chapter) — feeds the always-loaded modules_index.md so Claude
/// knows what other self-contained modules exist even when they aren't
/// active (needed for the `switchActiveModule` dm-action).
fn build_modules_index_md(modules: &[ModuleSummary], active_id: &str) -> String {
    let mut s = String::from("# Imported modules\n\n");
    for (i, m) in modules.iter().enumerate() {
        let marker = if m.id == active_id { " ← ACTIVE" } else { "" };
        s.push_str(&format!("{}. **{}** (`{}`){marker} — {}\n", i + 1, m.title, m.id, m.summary));
    }
    s
}

/// Slugifies `title` and disambiguates against existing subdirectories of
/// `modules_root` (which may not exist yet for a campaign's first import) —
/// two modules titled the same thing (a re-import of the same file, or two
/// unrelated documents that happen to share a title) get distinct ids.
fn unique_module_id(modules_root: &Path, title: &str) -> String {
    let base = slugify(title);
    if !modules_root.join(&base).exists() {
        return base;
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base}-{n}");
        if !modules_root.join(&candidate).exists() {
            return candidate;
        }
        n += 1;
    }
}

/// Reads modules/active_id.txt, trimmed — None if no module has ever been
/// imported for this campaign (or none is active for some other reason).
fn read_active_module_id_at(root: &Path, id: &str) -> Option<String> {
    fs::read_to_string(root.join(id).join("modules").join("active_id.txt"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Mirrors the active module's own index.md/current.md/plan.md into the
/// campaign-root active_module/ indirection files. CLAUDE.md's standing
/// imports point at these FIXED paths (@active_module/index.md,
/// @active_module/current.md) so switching the active module never requires
/// rewriting CLAUDE.md itself — only these small mechanical copies change,
/// the same write_atomic-a-file-in-place pattern advance_chapter_at already
/// uses for a single module's own current.md. plan.md is copied too (though
/// not a standing import) so suggest_session_plan_at/read_campaign_plan_at
/// have one fixed path to read regardless of which module is active.
fn sync_active_module_indirection_at(root: &Path, id: &str, module_id: &str) -> Result<(), String> {
    let dir = root.join(id);
    let module_dir = dir.join("modules").join(module_id);
    let active_dir = dir.join("active_module");
    fs::create_dir_all(&active_dir).map_err(|e| e.to_string())?;
    write_atomic(&active_dir.join("index.md"), &read_optional(&module_dir.join("index.md")))?;
    write_atomic(&active_dir.join("current.md"), &read_optional(&module_dir.join("current.md")))?;
    write_atomic(&active_dir.join("plan.md"), &read_optional(&module_dir.join("plan.md")))?;
    Ok(())
}

/// Writes chapter files, a new module's manifest.json/current.md/
/// current_id.txt/index.md/plan.md under modules/<unique_id>/, then makes
/// that module active: writes modules/active_id.txt, regenerates the
/// campaign-root modules_manifest.json/modules_index.md, and syncs the
/// active_module/* indirection. Never wipes anything — every import ADDS a
/// module, coexisting with any already imported. Also makes sure CLAUDE.md
/// references the standing module-import block, but only the first time
/// (idempotent `.contains()` check — a campaign that never imports a module
/// never gets this block at all).
fn write_chapters_to_disk(
    root: &Path,
    id: &str,
    chapters: &[(String, String, String)],
    plan: &str,
    module_title: &str,
) -> Result<(String, Vec<ChapterSummary>), String> {
    if chapters.is_empty() {
        return Err("No chapters to write.".into());
    }
    let dir = root.join(id);
    let modules_root = dir.join("modules");
    fs::create_dir_all(&modules_root).map_err(|e| e.to_string())?;
    let module_id = unique_module_id(&modules_root, module_title);
    let module_dir = modules_root.join(&module_id);
    fs::create_dir_all(&module_dir).map_err(|e| e.to_string())?;

    let mut summaries = vec![];
    for (i, (title, summary, content)) in chapters.iter().enumerate() {
        let chapter_id = format!("chapter-{:02}-{}", i + 1, slugify(title));
        write_atomic(&module_dir.join(format!("{chapter_id}.md")), content)?;
        summaries.push(ChapterSummary { id: chapter_id, title: title.clone(), summary: summary.clone() });
    }

    write_atomic(
        &module_dir.join("manifest.json"),
        &serde_json::to_string_pretty(&summaries).map_err(|e| e.to_string())?,
    )?;

    let first_id = summaries[0].id.clone();
    write_atomic(&module_dir.join("current.md"), &chapters[0].2)?;
    write_atomic(&module_dir.join("current_id.txt"), &first_id)?;
    write_atomic(&module_dir.join("index.md"), &build_index_md(&summaries, &first_id))?;
    write_atomic(&module_dir.join("plan.md"), plan)?;

    // Regenerate the campaign-level module list (structured truth + readable
    // index) including every module imported so far, not just this one.
    let mut all_modules: Vec<ModuleSummary> = fs::read_to_string(dir.join("modules_manifest.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    all_modules.push(ModuleSummary {
        id: module_id.clone(),
        title: module_title.trim().to_string(),
        summary: summaries[0].summary.clone(),
    });
    write_atomic(
        &dir.join("modules_manifest.json"),
        &serde_json::to_string_pretty(&all_modules).map_err(|e| e.to_string())?,
    )?;
    write_atomic(&dir.join("modules_index.md"), &build_modules_index_md(&all_modules, &module_id))?;
    write_atomic(&modules_root.join("active_id.txt"), &module_id)?;
    sync_active_module_indirection_at(root, id, &module_id)?;

    let claude_path = dir.join("CLAUDE.md");
    let mut claude_md = fs::read_to_string(&claude_path).map_err(|e| e.to_string())?;
    if !claude_md.contains("@active_module/current.md") {
        claude_md.push_str(MODULE_IMPORT_BLOCK);
        write_atomic(&claude_path, &claude_md)?;
    }

    Ok((module_id, summaries))
}

/// Sets which chapter is "current" WITHIN THE ACTIVE MODULE — called when a
/// turn's dm-actions block includes `advanceToChapter`, or from the Module
/// dialog's manual override. Resolves the active module via
/// modules/active_id.txt first, then re-syncs the active_module/*
/// indirection so the change is actually visible to CLAUDE.md.
fn advance_chapter_at(root: &Path, id: &str, chapter_id: &str) -> Result<(), String> {
    let active_id = read_active_module_id_at(root, id).ok_or("No active module for this campaign.")?;
    let module_dir = root.join(id).join("modules").join(&active_id);
    let manifest: Vec<ChapterSummary> = serde_json::from_str(
        &fs::read_to_string(module_dir.join("manifest.json"))
            .map_err(|e| format!("No active module for this campaign: {e}"))?,
    )
    .map_err(|e| e.to_string())?;
    if !manifest.iter().any(|c| c.id == chapter_id) {
        return Err(format!("Unknown chapter id \"{chapter_id}\"."));
    }
    let content = fs::read_to_string(module_dir.join(format!("{chapter_id}.md"))).map_err(|e| e.to_string())?;
    write_atomic(&module_dir.join("current.md"), &content)?;
    write_atomic(&module_dir.join("current_id.txt"), chapter_id)?;
    write_atomic(&module_dir.join("index.md"), &build_index_md(&manifest, chapter_id))?;
    sync_active_module_indirection_at(root, id, &active_id)?;
    // A cached session plan (see read_session_plan_at) describes "what's
    // coming up" for the chapter we just left — invalidate it so the next
    // "Plan Next Session" open regenerates against the new chapter instead
    // of silently showing stale content. Battle map FILES are left alone
    // here (a DM mid-session may have already printed them); they're only
    // replaced the next time the plan is actually regenerated.
    let _ = fs::remove_file(session_plan_path(root, id));
    Ok(())
}

/// Switches which already-imported module is active — the dm-actions
/// `switchActiveModule` handler, or a manual "Set as active" click in the
/// Module dialog. Validates the id BEFORE writing anything so a bad id never
/// leaves active_id.txt pointing at nothing. Deliberately does NOT touch the
/// target module's own current_id.txt — each module remembers its own
/// chapter progress independently, so switching back to a previously-visited
/// module resumes wherever it was left, not chapter 1.
fn set_active_module_at(root: &Path, id: &str, module_id: &str) -> Result<(), String> {
    let module_dir = root.join(id).join("modules").join(module_id);
    if !module_dir.join("manifest.json").exists() {
        return Err(format!("Unknown module id \"{module_id}\"."));
    }
    write_atomic(&root.join(id).join("modules").join("active_id.txt"), module_id)?;
    sync_active_module_indirection_at(root, id, module_id)
}

/// All imported modules + which one is active — feeds the Module dialog's
/// top-level list. Empty modules + None active_id means no module has ever
/// been imported for this campaign (same graceful shape as
/// get_module_chapters_at's own "nothing imported yet" case).
fn list_campaign_modules_at(root: &Path, id: &str) -> Result<CampaignModules, String> {
    let dir = root.join(id);
    let manifest_path = dir.join("modules_manifest.json");
    if !manifest_path.exists() {
        return Ok(CampaignModules { modules: vec![], active_id: None });
    }
    let modules: Vec<ModuleSummary> =
        serde_json::from_str(&fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(CampaignModules { modules, active_id: read_active_module_id_at(root, id) })
}

/// Builds the prompt for trimming a resolved section out of the *current*
/// chapter's working copy (module/current.md). Deliberately conservative —
/// safety here matters more than thoroughness, since corrupting content the
/// party hasn't reached yet would be far worse than an occasional missed
/// trim. Relies on `advance_chapter_at` always re-copying the pristine
/// original `chapter-XX-*.md` file into current.md on every chapter switch
/// (confirmed by reading that function above) — so this only ever rewrites
/// the working copy; switching away and back restores the untrimmed
/// original if a trim ever goes wrong.
fn build_trim_chapter_prompt(chapter_text: &str, resolved_description: &str) -> String {
    format!(
        "This is the full text of the Dungeons & Dragons chapter currently being run. The party has resolved the following part of it: \"{resolved_description}\".\n\n\
        Rewrite the chapter text, replacing ONLY the portion that corresponds to what's been resolved with a short bracketed note like [Already resolved: brief summary]. Everything else — especially anything the party hasn't reached yet — must be preserved EXACTLY VERBATIM, not paraphrased, not summarized, not reformatted. If you aren't confident which portion of the text corresponds to what's been resolved, make NO changes at all and return the text completely unchanged — a missed trim is harmless, but guessing wrong and altering unencountered content is not.\n\n\
        Reply with ONLY the resulting chapter text, no other commentary, no code fences.\n\n\
        Current chapter text:\n{chapter_text}"
    )
}

/// Impure: rewrites `module_id`'s own current.md only (never the original
/// per-chapter file — see build_trim_chapter_prompt's doc comment for why
/// that's safe). `module_id` is passed in by the caller (captured at the
/// moment `resolveChapterSection` was dispatched) rather than re-resolved
/// from modules/active_id.txt here — this call is fire-and-forget from the
/// frontend and can take several seconds, so re-reading "the" active module
/// lazily could race a mid-flight `switchActiveModule` and trim the wrong
/// one. Only re-syncs the active_module/* indirection if `module_id` is
/// STILL the active module by the time this finishes — if the party already
/// switched away, the trim still lands correctly in that module's own
/// current.md for whenever they switch back, but must not clobber whatever's
/// now actually being shown as active.
fn trim_resolved_chapter_section_at(root: &Path, id: &str, module_id: &str, resolved_description: &str) -> Result<(), String> {
    let path = root.join(id).join("modules").join(module_id).join("current.md");
    let current = fs::read_to_string(&path).map_err(|e| format!("No active chapter to trim: {e}"))?;
    let rewritten = crate::local_llm::ask_ingest_once(build_trim_chapter_prompt(&current, resolved_description), Some("sonnet"), false)?;
    let trimmed = rewritten.trim();
    if trimmed.is_empty() {
        return Err("Chapter trim returned empty content; leaving current.md untouched.".into());
    }
    backup_before_overwrite(&path);
    write_atomic(&path, trimmed)?;
    if read_active_module_id_at(root, id).as_deref() == Some(module_id) {
        sync_active_module_indirection_at(root, id, module_id)?;
        // A cached session plan (see read_session_plan_at) was written
        // against the PREVIOUS current.md — a resolved-section trim means
        // the story has genuinely moved within this same chapter (this is
        // the within-chapter equivalent of advance_chapter_at's own
        // invalidation, for the "story advanced but we're not out of the
        // chapter yet" case), so it's stale in the same way a chapter
        // change makes it stale. Only when this trim is for the module
        // that's actually active — a trim for some other module doesn't
        // change what the DM would plan for next.
        invalidate_session_plan_at(root, id);
    }
    Ok(())
}

/// Chapters for one SPECIFIC module (not implicitly "the" module — a
/// campaign can have several). Empty chapters + None current_id means that
/// module id doesn't exist / nothing's been imported at all.
fn get_module_chapters_at(root: &Path, id: &str, module_id: &str) -> Result<(Vec<ChapterSummary>, Option<String>), String> {
    let module_dir = root.join(id).join("modules").join(module_id);
    let manifest_path = module_dir.join("manifest.json");
    if !manifest_path.exists() {
        return Ok((vec![], None));
    }
    let manifest: Vec<ChapterSummary> =
        serde_json::from_str(&fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let current_id = fs::read_to_string(module_dir.join("current_id.txt")).ok().map(|s| s.trim().to_string());
    Ok((manifest, current_id))
}

/// The impure orchestration step, now a four-stage pipeline instead of two
/// calls, specifically so a long module stops losing detail:
/// 1. One Opus call finds the module title + chapter headings (boundary
///    detection only now — see build_chapterize_prompt's doc comment for why
///    plan-writing moved out of this call).
/// 2. The raw text is split on those headings (split_by_headings, pure/
///    mechanical — no content is rewritten, just cut).
/// 3. One Opus call PER CHAPTER (build_chapter_extraction_prompt) extracts
///    the concrete facts (NPCs, factions, items, threads) from that
///    chapter's own text alone — oversized chapters are sub-chunked first
///    (split_into_chunks) so no single call reads more than
///    EXTRACTION_CHUNK_MAX_CHARS. This is the "map" step.
/// 4. One Opus call (build_plan_synthesis_prompt) writes the campaign-
///    integration plan from ALL the extracted facts, then the existing
///    critique pass (build_plan_critique_prompt) polishes it exactly as
///    before. This is the "reduce" step.
/// Trades call count for fidelity: a several-hundred-page module now costs
/// roughly one call per chapter instead of two calls total — worth it only
/// because this runs once per import (see dm.rs), never on the live turn
/// loop. Steps 1 and 3 are load-bearing (a failure fails the whole import,
/// same as before) since a hole in the extracted facts would just
/// reintroduce the exact problem this pipeline exists to fix; only the final
/// critique polish still degrades gracefully to its pre-critique draft on
/// failure, same as before. Only this function (and the #[tauri::command]
/// wrapping it) touches the network/subprocess — split_by_headings/
/// split_into_chunks/write_chapters_to_disk above are pure and covered by
/// real tests instead.
/// Total chunk count across every chapter — gives the "extracting" progress
/// phase a real "chunk N of M" total up front (see
/// chapterize_and_import_module_at). Pure/cheap (split_into_chunks does no
/// I/O), unit-tested directly since the orchestrating function itself needs
/// a live `claude` to exercise (see the #[ignore]d end-to-end test).
fn total_extraction_chunks(chapters: &[(String, String, String)]) -> usize {
    chapters.iter().map(|(_, _, body)| split_into_chunks(body, EXTRACTION_CHUNK_MAX_CHARS).len()).sum()
}

fn chapterize_and_import_module_at(root: &Path, id: &str, raw_text: &str, on_progress: ProgressFn) -> Result<ChapterizeImportResult, String> {
    let dir = root.join(id);
    let campaign_lore = read_optional(&dir.join("memory").join("campaign_lore.md"));
    let other_modules_summary = read_optional(&dir.join("modules_index.md"));

    on_progress("chapterizing", 0, 0);
    let reply = crate::local_llm::ask_ingest_once(build_chapterize_prompt(raw_text), Some("opus"), true)?;
    let parsed = parse_chapterize_reply(&reply)?;
    let chapters = split_by_headings(raw_text, &parsed.chapters);
    let module_title = if parsed.module_title.trim().is_empty() {
        chapters[0].0.clone()
    } else {
        parsed.module_title.trim().to_string()
    };

    let mut concerns = parsed.concerns.clone();
    let covered_chars: usize = chapters.iter().map(|(_, _, body)| body.chars().count()).sum();
    if let Some(note) = coverage_concern(raw_text.chars().count(), covered_chars) {
        concerns.push(note);
    }

    // Total chunk count is fully knowable now (chapters are fixed, chunking is
    // pure/deterministic) — precompute it so "extracting" reports a real
    // "chunk N of M" instead of an unbounded counter.
    let total_chunks = total_extraction_chunks(&chapters);
    let mut chunks_done = 0usize;
    on_progress("extracting", 0, total_chunks);

    let mut extracts: Vec<(String, String)> = Vec::with_capacity(chapters.len());
    for (title, _, body) in &chapters {
        let mut chunk_extracts = Vec::new();
        for chunk in split_into_chunks(body, EXTRACTION_CHUNK_MAX_CHARS) {
            chunk_extracts.push(crate::local_llm::ask_ingest_once(build_chapter_extraction_prompt(&module_title, title, &chunk), Some("opus"), false)?);
            chunks_done += 1;
            on_progress("extracting", chunks_done, total_chunks);
        }
        extracts.push((title.clone(), chunk_extracts.join("\n\n")));
    }

    on_progress("synthesizing", 0, 0);
    let draft_plan = crate::local_llm::ask_ingest_once(build_plan_synthesis_prompt(&extracts, &campaign_lore, &other_modules_summary), Some("opus"), false)?;
    on_progress("critiquing", 0, 0);
    let plan = crate::local_llm::ask_ingest_once(build_plan_critique_prompt(&draft_plan, &campaign_lore, &other_modules_summary), Some("opus"), false)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(draft_plan);

    let (module_id, summaries) = write_chapters_to_disk(root, id, &chapters, &plan, &module_title)?;
    Ok(ChapterizeImportResult { module_id, module_title, chapters: summaries, concerns })
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

/// Backs up one campaign to a zip file at `dest_path` (chosen via the
/// frontend's native Save dialog). Async + spawn_blocking since zipping a
/// campaign with a lot of imported-module history is real, potentially slow
/// file I/O — same reasoning as probe_cuda's fix earlier: a sync command can
/// block whatever thread services IPC and freeze the whole window.
#[tauri::command]
pub async fn export_campaign(app: AppHandle, id: String, dest_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let root = campaigns_root(&app)?;
        export_campaign_at(&root, &id, Path::new(&dest_path))
    })
    .await
    .map_err(|e| format!("Export task failed: {e}"))?
}

/// import_campaign's return shape — `renamed_from` is only `Some` when the
/// zip's own name collided with an existing campaign and dedupe_campaign_name
/// picked a different one, so the frontend can tell the user what happened.
#[derive(Serialize)]
pub struct ImportedCampaign {
    #[serde(flatten)]
    pub meta: CampaignMeta,
    pub renamed_from: Option<String>,
}

/// Restores a campaign from a previously-exported zip (chosen via the
/// frontend's native file-open dialog) as a brand-new campaign. See
/// import_campaign_at's doc comment for collision/rename handling.
#[tauri::command]
pub async fn import_campaign(app: AppHandle, zip_path: String) -> Result<ImportedCampaign, String> {
    tokio::task::spawn_blocking(move || {
        let root = campaigns_root(&app)?;
        let (meta, renamed_from) = import_campaign_at(&root, Path::new(&zip_path))?;
        Ok(ImportedCampaign { meta, renamed_from })
    })
    .await
    .map_err(|e| format!("Import task failed: {e}"))?
}

/// Establishes memory/campaign_lore.md via a one-time Opus call — see
/// establish_campaign_lore_at. Called by the frontend as its own step right
/// after create_campaign succeeds; a failure here does not roll back the
/// already-created campaign (same tolerance as the existing pendingModuleFile
/// chaining for an in-progress module import).
#[tauri::command]
pub async fn establish_campaign_lore(app: AppHandle, id: String, intake: CampaignIntake) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let root = campaigns_root(&app)?;
        establish_campaign_lore_at(&root, &id, &intake)
    })
    .await
    .map_err(|e| format!("Campaign-lore establishment task failed: {e}"))?
}

/// Folds new material into an ALREADY-established campaign — see
/// update_campaign_lore_at. Unlike establish_campaign_lore, this is callable
/// any time after creation (a sourcebook picked up mid-campaign, a later plot
/// decision), not just once at creation.
#[tauri::command]
pub async fn update_campaign_lore(app: AppHandle, id: String, addition: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let root = campaigns_root(&app)?;
        update_campaign_lore_at(&root, &id, &addition)
    })
    .await
    .map_err(|e| format!("Campaign-lore update task failed: {e}"))?
}

#[tauri::command]
pub fn read_campaign_notes(app: AppHandle, id: String) -> Result<String, String> {
    fs::read_to_string(campaign_dir(&app, &id)?.join("CLAUDE.md")).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_campaign_notes(app: AppHandle, id: String, content: String) -> Result<(), String> {
    write_atomic(&campaign_dir(&app, &id)?.join("CLAUDE.md"), &content)
}

#[tauri::command]
pub fn read_campaign_memory(app: AppHandle, id: String) -> Result<String, String> {
    fs::read_to_string(campaign_dir(&app, &id)?.join("memory").join("MEMORY.md")).map_err(|e| e.to_string())
}

/// See DEFAULT_FLAGGED_FACTS_MD — the standalone facts (dm-actions
/// `remember`) split out of MEMORY.md so they're never subject to its lossy
/// compaction. Feeds the History dialog alongside read_campaign_memory.
#[tauri::command]
pub fn read_campaign_flagged_facts(app: AppHandle, id: String) -> Result<String, String> {
    fs::read_to_string(campaign_dir(&app, &id)?.join("memory").join("flagged_facts.md")).map_err(|e| e.to_string())
}

/// Moves one concluded flagged fact to resolved_facts.md — the dm-actions
/// `resolveFact` handler (see resolve_flagged_fact_at). Returns whether a
/// matching fact was actually found and moved.
#[tauri::command]
pub fn resolve_flagged_fact(app: AppHandle, id: String, date: String, fact: String) -> Result<bool, String> {
    resolve_flagged_fact_at(&campaigns_root(&app)?, &id, &date, &fact)
}

/// Appends a dated recap entry to the campaign's memory log — called once
/// when a session ends (see DMConsolePage's "End session" flow).
#[tauri::command]
pub fn append_session_recap(app: AppHandle, id: String, date: String, recap: String) -> Result<(), String> {
    append_session_recap_at(&campaigns_root(&app)?, &id, &date, &recap)
}

/// Opus map-reduce digest of a session's verbatim transcript — see
/// digest_session_at. Called once at session end (DMConsolePage's
/// wrapUpCurrentSession) with the full transcript of everything said this
/// sitting. Async + spawn_blocking since it makes real (potentially several,
/// for a long session) Opus calls and does file I/O — same treatment as every
/// other ingestion command. Returns the session summary so the frontend can
/// reuse it for the short MEMORY.md recap without a second call.
#[tauri::command]
pub async fn digest_session(app: AppHandle, id: String, date: String, transcript: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let root = campaigns_root(&app)?;
        digest_session_at(&root, &id, &date, &transcript)
    })
    .await
    .map_err(|e| format!("Session digest task failed: {e}"))?
}

/// Reads back one session's verbatim record for a turn's dm-actions
/// `recallSession` — see read_session_record_at. The frontend injects the
/// returned text into the DM's NEXT turn prompt so it can answer accurately
/// about that past session (see DMConsolePage's runTurn + dmPrompt.ts).
#[tauri::command]
pub fn read_session_record(app: AppHandle, id: String, session_id: String) -> Result<String, String> {
    read_session_record_at(&campaigns_root(&app)?, &id, &session_id)
}

/// Appends one flagged fact from a turn's dm-actions `remember` array — see
/// DMConsolePage's runTurn.
#[tauri::command]
pub fn append_memory_note(app: AppHandle, id: String, date: String, note: String) -> Result<(), String> {
    append_memory_note_at(&campaigns_root(&app)?, &id, &date, &note)
}

/// The three combat-positioning styles a campaign can be played in, chosen per
/// campaign in the DM Console toolbar and remembered in `battle_mode.txt`. The
/// active one is sent to the DM every turn (see DMConsolePage/buildTurnPrompt's
/// `Battle mode:` line) and governs how positioning is narrated — see DM_RULES'
/// "Running combat & positioning". `theater` is the default: it needs no
/// physical map or minis and is the common home-game style, and it is what
/// existing campaigns (which have no battle_mode.txt yet) fall back to.
const BATTLE_MODES: [&str; 3] = ["theater", "grid", "hex"];
const DEFAULT_BATTLE_MODE: &str = "theater";

/// Any unrecognized value (a missing file reads as "", an old/garbled file, a
/// bad command arg) resolves to the default rather than erroring — a wrong mode
/// is harmless (it only changes how positioning is narrated), so tolerate it.
fn normalize_battle_mode(raw: &str) -> String {
    let trimmed = raw.trim();
    if BATTLE_MODES.contains(&trimmed) {
        trimmed.to_string()
    } else {
        DEFAULT_BATTLE_MODE.to_string()
    }
}

/// Pure: reads a campaign's saved battle mode, defaulting to `theater` when the
/// file is missing (every campaign created before this feature) or holds
/// anything unrecognized.
fn read_battle_mode_at(root: &Path, id: &str) -> String {
    normalize_battle_mode(&read_optional(&root.join(id).join("battle_mode.txt")))
}

/// Pure: persists a campaign's battle mode, normalizing first so the file only
/// ever contains one of the three known values. Returns the value actually
/// written so the caller's UI reflects any normalization.
fn set_battle_mode_at(root: &Path, id: &str, mode: &str) -> Result<String, String> {
    let normalized = normalize_battle_mode(mode);
    write_atomic(&root.join(id).join("battle_mode.txt"), &normalized)?;
    Ok(normalized)
}

/// Read the campaign's battle mode — fetched once per campaign switch by
/// DMConsolePage, same pattern as read_campaign_plan / read_npc_voices.
#[tauri::command]
pub fn read_battle_mode(app: AppHandle, id: String) -> Result<String, String> {
    Ok(read_battle_mode_at(&campaigns_root(&app)?, &id))
}

/// Persist the campaign's battle mode when the DM picks one in the toolbar.
#[tauri::command]
pub fn set_battle_mode(app: AppHandle, id: String, mode: String) -> Result<String, String> {
    set_battle_mode_at(&campaigns_root(&app)?, &id, &mode)
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

/// Upserts one player character's identity + backstory summary into
/// memory/party.md (see DEFAULT_PARTY_MD) — called from DMConsolePage
/// whenever a character is pushed to the DM Console over LAN, and again for
/// the whole current party when a campaign is selected (so characters that
/// connected before the campaign was picked still land). Same upsert-by-name
/// machinery as entities.md/locations.md, so a re-push (HP changes, level-up,
/// edited backstory notes) updates that character's line in place.
#[tauri::command]
pub fn upsert_party_member(app: AppHandle, id: String, name: String, description: String) -> Result<(), String> {
    upsert_named_fact_at(&campaigns_root(&app)?, &id, "party.md", &name, &description)
}

/// Assigns an NPC's TTS voice (+ optional race/size pitch tag, + optional
/// speaking-rate override) — called from DMConsolePage's runTurn whenever a
/// turn's `rememberEntity` entry includes a `voiceId` (see BASE_CLAUDE_MD's
/// "Giving NPCs distinct voices" — Claude never sends `speed`, that's manual-
/// override-only, see the History dialog's voice panel), and from the manual
/// voice-override panel itself (voice_id/pitch/speed all human-set there).
/// Doesn't validate voice_id/pitch/speed against tts.rs's known sets/ranges
/// here — an unknown value just falls back to the narrator voice / no pitch
/// change / the default rate at speak time (see tts.rs's
/// ensure_voice_available/pitch_factor/DEFAULT_LENGTH_SCALE), same "harmless
/// no-op on a bad value" tolerance as other dm-actions fields.
#[tauri::command]
pub fn set_npc_voice(app: AppHandle, id: String, name: String, voice_id: String, pitch: Option<String>, speed: Option<f64>, enforce_unique: Option<bool>) -> Result<String, String> {
    set_npc_voice_at(&campaigns_root(&app)?, &id, &name, &voice_id, pitch.as_deref(), speed, enforce_unique.unwrap_or(false))
}

/// Reads the full name→assignment map for a campaign — fetched once per
/// campaign switch by DMConsolePage (same pattern as read_campaign_plan) and
/// consulted locally on every spoken line, not re-fetched per turn.
#[tauri::command]
pub fn read_npc_voices(app: AppHandle, id: String) -> Result<HashMap<String, NpcVoiceAssignment>, String> {
    Ok(read_npc_voices_at(&campaigns_root(&app)?, &id))
}

/// Counts NPCs in this campaign assigned one of tts.rs's curated archetype
/// voices (is_archetype_voice) — e.g. an `orc-m-1`. `ttsEngine` is a device-
/// wide setting (useSettingsStore), not a per-campaign one, so there's no
/// "was the high-quality engine enabled when this campaign was made" fact to
/// read back on import; this checks the actual voice data instead. Called
/// once per campaign activation (import or switch) by DMConsolePage — a
/// non-zero count while the high-quality engine is off is the signal it uses
/// to *offer* enabling it (existing confirm-download modal), never to force
/// the large, GPU-gated, one-way download automatically.
fn campaign_archetype_voice_count_at(root: &Path, id: &str) -> usize {
    read_npc_voices_at(root, id).values().filter(|a| crate::tts::is_archetype_voice(&a.voice_id)).count()
}

#[tauri::command]
pub fn campaign_archetype_voice_count(app: AppHandle, id: String) -> Result<usize, String> {
    Ok(campaign_archetype_voice_count_at(&campaigns_root(&app)?, &id))
}

/// Refreshes this campaign's generated DM rules — see sync_dm_rules_at. Called
/// from DMConsolePage on every campaign load, before the DM session is warmed,
/// so the very first turn already sees the current rules. Also brings the
/// session-index/retrieval files up to date (sync_session_index_at) in the
/// same pass — both are idempotent per-load upgrades for campaigns created
/// before these systems existed, so they belong on the same trigger.
#[tauri::command]
pub fn sync_dm_rules(app: AppHandle, id: String) -> Result<(), String> {
    let root = campaigns_root(&app)?;
    sync_dm_rules_at(&root, &id)?;
    sync_session_index_at(&root, &id)?;
    sync_battle_maps_index_at(&root, &id)
}

/// How much voice_debug.log to keep. It's a diagnostic, not a record — old
/// turns are dropped from the front rather than growing without bound.
const VOICE_DEBUG_MAX_BYTES: usize = 256 * 1024;

/// Appends one turn's raw (still-tagged) narration plus the per-sentence voice
/// decision that narration produced, to <campaign>/memory/voice_debug.log.
///
/// Exists because the DM's reply is stripped of its `[Name]:` tags before it's
/// displayed or stored anywhere — so when a voice comes out wrong at the table,
/// there is nothing on disk showing what the DM actually emitted or which
/// branch of resolveVoiceAssignment fired. Every voice diagnosis before this
/// was reverse-engineered from what a human heard, which repeatedly landed near
/// the bug without hitting it. This is the ground truth.
///
/// Never an error the caller must handle: a diagnostic that breaks a live turn
/// would be worse than the bug it's chasing.
#[tauri::command]
pub fn log_voice_debug(app: AppHandle, id: String, entry: String) -> Result<(), String> {
    let root = campaigns_root(&app)?;
    let path = root.join(&id).join("memory").join("voice_debug.log");
    let mut existing = read_optional(&path);
    existing.push_str(entry.trim_end());
    existing.push_str("\n\n");
    if existing.len() > VOICE_DEBUG_MAX_BYTES {
        // Trim from the front, then forward to the next turn header so the file
        // never starts mid-entry.
        let cut = existing.len() - VOICE_DEBUG_MAX_BYTES;
        let tail = match existing[cut..].find("\n=== turn ") {
            Some(i) => &existing[cut + i + 1..],
            None => &existing[cut..],
        };
        existing = tail.to_string();
    }
    write_atomic(&path, &existing)
}

/// Finds NPCs missing a voice assignment and assigns one via a dedicated
/// Opus reasoning pass — see reconcile_npc_voices_at. Called from
/// wrapUpCurrentSession (so voices are ready before the next sitting, not
/// decided under a live turn's time pressure) and from a manual "Assign NPC
/// voices" button. Returns how many were newly assigned — 0 is the common
/// case once a campaign's NPCs are mostly already voiced.
#[tauri::command]
pub async fn reconcile_npc_voices(app: AppHandle, id: String) -> Result<usize, String> {
    tokio::task::spawn_blocking(move || {
        let root = campaigns_root(&app)?;
        reconcile_npc_voices_at(&root, &id)
    })
    .await
    .map_err(|e| format!("Voice reconciliation task failed: {e}"))?
}

/// Ties any party member missing a personal campaign-lore hook to something
/// already established in campaign_lore.md — see reconcile_campaign_hooks_at.
/// Called from wrapUpCurrentSession (so hooks are ready before the next
/// sitting) and from a manual "Personalize campaign hooks" button. Returns
/// how many PCs newly got a hook — 0 is the common case once everyone at the
/// table already has one.
#[tauri::command]
pub async fn reconcile_campaign_hooks(app: AppHandle, id: String) -> Result<usize, String> {
    tokio::task::spawn_blocking(move || {
        let root = campaigns_root(&app)?;
        reconcile_campaign_hooks_at(&root, &id)
    })
    .await
    .map_err(|e| format!("Campaign-hooks reconciliation task failed: {e}"))?
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

/// Reads the overarching campaign-lore doc — feeds the Lore dialog (both to
/// show what's currently established and as the "existing" half of
/// update_campaign_lore's merge). Empty string if establish_campaign_lore
/// hasn't run yet for some reason, same tolerant shape as entities/locations.
#[tauri::command]
pub fn read_campaign_lore(app: AppHandle, id: String) -> Result<String, String> {
    Ok(read_optional(&campaign_dir(&app, &id)?.join("memory").join("campaign_lore.md")))
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
        let current_chapter = read_optional(&root.join(&id).join("active_module").join("current.md"));
        compact_entities_if_needed_at(&root, &id, "entities.md", "entities", &current_chapter)?;
        compact_entities_if_needed_at(&root, &id, "locations.md", "locations", &current_chapter)?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Knowledge compaction task failed: {e}"))?
}

/// Called at "End session" — see invalidate_session_plan_at's doc comment.
/// A plain sync command (a single fs::remove_file, no LLM call) rather than
/// spawn_blocking, matching read_battle_map/list_battle_maps' precedent for
/// fast local-IO-only commands in this file.
#[tauri::command]
pub fn invalidate_session_plan(app: AppHandle, id: String) -> Result<(), String> {
    invalidate_session_plan_at(&campaigns_root(&app)?, &id);
    Ok(())
}

/// Read-only peek at whatever's cached — NEVER calls Claude, even on a
/// cache miss (unlike suggest_session_plan below). This is what "opening"
/// the Plan Next Session dialog calls: just show whatever's already there
/// (or nothing) without silently kicking off an LLM call just from a click.
/// Actually generating — first time or a regenerate — is always an
/// explicit button press (suggest_session_plan / regenerate_session_plan).
fn read_cached_session_plan_at(root: &Path, id: &str) -> Option<SessionPlanResult> {
    read_session_plan_at(root, id).map(|plan_text| SessionPlanResult {
        plan_text,
        maps: current_plan_owned_maps_at(root, id),
        failed_maps: Vec::new(),
    })
}

#[tauri::command]
pub fn read_cached_session_plan(app: AppHandle, id: String) -> Result<Option<SessionPlanResult>, String> {
    Ok(read_cached_session_plan_at(&campaigns_root(&app)?, &id))
}

/// "Plan mode" — session-prep suggestion PLUS its battle maps in one merged
/// result, callable any time (not just at session start; a DM can ask days
/// ahead). Cache-aware (see plan_next_session_at): if a plan's already been
/// generated for whatever chapter is currently active, this returns it
/// straight from disk with zero Claude calls, so opening the dialog twice
/// can never show two different answers. Use regenerate_session_plan to
/// force a fresh one.
#[tauri::command]
pub async fn suggest_session_plan(app: AppHandle, id: String) -> Result<SessionPlanResult, String> {
    tokio::task::spawn_blocking(move || {
        let objects_enabled = crate::tile_library::tile_library_configured(&app);
        let vocabulary = crate::tile_library::object_vocabulary_for_app(&app);
        let footprint_guide = crate::tile_library::object_footprint_guide_for_app(&app);
        let root = campaigns_root(&app)?;
        let terrain_catalog = crate::terrain::read_terrain_catalog_at(&crate::terrain::terrain_catalog_path(&app)?);
        let app_emit = app.clone();
        let on_progress = move |phase: &str, done: usize, total: usize| {
            let _ = app_emit.emit("plan-progress", PlanProgress { phase: phase.to_string(), done, total });
        };
        let result = plan_next_session_at(&root, &id, &terrain_catalog, false, objects_enabled, &vocabulary, &footprint_guide, &on_progress)?;
        resolve_result_tiles(&app, &root, &id, &result);
        Ok(result)
    })
    .await
    .map_err(|e| format!("Session-plan task failed: {e}"))?
}

/// Resolve catalog tiles for every map a session-plan result owns. Each call
/// self-skips maps whose sidecar is already current (see resolve_map_tiles's
/// staleness gate), so a plan cache-hit spends no vision calls; only the maps
/// actually (re)generated this run get resolved. Never fatal.
fn resolve_result_tiles(app: &AppHandle, root: &Path, id: &str, result: &SessionPlanResult) {
    for m in &result.maps {
        if let Err(e) = resolve_map_tiles(app, root, id, &m.slug) {
            crate::maplog::log("TILE RESOLUTION ERROR", &format!("{}: {e}", m.slug));
        }
    }
}

/// Forces a fresh session plan (and, since maps are derived from it, a fresh
/// battle-map batch replacing whatever the previous plan owned) — the
/// "Regenerate" button's target.
#[tauri::command]
pub async fn regenerate_session_plan(app: AppHandle, id: String) -> Result<SessionPlanResult, String> {
    tokio::task::spawn_blocking(move || {
        let objects_enabled = crate::tile_library::tile_library_configured(&app);
        let vocabulary = crate::tile_library::object_vocabulary_for_app(&app);
        let footprint_guide = crate::tile_library::object_footprint_guide_for_app(&app);
        let root = campaigns_root(&app)?;
        let terrain_catalog = crate::terrain::read_terrain_catalog_at(&crate::terrain::terrain_catalog_path(&app)?);
        let app_emit = app.clone();
        let on_progress = move |phase: &str, done: usize, total: usize| {
            let _ = app_emit.emit("plan-progress", PlanProgress { phase: phase.to_string(), done, total });
        };
        let result = plan_next_session_at(&root, &id, &terrain_catalog, true, objects_enabled, &vocabulary, &footprint_guide, &on_progress)?;
        resolve_result_tiles(&app, &root, &id, &result);
        Ok(result)
    })
    .await
    .map_err(|e| format!("Session-plan task failed: {e}"))?
}

/// Pure heuristic: `pdf_extract` (see extract_module_text) only reads a PDF's
/// embedded text layer — it never does OCR. A scanned/image-only PDF (no
/// text layer at all) yields close to zero extracted characters regardless
/// of file size or page count, since that's pure raster image data. A file
/// that's clearly not a trivial stub (well past MIN_FILE_BYTES_TO_JUDGE) but
/// extracted almost nothing is a strong, low-false-positive signal of a scan
/// — deliberately an absolute floor rather than a chars-per-KB ratio, since
/// D&D modules are often art-heavy even when they DO have a real text layer,
/// which would make a ratio-based check flag plenty of legitimate documents.
/// Surfaced BEFORE the expensive chapterize Opus call runs on what would
/// otherwise be near-empty/garbled input — the same "cheap, deterministic,
/// pre-LLM warning" shape as coverage_concern/dropped_entity_names.
fn scanned_pdf_concern(file_bytes: u64, extracted_chars: usize) -> Option<String> {
    const MIN_FILE_BYTES_TO_JUDGE: u64 = 200_000; // 200KB -- too small a file to judge meaningfully either way
    const MIN_CHARS_FOR_A_REAL_DOCUMENT: usize = 500; // any real module of any length trivially exceeds this
    if file_bytes < MIN_FILE_BYTES_TO_JUDGE || extracted_chars >= MIN_CHARS_FOR_A_REAL_DOCUMENT {
        return None;
    }
    Some(format!(
        "This PDF extracted very little text ({extracted_chars} characters from a {}KB file) — it might be scanned images rather than a text-layer PDF, which this app can't OCR. If the chapter breakdown looks empty or garbled, that's likely why.",
        file_bytes / 1024
    ))
}

/// extract_module_text's return shape — text plus an optional pre-ingestion
/// warning (see scanned_pdf_concern), so the frontend can surface it right
/// when the file is picked, before spending a real ingestion call on it.
#[derive(Serialize, Clone, Debug)]
pub struct ExtractedModuleText {
    pub text: String,
    pub concern: Option<String>,
}

/// Reads a DM's own module/scenario file and returns its text. PDFs are text-
/// extracted (pure-Rust `pdf-extract`, no external binary); anything else is
/// read as UTF-8 text (.md/.txt, best-effort for other plain-text formats).
/// The file path comes from the OS file picker (@tauri-apps/plugin-dialog),
/// so it's whatever the DM chose, not something the app needs to sandbox.
#[tauri::command]
pub fn extract_module_text(path: String) -> Result<ExtractedModuleText, String> {
    let is_pdf = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);

    if is_pdf {
        let text = pdf_extract::extract_text(&path).map_err(|e| format!("Couldn't read PDF: {e}"))?;
        let file_bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let concern = scanned_pdf_concern(file_bytes, text.chars().count());
        Ok(ExtractedModuleText { text, concern })
    } else {
        let text = fs::read_to_string(&path).map_err(|e| format!("Couldn't read file: {e}"))?;
        Ok(ExtractedModuleText { text, concern: None })
    }
}

/// Chapterizes and imports a module's raw text (from extract_module_text) as
/// a NEW module, coexisting with any already imported — never replaces an
/// existing one. Runs a series of real `claude` calls, roughly one per
/// chapter (see chapterize_and_import_module_at), so this can take several
/// minutes for a long document; spawn_blocking keeps it off the async
/// runtime's worker threads.
#[tauri::command]
pub async fn chapterize_and_import_module(app: AppHandle, id: String, text: String) -> Result<ChapterizeImportResult, String> {
    tokio::task::spawn_blocking(move || {
        let root = campaigns_root(&app)?;
        let app_emit = app.clone();
        let on_progress = move |phase: &str, done: usize, total: usize| {
            let _ = app_emit.emit("ingest-progress", IngestProgress { phase: phase.to_string(), done, total });
        };
        chapterize_and_import_module_at(&root, &id, &text, &on_progress)
    })
    .await
    .map_err(|e| format!("Chapterize task failed: {e}"))?
}

/// One specific module's chapter list + which one is current — feeds the
/// Module dialog when a particular module is expanded. Empty chapters + None
/// current_id means that module id doesn't exist / nothing's imported yet.
#[tauri::command]
pub fn get_module_chapters(app: AppHandle, id: String, module_id: String) -> Result<ModuleChapters, String> {
    let (chapters, current_id) = get_module_chapters_at(&campaigns_root(&app)?, &id, &module_id)?;
    Ok(ModuleChapters { chapters, current_id })
}

/// Every imported module + which one is active — feeds the Module dialog's
/// top-level list.
#[tauri::command]
pub fn list_campaign_modules(app: AppHandle, id: String) -> Result<CampaignModules, String> {
    list_campaign_modules_at(&campaigns_root(&app)?, &id)
}

/// Switches which already-imported module is active — the dm-actions
/// `switchActiveModule` handler, or a manual "Set as active" click in the
/// Module dialog.
#[tauri::command]
pub fn set_active_module(app: AppHandle, id: String, module_id: String) -> Result<(), String> {
    set_active_module_at(&campaigns_root(&app)?, &id, &module_id)
}

/// The campaign's overarching lore plus the active module's own arc plan,
/// concatenated — feeds the Module dialog's "plan" display and the periodic
/// turn-prompt check-in (see dmPrompt.ts/DMConsolePage.tsx's
/// campaignPlanRef/dueForPlanCheck, which just treat this as an opaque
/// string). Empty string if neither exists yet.
#[tauri::command]
pub fn read_campaign_plan(app: AppHandle, id: String) -> Result<String, String> {
    let dir = campaign_dir(&app, &id)?;
    let lore = read_optional(&dir.join("memory").join("campaign_lore.md"));
    let module_plan = read_optional(&dir.join("active_module").join("plan.md"));
    let mut parts = vec![];
    if !lore.trim().is_empty() {
        parts.push(format!("## Campaign lore & framing\n{}", lore.trim()));
    }
    if !module_plan.trim().is_empty() {
        parts.push(format!("## Active module's arc plan\n{}", module_plan.trim()));
    }
    Ok(parts.join("\n\n"))
}

/// Sets the current chapter within the active module — called automatically
/// when a turn's dm-actions block includes `advanceToChapter`, or manually
/// from the Module dialog.
#[tauri::command]
pub fn set_current_chapter(app: AppHandle, id: String, chapter_id: String) -> Result<(), String> {
    advance_chapter_at(&campaigns_root(&app)?, &id, &chapter_id)
}

/// Trims a resolved section out of `module_id`'s current chapter working
/// copy — see a turn's dm-actions `resolveChapterSection` key. `module_id`
/// must be whatever module was active at the moment the dm-action was
/// dispatched (see trim_resolved_chapter_section_at's doc comment for why).
/// Runs a real LLM call (sonnet), so the frontend deliberately does NOT await
/// this — it fires and forgets, ready by the next turn rather than blocking
/// the current one.
#[tauri::command]
pub async fn resolve_chapter_section(app: AppHandle, id: String, module_id: String, description: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let root = campaigns_root(&app)?;
        trim_resolved_chapter_section_at(&root, &id, &module_id, &description)
    })
    .await
    .map_err(|e| format!("Chapter trim task failed: {e}"))?
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
            lore: String::new(),
        }
    }

    fn heading(h: &str, s: &str) -> ChapterHeading {
        ChapterHeading { title: h.into(), heading: h.into(), summary: s.into() }
    }

    /// The repair is deterministic and always ran on the way out, so a width
    /// problem should never have been worth a model call. Guards the ordering:
    /// once normalized, a ragged spec must raise no width/Grid-header issue —
    /// which is also what demotes the remaining issues to "features-only" and
    /// routes the retry down the cheap caption branch.
    #[test]
    fn normalizing_before_validating_removes_the_width_issues_entirely() {
        // Match the two STRUCTURAL messages precisely — "actually" also occurs
        // in the Features boilerplate ("a cell you actually drew"), which
        // normalize is not responsible for and prune handles separately.
        let structural = |i: &String| i.contains("not all the same width") || i.contains("the map block you drew is actually");
        let raw = validate_map_spec(BROKEN_BARROOM_SPEC);
        assert!(raw.iter().any(structural), "fixture must really have a width/header problem: {raw:?}");
        let fixed = validate_map_spec(&normalize_map_spec(BROKEN_BARROOM_SPEC));
        assert!(!fixed.iter().any(structural), "normalize must settle width + Grid header without a retry: {fixed:?}");
        // And with those gone, what's left is Features-only — which is what
        // routes the retry down the cheap caption branch instead of a redraw.
        assert!(all_features_only_issues(&fixed), "remaining issues should be features-only: {fixed:?}");
    }

    /// The floor material is rolled, so a tavern isn't the same board every
    /// session — but only the MATERIAL. Which brick or which plank is still
    /// the ranking's job, not the die's.
    #[test]
    fn roll_floor_query_swaps_material_on_a_high_roll_only() {
        // Brick on the low rolls, wood from 14 up — both reachable, brick favoured.
        assert_eq!(roll_floor_query("tavern", 1), Some("brick floor"));
        assert_eq!(roll_floor_query("tavern", 13), Some("brick floor"));
        assert_eq!(roll_floor_query("tavern", 14), Some("wooden flooring"));
        assert_eq!(roll_floor_query("tavern", 20), Some("wooden flooring"));
        // Neither branch may be unreachable — that was the bug being fixed.
        let rolls: Vec<&str> = (1..=20).filter_map(|r| roll_floor_query("tavern", r)).collect();
        assert!(rolls.contains(&"brick floor") && rolls.contains(&"wooden flooring"), "{rolls:?}");
        // A biome with no alternate ignores the roll entirely.
        assert_eq!(roll_floor_query("snow", 1), roll_floor_query("snow", 20));
        // And "dungeon" still opts out of the whole ground swap.
        assert_eq!(roll_floor_query("dungeon", 20), None);
    }

    /// Snow and volcanic must NOT gain an alternate on autopilot: the only
    /// candidates are ice and lava, which change how the map plays while the
    /// Tactics prose — written before the floor is rolled — says nothing of it.
    #[test]
    fn floor_alternates_stay_cosmetic_and_skip_the_hazard_biomes() {
        for biome in ["snow", "volcanic"] {
            assert!(!BIOME_FLOOR_ALTS.iter().any(|(b, _, _)| *b == biome), "{biome} must not roll: its alternate would change the tactics");
        }
        for (biome, alt, at) in BIOME_FLOOR_ALTS {
            assert!(BIOME_FLOORS.iter().any(|(b, _)| b == biome), "alternate for unknown biome {biome:?}");
            assert!((2..=20).contains(at), "{biome}: a threshold outside 2..=20 makes one branch unreachable");
            assert_ne!(Some(*alt), biome_floor_query(biome), "{biome}: alternate is identical to the primary");
        }
    }

    /// A query whose HEAD token is the bare word "floor" is a TRAP: it takes
    /// the 1000x exact-match tier, and `Brick_Floor_*` is `!Core_Settlements`
    /// (biome affinity always 1.0) while a biome's own texture may be scored
    /// 0.15 for being off-biome — so brick wins and nobody notices. It cost
    /// tavern, cave and underdark their ground.
    ///
    /// Whether it actually fires depends on the biome's affinity, not on the
    /// wording, so this can't be decided from the string. Each survivor below
    /// was PROBED against the live manifest; anything new must be probed too
    /// rather than reasoned about.
    #[test]
    fn floor_ending_queries_are_limited_to_ones_probed_against_the_real_catalog() {
        const PROBED: &[(&str, &str)] = &[
            ("tavern", "brick floor"),  // brick IS the intent here
            ("forest", "forest floor"), // → Forest_Floor_Twigs_*; Woodlands affinity carries it
        ];
        let queries = BIOME_FLOORS.iter().map(|(b, q)| (*b, *q)).chain(BIOME_FLOOR_ALTS.iter().map(|(b, q, _)| (*b, *q)));
        for (biome, q) in queries {
            if q.split_whitespace().last() == Some("floor") {
                assert!(PROBED.contains(&(biome, q)), "{biome}: query {q:?} ends in \"floor\" — probe it against the real catalog and add it to PROBED, or it may silently resolve to brick");
            }
        }
    }

    /// The whole point of the rewrite: the flame lands on the sprite's own
    /// firebox, which the artist centred, so the surrounding walls must not
    /// move it. The old version pushed it away from whatever it backed onto
    /// and landed it in a corner of the footprint, off the ash bed.
    #[test]
    fn firebox_rect_ignores_the_walls_the_hearth_backs_onto() {
        // Same 2x2 hearth, once in open floor and once jammed into a corner.
        let open = firebox_rect(&[(3, 1), (4, 1), (3, 2), (4, 2)], true);
        let cornered = firebox_rect(&[(0, 0), (1, 0), (0, 1), (1, 1)], true);
        // Identical placement relative to the footprint's own origin.
        assert!((open[0] - 3.0 - cornered[0]).abs() < 1e-3, "x must not depend on surroundings: {open:?} vs {cornered:?}");
        assert!((open[1] - 1.0 - cornered[1]).abs() < 1e-3, "y must not depend on surroundings: {open:?} vs {cornered:?}");
        // And it sits ON the ash bed: centred vertically, a touch right of
        // centre horizontally, well inside the 2x2 stone surround.
        let (cx, cy) = (open[0] + open[2] / 2.0, open[1] + open[3] / 2.0);
        assert!((cx - (3.0 + 0.545 * 2.0)).abs() < 1e-3, "x centre {cx}");
        assert!((cy - (1.0 + 1.0)).abs() < 1e-3, "y centre {cy}");
        assert!(open[2] < 1.0 && open[3] < 1.0, "flame must stay inside the firebox, not fill the footprint: {open:?}");
    }

    #[test]
    fn firebox_rect_fills_a_brazier_bowl() {
        // A brazier is a bowl seen top-down — flame centred, and much larger
        // relative to the tile than a hearth's, because it fills the bowl.
        let [x, y, w, h] = firebox_rect(&[(2, 1)], false);
        assert!((w - 0.62).abs() < 1e-3 && (h - 0.62).abs() < 1e-3);
        assert!((x - (2.0 + (1.0 - 0.62) / 2.0)).abs() < 1e-3);
        assert!((y - (1.0 + (1.0 - 0.62) / 2.0)).abs() < 1e-3);
    }

    #[test]
    fn write_atomic_creates_a_new_file_and_leaves_no_tmp_file_behind() {
        let root = Scratch::new("atomic-new");
        let path = root.0.join("fresh.md");
        write_atomic(&path, "hello").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello");
        assert!(!path.with_file_name("fresh.md.tmp").exists());
    }

    #[test]
    fn write_atomic_replaces_existing_content_and_leaves_no_tmp_file_behind() {
        let root = Scratch::new("atomic-replace");
        let path = root.0.join("existing.md");
        fs::write(&path, "old content").unwrap();
        write_atomic(&path, "new content").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new content");
        assert!(!path.with_file_name("existing.md.tmp").exists());
    }

    #[test]
    fn backup_before_overwrite_copies_existing_content_to_a_bak_file() {
        let root = Scratch::new("backup-existing");
        let path = root.0.join("entities.md");
        fs::write(&path, "- **Someone:** original description.").unwrap();
        backup_before_overwrite(&path);
        let bak = fs::read_to_string(path.with_file_name("entities.md.bak")).unwrap();
        assert!(bak.contains("original description."));
    }

    #[test]
    fn backup_before_overwrite_is_a_noop_when_source_file_does_not_exist() {
        let root = Scratch::new("backup-missing");
        let path = root.0.join("never_written.md");
        backup_before_overwrite(&path); // should not panic
        assert!(!path.with_file_name("never_written.md.bak").exists());
    }

    #[test]
    fn compact_memory_backs_up_pre_compaction_content_before_overwriting() {
        let root = Scratch::new("compact-backup");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        let path = root.0.join(&meta.id).join("memory").join("MEMORY.md");
        let pre_compaction = "# Campaign Memory\n\nSomething irreplaceable that must survive in the backup.";
        fs::write(&path, pre_compaction).unwrap();

        // Exercise the same overwrite compact_memory_if_needed_at performs,
        // without needing a live Claude call: backup then atomic write.
        backup_before_overwrite(&path);
        write_atomic(&path, "# Campaign Memory\n\nCompacted.").unwrap();

        let bak = fs::read_to_string(path.with_file_name("MEMORY.md.bak")).unwrap();
        assert!(bak.contains("Something irreplaceable that must survive in the backup."));
    }

    /// The real collision from a live campaign: Opus handed `male-gb-2` to
    /// both Father Carrow and Tomas, and `female-us-2` to both Mera and Yara.
    /// Two NPCs sharing a voice is silent until they share a scene.
    #[test]
    fn machine_chosen_voices_never_collide_with_an_existing_npc() {
        let root = Scratch::new("voice_collide");
        create_campaign_at(&root.0, &intake("Fogreach")).unwrap();

        set_npc_voice_at(&root.0, "fogreach", "Father Carrow", "male-gb-2", None, None, true).unwrap();
        set_npc_voice_at(&root.0, "fogreach", "Tomas", "male-gb-2", None, None, true).unwrap();
        set_npc_voice_at(&root.0, "fogreach", "Mera", "female-us-2", None, None, true).unwrap();
        set_npc_voice_at(&root.0, "fogreach", "Yara", "female-us-2", None, None, true).unwrap();

        let map = read_npc_voices_at(&root.0, "fogreach");
        assert_eq!(map["father carrow"].voice_id, "male-gb-2", "first claim keeps what it asked for");
        assert_ne!(map["tomas"].voice_id, "male-gb-2", "second must move off the taken id");
        assert!(map["tomas"].voice_id.starts_with("male-gb-"), "and must stay in its gender/accent bucket");
        assert_eq!(map["mera"].voice_id, "female-us-2");
        assert_ne!(map["yara"].voice_id, "female-us-2");
        assert!(map["yara"].voice_id.starts_with("female-us-"));
    }

    #[test]
    fn dedupe_never_steals_the_narrator_voice_and_is_stable_on_resend() {
        let root = Scratch::new("voice_narr");
        create_campaign_at(&root.0, &intake("Fogreach")).unwrap();
        set_npc_voice_at(&root.0, "fogreach", NARRATOR_VOICE_KEY, "male-gb-1", None, None, false).unwrap();

        // An NPC asking for the narrator's exact voice gets moved off it.
        set_npc_voice_at(&root.0, "fogreach", "Carrow", "male-gb-1", None, None, true).unwrap();
        let first = read_npc_voices_at(&root.0, "fogreach")["carrow"].voice_id.clone();
        assert_ne!(first, "male-gb-1");

        // Re-sending the same NPC's own assignment must not shuffle them onward
        // every time — their current voice is not a collision with themselves.
        set_npc_voice_at(&root.0, "fogreach", "Carrow", &first, None, None, true).unwrap();
        assert_eq!(read_npc_voices_at(&root.0, "fogreach")["carrow"].voice_id, first);
    }

    #[test]
    fn manual_override_may_deliberately_duplicate_a_voice() {
        let root = Scratch::new("voice_manual");
        create_campaign_at(&root.0, &intake("Fogreach")).unwrap();
        set_npc_voice_at(&root.0, "fogreach", "Carrow", "male-gb-2", None, None, true).unwrap();
        // enforce_unique = false: a human picking a duplicate said what they meant.
        set_npc_voice_at(&root.0, "fogreach", "Tomas", "male-gb-2", None, None, false).unwrap();
        assert_eq!(read_npc_voices_at(&root.0, "fogreach")["tomas"].voice_id, "male-gb-2");
    }

    #[test]
    fn sibling_voice_ids_stay_in_bucket_and_exclude_the_narrator() {
        let gb_males = crate::tts::sibling_voice_ids("male-gb-2");
        assert!(gb_males.contains(&"male-gb-1") && gb_males.contains(&"male-gb-4"));
        assert!(gb_males.iter().all(|id| id.starts_with("male-gb-")));
        assert!(!gb_males.contains(&"narrator"), "the narration's voice is never an NPC alternative");
        assert!(!gb_males.contains(&"male-us-1"), "a different accent is a different bucket");
        assert!(crate::tts::sibling_voice_ids("narrator").is_empty());
        assert!(crate::tts::sibling_voice_ids("nonsense").is_empty());
    }

    /// The bug this whole mechanism exists for: a campaign created before a
    /// rule change must still pick that change up. Simulates an OLD campaign by
    /// stripping the import line and the generated file, then asserts one load
    /// restores both.
    #[test]
    fn sync_dm_rules_upgrades_a_campaign_created_before_the_import_existed() {
        let root = Scratch::new("dm_rules_migrate");
        let meta = create_campaign_at(&root.0, &intake("Old Campaign")).unwrap();
        let dir = root.0.join(&meta.id);
        let claude_path = dir.join("CLAUDE.md");
        let rules_path = dir.join("memory").join("dm_rules.md");

        // Rewind to a pre-dm_rules campaign: no import line, no generated file,
        // plus a hand-edit of the kind the Notes dialog produces.
        let legacy = fs::read_to_string(&claude_path)
            .unwrap()
            .replace("@memory/dm_rules.md\n", "");
        fs::write(&claude_path, format!("{legacy}\n## My house rules\nCrits do max damage.\n")).unwrap();
        fs::remove_file(&rules_path).unwrap();
        assert!(!fs::read_to_string(&claude_path).unwrap().contains("@memory/dm_rules.md"));

        sync_dm_rules_at(&root.0, &meta.id).unwrap();

        let claude_md = fs::read_to_string(&claude_path).unwrap();
        assert!(claude_md.contains("@memory/dm_rules.md"), "old campaign must gain the import");
        assert!(claude_md.contains("Crits do max damage."), "the DM's own hand-edits must survive");
        let rules = fs::read_to_string(&rules_path).unwrap();
        assert!(rules.contains("[Ismark|male]"), "generated rules must carry the gender marker");
        assert!(rules.contains("supersedes"), "generated rules must claim precedence over a stale inline copy");
    }

    #[test]
    fn sync_dm_rules_is_idempotent_and_refreshes_stale_content() {
        let root = Scratch::new("dm_rules_idem");
        let meta = create_campaign_at(&root.0, &intake("Repeat")).unwrap();
        let dir = root.0.join(&meta.id);
        let rules_path = dir.join("memory").join("dm_rules.md");

        // A stale generated file from an older app version gets replaced wholesale.
        fs::write(&rules_path, "# ancient rules\n").unwrap();
        for _ in 0..3 {
            sync_dm_rules_at(&root.0, &meta.id).unwrap();
        }

        let claude_md = fs::read_to_string(dir.join("CLAUDE.md")).unwrap();
        assert_eq!(claude_md.matches("@memory/dm_rules.md").count(), 1, "import must not accumulate");
        let rules = fs::read_to_string(&rules_path).unwrap();
        assert!(!rules.contains("ancient rules"), "stale generated rules must be overwritten");
        assert_eq!(rules, DM_RULES);
    }

    #[test]
    fn read_battle_mode_at_defaults_to_theater_when_unset() {
        let root = Scratch::new("battle_mode_default");
        let meta = create_campaign_at(&root.0, &intake("No Mode Yet")).unwrap();
        // No battle_mode.txt is ever written by create_campaign_at, so an
        // existing campaign that predates this feature reads as theater.
        assert_eq!(read_battle_mode_at(&root.0, &meta.id), "theater");
    }

    /// The real spec the generator shipped for "Barroom Brawl" — every problem
    /// below was live on disk and rendered/printed as-is.
    const BROKEN_BARROOM_SPEC: &str = "# Barroom Brawl\nGrid: 16x12, 5 ft squares. Columns A onward left-to-right, rows 1 onward top-to-bottom.\nLegend: . floor  # wall  + door\nMap:\n################\n#............#\n#.+.........+#\n#............#\n#..^..=..=...#\n#..=..=..=...#\n#..^..=..=...#\n#..=..=..=...#\n#..^..=..=...#\n#..=..=..=...#\n#..^..=..=...#\n#.+.........+#\n################\nFeatures:\n- Bar at A2\n- Pillars at C4, G4\n- Fire pit at E7\nTactics:\n- The doors at A12 and P12 are entry points.";

    #[test]
    fn validate_map_spec_catches_every_flaw_in_the_shipped_barroom_map() {
        let issues = validate_map_spec(BROKEN_BARROOM_SPEC);
        let all = issues.join("\n");
        // Ragged rows: the walls are 16 wide, every interior row is 14.
        assert!(all.contains("not all the same width"), "{all}");
        // The header claims 16x12 over a grid that's really 16x13.
        assert!(all.contains("says 16x12"), "{all}");
        // All four `+` sit two squares inside the wall, on open floor.
        assert!(all.contains("C3 is standing on open floor"), "{all}");
        assert!(all.contains("M3 is standing on open floor"), "{all}");
        assert!(all.contains("C12 is standing on open floor"), "{all}");
        assert!(all.contains("M12 is standing on open floor"), "{all}");
        // "Bar at A2" — A2 is a wall; the bar was never drawn at all.
        assert!(all.contains("A2 contains `#` (a wall)"), "{all}");
        // "Pillars at C4/G4" and "Fire pit at E7" — plain floor, no `o`/`*`.
        assert!(all.contains("C4 contains `.` (plain floor)"), "{all}");
        assert!(all.contains("E7 contains `.` (plain floor)"), "{all}");
    }

    #[test]
    fn validate_map_spec_passes_a_sound_map() {
        // 10 wide x 10 tall, doors set into the top and left walls, and every
        // Features line pointing at a cell that really holds that code.
        let spec = "# Clean\nGrid: 10x10, 5 ft squares.\nLegend: . floor  # wall  + door  o pillar  = furniture\nMap:\n####+#####\n#........#\n#..o.....#\n#........#\n+........#\n#.....=..#\n#........#\n#........#\n#........#\n##########\nFeatures:\n- Pillar at D3\n- Door at E1\n- Table at G6\nTactics:\n- The door at E1 is the only way in.";
        assert_eq!(validate_map_spec(spec), Vec::<String>::new());
    }

    /// `=` is the only legend code for furniture. A Features line that says
    /// "Stool" but points at `^` (rubble) is drawing the wrong CHARACTER, not
    /// just the wrong cell — this is the semantic check on top of the
    /// existing "does this cell hold any object at all" one.
    #[test]
    fn validate_map_spec_flags_a_furniture_word_pointed_at_the_wrong_kind_of_object() {
        let spec = "# Rubble Test\nGrid: 10x10, 5 ft squares.\nLegend: . floor  # wall  ^ rubble\nMap:\n##########\n#........#\n#..^.....#\n#........#\n#........#\n#........#\n#........#\n#........#\n#........#\n##########\nFeatures:\n- Stool at D3\nTactics:\n- x";
        let all = validate_map_spec(spec).join("\n");
        assert!(all.contains("is furniture"), "{all}");
        assert!(all.contains("draw it with the `=` legend code, not `^`"), "{all}");
    }

    #[test]
    fn parse_object_line_reads_label_cell_and_footprint() {
        assert_eq!(
            parse_object_line("Round wooden dining table at D4 (2x2)"),
            Some(("Round wooden dining table".to_string(), 3, 3, 2, 2))
        );
        // Case-insensitive "at" and the "x" in the size suffix.
        assert_eq!(parse_object_line("Campfire AT C7 (1X1)"), Some(("Campfire".to_string(), 2, 6, 1, 1)));
    }

    #[test]
    fn parse_object_line_rejects_a_line_with_no_footprint_or_no_cell() {
        assert_eq!(parse_object_line("A table"), None);
        assert_eq!(parse_object_line("A table at D4"), None, "missing the (WxH) suffix");
        assert_eq!(parse_object_line("A table (2x2)"), None, "missing \" at \"");
    }

    #[test]
    fn validate_map_spec_passes_a_sound_map_with_objects() {
        let spec = "# Clean\nGrid: 10x10, 5 ft squares.\nLegend: . floor  # wall  + door  o pillar  = furniture\nMap:\n####+#####\n#........#\n#..o.....#\n#........#\n+........#\n#.....=..#\n#........#\n#........#\n#........#\n##########\nFeatures:\n- Pillar at D3\n- Door at E1\n- Table at G6\nObjects:\n- Small campfire at C7 (1x1)\n- Round rug at F8 (2x2)\nTactics:\n- x";
        assert_eq!(validate_map_spec(spec), Vec::<String>::new());
    }

    #[test]
    fn validate_map_spec_flags_every_kind_of_bad_objects_line() {
        let spec = "# Clean\nGrid: 10x10, 5 ft squares.\nLegend: . floor  # wall  + door  o pillar  = furniture\nMap:\n####+#####\n#........#\n#..o.....#\n#........#\n+........#\n#.....=..#\n#........#\n#........#\n#........#\n##########\nFeatures:\n- Pillar at D3\nObjects:\n- Wall torch at A1 (1x1)\n- Floating debris at Z9 (1x1)\n- Giant boulder at C7 (5x5)\n- a garbled line with no cell or size\nTactics:\n- x";
        let all = validate_map_spec(spec).join("\n");
        assert!(all.contains("Wall torch") && all.contains("`#` wall"), "{all}");
        assert!(all.contains("Floating debris") && all.contains("outside the"), "{all}");
        assert!(all.contains("Giant boulder") && all.contains("must both be whole numbers from 1 to 4"), "{all}");
        assert!(all.contains("doesn't parse"), "{all}");
    }

    /// The real spec the generator shipped for "Bar Fight" (test-campaign,
    /// 2026-07-17 live run): every Features line — the bar counter, the
    /// pillars, the tables, the stools, both doors — points at either the
    /// wrong row or a cell that never held the code the label claims. This
    /// is what taught the model to draw the room's furniture two rows off
    /// from where its own Features text described it.
    const BAR_FIGHT_SPEC: &str = "# Bar Fight\nGrid: 16x14, 5 ft squares. Columns A onward left-to-right, rows 1 onward top-to-bottom.\nLegend: . floor  # wall  + door  ~ water  o pillar  ^ difficult terrain (rubble)  = furniture/altar  T tree/foliage  _ stairs  * hazard (fire/brazier)  (space) = empty/void outside the map\nMap:\n################\n#..............#\n#=.===.===.===.#\n#..............#\n#....=....=....#\n#....==....==..+\n#....==....==..#\n#....^^....^^..#\n#....=....=....#\n#....==....==..#\n#....==....==..#\n#....^^....^^..#\n#....=....=....#\n#####+##########\nFeatures:\n- Bar counter at B2-K2 (the barkeep works the open floor at row 1 behind it)\n- Pillars at B5, D5, F5, H5, J5, L5, N5, P5\n- Tables at B7-C8, E7-F8, H7-I8, K7-L8, N7-O8\n- Stools at B10, D10, F10, H10, J10, L10, N10, P10\n- Broken bottles at G11-H11\n- Side door at A13\n- Main entrance at R13\nTactics:\n- x";

    #[test]
    fn prune_invalid_features_drops_every_line_the_model_never_actually_fixed() {
        let pruned = prune_invalid_features(BAR_FIGHT_SPEC);
        assert!(split_spec_grid(&pruned).is_some(), "pruning must not corrupt the grid: {pruned}");
        assert!(!pruned.contains("Bar counter at"), "{pruned}");
        assert!(!pruned.contains("Pillars at"), "{pruned}");
        assert!(!pruned.contains("Tables at"), "{pruned}");
        assert!(!pruned.contains("Stools at"), "{pruned}");
        assert!(!pruned.contains("Broken bottles at"), "{pruned}");
        assert!(!pruned.contains("Side door at"), "{pruned}");
        assert!(!pruned.contains("Main entrance at"), "{pruned}");
        // The Features header itself, the Map block, and Tactics survive —
        // pruning only removes bullets that fail validation, not sections.
        assert!(pruned.contains("Features:\n"), "{pruned}");
        assert!(pruned.contains("#=.===.===.===.#"), "{pruned}");
        assert!(pruned.contains("Tactics:\n- x"), "{pruned}");
    }

    #[test]
    fn prune_invalid_features_keeps_a_line_that_actually_checks_out() {
        let spec = "# Mixed\nGrid: 10x10, 5 ft squares.\nLegend: . floor  # wall  ^ rubble  = furniture\nMap:\n##########\n#........#\n#..^.....#\n#........#\n#........#\n#.....=..#\n#........#\n#........#\n#........#\n##########\nFeatures:\n- Stool at D3\n- Table at G6\nTactics:\n- x";
        let pruned = prune_invalid_features(spec);
        // "Stool at D3" is wrong (D3 is rubble) and gets dropped.
        assert!(!pruned.contains("Stool at"), "{pruned}");
        // "Table at G6" is correct (G6 really is `=`) and survives untouched.
        assert!(pruned.contains("Table at G6"), "{pruned}");
    }

    /// The exact live bug (test-campaign "Watch Intervention", 2026-07-17):
    /// the FIRST attempt copied the worked example verbatim — 1 issue, just
    /// the copy flag itself — and every retry that followed had MORE issues
    /// than that (a genuine attempt starts from nothing and racks up real
    /// mistakes), so nothing could ever beat it and the literal reference map
    /// shipped under a new title. A copy must never be eligible at all,
    /// whatever its own issue count, including on the very first attempt.
    #[test]
    fn fold_best_real_map_attempt_never_lets_a_copy_win_even_as_the_first_attempt() {
        let mut best = fold_best_real_map_attempt(None, "copied verbatim".into(), 1, true);
        assert_eq!(best, None, "a copy must never become best, even starting from nothing");
        // A genuine retry with WORSE issue count than the copy still wins —
        // any real attempt beats a copy outright.
        best = fold_best_real_map_attempt(best, "a real, imperfect room".into(), 9, false);
        assert_eq!(best, Some(("a real, imperfect room".to_string(), 9)));
        // A second copy can't unseat the real attempt already in hand.
        best = fold_best_real_map_attempt(best, "copied again".into(), 0, true);
        assert_eq!(best, Some(("a real, imperfect room".to_string(), 9)));
    }

    #[test]
    fn fold_best_real_map_attempt_prefers_fewer_issues_between_two_genuine_attempts() {
        let best = fold_best_real_map_attempt(None, "first try".into(), 5, false);
        // Worse doesn't replace better...
        let same = fold_best_real_map_attempt(best.clone(), "worse retry".into(), 8, false);
        assert_eq!(same, best);
        // ...but strictly better does.
        let improved = fold_best_real_map_attempt(best, "better retry".into(), 2, false);
        assert_eq!(improved, Some(("better retry".to_string(), 2)));
    }

    #[test]
    fn fold_best_real_map_attempt_returns_none_when_every_attempt_copies() {
        let mut best = fold_best_real_map_attempt(None, "copy 1".into(), 1, true);
        best = fold_best_real_map_attempt(best, "copy 2".into(), 1, true);
        // generate_one_map_spec falls back to the first attempt as a last
        // resort in this case — None here is what triggers that fallback.
        assert_eq!(best, None);
    }

    /// Pins the discriminator against validate_map_spec's REAL output on a
    /// spec with both kinds of problem, so a wording change to either
    /// function that breaks the classification fails a test instead of
    /// silently routing a structurally-broken grid into the narrow
    /// "just fix the labels" retry.
    #[test]
    fn all_features_only_issues_distinguishes_grid_problems_from_features_problems() {
        // Ragged rows (grid problem) AND a Features line pointing at floor —
        // BROKEN_BARROOM_SPEC has both.
        let mixed = validate_map_spec(BROKEN_BARROOM_SPEC);
        assert!(!mixed.is_empty());
        assert!(!all_features_only_issues(&mixed), "{mixed:?}");

        // A sound grid with ONLY a bad Features line — nothing structurally
        // wrong with the Map: block itself.
        let features_only_spec = "# X\nGrid: 10x10, 5 ft squares.\nLegend: . floor  # wall  = furniture\nMap:\n##########\n#........#\n#........#\n#........#\n#........#\n#....=...#\n#........#\n#........#\n#........#\n##########\nFeatures:\n- Bar at B2\nTactics:\n- x";
        let features_only = validate_map_spec(features_only_spec);
        assert!(!features_only.is_empty());
        assert!(all_features_only_issues(&features_only), "{features_only:?}");

        // No issues at all is a different stopping condition, not this one.
        assert!(!all_features_only_issues(&[]));
    }

    #[test]
    fn build_map_judge_prompt_shows_every_candidate_and_asks_for_a_numbered_verdict() {
        let candidates = vec!["# Room One\nMap:\n#..#".to_string(), "# Room Two\nMap:\n#..#".to_string(), "# Room Three\nMap:\n#..#".to_string()];
        let prompt = build_map_judge_prompt(&candidates);
        assert!(prompt.contains("Room One"), "{prompt}");
        assert!(prompt.contains("Room Two"), "{prompt}");
        assert!(prompt.contains("Room Three"), "{prompt}");
        assert!(prompt.contains("=== Candidate 1 ==="), "{prompt}");
        assert!(prompt.contains("=== Candidate 3 ==="), "{prompt}");
        // The exact output contract parse_judge_choice depends on.
        assert!(prompt.contains("\"Best: 1\""), "{prompt}");
        assert!(prompt.contains("\"Best: 3\""), "{prompt}");
    }

    #[test]
    fn parse_judge_choice_reads_a_bare_verdict_line() {
        assert_eq!(parse_judge_choice("Room 2 has the strongest layout.\n\nBest: 2", 3), Some(1));
    }

    #[test]
    fn parse_judge_choice_is_case_insensitive_and_ignores_trailing_punctuation() {
        assert_eq!(parse_judge_choice("best: 3.", 3), Some(2));
    }

    #[test]
    fn parse_judge_choice_uses_the_last_occurrence_so_a_restated_rubric_cant_be_mistaken_for_the_verdict() {
        // A reply that echoes "judge them, pick the Best: option" earlier and
        // gives its real verdict at the end must read the real verdict.
        let reply = "The rubric says to pick the Best: candidate by layout quality.\n\nBest: 1";
        assert_eq!(parse_judge_choice(reply, 3), Some(0));
    }

    #[test]
    fn parse_judge_choice_rejects_an_out_of_range_or_missing_verdict() {
        assert_eq!(parse_judge_choice("Best: 5", 3), None);
        assert_eq!(parse_judge_choice("I like the second one best.", 3), None);
    }

    #[test]
    fn normalize_map_spec_squares_ragged_rows_and_rewrites_the_grid_header() {
        let out = normalize_map_spec(BROKEN_BARROOM_SPEC);
        let (_, rows, _) = split_spec_grid(&out).unwrap();
        // Eleven rows were 14 wide and two stray wall rows were 16, so the grid
        // snaps to 14 — the two long walls lose their overhang instead of the
        // whole map gaining a 2-cell void stripe down the side of the print.
        assert!(rows.iter().all(|r| r.chars().count() == 14), "{rows:?}");
        assert_eq!(rows[0], "##############");
        // The room itself survives the snap intact — except its four doors,
        // which validate_map_spec's own test already established are all
        // floating two squares inside the wall on open floor. normalize_map_spec
        // now demotes a door that isn't actually set into a wall, so both rows
        // that had one come out as plain floor instead.
        assert_eq!(rows[2], "#............#");
        assert_eq!(rows[11], "#............#");
        // ...and the header now tells the truth about the grid underneath it,
        // which is what the DM's cell coordinates are resolved against.
        assert!(out.contains("Grid: 14x13, 5 ft squares."), "{out}");
        assert!(!out.contains("16x12"), "{out}");
        // Normalizing is idempotent and leaves an already-sound map untouched.
        assert_eq!(normalize_map_spec(&out), out);
    }

    #[test]
    fn modal_row_width_picks_the_width_most_rows_agree_on() {
        let rows: Vec<String> = vec!["####".into(), "#..#".into(), "#..#".into(), "######".into()];
        assert_eq!(modal_row_width(&rows), 4);
        // A tie goes to the wider width, so the repair truncates as little as possible.
        let tie: Vec<String> = vec!["####".into(), "######".into()];
        assert_eq!(modal_row_width(&tie), 6);
    }

    #[test]
    fn normalize_map_spec_scrubs_characters_that_arent_legend_codes() {
        let spec = "# X\nGrid: 4x2, 5 ft squares.\nMap:\n#!@#\n#.Z#\nFeatures:\n-";
        let out = normalize_map_spec(spec);
        let (_, rows, _) = split_spec_grid(&out).unwrap();
        // Junk becomes plain floor rather than reaching the renderer.
        assert_eq!(rows, vec!["#..#".to_string(), "#..#".to_string()]);
    }

    /// The real spec the generator shipped for "Bar Fight" on a later run
    /// (test-campaign, 2026-07-17): a door two cells deep in open floor, no
    /// `#` on any side — the retry never fixed it. normalize_map_spec must
    /// demote it to plain floor rather than shipping a door nobody can walk
    /// through a wall to reach.
    #[test]
    fn normalize_map_spec_demotes_a_door_that_isnt_set_into_a_wall() {
        let spec = "# X\nGrid: 5x5, 5 ft squares.\nMap:\n#####\n#...#\n#.+.#\n#...#\n#####\nFeatures:\n-";
        let out = normalize_map_spec(spec);
        let (_, rows, _) = split_spec_grid(&out).unwrap();
        assert_eq!(rows[2], "#...#", "the floating door should have been demoted to floor");
    }

    #[test]
    fn normalize_map_spec_leaves_a_real_door_alone() {
        let spec = "# X\nGrid: 5x5, 5 ft squares.\nMap:\n##+##\n#...#\n#...#\n#...#\n#####\nFeatures:\n-";
        let out = normalize_map_spec(spec);
        let (_, rows, _) = split_spec_grid(&out).unwrap();
        assert_eq!(rows[0], "##+##", "a door genuinely set into a wall must survive untouched");
    }

    #[test]
    fn door_in_wall_accepts_a_door_set_into_a_wall_and_rejects_a_floating_one() {
        let rows: Vec<String> = vec!["###".into(), "#+#".into(), "#.#".into()];
        // `+` at B2 has `#` left and right — a real doorway.
        assert!(door_in_wall(&rows, 1, 1));
        let floating: Vec<String> = vec!["...".into(), ".+.".into(), "...".into()];
        assert!(!door_in_wall(&floating, 1, 1));
    }

    #[test]
    fn column_label_and_parse_cell_ref_round_trip() {
        for i in [0usize, 1, 25, 26, 27, 51] {
            let label = column_label(i);
            let (col, row) = parse_cell_ref(&format!("{label}3")).unwrap();
            assert_eq!(col, i, "label {label}");
            assert_eq!(row, 2);
        }
        assert_eq!(parse_cell_ref("A2"), Some((0, 1)));
        assert_eq!(parse_cell_ref("M12"), Some((12, 11)));
        // Not cell refs.
        assert_eq!(parse_cell_ref("5"), None);
        assert_eq!(parse_cell_ref("at"), None);
        assert_eq!(parse_cell_ref("A0"), None);
    }

    const PLACEMENT_SPEC: &str = "# T\nGrid: 10x8, 5 ft squares.\nLegend: x\nMap:\n##########\n#........#\n#.======.#\n#........#\n#.o....o.#\n#........#\n#....*...#\n##########\nFeatures:\n- Bar counter at C3-H3\n- Pillars at C5, H5\n- Brazier at F7\n- Main entrance at A1\nObjects:\n- wooden crate at D6 (1x1)\nTactics:\n- x";

    #[test]
    fn parse_placements_groups_a_range_into_one_object_and_a_list_into_many() {
        let p = parse_placements(PLACEMENT_SPEC);
        // Bar counter (one contiguous 6-cell run), two separate pillars, one
        // brazier, one crate = 5. "Main entrance at A1" is a `#` wall cell —
        // not a resolvable object — so it contributes nothing.
        assert_eq!(p.len(), 5, "{p:#?}");

        let bar = p.iter().find(|x| x.label == "Bar counter").unwrap();
        assert_eq!((bar.w, bar.h), (6, 1));
        assert_eq!(bar.cells.len(), 6);

        // The two pillars are disconnected → two 1x1 placements, not one 6-wide box.
        let pillars: Vec<_> = p.iter().filter(|x| x.label == "Pillars").collect();
        assert_eq!(pillars.len(), 2);
        assert!(pillars.iter().all(|x| (x.w, x.h) == (1, 1)));

        let crate_p = p.iter().find(|x| x.label == "wooden crate").unwrap();
        assert_eq!(crate_p.cells, vec![(3, 5)]); // D6, 0-indexed
    }

    #[test]
    fn split_data_url_separates_media_and_base64() {
        assert_eq!(split_data_url("data:image/webp;base64,AAAA"), ("image/webp", "AAAA"));
        assert_eq!(split_data_url("data:image/png;base64,Qk0="), ("image/png", "Qk0="));
    }

    #[test]
    fn vision_message_asks_for_variety_across_repeated_slots() {
        let p = Placement { label: "Table".into(), cells: vec![(1, 1)], w: 1, h: 1 };
        let cand = crate::tile_library::TileCandidate { root: "r".into(), rel_path: "x".into(), w: 1, h: 1, data_url: "data:image/webp;base64,AA".into(), kind: crate::tile_library::ArtKind::Prop, luminance: None };
        let msg = build_vision_message(&[(&p, vec![cand])], "tavern");
        assert!(msg.to_lowercase().contains("variety"), "vision pick must ask for variety across repeated slots: {msg}");
    }

    /// The battlefield-design guidance distilled from DM map-design guides: a
    /// map is a set of terrain FUNCTIONS (sight-blocker / mover-blocker / half
    /// cover), reached by more than one approach, with exactly one set piece,
    /// in a room that isn't a bare rectangle. These live only in the FULL
    /// prompt — the streamlined one deliberately drops qualitative advice.
    #[test]
    fn full_prompt_teaches_the_battlefield_design_principles() {
        let p = battle_map_format_instructions_full(false, &[], &[]).to_lowercase();
        for needle in ["line of sight", "half cover", "two ways in", "choke point", "set piece", "moves"] {
            assert!(p.contains(needle), "full prompt must teach {needle:?}: {p}");
        }
        // A bare box is the dullest battlefield — the outer wall rule.
        assert!(p.contains("alcove") || p.contains("jog"), "full prompt must push an irregular outer wall: {p}");
    }

    /// Battlefield sizing: the guides top out around 12x12 "huge", so the cap
    /// stays generous but must not drift back to the old barn-sized 24x18.
    #[test]
    fn map_size_cap_stays_within_a_playable_battlefield() {
        assert!(MAP_MAX_COLS <= 16 && MAP_MAX_ROWS <= 14, "map cap drifted back up: {MAP_MAX_COLS}x{MAP_MAX_ROWS}");
        assert!(MAP_MIN_COLS <= MAP_MAX_COLS && MAP_MIN_ROWS <= MAP_MAX_ROWS);
    }

    #[test]
    fn full_prompt_warns_against_overcrowding_the_combat_map() {
        assert!(battle_map_format_instructions(false, false, &[], &[]).to_lowercase().contains("overcrowd"));
    }

    #[test]
    fn vision_chunks_stay_within_the_image_budget() {
        // 12 slots of 8 candidates each, cap 24 → chunks of 3 slots (24 imgs).
        assert_eq!(vision_chunks(&[8; 12], 24), vec![(0, 3), (3, 3), (6, 3), (9, 3)]);
        // A single slot bigger than the cap still gets its own chunk (never 0).
        assert_eq!(vision_chunks(&[30, 8], 24), vec![(0, 1), (1, 1)]);
        assert_eq!(vision_chunks(&[], 24), vec![]);
    }

    #[test]
    fn parse_vision_picks_reads_choices_and_tolerates_prose_and_zero() {
        // Prose around the JSON, 1-based choices, 0 = "none" → None, missing slot → None.
        let reply = "Sure! Here you go:\n{\"picks\":[{\"slot\":1,\"choice\":2},{\"slot\":2,\"choice\":0}]}\nThat's my pick.";
        assert_eq!(parse_vision_picks(reply, 3), vec![Some(1), None, None]);
        // Garbage → all None, never panics.
        assert_eq!(parse_vision_picks("no json here", 2), vec![None, None]);
    }

    /// The real failure that ate a map's fireplace, shelf AND keg in one go:
    /// the model answered with fractional indices, `as_u64` said None, and the
    /// whole chunk's picks were dropped without a trace.
    #[test]
    fn parse_vision_picks_rounds_a_fractional_choice_instead_of_dropping_it() {
        let reply = r#"{"picks":[{"slot":1,"choice":1.8},{"slot":2,"choice":2.5},{"slot":3,"choice":3.1}]}"#;
        // 1.8→2, 2.5→3, 3.1→3, then 1-based → 0-based.
        assert_eq!(parse_vision_picks(reply, 3), vec![Some(1), Some(2), Some(2)]);
        // A number sent as a string is the same intent, too.
        assert_eq!(parse_vision_picks(r#"{"picks":[{"slot":"1","choice":"2"}]}"#, 1), vec![Some(1)]);
        // Still never panics on nonsense, and 0 still means "none of these".
        assert_eq!(parse_vision_picks(r#"{"picks":[{"slot":1,"choice":0.2}]}"#, 1), vec![None]);
    }

    #[test]
    fn parse_placements_skips_structural_terrain_glyphs() {
        // A door/water/stairs feature must never become a catalog placement.
        let spec = "# T\nGrid: 10x8, 5 ft squares.\nLegend: x\nMap:\n####+#####\n#........#\n#..~~....#\n#........#\n#..._....#\n#........#\n#........#\n##########\nFeatures:\n- Door at E1\n- Pool at D3-E3\n- Stairs at D5\nTactics:\n- x";
        assert!(parse_placements(spec).is_empty(), "{:#?}", parse_placements(spec));
    }

    #[test]
    fn cell_refs_in_finds_every_cell_in_a_features_line_and_ignores_prose() {
        let refs: Vec<String> = cell_refs_in("Furniture at B5, D5, and F5 (5 ft)")
            .into_iter()
            .map(|(t, _, _)| t)
            .collect();
        assert_eq!(refs, vec!["B5", "D5", "F5"]);
    }

    #[test]
    fn cell_refs_in_expands_a_range_into_every_cell_it_spans() {
        // An en dash is what the model actually writes (seen live) — a bar
        // counter written "B2–K2" is ten cells, not two.
        let refs: Vec<String> = cell_refs_in("Bar counter at B2–K2 (10-cell run)")
            .into_iter()
            .map(|(t, _, _)| t)
            .collect();
        assert_eq!(refs, vec!["B2", "C2", "D2", "E2", "F2", "G2", "H2", "I2", "J2", "K2"]);

        // A range across both axes is the rectangle it spans: a 2x2 table.
        let block: Vec<String> = cell_refs_in("Table at D4-E5").into_iter().map(|(t, _, _)| t).collect();
        assert_eq!(block, vec!["D4", "D5", "E4", "E5"]);

        // A hyphen inside prose is not a range — both cells stand alone, and
        // nothing between them is invented.
        let prose: Vec<String> = cell_refs_in("Pillars at C4, G4 - both give cover")
            .into_iter()
            .map(|(t, _, _)| t)
            .collect();
        assert_eq!(prose, vec!["C4", "G4"]);
    }

    #[test]
    fn validate_map_spec_checks_the_inside_of_a_range_not_just_its_ends() {
        // The `=` run has a hole at D2, but B2 and F2 — the range's two ends —
        // are both `=`. Reading a range as just its endpoints missed the gap
        // entirely and reported a sound map.
        let spec = "# R\nGrid: 10x10, 5 ft squares.\nLegend: . floor  # wall  = furniture\nMap:\n##########\n#==.==...#\n#........#\n#........#\n#........#\n#........#\n#........#\n#........#\n#........#\n##########\nFeatures:\n- Bar at B2–F2\nTactics:\n- x";
        let issues = validate_map_spec(spec).join("\n");
        assert!(issues.contains("D2 contains `.` (plain floor)"), "{issues}");
        // ...and the cells that ARE furniture stay unreported.
        assert!(!issues.contains("B2 contains"), "{issues}");
        assert!(!issues.contains("E2 contains"), "{issues}");
    }

    #[test]
    fn set_then_read_battle_mode_roundtrips_each_mode() {
        let root = Scratch::new("battle_mode_roundtrip");
        let meta = create_campaign_at(&root.0, &intake("Modes")).unwrap();
        for mode in ["hex", "grid", "theater"] {
            let written = set_battle_mode_at(&root.0, &meta.id, mode).unwrap();
            assert_eq!(written, mode);
            assert_eq!(read_battle_mode_at(&root.0, &meta.id), mode);
        }
    }

    #[test]
    fn battle_mode_normalizes_unknown_values_to_theater() {
        let root = Scratch::new("battle_mode_bad");
        let meta = create_campaign_at(&root.0, &intake("Garbage")).unwrap();
        // A bad command arg is clamped on write...
        assert_eq!(set_battle_mode_at(&root.0, &meta.id, "isometric").unwrap(), "theater");
        // ...and a hand-corrupted file is clamped on read.
        fs::write(root.0.join(&meta.id).join("battle_mode.txt"), "  HEX-ish  ").unwrap();
        assert_eq!(read_battle_mode_at(&root.0, &meta.id), "theater");
    }

    #[test]
    fn battle_mode_tolerates_surrounding_whitespace() {
        let root = Scratch::new("battle_mode_ws");
        let meta = create_campaign_at(&root.0, &intake("Whitespace")).unwrap();
        fs::write(root.0.join(&meta.id).join("battle_mode.txt"), "  grid\n").unwrap();
        assert_eq!(read_battle_mode_at(&root.0, &meta.id), "grid");
    }

    /// The combat/positioning rules moved OUT of BASE_CLAUDE_MD (baked once at
    /// creation) and INTO DM_RULES (rewritten every load) specifically so
    /// existing campaigns pick up the three-mode battle-log protocol. If a
    /// refactor ever drops it from DM_RULES, old campaigns would silently lose
    /// combat tracking — so pin its presence here, and make sure the stale hex
    /// section is gone from BASE_CLAUDE_MD.
    const SAMPLE_MAP_SPEC: &str = "# The Goblin Warren\nGrid: 12x10, 5 ft squares. Columns A onward left-to-right, rows 1 onward top-to-bottom.\nLegend: . floor  # wall  + door  o pillar\nMap:\n############\n#..........#\n#..oo......#\n#..oo......#\n#..........#\n#..........#\n#........+.#\n#..........#\n#..........#\n############\nFeatures:\n- Pillars at C3/D3.\nTactics:\n- Ambush from behind the pillars at C3/D3; choke point at the door I7.";

    #[test]
    fn split_map_specs_splits_on_the_delimiter_and_skips_non_map_chunks() {
        let reply = format!("some preamble\n{d}\n{a}\n{d}\nnot a map, no grid here\n{d}\n{a}", d = MAP_SPEC_DELIMITER, a = SAMPLE_MAP_SPEC);
        let specs = split_map_specs(&reply);
        assert_eq!(specs.len(), 2, "preamble and the no-Map chunk must be dropped");
        assert!(specs[0].starts_with("# The Goblin Warren"));
    }

    #[test]
    fn map_title_and_summary_are_extracted_and_slugged() {
        assert_eq!(map_title(SAMPLE_MAP_SPEC), "The Goblin Warren");
        assert_eq!(slugify(&map_title(SAMPLE_MAP_SPEC)), "the-goblin-warren");
        assert!(map_summary(SAMPLE_MAP_SPEC).starts_with("12x10"));
        assert_eq!(map_title("no heading here\nMap:\n##"), "Battle Map");
    }

    #[test]
    fn writing_a_spec_then_reading_it_back_roundtrips_by_slug() {
        let root = Scratch::new("map-roundtrip");
        let meta = create_campaign_at(&root.0, &intake("Warrens")).unwrap();
        write_map_spec_at(&root.0, &meta.id, SAMPLE_MAP_SPEC).unwrap();
        let back = read_battle_map_at(&root.0, &meta.id, "the-goblin-warren").unwrap();
        assert!(back.contains("The Goblin Warren"));
        assert!(back.contains("############"));
    }

    #[test]
    fn read_battle_map_at_rejects_a_traversal_slug_and_a_missing_one() {
        let root = Scratch::new("map-bad-slug");
        let meta = create_campaign_at(&root.0, &intake("X")).unwrap();
        assert!(read_battle_map_at(&root.0, &meta.id, "../../secrets").unwrap().contains("not a valid map id"));
        assert!(read_battle_map_at(&root.0, &meta.id, "nope").unwrap().contains("No battle map found"));
    }

    #[test]
    fn rebuild_index_lists_one_line_per_map_and_drops_stale_entries() {
        let root = Scratch::new("map-index");
        let meta = create_campaign_at(&root.0, &intake("Dungeon")).unwrap();
        write_map_spec_at(&root.0, &meta.id, SAMPLE_MAP_SPEC).unwrap();
        write_map_spec_at(&root.0, &meta.id, "# The Flooded Vault\nGrid: 15x12, 5 ft squares.\nLegend: . floor  # wall\nMap:\n###\n#.#\n###\nFeatures:\n-\nTactics:\n-").unwrap();
        let metas = rebuild_battle_maps_index_at(&root.0, &meta.id).unwrap();
        assert_eq!(metas.len(), 2);
        let index = fs::read_to_string(battle_maps_dir(&root.0, &meta.id).join("index.md")).unwrap();
        assert_eq!(index.matches("- **").count(), 2, "one line per map, no dup");
        assert!(index.contains("**the-goblin-warren**"));
        assert!(index.contains("**the-flooded-vault**"));

        // Regenerating the SAME map (same title/slug) overwrites in place — the
        // index must not grow.
        write_map_spec_at(&root.0, &meta.id, SAMPLE_MAP_SPEC).unwrap();
        let metas2 = rebuild_battle_maps_index_at(&root.0, &meta.id).unwrap();
        assert_eq!(metas2.len(), 2, "re-saving an existing map must not add a new entry");
    }

    #[test]
    fn build_battle_maps_prompt_includes_content_and_hint() {
        let one = build_battle_maps_prompt("arc", "chapter goblins", "memory", "a bridge ambush", false, &[], &[]);
        assert!(one.contains("chapter goblins"));
        assert!(one.contains("a bridge ambush"));
        assert!(one.contains("ONE battle map"));
        assert!(one.contains(MAP_SPEC_DELIMITER));
    }

    #[test]
    fn force_map_title_replaces_an_existing_title_line() {
        let spec = "# Wrong Name\nGrid: 10x10, 5 ft squares.\nMap:\n##\n##\n";
        let out = force_map_title(spec, "Bridge Ambush");
        assert!(out.starts_with("# Bridge Ambush\n"));
        assert!(!out.contains("Wrong Name"));
    }

    #[test]
    fn force_map_title_prepends_a_title_when_none_exists() {
        let spec = "Grid: 10x10, 5 ft squares.\nMap:\n##\n##\n";
        let out = force_map_title(spec, "Bridge Ambush");
        assert!(out.starts_with("# Bridge Ambush\n"));
    }

    #[test]
    fn parse_plan_encounters_reads_tagged_numbered_lines_and_stops_at_next_heading() {
        let plan = "## Encounters\n1. [combat] Bridge Ambush — Goblins attack from cover.\n2. [non-combat] Merchant Haggling — Negotiate for supplies.\n3. Untagged Skirmish — defaults to combat.\n\n## Set up from what you own\n1. [combat] Should not be parsed — wrong section.\n";
        let encounters = parse_plan_encounters(plan);
        assert_eq!(encounters.len(), 3);
        assert_eq!(encounters[0], PlanEncounter { name: "Bridge Ambush".to_string(), description: "Goblins attack from cover.".to_string(), combat: true });
        assert_eq!(encounters[1].combat, false);
        assert_eq!(encounters[1].name, "Merchant Haggling");
        assert_eq!(encounters[2].combat, true, "an untagged line defaults to combat");
        assert_eq!(encounters[2].name, "Untagged Skirmish");
    }

    #[test]
    fn parse_plan_encounters_returns_empty_when_the_section_says_none_or_is_missing() {
        assert!(parse_plan_encounters("## Encounters\nNo encounters expected yet.\n\n## Set up from what you own\n...").is_empty());
        assert!(parse_plan_encounters("no encounters section at all here").is_empty());
    }

    /// Regression: live testing showed the model sometimes echoes the
    /// prompt's alternation literally instead of picking a tag — this must
    /// still parse cleanly (defaulting to combat, per the "missed fight-map
    /// is worse" rule) and, critically, must NOT leak the bracket junk into
    /// the encounter's name, since that name becomes the map's title/slug.
    #[test]
    fn parse_plan_encounters_strips_a_malformed_bracket_tag_instead_of_leaking_it_into_the_name() {
        let plan = "## Encounters\n1. [combat|non-combat] Watch Arrives at the Tavern — the guard responds.\n";
        let encounters = parse_plan_encounters(plan);
        assert_eq!(encounters.len(), 1);
        assert_eq!(encounters[0].name, "Watch Arrives at the Tavern");
        assert_eq!(encounters[0].combat, true, "an unrecognized tag defaults to combat");
    }

    #[test]
    fn new_campaigns_get_the_maps_index_import_and_a_seeded_index() {
        let root = Scratch::new("map-seed");
        let meta = create_campaign_at(&root.0, &intake("Fresh")).unwrap();
        let dir = root.0.join(&meta.id);
        assert!(dir.join("memory").join(BATTLE_MAPS_DIR).join("index.md").exists());
        let claude = fs::read_to_string(dir.join("CLAUDE.md")).unwrap();
        assert!(claude.contains("@memory/battle_maps/index.md"), "new campaigns import the maps index");
    }

    #[test]
    fn sync_battle_maps_index_at_upgrades_an_old_campaign_without_clobbering() {
        let root = Scratch::new("map-upgrade");
        let meta = create_campaign_at(&root.0, &intake("Old")).unwrap();
        // Simulate a pre-feature campaign: remove the import line and a saved map
        // must survive the sync.
        write_map_spec_at(&root.0, &meta.id, SAMPLE_MAP_SPEC).unwrap();
        let claude_path = root.0.join(&meta.id).join("CLAUDE.md");
        let stripped = fs::read_to_string(&claude_path).unwrap().replace("@memory/battle_maps/index.md\n", "");
        fs::write(&claude_path, &stripped).unwrap();

        sync_battle_maps_index_at(&root.0, &meta.id).unwrap();
        sync_battle_maps_index_at(&root.0, &meta.id).unwrap(); // idempotent

        let claude = fs::read_to_string(&claude_path).unwrap();
        assert_eq!(claude.matches("@memory/battle_maps/index.md").count(), 1, "import must not accumulate");
        assert!(read_battle_map_at(&root.0, &meta.id, "the-goblin-warren").unwrap().contains("The Goblin Warren"), "an existing map must survive the sync");
    }

    #[test]
    fn read_and_write_session_plan_round_trip_and_treat_blank_as_uncached() {
        let root = Scratch::new("session-plan-cache");
        let meta = create_campaign_at(&root.0, &intake("Cached")).unwrap();
        assert!(read_session_plan_at(&root.0, &meta.id).is_none(), "no plan generated yet");
        write_session_plan_at(&root.0, &meta.id, "## Encounters\n1. [combat] Test Fight — a fight.\n").unwrap();
        assert_eq!(read_session_plan_at(&root.0, &meta.id).unwrap(), "## Encounters\n1. [combat] Test Fight — a fight.\n");
    }

    /// The whole point of persisting the plan: a cache hit must never touch
    /// the LLM. plan_next_session_at(force: false) with a cache present
    /// short-circuits before ever building a prompt or calling
    /// ask_ingest_once — this test proves that by never configuring an
    /// ingestion provider (any accidental live call would error the test).
    #[test]
    fn plan_next_session_at_returns_cached_plan_and_owned_maps_without_any_llm_call() {
        let root = Scratch::new("plan-cache-hit");
        let meta = create_campaign_at(&root.0, &intake("Cached")).unwrap();
        write_session_plan_at(&root.0, &meta.id, "## Encounters\n1. [combat] Bridge Ambush — Goblins attack.\n").unwrap();
        write_map_spec_with_slug_at(&root.0, &meta.id, "bridge-ambush", SAMPLE_MAP_SPEC).unwrap();
        write_plan_manifest_at(
            &root.0, &meta.id,
            &[PlanMapEntry { slug: "bridge-ambush".to_string(), name: "Bridge Ambush".to_string(), description: "Goblins attack.".to_string() }],
        ).unwrap();

        let result = plan_next_session_at(&root.0, &meta.id, "", false, false, &[], &[], &no_progress).unwrap();
        assert!(result.plan_text.contains("Bridge Ambush"));
        assert_eq!(result.maps.len(), 1);
        assert_eq!(result.maps[0].slug, "bridge-ambush");
    }

    #[test]
    fn read_cached_session_plan_at_returns_none_when_nothing_is_cached_and_some_when_it_is() {
        let root = Scratch::new("read-cached-plan");
        let meta = create_campaign_at(&root.0, &intake("Cached")).unwrap();
        assert!(read_cached_session_plan_at(&root.0, &meta.id).is_none());

        write_session_plan_at(&root.0, &meta.id, "## Encounters\n1. [combat] Bridge Ambush — Goblins attack.\n").unwrap();
        write_map_spec_with_slug_at(&root.0, &meta.id, "bridge-ambush", SAMPLE_MAP_SPEC).unwrap();
        write_plan_manifest_at(
            &root.0, &meta.id,
            &[PlanMapEntry { slug: "bridge-ambush".to_string(), name: "Bridge Ambush".to_string(), description: "Goblins attack.".to_string() }],
        ).unwrap();

        let result = read_cached_session_plan_at(&root.0, &meta.id).unwrap();
        assert!(result.plan_text.contains("Bridge Ambush"));
        assert_eq!(result.maps.len(), 1);
        assert!(result.failed_maps.is_empty());
    }

    #[test]
    fn current_plan_owned_maps_at_skips_a_manifest_entry_whose_file_is_gone() {
        let root = Scratch::new("plan-owned-missing-file");
        let meta = create_campaign_at(&root.0, &intake("X")).unwrap();
        write_map_spec_with_slug_at(&root.0, &meta.id, "still-here", SAMPLE_MAP_SPEC).unwrap();
        write_plan_manifest_at(
            &root.0, &meta.id,
            &[
                PlanMapEntry { slug: "still-here".to_string(), name: "Still Here".to_string(), description: "x".to_string() },
                PlanMapEntry { slug: "hand-deleted".to_string(), name: "Hand Deleted".to_string(), description: "x".to_string() },
            ],
        ).unwrap();
        let maps = current_plan_owned_maps_at(&root.0, &meta.id);
        assert_eq!(maps.len(), 1);
        assert_eq!(maps[0].slug, "still-here");
    }

    #[test]
    fn advance_chapter_at_invalidates_the_cached_session_plan() {
        let root = Scratch::new("advance-invalidates-plan");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        let (_, summaries) = write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), "Test plan.", "Lost Mine").unwrap();
        write_session_plan_at(&root.0, &meta.id, "## Encounters\n1. [combat] Stale Fight — old chapter.\n").unwrap();
        assert!(read_session_plan_at(&root.0, &meta.id).is_some());

        advance_chapter_at(&root.0, &meta.id, &summaries[1].id).unwrap();

        assert!(read_session_plan_at(&root.0, &meta.id).is_none(), "advancing the chapter must clear the stale cached plan");
    }

    /// The freeform-campaign equivalent of the test above — no imported
    /// module, so advance_chapter_at never fires; "End session" is the only
    /// available signal that content has moved on.
    #[test]
    fn invalidate_session_plan_at_clears_a_cached_plan_with_no_active_module() {
        let root = Scratch::new("end-session-invalidates-plan");
        let meta = create_campaign_at(&root.0, &intake("Freeform")).unwrap();
        write_session_plan_at(&root.0, &meta.id, "## Encounters\n1. [combat] Stale Fight — old session.\n").unwrap();
        assert!(read_session_plan_at(&root.0, &meta.id).is_some());

        invalidate_session_plan_at(&root.0, &meta.id);

        assert!(read_session_plan_at(&root.0, &meta.id).is_none());
    }

    #[test]
    fn invalidate_session_plan_at_is_a_harmless_noop_when_nothing_is_cached() {
        let root = Scratch::new("end-session-invalidate-noop");
        let meta = create_campaign_at(&root.0, &intake("Fresh")).unwrap();
        invalidate_session_plan_at(&root.0, &meta.id); // must not panic/error
        assert!(read_session_plan_at(&root.0, &meta.id).is_none());
    }

    /// The empty-encounters branch of generate_battle_maps_for_plan_at never
    /// calls the LLM (nothing to ask for), so this exercises the cleanup
    /// half of the determinism fix without needing a live call: a plan that
    /// used to have combat encounters, regenerated into one with none, must
    /// not leave the old maps behind.
    #[test]
    fn generate_battle_maps_for_plan_at_with_no_combat_encounters_clears_previously_owned_maps() {
        let root = Scratch::new("plan-maps-clear-on-empty");
        let meta = create_campaign_at(&root.0, &intake("X")).unwrap();
        write_map_spec_with_slug_at(&root.0, &meta.id, "old-fight", SAMPLE_MAP_SPEC).unwrap();
        write_plan_manifest_at(
            &root.0, &meta.id,
            &[PlanMapEntry { slug: "old-fight".to_string(), name: "Old Fight".to_string(), description: "x".to_string() }],
        ).unwrap();

        let (maps, failed) = generate_battle_maps_for_plan_at(&root.0, &meta.id, "arc", "chapter", "memory", &[], false, &[], &[], &no_progress).unwrap();

        assert!(maps.is_empty());
        assert!(failed.is_empty());
        assert!(read_plan_manifest_at(&root.0, &meta.id).is_empty());
        assert!(!battle_maps_dir(&root.0, &meta.id).join("old-fight.md").exists(), "the stale plan-owned map must be deleted");
    }

    /// The bug this whole function exists to fix: a slug that isn't one of
    /// the plan's own maps (ad-hoc, hand-crafted, or just wrong) must be
    /// rejected with a clear reason rather than silently doing something
    /// unexpected — this is the one path testable without a live LLM call,
    /// since it returns before ever building a prompt.
    #[test]
    fn regenerate_one_plan_map_at_rejects_a_slug_the_plan_doesnt_own() {
        let root = Scratch::new("regenerate-one-map-rejects-unowned");
        let meta = create_campaign_at(&root.0, &intake("X")).unwrap();
        write_map_spec_with_slug_at(&root.0, &meta.id, "hand-crafted", SAMPLE_MAP_SPEC).unwrap();
        // No plan_manifest.json entry for "hand-crafted" — it's not plan-owned.

        let err = regenerate_one_plan_map_at(&root.0, &meta.id, "hand-crafted", false, &[], &[]).unwrap_err();
        assert!(err.contains("hand-crafted"), "{err}");
        assert!(err.contains("isn't one of the current plan's maps"), "{err}");
    }

    #[test]
    fn dm_rules_carry_the_battle_log_protocol_and_base_claude_md_dropped_the_old_hex_section() {
        assert!(DM_RULES.contains("## Running combat & positioning"));
        assert!(DM_RULES.contains("Active Battle Log"));
        assert!(DM_RULES.contains("Theater of the Mind"));
        assert!(DM_RULES.contains("endBattle"));
        assert!(DM_RULES.contains("battleResult"));
        assert!(
            !BASE_CLAUDE_MD.contains("## Physical hex-grid positioning"),
            "the hex-only positioning section must be gone from BASE_CLAUDE_MD"
        );
        assert!(
            !BASE_CLAUDE_MD.contains("clearPositions"),
            "the old position/clearPositions keys must be gone from BASE_CLAUDE_MD"
        );
    }

    /// Archetype voice clips (tts.rs's ARCHETYPE_VOICES) are already recorded
    /// at the right pitch/accent for their race — pairing one with a `pitch`
    /// tag would double up and distort an already-tuned voice, so the rules
    /// must steer Claude away from combining them, not just document pitch
    /// and archetype ids as two independent options.
    #[test]
    fn dm_rules_forbids_combining_pitch_with_an_archetype_voice() {
        assert!(DM_RULES.contains("Never combine `pitch` with a race-flavored id"));
        assert!(DM_RULES.contains("orc-*"));
        assert!(DM_RULES.contains("gnome-*"));
    }

    /// The BASE_CLAUDE_MD few-shot example is the one piece of guidance Claude
    /// sees on literally every reply (it's not tucked behind the periodic
    /// voice-rules import) — if it still showed a race-appropriate NPC paired
    /// with both an archetype id AND a pitch tag, that example would silently
    /// out-teach the explicit prose rule against doing exactly that.
    #[test]
    fn base_claude_md_example_does_not_pair_an_archetype_voice_with_pitch() {
        let action_block_start = BASE_CLAUDE_MD.find("```dm-actions").expect("example dm-actions block must exist");
        let action_block_end = BASE_CLAUDE_MD[action_block_start..].find("```\n").expect("block must close") + action_block_start;
        let example = &BASE_CLAUDE_MD[action_block_start..action_block_end];
        assert!(example.contains("gnome-m-3"), "Squibbins should demo a race-flavored id");
        assert!(!example.contains("\"pitch\""), "the example must not pair pitch with the archetype id it demonstrates");
    }

    /// The voice rules must live ONLY in the generated file — if they were also
    /// left inline in BASE_CLAUDE_MD, every new campaign would carry two copies
    /// and old campaigns would see a contradictory pair.
    #[test]
    fn voice_rules_are_not_duplicated_into_claude_md() {
        let root = Scratch::new("dm_rules_nodup");
        let meta = create_campaign_at(&root.0, &intake("No Dup")).unwrap();
        let claude_md = fs::read_to_string(root.0.join(&meta.id).join("CLAUDE.md")).unwrap();
        assert!(!claude_md.contains("## Giving NPCs distinct voices"));
        assert!(!claude_md.contains("## Out-of-character requests"));
        assert!(claude_md.contains("@memory/dm_rules.md"));
        let rules = fs::read_to_string(root.0.join(&meta.id).join("memory").join("dm_rules.md")).unwrap();
        assert!(rules.contains("## Giving NPCs distinct voices"));
        assert!(rules.contains("## Out-of-character requests"));
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
        assert!(claude_md.contains("@memory/flagged_facts.md"), "CLAUDE.md must import the flagged-facts registry so it auto-loads");
        assert!(claude_md.contains("@memory/party.md"), "CLAUDE.md must import the party registry so it auto-loads");
        assert!(claude_md.contains("@memory/entities.md"), "CLAUDE.md must import the entities registry so it auto-loads");
        assert!(claude_md.contains("@memory/locations.md"), "CLAUDE.md must import the locations registry so it auto-loads");
        assert!(claude_md.contains("## Campaign setting"));
        assert!(claude_md.contains("remember"), "persona must document the remember dm-action");
        assert!(claude_md.contains("rememberEntity"), "persona must document the rememberEntity dm-action");
        assert!(claude_md.contains("rememberLocation"), "persona must document the rememberLocation dm-action");
        assert!(claude_md.contains("resolveChapterSection"), "persona must document the resolveChapterSection dm-action");

        let memory_md = fs::read_to_string(root.0.join(&meta.id).join("memory").join("MEMORY.md")).unwrap();
        assert!(memory_md.contains("Campaign Memory"));

        let flagged_facts_md = fs::read_to_string(root.0.join(&meta.id).join("memory").join("flagged_facts.md")).unwrap();
        assert!(flagged_facts_md.contains("Flagged Facts"));

        let entities_md = fs::read_to_string(root.0.join(&meta.id).join("memory").join("entities.md")).unwrap();
        assert!(entities_md.contains("Entities"));

        let locations_md = fs::read_to_string(root.0.join(&meta.id).join("memory").join("locations.md")).unwrap();
        assert!(locations_md.contains("Locations"));

        let history_md = fs::read_to_string(root.0.join(&meta.id).join("memory").join("full_history.md")).unwrap();
        assert!(history_md.contains("Full History"));
        assert!(!claude_md.contains("@memory/full_history.md"), "the archive must never be a standing import — it costs nothing precisely because the DM never reads it");
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
            lore: String::new(),
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
    fn export_campaign_at_zips_the_folder_and_import_campaign_at_reads_it_back() {
        let root = Scratch::new("export-import-src");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine of Phandelver")).unwrap();
        append_memory_note_at(&root.0, &meta.id, "2026-07-12", "The party promised to return the map.").unwrap();

        let zip_path = root.0.join("backup.zip");
        export_campaign_at(&root.0, &meta.id, &zip_path).unwrap();
        assert!(zip_path.exists());

        // Import into a SEPARATE root — simulates restoring on a fresh machine.
        let other_root = Scratch::new("export-import-dst");
        let (imported, renamed_from) = import_campaign_at(&other_root.0, &zip_path).unwrap();
        assert_eq!(imported.id, meta.id);
        assert_eq!(imported.name, meta.name);
        assert_eq!(renamed_from, None, "importing into a fresh folder must not trigger a rename");

        let claude_md = fs::read_to_string(other_root.0.join(&imported.id).join("CLAUDE.md")).unwrap();
        assert!(claude_md.contains("You are the Dungeon Master"));
        let facts = fs::read_to_string(other_root.0.join(&imported.id).join("memory").join("flagged_facts.md")).unwrap();
        assert!(facts.contains("promised to return the map"), "imported campaign must carry over its actual memory content, not just CLAUDE.md");
    }

    #[test]
    fn export_campaign_at_errors_on_an_unknown_id() {
        let root = Scratch::new("export-missing");
        let err = export_campaign_at(&root.0, "does-not-exist", &root.0.join("out.zip")).unwrap_err();
        assert!(err.contains("No campaign found"));
    }

    #[test]
    fn import_campaign_at_auto_renames_on_a_name_collision_without_touching_the_original() {
        let root = Scratch::new("import-collision");
        let meta = create_campaign_at(&root.0, &intake("Curse of Strahd")).unwrap();
        append_memory_note_at(&root.0, &meta.id, "2026-07-12", "Original campaign's own fact.").unwrap();
        let zip_path = root.0.join("backup.zip");
        export_campaign_at(&root.0, &meta.id, &zip_path).unwrap();

        let (imported, renamed_from) = import_campaign_at(&root.0, &zip_path).unwrap();
        assert_eq!(renamed_from, Some("Curse of Strahd".to_string()));
        assert_eq!(imported.name, "Curse of Strahd (2)");
        assert_ne!(imported.id, meta.id);

        let original_facts = fs::read_to_string(root.0.join(&meta.id).join("memory").join("flagged_facts.md")).unwrap();
        assert!(original_facts.contains("Original campaign's own fact."), "the pre-existing campaign must be completely untouched by the rename");

        let campaigns = list_campaigns_at(&root.0).unwrap();
        assert_eq!(campaigns.len(), 2, "both the original and the renamed import must now exist side by side");
    }

    #[test]
    fn import_campaign_at_keeps_incrementing_the_suffix_past_two() {
        let root = Scratch::new("import-collision-triple");
        let meta = create_campaign_at(&root.0, &intake("Curse of Strahd")).unwrap();
        let zip_path = root.0.join("backup.zip");
        export_campaign_at(&root.0, &meta.id, &zip_path).unwrap();

        let (first_import, _) = import_campaign_at(&root.0, &zip_path).unwrap();
        assert_eq!(first_import.name, "Curse of Strahd (2)");
        let (second_import, _) = import_campaign_at(&root.0, &zip_path).unwrap();
        assert_eq!(second_import.name, "Curse of Strahd (3)");
    }

    #[test]
    fn import_campaign_at_rejects_a_zip_that_is_not_a_campaign_backup() {
        use std::io::Write;
        let root = Scratch::new("import-garbage");
        let zip_path = root.0.join("not-a-campaign.zip");
        let f = fs::File::create(&zip_path).unwrap();
        let mut zw = zip::ZipWriter::new(f);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        zw.start_file("random.txt", opts).unwrap();
        zw.write_all(b"not a campaign").unwrap();
        zw.finish().unwrap();

        let err = import_campaign_at(&root.0, &zip_path).unwrap_err();
        assert!(err.contains("doesn't look like a campaign backup"));
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
    fn append_memory_note_lands_in_flagged_facts_not_memory_md() {
        // Flagged facts must be physically separate from MEMORY.md's
        // compactable recap narrative (see DEFAULT_FLAGGED_FACTS_MD) — this
        // is the guarantee that a compaction pass can never drop one, since
        // compact_memory_if_needed_at never even sees this file.
        let root = Scratch::new("note");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        append_session_recap_at(&root.0, &meta.id, "2026-07-03", "The party set out from Neverwinter.").unwrap();
        append_memory_note_at(&root.0, &meta.id, "2026-07-03", "Sildar Hallwinter is a friendly NPC travelling with the party.").unwrap();
        append_memory_note_at(&root.0, &meta.id, "2026-07-10", "The party promised Gundren Rockseeker they'd find his brothers.").unwrap();

        let memory_md = fs::read_to_string(root.0.join(&meta.id).join("memory").join("MEMORY.md")).unwrap();
        assert!(memory_md.contains("The party set out from Neverwinter."));
        assert!(!memory_md.contains("Sildar Hallwinter"), "flagged facts must not land in MEMORY.md");
        assert!(!memory_md.contains("Gundren Rockseeker"), "flagged facts must not land in MEMORY.md");

        let flagged = fs::read_to_string(root.0.join(&meta.id).join("memory").join("flagged_facts.md")).unwrap();
        assert!(flagged.contains("Sildar Hallwinter is a friendly NPC"));
        assert!(flagged.contains("The party promised Gundren Rockseeker"));
        assert!(!flagged.contains("Neverwinter"), "session recaps must not land in flagged_facts.md");
    }

    #[test]
    fn remove_flagged_fact_matches_case_insensitively_and_returns_the_removed_line() {
        let content = "# Flagged Facts\n\n_intro blurb_\n- **2026-07-01:** The party promised Gundren they'd find his brothers.\n- **2026-07-02:** The mayor's ledger is forged.\n";
        let (remaining, removed) = remove_flagged_fact(content, "the party promised gundren").expect("should match");
        assert!(removed.contains("find his brothers"));
        assert!(!remaining.contains("Gundren"));
        assert!(remaining.contains("The mayor's ledger is forged."), "other facts must survive");
        assert!(remaining.contains("# Flagged Facts"), "heading must survive");
        assert!(remaining.contains("_intro blurb_"), "intro must survive");
    }

    #[test]
    fn remove_flagged_fact_refuses_ambiguous_and_missing_matches() {
        let content = "# Flagged Facts\n\n- **2026-07-01:** A promise to the smith.\n- **2026-07-02:** A promise to the mayor.\n";
        assert!(remove_flagged_fact(content, "a promise").is_none(), "two matching lines is ambiguous — must refuse");
        assert!(remove_flagged_fact(content, "the dragon's hoard").is_none(), "no match must refuse");
        assert!(remove_flagged_fact(content, "   ").is_none(), "blank needle must refuse");
        assert!(remove_flagged_fact(content, "flagged facts").is_none(), "heading text must never match — only bullet lines count");
    }

    #[test]
    fn resolve_flagged_fact_at_moves_the_fact_to_resolved_facts() {
        let root = Scratch::new("resolve-fact");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        append_memory_note_at(&root.0, &meta.id, "2026-07-01", "The party promised Gundren they'd find his brothers.").unwrap();
        append_memory_note_at(&root.0, &meta.id, "2026-07-02", "The mayor's ledger is forged.").unwrap();

        let moved = resolve_flagged_fact_at(&root.0, &meta.id, "2026-07-06", "promised Gundren").unwrap();
        assert!(moved);

        let flagged = fs::read_to_string(root.0.join(&meta.id).join("memory").join("flagged_facts.md")).unwrap();
        assert!(!flagged.contains("Gundren"), "resolved fact must leave flagged_facts.md");
        assert!(flagged.contains("The mayor's ledger is forged."), "unresolved facts must stay");

        let resolved = fs::read_to_string(root.0.join(&meta.id).join("memory").join("resolved_facts.md")).unwrap();
        assert!(resolved.contains("[resolved 2026-07-06]"));
        assert!(resolved.contains("find his brothers"));

        let history = fs::read_to_string(root.0.join(&meta.id).join("memory").join("full_history.md")).unwrap();
        assert!(history.contains("Resolved fact:"));
    }

    #[test]
    fn resolve_flagged_fact_at_is_a_tolerated_noop_when_nothing_matches() {
        let root = Scratch::new("resolve-fact-miss");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        append_memory_note_at(&root.0, &meta.id, "2026-07-01", "A promise to the smith.").unwrap();
        let moved = resolve_flagged_fact_at(&root.0, &meta.id, "2026-07-06", "the dragon's hoard").unwrap();
        assert!(!moved);
        let flagged = fs::read_to_string(root.0.join(&meta.id).join("memory").join("flagged_facts.md")).unwrap();
        assert!(flagged.contains("A promise to the smith."), "file must be untouched on a miss");
        assert!(!root.0.join(&meta.id).join("memory").join("resolved_facts.md").exists(), "no resolved file should appear on a miss");
    }

    #[test]
    fn upsert_party_member_writes_to_party_md_and_updates_in_place() {
        let root = Scratch::new("party");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        upsert_named_fact_at(&root.0, &meta.id, "party.md", "Thorin", "Played by Alex. Level 3 Dwarf Fighter.").unwrap();
        upsert_named_fact_at(&root.0, &meta.id, "party.md", "Thorin", "Played by Alex. Level 4 Dwarf Fighter.").unwrap();

        let party_md = fs::read_to_string(root.0.join(&meta.id).join("memory").join("party.md")).unwrap();
        assert!(party_md.contains("Level 4"), "re-push must update in place");
        assert!(!party_md.contains("Level 3"), "stale entry must be replaced, not duplicated");
        assert_eq!(party_md.matches("Thorin").count(), 1);
    }

    #[test]
    fn append_to_history_at_accumulates_entries_without_clobbering() {
        let root = Scratch::new("history");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        append_to_history_at(&root.0, &meta.id, "First entry").unwrap();
        append_to_history_at(&root.0, &meta.id, "Second entry").unwrap();

        let history_md = fs::read_to_string(root.0.join(&meta.id).join("memory").join("full_history.md")).unwrap();
        assert!(history_md.contains("Full History"), "the seed heading must survive");
        assert!(history_md.contains("First entry"));
        assert!(history_md.contains("Second entry"));
    }

    #[test]
    fn session_recaps_and_memory_notes_are_also_archived_to_full_history() {
        let root = Scratch::new("history-writes");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        append_session_recap_at(&root.0, &meta.id, "2026-07-03", "The party entered the goblin cave.").unwrap();
        append_memory_note_at(&root.0, &meta.id, "2026-07-03", "Sildar Hallwinter is travelling with the party.").unwrap();

        let history_md = fs::read_to_string(root.0.join(&meta.id).join("memory").join("full_history.md")).unwrap();
        assert!(history_md.contains("The party entered the goblin cave."));
        assert!(history_md.contains("Sildar Hallwinter is travelling with the party."));
    }

    #[test]
    fn entity_upserts_log_old_and_new_description_to_full_history() {
        let root = Scratch::new("history-upsert");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        upsert_named_fact_at(&root.0, &meta.id, "entities.md", "Harbin Wester", "A suspicious merchant.").unwrap();
        upsert_named_fact_at(&root.0, &meta.id, "entities.md", "Harbin Wester", "Revealed as a Black Spider spy.").unwrap();

        let history_md = fs::read_to_string(root.0.join(&meta.id).join("memory").join("full_history.md")).unwrap();
        assert!(history_md.contains("(new)"), "the first upsert should be logged as a new entry");
        assert!(history_md.contains("A suspicious merchant."));
        assert!(history_md.contains("Revealed as a Black Spider spy."));
    }

    #[test]
    fn build_session_digest_prompt_asks_for_structured_facts_and_protects_pcs() {
        let prompt = build_session_digest_prompt("DM: A hooded figure approaches.\nPlayer (Thorin): I draw my axe.");
        assert!(prompt.contains("A hooded figure approaches."));
        assert!(prompt.contains("\"entities\""));
        assert!(prompt.contains("\"locations\""));
        assert!(prompt.contains("\"summary\""));
        assert!(prompt.to_lowercase().contains("never include a player character"), "must protect PCs from being logged as entities");
    }

    #[test]
    fn parse_session_digest_handles_plain_and_fenced_json_and_tolerates_garbage() {
        let plain = r#"{"entities":[{"name":"Vera","description":"A bandit."}],"locations":[],"facts":["Owes a debt."],"summary":"An ambush."}"#;
        let d = parse_session_digest(plain);
        assert_eq!(d.entities.len(), 1);
        assert_eq!(d.entities[0].name, "Vera");
        assert_eq!(d.facts, vec!["Owes a debt."]);
        assert_eq!(d.summary, "An ambush.");

        let fenced = "```json\n{\"entities\":[],\"locations\":[{\"name\":\"Millhaven\",\"description\":\"A fishing town.\"}],\"facts\":[],\"summary\":\"Arrived in town.\"}\n```";
        let d2 = parse_session_digest(fenced);
        assert_eq!(d2.locations[0].name, "Millhaven");

        // Garbage degrades to an empty digest rather than panicking/erroring.
        let d3 = parse_session_digest("not json at all");
        assert!(d3.entities.is_empty() && d3.locations.is_empty() && d3.facts.is_empty() && d3.summary.is_empty());
    }

    #[test]
    fn is_valid_session_id_guards_against_path_traversal() {
        assert!(is_valid_session_id("session-01"));
        assert!(is_valid_session_id("session-123"));
        assert!(!is_valid_session_id("session-"), "must have digits");
        assert!(!is_valid_session_id("session-1a"), "digits only");
        assert!(!is_valid_session_id("../secrets"), "no traversal");
        assert!(!is_valid_session_id("session-01/../../etc"), "no traversal even with a valid prefix");
        assert!(!is_valid_session_id("nope"));
    }

    #[test]
    fn next_session_id_at_increments_past_the_highest_existing_record() {
        let root = Scratch::new("session-id");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        assert_eq!(next_session_id_at(&root.0, &meta.id), "session-01", "first session when none exist");

        let records = root.0.join(&meta.id).join(SESSION_RECORDS_DIR);
        fs::create_dir_all(&records).unwrap();
        fs::write(records.join("session-01.md"), "x").unwrap();
        fs::write(records.join("session-02.md"), "x").unwrap();
        assert_eq!(next_session_id_at(&root.0, &meta.id), "session-03");
    }

    #[test]
    fn append_session_index_line_at_accumulates_compact_lines_with_ids() {
        let root = Scratch::new("session-index");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        append_session_index_line_at(&root.0, &meta.id, "session-01", "2026-07-03", "The party entered the goblin cave.").unwrap();
        append_session_index_line_at(&root.0, &meta.id, "session-02", "2026-07-10", "They freed Sildar.").unwrap();

        let index = fs::read_to_string(root.0.join(&meta.id).join("memory").join("session_index.md")).unwrap();
        assert!(index.contains("- **session-01** (2026-07-03): The party entered the goblin cave."));
        assert!(index.contains("- **session-02** (2026-07-10): They freed Sildar."));
        assert!(index.contains("# Session Index"), "keeps its heading");
    }

    #[test]
    fn read_session_record_at_rejects_a_bad_id_and_reads_a_real_one() {
        let root = Scratch::new("read-record");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        let records = root.0.join(&meta.id).join(SESSION_RECORDS_DIR);
        fs::create_dir_all(&records).unwrap();
        fs::write(records.join("session-01.md"), "# session-01\n\nThe party met Gundren.").unwrap();

        assert!(read_session_record_at(&root.0, &meta.id, "session-01").unwrap().contains("The party met Gundren."));
        assert!(read_session_record_at(&root.0, &meta.id, "session-99").unwrap().contains("No session record found"));
        // A traversal attempt is refused BEFORE any filesystem access.
        assert!(read_session_record_at(&root.0, &meta.id, "../../../etc/passwd").unwrap().contains("not a valid session id"));
    }

    #[test]
    fn build_plan_reconciliation_prompt_is_conservative_and_grounds_the_plan_in_reality() {
        let prompt = build_plan_reconciliation_prompt(
            "## This module's own arc\nSteer the party to the lighthouse by session 4.",
            "The party went north instead and never approached the coast.",
            "- **Vera Blackwood:** Killed at Redstone Bridge.",
            "- **The Gilded Eel:** Burned down.",
            "- **2026-07-13:** The party swore to bring Captain Renn in alive.",
        );
        assert!(prompt.contains("Steer the party to the lighthouse"));
        assert!(prompt.contains("went north instead"), "must see where the party ACTUALLY ended up — the divergence signal");
        assert!(prompt.contains("Killed at Redstone Bridge"));
        assert!(prompt.contains("Burned down"));
        assert!(prompt.contains("bring Captain Renn in alive"));
        assert!(prompt.to_lowercase().contains("abandoned routes"), "must name the stale-pacing failure mode");
        assert!(prompt.to_lowercase().contains("completely unchanged"), "must be told to no-op when the session diverged from nothing");
        assert!(prompt.to_lowercase().contains("when in doubt, keep it"));
        // A live run caught the model echoing the CONTEXT sections back into
        // plan.md (the registries got copied wholesale into the plan, which then
        // re-injects them every check-in — they're already standing imports).
        // The context must be fenced off as input and never share the plan's own
        // `##` heading level.
        assert!(prompt.contains("never reproduce any of this"), "context must be explicitly marked as input-only");
        assert!(!prompt.contains("## What happened"), "context labels must not use the plan's own `##` heading level");
    }

    // The two no-op paths below are FREE — they must return before ever making
    // an LLM call. If either regressed into calling out, it would come back
    // with a revised plan and these `false` assertions would fail.
    #[test]
    fn reconcile_module_plan_at_is_a_free_no_op_with_no_active_module() {
        let root = Scratch::new("reconcile-no-module");
        let meta = create_campaign_at(&root.0, &intake("Homebrew")).unwrap();
        assert!(!reconcile_module_plan_at(&root.0, &meta.id, "Stuff happened.").unwrap());
    }

    #[test]
    fn reconcile_module_plan_at_is_a_free_no_op_when_the_active_module_has_no_plan() {
        let root = Scratch::new("reconcile-no-plan");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), "", "Lost Mine").unwrap();
        assert!(!reconcile_module_plan_at(&root.0, &meta.id, "Stuff happened.").unwrap());
    }

    #[test]
    fn create_campaign_seeds_session_index_and_imports_it() {
        let root = Scratch::new("seed-session-index");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        assert!(root.0.join(&meta.id).join("memory").join("session_index.md").exists());
        let claude_md = fs::read_to_string(root.0.join(&meta.id).join("CLAUDE.md")).unwrap();
        assert!(claude_md.contains("@memory/session_index.md"), "must be a standing import so it always loads");
    }

    #[test]
    fn sync_session_index_at_upgrades_an_old_campaign_without_clobbering_accumulated_data() {
        let root = Scratch::new("upgrade-session-index");
        let meta = create_campaign_at(&root.0, &intake("Old Campaign")).unwrap();
        let dir = root.0.join(&meta.id);
        let index_path = dir.join("memory").join("session_index.md");
        let claude_path = dir.join("CLAUDE.md");

        // Rewind to a pre-session-index campaign: no import line, but the file
        // already holds real accumulated data that MUST survive the upgrade.
        let legacy_claude = fs::read_to_string(&claude_path).unwrap().replace("@memory/session_index.md\n", "");
        fs::write(&claude_path, &legacy_claude).unwrap();
        fs::write(&index_path, "# Session Index\n\n- **session-01** (2026-07-01): A precious existing line.\n").unwrap();

        for _ in 0..3 {
            sync_session_index_at(&root.0, &meta.id).unwrap();
        }

        let index = fs::read_to_string(&index_path).unwrap();
        assert!(index.contains("A precious existing line."), "must NEVER overwrite accumulated session data");
        let claude_md = fs::read_to_string(&claude_path).unwrap();
        assert_eq!(claude_md.matches("@memory/session_index.md").count(), 1, "import added once, idempotently");
    }

    #[test]
    fn set_npc_voice_at_persists_and_read_npc_voices_at_is_case_insensitive() {
        let root = Scratch::new("npc-voices-basic");
        fs::create_dir_all(root.0.join("camp").join("memory")).unwrap();

        assert!(read_npc_voices_at(&root.0, "camp").is_empty());

        set_npc_voice_at(&root.0, "camp", "Gundren Rockseeker", "male-us-1", None, None, false).unwrap();
        let voices = read_npc_voices_at(&root.0, "camp");
        let assigned = voices.get("gundren rockseeker").expect("should be present under a lowercased key");
        assert_eq!(assigned.voice_id, "male-us-1");
        assert_eq!(assigned.pitch, None);
        assert_eq!(assigned.speed, None);
    }

    #[test]
    fn set_npc_voice_at_overwrites_a_previous_assignment_for_the_same_name() {
        let root = Scratch::new("npc-voices-overwrite");
        fs::create_dir_all(root.0.join("camp").join("memory")).unwrap();

        set_npc_voice_at(&root.0, "camp", "Elara", "female-us-1", None, None, false).unwrap();
        set_npc_voice_at(&root.0, "camp", "elara", "female-gb-1", None, None, false).unwrap();
        let voices = read_npc_voices_at(&root.0, "camp");
        assert_eq!(voices.len(), 1, "same name under different casing should overwrite, not duplicate");
        assert_eq!(voices.get("elara").unwrap().voice_id, "female-gb-1");
    }

    #[test]
    fn set_npc_voice_at_persists_a_race_size_pitch_tag() {
        let root = Scratch::new("npc-voices-pitch");
        fs::create_dir_all(root.0.join("camp").join("memory")).unwrap();

        set_npc_voice_at(&root.0, "camp", "Squibbins", "male-us-2", Some("small"), None, false).unwrap();
        let voices = read_npc_voices_at(&root.0, "camp");
        let assigned = voices.get("squibbins").unwrap();
        assert_eq!(assigned.voice_id, "male-us-2");
        assert_eq!(assigned.pitch.as_deref(), Some("small"));
    }

    #[test]
    fn campaign_archetype_voice_count_at_counts_only_archetype_ids() {
        let root = Scratch::new("archetype-voice-count");
        fs::create_dir_all(root.0.join("camp").join("memory")).unwrap();

        assert_eq!(campaign_archetype_voice_count_at(&root.0, "camp"), 0, "no assignments yet");

        set_npc_voice_at(&root.0, "camp", "Gundren Rockseeker", "dwarf-m-2", None, None, false).unwrap();
        set_npc_voice_at(&root.0, "camp", "Squibbins", "gnome-m-3", None, None, false).unwrap();
        set_npc_voice_at(&root.0, "camp", "Elara", "female-us-1", None, None, false).unwrap();
        assert_eq!(campaign_archetype_voice_count_at(&root.0, "camp"), 2, "Gundren and Squibbins are archetype voices, Elara is a plain catalog id");
    }

    #[test]
    fn campaign_archetype_voice_count_at_is_zero_for_an_unknown_campaign() {
        let root = Scratch::new("archetype-voice-count-missing");
        assert_eq!(campaign_archetype_voice_count_at(&root.0, "no-such-campaign"), 0);
    }

    #[test]
    fn set_npc_voice_at_persists_a_speed_override_independent_of_pitch() {
        let root = Scratch::new("npc-voices-speed");
        fs::create_dir_all(root.0.join("camp").join("memory")).unwrap();

        set_npc_voice_at(&root.0, "camp", "Narrator-ish NPC", "male-us-3", None, Some(0.95), false).unwrap();
        let voices = read_npc_voices_at(&root.0, "camp");
        let assigned = voices.get("narrator-ish npc").unwrap();
        assert_eq!(assigned.speed, Some(0.95));
        assert_eq!(assigned.pitch, None, "speed and pitch are independent overrides");
    }

    #[test]
    fn parse_entities_md_extracts_name_description_pairs_and_skips_junk() {
        let content = "# Entities\n\n_Some intro blurb, not an entry._\n\n- **Gundren Rockseeker:** A dwarf merchant, captured by goblins.\n- **Squibbins:** A jittery gnome tinkerer.\n\n";
        let parsed = parse_entities_md(content);
        assert_eq!(parsed, vec![
            ("Gundren Rockseeker".to_string(), "A dwarf merchant, captured by goblins.".to_string()),
            ("Squibbins".to_string(), "A jittery gnome tinkerer.".to_string()),
        ]);
    }

    #[test]
    fn parse_entities_md_returns_empty_for_a_freshly_seeded_file() {
        assert!(parse_entities_md(DEFAULT_ENTITIES_MD).is_empty());
    }

    #[test]
    fn build_voice_reconciliation_prompt_includes_catalog_criteria_and_every_name() {
        let unvoiced = vec![
            ("Gundren Rockseeker".to_string(), "A dwarf merchant.".to_string()),
            ("Squibbins".to_string(), "A jittery gnome tinkerer.".to_string()),
        ];
        let prompt = build_voice_reconciliation_prompt(&unvoiced, "");
        assert!(prompt.contains("Gundren Rockseeker"));
        assert!(prompt.contains("Squibbins"));
        assert!(prompt.contains("male-us-9"));
        assert!(prompt.contains("male-gb-4"));
        assert!(prompt.contains("female-gb-4"));
        assert!(prompt.contains("\"small\""));
        assert!(prompt.contains("\"large\""));
        // Archetype voices (tts.rs's ARCHETYPE_VOICES) -- Gundren the dwarf
        // and Squibbins the gnome above are exactly the case these exist for.
        assert!(prompt.contains("dwarf-m-1"));
        assert!(prompt.contains("gnome-f-5"));
        assert!(prompt.contains("sage-m-1"));
        assert!(prompt.to_lowercase().contains("spread"), "should ask it to spread picks across the bucket instead of defaulting to one id");
    }

    /// Same reasoning as dm_rules_forbids_combining_pitch_with_an_archetype_voice
    /// — this prompt is the other place Claude assigns voice_id + pitch
    /// together (the batch import pass), so it needs the same guardrail.
    #[test]
    fn voice_reconciliation_prompt_forbids_combining_pitch_with_an_archetype_voice() {
        let prompt = build_voice_reconciliation_prompt(&[], "");
        assert!(prompt.contains("Never set `pitch` alongside a race-flavored voice_id"));
    }

    #[test]
    fn build_voice_reconciliation_prompt_surfaces_existing_usage_to_favor_less_used_ids() {
        let unvoiced = vec![("Squibbins".to_string(), "A jittery gnome tinkerer.".to_string())];
        let with_usage = build_voice_reconciliation_prompt(&unvoiced, "male-us-1 (x3)");
        assert!(with_usage.contains("male-us-1 (x3)"));
        assert!(with_usage.to_lowercase().contains("less-used"));

        let blank_usage = build_voice_reconciliation_prompt(&unvoiced, "");
        assert!(!blank_usage.contains("already in use"), "should omit the usage paragraph entirely when nothing's assigned yet");
    }

    #[test]
    fn summarize_voice_usage_counts_by_id_and_is_empty_when_nothing_assigned() {
        assert_eq!(summarize_voice_usage(&HashMap::new()), "");

        let mut existing = HashMap::new();
        existing.insert("gundren".to_string(), NpcVoiceAssignment { voice_id: "male-us-1".to_string(), pitch: None, speed: None });
        existing.insert("squibbins".to_string(), NpcVoiceAssignment { voice_id: "male-us-1".to_string(), pitch: Some("small".to_string()), speed: None });
        existing.insert("elara".to_string(), NpcVoiceAssignment { voice_id: "female-gb-1".to_string(), pitch: None, speed: None });
        assert_eq!(summarize_voice_usage(&existing), "female-gb-1 (x1), male-us-1 (x2)");
    }

    #[test]
    fn parse_voice_reconciliation_reply_handles_plain_and_fenced_json() {
        let plain = r#"{"assignments":[{"name":"Gundren","voice_id":"male-us-1","pitch":null}]}"#;
        let parsed = parse_voice_reconciliation_reply(plain).unwrap();
        assert_eq!(parsed.assignments[0].name, "Gundren");
        assert_eq!(parsed.assignments[0].voice_id, "male-us-1");
        assert_eq!(parsed.assignments[0].pitch, None);

        let fenced = "```json\n{\"assignments\":[{\"name\":\"Squibbins\",\"voice_id\":\"male-us-2\",\"pitch\":\"small\"}]}\n```";
        let parsed2 = parse_voice_reconciliation_reply(fenced).unwrap();
        assert_eq!(parsed2.assignments[0].pitch.as_deref(), Some("small"));

        assert!(parse_voice_reconciliation_reply("not json").is_err());
    }

    #[test]
    fn reconcile_npc_voices_at_is_a_free_no_op_when_everyone_already_has_a_voice() {
        // No network access happens in this test at all — if the early-return
        // short-circuit ever regressed, this test would hang/fail trying to
        // shell out to the `claude` CLI instead of completing instantly.
        let root = Scratch::new("reconcile-noop");
        let memory_dir = root.0.join("camp").join("memory");
        fs::create_dir_all(&memory_dir).unwrap();
        fs::write(memory_dir.join("entities.md"), "- **Gundren Rockseeker:** A dwarf merchant.\n").unwrap();
        set_npc_voice_at(&root.0, "camp", "Gundren Rockseeker", "male-us-1", None, None, false).unwrap();

        assert_eq!(reconcile_npc_voices_at(&root.0, "camp").unwrap(), 0);
    }

    #[test]
    fn reconcile_npc_voices_at_is_a_free_no_op_when_entities_md_is_empty() {
        let root = Scratch::new("reconcile-empty");
        fs::create_dir_all(root.0.join("camp").join("memory")).unwrap();
        assert_eq!(reconcile_npc_voices_at(&root.0, "camp").unwrap(), 0);
    }

    #[test]
    fn ensure_personal_hooks_heading_is_idempotent() {
        let lore = "# Campaign Lore\n\nA sleepy village on the frontier.";
        let once = ensure_personal_hooks_heading(lore);
        assert!(once.contains("## Personal hooks"));
        let twice = ensure_personal_hooks_heading(&once);
        assert_eq!(once, twice, "must not duplicate the heading on a second call");
    }

    #[test]
    fn build_campaign_hooks_prompt_includes_lore_and_every_pending_name() {
        let pending = vec![
            ("Thorin".to_string(), "Raised by monks after her village was burned.".to_string()),
            ("Elara".to_string(), "A disgraced noble seeking redemption.".to_string()),
        ];
        let prompt = build_campaign_hooks_prompt("The Ashfen Cult hunts an ancient bloodline.", &pending);
        assert!(prompt.contains("Ashfen Cult"));
        assert!(prompt.contains("Thorin"));
        assert!(prompt.contains("Elara"));
        assert!(prompt.contains("never a brand new element"));
    }

    #[test]
    fn build_campaign_hooks_prompt_degrades_gracefully_with_no_established_lore_yet() {
        let pending = vec![("Thorin".to_string(), "A dwarf fighter.".to_string())];
        let prompt = build_campaign_hooks_prompt("", &pending);
        assert!(prompt.contains("Nothing established yet"));
    }

    #[test]
    fn parse_campaign_hooks_reply_handles_plain_and_fenced_json() {
        let plain = r#"{"hooks": [{"name": "Thorin", "hook": "The cult leader recognizes her family crest."}]}"#;
        let parsed = parse_campaign_hooks_reply(plain).unwrap();
        assert_eq!(parsed.hooks.len(), 1);
        assert_eq!(parsed.hooks[0].name, "Thorin");

        let fenced = format!("```json\n{plain}\n```");
        let parsed2 = parse_campaign_hooks_reply(&fenced).unwrap();
        assert_eq!(parsed2.hooks[0].name, "Thorin");

        assert!(parse_campaign_hooks_reply("not json").is_err());
    }

    #[test]
    fn reconcile_campaign_hooks_at_is_a_free_no_op_when_party_md_is_empty() {
        // No network access happens in this test — if the early-return
        // short-circuit ever regressed, this would hang/fail trying to shell
        // out to the `claude` CLI instead of completing instantly.
        let root = Scratch::new("hooks-empty");
        fs::create_dir_all(root.0.join("camp").join("memory")).unwrap();
        assert_eq!(reconcile_campaign_hooks_at(&root.0, "camp").unwrap(), 0);
    }

    #[test]
    fn reconcile_campaign_hooks_at_is_a_free_no_op_when_everyone_already_has_a_hook() {
        let root = Scratch::new("hooks-noop");
        let memory_dir = root.0.join("camp").join("memory");
        fs::create_dir_all(&memory_dir).unwrap();
        fs::write(memory_dir.join("party.md"), "- **Thorin:** A dwarf fighter.\n").unwrap();
        write_reconciled_hook_names_at(&root.0, "camp", &["thorin".to_string()].into_iter().collect()).unwrap();

        assert_eq!(reconcile_campaign_hooks_at(&root.0, "camp").unwrap(), 0);
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
    fn scanned_pdf_concern_is_none_for_a_small_file_regardless_of_extracted_length() {
        // Too small a file to judge meaningfully either way — a one-page
        // flyer-sized PDF legitimately might extract very little text.
        assert!(scanned_pdf_concern(50_000, 10).is_none());
    }

    #[test]
    fn scanned_pdf_concern_is_none_when_a_reasonably_sized_file_yields_real_text() {
        // A real, art-heavy D&D module: several MB of file size (embedded
        // art), but a real text layer trivially clears the floor.
        assert!(scanned_pdf_concern(5_000_000, 80_000).is_none());
    }

    #[test]
    fn scanned_pdf_concern_flags_a_large_file_with_almost_no_extracted_text() {
        let concern = scanned_pdf_concern(3_000_000, 40).expect("a multi-MB file with 40 characters extracted should be flagged");
        assert!(concern.contains("40 characters"));
        assert!(concern.contains("2929KB"));
        assert!(concern.to_lowercase().contains("scanned images"));
    }

    #[test]
    fn compact_entities_if_needed_at_is_a_noop_below_threshold() {
        let root = Scratch::new("entities-compact-noop");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        let did_compact = compact_entities_if_needed_at(&root.0, &meta.id, "entities.md", "entities", "").unwrap();
        assert!(!did_compact);
        let content = fs::read_to_string(root.0.join(&meta.id).join("memory").join("entities.md")).unwrap();
        assert!(content.contains("Entities"), "should be untouched");
    }

    #[test]
    fn dropped_entity_names_is_empty_when_all_names_survive_compaction() {
        let before = "# Entities\n\n- **Gundren Rockseeker:** A dwarf merchant, captured by goblins.\n- **Sildar Hallwinter:** A friendly NPC.\n";
        let after = "# Entities\n\n- **Gundren Rockseeker:** Rescued, now allied with the party.\n- **Sildar Hallwinter:** A friendly NPC.\n";
        assert!(dropped_entity_names(before, after).is_empty());
    }

    #[test]
    fn dropped_entity_names_flags_a_name_missing_after_compaction() {
        let before = "# Entities\n\n- **Gundren Rockseeker:** A dwarf merchant.\n- **Sildar Hallwinter:** A friendly NPC.\n";
        let after = "# Entities\n\n- **Sildar Hallwinter:** A friendly NPC.\n";
        assert_eq!(dropped_entity_names(before, after), vec!["Gundren Rockseeker".to_string()]);
    }

    #[test]
    fn dropped_entity_names_flags_an_entry_reformatted_out_of_the_parseable_pattern() {
        // Still mentions "Gundren" in prose, but no longer in the exact
        // "- **Name:** description" shape parse_entities_md (and
        // reconcile_npc_voices_at) depend on — this must count as dropped
        // even though the substring is technically still present.
        let before = "# Entities\n\n- **Gundren Rockseeker:** A dwarf merchant.\n";
        let after = "# Entities\n\nGundren Rockseeker is a dwarf merchant.\n";
        assert_eq!(dropped_entity_names(before, after), vec!["Gundren Rockseeker".to_string()]);
    }

    #[test]
    fn dropped_entity_names_is_case_and_whitespace_insensitive() {
        let before = "# Entities\n\n- **Gundren Rockseeker:** A dwarf merchant.\n";
        let after = "# Entities\n\n- **  gundren rockseeker  :** A dwarf merchant, tightened.\n";
        assert!(dropped_entity_names(before, after).is_empty());
    }

    #[test]
    fn build_compact_entities_prompt_forbids_dropping_named_entries() {
        let prompt = build_compact_entities_prompt("entities", "- **Someone:** A note.", "");
        assert!(prompt.to_lowercase().contains("never remove"));
        assert!(prompt.contains("Someone"));
    }

    #[test]
    fn build_compact_entities_prompt_forbids_dropping_distinguishing_facts_not_just_names() {
        let prompt = build_compact_entities_prompt("entities", "- **Someone:** A note.", "");
        assert!(prompt.to_lowercase().contains("never drop a concrete distinguishing fact"), "must protect description substance, not only names");
        assert!(prompt.to_lowercase().contains("secret"));
        assert!(prompt.to_lowercase().contains("bland role label"), "should name the specific failure mode to avoid");
    }

    #[test]
    fn build_compact_entities_prompt_includes_current_chapter_context_when_present() {
        let prompt = build_compact_entities_prompt(
            "entities",
            "- **Someone:** A note.",
            "The party is currently fighting goblins in the Cragmaw hideout.",
        );
        assert!(prompt.contains("Cragmaw hideout"));
        assert!(prompt.to_lowercase().contains("stay detailed"));
    }

    #[test]
    fn build_compact_entities_prompt_omits_context_block_when_no_chapter_active() {
        let prompt = build_compact_entities_prompt("entities", "- **Someone:** A note.", "");
        assert!(!prompt.to_lowercase().contains("currently happening"));
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
    fn build_trim_chapter_prompt_includes_description_and_a_verbatim_safety_instruction() {
        let prompt = build_trim_chapter_prompt(
            "The party enters the guard room and finds three goblins.",
            "the party defeated the goblins in the guard room",
        );
        assert!(prompt.contains("the party defeated the goblins in the guard room"));
        assert!(prompt.contains("The party enters the guard room and finds three goblins."));
        assert!(prompt.to_lowercase().contains("verbatim"));
        assert!(prompt.to_lowercase().contains("no changes at all") || prompt.to_lowercase().contains("make no changes"));
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
        assert_eq!(read_optional(&root.0.join(&meta.id).join("active_module").join("plan.md")), "");
        assert_eq!(read_optional(&root.0.join(&meta.id).join("active_module").join("current.md")), "");
        assert_eq!(read_optional(&root.0.join(&meta.id).join("memory").join("campaign_lore.md")), "");
    }

    #[test]
    fn build_establish_campaign_prompt_includes_intake_fields_and_inventory_and_scales_length_with_richness() {
        let full = CampaignIntake {
            name: "Curse of Strahd".into(),
            edition: "2014".into(),
            players: "Alex — Thorin".into(),
            module: "Curse of Strahd".into(),
            notes: "Gothic horror tone.".into(),
            lore: "The party is drawn into Barovia by the Mists.".into(),
        };
        let rich_inventory = "- **Strahd von Zarovich** — the vampire lord who rules Barovia.\n- **Madam Eva** — a Vistani fortune teller.";
        let prompt = build_establish_campaign_prompt(&full, rich_inventory);
        assert!(prompt.contains("Curse of Strahd"));
        assert!(prompt.contains("Alex — Thorin"));
        assert!(prompt.contains("Gothic horror tone."));
        assert!(prompt.contains("Strahd von Zarovich"));
        assert!(prompt.to_lowercase().contains("scale"), "should ask the doc's length to scale with inventory richness");

        let blank = build_establish_campaign_prompt(&intake("Homebrew Test"), "");
        assert!(blank.to_lowercase().contains("gave little or nothing to work with"), "should still ask for a serviceable frame when the inventory is blank");

        assert!(full_prompt_has_narrator_voice_trailer_instruction(&prompt));
    }

    fn full_prompt_has_narrator_voice_trailer_instruction(prompt: &str) -> bool {
        prompt.contains("NARRATOR_VOICE:") && prompt.contains("male-gb-1") && prompt.contains("female-gb-1")
    }

    #[test]
    fn extract_narrator_voice_pick_parses_id_and_pitch_and_strips_the_trailer() {
        let (doc, pick) = extract_narrator_voice_pick("## Hub\nThe party operates out of Vallaki.\n\nNARRATOR_VOICE: male-gb-1|large");
        assert_eq!(doc, "## Hub\nThe party operates out of Vallaki.");
        assert_eq!(pick, Some(("male-gb-1".to_string(), Some("large".to_string()))));
    }

    #[test]
    fn extract_narrator_voice_pick_handles_no_pitch_and_a_none_pitch() {
        let (doc, pick) = extract_narrator_voice_pick("## Hub\nSome lore.\nNARRATOR_VOICE: female-us-1");
        assert_eq!(doc, "## Hub\nSome lore.");
        assert_eq!(pick, Some(("female-us-1".to_string(), None)));

        let (_, pick_none) = extract_narrator_voice_pick("## Hub\nSome lore.\nNARRATOR_VOICE: female-us-1|none");
        assert_eq!(pick_none, Some(("female-us-1".to_string(), None)), "a literal 'none' pitch should parse the same as omitted");
    }

    #[test]
    fn extract_narrator_voice_pick_is_a_no_op_when_the_trailer_is_missing_or_not_the_last_line() {
        let (doc, pick) = extract_narrator_voice_pick("## Hub\nThe party operates out of Vallaki.");
        assert_eq!(doc, "## Hub\nThe party operates out of Vallaki.");
        assert_eq!(pick, None);

        // A stray "NARRATOR_VOICE:"-looking line buried mid-doc (not the very
        // last line) should never be mistaken for the trailer.
        let mid_doc = "## Hub\nNARRATOR_VOICE: male-gb-1\nMore lore after it.";
        let (doc2, pick2) = extract_narrator_voice_pick(mid_doc);
        assert_eq!(doc2, mid_doc);
        assert_eq!(pick2, None);
    }

    #[test]
    fn build_inventory_extraction_prompt_includes_the_chunk_and_asks_for_a_flat_list() {
        let prompt = build_inventory_extraction_prompt("The party is drawn into Barovia by the Mists.");
        assert!(prompt.contains("The party is drawn into Barovia by the Mists."));
        assert!(prompt.to_lowercase().contains("plausibly recur"));
        assert!(prompt.to_lowercase().contains("fragment, not the whole picture"), "should tell the model it's only seeing one chunk");
    }

    #[test]
    fn build_update_lore_critique_prompt_checks_coverage_of_both_existing_and_new_content() {
        let prompt = build_update_lore_critique_prompt(
            "## Hub\nThe party operates out of Phandalin. The Zhentarim have a hidden outpost nearby.",
            "## Hub\nThe party operates out of Phandalin.",
            "- **The Zhentarim** — a mercenary company with a hidden outpost nearby.",
        );
        assert!(prompt.contains("The party operates out of Phandalin."), "must include the pre-merge original doc");
        assert!(prompt.contains("The Zhentarim"));
        assert!(prompt.to_lowercase().contains("oversight"), "should ask whether a missing entry is a defensible cut or an oversight");
    }

    #[test]
    fn build_update_lore_critique_prompt_degrades_gracefully_with_an_empty_inventory() {
        let prompt = build_update_lore_critique_prompt("## Hub\n...", "## Hub\n...", "");
        assert!(prompt.contains("(none)"));
    }

    #[test]
    fn build_campaign_lore_critique_prompt_asks_about_coverage_of_missing_inventory_entries() {
        let prompt = build_campaign_lore_critique_prompt(
            "## Hub\nThe party operates out of Vallaki.",
            "- **Strahd von Zarovich** — the vampire lord who rules Barovia.",
        );
        assert!(prompt.contains("The party operates out of Vallaki."));
        assert!(prompt.contains("Strahd von Zarovich"));
        assert!(prompt.to_lowercase().contains("oversight"), "should ask whether a missing entry is a defensible cut or an oversight");
        assert!(full_prompt_has_narrator_voice_trailer_instruction(&prompt));
    }

    #[test]
    fn build_plan_critique_prompt_checks_against_campaign_context_and_degrades_gracefully_with_no_context() {
        let with_context = build_plan_critique_prompt(
            "## How this fits the campaign\nThe party is drawn here by Gundren.\n## This module's own arc\nA goblin ambush.",
            "The party operates out of Phandalin.",
            "1. **The Sunless Citadel** (`the-sunless-citadel`) — a goblin-infested ruin.",
        );
        assert!(with_context.contains("The party operates out of Phandalin."));
        assert!(with_context.contains("The Sunless Citadel"));
        assert!(with_context.to_lowercase().contains("generic fantasy module"));

        let no_context = build_plan_critique_prompt("## How this fits the campaign\n...\n## This module's own arc\n...", "", "");
        assert!(no_context.to_lowercase().contains("no established campaign lore"));
    }

    #[test]
    fn build_update_lore_prompt_includes_existing_doc_and_new_material_and_asks_to_merge_not_append() {
        let prompt = build_update_lore_prompt(
            "## Hub\nThe party operates out of Phandalin.",
            "The Zhentarim have a hidden outpost nearby.",
        );
        assert!(prompt.contains("The party operates out of Phandalin."));
        assert!(prompt.contains("The Zhentarim have a hidden outpost nearby."));
        assert!(prompt.to_lowercase().contains("weave it in"), "should ask for a merge, not a naive append");
    }

    #[test]
    fn build_chapterize_prompt_includes_module_title_instruction() {
        let prompt = build_chapterize_prompt("Document text.");
        assert!(prompt.contains("module_title"));
    }

    #[test]
    fn build_chapterize_prompt_instructs_a_spoiler_free_concerns_self_audit() {
        let prompt = build_chapterize_prompt("Document text.");
        assert!(prompt.contains("\"concerns\""));
        assert!(prompt.to_lowercase().contains("never reveal plot content"));
    }

    #[test]
    fn build_chapter_extraction_prompt_asks_for_facts_not_narrative() {
        let prompt = build_chapter_extraction_prompt("Lost Mine of Phandelver", "Chapter 1: Goblin Arrows", "Sildar Hallwinter is ambushed.");
        assert!(prompt.contains("Lost Mine of Phandelver"));
        assert!(prompt.contains("Chapter 1: Goblin Arrows"));
        assert!(prompt.contains("Sildar Hallwinter is ambushed."));
        assert!(prompt.contains("## NPCs"));
        assert!(prompt.contains("## Items & treasure"));
        assert!(prompt.to_lowercase().contains("do not summarize the narrative"));
    }

    #[test]
    fn build_plan_synthesis_prompt_includes_all_chapter_extracts_and_campaign_context() {
        let extracts = vec![
            ("Chapter 1: Goblin Arrows".to_string(), "- Sildar Hallwinter: captured NPC.".to_string()),
            ("Chapter 2: Cragmaw Hideout".to_string(), "- Klarg: goblin boss.".to_string()),
        ];
        let prompt = build_plan_synthesis_prompt(
            &extracts,
            "The party operates out of Phandalin.",
            "1. **The Sunless Citadel** (`the-sunless-citadel`) — a goblin-infested ruin.",
        );
        assert!(prompt.contains("Sildar Hallwinter"));
        assert!(prompt.contains("Klarg"));
        assert!(prompt.contains("Chapter 1: Goblin Arrows"));
        assert!(prompt.contains("Chapter 2: Cragmaw Hideout"));
        assert!(prompt.contains("The party operates out of Phandalin."));
        assert!(prompt.contains("The Sunless Citadel"));
        assert!(prompt.contains("How this fits the campaign"));
        assert!(prompt.contains("This module's own arc"));
    }

    #[test]
    fn build_plan_synthesis_prompt_degrades_gracefully_with_no_campaign_context() {
        let extracts = vec![("Chapter 1".to_string(), "- Some NPC.".to_string())];
        let prompt = build_plan_synthesis_prompt(&extracts, "", "");
        assert!(prompt.to_lowercase().contains("first module being imported"));
    }

    #[test]
    fn split_into_chunks_is_a_noop_when_text_already_fits() {
        assert_eq!(split_into_chunks("short text", 100), vec!["short text".to_string()]);
    }

    #[test]
    fn split_into_chunks_breaks_at_paragraph_boundaries() {
        let text = format!("{}\n\n{}", "a".repeat(50), "b".repeat(50));
        let chunks = split_into_chunks(&text, 60);
        assert_eq!(chunks, vec![format!("{}\n\n", "a".repeat(50)), "b".repeat(50)]);
    }

    #[test]
    fn split_into_chunks_falls_back_to_a_hard_cut_with_no_paragraph_break() {
        let text = "a".repeat(150);
        let chunks = split_into_chunks(&text, 60);
        assert_eq!(chunks.iter().map(|c| c.chars().count()).collect::<Vec<_>>(), vec![60, 60, 30]);
        assert_eq!(chunks.concat(), text);
    }

    #[test]
    fn split_into_chunks_never_splits_a_multibyte_char() {
        let text = format!("{}é", "a".repeat(60));
        let chunks = split_into_chunks(&text, 60);
        assert_eq!(chunks.concat(), text); // would have panicked on a bad byte-boundary cut instead
    }

    #[test]
    fn total_extraction_chunks_sums_chunk_counts_across_every_chapter() {
        // Chapter 1 fits in one chunk; chapter 2 needs a hard cut into two;
        // chapter 3 is empty (still one "chunk" — split_into_chunks is a
        // no-op on text that already fits, even empty text).
        let chapters = vec![
            ("Ch1".to_string(), "heading1".to_string(), "short".to_string()),
            ("Ch2".to_string(), "heading2".to_string(), "a".repeat(150)),
            ("Ch3".to_string(), "heading3".to_string(), "".to_string()),
        ];
        assert_eq!(split_into_chunks(&chapters[1].2, EXTRACTION_CHUNK_MAX_CHARS).len(), 1, "150 chars is well under the real 80k limit");
        // Use a tiny max so the "needs more than one chunk" branch is actually exercised here.
        let small_max = 60;
        let total: usize = chapters.iter().map(|(_, _, body)| split_into_chunks(body, small_max).len()).sum();
        assert_eq!(total, 1 + 3 + 1, "5 total chunks: 1 (short) + 3 (150 chars @ 60/chunk) + 1 (empty)");
        assert_eq!(total_extraction_chunks(&chapters), 3, "at the REAL EXTRACTION_CHUNK_MAX_CHARS, every chapter here is one chunk");
    }

    #[test]
    fn parse_chapterize_reply_defaults_concerns_to_empty_when_absent() {
        let no_concerns = r#"{"chapters":[{"heading":"Chapter 1","summary":"Intro."}]}"#;
        let parsed = parse_chapterize_reply(no_concerns).unwrap();
        assert!(parsed.concerns.is_empty());

        let with_concerns = r#"{"chapters":[{"heading":"Chapter 1","summary":"Intro."}],"concerns":["Chapter 2 came out much shorter than the others."]}"#;
        let parsed2 = parse_chapterize_reply(with_concerns).unwrap();
        assert_eq!(parsed2.concerns, vec!["Chapter 2 came out much shorter than the others."]);
    }

    #[test]
    fn coverage_concern_is_none_when_most_of_the_source_is_covered() {
        assert_eq!(coverage_concern(1000, 950), None);
        assert_eq!(coverage_concern(0, 0), None); // no source text at all — nothing to compare
    }

    #[test]
    fn coverage_concern_flags_when_a_large_portion_of_the_source_is_missing() {
        let note = coverage_concern(1000, 500).expect("50% coverage should be flagged");
        assert!(note.contains("50%"));
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
        let plain = "{\"chapters\":[{\"heading\":\"Chapter 1: Goblin Arrows\",\"summary\":\"An ambush on the road.\"}]}";
        let parsed = parse_chapterize_reply(plain).unwrap();
        assert_eq!(parsed.chapters[0].heading, "Chapter 1: Goblin Arrows");

        let fenced = "```json\n{\"chapters\":[{\"heading\":\"Chapter 1\",\"summary\":\"Intro.\"}]}\n```";
        let parsed2 = parse_chapterize_reply(fenced).unwrap();
        assert_eq!(parsed2.chapters[0].heading, "Chapter 1");

        assert!(parse_chapterize_reply("not json at all").is_err());
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
    fn split_by_headings_uses_clean_title_for_display_not_the_garbled_match_anchor() {
        // Simulates the real complaint: the exact-match "heading" is clipped/
        // garbled for match-safety, but "title" (a separate, clean field) is
        // what should actually show up as the chapter name.
        let text = "Chapter 1: About\nSome intro text.\nChapter 2: The Cave\nMore text.\n";
        let headings = vec![
            ChapterHeading { title: "Chapter 1: About the Village".into(), heading: "Chapter 1: About".into(), summary: "Intro.".into() },
            heading("Chapter 2: The Cave", "Cave."),
        ];
        let chapters = split_by_headings(text, &headings);
        assert_eq!(chapters[0].0, "Chapter 1: About the Village", "display title should use the clean title, not the clipped match anchor");
    }

    #[test]
    fn split_by_headings_falls_back_to_heading_when_title_is_missing() {
        // Older/incomplete replies before `title` existed (or one that just
        // omitted it) shouldn't lose their chapter name entirely.
        let headings = vec![ChapterHeading { title: String::new(), heading: "Chapter 1: Goblin Arrows".into(), summary: "Ambush.".into() }];
        let chapters = split_by_headings("Chapter 1: Goblin Arrows\nText.", &headings);
        assert_eq!(chapters[0].0, "Chapter 1: Goblin Arrows");
    }

    #[test]
    fn build_chapterize_prompt_instructs_separate_title_and_unique_heading() {
        let prompt = build_chapterize_prompt("Document text.");
        assert!(prompt.contains("\"title\""));
        assert!(prompt.to_lowercase().contains("never truncate it mid-word"));
        assert!(prompt.to_lowercase().contains("unique"));
        assert!(prompt.to_lowercase().contains("pure-reference material"));
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
        let (module_id, summaries) = write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), plan, "Lost Mine of Phandelver").unwrap();

        assert_eq!(module_id, "lost-mine-of-phandelver");
        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[0].id, "chapter-01-chapter-1-goblin-arrows");

        let module_dir = root.0.join(&meta.id).join("modules").join(&module_id);
        assert!(fs::read_to_string(module_dir.join(format!("{}.md", summaries[0].id))).unwrap().contains("Full text of chapter 1"));
        assert!(fs::read_to_string(module_dir.join("current.md")).unwrap().contains("Full text of chapter 1"));
        assert_eq!(fs::read_to_string(module_dir.join("current_id.txt")).unwrap(), summaries[0].id);
        assert!(fs::read_to_string(module_dir.join("plan.md")).unwrap().contains("Cragmaw Castle"));

        let index_md = fs::read_to_string(module_dir.join("index.md")).unwrap();
        assert!(index_md.contains("CURRENT CHAPTER"));
        assert!(index_md.contains("Cragmaw Hideout"));

        // The campaign-root indirection mirrors the (only, active) module.
        let active_dir = root.0.join(&meta.id).join("active_module");
        assert!(fs::read_to_string(active_dir.join("current.md")).unwrap().contains("Full text of chapter 1"));
        assert_eq!(fs::read_to_string(root.0.join(&meta.id).join("modules").join("active_id.txt")).unwrap(), module_id);

        let modules_index = fs::read_to_string(root.0.join(&meta.id).join("modules_index.md")).unwrap();
        assert!(modules_index.contains("Lost Mine of Phandelver"));
        assert!(modules_index.contains("ACTIVE"));

        let claude_md = fs::read_to_string(root.0.join(&meta.id).join("CLAUDE.md")).unwrap();
        assert!(claude_md.contains("@modules_index.md"));
        assert!(claude_md.contains("@active_module/index.md"));
        assert!(claude_md.contains("@active_module/current.md"));

        // Importing a SECOND module coexists with the first (no wipe), and
        // the standing-import block still isn't duplicated.
        let (module_id_2, _) = write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), plan, "A Different Module").unwrap();
        assert_ne!(module_id, module_id_2);
        assert!(root.0.join(&meta.id).join("modules").join(&module_id).join("manifest.json").exists(), "first module must still exist");
        assert!(root.0.join(&meta.id).join("modules").join(&module_id_2).join("manifest.json").exists());
        let reimported = fs::read_to_string(root.0.join(&meta.id).join("CLAUDE.md")).unwrap();
        assert_eq!(reimported.matches("@active_module/current.md").count(), 1);
        // The newly-imported module automatically becomes active.
        assert_eq!(fs::read_to_string(root.0.join(&meta.id).join("modules").join("active_id.txt")).unwrap(), module_id_2);
    }

    /// Real integration check against the actual `claude` CLI — not run as
    /// part of the normal `cargo test` suite (needs a live, authenticated
    /// `claude` on PATH and makes real Opus calls), but exercises the actual
    /// 4-stage pipeline end-to-end (see chapterize_and_import_module_at's doc
    /// comment): real subprocess calls, real JSON parsing, real file writes.
    /// A small synthetic 2-chapter module keeps it cheap (a handful of calls,
    /// not the ~dozen+ a real module import costs) while still proving the
    /// map/reduce restructuring didn't break anything only a live run can
    /// catch — in particular, that a fact from chapter 1's extraction pass
    /// actually survives into the synthesis pass's plan, rather than the
    /// pipeline silently producing a hole where the raw-text read used to be.
    /// Run with:
    ///   cargo test --lib -- --ignored --nocapture chapterize_and_import_module_at_end_to_end
    #[test]
    #[ignore]
    fn chapterize_and_import_module_at_end_to_end() {
        let root = Scratch::new("chapterize-e2e");
        let meta = create_campaign_at(&root.0, &intake("Test Module")).unwrap();

        let raw_text = "\
INTRODUCTION

This is a short test scenario for verifying the ingestion pipeline end to end.

CHAPTER 1: THE AMBUSH AT REDSTONE BRIDGE

The party is traveling the King's Road when they are ambushed by a group of bandits led by a woman named Vera Blackwood, a disgraced former town guard seeking revenge on the merchant who ruined her family. She wields a magic dagger called the Whisperfang, which can cast Silence once per day. If the party spares her, she reveals that her old commanding officer, Captain Aldric Renn, is secretly working with a smuggling ring based in the town of Millhaven.

CHAPTER 2: MILLHAVEN'S SECRET

The party arrives in Millhaven, a small fishing town of about 200 people. The town is run by Mayor Osric Penn, who is unaware of Captain Renn's smuggling operation. The smugglers meet at the old lighthouse every new moon. Inside the lighthouse, the party finds a locked chest requiring a DC 15 Dexterity check to pick, containing 200 gold pieces and a map showing a hidden cave along the coast — the location of the campaign's next adventure.
";

        let result = chapterize_and_import_module_at(&root.0, &meta.id, raw_text, &no_progress).unwrap();
        println!("=== RESULT ===\n{result:#?}");
        assert_eq!(result.chapters.len(), 2, "should detect exactly 2 narrative chapters, got: {:?}", result.chapters);

        let module_dir = root.0.join(&meta.id).join("modules").join(&result.module_id);
        let plan = fs::read_to_string(module_dir.join("plan.md")).unwrap();
        println!("=== PLAN ===\n{plan}\n");
        assert!(plan.contains("How this fits the campaign"));
        assert!(plan.contains("This module's own arc"));
        // The real proof the map->reduce pipeline actually carried a detail
        // through (not just "didn't crash"): a named NPC from chapter 1 shows
        // up in a plan synthesized from EXTRACTED FACTS, never the raw text.
        assert!(
            plan.contains("Vera") || plan.contains("Blackwood"),
            "plan should mention chapter 1's named NPC — got:\n{plan}"
        );

        let chapter1 = fs::read_to_string(module_dir.join(format!("{}.md", result.chapters[0].id))).unwrap();
        assert!(chapter1.contains("Whisperfang"), "chapter text on disk must be the verbatim original, not a rewrite");
    }

    /// Real integration check against the actual `claude` CLI — same "not run
    /// as part of the normal suite" reasoning as
    /// chapterize_and_import_module_at_end_to_end. Seeds an EXISTING
    /// campaign_lore.md directly (skipping establish_campaign_lore_at) to
    /// keep this test focused purely on update_campaign_lore_at's own
    /// pipeline, then folds in a synthetic "addition" containing a new named
    /// NPC. The one thing this test actually needs to prove: the merged doc
    /// keeps BOTH the pre-existing named entity AND the new one — the exact
    /// failure mode a single unprotected merge call was at risk of before
    /// this had an inventory (map) + coverage-critique step.
    /// Run with:
    ///   cargo test --lib -- --ignored --nocapture update_campaign_lore_at_end_to_end
    #[test]
    #[ignore]
    fn update_campaign_lore_at_end_to_end() {
        let root = Scratch::new("update-lore-e2e");
        let meta = create_campaign_at(&root.0, &intake("Test Campaign")).unwrap();
        let lore_path = root.0.join(&meta.id).join("memory").join("campaign_lore.md");
        write_atomic(
            &lore_path,
            "# Campaign Lore\n\n## Hub\nThe party operates out of the town of Redstone, home to the retired adventurer Elowen Vance, who runs the tavern where they meet contacts.\n\n## Threads\nElowen has hinted at a debt owed to a mysterious patron she won't name.",
        )
        .unwrap();

        let addition = "\
A new sourcebook chapter introduces the Ashfen Concord, a coalition of three swamp villages led by Chief Data Reyes, who has been raiding merchant caravans along the Redstone road to fund a ritual meant to hold back an encroaching curse. The Concord is not purely hostile — Chief Reyes will parley if approached with an offering of iron.
";

        let updated = update_campaign_lore_at(&root.0, &meta.id, addition).unwrap();
        println!("=== UPDATED LORE ===\n{updated}\n");

        assert!(updated.contains("Elowen") || updated.contains("Vance"), "pre-existing NPC must survive the merge — got:\n{updated}");
        assert!(updated.contains("Redstone"), "pre-existing hub location must survive the merge — got:\n{updated}");
        assert!(updated.contains("Reyes") || updated.contains("Ashfen"), "new material's named entity must actually get folded in — got:\n{updated}");

        let on_disk = fs::read_to_string(&lore_path).unwrap();
        assert_eq!(on_disk, updated, "returned text must match what's actually on disk");

        let backup = fs::read_to_string(lore_path.with_file_name("campaign_lore.md.bak")).unwrap();
        assert!(backup.contains("Elowen"), "the pre-merge doc must have been backed up before overwriting");
    }

    /// Real integration check of the whole session-digest pipeline against the
    /// actual `claude` CLI — same "not in the normal suite" reasoning as the
    /// other *_end_to_end tests. Feeds a synthetic verbatim transcript and
    /// proves the three things a live run must get right that no unit test
    /// can: (1) the raw transcript is saved losslessly for retrieval, (2) a
    /// named NPC from the transcript is actually extracted into entities.md,
    /// and (3) a compact line lands in the always-loaded session_index.md —
    /// AND that a player character is NOT mistakenly logged as an entity.
    /// Run with:
    ///   cargo test --lib -- --ignored --nocapture digest_session_at_end_to_end
    #[test]
    #[ignore]
    fn digest_session_at_end_to_end() {
        let root = Scratch::new("digest-e2e");
        let meta = create_campaign_at(&root.0, &intake("Test Campaign")).unwrap();

        let transcript = "\
DM: You're on the road to Redstone when a woman steps from the treeline — Vera Blackwood, a scarred ex-guard with a wolf's-head cloak. She levels a crossbow and demands your cargo.
Player (Thorin): I keep my hands visible and ask what she really wants.
DM: Her jaw tightens. 'What I want is Captain Renn's head. He framed my brother.' She lowers the bow a fraction — she's testing you.
Player (Thorin): I tell her we have no love for Renn either, and offer to hear her out.
DM: She studies you, then nods toward a cold campfire in the trees. Over the next hour she explains: Renn runs the smuggling ring out of the Gilded Eel tavern in Redstone, and she'll help you reach him if you swear to bring him in alive so he can confess. You give your word.
Player (Thorin): We shake on it.
DM: The deal is struck. Vera melts back into the woods, promising to meet you at the Gilded Eel at dusk.";

        let summary = digest_session_at(&root.0, &meta.id, "2026-07-13", transcript).unwrap();
        println!("=== SUMMARY ===\n{summary}\n");

        let dir = root.0.join(&meta.id);
        let record = fs::read_to_string(dir.join(SESSION_RECORDS_DIR).join("session-01.md")).unwrap();
        assert!(record.contains("Vera Blackwood, a scarred ex-guard"), "the verbatim transcript must be saved losslessly");

        let entities = fs::read_to_string(dir.join("memory").join("entities.md")).unwrap();
        println!("=== ENTITIES ===\n{entities}\n");
        assert!(entities.contains("Vera") || entities.contains("Blackwood"), "the named NPC must be extracted into entities.md — got:\n{entities}");
        assert!(!entities.to_lowercase().contains("thorin"), "the player character must NOT be logged as an entity — got:\n{entities}");

        let index = fs::read_to_string(dir.join("memory").join("session_index.md")).unwrap();
        println!("=== SESSION INDEX ===\n{index}\n");
        assert!(index.contains("session-01"), "a compact line must land in the always-loaded session index — got:\n{index}");

        // The promise the party made should be captured somewhere durable
        // (a flagged fact, or folded into Vera's entity description).
        let flagged = fs::read_to_string(dir.join("memory").join("flagged_facts.md")).unwrap();
        println!("=== FLAGGED FACTS ===\n{flagged}\n");
    }

    /// The stale plan this pair of e2e tests exercises: its entire climax is
    /// confronting one named NPC at one named place, on a schedule.
    const E2E_STALE_PLAN: &str = "\
## How this fits the campaign
The party operates out of Redstone and is hunting a smuggling ring.

## This module's own arc
The climax of this module is the confrontation with **Captain Aldric Renn** at the **Gilded Eel** tavern on the night of the new moon — everything else builds toward getting the party there. Key NPC to track: Captain Renn, the smuggler-captain, who must be taken alive at the Gilded Eel so he can confess.

**Pacing:** steer the party toward the Gilded Eel by the end of session 4. Foreshadow the new moon relentlessly.";

    /// Real integration check of the plan-reconciliation pass against the actual
    /// `claude` CLI — the one thing no unit test can reach, since the whole
    /// question is whether the model actually NOTICES the campaign has moved past
    /// the plan. Sets up the exact rot this was built for: a plan whose entire
    /// climax is confronting an NPC at a place, and a session in which the party
    /// kills that NPC somewhere else and burns the place to the ground.
    /// Run with:
    ///   cargo test --lib -- --ignored --nocapture reconcile_module_plan_at_end_to_end
    #[test]
    #[ignore]
    fn reconcile_module_plan_at_end_to_end() {
        let root = Scratch::new("reconcile-e2e");
        let meta = create_campaign_at(&root.0, &intake("Redstone")).unwrap();
        let (module_id, _) =
            write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), E2E_STALE_PLAN, "Redstone Conspiracy").unwrap();

        // The party goes completely off-plan: Renn dies on the road, nowhere near
        // the Gilded Eel, and the Gilded Eel itself burns down. Every load-bearing
        // element of the plan above is now void.
        let transcript = "\
DM: You spot Captain Aldric Renn's carriage on the King's Road, far from town — he's fleeing Redstone tonight, not waiting for the new moon.
Player (Thorin): We ambush the carriage. I put an arrow through him before he can draw.
DM: Your arrow takes Renn in the throat. He is dead before he hits the gravel — whatever confession you wanted from him died with him.
Player (Thorin): We search the body, then ride back toward town.
DM: As you crest the hill you see the Gilded Eel is a pillar of flame. Someone torched it to bury the evidence. By dawn it's a blackened shell: the smuggling ring's meeting place is gone, and so is the man who ran it.";

        let summary = digest_session_at(&root.0, &meta.id, "2026-07-14", transcript).unwrap();
        println!("=== SESSION SUMMARY ===\n{summary}\n");

        let dir = root.0.join(&meta.id);
        println!("=== ENTITIES ===\n{}\n", fs::read_to_string(dir.join("memory").join("entities.md")).unwrap());

        let revised = fs::read_to_string(dir.join("modules").join(&module_id).join("plan.md")).unwrap();
        println!("=== REVISED PLAN ===\n{revised}\n");

        assert_ne!(
            revised.trim(),
            E2E_STALE_PLAN.trim(),
            "the plan must actually change — the party invalidated its entire climax"
        );
        let lower = revised.to_lowercase();
        assert!(
            ["dead", "killed", "died", "destroyed", "burned", "burnt", "no longer", "resolved"]
                .iter()
                .any(|m| lower.contains(m)),
            "the revised plan should acknowledge Renn's death / the Gilded Eel's destruction — got:\n{revised}"
        );

        // Regression: a first live run had the model copying the CONTEXT blocks
        // (the entities/locations/flagged-facts registries) straight into
        // plan.md. Those are already standing imports loaded every turn, so the
        // plan would re-inject duplicates of them at every check-in.
        for leaked in ["# Entities", "# Locations", "# Flagged Facts", "What happened in the session"] {
            assert!(!revised.contains(leaked), "context leaked into the plan (\"{leaked}\") — got:\n{revised}");
        }
        assert!(
            revised.len() < E2E_STALE_PLAN.len() * 3,
            "the revised plan ballooned ({} chars vs {} before) — it's a revision, not an append:\n{revised}",
            revised.len(),
            E2E_STALE_PLAN.len()
        );

        // The old plan must stay recoverable, and the MIRRORED copy is the one the
        // turn-level check-in actually reads (read_campaign_plan) — if that isn't
        // re-synced, the revision never reaches the DM.
        let backup = fs::read_to_string(dir.join("modules").join(&module_id).join("plan.md.bak")).unwrap();
        assert!(backup.contains("Gilded Eel"), "the pre-reconciliation plan must be backed up");
        let mirrored = fs::read_to_string(dir.join("active_module").join("plan.md")).unwrap();
        assert_eq!(mirrored.trim(), revised.trim(), "active_module/plan.md must carry the revision");
    }

    /// Real integration check of the LOCAL ingestion path (local_llm.rs's
    /// set_ingestion_provider / ask_ingest_once) — the one thing shipped without
    /// ever being run against a real server. Drives a genuine session digest
    /// through a local OpenAI-compatible server, which is the HARDEST ingestion
    /// prompt for a small model: it's the `expect_json` path, so the reply has to
    /// come back as a parseable JSON object under guided decoding, and the facts
    /// inside it have to actually be right enough to land in the registries.
    ///
    /// Needs a local server up (e.g. vLLM on :8000). Run with:
    ///   cargo test --lib -- --ignored --nocapture local_ingestion_end_to_end
    /// Override the defaults with LOCAL_INGEST_URL / LOCAL_INGEST_MODEL.
    #[test]
    #[ignore]
    fn local_ingestion_end_to_end() {
        let base_url = std::env::var("LOCAL_INGEST_URL").unwrap_or_else(|_| "http://localhost:8000".to_string());
        let model = std::env::var("LOCAL_INGEST_MODEL").unwrap_or_else(|_| "Qwen/Qwen3-30B-A3B-GPTQ-Int4".to_string());
        println!("=== ingesting via LOCAL model: {model} @ {base_url} ===");

        let root = Scratch::new("local-ingest-e2e");
        let meta = create_campaign_at(&root.0, &intake("Local Test")).unwrap();

        // Point ALL ingestion at the local server. Restored at the end so this
        // can't leak into any other test in the same process.
        crate::local_llm::set_ingestion_provider(true, base_url, model);

        let transcript = "\
DM: The gate guard, a heavyset woman named Serla Vance, blocks your way into Thornwick. She wants a toll of ten gold, and she is not in a mood to haggle.
Player (Thorin): I tell her we're here on the baron's business and show her the seal.
DM: Serla squints at the seal, then waves you through. \"Baron's business,\" she mutters. \"Then you'll want the Brass Lantern — that's where his man drinks.\"
Player (Thorin): We head for the Brass Lantern.
DM: The Brass Lantern is a low tavern by the river. Inside, the baron's man — a nervous clerk called Pell Otwin — is already three cups deep, and he flinches when he sees the seal.";

        let result = digest_session_at(&root.0, &meta.id, "2026-07-14", transcript);

        // Always restore the Claude default before asserting, so a failure here
        // can't poison the process-global config for anything that follows.
        crate::local_llm::set_ingestion_provider(false, String::new(), String::new());

        let summary = result.expect("local ingestion should complete — is the local server actually running?");
        println!("=== SUMMARY (from the local model) ===\n{summary}\n");

        let dir = root.0.join(&meta.id);
        let entities = fs::read_to_string(dir.join("memory").join("entities.md")).unwrap();
        let locations = fs::read_to_string(dir.join("memory").join("locations.md")).unwrap();
        println!("=== ENTITIES ===\n{entities}\n=== LOCATIONS ===\n{locations}\n");

        // The real bar: the local model's JSON actually parsed AND its facts
        // reached the registries. A garbled reply would leave these empty.
        let lower_entities = entities.to_lowercase();
        assert!(
            lower_entities.contains("serla") || lower_entities.contains("pell") || lower_entities.contains("otwin"),
            "a named NPC from the transcript must reach entities.md — got:\n{entities}"
        );
        assert!(
            !lower_entities.contains("thorin"),
            "the player character must NOT be logged as an entity — got:\n{entities}"
        );
        assert!(
            fs::read_to_string(dir.join("memory").join("session_index.md")).unwrap().contains("session-01"),
            "the session index line must still be written on the local path"
        );
        assert!(
            dir.join(SESSION_RECORDS_DIR).join("session-01.md").exists(),
            "the verbatim record must still be saved on the local path"
        );
    }

    /// The one question about the retrieval system that NO unit test can answer:
    /// given a compact session index and a player asking for a detail that lives
    /// only inside an old session's full record, does the DM actually reach for
    /// the `recallSession` action on its own? Everything else about retrieval is
    /// mechanically tested (the record is written, the read is path-guarded, the
    /// injection compiles) — this is the behavioural seam, and it needs a real
    /// turn with the campaign's CLAUDE.md + session_index.md genuinely loaded.
    ///
    /// The index line is deliberately VAGUE about the specifics the player asks
    /// for, and those specifics appear nowhere else — not in entities.md, not in
    /// the index. Recalling the record is the only honest way to answer.
    /// Run with:
    ///   cargo test --lib -- --ignored --nocapture recall_session_behavioral_loop
    #[test]
    #[ignore]
    fn recall_session_behavioral_loop() {
        let root = Scratch::new("recall-e2e");
        let meta = create_campaign_at(&root.0, &intake("Fogreach")).unwrap();
        let dir = root.0.join(&meta.id);

        append_session_index_line_at(
            &root.0,
            &meta.id,
            "session-01",
            "2026-06-01",
            "The party met a blind elder in Fogreach and learned something about who poisoned the well.",
        )
        .unwrap();

        let records = dir.join(SESSION_RECORDS_DIR);
        fs::create_dir_all(&records).unwrap();
        fs::write(
            records.join("session-01.md"),
            "# session-01 (2026-06-01)\n\n\
DM: The blind elder, Marta Ashgrove, grips your sleeve. \"The well wasn't poisoned by the Ashfen,\" she whispers. \"It was Reeve Calder. He did it to blame them — and he paid a hedge-witch named Ossic to brew the draught.\"\n\
Player (Thorin): Who is Ossic?\n\
DM: \"A hedge-witch out in the fen. Calder paid her forty gold. She kept the receipt — she never trusted him.\"\n",
        )
        .unwrap();

        let prompt = "Current party status:\nThorin (Alex) — L3 fighter/3 | HP 20/20 | —\n\n\
The player playing Thorin says: Hang on — remind me exactly who poisoned the well, and who did they pay to actually brew it? I want the specific names, not a vague recollection.";

        let reply = crate::dm::ask_claude_once_in(prompt.to_string(), dir.clone(), Some("sonnet")).unwrap();
        println!("=== DM REPLY ===\n{reply}\n");

        assert!(
            reply.contains("recallSession"),
            "the DM should reach for recallSession when the index alone can't answer the question — got:\n{reply}"
        );
        assert!(
            reply.contains("session-01"),
            "and should name the session id straight off the index — got:\n{reply}"
        );
    }

    /// The other half of the design, and the more dangerous failure: the plan is
    /// expensive ingestion output, and MOST sessions invalidate nothing. A session
    /// that merely advances along the plan must NOT get the still-live arc
    /// rewritten out from under it.
    /// Run with:
    ///   cargo test --lib -- --ignored --nocapture reconcile_module_plan_at_leaves_a_still_live_plan_intact
    #[test]
    #[ignore]
    fn reconcile_module_plan_at_leaves_a_still_live_plan_intact() {
        let root = Scratch::new("reconcile-e2e-noop");
        let meta = create_campaign_at(&root.0, &intake("Redstone")).unwrap();
        let (module_id, _) =
            write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), E2E_STALE_PLAN, "Redstone Conspiracy").unwrap();

        // A session that goes entirely TO plan: Renn is alive, the Gilded Eel
        // stands, the new moon hasn't come. Nothing is resolved or invalidated.
        let transcript = "\
DM: The road to Redstone is quiet. Word in the villages is that Captain Renn hasn't been seen in a week, but the Gilded Eel is still serving every night.
Player (Thorin): We keep heading for Redstone. How long until the new moon?
DM: Three nights, by your reckoning. You make camp off the road.
Player (Thorin): We rest and push on at first light.
DM: You reach the outskirts of Redstone by dusk. Across the square, the Gilded Eel's lantern is lit.";

        digest_session_at(&root.0, &meta.id, "2026-07-14", transcript).unwrap();

        let revised = fs::read_to_string(root.0.join(&meta.id).join("modules").join(&module_id).join("plan.md")).unwrap();
        println!("=== PLAN AFTER A NON-DIVERGING SESSION ===\n{revised}\n");

        let lower = revised.to_lowercase();
        assert!(lower.contains("renn"), "a still-live key NPC must survive a session that never touched him — got:\n{revised}");
        assert!(lower.contains("gilded eel"), "the still-live climax location must survive — got:\n{revised}");
    }

    #[test]
    fn unique_module_id_disambiguates_collisions() {
        let root = Scratch::new("unique-id");
        let modules_root = root.0.join("modules");
        fs::create_dir_all(modules_root.join("the-sunless-citadel")).unwrap();
        assert_eq!(unique_module_id(&modules_root, "The Sunless Citadel"), "the-sunless-citadel-2");
        fs::create_dir_all(modules_root.join("the-sunless-citadel-2")).unwrap();
        assert_eq!(unique_module_id(&modules_root, "The Sunless Citadel"), "the-sunless-citadel-3");
        // No collision at all — untouched.
        assert_eq!(unique_module_id(&modules_root, "A Fresh Title"), "a-fresh-title");
    }

    #[test]
    fn advance_chapter_updates_current_pointer_and_index_marker() {
        let root = Scratch::new("advance");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        let (module_id, summaries) = write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), "Test plan.", "Lost Mine").unwrap();
        let second_id = summaries[1].id.clone();

        advance_chapter_at(&root.0, &meta.id, &second_id).unwrap();

        let module_dir = root.0.join(&meta.id).join("modules").join(&module_id);
        assert_eq!(fs::read_to_string(module_dir.join("current_id.txt")).unwrap(), second_id);
        assert!(fs::read_to_string(module_dir.join("current.md")).unwrap().contains("Full text of chapter 2"));
        let index_md = fs::read_to_string(module_dir.join("index.md")).unwrap();
        // The marker should have moved off chapter 1 and onto chapter 2.
        let ch1_line = index_md.lines().find(|l| l.contains("Goblin Arrows")).unwrap();
        let ch2_line = index_md.lines().find(|l| l.contains("Cragmaw Hideout")).unwrap();
        assert!(!ch1_line.contains("CURRENT CHAPTER"));
        assert!(ch2_line.contains("CURRENT CHAPTER"));

        // The active_module indirection must reflect the new chapter too.
        assert!(fs::read_to_string(root.0.join(&meta.id).join("active_module").join("current.md")).unwrap().contains("Full text of chapter 2"));
    }

    #[test]
    fn advance_chapter_rejects_unknown_id() {
        let root = Scratch::new("advance-bad");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), "Test plan.", "Lost Mine").unwrap();
        let err = advance_chapter_at(&root.0, &meta.id, "chapter-99-nonexistent").unwrap_err();
        assert!(err.contains("Unknown chapter id"));
    }

    #[test]
    fn advance_chapter_errors_when_no_module_is_active() {
        let root = Scratch::new("advance-no-module");
        let meta = create_campaign_at(&root.0, &intake("Fresh")).unwrap();
        let err = advance_chapter_at(&root.0, &meta.id, "chapter-01-anything").unwrap_err();
        assert!(err.contains("No active module"));
    }

    #[test]
    fn get_module_chapters_reflects_none_then_imported_state() {
        let root = Scratch::new("get-chapters");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();

        let (chapters, current) = get_module_chapters_at(&root.0, &meta.id, "nonexistent-module").unwrap();
        assert!(chapters.is_empty());
        assert!(current.is_none());

        let (module_id, summaries) = write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), "Test plan.", "Lost Mine").unwrap();
        let (chapters2, current2) = get_module_chapters_at(&root.0, &meta.id, &module_id).unwrap();
        assert_eq!(chapters2.len(), 2);
        assert_eq!(current2, Some(summaries[0].id.clone()));
    }

    #[test]
    fn list_campaign_modules_at_reflects_none_then_multiple_with_correct_active_id() {
        let root = Scratch::new("list-modules");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();

        let empty = list_campaign_modules_at(&root.0, &meta.id).unwrap();
        assert!(empty.modules.is_empty());
        assert!(empty.active_id.is_none());

        let (id1, _) = write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), "Plan 1.", "Module One").unwrap();
        let (id2, _) = write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), "Plan 2.", "Module Two").unwrap();

        let both = list_campaign_modules_at(&root.0, &meta.id).unwrap();
        assert_eq!(both.modules.len(), 2);
        assert_eq!(both.active_id, Some(id2.clone()), "the most recently imported module becomes active");
        assert!(both.modules.iter().any(|m| m.id == id1));
        assert!(both.modules.iter().any(|m| m.id == id2));
    }

    #[test]
    fn set_active_module_at_rejects_unknown_id_without_writing_anything() {
        let root = Scratch::new("set-active-bad");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        let (real_id, _) = write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), "Plan.", "Real Module").unwrap();

        let err = set_active_module_at(&root.0, &meta.id, "does-not-exist").unwrap_err();
        assert!(err.contains("Unknown module id"));
        // active_id.txt must still point at whatever was active before the failed call.
        assert_eq!(read_active_module_id_at(&root.0, &meta.id), Some(real_id));
    }

    #[test]
    fn set_active_module_at_preserves_each_modules_own_chapter_progress_across_switches() {
        let root = Scratch::new("set-active-progress");
        let meta = create_campaign_at(&root.0, &intake("Lost Mine")).unwrap();
        let (id_a, chapters_a) = write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), "Plan A.", "Module A").unwrap();
        let (id_b, _) = write_chapters_to_disk(&root.0, &meta.id, &sample_chapters(), "Plan B.", "Module B").unwrap();

        // Module B is active after import; switch back to A and advance a chapter in it.
        set_active_module_at(&root.0, &meta.id, &id_a).unwrap();
        advance_chapter_at(&root.0, &meta.id, &chapters_a[1].id).unwrap();
        assert!(fs::read_to_string(root.0.join(&meta.id).join("active_module").join("current.md")).unwrap().contains("Full text of chapter 2"));

        // Switch to B, then back to A — A must resume at chapter 2, not reset to chapter 1.
        set_active_module_at(&root.0, &meta.id, &id_b).unwrap();
        set_active_module_at(&root.0, &meta.id, &id_a).unwrap();
        let (_, current_a) = get_module_chapters_at(&root.0, &meta.id, &id_a).unwrap();
        assert_eq!(current_a, Some(chapters_a[1].id.clone()));
        assert!(fs::read_to_string(root.0.join(&meta.id).join("active_module").join("current.md")).unwrap().contains("Full text of chapter 2"));
    }
}

#[cfg(test)]
mod example_map_tests {
    use super::*;

    /// The worked example in battle_map_format_instructions is teaching material:
    /// if it violated our own rules we would be training the model to violate
    /// them. Pin it against the real validator.
    #[test]
    fn the_prompts_worked_example_passes_our_own_validator() {
        let instr = battle_map_format_instructions(false, false, &[], &[]);
        let spec = instr
            .split(MAP_SPEC_DELIMITER)
            .find(|s| s.contains("# The Bent Nail"))
            .expect("example map not found in the prompt");
        let spec = spec.trim();
        assert_eq!(validate_map_spec(spec), Vec::<String>::new(), "spec was:\n{spec}");
        // ...and normalizing it must be a no-op — it's already sound.
        assert_eq!(normalize_map_spec(spec).trim(), spec);
    }

    /// Live evidence (test-campaign "Bar Fight", two separate generations on
    /// 2026-07-17) showed the model drawing stool clusters as `^` — the
    /// existing "vary the size" rule taught it stools are small, but never
    /// said small furniture is still `=`, so it reached for rubble's dotted
    /// rendering instead. Pin that the explicit correction is actually in
    /// the prompt the model sees.
    #[test]
    fn battle_map_format_instructions_explicitly_forbids_drawing_a_seat_as_rubble() {
        let full = battle_map_format_instructions(false, false, &[], &[]);
        assert!(full.contains("NEVER draw a seat with `^`"), "{full}");
        // The streamlined variant phrases it more tersely, but the same
        // correction — stools are `=`, never `^` — must still be in there.
        let streamlined = battle_map_format_instructions(true, false, &[], &[]);
        assert!(streamlined.contains("never `^`"), "{streamlined}");
        // Live evidence (test-campaign "Tavern Brawl", 2026-07-19): the model
        // used `^` for "overturned chairs" as difficult terrain, which the
        // renderer paints as grey rocks in the middle of a wooden tavern. Both
        // variants must now warn `^` is stone-only, so brawl clutter routes to
        // furniture/Objects instead.
        assert!(full.to_lowercase().contains("grey stone rocks"), "{full}");
        assert!(streamlined.to_lowercase().contains("grey stone rocks"), "{streamlined}");
    }

    /// Live-observed failure (test-campaign "Tavern Brawl (Watchmen)",
    /// 2026-07-19): with the Objects: layer enabled but no explicit
    /// exclusion, the model used it to mark an NPC's position
    /// ("Hilda Brightmantle (downed, unconscious) at D2") instead of
    /// physical set-dressing. Pin that the exclusion is actually in both
    /// prompt variants whenever objects_enabled is true — this is a real DM
    /// error (Nabil runs combat with physical miniatures), not just cosmetic.
    /// The guide is BINDING, not advice: an under-sized object either grows in
    /// place (free) or becomes a cheap-retry issue — because with the guide as
    /// a prompt line alone, the model wrote eleven 1x1 pine trees straight past
    /// it and the map got fifteen gingerbread trees.
    #[test]
    fn enforce_object_sizes_grows_in_place_or_raises_a_cheap_issue() {
        let guide = vec![("tree".to_string(), 2, 2)];
        // C2 has open floor right/down -> grown to (2x2) in place. The one at
        // H2 is jammed against the east wall -> can't grow -> issue.
        let spec = "# X
Grid: 9x6, 5 ft squares.
Legend: . floor  # wall
Map:
#########
#.......#
#.......#
#.......#
#.......#
#########
Objects:
- Pine trees at C2 (1x1)
- Lone pine tree at H2 (1x1)
- wooden crate at E3 (1x1)
Tactics:
- x";
        let (fixed, issues) = enforce_object_sizes(spec, &guide);
        assert!(fixed.contains("- Pine trees at C2 (2x2)"), "{fixed}");
        // Plural matched; the crate has no guide entry and is untouched.
        assert!(fixed.contains("- wooden crate at E3 (1x1)"), "{fixed}");
        assert_eq!(issues.len(), 1, "{issues:?}");
        assert!(issues[0].starts_with("Objects says \"Lone pine tree"), "{issues:?}");
        // And that issue rides the cheap retry, like other Objects issues.
        assert!(all_features_only_issues(&issues), "{issues:?}");
        // Already-large placements pass untouched either orientation.
        let ok = "# X
Grid: 9x6, 5 ft squares.
Legend: . floor  # wall
Map:
#########
#.......#
#.......#
#.......#
#.......#
#########
Objects:
- Pine tree at C2 (2x2)
Tactics:
- x";
        let (same, none) = enforce_object_sizes(ok, &guide);
        assert_eq!(same, ok);
        assert!(none.is_empty());
        // A Tactics sentence that happens to parse like an object line is
        // OUTSIDE the Objects section and must never be rewritten.
        let tactics = "# X
Grid: 9x6, 5 ft squares.
Legend: . floor  # wall
Map:
#########
#.......#
#.......#
#.......#
#.......#
#########
Objects:
Tactics:
- topple the dead tree at C2 (1x1) onto pursuers";
        let (t_same, t_none) = enforce_object_sizes(tactics, &guide);
        assert_eq!(t_same, tactics);
        assert!(t_none.is_empty());
    }

    /// The derived size guide reaches the model verbatim — and only when the
    /// library actually produced one.
    #[test]
    fn objects_rule_line_carries_the_derived_size_guide() {
        let vocab = vec!["tree".to_string(), "table".to_string()];
        let guide = vec!["tree 2x2".to_string(), "wagon 2x3".to_string()];
        let with = objects_rule_line(&vocab, &guide);
        assert!(with.contains("SIZE GUIDE"), "{with}");
        assert!(with.contains("tree 2x2, wagon 2x3"), "{with}");
        // No guide -> no line; the vocabulary line is untouched either way.
        let without = objects_rule_line(&vocab, &[]);
        assert!(!without.contains("SIZE GUIDE"), "{without}");
        assert!(without.contains("tree, table"), "{without}");
    }

    #[test]
    fn battle_map_format_instructions_explicitly_forbids_npcs_in_objects_when_enabled() {
        let vocab = vec!["table".to_string(), "barrel".to_string()];
        let full = battle_map_format_instructions(false, true, &vocab, &[]);
        assert!(full.to_lowercase().contains("never a creature, npc, or monster"), "{full}");
        assert!(full.contains("table, barrel"), "real vocabulary must reach the prompt: {full}");
        let streamlined = battle_map_format_instructions(true, true, &vocab, &[]);
        assert!(streamlined.to_lowercase().contains("never a creature, npc, or monster"), "{streamlined}");
        assert!(streamlined.contains("table, barrel"), "{streamlined}");
        // With no tile library imported, the whole Objects: section (rule
        // included) must be absent — nothing to guard against if the model
        // never sees the section at all.
        let disabled = battle_map_format_instructions(false, false, &[], &[]);
        assert!(!disabled.contains("Objects:"), "{disabled}");
    }

    /// Same pin, for the cave example — it's teaching material too, and it's
    /// the one example that must NOT contain `=` anywhere.
    #[test]
    fn the_prompts_cave_example_passes_our_own_validator_and_has_no_furniture() {
        let instr = battle_map_format_instructions(false, false, &[], &[]);
        let spec = instr
            .split(MAP_SPEC_DELIMITER)
            .find(|s| s.contains("# Flooded Grotto"))
            .expect("cave example not found in the prompt");
        let spec = spec.trim();
        assert_eq!(validate_map_spec(spec), Vec::<String>::new(), "spec was:\n{spec}");
        assert_eq!(normalize_map_spec(spec).trim(), spec);
        assert!(
            !EXAMPLE_CAVE_GRID.iter().any(|row| row.contains('=')),
            "the whole point of the cave example is that it has no furniture"
        );
    }

    /// The examples are embedded in the prompt by joining EXAMPLE_MAP_GRID /
    /// EXAMPLE_CAVE_GRID, so the guard compares against exactly the text the
    /// model saw. If someone edits a grid, both move together — this pins
    /// that they can't drift.
    #[test]
    fn copies_the_example_catches_the_grid_the_prompt_actually_shows() {
        let instr = battle_map_format_instructions(false, false, &[], &[]);
        for row in EXAMPLE_MAP_GRID {
            assert!(instr.contains(row), "prompt lost tavern row {row}");
        }
        for row in EXAMPLE_CAVE_GRID {
            assert!(instr.contains(row), "prompt lost cave row {row}");
        }
        // The streamlined (local-model) variant only shows one example, but
        // it's the SAME tavern grid — copying it must still be caught.
        let streamlined = battle_map_format_instructions(true, false, &[], &[]);
        for row in EXAMPLE_MAP_GRID {
            assert!(streamlined.contains(row), "streamlined prompt lost tavern row {row}");
        }
        // The real thing the model returned live: our example under a new name.
        let plagiarised = format!(
            "# Tavern Brawl\nGrid: 16x12, 5 ft squares.\nLegend: {MAP_LEGEND}\nMap:\n{}\nFeatures:\n- Bar counter at C3-H3\nTactics:\n- x",
            EXAMPLE_MAP_GRID.join("\n")
        );
        assert!(copies_the_example(&plagiarised));
        // Copying the SECOND example verbatim must be caught too.
        let plagiarised_cave = format!(
            "# Sunken Cavern\nGrid: 10x10, 5 ft squares.\nLegend: {MAP_LEGEND}\nMap:\n{}\nFeatures:\n- Stalagmite at D2\nTactics:\n- x",
            EXAMPLE_CAVE_GRID.join("\n")
        );
        assert!(copies_the_example(&plagiarised_cave));
        // A genuinely different room is not a copy — this is the live-generated
        // Dockside Tap, which passed on its own merits.
        let original = "# The Dockside Tap\nGrid: 18x14, 5 ft squares.\nMap:\n##################\n#................#\n#.==========.....#\n#...=............#\n#...........==...#\n#.o..==..........+\n#....==....=.....#\n#......^^........#\n#......==........#\n#......==......*.#\n#.==.........=...#\n#.==.............#\n#................#\n#######+##########\nFeatures:\n- Bar counter at C3-L3\nTactics:\n- x";
        assert!(!copies_the_example(original));
    }

    /// The streamlined prompt is teaching material too, just shorter — its
    /// one example has to actually be sound, same as the full prompt's.
    #[test]
    fn the_streamlined_prompts_example_passes_our_own_validator() {
        let instr = battle_map_format_instructions(true, false, &[], &[]);
        let spec = instr
            .split(MAP_SPEC_DELIMITER)
            .find(|s| s.contains("# The Bent Nail"))
            .expect("example map not found in the streamlined prompt");
        let spec = spec.trim();
        assert_eq!(validate_map_spec(spec), Vec::<String>::new(), "spec was:\n{spec}");
    }

    /// The whole point is that it's actually shorter — a small model with a
    /// long prompt is exactly what broke live. Pin that the streamlined
    /// variant dropped the second worked example and the qualitative rules,
    /// not just reworded them.
    #[test]
    fn the_streamlined_prompt_is_meaningfully_shorter_and_drops_the_cave_example() {
        let full = battle_map_format_instructions(false, false, &[], &[]);
        let streamlined = battle_map_format_instructions(true, false, &[], &[]);
        assert!(streamlined.len() < full.len() / 2, "full={} streamlined={}", full.len(), streamlined.len());
        assert!(!streamlined.contains("Flooded Grotto"), "{streamlined}");
    }
}
