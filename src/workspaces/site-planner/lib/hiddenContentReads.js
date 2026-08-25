/* hiddenContentReads — THE DECLARATION TABLE: who may read the whole model, and who may not.
 *
 * ⛔ WHY THIS EXISTS. B3296: the dissolved road network painted roads the owner had hidden, because
 * it read `els` — the whole model — where the drawing wanted the visible subset. One filter fixed
 * it. The question that fix raises is how many other reads sit in the same position, and the only
 * honest way to answer "none" is to enumerate every one of them and say, per call site, which
 * answer is correct.
 *
 * ── ⛔ THE TRAP IN THE OTHER DIRECTION, AND IT IS THE WORSE ONE ─────────────────────────────────
 * Most reads of the whole model are RIGHT, and adding a filter to one would be a worse bug than the
 * one B3296 fixed. A hidden building is still a building for coverage, impervious area, parking
 * ratio, detention, cost, the saved record, the undo frame and every regulatory answer. **Hiding is
 * a VIEW state.** So `correct-unfiltered` is a first-class verdict here, recorded with its reason,
 * rather than a silence — a future session reading this table must be able to tell "we checked this
 * and it is right" apart from "nobody looked".
 *
 * ── THE LINE ────────────────────────────────────────────────────────────────────────────────────
 * MUST-FILTER is anything that PRODUCES A PICTURE, or an artefact a person reads as truth about
 * what is on the drawing:
 *   · drawn geometry, and above all a MERGED surface composed from several objects at once — the
 *     exact trap B3296 was, because no single object owning it can be asked whether it is hidden;
 *   · the printed sheet;
 *   · a click target — you must not be able to hit what you cannot see;
 *   · a snap magnet or an alignment guide — an invisible object must not pull the cursor;
 *   · an extent: a zoom-to-fit or an export crop framed around something that is not on screen.
 *
 * CORRECT-UNFILTERED is a count, a save, a sync payload, an undo frame, an engineering ledger, or a
 * regulatory inference. None of these may move when a checkbox is unticked.
 */

/** The raw model collections. A read of one of these is what this table is about. */
export const RAW_COLLECTIONS = Object.freeze(["els", "parcels", "markups", "measures", "callouts"]);

export const VERDICT = Object.freeze({
  MUST_FILTER: "must-filter",
  CORRECT_UNFILTERED: "correct-unfiltered",
});

const F = VERDICT.MUST_FILTER;
const U = VERDICT.CORRECT_UNFILTERED;

