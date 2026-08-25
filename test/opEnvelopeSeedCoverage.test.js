/* ⛔ B727936 (widened, 2026-08-25) — EVERY SEAM THAT CAN LAND A `site_elements` ROW WITH NO
 * OPERATION OPEN, GUARDED SO IT CANNOT SILENTLY REGROW.
 *
 * THE CASE. B727936 was filed as "the plan-duplicate flow never opens an operation" — true, but
 * production data showed it was not the whole gap: TWO plans that were NEVER duplicated ("Concept
 * C Full Site" / "Concept D 1M SF") also carried `op_kind: "unknown"` rows, all rev 1, each plan's
 * rows sharing one exact microsecond timestamp — the fingerprint of a batched initial-seed commit,
 * not a live gesture. `pushHistory()` is the ONLY call in this codebase that opens an operation
 * (`opTrackerRef.current.beginOperation`, `operationEnvelope.js`'s tracker) — and it is called from
 * ~190 sites covering every interactive drawing/editing gesture. `envelopeNow()` (read at ENQUEUE
 * time, inside `elementSync.js`'s diff) falls back to `op_kind: "unknown"` whenever NOTHING is
 * open. So the actual defect class is not "the duplicate flow" — it is any code path that changes
 * the canvas's collections (`els`/`parcels`/`measures`/`callouts`/`markups`) WITHOUT a preceding
 * `pushHistory()`/`beginOperation()` call, because that state change still feeds the SAME
 * autosave-diff effect (`reconcileElems` → `e.reconcile(...)`) that every real edit does.
 *
 * THE FULL AUDIT (every write path that can create a `site_elements` row), reported here so the
 * next session does not have to re-derive it:
 *   · Plan duplicate / new plan (same parcel) / new site from map (`SitePlannerApp.jsx`
 *     `duplicatePlan`/`newPlanSameParcel`/`newSiteFromMap`) — these call `saveSite()` only, which
 *     (per `cloudSync.js`'s `slimForCloud`) writes the `sites` metadata row and STRIPS every
 *     element collection. The content they carry forward never touches `site_elements` until the
 *     plan is opened and `SitePlanner.jsx`'s `refetchReplace` seeds it — GAP, fixed below.
 *   · Legacy-site migration (`importLegacyIntoCloud`/`importOneSiteToCloud`/`stageLegacySite`,
 *     `storage.js`) — same as above: only the `sites` row via `cloudUpsert`/`siteRowFor`. No
 *     separate gap; covered by the same `refetchReplace` fix.
 *   · Parcel split (`performSplit`) and parcel combine/merge (`mergeParcels`) — both call
 *     `pushHistory()` before writing (kind defaults to "edit", not "split"/"merge" specifically —
 *     a labeling-quality gap the module's own header calls out as deliberately deferred future
 *     work, not an `op_kind: "unknown"` bug).
 *   · Deed promotion → parcel (`promoteDeedToParcel`, `plannerPlacementCmds.js`) — calls
 *     `ctx.pushHistory()` before `ctx.addParcel()`. Covered.
 *   · JSON site import (`importJSONFile`) — calls `pushHistory()` before the bulk collection
 *     replace. Covered.
 *   · Version-history restore (`restoreVersion`) — calls `pushHistory()` before restoring. Covered.
 *   · Clipboard paste, same-plan and cross-plan (`duplicateRef`, the cross-plan paste handler) —
 *     both call `pushHistory()`. Covered.
 *   · Standards "Apply to this plan" (`applyAllStd`) — calls `pushHistory()`. Its toast's own
 *     "Undo" button reverted state directly with NO fresh operation and was never on the Ctrl+Z
 *     stack at all — GAP, fixed below.
 *   · Undo / redo (`applySnapshot`, via `undo()`/`redo()`) — `endOperation()` is never called
 *     anywhere, so an undo/redo rode whichever operation was last begun (often the very edit it is
 *     reverting) rather than minting its own. Never actually `"unknown"` (some operation is always
 *     open by the time anything is undoable) but a real misattribution — GAP, fixed below.
 *   · Cross-tab local convergence (the `storage` event handler) — fires ONLY when
 *     `!isCloudActive()`, at which point `elSyncRef.current` is null and `reconcileElems` early-
 *     returns before ever reaching `site_elements`. Not a gap for this bug (verified: no cloud
 *     engine exists to write through).
 *   · "Take over editing here" (`takeOverEditing`) — a union-merge reconcile with no gesture and no
 *     operation open — GAP, fixed below.
 *   · Overlay import (DXF/PDF/DWG) — never touches `els`/`parcels`/etc. at all (`liveCollections()`
 *     in the mount effect enumerates exactly the five synced collections; overlays/underlay are not
 *     among them). Not a `site_elements` write path.
 *   · Template / library placement — no such feature exists in this codebase (only the Library
 *     *file browser*, which is unrelated to element geometry).
 *
 * THE FIX, all four in `SitePlanner.jsx`: `refetchReplace`'s seed reconcile and `takeOverEditing`'s
 * merge both now call `opTrackerRef.current.beginOperation("create")` before touching state;
 * `undo`/`redo` and the Standards-toast "Undo" callback each mint their own fresh operation instead
 * of riding whatever was last begun.
 *
 * NEVER BACKFILLED: the 3,324 pre-envelope legacy `op_kind: null` rows (first seen 2026-06-19,
 * before B712225 shipped the column at all) pre-date this mechanism entirely and are explicitly
 * OUT OF SCOPE — they describe writes from before the envelope existed, not a defect in it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createOperationTracker } from "../src/workspaces/site-planner/lib/operationEnvelope.js";

const here = dirname(fileURLToPath(import.meta.url));
const SP_PATH = join(here, "../src/workspaces/site-planner/SitePlanner.jsx");
const SP = readFileSync(SP_PATH, "utf8");

const slice = (fromMarker, toMarker) => {
  const from = SP.indexOf(fromMarker);
  expect(from, `marker not found: ${fromMarker}`).toBeGreaterThan(-1);
  const to = SP.indexOf(toMarker, from + fromMarker.length);
  expect(to, `end marker not found after start: ${toMarker}`).toBeGreaterThan(-1);
  return SP.slice(from, to);
};

describe("B727936 (widened) · the seed/reconcile mechanism itself", () => {
  // Reproduces the bug at the level `envelopeNow()` actually operates: with no operation open, a
  // freshly-diffed write is stamped "unknown"; opening one first (exactly what the four SitePlanner
  // fixes now do) makes it a real kind. This is the contract every wiring guard below relies on.
  it("a write diffed with no operation open is stamped unknown", () => {
    const t = createOperationTracker({ sessionId: "sess-A", userId: () => "user-1" });
    expect(t.current().op_kind).toBe("unknown");
  });
  it("beginOperation before the diff gives the write a real kind", () => {
    const t = createOperationTracker({ sessionId: "sess-A", userId: () => "user-1" });
    t.beginOperation("create");
    expect(t.current().op_kind).toBe("create");
    expect(t.current().op_id).toBeTruthy();
  });
});

describe("B727936 (widened) · wiring — every non-gesture reconcile seam opens an operation first", () => {
  it("refetchReplace (the initial/reconnect seed — the actual duplicate/new-plan/new-site gap) opens one before its reconcile", () => {
    const body = slice(
      "const refetchReplace = async (eng) => {",
      "\n  useEffect(() => {\n    if (!isCloudActive() || !siteId || !supabase) {",
    );
    const begin = body.indexOf("opTrackerRef.current.beginOperation(");
    const reconcile = body.indexOf("eng.reconcile(merged");
    expect(begin, "refetchReplace must call beginOperation before its seed reconcile").toBeGreaterThan(-1);
    expect(reconcile, "refetchReplace must still call eng.reconcile(merged, ...)").toBeGreaterThan(-1);
    expect(begin).toBeLessThan(reconcile);
  });

  it("takeOverEditing (the cross-device/cross-session union merge) opens one before replacing state", () => {
    const body = slice(
      "const takeOverEditing = async () => {",
      "const closeHdrMenus = () => {",
    );
    const begin = body.indexOf("opTrackerRef.current.beginOperation(");
    const setParcels = body.indexOf("setParcels(merged.parcels)");
    expect(begin, "takeOverEditing must call beginOperation before its union-merge state set").toBeGreaterThan(-1);
    expect(setParcels, "takeOverEditing must still re-hydrate the canvas from the merged union").toBeGreaterThan(-1);
    expect(begin).toBeLessThan(setParcels);
  });

  it("undo and redo each mint their own operation rather than riding whatever was last begun", () => {
    const undoLine = SP.split("\n").find((l) => l.trim().startsWith("const undo = ()"));
    const redoLine = SP.split("\n").find((l) => l.trim().startsWith("const redo = ()"));
    expect(undoLine, "const undo = () => {...} not found").toBeTruthy();
    expect(redoLine, "const redo = () => {...} not found").toBeTruthy();
    for (const line of [undoLine, redoLine]) {
      const begin = line.indexOf("opTrackerRef.current.beginOperation(");
      const apply = line.indexOf("applySnapshot(");
      expect(begin, `${line} must call beginOperation`).toBeGreaterThan(-1);
      expect(apply, `${line} must still call applySnapshot`).toBeGreaterThan(-1);
      expect(begin).toBeLessThan(apply);
    }
  });

  it("the Standards-apply toast's own Undo button opens a fresh operation (and is now on the undo stack)", () => {
    const body = slice(
      "const applyAllStd = () => {",
      "\n\n  /* ---- live color picking (B567) ----",
    );
    const toastCbStart = body.indexOf("flashStdToast(appliedObjectsLabel(res.count), () => {");
    expect(toastCbStart, "the Standards-apply toast callback was not found").toBeGreaterThan(-1);
    const cb = body.slice(toastCbStart);
    const push = cb.indexOf("pushHistory();");
    const revert = cb.indexOf("setParcels(beforeParcels)");
    expect(push, "the toast's Undo callback must call pushHistory()").toBeGreaterThan(-1);
    expect(revert, "the toast's Undo callback must still revert to the pre-apply state").toBeGreaterThan(-1);
    expect(push).toBeLessThan(revert);
  });
});

describe("B727936 (widened) · no new unguarded reconcile seam can appear unnoticed", () => {
  // Every write to site_elements funnels through exactly one engine method: `.reconcile(`. There
  // are exactly two call sites today — the routine gesture-diff funnel (reconcileElems, itself only
  // reachable through pushHistory-covered edits or the two seams guarded above) and the seed in
  // refetchReplace (guarded above). A THIRD call site is a new non-gesture write path that this
  // suite has not seen — pinning the count forces a human to extend this guard rather than let one
  // slip through silently.
  it("pins the total .reconcile( call-site count in SitePlanner.jsx", () => {
    const count = (SP.match(/\.reconcile\(/g) || []).length;
    expect(count, "a new `.reconcile(` call site appeared — audit it for an open operation and extend this guard, per B727936").toBe(2);
  });
});
