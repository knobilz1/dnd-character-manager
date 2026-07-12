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
use tauri::{AppHandle, Manager};

const BASE_CLAUDE_MD: &str = r#"# You are the Dungeon Master

You are the Dungeon Master for a Dungeons & Dragons game night. The players are physically at the table talking to you out loud through speech-to-text; you reply and your reply is read aloud with text-to-speech, so keep prose natural to hear, not to read.

You are given the current party status (HP, conditions, etc.) at the top of every message — treat it as ground truth, it may have changed since you last looked. For what's happened in past sessions and any standing facts worth remembering, see the campaign memory below. entities.md and locations.md are standing registries of every named NPC/faction/creature and place you've ever introduced — always check them before treating someone or somewhere as new; if a name you're about to introduce is already there, it means the party has met them/been there before. These registries are YOUR reference, not the party's — knowing a name is in entities.md is not the same as the party having actually learned it in-fiction. Never have a PC or the narration casually use a named NPC's proper name until that name has actually been given to the party in-scene (the NPC introduces themselves, someone else names them, a sign/notice/rumor names them, etc.); before that, refer to them by description only ("the innkeeper", "a hooded figure by the fire", "the guard captain"). This applies even to someone already logged in entities.md from a past session, if the CURRENT scene is genuinely the party's first encounter with them face to face. party.md is the player characters themselves — who plays them, their identity, and their player-written backstory notes, synced automatically from the players' own character sheets. Treat it as read-only ground truth about who these people are (party members are NOT NPCs — never add them to entities.md via rememberEntity), and actively mine it: a character's bonds, flaws, and unresolved backstory threads are the best material for making the story feel personal to this table.

