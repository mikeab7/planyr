# Notes conflict-review critique loop (B849104/B849105/B849106/B849107)

Referenced from `ConflictReview.jsx`'s header. Screenshots referenced here were produced by
`node ui-audit/verify-notes-conflict-review.mjs` (writes to `/tmp/claude-conflict-review-shots/`
— not committed; regenerate to re-look) against the owner's exact reported case, reproduced on
scratch data: a signature-block table on the older copy (4 days ago), converted to plain contact
lines on the newer copy (1 day ago) — matching what `convertTableToText` (B649377) actually
produces.

The six questions, run against real rendered screenshots (light/dark × desktop/narrow, plus the
edit-time-unknown fallback), per the brief:

1. Can I tell in under one second which button keeps the newer version, without reading body
   text?
2. If I clicked the wrong one, would I have been able to predict that from the label alone?
3. Could I explain to a colleague what each button does, from the screenshot, in one sentence
   each?
4. Does this look out of place next to Google Docs version history?
5. Would I ship this to a paying customer?
6. With the colour removed entirely, could I still tell what changed and in which direction?
   (NEW-4's addition.)

## Round 1

Built the redesign: recency-derived headings ("Newer version — edited 1d ago" / "Older version
— edited 4d ago"), recency-derived button text ("Keep the newer version" / "Keep the older
version"), a shared "nothing is lost" line stated once instead of per-column, a sticky legend
covering both encodings the renderer emits (inline underline/strikethrough for a word-level
edit, a block-level "+ Added"/"− Removed" tag for a whole item), and an explicit "✕ Decide
later" close control instead of a bare "✕".

Screenshotted and read against the six questions: passed 1–3 and 5–6 cleanly (the button text
alone answers "which is newer" and "what happens if I pick it"; the "+ Added"/"− Removed" words
survive with colour removed). On Q4, the layout reads as a reasonable relative — not a literal
skin of Google Docs' version list, but the same underlying idea (identify by *when*, act by a
verb that names the version) carried into a two-column comparison, which is the right shape for
resolving exactly two candidates rather than browsing a long history.

No visual layout issue found in round 1 — the design was built with the anti-patterns and the
dual-encoding gap already in mind (see `ConflictReview.jsx`'s own header for the history of what
those were), so the first render already avoided them. That is not the same as the loop having
nothing to check: round 2 below is what it was for.

## Round 2

Re-read the SAME screenshots plus the edit-time-unknown fallback fixture (`?fixture=unknown` —
neither copy's edit time is known, the rare degrade path) specifically hunting for something
round 1 missed. Found one:

**The fallback legend's prose was grammatically broken.** `roleLabel()`'s fallback strings are
"This window's version" (no article) and "The other window's version" (article built in) — two
different shapes, because English does not put "the" before a demonstrative. The legend template
wrapped BOTH in an external "the": `in the <label>` produced **"in the this window's version"**
and **"keeping the the other window's version"** — a double article, sitting in the one sentence
whose entire job is to tell the owner which copy has which text when the panel cannot rank them
by time. This is exactly the class of thing a critique loop run only once would ship: it reads
fine skimmed, and is wrong on a second, closer read.

Fix: `rolePhrase()`, a second, MID-SENTENCE-safe form of each slot's name that is always a
complete, self-contained phrase ("the newer version", "this window's version", "the other
window's version") — no caller ever prepends its own article again. Re-screenshotted; the
fallback sentence now reads "Underlined text or a + Added tag is only in this window's version —
keeping the other window's version loses it." with no double article, in both the redline legend
and (by construction, since `ChoiceColumn`/`VersionCard` never used the phrase form to begin
with) nowhere else needed the same fix.

Re-ran all six questions against the corrected fallback screenshot: passes. Re-ran the full
`verify-notes-conflict-review.mjs` suite (24 checks, including the direction/label/legend/defer
assertions against the comparable fixture) — all green, confirming the grammar fix touched only
prose, not the underlying direction logic.

## Stopping condition

Two rounds, the second one finding and fixing a real defect the first one's own construction did
not surface. Stopping here per the brief ("stop when the screenshot passes, not when the controls
exist") — the screenshots pass the six questions in both themes, both widths, and the one
fallback state that has its own distinct wording to get right.
