//! Generate a character's background from a short player-facing questionnaire.
//!
//! The creator's Background step asks the player half a dozen easy questions — what campaign,
//! what kind of character, how they like to play. It does NOT ask the questions that actually
//! make a backstory usable at a table, because those are hard to answer cold and asking them is
//! how you get a blank stare and "uh, I'm an orphan":
//!
//!   Who raised you, and what did they teach you that you've since rejected?
//!   What happened that made you leave — and why THEN, not a year earlier?
//!   What did you do that you'd never tell the party about?
//!   Name someone who wants you ruined, and why.
//!   What do you want badly enough to get someone killed over?
//!   What's the tic the table remembers after session one?
//!   Which other PC did you know before, and what do you owe each other?
//!   What moment does the PLAYER want their character to have?
//!
//! The model answers those eight itself, from the player's easy answers, and writes the
//! background out of them. That inversion is the whole feature: the player supplies taste, the
//! model supplies the interrogation.
//!
//! Runs through `ask_ingest_once`, so it obeys whichever engine the user has configured (Claude,
//! Codex, Gemini or a local server) instead of hardwiring one.

use serde::{Deserialize, Serialize};

/// The player's own answers. Every field is optional prose — a player who fills in two of these
/// still gets a background, and one who fills in none gets something generic rather than an
/// error. Nothing here is a rules input; it is all taste.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundBrief {
    /// "Curse of Strahd", "homebrew pirate game", "no idea yet".
    pub campaign: String,
    /// The character they picture — "a washed-up duellist who talks too much".
    pub concept: String,
    /// How they like to play: combat, talking, exploring, scheming, comic relief.
    pub playstyle: String,
    /// Tone for the past: heroic, bittersweet, grim, mysterious, comic.
    pub tone: String,
    /// Anything they definitely want in, or definitely do not want.
    pub wants: String,
    /// Other players' characters they already know about, for the party-tie question.
    pub party: String,
}

/// What the creator writes into `backgroundCustom`. Field names match the TS type exactly so the
/// frontend can apply the result without a translation layer.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedBackground {
    pub personality_traits: String,
    pub ideals: String,
    pub bonds: String,
    pub flaws: String,
    pub backstory: String,
}

/// The eight questions the model must answer for itself. Kept as one const so the prompt and any
/// future critique pass cannot drift apart.
const HIDDEN_QUESTIONS: &str = "\
1. Who raised them, and what did those people teach them that they have since rejected? (Origin plus a built-in internal conflict.)
2. What happened that made them leave — and why THEN, rather than a year earlier? The \"why now\" is what makes a character feel in motion.
3. What did they do that they would never tell the party about? Every secret is a future scene.
4. Someone wants them ruined. Give that person a NAME and a reason — a villain the DM can use, pre-loaded with stakes.
5. What do they want badly enough to get someone killed over? Motivation with teeth, not \"seeks adventure\".
6. What is the one habit or tic the table will remember after session one? This is the difference between a character and a stat block.
7. Which other party member did they know before this, and what do the two of them owe each other?
8. What moment does the PLAYER want this character to have at some point?";

fn brief_line(label: &str, value: &str) -> String {
    let v = value.trim();
    if v.is_empty() {
        format!("- {label}: (not answered — decide something that fits the rest)\n")
    } else {
        format!("- {label}: {v}\n")
    }
}

