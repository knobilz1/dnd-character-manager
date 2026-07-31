"""Phase A: every class feature vs any mechanical implementation.

R20 established the shape at subclass level by naming instances. This sweeps ALL 488 class features
across both editions systematically, so the finding is a coverage number rather than a list of the
ones somebody happened to look at.

A feature is flagged when its description makes a MECHANICAL claim of a kind the app has a field for,
and no implementation exists for it. "Implementation" means one of:
  - a resource whose key or name matches (the R5 layer)
  - a derived-stat field the claim maps to (speed, resistances, proficiencies, expertise...)
  - the feature's own name appearing in code outside src/data (a hardcoded branch)
  - it is an ASI/feat slot, which the level-up dialog handles generically

Claim categories are deliberately narrow and objective. Narrative or DM-facing text ("you can find
food and water", "you gain a reputation") is not a mechanical claim and is not flagged — inflating
the list with those would make it useless for triage, which is the failure mode of the first D4 sweep.
"""
import re, sys, io, os, collections
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
ROOT = r'C:\Users\nabil\Desktop\Code\dnd-character-manager\src'

# ── every class feature ──────────────────────────────────────────────────────
def unesc(x):
    return x.replace("\\'", "'")


def brace_object(s, start):
    """Text of the {...} beginning at `start`, respecting quotes and escapes."""
    depth, in_str, esc = 0, False, False
    for i in range(start, len(s)):
        ch = s[i]
        if in_str:
            if esc: esc = False
            elif ch == '\\': esc = True
            elif ch == "'": in_str = False
        elif ch == "'": in_str = True
        elif ch == '{': depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return s[start:i + 1]
    return None


feats = []
for label, path in (('2014', r'data\classes\index.ts'), ('2024', r'data\classes\phb2024.ts')):
    s = open(os.path.join(ROOT, path), encoding='utf-8').read()
    cls_at = [(m.start(), m.group(1)) for m in re.finditer(r"^    id: '([a-z0-9-]+)',", s, re.M)]

    def owner(pos):
        best = '?'
        for start, cid in cls_at:
            if start <= pos:
                best = cid
            else:
                break
        return best

    # every object literal that has BOTH a name and a level is a feature; field order varies
    # (isASI/featOnly sit between them in places), so pull each field out independently
    for m in re.finditer(r"\{\s*name: '", s):
        obj = brace_object(s, m.start())
        if obj is None:
            continue
        nm = re.search(r"name: '((?:[^'\\]|\\.)*)'", obj)
        lv = re.search(r"level: (\d+)", obj)
        de = re.search(r"description: '((?:[^'\\]|\\.)*)'", obj)
        if not (nm and lv):
            continue          # resource defs and other name-bearing objects have no level
        feats.append({'ed': label, 'classId': owner(m.start()), 'name': unesc(nm.group(1)),
                      'level': int(lv.group(1)), 'desc': unesc(de.group(1)) if de else '',
                      'isASI': 'isASI: true' in obj})

assert len(feats) >= 470, 'class feature parse collapsed: %d (expected ~488)' % len(feats)
by_class = collections.Counter(f['classId'] for f in feats)
assert '?' not in by_class, 'some features could not be attributed to a class'
assert len(by_class) == 25, 'features attributed to %d classes, expected 25' % len(by_class)
print('class features parsed: %d across %d classes (2014=%d, 2024=%d)'
      % (len(feats), len(by_class), sum(f['ed'] == '2014' for f in feats), sum(f['ed'] == '2024' for f in feats)))

# ── what the app can actually express ────────────────────────────────────────
data_blob = ''
for p in (r'data\classes\index.ts', r'data\classes\phb2024.ts',
          r'data\subclasses\index.ts', r'data\subclasses\phb2024.ts', r'data\feats.ts'):
    data_blob += open(os.path.join(ROOT, p), encoding='utf-8').read()
resource_keys = set(re.findall(r"key: '([a-z0-9_]+)'", data_blob))
resource_names = set(n.replace("\\'", "'").lower() for n in re.findall(r"name: '((?:[^'\\]|\\.)*)', key:", data_blob))

# every non-data source file, for hardcoded branches
code_blob = ''
for base, _, files in os.walk(ROOT):
    if os.sep + 'data' in base:
        continue
    for fn in files:
        if fn.endswith(('.ts', '.tsx')):
            code_blob += open(os.path.join(base, fn), encoding='utf-8', errors='replace').read()
assert len(code_blob) > 300000, 'code blob too small (%d) — walk failed' % len(code_blob)

# controls
assert 'rage' in resource_keys, 'positive control: rage key missing'
assert 'sneakAttackDice' in code_blob, 'positive control: code blob missing a known symbol'
print('resource keys: %d, code corpus: %d chars, controls ok\n' % (len(resource_keys), len(code_blob)))


def slug(name):
    return re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')


def implemented(f):
    """Any evidence the app does something with this feature."""
    if f['isASI']:
        return 'ASI (generic)'
    s = slug(f['name'])
    if s in resource_keys:
        return 'resource key'
    if f['name'].lower() in resource_names:
        return 'resource name'
    # a hardcoded branch anywhere in code: the feature name, or its slug, or a camelCase form
    camel = re.sub(r'_(.)', lambda m: m.group(1).upper(), s)
    for probe in (f['name'], s, camel):
        if len(probe) > 4 and probe in code_blob:
            return 'code reference'
    return None


# ── mechanical claim categories, narrow and objective ────────────────────────
CLAIMS = [
    ('speed',       r'(?:your (?:walking )?speed increases by|speed increases by \d+)'),
    ('resistance',  r'you have resistance to'),
    ('proficiency', r'you (?:gain|have) proficiency (?:with|in)'),
    ('expertise',   r'expertise|double your proficiency bonus'),
    ('advantage',   r'you have advantage on'),
    ('spell-grant', r'(?:is always prepared|always prepared for you|doesn\'t count against|you learn the .{3,40} spell)'),
    ('extra-attack', r'you can attack twice|two attacks instead of one'),
]

flagged = collections.defaultdict(list)
impl_counts = collections.Counter()
for f in feats:
    low = f['desc'].lower()
    imp = implemented(f)
    impl_counts[imp or 'NONE'] += 1
    for cat, pat in CLAIMS:
        if re.search(pat, low):
            if imp is None:
                flagged[cat].append(f)

print('implementation evidence across all %d features:' % len(feats))
for k, v in impl_counts.most_common():
    print('   %-16s %d' % (k, v))
print()

total = 0
for cat, _ in CLAIMS:
    rows = flagged[cat]
    total += len(rows)
    print('### CLAIMS "%s" WITH NO IMPLEMENTATION (%d)' % (cat.upper(), len(rows)))
    for f in sorted(rows, key=lambda x: (x['classId'], x['level'])):
        print('   %-16s lv%-3s %-34s %s' % (f['classId'][:16], f['level'], f['name'][:34], f['desc'][:64].replace('\n', ' ')))
    print()

print('class features swept: %d   flagged: %d' % (len(feats), total))
