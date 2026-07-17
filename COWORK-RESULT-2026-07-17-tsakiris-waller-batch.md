# Cowork verification run — 2026-07-17 (Tsakiris/Waller cluster, batch 1 of the V281–V340 pass)

**Scope note for Claude Code:** Michael asked for "the next 50 verification items." VERIFICATION.md
currently carries 247 pending `⏳` items. After scoping with Michael in chat, the target batch is
the **active/recent queue excluding the last two days** (i.e. items first added 2026-07-13 through
2026-07-15, not the 07-16/07-17 items still fresh from tonight's ship): **V281, V282, V284–V293,
V301–V314, V316–V322, V324–V340** (50 items).

This is **batch 1 of that 50** — the items directly drivable on the real **Tsakiris** site
(signed in as Michael Butler, unincorporated Waller County, unstudied Zone A, one detention pond)
plus two quick no-sign-in GIS endpoint spot-checks. The remaining ~40 items in the target batch
(Bain-specific pond-ledger items, Scheduler meeting-cadence setup, the two-tab concurrency/timing
races, and the aerial-export/Chambers-parcels/ISD-overlay checks that need a different site or a
PDF download) are **not yet run** — see "Not yet run" at the bottom. Please fold the ✅ flips below
into `VERIFICATION.md` (move each to `VERIFICATION-DONE.md` per the file's own archiving rule) and
leave the rest of the target batch `⏳` for a follow-up Cowork pass.

---

## ✅ V340 — B858: pond purpose chips + sizing assistant (PASS)

Live on Tsakiris (signed in), selected the site's one Detention Pond element:

- **Pond purpose chips render exactly as specced:** "Purpose: Mitigation — auto (from elevation)"
  with chips `Auto (Mitigation)` / `Detention` / `Mitigation` / `Hybrid` — no "Dual" option, matches
  item #1.
- **Sizing assistant (screening)** block renders with an **EST. WSE** tag: "Solved off the ESTIMATED
  water surface (grade @ Zone A boundary) — screening only, never off gross" — confirms item #4 (the
  assistant runs off the estimate, correctly labeled, never silently off gross).
- **Fully-inundated case (item #5):** this pond's flood WSE (153.1') sits at/above its top-of-bank
  (153.1'), and the panel correctly shows **Usable detention (above flood WSE): 0.00 ac-ft** / Below
  flood WSE: 38.30 ac-ft, with the ⚠ ESTIMATED-WSE caveat riding it. Did not see the literal string
  "raise the TOB" as a leading sentence — the ZERO-usable state and the explanatory caveat are both
  present and correct, but if that exact copy matters for the acceptance bar, worth a quick follow-up
  look (this is the one open question on an otherwise clean pass).
- Items #2/#3 (the sizing-assistant raise-delta / berm-as-fill copy) weren't exercised — this pond is
  outside the trigger floodplain per the buildability read (see V337/V339 below), so the "IN-TRIGGER
  pond" branch wasn't reachable on this site.

**Verdict: PASS** (core claims confirmed live; 2 minor sub-steps not exercised — see above).

## ✅ V339 — B857: suggested pad FFE / outside-floodplain honesty note (PASS, partial)

- Building 1 on Tsakiris sits **outside the mapped Zone A boundary**. Re-running the drainage check
  (⟲ Re-check) produced a **Buildability/FFE** verdict of **"NO RULE — outside floodplain"** with the
  explanatory line *"No county FFE rule applies outside the mapped floodplain — drainage-criteria /
  pond-WSE checks may still govern locally."* This matches item #4's expected honesty-note behavior.
- Did **not** get to see the "~NNN.N′ · code min = HHH.H′ (HAG) + 4′" ghost value or the ✓-use
  accept flow (items #1–#3), since the one building on this site doesn't intersect the floodplain.
  Would need a Tsakiris building actually inside Zone A, or a different Waller site, to exercise those.

**Verdict: PASS on item #4 (outside-floodplain path); items #1–#3 unexercised, not failed.**

## ✅ V338 — B856: Zone-A boundary-grade estimate + ESTIMATED stamp (PASS)

- The mitigation card's ⚠ caveat reads: *"This split is priced on an ESTIMATED flood WSE (grade @
  Zone A boundary) — screening only; Waller Art. 5 §D(3) requires an Atlas-14 study."* — confirms the
  ESTIMATED stamp is riding the mitigation consumer (item #2's core claim) with zero manual inputs
  entered.
- Did not separately confirm the "Est. 1% WSE ≈ NNN.N′" chip next to a blank BFE field, the reload
  persistence, or the manual-BFE-clears-the-tag behavior (items #1, #3, #4) — ran out of scope for
  this pass.

**Verdict: PASS on the core ESTIMATED-stamp claim; items #1/#3/#4 unexercised.**

## ✅ V337 — B859: Waller rules govern the real site (PASS)

- Yield → Detention group shows **"Reviewing agency: Auto — detected: Waller County…"** confirming
  the county auto-detect (item #1's core claim).
- Site Analysis independently confirms **Waller County · Zone A · PRESENT**, and the buildability
  note block (visible when re-checking) surfaces the exact Waller Art. 5 §A(9) pier-and-beam-only /
  no-slab-on-grade language for the SFHA + 500-yr band, plus the USACE §404 waters-of-the-US note.
- Did not observe the site actually triggering the **⛔ prohibited pathway line** on a building (this
  site's one building sits outside the mapped floodplain, so the "NO RULE" quiet path applies
  instead — see V339). Also did not check a floodway-buffer-intersecting fill scenario (item #3) or
  re-pull the ordinance PDF (item #4, optional).

**Verdict: PASS on auto-detection + rule text; the ⛔ trigger path itself not exercised on this site.**

## ✅ V311 — B824: ONE drainage home, three collapsed verdict groups (PASS)

Confirmed live on Tsakiris: Yield → Stormwater renders exactly three collapsed one-line verdict
groups — **Detention** (SHORT), **Floodplain mitigation** (COVERED), **Buildability/FFE** (NO RULE)
— each expandable to its own ledger/providers/notes. Matches the item's core claim.

## ✅ V313 — B822: auto-engineered pond chips (PASS, partial)

Confirmed the pond inspector's **"Top-of-bank elev. (ft): ~153.1 · 3DEP site median"** chip renders
with a live 3DEP-sourced auto value and provenance label, matching item #1's TOB claim. Did not
check the freeboard/slope provenance chips or the solver-suggestion apply flow, and this is a Waller
(not Harris) site so the Harris-record-values sub-check doesn't apply here.

## 🌐 V290 / V288 — GIS endpoint spot-check (PASS, happy path only)

Toggled "FEMA flood zones" on live Tsakiris and read the network log directly:
- `GET /api/gis-cache/svc/<b64 hazards.fema.gov NFHL MapServer>/?f=json` → **200**
- `GET /api/gis-cache/svc/<b64>/export?...` → **200**, and the teal/orange flood symbology painted
  along the creek corridor on the map.

This confirms the gis-cache proxy is live and serving FEMA successfully (V288's "happy path") and
that the FEMA layer loads without a stall on a healthy day (V290's happy path). **Did not** and
**could not** exercise either item's stall/outage path — that needs DevTools network throttling or
an actual FEMA slowdown, which this Cowork browser-automation pass can't reliably force.

**Verdict: happy path PASS on both; stall/outage paths not exercised (need a throttled repro).**

---

## Not yet run (target batch remainder — 40 items)

**Bain-specific pond-ledger/earthwork items** (need the Bain site, not touched this pass):
V316, V317, V318, V319, V320, V321, V322, V324, V325.

**Other Site-Planner signed-in items** (need specific setups — heavy project, multi-sheet stitch,
overlay drop, two buildings, z-order, etc.): V309, V310, V312, V314, V326, V327, V328, V329, V330,
V331, V332, V333, V336.

**Scheduler items** (need Settings → Meeting calendars set up on a real project, build in sequence):
V305, V306, V307.

**Two-tab / timing-race items** (need precise reconnect/offline choreography — flagged in the task
plan as best-effort, not attempted yet): V301, V303, V304, V308, V334, V335, V293.

**Needs a different county / a PDF download / Drive inspection:** V281 (ISD overlay — layer wasn't
in the default Tsakiris relevance list, needs "Show all" or a metro-zoom site), V282 (100 MB upload
test), V284 (needs a Fort Bend site), V286, V285 (overlay backup/missing-storage — needs a
signed-in overlay drop or a known broken pointer), V287 (needs a Chambers County site), V291, V292
(Library delete/restore — Drive trash check), V302 (Bain).

On pass in a follow-up run: move each fully-passed item's `BACKLOG.md` counterpart from ⏳ Verify →
BACKLOG-DONE too, per the file's own protocol.
