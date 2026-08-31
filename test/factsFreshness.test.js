/* NEW-4 — the flood/drainage check is MANUAL, and its freshness is a light.
 *
 * Owner decision, restated 2026-08-06: "seems like it only needs it once after relevant elements are
 * moved, and so maybe we just only do it manually, leave it green while elements are in the same
 * spot, once they're moved turn it red so we know to recheck."
 *
 * Two properties are load-bearing and both are pinned here:
 *   1. FOUR STATES, NOT THREE. "never checked" and "checked and still valid" are different facts;
 *      collapsing them makes a blank read as an all-clear, which is the silent-failure class.
 *   2. THE NETWORK/GEOMETRY KEY IS LOOSE ON PURPOSE. Only a move that genuinely invalidates the
 *      FETCHED data — outgrowing the envelope, drifting the sampled anchor — turns THAT reason red;
 *      the pure math still recomputes live off the cached facts for anything smaller, so the
 *      network answer itself is never stale over a small in-envelope nudge.
 *
 * ⛔ NEW-7 (owner live pass 2026-08-31, verbatim: "if I had run it and then changed elements") —
 * property 2 above turned out to be narrower than what he actually asked for the FIRST time
 * (2026-08-06's own quote already says "once they're moved turn it red"). Repro: nudging one
 * building 5 ft with the arrow keys (a real edit — Undo armed) left the light green, because the
 * move never grew the site's overall envelope past the 2-ft tolerance. The numbers were never
 * wrong (recompute is still live and correct) — the LIGHT just never told him the verdict he was
 * looking at predates his edit. `editedSinceCheck` is a SEPARATE, additive trigger for exactly
 * that — a site-element edit (SitePlanner.jsx's own undo-history counter) since the last check —
 * checked LAST, after the two network-facing tests, and it does not loosen or replace the
 * envelope/anchor key those two properties describe; a network re-fetch is still only requested
 * when the geometry genuinely outgrows what was fetched.
 */
import { describe, it, expect } from "vitest";
import { factsFreshness, canonEnv, FRESHNESS_REASONS, ANCHOR_DRIFT_FT } from "../src/workspaces/site-planner/lib/factRevalidation.js";

const env = canonEnv({ mnX: 0, mnY: 0, mxX: 1000, mxY: 1000 });
const lastCheck = (over = {}) => ({
  sig: "2:435600:0,0:29.7604,-95.3698:1@0,0,20,20",
  fetch: { env, anchorPt: { x: 500, y: 500 }, groundPt: { x: 500, y: 500 } },
  checkedAt: Date.now() - 3 * 86400000,
  ...over,
});
const geom = { bboxNow: { mnX: 100, mnY: 100, mxX: 900, mxY: 900 }, anchorNow: { x: 500, y: 500 }, groundNow: { x: 500, y: 500 } };

describe("four states, never three", () => {
  it("a plan nothing has ever run against is UNCHECKED — not a pass and not a failure", () => {
    expect(factsFreshness({}).state).toBe("unchecked");
    expect(factsFreshness({ sigNow: "anything" }).state).toBe("unchecked");
  });

  it("a run in flight is CHECKING, and outranks everything else", () => {
    // Even a plainly stale plan reads "checking" while the answer is being fetched — a red light
    // over a live fetch tells the user to do the thing they are already doing.
    expect(factsFreshness({ busy: true, lastCheck: lastCheck(), sigNow: "moved", ...geom }).state).toBe("checking");
    expect(factsFreshness({ busy: true }).state).toBe("checking");
  });

  it("a live check this session with no remembered record is FRESH", () => {
    expect(factsFreshness({ hasSessionCtx: true, sigNow: "x" }).state).toBe("fresh");
  });

  it("a remembered check whose signature still matches is FRESH", () => {
    const lc = lastCheck();
    expect(factsFreshness({ lastCheck: lc, sigNow: lc.sig, ...geom }).state).toBe("fresh");
  });
});

describe("red means the answer no longer describes the drawing", () => {
  it("goes STALE when the signature moved, and says why in one sentence", () => {
    const r = factsFreshness({ lastCheck: lastCheck(), sigNow: "3:500000:0,0:29.7604,-95.3698:2@0,0,40,40", ...geom });
    expect(r.state).toBe("stale");
    expect(r.reason).toBe("moved");
    expect(r.note).toBe(FRESHNESS_REASONS.moved);
  });

  it("goes STALE when the drawing outgrew the area that was fetched", () => {
    const lc = lastCheck();
    const r = factsFreshness({ lastCheck: lc, sigNow: lc.sig, bboxNow: { mnX: -500, mnY: 0, mxX: 1000, mxY: 1000 }, anchorNow: { x: 500, y: 500 }, groundNow: { x: 500, y: 500 } });
    expect(r.state).toBe("stale");
    expect(r.reason).toBe("env-exit");
  });

  it("goes STALE when the fill drifted away from where it was sampled", () => {
    const lc = lastCheck();
    const r = factsFreshness({ lastCheck: lc, sigNow: lc.sig, ...geom, anchorNow: { x: 500 + ANCHOR_DRIFT_FT + 10, y: 500 } });
    expect(r.state).toBe("stale");
    expect(r.reason).toBe("anchor-moved");
  });

  it("goes STALE when the parcel drifted away from where it was sampled", () => {
    const lc = lastCheck();
    const r = factsFreshness({ lastCheck: lc, sigNow: lc.sig, ...geom, groundNow: { x: 500, y: 500 + ANCHOR_DRIFT_FT + 10 } });
    expect(r.state).toBe("stale");
    expect(r.reason).toBe("ground-moved");
  });

  it("every reason carries owner-facing words — a red light with no sentence is a puzzle", () => {
    for (const [, note] of Object.entries(FRESHNESS_REASONS)) {
      expect(note.length).toBeGreaterThan(10);
      expect(note).toMatch(/^[a-z]/); // a fragment that reads under "why?", not a shouted label
    }
  });
});

