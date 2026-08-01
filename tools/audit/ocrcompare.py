"""Is OCR actually BETTER than a book's existing text layer? Measure a sample before re-OCRing it.

OCR is not free and not automatically an improvement: it takes minutes per book and introduces its
own errors. The 2024 PHB was worth it (its layer was character-mangled) and Spelljammer was
essential (no layer at all), but a book whose only fault is writing "ld6" may come out worse, since
`debook()` already repairs that at comparison time.

So: OCR a sample of pages, extract the same pages from the text layer, and compare on signals that
say which one a sweep can trust — dice written with a digit, core vocabulary present, and how much
of the text is one- and two-character fragments.

Usage: python tools/audit/ocrcompare.py <BookId> [firstPage] [lastPage]
"""
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(__file__))
import r6verify as V  # noqa: E402
from bookquality import BOOK_PDF  # noqa: E402
from ocrbook import ocr_page, page_image, FURNITURE  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

MUST = ['proficiency', 'advantage', 'damage', 'saving throw', 'spell', 'creature']


def score(text, label):
    words = re.findall(r'[A-Za-z]+', text)
    frag = 100 * sum(1 for w in words if len(w) <= 2) / max(1, len(words))
    good = len(re.findall(r'\b1d\d', text))
    bad = len(re.findall(r'\bld\d', text))
    found = sum(1 for w in MUST if re.search(w, text, re.I))
    print(f'  {label:12} {len(text):8,} chars | dice 1d:{good:4} ld:{bad:4} | '
          f'vocab {found}/{len(MUST)} | fragments {frag:4.1f}%')
    return {'chars': len(text), 'good': good, 'bad': bad, 'vocab': found, 'frag': frag}


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    book = sys.argv[1]
    a = int(sys.argv[2]) if len(sys.argv) > 2 else 30
    b = int(sys.argv[3]) if len(sys.argv) > 3 else a + 19

    from pypdf import PdfReader
    r = PdfReader(os.path.join(V.REF, BOOK_PDF[book]))
    pages = range(a, min(b + 1, len(r.pages)))
    print(f'{book}: comparing pages {a}-{min(b, len(r.pages) - 1)} of {len(r.pages)}\n')

    layer = '\n'.join((r.pages[i].extract_text() or '') for i in pages)
    ocr = []
    with tempfile.TemporaryDirectory() as tmp:
        for i in pages:
            img = page_image(r.pages[i])
            ocr.append(FURNITURE.sub('', ocr_page(img, tmp, i)) if img is not None else '')
    ocr = '\n'.join(ocr)

    ls = score(layer, 'text layer')
    os_ = score(ocr, 'OCR')

    print()
    if os_['chars'] < ls['chars'] * 0.5:
        print('  VERDICT: keep the text layer — OCR recovered far less text.')
    elif os_['bad'] > ls['bad'] and ls['bad'] == 0:
        print('  VERDICT: keep the text layer — OCR introduced dice errors the layer did not have.')
    elif ls['bad'] > ls['good'] and os_['good'] > os_['bad']:
        print('  VERDICT: RE-OCR — the layer mis-reads dice as letters and OCR reads them correctly.')
    elif os_['vocab'] > ls['vocab']:
        print('  VERDICT: RE-OCR — OCR recovers vocabulary the layer is missing.')
    elif os_['frag'] < ls['frag'] - 3:
        print('  VERDICT: RE-OCR — markedly less fragmented.')
    else:
        print('  VERDICT: no clear gain — keep the text layer and let debook() handle the damage.')


if __name__ == '__main__':
    main()
