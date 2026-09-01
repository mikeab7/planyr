# Cowork verification run — 2026-07-17 (Bain cluster, batch 2 of the V281–V340 pass)

Follow-up to `COWORK-RESULT-2026-07-17-tsakiris-waller-batch.md` (PR #659) — same 50-item target
batch (V281, V282, V284–V293, V301–V314, V316–V322, V324–V340), same scoping rationale. This batch
covers the **Bain-specific pond-ledger/earthwork items**, driven live and signed in on the real
Bain site (`smr9olizi5ue`, City of Houston ETJ / Fort Bend County, 6 detention ponds, currently
54.28 ac-ft SHORT on detention / covered on floodplain mitigation).

## ✅ V340 — B858 (upgraded to full PASS — see prior batch for partial)

Selected the 9.80-ac creek pond (fully inundated: flood WSE 138.4′ at/above its 135.7′ TOB). The
panel reads, verbatim: **"⚠ The flood WSE is at or above this pond's top of bank — the basin is
fully inundated in the design flood; usable detention is ZERO."** and the sizing assistant reads
**"— usable detention is ZERO — the flood WSE sits at/above the top of bank; raise the TOB first."**
— this is the exact leading-sentence copy item #5 called for, which the Tsakiris batch flagged as
an open question. Also confirmed on this same pond: the assistant's raise-delta ("raise the top of
bank +4.0′ (berm) — +2.49 ac-ft usable — the +4.0′ screening clamp still leaves it short") and the
berm-as-fill fold-back ("the berm prism below the WSE is NEW fill (~0.83 ac-ft) folded into the
mitigation requirement") — items #2 and #3, both previously unexercised. **V340 is now a full PASS,
all 5 sub-items confirmed.**

## ✅ V321 — B830 (+NEW-13): ledger balancer (PASS)

Yield → Detention → Ledger balancer, expanded on Bain: **8 moves screened**, including
**"Phase out 27211 Hoyt LN, (29.71 ac) — req −20.92 ac-ft at the current rate"** — matches the
item's own worked example (29.71-ac parcel ≈ −20.9 ac-ft) almost exactly. Also present: shrink
moves on two named ponds ("saves ~99,743 cy of cut" / "~18,104 cy"), basin-conversion moves on
Buildings 2/3/4, a pumped-outfall credit capped by FBCDD's 38.37 share limit, and — confirming the
item's berm-exclusion claim — **"4 ponds excluded from the berm auto-suggest — floodplain fringe."**
No move auto-applied; all are proposal lines with an explicit Apply.

## ✅ V320 — B834: creek ponds mitigation-primary (PASS)

The 9.80-ac creek pond's purpose auto-classifies **"Mitigation — auto (from elevation)"**. Yield →
Floodplain mitigation shows **Required 25.12 ac-ft · Provided (credited pond cut) 100.67 ac-ft · 3
ponds · Balance: covered** — matches the item's Required/Provided/Balance claim exactly. Did not
separately re-confirm the Detention group's usable figure is byte-unchanged vs. a pre-ship baseline
(no baseline available this session) — the group renders and is internally consistent, but that
specific no-regression check wasn't run.

## ✅ V318 — B826: proposed-surface engine (PASS)

Yield → Earthwork cost (screening) on Bain, zero manual typing: **Graded surface — cut 16,326 CY
/ fill 108,916 CY (compacted), incl. 6,202 CY of transition-wedge daylight fringe @ 3:1, net dirt
182,493 CY export.** A **"⚖ Balance the dirt"** button is present. Three real warning lines render:
pond berms toeing into the mapped floodplain (priced into mitigation), fill near the property line
too tall for a 3:1 tie-down (0.55 ac — the PL-fill flag firing, which is correct here, not a bug),
and a dock-approach grade break (adjoining pavement steps 0.75′ at a court edge). Did not exercise
the ADA/TAS override flag (no accessible-parking field on this site) or click Balance itself
(would mutate real site data — held off).

## ✅ V317 — B809: fill-depth heat map (PASS)

The "Cut/fill map on the plan" checkbox toggled ON paints a visible color-coded heat map directly
over Building 1's footprint on the live canvas, with a legend reading **"Cut / fill (proposed −
existing)"** and binned rows ("fill 0.0–0.5′", "fill 0.5–1.0′", "fill 1.0–1.5′" …). Matches the
item's core rendering claim. Did not separately verify the Σ-cells-equals-ledger tie-out number or
export it to PDF.

## ✅ V325 — B833: transition wedges (PASS, partial)

Confirmed the wedge-earthwork note reads **"+1.73 ac-ft of the requirement comes from transition
slopes past pad edges"** and a separate berm-toe note **"+0.17 ac-ft from pond berms whose toe
crosses the mapped floodplain"** — both real, non-zero, live-computed deltas matching the item's
"+X ac-ft from transition slopes" / pond-berm claims. Did not toggle the 4:1-vs-3:1 slope setting
to confirm the share grows/shrinks (checkbox is present — "4:1 transition slopes (mowable)" — but
flipping it changes the real site's screening numbers, so held off this pass).

## ✅ V314 — B827: 0.2% WSE at the Bain mosaic hole (PASS)

Confirmed the pond inspector reads **"0.2% (500-yr) WSE ~139.0′ · DRAFT (FBCDD)"** with zero manual
input — exactly the DRAFT-tagged Willow-raster value the item calls for. Did not test the "×
clears a manually-entered 139.5 back to auto" round-trip (no manual override was present to clear).

## 🟡 V316 — B808: per-cell 3DEP grade (PARTIAL — not a clean pass)

The pond inspector shows **"Existing grade ~135.7′ · 3DEP"** and the 1% WSE line separately reads
**"1% WSE ≈ 138.4′ read from FEMA's regulatory cross-sections on Willow Fork Buffalo Bayou"** (a
studied reach, correctly outranking the DRAFT raster per the provider precedence chain). This
confirms 3DEP is wired as the grade source, but I did **not** confirm the providers line reads the
item's exact expected string ("grade 3DEP per-cell grid"), and did not check for a >15%
grid-vs-median delta flag. Flagging this as **evidence-consistent but not fully verified** — worth
a closer look before archiving.

## 🟡 V322 — B831: TxRRC pipeline corridor (PARTIAL — layer renders, no flag observed)

Toggling "Pipeline easement corridor (assumed)" on Bain draws the corridor lines live on the map
(visual confirmation the layer + endpoint work). At the zoom level checked this pass, the corridor
didn't visibly cross the pond currently in view, and I didn't pan to the other 3 ponds or open each
one's inspector to check for the overlap-acreage flag / "not screened this session" fallback text.
**Not a fail — just not fully exercised.**

## Site-wide context confirmed along the way

Re-running the drainage check (⟲ Re-check) on stale data produced fresh numbers matching the same
shape as the 2026-07-11 memory record (Bain SHORT on detention, ~−54 ac-ft — was −54.73 then,
−54.28 now, consistent drift as the plan has evolved since). "Buildability/FFE: ASSUMED 140.97′
req" also rendered without incident.

---

## Running tally across both batches (PR #659 + this one)

**Confirmed PASS (13):** V337, V338, V339, V340 (full), V311, V313, V314, V317, V318, V320, V321,
V325 (partial-pass), plus the V288/V290 GIS happy-path spot-check.

**Partial / needs a closer look (2):** V316, V322.

**Not yet run (35):** V281, V282, V284, V285, V286, V287, V289, V291, V292, V293, V301, V302, V303,
V304, V305, V306, V307, V308, V309, V310, V312, V319, V324, V326, V327, V328, V329, V330, V331,
V332, V333, V334, V335, V336 — Scheduler cadence setup (3, sequential), two-tab timing races (7,
flagged best-effort), items needing a different county/PDF download/Drive check (8), and other
Site-Planner setups needing a heavy project / multi-sheet stitch / two buildings / etc. (13),
V319/V324 held off this pass to avoid mutating real Bain geometry mid-verification-run.

On pass: fold each ✅ into `VERIFICATION.md` → `VERIFICATION-DONE.md` per the file's own protocol;
leave V316/V322 flagged ⏳ with the partial note above rather than closing them.
