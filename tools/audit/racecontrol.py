"""Negative control for racepdf, which had never had one.

racepdf has no --control flag: its 98%/96% figures came from a scratch script, and the tool
itself cannot answer "can this sweep fail?". Any scoring change to it is therefore unmeasured by
default — including the inherited-trait retry.

Rather than refactor its 100-line main(), this corrupts what races() returns and reads the finding
names back off stdout. Same two controls as everywhere else.

Usage: RACE_BUNDLE=<races.mjs> python racecontrol.py [impossible|plausible]
"""
import io
import os
import re
import sys
from contextlib import redirect_stdout

REPO = r'C:\Users\nabil\Desktop\Code\dnd-character-manager'
sys.path.insert(0, os.path.join(REPO, 'tools', 'audit'))
os.chdir(REPO)

import racepdf as R  # noqa: E402
from subclasspdf import _impossible, _plausible  # noqa: E402

MODE = sys.argv[1] if len(sys.argv) > 1 else 'impossible'
mangle = _impossible if MODE == 'impossible' else _plausible

real = R.races()


def corrupt():
    out, changed = [], set()
    for r in real:
        traits = []
        for t in r['traits']:
            d = mangle(t.get('d') or '')
            if d != (t.get('d') or ''):
                changed.add(r['name'])
            traits.append(dict(t, d=d))
        out.append(dict(r, traits=traits))
    corrupt.changed = changed
    return out


R.races = corrupt
# main() reads sys.argv and treats any positional as a BOOK FILTER — leaving 'impossible'
# there matched no book and printed "NOTHING PAIRED", which looks like a broken sweep.
# --full is NOT optional here. main() truncates each finding category to 25 entries without it,
# and this harness reads detections off stdout — so the FIRST run of this control reported 36%
# for a sweep that detects 96%. A probe that cannot see all of what it measures reports the
# shortfall as a failure of the thing measured.
sys.argv = [sys.argv[0], '--full']
buf = io.StringIO()
with redirect_stdout(buf):
    R.main()
text = buf.getvalue()

# Only the FINDINGS section counts. Notes ("INHERITED", "NAME OUTSIDE ENTRY") are explicitly not
# findings, and counting them as detections would let the sweep take credit for entries it never
# compared — the same inflation that made fighting styles read 100% before hidden entries were
# excluded.
body = text.split('Not findings')[0]
flagged = set(re.findall(r'^- \*\*(.+?)\*\*', body, re.M))
changed = corrupt.changed
det = changed & flagged
print(f'CONTROL[{MODE}]: {len(changed)} corrupted, {len(det)} detected '
      f'({100 * len(det) // max(1, len(changed))}%)')
missed = sorted(changed - flagged)
print('  missed: none' if not missed else f'  MISSED ({len(missed)}): ' + ', '.join(missed[:12]))
