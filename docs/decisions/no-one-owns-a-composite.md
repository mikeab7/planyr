# Named rule NO-ONE-OWNS-A-COMPOSITE

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **NO-ONE-OWNS-A-COMPOSITE** — **A SURFACE BUILT FROM SEVERAL OBJECTS AT ONCE IS OWNED BY NONE OF THEM,
  SO NO PER-OBJECT PREDICATE CAN REACH IT AND NO FEATURE CENSUS CAN SEE IT.** (B505664, 2026-08-14, after
  the same species surfaced THREE times in one day.) A composite is a dissolved region, a merged outline,
  a union, or a **cached raster** — anything drawn once on behalf of many.
  1. **THE OBLIGATION.** When you add a hide, an exclusion, or **ANY** per-object state, ask separately
     **what composites read that object**, and invalidate them EXPLICITLY. A per-object filter applied at
     the object's own draw site is not enough and never was: the composite has already been built.
  2. **⛔ THE GUARD IS INK OR PIXELS, NEVER REGISTRATIONS.** A census counts things that REGISTERED
     themselves — `data-feature` keys, `[data-el-id]` nodes, model entries. A composite registers nothing,
     so it is invisible to every count by construction. Assert on what is PAINTED
     (`ui-audit/lib/inkCensus.mjs` attributes every painted node; a canvas pixel count answers where even
     that cannot).
  3. **⛔ AND THIS IS EXACTLY WHERE `COUNT-EVERY-KIND` STOPS, WHICH IS WHY THE TWO ARE NAMED TOGETHER.**
     That rule guarantees you counted every FAMILY of object, and it is the closest thing this repo had —
     so the next reader will reach for it and believe they are covered. **They are not.** COUNT-EVERY-KIND
     is the instrument half, and it is the very rule that certified the road pavement green: every road's
     own node correctly left the canvas, `4 drawn → 0`, ✓, while four unbroken grey ribbons stayed on the
     drawing. A rule about counting every kind of object says nothing about ink belonging to several at once.
  4. **THE THREE INSTANCES, so this entry carries its own evidence rather than reading as theory:**
     · **B3296 — the dissolved road pavement.** Hiding Roads removed every road's hit target, label and
       dimension and left the merged pavement painted, because `roadNet` unions the cluster from `els`.
     · **B494050 — the export crop.** `devExtent`/`exportFeetExtent` framed the printed sheet from the whole
       model, so a hidden group left blank paper where it used to be (PDF-PARITY).
     · **B503184 — Doc Review's cached sharp tile.** `renderDetail`'s `tileCovers` check asks *"does what I
       already drew still cover this view"* and knows nothing about the drawing having changed, so a
       switched-off PDF layer stayed on screen: backdrop 0 blue px, the tile above it **579,121** — exactly
       that shape's share of the page.
  5. **⛔ THE SHAPE THEY SHARE, and it is why each survived review: IN EVERY ONE, THE PER-OBJECT SIDE WAS
     CORRECT AND LOOKED CORRECT.** The filter was applied, the predicate was asked, the object's own node
     left the DOM, the unit tests passed. Nothing in the per-object code reads as wrong on inspection —
     which is precisely why "I checked the filter" is not evidence here.
  ⚠ **PROSE, WITH PER-INSTANCE GUARDS — there is no generic detector and this entry does not imply one.**
  "Is this surface a composite?" is not decidable from source, so the enforcement is behavioural and lives
  with each instance: the repo-root `test/` suites **contentVisibility** (the seam sweep), **hiddenContentReads**
  (the declaration table + its teeth proof) and **docReviewLayerVisibility**, plus the ui-audit harnesses
  **verify-content-visibility** (per-family ink), **verify-hidden-content-behaviour** and
  **verify-pdf-layer-hiding** (canvas pixels). `test/compositeSurfaceRule.test.js` guards the ENTRY itself:
  that the rule is still stated with its operative line, and that every guard it cites still exists —
  a rule whose evidence has been deleted has rotted, and reads as covered.
  **⛔ AND THE PREFERRED FORM OF THE TEETH PROOF, learned on B503184: point the new check at UNTOUCHED
  code and require it to go RED there BEFORE writing the fix.** That is stronger than planting a synthetic
  defect, because a planted one only proves the check can see the thing you already built it to see.
