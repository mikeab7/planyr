import { describe, it, expect } from "vitest";
import { planAutosave } from "../src/workspaces/doc-review/lib/autosavePlan.js";
import { isStoredSource, storeSource, guessContentType, stripFileExt } from "../src/workspaces/doc-review/lib/reviewStore.js";

/* B324/NEW-4 — a genuine edit made inside the ~1.5 s post-open suspend window must still be
 * mirrored + flagged dirty (so it's recoverable and flushes to the cloud), while only the
 * programmatic-load echo is skipped and only the debounced cloud re-save is suppressed. */
describe("planAutosave — post-load suspend window no longer eats real edits (B324)", () => {
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

/* B323/NEW-3 — buildSnapshot must not persist a source whose bytes aren't stored yet (no key),
 * or a quick reload mid-upload strands the backdrop with an unfetchable pointer. */
describe("isStoredSource — only a really-stored source is persistable (B323)", () => {
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

/* B322/NEW-2 — interactively-opened + stitched sources go through the same Drive-first,
 * Supabase-fallback path as filing. With no cloud configured the helper degrades cleanly
 * (no key, never throws) rather than half-writing. */
describe("storeSource — Drive-first/Supabase-fallback, degrades gracefully (B322)", () => {
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

/* B685 — any file type stores with a sensible content type. The browser's own file.type wins
 * when present; a typeless file (dragged CAD, some pickers) derives one from the extension so
 * Drive/Supabase don't mislabel a DWG as a PDF; a truly unknown extension is the safe generic. */
describe("guessContentType — sensible MIME for any file (B685)", () => {
  it("prefers the browser-provided type when set", () => {
    expect(guessContentType("whatever.bin", "image/png")).toBe("image/png");
  });
  it("derives from the extension when the type is empty", () => {
    expect(guessContentType("plan.pdf", "")).toBe("application/pdf");
    expect(guessContentType("site.DWG", "")).toBe("image/vnd.dwg"); // case-insensitive
    expect(guessContentType("budget.xlsx", "")).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(guessContentType("photo.jpeg", "")).toBe("image/jpeg");
  });
  it("falls back to the generic binary type for unknown / missing extensions", () => {
    expect(guessContentType("mystery.qqq", "")).toBe("application/octet-stream");
    expect(guessContentType("", "")).toBe("application/octet-stream");
    expect(guessContentType(null, null)).toBe("application/octet-stream");
  });
});

/* B686 — the display-label extension strip only removes a REAL (letter-first) extension, so
 * version-style names keep their trailing number. */
describe("stripFileExt — strip a real extension, keep version-style dotted names (B686)", () => {
  it("strips a genuine, letter-first extension", () => {
    expect(stripFileExt("survey.pdf")).toBe("survey");
    expect(stripFileExt("Site Plan.DWG")).toBe("Site Plan");
    expect(stripFileExt("budget.xlsx")).toBe("budget");
    expect(stripFileExt("2026.06.20 Plan.pdf")).toBe("2026.06.20 Plan"); // only the final ext goes
  });
  it("keeps a trailing dotted segment that starts with a digit (a version, not an extension)", () => {
    expect(stripFileExt("Rev.3")).toBe("Rev.3");
    expect(stripFileExt("Site Plan v1.2")).toBe("Site Plan v1.2");
    expect(stripFileExt("Lot2.5Acres")).toBe("Lot2.5Acres");
  });
  it("leaves an extension-less name untouched", () => {
    expect(stripFileExt("Sitemap")).toBe("Sitemap");
    expect(stripFileExt("")).toBe("");
  });
});
