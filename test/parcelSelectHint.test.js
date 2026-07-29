/* NEW-1 — "Select parcels: off" stranded the user: clicking a parcel did nothing, with no feedback.
 *
 * The live repro (owner's plan `smrjdgmlinea`): `settings.parcelSelect` was saved false into the
 * plan, so B311's click-through branch (`if (!settings.parcelSelect) return;`) let every press on a
 * lot fall through to a background pan — correct by design, but silent, per-plan-persistent, and
 * announced only by a quiet header readout. Two guards live here:
 *
 *   1. the point-of-failure hint fires EXACTLY ONCE per press that actually lands on a parcel,
 *      never on empty canvas, and never as a stream during a pan across many lots;
 *   2. `settings.parcelSelect` — what the header toggle flips — round-trips through the real
 *      save/load path, which is why an accidental flip persisted across sessions and devices in
 *      the first place (and why the toggle now announces itself when it goes off).
 *
 * The "does not select or move the parcel" half is asserted against the real render path in
 * e2e/parcel-select-toggle.spec.js — the click-through behaviour B311 exists for stays intact.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { parcelSelectHintDecision, PARCEL_HINT_COOLDOWN_MS } from "../src/workspaces/site-planner/lib/parcelSelectHint.js";

describe("parcelSelectHintDecision — when the hint is allowed to speak", () => {
  const base = { parcelSelect: false, hitParcel: true, now: 10_000, lastShownAt: 0, lastGestureId: null, gestureId: 1 };

  it("hints on the first blocked press that lands on a parcel", () => {
    expect(parcelSelectHintDecision(base)).toEqual({ show: true, reason: "hint" });
  });

  it("stays silent when selection is ON — nothing failed, so there is nothing to explain", () => {
    expect(parcelSelectHintDecision({ ...base, parcelSelect: true })).toEqual({ show: false, reason: "select-on" });
  });

  it("stays silent when the press did NOT land on a parcel (empty canvas pans, as it always has)", () => {
    expect(parcelSelectHintDecision({ ...base, hitParcel: false })).toEqual({ show: false, reason: "no-parcel" });
  });

  it("stays silent for a SECOND call carrying the same gesture id (one hint per press gesture)", () => {
    // Two hit-strokes of one lot (boundary + setback) resolving from one native pointerdown share
    // the event's timeStamp — that is the gesture identity.
    expect(parcelSelectHintDecision({ ...base, lastShownAt: base.now, lastGestureId: 1, gestureId: 1 }))
      .toEqual({ show: false, reason: "same-gesture" });
  });

  it("rate-limits a fresh gesture inside the cooldown window", () => {
    const t = 10_000;
    expect(parcelSelectHintDecision({ ...base, now: t + PARCEL_HINT_COOLDOWN_MS - 1, lastShownAt: t, lastGestureId: 1, gestureId: 2 }))
      .toEqual({ show: false, reason: "cooldown" });
  });

  it("speaks again once the cooldown has elapsed", () => {
    const t = 10_000;
    expect(parcelSelectHintDecision({ ...base, now: t + PARCEL_HINT_COOLDOWN_MS, lastShownAt: t, lastGestureId: 1, gestureId: 2 }))
      .toEqual({ show: true, reason: "hint" });
  });

  it("never keys the gesture guard on a REUSED id alone — a repeat id outside the cooldown still speaks", () => {
    // Chromium reuses pointerId 1 for every mouse press, which is exactly why the host passes
    // event.timeStamp. Belt-and-braces: a stale matching id is only suppressed while it IS the last
    // one recorded; the cooldown is the thing that expires.
    const t = 10_000;
    expect(parcelSelectHintDecision({ ...base, now: t + PARCEL_HINT_COOLDOWN_MS, lastShownAt: t, lastGestureId: 9, gestureId: 2 }).show).toBe(true);
  });

  it("treats a never-shown state (lastShownAt 0 / undefined) as free to speak", () => {
    expect(parcelSelectHintDecision({ ...base, lastShownAt: 0 }).show).toBe(true);
    expect(parcelSelectHintDecision({ parcelSelect: false, hitParcel: true, now: 5 }).show).toBe(true);
  });

  it("survives a missing input object without throwing (defensive, like the other pure reducers here)", () => {
    expect(parcelSelectHintDecision().show).toBe(false); // no hitParcel → silent
  });
});

/* The host wires the decision to a mutable "last shown" record. This replays a realistic gesture
 * stream through that exact loop, so "exactly once per press" and "not a stream during a pan" are
 * asserted as COUNTS, not as single-call booleans. */
