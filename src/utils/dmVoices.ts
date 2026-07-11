/** Ephemeral voices for unnamed, un-remembered NPCs.
 *
 *  Background: the DM only assigns a permanent `voiceId` (npc_voices.json)
 *  to NPCs it considers worth remembering via `rememberEntity` — and
 *  BASE_CLAUDE_MD explicitly tells it NOT to bother for someone who'll say
 *  one throwaway line. But it still *tags* those throwaway speakers, e.g.
 *  `[Old Man]: "..."`. Before this module, such a tag resolved to nothing,
 *  the frontend sent `voiceId: undefined`, and tts.rs's `speak_text` did
 *  `voice_id.unwrap_or(DEFAULT_VOICE_ID)` — the catalog's `"narrator"` id,
 *  which is `af_heart`, a FEMALE voice, and (crucially) NOT the campaign's
 *  configured narrator override. So every unnamed NPC of any gender spoke
 *  in the same stock female voice: an old man and a woman in one scene came
 *  out identical. Confirmed live at the table.
 *
 *  Fix: derive a voice from the descriptive tag itself. These assignments are
 *  deliberately NEVER persisted to npc_voices.json — the same invariant that
 *  keeps throwaway/OOC names out of entities.md (see BASE_CLAUDE_MD's
 *  "Out-of-character requests"). They live only in memory for the session.
 *
 *  Gender is inferred, never guessed: BASE_CLAUDE_MD states a wrong-gender
 *  voice is the single most jarring mistake this system can make, so when a
 *  tag carries no gender signal at all (`[Innkeeper]:`) we return null and
 *  the caller falls back to the narrator's own voice rather than flipping a
 *  coin. Keep the id lists in sync with tts.rs's VOICE_CATALOG.
 */

/** Non-narrator catalog ids, split by the gender prefix tts.rs guarantees.
 *  `"narrator"` (af_heart) is deliberately excluded — an ephemeral NPC must
 *  never collide with the narration's own voice.
 *
 *  `male-us-9` (Kokoro's `am_santa`) is also excluded: it's a novelty
 *  Santa-styled character voice, fine when the DM picks it on purpose but
 *  jarring when auto-assigned to an arbitrary "[Old Man]:" in a grim campaign.
 *  It stays fully available via `rememberEntity`'s explicit `voiceId` and the
 *  manual override panel — this list only governs automatic picks. */
export const MALE_VOICE_IDS = [
  'male-us-1', 'male-us-2', 'male-us-3', 'male-us-4', 'male-us-5',
  'male-us-6', 'male-us-7', 'male-us-8',
  'male-gb-1', 'male-gb-2', 'male-gb-3', 'male-gb-4',
];

export const FEMALE_VOICE_IDS = [
  'female-us-1', 'female-us-2', 'female-us-3', 'female-us-4', 'female-us-5',
  'female-us-6', 'female-us-7', 'female-us-8', 'female-us-9', 'female-us-10',
  'female-gb-1', 'female-gb-2', 'female-gb-3', 'female-gb-4',
];

/** Matched as whole words, never substrings — "woman" contains "man", so a
 *  substring test would sex-flip every female tag. `normalizeTag` tokenizes
 *  first for exactly this reason. */
const MALE_WORDS = new Set([
  'man', 'men', 'boy', 'boys', 'lad', 'male', 'he', 'him', 'his',
  'sir', 'lord', 'father', 'brother', 'son', 'uncle', 'nephew', 'grandfather',
  'king', 'prince', 'duke', 'baron', 'earl', 'knight', 'squire',
  'priest', 'friar', 'monk', 'abbot', 'husband', 'widower',
  'gentleman', 'fellow', 'guy', 'bloke', 'lads',
]);

const FEMALE_WORDS = new Set([
  'woman', 'women', 'girl', 'girls', 'lass', 'female', 'she', 'her', 'hers',
  'lady', 'madam', 'maam', 'mother', 'sister', 'daughter', 'aunt', 'niece', 'grandmother',
  'queen', 'princess', 'duchess', 'baroness', 'countess', 'dame',
  'priestess', 'nun', 'abbess', 'wife', 'widow',
  'gentlewoman', 'maid', 'barmaid', 'matron', 'crone', 'hag', 'witch',
]);

