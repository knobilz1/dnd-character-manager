import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { SubclassOptionsPicker } from '../creator/steps/SubclassOptionsPicker';
import { LanguagePicker } from '../../components/LanguagePicker';
import { ProficiencyPicker } from '../../components/ProficiencyPicker';
import { useCharacterDerived } from '../../hooks/useCharacterDerived';
import { getSubclassOptions } from '../../data/subclassOptions';
import { Search, ChevronUp, ChevronDown, X, Plus, Pencil, Trash2, Check } from 'lucide-react';
import { SectionHeader, HoverCard } from '../../components/ui';
import { cn } from '../../utils/cn';
import { getBackground, resolveBackground } from '../../data/backgrounds';
import { getRace } from '../../data/races';
import { FlexibleAsiPicker } from '../creator/steps/FlexibleAsiPicker';
import { getClass } from '../../data/classes';
import { ALL_SUBCLASSES } from '../../data/subclasses';
import { ALL_FEATS } from '../../data/feats';
import { ALL_FIGHTING_STYLES, activeFightingStyles } from '../../data/fightingStyles';
import { ALL_INVOCATIONS } from '../../data/invocations';
import { ALL_PACT_BOONS } from '../../data/pactBoons';
import { ALL_METAMAGIC } from '../../data/metamagic';
import { ALL_MANEUVERS } from '../../data/maneuvers';
import { ALL_INFUSIONS } from '../../data/infusions';
import { totalCharacterLevel } from '../../data/mechanics';
import { toolOptions } from '../../data/tools';
import { useCharacterStore } from '../../store/useCharacterStore';
import type { Background, BackgroundCustom, Character, JournalEntry, AbilityKey } from '../../types';

/** id → printed name, for the option pools that store ids. Built from the same catalogs the
 *  grants draw their options from, so a renamed entry cannot leave a stale label behind. */
const OPTION_LABELS: Record<string, string> = Object.fromEntries(
  [...ALL_FIGHTING_STYLES, ...ALL_INVOCATIONS, ...ALL_METAMAGIC, ...ALL_MANEUVERS]
    .map(x => [x.id, x.name]),
);

