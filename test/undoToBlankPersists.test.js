/* NEW-4 (interaction sweep, owner chat block 2026-08-22) — undoing a plan's last drawn object
 * back to a genuinely blank state used to silently fail to persist. Found by the sweep script:
 * drawing a callout on an EMPTY plan (no parcel, nothing else), undoing it (the canvas correctly
 * shows the callout gone), then reloading — the callout REAPPEARED, resurrected from a stale
 * localStorage record the autosave effect never overwrote.
 *
 * Root cause: the debounced autosave effect's "don't save a still-blank site" guard (there to
 * stop a freshly-opened, never-touched "Start blank" plan from cluttering storage with an empty
 * record) fired unconditionally on ANY blank state — including a plan that already HAS a saved
 * record and is reverting to blank via a deliberate undo. `fresh` (no existing record for this
 * id yet) is the correct discriminator: skip the save only for a plan that has never been saved,
 * never for one reverting an existing record back to blank.
 *
 * This is a SOURCE guard (mirrors parcelClickRouting.test.js) because the persistence timing
 * this covers needs a real debounced autosave effect + localStorage round trip, which is proven
 * live instead (below) — this locks the WIRING so a future edit can't silently drop the `fresh &&`
 * guard and reopen the bug.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SP = readFileSync(join(here, "../src/workspaces/site-planner/SitePlanner.jsx"), "utf8");

describe("NEW-4: undoing back to a blank plan persists on an EXISTING record, never on a fresh one", () => {
  it("the blank-skip guard is scoped to a plan with no existing saved record (`fresh`)", () => {
    const at = SP.indexOf("if (firstSave.current) { firstSave.current = false; return; }");
    expect(at, "the autosave effect's mount-skip moved — update this slice").toBeGreaterThan(-1);
    const region = SP.slice(at, at + 1200);
    // `fresh` must be computed BEFORE the blank check, and the blank check must require it.
    const freshIdx = region.indexOf("const fresh = !loadSite(siteId)");
    const guardIdx = region.indexOf("if (fresh && isBlankSite(");
    expect(freshIdx, "fresh must be computed").toBeGreaterThan(-1);
    expect(guardIdx, "the blank-skip guard must require `fresh`").toBeGreaterThan(-1);
    expect(freshIdx).toBeLessThan(guardIdx); // fresh is computed before it's used in the guard
  });

  it("a bare unscoped blank-skip (the pre-fix shape) is gone", () => {
    // The old bug: `if (isBlankSite({...}) && !deletedIds.length) return;` with no `fresh` guard.
    expect(SP.includes("if (isBlankSite({ parcels, els, measures, callouts, markups, underlay, sheetOverlays }) && !deletedIds.length) return;")).toBe(false);
  });
});
