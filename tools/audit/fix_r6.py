"""R6 fix — add maxCharges/recharge to the 15 items verified against the actual rulebooks.

Every value below was read out of the book PDF this session (see AUDIT-FINDINGS R6). Nothing here
is recalled; the evidence column is the sentence the value came from.

Asserts each item is matched exactly once and does not already carry maxCharges, so a re-run or a
renamed item fails loudly instead of silently doing nothing.
"""
import re
import sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
SRC = 'src/data/items.ts'

# name -> (maxCharges, recharge, evidence sentence from the book)
FIX = {
    "Lorehold Primer":     (3, 'dawn', 'SCoC: "has 3 charges, and it regains 1d3 expended charges daily at dawn"'),
    "Prismari Primer":     (3, 'dawn', 'SCoC: same clause'),
    "Quandrix Primer":     (3, 'dawn', 'SCoC: same clause'),
    "Silverquill Primer":  (3, 'dawn', 'SCoC: same clause'),
    "Witherbloom Primer":  (3, 'dawn', 'SCoC: same clause'),
    "Belashyrra's Beholder Crown": (10, 'dawn', 'ERLW: "The crown regains 1d6+3 expended charges daily at dawn" (10 charges)'),
    "Earworm":             (4, 'dawn', 'ERLW: "The earworm has 4 charges ... regains 1d4 expended charges daily at dawn"'),
    "Ghost Step Tattoo":   (3, 'dawn', 'TCE: "The tattoo has 3 charges, and it regains all expended charges daily at dawn"'),
    "Eldritch Claw Tattoo": (1, 'dawn', 'TCE: "Once used, this bonus action can\'t be used again until the next dawn"'),
    "Crook of Rao":        (6, 'dawn', 'TCE: "The crook has 6 charges ... regains 1d6 expended charges daily at dawn"'),
    "Demonomicon of Iggwilv": (8, 'dawn', 'TCE: "The book has 8 charges. It regains 1d8 expended charges daily at dawn"'),
    "Bowl of Commanding Water Elementals":   (1, 'dawn', "DMG: \"The bowl can't be used this way again until the next dawn\""),
    "Brazier of Commanding Fire Elementals": (1, 'dawn', "DMG: \"The brazier can't be used this way again until the next dawn\""),
    "Censer of Controlling Air Elementals":  (1, 'dawn', "DMG: \"The censer can't be used this way again until the next dawn\""),
    "Stone of Controlling Earth Elementals": (1, 'dawn', "DMG: \"The stone can't be used this way again until the next dawn\""),
}

text = open(SRC, encoding='utf-8').read()
done = 0
for name, (mc, rc, why) in FIX.items():
    q = '"' if "'" in name else "'"
    needle = '{ name: %s%s%s,' % (q, name, q)
    hits = [m.start() for m in re.finditer(re.escape(needle), text)]
    assert len(hits) == 1, f'{name}: expected 1 match, got {len(hits)}'
    start = hits[0]
    end = text.index('\n', start)
    line = text[start:end]
    assert 'maxCharges' not in line, f'{name}: already tracked — refusing to double-apply'
    close = line.rindex('}')
    text = text[:start] + line[:close].rstrip().rstrip(',') + \
        f", maxCharges: {mc}, recharge: '{rc}' " + line[close:] + text[end:]
    print(f'  {name:40} maxCharges={mc} recharge={rc}')
    print(f'      {why}')
    done += 1

assert done == len(FIX)
open(SRC, 'w', encoding='utf-8', newline='').write(text)
print(f'\napplied {done} items to {SRC}')