export function TraitsPanel({ character, setNotes, setRacialAbilityChoice, setBackgroundAbilityChoice, setSubclassOptions }: {
  character: Character;
  setNotes: (n: string) => void;
  setRacialAbilityChoice: (v: Partial<Record<AbilityKey, number>>) => void;
  setBackgroundAbilityChoice: (v: Partial<Record<AbilityKey, number>>) => void;
  setSubclassOptions: (v: Record<string, string[]>) => void;
}) {
  const { setExperiencePoints, setCampaignName, updateBackgroundCustom, addJournalEntry, updateJournalEntry, deleteJournalEntry, setSelectedLanguages, setSelectedToolProficiencies, setSelectedFeatPicks, setSelectedFeatExpertise } = useCharacterStore();
  const derived = useCharacterDerived(character);
  const languages: string[] = derived?.languages ?? [];
  const languagesOwed: number = derived?.languagesOwed ?? 0;
  const toolProficiencies: string[] = derived?.toolProficiencies ?? [];
  const toolChoices: any[] = derived?.toolChoices ?? [];
  const featPicks: any[] = derived?.featPicks ?? [];
  const featExpertiseOwed: number = derived?.featExpertiseOwed ?? 0;
  const featExpertise: string[] = derived?.featExpertise ?? [];
  const skillProfs: Set<string> = derived?.allSkillProficiencies ?? new Set();
  const bg = resolveBackground(character);
  const race = getRace(character.raceId);
  const bgAsiSource = getBackground(character.backgroundId);
  // Every class this character has, not just `classes[0]`. A multiclass character carries a level,
  // a feature list and a subclass PER class, and this panel used to render only the first one — so
  // a monk taken as a second class showed "Class: Fighter / Subclass: —", listed no monk features,
  // and (the part that isn't merely cosmetic) offered no subclass Choices picker, leaving Four
  // Elements disciplines and Kensei weapon proficiencies unreachable for the whole character.
  // Each row carries its OWN level: a group's allowance is keyed to the class's level, never the
  // character's total, or a monk 3 / fighter 3 would draw a 6th-level monk's second discipline.
  const classRows = character.classes.map((cl) => ({
    cl,
    def: getClass(cl.classId),
    subclass: cl.subclassId ? ALL_SUBCLASSES.find(s => s.id === cl.subclassId) ?? null : null,
  }));
  const feats = ALL_FEATS.filter(f => character.selectedFeats.includes(f.id));
  const totalLevel = totalCharacterLevel(character.classes);

  const co = character.classOptions ?? { fightingStyles: [], invocations: [], metamagic: [], maneuvers: [], infusions: [] };
  // Feat picks live in their own store, so each of these lists has to consider both. Fighting
  // Initiate, Eldritch Adept, Metamagic Adept and Martial Adept each grant one of these options
  // and were rendering nowhere at all — the pick had no home and the list never looked for it.
  const featPicked = new Set(Object.values(character.selectedFeatPicks ?? {}).flat());
  const has = (ids: string[] | undefined, id: string) => !!ids?.includes(id) || featPicked.has(id);
  const fightingStyles = ALL_FIGHTING_STYLES.filter(x => activeFightingStyles(character).includes(x.id));
  const invocations = ALL_INVOCATIONS.filter(x => has(co.invocations, x.id));
  const pactBoon = co.pactBoon ? ALL_PACT_BOONS.find(p => p.id === co.pactBoon) : null;
  const metamagic = ALL_METAMAGIC.filter(x => has(co.metamagic, x.id));
  const maneuvers = ALL_MANEUVERS.filter(x => has(co.maneuvers, x.id));
  const infusions = ALL_INFUSIONS.filter(x => co.infusions?.includes(x.id));

  return (
    <div className="space-y-4">
      {/* Character Info */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <SectionHeader>Character Info</SectionHeader>
        <div className="grid grid-cols-2 gap-3 text-sm">
          {[
            { label: 'Level', value: totalLevel },
            { label: 'XP', value: character.experiencePoints.toLocaleString() },
            { label: 'Race', value: race?.name ?? '—' },
            { label: 'Background', value: bg?.name ?? '—' },
            { label: 'Class', value: classRows.map(r => r.def?.name ?? '—').join(' / ') || '—' },
            { label: 'Subclass', value: classRows.filter(r => r.subclass).map(r => r.subclass!.name).join(' / ') || '—' },
            { label: 'Alignment', value: character.alignment },
            { label: 'Player', value: character.playerName || '—' },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-xs text-slate-400">{label}</p>
              <p className="text-white font-medium">{value}</p>
            </div>
          ))}
        </div>

        {/* XP + Campaign name row */}
        <div className="mt-3 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-400 shrink-0">XP:</label>
            <input
              type="number"
              min={0}
              value={character.experiencePoints}
              onChange={e => {
                const xp = Number(e.target.value);
                if (!isNaN(xp) && xp >= 0) setExperiencePoints(xp);
              }}
              className="w-28 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm"
            />
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <label className="text-xs text-slate-400 shrink-0">Campaign:</label>
            <input
              type="text"
              value={character.campaignName ?? ''}
              onChange={e => setCampaignName(e.target.value)}
              placeholder="Campaign name…"
              className="flex-1 min-w-0 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-slate-400"
            />
          </div>
        </div>
      </div>

      {/* D4 — subclass build choices, in their own card rather than under Racial Traits. On the
          sheet as well as the creator because a character made before the choice existed, or
          levelled past it, would otherwise never be able to supply it — exactly how Circle of the
          Land's land type stayed unreachable. Renders nothing when the subclass offers none. */}
      {classRows.map(({ cl, subclass }) => subclass && getSubclassOptions(subclass.id).length > 0 && (
        <div key={`choices-${cl.classId}`} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>{subclass.name} — Choices</SectionHeader>
          <SubclassOptionsPicker
            subclassId={subclass.id}
            classLevel={cl.level}
            enabledBooks={character.enabledBooks}
            value={character.subclassOptions}
            onChange={setSubclassOptions}
            compact
          />
        </div>
      ))}

      {/* Background Traits */}
      {bg && (
        <BackgroundSection
          bg={bg}
          bookBg={getBackground(character.backgroundId)}
          custom={character.backgroundCustom ?? {}}
          onChange={updateBackgroundCustom}
        />
      )}

      {/* Racial Traits */}
      {race && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Racial Traits: {race.name}</SectionHeader>
          {/* Races printed from Tasha's on let the player choose where the ability increase goes.
              The picker lives here as well as in the creator because race cannot change after
              creation — a creator-only control would leave every existing character permanently
              unable to supply the value, which is exactly how the Circle of the Land land type
              and the Deep Gnome spell ability were both unreachable. */}
          {race.flexibleAsi && (
            <div className="bg-slate-900 border border-amber-700/40 rounded-lg p-3 mb-2">
              <FlexibleAsiPicker
                source={race}
                value={character.racialAbilityChoice}
                onChange={setRacialAbilityChoice}
                compact
              />
            </div>
          )}
          {/* C7 — PHB 2024 puts the ability increase on the BACKGROUND. Same reasoning as the
              racial picker above: background cannot change after creation, so an existing 2024
              character needs this here or its +2/+1 is unreachable forever. */}
          {bgAsiSource?.flexibleAsi && (
            <div className="bg-slate-900 border border-amber-700/40 rounded-lg p-3 mb-2">
              <FlexibleAsiPicker
                source={bgAsiSource}
                value={character.backgroundAbilityChoice}
                onChange={setBackgroundAbilityChoice}
                label="Background Ability Score Increase"
                compact
              />
            </div>
          )}
          <div className="space-y-2">
            {race.traits.map(trait => (
              <div key={trait.name} className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs font-bold text-white mb-1">{trait.name}</p>
                <p className="text-xs text-slate-400 leading-relaxed">{trait.description}</p>
              </div>
            ))}
            {/* Darkvision was stored on 74 races and read ONLY by the creator's race badge, so it
                never reached the sheet, the print sheet or the PDF — the number you actually want
                mid-dungeon was the one place it wasn't. */}
            {race.darkvision != null && (
              <div className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs font-bold text-white mb-1">Darkvision</p>
                <p className="text-xs text-slate-400">{race.darkvision} ft</p>
              </div>
            )}
            {/* Languages were shown NOWHERE on the sheet, and the printed sheet listed the race's
                raw array — placeholder strings and all. This is the resolved list; the picker
                below appears only while a choice is still owed. */}
            {languages.length > 0 && (
              <div className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs font-bold text-white mb-1">Languages</p>
                <p className="text-xs text-slate-400">{languages.join(', ')}</p>
              </div>
            )}
            <LanguagePicker
              known={languages}
              owed={languagesOwed}
              selected={character.selectedLanguages ?? []}
              onChange={setSelectedLanguages}
              compact
            />
            {toolProficiencies.length > 0 && (
              <div className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs font-bold text-white mb-1">Tool Proficiencies</p>
                <p className="text-xs text-slate-400">{toolProficiencies.join(', ')}</p>
              </div>
            )}
            <ProficiencyPicker
              choices={toolChoices.map(c => ({
                key: c.text, label: c.text, count: c.grant.count, options: toolOptions(c.grant),
              }))}
              value={character.selectedToolProficiencies}
              onChange={setSelectedToolProficiencies}
              compact
            />
            {/* Feat-granted picks. Skilled, Skill Expert, Prodigy, Squat Nimbleness, Keen Mind,
                Observant and Weapon Master all named a proficiency in their description and
                granted none, because no field carried it and no picker offered it. */}
            <ProficiencyPicker
              choices={featPicks.filter(g => !g.auto).map(g => ({
                key: g.featId, label: `${g.featName} — ${g.label}`, count: g.count, options: g.options,
                // Fighting styles, invocations, metamagic and maneuvers are stored by id, so
                // without this the buttons would read "two-weapon-fighting". Skills, tools and
                // weapons store their printed name and fall through unchanged.
                labels: OPTION_LABELS,
              }))}
              value={character.selectedFeatPicks}
              onChange={setSelectedFeatPicks}
              compact
            />
            {featExpertiseOwed > 0 && (
              <ProficiencyPicker
                choices={[{
                  key: 'feat-expertise',
                  label: `Expertise — choose ${featExpertiseOwed}`,
                  count: featExpertiseOwed,
                  // Expertise doubles an existing proficiency, so the pool is what you are already
                  // proficient in — offering all eighteen would invite an illegal pick.
                  options: [...skillProfs].sort(),
                }]}
                value={{ 'feat-expertise': featExpertise }}
                onChange={(next) => setSelectedFeatExpertise(next['feat-expertise'] ?? [])}
                compact
              />
            )}
            {(race.resistances?.length ?? 0) > 0 && (
              <div className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs font-bold text-white mb-1">Damage Resistances</p>
                <p className="text-xs text-slate-400 capitalize">{race.resistances!.join(', ')}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Class Features — one card per class, so a multiclass character's second class is listed
          rather than silently dropped. */}
      {classRows.map(({ cl, def }) => def && (
        <div key={`feat-${cl.classId}`} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Class Features: {def.name} {cl.level}</SectionHeader>
          <div className="space-y-2">
            {def.features
              .filter(f => f.level <= cl.level)
              .sort((a, b) => a.level - b.level)
              .map((f, i) => (
                <HoverCard
                  key={i}
                  content={
                    <div>
                      <div className="flex items-center gap-1 mb-2">
                        <span className="text-xs bg-slate-700 text-slate-300 px-1 py-0.5 rounded">Lv.{f.level}</span>
                        <span className="text-xs font-bold text-white">{f.name}</span>
                      </div>
                      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{f.description}</p>
                    </div>
                  }
                >
                <div className="bg-slate-900 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">Lv.{f.level}</span>
                    <p className="text-xs font-bold text-white">{f.name}</p>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed line-clamp-3">{f.description}</p>
                </div>
                </HoverCard>
              ))}
          </div>
        </div>
      ))}

      {/* Subclass Features — likewise per class, and gated on that class's own level. */}
      {classRows.map(({ cl, def, subclass }) => subclass && (
        <div key={`sub-${cl.classId}`} className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>{def?.subclassLabel}: {subclass.name}</SectionHeader>
          <div className="space-y-2">
            {subclass.features
              .filter(f => f.level <= cl.level)
              .sort((a, b) => a.level - b.level)
              .map((f, i) => (
                <div key={i} className="bg-slate-900 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">Lv.{f.level}</span>
                    <p className="text-xs font-bold text-white">{f.name}</p>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{f.description}</p>
                </div>
              ))}
          </div>
        </div>
      ))}

      {/* Feats */}
      {feats.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Feats</SectionHeader>
          <div className="space-y-2">
            {feats.map(feat => (
              <HoverCard
                key={feat.id}
                content={
                  <div>
                    <p className="font-bold text-white text-sm mb-2">{feat.name}</p>
                    <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{feat.description}</p>
                  </div>
                }
              >
              <div className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs font-bold text-white mb-1">{feat.name}</p>
                <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line line-clamp-4">{feat.description}</p>
              </div>
              </HoverCard>
            ))}
          </div>
        </div>
      )}

      {/* Fighting Styles */}
      {fightingStyles.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Fighting Style{fightingStyles.length > 1 ? 's' : ''}</SectionHeader>
          <div className="space-y-2">
            {fightingStyles.map(fs => (
              <div key={fs.id} className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs font-bold text-white mb-1">{fs.name}</p>
                <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line">{fs.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pact Boon */}
      {pactBoon && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Pact Boon</SectionHeader>
          <div className="bg-slate-900 rounded-lg p-3">
            <p className="text-xs font-bold text-white mb-1">{pactBoon.name}</p>
            <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line">{pactBoon.description}</p>
          </div>
        </div>
      )}

      {/* Eldritch Invocations */}
      {invocations.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Eldritch Invocations</SectionHeader>
          <div className="space-y-2">
            {invocations.map(inv => (
              <div key={inv.id} className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs font-bold text-white mb-1">{inv.name}</p>
                <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line">{inv.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metamagic */}
      {metamagic.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Metamagic</SectionHeader>
          <div className="space-y-2">
            {metamagic.map(m => (
              <div key={m.id} className="bg-slate-900 rounded-lg p-3">
                <div className="flex items-baseline justify-between mb-1">
                  <p className="text-xs font-bold text-white">{m.name}</p>
                  <p className="text-[10px] text-yellow-400">{m.cost}</p>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line">{m.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Maneuvers */}
      {maneuvers.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Battle Master Maneuvers</SectionHeader>
          <div className="space-y-2">
            {maneuvers.map(m => (
              <div key={m.id} className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs font-bold text-white mb-1">{m.name}</p>
                <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line">{m.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Infusions */}
      {infusions.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <SectionHeader>Artificer Infusions Known</SectionHeader>
          <div className="space-y-2">
            {infusions.map(inf => (
              <div key={inf.id} className="bg-slate-900 rounded-lg p-3">
                <p className="text-xs font-bold text-white mb-1">{inf.name}</p>
                {inf.prerequisite && <p className="text-[10px] text-yellow-400 mb-1">Requires: {inf.prerequisite}</p>}
                <p className="text-xs text-slate-400 leading-relaxed whitespace-pre-line">{inf.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Campaign Journal */}
      <JournalSection
        entries={character.journal ?? []}
        onAdd={addJournalEntry}
        onUpdate={updateJournalEntry}
        onDelete={deleteJournalEntry}
      />

      {/* Notes */}
      <NotesSection notes={character.notes ?? ''} setNotes={setNotes} />
    </div>
  );
}

// ── Campaign Journal ────────────────────────────────────────────────────────────

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDate(iso: string) {
  if (!iso) return '';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

interface EntryFormState {
  sessionNumber: string;
  date: string;
  title: string;
  content: string;
}

const EMPTY_FORM: EntryFormState = { sessionNumber: '', date: todayISO(), title: '', content: '' };

function EntryForm({
  initial = EMPTY_FORM,
  onSave,
  onCancel,
  saveLabel = 'Save Entry',
}: {
  initial?: EntryFormState;
  onSave: (v: EntryFormState) => void;
  onCancel: () => void;
  saveLabel?: string;
}) {
  const [v, setV] = useState<EntryFormState>(initial);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  return (
    <div className="space-y-2 bg-slate-900 border border-slate-600 rounded-lg p-3">
      <div className="flex gap-2">
        <div className="w-20">
          <label className="text-[10px] text-slate-400 uppercase tracking-wide">Session #</label>
          <input
            type="number"
            min={1}
            value={v.sessionNumber}
            onChange={e => setV(p => ({ ...p, sessionNumber: e.target.value }))}
            placeholder="—"
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-slate-400"
          />
        </div>
        <div className="w-36">
          <label className="text-[10px] text-slate-400 uppercase tracking-wide">Date</label>
          <input
            type="date"
            value={v.date}
            onChange={e => setV(p => ({ ...p, date: e.target.value }))}
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-slate-400"
          />
        </div>
        <div className="flex-1 min-w-0">
          <label className="text-[10px] text-slate-400 uppercase tracking-wide">Title</label>
          <input
            ref={titleRef}
            type="text"
            value={v.title}
            onChange={e => setV(p => ({ ...p, title: e.target.value }))}
            placeholder="Session title…"
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-slate-400"
          />
        </div>
      </div>
      <textarea
        value={v.content}
        onChange={e => setV(p => ({ ...p, content: e.target.value }))}
        placeholder="What happened this session?"
        rows={5}
        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-400 resize-none"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-slate-400 hover:text-white rounded border border-slate-600 hover:border-slate-400 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => { if (v.title.trim()) onSave(v); }}
          disabled={!v.title.trim()}
          className="px-3 py-1.5 text-xs bg-violet-700 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded border border-violet-600 transition-colors flex items-center gap-1"
        >
          <Check size={11} /> {saveLabel}
        </button>
      </div>
    </div>
  );
}

function JournalSection({
  entries,
  onAdd,
  onUpdate,
  onDelete,
}: {
  entries: JournalEntry[];
  onAdd: (e: Omit<JournalEntry, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onUpdate: (id: string, patch: Partial<Pick<JournalEntry, 'title' | 'date' | 'sessionNumber' | 'content'>>) => void;
  onDelete: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  function handleAdd(v: EntryFormState) {
    onAdd({
      date: v.date,
      sessionNumber: v.sessionNumber ? Number(v.sessionNumber) : undefined,
      title: v.title.trim(),
      content: v.content,
    });
    setAdding(false);
  }

  function handleUpdate(id: string, v: EntryFormState) {
    onUpdate(id, {
      date: v.date,
      sessionNumber: v.sessionNumber ? Number(v.sessionNumber) : undefined,
      title: v.title.trim(),
      content: v.content,
    });
    setEditingId(null);
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <SectionHeader className="mb-0">Campaign Journal</SectionHeader>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setExpandedId(null); setEditingId(null); }}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-violet-300 transition-colors border border-slate-600 hover:border-violet-600 rounded-lg px-2 py-1"
          >
            <Plus size={11} /> New Entry
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-3">
          <EntryForm onSave={handleAdd} onCancel={() => setAdding(false)} saveLabel="Add Entry" />
        </div>
      )}

      {entries.length === 0 && !adding && (
        <p className="text-slate-500 text-sm italic">No journal entries yet. Click "+ New Entry" to start.</p>
      )}

      <div className="space-y-1.5">
        {entries.map(entry => {
          const isExpanded = expandedId === entry.id;
          const isEditing = editingId === entry.id;
          const sessionLabel = entry.sessionNumber != null ? `Session ${entry.sessionNumber}` : null;
          const dateLabel = entry.date ? formatDate(entry.date) : null;
          const meta = [sessionLabel, dateLabel].filter(Boolean).join(' · ');

          return (
            <div key={entry.id} className="border border-slate-700 rounded-lg overflow-hidden">
              {/* Header row */}
              <button
                onClick={() => {
                  if (isEditing) return;
                  setExpandedId(isExpanded ? null : entry.id);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-700/50 transition-colors text-left"
              >
                {sessionLabel && (
                  <span className="shrink-0 text-[10px] bg-violet-900/60 text-violet-300 border border-violet-700/50 px-1.5 py-0.5 rounded font-medium">
                    {sessionLabel}
                  </span>
                )}
                <span className="text-sm font-medium text-white truncate flex-1">{entry.title}</span>
                {dateLabel && <span className="text-[10px] text-slate-500 shrink-0">{dateLabel}</span>}
                <span className="text-slate-500 text-[10px] shrink-0 ml-1">{isExpanded ? '▲' : '▼'}</span>
              </button>

              {/* Expanded body */}
              {isExpanded && !isEditing && (
                <div className="px-3 pb-3 pt-1 bg-slate-900/50 border-t border-slate-700/50">
                  {meta && <p className="text-[10px] text-slate-500 mb-2">{meta}</p>}
                  <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{entry.content || <span className="italic text-slate-500">No notes written.</span>}</p>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => setEditingId(entry.id)}
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-violet-300 transition-colors border border-slate-600 hover:border-violet-600 rounded px-2 py-1"
                    >
                      <Pencil size={11} /> Edit
                    </button>
                    <button
                      onClick={() => { onDelete(entry.id); setExpandedId(null); }}
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-red-400 transition-colors border border-slate-600 hover:border-red-700 rounded px-2 py-1"
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  </div>
                </div>
              )}

              {/* Inline edit form */}
              {isEditing && (
                <div className="px-3 pb-3 pt-2 bg-slate-900/50 border-t border-slate-700/50">
                  <EntryForm
                    initial={{
                      sessionNumber: entry.sessionNumber != null ? String(entry.sessionNumber) : '',
                      date: entry.date ?? todayISO(),
                      title: entry.title,
                      content: entry.content,
                    }}
                    onSave={v => handleUpdate(entry.id, v)}
                    onCancel={() => setEditingId(null)}
                    saveLabel="Save Changes"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Notes with built-in search ─────────────────────────────────────────────────
function NotesSection({ notes, setNotes }: { notes: string; setNotes: (n: string) => void }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery]           = useState('');
  const [matchIdx, setMatchIdx]     = useState(0);
  const taRef    = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Compute all match positions (case-insensitive)
  const matches = useMemo<{ start: number; end: number }[]>(() => {
    if (!query.trim()) return [];
    const lower = notes.toLowerCase();
    const q     = query.toLowerCase();
    const found: { start: number; end: number }[] = [];
    let i = 0;
    while (i <= lower.length - q.length) {
      const idx = lower.indexOf(q, i);
      if (idx === -1) break;
      found.push({ start: idx, end: idx + q.length });
      i = idx + 1;
    }
    return found;
  }, [notes, query]);

  // Reset to first match whenever query changes
  useEffect(() => { setMatchIdx(0); }, [query]);

  // Jump to the current match inside the textarea
  useEffect(() => {
    if (!matches.length || !taRef.current) return;
    const { start, end } = matches[Math.min(matchIdx, matches.length - 1)];
    const ta = taRef.current;
    ta.focus();
    ta.setSelectionRange(start, end);
    // Scroll so the selection is roughly centred
    const lineHeight = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    const linesBefore = notes.slice(0, start).split('\n').length - 1;
    ta.scrollTop = Math.max(0, linesBefore * lineHeight - ta.clientHeight / 2);
  }, [matchIdx, matches, notes]);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
    setMatchIdx(0);
  }, []);

  const next = useCallback(() =>
    setMatchIdx(i => matches.length ? (i + 1) % matches.length : 0),
  [matches.length]);

  const prev = useCallback(() =>
    setMatchIdx(i => matches.length ? (i - 1 + matches.length) % matches.length : 0),
  [matches.length]);

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter')     { e.preventDefault(); next(); }
    if (e.key === 'Escape')    { closeSearch(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); next(); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); prev(); }
  }

  const hasResults   = matches.length > 0;
  const noResults    = query.trim().length > 0 && matches.length === 0;
  const currentLabel = hasResults ? `${matchIdx + 1}/${matches.length}` : null;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      {/* Header row */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={searchOpen ? closeSearch : openSearch}
          title={searchOpen ? 'Close search' : 'Search notes'}
          className={cn(
            'p-0.5 rounded transition-colors shrink-0',
            searchOpen ? 'text-sky-400 hover:text-sky-300' : 'text-slate-500 hover:text-slate-300',
          )}
        >
          <Search size={13} />
        </button>
        <SectionHeader className="mb-0">Notes</SectionHeader>
      </div>

      {/* Search bar — slides in when open */}
      {searchOpen && (
        <div className="flex items-center gap-1.5 mb-2 bg-slate-900 border border-slate-600 rounded-lg px-2 py-1">
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            placeholder="Find in notes…"
            className="flex-1 min-w-0 bg-transparent text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
          />
          {currentLabel && (
            <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">{currentLabel}</span>
          )}
          {noResults && (
            <span className="text-[10px] text-red-400 shrink-0">no results</span>
          )}
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={prev}
              disabled={!hasResults}
              title="Previous match"
              className="p-0.5 rounded text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-colors"
            >
              <ChevronUp size={13} />
            </button>
            <button
              onClick={next}
              disabled={!hasResults}
              title="Next match"
              className="p-0.5 rounded text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-colors"
            >
              <ChevronDown size={13} />
            </button>
            <button
              onClick={closeSearch}
              title="Close search"
              className="p-0.5 rounded text-slate-500 hover:text-slate-300 transition-colors ml-0.5"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Textarea — raw element so we can attach a ref */}
      <textarea
        ref={taRef}
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Adventure notes, reminders, contacts, lore..."
        className="w-full min-h-32 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-red-500 transition-colors resize-none"
      />
    </div>
  );
}

// ── Background: book mechanics, player's words ─────────────────────────────────
// `bg` is the resolved background (player text already laid over the book's);
// `bookBg` is the raw book entry, kept only to offer the original wording as a
// placeholder so it's obvious what a blank field falls back to.
function BackgroundSection({
  bg,
  bookBg,
  custom,
  onChange,
}: {
  bg: Background;
  bookBg: Background | undefined;
  custom: BackgroundCustom;
  onChange: (patch: Partial<BackgroundCustom>) => void;
}) {
  const [editing, setEditing] = useState(false);

  const fields = [
    { key: 'personalityTraits', label: 'Personality Traits', book: bookBg?.personalityTraits },
    { key: 'ideals', label: 'Ideals', book: bookBg?.ideals },
    { key: 'bonds', label: 'Bonds', book: bookBg?.bonds },
    { key: 'flaws', label: 'Flaws', book: bookBg?.flaws },
  ] as const;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <SectionHeader className="mb-0">Background: {bg.name}</SectionHeader>
        <button
          onClick={() => setEditing(e => !e)}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-violet-300 transition-colors border border-slate-600 hover:border-violet-600 rounded-lg px-2 py-1"
        >
          {editing ? <><Check size={11} /> Done</> : <><Pencil size={11} /> Edit</>}
        </button>
      </div>

      <div className="mb-3 bg-slate-900 rounded-lg p-3">
        <p className="text-xs font-bold text-slate-300 mb-1">Feature: {bg.feature.name}</p>
        <p className="text-xs text-slate-400 leading-relaxed">{bg.feature.description}</p>
      </div>

      {editing ? (
        <div className="space-y-3">
          <p className="text-[10px] text-slate-500">Blank fields use {bookBg?.name ?? 'the book'}'s default text. Editing these never changes your proficiencies or feature.</p>
          <div>
            <label className="text-xs font-bold text-slate-400">Background Name</label>
            <input
              type="text"
              value={custom.name ?? ''}
              onChange={e => onChange({ name: e.target.value })}
              placeholder={bookBg?.name ?? ''}
              className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
            />
          </div>
          {fields.map(f => (
            <div key={f.key}>
              <label className="text-xs font-bold text-slate-400">{f.label}</label>
              <textarea
                value={custom[f.key] ?? ''}
                onChange={e => onChange({ [f.key]: e.target.value })}
                placeholder={f.book?.[0] ?? ''}
                rows={2}
                className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-violet-500 resize-y"
              />
            </div>
          ))}
          <div>
            <label className="text-xs font-bold text-slate-400">Backstory</label>
            <textarea
              value={custom.backstory ?? ''}
              onChange={e => onChange({ backstory: e.target.value })}
              placeholder="Who were you before the first session?"
              rows={6}
              className="mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-violet-500 resize-y"
            />
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <TraitSection title="Personality Traits" items={bg.personalityTraits.slice(0, 2)} />
            <TraitSection title="Ideals" items={bg.ideals.slice(0, 1)} />
            <TraitSection title="Bonds" items={bg.bonds.slice(0, 1)} />
            <TraitSection title="Flaws" items={bg.flaws.slice(0, 1)} />
          </div>
          {custom.backstory?.trim() && (
            <div className="mt-2 bg-slate-900 rounded-lg p-3">
              <p className="text-xs font-bold text-slate-400 mb-1">Backstory</p>
              <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">{custom.backstory}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TraitSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="bg-slate-900 rounded-lg p-3">
      <p className="text-xs font-bold text-slate-400 mb-1">{title}</p>
      {items.map((item, i) => (
        <p key={i} className="text-xs text-slate-300 italic leading-relaxed">"{item}"</p>
      ))}
    </div>
  );
}
