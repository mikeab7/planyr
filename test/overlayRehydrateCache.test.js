/* B719776 — RICHFIELD/QUIDDITY OVERLAY DOESN'T RENDER: the client fetch-and-rasterise path, not the
 * data or permissions (confirmed against production — see BACKLOG.md B719776).
 *
 * AUDIT-FIRST found two real defects in the rehydrate-from-Storage effect in `SitePlanner.jsx`
 * (the one that reruns whenever a plan opens on a device whose local IndexedDB cache doesn't already
 * hold this overlay's raster — a fresh browser, "clear site data", private mode, or a first `idbPut`
 * that silently failed):
 *
 *  (1) MISSING CACHE BACKFILL. The two OTHER places that produce a fresh raster — creating an
 *      overlay (openOverlayFile) and changing its page — both write the result back to IndexedDB
 *      (`idbPut(o.idbKey, r.src)`) so the NEXT load is instant and offline-safe. The rehydrate path
 *      downloaded from cloud Storage and re-ran PDF.js/DXF, but never wrote the result back — so
 *      EVERY reload on a cold device re-paid the full download + re-rasterize, forever.
 *
 *  (2) SILENT RASTERIZE FAILURE MISCLASSIFIED AS "NETWORK". `rasterizeStoredPdf`/`rasterizeStoredDxf`
 *      return null on ANY failure — a bad download, or PDF.js/canvas throwing while decoding a page
 *      that DID download successfully. The caller could not tell those apart: it always recorded
 *      "network" (implying a retry might help). A rasterize failure is a genuinely different, likely
 *      DETERMINISTIC failure (retrying the same bytes will not fix it) with no telemetry at all — the
 *      real bug is invisible even in production diagnostics. LOUD-FAILURE requires it be surfaced.
 *
 * This suite is a SOURCE GUARD (the effect lives inline in a 30k-line component, not an exported pure
 * function) — it replays the PRE-FIX shape as a mutation check and asserts the fixed shape is present.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");

// Isolate the rehydrate-from-storage effect body so assertions can't accidentally match one of the
// OTHER two idbPut call sites (create-time / page-change) elsewhere in the file.
const effectStart = src.indexOf("// Cross-device reload (B72): an overlay that synced only its transform");
const effectEnd = src.indexOf("}, [sheetOverlays, overlayLoadErr]);", effectStart);
if (effectStart === -1 || effectEnd === -1) throw new Error("rehydrate effect anchor text not found — SitePlanner.jsx moved; update this test's anchors");
const effectBody = src.slice(effectStart, effectEnd);

describe("(1) the rehydrate effect backfills IndexedDB on every recovered raster (B719776)", () => {
  it("the PDF branch idbPuts the re-rasterized src", () => {
    const pdfBranch = effectBody.slice(effectBody.indexOf('endsWith(".pdf")'), effectBody.indexOf('endsWith(".dxf")'));
    expect(pdfBranch).toMatch(/idbPut\(o\.idbKey,\s*r\.src\)/);
  });
  it("the DXF branch idbPuts the re-rasterized src", () => {
    const dxfBranch = effectBody.slice(effectBody.indexOf('endsWith(".dxf")'), effectBody.indexOf("} else if (key) {"));
    expect(dxfBranch).toMatch(/idbPut\(o\.idbKey,\s*r\.src\)/);
  });
  it("the image branch idbPuts the restored src", () => {
    const imgBranch = effectBody.slice(effectBody.indexOf("} else if (key) {"));
    expect(imgBranch).toMatch(/idbPut\(o\.idbKey,\s*res\.data\)/);
  });
  it("every backfill is gated on idbAvailable() (never write to a store that isn't there)", () => {
    const puts = effectBody.match(/if \(o\.idbKey && idbAvailable\(\)\) idbPut\(/g) || [];
    expect(puts.length).toBe(3); // one per branch: pdf / dxf / image
  });

  // ⛔ MUTATION CHECK — the PRE-FIX shape, replayed verbatim, to prove this suite would have caught it.
  it("[pre-fix control] a rehydrate branch with no idbPut would fail the branch assertion above", () => {
    const preFixPdfBranch = [
      'if (key.toLowerCase().endsWith(".pdf")) { // PDF: re-rasterize the stored page',
      "  res = await fetchOverlayBytes(key);",
      "  if (res.data) { const r = await rasterizeStoredPdf(res.data, o.page || 1, { knockout: o.knockout !== false });",
      '    if (r) { setSheetOverlays((arr) => arr.map((x) => (x.id === o.id && !x.src ? { ...x, src: r.src, imgW: r.imgW, imgH: r.imgH, pageCount: r.pageCount } : x))); loaded = true; } }',
    ].join("\n");
    expect(preFixPdfBranch).not.toMatch(/idbPut\(o\.idbKey,\s*r\.src\)/);
  });
});

describe("(2) a raster-step failure is LOUD and distinct from a network failure (B719776)", () => {
  it("tracks rasterFailed separately from a download failure", () => {
    expect(effectBody).toMatch(/let loaded = false,\s*rasterFailed = false;/);
    expect(effectBody).toMatch(/\}\s*else rasterFailed = true;/);
  });
  it("reports a named telemetry event naming the overlay/site — never silent (LOUD-FAILURE)", () => {
    expect(effectBody).toMatch(/reportClientEvent\("overlay-rasterize-failed"/);
    expect(effectBody).toMatch(/overlay:\s*o\.id/);
  });
  it("records a TERMINAL reason distinct from \"network\" and \"missing\" so retry copy isn't misleading", () => {
    expect(effectBody).toMatch(/if \(rasterFailed\) \{[\s\S]*?setOverlayLoadErr\(\(m\) => \(\{ \.\.\.m, \[o\.id\]: "render" \}\)\);/);
  });
  it("the rasterFailed branch runs BEFORE the generic missing/network classification (never double-classified)", () => {
    const rasterIdx = effectBody.indexOf("if (rasterFailed) {");
    const genericIdx = effectBody.indexOf('const reason = key ? (res.missing ? "missing" : "network") : "missing";');
    expect(rasterIdx).toBeGreaterThan(-1);
    expect(genericIdx).toBeGreaterThan(rasterIdx);
  });

  // ⛔ MUTATION CHECK — the PRE-FIX shape: any raster failure (network OR rasterize) fell through to
  // the same generic classifier and was silently called "network" with zero telemetry.
  it("[pre-fix control] the old classifier could not distinguish a rasterize failure from a network one", () => {
    const preFixClassifier = 'const reason = key ? (res.missing ? "missing" : "network") : "missing";';
    // The pre-fix line alone (with no rasterFailed branch ahead of it) can't express a "render" reason.
    expect(preFixClassifier).not.toMatch(/render/);
  });
});

describe("(3) the placeholder UI has a distinct label + action for a rasterize failure", () => {
  const renderStart = src.indexOf('const ovErr = overlayLoadErr[o.id];');
  const renderEnd = src.indexOf("})()}", renderStart);
  const renderBody = src.slice(renderStart, renderEnd);

  it('renders a "couldn\'t render" (not "couldn\'t reach storage") label for ovErr === "render"', () => {
    expect(renderBody).toMatch(/ovErr === "render"/);
    expect(renderBody).toMatch(/Couldn.t render/);
  });
  it("a \"render\" failure offers re-add (not the network retry, which would loop forever on the same bytes)", () => {
    // retryOverlay is only wired for the "network" branch; render/missing fall through to reAddOverlay.
    const clickHandler = renderBody.slice(renderBody.indexOf("onClick={"));
    expect(clickHandler).toMatch(/if \(ovErr === "network"\) retryOverlay\(o\.id\); else reAddOverlay\(o\.id\);/);
  });
});
