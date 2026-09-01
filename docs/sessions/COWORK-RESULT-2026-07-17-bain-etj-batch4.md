# Cowork verification run — 2026-07-17 (batch 4 of the V281–V340 pass — quick Bain ETJ check)

Follow-up to PR #659 (Tsakiris), PR #660 (Bain batch 2), PR #661 (Scheduler batch 3) — same 50-item
target batch. One more quick item, driven live and signed in on the real **Bain** project
(`smr9olizi5ue`, City of Houston — ETJ / City of Katy — edge only · Fort Bend County).

## ✅ V312 — B823: one-line notes + the materially-inside-city gate, on the live Bain panel (PASS — Bain portion)

Yield → Stormwater → Detention (expanded) on the live Bain site:

- **The ETJ one-liner renders verbatim, with its ⓘ:** "Houston ETJ — county (FBCDD) criteria govern
  detention ⓘ" — matches the item's expected copy exactly, and Bain is a real Houston-ETJ-plus-a-
  Katy-sliver site, so this is the real trigger case, not a synthetic one.
- **No "verify with the city" text anywhere** in either the Detention or the Floodplain mitigation
  group (checked both fully expanded, including "Assumptions — correct if needed," "Assumptions &
  method (4)," and all inline caveats) — the gate is correctly silencing that caveat on this
  ETJ-only site.
- **Every inline note is single-line** (one logical sentence each, though a few wrap across two
  visual lines at the panel's width — that's wrapping, not a stacked multi-line note block):
  "Credited cut needs hydraulic connection + same-watershed stage distribution — engineer confirms.",
  "+1.73 ac-ft of the requirement comes from transition slopes past pad edges.", "+0.17 ac-ft from
  pond berms whose toe crosses the mapped floodplain.", "1 anchored floodplain pond — flood WSE
  unknown; gross OVERSTATES.", "A pond's top of bank sits at/below the flood WSE — its usable
  detention is ZERO." None exceed one sentence.

**Not exercised this pass** (need different sites): a genuinely in-city-limits site with an
unmodeled city (to confirm the one-line city caveat still shows there), and a Harris County site (to
confirm the channel question is kept, not silenced).

**Verdict: PASS on the Bain-specific claims (ETJ one-liner + city-verify gate + single-line notes);
the in-city and Harris-County comparison cases not exercised.**

---

## Running tally across all four batches (PR #659 + #660 + #661 + this one)

**Confirmed full PASS (16):** V337, V338, V339, V340 (full), V311, V313, V314, V317, V318, V320,
V321, V325 (partial-pass), V305 (full), V308, V312 (Bain portion), plus the V288/V290 GIS
happy-path spot-check.

**Partial / needs a closer look (5):** V316, V322, V306, V307, V335.

**Not yet run (~29):** V281, V282, V284, V285, V286, V287, V289, V291, V292, V293, V301, V302, V303,
V304, V309, V310, V319, V324, V326, V327, V328, V329, V330, V331, V332, V333, V334, V336 (needs a
dedicated pass) — plus the in-city/Harris comparison legs of V312, and genuine follow-ups on
V306/V307 (deadline-row + Float/Cost columns on a disposable task) and V335 (Doc Review banner with
a real drawing open in two tabs).

On pass: fold V312 into `VERIFICATION.md` → `VERIFICATION-DONE.md` per the file's own protocol.
