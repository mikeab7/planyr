/* NEW-7 — DRAWDOWN AS A STATUTE, not a readout.
 *
 * In Texas, time-to-empty (drawdownTime.js) is an informational screen: a long drawdown tells you
 * the "pond recovers between storms" assumption is shaky, and it can fail a shared
 * detention/mitigation pond under FBC §5.02(h)(1). Nothing about it is a legal test, and that
 * presentation does not change here.
 *
 * In COLORADO it is the law. Under the prior-appropriation doctrine, water detained on your land
 * is water taken from a downstream senior right, so detention is an out-of-priority diversion
 * unless it drains fast enough. C.R.S. 37-92-602(8) sets the bright line:
 *
 *     ≥ 97% of the runoff from a 5-YEAR storm released within  72 hours
 *     ≥ 99% of the runoff from events EXCEEDING the 5-year released within 120 hours
 *
 * A facility that meets it gets a REBUTTABLE PRESUMPTION of no material injury to water rights.
 * A facility that does not is an out-of-priority diversion in a state that takes that seriously.
 * Separately, any stormwater detention facility CONSTRUCTED AFTER 5 AUGUST 2015 must be notified
 * to the State Engineer before it begins operating, with its location, surface area at design
 * volume, and drain-rate data.
 *
 * WHY THIS IS CHEAP AND WORTH DOING NOW: the engine already exists. drawdownTime.js computes
 * time-to-empty per pond and site-wide. This module turns that number into a jurisdiction-aware
 * PASS/FAIL — Colorado only — and leaves Texas exactly as it was.
 *
 * ⚠ THE OPTIMISM CAVEAT MATTERS MORE HERE THAN IN TEXAS. drawdownTime's figure is a constant-rate
 * LOWER bound: real outflow decays as head drops, so the true drawdown is always LONGER. A
 * screening number that clears 72 hours by a small margin therefore does NOT establish compliance —
 * it establishes that compliance is not yet ruled out. This module says so on every pass, because
 * a false "compliant" on a water-rights test is the expensive direction to be wrong in.
 *
 * Pure. No React, no DOM. Node-testable.
 */

const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

/* The statute as a versioned rule record, the same shape the detention rules use: cited, dated,
 * and never a bare constant. Keyed by state so Texas resolves to null and keeps its readout. */
export const DRAWDOWN_STATUTES = {
  CO: {
    id: "crs-37-92-602-8",
    state: "CO",
    authority: "Colorado Division of Water Resources / State Engineer",
    citation: "C.R.S. 37-92-602(8)",
    label: "Colorado stormwater detention drainage requirement",
    verified: true,
    verifiedOn: "2026-07-29",
    effectiveDate: "2015-08-05",
    tests: [
      {
        id: "five-year",
        label: "5-year storm",
        releaseFraction: 0.97,
        withinHr: 72,
        text: "At least 97% of the runoff from a 5-year storm must be released within 72 hours.",
      },
      {
        id: "greater-than-five-year",
        label: "Events exceeding the 5-year",
        releaseFraction: 0.99,
        withinHr: 120,
        text: "At least 99% of the runoff from events greater than the 5-year must be released within 120 hours.",
      },
    ],
    presumption:
      "A facility that meets both tests carries a rebuttable presumption of no material injury to " +
      "vested water rights. One that does not is an out-of-priority diversion in a prior-appropriation state.",
    notification: {
      afterDate: "2015-08-05",
      text:
        "A stormwater detention facility constructed after 5 August 2015 must be notified to the State " +
        "Engineer BEFORE it begins operating, reporting its location, surface area at the design volume, " +
        "and drain-rate data.",
    },
    note:
      "Water-rights compliance, not a drainage-criteria requirement — it applies on top of whatever " +
      "MHFD or the county manual requires, and the two are sized by different reasoning. Confirm with " +
      "your water-rights counsel and the Division of Water Resources.",
  },
};

export const statuteForState = (state) => DRAWDOWN_STATUTES[String(state || "").toUpperCase()] || null;

/* Evaluate ONE test against a screening drawdown time.
 *
 * `hoursToEmpty` is time to release the FULL stored volume at the allowable rate. The statute is
 * written against a fraction of a specific storm's runoff, so this is deliberately a CONSERVATIVE
 * proxy: releasing 100% of the design volume within the limit necessarily releases 97% (or 99%)
 * of a smaller storm's runoff within it. That direction of approximation is the safe one — it can
 * report "not established" when the facility would in fact comply, and cannot report compliance
 * for one that would not. `proxy:true` and `proxyNote` say so on every result. */