export const DECLARATIONS = Object.freeze([
  /* ── MUST-FILTER: it makes a picture, or an artefact read as truth ─────────────────────────── */
  { name: "drawEls", verdict: F,
    why: "The draw set. The one seam the visibility filter has always been applied at." },
  { name: "roadNet", verdict: F,
    why: "B3296 — the DISSOLVED pavement. Drawn once per connected cluster on behalf of several roads at once, so no road owns it and a per-element filter cannot reach it. This is the call site the whole audit exists because of." },
  { name: "roadRadiusFlags", verdict: F,
    why: "B3296 — review chrome painted ON a road, whose corner dot is a live one-click Fix. A flag for a road nobody can see is a marker floating on empty ground." },
  { name: "fit", verdict: F,
    why: "B494048 — Zoom to fit. An extent built from the whole model frames the view around content that is not on screen, so the drawing you CAN see is pushed into a corner of it." },
  { name: "connectableRoads", verdict: F,
    why: "B494049 — the road-connect magnet. A hidden road must not weld or snap the endpoint of one you are drawing." },
  { name: "devExtent", verdict: F,
    why: "B494050 — the EXPORT crop, and the print-frame seed. The sheet is framed to the development's extent; built from the whole model it prints blank paper around content the drawing is not showing. PDF-PARITY. (The ambient flush-snap's neighbour set lives inside `onMove`, declared below.)" },

  /* ── CORRECT-UNFILTERED: filtering any of these would be the worse bug ─────────────────────── */
  { name: "siteSqft", verdict: U,
    why: "Site AREA from the dissolved parcels. A number; hiding a parcel must not shrink the site." },
  { name: "parcelStreets", verdict: U,
    why: "REGULATORY inference — which parcel edge fronts a street, feeding the setback ROLE. A zoning answer may not change because a checkbox was unticked." },
  { name: "gsInputs", verdict: U,
    why: "The proposed-grading surface, which is ONE derivation feeding both the cut/fill heatmap and the priced earthwork rows. Filtering it would move the ledger — the invariant B442688 exists to protect — so the analysis overlay deliberately shows the graded surface of the whole plan." },
  { name: "exportCtx", verdict: U,
    why: "Hands the export path the live model AND the live `<svg>`. The PDF/PNG sheet is a CLONE of the drawing, so hidden content is already absent from it by construction; the model is there for the data exports, which decide their own contents." },
  { name: "elNeighbors", verdict: U,
    why: "Neighbour resolution for dock/apron geometry. A hidden neighbour still shapes the element that IS drawn — the same reason roadNet reads `els` rather than the cull." },
  /* ── MUST-FILTER (continued): the seams the B3296 audit found ──────────────────────────────── */
  { name: "snapToBoundary", verdict: F,
    why: "B494049 — the parcel-EDGE snap. Same rule as the flush-snap: a hidden boundary may not pull the cursor." },
  { name: "measureChips", verdict: F,
    why: "B494051 — the measurement summary chips are OBSTACLES for the element-label collision pass as well as things that are drawn, so an unfiltered set makes a building's label yield around a chip that is not on screen." },
  { name: "onMove", verdict: F,
    why: "Hosts the ambient flush-snap's neighbour set (B494049). Everything else it reads is the element being dragged, which cannot be hidden — hiding clears the selection into it." },

  /* ── CORRECT-UNFILTERED: judged, and filtering any of these would be the worse bug ─────────── */
  { name: "fmtScaleNum", verdict: U,
    why: "A number FORMATTER. Its body is swept only because the sweep reads a whole top-level span; it produces no picture." },
  { name: "probeRef", verdict: U, why: "The E2E read-only probe store. It reports what the app holds, so it must report ALL of it." },
  { name: "frameToActiveParcels", verdict: U,
    why: "Frames the ACTIVE parcels on an explicit user action (the parcel panel's own control). Its subject is the parcel set the user just named, not what the View menu is showing." },
  { name: "onBgDown", verdict: U,
    why: "A press handler. Its element reads resolve what was pressed, and a hidden element cannot be pressed (it is not rendered) — proven by the HIT arm of verify-hidden-content-behaviour." },
  { name: "onUp", verdict: U, why: "Release handler; the marquee pick it hosts is already visibility-filtered (B442688)." },
  { name: "calloutDblAction", verdict: U, why: "Acts on the callout that was double-clicked; a hidden one cannot be." },
  { name: "insertVtx", verdict: U, why: "Edits the SELECTED element's geometry. A hidden element cannot be selected." },
  { name: "finishRoad", verdict: U, why: "Commits the road being drawn — a model write, not a picture." },
  { name: "alignToElement", verdict: U, why: "Aligns to an element the user PICKED by name from a menu; the menu is the visibility decision, not this." },
  { name: "startRoadEnd", verdict: U, why: "Begins a drag on the selected road's endpoint." },
  { name: "checkDrainage", verdict: U,
    why: "ENGINEERING. The drainage pass prices the whole site; hiding a building must not change a detention volume." },
  { name: "drainFactsNow", verdict: U, why: "The same engineering tier as checkDrainage — a drainage number, not a picture." },
  { name: "corridorBboxSig", verdict: U, why: "A cache signature over the GIS fetch envelope — a network decision, not a picture." },
  { name: "findOpenPondCenter", verdict: U,
    why: "Places a new pond clear of existing elements. It must avoid a hidden building — putting a pond on top of one because it was hidden would be a real collision in the model." },
  { name: "designPond", verdict: U, why: "The pond auto-design engine; same reason as findOpenPondCenter." },
  { name: "labelCands", verdict: U, why: "Already reads the visible draw set; swept because the span mentions `els` in prose." },
  { name: "parcelChips", verdict: U, why: "Already asks the predicate (parcelAcreageHidden / the parcels row)." },
  { name: "dimItems", verdict: U, why: "Already iterates the visible draw set (`drawEls`), so it inherits the filter." },
  { name: "sideAddNodes", verdict: U, why: "Hover/selection chrome — it renders only for the hovered or selected element, and neither can be hidden." },
  { name: "parkingAddNodes", verdict: U, why: "Same as sideAddNodes — hover/selection chrome, and neither state survives a hide." },
  { name: "handleNodes", verdict: U,
    why: "The handle layer renders from `sel`/`multi`, and hiding a group CLEARS any selection into it (B442688) — so the grips cannot outlive their object." },
  { name: "markupHandles", verdict: U, why: "Same as handleNodes — the handle layer renders from a selection a hide clears." },
  { name: "calloutHandles", verdict: U, why: "Same as handleNodes — the handle layer renders from a selection a hide clears." },
  { name: "startRoute", verdict: U, why: "Utility-route drawing; acts on what the user clicked." },
  { name: "onDimNumberDown", verdict: U, why: "A press on a dimension number, which only exists for a drawn element." },
  { name: "renderPanelBody", verdict: U, why: "PANEL content — a list and a set of numbers, never a depiction of the drawing." },
  { name: "markupsZ", verdict: U, why: "The z-ordering pass; `drawMarkupsZ` beside it is the filtered draw set." },
  { name: "calibPlace", verdict: U, why: "Aerial calibration placement — it reads the model to georeference, not to draw." },
  { name: "createExportSheet", verdict: U,
    why: "The export module's ctx destructure. The PDF/PNG sheet CLONES the live `<svg>`, so hidden content is absent by construction; the model is there for the DATA exports, which decide their own contents." },
  { name: "exportKmz", verdict: U,
    why: "A MODEL-BUILT export: it decides its own contents and never inherits a canvas display toggle (kmzExport.js's own rule, guarded by test/kmzExport.test.js)." },
  { name: "exportFeetExtent", verdict: F,
    why: "B494050 — the sheet's CROP. Its primary branch reads the visibility-aware `devExtent`; its fallback branch (a plan with no development yet) reads the collections directly and asks the predicate for itself." },
  { name: "buildExportSvgRaw", verdict: U,
    why: "Clones the live `<svg>`. Hidden content is not in the DOM, so it cannot reach the sheet — parity by construction, asserted on the real artefact by verify-content-visibility." },
]);
