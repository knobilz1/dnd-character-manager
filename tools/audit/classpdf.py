"""Base-class features vs the PDFs — 25 classes, 494 features.

Deliberately thin. A class is the same shape as a subclass — a named entity carrying named,
levelled features — so this reuses `subclasspdf.sweep` and both of its controls outright rather
than growing a fourth near-copy of the same locator. Everything the other sweeps paid for comes
with it: de-hyphenation, split dice, TCE's split unit word, source-side-only readings of bare dice
/ spelled-out dice counts / "spell save DC", the index-vs-entry discriminator, dual extraction,
and the coverage gate.

ONE REAL DIFFERENCE, and it is the reason this file exists at all: a class occupies a whole
CHAPTER, not an entry. Barbarian's features run from Rage to Primal Champion across tens of
thousands of characters, so the entry span is far wider than a subclass's 12,000. The per-feature
comparison window is NOT widened to match — that is priced at 2,400 by the plausible control and
widening it trades real detection for a quieter report.

Usage: CLASS_BUNDLE=<bundled classes.mjs> python tools/audit/classpdf.py [book] [--full]
       ... --control [--plausible]
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(__file__))
import subclasspdf  # noqa: E402

# A class chapter, not an entry. Measured against the alternative: at subclasspdf's 12,000 the
# late features of every long class fall outside the span and are reported missing.
subclasspdf.SPAN = 90000


def classes():
    scratch = os.environ.get('CLASS_BUNDLE')
    if not scratch:
        sys.exit('set CLASS_BUNDLE to a bundled classes.mjs path')
    out = subprocess.run(
        ['node', '-e',
         'const {pathToFileURL}=await import("node:url");'
         'const m=await import(pathToFileURL(process.argv[1]).href);'
         'console.log(JSON.stringify(m.ALL_CLASSES.map(c=>({id:c.id,name:c.name,'
         'book:c.sourceBook,'
         'features:(c.features??[]).map(f=>({name:f.name,level:f.level,d:f.description??""}))}))));',
         scratch],
        capture_output=True, text=True, encoding='utf-8')
    if out.returncode:
        sys.exit(out.stderr[:800])
    return json.loads(out.stdout)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    full = '--full' in sys.argv
    rows = classes()
    if '--control' in sys.argv:
        subclasspdf.control(rows, 'plausible' if '--plausible' in sys.argv else 'impossible')
        return

    stats, findings, notes, paired, unpaired, nobook = subclasspdf.sweep(
        rows, args[0] if args else None)
    considered = paired + unpaired + nobook
    print(f'# {considered} classes considered\n')
    print('| book | paired | total | no PDF | features | names found |')
    print('|---|---|---|---|---|---|')
    for b, st in sorted(stats.items()):
        thin = '  ⚠ THIN' if st['nobook'] == 0 and st['total'] and st['paired'] / st['total'] < 0.8 else ''
        print(f"| {b} | {st['paired']} | {st['total']} | {st['nobook']} | {st['feats']} | "
              f"{st['found']} |{thin}")
    print(f'\npaired {paired} + unpaired {unpaired} + no-PDF {nobook} = {considered}')
    if paired == 0:
        sys.exit('\nNOTHING PAIRED — any findings below would be meaningless.')

    def dump(rows_):
        kinds = {}
        for r in rows_:
            kinds.setdefault(r[0], []).append(r)
        for kind, lst in kinds.items():
            print(f'\n## {kind} ({len(lst)})')
            for _, name, book, what, note in (lst if full else lst[:25]):
                print(f'- **{name}** [{book}]' + (f' — {what}' if what else '')
                      + (f'  ({note})' if note else ''))
            if not full and len(lst) > 25:
                print(f'  … {len(lst) - 25} more (pass --full)')

    dump(findings)
    if notes:
        print('\n---\n# Not findings — the audit read the wrong window or the wrong extraction')
        dump(notes)
    print(f'\n{len(findings)} findings over {paired} paired classes'
          + (f'  (+{len(notes)} explained above)' if notes else ''))


if __name__ == '__main__':
    main()
