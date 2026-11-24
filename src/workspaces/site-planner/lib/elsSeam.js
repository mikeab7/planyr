/* AUDIT BATCH G2 — THE ONE SEAM every element write goes through (named, so it has a home and a unit test).
 *
 * `SitePlanner.jsx`'s `setEls` hands its updater here: the update is applied, then a road connected to a parking field / truck court
 * FOLLOWS it (`followDrives`, owner constraint #48), then drive-in ramps are re-seated on their wall (`reseatRamps`) and re-fitted
 * (`refitRamps`). `gestureBase` is the elements as the current gesture BEGAN (`drag.current.followBase`), so the let-go threshold is
 * measured over the whole drag; outside a gesture the base is the previous state.
 *
 * THE RAW-WRITE EXCEPTIONS — the only callers that bypass this seam, by design (they RESTORE exact geometry and must never be
 * re-interpreted): undo / redo (`applySnapshot`), a remote row (the sync engine), a plan load, a version restore, a seed adoption,
 * and the dock-height ramp refit. They all call `setElsRaw` through `replacePlanContents` or directly. Never add another. */
import { followDrives } from "./driveFollow.js";
import { refitRamps, reseatRamps } from "./driveInRamp.js";

export function seamElements(prev, update, { gestureBase = null, restrip, rampSeatCtx, dockSidesOf, dockIn }) {
  const next = followDrives(gestureBase || prev, prev, typeof update === "function" ? update(prev) : update, { restrip });
  return refitRamps(reseatRamps(gestureBase || prev, prev, next, rampSeatCtx()), dockSidesOf, dockIn);
}