@memory/MEMORY.md
@memory/flagged_facts.md
@memory/entities.md
@memory/locations.md
@memory/party.md
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
{"damage":[{"name":"Thorin","amount":12}],"addCondition":[{"name":"Mira","condition":"Prone"}],"rememberEntity":[{"name":"Gundren Rockseeker","description":"A dwarf merchant, captured by goblins near the Triboar Trail.","voiceId":"male-us-1"},{"name":"Squibbins","description":"A jittery gnome tinkerer who runs the general store.","voiceId":"male-us-2","pitch":"small"}]}
```

Valid keys (all optional): damage [{name,amount}], heal [{name,amount}], tempHp [{name,amount}], addCondition [{name,condition}], removeCondition [{name,condition}], exhaustion [{name,level}], inspiration [{name,value: true|false}], position [{name,q,r}], clearPositions (true|false).
- `rememberEntity` / `rememberLocation`: `[{name, description, voiceId?, pitch?}]` — use these for any named NPC, faction, creature (`rememberEntity`), or place (`rememberLocation`) worth recalling much later. Each is *upserted by name*: if the name already exists in entities.md/locations.md, your description **replaces** the old one (rewrite it to reflect what's changed, e.g. "captured by goblins" becoming "rescued, now allied with the party" — don't just restate the original), so keep the description as a short, current, standalone summary rather than a running diary. If the name is new, it's added fresh. These are the DM's long-term "who/where" memory and are never summarized away, so this is the reliable way to make sure someone met in session 3 is still recognized in session 100. `voiceId`/`pitch` are `rememberEntity`-only (see "Giving NPCs distinct voices" below) — include them the first time you introduce an NPC worth voicing; once assigned they're permanent, so no need to repeat them on later updates to the same NPC's description. For an NPC worth remembering, also fold a short speech quirk or mannerism into the description the first time (e.g. "gruff, clipped sentences" or "nervous giggle, over-explains") — the voice makes them sound distinct in the moment, but a written quirk is what lets you keep playing them consistently many sessions later, long after the specific scene is forgotten.
- `remember`: array of short, standalone facts worth recalling much later that AREN'T about one specific named entity or location — a promise made, a secret learned, a general consequence that should echo later. These go in flagged_facts.md, which — like entities.md/locations.md — is never summarized or compressed away, so prefer `rememberEntity`/`rememberLocation` whenever a fact is really about a specific person or place, and `remember` for everything else worth permanently keeping.
- `resolveFact`: array of strings — each one a fact from flagged_facts.md whose story has now fully concluded (the promise was fulfilled or definitively broken, the secret came out, the consequence played out). Copy the fact's text as it appears in flagged_facts.md (verbatim or its distinctive part) so it can be matched. The fact is archived, not deleted — but be conservative, exactly like `resolveChapterSection`: only flag something genuinely, completely concluded. A fact left unresolved a little too long is harmless; a still-live promise wrongly resolved stops being shown to you.
- `advanceToChapter`: a chapter id (only relevant if the active module has chapters — see active_module/index.md for the current list of valid ids). Include this only when the party's actions have actually concluded the current chapter and moved the story into the next one. Don't skip ahead or advance early just because you're curious what's next.
- `resolveChapterSection`: a short description of a clearly-concluded, bounded portion of the *current* chapter (e.g. "the party cleared the eastern guard room and looted it") — only when the active module has chapters. This trims that resolved portion out of the chapter text you're given each turn, so it stops taking up space once it's no longer relevant. Be conservative: only flag something as resolved when it's genuinely done and bounded, never anything the party hasn't reached yet — a missed trim just means the text stays a little longer, which is harmless, but flagging unresolved content as done risks losing something you still need.
- `switchActiveModule`: a module id from modules_index.md — only relevant if this campaign has more than one imported module. Use this when the party's own actions clearly move them from one self-contained module/side-quest to a different already-imported one (e.g. leaving one dungeon to chase a lead that belongs to another module you have on file). Never invent a module id that isn't listed in modules_index.md, and don't switch just because you're curious — only when the party has actually moved on in the fiction.
- `position` / `clearPositions`: see "Physical hex-grid positioning" below.
Only include this block when something actually changed. Never mention the block itself in your spoken narration — it is stripped before anyone hears it.

## Campaign-arc plan check-ins
Most turns you'll just see the active module's current chapter text (if any) and won't see the overarching campaign lore or the active module's own arc plan — that's intentional, it's not repeated every turn. Every so often (session start, right after a chapter or module change, and periodically otherwise) your prompt will start with a "Campaign-arc plan check-in" section containing the campaign's overarching lore and/or the active module's arc plan again. When you see it, use it to steer pacing, keep foreshadowed threads and NPCs consistent with the wider story, and then continue narrating normally — don't call attention to it or treat it as new information from the players.

## Physical hex-grid positioning
This table plays on physical 3D-printed hex terrain — uniform hexagonal cells with no printed coordinates or landmarks, so you must never speak a raw coordinate or compass direction aloud (there's no shared "north" between your bookkeeping and the physical table). Instead:
- Track every combatant's (PCs, monsters, NPCs) position as axial hex coordinates (q, r). When any exist, your prompt starts with a line like "Current hex positions (axial q,r — internal bookkeeping only, never read aloud): Thorin: (0,0), Goblin1: (3,-2)" — treat this as ground truth, it's tracked outside your own memory and given fresh every turn.
- Hex distance between two axial coordinates: (|q1-q2| + |q1+r1-q2-r2| + |r1-r2|) / 2. Use this to reason about range, adjacency, and movement, but always translate the result into something a human can act on by eye-counting hexes on the table: a hex count plus a named anchor plus a natural relative direction (e.g. "place the goblin 3 hexes past Thorin, roughly toward the cave mouth" or "that's 2 hexes — well within your movement"). Never say "(3,-2)" or "northeast" out loud.
- When a combatant is newly placed or moves, report it via the `position` key: `{"position":[{"name":"Goblin1","q":3,"r":-2}]}`. Assign new coordinates relative to whoever's already tracked (or, if nothing is tracked yet, ask where the party currently stands and assign them coordinates clustered near (0,0) to establish the starting reference).
- When combat ends or a genuinely new encounter is about to start, include `"clearPositions":true` so stale coordinates from the last fight don't bleed into the next one — then re-establish starting positions as above.
- If no hex-position line appears in your prompt, there's no active battle map — don't invent one; just narrate normally until positioning actually starts mattering.

## How to DM
- Track initiative yourself. Each round: narrate enemies, resolve actions, prompt the next player by name.
- Balance the spotlight across a session — check in with quieter players by name rather than only following whoever spoke most recently or is loudest.
- Prefer open prompts ("what do you do?") over leading yes/no ones ("do you want to attack?") — let players drive the scene instead of picking from an implied menu.
- Roll monster attacks, saves, and damage yourself and state the result; let players roll their own d20s unless asked to roll for them, in which case just state a result plausible for the situation.
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
2. Also optionally include `pitch` alongside it — three tiers, based on the NPC's actual D&D size and build, not just how imposing they read in flavor text: `"small"` for a Small (or Tiny) creature (gnomes, halflings, kobolds, most fey); `"large"` for an actually Large-or-bigger creature (ogres, trolls, hill giants and up, most adult dragons); `"gruff"` for a Medium-size race that still naturally reads as rougher/deeper-voiced than a human (orcs, half-orcs, goliaths, firbolgs, bugbears, hobgoblins, and similar) — a milder version of `"large"`'s shift, since they aren't mechanically Large. Omit the field entirely for an ordinary Medium NPC with nothing distinctive about their build — most NPCs don't need it. This layers a pitch/pace shift on top of whichever voice you picked in step 1, it doesn't replace that choice.
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

/// Pass 1 of establish_campaign_lore_at's three-pass pipeline. Asks Claude to
/// inventory every named NPC, faction, location, and plot thread it can find
/// in the DM-provided material — which may be a short typed note or the full
/// extracted text of an official sourcebook running to hundreds of pages — as
/// a flat list. This is a working artifact, not the final doc, so it's
/// deliberately allowed to be as long as the source material actually
/// warrants instead of being squeezed to a fixed length the way the final
/// campaign_lore.md is. Pass 2 (build_establish_campaign_prompt) drafts from
/// this, and pass 3 (build_campaign_lore_critique_prompt) checks coverage
/// against it; the raw result is also saved to disk verbatim (see
/// establish_campaign_lore_at) as a permanent, never-loaded backup — the same
/// "cheap insurance against a later pass losing something" reasoning as
/// DEFAULT_HISTORY_MD.
fn build_campaign_inventory_prompt(intake: &CampaignIntake) -> String {
    let lore_block = if intake.lore.trim().is_empty() {
        "(No lore material was provided.)".to_string()
    } else {
        intake.lore.trim().to_string()
    };
    format!(
        "You're helping set up a new Dungeons & Dragons campaign. Below is whatever material the DM provided for it — this could be a short note, or the full extracted text of an official campaign sourcebook running to hundreds of pages.\n\n\
        Campaign name: {}\n\
        Module/scenario noted at creation: {}\n\
        Other notes: {}\n\n\
        Material:\n{lore_block}\n\n\
        List every named NPC, faction, organization, recurring location, and ongoing plot thread you can find in the material above that could plausibly recur across a long campaign (skip one-off, purely incidental mentions). One line per entry, format: \"- **Name/thread** — one clause on what/who they are and why they might matter later.\" Be thorough rather than selective — this is a working inventory, not the final doc, so include anything plausibly recurring even if you're not sure it'll make the final cut. If the material contains little or nothing to inventory, say so plainly rather than inventing entries.\n\n\
        Reply with ONLY the inventory list (or that one-line note if there's nothing to inventory), no other commentary.",
        intake.name.trim(),
        intake.module.trim(),
        intake.notes.trim(),
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

/// Impure: three Opus calls (see build_claude_args's doc comment in dm.rs for
/// why one-time ingestion work gets the quality/latency budget a live turn
/// can't afford) — inventory, then draft, then a coverage-checking critique —
/// that together write memory/campaign_lore.md. Returns the final text so the
/// frontend can display/confirm it. Deliberately a fully separate step from
/// create_campaign_at (which stays LLM-free and fast) — called by its own
/// tauri command right after create_campaign succeeds, the same sequential-
/// chaining shape DMConsolePage.tsx already uses for
/// chapterize_and_import_module when a module file was picked during creation.
///
/// Each later pass tolerates the previous *refinement* step failing or
/// coming back empty by falling back to what it already has (an inventory
/// call failing just means pass 2 drafts without one, same as a blank
/// intake.lore; a critique call failing just means the draft ships as-is) —
/// only the pass-2 draft itself is required to succeed and be non-empty,
/// since that's the one piece with no reasonable fallback.
fn establish_campaign_lore_at(root: &Path, id: &str, intake: &CampaignIntake) -> Result<String, String> {
    let inventory = crate::dm::ask_claude_once(build_campaign_inventory_prompt(intake), Some("opus"))
        .unwrap_or_default()
        .trim()
        .to_string();
    if !inventory.is_empty() {
        // Best-effort permanent backup (see build_campaign_inventory_prompt's
        // doc comment) — a write failure here shouldn't block establishing
        // the campaign's actual lore doc.
        let _ = write_atomic(&root.join(id).join("memory").join("campaign_source_inventory.md"), &inventory);
    }

    let draft = crate::dm::ask_claude_once(build_establish_campaign_prompt(intake, &inventory), Some("opus"))?;
    let draft = draft.trim().to_string();
    if draft.is_empty() {
        return Err("Campaign-lore establishment returned empty content.".into());
    }

    let final_lore = crate::dm::ask_claude_once(build_campaign_lore_critique_prompt(&draft, &inventory), Some("opus"))
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
/// property over many additions.
fn build_update_lore_prompt(existing_lore: &str, addition: &str) -> String {
    format!(
        "You previously wrote the overarching campaign-lore doc below for a Dungeons & Dragons campaign. New material has come up that should be folded into it — a sourcebook, a later plot decision, anything the DM wants the persistent frame to account for going forward.\n\n\
        Existing campaign-lore doc:\n{existing_lore}\n\n\
        New material to fold in:\n{addition}\n\n\
        Rewrite the campaign-lore doc so it incorporates the new material naturally alongside what's still relevant from before — don't just append it as a separate section, weave it in where it fits (a new faction goes with the other factions, a new thread goes with the other plot threads, etc.). Keep the same concise markdown-outline style and length guidance as before (a few hundred words is plenty).\n\n\
        Reply with ONLY the full, updated markdown doc, no other commentary, no code fences.",
    )
}

/// Impure: folds `addition` into an existing campaign's lore doc via one Opus
/// call, backing up the previous version first (same
/// backup_before_overwrite + write_atomic pattern used everywhere else
/// content gets overwritten in place, e.g. trim_resolved_chapter_section_at).
/// Reads the existing doc itself rather than requiring the caller to pass it
/// in, so the frontend only ever needs to supply the new text — same shape
/// as establish_campaign_lore_at needing just the intake answers.
fn update_campaign_lore_at(root: &Path, id: &str, addition: &str) -> Result<String, String> {
    let path = root.join(id).join("memory").join("campaign_lore.md");
    let existing = read_optional(&path);
    let lore = crate::dm::ask_claude_once(build_update_lore_prompt(&existing, addition), Some("opus"))?;
    let trimmed = lore.trim();
    if trimmed.is_empty() {
        return Err("Campaign-lore update returned empty content; leaving campaign_lore.md untouched.".into());
    }
    backup_before_overwrite(&path);
    write_atomic(&path, trimmed)?;
    Ok(trimmed.to_string())
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
/// npc_voices.json written before this field existed.
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
        2. `pitch` (optional) — three tiers, based on their actual D&D size and build, NOT gender: `\"small\"` for a Small (or Tiny) creature (gnomes, halflings, kobolds, most fey); `\"large\"` for an actually Large-or-bigger creature (ogres, trolls, hill giants and up, most adult dragons); `\"gruff\"` for a Medium-size race that still naturally reads as rougher/deeper-voiced (orcs, half-orcs, goliaths, firbolgs, bugbears, hobgoblins, and similar) — a milder version of `\"large\"`'s shift, since they aren't mechanically Large. Omit entirely (or use null) for an ordinary Medium NPC with nothing distinctive about their build.\n\
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
    let reply = crate::dm::ask_claude_once(build_voice_reconciliation_prompt(&unvoiced, &usage_summary), Some("opus"))?;
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
    let reply = crate::dm::ask_claude_once(build_campaign_hooks_prompt(&campaign_lore, &pending), Some("opus"))?;
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
    let rewritten = crate::dm::ask_claude_once(build_compact_memory_prompt(&current), Some("sonnet"))?;
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
        Rewrite it more compactly, but you must NEVER remove a named entry — every name currently listed must still be present afterward. Only merge exact or near-duplicate entries for the same name, and tighten overly wordy descriptions. If in doubt, leave an entry as-is rather than risk losing it.\n\n\
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
    let rewritten = crate::dm::ask_claude_once(
        build_compact_entities_prompt(file_label, &current, current_chapter_context),
        Some("sonnet"),
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
    crate::dm::ask_claude_once(prompt, Some("sonnet"))
}