/// Pure, so the prompt can be asserted in tests without running a model.
pub fn build_prompt(brief: &BackgroundBrief, race: &str, class: &str, background: &str) -> String {
    let mut who = String::new();
    if !race.trim().is_empty() {
        who.push_str(&format!("- Race/species: {}\n", race.trim()));
    }
    if !class.trim().is_empty() {
        who.push_str(&format!("- Class: {}\n", class.trim()));
    }
    if !background.trim().is_empty() {
        who.push_str(&format!("- Background: {} (their background's mechanics are already chosen; write fiction that fits it)\n", background.trim()));
    }

    format!(
        "You are writing a Dungeons & Dragons 5e character's background for the player who will \
play them. Write it to be USED at a table: a DM should be able to read it once and immediately \
have three things to do with it.

WHAT THE PLAYER TOLD YOU
{brief}
WHO THEY ARE MECHANICALLY
{who}
ANSWER THESE EIGHT QUESTIONS YOURSELF, FROM WHAT THE PLAYER SAID. Do not ask the player any of \
them and do not print them or their answers as a list — they are the skeleton the writing hangs \
on, and every one of them must be visible in the finished text.

{questions}

RULES
- Invent concrete PROPER NOUNS: people, a town, an organisation. \"A merchant\" is unusable; \
\"Halvard Crane, who runs the Weighbridge\" is a scene waiting to happen.
- Keep it playable at level 1. No lost heirs to thrones, no slain gods, no character who was \
already a legend. Small, specific and personal beats epic.
- Respect anything the player said they want or do not want. If they named another party member, \
question 7 must use that character by name.
- Write in second person (\"you\"), the way a background reads on a sheet.
- Backstory: 150-250 words. The four trait fields: ONE sentence each, in the player's voice, the \
way the Player's Handbook writes them.
- Do NOT annotate or label any field — no \"(Bittersweet)\", no \"(Ideal)\", no question numbers. \
These go straight onto a character sheet and are read as the character's own words.

Reply with ONLY a JSON object, no prose around it, no code fence:
{{\"personalityTraits\": \"...\", \"ideals\": \"...\", \"bonds\": \"...\", \"flaws\": \"...\", \"backstory\": \"...\"}}",
        brief = format!(
            "{}{}{}{}{}{}",
            brief_line("Campaign or setting", &brief.campaign),
            brief_line("The character they picture", &brief.concept),
            brief_line("How they like to play", &brief.playstyle),
            brief_line("Tone they want", &brief.tone),
            brief_line("Wants / does not want", &brief.wants),
            brief_line("Other party members they know", &brief.party),
        ),
        who = if who.is_empty() { "- (not chosen yet)\n".to_string() } else { who },
        questions = HIDDEN_QUESTIONS,
    )
}

/// Pull the object out of whatever the model wrapped it in. Models fence JSON roughly half the
/// time however plainly you ask them not to, and a fence is not a failure worth showing a player.
fn extract_json_object(s: &str) -> &str {
    match (s.find('{'), s.rfind('}')) {
        (Some(a), Some(b)) if b > a => &s[a..=b],
        _ => s,
    }
}

/// Parse the reply. Pure and separately testable, because the failure everybody actually hits is
/// a well-formed object with one field missing, not malformed JSON.
pub fn parse_reply(reply: &str) -> Result<GeneratedBackground, String> {
    let v: serde_json::Value = serde_json::from_str(extract_json_object(reply))
        .map_err(|e| format!("The model's reply wasn't valid JSON ({e}). Try Regenerate."))?;
    let get = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
    let out = GeneratedBackground {
        personality_traits: get("personalityTraits"),
        ideals: get("ideals"),
        bonds: get("bonds"),
        flaws: get("flaws"),
        backstory: get("backstory"),
    };
    // A background with no backstory is the one outcome worth refusing: the four trait lines can
    // be edited by hand in a minute, the backstory is the part the player asked for.
    if out.backstory.is_empty() {
        return Err("The model didn't return a backstory. Try Regenerate.".into());
    }
    Ok(out)
}

/// Async + spawn_blocking: this shells out to a CLI that takes 10-40 seconds, and a sync command
/// would run it on the main thread and freeze the creator.
#[tauri::command]
pub async fn generate_character_background(
    brief: BackgroundBrief, race: String, class: String, background: String,
) -> Result<GeneratedBackground, String> {
    tokio::task::spawn_blocking(move || {
        let prompt = build_prompt(&brief, &race, &class, &background);
        let reply = crate::local_llm::ask_ingest_once(prompt, Some("opus"), true)?;
        parse_reply(&reply)
    })
    .await
    .map_err(|e| format!("background generation panicked: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn brief() -> BackgroundBrief {
        BackgroundBrief {
            campaign: "Curse of Strahd".into(),
            concept: "a washed-up duellist".into(),
            playstyle: "talking my way out of things".into(),
            tone: "bittersweet".into(),
            wants: "no dead-family origin please".into(),
            party: "Mira the cleric".into(),
        }
    }

    /// The eight questions must reach the model, and the instruction NOT to ask them must reach it
    /// too. Losing either one silently turns this back into a generic "write me a backstory".
    #[test]
    fn prompt_carries_all_eight_hidden_questions_and_forbids_asking_them() {
        let p = build_prompt(&brief(), "Human", "Bard", "Entertainer");
        for needle in [
            "Who raised them",
            "why THEN",
            "never tell the party",
            "wants them ruined",
            "killed over",
            "habit or tic",
            "which other party member",
            "moment does the PLAYER want",
        ] {
            assert!(
                p.to_lowercase().contains(&needle.to_lowercase()),
                "prompt lost the hidden question {needle:?}"
            );
        }
        assert!(p.contains("Do not ask the player any of them"));
        assert!(p.contains("Curse of Strahd") && p.contains("Mira the cleric"));
        assert!(p.contains("Human") && p.contains("Bard") && p.contains("Entertainer"));
    }

    /// A half-filled questionnaire is the normal case, not an error case.
    #[test]
    fn unanswered_questions_become_an_instruction_rather_than_a_blank() {
        let mut b = BackgroundBrief::default();
        b.concept = "a tired sellsword".into();
        let p = build_prompt(&b, "", "", "");
        assert!(p.contains("a tired sellsword"));
        assert!(p.contains("(not answered — decide something that fits the rest)"));
        assert!(p.contains("- (not chosen yet)"));
    }

    #[test]
    fn parses_plain_and_fenced_json_and_tolerates_missing_trait_fields() {
        let plain = r#"{"personalityTraits":"a","ideals":"b","bonds":"c","flaws":"d","backstory":"e"}"#;
        let g = parse_reply(plain).unwrap();
        assert_eq!((g.personality_traits.as_str(), g.backstory.as_str()), ("a", "e"));

        let fenced = "Here you go:\n```json\n{\"backstory\":\"only this\"}\n```\nHope that helps!";
        let g2 = parse_reply(fenced).unwrap();
        assert_eq!(g2.backstory, "only this");
        assert_eq!(g2.ideals, "", "a missing trait is blank, not a failure");
    }

    /// The one refusal. Everything else the player can fix by typing; a missing backstory is the
    /// thing they pressed the button for.
    #[test]
    fn a_reply_with_no_backstory_is_an_error_not_an_empty_background() {
        assert!(parse_reply(r#"{"ideals":"be good"}"#).is_err());
        assert!(parse_reply("I'd rather not").is_err());
    }
}
