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

## Stopping condition (rounds 1–2)

Two rounds, the second one finding and fixing a real defect the first one's own construction did
not surface. Stopping here per the brief ("stop when the screenshot passes, not when the controls
exist") — the screenshots pass the six questions in both themes, both widths, and the one
fallback state that has its own distinct wording to get right.

---

## Round 3–4 (B842944–B842948, owner redlines, 2026-09-03)

Michael marked up a screenshot of his own LIVE conflict panel — the one this document's rounds 1–2
shipped — with five separate notes (never touched: the reference conflict itself, only reproduced
on scratch data via `ui-audit/conflict-review-harness.html`). Full detail on each fix is in
`ConflictReview.jsx`'s own header and the notes workspace `CLAUDE.md`'s B842944–B842948 entry; this
section is the critique-loop record the brief asked for.

**Round 3 — built the redesign, ran the six questions against `node
ui-audit/verify-notes-conflict-review.mjs`'s fresh screenshots** (both themes × desktop/narrow,
`/tmp/claude-conflict-review-shots/`): passed cleanly. The two Keep buttons are filled, Notes'
own accent, labelled + timestamped as one control, sitting close together, centered; the mode
toggle and Decide later read as real controls; the legend is two short fragments; the reassurance
line is a quiet caption, not a banner. Q3 ("does the header ever cover a single character of the
note?") could not be answered from the short fixture alone — it never scrolls far enough to test
the exact failure Michael reported.

**Round 4 — a targeted stress render, because Q3 is the one question a short fixture cannot
answer.** Loaded the harness, opened the review, then injected forty extra paragraphs into the
redline body (a one-off diagnostic script, not a committed fixture) ending in the owner's own
reported text — `jerry@broadacrellc.com` / `M: (832) 309-0891` — and scrolled halfway down.
Screenshot: those exact lines render in full, directly under the docked version bar, with a clean
divider and zero overlap — the header never entered the content's paint area at any scroll
position, which is the structural guarantee `overflow-y: auto` clipping gives a DOCKED sibling
that `position: sticky` inside the same scrolling box never had. This is the same case that broke
round 1–2's shipped design (sticky, inside the scroll pane) once real long-note content met it —
worth recording so a future session does not reach for `position: sticky` here again believing it
already "stays visible" is the same thing as "never overlaps."

## Stopping condition (rounds 3–4)

Two rounds again: round 3 covered the five items generically, round 4 specifically stress-tested
the one item (NEW-2) most likely to hide a subtle regression under a short fixture. Both passed;
stopping per the same rule — the screenshots pass, including the one that reproduces his exact
reported text scrolling cleanly under the header.
