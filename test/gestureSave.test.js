/* NEW-1 (B217540 recurrence ×2) — a gesture in flight is not a save point. The pure rule + the wiring guards.
 * The browser half (a real drag, counted writes) is e2e/gesture-save-deferral.spec.js. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { GESTURE_SAVE_DEFER_MAX_MS, GESTURE_SAVE_POLL_MS, deferSaveDecision } from "../src/workspaces/site-planner/lib/gestureSave.js";

const planner = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

describe("deferSaveDecision", () => {
  it("defers on the first frame of a gesture, and while inside the window", () => {
    expect(deferSaveDecision(0, 1_000_000)).toBe("defer");
    expect(deferSaveDecision(1000, 1000 + GESTURE_SAVE_DEFER_MAX_MS - 1)).toBe("defer");
  });
  it("EXPIRES — a gesture that never ends can never switch autosave off", () => {
    expect(deferSaveDecision(1000, 1000 + GESTURE_SAVE_DEFER_MAX_MS)).toBe("write");
    expect(deferSaveDecision(1000, 1000 + 10 * GESTURE_SAVE_DEFER_MAX_MS)).toBe("write");
  });
  it("the window is long enough to cover a real drag and short enough to be a crash-safety net", () => {
    expect(GESTURE_SAVE_DEFER_MAX_MS).toBeGreaterThanOrEqual(2000);
    expect(GESTURE_SAVE_DEFER_MAX_MS).toBeLessThanOrEqual(10000);
    expect(GESTURE_SAVE_POLL_MS).toBeLessThan(400);   // the settle must still land inside the 400 ms push debounce's order of magnitude
  });
});

describe("wiring — the autosave effect", () => {
  const start = planner.indexOf("const [saveTick, setSaveTick] = useState(0);");
  const end = planner.indexOf("}, [siteId, saveTick, parcels, els,", start);
  const body = planner.slice(start, end);
  it("asks the rule BEFORE any storage work (the 'is this new?' read and the writes come after)", () => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const decide = body.indexOf("deferSaveDecision(");
    expect(decide).toBeGreaterThan(0);
    expect(decide).toBeLessThan(body.indexOf("siteExistsLocally(siteId)"));
    expect(decide).toBeLessThan(body.indexOf("saveSite(payload)"));
  });
  it("keeps the per-element sync diff current while deferring (it already defers its own flush)", () => {
    const deferred = body.slice(body.indexOf("deferSaveDecision("), body.indexOf("deferSaveSince.current = 0;"));
    expect(deferred).toContain("reconcileElems(true)");
  });
  it("re-runs itself when the gesture ends (saveTick is a dependency and the poll bumps it), with no gesture-end site to forget", () => {
    expect(planner).toContain("[siteId, saveTick, parcels, els,");
    expect(body).toContain("setSaveTick((n) => n + 1)");
    expect(body).toContain("GESTURE_SAVE_POLL_MS");
  });
  it("clears its poll on cleanup so an unmount or a newer frame never leaves a stray timer", () => {
    expect(body).toMatch(/return \(\) => \{ if \(poll\) clearTimeout\(poll\); \};/);
  });
});