function makeHintHost({ parcelSelect = false } = {}) {
  const shown = [];
  let last = { at: 0, gestureId: null };
  return {
    shown,
    // one native pointerdown landing on a parcel hit-stroke
    press(now, gestureId, { hitParcel = true } = {}) {
      const d = parcelSelectHintDecision({ parcelSelect, hitParcel, now, lastShownAt: last.at, lastGestureId: last.gestureId, gestureId });
      if (!d.show) return d.reason;
      last = { at: now, gestureId };
      shown.push({ now, gestureId });
      return d.reason;
    },
  };
}

describe("the blocked-press stream — exactly one hint per press, and never a stream during a pan", () => {
  it("one press on a parcel = exactly one hint, even when both of that lot's hit-strokes report it", () => {
    const h = makeHintHost();
    h.press(1_000, 1_000.5);            // boundary hit-stroke
    h.press(1_000, 1_000.5);            // same native event, setback hit-stroke
    expect(h.shown).toHaveLength(1);
  });

  it("a pan that drags across ten lots is ONE press → still exactly one hint", () => {
    const h = makeHintHost();
    // A pan is a single pointerdown; the lots crossed afterwards never re-enter the handler. Even
    // if they did, the shared gesture id suppresses them.
    for (let i = 0; i < 10; i++) h.press(2_000 + i * 30, 2_000);
    expect(h.shown).toHaveLength(1);
  });

  it("impatient repeat clicking on the same lot does not stack hints — one per cooldown window", () => {
    const h = makeHintHost();
    const t0 = 5_000;
    const reasons = [0, 200, 400, 900, 1_500].map((dt) => h.press(t0 + dt, t0 + dt));
    expect(h.shown).toHaveLength(1);
    expect(reasons.slice(1).every((r) => r === "cooldown")).toBe(true);
    // …and it speaks again for a genuinely later attempt.
    h.press(t0 + PARCEL_HINT_COOLDOWN_MS + 1, 99_999);
    expect(h.shown).toHaveLength(2);
  });

  it("presses on empty canvas never produce a hint, however many there are", () => {
    const h = makeHintHost();
    for (let i = 0; i < 25; i++) h.press(9_000 + i * 500, 9_000 + i, { hitParcel: false });
    expect(h.shown).toEqual([]);
  });

  it("with selection ON, the same stream is completely silent", () => {
    const h = makeHintHost({ parcelSelect: true });
    for (let i = 0; i < 5; i++) h.press(1_000 + i * 10_000, i);
    expect(h.shown).toEqual([]);
  });
});

/* ── The toggle's other half: what it flips is PERSISTED per plan. That persistence is precisely
 * what turned one accidental click into a cross-session, cross-device trap, so it gets a guard on
 * the real save/load path (not a hand-rolled object copy). */
describe("settings.parcelSelect persists per plan through the real save/load path", () => {
  let store;
  beforeEach(() => {
    store = {};
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
      key: (i) => Object.keys(store)[i] ?? null,
      get length() { return Object.keys(store).length; },
    };
    vi.resetModules();
  });

  it("a plan saved with the toggle OFF loads back OFF (the cross-session trap, reproduced)", async () => {
    const { saveSite, loadSite } = await import("../src/workspaces/site-planner/lib/storage.js");
    saveSite({ id: "p1", site: "Tsakiris", name: "Plan A", settings: { parcelSelect: false } });
    expect(loadSite("p1").settings.parcelSelect).toBe(false);
  });

  it("flipping it back ON persists too — the header toggle's fix actually sticks", async () => {
    const { saveSite, loadSite } = await import("../src/workspaces/site-planner/lib/storage.js");
    saveSite({ id: "p1", site: "Tsakiris", name: "Plan A", settings: { parcelSelect: false } });
    const m = loadSite("p1");
    saveSite({ ...m, settings: { ...m.settings, parcelSelect: true } });
    expect(loadSite("p1").settings.parcelSelect).toBe(true);
  });

  it("is per PLAN — turning it off in one plan does not reach into another", async () => {
    const { saveSite, loadSite } = await import("../src/workspaces/site-planner/lib/storage.js");
    saveSite({ id: "p1", site: "Tsakiris", name: "Plan A", settings: { parcelSelect: false } });
    saveSite({ id: "p2", site: "Tsakiris", name: "Plan B", settings: { parcelSelect: true } });
    expect(loadSite("p1").settings.parcelSelect).toBe(false);
    expect(loadSite("p2").settings.parcelSelect).toBe(true);
  });
});
