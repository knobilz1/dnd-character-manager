"""Dump an item's raw book entry from the cached PDF text, for hand-reading.

Usage: python tools/audit/r6dump.py ARRAY "Item Name" [span]
"""
import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, __import__('os').path.dirname(__file__))
from r6verify import ARRAY_PDF, book_text, find_entry, clip_to_entry

arr, name = sys.argv[1], sys.argv[2]
span = int(sys.argv[3]) if len(sys.argv) > 3 else 1100
raw = find_entry(book_text(ARRAY_PDF[arr]), name, span)
print(f'--- {name} ({arr}) ---')
print(' '.join(clip_to_entry(raw).split()) if raw else 'NOT FOUND')
