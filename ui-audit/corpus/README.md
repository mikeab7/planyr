# Title-block scoring corpus (B356)

Drop the owner's **extracted title-block text** here to score the real readers
(`node ui-audit/score-filing.mjs`). This folder is intentionally empty of corpus data —
the text comes from the owner's Drive once the Claude Code connector is re-authorized to
**michael@planyr.io** (the training PDFs live at *My Drive › Planyr › Training Files*).

## Format

One `.txt` file per drawing. **The filename IS the ground truth** — keep the original
descriptive PDF name and append `.txt`:

```
2024-10-22 - JACINTOPORT - STRUCTURAL - IFC.pdf.txt
Bergstrom Phase 2a - Arch IFP 2025.10.24.pdf.txt
2023.05.30 Mesa - Plumbing.pdf.txt
```

The file's **contents** = the PDF's first ~2 pages of embedded text (the title block /
cover). Get it from the Drive connector's **`read_file_content`** (returns extracted text,
small) — **not** `download_file_content` (returns 10–94 MB of base64 and blows up context).

## Run

```
node ui-audit/score-filing.mjs
```

Prints a per-file scorecard (project / discipline / date / revision / scale) and field
pass-rates. `✓` pass · `✗` miss (tune the table/regex, then add a unit test with the real
snippet) · `△` correct only by resolving to "Other" (a discipline-taxonomy gap to raise with
the owner) · `·` not graded (the filename doesn't state that field).

Real `.txt` corpus files are **git-ignored** below (only this README is tracked) so the
owner's drawings never get committed.