/// `campaign_lore` (memory/campaign_lore.md) and `other_modules_summary`
/// (modules_index.md's listing of already-imported modules) are both `""` for
/// a campaign's first-ever import — the prompt degrades to a plain "no wider
/// context yet" framing rather than an awkward "given the campaign's lore:
/// (nothing)" block in that case.
fn build_chapterize_prompt(text: &str, campaign_lore: &str, other_modules_summary: &str) -> String {
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
    format!(
        "You will be given the full text of a Dungeons & Dragons adventure module or scenario document, extracted from a PDF. Do three things with it, in one reply.\n\n\
        1. Give the whole module a short, human-readable title (a few words, e.g. \"The Sunless Citadel\" or \"Goblin Ambush at the Old Mill\") — from the document's own title if it has one, otherwise one you invent that fits.\n\n\
        2. Identify its logical NARRATIVE chapters or major sections — the story beats the party actually plays through in order. Leave out pure-reference material that isn't a story beat (monster/NPC stat-block appendices, item/treasure tables, handout-only pages, maps with no accompanying scene) — those aren't \"chapters\" the party progresses through, so including them just makes chapter sizes wildly uneven and risks one becoming the \"current\" chapter by mistake. For each chapter, give TWO different strings:\n\
        - \"title\": a short, clean, human-readable name (e.g. \"Chapter 3: The Ambush at Old Mill\") — this is shown directly to players, so it must read as a complete phrase. Never truncate it mid-word or mid-sentence for any reason.\n\
        - \"heading\": copied EXACTLY character-for-character from a contiguous span of the document text below — including any extraction artifacts like doubled letters, stray spaces between every word, broken ligatures, or OCR garbling (e.g. if the document shows \"CHAPTER  I  I ACQUISITIO:-<S\", copy exactly that, do not clean it up to \"CHAPTER 1: ACQUISITIONS\"). Nobody ever sees this string — it exists purely to find this exact position in the raw text programmatically, so ANY normalization, cleanup, or paraphrasing will make it fail to match. Prefer it to be UNIQUE within the whole document: a short/generic heading word (\"About\", \"Background\", \"Introduction\") likely repeats elsewhere (as a subsection heading, a running header, etc.) and matching the wrong occurrence silently corrupts the split — if the bare heading text looks generic, extend the copied substring with the next few words until it's distinctive, still verbatim.\n\
        List chapters in the order they appear.\n\n\
        3. Write a plan for the AI Dungeon Master who will run this live at the table, as a markdown doc with exactly two sections:\n\
        ## How this fits the campaign\n\
        Given the campaign context below, which existing NPCs/factions/threads (if any) this module's content should tie into, and a natural in-fiction hook for why the party ends up here. If there's no established campaign context yet, say this module can serve as the campaign's foundation instead.\n\
        ## This module's own arc\n\
        The overall story arc across this module's own chapters, key NPCs/factions worth tracking, threads that should pay off later (foreshadowing), and pacing guidance for how the chapters connect. A module provides a framework and leaves the DM to fill in the gaps — this section IS that framework. Keep the whole plan concise (a few hundred words total is plenty), not a retelling of the text.\n\n\
        4. Self-audit your own breakdown above and list any STRUCTURAL concerns as short strings — e.g. a heading you weren't fully confident matched a unique exact point in the source text, narrative chapters that still came out very uneven in size, or a campaign tie-in that feels forced. The person reading this may be a PLAYER in the game, not the DM, so these strings must never reveal plot content, twists, names of secrets, or anything that would spoil the adventure — describe only the structural problem itself. If you have no concerns, return an empty array.\n\n\
        {context_block}\n\n\
        Reply with ONLY a JSON object, no other text, no markdown code fences:\n\
        {{\"module_title\": \"<short title>\", \"chapters\": [{{\"title\": \"<clean readable chapter title>\", \"heading\": \"<exact verbatim substring, artifacts included, chosen to be unique>\", \"summary\": \"<one clean, readable sentence describing what happens in this section>\"}}], \"plan\": \"<markdown plan with both sections above>\", \"concerns\": [\"<short structural concern, no spoilers>\"]}}\n\n\
        If the document has no clear internal chapter structure, still return a single chapters entry whose heading is an exact short substring from the very start of the document, whose title is a short readable name for the whole document, and whose summary describes the whole document — and still include a plan.\n\n\
        Document:\n{text}"
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
    #[serde(default)]
    plan: String,
    /// Claude's own spoiler-free structural self-audit of this breakdown —
    /// see build_chapterize_prompt's point 4. Never plot content, only things
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
    let rewritten = crate::dm::ask_claude_once(build_trim_chapter_prompt(&current, resolved_description), Some("sonnet"))?;
    let trimmed = rewritten.trim();
    if trimmed.is_empty() {
        return Err("Chapter trim returned empty content; leaving current.md untouched.".into());
    }
    backup_before_overwrite(&path);
    write_atomic(&path, trimmed)?;
    if read_active_module_id_at(root, id).as_deref() == Some(module_id) {
        sync_active_module_indirection_at(root, id, module_id)?;
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

/// The impure orchestration step: one Opus call asks Claude for a module
/// title, chapter headings, and an integration-aware draft plan in the same
/// reply (reading whatever campaign lore + other modules already exist first
/// so the plan can actually tie into them), a second Opus call critiques and
/// revises just the plan text (see build_plan_critique_prompt — the
/// chapters/headings from pass 1 are used as-is, since split_by_headings
/// needs them to match the raw source text exactly), then the raw text is
/// split on those headings and everything is written to disk as a new,
/// independently-tracked module. Only this function (and the
/// #[tauri::command] wrapping it) touches the network/subprocess —
/// split_by_headings/write_chapters_to_disk above are pure and covered by
/// real tests instead. Forced onto `opus` (see dm.rs) since this runs once
/// per module import, not on every turn. If the critique call fails or comes
/// back empty, the pass-1 draft plan ships as-is rather than failing the
/// whole (expensive) import over a secondary refinement step.
fn chapterize_and_import_module_at(root: &Path, id: &str, raw_text: &str) -> Result<ChapterizeImportResult, String> {
    let dir = root.join(id);
    let campaign_lore = read_optional(&dir.join("memory").join("campaign_lore.md"));
    let other_modules_summary = read_optional(&dir.join("modules_index.md"));
    let reply = crate::dm::ask_claude_once(build_chapterize_prompt(raw_text, &campaign_lore, &other_modules_summary), Some("opus"))?;
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

    let plan = crate::dm::ask_claude_once(build_plan_critique_prompt(&parsed.plan, &campaign_lore, &other_modules_summary), Some("opus"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(parsed.plan);

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

/// Refreshes this campaign's generated DM rules — see sync_dm_rules_at. Called
/// from DMConsolePage on every campaign load, before the DM session is warmed,
/// so the very first turn already sees the current rules.
#[tauri::command]
pub fn sync_dm_rules(app: AppHandle, id: String) -> Result<(), String> {
    sync_dm_rules_at(&campaigns_root(&app)?, &id)
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
/// existing one. Runs a real `claude` call to find chapter boundaries, so
/// this can take a while for a long document; spawn_blocking keeps it off
/// the async runtime's worker threads.
#[tauri::command]
pub async fn chapterize_and_import_module(app: AppHandle, id: String, text: String) -> Result<ChapterizeImportResult, String> {
    tokio::task::spawn_blocking(move || {
        let root = campaigns_root(&app)?;
        chapterize_and_import_module_at(&root, &id, &text)
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
        assert!(prompt.to_lowercase().contains("spread"), "should ask it to spread picks across the bucket instead of defaulting to one id");
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
    fn build_campaign_inventory_prompt_includes_intake_fields_and_degrades_gracefully_when_lore_is_blank() {
        let full = CampaignIntake {
            name: "Curse of Strahd".into(),
            edition: "2014".into(),
            players: "Alex — Thorin".into(),
            module: "Curse of Strahd".into(),
            notes: "Gothic horror tone.".into(),
            lore: "The party is drawn into Barovia by the Mists.".into(),
        };
        let prompt = build_campaign_inventory_prompt(&full);
        assert!(prompt.contains("Curse of Strahd"));
        assert!(prompt.contains("The party is drawn into Barovia by the Mists."));
        assert!(prompt.to_lowercase().contains("plausibly recur"));

        let blank = build_campaign_inventory_prompt(&intake("Homebrew Test"));
        assert!(blank.contains("(No lore material was provided.)"), "should still ask for a plain no-material note when lore is blank");
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
    fn build_chapterize_prompt_includes_module_title_instruction_and_degrades_gracefully_with_no_campaign_context() {
        let prompt = build_chapterize_prompt("Document text.", "", "");
        assert!(prompt.contains("module_title"));
        assert!(prompt.to_lowercase().contains("first module being imported"));
        assert!(!prompt.to_lowercase().contains("given the campaign's lore"));
    }

    #[test]
    fn build_chapterize_prompt_includes_campaign_lore_and_other_modules_when_present() {
        let prompt = build_chapterize_prompt(
            "Document text.",
            "The party operates out of Phandalin.",
            "1. **The Sunless Citadel** (`the-sunless-citadel`) — a goblin-infested ruin.",
        );
        assert!(prompt.contains("The party operates out of Phandalin."));
        assert!(prompt.contains("The Sunless Citadel"));
        assert!(prompt.contains("How this fits the campaign"));
        assert!(prompt.contains("This module's own arc"));
    }

    #[test]
    fn build_chapterize_prompt_instructs_a_spoiler_free_concerns_self_audit() {
        let prompt = build_chapterize_prompt("Document text.", "", "");
        assert!(prompt.contains("\"concerns\""));
        assert!(prompt.to_lowercase().contains("never reveal plot content"));
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
        let prompt = build_chapterize_prompt("Document text.", "", "");
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
