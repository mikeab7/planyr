/* sessionAxes — the pure half of the SESSION-SHAPED degradation probe (NEW-2).
 *
 * ⛔ READ THE REFRAME FIRST, because it is the whole reason this file exists and it corrects the
 * framing every prior instrument in this repo was built under.
 *
 * B1432's probe (ui-audit/interaction-degradation.mjs) FROZE CONTENT and varied INTERACTION
 * COUNT. It was correct, it stays, and it came back flat across 3,000 gestures. But a real work
 * session is not a constant scene. The owner DRAWS elements, TURNS LAYERS ON, OPENS PANELS,
 * SWITCHES PLANS, and EDITS — and every one of those rises monotonically through a session and
 * every one of them resets on reload. So the honest hypothesis is not ACCUMULATION, it is
 * AMPLIFICATION:
 *
 *     per-frame cost ≈ f(elements drawn × panels open × layers enabled × memo-invalidation state)
 *
 * and "time since reload" is only the proxy that correlates with all four. This also RECONCILES
 * B1357's r = 0.93 "cost tracks how much is drawn" finding, which may have been right all along:
 * what changes during his session is how much is drawn, because he is the one drawing it.
 *
 * ⚠ THE CONTROL IS INVERTED RELATIVE TO B1432, AND GETTING THAT BACKWARDS WOULD INVALIDATE EVERY
 * NUMBER HERE. There, content constant was the premise and a content change was a FAULT. Here
 * content IS the independent variable, so:
 *   • the VIEW must still be neutral (same viewport at every rung, or the rungs are looking at
 *     different amounts of scene for a reason that has nothing to do with the axis) — that guard
 *     is imported unchanged from interactionAxis.mjs rather than re-implemented; and
 *   • the AXIS QUANTITY MUST ACTUALLY HAVE MOVED at each rung. A rung whose panel did not open,
 *     whose layer toggle did not take, or whose building was not drawn is not a cheap rung — it
 *     is a MISSING rung, and reporting it as a data point manufactures a flat line out of a
 *     broken driver. `rungEffectFault` is that assertion, and it is the single most important
 *     thing in this file.
 *
 * Pure → unit-tested, and shared with ui-audit/session-axes.mjs so the rule cannot drift between
 * what the harness checks and what the report claims.
 */
import { linearGrowth, viewDrift, probeValidityFault, pearson } from "./interactionAxis.mjs";

export { linearGrowth, viewDrift, probeValidityFault, pearson };

/* ── The axes ─────────────────────────────────────────────────────────────────────────────────
 *
 * `sessionRise` is THE HONEST GUESS AND IT IS DECLARED HERE RATHER THAN COMPUTED, so a reader can
 * disagree with the ranking by disagreeing with a number they can see. It is "how many units of
 * this axis a real working session plausibly adds before the owner reloads" — the multiplier that
 * turns a cost-per-unit into a cost-by-end-of-session. Every value carries its basis.
 *
 * `observable` is the page counter that PROVES the rung took effect. If it does not move, the
 * rung is missing, not free.
 */
export const AXES = [
  {
    id: "panels",
    title: "Panels opened cumulatively",
    unit: "panel",
    observable: "panelsOpen",
    sessionRise: 4,
    riseBasis: "the left dock is single-occupancy, so a session with several panels in view means one docked plus up to four floated (Yield · Land · Analysis · References · Standards)",
  },
  {
    id: "layers",
    title: "Layers enabled cumulatively",
    unit: "layer",
    observable: "layersOn",
    sessionRise: 8,
    riseBasis: "B1424's owner report is literally 'ten layers on'; the drawn view toggles (docks, column grid, dimensions, areas) plus the GIS rows he actually turns on",
  },
  {
    id: "elements",
    title: "Elements drawn cumulatively",
    unit: "element",
    observable: "elementsDrawn",
    sessionRise: 40,
    riseBasis: "the reference plan is 62 elements; a design session that adds a building row, a parking field and a pond adds tens, and this is the r=0.93 axis driven the way he drives it",
  },
  {
    id: "edits",
    title: "Edits made (memo-invalidation state)",
    unit: "edit",
    observable: "editsMade",
    sessionRise: 60,
    riseBasis: "an edit is any committed mutation — a drag, a nudge, a field commit; a design hour is dozens, and each one pushes an undo generation and re-identifies the model array",
  },
  {
    id: "plans",
    title: "Plan / revision switches",
    unit: "switch",
    observable: "planSwitches",
    sessionRise: 6,
    riseBasis: "the owner compares revisions; a working session opens a handful of plans and returns to the first",
  },
];

