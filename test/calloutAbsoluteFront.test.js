/* B806080 round 2 — "Bring to front" on a callout must reach the ABSOLUTE top of the plan, not
 * just the top of its own family. The owner corrected his own brief after finding this measured,
 * live, on the merged round-1 fix:
 *
 *   Plan smt7q6ar8egz, callout e1455193brcgly ("WE WOULD BE REQUIRED TO DEDICATE THIS PORTION OF
 *   THE MAJOR THOROUGHFARE"), z=34816 — already the HIGHEST z of any callout on the plan. It still
 *   painted UNDER area measurement e1454898kaaymz (z=0, a 60%-opaque cream wash) that overlaps it,
 *   while the app's own "Bring to Front" told him it was "Already in front of everything on the
 *   plan." The z values prove z was never the mechanism: 34816 > 0 and the measurement still won.
 *
 * `arrangeAcrossBands` (round 1's own mechanism, still correct for what it does) can only ever
 * reorder a callout against OTHER CALLOUTS — it reasons over one family's `items` array and has no
 * way to reach a measurement or a markup, which live in separate collections and separate render
 * passes. And PAINT_LADDER's own rung 10 ("a measurement outranks decoration", B548819, an owner
 * default) sits structurally ABOVE every callout rung a within-family reorder could ever produce.
 * So `af.atTop` — true the instant a callout is the highest of the callout family alone — was
 * never the right fact to build the toast from, and IS the reason the toast lied.
 *
 * These are the two new pure functions (lib/arrange.js) that fix it: `calloutFrontForceZ` computes
 * where a forced callout must land to clear every other FORCED callout, and
 * `calloutAtAbsoluteFront` is the one fact "Already in front of everything" may be built from.
 */
import { describe, it, expect } from "vitest";
import { calloutAtAbsoluteFront, calloutFrontForceZ, arrangeAcrossBands } from "../src/workspaces/site-planner/lib/arrange.js";

describe("B806080 round 2 — calloutAtAbsoluteFront / calloutFrontForceZ", () => {
  it("an untouched callout (no frontForce) is never at the absolute front, whatever its z", () => {
    const callouts = [{ id: "co1", z: 999999 }];
    expect(calloutAtAbsoluteFront(callouts, "co1")).toBe(false);
  });

  it("a forced callout alone on the plan IS at the absolute front", () => {
    const callouts = [{ id: "co1", z: 34816, frontForce: true }];
    expect(calloutAtAbsoluteFront(callouts, "co1")).toBe(true);
  });

  it("a forced callout below another forced callout's z is NOT at the absolute front", () => {
    const callouts = [
      { id: "co1", z: 100, frontForce: true },
      { id: "co2", z: 200, frontForce: true },
    ];
    expect(calloutAtAbsoluteFront(callouts, "co1")).toBe(false);
    expect(calloutAtAbsoluteFront(callouts, "co2")).toBe(true);
  });

  it("calloutFrontForceZ leaves the current z alone when there is no other forced peer", () => {
    const callouts = [{ id: "co1", z: 34816 }];
    expect(calloutFrontForceZ(callouts, "co1", 34816)).toBe(34816);
  });

  it("calloutFrontForceZ lifts above every OTHER forced callout, regardless of the target's own z", () => {
    const callouts = [
      { id: "co1", z: 999999 },              // the callout being forced — its own huge z is irrelevant
      { id: "co2", z: 50, frontForce: true }, // already forced, lower z
    ];
    const z = calloutFrontForceZ(callouts, "co1", 999999);
    expect(z).toBeGreaterThan(50);
  });

  it("⛔ THE OWNER'S EXACT MEASURED CASE — replays what the pre-fix mechanism actually did", () => {
    // The pre-fix "Bring to Front" ran arrangeAcrossBands over the callout family ALONE. His
    // WETLANDS callout (z=34816) was already the highest of any callout (next: 29696), so this is
    // exactly what production reported — a genuine no-op, hence the (wrong) "already in front" toast.
    const callouts = [
      { id: "e1455193brcgly", z: 34816 }, // the reported callout
      { id: "phaseIV", z: 29696 },        // "next-highest callout", per the owner's own SELECT
    ];
    const preFixResult = arrangeAcrossBands(callouts, "e1455193brcgly", "front");
    expect(preFixResult, "arrangeAcrossBands genuinely cannot move it further — it was never the mechanism that was broken").toBeNull();

    // The NEW mechanism does not ask arrangeAcrossBands at all for "front" on a callout — and
    // BEFORE it is ever forced, `calloutAtAbsoluteFront` correctly says it is NOT at the front,
    // which is the one-sentence proof the old toast was lying.
    expect(calloutAtAbsoluteFront(callouts, "e1455193brcgly")).toBe(false);
  });
});
