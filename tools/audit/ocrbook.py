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

sys.path.insert(0, os.path.dirname(__file__))
import r6verify as V  # noqa: E402

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# The page's own text layer is print furniture, not content. Dropped so it cannot pollute a search
# (every page would otherwise contain a date and a URL).
FURNITURE = re.compile(r'^\s*(\d+/\d+/\d+,.*|https?://\S+.*|\d+/\d+)\s*$', re.M)


def ocr_page(img_bytes, tmpdir, i):
    src = os.path.join(tmpdir, f'p{i}.png')
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
            imgs = list(pg.images)
            txt = ''
            if imgs:
                txt = ocr_page(imgs[0].data, tmp, i)
            if not txt.strip():
                txt = pg.extract_text() or ''
            out.append(FURNITURE.sub('', txt))
            if (i + 1) % 10 == 0:
                print(f'  {i + 1}/{len(r.pages)} pages, {sum(len(x) for x in out):,} chars',
                      flush=True)
    text = '\n'.join(out)
    if rng:
        print(text[:3000])
        print(f'\n[{len(pages)} pages, {len(text):,} chars — sample only, cache not written]')
        return
    os.makedirs(V.CACHE, exist_ok=True)
    with open(key, 'w', encoding='utf-8') as f:
        f.write(text)
    print(f'\nwrote {len(text):,} chars to {key}')


if __name__ == '__main__':
    main()