export const axisById = (id) => AXES.find((a) => a.id === id) || null;

/* ── Rung validity ───────────────────────────────────────────────────────────────────────────
 *
 * THE ASSERTION THAT STOPS A BROKEN DRIVER FROM READING AS A FLAT AXIS.
 *
 * Every rung declares what it was supposed to do to the page (`expected`), and the harness reads
 * back what actually happened (`observed`). A rung at N=3 panels whose `panelsOpen` still reads 0
 * did not open three panels — a selector went stale, a menu ate the click, a toggle was already
 * on. That rung's frame cost is a perfectly plausible number describing a scene nobody asked for,
 * and placing it on a trend line produces the most dangerous result an instrument can produce: a
 * confident, false "this axis is free".
 *
 * Returns the reason this rung may NOT be placed on the trend, or null when it may. `atLeast`
 * mode is deliberate for the axes the driver can only push in one direction (you cannot un-draw a
 * building without an edit): the rung is valid if the observable reached its target, and the
 * message says by how much it fell short rather than merely "invalid".
 */
export function rungEffectFault({ axis, target, observed, baseline = 0, mode = "exact", tolerance = 0 }) {
  const a = typeof axis === "string" ? axisById(axis) : axis;
  const name = a ? a.observable : "the axis counter";
  if (observed == null || !Number.isFinite(observed)) {
    return `${name} could not be read at rung ${target} — the rung is UNMEASURED, not free`;
  }
  if (!Number.isFinite(target)) return `rung target is not a number, so nothing can be asserted about it`;
  const gained = observed - baseline;
  if (mode === "atLeast") {
    if (gained + tolerance >= target) return null;
    return `${name} reached ${gained} of the ${target} this rung was supposed to add (baseline ${baseline}, observed ${observed}) — the driver did not do what the rung says it did, so this frame cost describes a DIFFERENT scene and may not join the trend`;
  }
  if (Math.abs(gained - target) <= tolerance) return null;
  return `${name} moved to ${gained} where rung ${target} was expected (baseline ${baseline}, observed ${observed}) — the rung did not take, so its frame cost may not join the trend`;
}

/* The viewport half of rung validity, imported rather than re-derived: `probeValidityFault` is
 * the same rule B1432 asserts, and the two harnesses must not drift on what "neutral" means.
 * Wrapped only to name WHY it matters differently here — there, a drifting view collapsed the
 * probe into the content axis; here, content is already the axis, so a drifting view means the
 * rungs are not comparable at all. */
export function rungViewFault(views, tolerance = 1) {
  return probeValidityFault({ ...views, tolerance });
}

/* ── Cost as a function of the axis ──────────────────────────────────────────────────────────
 *
 * The deliverable the item asks for is "cost as a function of each axis", which is a SLOPE with a
 * correlation and a stated floor — never a from/to pair. A from/to pair cannot distinguish a step
 * at the first rung (a fixed cost of having ANY panel open) from a per-unit cost (each extra panel
 * costing the same again), and those two have completely different fixes.
 */
export function axisCost({ rungs = [], costs = [], floorPct = null } = {}) {
  const pts = [];
  for (let i = 0; i < Math.min(rungs.length, costs.length); i++) {
    if (Number.isFinite(rungs[i]) && Number.isFinite(costs[i]) && costs[i] > 0) pts.push({ n: rungs[i], v: costs[i] });
  }
  if (pts.length < 3) {
    return { verdict: "unmeasured", why: "fewer than three reportable rungs — a slope over two points is a line through two points, not a trend", points: pts.length };
  }
  const g = linearGrowth(pts);
  const first = pts[0].v, last = pts[pts.length - 1].v;
  const risePct = +(((last - first) / first) * 100).toFixed(1);
  const span = pts[pts.length - 1].n - pts[0].n;
  const perUnitMs = g && span > 0 ? +g.slope.toFixed(4) : null;
  const perUnitPct = perUnitMs != null && first > 0 ? +((perUnitMs / first) * 100).toFixed(3) : null;

  if (floorPct == null) {
    return { verdict: "inconclusive", why: "no noise floor could be stated, so no rise can be called real", risePct, perUnitMs, perUnitPct, r: g?.r ?? null, points: pts.length };
  }
  /* A TREND, NOT AN ENDPOINT — the same rule axisVerdict applies in interactionAxis.mjs, for the
   * same reason: one point is a fluke. The last two rungs must BOTH clear the floor above rung 0. */
  const over = (v) => ((v - first) / first) * 100 > floorPct;
  const sustained = pts.length >= 3 && over(last) && over(pts[pts.length - 2].v);
  if (!sustained) {
    return {
      verdict: risePct > floorPct ? "UNSUSTAINED" : "INCONCLUSIVE",
      why: risePct > floorPct
        ? `only the final rung cleared the ±${floorPct}% floor — one point is not a trend`
        : `cost did not rise with this axis beyond the ±${floorPct}% noise floor (+${risePct}% across ${pts[0].n}→${pts[pts.length - 1].n} ${""}units)`,
      risePct, perUnitMs, perUnitPct, r: g?.r ?? null, floorPct, points: pts.length,
    };
  }
  return {
    verdict: "GROWS",
    why: `the identical probe got ${risePct}% slower across ${pts[0].n}→${pts[pts.length - 1].n} units of this axis, clearing the ±${floorPct}% floor at the last two rungs`,
    risePct, perUnitMs, perUnitPct, r: g?.r ?? null, floorPct, points: pts.length,
  };
}

