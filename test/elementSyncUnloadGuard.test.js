import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* B901 anti-drift guard: the element-sync engine's last-ditch keepalive commit must be wired
 * directly to the browser's real unload signals (beforeunload / visibilitychange-hidden), not
 * ONLY to the app's internal forced-reload registry (registerFlush/flushAll, which fires solely
 * on chunk-recovery or the ErrorBoundary's own "Reload" button — see app/flushRegistry.js). A
 * genuine user-initiated reload/close never called flushAll(), so a still-debounced per-element
 * edit (e.g. clearing a pond's outlet) could miss its keepalive commit before the tab unloaded.
 * This is a source-text guard (the rendered behavior needs a signed-in browser to fully exercise
 * — see VERIFICATION.md V376) mirroring the existing B761/B762 guard pattern in
 * test/layerPanelV2Guards.test.js: it fails loudly if a future edit silently drops the direct
 * unload wiring back to registerFlush-only. */
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("B901 — element-sync keepalive flush is wired to REAL browser unload, not just the forced-reload registry", () => {
  const src = read("../src/workspaces/site-planner/SitePlanner.jsx");

  it("the element-sync flush effect listens for the native beforeunload event directly", () => {
    // Find the element-sync keepalive-commit block by its distinctive keepaliveCommit call, then
    // confirm a real `beforeunload` listener sits in the same effect (not just registerFlush).
    const idx = src.indexOf("keepaliveCommit({ url, anon, token: currentAccessToken(), siteId, ops })");
    expect(idx, "keepaliveCommit call site not found — has it moved or been renamed?").toBeGreaterThan(-1);
    const block = src.slice(Math.max(0, idx - 800), idx + 800);
    expect(block).toMatch(/window\.addEventListener\(\s*["']beforeunload["']\s*,\s*runFlush\s*\)/);
    expect(block).toMatch(/document\.addEventListener\(\s*["']visibilitychange["']\s*,\s*onVis\s*\)/);
  });

  it("still ALSO registers with the forced-reload registry (belt-and-suspenders, not a replacement)", () => {
    const idx = src.indexOf("keepaliveCommit({ url, anon, token: currentAccessToken(), siteId, ops })");
    const block = src.slice(Math.max(0, idx - 800), idx + 800);
    expect(block).toMatch(/registerFlush\(runFlush\)/);
  });

  it("re-diffs the live collections before reading pendingOps (a very last edit may not have been diffed into the dirty queue yet)", () => {
    const idx = src.indexOf("keepaliveCommit({ url, anon, token: currentAccessToken(), siteId, ops })");
    const block = src.slice(Math.max(0, idx - 800), idx + 200);
    expect(block).toMatch(/reconcileElems\(false\)/);
  });
});
