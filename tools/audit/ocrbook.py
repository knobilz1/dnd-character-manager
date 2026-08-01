"""OCR a PDF whose pages are IMAGES, and write the result into the same cache the sweeps read.

Some books here are print-to-PDF captures of a web viewer: every page carries a text layer, but it
holds only the browser furniture ("9/15/22, 10:50 PM … anyflip.com/fqhgb/ytev/ 21/219") while the
book itself is one embedded image per page. `pypdf.extract_text` therefore returns ~120 characters
a page and the book reads as empty — which is why the Spelljammer races and spells were written
off as unverifiable rather than merely unread.

Writes to tools/audit/.pdfcache/ under the SAME key `r6verify.book_text` uses, so every existing
sweep picks the text up with no change.

The cache is gitignored and MUST stay that way: it is the full text of copyrighted books, held
locally to diff the app's data against the source Nabil owns. For the same reason this script
never prints book prose — a --pages run reports density and word-shape statistics, which is what
actually tells you whether OCR worked.

Usage: python tools/audit/ocrbook.py "<pdf filename>" [--pages A-B] [--force]
"""
import os
import re
import subprocess
import sys
import tempfile
from io import BytesIO as io_bytes

sys.path.insert(0, os.path.dirname(__file__))
import r6verify as V  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# The page's own text layer is print furniture, not content. Dropped so it cannot pollute a search
# (every page would otherwise contain a date and a URL).
FURNITURE = re.compile(r'^\s*(\d+/\d+/\d+,.*|https?://\S+.*|\d+/\d+)\s*$', re.M)


def page_image(pg):
    """The page's own scan, which is the LARGEST image on it.

    Not `images[0]`: some books place a logo or a decorative rule first, and taking that yields a
    few characters for a whole page. VGM looked like it simply would not OCR — 17 characters from
    18 pages — until this was the difference.
    """
    best, size = None, 0
    for im in pg.images:
        try:
            data = im.data
        except Exception:                                    # noqa: BLE001
            continue
        if len(data) > size:
            best, size = data, len(data)
    return best


def ocr_page(img_bytes, tmpdir, i):
    # Decode through PIL rather than writing the raw bytes out with a .png name. Volo's pages are
    # JPEG 2000 (Im0.jp2), and tesseract simply fails on a mis-named file — the book looked like it
    # would not OCR at all, 17 characters from 18 pages, purely because of the extension.
    src = os.path.join(tmpdir, f'p{i}.png')
    try:
        from PIL import Image
        Image.open(io_bytes(img_bytes)).convert('RGB').save(src)
    except Exception:                                        # noqa: BLE001
        with open(src, 'wb') as f:
            f.write(img_bytes)
    out = os.path.join(tmpdir, f'p{i}')
    r = subprocess.run(['tesseract', src, out, '--psm', '3'],
                       capture_output=True, text=True)
    if r.returncode:
        return ''
    try:
        with open(out + '.txt', encoding='utf-8', errors='replace') as f:
            return f.read()
    except FileNotFoundError:
        return ''


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    pdf = args[0]
    rng = next((a.split('=', 1)[-1] for a in sys.argv if a.startswith('--pages')), None)
    if rng and '=' not in rng:
        rng = sys.argv[sys.argv.index('--pages') + 1]
    force = '--force' in sys.argv

    key = os.path.join(V.CACHE, V.norm(pdf)[:60] + '.txt')
    if os.path.exists(key) and not force and not rng:
        cur = open(key, encoding='utf-8').read()
        # A capture's furniture-only layer is ~120 chars/page; real text is far denser. Refuse to
        # overwrite a cache that already looks like a real extraction.
        if len(cur) > 200_000:
            sys.exit(f'cache already holds {len(cur):,} chars — pass --force to replace')

    from pypdf import PdfReader
    r = PdfReader(os.path.join(V.REF, pdf))
    pages = range(len(r.pages))
    if rng:
        a, _, b = rng.partition('-')
        pages = range(int(a), int(b or a) + 1)

    out = []
    with tempfile.TemporaryDirectory() as tmp:
        for i in pages:
            pg = r.pages[i]
            txt = ''
            img = page_image(pg)
            if img is not None:
                txt = ocr_page(img, tmp, i)
            if not txt.strip():
                txt = pg.extract_text() or ''
            out.append(FURNITURE.sub('', txt))
            if (i + 1) % 10 == 0:
                print(f'  {i + 1}/{len(r.pages)} pages, {sum(len(x) for x in out):,} chars',
                      flush=True)
    text = '\n'.join(out)
    if rng:
        # Statistics, never the prose itself — see the module docstring. What tells you an OCR run
        # worked is density and word shape: a failed page yields a handful of 1-2 letter fragments,
        # a good one yields ~2,500 chars of mostly real words.
        words = re.findall(r'[A-Za-z]+', text)
        frag = 100 * sum(1 for w in words if len(w) <= 2) / max(1, len(words))
        n = len(list(pages))
        print(f'[{n} pages, {len(text):,} chars, {len(text) // max(1, n):,}/page, '
              f'{len(words):,} words, {frag:.1f}% fragments — sample only, cache not written]')
        return
    os.makedirs(V.CACHE, exist_ok=True)
    with open(key, 'w', encoding='utf-8') as f:
        f.write(text)
    print(f'\nwrote {len(text):,} chars to {key}')


if __name__ == '__main__':
    main()