/* ── (d) The memo-invalidation test ──────────────────────────────────────────────────────────
 *
 * "Pan cost immediately after an edit vs after 30 idle seconds." The hypothesis this settles is
 * the owner's own, and it is the sharpest one in the block: if memo dependency arrays include the
 * MODEL OBJECT, every edit invalidates every memo, nothing is cached after the first edit, and
 * the first gesture after an edit pays for everything the memos would otherwise have held.
 *
 * The distinction that makes this measurable: a memo miss is paid on the FIRST frame that needs
 * the value, so a HOT probe (immediately after an edit) is dearer than a COLD one (after the
 * app has been left alone long enough to have re-filled everything it is going to re-fill).
 * If hot ≈ cold, the memos are not being invalidated by the edit — or they were never holding
 * anything worth holding, which is the same news for the owner and different news for the fix.
 */
export function editRecoveryVerdict({ hotMs, coldMs, floorPct = null } = {}) {
  if (!Number.isFinite(hotMs) || !Number.isFinite(coldMs) || hotMs <= 0 || coldMs <= 0) {
    return { verdict: "unmeasured", why: "one of the two probes did not produce a reportable frame cost" };
  }
  const deltaPct = +(((hotMs - coldMs) / coldMs) * 100).toFixed(1);
  if (floorPct == null) return { verdict: "inconclusive", why: "no noise floor could be stated", deltaPct, hotMs, coldMs };
  if (deltaPct > floorPct) {
    return {
      verdict: "EDIT-SENSITIVE", deltaPct, hotMs, coldMs, floorPct,
      why: `the first gesture after an edit costs ${deltaPct}% more than the same gesture after the app has been left alone — consistent with memos being invalidated by the edit and re-filled on the next frame`,
    };
  }
  if (deltaPct < -floorPct) {
    return {
      verdict: "COLD-SLOWER", deltaPct, hotMs, coldMs, floorPct,
      why: `the gesture after idling costs ${-deltaPct}% MORE than the one right after an edit — the opposite of the memo-invalidation prediction; suspect something that runs on a timer rather than on an edit`,
    };
  }
  return {
    verdict: "INCONCLUSIVE", deltaPct, hotMs, coldMs, floorPct,
    why: `pan cost right after an edit and after ${""}idling are within the ±${floorPct}% floor (${deltaPct}%) — this run does not show edits invalidating anything the next frame has to pay for`,
  };
}

/* ── (e) The plan-switch retention test ──────────────────────────────────────────────────────
 *
 * "Load plan A, load plan B, return to A, and check whether A's geometry, listeners and memos
 * were ever released."
 *
 * The shape that makes this answerable rather than suggestive: A's footprint is measured at
 * A₀ (first load) and again at A₁ (after the round trip). If nothing was released, A₁ carries A₀
 * PLUS whatever B left behind, and the counters say so. A tolerance is required and is stated:
 * a returning plan legitimately differs by a few nodes (a toast, a status chip, one more tile),
 * and calling that a leak is how an instrument cries wolf.
 *
 * `counters` are compared per key; only keys present in both are judged. Returns a verdict plus
 * the per-key evidence, because "it leaked" without saying WHICH counter leaked is not a finding.
 */
