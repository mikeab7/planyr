# Cowork verification run — 2026-07-18 (batch 5 of the V281–V340 pass — ISD overlay + aerial-flash)

Follow-up to PR #659 (Tsakiris), PR #660 (Bain batch 2), PR #661 (Scheduler batch 3), PR #662 (Bain
ETJ batch 4) — same 50-item target batch. Driven live and signed in on the real **Bain** project
(`smr9olizi5ue`, City of Houston — ETJ / City of Katy — edge only · Fort Bend County).

## 🟡 V281 — B775: School districts (ISD) overlay — polygon render + badge confirmed; label/popover not exercised (PARTIAL)

Toggled **Layers → Jurisdictions → School districts (ISD)** on (confirmed via the "1 ON" counter and
a checked checkbox). Zoomed out through several increments until a real purple ISD boundary polygon
line became visible crossing the Bain site's aerial — confirms the overlay genuinely paints district
polygons from the TEA (Texas Education Agency) feed, not just a legend entry.

Opened the **Analysis** (Site Analysis) left-rail tab and scrolled to the jurisdiction summary block,
which reads:

```
City              Katy · 6d ago
ETJ               Houston ETJ · 6d ago
School district    Katy ISD · 5d ago
```

Katy ISD is correct for a Katy, TX site — confirms the "badge/analysis show the right ISD for a real
parcel" half of this item's claim.

**Not confirmed:** the zoom-gated name label directly on the map, and the click-identify popover.
Clicked both on the boundary line and inside the polygon interior at a couple of zoom levels — no
popover appeared either time. The Parcel panel's Appraisal Data section (Account/ID, Acreage 76.53,
Land value $1,160,036, Land use D1) has no explicit ISD field, and I didn't expand its collapsed "▶
All county fields" row to check for one there.

**Verdict: PARTIAL. Polygon rendering + Site Analysis badge confirmed live and correct; zoom-gated
map label and click-identify popover not exercised (either a higher zoom threshold than reached, or
a click-precision issue — worth a dedicated follow-up with `read_page`/element refs instead of raw
coordinate clicks).**

## 🟡 V310 — B821: single-/double-click no longer flashes/blanks the aerial (PARTIAL — macro-level confirmed, frame-level unverifiable)

On the live Bain site (aerial ON): single-clicked a parcel, double-clicked a building element, then
clicked empty space to deselect — took a screenshot immediately after each action. In all three
cases the aerial basemap tiles stayed fully rendered throughout; only the selection highlight
(outline/handles) changed. No gross blanking, gray/white flash, or tile re-fetch was visible in any
of the three states.

**Caveat, stated plainly:** this item's literal claim is that a **single rendered frame** no longer
flashes blank — that's a sub-16ms-scale claim that discrete screenshots taken after the fact cannot
disprove or confirm; a screenshot can only ever catch the settled state, not a transient frame. The
item itself acknowledges this is a "zoom-/data-density render class" claim that's "not
headless-observable," and notes the fix logic is already proven by build + 3796 sandbox tests + a
logged-out render smoke — this live pass adds macro-level confirmation (no visible blanking on
click/double-click/deselect) on top of that, which is the strongest confirmation available without
frame-by-frame video capture.

**Verdict: PARTIAL/PASS-with-caveat. No macro-level flash or blank observed across click,
double-click, and deselect on a real aerial-on site; the underlying single-frame claim is inherently
unverifiable via screenshot-based testing and is already covered by the cited sandbox test suite.**

---

## Running tally across all five batches (PR #659 + #660 + #661 + #662 + this one)

**Confirmed full PASS (18):** V337, V338, V339, V340, V311, V313, V314, V317, V318, V320, V321,
V325 (partial-pass), V305, V308, V312 (Bain portion), plus the V288/V290 GIS happy-path spot-check.

**Partial / needs a closer look (7):** V316, V322, V306, V307, V335, V281, V310.

**Not yet run (~27):** V282, V284, V285, V286, V287, V289, V291, V292, V293, V301, V302, V303, V304,
V309, V319, V324, V326, V327, V328, V329, V330, V331, V332, V333, V334, V336 (dedicated pass) — plus
the in-city/Harris comparison legs of V312, and follow-ups on V306/V307 (deadline-row + Float/Cost
columns on a disposable task) and V335 (Doc Review banner with a real drawing open in two tabs).

On pass: fold V281 (partial-pass) and V310 (partial-pass) into `VERIFICATION.md` →
`VERIFICATION-DONE.md` per the file's own protocol, flagged ⏳ with the partial notes above rather
than closed outright — the un-exercised sub-claims (ISD label/popover; single-frame flash) are worth
a dedicated follow-up but do not contradict the item's core claim.
