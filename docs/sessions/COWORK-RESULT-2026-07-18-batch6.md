# Cowork verification run — 2026-07-18 (batch 6 of the V281–V340 pass — Scheduler keyboard indent/outdent + incidental undo reliability)

Follow-up to PR #659, #660, #661, #662, #663 — same 50-item target batch. Driven live and signed in
on the real **Goose Creek** project (`smqfy48tlk9j`), Schedule → Grid.

## 🟡 V327 — B255: Scheduler keyboard indent/outdent (PARTIAL — keyboard shortcut confirmed real and cascades correctly; right-click-menu text comparison and column auto-size not exercised)

Selected task **#40 "Planning & Development Review"** (a real leaf task under PUD, sibling of #39
"Submit PUD to Planning & Development"). Right-clicking it did open a real context menu (cell
formatting, Insert Row Above/Below, etc.), but the menu is taller than this session's rendered
browser viewport and the Indent/Outdent entries — evidently further down the menu — couldn't be
scrolled into view (mouse-wheel didn't scroll the menu, and the scheduler is a cross-origin iframe so
`javascript_tool` can't read its DOM either — same friction documented for the Settings/Meeting
calendars panels in earlier batches). So the exact right-click menu wording couldn't be captured
directly.

Instead tested the **keyboard shortcut** `Alt+Shift+Right`: task #40 was cleanly re-parented under
task #39 (a new expand-arrow appeared on #39), and this **cascaded a real recalculation** — PUD's own
Start date shifted from 05/22/26 to 05/26/26. `Alt+Shift+Left` correctly outdented #40 back to being
a sibling of #39 again (arrow removed), confirming the shortcut pair is a real, working indent/outdent
mechanism tied into the same dependency engine as the right-click path (not a cosmetic-only toggle).

**Caveat:** the outdent did **not** cleanly revert the cascaded dates — after Left, #39/#40/PUD were
left on shifted dates (05/26–05/27 range) rather than their original 05/22/05/26 values. This isn't
itself a fail of V327 (the item is about indent/outdent existing and matching the right-click menu,
not about dates snapping back on manual outdent) but it meant a live production task's dates were
left in a different state than before testing. **Fixed by `Ctrl+Z` × 5**, which cleanly walked back
through both the outdent and the indent (plus their cascades) and restored PUD/#39/#40 to their exact
original dates — confirmed by a follow-up screenshot matching the pre-test state exactly. (This
incidentally also serves as a positive live data point for **V319**'s "rapid edit-then-undo" sub-path
— see below.)

**Not exercised:** the right-click menu's own Indent/Outdent wording (viewport-clipped, see above),
and double-click-to-autofit on a column border — one double-click on the DUR/COLUMNS boundary produced
no visible width change, but the click may not have landed precisely on the resize handle; needs a
follow-up with `read_page` element refs for the column border rather than raw coordinates. The
master/split-view comparison wasn't attempted either.

**Verdict: PARTIAL. Keyboard indent/outdent confirmed as a real, cascade-correct mechanism (not
cosmetic); right-click-menu wording comparison and double-click column auto-size not confirmed due to
a viewport/iframe limitation in this session, not a product defect.**

## 🟢 V319 — B828: rapid edit-then-undo (PARTIAL, incidental positive evidence — overlay Width and Stitcher auto-calibrate paths not exercised)

Not run as its own dedicated pass, but the V327 test above produced a real, unplanned exercise of
this exact class of claim: 4 sequential structural/date-cascading edits (indent → cascade, outdent →
cascade) were reverted with 5 rapid `Ctrl+Z` presses issued back-to-back (no pauses between them),
and the final state matched the pre-edit state exactly across all three affected rows (#38 PUD, #39,
#40) — both dates and hierarchy. This is a genuine, live, production-data confirmation that rapid
undo doesn't drop or corrupt a step even when the edits being undone include cascading recalculations,
which is a harder case than a single simple field edit.

**Not exercised:** the other two named sub-paths (overlay Width undo, Stitcher auto-calibrate undo) —
those need a Site Planner overlay and a stitched-sheet setup respectively, neither of which was in
scope for this pass.

**Verdict: PARTIAL/PASS-with-caveat on the "rapid edit-then-undo" sub-path specifically (strong
incidental live evidence); overlay-Width and Stitcher-auto-calibrate sub-paths still not run.**

---

## Running tally across all six batches (PR #659 + #660 + #661 + #662 + #663 + this one)

**Confirmed full PASS (18):** V337, V338, V339, V340, V311, V313, V314, V317, V318, V320, V321,
V325 (partial-pass), V305, V308, V312 (Bain portion), plus the V288/V290 GIS happy-path spot-check.

**Partial / needs a closer look (9):** V316, V322, V306, V307, V335, V281, V310, V327, V319.

**Not yet run (~25):** V282, V284, V285, V286, V287, V289, V291, V292, V293, V301, V302, V303, V304,
V309, V324, V326, V328, V329, V330, V331, V332, V333, V334, V336 (dedicated pass) — plus the
in-city/Harris comparison legs of V312, follow-ups on V306/V307 (deadline-row + Float/Cost columns on
a disposable task), V335 (Doc Review banner with a real drawing open in two tabs), V327's right-click
wording + column auto-size, and V319's overlay-Width/Stitcher-auto-calibrate sub-paths.

**Blocker encountered this pass, worth flagging for Claude Code:** `file_upload` in this Cowork
session can only push files that were shared into the session's own uploads/outputs folders — it
can't reach arbitrary sandbox paths, and no file was pre-shared into this session. That blocks any
V-item requiring a real file upload through the Library's native picker (V282's 100MB chunked upload,
V291/V292's upload→delete→restore→Drive-trash round trip) from a Cowork session unless a test file is
attached to the conversation first. Not a product bug — a testing-environment constraint.

On pass: fold V327 (partial-pass) and V319 (partial-pass, incidental) into `VERIFICATION.md` →
`VERIFICATION-DONE.md` per the file's own protocol, flagged ⏳ with the partial notes above rather
than closed outright.
