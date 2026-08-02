"""R6 verification — check every charged item's maxCharges/recharge against the actual rulebook.

The previous pass declared this "a false positive, all 38 are fine" on the theory that the app's
descriptions are terse and the DMG markdown had no recharge clauses. Both halves were wrong: the
markdown DOES carry them, and the PDFs are OCR-searchable. So actually check.

Source of truth is the PDF (OCR text layer), with the markdown extract as a cross-check.
PDF text is OCR'd with spacing noise ("meta l tube", "u ncommon"), so ALL matching is done on
letters-only normalised text and the raw slice is printed for a human to read.

Usage:  python tools/audit/r6verify.py [namefilter]
"""
import json
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

REF = r'C:\Users\nabil\Desktop\Code\reference-books'
CACHE = os.path.join(os.path.dirname(__file__), '.pdfcache')

# which ItemTemplate array came from which book PDF
ARRAY_PDF = {
    'MAGIC_ITEMS': "D&D 5E - Dungeon Master's Guide.pdf",
    'DMG_EXTRA':   "D&D 5E - Dungeon Master's Guide.pdf",
    'TREASURE':    "D&D 5E - Dungeon Master's Guide.pdf",
    'XGTE_ITEMS':  "Xanathar's Guide To Everything.pdf",
    'TCE_ITEMS':   "Tasha\u2019s Cauldron of Everything.pdf",
    'EGTW_ITEMS':  "Explorer's Guide To Wildemount.pdf",
    'FTOD_ITEMS':  "fizban-tresury-of-dragons.pdf",
    'GGR_ITEMS':   "Guildmasters guide to Ravnica.pdf",
    'SJA_ITEMS':   "Spelljammer - Adventures in Space - Bob Flip PDF _ AnyFlip.pdf",
    'SCOC_ITEMS':  "Strixhaven- A Curriculum of Chaos.pdf",
    'ERLW_ITEMS':  "D&D 5E - Eberron - Rising from the Last War.pdf",
}

norm = lambda s: re.sub(r'[^a-z0-9]', '', (s or '').lower())


def book_text(pdf):
    """Whole-book text, cached to disk — extraction is slow and we re-run this a lot."""
    os.makedirs(CACHE, exist_ok=True)
    key = os.path.join(CACHE, norm(pdf)[:60] + '.txt')
    if os.path.exists(key):
        return open(key, encoding='utf-8').read()
    from pypdf import PdfReader
    r = PdfReader(os.path.join(REF, pdf))
    out = []
    for p in r.pages:
        try:
            out.append(p.extract_text() or '')
        except Exception:
            out.append('')
    t = '\n'.join(out)
    open(key, 'w', encoding='utf-8').write(t)
    return t


# An item ENTRY always opens with a type/rarity line. A random-treasure TABLE row does not.
# Without this anchor the search lands on "Ring of evasion 18 Armor of vulnerability 66" and
# then confidently diffs the app against a page-number index.
ENTRY_MARK = re.compile(
    r'wondrous\s+item|requires?\s+attunement|\b(?:very\s+rare|legendary|uncommon|rare|common|artifact)\b'
    r'|\b(?:weapon|armor|ring|rod|staff|wand|potion|scroll|wondrous)\s*[,(]', re.I)

_INDEX_CACHE = {}


def _flatten(text):
    """(letters-only text, normalised->raw index map), cached per book.

    The cache entry KEEPS A REFERENCE to `text`, and that is the whole point of storing it.
    `id()` is a memory address: once a book's text is garbage-collected the next book allocated
    can land on the same address and silently receive the previous book's character index, so
    every window offset is computed against the wrong text. Holding the string alive makes the
    address unique for the life of the process.

    It presents as a sweep that is not deterministic ACROSS RUNS IN ONE PROCESS while being
    perfectly deterministic in isolated ones — spell width 550 read 256 findings between runs of
    500 and 600 that read 92 and 87. Every knob-pricing table built by looping settings in one
    process is affected, which is how the item window was chosen.
    """
    key = id(text)
    if key not in _INDEX_CACHE:
        raw_idx, buf = [], []
        for i, ch in enumerate(text):
            c = ch.lower()
            if c.isalnum():
                buf.append(c)
                raw_idx.append(i)
        _INDEX_CACHE[key] = (text, ''.join(buf), raw_idx)
    return _INDEX_CACHE[key][1:]