function evalTest(test, hoursToEmpty) {
  const h = num(hoursToEmpty);
  if (h == null) {
    return { id: test.id, label: test.label, verdict: "unknown", hours: null, limitHr: test.withinHr, reason: "drawdown time not computable — the allowable release rate is not set." };
  }
  const pass = h <= test.withinHr;
  return {
    id: test.id,
    label: test.label,
    verdict: pass ? "not-ruled-out" : "fail",
    hours: h,
    limitHr: test.withinHr,
    marginHr: test.withinHr - h,
    releaseFraction: test.releaseFraction,
    text: test.text,
    reason: pass
      ? `Full stored volume releases in ${h < 48 ? `${h.toFixed(1)} hr` : `${(h / 24).toFixed(1)} days`}, inside the ${test.withinHr}-hour limit.`
      : `Full stored volume takes ${h < 48 ? `${h.toFixed(1)} hr` : `${(h / 24).toFixed(1)} days`} to release — past the ${test.withinHr}-hour limit.`,
  };
}

/* THE assessment a Colorado pond panel renders.
 *
 *   state          "CO" | "TX" | null — from coloradoRegions.siteState. Anything but "CO" returns
 *                  `applies:false` and the caller keeps today's informational readout untouched.
 *   drawdown       the assessDrawdown() result from drawdownTime.js (site + per-pond hours).
 *   constructedAfter2015  true | false | null — drives the State Engineer notification note.
 *                  null (unknown) still SHOWS the note, because a new pond on a screening plan is
 *                  overwhelmingly a post-2015 facility and a missed notification is not recoverable.
 *
 * Verdicts are deliberately three-valued and deliberately NOT called "pass":
 *   "fail"          — over the limit even on the optimistic bound. This one is solid: the real
 *                     drawdown is longer, so a screening failure is a real failure.
 *   "not-ruled-out" — inside the limit on the optimistic bound. NOT compliance.
 *   "unknown"       — no release rate, so no answer.
 */
export function assessStatutoryDrawdown({ state = null, drawdown = null, constructedAfter2015 = null } = {}) {
  const statute = statuteForState(state);
  if (!statute) return { applies: false, statute: null, verdict: null, tests: [], note: null };

  if (!drawdown || drawdown.known !== true) {
    return {
      applies: true,
      statute,
      verdict: "unknown",
      tests: statute.tests.map((t) => evalTest(t, null)),
      ponds: [],
      headline: "Colorado water-rights drawdown — not yet checkable",
      reason: (drawdown && drawdown.reason) || "allowable release rate not set — enter the jurisdiction's release rate (or the pond's outlet capacity) to screen the C.R.S. 37-92-602(8) tests.",
      notification: notificationNote(statute, constructedAfter2015),
      proxy: true,
      proxyNote: PROXY_NOTE,
      note: statute.note,
    };
  }

  const siteHours = drawdown.site ? num(drawdown.site.hours) : null;
  const tests = statute.tests.map((t) => evalTest(t, siteHours));
  const ponds = (drawdown.ponds || []).map((p) => ({
    id: p.id, name: p.name, hours: num(p.hours),
    tests: statute.tests.map((t) => evalTest(t, num(p.hours))),
  }));
  // Site-wide governs the headline, but a single non-compliant pond is a non-compliant facility —
  // the statute applies per FACILITY, not to the site average.
  const anyFail = tests.some((t) => t.verdict === "fail") || ponds.some((p) => p.tests.some((t) => t.verdict === "fail"));
  const anyUnknown = tests.some((t) => t.verdict === "unknown");
  const verdict = anyFail ? "fail" : anyUnknown ? "unknown" : "not-ruled-out";

  return {
    applies: true,
    statute,
    verdict,
    tests,
    ponds,
    siteHours,
    headline: anyFail
      ? "Fails the Colorado 72-hour drawdown statute"
      : anyUnknown ? "Colorado water-rights drawdown — not yet checkable"
      : "Colorado drawdown statute not ruled out",
    reason: anyFail
      ? "Detention that drains this slowly is an out-of-priority diversion under C.R.S. 37-92-602(8) — a water-rights problem, not a drainage-criteria one. Increase the release rate or reduce the stored volume."
      : anyUnknown ? "Enter the allowable release rate to screen the statute."
      : "The screening drawdown sits inside both statutory limits. That is not a compliance finding — see the caveat.",
    presumption: statute.presumption,
    notification: notificationNote(statute, constructedAfter2015),
    proxy: true,
    proxyNote: PROXY_NOTE,
    note: statute.note,
  };
}

const PROXY_NOTE =
  "Screening only, and optimistic in one direction: the drawdown time is a constant-rate lower bound " +
  "(real outflow decays as the water level drops), and the full stored volume stands in for the " +
  "statute's storm-specific runoff fractions. A result inside the limit means non-compliance is NOT " +
  "ruled out — it is not a finding of compliance. A result outside it is real.";

function notificationNote(statute, constructedAfter2015) {
  if (constructedAfter2015 === false) {
    return { required: false, text: "Constructed before 5 August 2015 — the State Engineer notification requirement does not apply.", certain: true };
  }
  return {
    required: true,
    certain: constructedAfter2015 === true,
    text: statute.notification.text,
    // An unknown construction date still surfaces the requirement — see the doc comment above.
    assumed: constructedAfter2015 == null,
  };
}
