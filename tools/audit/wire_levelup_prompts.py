"""Make the level-up dialog PROMPT for the two things it silently skipped.

Fighting styles and subclass build choices were only reachable in the creator, so a character who
levelled INTO them (a Champion reaching 10, a Four Elements monk reaching 6) was never asked and
silently went without. Both pickers already exist; nothing called them from here.
"""
import io

P = 'src/pages/sheet/LevelUpDialog.tsx'

EDITS = [
    # ── imports ──────────────────────────────────────────────────────────────
    (
        "import { ALL_FEATS, getEligibleFeats } from '../../data/feats';",
        "import { ALL_FEATS, getEligibleFeats } from '../../data/feats';\n"
        "import { ALL_FIGHTING_STYLES, fightingStylesAllowed } from '../../data/fightingStyles';\n"
        "import { SubclassOptionsPicker } from '../creator/steps/SubclassOptionsPicker';\n"
        "import { getSubclassOptions, picksAllowed } from '../../data/subclassOptions';",
    ),
    # ── state ────────────────────────────────────────────────────────────────
    (
        "  const [pendingOptionalFeatures, setPendingOptionalFeatures] = React.useState<string[]>([]);",
        "  const [pendingOptionalFeatures, setPendingOptionalFeatures] = React.useState<string[]>([]);\n"
        "  const [pendingFightingStyles, setPendingFightingStyles] = React.useState<string[]>([]);\n"
        "  // Subclass build choices (Four Elements disciplines, Kensei weapons, Runes, Arcane Shots).\n"
        "  // null = untouched this level-up; anything else replaces character.subclassOptions.\n"
        "  const [pendingSubclassOptions, setPendingSubclassOptions] =\n"
        "    React.useState<Record<string, string[]> | null>(null);",
    ),
    # ── reset when the chosen class changes ──────────────────────────────────
    (
        "    setPendingExpertise([]);\n  }, [selectedClassIdx, newClassId]);",
        "    setPendingExpertise([]);\n"
        "    setPendingFightingStyles([]);\n"
        "    setPendingSubclassOptions(null);\n"
        "  }, [selectedClassIdx, newClassId]);",
    ),
    # ── persist on confirm ───────────────────────────────────────────────────
    (
        "        pendingInfusions.length || pendingOptionalFeatures.length) {",
        "        pendingInfusions.length || pendingOptionalFeatures.length ||\n"
        "        pendingFightingStyles.length) {",
    ),
    (
        "        optionalFeatures: [...new Set([...(existing.optionalFeatures ?? []), ...pendingOptionalFeatures])],\n      });",
        "        optionalFeatures: [...new Set([...(existing.optionalFeatures ?? []), ...pendingOptionalFeatures])],\n"
        "        fightingStyles: [...new Set([...(existing.fightingStyles ?? []), ...pendingFightingStyles])],\n"
        "      });",
    ),
    (
        "    // `classId` (= classDef.id), not `primary.classId`",
        "    // Subclass choices write to their own field, not classOptions.\n"
        "    if (pendingSubclassOptions) setSubclassOptions(pendingSubclassOptions);\n\n"
        "    // `classId` (= classDef.id), not `primary.classId`",
    ),
    (
        "  const { addSpellToBook, updateClassOptions } = useCharacterStore();",
        "  const { addSpellToBook, updateClassOptions, setSubclassOptions } = useCharacterStore();",
    ),
]

# ── computed values + the two new sections, inserted before the invocations block ──
# Anchored on code, not on the section's comment rule: the box-drawing dashes in those comments
# are not worth counting exactly.
ANCHOR = "        {isWarlock && totalNewInvocations > 0 && ("

SECTIONS = """        {/* ─── Fighting Style ──────────────────────────────────────────────── */}
        {fightingStylesOwed > 0 && (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
              Fighting Style{fightingStylesOwed > 1 ? 's' : ''} — choose {fightingStylesOwed}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {fightingStylesAvail.map(fs => {
                const on = pendingFightingStyles.includes(fs.id);
                const full = !on && pendingFightingStyles.length >= fightingStylesOwed;
                return (
                  <button
                    key={fs.id}
                    disabled={full}
                    onClick={() => setPendingFightingStyles(p =>
                      p.includes(fs.id) ? p.filter(x => x !== fs.id) : [...p, fs.id])}
                    className={cn(
                      'p-3 rounded-lg border-2 text-left transition-all',
                      on ? 'border-red-500 bg-red-950/30' : 'border-slate-700 bg-slate-800 hover:border-slate-500',
                      full && 'opacity-40 cursor-not-allowed',
                    )}
                  >
                    <p className="text-sm font-bold text-white">{fs.name}</p>
                    <p className="text-xs text-slate-400 line-clamp-2">{fs.description}</p>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* ─── Subclass choices ────────────────────────────────────────────── */}
        {subclassChoicesOwed && (
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
              {subclassForOptions?.name} — new choice available
            </h3>
            <SubclassOptionsPicker
              subclassId={subclassForOptions?.id}
              classLevel={newLevel}
              value={pendingSubclassOptions ?? character.subclassOptions}
              onChange={setPendingSubclassOptions}
              compact
            />
          </section>
        )}

"""

COMPUTED = """  // ── Fighting Style / subclass choices owed AT THE NEW LEVEL ───────────────
  // Both pickers already existed, in the creator only, so a character who LEVELLED into a choice
  // was never asked for it: a Champion reaching 10 got no second style, a Four Elements monk
  // reaching 6 got no second discipline. They stayed silently unspent.
  const fightingStyleBase = baseClassId(classId);
  const fightingStylesOwed = Math.max(
    0,
    fightingStylesAllowed(fightingStyleBase, primary?.subclassId ?? pendingSubclass, newLevel)
      - (classOpts.fightingStyles ?? []).length,
  );
  const fightingStylesAvail = ALL_FIGHTING_STYLES
    .filter(fs => bookEnabled(fs, character.enabledBooks))
    .filter(fs => fs.classes.includes(fightingStyleBase))
    .filter(fs => !(classOpts.fightingStyles ?? []).includes(fs.id));

  const subclassForOptions = getSubclass(primary?.subclassId ?? pendingSubclass ?? '');
  // Owed only when the allowance GREW at this level — otherwise every level-up would nag about a
  // choice the player deliberately left open.
  const subclassChoicesOwed = !!subclassForOptions && getSubclassOptions(subclassForOptions.id).some(g => {
    const picked = (character.subclassOptions?.[g.key] ?? []).length;
    return picksAllowed(g, newLevel) > picked && picksAllowed(g, newLevel) > picksAllowed(g, newLevel - 1);
  });

"""


def main():
    s = io.open(P, encoding='utf-8').read()
    for old, new in EDITS:
        assert s.count(old) == 1, 'anchor %r found %d times' % (old[:60], s.count(old))
        s = s.replace(old, new)
    assert s.count(ANCHOR) == 1, 'render anchor found %d times' % s.count(ANCHOR)
    s = s.replace(ANCHOR, SECTIONS + ANCHOR)
    # Computed block goes just before the JSX return of the dialog body.
    ret = '  return (\n    <Dialog open={open}'
    assert s.count(ret) == 1, 'return anchor found %d times' % s.count(ret)
    s = s.replace(ret, COMPUTED + ret)
    io.open(P, 'w', encoding='utf-8', newline='').write(s)
    print('wired %d edits + 2 sections + computed block' % len(EDITS))


if __name__ == '__main__':
    main()
