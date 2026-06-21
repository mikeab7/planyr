import { describe, it, expect } from "vitest";
import { planAutosave } from "../src/workspaces/doc-review/lib/autosavePlan.js";
import { isStoredSource, storeSource } from "../src/workspaces/doc-review/lib/reviewStore.js";

/* B319/NEW-4 — a genuine edit made inside the ~1.5 s post-open suspend window must still be
 * mirrored + flagged dirty (so it's recoverable and flushes to the cloud), while only the
 * programmatic-load echo is skipped and only the debounced cloud re-save is suppressed. */
describe("planAutosave — post-load suspend window no longer eats real edits (B319)", () => {
  it("a programmatic-load echo is skipped entirely, and the echo flag is consumed", () => {
    expect(planAutosave({ enabled: true, empty: false, loadEcho: true, suspended: true }))
      .toEqual({ consumeEcho: true, markDirty: false, mirror: false, scheduleSave: false });
    // loadEcho wins even over empty/disabled, so the flag never leaks into the next real edit.
    expect(planAutosave({ enabled: false, empty: true, loadEcho: true, suspended: false }).consumeEcho).toBe(true);
  });

  it("a real edit INSIDE the suspend window mirrors + flags dirty but does NOT debounce-save", () => {
    expect(planAutosave({ enabled: true, empty: false, loadEcho: false, suspended: true }))
      .toEqual({ consumeEcho: false, markDirty: true, mirror: true, scheduleSave: false });
  });

  it("a real edit OUTSIDE the window mirrors, flags dirty, AND debounce-saves", () => {
    expect(planAutosave({ enabled: true, empty: false, loadEcho: false, suspended: false }))
      .toEqual({ consumeEcho: false, markDirty: true, mirror: true, scheduleSave: true });
  });

  it("a blank or disabled review writes nothing (and isn't an echo to consume)", () => {
    for (const args of [{ empty: true }, { enabled: false }]) {
      const p = planAutosave({ enabled: true, empty: false, loadEcho: false, suspended: false, ...args });
      expect(p).toEqual({ consumeEcho: false, markDirty: false, mirror: false, scheduleSave: false });
    }
  });
});

/* B318/NEW-3 — buildSnapshot must not persist a source whose bytes aren't stored yet (no key),
 * or a quick reload mid-upload strands the backdrop with an unfetchable pointer. */
describe("isStoredSource — only a really-stored source is persistable (B318)", () => {
  it("true once it has a Drive key, a Supabase key, or is known-oversize", () => {
    expect(isStoredSource({ storageKey: "uid/project-x/civil/src1.pdf" })).toBe(true);
    expect(isStoredSource({ driveKey: "project-x/civil/a.pdf" })).toBe(true);
    expect(isStoredSource({ oversize: true })).toBe(true); // the loader turns this into a "re-drop"
  });
  it("false while still uploading (keyless) or absent — never persisted", () => {
    expect(isStoredSource({ storageKey: null, driveKey: null, oversize: false })).toBe(false);
    expect(isStoredSource({})).toBe(false);
    expect(isStoredSource(null)).toBe(false);
    expect(isStoredSource(undefined)).toBe(false);
  });
});

/* B317/NEW-2 — interactively-opened + stitched sources go through the same Drive-first,
 * Supabase-fallback path as filing. With no cloud configured the helper degrades cleanly
 * (no key, never throws) rather than half-writing. */
describe("storeSource — Drive-first/Supabase-fallback, degrades gracefully (B317)", () => {
  it("returns an unstored-but-clean result when the cloud isn't configured", async () => {
    const r = await storeSource("src1", { size: 10, type: "application/pdf" }, { projectId: "p1", discipline: "Civil", fileName: "a.pdf" });
    expect(r.ok).toBe(false);
    expect(r.storageKey).toBeNull();
    expect(r.driveKey).toBeNull();
    expect(r.oversize).toBe(false);
    expect(r.driveSkipped).toBe(true); // Drive was skipped (not a hard error), so no driveError surfaced
    expect(r.driveError).toBeNull();
  });
  it("a result that didn't store anything is correctly judged not-persistable", async () => {
    const r = await storeSource("src2", { size: 10, type: "application/pdf" }, {});
    expect(isStoredSource(r)).toBe(false);
  });
});