export function planSwitchVerdict({ a0 = {}, b = {}, a1 = {}, keys = [], tolerancePct = 5 } = {}) {
  const rows = [];
  for (const k of keys) {
    const v0 = a0[k], v1 = a1[k];
    if (!Number.isFinite(v0) || !Number.isFinite(v1)) { rows.push({ counter: k, a0: v0 ?? null, b: b[k] ?? null, a1: v1 ?? null, deltaPct: null, verdict: "unmeasured" }); continue; }
    const deltaPct = v0 === 0 ? (v1 === 0 ? 0 : null) : +(((v1 - v0) / v0) * 100).toFixed(1);
    rows.push({
      counter: k, a0: v0, b: b[k] ?? null, a1: v1, delta: +(v1 - v0).toFixed(2), deltaPct,
      verdict: deltaPct == null ? "unmeasured" : deltaPct > tolerancePct ? "RETAINED" : deltaPct < -tolerancePct ? "shrank" : "released",
    });
  }
  const retained = rows.filter((r) => r.verdict === "RETAINED");
  if (!rows.some((r) => r.verdict !== "unmeasured")) {
    return { verdict: "unmeasured", why: "no counter could be compared across the round trip", rows };
  }
  if (!retained.length) {
    return {
      verdict: "RELEASED", rows, tolerancePct,
      why: `returning to plan A costs what plan A cost the first time, within ±${tolerancePct}% on every counter — switching plans does not strand the plan you left`,
    };
  }
  return {
    verdict: "RETAINED", rows, tolerancePct,
    why: `returning to plan A left ${retained.map((r) => `${r.counter} +${r.deltaPct}%`).join(", ")} above what plan A cost on first load — plan B was not fully released`,
  };
}

/* ── The ranking ─────────────────────────────────────────────────────────────────────────────
 *
 * The item asks for cost "as a function of each axis" and the parent block asks for a ranking by
 * (cost × how much it grows with session activity). That product is computed HERE, from two
 * numbers that are both visible: the MEASURED per-unit cost, and the DECLARED session rise on the
 * axis definition above. Nothing is invented in this function — it multiplies and sorts, so
 * disagreeing with the ranking means disagreeing with a number you can point at.
 *
 * An axis whose verdict is not GROWS contributes ZERO to the ranking rather than a small number:
 * a per-unit slope that did not clear its own noise floor is not a small cost, it is an unproven
 * one, and letting unproven costs sort above proven ones is how a fix gets aimed at noise.
 */
export function rankAxes(results = []) {
  return [...results]
    .map((r) => {
      const a = axisById(r.axis) || { sessionRise: null, unit: "unit", riseBasis: null };
      const proven = r.cost?.verdict === "GROWS";
      const perUnitMs = proven ? r.cost.perUnitMs : null;
      const sessionMs = perUnitMs != null && a.sessionRise != null ? +(perUnitMs * a.sessionRise).toFixed(2) : null;
      return {
        axis: r.axis, title: a.title || r.axis, unit: a.unit, verdict: r.cost?.verdict ?? "unmeasured",
        perUnitMs, sessionRise: a.sessionRise, riseBasis: a.riseBasis,
        risePct: r.cost?.risePct ?? null, r: r.cost?.r ?? null,
        sessionMs, score: sessionMs ?? 0,
      };
    })
    .sort((x, y) => y.score - x.score || String(x.axis).localeCompare(String(y.axis)));
}

/* ── Instrument honesty ──────────────────────────────────────────────────────────────────────
 *
 * The item's own instruction: "if that floor blocks a real answer, fix the instrument rather than
 * reporting noise as signal." So the harness has to be able to SAY that its floor blocked the
 * answer, in the same breath as the answer.
 *
 * A ±50% floor arises from 16.7 ms frame quantisation: at 60 Hz a "median frame" is 16.7 or 33.3
 * with nothing in between, so a real 25% regression is invisible. `floorBlocks` reports whether
 * the measured effect could ever have been seen through the stated floor, and `quantisationFloor`
 * gives the floor that quantisation ALONE imposes on a given median — which is the number to beat
 * by lengthening the probe or moving to sub-frame timing.
 */
export function quantisationFloor(medianMs, frameMs = 1000 / 60) {
  if (!Number.isFinite(medianMs) || medianMs <= 0) return null;
  return +((frameMs / medianMs) * 100).toFixed(1);
}

export function floorBlocks({ floorPct, expectedEffectPct }) {
  if (!Number.isFinite(floorPct) || !Number.isFinite(expectedEffectPct)) return null;
  return expectedEffectPct <= floorPct;
}

/* Percentile helper shared by the harness so the report and any future consumer agree on what
 * "p90" means (nearest-rank, lower). Duplicated nowhere else. */
export function pct(arr, p) {
  const s = (arr || []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