describe("the network/geometry key is LOOSE on purpose — an in-envelope edit never needs a re-fetch", () => {
  const lc = lastCheck();
  it("a sub-envelope move of the fill keeps the FETCH reason green (editedSinceCheck not asked)", () => {
    // Inside the fetched envelope and under the drift threshold: the ledgers recompute live off the
    // cached facts, so the NETWORK answer on screen IS current — no re-fetch is owed. This is the
    // envelope/anchor key alone; the caller (SitePlanner.jsx) ALSO asks `editedSinceCheck` in the
    // live app (see the NEW-7 block below), which is a separate, additive signal this call doesn't set.
    const r = factsFreshness({ lastCheck: lc, sigNow: lc.sig, ...geom, anchorNow: { x: 500 + ANCHOR_DRIFT_FT - 5, y: 500 } });
    expect(r.state).toBe("fresh");
  });

  it("an identical signature keeps it green no matter how long ago the check was", () => {
    const old = lastCheck({ checkedAt: Date.now() - 400 * 86400000 });
    expect(factsFreshness({ lastCheck: old, sigNow: old.sig, ...geom }).state).toBe("fresh");
  });

  it("a remembered check with no fetch record still reads on its signature alone", () => {
    const noFetch = { sig: "s", checkedAt: Date.now() };
    expect(factsFreshness({ lastCheck: noFetch, sigNow: "s" }).state).toBe("fresh");
    expect(factsFreshness({ lastCheck: noFetch, sigNow: "t" }).state).toBe("stale");
  });

  it("a missing signature on either side never fabricates a red", () => {
    // An absent sig is "I don't know", and "I don't know" must not render as "your numbers are wrong".
    expect(factsFreshness({ lastCheck: { fetch: null }, sigNow: "x" }).state).toBe("fresh");
    expect(factsFreshness({ lastCheck: lastCheck(), sigNow: "", ...geom }).state).toBe("fresh");
  });
});

// NEW-7 (owner live pass 2026-08-31, V496866 follow-on) — "if I had run it and then changed
// elements". A site-element edit turns the light STALE even when it stays well inside the
// fetched envelope (a small nudge, a resize) — the caller supplies this as `editedSinceCheck`
// from its own undo-history counter; this module stays network/geometry-pure otherwise.
describe("NEW-7 — editedSinceCheck: an element edit turns the light stale, keeping the run date", () => {
  it("an edit since the check flips a fresh check to stale, reason 'edited'", () => {
    const lc = lastCheck();
    const r = factsFreshness({ lastCheck: lc, sigNow: lc.sig, ...geom, editedSinceCheck: true });
    expect(r.state).toBe("stale");
    expect(r.reason).toBe("edited");
    expect(r.note).toBe(FRESHNESS_REASONS.edited);
  });

  it("with no edit since the check, an otherwise-fresh plan stays fresh", () => {
    const lc = lastCheck();
    const r = factsFreshness({ lastCheck: lc, sigNow: lc.sig, ...geom, editedSinceCheck: false });
    expect(r.state).toBe("fresh");
  });

  it("a genuine env-exit/anchor-drift reason still wins its own name over the generic 'edited' one", () => {
    // Both can be true at once (an edit that also grew the envelope) — the more specific,
    // network-facing reason is checked first and must not be masked by the edit flag.
    const lc = lastCheck();
    const r = factsFreshness({ lastCheck: lc, sigNow: lc.sig, bboxNow: { mnX: -500, mnY: 0, mxX: 1000, mxY: 1000 }, anchorNow: { x: 500, y: 500 }, groundNow: { x: 500, y: 500 }, editedSinceCheck: true });
    expect(r.reason).toBe("env-exit");
  });

  it("a busy (in-flight) check still outranks an edit flag — 'checking' wins", () => {
    expect(factsFreshness({ busy: true, lastCheck: lastCheck(), sigNow: "moved", ...geom, editedSinceCheck: true }).state).toBe("checking");
  });

  it("an edit flag alone never fabricates a check on a plan that was never checked", () => {
    expect(factsFreshness({ editedSinceCheck: true }).state).toBe("unchecked");
  });
});

describe("the source wiring — the light must not be gated on the auto pass", () => {
  it("the facts pass is OPT-IN, so nothing is fetched when a plan is opened", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    // `!== false` (opt-OUT) is what ran a GIS pull plus a DEM grid on every open.
    expect(src).toContain('const drainAutoEnabled = (settings.drainage?.autoFacts === true)');
    expect(src).not.toContain('settings.drainage?.autoFacts !== false');
  });

  it("the light is computed from geometry, NOT from drainAutoEnabled", async () => {
    // If the freshness inputs were gated on the auto flag they would be null on every plan, and the
    // light would be permanently grey — a silent failure that looks exactly like "nothing to say".
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    expect(src).toContain("if (!origin || !drainActive.length) return { bboxNow: null, anchorNow: null, groundNow: null };");
    expect(src).toContain("const drainFreshness = factsFreshness({");
  });

  it("NEW-7 — the light actually asks editedSinceCheck, off the undo-history counter, not a rewrite of the loose key", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
    expect(src).toContain("editedSinceCheck: drainEditedSinceCheck,");
    expect(src).toContain("drainEditStampRef.current != null && histTick !== drainEditStampRef.current");
  });
});