/** Lowercase, then split on anything that isn't a letter. Apostrophes are
 *  dropped BEFORE that split rather than becoming a separator — otherwise
 *  "Ma'am" tokenizes to ["ma","am"] and never matches, which is exactly the
 *  bug the first cut of this had. No stemming: plural forms that actually
 *  occur in tags are listed explicitly instead. */
export function normalizeTag(tag: string): string[] {
  return tag.toLowerCase().replace(/['’]/g, '').replace(/[^a-z]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

/** 'male' | 'female' | null. Majority of whole-word hits wins; a tie (zero
 *  hits, or an even mix) yields null and the caller falls back rather than
 *  guessing.
 *
 *  Majority rather than "any male word ⇒ male" because this also runs over
 *  free-text entity descriptions, where the other gender routinely appears in
 *  passing: "Ireena Kolyana, a young woman; her brother Ismark guards her"
 *  hits `brother` once but `woman`/`her`/`her` three times. A strict
 *  both-hit ⇒ null rule would refuse nearly every real description. */
export function inferGender(text: string): 'male' | 'female' | null {
  const words = normalizeTag(text);
  let male = 0;
  let female = 0;
  for (const w of words) {
    if (MALE_WORDS.has(w)) male++;
    else if (FEMALE_WORDS.has(w)) female++;
  }
  if (male === female) return null;
  return male > female ? 'male' : 'female';
}

/** Like inferGender, but demands unanimity: some words of one gender, ZERO of
 *  the other. For guessing a speaker's gender from the narration that just
 *  preceded their line, where a majority vote is far too loose — "A young
 *  woman steps forward, her brother close behind" introduces two people of
 *  different genders and must resolve to null, not "female" on a 3-to-1 count.
 *  A wrong-gender voice is the worst outcome; declining to guess is cheap. */
export function inferGenderStrict(text: string): 'male' | 'female' | null {
  const words = normalizeTag(text);
  const male = words.some((w) => MALE_WORDS.has(w));
  const female = words.some((w) => FEMALE_WORDS.has(w));
  if (male === female) return null;
  return male ? 'male' : 'female';
}

/** Deterministic pick within one gender's pool. `seed` is whatever string
 *  identifies the NPC (tag or name) — the same seed always starts at the same
 *  index, and we scan forward past `taken` so a new NPC never lands on the
 *  narrator's voice or another NPC's. Falls back to a repeat only when the
 *  whole pool is spoken for. */
export function pickVoiceForGender(gender: 'male' | 'female', seed: string, taken: ReadonlySet<string>): string {
  const pool = gender === 'male' ? MALE_VOICE_IDS : FEMALE_VOICE_IDS;
  const start = hashTag(normalizeTag(seed)) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[(start + i) % pool.length];
    if (!taken.has(candidate)) return candidate;
  }
  return pool[start];
}

/** FNV-1a. Any stable string→int hash works; the requirement is only that the
 *  same tag maps to the same starting index every time, so "[Old Man]:" keeps
 *  one voice for the whole scene instead of drifting line to line. */
function hashTag(words: string[]): number {
  let h = 0x811c9dc5;
  for (const ch of words.join(' ')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Deterministic voice for a speaker tag, or null when gender is unknowable.
 *  `genderHint` comes from the tag's optional `[Name|male]:` marker (see
 *  parseSpeakerTag) and wins outright — a proper name like "Ismark" carries no
 *  gender word of its own, so without the hint this returns null for exactly
 *  the NPCs that most need a voice. `taken` are voice ids already spoken for
 *  (real NPCs, the narrator override, previously-picked ephemerals). */
export function pickEphemeralVoice(
  tag: string,
  taken: ReadonlySet<string>,
  genderHint?: 'male' | 'female' | null,
): string | null {
  const gender = genderHint ?? inferGender(tag);
  if (!gender) return null;
  return pickVoiceForGender(gender, tag, taken);
}
