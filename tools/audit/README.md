# Audit tooling — read this before writing a new sweep

These scripts compare the app's data against the rulebooks. The traps below are not hypothetical:
every one cost real time, most of them more than once.

## The one rule

**A tool that cannot perceive something reports that the something is absent — in exactly the same
format as a real finding.** Measure the instrument before trusting the measurement.

On 2026-08-01 that pattern produced, in a single day: "Spelljammer has no text" (it is 219 page
images), "the app invented 1d6" (MMoM writes dice as `ld6`, 202 times to 2), "the app invented
Charisma" (the 2024 PHB's text layer rendered it `'~!1a­risma`), and "Volo's cannot be OCR'd" (two
bugs of mine). In the same run, "Leonin is not in MMoM" and "Giff is the playtest race" were TRUE.
The four false ones and the two true ones were indistinguishable by inspection.

## Before believing any result

- **Run `bookquality.py` first.** It probes each book for words a rulebook cannot lack and for
  known damage. 12 of 17 books are damaged. `debook()` in `racepdf.py` repairs the ligature and
  dice cases at comparison time — new code must either use it or handle the damage itself.
- **Keep a known-good control.** PHB extracts cleanly, so PHB findings are trustworthy. A sweep
  with no clean control cannot tell its own bugs from the app's.
- **Gate on pairing, and print matched/total before any finding.** "0 mismatches" over 3% pairing
  is worthless. `racepdf.py` refuses to report until it has located entries, and flags thin books.
- **Check the probe can fail AND can pass.** Stash the fix and re-run: the count must go up.
  A field list of `[]` means a claim can never be marked covered, and reads as permanent work.
- **Check the baseline lacks what you're proving.** A weapon negative control against a fighter
  cannot fail — fighters are proficient with everything.

## PDF specifics

- Text is **searched flat** (`60feet`) but must be **compared raw** (`60 feet`), or a
  word-boundary regex matches nothing. `r6verify._flatten` gives the normalised→raw index map.
- Page images: take the **largest** image on the page, not `images[0]` — some pages lead with a
  decorative rule. Decode through **PIL**, never by writing bytes to a `.png` name; Volo's pages
  are JPEG 2000 and tesseract fails silently on a mis-named file.
- The **back-of-book index out-scores the real entry** if you rank windows by how many trait names
  are nearby. Discriminate on what FOLLOWS the name: a page number means index, prose means entry.
- The PDFs are **pre-errata printings**. A difference is not automatically an app bug — PHB
  Tiefling says "once per day" where the app correctly uses the errata's long-rest wording.
- The `md/` extracts are **summaries**, not verbatim. Use them for numbers and rules; use the PDFs
  for anything about wording.
- `.pdfcache/` holds full book text and is gitignored by `tools/audit/.gitignore`. Keep it that
  way, and **never print book prose** to a terminal or transcript — to check an OCR run, measure
  character density and the share of well-formed words instead.

## The data's own quirks

- `parentRaceId` is **dangling**: the app flattens base races away, so there is no race with id
  `elf`, only `elf-high` etc. carrying the merged trait list. Looking the parent up returns None.
- Race and feat descriptions are deliberate **paraphrase**, not quotation. A verbatim diff yields
  hundreds of findings, none real. Compare the mechanical vocabulary only.
- A 2014 **variant** is printed as trait replacements, not as a race — SCAG's Feral tiefling is one
  line, while the app models it as a full race carrying the PHB tiefling's traits.

## Scripts

| Script | Does |
|---|---|
| `bookquality.py` | Extraction health for every book. **Start here.** |
| `ocrcompare.py` | Is OCR better than a book's text layer? Measures a sample before you spend hours. |
| `ocrbook.py` | OCR a book whose pages are images; writes to the same cache `book_text` reads. |
| `racepdf.py` | Race traits vs the books. Carries `debook()` and `BOOK_PDF`. |
| `r6verify.py` | `book_text()` + the flat/raw index map. Reused by everything. |
| `bundle.mjs` | Bundles a `src/` module so probes import the REAL data instead of parsing TS. |
| `featmirror/featpicks/featspells/featresources/featproficiency/featclassoptions.mjs` | Feat sweeps; each fails on pre-fix code. |
| `creatorcarry.mjs` | Guards that `finalize()` drops no player choice — it is a whitelist. |