def find_entry(text, name, span=1400):
    """Locate an item's ENTRY (not any mention) and return the raw slice after the heading.

    Scores every occurrence: an entry is followed closely by a type/rarity line; a table row is
    followed by page numbers. Returns the best-scoring occurrence, or None if none looks like an
    entry at all (better to report NOT FOUND than to diff against the index).
    """
    base = re.sub(r',\s*\+\d.*$', '', name)
    base = re.sub(r'\s*\(.*?\)\s*$', '', base).strip()
    target = norm(base)
    if not target:
        return None
    flat, raw_idx = _flatten(text)

    best, best_score = None, 0
    pos = flat.find(target)
    while pos >= 0:
        end = min(pos + len(target), len(raw_idx) - 1)
        after = text[raw_idx[end]: raw_idx[end] + 220]
        m = ENTRY_MARK.search(after)
        if m:
            # closer type/rarity line == more likely a real entry heading
            score = 200 - min(m.start(), 199)
            # a table row reads "Ring of evasion 18 ..." — digits right after the name
            if re.match(r'\W{0,3}\d', after):
                score -= 150
            if score > best_score:
                best_score, best = score, text[raw_idx[end]: raw_idx[end] + span]
        pos = flat.find(target, pos + 1)
    return best


RECHARGE_PAT = [
    (r'daily\s+at\s+dawn', 'dawn'),
    (r'until\s+the\s+next\s+dawn', 'dawn'),
    (r'at\s+(?:the\s+next\s+)?dawn', 'dawn'),
    (r'regains?\s+all\s+.{0,24}charges', 'dawn'),
    (r'finish(?:ed)?\s+a\s+long\s+rest', 'long'),
    (r'short\s+or\s+long\s+rest', 'short'),
    (r'finish(?:ed)?\s+a\s+short\s+rest', 'short'),
    (r'cracks?\s+and\s+becomes?\s+use\s*less', 'NONE (destroyed)'),
    (r'crumbles?\s+(?:into|to)\s+(?:powder|dust)', 'NONE (destroyed)'),
    (r'becomes?\s+(?:a\s+)?nonmagical', 'NONE (destroyed)'),
    (r'(?:it\s+)?is\s+destroyed', 'NONE (destroyed)'),
    (r'can\s*\'?t\s+regain\s+charges|no\s+charges?\s+are\s+regained', 'NONE (destroyed)'),
]

# The next item's heading, in OCR form: its own line, mostly capitals.
# Bounding on this is load-bearing — a 1400-char slice off "Chime of Opening" runs into
# "CIRCLET OF BLASTING ... until the next dawn" and reports the neighbour's recharge as the
# chime's. That produced a false OK on an item the DMG says cracks after ten uses.
NEXT_HEADING = re.compile(r'\n\s*([A-Z][A-Z0-9 ,\'’+\-/]{5,})\s*\n')


def clip_to_entry(raw):
    m = NEXT_HEADING.search(raw, 60)
    return raw[:m.start()] if m else raw


def recharge_from(raw):
    """Return (verdict, evidence) — EARLIEST match by position, not by pattern order."""
    flat = re.sub(r'[ \t]+', ' ', clip_to_entry(raw))
    hits = []
    for pat, verdict in RECHARGE_PAT:
        m = re.search(pat, flat, re.I)
        if m:
            hits.append((m.start(), m.end(), verdict))
    if not hits:
        return None, re.sub(r'\s+', ' ', flat)[:160].strip()
    s, e, verdict = min(hits)
    return verdict, re.sub(r'\s+', ' ', flat[max(0, s - 150):e + 60]).strip()


def main():
    items = json.load(open(os.path.join(os.path.dirname(__file__), 'r6items.json'), encoding='utf-8'))
    filt = norm(sys.argv[1]) if len(sys.argv) > 1 else None
    agree = disagree = nosource = 0
    for it in items:
        if filt and filt not in norm(it['name']):
            continue
        pdf = ARRAY_PDF.get(it['array'])
        if not pdf or not os.path.exists(os.path.join(REF, pdf)):
            print(f'[NO PDF ] {it["array"]:12} {it["name"]}')
            nosource += 1
            continue
        raw = find_entry(book_text(pdf), it['name'])
        if not raw:
            print(f'[NOT FND] {it["array"]:12} {it["name"]}')
            nosource += 1
            continue
        verdict, ev = recharge_from(raw)
        have = it.get('recharge')
        want = None if verdict and verdict.startswith('NONE') else (verdict or '').rstrip('?')
        ok = (have == want) or (verdict is None)
        (globals().__setitem__('_', None))
        if verdict is None:
            tag = '[?SOURCE]'
            nosource += 1
        elif ok:
            tag = '[  OK   ]'
            agree += 1
        else:
            tag = '[MISMATCH]'
            disagree += 1
        print(f'{tag} {it["name"]:42} app(max={it.get("maxCharges")},rec={have}) '
              f'book={verdict}')
        if not ok or verdict is None:
            print(f'          evidence: {ev[:300]}')
    print(f'\n# agree={agree} mismatch={disagree} unresolved={nosource}')


if __name__ == '__main__':
    main()
